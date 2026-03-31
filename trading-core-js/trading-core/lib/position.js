// trading-core-js/trading-core/lib/position.js
import * as Trading_core__Money from "./money.js";
import * as Trading_core__Price from "./price.js";
function unrealized_pnl(pos) {
  const diff = Trading_core__Price.sub(pos.current_price, pos.avg_entry_price);
  return Trading_core__Money.of_float(diff * pos.qty);
}
function market_value(pos) {
  return Trading_core__Money.of_float(Trading_core__Price.to_float(pos.current_price) * pos.qty);
}
function cost_basis(pos) {
  return Trading_core__Money.of_float(Trading_core__Price.to_float(pos.avg_entry_price) * pos.qty);
}
function pnl_pct(pos) {
  const entry = Trading_core__Price.to_float(pos.avg_entry_price);
  if (entry === 0) {
    return 0;
  } else {
    return (Trading_core__Price.to_float(pos.current_price) - entry) / entry * 100;
  }
}
function is_long(pos) {
  return pos.qty > 0;
}
function is_short(pos) {
  return pos.qty < 0;
}
function update_price(pos, new_price) {
  return {
    symbol: pos.symbol,
    qty: pos.qty,
    avg_entry_price: pos.avg_entry_price,
    current_price: new_price,
    strategy_id: pos.strategy_id,
    opened_at: pos.opened_at
  };
}
export {
  cost_basis,
  is_long,
  is_short,
  market_value,
  pnl_pct,
  unrealized_pnl,
  update_price
};
