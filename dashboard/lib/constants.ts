/** Strategy maturity phases with labels and descriptions */
export const STRATEGY_PHASES = [
  { key: 'Warming up', label: 'Warming up', description: 'Collecting initial market data before generating signals' },
  { key: 'Pilot', label: 'Pilot', description: 'Live testing with reduced allocation limits' },
  { key: 'Live', label: 'Live', description: 'Full allocation, active signal generation' },
] as const;

/** Tooltip hints for portfolio metrics */
export const PORTFOLIO_HINTS: Record<string, string> = {
  'Total Equity': 'Total account value including cash and open positions',
  Cash: 'Available cash not allocated to any position',
  'Buying Power': 'Maximum amount available for new trades (includes margin)',
  'Daily PnL': 'Profit or loss for the current trading day',
  'Total PnL': 'Cumulative profit or loss since inception',
  'Account Phase': 'Current maturity phase: Micro, Small, Medium, or Standard',
};

/** Tooltip hints for strategy card metrics */
export const STRATEGY_HINTS: Record<string, string> = {
  Sharpe: 'Risk-adjusted return ratio. Above 1.0 is good, above 2.0 is excellent',
  'Win Rate': 'Percentage of trades that were profitable',
  Signals: 'Total number of trading signals generated',
  PnL: 'Profit or loss attributed to this strategy',
  Allocation: 'Percentage of portfolio allocated to this strategy',
};

/** Tooltip hints for risk monitor metrics */
export const RISK_HINTS: Record<string, string> = {
  Watchdog: 'Independent process monitoring engine health. Green = normal',
  'Engine Phase': 'Current engine state: Trading, Warming up, Halted, Off hours',
  'Last Check': 'Time of last watchdog health check',
  'Missed Heartbeats': 'Consecutive missed engine heartbeats. 0 is normal, >3 is concerning',
  'Daily P&L': 'Today\'s profit/loss. Triggers risk alerts at -5% drawdown',
  Equity: 'Current total account value',
  'Order Rate': 'Orders submitted per minute. Max varies by account phase',
};
