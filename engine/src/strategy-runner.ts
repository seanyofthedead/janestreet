/**
 * Wraps OCaml strategy modules and manages strategy health.
 * Calls each enabled strategy's signal function on each tick.
 */

import pino from 'pino';
import * as Signal from '../../trading-core-js/trading-core/lib/signal.js';
import * as Types from '../../trading-core-js/trading-core/lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strategy identifier matching the OCaml strategy variant */
export type StrategyId = 0 | 1 | 2 | 3 | 4;

export const STRATEGY_NAMES: Record<StrategyId, string> = {
  0: 'Mean_reversion',
  1: 'Sector_rotation',
  2: 'Calendar_seasonal',
  3: 'Momentum',
  4: 'Market_making',
};

/** Signal object compatible with OCaml risk engine */
export interface StrategySignal {
  strategy: StrategyId;
  symbol: string;
  side: number; // 0 = Buy, 1 = Sell
  strength: { TAG: number; _0: number }; // Strong=0, Moderate=1, Weak=2
  target_price: number;
  max_position_pct: number;
  timestamp: number;
}

/** Market data snapshot for a single symbol */
export interface SymbolMarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  bars: Array<{ o: number; h: number; l: number; c: number; v: number }>;
}

/** Regime enum (mirrors OCaml): 0=Low_vol_trending, 1=Normal, 2=High_vol_ranging, 3=Crisis */
export type Regime = 0 | 1 | 2 | 3;

/** Phase enum: 0=Micro, 1=Small, 2=Medium, 3=Standard */
export type Phase = 0 | 1 | 2 | 3;

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
// Strategy signal generators (placeholder implementations)
// These would be replaced by actual OCaml-compiled strategy modules
// ---------------------------------------------------------------------------

function meanReversionSignal(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 20) return null;

  // Simple mean reversion: compare current price to 20-bar SMA
  const sma = data.bars.slice(-20).reduce((sum, b) => sum + b.c, 0) / 20;
  const deviation = (data.price - sma) / sma;

  // Intraday 1-min bars: 0.02% deviation is meaningful for SPY
  if (Math.abs(deviation) < 0.0002) return null;

  const side = deviation > 0 ? 1 : 0; // Sell if above mean, buy if below
  const absDeviation = Math.abs(deviation);
  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(absDeviation * 2000, 0.95);

  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 0,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: sma,
    max_position_pct: regime === 3 ? 0.03 : 0.08,
    timestamp: Date.now(),
  };
}

function momentumSignal(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 50) return null;

  const recent = data.bars.slice(-10);
  const older = data.bars.slice(-50, -10);
  const recentAvg = recent.reduce((s, b) => s + b.c, 0) / recent.length;
  const olderAvg = older.reduce((s, b) => s + b.c, 0) / older.length;

  const momentum = (recentAvg - olderAvg) / olderAvg;
  // Intraday 1-min bars: 0.01% trend is detectable
  if (Math.abs(momentum) < 0.0001) return null;

  const side = momentum > 0 ? 0 : 1;
  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(Math.abs(momentum) * 2000, 0.9);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 3,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: data.price * (1 + momentum * 0.5),
    max_position_pct: regime === 3 ? 0.02 : 0.06,
    timestamp: Date.now(),
  };
}

function sectorRotationSignal(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 50) return null;

  // Relative-strength approach: compare long-term trend to short-term pullback
  const longTermPrice = data.bars[data.bars.length - 50].c;
  const shortTermPrice = data.bars[data.bars.length - 20].c;
  const currentPrice = data.price;

  const longReturn = (currentPrice - longTermPrice) / longTermPrice;
  const shortReturn = (currentPrice - shortTermPrice) / shortTermPrice;

  // Intraday 1-min bars: 0.02% long trend with any short pullback
  let side: number;
  if (longReturn > 0.0002 && shortReturn < -0.0001) {
    side = 0; // Buy: dip in uptrend
  } else if (longReturn < -0.0002 && shortReturn > 0.0001) {
    side = 1; // Sell: rally in downtrend
  } else {
    return null;
  }

  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(Math.abs(longReturn) * 2000, 0.8);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 1,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: shortTermPrice,
    max_position_pct: regime === 3 ? 0.03 : 0.06,
    timestamp: Date.now(),
  };
}

function calendarSeasonalSignal(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 30) return null;

  // Seasonal anomalies break down in crises
  if (regime === 3) return null;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1; // 1-indexed
  const daysInMonth = new Date(now.getFullYear(), month, 0).getDate();

  // Turn-of-month effect: last 3 days + first 3 days are bullish
  const isTurnOfMonth = dayOfMonth >= daysInMonth - 2 || dayOfMonth <= 3;

  // Sell-in-May: May through October tends bearish, Nov-Apr bullish
  const isSellInMay = month >= 5 && month <= 10;

  if (isTurnOfMonth) {
    // Turn-of-month: Moderate Buy — strongest seasonal signal
    return {
      strategy: 2,
      symbol: data.symbol,
      side: 0,
      strength: { TAG: 1, _0: 0.55 }, // Moderate
      target_price: data.price * 1.005,
      max_position_pct: 0.04,
      timestamp: Date.now(),
    };
  }

  if (isSellInMay) {
    // Summer months: Moderate Sell
    return {
      strategy: 2,
      symbol: data.symbol,
      side: 1,
      strength: { TAG: 1, _0: 0.45 }, // Moderate
      target_price: data.price * 0.995,
      max_position_pct: 0.04,
      timestamp: Date.now(),
    };
  }

  // Nov-Apr: Moderate Buy
  return {
    strategy: 2,
    symbol: data.symbol,
    side: 0,
    strength: { TAG: 1, _0: 0.50 }, // Moderate
    target_price: data.price * 1.003,
    max_position_pct: 0.04,
    timestamp: Date.now(),
  };
}

function marketMakingSignal(data: SymbolMarketData, _regime: Regime): StrategySignal | null {
  if (data.bars.length < 10) return null;

  const spread = data.ask - data.bid;
  const midpoint = (data.ask + data.bid) / 2;
  const spreadPct = spread / midpoint;

  // Intraday: any meaningful spread is tradeable (IEX often has wider spreads)
  if (spreadPct < 0.0001) return null;

  // Market making buys at bid, sells at ask
  const side = Math.random() > 0.5 ? 0 : 1;
  const price = side === 0 ? data.bid + spread * 0.25 : data.ask - spread * 0.25;
  // Scale for tighter spreads: 0.01% → 0.5 (Moderate), 0.02% → 0.8 (Strong)
  const conf = Math.min(spreadPct * 5000, 0.8);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 4,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: price,
    max_position_pct: 0.04,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// StrategyRunner
// ---------------------------------------------------------------------------

const MISS_THRESHOLD = process.env.SIMULATION_MODE === 'true' ? 300 : 300;
const RECOVERY_THRESHOLD = 10;
const MIN_BARS_FOR_PRIMED: Record<StrategyId, number> = {
  0: 20,  // mean reversion needs 20 bars
  1: 50,  // sector rotation needs 50
  2: 30,  // calendar seasonal needs 30
  3: 50,  // momentum needs 50
  4: 10,  // market making needs 10
};

export class StrategyRunner {
  private readonly logger: pino.Logger;
  private readonly health: Map<StrategyId, StrategyHealth> = new Map();

  /** Signal generators for each strategy */
  private readonly generators: Map<
    StrategyId,
    (data: SymbolMarketData, regime: Regime) => StrategySignal | null
  > = new Map();

  constructor(logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'strategy-runner' })).child({
      component: 'strategy-runner',
    });

    // Register built-in signal generators
    this.generators.set(0, meanReversionSignal);
    this.generators.set(1, sectorRotationSignal);
    this.generators.set(2, calendarSeasonalSignal);
    this.generators.set(3, momentumSignal);
    this.generators.set(4, marketMakingSignal);

    // Initialize health for all strategies
    for (let i = 0; i <= 4; i++) {
      const id = i as StrategyId;
      this.health.set(id, {
        strategyId: id,
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

    for (let strategyId = 0; strategyId <= 4; strategyId++) {
      const id = strategyId as StrategyId;

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

      const generator = this.generators.get(id);
      if (!generator) continue;

      health.totalTicks++;
      let producedSignal = false;

      for (const data of marketData) {
        try {
          const signal = generator(data, regime);
          if (signal) {
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

      // Update health tracking
      if (producedSignal) {
        health.consecutiveMisses = 0;
        health.consecutiveSuccesses++;
        if (!health.isHealthy && health.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
          health.isHealthy = true;
          this.logger.info({ strategy: STRATEGY_NAMES[id] }, 'Strategy recovered');
        }
      } else {
        health.consecutiveMisses++;
        health.consecutiveSuccesses = 0;
        if (health.isHealthy && health.consecutiveMisses >= MISS_THRESHOLD) {
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

    if (barCount >= MIN_BARS_FOR_PRIMED[strategyId]) {
      health.isPrimed = true;
      this.logger.info(
        { strategy: STRATEGY_NAMES[strategyId], barCount },
        'Strategy primed',
      );
    }
  }

  /** Check if all enabled strategies (for given phase) are primed */
  allPrimed(phase: Phase): boolean {
    for (let i = 0; i <= 4; i++) {
      const id = i as StrategyId;
      if (Types.strategy_enabled_for_phase(phase, id)) {
        const health = this.health.get(id);
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
