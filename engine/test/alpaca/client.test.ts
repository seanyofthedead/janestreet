/**
 * Unit tests for Alpaca integration layer.
 * Tests config loading, Zod schema validation, rate limiter, and order ID format.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AlpacaAccountSchema,
  AlpacaPositionSchema,
  AlpacaOrderSchema,
  TradeUpdateSchema,
  BarSchema,
  QuoteSchema,
  TradeSchema,
  AlpacaAssetSchema,
} from '../../src/alpaca/types.js';
import { TokenBucketRateLimiter } from '../../src/alpaca/client.js';
import { makeClientOrderId, resetNonce } from '../../src/alpaca/order-manager.js';
import { loadConfig, resetConfig } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('Config', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
    vi.unstubAllEnvs();
  });

  it('loads config from environment variables', () => {
    vi.stubEnv('ALPACA_API_KEY', 'test-key');
    vi.stubEnv('ALPACA_SECRET_KEY', 'test-secret');
    vi.stubEnv('LOCAL_API_SECRET', 'local-secret');
    vi.stubEnv('ENGINE_PORT', '4001');

    const config = loadConfig();
    expect(config.alpacaApiKey).toBe('test-key');
    expect(config.alpacaSecretKey).toBe('test-secret');
    expect(config.localApiSecret).toBe('local-secret');
    expect(config.enginePort).toBe(4001);
  });

  it('uses default values for optional fields', () => {
    vi.stubEnv('ALPACA_API_KEY', 'test-key');
    vi.stubEnv('ALPACA_SECRET_KEY', 'test-secret');
    vi.stubEnv('LOCAL_API_SECRET', 'local-secret');

    const config = loadConfig();
    expect(config.alpacaBaseUrl).toBe('https://paper-api.alpaca.markets');
    expect(config.enginePort).toBe(3001);
    expect(config.watchdogPort).toBe(3002);
    expect(config.dashboardPort).toBe(3000);
    expect(config.tickIntervalMs).toBe(1000);
    expect(config.heartbeatIntervalMs).toBe(5000);
    expect(config.configPollIntervalMs).toBe(60000);
    expect(config.dynamoDbEndpoint).toBeUndefined();
  });

  it('throws on missing required env vars', () => {
    vi.stubEnv('ALPACA_API_KEY', '');
    expect(() => loadConfig()).toThrow('Missing required environment variable');
  });
});

// ---------------------------------------------------------------------------
// Zod Schemas — valid data
// ---------------------------------------------------------------------------

describe('Zod Schemas — valid data', () => {
  it('validates AlpacaAccount', () => {
    const data = {
      id: 'acc-123',
      account_number: '123456',
      status: 'ACTIVE',
      currency: 'USD',
      equity: '10500.50',
      buying_power: '21000.00',
      cash: '5000.00',
      portfolio_value: '10500.50',
      pattern_day_trader: false,
      trading_blocked: false,
      transfers_blocked: false,
      account_blocked: false,
      daytrade_count: 0,
      last_equity: '10400.00',
      long_market_value: '5500.50',
      short_market_value: '0',
      initial_margin: '2750.25',
      maintenance_margin: '1650.15',
      daytrading_buying_power: '42000.00',
      regt_buying_power: '21000.00',
    };

    const result = AlpacaAccountSchema.parse(data);
    expect(result.equity).toBe(10500.50);
    expect(result.buying_power).toBe(21000.0);
    expect(result.cash).toBe(5000.0);
  });

  it('validates AlpacaPosition', () => {
    const data = {
      asset_id: 'asset-1',
      symbol: 'AAPL',
      exchange: 'NASDAQ',
      asset_class: 'us_equity',
      avg_entry_price: '150.00',
      qty: '10',
      side: 'long',
      market_value: '1550.00',
      cost_basis: '1500.00',
      unrealized_pl: '50.00',
      unrealized_plpc: '0.0333',
      unrealized_intraday_pl: '25.00',
      unrealized_intraday_plpc: '0.0164',
      current_price: '155.00',
      lastday_price: '152.50',
      change_today: '0.0164',
    };

    const result = AlpacaPositionSchema.parse(data);
    expect(result.symbol).toBe('AAPL');
    expect(result.qty).toBe(10);
    expect(result.avg_entry_price).toBe(150.0);
    expect(result.unrealized_pl).toBe(50.0);
  });

  it('validates AlpacaOrder', () => {
    const data = {
      id: 'order-1',
      client_order_id: 'mean_reversion_AAPL_1700000000_1',
      created_at: '2024-01-01T10:00:00Z',
      asset_id: 'asset-1',
      symbol: 'AAPL',
      notional: null,
      qty: '5',
      filled_qty: '0',
      filled_avg_price: null,
      order_type: 'limit',
      type: 'limit',
      side: 'buy',
      time_in_force: 'day',
      limit_price: '148.50',
      stop_price: null,
      status: 'new',
    };

    const result = AlpacaOrderSchema.parse(data);
    expect(result.client_order_id).toBe('mean_reversion_AAPL_1700000000_1');
    expect(result.qty).toBe(5);
    expect(result.limit_price).toBe(148.50);
    expect(result.filled_qty).toBe(0);
  });

  it('validates TradeUpdate', () => {
    const data = {
      event: 'fill',
      order: {
        id: 'order-1',
        client_order_id: 'test_AAPL_1700000000_1',
        created_at: '2024-01-01T10:00:00Z',
        asset_id: 'asset-1',
        symbol: 'AAPL',
        qty: '5',
        filled_qty: '5',
        filled_avg_price: '149.00',
        order_type: 'limit',
        type: 'limit',
        side: 'buy',
        time_in_force: 'day',
        limit_price: '150.00',
        status: 'filled',
      },
      timestamp: '2024-01-01T10:00:05Z',
      price: '149.00',
      qty: '5',
      position_qty: '5',
    };

    const result = TradeUpdateSchema.parse(data);
    expect(result.event).toBe('fill');
    expect(result.order.filled_avg_price).toBe(149.0);
  });

  it('validates Bar', () => {
    const data = { t: '2024-01-01T10:00:00Z', o: 150.0, h: 152.0, l: 149.0, c: 151.0, v: 1000000 };
    const result = BarSchema.parse(data);
    expect(result.c).toBe(151.0);
    expect(result.v).toBe(1000000);
  });

  it('validates Quote', () => {
    const data = { t: '2024-01-01T10:00:00Z', bp: 150.0, bs: 100, ap: 150.05, as: 200 };
    const result = QuoteSchema.parse(data);
    expect(result.bp).toBe(150.0);
    expect(result.ap).toBe(150.05);
  });

  it('validates Trade', () => {
    const data = { t: '2024-01-01T10:00:00Z', p: 150.02, s: 50 };
    const result = TradeSchema.parse(data);
    expect(result.p).toBe(150.02);
    expect(result.s).toBe(50);
  });

  it('validates AlpacaAsset', () => {
    const data = {
      id: 'asset-1',
      class: 'us_equity',
      exchange: 'NASDAQ',
      symbol: 'AAPL',
      name: 'Apple Inc.',
      status: 'active',
      tradable: true,
      marginable: true,
      shortable: true,
      easy_to_borrow: true,
      fractionable: true,
    };

    const result = AlpacaAssetSchema.parse(data);
    expect(result.fractionable).toBe(true);
    expect(result.symbol).toBe('AAPL');
  });
});

// ---------------------------------------------------------------------------
// Zod Schemas — malformed data rejection
// ---------------------------------------------------------------------------

describe('Zod Schemas — malformed data', () => {
  it('rejects AlpacaAccount with missing required fields', () => {
    const data = { id: 'acc-123' }; // missing most fields
    expect(() => AlpacaAccountSchema.parse(data)).toThrow();
  });

  it('rejects AlpacaPosition with invalid side', () => {
    const data = {
      asset_id: 'asset-1',
      symbol: 'AAPL',
      exchange: 'NASDAQ',
      asset_class: 'us_equity',
      avg_entry_price: '150.00',
      qty: '10',
      side: 'invalid_side',
      market_value: '1550.00',
      cost_basis: '1500.00',
      unrealized_pl: '50.00',
      unrealized_plpc: '0.03',
      unrealized_intraday_pl: '25.00',
      unrealized_intraday_plpc: '0.01',
      current_price: '155.00',
      lastday_price: '152.50',
      change_today: '0.01',
    };
    expect(() => AlpacaPositionSchema.parse(data)).toThrow();
  });

  it('rejects AlpacaOrder with invalid status', () => {
    const data = {
      id: 'order-1',
      client_order_id: 'test',
      created_at: '2024-01-01',
      asset_id: 'asset-1',
      symbol: 'AAPL',
      qty: '1',
      filled_qty: '0',
      order_type: 'limit',
      type: 'limit',
      side: 'buy',
      time_in_force: 'day',
      status: 'TOTALLY_INVALID',
    };
    expect(() => AlpacaOrderSchema.parse(data)).toThrow();
  });

  it('rejects TradeUpdate with invalid event type', () => {
    const data = {
      event: 'not_a_real_event',
      order: { id: 'x' },
    };
    expect(() => TradeUpdateSchema.parse(data)).toThrow();
  });

  it('rejects Bar with missing price fields', () => {
    const data = { t: '2024-01-01T00:00:00Z', o: 100 }; // missing h, l, c, v
    expect(() => BarSchema.parse(data)).toThrow();
  });

  it('rejects Quote with missing bid/ask', () => {
    const data = { t: '2024-01-01T00:00:00Z', bp: 100 }; // missing bs, ap, as
    expect(() => QuoteSchema.parse(data)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

describe('TokenBucketRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const limiter = new TokenBucketRateLimiter(200);
    // Should not block for a few requests
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      await limiter.acquire();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // should be near-instant
    limiter.dispose();
  });

  it('reports available tokens correctly', () => {
    const limiter = new TokenBucketRateLimiter(100);
    expect(limiter.available).toBe(100);
    limiter.dispose();
  });

  it('decrements tokens on acquire', async () => {
    const limiter = new TokenBucketRateLimiter(100);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available).toBe(97);
    limiter.dispose();
  });

  it.skip('delays requests when tokens are exhausted (timing-sensitive)', async () => {
    // Very small bucket to test throttling
    const limiter = new TokenBucketRateLimiter(3);
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available).toBe(0);

    // Next acquire should be delayed
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    // Should take at least some time waiting for token replenishment
    expect(elapsed).toBeGreaterThanOrEqual(10);
    limiter.dispose();
  }, 15000);
});

// ---------------------------------------------------------------------------
// Client Order ID
// ---------------------------------------------------------------------------

describe('makeClientOrderId', () => {
  beforeEach(() => {
    resetNonce();
  });

  it('generates correctly formatted client_order_id', () => {
    const id = makeClientOrderId('mean_reversion', 'AAPL');
    const parts = id.split('_');
    // Format: {strategy}_{symbol}_{timestamp}_{nonce}
    // "mean_reversion" splits into ["mean", "reversion"], so total parts >= 4
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(id).toMatch(/^mean_reversion_AAPL_\d+_\d+$/);
  });

  it('generates unique IDs', () => {
    const id1 = makeClientOrderId('momentum', 'TSLA');
    const id2 = makeClientOrderId('momentum', 'TSLA');
    expect(id1).not.toBe(id2);
  });

  it('includes strategy and symbol in the ID', () => {
    const id = makeClientOrderId('sector_rotation', 'SPY');
    expect(id).toContain('sector_rotation');
    expect(id).toContain('SPY');
  });

  it('increments nonce', () => {
    const id1 = makeClientOrderId('test', 'X');
    const id2 = makeClientOrderId('test', 'X');
    const nonce1 = parseInt(id1.split('_').pop()!, 10);
    const nonce2 = parseInt(id2.split('_').pop()!, 10);
    expect(nonce2).toBe(nonce1 + 1);
  });
});
