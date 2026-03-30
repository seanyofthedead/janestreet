(** 4-layer risk calculation engine.
    Returns the most severe action across all layers.
    Severity: Kill_switch > Flatten_all > Reduce_size > Reject > Allow *)

(** Compare risk actions by severity. Higher = more severe. *)
let severity = function
  | Types.Allow -> 0
  | Types.Reject _ -> 1
  | Types.Reduce_size _ -> 2
  | Types.Flatten_all _ -> 3
  | Types.Kill_switch _ -> 4

let more_severe a b =
  if severity a >= severity b then a else b

(** Layer 1: Pre-trade checks *)
let check_buying_power (portfolio : Portfolio.t) (signal : Signal.t) =
  let order_value =
    Money.of_float (Price.to_float signal.target_price *. signal.max_position_pct *. Money.to_float portfolio.equity)
  in
  if signal.side = Buy && Money.( > ) order_value portfolio.buying_power then
    Types.Reject "Insufficient buying power"
  else
    Types.Allow

let check_position_size (config : Risk_config.t) (signal : Signal.t) =
  if signal.max_position_pct > config.max_position_pct then
    Types.Reject ("Position size " ^ string_of_float signal.max_position_pct
                  ^ " exceeds limit " ^ string_of_float config.max_position_pct)
  else
    Types.Allow

let check_pdt (pdt : Pdt_tracker.t) (signal : Signal.t) =
  (* Only check for buys that could become day trades *)
  match signal.side with
  | Buy ->
    if not (Pdt_tracker.can_day_trade pdt) then
      Types.Reject "PDT restriction: no day trades remaining"
    else
      Types.Allow
  | Sell -> Types.Allow

let check_strategy_enabled (phase : Types.account_phase) (signal : Signal.t) =
  if Types.strategy_enabled_for_phase phase signal.strategy then
    Types.Allow
  else
    Types.Reject ("Strategy not enabled for current account phase")

let check_max_positions (config : Risk_config.t) (portfolio : Portfolio.t) (signal : Signal.t) =
  match signal.side with
  | Buy ->
    if Portfolio.position_count portfolio >= config.max_positions_by_phase then
      Types.Reject "Maximum number of positions reached"
    else
      Types.Allow
  | Sell -> Types.Allow

(** Layer 2: Position-level checks *)
let check_concentration (config : Risk_config.t) (portfolio : Portfolio.t) (signal : Signal.t) =
  let current_conc = Portfolio.concentration portfolio signal.symbol in
  if current_conc > config.max_position_pct then
    Types.Reject ("Symbol concentration " ^ string_of_float current_conc
                  ^ " exceeds " ^ string_of_float config.max_position_pct)
  else
    Types.Allow

(** Layer 3: Portfolio-level checks *)
let check_drawdown (config : Risk_config.t) (portfolio : Portfolio.t) (peak_equity : Money.t) =
  let peak = Money.to_float peak_equity in
  let current = Money.to_float portfolio.equity in
  if peak <= 0.0 then Types.Allow
  else
    let drawdown = (peak -. current) /. peak in
    if drawdown >= config.max_drawdown_flatten_pct then
      Types.Flatten_all ("Drawdown " ^ string_of_float (drawdown *. 100.0)
                         ^ "% exceeds flatten threshold")
    else if drawdown >= config.max_drawdown_reduce_pct then
      Types.Reduce_size 0.5
    else
      Types.Allow

let check_daily_loss (config : Risk_config.t) (portfolio : Portfolio.t) (daily_pnl : Money.t) =
  let eq = Money.to_float portfolio.equity in
  if eq <= 0.0 then Types.Allow
  else
    let loss_pct = Float.abs (Float.min 0.0 (Money.to_float daily_pnl)) /. eq in
    if loss_pct >= config.max_daily_loss_pct then
      Types.Reject "Daily loss limit exceeded"
    else
      Types.Allow

let check_cash_reserve (config : Risk_config.t) (portfolio : Portfolio.t) =
  let eq = Money.to_float portfolio.equity in
  if eq <= 0.0 then Types.Allow
  else
    let cash_pct = Money.to_float portfolio.cash /. eq in
    if cash_pct < config.min_cash_reserve_pct then
      Types.Reject "Cash reserve below minimum"
    else
      Types.Allow

(** Layer 4: System-level checks *)
let check_heartbeat (config : Risk_config.t) (last_heartbeat : float) (current_time : float) =
  let elapsed_ms = current_time -. last_heartbeat in
  let timeout_ms = config.heartbeat_timeout_seconds *. 1000.0 in
  if elapsed_ms > timeout_ms then
    Types.Kill_switch ("Heartbeat timeout: " ^ string_of_float (elapsed_ms /. 1000.0)
                       ^ "s since last heartbeat")
  else
    Types.Allow

(** Main evaluation: run all 4 layers, return most severe action. *)
let evaluate
    ~(config : Risk_config.t)
    ~(portfolio : Portfolio.t)
    ~(signal : Signal.t)
    ~(pdt : Pdt_tracker.t)
    ~(phase : Types.account_phase)
    ~(last_heartbeat : float)
    ~(current_time : float)
    ~(daily_pnl : Money.t)
    ~(peak_equity : Money.t)
  : Types.risk_action =
  (* Layer 4 first - system level is highest priority *)
  let l4 = check_heartbeat config last_heartbeat current_time in
  (* Layer 3 - portfolio level *)
  let l3a = check_drawdown config portfolio peak_equity in
  let l3b = check_daily_loss config portfolio daily_pnl in
  let l3c = check_cash_reserve config portfolio in
  (* Layer 2 - position level *)
  let l2 = check_concentration config portfolio signal in
  (* Layer 1 - pre-trade *)
  let l1a = check_buying_power portfolio signal in
  let l1b = check_position_size config signal in
  let l1c = check_pdt pdt signal in
  let l1d = check_strategy_enabled phase signal in
  let l1e = check_max_positions config portfolio signal in
  (* Combine: most severe wins *)
  List.fold_left more_severe Types.Allow
    [ l4; l3a; l3b; l3c; l2; l1a; l1b; l1c; l1d; l1e ]
