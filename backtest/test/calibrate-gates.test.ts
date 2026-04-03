/**
 * Empirical gate calibration study.
 * Analyzes indicator distributions on real 1-min SPY data.
 * Run: npx vitest run backtest/test/calibrate-gates.test.ts
 */

import { describe, it, expect } from 'vitest';
import { loadBars } from '../src/data-loader.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error Melange-compiled JS
import { ema, rsi, z_score, hurst_exponent, adf_statistic, bollinger_bands } from '../../trading-core-js/trading-core/lib/indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hasData = existsSync(join(__dirname, '..', '..', 'data', 'SPY_1Min.json'));

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdDev(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const m = slice.reduce((a, b) => a + b, 0) / period;
  return Math.sqrt(slice.reduce((acc, v) => acc + (v - m) ** 2, 0) / period);
}

function relativeVolume(volumes: number[], period: number): number {
  if (volumes.length < period + 1) return 1.0;
  const avg = volumes.slice(-(period + 1), -1).reduce((a, b) => a + b, 0) / period;
  return avg === 0 ? 0 : volumes[volumes.length - 1] / avg;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function passRate(values: number[], threshold: number, dir: 'lt' | 'gte'): number {
  const n = dir === 'lt' ? values.filter(v => v < threshold).length : values.filter(v => v >= threshold).length;
  return n / values.length;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

describe.skipIf(!hasData)('signal gate calibration study', () => {
  it('analyzes indicator distributions on real 1-min data', async () => {
    const bars = await loadBars('SPY', '1Min', new Date('2026-03-10'), new Date('2026-03-27'));
    console.log(`\nLoaded ${bars.length} SPY 1-min bars (${(bars.length / 390).toFixed(1)} trading days)\n`);

    const WARMUP = 200;
    const closes: number[] = [], volumes: number[] = [];
    const adfValues: number[] = [], hurstValues: number[] = [], absZValues: number[] = [], rvolValues: number[] = [];
    const LOOKAHEAD = 5;
    const mrOutcomes: Array<{ profitable: boolean; pnlBps: number }> = [];
    const momOutcomes: Array<{ profitable: boolean; pnlBps: number }> = [];
    let ema12 = 0, ema26 = 0;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      closes.push(bar.close); volumes.push(bar.volume);
      ema12 = closes.length === 1 ? bar.close : ema(12.0, ema12 || bar.close, bar.close);
      ema26 = closes.length === 1 ? bar.close : ema(26.0, ema26 || bar.close, bar.close);
      if (i < WARMUP) continue;

      const sma20 = sma(closes, 20), std20 = stdDev(closes, 20);

      if (closes.length >= 50) {
        const returns = closes.slice(-50).map((c, j, a) => j === 0 ? 0 : (c - a[j-1]) / a[j-1]).slice(1);
        const h = hurst_exponent(returns) as number;
        const a = adf_statistic(closes.slice(-50)) as number;
        if (Number.isFinite(h)) hurstValues.push(h);
        if (Number.isFinite(a)) adfValues.push(a);
      }

      if (std20 > 0) {
        const z = z_score(bar.close, sma20, std20) as number;
        if (Number.isFinite(z)) absZValues.push(Math.abs(z));
      }

      const rv = relativeVolume(volumes, 20);
      if (Number.isFinite(rv)) rvolValues.push(rv);

      // Mean reversion profitability at relaxed thresholds
      if (i + LOOKAHEAD < bars.length && closes.length >= 50) {
        const returns = closes.slice(-50).map((c, j, a) => j === 0 ? 0 : (c - a[j-1]) / a[j-1]).slice(1);
        const h = hurst_exponent(returns) as number;
        const a = adf_statistic(closes.slice(-50)) as number;
        const z = std20 > 0 ? z_score(bar.close, sma20, std20) as number : 0;
        if (a < -1.5 && h < 0.55 && Math.abs(z) > 1.5) {
          const dir = z > 0 ? 'sell' : 'buy';
          const exit = bars[i + LOOKAHEAD].close;
          const pnl = dir === 'buy' ? (exit - bar.close) / bar.close : (bar.close - exit) / bar.close;
          mrOutcomes.push({ profitable: pnl > 0, pnlBps: pnl * 10000 });
        }
      }

      // Momentum profitability at relaxed thresholds
      if (i + LOOKAHEAD < bars.length && ema26 > 0) {
        const rv2 = relativeVolume(volumes, 20);
        const cross = (ema12 - ema26) / ema26;
        if (rv2 >= 1.1 && Math.abs(cross) > 0.0001) {
          const dir = cross > 0 ? 'buy' : 'sell';
          const exit = bars[i + LOOKAHEAD].close;
          const pnl = dir === 'buy' ? (exit - bar.close) / bar.close : (bar.close - exit) / bar.close;
          momOutcomes.push({ profitable: pnl > 0, pnlBps: pnl * 10000 });
        }
      }
    }

    const N = adfValues.length;
    console.log(`Post-warmup bars: ${N}\n`);

    // Distributions
    const sortedAdf = [...adfValues].sort((a, b) => a - b);
    const sortedHurst = [...hurstValues].sort((a, b) => a - b);
    const sortedZ = [...absZValues].sort((a, b) => a - b);
    const sortedRvol = [...rvolValues].sort((a, b) => a - b);

    console.log('=== DISTRIBUTIONS ===\n');
    console.log(`ADF: mean=${mean(adfValues).toFixed(3)}, p5=${percentile(sortedAdf,5).toFixed(3)}, p50=${percentile(sortedAdf,50).toFixed(3)}, p95=${percentile(sortedAdf,95).toFixed(3)}`);
    console.log(`  <-2.86: ${(passRate(adfValues,-2.86,'lt')*100).toFixed(1)}%  <-1.50: ${(passRate(adfValues,-1.50,'lt')*100).toFixed(1)}%  <-1.00: ${(passRate(adfValues,-1.00,'lt')*100).toFixed(1)}%`);
    console.log(`Hurst: mean=${mean(hurstValues).toFixed(4)}, p5=${percentile(sortedHurst,5).toFixed(4)}, p50=${percentile(sortedHurst,50).toFixed(4)}, p95=${percentile(sortedHurst,95).toFixed(4)}`);
    console.log(`  <0.50: ${(passRate(hurstValues,0.50,'lt')*100).toFixed(1)}%  <0.55: ${(passRate(hurstValues,0.55,'lt')*100).toFixed(1)}%`);
    console.log(`|Z|: mean=${mean(absZValues).toFixed(3)}, p75=${percentile(sortedZ,75).toFixed(3)}, p90=${percentile(sortedZ,90).toFixed(3)}, p95=${percentile(sortedZ,95).toFixed(3)}`);
    console.log(`  >=2.0: ${(passRate(absZValues,2.0,'gte')*100).toFixed(1)}%  >=1.5: ${(passRate(absZValues,1.5,'gte')*100).toFixed(1)}%`);
    console.log(`RVOL: mean=${mean(rvolValues).toFixed(3)}, p50=${percentile(sortedRvol,50).toFixed(3)}, p90=${percentile(sortedRvol,90).toFixed(3)}, p95=${percentile(sortedRvol,95).toFixed(3)}`);
    console.log(`  >=1.50: ${(passRate(rvolValues,1.50,'gte')*100).toFixed(1)}%  >=1.10: ${(passRate(rvolValues,1.10,'gte')*100).toFixed(1)}%`);

    // Combined pass rates
    console.log('\n=== COMBINED GATES ===\n');
    const minLen = Math.min(adfValues.length, hurstValues.length, absZValues.length);
    const combos = [
      { name: 'Current (ADF<-2.86,H<0.50,|z|>=2.0)', adf: -2.86, h: 0.50, z: 2.0 },
      { name: 'Relaxed (ADF<-1.50,H<0.55,|z|>=1.5)', adf: -1.50, h: 0.55, z: 1.5 },
      { name: 'No ADF  (H<0.55,|z|>=1.5)',            adf: 999,   h: 0.55, z: 1.5 },
    ];
    for (const c of combos) {
      let p = 0;
      for (let i = 0; i < minLen; i++) {
        if ((c.adf === 999 || adfValues[i] < c.adf) && hurstValues[i] < c.h && absZValues[i] >= c.z) p++;
      }
      console.log(`  ${c.name}: ${(p/minLen*100).toFixed(2)}% (${p}/${minLen})`);
    }

    // Profitability
    console.log('\n=== PROFITABILITY (5-bar lookahead) ===\n');
    console.log(`MeanRev (relaxed): ${mrOutcomes.length} signals, ${mrOutcomes.filter(o=>o.profitable).length} profitable (${mrOutcomes.length>0?((mrOutcomes.filter(o=>o.profitable).length/mrOutcomes.length)*100).toFixed(1):'N/A'}%), avg ${mrOutcomes.length>0?(mean(mrOutcomes.map(o=>o.pnlBps))).toFixed(2):'N/A'} bps`);
    console.log(`Momentum (relaxed): ${momOutcomes.length} signals, ${momOutcomes.filter(o=>o.profitable).length} profitable (${momOutcomes.length>0?((momOutcomes.filter(o=>o.profitable).length/momOutcomes.length)*100).toFixed(1):'N/A'}%), avg ${momOutcomes.length>0?(mean(momOutcomes.map(o=>o.pnlBps))).toFixed(2):'N/A'} bps`);

    expect(N).toBeGreaterThan(0);
  }, 120_000);
});
