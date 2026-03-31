// trading-core-js/trading-core/lib/time_utils.js
function now(param) {
  return Date.now();
}
function of_float(f) {
  return f;
}
function to_float(t) {
  return t;
}
function diff(a, b) {
  return a - b;
}
function add_seconds(t, s) {
  return t + s * 1e3;
}
function add_minutes(t, m) {
  return add_seconds(t, m * 60);
}
function is_market_hours(_t) {
  return true;
}
function is_unwind_time(_t) {
  return false;
}
function is_cancel_time(_t) {
  return false;
}
var market_open_hour = 9;
var market_open_min = 30;
var market_close_hour = 16;
var market_close_min = 0;
export {
  add_minutes,
  add_seconds,
  diff,
  is_cancel_time,
  is_market_hours,
  is_unwind_time,
  market_close_hour,
  market_close_min,
  market_open_hour,
  market_open_min,
  now,
  of_float,
  to_float
};
