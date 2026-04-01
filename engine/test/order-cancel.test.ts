/**
 * Tests for order cancellation via OrderManager.
 * Covers: valid cancel, unknown order ID, terminal-state order.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderManager, resetNonce } from '../src/alpaca/order-manager.js';
import type { AlpacaOrder } from '../src/alpaca/types.js';

// Mock DynamoDB to avoid real persistence calls
vi.mock('../src/dynamodb.js', () => ({
  getDynamoClient: () => ({
    send: vi.fn().mockResolvedValue({}),
  }),
  TABLE_STATE: 'trading-state',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlpacaOrder(overrides: Partial<AlpacaOrder> = {}): AlpacaOrder {
  return {
    id: 'alpaca-uuid-123',
    client_order_id: 'test_SPY_1234_1',
    created_at: '2026-03-31T10:00:00Z',
    asset_id: 'asset-1',
    symbol: 'SPY',
    qty: 10,
    filled_qty: 0,
    order_class: 'simple',
    order_type: 'limit',
    type: 'limit',
    side: 'buy',
    time_in_force: 'day',
    limit_price: 450.0,
    status: 'new',
    extended_hours: false,
    ...overrides,
  };
}

function makeMockClient() {
  return {
    cancelOrder: vi.fn().mockResolvedValue({}),
    getAsset: vi.fn(),
    getOrders: vi.fn().mockResolvedValue([]),
    sdk: {
      createOrder: vi.fn(),
      cancelAllOrders: vi.fn(),
      closeAllPositions: vi.fn(),
    },
  } as any;
}

function makeMockConfig() {
  return {
    alpacaApiKey: 'test-key',
    alpacaSecretKey: 'test-secret',
    alpacaBaseUrl: 'https://paper-api.alpaca.markets',
    tickIntervalMs: 5000,
    heartbeatIntervalMs: 30000,
    simulationMode: false,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrderManager.cancelOrder', () => {
  let orderManager: OrderManager;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    resetNonce();
    mockClient = makeMockClient();
    orderManager = new OrderManager(makeMockConfig(), mockClient);
  });

  it('cancels a tracked order successfully', async () => {
    // Manually add a tracked order via the internal map
    const order = makeAlpacaOrder({
      id: 'alpaca-uuid-abc',
      client_order_id: 'meanrev_SPY_1000_1',
      status: 'new',
    });
    // Access the private trackedOrders map for test setup
    (orderManager as any).trackedOrders.set('meanrev_SPY_1000_1', order);

    const result = await orderManager.cancelOrder('meanrev_SPY_1000_1');

    expect(result).toEqual({
      clientOrderId: 'meanrev_SPY_1000_1',
      alpacaOrderId: 'alpaca-uuid-abc',
      status: 'cancel_requested',
    });
    expect(mockClient.cancelOrder).toHaveBeenCalledWith('alpaca-uuid-abc');
  });

  it('throws when order ID is not found', async () => {
    await expect(orderManager.cancelOrder('nonexistent_order_id'))
      .rejects.toThrow('Order not found: nonexistent_order_id');

    expect(mockClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('throws when order is in terminal state (filled)', async () => {
    const order = makeAlpacaOrder({
      client_order_id: 'filled_order',
      status: 'filled',
    });
    (orderManager as any).trackedOrders.set('filled_order', order);

    await expect(orderManager.cancelOrder('filled_order'))
      .rejects.toThrow('terminal state: filled');

    expect(mockClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('throws when order is in terminal state (canceled)', async () => {
    const order = makeAlpacaOrder({
      client_order_id: 'canceled_order',
      status: 'canceled',
    });
    (orderManager as any).trackedOrders.set('canceled_order', order);

    await expect(orderManager.cancelOrder('canceled_order'))
      .rejects.toThrow('terminal state: canceled');

    expect(mockClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('throws when order is in terminal state (expired)', async () => {
    const order = makeAlpacaOrder({
      client_order_id: 'expired_order',
      status: 'expired',
    });
    (orderManager as any).trackedOrders.set('expired_order', order);

    await expect(orderManager.cancelOrder('expired_order'))
      .rejects.toThrow('terminal state: expired');

    expect(mockClient.cancelOrder).not.toHaveBeenCalled();
  });

  it('allows cancel for partially filled orders', async () => {
    const order = makeAlpacaOrder({
      id: 'alpaca-uuid-partial',
      client_order_id: 'partial_order',
      status: 'partially_filled',
      filled_qty: 5,
    });
    (orderManager as any).trackedOrders.set('partial_order', order);

    const result = await orderManager.cancelOrder('partial_order');

    expect(result.status).toBe('cancel_requested');
    expect(mockClient.cancelOrder).toHaveBeenCalledWith('alpaca-uuid-partial');
  });
});
