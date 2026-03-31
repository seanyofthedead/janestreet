/**
 * Signal conflict resolution.
 * Groups signals by symbol and resolves conflicts using confidence + priority.
 */

import pino from 'pino';
import * as Signal from '../../trading-core-js/trading-core/lib/signal.js';
import type { StrategySignal } from './strategy-runner.js';

// ---------------------------------------------------------------------------
// ConflictResolver
// ---------------------------------------------------------------------------

export class ConflictResolver {
  private readonly logger: pino.Logger;

  constructor(logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'conflict-resolver' })).child({
      component: 'conflict-resolver',
    });
  }

  /**
   * Resolve conflicting signals for the same symbol.
   *
   * Rules:
   * 1. Group signals by symbol
   * 2. If all signals for a symbol agree on side, keep the highest confidence one
   * 3. If signals conflict (different sides), the highest confidence wins;
   *    ties broken by fixed priority: mean_reversion > momentum > market_making
   *    (uses OCaml Signal.compare_priority)
   * 4. Return one signal per symbol
   */
  resolve(signals: StrategySignal[]): StrategySignal[] {
    if (signals.length === 0) return [];

    // Group by symbol
    const grouped = new Map<string, StrategySignal[]>();
    for (const signal of signals) {
      const existing = grouped.get(signal.symbol);
      if (existing) {
        existing.push(signal);
      } else {
        grouped.set(signal.symbol, [signal]);
      }
    }

    const resolved: StrategySignal[] = [];

    for (const [symbol, symbolSignals] of grouped) {
      if (symbolSignals.length === 1) {
        resolved.push(symbolSignals[0]!);
        continue;
      }

      // Sort by confidence descending, then strategy priority (OCaml compare_priority)
      symbolSignals.sort((a, b) => Signal.compare_priority(a, b));

      const winner = symbolSignals[0]!;

      // Check for conflicts (different sides)
      const hasBuy = symbolSignals.some((s) => s.side === 0);
      const hasSell = symbolSignals.some((s) => s.side === 1);

      if (hasBuy && hasSell) {
        this.logger.info(
          {
            symbol,
            winner: {
              strategy: winner.strategy,
              side: winner.side === 0 ? 'buy' : 'sell',
              confidence: Signal.confidence(winner),
            },
            conflicting: symbolSignals.length,
          },
          'Resolved signal conflict',
        );
      }

      resolved.push(winner);
    }

    this.logger.debug(
      { input: signals.length, output: resolved.length },
      'Signal resolution complete',
    );

    return resolved;
  }
}
