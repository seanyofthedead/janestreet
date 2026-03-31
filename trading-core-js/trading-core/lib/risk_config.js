// trading-core-js/trading-core/lib/risk_config.js
function default_for_phase(phase) {
  switch (phase) {
    case /* Micro */
    0:
      return {
        max_position_pct: 0.15,
        max_sector_pct: 0.5,
        min_cash_reserve_pct: 0.2,
        max_daily_loss_pct: 0.05,
        max_drawdown_reduce_pct: 0.1,
        max_drawdown_flatten_pct: 0.2,
        max_order_rate_per_min: 5,
        heartbeat_timeout_seconds: 15,
        max_positions_by_phase: 3
      };
    case /* Small */
    1:
      return {
        max_position_pct: 0.15,
        max_sector_pct: 0.4,
        min_cash_reserve_pct: 0.15,
        max_daily_loss_pct: 0.05,
        max_drawdown_reduce_pct: 0.1,
        max_drawdown_flatten_pct: 0.2,
        max_order_rate_per_min: 8,
        heartbeat_timeout_seconds: 15,
        max_positions_by_phase: 6
      };
    case /* Medium */
    2:
      return {
        max_position_pct: 0.15,
        max_sector_pct: 0.35,
        min_cash_reserve_pct: 0.1,
        max_daily_loss_pct: 0.05,
        max_drawdown_reduce_pct: 0.1,
        max_drawdown_flatten_pct: 0.2,
        max_order_rate_per_min: 10,
        heartbeat_timeout_seconds: 15,
        max_positions_by_phase: 12
      };
    case /* Standard */
    3:
      return {
        max_position_pct: 0.15,
        max_sector_pct: 0.35,
        min_cash_reserve_pct: 0.1,
        max_daily_loss_pct: 0.05,
        max_drawdown_reduce_pct: 0.1,
        max_drawdown_flatten_pct: 0.2,
        max_order_rate_per_min: 20,
        heartbeat_timeout_seconds: 15,
        max_positions_by_phase: 20
      };
  }
}
export {
  default_for_phase
};
