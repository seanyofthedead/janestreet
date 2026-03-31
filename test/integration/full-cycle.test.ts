import { describe, it, expect } from 'vitest';

const ENGINE_URL = process.env.ENGINE_URL || 'http://localhost:3001';
const WATCHDOG_URL = process.env.WATCHDOG_URL || 'http://localhost:3002';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

/**
 * End-to-end integration tests.
 *
 * These require running services (engine, watchdog, dashboard, DynamoDB Local).
 * Skipped by default — run explicitly with:
 *
 *   INTEGRATION=true npx vitest run test/integration/full-cycle.test.ts
 */
const runIntegration = process.env.INTEGRATION === 'true';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('Full-cycle integration tests', () => {
  it('Engine /health returns valid JSON', async () => {
    const res = await fetch(`${ENGINE_URL}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('Engine /api/account returns portfolio data', async () => {
    const res = await fetch(`${ENGINE_URL}/api/account`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
    // Verify snake_case fields expected by dashboard
    expect(typeof body.equity).toBe('number');
    expect(body.buying_power).toBeDefined();
    expect(body.daily_pnl).toBeDefined();
    expect(body.phase).toBeDefined();
    expect(body.currency).toBe('USD');
  });

  it('Engine /api/positions returns an array', async () => {
    const res = await fetch(`${ENGINE_URL}/api/positions`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('Engine /api/orders returns an array', async () => {
    const res = await fetch(`${ENGINE_URL}/api/orders`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('Engine /api/strategies returns all 5 strategies', async () => {
    const res = await fetch(`${ENGINE_URL}/api/strategies`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(5);
    // Verify each strategy has required fields
    for (const s of body) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.id).toBe('number');
      expect(typeof s.isHealthy).toBe('boolean');
    }
  });

  it('Watchdog /status returns health data', async () => {
    const res = await fetch(`${WATCHDOG_URL}/status`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('Watchdog /watchdog-alive responds', async () => {
    const res = await fetch(`${WATCHDOG_URL}/watchdog-alive`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  it('Dashboard returns HTML', async () => {
    const res = await fetch(DASHBOARD_URL);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('<');
  });
});
