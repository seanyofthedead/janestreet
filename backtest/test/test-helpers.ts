/**
 * Shared test data generators for regime backtest tests.
 * All generators are deterministic — no Math.random().
 */

import type { Bar } from '../src/data-loader.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const BASE_TIMESTAMP = new Date('2026-01-05T14:30:00Z').getTime(); // Monday

// ---------------------------------------------------------------------------
// Core generator
// ---------------------------------------------------------------------------

export interface BarGenConfig {
  symbol: string;
  count: number;
  startPrice: number;
  /** Deterministic per-bar price change function. Receives bar index. */
  changeFn: (i: number) => number;
  /** Timestamp spacing (default: 1 day) */
  intervalMs?: number;
  /** Base timestamp (default: 2026-01-05 14:30 UTC) */
  baseTimestamp?: number;
  /** Volume base (default: 1_000_000) */
  volumeBase?: number;
}

export function generateBars(config: BarGenConfig): Bar[] {
  const {
    count,
    startPrice,
    changeFn,
    intervalMs = DAY_MS,
    baseTimestamp = BASE_TIMESTAMP,
    volumeBase = 1_000_000,
  } = config;

  const bars: Bar[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const change = changeFn(i);
    price = Math.max(1, price + change);

    const open = price - change * 0.3;
    const close = price;
    const spread = Math.abs(change) + 0.5;
    const high = Math.max(open, close) + spread * 0.6;
    const low = Math.min(open, close) - spread * 0.4;
    const volume = volumeBase + Math.floor(Math.sin(i * 0.2) * volumeBase * 0.3);

    bars.push({
      timestamp: baseTimestamp + i * intervalMs,
      open: round2(open),
      high: round2(high),
      low: round2(Math.max(0.01, low)),
      close: round2(close),
      volume,
    });
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Preset generators
// ---------------------------------------------------------------------------

/**
 * High-volatility bars: large daily swings (3-5% of price).
 * Designed to trigger Crisis regime detection (realized vol > 30% annualized).
 */
export function generateHighVolBars(
  symbol: string,
  count: number,
  startPrice: number,
): Bar[] {
  return generateBars({
    symbol,
    count,
    startPrice,
    changeFn: (i) => {
      const pct = 0.035 + Math.sin(i * 0.7) * 0.015;
      return startPrice * pct * (i % 2 === 0 ? 1 : -1);
    },
  });
}

/**
 * Calm trending bars: small consistent upward drift with low noise.
 * Designed to trigger Low_vol_trending (realized vol < 15%, strong trend).
 */
export function generateTrendingBars(
  symbol: string,
  count: number,
  startPrice: number,
  dailyDriftPct = 0.002,
): Bar[] {
  return generateBars({
    symbol,
    count,
    startPrice,
    changeFn: (i) => {
      const drift = startPrice * dailyDriftPct;
      const noise = Math.sin(i * 1.3) * startPrice * 0.0005;
      return drift + noise;
    },
  });
}

/**
 * Ranging bars: oscillates in a band with high volatility but no direction.
 * Designed to trigger High_vol_ranging (high vol, low trend strength).
 */
export function generateRangingBars(
  symbol: string,
  count: number,
  startPrice: number,
  rangePct = 0.03,
): Bar[] {
  return generateBars({
    symbol,
    count,
    startPrice,
    changeFn: (i) => {
      return startPrice * rangePct * Math.sin(i * 0.3);
    },
  });
}

/**
 * Mixed regime bars: concatenates segments of different volatility profiles.
 */
export interface MixedRegimeConfig {
  symbol: string;
  startPrice: number;
  segments: Array<{
    count: number;
    type: 'calm' | 'volatile' | 'trending' | 'ranging';
  }>;
}

export function generateMixedRegimeBars(config: MixedRegimeConfig): Bar[] {
  const { startPrice, segments } = config;
  const allBars: Bar[] = [];
  let price = startPrice;
  let timestamp = BASE_TIMESTAMP;

  for (const segment of segments) {
    for (let i = 0; i < segment.count; i++) {
      let change: number;
      switch (segment.type) {
        case 'calm':
          change = price * 0.001 * Math.sin(i * 0.5);
          break;
        case 'volatile':
          change = price * 0.04 * (i % 2 === 0 ? 1 : -1.05);
          break;
        case 'trending':
          change = price * 0.002 + Math.sin(i * 1.3) * price * 0.0003;
          break;
        case 'ranging':
          change = price * 0.025 * Math.sin(i * 0.3);
          break;
      }

      price = Math.max(1, price + change);
      const open = price - change * 0.3;
      const close = price;
      const spread = Math.abs(change) + 0.5;
      const high = Math.max(open, close) + spread * 0.6;
      const low = Math.min(open, close) - spread * 0.4;

      allBars.push({
        timestamp,
        open: round2(open),
        high: round2(high),
        low: round2(Math.max(0.01, low)),
        close: round2(close),
        volume: 1_000_000 + Math.floor(Math.sin(i * 0.2) * 300_000),
      });
      timestamp += DAY_MS;
    }
  }

  return allBars;
}

/**
 * Generate 1-minute bars (for intraday backtest use).
 */
export function generateMinuteBars(
  symbol: string,
  count: number,
  startPrice: number,
  volatilityPct = 0.001,
): Bar[] {
  return generateBars({
    symbol,
    count,
    startPrice,
    intervalMs: MIN_MS,
    changeFn: (i) => {
      return startPrice * volatilityPct * Math.sin(i * 0.1 + 0.5);
    },
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function closePrices(bars: Bar[]): number[] {
  return bars.map(b => b.close);
}

export function logReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  return returns;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function realizedVol(closes: number[], period = 20): number {
  if (closes.length < period + 1) return 0;
  const recent = closes.slice(-(period + 1));
  const returns = logReturns(recent);
  return stdev(returns) * Math.sqrt(252);
}
