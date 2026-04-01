const ENGINE_URL = 'http://localhost:3001';
const WATCHDOG_URL = 'http://localhost:3002';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

// ---- Account & Positions ----

export interface Account {
  equity: number;
  cash: number;
  buying_power: number;
  daily_pnl: number;
  total_pnl: number;
  phase: string;
  currency: string;
  status: string;
}

export interface Position {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  market_value: number;
  pct_of_portfolio: number;
}

export interface Order {
  id: string;
  submitted_at: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number | null;
  filled_price: number | null;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected' | 'partial';
  strategy: string;
  type: string;
}

export interface StrategyMetrics {
  id: number;
  name: string;
  sharpe?: number;
  win_rate?: number;
  signal_count?: number;
  totalSignals?: number;
  totalTicks?: number;
  pnl?: number;
  allocation_pct?: number;
  maturity?: string;
  healthy?: boolean;
  isHealthy?: boolean;
  isPrimed?: boolean;
  consecutiveMisses?: number;
  lastSignalAt?: string | null;
}

export interface WatchdogStatus {
  status: 'healthy' | 'degraded' | 'critical' | 'kill-triggered';
  consecutiveMisses: number;
  lastCheckTime: string;
  dailyPnl: number | null;
  orderRate: number | null;
  enginePhase: string | null;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  timestamp: string;
}

// ---- REST fetchers ----

export function fetchAccount(): Promise<Account> {
  return fetchJson<Account>(`${ENGINE_URL}/api/account`);
}

export function fetchPositions(): Promise<Position[]> {
  return fetchJson<Position[]>(`${ENGINE_URL}/api/positions`);
}

export function fetchOrders(): Promise<Order[]> {
  return fetchJson<Order[]>(`${ENGINE_URL}/api/orders`);
}

export function fetchStrategies(): Promise<StrategyMetrics[]> {
  return fetchJson<StrategyMetrics[]>(`${ENGINE_URL}/api/strategies`);
}

export function fetchWatchdogStatus(): Promise<WatchdogStatus> {
  return fetchJson<WatchdogStatus>(`${WATCHDOG_URL}/status`);
}

export function triggerKillSwitch(apiKey: string): Promise<{ success: boolean; message: string }> {
  return fetchJson(`${WATCHDOG_URL}/kill`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
  });
}

export function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  const query = symbols.join(',');
  return fetchJson<Quote[]>(`${ENGINE_URL}/api/quotes?symbols=${encodeURIComponent(query)}`);
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function fetchBars(symbol: string, timeframe = '5Min'): Promise<CandleData[]> {
  return fetchJson<CandleData[]>(
    `${ENGINE_URL}/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`
  );
}
