/**
 * Wraps strategy modules and manages strategy health.
 * Calls each enabled strategy's signal function on each tick.
 */

import pino from 'pino';
import * as Signal from '../../trading-core-js/trading-core/lib/signal.js';
import * as Types from '../../trading-core-js/trading-core/lib/types.js';
import { STRATEGY_REGISTRY, STRATEGY_NAMES } from './strategies/index.js';
import type { StrategyId, StrategySignal, SymbolMarketData, Regime, Phase } from './strategies/types.js';

// Re-export types and names so existing consumers don't break
export { STRATEGY_NAMES };
export type { StrategyId, StrategySignal, SymbolMarketData, Regime, Phase };

// ---------------------------------------------------------------------------
// Strategy health tracking
// ---------------------------------------------------------------------------

interface StrategyHealth {
  strategyId: StrategyId;
  consecutiveMisses: number;
  consecutiveSuccesses: number;
  isHealthy: boolean;
  totalTicks: number;
  totalSignals: number;
  lastSignalAt: number | null;
  isPrimed: boolean;
}

// ---------------------------------------------------------------------------
// StrategyRunner
// ---------------------------------------------------------------------------

const DEFAULT_MISS_THRESHOLD = 300;
const DEFAULT_RECOVERY_THRESHOLD = 10;

export class StrategyRunner {
  private readonly logger: pino.Logger;
  private readonly health: Map<StrategyId, StrategyHealth> = new Map();

  constructor(logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'strategy-runner' })).child({
      component: 'strategy-runner',
    });

    // Initialize health for all registered strategies
    for (const module of STRATEGY_REGISTRY) {
      this.health.set(module.id, {
        strategyId: module.id,
        consecutiveMisses: 0,
        consecutiveSuccesses: 0,
        isHealthy: true,
        totalTicks: 0,
        totalSignals: 0,
        lastSignalAt: null,
        isPrimed: false,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Core execution
  // -----------------------------------------------------------------------

  /**
   * Run all enabled strategies against market data.
   * Returns array of signals from all strategies that produced one.
   */
  runStrategies(
    marketData: SymbolMarketData[],
    phase: Phase,
    regime: Regime,
    enabledStrategies?: Record<string, boolean>,
  ): StrategySignal[] {
    const signals: StrategySignal[] = [];

    for (const module of STRATEGY_REGISTRY) {
      const id = module.id;

      // Check if strategy is enabled for this account phase (safety floor)
      if (!Types.strategy_enabled_for_phase(phase, id)) {
        continue;
      }

      // Check config-based strategy toggle
      if (enabledStrategies) {
        const name = STRATEGY_NAMES[id];
        if (name && enabledStrategies[name] === false) {
          this.logger.debug({ strategy: name }, 'Strategy disabled by config');
          continue;
        }
      }

      const health = this.health.get(id)!;

      // Skip unhealthy strategies
      if (!health.isHealthy) {
        this.logger.warn({ strategy: STRATEGY_NAMES[id] }, 'Skipping unhealthy strategy');
        continue;
      }

      health.totalTicks++;
      let producedSignal = false;

      for (const data of marketData) {
        try {
          const signal = module.generate(data, regime);
          if (signal) {
            // Stamp the strategy ID to prevent copy-paste bugs in generators
            signal.strategy = id;
            // Validate signal is actionable using OCaml
            if (Signal.is_actionable(signal)) {
              signals.push(signal);
              producedSignal = true;
              health.totalSignals++;
              health.lastSignalAt = Date.now();
            }
          }
        } catch (err) {
          this.logger.error(
            { strategy: STRATEGY_NAMES[id], symbol: data.symbol, err: (err as Error).message },
            'Strategy execution error',
          );
        }
      }

      // Update health tracking (per-strategy thresholds with global defaults)
      const missThreshold = module.missThreshold ?? DEFAULT_MISS_THRESHOLD;
      const recoveryThreshold = module.recoveryThreshold ?? DEFAULT_RECOVERY_THRESHOLD;

      if (producedSignal) {
        health.consecutiveMisses = 0;
        health.consecutiveSuccesses++;
        if (!health.isHealthy && health.consecutiveSuccesses >= recoveryThreshold) {
          health.isHealthy = true;
          this.logger.info({ strategy: STRATEGY_NAMES[id] }, 'Strategy recovered');
        }
      } else {
        health.consecutiveMisses++;
        health.consecutiveSuccesses = 0;
        if (health.isHealthy && health.consecutiveMisses >= missThreshold) {
          health.isHealthy = false;
          this.logger.warn(
            { strategy: STRATEGY_NAMES[id], misses: health.consecutiveMisses },
            'Strategy marked unhealthy after consecutive misses',
          );
        }
      }
    }

    return signals;
  }

  // -----------------------------------------------------------------------
  // Warmup / priming
  // -----------------------------------------------------------------------

  /** Check if a strategy has enough bars to be primed */
  checkPrimed(strategyId: StrategyId, barCount: number): void {
    const health = this.health.get(strategyId);
    if (!health) return;

    const module = STRATEGY_REGISTRY.find((m) => m.id === strategyId);
    if (!module) return;

    if (barCount >= module.minBars) {
      health.isPrimed = true;
      this.logger.info(
        { strategy: STRATEGY_NAMES[strategyId], barCount },
        'Strategy primed',
      );
    }
  }

  /** Check if all enabled strategies (for given phase) are primed */
  allPrimed(phase: Phase): boolean {
    for (const module of STRATEGY_REGISTRY) {
      if (Types.strategy_enabled_for_phase(phase, module.id)) {
        const health = this.health.get(module.id);
        if (health && !health.isPrimed) return false;
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Health / metrics
  // -----------------------------------------------------------------------

  /** Get health metrics for all strategies */
  getMetrics(): Array<{
    name: string;
    id: StrategyId;
    isHealthy: boolean;
    isPrimed: boolean;
    totalTicks: number;
    totalSignals: number;
    consecutiveMisses: number;
    lastSignalAt: number | null;
  }> {
    const metrics: Array<{
      name: string;
      id: StrategyId;
      isHealthy: boolean;
      isPrimed: boolean;
      totalTicks: number;
      totalSignals: number;
      consecutiveMisses: number;
      lastSignalAt: number | null;
    }> = [];

    for (const [id, health] of this.health) {
      metrics.push({
        name: STRATEGY_NAMES[id],
        id,
        isHealthy: health.isHealthy,
        isPrimed: health.isPrimed,
        totalTicks: health.totalTicks,
        totalSignals: health.totalSignals,
        consecutiveMisses: health.consecutiveMisses,
        lastSignalAt: health.lastSignalAt,
      });
    }

    return metrics;
  }

  /** Manually mark a strategy as healthy/unhealthy (for testing) */
  setHealth(strategyId: StrategyId, isHealthy: boolean): void {
    const health = this.health.get(strategyId);
    if (health) {
      health.isHealthy = isHealthy;
      if (isHealthy) {
        health.consecutiveMisses = 0;
      }
    }
  }

  /** Reset health for a strategy */
  resetHealth(strategyId: StrategyId): void {
    const health = this.health.get(strategyId);
    if (health) {
      health.consecutiveMisses = 0;
      health.consecutiveSuccesses = 0;
      health.isHealthy = true;
    }
  }
}
