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
function min(x, y) {
  if (y > x || !caml_signbit_float(y) && caml_signbit_float(x)) {
    if (y !== y) {
      return y;
    } else {
      return x;
    }
  } else if (x !== x) {
    return x;
  } else {
    return y;
  }
}
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

// trading-core-js/trading-core/lib/signals/mean_reversion.js
import * as Trading_core__Symbol from "../symbol.js";
function generate(symbol, _price, sma20, param, z, adf_stat, hurst, now) {
  const is_stationary = adf_stat < -2.86 && hurst < 0.5;
  if (!is_stationary) {
    return;
  }
  const signal_side = z <= -2 ? (
    /* Buy */
    0
  ) : z >= 2 ? (
    /* Sell */
    1
  ) : (Math.abs(z) < 0.5, void 0);
  if (signal_side === void 0) {
    return;
  }
  const abs_z = Math.abs(z);
  const raw_conf = (abs_z - 2) / 1;
  const conf = max(0.5, min(1, 0.5 + raw_conf * 0.5));
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
  const s = Trading_core__Symbol.create(symbol);
  let sym;
  sym = s.TAG === /* Ok */
  0 ? s._0 : symbol;
  return {
    strategy: (
      /* Mean_reversion */
      0
    ),
    symbol: sym,
    side: signal_side,
    strength,
    target_price: sma20,
    max_position_pct: 0.15,
    timestamp: now
  };
}
function should_exit(z) {
  return Math.abs(z) < 0.5;
}
function is_stopped(z) {
  return Math.abs(z) >= 3;
}
function passes_stationarity_gate(adf_stat, hurst) {
  if (adf_stat < -2.86) {
    return hurst < 0.5;
  } else {
    return false;
  }
}
export {
  generate,
  is_stopped,
  passes_stationarity_gate,
  should_exit
};
