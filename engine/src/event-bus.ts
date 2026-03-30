/**
 * In-process typed EventEmitter for the trading engine.
 * All engine components communicate through this bus.
 */

import { EventEmitter } from 'events';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface TickEvent {
  timestamp: number;
  symbols: string[];
  prices: Record<string, number>;
}

export interface SignalEvent {
  strategy: string;
  symbol: string;
  side: 'buy' | 'sell';
  confidence: number;
  targetPrice: number;
  timestamp: number;
}

export interface OrderSubmittedEvent {
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  limitPrice: number;
  strategy: string;
  timestamp: number;
}

export interface OrderFilledEvent {
  clientOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  filledQty: number;
  avgPrice: number;
  timestamp: number;
}

export interface RiskAlertEvent {
  level: 'info' | 'warning' | 'critical';
  message: string;
  signal?: SignalEvent;
  riskDecision: string;
  timestamp: number;
}

export interface CircuitBreakerEvent {
  reason: string;
  previousState: string;
  newState: string;
  timestamp: number;
}

export interface StateTransitionEvent {
  from: string;
  to: string;
  trigger: string;
  timestamp: number;
}

export interface WarmupCompleteEvent {
  strategies: string[];
  barsLoaded: number;
  durationMs: number;
  timestamp: number;
}

export interface HeartbeatEvent {
  engineState: string;
  uptimeMs: number;
  tickCount: number;
  activeOrders: number;
  positionCount: number;
  timestamp: number;
}

export interface ConfigChangeEvent {
  changedKeys: string[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------

export interface EngineEvents {
  tick: [TickEvent];
  signal: [SignalEvent];
  'order-submitted': [OrderSubmittedEvent];
  'order-filled': [OrderFilledEvent];
  'risk-alert': [RiskAlertEvent];
  'circuit-breaker': [CircuitBreakerEvent];
  'state-transition': [StateTransitionEvent];
  'warmup-complete': [WarmupCompleteEvent];
  heartbeat: [HeartbeatEvent];
  'config-change': [ConfigChangeEvent];
}

export type EngineEventName = keyof EngineEvents;

// ---------------------------------------------------------------------------
// Typed EventBus
// ---------------------------------------------------------------------------

export class EventBus {
  private readonly emitter: EventEmitter;
  private readonly logger: pino.Logger;

  constructor(logger?: pino.Logger) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this.logger = (logger ?? pino({ name: 'event-bus' })).child({ component: 'event-bus' });
  }

  emit<K extends EngineEventName>(event: K, ...args: EngineEvents[K]): void {
    this.logger.debug({ event, payload: args[0] }, 'Event emitted');
    this.emitter.emit(event, ...args);
  }

  on<K extends EngineEventName>(event: K, listener: (...args: EngineEvents[K]) => void): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends EngineEventName>(event: K, listener: (...args: EngineEvents[K]) => void): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  once<K extends EngineEventName>(event: K, listener: (...args: EngineEvents[K]) => void): void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
  }

  /** Number of listeners for a given event */
  listenerCount(event: EngineEventName): number {
    return this.emitter.listenerCount(event);
  }

  /** Remove all listeners, optionally for a specific event */
  removeAllListeners(event?: EngineEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}
