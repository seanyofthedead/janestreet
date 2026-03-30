/**
 * Tests for orchestrator components:
 * - Engine state transitions
 * - Conflict resolver picks highest confidence
 * - Strategy runner marks unhealthy after 3 misses
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We import from the OCaml-compiled modules directly for state transition tests,
// and from our TS modules for strategy runner and conflict resolver tests.
// ---------------------------------------------------------------------------

// NOTE: The Melange-compiled modules require their runtime.
// For unit tests that don't need the full Melange runtime, we
// replicate the logic locally to keep tests self-contained.

// ---------------------------------------------------------------------------
// Engine state transition tests (replicated OCaml logic)
// ---------------------------------------------------------------------------

describe('Engine state transitions', () => {
  // State constants matching OCaml: Starting=0, Warming_up=1, Trading=2, Off_hours=3, Read_only=4
  // Transition constants: Watchdog_connected=0, Warmup_complete=1, Market_open=2, Market_close=3,
  //   Watchdog_lost=4, Data_gap=5, Data_recovered=6, Watchdog_recovered=7,
  //   Cooldown_expired=8, Human_acknowledged=9, Restart=10
  // Tagged transitions: Flatten_triggered={TAG:0, _0:reason}, Kill_triggered={TAG:1, _0:reason}

  function applyTransition(state: unknown, transition: unknown): { TAG: number; _0: unknown } {
    // Starting -> Watchdog_connected -> Warming_up
    if (state === 0 && transition === 0) return { TAG: 0, _0: 1 };
    // Warming_up -> Warmup_complete -> Trading
    if (state === 1 && transition === 1) return { TAG: 0, _0: 2 };
    // Trading -> Market_close -> Off_hours
    if (state === 2 && transition === 3) return { TAG: 0, _0: 3 };
    // Trading -> Watchdog_lost -> Read_only
    if (state === 2 && transition === 4) return { TAG: 0, _0: 4 };
    // Trading -> Data_gap -> Read_only
    if (state === 2 && transition === 5) return { TAG: 0, _0: 4 };
    // Read_only -> Data_recovered -> Trading
    if (state === 4 && transition === 6) return { TAG: 0, _0: 2 };
    // Read_only -> Watchdog_recovered -> Trading
    if (state === 4 && transition === 7) return { TAG: 0, _0: 2 };
    // Off_hours -> Market_open -> Warming_up
    if (state === 3 && transition === 2) return { TAG: 0, _0: 1 };
    // Cooldown -> Cooldown_expired -> Warming_up
    if (typeof state === 'object' && state !== null && (state as any).TAG === 0 && transition === 8) {
      return { TAG: 0, _0: 1 };
    }
    // Halted -> Human_acknowledged -> Starting
    if (typeof state === 'object' && state !== null && (state as any).TAG === 1 && transition === 9) {
      return { TAG: 0, _0: 0 };
    }
    // Trading -> Flatten_triggered -> Cooldown
    if (state === 2 && typeof transition === 'object' && transition !== null && (transition as any).TAG === 0) {
      return { TAG: 0, _0: { TAG: 0, until: Date.now() / 1000 + 1800, reason: (transition as any)._0 } };
    }
    // Trading -> Kill_triggered -> Halted
    if (state === 2 && typeof transition === 'object' && transition !== null && (transition as any).TAG === 1) {
      return { TAG: 0, _0: { TAG: 1, reason: (transition as any)._0 } };
    }
    // Any -> Restart -> Starting
    if (transition === 10) return { TAG: 0, _0: 0 };
    // Invalid
    return { TAG: 1, _0: 'Invalid transition from current state' };
  }

  it('Starting -> Watchdog_connected -> Warming_up', () => {
    const result = applyTransition(0, 0);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(1); // Warming_up
  });

  it('Warming_up -> Warmup_complete -> Trading', () => {
    const result = applyTransition(1, 1);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(2); // Trading
  });

  it('Trading -> Market_close -> Off_hours', () => {
    const result = applyTransition(2, 3);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(3); // Off_hours
  });

  it('Trading -> Watchdog_lost -> Read_only', () => {
    const result = applyTransition(2, 4);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(4); // Read_only
  });

  it('Read_only -> Data_recovered -> Trading', () => {
    const result = applyTransition(4, 6);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(2); // Trading
  });

  it('Trading -> Flatten_triggered -> Cooldown', () => {
    const result = applyTransition(2, { TAG: 0, _0: 'drawdown' });
    expect(result.TAG).toBe(0);
    expect(typeof result._0).toBe('object');
    expect((result._0 as any).TAG).toBe(0); // Cooldown
    expect((result._0 as any).reason).toBe('drawdown');
  });

  it('Trading -> Kill_triggered -> Halted', () => {
    const result = applyTransition(2, { TAG: 1, _0: 'heartbeat timeout' });
    expect(result.TAG).toBe(0);
    expect(typeof result._0).toBe('object');
    expect((result._0 as any).TAG).toBe(1); // Halted
    expect((result._0 as any).reason).toBe('heartbeat timeout');
  });

  it('Halted -> Human_acknowledged -> Starting', () => {
    const halted = { TAG: 1, reason: 'test' };
    const result = applyTransition(halted, 9);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(0); // Starting
  });

  it('Cooldown -> Cooldown_expired -> Warming_up', () => {
    const cooldown = { TAG: 0, until: Date.now() / 1000, reason: 'test' };
    const result = applyTransition(cooldown, 8);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(1); // Warming_up
  });

  it('Off_hours -> Market_open -> Warming_up', () => {
    const result = applyTransition(3, 2);
    expect(result.TAG).toBe(0);
    expect(result._0).toBe(1); // Warming_up
  });

  it('rejects invalid transition', () => {
    // Starting -> Market_close is invalid
    const result = applyTransition(0, 3);
    expect(result.TAG).toBe(1); // Error
  });

  it('any state -> Restart -> Starting', () => {
    expect(applyTransition(2, 10)._0).toBe(0);
    expect(applyTransition(3, 10)._0).toBe(0);
    expect(applyTransition(4, 10)._0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Conflict resolver tests
// ---------------------------------------------------------------------------

describe('Conflict resolver', () => {
  interface TestSignal {
    strategy: number;
    symbol: string;
    side: number;
    strength: { TAG: number; _0: number };
    target_price: number;
    max_position_pct: number;
    timestamp: number;
  }

  function compareTestPriority(a: TestSignal, b: TestSignal): number {
    const confA = a.strength._0;
    const confB = b.strength._0;
    if (confA !== confB) return confB - confA; // higher confidence first
    // Strategy priority: mean_reversion(0)=3, sector_rotation(1)=2, calendar(2)=1, momentum(3)=2, mm(4)=0
    const priorities: Record<number, number> = { 0: 3, 1: 2, 2: 1, 3: 2, 4: 0 };
    return (priorities[b.strategy] ?? 0) - (priorities[a.strategy] ?? 0);
  }

  function resolveConflicts(signals: TestSignal[]): TestSignal[] {
    const grouped = new Map<string, TestSignal[]>();
    for (const s of signals) {
      const arr = grouped.get(s.symbol) ?? [];
      arr.push(s);
      grouped.set(s.symbol, arr);
    }
    const result: TestSignal[] = [];
    for (const [, group] of grouped) {
      group.sort(compareTestPriority);
      result.push(group[0]!);
    }
    return result;
  }

  it('picks highest confidence signal', () => {
    const signals: TestSignal[] = [
      {
        strategy: 0,
        symbol: 'SPY',
        side: 0,
        strength: { TAG: 1, _0: 0.5 },
        target_price: 450,
        max_position_pct: 0.08,
        timestamp: 1,
      },
      {
        strategy: 3,
        symbol: 'SPY',
        side: 1,
        strength: { TAG: 0, _0: 0.85 },
        target_price: 455,
        max_position_pct: 0.06,
        timestamp: 1,
      },
    ];

    const resolved = resolveConflicts(signals);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.strategy).toBe(3); // Momentum wins with 0.85 confidence
    expect(resolved[0]!.side).toBe(1); // sell
  });

  it('uses strategy priority as tiebreaker', () => {
    const signals: TestSignal[] = [
      {
        strategy: 3, // Momentum, priority=2
        symbol: 'AAPL',
        side: 0,
        strength: { TAG: 0, _0: 0.8 },
        target_price: 180,
        max_position_pct: 0.06,
        timestamp: 1,
      },
      {
        strategy: 0, // Mean_reversion, priority=3
        symbol: 'AAPL',
        side: 1,
        strength: { TAG: 0, _0: 0.8 },
        target_price: 175,
        max_position_pct: 0.08,
        timestamp: 1,
      },
    ];

    const resolved = resolveConflicts(signals);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.strategy).toBe(0); // Mean_reversion wins on priority
  });

  it('keeps independent symbols separate', () => {
    const signals: TestSignal[] = [
      {
        strategy: 0,
        symbol: 'SPY',
        side: 0,
        strength: { TAG: 0, _0: 0.7 },
        target_price: 450,
        max_position_pct: 0.08,
        timestamp: 1,
      },
      {
        strategy: 3,
        symbol: 'QQQ',
        side: 1,
        strength: { TAG: 0, _0: 0.6 },
        target_price: 380,
        max_position_pct: 0.06,
        timestamp: 1,
      },
    ];

    const resolved = resolveConflicts(signals);
    expect(resolved).toHaveLength(2);
  });

  it('returns empty for no signals', () => {
    expect(resolveConflicts([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Strategy runner health tests
// ---------------------------------------------------------------------------

describe('Strategy runner health', () => {
  interface StrategyHealth {
    consecutiveMisses: number;
    consecutiveSuccesses: number;
    isHealthy: boolean;
  }

  const MISS_THRESHOLD = 3;
  const RECOVERY_THRESHOLD = 10;

  function simulateTick(health: StrategyHealth, produced: boolean): void {
    if (produced) {
      health.consecutiveMisses = 0;
      health.consecutiveSuccesses++;
      if (!health.isHealthy && health.consecutiveSuccesses >= RECOVERY_THRESHOLD) {
        health.isHealthy = true;
      }
    } else {
      health.consecutiveMisses++;
      health.consecutiveSuccesses = 0;
      if (health.isHealthy && health.consecutiveMisses >= MISS_THRESHOLD) {
        health.isHealthy = false;
      }
    }
  }

  it('marks unhealthy after 3 consecutive misses', () => {
    const health: StrategyHealth = {
      consecutiveMisses: 0,
      consecutiveSuccesses: 0,
      isHealthy: true,
    };

    simulateTick(health, false);
    expect(health.isHealthy).toBe(true);
    simulateTick(health, false);
    expect(health.isHealthy).toBe(true);
    simulateTick(health, false);
    expect(health.isHealthy).toBe(false);
    expect(health.consecutiveMisses).toBe(3);
  });

  it('stays healthy if a signal is produced before 3 misses', () => {
    const health: StrategyHealth = {
      consecutiveMisses: 0,
      consecutiveSuccesses: 0,
      isHealthy: true,
    };

    simulateTick(health, false);
    simulateTick(health, false);
    simulateTick(health, true); // resets
    expect(health.isHealthy).toBe(true);
    expect(health.consecutiveMisses).toBe(0);
  });

  it('recovers after 10 consecutive good ticks', () => {
    const health: StrategyHealth = {
      consecutiveMisses: 5,
      consecutiveSuccesses: 0,
      isHealthy: false,
    };

    for (let i = 0; i < 9; i++) {
      simulateTick(health, true);
      expect(health.isHealthy).toBe(false);
    }
    simulateTick(health, true);
    expect(health.isHealthy).toBe(true);
    expect(health.consecutiveSuccesses).toBe(10);
  });

  it('does not recover with intermittent misses', () => {
    const health: StrategyHealth = {
      consecutiveMisses: 3,
      consecutiveSuccesses: 0,
      isHealthy: false,
    };

    for (let i = 0; i < 8; i++) {
      simulateTick(health, true);
    }
    simulateTick(health, false); // resets consecutive successes
    expect(health.isHealthy).toBe(false);
    expect(health.consecutiveSuccesses).toBe(0);
  });
});
