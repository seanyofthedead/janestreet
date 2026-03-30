open Trading_core

(** Calendar/seasonal strategy signal generator.
    Turn-of-month, sell-in-May, and FOMC pre-drift effects. *)

type seasonal_signal =
  | Bullish_window
  | Neutral
  | Bearish_window

(** Turn of Month effect.
    Buy day -5 before month end, sell day +3 after month start.
    @param day_of_month      current day (1-31)
    @param days_in_month     total days in current month
    @param trading_day_of_month  trading day count from start of month (1-based) *)
let turn_of_month ~day_of_month ~days_in_month ~trading_day_of_month =
  if day_of_month >= days_in_month - 5 then Bullish_window
  else if trading_day_of_month <= 3 then Bullish_window
  else Neutral

(** Sell in May effect.
    Bearish May(5) through October(10), Bullish November(11) through April(4). *)
let sell_in_may ~month =
  if month >= 5 && month <= 10 then Bearish_window
  else Bullish_window

(** FOMC pre-announcement drift.
    Buy 2 days before FOMC meeting date.
    @param days_until_fomc  number of calendar days until next FOMC meeting *)
let fomc_pre_drift ~days_until_fomc =
  if days_until_fomc >= 1 && days_until_fomc <= 2 then Bullish_window
  else Neutral

(** Combine seasonal signals: majority vote with weighting.
    Turn-of-month weight=1, Sell-in-May weight=1, FOMC weight=2 (stronger). *)
let combine ~tom ~sim ~fomc =
  let score_of = function
    | Bullish_window -> 1.0
    | Neutral -> 0.0
    | Bearish_window -> -1.0
  in
  let total = score_of tom +. score_of sim +. 2.0 *. score_of fomc in
  if total > 0.5 then Bullish_window
  else if total < -0.5 then Bearish_window
  else Neutral

(** Convert seasonal signal to Signal.t for a given symbol.
    Confidence is modest (0.3-0.55) as seasonal effects are weak edge. *)
let to_signal ~symbol ~seasonal ~now =
  let side, conf =
    match seasonal with
    | Bullish_window -> Some Types.Buy, 0.55
    | Bearish_window -> Some Types.Sell, 0.45
    | Neutral -> None, 0.0
  in
  match side with
  | None -> None
  | Some side ->
    let sym = match Symbol.create symbol with Ok s -> s | Error _ -> symbol in
    let strength =
      if conf > 0.8 then Types.Strong conf
      else if conf > 0.5 then Types.Moderate conf
      else Types.Weak conf
    in
    Some ({
      Signal.strategy = Types.Calendar_seasonal;
      symbol = sym;
      side;
      strength;
      target_price = 0.0;  (* seasonal signals don't have price targets *)
      max_position_pct = 0.10;
      timestamp = now;
    } : Signal.t)

(** Full calendar signal generation.
    @param symbol                ticker (e.g., "SPY")
    @param day_of_month          1-31
    @param days_in_month         total days in month
    @param trading_day_of_month  trading day count (1-based)
    @param month                 1-12
    @param days_until_fomc       days to next FOMC (pass max_int if none upcoming) *)
let generate ~symbol ~day_of_month ~days_in_month ~trading_day_of_month
    ~month ~days_until_fomc ~now =
  let tom = turn_of_month ~day_of_month ~days_in_month ~trading_day_of_month in
  let sim = sell_in_may ~month in
  let fomc = fomc_pre_drift ~days_until_fomc in
  let combined = combine ~tom ~sim ~fomc in
  to_signal ~symbol ~seasonal:combined ~now
