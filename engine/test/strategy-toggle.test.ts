/**
 * Tests for strategy enable/disable functionality.
 * - StrategyRunner: config-based strategy toggling (Pattern C: real class, synthetic data)
 * - ConfigPoller: setStrategyEnabled persistence (Pattern B: vi.mock)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategyRunner } from '../src/strategy-runner.js';
import type { SymbolMarketData, Regime, Phase, StrategyId } from '../src/strategy-runner.js';

// ---------------------------------------------------------------------------
// Helpers (same as strategies.test.ts)
// ---------------------------------------------------------------------------

function makeBars(
  count: number,
  startPrice: number,
  trend: 'up' | 'down' | 'flat' | 'sine' = 'sine',
) {
  return Array.from({ length: count }, (_, i) => {
    let base: number;
    switch (trend) {
      case 'up':
        base = startPrice + i * 0.5;
        break;
      case 'down':
        base = startPrice - i * 0.5;
        break;
      case 'flat':
        base = startPrice;
        break;
      case 'sine':
        base = startPrice + Math.sin(i * 0.3) * 5;
        break;
    }
    return {
      o: base - 0.5,
      h: base + 1.5,
      l: base - 1.5,
      c: base,
      v: 1000000,
    };
  });
}

function makeMarketData(overrides: Partial<SymbolMarketData> = {}): SymbolMarketData {
  const bars = makeBars(60, 150, 'sine');
  return {
    symbol: 'SPY',
    price: 150,
    bid: 149.95,
    ask: 150.05,
    volume: 500000,
    bars,
    ...overrides,
  };
}

function primeAllStrategies(runner: StrategyRunner): void {
  for (let i = 0; i <= 4; i++) {
    runner.checkPrimed(i as StrategyId, 100);
  }
}

// ---------------------------------------------------------------------------
// StrategyRunner: config-based strategy toggling (Pattern C)
// ---------------------------------------------------------------------------

describe('StrategyRunner config-based strategy toggling', () => {
  it('skips a strategy disabled by enabledStrategies config', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Price far above SMA to trigger mean reversion
    const bars = makeBars(60, 100, 'flat');
    const data = makeMarketData({ price: 120, bars });

    // First, confirm mean reversion produces signals when enabled
    const signalsEnabled = runner.runStrategies([data], 3 as Phase, 1 as Regime, {
      Mean_reversion: true,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,
      Market_making: true,
    });
    const mrEnabled = signalsEnabled.filter((s) => s.strategy === 0);

    // Now disable mean reversion
    const signalsDisabled = runner.runStrategies([data], 3 as Phase, 1 as Regime, {
      Mean_reversion: false,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,
      Market_making: true,
    });
    const mrDisabled = signalsDisabled.filter((s) => s.strategy === 0);

    // Mean reversion should produce no signals when disabled
    expect(mrDisabled).toHaveLength(0);

    // And the metrics should show mean reversion was not ticked when disabled
    // (it was ticked once before, so totalTicks should be 1 not 2)
    const metrics = runner.getMetrics();
    const mrMetrics = metrics.find((m) => m.id === 0)!;
    expect(mrMetrics.totalTicks).toBe(1);
  });

  it('runs a config-enabled strategy that the phase allows', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    // Use data that triggers mean reversion (price far from SMA)
    const bars = makeBars(60, 100, 'flat');
    const data = makeMarketData({ price: 120, bars });

    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime, {
      Mean_reversion: true,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,
      Market_making: true,
    });

    // Mean reversion should have been evaluated
    const metrics = runner.getMetrics();
    const mrMetrics = metrics.find((m) => m.id === 0)!;
    expect(mrMetrics.totalTicks).toBe(1);

    // And signals should include mean reversion (price 120 vs SMA ~100)
    const mrSignals = signals.filter((s) => s.strategy === 0);
    expect(mrSignals.length).toBeGreaterThan(0);
  });

  it('phase restriction still takes priority over config enable', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    const bars = makeBars(60, 100, 'up');
    const data = makeMarketData({ price: 130, bars });

    // Micro phase (0) disables Momentum (3) and Market_making (4)
    const signals = runner.runStrategies([data], 0 as Phase, 1 as Regime, {
      Mean_reversion: true,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,  // config says enabled, but phase blocks it
      Market_making: true,
    });

    const momentumSignals = signals.filter((s) => s.strategy === 3);
    const mmSignals = signals.filter((s) => s.strategy === 4);

    expect(momentumSignals).toHaveLength(0);
    expect(mmSignals).toHaveLength(0);
  });

  it('works without enabledStrategies parameter (backwards compatible)', () => {
    const runner = new StrategyRunner();
    primeAllStrategies(runner);

    const bars = makeBars(60, 100, 'flat');
    const data = makeMarketData({ price: 120, bars });

    // Call without the optional parameter
    const signals = runner.runStrategies([data], 3 as Phase, 1 as Regime);

    // Should still work -- all strategies evaluated
    const metrics = runner.getMetrics();
    for (const m of metrics) {
      expect(m.totalTicks).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// ConfigPoller: setStrategyEnabled (Pattern B: vi.mock)
// ---------------------------------------------------------------------------

// Mock DynamoDB
vi.mock('../src/dynamodb.js', () => {
  const store: Record<string, Record<string, unknown>> = {};
  const mockClient = {
    send: vi.fn(async (cmd: any) => {
      if (cmd.constructor?.name === 'GetCommand' || cmd.input?.Key) {
        const key = cmd.input?.Key?.key;
        return { Item: store[key] ?? undefined };
      }
      if (cmd.constructor?.name === 'PutCommand' || cmd.input?.Item) {
        const item = cmd.input?.Item;
        if (item?.key) {
          store[item.key] = { ...item };
        }
        return {};
      }
      return {};
    }),
  };
  return {
    getDynamoClient: () => mockClient,
    TABLE_CONFIG: 'trading-config',
    _store: store,
    _mockClient: mockClient,
  };
});

// We need to dynamically import after the mock is set up
const { ConfigPoller } = await import('../src/config-poller.js');
const { EventBus } = await import('../src/event-bus.js');
const dynamo = await import('../src/dynamodb.js');

describe('ConfigPoller.setStrategyEnabled', () => {
  let poller: InstanceType<typeof ConfigPoller>;
  let bus: InstanceType<typeof EventBus>;

  beforeEach(() => {
    // Clear the mock store
    const store = (dynamo as any)._store as Record<string, unknown>;
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    vi.clearAllMocks();

    bus = new EventBus();
    const config = { configPollIntervalMs: 60000 } as any;
    poller = new ConfigPoller(config, bus);
  });

  it('writes to DynamoDB and updates in-memory config', async () => {
    await poller.setStrategyEnabled('mean_reversion', false);

    const config = poller.getConfig();
    expect(config.enabledStrategies.Mean_reversion).toBe(false);

    // Verify DynamoDB was written to
    const mockClient = (dynamo as any)._mockClient;
    expect(mockClient.send).toHaveBeenCalled();
  });

  it('accepts case-insensitive strategy names', async () => {
    await poller.setStrategyEnabled('MOMENTUM', false);
    const config = poller.getConfig();
    expect(config.enabledStrategies.Momentum).toBe(false);
  });

  it('accepts numeric string IDs', async () => {
    await poller.setStrategyEnabled('4', false);
    const config = poller.getConfig();
    expect(config.enabledStrategies.Market_making).toBe(false);
  });

  it('rejects unknown strategy names', async () => {
    await expect(poller.setStrategyEnabled('nonexistent', true)).rejects.toThrow(
      'Unknown strategy: nonexistent',
    );
  });

  it('rejects unknown numeric IDs', async () => {
    await expect(poller.setStrategyEnabled('99', true)).rejects.toThrow(
      'Unknown strategy: 99',
    );
  });

  it('forcePoll is callable', async () => {
    // Should not throw
    await poller.forcePoll();
  });
});
