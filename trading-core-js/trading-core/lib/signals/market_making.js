// trading-core-js/node_modules/melange.js/caml_js_exceptions.js
var MelangeError = (function MelangeError2(message, payload) {
  var cause = payload != null ? payload : { MEL_EXN_ID: message };
  var _this = Error.call(this, message, { cause });
  if (_this.cause == null) {
    Object.defineProperty(_this, "cause", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: cause
    });
  }
  Object.defineProperty(_this, "name", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: "MelangeError"
  });
  Object.assign(_this, cause);
  return _this;
});
MelangeError.prototype = Error.prototype;

// trading-core-js/node_modules/melange.js/caml_float.js
function caml_signbit_float(x) {
  if (x === 0 && 1 / x === -Infinity) {
    return true;
  } else if (x === 0 && 1 / x === Infinity) {
    return false;
  } else {
    return x < 0;
  }
}

// trading-core-js/node_modules/melange.js/caml_int64.js
function float_of_bits(x) {
  return (function(lo, hi) {
    return new Float64Array(new Int32Array([lo, hi]).buffer)[0];
  })(x[1], x[0]);
}

// trading-core-js/node_modules/melange.js/caml_sys.js
var os_type = (function(_) {
  if (typeof process !== "undefined" && process.platform === "win32") {
    return "Win32";
  } else {
    return "Unix";
  }
});
function caml_sys_executable_name(param) {
  if (typeof process === "undefined") {
    return "";
  }
  const argv = process.argv;
  if (argv == null) {
    return "";
  } else {
    return argv[0];
  }
}

// trading-core-js/node_modules/melange/sys.js
var executable_name = caml_sys_executable_name();
var os_type2 = os_type();
var unix = os_type() === "Unix";
var win32 = os_type() === "Win32";
var max_array_length = 2147483647;

// trading-core-js/node_modules/melange/obj.js
var max_ephe_length = max_array_length - 2 | 0;

// trading-core-js/node_modules/melange/float.js
var nan = Number.NaN;
var signaling_nan = float_of_bits([
  2146435072,
  1
]);
function max(x, y) {
  if (y > x || !caml_signbit_float(y) && caml_signbit_float(x)) {
    if (x !== x) {
      return x;
    } else {
      return y;
    }
  } else if (y !== y) {
    return y;
  } else {
    return x;
  }
}

// trading-core-js/trading-core/lib/signals/market_making.js
import * as Trading_core__Symbol from "../symbol.js";
import * as Trading_core__Types from "../types.js";
function generate(symbol, bid, ask, volatility, base_spread_bps, inventory, max_inventory, now) {
  const mid = (bid + ask) / 2;
  const vol_mult = max(1, volatility / 0.15);
  const half_spread = mid * base_spread_bps / 1e4 * vol_mult / 2;
  const skew = max_inventory <= 0 ? 0 : inventory / max_inventory * half_spread;
  const buy_price = mid - half_spread - skew;
  const sell_price = mid + half_spread - skew;
  const abs_inv = Math.abs(inventory);
  if (abs_inv >= max_inventory) {
    return (
      /* [] */
      0
    );
  }
  const s = Trading_core__Symbol.create(symbol);
  let sym;
  sym = s.TAG === /* Ok */
  0 ? s._0 : symbol;
  const strength = {
    TAG: (
      /* Moderate */
      1
    ),
    _0: 0.5
  };
  const buy_signal = {
    strategy: (
      /* Market_making */
      4
    ),
    symbol: sym,
    side: (
      /* Buy */
      0
    ),
    strength,
    target_price: buy_price,
    max_position_pct: 0.15,
    timestamp: now
  };
  const sell_signal = {
    strategy: (
      /* Market_making */
      4
    ),
    symbol: sym,
    side: (
      /* Sell */
      1
    ),
    strength,
    target_price: sell_price,
    max_position_pct: 0.15,
    timestamp: now
  };
  return {
    hd: buy_signal,
    tl: {
      hd: sell_signal,
      tl: (
        /* [] */
        0
      )
    }
  };
}
function is_enabled(phase) {
  return Trading_core__Types.strategy_enabled_for_phase(
    phase,
    /* Market_making */
    4
  );
}
var pnl_validated = false;
export {
  generate,
  is_enabled,
  pnl_validated
};
