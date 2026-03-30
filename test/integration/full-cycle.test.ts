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

  it('Engine /account returns portfolio data', async () => {
    const res = await fetch(`${ENGINE_URL}/account`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('Engine /positions returns an array', async () => {
    const res = await fetch(`${ENGINE_URL}/positions`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('Engine /orders returns an array', async () => {
    const res = await fetch(`${ENGINE_URL}/orders`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
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
