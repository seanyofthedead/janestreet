(** Pattern Day Trader tracking.
    Tracks day trades in a rolling 5-business-day window.
    PDT rule: 4+ day trades in 5 business days with equity < $25K = restricted. *)

type day_trade = {
  symbol: Symbol.t;
  date: float;  (** Unix timestamp ms *)
  strategy: Types.strategy_id;
}

type t = {
  trades: day_trade list;
  equity: float;
}

let empty equity = { trades = []; equity }

(** 5 business days in milliseconds (approximate: 5 * 24 * 60 * 60 * 1000) *)
let five_business_days_ms = 5.0 *. 24.0 *. 60.0 *. 60.0 *. 1000.0

let prune_old_trades (current_time : float) (trades : day_trade list) : day_trade list =
  List.filter (fun (trade : day_trade) ->
    let age = current_time -. trade.date in
    age < five_business_days_ms
  ) trades

let add_trade (tracker : t) (trade : day_trade) : t =
  let trades = prune_old_trades trade.date (trade :: tracker.trades) in
  { tracker with trades }

let day_trade_count (tracker : t) : int =
  List.length tracker.trades

let trades_remaining (tracker : t) : int =
  if tracker.equity >= 25000.0 then
    999  (* effectively unlimited *)
  else
    let used = day_trade_count tracker in
    Int.max 0 (3 - used)

let can_day_trade (tracker : t) : bool =
  trades_remaining tracker > 0

let status (tracker : t) : Types.pdt_status =
  if tracker.equity >= 25000.0 then Types.Unrestricted
  else
    let used = day_trade_count tracker in
    if used >= 3 then Types.Blocked
    else Types.Restricted { trades_used = used }
