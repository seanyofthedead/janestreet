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

// trading-core-js/trading-core/lib/position_sizer.js
import * as Trading_core__Money from "./money.js";
function half_kelly(win_prob, avg_win, avg_loss) {
  if (avg_loss <= 0 || win_prob <= 0 || win_prob >= 1) {
    return 0;
  }
  const b = avg_win / avg_loss;
  const q = 1 - win_prob;
  const full_kelly = (b * win_prob - q) / b;
  const hk = full_kelly / 2;
  return max(0, min(0.5, hk));
}
function phase_minimum(equity, phase) {
  switch (phase) {
    case /* Micro */
    0:
      return max(50, 0.05 * equity);
    case /* Small */
    1:
      return max(125, 0.03 * equity);
    case /* Medium */
    2:
    case /* Standard */
    3:
      return 2e3;
  }
}
function max_position(equity) {
  return 0.15 * equity;
}
function calculate_position_size(equity, phase, kelly_fraction, signal_confidence, param) {
  const scaled_fraction = kelly_fraction * signal_confidence;
  const raw_amount = equity * scaled_fraction;
  const min_pos = phase_minimum(equity, phase);
  const max_pos = 0.15 * equity;
  const clamped = raw_amount < min_pos ? min_pos : raw_amount > max_pos ? max_pos : raw_amount;
  return Trading_core__Money.of_float(min(clamped, equity));
}
export {
  calculate_position_size,
  half_kelly,
  max_position,
  phase_minimum
};
