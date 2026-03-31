/**
 * Tests for MockOrderManager.
 * Verifies order submission, fill simulation, and event emission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { MockOrderManager } from '../../src/simulation/mock-order-manager.js';
import { SimulationController } from '../../src/simulation/controller.js';
import type { EngineConfig } from '../../src/config.js';
import type { OrderParams } from '../../src/alpaca/order-manager.js';
import type { ReplayBar } from '../../src/simulation/controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): EngineConfig {
  return {
    alpacaApiKey: 'test-key',
    alpacaSecretKey: 'test-secret',
    alpacaBaseUrl: 'https://paper-api.alpaca.markets',
    localApiSecret: 'local-secret',
    enginePort: 3001,
    watchdogPort: 3002,
    dashboardPort: 3000,
    dynamoDbEndpoint: undefined,
    tickIntervalMs: 1000,
    heartbeatIntervalMs: 5000,
    configPollIntervalMs: 60000,
    simulationMode: true,
    simulationDate: '2026-03-27',
    simulationSpeed: 600,
  };
}

function makeBars(count: number, startPrice: number, startTime: number): ReplayBar[] {
  return Array.from({ length: count }, (_, i) => ({
    o: startPrice + i * 0.1,
    h: startPrice + i * 0.1 + 0.5,
    l: startPrice + i * 0.1 - 0.5,
    c: startPrice + i * 0.1 + 0.2,
    v: 100000,
    timestamp: startTime + i * 60000,
  }));
}

function makeOrderParams(overrides: Partial<OrderParams> = {}): OrderParams {
  return {
    strategy: 'mean_reversion',
    symbol: 'SPY',
    side: 'buy',
    limitPrice: 450,
    notional: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MockOrderManager — order submission', () => {
  let emitter: EventEmitter;
  let simController: SimulationController;
  let mockOm: MockOrderManager;

  beforeEach(() => {
    emitter = new EventEmitter();
    simController = new SimulationController(emitter, makeConfig());
    mockOm = new MockOrderManager(simController);
  });

  afterEach(() => {
    simController.stopReplay();
  });

  it('submitOrder returns valid AlpacaOrder', async () => {
    const order = await mockOm.submitOrder(makeOrderParams());

    expect(order.id).toMatch(/^sim-/);
    expect(order.client_order_id).toContain('mean_reversion');
    expect(order.client_order_id).toContain('SPY');
    expect(order.symbol).toBe('SPY');
    expect(order.side).toBe('buy');
    expect(order.status).toBe('new');
    expect(order.type).toBe('limit');
    expect(order.order_type).toBe('limit');
    expect(order.time_in_force).toBe('day');
    expect(order.created_at).toBeDefined();
    expect(order.filled_qty).toBe(0);
  });

  it('generates unique client_order_ids', async () => {
    const o1 = await mockOm.submitOrder(makeOrderParams());
    const o2 = await mockOm.submitOrder(makeOrderParams());
    const o3 = await mockOm.submitOrder(makeOrderParams());

    const ids = new Set([o1.client_order_id, o2.client_order_id, o3.client_order_id]);
    expect(ids.size).toBe(3);
  });

  it('calculates qty from notional and limitPrice', async () => {
    const order = await mockOm.submitOrder(makeOrderParams({ notional: 450, limitPrice: 150 }));
    expect(order.qty).toBe(3); // 450 / 150
  });

  it('tracks orders in trackedOrders', async () => {
    const order = await mockOm.submitOrder(makeOrderParams());
    const tracked = mockOm.getTrackedOrder(order.client_order_id);
    expect(tracked).toBeDefined();
    expect(tracked?.symbol).toBe('SPY');
  });

  it('emits orderUpdate event on submission', async () => {
    const handler = vi.fn();
    mockOm.on('orderUpdate', handler);

    await mockOm.submitOrder(makeOrderParams());

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0][0];
    expect(event.type).toBe('new');
    expect(event.clientOrderId).toBeDefined();
  });
});

describe('MockOrderManager — fill simulation', () => {
  let emitter: EventEmitter;
  let simController: SimulationController;
  let mockOm: MockOrderManager;

  beforeEach(() => {
    emitter = new EventEmitter();
    simController = new SimulationController(emitter, makeConfig());
    mockOm = new MockOrderManager(simController);
  });

  afterEach(() => {
    simController.stopReplay();
  });

  it('fills pending buy orders on next bar with positive slippage', async () => {
    // Load bars: first bar opens at 450
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(3, 450, 1000));
    simController.loadDataDirect(data);

    // Submit a buy order
    const order = await mockOm.submitOrder(makeOrderParams({ side: 'buy', symbol: 'SPY' }));
    expect(order.status).toBe('new');

    // Capture fill events
    const fills: unknown[] = [];
    mockOm.on('orderUpdate', (event) => {
      if (event.type === 'fill') fills.push(event);
    });

    // Start replay — first bar triggers fills
    simController.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 200));
    simController.stopReplay();

    expect(fills.length).toBe(1);
    const fill = fills[0] as any;
    expect(fill.type).toBe('fill');
    expect(fill.fillPrice).toBeGreaterThan(450); // slippage on buy
  });

  it('fills pending sell orders with negative slippage', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(3, 450, 1000));
    simController.loadDataDirect(data);

    await mockOm.submitOrder(makeOrderParams({ side: 'sell', symbol: 'SPY' }));

    const fills: unknown[] = [];
    mockOm.on('orderUpdate', (event) => {
      if (event.type === 'fill') fills.push(event);
    });

    simController.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 200));
    simController.stopReplay();

    const fill = fills[0] as any;
    expect(fill.fillPrice).toBeLessThan(450); // slippage on sell
  });

  it('does not fill orders for other symbols', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('QQQ', makeBars(3, 380, 1000));
    simController.loadDataDirect(data);

    // Submit order for SPY, but only QQQ bars are in replay
    await mockOm.submitOrder(makeOrderParams({ symbol: 'SPY' }));

    const fills: unknown[] = [];
    mockOm.on('orderUpdate', (event) => {
      if (event.type === 'fill') fills.push(event);
    });

    simController.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 500));
    simController.stopReplay();

    expect(fills).toHaveLength(0);
    expect(mockOm.getPendingCount()).toBe(1); // still pending
  });

  it('updates order status to filled after fill', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(2, 450, 1000));
    simController.loadDataDirect(data);

    const order = await mockOm.submitOrder(makeOrderParams({ symbol: 'SPY' }));

    simController.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 200));
    simController.stopReplay();

    const tracked = mockOm.getTrackedOrder(order.client_order_id);
    expect(tracked?.status).toBe('filled');
    expect(tracked?.filled_avg_price).toBeGreaterThan(0);
  });
});

describe('MockOrderManager — interface stubs', () => {
  let emitter: EventEmitter;
  let simController: SimulationController;
  let mockOm: MockOrderManager;

  beforeEach(() => {
    emitter = new EventEmitter();
    simController = new SimulationController(emitter, makeConfig());
    mockOm = new MockOrderManager(simController);
  });

  it('connectTradeUpdates is callable', () => {
    expect(() => mockOm.connectTradeUpdates()).not.toThrow();
  });

  it('disconnectTradeUpdates is callable', () => {
    expect(() => mockOm.disconnectTradeUpdates()).not.toThrow();
  });

  it('killSwitchCancelAll cancels pending orders', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(2, 450, 1000));
    simController.loadDataDirect(data);

    await mockOm.submitOrder(makeOrderParams());
    expect(mockOm.getPendingCount()).toBe(1);

    await mockOm.killSwitchCancelAll();
    expect(mockOm.getPendingCount()).toBe(0);
  });

  it('killSwitchCloseAll is callable', async () => {
    await expect(mockOm.killSwitchCloseAll()).resolves.toBeUndefined();
  });

  it('getAllTrackedOrders returns copy of orders', async () => {
    await mockOm.submitOrder(makeOrderParams());
    const all = mockOm.getAllTrackedOrders();
    expect(all.size).toBe(1);
  });
});
