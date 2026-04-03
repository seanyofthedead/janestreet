/**
 * Parity tests: classifier correctness and helper-function equivalence.
 * Proves the unified regime classifier produces correct outputs for all regime
 * zones and boundaries, and that the engine's vol/trend helpers match the
 * backtest oracle's formulas exactly.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — Melange-compiled JS, no .d.ts
import * as Regime from '../../trading-core-js/trading-core/lib/regime.js';
import {
  aggregateToDailyCloses,
  annualizedRealizedVol,
  trendStrength,
} from '../src/regime-helpers.js';

// ---------------------------------------------------------------------------
// Reference implementations (inlined from backtest/src/regime-labels.ts)
// These are the backtest oracle's formulas — used as ground truth.
// ---------------------------------------------------------------------------

function refAnnualizedRealizedVol(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a: number, b: number) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc: number, r: number) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function refTrendStrength(closes: number[]): number {
  if (closes.length < 2) return 0;
  const periodReturn = Math.abs(Math.log(closes[closes.length - 1] / closes[0]));
  const vol = refAnnualizedRealizedVol(closes);
  if (vol <= 0) return 0;
  const annualizedReturn = periodReturn * (252 / (closes.length - 1));
  return annualizedReturn / vol;
}

// ---------------------------------------------------------------------------
// Classifier correctness
// ---------------------------------------------------------------------------

describe('Regime.classify correctness', () => {
  const cases: Array<[number, number, number, string]> = [
    // [vol, trend, expectedRegime, label]
    // Crisis zone: vol > 0.30
    [0.31, 0.5, 3, 'vol=0.31 → Crisis'],
    [0.50, 0.0, 3, 'vol=0.50 → Crisis'],
    [0.35, 2.0, 3, 'vol=0.35, high trend → still Crisis'],
    // High_vol_ranging: vol > 0.20 && trend < 0.5
    [0.25, 0.3, 2, 'vol=0.25, trend=0.3 → High_vol_ranging'],
    [0.21, 0.0, 2, 'vol=0.21, trend=0 → High_vol_ranging'],
    [0.29, 0.49, 2, 'vol=0.29, trend=0.49 → High_vol_ranging'],
    // Low_vol_trending: vol < 0.15 && trend > 1.0
    [0.10, 1.5, 0, 'vol=0.10, trend=1.5 → Low_vol_trending'],
    [0.05, 2.0, 0, 'vol=0.05, trend=2.0 → Low_vol_trending'],
    [0.14, 1.1, 0, 'vol=0.14, trend=1.1 → Low_vol_trending'],
    // Normal: everything else
    [0.18, 0.7, 1, 'vol=0.18, trend=0.7 → Normal'],
    [0.16, 0.8, 1, 'vol=0.16, trend=0.8 → Normal (vol not < 0.15)'],
    [0.22, 0.6, 1, 'vol=0.22, trend=0.6 → Normal (trend not < 0.5)'],
    [0.10, 0.8, 1, 'vol=0.10, trend=0.8 → Normal (trend not > 1.0)'],
    // Boundary-exact values: should NOT trigger the adjacent regime
    [0.30, 0.5, 1, 'vol=0.30 exactly → Normal (not > 0.30)'],
    [0.20, 0.5, 1, 'vol=0.20, trend=0.5 → Normal (not > 0.20 or not < 0.5)'],
    [0.15, 1.0, 1, 'vol=0.15, trend=1.0 → Normal (not < 0.15 or not > 1.0)'],
    // Edge cases
    [0.0, 0.0, 1, 'vol=0, trend=0 → Normal'],
    [1.0, 10.0, 3, 'extreme vol=1.0 → Crisis'],
    [0.001, 100.0, 0, 'tiny vol, huge trend → Low_vol_trending'],
    // Just-past-boundary
    [0.301, 0.5, 3, 'vol just above 0.30 → Crisis'],
    [0.201, 0.499, 2, 'vol just above 0.20, trend just below 0.5 → High_vol_ranging'],
    [0.149, 1.001, 0, 'vol just below 0.15, trend just above 1.0 → Low_vol_trending'],
  ];

  for (const [vol, trend, expected, label] of cases) {
    it(label, () => {
      expect(Regime.classify(vol, trend)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Helper-function equivalence
// ---------------------------------------------------------------------------

describe('helper-function equivalence (engine vs backtest reference)', () => {
  const EPSILON = 1e-10;

  // Test close arrays representing different market conditions
  const testArrays: Record<string, number[]> = {
    'flat prices': Array.from({ length: 21 }, () => 100),
    'steady uptrend': (() => {
      const c = [100];
      for (let i = 1; i <= 20; i++) c.push(c[i - 1] * 1.01);
      return c;
    })(),
    'high volatility': (() => {
      const c = [100];
      for (let i = 1; i <= 20; i++) c.push(c[i - 1] * (i % 2 === 0 ? 1.05 : 0.95));
      return c;
    })(),
    'crash then recovery': (() => {
      const c = [100];
      for (let i = 1; i <= 10; i++) c.push(c[i - 1] * 0.97);
      for (let i = 11; i <= 20; i++) c.push(c[i - 1] * 1.03);
      return c;
    })(),
    'gentle downtrend': (() => {
      const c = [100];
      for (let i = 1; i <= 20; i++) c.push(c[i - 1] * 0.995);
      return c;
    })(),
  };

  for (const [name, closes] of Object.entries(testArrays)) {
    it(`annualizedRealizedVol matches reference for ${name}`, () => {
      const engineVal = annualizedRealizedVol(closes);
      const refVal = refAnnualizedRealizedVol(closes);
      expect(Math.abs(engineVal - refVal)).toBeLessThan(EPSILON);
    });

    it(`trendStrength matches reference for ${name}`, () => {
      const engineVal = trendStrength(closes);
      const refVal = refTrendStrength(closes);
      expect(Math.abs(engineVal - refVal)).toBeLessThan(EPSILON);
    });
  }
});

// ---------------------------------------------------------------------------
// Aggregation correctness
// ---------------------------------------------------------------------------

describe('aggregateToDailyCloses correctness', () => {
  it('produces correct daily sequence from synthetic 1-min bars', () => {
    // 3 "days" of 390 bars each, with different closing prices per day
    const bars: Array<{ c: number }> = [];
    for (let day = 0; day < 3; day++) {
      for (let bar = 0; bar < 390; bar++) {
        bars.push({ c: 100 + day * 10 + bar * 0.01 });
      }
    }
    const daily = aggregateToDailyCloses(bars, 390);
    expect(daily).toHaveLength(3);
    // Last bar of each day
    expect(daily[0]).toBeCloseTo(100 + 389 * 0.01); // 103.89
    expect(daily[1]).toBeCloseTo(110 + 389 * 0.01); // 113.89
    expect(daily[2]).toBeCloseTo(120 + 389 * 0.01); // 123.89
  });
});
