/**
 * Basic vitest tests for the watchdog.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
