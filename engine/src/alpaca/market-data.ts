/**
 * WebSocket market data streaming from Alpaca IEX feed.
 * Handles reconnection, re-subscription, gap detection, and backpressure.
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import pino from 'pino';
import type { EngineConfig, AssetClass } from '../config.js';
import type { AlpacaClient } from './client.js';
import {
  MarketDataMessageSchema,
  type Trade,
  type Quote,
  type Bar,
} from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketDataEvents {
  trade: [symbol: string, trade: Trade];
  quote: [symbol: string, quote: Quote];
  bar: [symbol: string, bar: Bar];
  connected: [];
  disconnected: [reason: string];
  error: [err: Error];
}

interface BufferedMessage {
  type: 'trade' | 'quote' | 'bar';
  symbol: string;
  data: Trade | Quote | Bar;
  receivedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EQUITY_MARKET_DATA_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const CRYPTO_MARKET_DATA_URL = 'wss://stream.data.alpaca.markets/v1beta3/crypto/us';
const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BUFFER_SIZE = 1_000;

function marketDataUrl(assetClass: AssetClass): string {
  return assetClass === 'crypto' ? CRYPTO_MARKET_DATA_URL : EQUITY_MARKET_DATA_URL;
}

// ---------------------------------------------------------------------------
// MarketDataStream
// ---------------------------------------------------------------------------

export class MarketDataStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly logger: pino.Logger;
  private readonly config: EngineConfig;
  private readonly client: AlpacaClient;
  private readonly wsUrl: string;
  private subscribedTrades: string[] = [];
  private subscribedQuotes: string[] = [];
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting = false;
  private isAuthenticated = false;
  private intentionallyClosed = false;
  private messageBuffer: BufferedMessage[] = [];

  constructor(config: EngineConfig, client: AlpacaClient, logger?: pino.Logger, assetClassOverride?: AssetClass) {
    super();
    this.config = config;
    this.client = client;
    this.wsUrl = marketDataUrl(assetClassOverride ?? config.assetClass);
    this.logger = (logger ?? pino({ name: 'market-data' })).child({ component: 'market-data' });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Connect to the market data WebSocket */
  connect(): void {
    if (this.ws || this.isConnecting) return;
    this.intentionallyClosed = false;
    this.doConnect();
  }

  /** Subscribe to trades and/or quotes for symbols */
  subscribe(trades: string[], quotes: string[]): void {
    this.subscribedTrades = [...new Set([...this.subscribedTrades, ...trades])];
    this.subscribedQuotes = [...new Set([...this.subscribedQuotes, ...quotes])];

    if (this.ws && this.isAuthenticated) {
      this.sendSubscribe(trades, quotes);
    }
  }

  /** Unsubscribe from symbols (sends unsubscribe message) */
  unsubscribe(trades: string[], quotes: string[]): void {
    this.subscribedTrades = this.subscribedTrades.filter((s) => !trades.includes(s));
    this.subscribedQuotes = this.subscribedQuotes.filter((s) => !quotes.includes(s));

    if (this.ws && this.isAuthenticated) {
      this.ws.send(
        JSON.stringify({
          action: 'unsubscribe',
          trades,
          quotes,
        }),
      );
    }
  }

  /** Gracefully disconnect */
  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.isConnecting = false;
  }

  /** Get buffered messages (for consumers that poll instead of listen) */
  drainBuffer(): BufferedMessage[] {
    const msgs = this.messageBuffer;
    this.messageBuffer = [];
    return msgs;
  }

  // -----------------------------------------------------------------------
  // Connection management
  // -----------------------------------------------------------------------

  private doConnect(): void {
    this.isConnecting = true;
    this.isAuthenticated = false;
    this.logger.info({ url: this.wsUrl }, 'Connecting to market data stream');

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.logger.info('WebSocket open, authenticating');
      this.ws!.send(
        JSON.stringify({
          action: 'auth',
          key: this.config.alpacaApiKey,
          secret: this.config.alpacaSecretKey,
        }),
      );
    });

    this.ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.logger.warn({ code, reason: reasonStr }, 'Market data WebSocket closed');
      this.isAuthenticated = false;
      this.isConnecting = false;
      this.ws = null;
      this.emit('disconnected', reasonStr);

      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error({ err: err.message }, 'Market data WebSocket error');
      this.emit('error', err);
    });
  }

  private handleMessage(data: Buffer): void {
    let messages: unknown[];
    try {
      const parsed = JSON.parse(data.toString());
      messages = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      this.logger.error({ raw: data.toString().slice(0, 200) }, 'Failed to parse market data message');
      return;
    }

    for (const msg of messages) {
      const result = MarketDataMessageSchema.safeParse(msg);
      if (!result.success) {
        this.logger.warn({ msg, errors: result.error.issues }, 'Invalid market data message');
        continue;
      }
      const parsed = result.data;

      switch (parsed.T) {
        case 'success':
          if (parsed.msg === 'authenticated') {
            this.logger.info('Market data authenticated');
            this.isAuthenticated = true;
            this.isConnecting = false;
            this.backoffMs = INITIAL_BACKOFF_MS;
            this.resubscribe();
            this.emit('connected');
          }
          break;

        case 'subscription':
          this.logger.info(
            { trades: parsed.trades, quotes: parsed.quotes },
            'Subscription confirmed',
          );
          break;

        case 'error':
          this.logger.error({ code: parsed.code, msg: parsed.msg }, 'Market data error');
          // Error 407 = slow client
          if (parsed.code === 407) {
            this.logger.error('Slow client detected (407). Reconnecting.');
            this.ws?.close();
          }
          this.emit('error', new Error(`Alpaca error ${parsed.code}: ${parsed.msg}`));
          break;

        case 't': {
          const trade: BufferedMessage = {
            type: 'trade',
            symbol: parsed.S,
            data: { t: parsed.t, p: parsed.p, s: parsed.s, x: parsed.x ?? undefined, i: parsed.i ?? undefined, c: parsed.c ?? undefined, z: parsed.z ?? undefined },
            receivedAt: Date.now(),
          };
          this.pushBuffer(trade);
          this.emit('trade', parsed.S, trade.data);
          break;
        }

        case 'q': {
          const quote: BufferedMessage = {
            type: 'quote',
            symbol: parsed.S,
            data: { t: parsed.t, bp: parsed.bp, bs: parsed.bs, ap: parsed.ap, as: parsed.as, bx: parsed.bx ?? undefined, ax: parsed.ax ?? undefined, c: parsed.c ?? undefined, z: parsed.z ?? undefined },
            receivedAt: Date.now(),
          };
          this.pushBuffer(quote);
          this.emit('quote', parsed.S, quote.data);
          break;
        }

        case 'b': {
          const bar: BufferedMessage = {
            type: 'bar',
            symbol: parsed.S,
            data: { t: parsed.t, o: parsed.o, h: parsed.h, l: parsed.l, c: parsed.c, v: parsed.v, n: parsed.n, vw: parsed.vw },
            receivedAt: Date.now(),
          };
          this.pushBuffer(bar);
          this.emit('bar', parsed.S, bar.data);
          break;
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Backpressure buffer
  // -----------------------------------------------------------------------

  private pushBuffer(msg: BufferedMessage): void {
    if (this.messageBuffer.length >= MAX_BUFFER_SIZE) {
      // Drop oldest to maintain bounded buffer
      this.messageBuffer.shift();
      this.logger.warn('Message buffer overflow — dropped oldest message');
    }
    this.messageBuffer.push(msg);
  }

  // -----------------------------------------------------------------------
  // Subscription helpers
  // -----------------------------------------------------------------------

  private sendSubscribe(trades: string[], quotes: string[]): void {
    if (!this.ws) return;
    const msg: Record<string, unknown> = { action: 'subscribe' };
    if (trades.length > 0) msg.trades = trades;
    if (quotes.length > 0) msg.quotes = quotes;
    this.ws.send(JSON.stringify(msg));
    this.logger.info({ trades, quotes }, 'Sent subscribe');
  }

  private resubscribe(): void {
    if (this.subscribedTrades.length > 0 || this.subscribedQuotes.length > 0) {
      this.sendSubscribe(this.subscribedTrades, this.subscribedQuotes);
      // Gap detection: after reconnect, fetch a snapshot via REST to fill gaps
      this.fetchGapSnapshot().catch((err) => {
        this.logger.error({ err: (err as Error).message }, 'Gap snapshot fetch failed');
      });
    }
  }

  private async fetchGapSnapshot(): Promise<void> {
    const allSymbols = [...new Set([...this.subscribedTrades, ...this.subscribedQuotes])];
    if (allSymbols.length === 0) return;

    this.logger.info({ symbols: allSymbols }, 'Fetching gap snapshot after reconnect');
    try {
      const quotes = await this.client.getLatestQuotes(allSymbols);
      for (const [symbol, quote] of quotes) {
        this.emit('quote', symbol, quote);
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Failed to fetch gap snapshot');
    }
  }

  // -----------------------------------------------------------------------
  // Reconnection
  // -----------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const jitter = Math.random() * 0.3 * this.backoffMs;
    const delay = Math.min(this.backoffMs + jitter, MAX_BACKOFF_MS);
    this.logger.info({ delayMs: Math.round(delay) }, 'Scheduling reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);

    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }
}
