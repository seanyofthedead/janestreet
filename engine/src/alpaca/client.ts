/**
 * Alpaca API client wrapper with Zod validation and rate limiting.
 * Uses dynamic import for the CommonJS @alpacahq/alpaca-trade-api SDK.
 */

import { createRequire } from 'module';
import pino from 'pino';
import type { EngineConfig } from '../config.js';
import {
  AlpacaAccountSchema,
  AlpacaPositionSchema,
  AlpacaOrderSchema,
  AlpacaAssetSchema,
  BarSchema,
  QuoteSchema,
  type AlpacaAccount,
  type AlpacaPosition,
  type AlpacaOrder,
  type AlpacaAsset,
  type Bar,
  type Quote,
} from './types.js';

// ---------------------------------------------------------------------------
// Token Bucket Rate Limiter
// ---------------------------------------------------------------------------

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;
  private queue: Array<{ resolve: () => void }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(maxRequestsPerMinute: number) {
    this.maxTokens = maxRequestsPerMinute;
    this.tokens = maxRequestsPerMinute;
    this.lastRefill = Date.now();
    // Refill rate: maxTokens per 60_000ms
    this.refillRatePerMs = maxRequestsPerMinute / 60_000;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
    this.lastRefill = now;
  }

  /** Acquire a token, waiting if necessary. Returns a promise that resolves when ready. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait for a token
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve });
      this.scheduleDrain();
    });
  }

  private scheduleDrain(): void {
    if (this.drainTimer) return;
    // Check every 50ms
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.refill();
      while (this.queue.length > 0 && this.tokens >= 1) {
        this.tokens -= 1;
        const waiter = this.queue.shift()!;
        waiter.resolve();
      }
      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }, 50);
  }

  /** Current available tokens (for testing/monitoring) */
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  dispose(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Alpaca Client
// ---------------------------------------------------------------------------

export class AlpacaClient {
  private alpaca: any;
  private readonly logger: pino.Logger;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private memoryLogInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: EngineConfig, logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'alpaca-client' })).child({ component: 'alpaca-client' });
    this.rateLimiter = new TokenBucketRateLimiter(200);

    // Dynamic require for the CommonJS Alpaca SDK
    const require = createRequire(import.meta.url);
    const Alpaca = require('@alpacahq/alpaca-trade-api');

    this.alpaca = new Alpaca({
      keyId: config.alpacaApiKey,
      secretKey: config.alpacaSecretKey,
      baseUrl: config.alpacaBaseUrl,
      paper: config.alpacaBaseUrl.includes('paper'),
    });

    // Log memory usage every 60s
    this.memoryLogInterval = setInterval(() => {
      const mem = process.memoryUsage();
      this.logger.info(
        {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          external: Math.round(mem.external / 1024 / 1024),
        },
        'Memory usage (MB)',
      );
    }, 60_000);
  }

  /** Access the rate limiter (for kill switch bypass) */
  get limiter(): TokenBucketRateLimiter {
    return this.rateLimiter;
  }

  /** Access the underlying Alpaca SDK instance (for WebSocket connections) */
  get sdk(): any {
    return this.alpaca;
  }

  private async rateLimitedCall<T>(fn: () => Promise<T>): Promise<T> {
    await this.rateLimiter.acquire();
    return fn();
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccount(): Promise<AlpacaAccount> {
    this.logger.debug('Fetching account');
    const raw = await this.rateLimitedCall(() => this.alpaca.getAccount());
    return AlpacaAccountSchema.parse(raw);
  }

  // -------------------------------------------------------------------------
  // Positions
  // -------------------------------------------------------------------------

  async getPositions(): Promise<AlpacaPosition[]> {
    this.logger.debug('Fetching positions');
    const raw = await this.rateLimitedCall(() => this.alpaca.getPositions());
    return (raw as unknown[]).map((p) => AlpacaPositionSchema.parse(p));
  }

  // -------------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------------

  async getOrders(status?: 'open' | 'closed' | 'all'): Promise<AlpacaOrder[]> {
    this.logger.debug({ status }, 'Fetching orders');
    const raw = await this.rateLimitedCall(() =>
      this.alpaca.getOrders({ status: status ?? 'open', limit: 500 }),
    );
    return (raw as unknown[]).map((o) => AlpacaOrderSchema.parse(o));
  }

  // -------------------------------------------------------------------------
  // Cancel / Close all
  // -------------------------------------------------------------------------

  async cancelAllOrders(): Promise<unknown> {
    this.logger.warn('Cancelling ALL open orders');
    return this.rateLimitedCall(() => this.alpaca.cancelAllOrders());
  }

  async closeAllPositions(): Promise<unknown> {
    this.logger.warn('Closing ALL positions');
    return this.rateLimitedCall(() => this.alpaca.closeAllPositions());
  }

  // -------------------------------------------------------------------------
  // Assets
  // -------------------------------------------------------------------------

  async getAsset(symbol: string): Promise<AlpacaAsset> {
    this.logger.debug({ symbol }, 'Fetching asset info');
    const raw = await this.rateLimitedCall(() => this.alpaca.getAsset(symbol));
    return AlpacaAssetSchema.parse(raw);
  }

  // -------------------------------------------------------------------------
  // Market Data — Historical Bars
  // -------------------------------------------------------------------------

  async getBars(
    symbol: string,
    timeframe: string,
    start: string,
    end: string,
  ): Promise<Bar[]> {
    this.logger.debug({ symbol, timeframe, start, end }, 'Fetching bars');
    const raw = await this.rateLimitedCall(() =>
      this.alpaca.getBarsV2(symbol, {
        timeframe,
        start,
        end,
        feed: 'iex',
      }),
    );

    // getBarsV2 returns an async iterator
    const bars: Bar[] = [];
    for await (const bar of raw as AsyncIterable<unknown>) {
      const b = bar as Record<string, unknown>;
      // Alpaca SDK v3 uses full property names; normalize to short form
      const normalized = {
        t: b.t ?? b.Timestamp ?? b.timestamp,
        o: b.o ?? b.OpenPrice ?? b.open,
        h: b.h ?? b.HighPrice ?? b.high,
        l: b.l ?? b.LowPrice ?? b.low,
        c: b.c ?? b.ClosePrice ?? b.close,
        v: b.v ?? b.Volume ?? b.volume,
        n: b.n ?? b.TradeCount ?? b.tradeCount,
        vw: b.vw ?? b.VWAP ?? b.vwap,
      };
      bars.push(BarSchema.parse(normalized));
    }
    return bars;
  }

  // -------------------------------------------------------------------------
  // Market Data — Latest Quotes
  // -------------------------------------------------------------------------

  async getLatestQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    this.logger.debug({ symbols }, 'Fetching latest quotes');
    const raw = await this.rateLimitedCall(() =>
      this.alpaca.getLatestQuotes(symbols, { feed: 'iex' }),
    );

    const result = new Map<string, Quote>();
    if (raw instanceof Map) {
      for (const [symbol, quote] of raw) {
        result.set(symbol, QuoteSchema.parse(quote));
      }
    } else if (typeof raw === 'object' && raw !== null) {
      for (const [symbol, quote] of Object.entries(raw)) {
        result.set(symbol, QuoteSchema.parse(quote));
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose(): void {
    if (this.memoryLogInterval) {
      clearInterval(this.memoryLogInterval);
      this.memoryLogInterval = null;
    }
    this.rateLimiter.dispose();
    this.logger.info('AlpacaClient disposed');
  }
}
