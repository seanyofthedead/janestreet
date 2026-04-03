/**
 * Regime backtest comparison.
 * Runs multiple backtest variants and produces a comparison report.
 */

import type { BacktestConfig, BacktestResult } from './runner.js';
import { runBacktest } from './runner.js';
import type { Bar } from './data-loader.js';
import type { RegimeSchedule, RegimeId } from './regime-labels.js';
import { regimeBreakdown, REGIME_NAMES } from './regime-labels.js';

export interface ComparisonVariant {
  name: string;
  regimeSchedule?: BacktestConfig['regimeSchedule'];
}

export interface VariantResult {
  name: string;
  result: BacktestResult;
}

export interface ComparisonReport {
  variants: VariantResult[];
  sharpeImprovement: Record<string, number>;
  captureRatios: Record<string, number>;
  regimeBreakdownDays?: Record<string, number>;
}

export function runComparison(
  baseConfig: Omit<BacktestConfig, 'regimeSchedule'>,
  barsBySymbol: Map<string, Bar[]>,
  variants: ComparisonVariant[],
): ComparisonReport {
  if (variants.length < 2) throw new Error('Need at least 2 variants');

  const results: VariantResult[] = [];
  for (const variant of variants) {
    const config: BacktestConfig = { ...baseConfig, regimeSchedule: variant.regimeSchedule };
    const result = runBacktest(config, barsBySymbol);
    results.push({ name: variant.name, result });
  }

  const baselineSharpe = results[0].result.metrics.sharpeRatio;
  const sharpeImprovement: Record<string, number> = {};
  const captureRatios: Record<string, number> = {};

  const oracleResult = results.find(r => r.name.toLowerCase().includes('oracle'));
  const oracleSharpe = oracleResult?.result.metrics.sharpeRatio ?? baselineSharpe;
  const oracleDelta = oracleSharpe - baselineSharpe;

  for (const r of results) {
    const delta = r.result.metrics.sharpeRatio - baselineSharpe;
    sharpeImprovement[r.name] = baselineSharpe !== 0 ? delta / Math.abs(baselineSharpe) : 0;
    captureRatios[r.name] = oracleDelta !== 0 ? delta / oracleDelta : (delta === 0 ? 1 : 0);
  }

  let regimeBreakdownDays: Record<string, number> | undefined;
  const oracleVariant = variants.find(v => v.name.toLowerCase().includes('oracle'));
  if (oracleVariant?.regimeSchedule) {
    const breakdown = regimeBreakdown(oracleVariant.regimeSchedule as RegimeSchedule);
    regimeBreakdownDays = {};
    for (const [id, days] of Object.entries(breakdown)) {
      regimeBreakdownDays[REGIME_NAMES[Number(id) as RegimeId]] = Math.round(days * 10) / 10;
    }
  }

  return { variants: results, sharpeImprovement, captureRatios, regimeBreakdownDays };
}

export function formatReport(report: ComparisonReport): string {
  const lines: string[] = ['', '=== Regime Backtest Comparison ===', ''];
  const header = '| Variant        | Sharpe | Sortino | Max DD  | Win Rate | Trades | Sharpe Δ |';
  const sep =    '|----------------|--------|---------|---------|----------|--------|----------|';
  lines.push(header, sep);

  for (const v of report.variants) {
    const m = v.result.metrics;
    const improvPct = ((report.sharpeImprovement[v.name] ?? 0) * 100).toFixed(1);
    lines.push(
      `| ${v.name.padEnd(14)} | ${m.sharpeRatio.toFixed(2).padStart(6)} | ${(m.sortinoRatio ?? 0).toFixed(2).padStart(7)} | ${(-(m.maxDrawdown * 100)).toFixed(1).padStart(6)}% | ${((m.winRate ?? 0) * 100).toFixed(1).padStart(7)}% | ${String(m.totalTrades).padStart(6)} | ${improvPct.padStart(7)}% |`,
    );
  }

  lines.push('', 'Capture ratios:');
  for (const [name, ratio] of Object.entries(report.captureRatios)) {
    if (name.toLowerCase().includes('baseline')) continue;
    lines.push(`  ${name}: ${(ratio * 100).toFixed(1)}%`);
  }

  if (report.regimeBreakdownDays) {
    lines.push('', 'Regime time (days):');
    for (const [name, days] of Object.entries(report.regimeBreakdownDays)) {
      lines.push(`  ${name}: ${days}`);
    }
  }

  const oracleImprovement = report.sharpeImprovement['Oracle'] ?? report.sharpeImprovement['oracle'] ?? 0;
  lines.push('');
  if (Math.abs(oracleImprovement) < 0.05) lines.push('DECISION: Oracle < 5%. Regime NOT the bottleneck.');
  else if (Math.abs(oracleImprovement) < 0.10) lines.push('DECISION: Oracle 5-10%. Proceed cautiously.');
  else lines.push('DECISION: Oracle > 10%. Proceed to Step 3.');
  lines.push('');
  return lines.join('\n');
}
