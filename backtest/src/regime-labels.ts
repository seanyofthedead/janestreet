/**
 * Oracle regime labeling from historical bar data.
 * Computes "correct" regime labels from realized volatility and trend strength,
 * using thresholds aligned with trading-core/lib/regime.ml classify function.
 *
 * Labels are daily granularity — regime doesn't change intraday.
 */

import type { Bar } from './data-loader.js';

// @ts-expect-error — Melange-compiled JS, no .d.ts
import * as Regime from '../../trading-core-js/trading-core/lib/regime.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegimeId = 0 | 1 | 2 | 3;

export const REGIME_NAMES: Record<RegimeId, string> = {
  0: 'Low_vol_trending',
  1: 'Normal',
  2: 'High_vol_ranging',
  3: 'Crisis',
};

export interface RegimeLabel {
  start: number;
  end: number;
  regime: RegimeId;
  realizedVol: number;
  trendStrength: number;
}

export type RegimeSchedule = RegimeLabel[];

const VOL_LOOKBACK = 20;

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export function computeOracleLabels(dailyBars: Bar[]): RegimeSchedule {
  if (dailyBars.length < VOL_LOOKBACK + 1) return [];

  const closes = dailyBars.map(b => b.close);
  const schedule: RegimeSchedule = [];

  for (let i = VOL_LOOKBACK; i < dailyBars.length; i++) {
    const windowCloses = closes.slice(i - VOL_LOOKBACK, i + 1);
    const vol = annualizedRealizedVol(windowCloses);
    const trend = trendStrength(windowCloses);
    const regime = classifyRegime(vol, trend);

    const bar = dailyBars[i];
    const dayStart = bar.timestamp;
    const dayEnd = i + 1 < dailyBars.length
      ? dailyBars[i + 1].timestamp - 1
      : bar.timestamp + 24 * 60 * 60 * 1000 - 1;

    const prev = schedule[schedule.length - 1];
    if (prev && prev.regime === regime) {
      prev.end = dayEnd;
      prev.realizedVol = vol;
      prev.trendStrength = trend;
    } else {
      schedule.push({ start: dayStart, end: dayEnd, regime, realizedVol: vol, trendStrength: trend });
    }
  }

  return schedule;
}

export function classifyRegime(realizedVol: number, trendStrength: number): RegimeId {
  return Regime.classify(realizedVol, trendStrength) as RegimeId;
}

export function lookupRegime(schedule: RegimeSchedule, timestamp: number): RegimeId {
  for (const label of schedule) {
    if (timestamp >= label.start && timestamp <= label.end) return label.regime;
  }
  return 1;
}

export function regimeBreakdown(schedule: RegimeSchedule): Record<RegimeId, number> {
  const breakdown: Record<RegimeId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const label of schedule) {
    breakdown[label.regime] += (label.end - label.start) / (24 * 60 * 60 * 1000);
  }
  return breakdown;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

function annualizedRealizedVol(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function trendStrength(closes: number[]): number {
  if (closes.length < 2) return 0;
  const periodReturn = Math.abs(Math.log(closes[closes.length - 1] / closes[0]));
  const vol = annualizedRealizedVol(closes);
  if (vol <= 0) return 0;
  const annualizedReturn = periodReturn * (252 / (closes.length - 1));
  return annualizedReturn / vol;
}
