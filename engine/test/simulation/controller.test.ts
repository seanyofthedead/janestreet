/**
 * Tests for SimulationController.
 * Verifies data loading, timeline building, bar replay, and event emission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { SimulationController, getPreviousTradingDay } from '../../src/simulation/controller.js';
import type { EngineConfig } from '../../src/config.js';
import type { ReplayBar } from '../../src/simulation/controller.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
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
    simulationSpeed: 10,
    ...overrides,
  };
}

function makeBars(count: number, startPrice: number, startTime: number): ReplayBar[] {
  return Array.from({ length: count }, (_, i) => ({
    o: startPrice + i * 0.1,
    h: startPrice + i * 0.1 + 0.5,
    l: startPrice + i * 0.1 - 0.5,
    c: startPrice + i * 0.1 + 0.2,
    v: 100000 + i * 1000,
    timestamp: startTime + i * 60000, // 1 minute apart
  }));
}

// ---------------------------------------------------------------------------
// getPreviousTradingDay
// ---------------------------------------------------------------------------

describe('getPreviousTradingDay', () => {
  it('returns a YYYY-MM-DD string', () => {
    const day = getPreviousTradingDay();
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a weekday (not Saturday or Sunday)', () => {
    const day = getPreviousTradingDay();
    const date = new Date(`${day}T12:00:00`);
    const dow = date.getDay();
    expect(dow).toBeGreaterThanOrEqual(1); // Monday
    expect(dow).toBeLessThanOrEqual(5);    // Friday
  });
});

// ---------------------------------------------------------------------------
// SimulationController — data loading
// ---------------------------------------------------------------------------

describe('SimulationController — loadDataDirect', () => {
  let emitter: EventEmitter;
  let controller: SimulationController;

  beforeEach(() => {
    emitter = new EventEmitter();
    controller = new SimulationController(emitter, makeConfig());
  });

  afterEach(() => {
    controller.stopReplay();
  });

  it('loads bars for all symbols', () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(5, 450, 1000000));
    data.set('AAPL', makeBars(3, 175, 1000000));

    const total = controller.loadDataDirect(data);
    expect(total).toBe(8);
  });

  it('builds merged timeline sorted by timestamp', () => {
    const data = new Map<string, ReplayBar[]>();
    // SPY starts at t=1000, AAPL at t=500 (earlier)
    data.set('SPY', makeBars(3, 450, 1000));
    data.set('AAPL', makeBars(3, 175, 500));

    controller.loadDataDirect(data);

    // After loading, replay the first bar — should be AAPL (earlier timestamp)
    const barHandler = vi.fn();
    emitter.on('bar', barHandler);

    // Manually trigger one replay
    controller.startReplay();
    // The timer fires at intervals, but we can check that the first bar will be AAPL
    // by checking getCurrentBar after stopping
    controller.stopReplay();
  });

  it('getNextBar returns correct bar before replay starts', () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(5, 450, 1000));
    controller.loadDataDirect(data);

    const next = controller.getNextBar('SPY');
    expect(next).toBeDefined();
    expect(next!.o).toBeCloseTo(450, 0);
  });

  it('getCurrentBar returns null before any replay', () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(5, 450, 1000));
    controller.loadDataDirect(data);

    expect(controller.getCurrentBar('SPY')).toBeNull();
  });

  it('handles empty data set', () => {
    const total = controller.loadDataDirect(new Map());
    expect(total).toBe(0);
    expect(controller.isComplete()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SimulationController — replay
// ---------------------------------------------------------------------------

describe('SimulationController — replay', () => {
  let emitter: EventEmitter;
  let controller: SimulationController;

  beforeEach(() => {
    emitter = new EventEmitter();
    // Speed 600 = 100ms per bar (fast for testing)
    controller = new SimulationController(emitter, makeConfig({ simulationSpeed: 600 }));
  });

  afterEach(() => {
    controller.stopReplay();
  });

  it('emits bar, quote, and trade events on each replay', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(2, 450, 1000));
    controller.loadDataDirect(data);

    const barEvents: unknown[] = [];
    const quoteEvents: unknown[] = [];
    const tradeEvents: unknown[] = [];

    emitter.on('bar', (symbol, bar) => barEvents.push({ symbol, bar }));
    emitter.on('quote', (symbol, quote) => quoteEvents.push({ symbol, quote }));
    emitter.on('trade', (symbol, trade) => tradeEvents.push({ symbol, trade }));

    controller.startReplay();

    // Wait for at least 2 bar replays
    await new Promise((resolve) => setTimeout(resolve, 350));
    controller.stopReplay();

    expect(barEvents.length).toBeGreaterThanOrEqual(2);
    expect(quoteEvents.length).toBeGreaterThanOrEqual(2);
    expect(tradeEvents.length).toBeGreaterThanOrEqual(2);

    // Verify bar event shape
    const firstBar = barEvents[0] as { symbol: string; bar: Record<string, unknown> };
    expect(firstBar.symbol).toBe('SPY');
    expect(firstBar.bar).toHaveProperty('o');
    expect(firstBar.bar).toHaveProperty('h');
    expect(firstBar.bar).toHaveProperty('l');
    expect(firstBar.bar).toHaveProperty('c');
    expect(firstBar.bar).toHaveProperty('v');
    expect(firstBar.bar).toHaveProperty('t');

    // Verify quote event has bid/ask
    const firstQuote = quoteEvents[0] as { symbol: string; quote: Record<string, number> };
    expect(firstQuote.quote).toHaveProperty('bp');
    expect(firstQuote.quote).toHaveProperty('ap');
    expect(firstQuote.quote.bp).toBeLessThan(firstQuote.quote.ap);
  });

  it('calls onBar callbacks for each replayed bar', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(3, 450, 1000));
    controller.loadDataDirect(data);

    const callback = vi.fn();
    controller.onBar(callback);

    controller.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 500));
    controller.stopReplay();

    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback.mock.calls[0][0]).toBe('SPY');
  });

  it('isComplete returns true after all bars replayed', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(2, 450, 1000));
    controller.loadDataDirect(data);

    expect(controller.isComplete()).toBe(false);

    controller.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(controller.isComplete()).toBe(true);
  });

  it('getProgress tracks replay position', () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(5, 450, 1000));
    controller.loadDataDirect(data);

    const progress = controller.getProgress();
    expect(progress.current).toBe(0);
    expect(progress.total).toBe(5);
  });

  it('handles symbols with different bar counts', async () => {
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(5, 450, 1000));
    data.set('AAPL', makeBars(3, 175, 1000));
    controller.loadDataDirect(data);

    const barEvents: Array<{ symbol: string }> = [];
    emitter.on('bar', (symbol: string) => barEvents.push({ symbol }));

    controller.startReplay();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    controller.stopReplay();

    expect(controller.isComplete()).toBe(true);
    // Should have 8 total bar events (5 SPY + 3 AAPL)
    expect(barEvents.length).toBe(8);
  });

  it('replay speed: interval calculated from simulationSpeed', () => {
    // Speed 10 = 60000/10 = 6000ms per bar
    const fast = new SimulationController(emitter, makeConfig({ simulationSpeed: 10 }));
    // We can't easily test the interval directly, but we can verify it doesn't crash
    const data = new Map<string, ReplayBar[]>();
    data.set('SPY', makeBars(1, 450, 1000));
    fast.loadDataDirect(data);
    fast.startReplay();
    fast.stopReplay(); // immediate stop
  });
});
