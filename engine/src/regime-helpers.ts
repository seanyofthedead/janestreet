/**
 * Regime detection helper functions.
 * Computes realized volatility and trend strength from price closes.
 * Exported as pure functions for direct testability.
 *
 * The periodsPerYear parameter controls annualization:
 * - Daily bars: 252
 * - 1-min bars: 252 * 390 = 98,280
 * Annualized vol is scale-invariant: sqrt(98280) on 1-min returns
 * produces the same annualized vol as sqrt(252) on daily returns.
 */

/** 1-min bars: 252 trading days * 390 minutes per day */
export const PERIODS_PER_YEAR_1MIN = 252 * 390;

/** Daily bars: 252 trading days */
export const PERIODS_PER_YEAR_DAILY = 252;

/**
 * Annualized realized volatility from close prices.
 * Uses log returns with sample variance, annualized by sqrt(periodsPerYear).
 */
export function annualizedRealizedVol(
  closes: number[],
  periodsPerYear: number = PERIODS_PER_YEAR_1MIN,
): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(periodsPerYear);
}

/**
 * Trend strength: annualized absolute return divided by annualized vol.
 * A Sharpe-like ratio of directional move over volatility.
 */
export function trendStrength(
  closes: number[],
  periodsPerYear: number = PERIODS_PER_YEAR_1MIN,
): number {
  if (closes.length < 2) return 0;
  const periodReturn = Math.abs(Math.log(closes[closes.length - 1] / closes[0]));
  const vol = annualizedRealizedVol(closes, periodsPerYear);
  if (vol <= 0) return 0;
  const annualizedReturn = periodReturn * (periodsPerYear / (closes.length - 1));
  return annualizedReturn / vol;
}
