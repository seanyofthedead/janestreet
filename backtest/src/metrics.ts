/**
 * Performance metrics for backtest evaluation.
 * TypeScript implementations matching the OCaml trading-core equivalents.
 */

export interface Trade {
  symbol: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  qty: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
  strategy: string;
}

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Annualized Sharpe ratio.
 * sharpe = sqrt(252) * mean(excess returns) / stdev(returns)
 */
export function sharpe(returns: number[], riskFreeRate = 0.0): number {
  if (returns.length < 2) return 0;
  const dailyRf = riskFreeRate / TRADING_DAYS_PER_YEAR;
  const excess = returns.map(r => r - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance =
    excess.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (excess.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Annualized Sortino ratio.
 * Uses only downside deviation (returns below target).
 */
export function sortino(returns: number[], riskFreeRate = 0.0): number {
  if (returns.length < 2) return 0;
  const dailyRf = riskFreeRate / TRADING_DAYS_PER_YEAR;
  const excess = returns.map(r => r - dailyRf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downsideSquares = excess
    .filter(r => r < 0)
    .map(r => r ** 2);
  if (downsideSquares.length === 0) return mean > 0 ? Infinity : 0;
  const downsideVariance =
    downsideSquares.reduce((a, b) => a + b, 0) / excess.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return 0;
  return (mean / downsideDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Maximum drawdown from an equity curve.
 * Returns a positive number representing the worst peak-to-trough decline as a fraction.
 */
export function maxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/**
 * Calmar ratio: annualized return / max drawdown.
 */
export function calmar(annualizedReturn: number, maxDD: number): number {
  if (maxDD === 0) return annualizedReturn > 0 ? Infinity : 0;
  return annualizedReturn / maxDD;
}

/**
 * Win rate: percentage of profitable trades.
 */
export function winRate(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  const winners = trades.filter(t => t.pnl > 0).length;
  return winners / trades.length;
}

/**
 * Profit factor: gross profit / gross loss.
 */
export function profitFactor(trades: Trade[]): number {
  const grossProfit = trades
    .filter(t => t.pnl > 0)
    .reduce((acc, t) => acc + t.pnl, 0);
  const grossLoss = Math.abs(
    trades.filter(t => t.pnl < 0).reduce((acc, t) => acc + t.pnl, 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

/**
 * Compute daily returns from an equity curve.
 */
export function equityCurveToReturns(equityCurve: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev === 0) {
      returns.push(0);
    } else {
      returns.push((equityCurve[i] - prev) / prev);
    }
  }
  return returns;
}

/**
 * Annualized return from daily returns.
 */
export function annualizedReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  const cumulative = returns.reduce((acc, r) => acc * (1 + r), 1);
  const years = returns.length / TRADING_DAYS_PER_YEAR;
  if (years === 0) return 0;
  return cumulative ** (1 / years) - 1;
}

/**
 * Bundle all metrics into a summary object.
 */
export interface MetricsSummary {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  calmarRatio: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalTrades: number;
  annualizedReturn: number;
}

export function computeMetrics(
  equityCurve: number[],
  trades: Trade[],
  riskFreeRate = 0.0,
): MetricsSummary {
  const returns = equityCurveToReturns(equityCurve);
  const mdd = maxDrawdown(equityCurve);
  const annRet = annualizedReturn(returns);
  return {
    sharpeRatio: sharpe(returns, riskFreeRate),
    sortinoRatio: sortino(returns, riskFreeRate),
    maxDrawdown: mdd,
    calmarRatio: calmar(annRet, mdd),
    winRate: winRate(trades),
    profitFactor: profitFactor(trades),
    totalPnl: trades.reduce((acc, t) => acc + t.pnl, 0),
    totalTrades: trades.length,
    annualizedReturn: annRet,
  };
}
