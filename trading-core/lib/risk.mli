(** 4-layer risk calculation engine.
    Layer 1: Pre-trade checks (buying power, PDT, position size, strategy, rate)
    Layer 2: Position-level (concentration, per-strategy allocation)
    Layer 3: Portfolio-level (drawdown, daily loss, exposure, cash reserve)
    Layer 4: System-level (heartbeat watchdog) *)

val evaluate :
  config:Risk_config.t ->
  portfolio:Portfolio.t ->
  signal:Signal.t ->
  pdt:Pdt_tracker.t ->
  phase:Types.account_phase ->
  last_heartbeat:float ->
  current_time:float ->
  daily_pnl:Money.t ->
  peak_equity:Money.t ->
  Types.risk_action
