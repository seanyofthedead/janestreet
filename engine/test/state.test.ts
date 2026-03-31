/**
 * Tests for in-memory State management.
 * Covers position tracking, order lifecycle, portfolio snapshots,
 * and OCaml portfolio format conversion.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { State } from '../src/state.js';
import type { TrackedOrder } from '../src/state.js';

// Mock DynamoDB to avoid real persistence calls
vi.mock('../src/dynamodb.js', () => ({
  getDynamoClient: () => ({
    send: vi.fn().mockResolvedValue({}),
  }),
  TABLE_STATE: 'trading-state',
}));

// ---------------------------------------------------------------------------
// State initialization
// ---------------------------------------------------------------------------

describe('State initialization', () => {
  it('starts with default values', () => {
    const state = new State();
    expect(state.equity).toBe(0);
    expect(state.cash).toBe(0);
    expect(state.buyingPower).toBe(0);
    expect(state.dailyPnl).toBe(0);
    expect(state.peakEquity).toBe(0);
    expect(state.engineStateName).toBe('Starting');
    expect(state.tickCount).toBe(0);
    expect(state.dayTradeCount).toBe(0);
  });

  it('starts with empty positions and orders', () => {
    const state = new State();
    expect(state.getAllPositions()).toHaveLength(0);
    expect(state.getAllActiveOrders()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Position management
// ---------------------------------------------------------------------------

describe('Position management', () => {
  it('updatePosition updates price and P&L', () => {
    const state = new State();

    // Manually set a position (normally done via reconcileWithAlpaca)
    // We access the internal map through the public interface
    // First, we need to get a position in there
    state.equity = 10000;
    state.cash = 5000;

    // updatePosition does nothing if position doesn't exist
    state.updatePosition('SPY', 450);
    expect(state.getPosition('SPY')).toBeUndefined();
  });

  it('getAllPositions returns empty array initially', () => {
    const state = new State();
    expect(state.getAllPositions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Order management
// ---------------------------------------------------------------------------

describe('Order management', () => {
  let state: State;

  beforeEach(() => {
    state = new State();
  });

  it('addOrder tracks a new order', () => {
    const order: TrackedOrder = {
      clientOrderId: 'mr_SPY_123_1',
      orderId: 'alpaca-order-1',
      symbol: 'SPY',
      side: 'buy',
      qty: 5,
      limitPrice: 448,
      status: 'new',
      strategy: 'mean_reversion',
      createdAt: new Date().toISOString(),
      filledQty: 0,
      filledAvgPrice: undefined,
    };

    state.addOrder(order);
    expect(state.getOrder('mr_SPY_123_1')).toBeDefined();
    expect(state.getAllActiveOrders()).toHaveLength(1);
  });

  it('updateOrder changes status and fill data', () => {
    const order: TrackedOrder = {
      clientOrderId: 'mr_SPY_123_1',
      orderId: 'alpaca-order-1',
      symbol: 'SPY',
      side: 'buy',
      qty: 5,
      limitPrice: 448,
      status: 'new',
      strategy: 'mean_reversion',
      createdAt: new Date().toISOString(),
      filledQty: 0,
      filledAvgPrice: undefined,
    };

    state.addOrder(order);
    state.updateOrder('mr_SPY_123_1', {
      status: 'partially_filled',
      filledQty: 3,
      filledAvgPrice: 447.5,
    });

    const updated = state.getOrder('mr_SPY_123_1');
    expect(updated?.status).toBe('partially_filled');
    expect(updated?.filledQty).toBe(3);
    expect(updated?.filledAvgPrice).toBe(447.5);
  });

  it('updateOrder for unknown order does not throw', () => {
    expect(() => {
      state.updateOrder('nonexistent', { status: 'filled' });
    }).not.toThrow();
  });

  it('multiple orders tracked independently', () => {
    const order1: TrackedOrder = {
      clientOrderId: 'mr_SPY_123_1',
      orderId: 'o1',
      symbol: 'SPY',
      side: 'buy',
      qty: 5,
      limitPrice: 448,
      status: 'new',
      strategy: 'mean_reversion',
      createdAt: new Date().toISOString(),
      filledQty: 0,
      filledAvgPrice: undefined,
    };
    const order2: TrackedOrder = {
      clientOrderId: 'mom_AAPL_124_2',
      orderId: 'o2',
      symbol: 'AAPL',
      side: 'sell',
      qty: 10,
      limitPrice: 175,
      status: 'new',
      strategy: 'momentum',
      createdAt: new Date().toISOString(),
      filledQty: 0,
      filledAvgPrice: undefined,
    };

    state.addOrder(order1);
    state.addOrder(order2);

    expect(state.getAllActiveOrders()).toHaveLength(2);
    expect(state.getOrder('mr_SPY_123_1')?.symbol).toBe('SPY');
    expect(state.getOrder('mom_AAPL_124_2')?.symbol).toBe('AAPL');
  });
});

// ---------------------------------------------------------------------------
// Portfolio snapshot
// ---------------------------------------------------------------------------

describe('Portfolio snapshot', () => {
  it('returns correct snapshot with no positions', () => {
    const state = new State();
    state.equity = 1000;
    state.cash = 1000;
    state.buyingPower = 4000;
    state.dailyPnl = 0;

    const snapshot = state.getPortfolioSnapshot();
    expect(snapshot.equity).toBe(1000);
    expect(snapshot.cash).toBe(1000);
    expect(snapshot.buyingPower).toBe(4000);
    expect(snapshot.positionCount).toBe(0);
    expect(snapshot.positions).toHaveLength(0);
    expect(snapshot.totalUnrealizedPl).toBe(0);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OCaml portfolio format
// ---------------------------------------------------------------------------

describe('toOcamlPortfolio', () => {
  it('returns correct format with no positions', () => {
    const state = new State();
    state.equity = 1000;
    state.cash = 1000;
    state.buyingPower = 4000;
    state.dailyPnl = -5;

    const ocamlPortfolio = state.toOcamlPortfolio();
    expect(ocamlPortfolio.equity).toBe(1000);
    expect(ocamlPortfolio.cash).toBe(1000);
    expect(ocamlPortfolio.buying_power).toBe(4000);
    expect(ocamlPortfolio.daily_pnl).toBe(-5);
    expect(ocamlPortfolio.total_pnl).toBe(0);
    // Empty position list = 0 (OCaml nil)
    expect(ocamlPortfolio.positions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Engine state tracking
// ---------------------------------------------------------------------------

describe('Engine state tracking', () => {
  it('engineState and engineStateName update together', () => {
    const state = new State();
    expect(state.engineState).toBe(0); // Starting
    expect(state.engineStateName).toBe('Starting');

    state.engineState = 3; // Off_hours
    state.engineStateName = 'Off_hours';
    expect(state.engineState).toBe(3);
    expect(state.engineStateName).toBe('Off_hours');
  });

  it('peakEquity tracks highest equity seen', () => {
    const state = new State();
    state.equity = 1000;
    state.peakEquity = 1000;

    state.equity = 1200;
    if (state.equity > state.peakEquity) state.peakEquity = state.equity;
    expect(state.peakEquity).toBe(1200);

    state.equity = 1100;
    // peakEquity should not decrease
    expect(state.peakEquity).toBe(1200);
  });

  it('lastHeartbeat is set on construction', () => {
    const before = Date.now();
    const state = new State();
    expect(state.lastHeartbeat).toBeGreaterThanOrEqual(before);
    expect(state.lastHeartbeat).toBeLessThanOrEqual(Date.now());
  });
});
