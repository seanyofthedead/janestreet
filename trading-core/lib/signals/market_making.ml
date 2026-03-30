open Trading_core

(** Market making strategy signal generator.
    Fair value from mid-price, volatility-adjusted spread, inventory skew.
    Emits paired buy/sell signals.  Enabled at Medium phase ($10,000+).
    Paper PnL is flagged as unvalidated. *)

(** Generate market-making quote signals.
    @param symbol             ticker to make markets in
    @param bid                current best bid
    @param ask                current best ask
    @param volatility         annualized volatility (e.g. 0.20 = 20%)
    @param base_spread_bps    base spread in basis points (e.g. 5.0)
    @param inventory          current position: positive = long, negative = short
    @param max_inventory      maximum allowed inventory (absolute shares)
    @param now                current timestamp
    Returns 0 signals (if inventory maxed) or 2 signals (buy + sell). *)
let generate ~symbol ~bid ~ask ~volatility ~base_spread_bps
    ~inventory ~max_inventory ~now =
  (* Fair value = mid-price *)
  let mid = (bid +. ask) /. 2.0 in
  (* Volatility multiplier: widen spread in high vol *)
  let vol_mult = Float.max 1.0 (volatility /. 0.15) in
  (* Base spread in price terms *)
  let half_spread = mid *. base_spread_bps /. 10000.0 *. vol_mult /. 2.0 in
  (* Inventory skew: push quotes away from heavy side.
     If long, lower bid more (less eager to buy), raise ask less (eager to sell).
     Skew = inventory / max_inventory * half_spread *)
  let skew =
    if max_inventory <= 0.0 then 0.0
    else inventory /. max_inventory *. half_spread
  in
  let buy_price = mid -. half_spread -. skew in
  let sell_price = mid +. half_spread -. skew in
  (* Skip if inventory would breach limits *)
  let abs_inv = Float.abs inventory in
  if abs_inv >= max_inventory then []
  else
    let sym = match Symbol.create symbol with Ok s -> s | Error _ -> symbol in
    let confidence = 0.5 in  (* market-making has flat confidence *)
    let strength = Types.Moderate confidence in
    let buy_signal : Signal.t = {
      strategy = Types.Market_making;
      symbol = sym;
      side = Types.Buy;
      strength;
      target_price = buy_price;
      max_position_pct = 0.15;
      timestamp = now;
    } in
    let sell_signal : Signal.t = {
      strategy = Types.Market_making;
      symbol = sym;
      side = Types.Sell;
      strength;
      target_price = sell_price;
      max_position_pct = 0.15;
      timestamp = now;
    } in
    [ buy_signal; sell_signal ]

(** Check if market making is enabled for the given phase *)
let is_enabled ~phase =
  Types.strategy_enabled_for_phase phase Types.Market_making

(** Paper PnL is unvalidated — flag for logging. *)
let pnl_validated = false
