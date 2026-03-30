/**
 * Zod schemas for Alpaca API data validation at the OCaml/TS boundary.
 * All data from Alpaca is validated through these schemas before use.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce stringified numbers (Alpaca often returns numeric strings) */
const numericString = z.union([z.number(), z.string()]).pipe(z.coerce.number());

/** Nullable numeric string */
const optionalNumeric = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .pipe(z.coerce.number().optional());

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

export const AlpacaAccountSchema = z.object({
  id: z.string(),
  account_number: z.string(),
  status: z.string(),
  currency: z.string().default('USD'),
  equity: numericString,
  buying_power: numericString,
  cash: numericString,
  portfolio_value: numericString,
  pattern_day_trader: z.boolean(),
  trading_blocked: z.boolean(),
  transfers_blocked: z.boolean(),
  account_blocked: z.boolean(),
  daytrade_count: z.number().int(),
  last_equity: numericString,
  long_market_value: numericString,
  short_market_value: numericString,
  initial_margin: numericString,
  maintenance_margin: numericString,
  daytrading_buying_power: numericString,
  regt_buying_power: numericString,
});

export type AlpacaAccount = z.infer<typeof AlpacaAccountSchema>;

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

export const AlpacaPositionSchema = z.object({
  asset_id: z.string(),
  symbol: z.string(),
  exchange: z.string(),
  asset_class: z.string(),
  avg_entry_price: numericString,
  qty: numericString,
  qty_available: numericString.optional(),
  side: z.enum(['long', 'short']),
  market_value: numericString,
  cost_basis: numericString,
  unrealized_pl: numericString,
  unrealized_plpc: numericString,
  unrealized_intraday_pl: numericString,
  unrealized_intraday_plpc: numericString,
  current_price: numericString,
  lastday_price: numericString,
  change_today: numericString,
});

export type AlpacaPosition = z.infer<typeof AlpacaPositionSchema>;

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

export type AlpacaOrder = {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at?: string | null;
  submitted_at?: string | null;
  filled_at?: string | null;
  expired_at?: string | null;
  canceled_at?: string | null;
  failed_at?: string | null;
  replaced_at?: string | null;
  replaced_by?: string | null;
  replaces?: string | null;
  asset_id: string;
  symbol: string;
  asset_class?: string;
  notional?: number;
  qty?: number;
  filled_qty: number;
  filled_avg_price?: number;
  order_class: string;
  order_type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  side: 'buy' | 'sell';
  time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  status: string;
  extended_hours: boolean;
  legs?: AlpacaOrder[] | null;
  trail_percent?: number;
  trail_price?: number;
  hwm?: number;
};

export const AlpacaOrderSchema: z.ZodType<AlpacaOrder, z.ZodTypeDef, unknown> = z.object({
  id: z.string(),
  client_order_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional().nullable(),
  submitted_at: z.string().optional().nullable(),
  filled_at: z.string().optional().nullable(),
  expired_at: z.string().optional().nullable(),
  canceled_at: z.string().optional().nullable(),
  failed_at: z.string().optional().nullable(),
  replaced_at: z.string().optional().nullable(),
  replaced_by: z.string().optional().nullable(),
  replaces: z.string().optional().nullable(),
  asset_id: z.string(),
  symbol: z.string(),
  asset_class: z.string().optional(),
  notional: optionalNumeric,
  qty: optionalNumeric,
  filled_qty: numericString,
  filled_avg_price: optionalNumeric,
  order_class: z.string().optional().default(''),
  order_type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'trailing_stop']),
  side: z.enum(['buy', 'sell']),
  time_in_force: z.enum(['day', 'gtc', 'opg', 'cls', 'ioc', 'fok']),
  limit_price: optionalNumeric,
  stop_price: optionalNumeric,
  status: z.enum([
    'new',
    'partially_filled',
    'filled',
    'done_for_day',
    'canceled',
    'expired',
    'replaced',
    'pending_cancel',
    'pending_replace',
    'pending_new',
    'accepted_for_bidding',
    'accepted',
    'held',
    'stopped',
    'rejected',
    'suspended',
    'calculated',
  ]),
  extended_hours: z.boolean().optional().default(false),
  legs: z.array(z.lazy(() => AlpacaOrderSchema)).optional().nullable(),
  trail_percent: optionalNumeric,
  trail_price: optionalNumeric,
  hwm: optionalNumeric,
});

// ---------------------------------------------------------------------------
// Trade Update (streaming)
// ---------------------------------------------------------------------------

export const TradeUpdateEventType = z.enum([
  'new',
  'fill',
  'partial_fill',
  'canceled',
  'expired',
  'done_for_day',
  'replaced',
  'rejected',
  'pending_new',
  'stopped',
  'pending_cancel',
  'pending_replace',
  'calculated',
  'suspended',
  'order_replace_rejected',
  'order_cancel_rejected',
]);

export const TradeUpdateSchema = z.object({
  event: TradeUpdateEventType,
  order: AlpacaOrderSchema,
  timestamp: z.string().optional(),
  price: optionalNumeric,
  qty: optionalNumeric,
  position_qty: optionalNumeric,
});

export type TradeUpdate = z.infer<typeof TradeUpdateSchema>;

// ---------------------------------------------------------------------------
// Market Data — Bars
// ---------------------------------------------------------------------------

export const BarSchema = z.object({
  t: z.string().describe('RFC3339 timestamp'),
  o: z.number().describe('Open price'),
  h: z.number().describe('High price'),
  l: z.number().describe('Low price'),
  c: z.number().describe('Close price'),
  v: z.number().int().describe('Volume'),
  n: z.number().int().optional().describe('Number of trades'),
  vw: z.number().optional().describe('VWAP'),
});

export type Bar = z.infer<typeof BarSchema>;

// ---------------------------------------------------------------------------
// Market Data — Quotes
// ---------------------------------------------------------------------------

export const QuoteSchema = z.object({
  t: z.string().describe('RFC3339 timestamp'),
  ax: z.string().optional().describe('Ask exchange'),
  ap: z.number().describe('Ask price'),
  as: z.number().int().describe('Ask size'),
  bx: z.string().optional().describe('Bid exchange'),
  bp: z.number().describe('Bid price'),
  bs: z.number().int().describe('Bid size'),
  c: z.array(z.string()).optional().describe('Conditions'),
  z: z.string().optional().describe('Tape'),
});

export type Quote = z.infer<typeof QuoteSchema>;

// ---------------------------------------------------------------------------
// Market Data — Trades
// ---------------------------------------------------------------------------

export const TradeSchema = z.object({
  t: z.string().describe('RFC3339 timestamp'),
  p: z.number().describe('Price'),
  s: z.number().int().describe('Size'),
  x: z.string().optional().describe('Exchange'),
  i: z.string().optional().describe('Trade ID'),
  c: z.array(z.string()).optional().describe('Conditions'),
  z: z.string().optional().describe('Tape'),
});

export type Trade = z.infer<typeof TradeSchema>;

// ---------------------------------------------------------------------------
// Market Data WebSocket Messages
// ---------------------------------------------------------------------------

export const MarketDataAuthSchema = z.object({
  action: z.literal('auth'),
  key: z.string(),
  secret: z.string(),
});

export const MarketDataSubscribeSchema = z.object({
  action: z.literal('subscribe'),
  trades: z.array(z.string()).optional(),
  quotes: z.array(z.string()).optional(),
  bars: z.array(z.string()).optional(),
});

export const MarketDataMessageSchema = z.discriminatedUnion('T', [
  z.object({ T: z.literal('t'), S: z.string() }).merge(TradeSchema.omit({})),
  z.object({ T: z.literal('q'), S: z.string() }).merge(QuoteSchema.omit({})),
  z.object({ T: z.literal('b'), S: z.string() }).merge(BarSchema.omit({})),
  z.object({
    T: z.literal('success'),
    msg: z.enum(['connected', 'authenticated']),
  }),
  z.object({
    T: z.literal('subscription'),
    trades: z.array(z.string()).optional(),
    quotes: z.array(z.string()).optional(),
    bars: z.array(z.string()).optional(),
  }),
  z.object({
    T: z.literal('error'),
    code: z.number(),
    msg: z.string(),
  }),
]);

export type MarketDataMessage = z.infer<typeof MarketDataMessageSchema>;

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

export const AlpacaAssetSchema = z.object({
  id: z.string(),
  class: z.string(),
  exchange: z.string(),
  symbol: z.string(),
  name: z.string().optional(),
  status: z.string(),
  tradable: z.boolean(),
  marginable: z.boolean(),
  shortable: z.boolean(),
  easy_to_borrow: z.boolean(),
  fractionable: z.boolean(),
  maintenance_margin_requirement: z.number().optional(),
  min_order_size: optionalNumeric,
  min_trade_increment: optionalNumeric,
  price_increment: optionalNumeric,
});

export type AlpacaAsset = z.infer<typeof AlpacaAssetSchema>;
