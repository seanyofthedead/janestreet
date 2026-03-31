/**
 * Tests for the typed EventBus.
 * Verifies emit/receive, listener lifecycle, and all event types.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/event-bus.js';
import type {
  TickEvent,
  SignalEvent,
  OrderSubmittedEvent,
  OrderFilledEvent,
  RiskAlertEvent,
  CircuitBreakerEvent,
  StateTransitionEvent,
  WarmupCompleteEvent,
  HeartbeatEvent,
  ConfigChangeEvent,
} from '../src/event-bus.js';

describe('EventBus', () => {
  it('emits and receives tick events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('tick', handler);

    const event: TickEvent = {
      timestamp: Date.now(),
      symbols: ['SPY', 'AAPL'],
      prices: { SPY: 450, AAPL: 175 },
    };
    bus.emit('tick', event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('emits and receives signal events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('signal', handler);

    const event: SignalEvent = {
      strategy: 'Mean_reversion',
      symbol: 'SPY',
      side: 'buy',
      confidence: 0.85,
      targetPrice: 448,
      timestamp: Date.now(),
    };
    bus.emit('signal', event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].strategy).toBe('Mean_reversion');
  });

  it('emits and receives order-submitted events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('order-submitted', handler);

    const event: OrderSubmittedEvent = {
      clientOrderId: 'mr_SPY_123_1',
      symbol: 'SPY',
      side: 'buy',
      qty: 2,
      limitPrice: 448,
      strategy: 'Mean_reversion',
      timestamp: Date.now(),
    };
    bus.emit('order-submitted', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives order-filled events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('order-filled', handler);

    const event: OrderFilledEvent = {
      clientOrderId: 'mr_SPY_123_1',
      symbol: 'SPY',
      side: 'buy',
      filledQty: 2,
      avgPrice: 447.5,
      timestamp: Date.now(),
    };
    bus.emit('order-filled', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives risk-alert events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('risk-alert', handler);

    const event: RiskAlertEvent = {
      level: 'warning',
      message: 'Position too large',
      riskDecision: 'Reduce_size',
      timestamp: Date.now(),
    };
    bus.emit('risk-alert', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives circuit-breaker events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('circuit-breaker', handler);

    const event: CircuitBreakerEvent = {
      reason: 'Max drawdown exceeded',
      previousState: 'Trading',
      newState: 'Cooldown(drawdown)',
      timestamp: Date.now(),
    };
    bus.emit('circuit-breaker', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives state-transition events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('state-transition', handler);

    const event: StateTransitionEvent = {
      from: 'Warming_up',
      to: 'Trading',
      trigger: 'Warmup_complete',
      timestamp: Date.now(),
    };
    bus.emit('state-transition', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives warmup-complete events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('warmup-complete', handler);

    const event: WarmupCompleteEvent = {
      strategies: ['Mean_reversion', 'Sector_rotation'],
      barsLoaded: 800,
      durationMs: 5000,
      timestamp: Date.now(),
    };
    bus.emit('warmup-complete', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives heartbeat events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('heartbeat', handler);

    const event: HeartbeatEvent = {
      engineState: 'Trading',
      uptimeMs: 60000,
      tickCount: 60,
      activeOrders: 2,
      positionCount: 3,
      timestamp: Date.now(),
    };
    bus.emit('heartbeat', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emits and receives config-change events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('config-change', handler);

    const event: ConfigChangeEvent = {
      changedKeys: ['maxPositionPct', 'symbols'],
      timestamp: Date.now(),
    };
    bus.emit('config-change', event);
    expect(handler).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Listener lifecycle
  // -----------------------------------------------------------------------

  it('starts with zero listeners', () => {
    const bus = new EventBus();
    expect(bus.listenerCount('tick')).toBe(0);
    expect(bus.listenerCount('signal')).toBe(0);
    expect(bus.listenerCount('heartbeat')).toBe(0);
  });

  it('adds and removes listeners', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('tick', handler);
    expect(bus.listenerCount('tick')).toBe(1);

    bus.off('tick', handler);
    expect(bus.listenerCount('tick')).toBe(0);
  });

  it('once fires exactly once', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('heartbeat', handler);

    const event: HeartbeatEvent = {
      engineState: 'Trading',
      uptimeMs: 1000,
      tickCount: 1,
      activeOrders: 0,
      positionCount: 0,
      timestamp: Date.now(),
    };

    bus.emit('heartbeat', event);
    bus.emit('heartbeat', event);

    expect(handler).toHaveBeenCalledOnce();
  });

  it('removeAllListeners clears specific event', () => {
    const bus = new EventBus();
    bus.on('tick', vi.fn());
    bus.on('tick', vi.fn());
    bus.on('signal', vi.fn());

    expect(bus.listenerCount('tick')).toBe(2);
    expect(bus.listenerCount('signal')).toBe(1);

    bus.removeAllListeners('tick');

    expect(bus.listenerCount('tick')).toBe(0);
    expect(bus.listenerCount('signal')).toBe(1);
  });

  it('removeAllListeners with no arg clears all', () => {
    const bus = new EventBus();
    bus.on('tick', vi.fn());
    bus.on('signal', vi.fn());
    bus.on('heartbeat', vi.fn());

    bus.removeAllListeners();

    expect(bus.listenerCount('tick')).toBe(0);
    expect(bus.listenerCount('signal')).toBe(0);
    expect(bus.listenerCount('heartbeat')).toBe(0);
  });

  it('supports multiple listeners on same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('tick', handler1);
    bus.on('tick', handler2);

    bus.emit('tick', {
      timestamp: Date.now(),
      symbols: ['SPY'],
      prices: { SPY: 450 },
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });
});
