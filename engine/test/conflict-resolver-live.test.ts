/**
 * Tests for ConflictResolver using the real Melange-compiled Signal module.
 * Unlike orchestrator.test.ts (which replicates logic), this exercises
 * the actual OCaml compare_priority function.
 */

import { describe, it, expect } from 'vitest';
import { ConflictResolver } from '../src/conflict-resolver.js';
import type { StrategySignal } from '../src/strategy-runner.js';

function makeSignal(overrides: Partial<StrategySignal>): StrategySignal {
  return {
    strategy: 0,
    symbol: 'SPY',
    side: 0,
    strength: { TAG: 0, _0: 0.8 },
    target_price: 450,
    max_position_pct: 0.08,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('ConflictResolver (live OCaml)', () => {
  const resolver = new ConflictResolver();

  it('returns empty for no signals', () => {
    expect(resolver.resolve([])).toHaveLength(0);
  });

  it('passes through single signal unchanged', () => {
    const signal = makeSignal({ symbol: 'SPY', strategy: 0 });
    const resolved = resolver.resolve([signal]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toBe(signal);
  });

  it('picks highest confidence signal for same symbol', () => {
    const low = makeSignal({
      symbol: 'SPY',
      strategy: 0,
      side: 0,
      strength: { TAG: 1, _0: 0.5 },
    });
    const high = makeSignal({
      symbol: 'SPY',
      strategy: 3,
      side: 1,
      strength: { TAG: 0, _0: 0.85 },
    });

    const resolved = resolver.resolve([low, high]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].strategy).toBe(3); // Momentum wins with 0.85
    expect(resolved[0].side).toBe(1); // sell
  });

  it('uses strategy priority as tiebreaker', () => {
    // Mean_reversion (priority 3) vs Momentum (priority 2), same confidence
    const mr = makeSignal({
      symbol: 'AAPL',
      strategy: 0,
      strength: { TAG: 0, _0: 0.8 },
    });
    const mom = makeSignal({
      symbol: 'AAPL',
      strategy: 3,
      strength: { TAG: 0, _0: 0.8 },
    });

    const resolved = resolver.resolve([mom, mr]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].strategy).toBe(0); // Mean_reversion wins on priority
  });

  it('keeps independent symbols separate', () => {
    const spy = makeSignal({ symbol: 'SPY', strategy: 0, strength: { TAG: 0, _0: 0.7 } });
    const qqq = makeSignal({ symbol: 'QQQ', strategy: 3, strength: { TAG: 0, _0: 0.6 } });

    const resolved = resolver.resolve([spy, qqq]);
    expect(resolved).toHaveLength(2);
    const symbols = resolved.map((s) => s.symbol).sort();
    expect(symbols).toEqual(['QQQ', 'SPY']);
  });

  it('resolves 3-way conflict for same symbol', () => {
    const s1 = makeSignal({ symbol: 'TSLA', strategy: 0, strength: { TAG: 1, _0: 0.5 } });
    const s2 = makeSignal({ symbol: 'TSLA', strategy: 1, strength: { TAG: 0, _0: 0.9 } });
    const s3 = makeSignal({ symbol: 'TSLA', strategy: 3, strength: { TAG: 0, _0: 0.7 } });

    const resolved = resolver.resolve([s1, s2, s3]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].strategy).toBe(1); // Sector_rotation at 0.9 confidence wins
  });

  it('handles mixed symbols with conflicts', () => {
    const spy1 = makeSignal({ symbol: 'SPY', strategy: 0, side: 0, strength: { TAG: 0, _0: 0.8 } });
    const spy2 = makeSignal({ symbol: 'SPY', strategy: 3, side: 1, strength: { TAG: 0, _0: 0.6 } });
    const aapl = makeSignal({ symbol: 'AAPL', strategy: 1, strength: { TAG: 0, _0: 0.7 } });

    const resolved = resolver.resolve([spy1, spy2, aapl]);
    expect(resolved).toHaveLength(2);

    const spyResolved = resolved.find((s) => s.symbol === 'SPY');
    expect(spyResolved?.strategy).toBe(0); // Higher confidence wins
    expect(spyResolved?.side).toBe(0); // buy
  });
});
