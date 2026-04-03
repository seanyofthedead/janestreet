/**
 * Integration test: runs actual regime comparison on real historical data.
 * Uses vitest for Melange alias resolution.
 * Run: npx vitest run backtest/test/run-regime-comparison.test.ts
 */

import { describe, it, expect } from 'vitest';
import { loadBars, type Bar } from '../src/data-loader.js';
import { computeOracleLabels } from '../src/regime-labels.js';
import { runComparison, formatReport, type ComparisonVariant } from '../src/regime-comparison.js';
import type { BacktestConfig } from '../src/runner.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hasData = existsSync(join(__dirname, '..', '..', 'data', 'SPY_1Day.json'));

describe.skipIf(!hasData)('regime comparison on real data', () => {
  it('runs baseline vs oracle and reports results', async () => {
    const spyDaily = await loadBars('SPY', '1Day', new Date('2026-01-02'), new Date('2026-03-27'));
    console.log(`SPY daily: ${spyDaily.length} bars`);

    const oracleSchedule = computeOracleLabels(spyDaily);
    console.log(`Oracle periods: ${oracleSchedule.length}`);
    for (const l of oracleSchedule) {
      const names = ['Low_vol_trending', 'Normal', 'High_vol_ranging', 'Crisis'];
      console.log(`  ${new Date(l.start).toISOString().slice(0,10)} ${names[l.regime]} (vol=${(l.realizedVol*100).toFixed(1)}%)`);
    }

    // 2 symbols, 1 week — manageable for the O(n^2) runner
    const symbols = ['SPY', 'AAPL'];
    const barsBySymbol = new Map<string, Bar[]>();
    for (const sym of symbols) {
      try {
        const bars = await loadBars(sym, '1Min', new Date('2026-03-10'), new Date('2026-03-22'));
        barsBySymbol.set(sym, bars);
        console.log(`${sym}: ${bars.length} bars`);
      } catch { console.log(`${sym}: no data`); }
    }
    expect(barsBySymbol.size).toBeGreaterThan(0);

    const firstBars = [...barsBySymbol.values()][0];
    const baseConfig: Omit<BacktestConfig, 'regimeSchedule'> = {
      symbols: [...barsBySymbol.keys()],
      startDate: new Date(firstBars[0].timestamp),
      endDate: new Date(firstBars[firstBars.length - 1].timestamp),
      initialCapital: 50_000,
      strategies: [0, 3] as (0 | 1 | 2 | 3 | 4)[],
      slippagePct: 0.0005,
    };

    const variants: ComparisonVariant[] = [
      { name: 'Baseline' },
      { name: 'Oracle', regimeSchedule: oracleSchedule },
    ];

    console.log('\nRunning backtests...');
    const report = runComparison(baseConfig, barsBySymbol, variants);
    console.log(formatReport(report));

    expect(report.variants).toHaveLength(2);
    for (const v of report.variants) {
      expect(Number.isFinite(v.result.metrics.sharpeRatio)).toBe(true);
    }
  }, 120_000);
});
