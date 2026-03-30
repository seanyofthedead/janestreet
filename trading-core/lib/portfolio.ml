type t = {
  positions: Position.t list;
  cash: Money.t;
  equity: Money.t;
  buying_power: Money.t;
  daily_pnl: Money.t;
  total_pnl: Money.t;
}

let empty = {
  positions = [];
  cash = Money.zero;
  equity = Money.zero;
  buying_power = Money.zero;
  daily_pnl = Money.zero;
  total_pnl = Money.zero;
}

let total_market_value portfolio =
  List.fold_left (fun acc pos -> Money.add acc (Position.market_value pos)) Money.zero portfolio.positions

let total_unrealized_pnl portfolio =
  List.fold_left (fun acc pos -> Money.add acc (Position.unrealized_pnl pos)) Money.zero portfolio.positions

let position_count portfolio = List.length portfolio.positions

let gross_exposure portfolio =
  List.fold_left (fun acc pos ->
    Money.add acc (Money.abs (Position.market_value pos))
  ) Money.zero portfolio.positions

let net_exposure portfolio =
  List.fold_left (fun acc pos ->
    Money.add acc (Position.market_value pos)
  ) Money.zero portfolio.positions

let concentration portfolio symbol =
  let eq = Money.to_float portfolio.equity in
  if eq = 0.0 then 0.0
  else
    let pos_value = List.fold_left (fun acc (pos : Position.t) ->
      if Symbol.equal pos.symbol symbol then
        Money.add acc (Money.abs (Position.market_value pos))
      else acc
    ) Money.zero portfolio.positions in
    Money.to_float pos_value /. eq

let find_position portfolio symbol =
  List.find_opt (fun (pos : Position.t) -> Symbol.equal pos.symbol symbol) portfolio.positions

let cash_pct portfolio =
  let eq = Money.to_float portfolio.equity in
  if eq = 0.0 then 100.0
  else (Money.to_float portfolio.cash /. eq) *. 100.0
