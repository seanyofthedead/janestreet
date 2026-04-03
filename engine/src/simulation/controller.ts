/**
 * SimulationController: loads historical bars and replays them through
 * the MarketDataStream EventEmitter during off-hours.
 */

import pino from 'pino';
import type { EventEmitter } from 'events';
import type { EngineConfig } from '../config.js';
import { downloadBars } from '../../../backtest/src/data-loader.js';
import type { Bar as BacktestBar } from '../../../backtest/src/data-loader.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  timestamp: number;
}

interface TimelineEntry {
  symbol: string;
  barIndex: number;
  timestamp: number;
}

export type BarCallback = (symbol: string, bar: ReplayBar) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the most recent trading day as YYYY-MM-DD. Crypto trades on weekends. */
export function getPreviousTradingDay(isCrypto: boolean = false): string {
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() - 1);

  // Skip weekends for equities only
  if (!isCrypto) {
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1);
    }
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// SimulationController
// ---------------------------------------------------------------------------

export class SimulationController {
  private readonly logger: pino.Logger;
  private readonly marketData: EventEmitter;
  private readonly replayIntervalMs: number;

  /** All loaded bars by symbol */
  private bars: Map<string, ReplayBar[]> = new Map();

  /** Current replay index per symbol */
  private barIndex: Map<string, number> = new Map();

  /** Merged timeline of all bars sorted by timestamp */
  private timeline: TimelineEntry[] = [];

  /** Current position in the merged timeline */
  private timelineIndex: number = 0;

  /** Replay interval timer */
  private replayTimer: ReturnType<typeof setInterval> | null = null;

  /** Callbacks invoked on each bar replay (for MockOrderManager fill processing) */
  private onBarCallbacks: BarCallback[] = [];

  constructor(
    marketData: EventEmitter,
    config: EngineConfig,
    logger?: pino.Logger,
  ) {
    this.marketData = marketData;
    this.replayIntervalMs = Math.max(100, Math.floor(60_000 / config.simulationSpeed));
    this.logger = (logger ?? pino({ name: 'simulation' })).child({ component: 'simulation-controller' });
  }

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------

  /**
   * Load historical 1-minute bars for all symbols for the given date.
   * Returns total bar count.
   */
  async loadData(
    symbols: string[],
    date: string,
    alpacaApiKey: string,
    alpacaSecret: string,
    isCrypto: boolean = false,
  ): Promise<number> {
    // Crypto trades 24/7; equities trade 9:30 AM - 4:00 PM ET
    const startDate = isCrypto
      ? new Date(`${date}T00:00:00Z`)
      : new Date(`${date}T09:30:00-04:00`);
    const endDate = isCrypto
      ? new Date(`${date}T23:59:59Z`)
      : new Date(`${date}T16:00:00-04:00`);

    this.logger.info({ date, symbols: symbols.length, start: startDate.toISOString(), end: endDate.toISOString() }, 'Loading simulation data');

    let totalBars = 0;

    for (const symbol of symbols) {
      try {
        const rawBars: BacktestBar[] = await downloadBars(
          symbol,
          '1Min',
          startDate,
          endDate,
          alpacaApiKey,
          alpacaSecret,
        );

        const replayBars: ReplayBar[] = rawBars.map((b) => ({
          o: b.open,
          h: b.high,
          l: b.low,
          c: b.close,
          v: b.volume,
          timestamp: b.timestamp,
        }));

        this.bars.set(symbol, replayBars);
        this.barIndex.set(symbol, 0);
        totalBars += replayBars.length;

        this.logger.info({ symbol, bars: replayBars.length }, 'Loaded bars for symbol');
      } catch (err) {
        this.logger.error({ symbol, err: (err as Error).message }, 'Failed to load bars for symbol');
      }
    }

    // Build merged timeline sorted by timestamp
    this.timeline = [];
    for (const [symbol, symbolBars] of this.bars) {
      for (let i = 0; i < symbolBars.length; i++) {
        this.timeline.push({
          symbol,
          barIndex: i,
          timestamp: symbolBars[i]!.timestamp,
        });
      }
    }
    this.timeline.sort((a, b) => a.timestamp - b.timestamp);
    this.timelineIndex = 0;

    this.logger.info({ totalBars, timelineEntries: this.timeline.length }, 'Simulation data loaded');
    return totalBars;
  }

  /**
   * Load pre-built bars directly (for testing without Alpaca API).
   */
  loadDataDirect(data: Map<string, ReplayBar[]>): number {
    let totalBars = 0;
    this.bars = new Map(data);

    for (const [symbol, symbolBars] of this.bars) {
      this.barIndex.set(symbol, 0);
      totalBars += symbolBars.length;
    }

    // Build merged timeline
    this.timeline = [];
    for (const [symbol, symbolBars] of this.bars) {
      for (let i = 0; i < symbolBars.length; i++) {
        this.timeline.push({
          symbol,
          barIndex: i,
          timestamp: symbolBars[i]!.timestamp,
        });
      }
    }
    this.timeline.sort((a, b) => a.timestamp - b.timestamp);
    this.timelineIndex = 0;

    return totalBars;
  }

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  /** Register a callback invoked on each bar replay. */
  onBar(callback: BarCallback): void {
    this.onBarCallbacks.push(callback);
  }

  /**
   * Instantly replay N bars without any timer delay.
   * Used to pre-fill the barBuffer so strategies have data from tick #1.
   */
  bulkReplay(count: number): void {
    const toReplay = Math.min(count, this.timeline.length - this.timelineIndex);
    this.logger.info({ count: toReplay }, 'Bulk-replaying bars');
    for (let i = 0; i < toReplay; i++) {
      this.replayNextBar();
    }
  }

  /** Start the bar replay timer. */
  startReplay(): void {
    if (this.timeline.length === 0) {
      this.logger.warn('No bars to replay');
      return;
    }

    this.logger.info(
      { intervalMs: this.replayIntervalMs, totalBars: this.timeline.length },
      'Starting simulation replay',
    );

    this.replayTimer = setInterval(() => {
      this.replayNextBar();
    }, this.replayIntervalMs);
  }

  /** Stop the replay timer. */
  stopReplay(): void {
    if (this.replayTimer) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
  }

  /** Whether all bars have been replayed. */
  isComplete(): boolean {
    return this.timelineIndex >= this.timeline.length;
  }

  /** Get replay progress as a fraction. */
  getProgress(): { current: number; total: number } {
    return { current: this.timelineIndex, total: this.timeline.length };
  }

  // -----------------------------------------------------------------------
  // Bar accessors (for MockOrderManager fill simulation)
  // -----------------------------------------------------------------------

  /** Get the current bar for a symbol (most recently replayed). */
  getCurrentBar(symbol: string): ReplayBar | null {
    const idx = this.barIndex.get(symbol);
    if (idx === undefined || idx <= 0) return null;
    const symbolBars = this.bars.get(symbol);
    return symbolBars?.[idx - 1] ?? null;
  }

  /** Get the next bar for a symbol (not yet replayed). */
  getNextBar(symbol: string): ReplayBar | null {
    const idx = this.barIndex.get(symbol);
    if (idx === undefined) return null;
    const symbolBars = this.bars.get(symbol);
    return symbolBars?.[idx] ?? null;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private replayNextBar(): void {
    if (this.isComplete()) {
      this.logger.info('Simulation replay complete');
      this.stopReplay();
      return;
    }

    const entry = this.timeline[this.timelineIndex]!;
    const bar = this.bars.get(entry.symbol)?.[entry.barIndex];

    if (!bar) {
      this.timelineIndex++;
      return;
    }

    // Advance the per-symbol index
    this.barIndex.set(entry.symbol, entry.barIndex + 1);
    this.timelineIndex++;

    // Emit bar event on MarketDataStream (matches wireMarketDataEvents expectation)
    this.marketData.emit('bar', entry.symbol, {
      o: bar.o,
      h: bar.h,
      l: bar.l,
      c: bar.c,
      v: bar.v,
      t: new Date(bar.timestamp).toISOString(),
    });

    // Emit quote event (synthetic spread from close price)
    const spread = bar.c * 0.001; // 10 bps total spread
    this.marketData.emit('quote', entry.symbol, {
      bp: bar.c - spread / 2,
      ap: bar.c + spread / 2,
      bs: 100,
      as: 100,
      t: new Date(bar.timestamp).toISOString(),
    });

    // Emit trade event
    this.marketData.emit('trade', entry.symbol, {
      p: bar.c,
      s: bar.v,
      t: new Date(bar.timestamp).toISOString(),
    });

    // Notify callbacks (MockOrderManager uses this for fill processing)
    for (const cb of this.onBarCallbacks) {
      cb(entry.symbol, bar);
    }

    this.logger.debug(
      { symbol: entry.symbol, close: bar.c, progress: `${this.timelineIndex}/${this.timeline.length}` },
      'Replayed bar',
    );
  }
}
