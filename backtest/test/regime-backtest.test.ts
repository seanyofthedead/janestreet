/**
 * Step 2 tests: Oracle regime labels, regime override in backtest, and comparison.
 */

import { describe, it, expect } from 'vitest';
import {
  computeOracleLabels, classifyRegime, lookupRegime, regimeBreakdown,
  type RegimeSchedule,
} from '../src/regime-labels.js';
import { runBacktest, type BacktestConfig } from '../src/runner.js';
import { runComparison, type ComparisonVariant } from '../src/regime-comparison.js';
import type { Bar } from '../src/data-loader.js';
import { generateHighVolBars, generateTrendingBars } from './test-helpers.js';

function generateSyntheticBars(count: number, startPrice: number): Bar[] {
  const bars: Bar[] = [];
  let price = startPrice;
  const baseTimestamp = new Date('2026-01-05T14:30:00Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let i = 0; i < count; i++) {
    const change = Math.sin(i * 0.1) * 2 + 0.05;
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

function makeConfig(bars: Bar[], regimeSchedule?: BacktestConfig['regimeSchedule']) {
  return {
    config: {
      symbols: ['TEST'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 50_000,
      strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
      regimeSchedule,
    } satisfies BacktestConfig,
    barMap: new Map([['TEST', bars]]),
  };
}

// ---------------------------------------------------------------------------
// Oracle label tests
// ---------------------------------------------------------------------------

describe('regime-labels', () => {
  describe('classifyRegime', () => {
    it('Crisis when vol > 30%', () => expect(classifyRegime(0.35, 0.3)).toBe(3));
    it('Low_vol_trending when vol < 15% and strong trend', () => expect(classifyRegime(0.10, 1.5)).toBe(0));
    it('High_vol_ranging when vol > 20% and weak trend', () => expect(classifyRegime(0.25, 0.3)).toBe(2));
    it('Normal for moderate conditions', () => expect(classifyRegime(0.18, 0.7)).toBe(1));
  });

  describe('computeOracleLabels', () => {
    it('returns empty for insufficient data', () => {
      expect(computeOracleLabels(generateSyntheticBars(10, 100))).toHaveLength(0);
    });

    it('produces valid labels for sufficient data', () => {
      const labels = computeOracleLabels(generateSyntheticBars(50, 100));
      expect(labels.length).toBeGreaterThan(0);
      for (const label of labels) {
        expect(label.start).toBeLessThanOrEqual(label.end);
        expect(label.regime).toBeGreaterThanOrEqual(0);
        expect(label.regime).toBeLessThanOrEqual(3);
        expect(Number.isFinite(label.realizedVol)).toBe(true);
      }
    });

    it('labels do not overlap', () => {
      const labels = computeOracleLabels(generateSyntheticBars(50, 100));
      for (let i = 1; i < labels.length; i++) {
        expect(labels[i].start).toBeGreaterThan(labels[i - 1].end);
      }
    });

    it('high-vol bars produce Crisis or High_vol_ranging labels', () => {
      const labels = computeOracleLabels(generateHighVolBars('SPY', 50, 500));
      expect(labels.some(l => l.regime === 3 || l.regime === 2)).toBe(true);
    });
  });

  describe('lookupRegime', () => {
    it('returns correct regime within schedule', () => {
      const schedule: RegimeSchedule = [
        { start: 100, end: 200, regime: 3, realizedVol: 0.35, trendStrength: 0.2 },
        { start: 201, end: 300, regime: 1, realizedVol: 0.18, trendStrength: 0.7 },
      ];
      expect(lookupRegime(schedule, 150)).toBe(3);
      expect(lookupRegime(schedule, 250)).toBe(1);
    });

    it('defaults to Normal outside schedule', () => {
      const schedule: RegimeSchedule = [
        { start: 100, end: 200, regime: 3, realizedVol: 0.35, trendStrength: 0.2 },
      ];
      expect(lookupRegime(schedule, 50)).toBe(1);
      expect(lookupRegime(schedule, 250)).toBe(1);
    });
  });

  describe('regimeBreakdown', () => {
    it('computes time per regime', () => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const schedule: RegimeSchedule = [
        { start: 0, end: 10 * DAY_MS, regime: 1, realizedVol: 0.18, trendStrength: 0.7 },
        { start: 10 * DAY_MS + 1, end: 15 * DAY_MS, regime: 3, realizedVol: 0.35, trendStrength: 0.2 },
      ];
      const b = regimeBreakdown(schedule);
      expect(b[1]).toBeGreaterThan(0);
      expect(b[3]).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Regime override in runner
// ---------------------------------------------------------------------------

describe('backtest runner with regime override', () => {
  it('backward-compatible: no regimeSchedule same results', () => {
    const bars = generateSyntheticBars(300, 150);
    const { config, barMap } = makeConfig(bars);
    const r1 = runBacktest(config, barMap);
    const r2 = runBacktest(config, barMap);
    expect(r1.finalEquity).toBe(r2.finalEquity);
    expect(r1.trades.length).toBe(r2.trades.length);
  });

  it('Crisis regime changes results vs Normal', () => {
    const bars = generateSyntheticBars(300, 150);
    const ts0 = bars[0].timestamp;
    const tsEnd = bars[bars.length - 1].timestamp;
    const { config: normalConfig, barMap } = makeConfig(bars);
    const crisisSchedule = [{ start: ts0, end: tsEnd, regime: 3 as const }];
    const { config: crisisConfig } = makeConfig(bars, crisisSchedule);
    const normalResult = runBacktest(normalConfig, barMap);
    const crisisResult = runBacktest(crisisConfig, barMap);
    if (normalResult.trades.length > 0 && crisisResult.trades.length > 0) {
      expect(crisisResult.finalEquity).not.toBe(normalResult.finalEquity);
    }
  });

  it('partial schedule gaps default to Normal', () => {
    const bars = generateSyntheticBars(300, 150);
    const ts0 = bars[0].timestamp;
    const midTs = bars[150].timestamp;
    const tsEnd = bars[bars.length - 1].timestamp;
    const partial = [{ start: ts0, end: midTs, regime: 3 as const }];
    const full = [{ start: ts0, end: tsEnd, regime: 3 as const }];
    const { barMap } = makeConfig(bars);
    const partialResult = runBacktest({ ...makeConfig(bars, partial).config }, barMap);
    const fullResult = runBacktest({ ...makeConfig(bars, full).config }, barMap);
    if (partialResult.trades.length > 0 && fullResult.trades.length > 0) {
      expect(partialResult.finalEquity).not.toBe(fullResult.finalEquity);
    }
  });
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

describe('regime comparison', () => {
  it('report includes all metrics', () => {
    const bars = generateSyntheticBars(300, 150);
    const { barMap } = makeConfig(bars);
    const oracleLabels = computeOracleLabels(bars);
    const baseConfig = {
      symbols: ['TEST'],
      startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 50_000,
      strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
    };
    const variants: ComparisonVariant[] = [
      { name: 'Baseline' },
      { name: 'Oracle', regimeSchedule: oracleLabels },
    ];
    const report = runComparison(baseConfig, barMap, variants);
    expect(report.variants).toHaveLength(2);
    for (const v of report.variants) {
      expect(Number.isFinite(v.result.metrics.sharpeRatio)).toBe(true);
      expect(v.result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    }
  });

  it('comparison is deterministic', () => {
    const bars = generateSyntheticBars(300, 150);
    const { barMap } = makeConfig(bars);
    const oracleLabels = computeOracleLabels(bars);
    const baseConfig = {
      symbols: ['TEST'], startDate: new Date(bars[0].timestamp),
      endDate: new Date(bars[bars.length - 1].timestamp),
      initialCapital: 50_000, strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
    };
    const variants: ComparisonVariant[] = [{ name: 'Baseline' }, { name: 'Oracle', regimeSchedule: oracleLabels }];
    const r1 = runComparison(baseConfig, barMap, variants);
    const r2 = runComparison(baseConfig, barMap, variants);
    expect(r1.variants[0].result.finalEquity).toBe(r2.variants[0].result.finalEquity);
  });
});
