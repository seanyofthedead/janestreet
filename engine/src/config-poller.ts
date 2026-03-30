/**
 * Runtime configuration polling.
 * Polls DynamoDB config table for updated risk limits and strategy parameters.
 * Currently stubbed with defaults.
 */

import pino from 'pino';
import type { EventBus } from './event-bus.js';
import type { EngineConfig } from './config.js';

// ---------------------------------------------------------------------------
// Runtime config shape
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  /** Risk limits */
  maxPositionPct: number;
  maxSectorPct: number;
  minCashReservePct: number;
  maxDailyLossPct: number;
  maxDrawdownReducePct: number;
  maxDrawdownFlattenPct: number;
  maxOrderRatePerMin: number;
  heartbeatTimeoutSeconds: number;
  maxPositionsByPhase: number;

  /** Symbol universe */
  symbols: string[];

  /** Strategy toggles */
  enabledStrategies: Record<string, boolean>;

  /** Human acknowledgment flag (for halted state recovery) */
  humanAcknowledged: boolean;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultRuntimeConfig(): RuntimeConfig {
  return {
    maxPositionPct: 0.15,
    maxSectorPct: 0.40,
    minCashReservePct: 0.15,
    maxDailyLossPct: 0.05,
    maxDrawdownReducePct: 0.10,
    maxDrawdownFlattenPct: 0.20,
    maxOrderRatePerMin: 10,
    heartbeatTimeoutSeconds: 15,
    maxPositionsByPhase: 6,
    symbols: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
    enabledStrategies: {
      Mean_reversion: true,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,
      Market_making: true,
    },
    humanAcknowledged: false,
    lastUpdated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ConfigPoller
// ---------------------------------------------------------------------------

export class ConfigPoller {
  private readonly logger: pino.Logger;
  private readonly bus: EventBus;
  private readonly pollIntervalMs: number;
  private current: RuntimeConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: EngineConfig, bus: EventBus, logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'config-poller' })).child({
      component: 'config-poller',
    });
    this.bus = bus;
    this.pollIntervalMs = config.configPollIntervalMs;
    this.current = defaultRuntimeConfig();
  }

  /** Start polling for config changes */
  start(): void {
    this.logger.info({ intervalMs: this.pollIntervalMs }, 'Starting config poller');
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error({ err: (err as Error).message }, 'Config poll failed');
      });
    }, this.pollIntervalMs);
  }

  /** Stop polling */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Config poller stopped');
  }

  /** Get current runtime config */
  getConfig(): RuntimeConfig {
    return this.current;
  }

  /** Get symbol universe */
  getSymbols(): string[] {
    return this.current.symbols;
  }

  /** Check if human has acknowledged a halt */
  isHumanAcknowledged(): boolean {
    return this.current.humanAcknowledged;
  }

  /** Clear the human acknowledgment flag after processing */
  clearAcknowledgment(): void {
    this.current.humanAcknowledged = false;
  }

  /**
   * Build a risk config object compatible with the OCaml risk engine.
   */
  toOcamlRiskConfig(): {
    max_position_pct: number;
    max_sector_pct: number;
    min_cash_reserve_pct: number;
    max_daily_loss_pct: number;
    max_drawdown_reduce_pct: number;
    max_drawdown_flatten_pct: number;
    max_order_rate_per_min: number;
    heartbeat_timeout_seconds: number;
    max_positions_by_phase: number;
  } {
    return {
      max_position_pct: this.current.maxPositionPct,
      max_sector_pct: this.current.maxSectorPct,
      min_cash_reserve_pct: this.current.minCashReservePct,
      max_daily_loss_pct: this.current.maxDailyLossPct,
      max_drawdown_reduce_pct: this.current.maxDrawdownReducePct,
      max_drawdown_flatten_pct: this.current.maxDrawdownFlattenPct,
      max_order_rate_per_min: this.current.maxOrderRatePerMin,
      heartbeat_timeout_seconds: this.current.heartbeatTimeoutSeconds,
      max_positions_by_phase: this.current.maxPositionsByPhase,
    };
  }

  // -----------------------------------------------------------------------
  // Internal polling
  // -----------------------------------------------------------------------

  private async poll(): Promise<void> {
    this.logger.debug('Polling for config changes');

    try {
      const newConfig = await this.fetchFromDynamoDB();

      // Detect changes
      const changedKeys = this.detectChanges(this.current, newConfig);
      if (changedKeys.length > 0) {
        this.logger.info({ changedKeys }, 'Config changed');
        this.current = newConfig;
        this.bus.emit('config-change', {
          changedKeys,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Failed to fetch config');
    }
  }

  /** Stub: fetch config from DynamoDB. Returns defaults for now. */
  private async fetchFromDynamoDB(): Promise<RuntimeConfig> {
    // TODO: Replace with actual DynamoDB GetItem
    // const params = {
    //   TableName: 'engine-config',
    //   Key: { pk: 'RUNTIME_CONFIG' },
    // };
    // const result = await dynamo.get(params);
    // return parseConfig(result.Item);

    return this.current;
  }

  /** Compare two configs and return keys that differ */
  private detectChanges(prev: RuntimeConfig, next: RuntimeConfig): string[] {
    const changed: string[] = [];
    const keys = Object.keys(prev) as (keyof RuntimeConfig)[];

    for (const key of keys) {
      if (key === 'lastUpdated') continue;
      const prevVal = JSON.stringify(prev[key]);
      const nextVal = JSON.stringify(next[key]);
      if (prevVal !== nextVal) {
        changed.push(key);
      }
    }

    return changed;
  }
}
