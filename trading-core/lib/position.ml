type t = {
  symbol: Symbol.t;
  qty: float;
  avg_entry_price: Price.t;
  current_price: Price.t;
  strategy_id: Types.strategy_id;
  opened_at: Time_utils.t;
}

let unrealized_pnl pos =
  let diff = Price.sub pos.current_price pos.avg_entry_price in
  Money.of_float (diff *. pos.qty)

let market_value pos =
  Money.of_float (Price.to_float pos.current_price *. pos.qty)

let cost_basis pos =
  Money.of_float (Price.to_float pos.avg_entry_price *. pos.qty)

let pnl_pct pos =
  let entry = Price.to_float pos.avg_entry_price in
  if entry = 0.0 then 0.0
  else ((Price.to_float pos.current_price -. entry) /. entry) *. 100.0

let is_long pos = pos.qty > 0.0
let is_short pos = pos.qty < 0.0

let update_price pos new_price =
  { pos with current_price = new_price }
