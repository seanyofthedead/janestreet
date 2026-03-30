(** Risk configuration parameters per account phase.
    All percentage values stored as decimals (0.15 = 15%). *)

type t = {
  max_position_pct: float;
  max_sector_pct: float;
  min_cash_reserve_pct: float;
  max_daily_loss_pct: float;
  max_drawdown_reduce_pct: float;
  max_drawdown_flatten_pct: float;
  max_order_rate_per_min: int;
  heartbeat_timeout_seconds: float;
  max_positions_by_phase: int;
}

let default_for_phase (phase : Types.account_phase) =
  match phase with
  | Micro -> {
      max_position_pct = 0.15;
      max_sector_pct = 0.50;
      min_cash_reserve_pct = 0.20;
      max_daily_loss_pct = 0.05;
      max_drawdown_reduce_pct = 0.10;
      max_drawdown_flatten_pct = 0.20;
      max_order_rate_per_min = 5;
      heartbeat_timeout_seconds = 15.0;
      max_positions_by_phase = 3;
    }
  | Small -> {
      max_position_pct = 0.15;
      max_sector_pct = 0.40;
      min_cash_reserve_pct = 0.15;
      max_daily_loss_pct = 0.05;
      max_drawdown_reduce_pct = 0.10;
      max_drawdown_flatten_pct = 0.20;
      max_order_rate_per_min = 8;
      heartbeat_timeout_seconds = 15.0;
      max_positions_by_phase = 6;
    }
  | Medium -> {
      max_position_pct = 0.15;
      max_sector_pct = 0.35;
      min_cash_reserve_pct = 0.10;
      max_daily_loss_pct = 0.05;
      max_drawdown_reduce_pct = 0.10;
      max_drawdown_flatten_pct = 0.20;
      max_order_rate_per_min = 10;
      heartbeat_timeout_seconds = 15.0;
      max_positions_by_phase = 12;
    }
  | Standard -> {
      max_position_pct = 0.15;
      max_sector_pct = 0.35;
      min_cash_reserve_pct = 0.10;
      max_daily_loss_pct = 0.05;
      max_drawdown_reduce_pct = 0.10;
      max_drawdown_flatten_pct = 0.20;
      max_order_rate_per_min = 20;
      heartbeat_timeout_seconds = 15.0;
      max_positions_by_phase = 20;
    }
