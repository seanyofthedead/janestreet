/**
 * Pattern Day Trader (PDT) tracker for backtest simulation.
 * Mirrors OCaml pdt_tracker.ml logic: max 3 day trades in rolling 5 business days
 * when equity is below $25,000.
 */

export interface DayTradeRecord {
  symbol: string;
  date: number; // timestamp ms
}

export interface PdtTracker {
  trades: DayTradeRecord[];
  equity: number;
}

const FIVE_BUSINESS_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const PDT_EQUITY_THRESHOLD = 25_000;
const MAX_DAY_TRADES_RESTRICTED = 3;

/**
 * Create an empty PDT tracker with the given equity.
 */
export function createPdtTracker(equity: number): PdtTracker {
  return { trades: [], equity };
}

/**
 * Remove trades older than 5 business days from the current time.
 */
function pruneOldTrades(currentTime: number, trades: DayTradeRecord[]): DayTradeRecord[] {
  return trades.filter(t => (currentTime - t.date) < FIVE_BUSINESS_DAYS_MS);
}

/**
 * Record a day trade (same-day open and close of a position).
 */
export function addDayTrade(tracker: PdtTracker, symbol: string, date: number): PdtTracker {
  const trade: DayTradeRecord = { symbol, date };
  const trades = pruneOldTrades(date, [trade, ...tracker.trades]);
  return { ...tracker, trades };
}

/**
 * Update the equity value used for PDT determination.
 */
export function updateEquity(tracker: PdtTracker, equity: number): PdtTracker {
  return { ...tracker, equity };
}

/**
 * Check if we can make another day trade.
 * Unlimited if equity >= $25K, otherwise max 3 in rolling 5-day window.
 */
export function canDayTrade(tracker: PdtTracker): boolean {
  return tradesRemaining(tracker) > 0;
}

/**
 * Number of day trades remaining in the current window.
 * Returns 999 if unrestricted (equity >= $25K).
 */
export function tradesRemaining(tracker: PdtTracker): number {
  if (tracker.equity >= PDT_EQUITY_THRESHOLD) return 999;
  const used = tracker.trades.length;
  return Math.max(0, MAX_DAY_TRADES_RESTRICTED - used);
}

/**
 * Current count of day trades in the rolling window.
 */
export function dayTradeCount(tracker: PdtTracker): number {
  return tracker.trades.length;
}

/**
 * PDT status matching OCaml variant type.
 */
export type PdtStatus =
  | { kind: 'unrestricted' }
  | { kind: 'restricted'; tradesUsed: number }
  | { kind: 'blocked' };

export function status(tracker: PdtTracker): PdtStatus {
  if (tracker.equity >= PDT_EQUITY_THRESHOLD) {
    return { kind: 'unrestricted' };
  }
  const used = tracker.trades.length;
  if (used >= MAX_DAY_TRADES_RESTRICTED) {
    return { kind: 'blocked' };
  }
  return { kind: 'restricted', tradesUsed: used };
}

/**
 * Convert to OCaml-compatible pdt_tracker record for passing to risk.evaluate.
 * The OCaml module expects { trades: linked-list, equity: float }.
 */
export function toOCaml(tracker: PdtTracker): { trades: unknown; equity: number } {
  // Build a Melange-style linked list from the trades array
  let list: unknown = 0; // /* [] */ 0
  for (let i = tracker.trades.length - 1; i >= 0; i--) {
    list = {
      hd: { symbol: tracker.trades[i].symbol, date: tracker.trades[i].date },
      tl: list,
    };
  }
  return { trades: list, equity: tracker.equity };
}
