/**
 * Basic vitest tests for the watchdog.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { WatchdogConfig } from '../src/config.js';
import { KillSwitch } from '../src/kill-switch.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTestConfig(overrides?: Partial<WatchdogConfig>): WatchdogConfig {
  return {
    alpacaApiKey: 'test-api-key',
    alpacaSecretKey: 'test-secret-key',
    alpacaBaseUrl: 'https://paper-api.alpaca.markets',
    enginePort: 3001,
    watchdogPort: 3099,
    localApiSecret: 'test-secret-abc123',
    healthCheckIntervalMs: 5_000,
    maxMissedHeartbeats: 3,
    dailyLossThreshold: 1000,
    orderRateAnomalyMultiplier: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe('WatchdogConfig', () => {
  it('loads config with correct defaults', () => {
    const config = makeTestConfig();
    expect(config.healthCheckIntervalMs).toBe(5_000);
    expect(config.maxMissedHeartbeats).toBe(3);
    expect(config.dailyLossThreshold).toBe(1000);
    expect(config.orderRateAnomalyMultiplier).toBe(10);
    expect(config.alpacaBaseUrl).toBe('https://paper-api.alpaca.markets');
  });

  it('overrides config values', () => {
    const config = makeTestConfig({ dailyLossThreshold: 500, maxMissedHeartbeats: 5 });
    expect(config.dailyLossThreshold).toBe(500);
    expect(config.maxMissedHeartbeats).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// KillSwitch construction
// ---------------------------------------------------------------------------

describe('KillSwitch', () => {
  it('constructs without errors', () => {
    const config = makeTestConfig();
    const ks = new KillSwitch(config);
    expect(ks).toBeDefined();
    expect(ks.isActivated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Auth middleware (testing the HTTP server directly)
// ---------------------------------------------------------------------------

describe('Auth middleware', () => {
  let server: http.Server;
  const config = makeTestConfig();
  const PORT = 3099;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

      if (req.method === 'POST' && url.pathname === '/kill') {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== config.localApiSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(PORT, '127.0.0.1', resolve);
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('rejects requests without correct API key', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/kill`, {
      method: 'POST',
      headers: { 'X-API-Key': 'wrong-key' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects requests with no API key', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/kill`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('accepts requests with correct API key', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/kill`, {
      method: 'POST',
      headers: { 'X-API-Key': config.localApiSecret },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// KillSwitch idempotency and engine notification
// ---------------------------------------------------------------------------

describe('KillSwitch idempotency guard', () => {
  it('second activate() returns immediately with alreadyActivated', async () => {
    const config = makeTestConfig();
    const ks = new KillSwitch(config);

    // Patch the internal alpaca client to avoid real API calls
    (ks as any).alpaca = {
      cancelAllOrders: vi.fn().mockResolvedValue(undefined),
      closeAllPositions: vi.fn().mockResolvedValue(undefined),
    };

    // Mock fetch for the engine notification
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    try {
      const first = await ks.activate('test reason');
      expect(first.success).toBe(true);
      expect(first.alreadyActivated).toBeUndefined();
      expect(first.viaEngine).toBe(false);
      expect(ks.isActivated).toBe(true);

      // Second call should short-circuit
      const second = await ks.activate('duplicate reason');
      expect(second.success).toBe(true);
      expect(second.alreadyActivated).toBe(true);
      expect(second.errors).toEqual([]);

      // Alpaca methods should only have been called once (from the first activation)
      expect((ks as any).alpaca.cancelAllOrders).toHaveBeenCalledTimes(1);
      expect((ks as any).alpaca.closeAllPositions).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('KillSwitch engine notification', () => {
  it('calls engine notify-kill endpoint after kill', async () => {
    const config = makeTestConfig({ enginePort: 3001 });
    const ks = new KillSwitch(config);

    (ks as any).alpaca = {
      cancelAllOrders: vi.fn().mockResolvedValue(undefined),
      closeAllPositions: vi.fn().mockResolvedValue(undefined),
    };

    const originalFetch = globalThis.fetch;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;

    try {
      await ks.activate('loss threshold');

      // fetch should have been called for the engine notification
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3001/api/notify-kill');
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-API-Key']).toBe(config.localApiSecret);

      const body = JSON.parse(opts.body);
      expect(body.reason).toBe('loss threshold');
      expect(body.success).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('engine notification failure does not block kill result', async () => {
    const config = makeTestConfig();
    const ks = new KillSwitch(config);

    (ks as any).alpaca = {
      cancelAllOrders: vi.fn().mockResolvedValue(undefined),
      closeAllPositions: vi.fn().mockResolvedValue(undefined),
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    try {
      const result = await ks.activate('engine down test');

      // Kill still succeeds even though notification failed
      expect(result.success).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.viaEngine).toBe(false);
      expect(ks.isActivated).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
