type t = {
  strategy: Types.strategy_id;
  symbol: Symbol.t;
  side: Types.side;
  strength: Types.signal_strength;
  target_price: Price.t;
  max_position_pct: float;
  timestamp: Time_utils.t;
}

let confidence signal =
  match signal.strength with
  | Types.Strong c -> c
  | Types.Moderate c -> c
  | Types.Weak c -> c

let is_actionable signal =
  match signal.strength with
  | Types.Strong _ | Types.Moderate _ -> true
  | Types.Weak _ -> false

let strategy_priority = function
  | Types.Mean_reversion -> 3
  | Types.Sector_rotation -> 2
  | Types.Calendar_seasonal -> 1
  | Types.Momentum -> 2
  | Types.Market_making -> 0

(* Compare signals for conflict resolution: highest confidence wins,
   then fixed priority as deterministic tiebreaker *)
let compare_priority a b =
  let conf_a = confidence a in
  let conf_b = confidence b in
  if Float.compare conf_a conf_b <> 0 then Float.compare conf_b conf_a
  else
    let pri_a = strategy_priority a.strategy in
    let pri_b = strategy_priority b.strategy in
    Int.compare pri_b pri_a
