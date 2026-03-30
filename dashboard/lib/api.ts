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
  id: string;
  name: string;
  sharpe: number;
  win_rate: number;
  signal_count: number;
  pnl: number;
  allocation_pct: number;
  maturity: string;
  healthy: boolean;
}

export interface WatchdogStatus {
  running: boolean;
  last_heartbeat: string;
  circuit_breakers: {
    drawdown_pct: number;
    drawdown_limit: number;
    daily_loss_pct: number;
    daily_loss_limit: number;
    exposure_pct: number;
    exposure_limit: number;
    cash_reserve_pct: number;
    cash_reserve_min: number;
    pdt_trades_remaining: number;
    any_triggered: boolean;
  };
  kill_switch_active: boolean;
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
