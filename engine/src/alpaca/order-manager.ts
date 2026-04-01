/**
 * Order submission, tracking, and trade update streaming.
 * Manages the order lifecycle and maps Alpaca events to internal types.
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import pino from 'pino';
import type { EngineConfig } from '../config.js';
import { AlpacaClient } from './client.js';
import {
  AlpacaOrderSchema,
  TradeUpdateSchema,
  type AlpacaOrder,
  type TradeUpdate,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrderParams {
  /** Strategy name (used in client_order_id) */
  strategy: string;
  symbol: string;
  side: 'buy' | 'sell';
  /** Limit price — required for limit orders */
  limitPrice: number;
  /** Quantity in shares (mutually exclusive with notional) */
  qty?: number;
  /** Notional value in dollars (mutually exclusive with qty) */
  notional?: number;
  /** Time in force (default 'day') */
  timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  /** Extended hours flag */
  extendedHours?: boolean;
}

export interface OrderEvent {
  type: 'new' | 'fill' | 'partial_fill' | 'canceled' | 'expired' | 'rejected' | 'replaced' | 'error';
  clientOrderId: string;
  order: AlpacaOrder;
  timestamp: string;
  fillPrice?: number;
  fillQty?: number;
  positionQty?: number;
}

export interface OrderManagerEvents {
  orderUpdate: [event: OrderEvent];
  connected: [];
  disconnected: [reason: string];
  error: [err: Error];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// ---------------------------------------------------------------------------
// Nonce generator
// ---------------------------------------------------------------------------

let nonce = 0;
function nextNonce(): number {
  return ++nonce;
}

/** Reset nonce (for testing) */
export function resetNonce(): void {
  nonce = 0;
}

// ---------------------------------------------------------------------------
// Client Order ID
// ---------------------------------------------------------------------------

/** Generate a client_order_id: {strategy}_{symbol}_{timestamp}_{nonce} */
export function makeClientOrderId(strategy: string, symbol: string): string {
  const ts = Date.now();
  const n = nextNonce();
  return `${strategy}_${symbol}_${ts}_${n}`;
}

// ---------------------------------------------------------------------------
// OrderManager
// ---------------------------------------------------------------------------

export class OrderManager extends EventEmitter {
  private readonly logger: pino.Logger;
  private readonly config: EngineConfig;
  private readonly client: AlpacaClient;

  /** Active orders tracked by client_order_id */
  private readonly trackedOrders = new Map<string, AlpacaOrder>();

  /** Trade updates WebSocket */
  private tradeWs: WebSocket | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private intentionallyClosed = false;

  /** Asset fractionable cache */
  private fractionableCache = new Map<string, boolean>();

  constructor(config: EngineConfig, client: AlpacaClient, logger?: pino.Logger) {
    super();
    this.config = config;
    this.client = client;
    this.logger = (logger ?? pino({ name: 'order-manager' })).child({ component: 'order-manager' });
  }

  // -----------------------------------------------------------------------
  // Order Submission
  // -----------------------------------------------------------------------

  /**
   * Submit a limit order.
   * Validates fractional order constraints and generates client_order_id.
   */
  async submitOrder(params: OrderParams): Promise<AlpacaOrder> {
    const { strategy, symbol, side, limitPrice, qty, notional, timeInForce, extendedHours } = params;

    // Validate mutually exclusive qty / notional
    if (qty !== undefined && notional !== undefined) {
      throw new Error('Cannot specify both qty and notional');
    }
    if (qty === undefined && notional === undefined) {
      throw new Error('Must specify either qty or notional');
    }

    // Check fractionable flag for fractional orders
    const isFractional = qty !== undefined && !Number.isInteger(qty);
    if (isFractional || notional !== undefined) {
      const fractionable = await this.checkFractionable(symbol);
      if (!fractionable) {
        throw new Error(`Asset ${symbol} does not support fractional orders`);
      }
    }

    // Fractional orders must use time_in_force: 'day'
    const tif = isFractional || notional !== undefined ? 'day' : (timeInForce ?? 'day');
    if ((isFractional || notional !== undefined) && timeInForce && timeInForce !== 'day') {
      this.logger.warn(
        { symbol, requestedTif: timeInForce },
        'Fractional/notional orders require time_in_force=day, overriding',
      );
    }

    const clientOrderId = makeClientOrderId(strategy, symbol);

    const orderRequest: Record<string, unknown> = {
      symbol,
      side,
      type: 'limit',
      time_in_force: tif,
      limit_price: limitPrice,
      client_order_id: clientOrderId,
    };

    if (qty !== undefined) {
      orderRequest.qty = qty;
    } else {
      orderRequest.notional = notional;
    }

    if (extendedHours) {
      orderRequest.extended_hours = true;
    }

    this.logger.info({ clientOrderId, symbol, side, qty, notional, limitPrice }, 'Submitting order');

    const raw = await this.client.sdk.createOrder(orderRequest);
    const order = AlpacaOrderSchema.parse(raw);

    this.trackedOrders.set(clientOrderId, order);
    this.logger.info(
      { clientOrderId, orderId: order.id, status: order.status },
      'Order submitted',
    );

    return order;
  }

  /** Get a tracked order by client_order_id */
  getTrackedOrder(clientOrderId: string): AlpacaOrder | undefined {
    return this.trackedOrders.get(clientOrderId);
  }

  /** Get all tracked orders */
  getAllTrackedOrders(): Map<string, AlpacaOrder> {
    return new Map(this.trackedOrders);
  }

  // -----------------------------------------------------------------------
  // Order Cancellation
  // -----------------------------------------------------------------------

  /**
   * Cancel an order by client_order_id.
   * Looks up the tracked order, validates it is not in a terminal state,
   * and sends the cancel request to Alpaca.
   */
  async cancelOrder(clientOrderId: string): Promise<{ clientOrderId: string; alpacaOrderId: string; status: string }> {
    const tracked = this.trackedOrders.get(clientOrderId);
    if (!tracked) {
      throw new Error(`Order not found: ${clientOrderId}`);
    }

    const terminalStatuses = ['filled', 'canceled', 'expired', 'rejected'];
    if (terminalStatuses.includes(tracked.status)) {
      throw new Error(`Order ${clientOrderId} is in terminal state: ${tracked.status}`);
    }

    const alpacaOrderId = tracked.id;
    this.logger.info({ clientOrderId, alpacaOrderId }, 'Cancelling order');
    await this.client.cancelOrder(alpacaOrderId);

    return { clientOrderId, alpacaOrderId, status: 'cancel_requested' };
  }

  // -----------------------------------------------------------------------
  // Kill Switch (bypasses rate limiter)
  // -----------------------------------------------------------------------

  /** Emergency cancel all orders — bypasses rate limiter */
  async killSwitchCancelAll(): Promise<void> {
    this.logger.warn('KILL SWITCH: Cancelling all orders (bypassing rate limiter)');
    await this.client.sdk.cancelAllOrders();
  }

  /** Emergency close all positions — bypasses rate limiter */
  async killSwitchCloseAll(): Promise<void> {
    this.logger.warn('KILL SWITCH: Closing all positions (bypassing rate limiter)');
    await this.client.sdk.closeAllPositions();
  }

  // -----------------------------------------------------------------------
  // Fractionable check
  // -----------------------------------------------------------------------

  private async checkFractionable(symbol: string): Promise<boolean> {
    const cached = this.fractionableCache.get(symbol);
    if (cached !== undefined) return cached;

    const asset = await this.client.getAsset(symbol);
    this.fractionableCache.set(symbol, asset.fractionable);
    return asset.fractionable;
  }

  // -----------------------------------------------------------------------
  // Trade Updates WebSocket
  // -----------------------------------------------------------------------

  /** Connect to the trade updates WebSocket stream */
  connectTradeUpdates(): void {
    if (this.tradeWs || this.isConnecting) return;
    this.intentionallyClosed = false;
    this.doConnectTradeWs();
  }

  /** Disconnect trade updates WebSocket */
  disconnectTradeUpdates(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tradeWs) {
      this.tradeWs.close(1000, 'Client disconnect');
      this.tradeWs = null;
    }
    this.isConnecting = false;
  }

  private doConnectTradeWs(): void {
    this.isConnecting = true;
    const baseUrl = this.config.alpacaBaseUrl.replace('https://', 'wss://');
    const wsUrl = `${baseUrl}/stream`;
    this.logger.info({ url: wsUrl }, 'Connecting to trade updates stream');

    this.tradeWs = new WebSocket(wsUrl);

    this.tradeWs.on('open', () => {
      this.logger.info('Trade updates WebSocket open, authenticating');
      this.tradeWs!.send(
        JSON.stringify({
          action: 'authenticate',
          data: {
            key_id: this.config.alpacaApiKey,
            secret_key: this.config.alpacaSecretKey,
          },
        }),
      );
    });

    this.tradeWs.on('message', (data: Buffer) => {
      this.handleTradeWsMessage(data);
    });

    this.tradeWs.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.logger.warn({ code, reason: reasonStr }, 'Trade updates WebSocket closed');
      this.isConnecting = false;
      this.tradeWs = null;
      this.emit('disconnected', reasonStr);

      if (!this.intentionallyClosed) {
        this.scheduleTradeWsReconnect();
      }
    });

    this.tradeWs.on('error', (err: Error) => {
      this.logger.error({ err: err.message }, 'Trade updates WebSocket error');
      this.emit('error', err);
    });
  }

  private handleTradeWsMessage(data: Buffer): void {
    let payload: any;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      this.logger.error({ raw: data.toString().slice(0, 200) }, 'Failed to parse trade update');
      return;
    }

    // Alpaca streaming API wraps messages in { stream, data } format
    const stream = payload.stream;
    const msgData = payload.data;

    if (stream === 'authorization') {
      if (msgData?.status === 'authorized') {
        this.logger.info('Trade updates authenticated');
        this.isConnecting = false;
        this.backoffMs = INITIAL_BACKOFF_MS;
        // Subscribe to trade updates
        this.tradeWs!.send(
          JSON.stringify({
            action: 'listen',
            data: { streams: ['trade_updates'] },
          }),
        );
        this.emit('connected');
        // Reconciliation: fetch current orders after reconnect
        this.reconcileOrders().catch((err) => {
          this.logger.error({ err: (err as Error).message }, 'Order reconciliation failed');
        });
      } else {
        this.logger.error({ data: msgData }, 'Trade updates auth failed');
      }
      return;
    }

    if (stream === 'listening') {
      this.logger.info({ streams: msgData?.streams }, 'Trade updates listening');
      return;
    }

    if (stream === 'trade_updates') {
      this.processTradeUpdate(msgData);
      return;
    }

    this.logger.debug({ stream, data: msgData }, 'Unknown trade WS message');
  }

  private processTradeUpdate(raw: unknown): void {
    const result = TradeUpdateSchema.safeParse(raw);
    if (!result.success) {
      this.logger.warn({ raw, errors: result.error.issues }, 'Invalid trade update');
      return;
    }

    const update: TradeUpdate = result.data;
    const clientOrderId = update.order.client_order_id;

    // Update tracked order
    this.trackedOrders.set(clientOrderId, update.order);

    // Map to OrderEvent
    const event: OrderEvent = {
      type: this.mapEventType(update.event),
      clientOrderId,
      order: update.order,
      timestamp: update.timestamp ?? new Date().toISOString(),
      fillPrice: update.price ?? undefined,
      fillQty: update.qty ?? undefined,
      positionQty: update.position_qty ?? undefined,
    };

    this.logger.info(
      {
        event: event.type,
        clientOrderId,
        symbol: update.order.symbol,
        status: update.order.status,
      },
      'Trade update received',
    );

    this.emit('orderUpdate', event);

    // Clean up terminal orders
    const terminalStatuses = ['filled', 'canceled', 'expired', 'rejected'];
    if (terminalStatuses.includes(update.order.status)) {
      // Keep in tracked map briefly for queries, then remove
      setTimeout(() => {
        this.trackedOrders.delete(clientOrderId);
      }, 60_000);
    }
  }

  private mapEventType(
    alpacaEvent: string,
  ): OrderEvent['type'] {
    switch (alpacaEvent) {
      case 'new':
      case 'pending_new':
        return 'new';
      case 'fill':
        return 'fill';
      case 'partial_fill':
        return 'partial_fill';
      case 'canceled':
      case 'pending_cancel':
        return 'canceled';
      case 'expired':
      case 'done_for_day':
        return 'expired';
      case 'rejected':
        return 'rejected';
      case 'replaced':
      case 'pending_replace':
        return 'replaced';
      default:
        return 'error';
    }
  }

  // -----------------------------------------------------------------------
  // Reconciliation
  // -----------------------------------------------------------------------

  /** Fetch current open orders and reconcile with tracked state */
  private async reconcileOrders(): Promise<void> {
    this.logger.info('Reconciling orders after reconnect');
    try {
      const openOrders = await this.client.getOrders('open');
      for (const order of openOrders) {
        if (order.client_order_id) {
          this.trackedOrders.set(order.client_order_id, order);
        }
      }
      this.logger.info({ count: openOrders.length }, 'Order reconciliation complete');
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Reconciliation failed');
    }
  }

  // -----------------------------------------------------------------------
  // Reconnection
  // -----------------------------------------------------------------------

  private scheduleTradeWsReconnect(): void {
    if (this.reconnectTimer) return;
    const jitter = Math.random() * 0.3 * this.backoffMs;
    const delay = Math.min(this.backoffMs + jitter, MAX_BACKOFF_MS);
    this.logger.info({ delayMs: Math.round(delay) }, 'Scheduling trade WS reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnectTradeWs();
    }, delay);

    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    this.disconnectTradeUpdates();
    this.trackedOrders.clear();
    this.fractionableCache.clear();
    this.logger.info('OrderManager disposed');
  }
}
