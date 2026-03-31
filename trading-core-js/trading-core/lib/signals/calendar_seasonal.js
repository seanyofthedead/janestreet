// trading-core-js/trading-core/lib/signals/calendar_seasonal.js
import * as Trading_core__Symbol from "../symbol.js";
function turn_of_month(day_of_month, days_in_month, trading_day_of_month) {
  if (day_of_month >= (days_in_month - 5 | 0) || trading_day_of_month <= 3) {
    return (
      /* Bullish_window */
      0
    );
  } else {
    return (
      /* Neutral */
      1
    );
  }
}
function sell_in_may(month) {
  if (month >= 5 && month <= 10) {
    return (
      /* Bearish_window */
      2
    );
  } else {
    return (
      /* Bullish_window */
      0
    );
  }
}
function fomc_pre_drift(days_until_fomc) {
  if (days_until_fomc >= 1 && days_until_fomc <= 2) {
    return (
      /* Bullish_window */
      0
    );
  } else {
    return (
      /* Neutral */
      1
    );
  }
}
function combine(tom, sim, fomc) {
  const score_of = function(param) {
    switch (param) {
      case /* Bullish_window */
      0:
        return 1;
      case /* Neutral */
      1:
        return 0;
      case /* Bearish_window */
      2:
        return -1;
    }
  };
  const total = score_of(tom) + score_of(sim) + 2 * score_of(fomc);
  if (total > 0.5) {
    return (
      /* Bullish_window */
      0
    );
  } else if (total < -0.5) {
    return (
      /* Bearish_window */
      2
    );
  } else {
    return (
      /* Neutral */
      1
    );
  }
}
function to_signal(symbol, seasonal, now) {
  let match;
  switch (seasonal) {
    case /* Bullish_window */
    0:
      match = [
        /* Buy */
        0,
        0.55
      ];
      break;
    case /* Neutral */
    1:
      match = [
        void 0,
        0
      ];
      break;
    case /* Bearish_window */
    2:
      match = [
        /* Sell */
        1,
        0.45
      ];
      break;
  }
  const side = match[0];
  if (side === void 0) {
    return;
  }
  const conf = match[1];
  const s = Trading_core__Symbol.create(symbol);
  let sym;
  sym = s.TAG === /* Ok */
  0 ? s._0 : symbol;
  const strength = conf > 0.8 ? {
    TAG: (
      /* Strong */
      0
    ),
    _0: conf
  } : conf > 0.5 ? {
    TAG: (
      /* Moderate */
      1
    ),
    _0: conf
  } : {
    TAG: (
      /* Weak */
      2
    ),
    _0: conf
  };
  return {
    strategy: (
      /* Calendar_seasonal */
      2
    ),
    symbol: sym,
    side,
    strength,
    target_price: 0,
    max_position_pct: 0.1,
    timestamp: now
  };
}
function generate(symbol, day_of_month, days_in_month, trading_day_of_month, month, days_until_fomc, now) {
  const tom = turn_of_month(day_of_month, days_in_month, trading_day_of_month);
  const sim = sell_in_may(month);
  const fomc = fomc_pre_drift(days_until_fomc);
  const combined = combine(tom, sim, fomc);
  return to_signal(symbol, combined, now);
}
export {
  combine,
  fomc_pre_drift,
  generate,
  sell_in_may,
  to_signal,
  turn_of_month
};
