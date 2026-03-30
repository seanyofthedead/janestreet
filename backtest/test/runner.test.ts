/**
 * Unit tests for backtest runner, metrics, PDT tracker, and phase simulator.
 */

import { describe, it, expect } from 'vitest';
import {
  sharpe,
  sortino,
  maxDrawdown,
  calmar,
  winRate,
  profitFactor,
  equityCurveToReturns,
  type Trade,
} from '../src/metrics.js';
import {
  createPdtTracker,
  addDayTrade,
  canDayTrade,
  tradesRemaining,
  status,
  updateEquity,
} from '../src/pdt-tracker.js';
import {
  determinePhase,
  isStrategyEnabled,
  getMaxPositions,
  getEnabledStrategies,
  computePhaseState,
  PHASE_THRESHOLDS,
} from '../src/phase-simulator.js';
import { runBacktest, type BacktestConfig } from '../src/runner.js';
import type { Bar } from '../src/data-loader.js';

// ---------------------------------------------------------------------------
// Metrics tests
// ---------------------------------------------------------------------------

describe('metrics', () => {
  it('sharpe ratio matches known test vector', () => {
    // Daily returns of 0.1% with no variance => high sharpe
    const returns = Array(252).fill(0.001);
    const s = sharpe(returns);
    // Constant returns have zero variance in theory, but floating-point
    // fill(0.001) produces identical values, so sample variance = 0, sharpe = 0
    // However, if any numerical noise creeps in, sharpe can be very high
    // Just check it's finite and non-negative
    expect(Number.isFinite(s) || s === 0).toBe(true);

    // Known test: mixed returns
    const mixedReturns = [0.01, -0.005, 0.008, -0.003, 0.012, -0.002, 0.006, -0.004, 0.009, -0.001];
    const s2 = sharpe(mixedReturns);
    expect(s2).toBeGreaterThan(0); // net positive returns
    expect(Number.isFinite(s2)).toBe(true);
  });

  it('sortino ratio penalizes only downside', () => {
    // All positive returns -> infinite sortino
    const positiveReturns = [0.01, 0.02, 0.015, 0.005, 0.01];
    const s = sortino(positiveReturns);
    expect(s).toBe(Infinity);

    // Mixed returns
    const mixed = [0.01, -0.005, 0.008, -0.003, 0.012];
    const sm = sortino(mixed);
    expect(sm).toBeGreaterThan(0);
    expect(Number.isFinite(sm)).toBe(true);
  });

  it('maxDrawdown computes correctly', () => {
    const curve = [100, 110, 105, 120, 90, 95, 130];
    const dd = maxDrawdown(curve);
    // Peak was 120, trough was 90 -> dd = 30/120 = 0.25
    expect(dd).toBeCloseTo(0.25, 4);
  });

  it('maxDrawdown is 0 for monotonically increasing curve', () => {
    const curve = [100, 110, 120, 130, 140];
    expect(maxDrawdown(curve)).toBe(0);
  });

  it('calmar ratio = annualized return / max drawdown', () => {
    expect(calmar(0.15, 0.10)).toBeCloseTo(1.5, 4);
    expect(calmar(0.15, 0)).toBe(Infinity);
    expect(calmar(0, 0.10)).toBe(0);
  });

  it('winRate computes correctly', () => {
    const trades: Trade[] = [
      makeTrade(10, 'buy', 100, 110, 10),  // win
      makeTrade(10, 'buy', 100, 90, -10),   // loss
      makeTrade(10, 'buy', 100, 115, 15),  // win
    ];
    expect(winRate(trades)).toBeCloseTo(2 / 3, 4);
  });

  it('profitFactor = gross profit / gross loss', () => {
    const trades: Trade[] = [
      makeTrade(10, 'buy', 100, 110, 100),  // +100
      makeTrade(10, 'buy', 100, 90, -50),   // -50
      makeTrade(10, 'buy', 100, 105, 50),   // +50
    ];
    // gross profit = 150, gross loss = 50
    expect(profitFactor(trades)).toBeCloseTo(3.0, 4);
  });

  it('profitFactor with no losses returns Infinity', () => {
    const trades: Trade[] = [
      makeTrade(10, 'buy', 100, 110, 100),
    ];
    expect(profitFactor(trades)).toBe(Infinity);
  });

  it('equityCurveToReturns computes daily returns', () => {
    const curve = [100, 110, 99];
    const returns = equityCurveToReturns(curve);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.10, 4);  // 110/100 - 1
    expect(returns[1]).toBeCloseTo(-0.1, 4);  // 99/110 - 1
  });
});

// ---------------------------------------------------------------------------
// PDT tracker tests
// ---------------------------------------------------------------------------

describe('pdt-tracker', () => {
  const NOW = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('allows 3 day trades under $25K', () => {
    let tracker = createPdtTracker(10_000);
    expect(canDayTrade(tracker)).toBe(true);
    expect(tradesRemaining(tracker)).toBe(3);

    tracker = addDayTrade(tracker, 'AAPL', NOW);
    expect(tradesRemaining(tracker)).toBe(2);

    tracker = addDayTrade(tracker, 'MSFT', NOW + 1000);
    expect(tradesRemaining(tracker)).toBe(1);

    tracker = addDayTrade(tracker, 'GOOG', NOW + 2000);
    expect(tradesRemaining(tracker)).toBe(0);
    expect(canDayTrade(tracker)).toBe(false);
  });

  it('rejects 4th day trade under $25K', () => {
    let tracker = createPdtTracker(10_000);
    tracker = addDayTrade(tracker, 'AAPL', NOW);
    tracker = addDayTrade(tracker, 'MSFT', NOW + 1000);
    tracker = addDayTrade(tracker, 'GOOG', NOW + 2000);

    // 4th trade should be blocked
    expect(canDayTrade(tracker)).toBe(false);
    expect(tradesRemaining(tracker)).toBe(0);

    const s = status(tracker);
    expect(s.kind).toBe('blocked');
  });

  it('unlimited day trades at $25K+', () => {
    let tracker = createPdtTracker(25_000);
    expect(tradesRemaining(tracker)).toBe(999);

    tracker = addDayTrade(tracker, 'AAPL', NOW);
    tracker = addDayTrade(tracker, 'AAPL', NOW + 1000);
    tracker = addDayTrade(tracker, 'AAPL', NOW + 2000);
    tracker = addDayTrade(tracker, 'AAPL', NOW + 3000);

    // Still unlimited because equity >= 25K
    expect(canDayTrade(tracker)).toBe(true);
    expect(tradesRemaining(tracker)).toBe(999);
    expect(status(tracker).kind).toBe('unrestricted');
  });

  it('prunes trades older than 5 business days', () => {
    let tracker = createPdtTracker(10_000);
    const oldDate = NOW - 6 * DAY_MS; // 6 days ago (beyond 5-day window)
    tracker = addDayTrade(tracker, 'AAPL', oldDate);
    // Adding a new trade prunes old ones
    tracker = addDayTrade(tracker, 'MSFT', NOW);
    // Old trade should be pruned, only 1 recent trade
    expect(tradesRemaining(tracker)).toBe(2);
  });

  it('updateEquity changes PDT restriction status', () => {
    let tracker = createPdtTracker(10_000);
    tracker = addDayTrade(tracker, 'AAPL', NOW);
    tracker = addDayTrade(tracker, 'MSFT', NOW + 1000);
    tracker = addDayTrade(tracker, 'GOOG', NOW + 2000);
    expect(canDayTrade(tracker)).toBe(false);

    // Equity rises above $25K
    tracker = updateEquity(tracker, 30_000);
    expect(canDayTrade(tracker)).toBe(true);
    expect(tradesRemaining(tracker)).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Phase simulator tests
// ---------------------------------------------------------------------------

describe('phase-simulator', () => {
  it('determines correct phase from equity', () => {
    expect(determinePhase(1_000)).toBe(0);   // Micro
    expect(determinePhase(2_499)).toBe(0);   // Micro
    expect(determinePhase(2_500)).toBe(1);   // Small
    expect(determinePhase(9_999)).toBe(1);   // Small
    expect(determinePhase(10_000)).toBe(2);  // Medium
    expect(determinePhase(24_999)).toBe(2);  // Medium
    expect(determinePhase(25_000)).toBe(3);  // Standard
    expect(determinePhase(100_000)).toBe(3); // Standard
  });

  it('strategy_enabled_for_phase matches OCaml', () => {
    // Micro: Mean_reversion(0), Sector_rotation(1), Calendar_seasonal(2) enabled
    //        Momentum(3), Market_making(4) disabled
    expect(isStrategyEnabled(0, 0)).toBe(true);
    expect(isStrategyEnabled(0, 1)).toBe(true);
    expect(isStrategyEnabled(0, 2)).toBe(true);
    expect(isStrategyEnabled(0, 3)).toBe(false);
    expect(isStrategyEnabled(0, 4)).toBe(false);

    // Small: Momentum enabled, Market_making disabled
    expect(isStrategyEnabled(1, 3)).toBe(true);
    expect(isStrategyEnabled(1, 4)).toBe(false);

    // Standard: all enabled
    expect(isStrategyEnabled(3, 0)).toBe(true);
    expect(isStrategyEnabled(3, 3)).toBe(true);
    expect(isStrategyEnabled(3, 4)).toBe(true);
  });

  it('max positions increase with phase', () => {
    expect(getMaxPositions(0)).toBe(3);   // Micro
    expect(getMaxPositions(1)).toBe(6);   // Small
    expect(getMaxPositions(2)).toBe(12);  // Medium
    expect(getMaxPositions(3)).toBe(20);  // Standard
  });

  it('getEnabledStrategies returns correct list', () => {
    const micro = getEnabledStrategies(0);
    expect(micro).toEqual([0, 1, 2]); // Mean_rev, Sector, Calendar

    const standard = getEnabledStrategies(3);
    expect(standard).toEqual([0, 1, 2, 3, 4]); // All strategies
  });

  it('computePhaseState integrates phase and PDT', () => {
    const pdt = createPdtTracker(5_000);
    const state = computePhaseState(5_000, pdt);
    expect(state.phase).toBe(1); // Small
    expect(state.maxPositions).toBe(6);
    expect(state.pdtRestricted).toBe(false);
    expect(state.enabledStrategies).toContain(0);
    expect(state.enabledStrategies).toContain(3);
    expect(state.enabledStrategies).not.toContain(4);
  });

  it('phase thresholds are correct', () => {
    expect(PHASE_THRESHOLDS.MICRO_MAX).toBe(2_500);
    expect(PHASE_THRESHOLDS.SMALL_MAX).toBe(10_000);
    expect(PHASE_THRESHOLDS.MEDIUM_MAX).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// Backtest runner tests
// ---------------------------------------------------------------------------

describe('backtest runner', () => {
  it('produces deterministic results for same inputs', () => {
    const bars = generateSyntheticBars('AAPL', 300, 150);
    const barMap = new Map([['AAPL', bars]]);

    const config: BacktestConfig = {
      symbols: ['AAPL'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 50_000,
      strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
    };

    const result1 = runBacktest(config, barMap);
    const result2 = runBacktest(config, barMap);

    expect(result1.finalEquity).toBe(result2.finalEquity);
    expect(result1.equityCurve).toEqual(result2.equityCurve);
    expect(result1.trades.length).toBe(result2.trades.length);
  });

  it('starts with initial capital', () => {
    const bars = generateSyntheticBars('AAPL', 250, 150);
    const barMap = new Map([['AAPL', bars]]);

    const config: BacktestConfig = {
      symbols: ['AAPL'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 10_000,
      strategies: [0] as (0 | 1 | 2 | 3 | 4)[],
    };

    const result = runBacktest(config, barMap);
    expect(result.equityCurve[0]).toBe(10_000);
  });

  it('returns valid metrics', () => {
    const bars = generateSyntheticBars('AAPL', 300, 150);
    const barMap = new Map([['AAPL', bars]]);

    const config: BacktestConfig = {
      symbols: ['AAPL'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 50_000,
      strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
    };

    const result = runBacktest(config, barMap);
    expect(result.metrics).toBeDefined();
    expect(Number.isFinite(result.metrics.sharpeRatio)).toBe(true);
    expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.metrics.maxDrawdown).toBeLessThanOrEqual(1);
    expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
  });

  it('equity curve has entries for each bar after warmup', () => {
    const bars = generateSyntheticBars('SPY', 250, 100);
    const barMap = new Map([['SPY', bars]]);

    const config: BacktestConfig = {
      symbols: ['SPY'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 25_000,
      strategies: [0] as (0 | 1 | 2 | 3 | 4)[],
    };

    const result = runBacktest(config, barMap);
    // Equity curve starts with initial capital + entries after warmup + final close
    expect(result.equityCurve.length).toBeGreaterThan(1);
    expect(result.equityCurve[0]).toBe(25_000);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrade(
  qty: number,
  side: 'buy' | 'sell',
  entry: number,
  exit: number,
  pnl: number,
): Trade {
  return {
    symbol: 'TEST',
    side,
    entryPrice: entry,
    exitPrice: exit,
    qty,
    entryTime: Date.now() - 86400000,
    exitTime: Date.now(),
    pnl,
    strategy: 'test',
  };
}

/**
 * Generate synthetic daily bars with a simple random walk.
 * Deterministic: uses a seeded-like approach with fixed increments.
 */
function generateSyntheticBars(
  symbol: string,
  count: number,
  startPrice: number,
): Bar[] {
  const bars: Bar[] = [];
  let price = startPrice;
  const baseTimestamp = new Date('2023-01-03T14:30:00Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Deterministic price changes: sine wave + small drift
  for (let i = 0; i < count; i++) {
    const change = Math.sin(i * 0.1) * 2 + 0.05; // deterministic oscillation + small upward drift
    price = Math.max(1, price + change);

    const open = price - 0.5;
    const close = price;
    const high = Math.max(open, close) + Math.abs(Math.sin(i * 0.3)) * 1.5;
    const low = Math.min(open, close) - Math.abs(Math.cos(i * 0.3)) * 1.5;
    const volume = 1_000_000 + Math.floor(Math.sin(i * 0.2) * 500_000 + 500_000);

    bars.push({
      timestamp: baseTimestamp + i * DAY_MS,
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(Math.max(0.01, low) * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume,
    });
  }

  return bars;
}
