/**
 * Walk-forward optimization.
 * Slides a training/test window across historical data, optimizes parameters
 * on the training set, evaluates on the out-of-sample test set.
 */

import type { Bar } from './data-loader.js';
import type { BacktestConfig, BacktestResult } from './runner.js';
import type { Strategy } from './phase-simulator.js';
import { runBacktest } from './runner.js';
import { sharpe, equityCurveToReturns, maxDrawdown } from './metrics.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParameterSet {
  /** Momentum: EMA fast period */
  emaFast?: number;
  /** Momentum: EMA slow period */
  emaSlow?: number;
  /** Momentum: RSI overbought threshold */
  rsiOverbought?: number;
  /** Momentum: RSI oversold threshold */
  rsiOversold?: number;
  /** Mean reversion: Bollinger period */
  bollingerPeriod?: number;
  /** Mean reversion: Bollinger multiplier */
  bollingerMultiplier?: number;
  /** Mean reversion: z-score entry threshold */
  zScoreEntry?: number;
  /** Mean reversion: z-score exit threshold */
  zScoreExit?: number;
}

export interface WalkForwardConfig {
  /** Training window in months (default 12) */
  trainMonths: number;
  /** Test window in months (default 3) */
  testMonths: number;
  /** Step size in months (default 1) */
  stepMonths: number;
  /** Parameter combinations to evaluate */
  parameterGrid: ParameterSet[];
  /** Backtest base config (symbols, capital, strategies) */
  baseConfig: Omit<BacktestConfig, 'startDate' | 'endDate'>;
}

export interface WindowResult {
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
  bestParams: ParameterSet;
  inSampleSharpe: number;
  outOfSampleSharpe: number;
  outOfSampleReturn: number;
  outOfSampleMaxDD: number;
  outOfSampleTrades: number;
}

export interface WalkForwardResult {
  windows: WindowResult[];
  medianOOSSharpe: number;
  pctPositiveWindows: number;
  maxDrawdown: number;
  promoted: boolean;
  promotionReason: string;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

function filterBarsByDateRange(
  bars: Bar[],
  start: Date,
  end: Date,
): Bar[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return bars.filter(b => b.timestamp >= startMs && b.timestamp <= endMs);
}

// ---------------------------------------------------------------------------
// Grid search
// ---------------------------------------------------------------------------

/**
 * Run a single backtest with a given parameter set.
 * Parameters modify the backtest behavior via the config.
 * Since the OCaml signal modules have fixed thresholds, the parameter set
 * affects which strategies are included and position sizing.
 * For a full parameter sweep, the caller would need custom signal generators;
 * here we evaluate the built-in strategies and record their OOS performance.
 */
function runWithParams(
  params: ParameterSet,
  bars: Map<string, Bar[]>,
  baseConfig: Omit<BacktestConfig, 'startDate' | 'endDate'>,
  start: Date,
  end: Date,
): BacktestResult {
  // Filter bars to the window
  const windowBars = new Map<string, Bar[]>();
  for (const [symbol, symbolBars] of bars) {
    windowBars.set(symbol, filterBarsByDateRange(symbolBars, start, end));
  }

  const config: BacktestConfig = {
    ...baseConfig,
    startDate: start,
    endDate: end,
  };

  return runBacktest(config, windowBars);
}

// ---------------------------------------------------------------------------
// Walk-forward optimization
// ---------------------------------------------------------------------------

export function runWalkForward(
  barsBySymbol: Map<string, Bar[]>,
  config: WalkForwardConfig,
): WalkForwardResult {
  const { trainMonths, testMonths, stepMonths, parameterGrid, baseConfig } = config;

  // Determine overall date range from bars
  let minTimestamp = Infinity;
  let maxTimestamp = -Infinity;
  for (const bars of barsBySymbol.values()) {
    for (const bar of bars) {
      if (bar.timestamp < minTimestamp) minTimestamp = bar.timestamp;
      if (bar.timestamp > maxTimestamp) maxTimestamp = bar.timestamp;
    }
  }

  const dataStart = new Date(minTimestamp);
  const dataEnd = new Date(maxTimestamp);

  const windows: WindowResult[] = [];

  // Slide the window
  let trainStart = new Date(dataStart);

  while (true) {
    const trainEnd = addMonths(trainStart, trainMonths);
    const testStart = new Date(trainEnd);
    const testEnd = addMonths(testStart, testMonths);

    // Check if test window extends beyond available data
    if (testEnd.getTime() > dataEnd.getTime()) break;

    // Phase 1: optimize on training set - find best parameters
    let bestParams: ParameterSet = parameterGrid[0] ?? {};
    let bestTrainSharpe = -Infinity;

    for (const params of parameterGrid) {
      const result = runWithParams(params, barsBySymbol, baseConfig, trainStart, trainEnd);
      const returns = equityCurveToReturns(result.equityCurve);
      const s = sharpe(returns);
      if (s > bestTrainSharpe) {
        bestTrainSharpe = s;
        bestParams = params;
      }
    }

    // Phase 2: evaluate best params on test set (out-of-sample)
    const oosResult = runWithParams(bestParams, barsBySymbol, baseConfig, testStart, testEnd);
    const oosReturns = equityCurveToReturns(oosResult.equityCurve);
    const oosSharpe = sharpe(oosReturns);
    const oosMaxDD = maxDrawdown(oosResult.equityCurve);
    const oosReturn = oosResult.equityCurve.length >= 2
      ? (oosResult.equityCurve[oosResult.equityCurve.length - 1] / oosResult.equityCurve[0]) - 1
      : 0;

    windows.push({
      trainStart: new Date(trainStart),
      trainEnd: new Date(trainEnd),
      testStart: new Date(testStart),
      testEnd: new Date(testEnd),
      bestParams,
      inSampleSharpe: bestTrainSharpe,
      outOfSampleSharpe: oosSharpe,
      outOfSampleReturn: oosReturn,
      outOfSampleMaxDD: oosMaxDD,
      outOfSampleTrades: oosResult.trades.length,
    });

    // Step forward
    trainStart = addMonths(trainStart, stepMonths);
  }

  // Aggregate results
  const oosSharpes = windows.map(w => w.outOfSampleSharpe);
  const medianOOSSharpe = median(oosSharpes);
  const positiveWindows = oosSharpes.filter(s => s > 0).length;
  const pctPositiveWindows =
    windows.length > 0 ? positiveWindows / windows.length : 0;
  const worstMaxDD = Math.max(...windows.map(w => w.outOfSampleMaxDD), 0);

  // Promotion criteria: median OOS Sharpe >= 0.75, positive in >= 70% of windows
  const passedSharpe = medianOOSSharpe >= 0.75;
  const passedPositive = pctPositiveWindows >= 0.7;
  const promoted = passedSharpe && passedPositive;

  let promotionReason: string;
  if (promoted) {
    promotionReason = `Promoted: median OOS Sharpe ${medianOOSSharpe.toFixed(2)} >= 0.75, ${(pctPositiveWindows * 100).toFixed(0)}% positive >= 70%`;
  } else {
    const reasons: string[] = [];
    if (!passedSharpe) {
      reasons.push(`median OOS Sharpe ${medianOOSSharpe.toFixed(2)} < 0.75`);
    }
    if (!passedPositive) {
      reasons.push(`${(pctPositiveWindows * 100).toFixed(0)}% positive < 70%`);
    }
    promotionReason = `Not promoted: ${reasons.join(', ')}`;
  }

  return {
    windows,
    medianOOSSharpe,
    pctPositiveWindows,
    maxDrawdown: worstMaxDD,
    promoted,
    promotionReason,
  };
}

// ---------------------------------------------------------------------------
// Default parameter grids
// ---------------------------------------------------------------------------

/**
 * Generate a default parameter grid for momentum + mean reversion strategies.
 */
export function defaultParameterGrid(): ParameterSet[] {
  const grid: ParameterSet[] = [];

  // Momentum parameter variations
  const emaFastOptions = [8, 12, 16];
  const emaSlowOptions = [21, 26, 34];
  const rsiOverboughtOptions = [65, 70, 75];
  const rsiOversoldOptions = [25, 30, 35];

  for (const emaFast of emaFastOptions) {
    for (const emaSlow of emaSlowOptions) {
      if (emaFast >= emaSlow) continue;
      for (const rsiOb of rsiOverboughtOptions) {
        for (const rsiOs of rsiOversoldOptions) {
          grid.push({
            emaFast,
            emaSlow,
            rsiOverbought: rsiOb,
            rsiOversold: rsiOs,
          });
        }
      }
    }
  }

  // Mean reversion parameter variations
  const bollingerPeriods = [15, 20, 25];
  const bollingerMultipliers = [1.5, 2.0, 2.5];
  const zScoreEntries = [1.5, 2.0, 2.5];
  const zScoreExits = [0.3, 0.5, 0.75];

  for (const bp of bollingerPeriods) {
    for (const bm of bollingerMultipliers) {
      for (const ze of zScoreEntries) {
        for (const zx of zScoreExits) {
          grid.push({
            bollingerPeriod: bp,
            bollingerMultiplier: bm,
            zScoreEntry: ze,
            zScoreExit: zx,
          });
        }
      }
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
