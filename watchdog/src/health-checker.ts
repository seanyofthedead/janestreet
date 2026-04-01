/**
 * Health checker — polls the engine's /health endpoint and monitors for anomalies.
 * Emits status events and triggers the kill switch when thresholds are breached.
 */

import { EventEmitter } from 'events';
import pino from 'pino';
import type { WatchdogConfig } from './config.js';
import type { KillSwitch } from './kill-switch.js';

export type WatchdogStatus = 'healthy' | 'degraded' | 'critical' | 'kill-triggered';

export interface HealthCheckResult {
  status: WatchdogStatus;
  consecutiveMisses: number;
  lastCheckTime: string;
  dailyPnl: number | null;
  orderRate: number | null;
  enginePhase: string | null;
}

interface EngineHealthResponse {
  status: string;
  timestamp: string;
  dailyPnl?: number;
  orderRate?: number;
  engineState?: string;
}

export class HealthChecker extends EventEmitter {
  private readonly config: WatchdogConfig;
  private readonly killSwitch: KillSwitch;
  private readonly logger: pino.Logger;

  private consecutiveMisses = 0;
  private currentStatus: WatchdogStatus = 'healthy';
  private lastCheckTime: string = new Date().toISOString();
  private dailyPnl: number | null = null;
  private orderRate: number | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private baselineOrderRate: number | null = null;
  private enginePhase: string | null = null;

  constructor(config: WatchdogConfig, killSwitch: KillSwitch, logger?: pino.Logger) {
    super();
    this.config = config;
    this.killSwitch = killSwitch;
    this.logger = (logger ?? pino({ name: 'health-checker' })).child({ component: 'health-checker' });
  }

  /** Start the health check polling loop */
  start(): void {
    this.logger.info(
      { intervalMs: this.config.healthCheckIntervalMs },
      'Starting health check polling',
    );

    // Use setTimeout chain instead of setInterval to prevent overlapping checks
    const scheduleNext = () => {
      this.pollTimer = setTimeout(async () => {
        await this.check();
        if (this.pollTimer !== null) scheduleNext(); // only continue if not stopped
      }, this.config.healthCheckIntervalMs);
    };
    scheduleNext();

    // Run first check immediately
    void this.check();
  }

  /** Stop the health check polling loop */
  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Health check polling stopped');
  }

  /** Get current health status */
  getStatus(): HealthCheckResult {
    return {
      status: this.currentStatus,
      consecutiveMisses: this.consecutiveMisses,
      lastCheckTime: this.lastCheckTime,
      dailyPnl: this.dailyPnl,
      orderRate: this.orderRate,
      enginePhase: this.enginePhase,
    };
  }

  /** Perform a single health check */
  async check(): Promise<void> {
    this.lastCheckTime = new Date().toISOString();

    try {
      const response = await this.fetchEngineHealth();
      this.consecutiveMisses = 0;

      // Parse engine health data
      if (response.dailyPnl !== undefined) {
        this.dailyPnl = response.dailyPnl;
      }
      if (response.orderRate !== undefined) {
        this.orderRate = response.orderRate;
        // Establish baseline on first successful read
        if (this.baselineOrderRate === null && response.orderRate > 0) {
          this.baselineOrderRate = response.orderRate;
        }
      }

      // Track engine phase/state
      this.enginePhase = response.engineState ?? null;

      // Check daily loss threshold
      if (this.dailyPnl !== null && this.dailyPnl < -this.config.dailyLossThreshold) {
        this.logger.error(
          { dailyPnl: this.dailyPnl, threshold: this.config.dailyLossThreshold },
          'Daily loss threshold breached',
        );
        await this.triggerKill('Daily loss threshold breached');
        return;
      }

      // Check order rate anomaly
      if (
        this.baselineOrderRate !== null &&
        this.orderRate !== null &&
        this.orderRate > this.baselineOrderRate * this.config.orderRateAnomalyMultiplier
      ) {
        this.logger.error(
          { orderRate: this.orderRate, baseline: this.baselineOrderRate, multiplier: this.config.orderRateAnomalyMultiplier },
          'Order rate anomaly detected',
        );
        await this.triggerKill('Order rate anomaly detected');
        return;
      }

      this.setStatus('healthy');
    } catch (err: unknown) {
      this.consecutiveMisses++;
      this.logger.warn(
        { consecutiveMisses: this.consecutiveMisses, err: err instanceof Error ? err.message : String(err) },
        'Engine health check failed',
      );

      if (this.consecutiveMisses >= this.config.maxMissedHeartbeats) {
        await this.triggerKill(
          `Engine unresponsive: ${this.consecutiveMisses} consecutive missed heartbeats`,
        );
      } else {
        this.setStatus('degraded');
      }
    }
  }

  private async fetchEngineHealth(): Promise<EngineHealthResponse> {
    const url = `http://127.0.0.1:${this.config.enginePort}/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Engine health returned ${res.status}`);
      }
      return (await res.json()) as EngineHealthResponse;
    } finally {
      clearTimeout(timeout);
    }
  }

  private setStatus(status: WatchdogStatus): void {
    if (status !== this.currentStatus) {
      this.logger.info({ from: this.currentStatus, to: status }, 'Status changed');
      this.currentStatus = status;
      this.emit(status);
    }
  }

  private async triggerKill(reason: string): Promise<void> {
    this.setStatus('critical');
    this.setStatus('kill-triggered');
    this.stop();

    this.logger.fatal({ reason }, 'Triggering kill switch');
    await this.killSwitch.activate(reason);
  }
}
