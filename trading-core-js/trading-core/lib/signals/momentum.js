// trading-core-js/node_modules/melange.js/caml.js
function caml_int_compare(x, y) {
  if (x < y) {
    return -1;
  } else if (x === y) {
    return 0;
  } else {
    return 1;
  }
}
function caml_float_compare(x, y) {
  if (x === y) {
    return 0;
  } else if (x < y) {
    return -1;
  } else if (x > y || x === x) {
    return 1;
  } else if (y === y) {
    return -1;
  } else {
    return 0;
  }
}
function caml_string_compare(s1, s2) {
  if (s1 === s2) {
    return 0;
  } else if (s1 < s2) {
    return -1;
  } else {
    return 1;
  }
}

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

// trading-core-js/node_modules/melange.js/caml_obj.js
var for_in = (function(o, foo) {
  for (var x in o) {
    foo(x);
  }
});
function caml_compare(a, b) {
  if (a === b) {
    return 0;
  }
  const a_type = typeof a;
  const b_type = typeof b;
  switch (a_type) {
    case "bigint":
      if (b_type === "bigint") {
        return caml_float_compare(a, b);
      }
      break;
    case "boolean":
      if (b_type === "boolean") {
        return caml_int_compare(a, b);
      }
      break;
    case "function":
      if (b_type === "function") {
        throw new MelangeError("Invalid_argument", {
          MEL_EXN_ID: "Invalid_argument",
          _1: "compare: functional value"
        });
      }
      break;
    case "number":
      if (b_type === "number") {
        return caml_float_compare(a, b);
      }
      break;
    case "string":
      if (b_type === "string") {
        return caml_string_compare(a, b);
      } else {
        return 1;
      }
    case "undefined":
      return -1;
  }
  switch (b_type) {
    case "string":
      return -1;
    case "undefined":
      return 1;
    default:
      if (a_type === "boolean") {
        return 1;
      }
      if (b_type === "boolean") {
        return -1;
      }
      if (a_type === "function") {
        return 1;
      }
      if (b_type === "function") {
        return -1;
      }
      if (a_type === "number") {
        if (b === null || b.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
          return 1;
        } else {
          return -1;
        }
      }
      if (b_type === "number") {
        if (a === null || a.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
          return -1;
        } else {
          return 1;
        }
      }
      if (a === null) {
        if (b.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
          return 1;
        } else {
          return -1;
        }
      }
      if (b === null) {
        if (a.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
          return -1;
        } else {
          return 1;
        }
      }
      if (a.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
        if (b.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
          return aux_obj_compare(a, b);
        } else {
          return -1;
        }
      }
      const tag_a = a.TAG;
      const tag_b = b.TAG;
      if (tag_a === 248) {
        return caml_int_compare(a[1], b[1]);
      }
      if (tag_a === 251) {
        throw new MelangeError("Invalid_argument", {
          MEL_EXN_ID: "Invalid_argument",
          _1: "equal: abstract value"
        });
      }
      if (tag_a !== tag_b) {
        if (tag_a < tag_b) {
          return -1;
        } else {
          return 1;
        }
      }
      const len_a = a.length | 0;
      const len_b = b.length | 0;
      if (len_a === len_b) {
        if (Array.isArray(a)) {
          let _i = 0;
          while (true) {
            const i = _i;
            if (i === len_a) {
              return 0;
            }
            const res = caml_compare(a[i], b[i]);
            if (res !== 0) {
              return res;
            }
            _i = i + 1 | 0;
            continue;
          }
          ;
        } else if (a instanceof Date && b instanceof Date) {
          return a - b;
        } else {
          return aux_obj_compare(a, b);
        }
      } else if (len_a < len_b) {
        let _i$1 = 0;
        while (true) {
          const i$1 = _i$1;
          if (i$1 === len_a) {
            return -1;
          }
          const res$1 = caml_compare(a[i$1], b[i$1]);
          if (res$1 !== 0) {
            return res$1;
          }
          _i$1 = i$1 + 1 | 0;
          continue;
        }
        ;
      } else {
        let _i$2 = 0;
        while (true) {
          const i$2 = _i$2;
          if (i$2 === len_b) {
            return 1;
          }
          const res$2 = caml_compare(a[i$2], b[i$2]);
          if (res$2 !== 0) {
            return res$2;
          }
          _i$2 = i$2 + 1 | 0;
          continue;
        }
        ;
      }
  }
}
function aux_obj_compare(a, b) {
  const min_key_lhs = {
    contents: void 0
  };
  const min_key_rhs = {
    contents: void 0
  };
  const do_key = function(param, key) {
    const min_key = param[2];
    const b2 = param[1];
    if (!(!Object.prototype.hasOwnProperty.call(b2, key) || caml_compare(param[0][key], b2[key]) > 0)) {
      return;
    }
    const mk = min_key.contents;
    if (mk !== void 0 && key >= mk) {
      return;
    } else {
      min_key.contents = key;
      return;
    }
  };
  const partial_arg = [
    a,
    b,
    min_key_rhs
  ];
  const do_key_a = function(param) {
    return do_key(partial_arg, param);
  };
  const partial_arg$1 = [
    b,
    a,
    min_key_lhs
  ];
  const do_key_b = function(param) {
    return do_key(partial_arg$1, param);
  };
  for_in(a, do_key_a);
  for_in(b, do_key_b);
  const match = min_key_lhs.contents;
  const match$1 = min_key_rhs.contents;
  if (match !== void 0) {
    if (match$1 !== void 0) {
      return caml_string_compare(match, match$1);
    } else {
      return -1;
    }
  } else if (match$1 !== void 0) {
    return 1;
  } else {
    return 0;
  }
}
function caml_greaterequal(a, b) {
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return a >= b;
  } else {
    return caml_compare(a, b) >= 0;
  }
}
function caml_greaterthan(a, b) {
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return a > b;
  } else {
    return caml_compare(a, b) > 0;
  }
}
function caml_lessequal(a, b) {
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return a <= b;
  } else {
    return caml_compare(a, b) <= 0;
  }
}
function caml_lessthan(a, b) {
  if ((typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return a < b;
  } else {
    return caml_compare(a, b) < 0;
  }
}

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

// trading-core-js/trading-core/lib/signals/momentum.js
import * as Trading_core__Symbol from "../symbol.js";
import * as Trading_core__Types from "../types.js";
function generate(symbol, ema12, ema26, prev_ema12, prev_ema26, sma50, sma200, rsi14, rel_volume, price, now) {
  if (rel_volume < 1.5) {
    return;
  }
  const uptrend = caml_greaterthan(sma50, sma200);
  const downtrend = caml_lessthan(sma50, sma200);
  const bullish_cross = caml_lessequal(prev_ema12, prev_ema26) && ema12 > ema26;
  const bearish_cross = caml_greaterequal(prev_ema12, prev_ema26) && ema12 < ema26;
  const rsi_oversold = rsi14 < 30;
  const rsi_overbought = rsi14 > 70;
  const signal_side = bullish_cross && uptrend && !rsi_overbought ? (
    /* Buy */
    0
  ) : bearish_cross && downtrend && !rsi_oversold ? (
    /* Sell */
    1
  ) : void 0;
  if (signal_side === void 0) {
    return;
  }
  let rsi_bonus;
  rsi_bonus = signal_side === /* Buy */
  0 ? rsi_oversold ? 0.15 : 0 : rsi_overbought ? 0.15 : 0;
  const vol_bonus = rel_volume >= 2 ? 0.1 : 0;
  const conf = min(1, 0.6 + rsi_bonus + vol_bonus);
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
  const ema_diff = Math.abs(ema12 - ema26);
  let target;
  target = signal_side === /* Buy */
  0 ? price + ema_diff : price - ema_diff;
  const s = Trading_core__Symbol.create(symbol);
  let sym;
  sym = s.TAG === /* Ok */
  0 ? s._0 : symbol;
  return {
    strategy: (
      /* Momentum */
      3
    ),
    symbol: sym,
    side: signal_side,
    strength,
    target_price: target,
    max_position_pct: 0.15,
    timestamp: now
  };
}
function is_enabled(phase) {
  return Trading_core__Types.strategy_enabled_for_phase(
    phase,
    /* Momentum */
    3
  );
}
export {
  generate,
  is_enabled
};
