/**
 * Regime detection helper functions.
 * Computes realized volatility and trend strength from price closes.
 * Exported as pure functions for direct testability.
 */

/**
 * Aggregate 1-min bars to daily-equivalent closes by taking the last close
 * from each barsPerDay-sized chunk.
 */
export function aggregateToDailyCloses(
  minuteBars: Array<{ c: number }>,
  barsPerDay: number = 390,
): number[] {
  const dailyCloses: number[] = [];
  for (let i = barsPerDay - 1; i < minuteBars.length; i += barsPerDay) {
    dailyCloses.push(minuteBars[i].c);
  }
  return dailyCloses;
}

/**
 * Annualized realized volatility from daily close prices.
 * Uses log returns with sample variance, annualized by sqrt(252).
 * Matches backtest/src/regime-labels.ts helper logic.
 */
export function annualizedRealizedVol(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Trend strength: annualized absolute return divided by annualized vol.
 * A Sharpe-like ratio of directional move over volatility.
 * Matches backtest/src/regime-labels.ts helper logic.
 */
export function trendStrength(closes: number[]): number {
  if (closes.length < 2) return 0;
  const periodReturn = Math.abs(Math.log(closes[closes.length - 1] / closes[0]));
  const vol = annualizedRealizedVol(closes);
  if (vol <= 0) return 0;
  const annualizedReturn = periodReturn * (252 / (closes.length - 1));
  return annualizedReturn / vol;
}
