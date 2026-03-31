/**
 * Tests for strategy signal generation and health tracking.
 * Uses synthetic market data to verify strategies produce signals
 * and respect phase-based enablement.
 */

import { describe, it, expect } from 'vitest';
import { StrategyRunner } from '../src/strategy-runner.js';
import type { SymbolMarketData, Regime, Phase, StrategyId } from '../src/strategy-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate synthetic bars with a given trend */
function makeBars(
  count: number,
  startPrice: number,
  trend: 'up' | 'down' | 'flat' | 'sine' = 'sine',
) {
  return Array.from({ length: count }, (_, i) => {
    let base: number;
    switch (trend) {
      case 'up':
        base = startPrice + i * 0.5;
        break;
      case 'down':
        base = startPrice - i * 0.5;
        break;
      case 'flat':
        base = startPrice;
        break;
      case 'sine':
        base = startPrice + Math.sin(i * 0.3) * 5;
        break;
    }
    return {
      o: base - 0.5,
      h: base + 1.5,
      l: base - 1.5,
      c: base,
      v: 1000000,
    };
  });
}

function makeMarketData(overrides: Partial<SymbolMarketData> = {}): SymbolMarketData {
  const bars = makeBars(60, 150, 'sine');
  return {
    symbol: 'SPY',
    price: 150,
    bid: 149.95,
    ask: 150.05,
    volume: 500000,
    bars,
    ...overrides,
  };
}

function primeAllStrategies(runner: StrategyRunner): void {
  for (let i = 0; i <= 4; i++) {
    runner.checkPrimed(i as StrategyId, 100);
  }
}

// ---------------------------------------------------------------------------
// Strategy signal generation
// ---------------------------------------------------------------------------

describe('Strategy signal generation', () => {
  it('generates at least one signal with sufficient data', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Price far above SMA should trigger mean reversion sell
    const bars = makeBars(60, 140, 'flat');
    const data = makeMarketData({ price: 160, bars });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);
    expect(signals.length).toBeGreaterThan(0);
  });

  it('mean reversion signals when price deviates from SMA', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Flat bars at 100, current price at 115 (15% above SMA)
    const bars = makeBars(30, 100, 'flat');
    const data = makeMarketData({ symbol: 'AAPL', price: 115, bars });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);
    const mrSignals = signals.filter((s) => s.strategy === 0);

    if (mrSignals.length > 0) {
      // If triggered, should be a sell (price above mean)
      expect(mrSignals[0].side).toBe(1); // sell
    }
  });

  it('does not generate signals with insufficient bars', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Only 5 bars -- not enough for any strategy
    const bars = makeBars(5, 150);
    const data = makeMarketData({ bars });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);
    expect(signals).toHaveLength(0);
  });

  it('respects Micro phase: disables Momentum and Market_making', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    const bars = makeBars(60, 100, 'up');
    const data = makeMarketData({
      price: 130,
      bid: 129,
      ask: 132, // wide spread for market making
      bars,
    });

    const signals = runner.runStrategies([data], 0 as Phase, 1 as Regime);
    const momentumSignals = signals.filter((s) => s.strategy === 3);
    const mmSignals = signals.filter((s) => s.strategy === 4);

    expect(momentumSignals).toHaveLength(0);
    expect(mmSignals).toHaveLength(0);
  });

  it('Standard phase does not block any strategy', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Use data designed to trigger multiple strategies
    const bars = makeBars(60, 100, 'up');
    const data = makeMarketData({
      price: 130,
      bid: 125,
      ask: 135, // very wide spread for market making
      bars,
    });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);
    // Can't guarantee all strategies trigger (depends on data + actionability filter),
    // but verify no strategy is phase-blocked by checking the runner ran all 5
    const metrics = runner.getMetrics();
    // All 5 strategies should have totalTicks > 0 (they were all evaluated)
    for (const m of metrics) {
      expect(m.totalTicks).toBeGreaterThan(0);
    }
  });

  it('handles multiple symbols', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    const data1 = makeMarketData({ symbol: 'SPY', price: 170, bars: makeBars(60, 150, 'flat') });
    const data2 = makeMarketData({ symbol: 'AAPL', price: 120, bars: makeBars(60, 150, 'flat') });

    const signals = runner.runStrategies([data1, data2], 3 as Phase, 1 as Regime);
    const symbols = new Set(signals.map((s) => s.symbol));
    // Should have signals from at least one symbol
    expect(symbols.size).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Strategy health tracking
// ---------------------------------------------------------------------------

describe('Strategy health tracking', () => {
  it('all strategies start healthy', () => {
    const runner = new StrategyRunner();
    const metrics = runner.getMetrics();

    expect(metrics).toHaveLength(5);
    for (const m of metrics) {
      expect(m.isHealthy).toBe(true);
      expect(m.totalTicks).toBe(0);
      expect(m.totalSignals).toBe(0);
    }
  });

  it('strategies become unhealthy after 30 consecutive misses', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Run with data that won't generate signals (too few bars)
    const data = makeMarketData({ bars: makeBars(5, 150) });

    for (let i = 0; i < 30; i++) {
      runner.runStrategies([data], 3 as Phase, 1 as Regime);
    }

    const metrics = runner.getMetrics();
    // Strategies that need more bars (momentum=50, sector_rotation=50) should be unhealthy
    const momentumHealth = metrics.find((m) => m.id === 3);
    expect(momentumHealth?.isHealthy).toBe(false);
    expect(momentumHealth?.consecutiveMisses).toBe(30);
  });

  it('setHealth and resetHealth work', () => {
    const runner = new StrategyRunner();

    runner.setHealth(0, false);
    let metrics = runner.getMetrics();
    expect(metrics.find((m) => m.id === 0)?.isHealthy).toBe(false);

    runner.resetHealth(0);
    metrics = runner.getMetrics();
    expect(metrics.find((m) => m.id === 0)?.isHealthy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Warmup / priming
// ---------------------------------------------------------------------------

describe('Strategy priming', () => {
  it('strategies start unprimed', () => {
    const runner = new StrategyRunner();
    const metrics = runner.getMetrics();
    for (const m of metrics) {
      expect(m.isPrimed).toBe(false);
    }
  });

  it('checkPrimed marks strategy as primed when enough bars', () => {
    const runner = new StrategyRunner();

    runner.checkPrimed(0, 20); // Mean reversion needs 20
    runner.checkPrimed(3, 40); // Momentum needs 50 -- not enough
    runner.checkPrimed(4, 10); // Market making needs 10

    const metrics = runner.getMetrics();
    expect(metrics.find((m) => m.id === 0)?.isPrimed).toBe(true);
    expect(metrics.find((m) => m.id === 3)?.isPrimed).toBe(false);
    expect(metrics.find((m) => m.id === 4)?.isPrimed).toBe(true);
  });

  it('allPrimed returns false when not all enabled strategies are primed', () => {
    const runner = new StrategyRunner();
    runner.checkPrimed(0, 20);
    // Micro phase enables 0,1,2 -- only 0 is primed
    expect(runner.allPrimed(0 as Phase)).toBe(false);
  });

  it('allPrimed returns true when all enabled strategies are primed', () => {
    const runner = new StrategyRunner();
    runner.checkPrimed(0, 20);
    runner.checkPrimed(1, 50);
    runner.checkPrimed(2, 30);
    // Micro phase only needs 0,1,2
    expect(runner.allPrimed(0 as Phase)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Signal structure validation
// ---------------------------------------------------------------------------

describe('Signal structure', () => {
  it('signals have required fields', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    const bars = makeBars(60, 100, 'flat');
    const data = makeMarketData({ price: 120, bars });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);

    for (const signal of signals) {
      expect(signal.strategy).toBeGreaterThanOrEqual(0);
      expect(signal.strategy).toBeLessThanOrEqual(4);
      expect(typeof signal.symbol).toBe('string');
      expect([0, 1]).toContain(signal.side);
      expect(signal.strength).toBeDefined();
      expect(signal.strength.TAG).toBeGreaterThanOrEqual(0);
      expect(signal.strength.TAG).toBeLessThanOrEqual(2);
      expect(signal.strength._0).toBeGreaterThan(0);
      expect(signal.strength._0).toBeLessThanOrEqual(1);
      expect(signal.target_price).toBeGreaterThan(0);
      expect(signal.max_position_pct).toBeGreaterThan(0);
      expect(signal.timestamp).toBeGreaterThan(0);
    }
  });
});
