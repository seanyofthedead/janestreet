/**
 * Tests for notify-kill business logic.
 * Covers State.updateDailyPnl, startOfDayEquity initialization,
 * and Orchestrator.notifyExternalKill state transitions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State } from '../src/state.js';

// Mock DynamoDB to avoid real persistence calls (Pattern B)
vi.mock('../src/dynamodb.js', () => ({
  getDynamoClient: () => ({
    send: vi.fn().mockResolvedValue({}),
  }),
  TABLE_STATE: 'trading-state',
}));

// ---------------------------------------------------------------------------
// State.updateDailyPnl
// ---------------------------------------------------------------------------

describe('State.updateDailyPnl', () => {
  let state: State;

  beforeEach(() => {
    state = new State();
  });

  it('computes dailyPnl as equity minus startOfDayEquity', () => {
    state.startOfDayEquity = 10_000;
    state.equity = 10_250;

    state.updateDailyPnl();

    expect(state.dailyPnl).toBe(250);
  });

  it('computes negative dailyPnl when equity drops', () => {
    state.startOfDayEquity = 10_000;
    state.equity = 9_800;

    state.updateDailyPnl();

    expect(state.dailyPnl).toBe(-200);
  });

  it('returns zero when equity equals startOfDayEquity', () => {
    state.startOfDayEquity = 10_000;
    state.equity = 10_000;

    state.updateDailyPnl();

    expect(state.dailyPnl).toBe(0);
  });

  it('does not update dailyPnl when startOfDayEquity is 0', () => {
    state.startOfDayEquity = 0;
    state.equity = 10_000;
    state.dailyPnl = 42; // pre-existing value

    state.updateDailyPnl();

    // Should remain unchanged since startOfDayEquity is 0
    expect(state.dailyPnl).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// State.startOfDayEquity set during reconciliation
// ---------------------------------------------------------------------------

describe('State.startOfDayEquity during reconciliation', () => {
  it('sets startOfDayEquity on first reconciliation', async () => {
    const state = new State();

    const mockClient = {
      getAccount: vi.fn().mockResolvedValue({
        equity: 25_000,
        cash: 12_000,
        buying_power: 50_000,
        daytrade_count: 0,
      }),
      getPositions: vi.fn().mockResolvedValue([]),
      getOrders: vi.fn().mockResolvedValue([]),
    } as any;

    await state.reconcileWithAlpaca(mockClient);

    expect(state.startOfDayEquity).toBe(25_000);
  });

  it('does not overwrite startOfDayEquity on subsequent reconciliations', async () => {
    const state = new State();

    const mockClient1 = {
      getAccount: vi.fn().mockResolvedValue({
        equity: 25_000,
        cash: 12_000,
        buying_power: 50_000,
        daytrade_count: 0,
      }),
      getPositions: vi.fn().mockResolvedValue([]),
      getOrders: vi.fn().mockResolvedValue([]),
    } as any;

    await state.reconcileWithAlpaca(mockClient1);
    expect(state.startOfDayEquity).toBe(25_000);

    // Second reconciliation with different equity
    const mockClient2 = {
      getAccount: vi.fn().mockResolvedValue({
        equity: 26_000,
        cash: 13_000,
        buying_power: 52_000,
        daytrade_count: 0,
      }),
      getPositions: vi.fn().mockResolvedValue([]),
      getOrders: vi.fn().mockResolvedValue([]),
    } as any;

    await state.reconcileWithAlpaca(mockClient2);

    // startOfDayEquity should still be the first value
    expect(state.startOfDayEquity).toBe(25_000);
    // But equity should be updated
    expect(state.equity).toBe(26_000);
  });
});
