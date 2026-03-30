/**
 * Performance tracking: maintains per-strategy trade history,
 * computes daily returns, and delegates metrics to Melange-compiled OCaml.
 */

import pino from 'pino';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

// ---------------------------------------------------------------------------
// Melange-compiled performance module
// ---------------------------------------------------------------------------

import * as Performance from '../../trading-core-js/trading-core/lib/performance.js';

import { getDynamoClient, TABLE_HISTORY } from './dynamodb.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeRecord {
  strategy: string;
  pnl: number;
  timestamp: number;
}

export interface StrategyMetrics {
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
  avgWin: number;
  avgLoss: number;
}

// ---------------------------------------------------------------------------
// PerformanceTracker
// ---------------------------------------------------------------------------

export class PerformanceTracker {
  private readonly logger: pino.Logger;
  private readonly trades: TradeRecord[] = [];

  /** Risk-free rate (annualized, e.g. 0.05 for 5%) */
  private readonly riskFreeRate: number;

  constructor(riskFreeRate: number = 0.05) {
    this.logger = pino({ name: 'performance-tracker' });
    this.riskFreeRate = riskFreeRate;
  }

  // -----------------------------------------------------------------------
  // Trade recording
  // -----------------------------------------------------------------------

  /** Record a completed trade's PnL for a strategy. */
  recordTrade(strategy: string, pnl: number, timestamp: number): void {
    this.trades.push({ strategy, pnl, timestamp });
    this.logger.debug({ strategy, pnl, timestamp }, 'trade recorded');
  }

  /** Return all recorded trades (read-only snapshot). */
  getAllTrades(): readonly TradeRecord[] {
    return this.trades;
  }

  /** Return trades for a single strategy. */
  getTradesForStrategy(strategy: string): TradeRecord[] {
    return this.trades.filter((t) => t.strategy === strategy);
  }

  // -----------------------------------------------------------------------
  // Daily return computation
  // -----------------------------------------------------------------------

  /**
   * Compute daily return series for a strategy over the last N days.
   * Groups trades by calendar day and sums PnL per day, then divides by
   * a notional capital of 1.0 (returns are absolute PnL values).
   */
  getDailyReturns(strategy: string, days: number): number[] {
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const stratTrades = this.trades.filter(
      (t) => t.strategy === strategy && t.timestamp >= cutoff,
    );

    if (stratTrades.length === 0) return [];

    // Group by day (UTC date string)
    const dailyMap = new Map<string, number>();
    for (const t of stratTrades) {
      const dayKey = new Date(t.timestamp).toISOString().slice(0, 10);
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + t.pnl);
    }

    // Sort by date and return the PnL values as the return series
    const sorted = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([, pnl]) => pnl);
  }

  // -----------------------------------------------------------------------
  // Metrics (delegates to OCaml via Melange)
  // -----------------------------------------------------------------------

  /** Get performance metrics for a single strategy. */
  getStrategyMetrics(strategy: string, days: number = 252): StrategyMetrics {
    const returns = this.getDailyReturns(strategy, days);
    if (returns.length === 0) {
      return {
        sharpe: 0,
        sortino: 0,
        maxDrawdown: 0,
        winRate: 0,
        profitFactor: 0,
        tradeCount: 0,
        avgWin: 0,
        avgLoss: 0,
      };
    }

    const arr = new Float64Array(returns);
    const m = Performance.calculate_metrics(arr, this.riskFreeRate);

    return {
      sharpe: m.sharpe,
      sortino: m.sortino,
      maxDrawdown: m.max_drawdown,
      winRate: m.win_rate,
      profitFactor: m.profit_factor,
      tradeCount: m.trade_count,
      avgWin: m.avg_win,
      avgLoss: m.avg_loss,
    };
  }

  /** Get metrics for all strategies that have at least one trade. */
  getAllMetrics(days: number = 252): Map<string, StrategyMetrics> {
    const strategies = new Set(this.trades.map((t) => t.strategy));
    const result = new Map<string, StrategyMetrics>();
    for (const s of strategies) {
      result.set(s, this.getStrategyMetrics(s, days));
    }
    return result;
  }

  /** Get the rolling 60-day Sharpe for a strategy. */
  getRollingSharpe(strategy: string, window: number = 60): number {
    const returns = this.getDailyReturns(strategy, window);
    if (returns.length === 0) return 0;
    const arr = new Float64Array(returns);
    return Performance.rolling_sharpe(arr, window);
  }

  // -----------------------------------------------------------------------
  // Persistence (DynamoDB stub)
  // -----------------------------------------------------------------------

  /** Persist daily performance snapshot to DynamoDB. */
  async persistDaily(): Promise<void> {
    const allMetrics = this.getAllMetrics();
    const client = getDynamoClient();
    const date = new Date().toISOString().slice(0, 10);
    const now = Date.now();

    this.logger.info({ strategyCount: allMetrics.size }, 'Persisting daily metrics');

    for (const [strategy, metrics] of allMetrics) {
      try {
        await client.send(
          new PutCommand({
            TableName: TABLE_HISTORY,
            Item: {
              strategy,
              timestamp: now,
              date,
              sharpe: metrics.sharpe,
              sortino: metrics.sortino,
              maxDrawdown: metrics.maxDrawdown,
              winRate: metrics.winRate,
              profitFactor: metrics.profitFactor,
              tradeCount: metrics.tradeCount,
              avgWin: metrics.avgWin,
              avgLoss: metrics.avgLoss,
            },
          }),
        );
      } catch (err) {
        this.logger.warn(
          { strategy, err: (err as Error).message },
          'Failed to persist daily metrics for strategy',
        );
      }
    }
  }
}
