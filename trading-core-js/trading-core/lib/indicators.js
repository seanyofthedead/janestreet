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

// trading-core-js/node_modules/melange.js/caml_array.js
function sub(x, offset, len) {
  const result = new Array(len);
  let j = 0;
  let i = offset;
  while (j < len) {
    result[j] = x[i];
    j = j + 1 | 0;
    i = i + 1 | 0;
  }
  ;
  return result;
}
function set(xs, index, newval) {
  if (index < 0 || index >= xs.length) {
    throw new MelangeError("Invalid_argument", {
      MEL_EXN_ID: "Invalid_argument",
      _1: "index out of bounds"
    });
  }
  xs[index] = newval;
}
function get(xs, index) {
  if (index < 0 || index >= xs.length) {
    throw new MelangeError("Invalid_argument", {
      MEL_EXN_ID: "Invalid_argument",
      _1: "index out of bounds"
    });
  }
  return xs[index];
}
function make(len, init2) {
  const b = new Array(len);
  for (let i = 0; i < len; ++i) {
    b[i] = init2;
  }
  return b;
}

// trading-core-js/node_modules/melange.js/curry.js
function app(_f, _args) {
  while (true) {
    const args = _args;
    const f = _f;
    const init_arity = f.length;
    const arity = init_arity === 0 ? 1 : init_arity;
    const len = args.length;
    const d = arity - len | 0;
    if (d === 0) {
      return f.apply(null, args);
    }
    if (d >= 0) {
      return function(x) {
        return app(f, args.concat([x]));
      };
    }
    _args = sub(args, arity, -d | 0);
    _f = f.apply(null, sub(args, 0, arity));
    continue;
  }
  ;
}
function _1(o, a0) {
  const arity = o.length;
  if (arity === 1) {
    return o(a0);
  } else {
    switch (arity) {
      case 1:
        return o(a0);
      case 2:
        return function(param) {
          return o(a0, param);
        };
      case 3:
        return function(param, param$1) {
          return o(a0, param, param$1);
        };
      case 4:
        return function(param, param$1, param$2) {
          return o(a0, param, param$1, param$2);
        };
      case 5:
        return function(param, param$1, param$2, param$3) {
          return o(a0, param, param$1, param$2, param$3);
        };
      case 6:
        return function(param, param$1, param$2, param$3, param$4) {
          return o(a0, param, param$1, param$2, param$3, param$4);
        };
      case 7:
        return function(param, param$1, param$2, param$3, param$4, param$5) {
          return o(a0, param, param$1, param$2, param$3, param$4, param$5);
        };
      default:
        return app(o, [a0]);
    }
  }
}
function _2(o, a0, a1) {
  const arity = o.length;
  if (arity === 2) {
    return o(a0, a1);
  } else {
    switch (arity) {
      case 1:
        return app(o(a0), [a1]);
      case 2:
        return o(a0, a1);
      case 3:
        return function(param) {
          return o(a0, a1, param);
        };
      case 4:
        return function(param, param$1) {
          return o(a0, a1, param, param$1);
        };
      case 5:
        return function(param, param$1, param$2) {
          return o(a0, a1, param, param$1, param$2);
        };
      case 6:
        return function(param, param$1, param$2, param$3) {
          return o(a0, a1, param, param$1, param$2, param$3);
        };
      case 7:
        return function(param, param$1, param$2, param$3, param$4) {
          return o(a0, a1, param, param$1, param$2, param$3, param$4);
        };
      default:
        return app(o, [
          a0,
          a1
        ]);
    }
  }
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

// trading-core-js/node_modules/melange.js/caml_int64.js
function float_of_bits(x) {
  return (function(lo, hi) {
    return new Float64Array(new Int32Array([lo, hi]).buffer)[0];
  })(x[1], x[0]);
}

// trading-core-js/node_modules/melange/stdlib.js
var infinity = Infinity;
var neg_infinity = -Infinity;

// trading-core-js/node_modules/melange/sys.js
var executable_name = caml_sys_executable_name();
var os_type2 = os_type();
var unix = os_type() === "Unix";
var win32 = os_type() === "Win32";
var max_array_length = 2147483647;

// trading-core-js/node_modules/melange/obj.js
var max_ephe_length = max_array_length - 2 | 0;

// trading-core-js/node_modules/melange/array.js
function map(f, a) {
  const l = a.length;
  if (l === 0) {
    return [];
  }
  const r = make(l, _1(f, a[0]));
  for (let i = 1; i < l; ++i) {
    r[i] = _1(f, a[i]);
  }
  return r;
}
function fold_left2(f, x, a) {
  let r = x;
  for (let i = 0, i_finish = a.length; i < i_finish; ++i) {
    r = _2(f, r, a[i]);
  }
  return r;
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
var infinity2 = infinity;
var neg_infinity2 = neg_infinity;

// trading-core-js/trading-core/lib/indicators.js
function ema(period, prev, price) {
  const alpha = 2 / (period + 1);
  return alpha * price + (1 - alpha) * prev;
}
function rsi(gains, losses) {
  if (losses <= 0) {
    return 100;
  }
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}
function bollinger_bands(sma, std_dev, multiplier) {
  return {
    upper: sma + multiplier * std_dev,
    middle: sma,
    lower: sma - multiplier * std_dev
  };
}
function z_score(value, mean, std_dev) {
  if (std_dev <= 0) {
    return 0;
  } else {
    return (value - mean) / std_dev;
  }
}
function rvol(current_volume, avg_volume) {
  if (avg_volume <= 0) {
    return 0;
  } else {
    return current_volume / avg_volume;
  }
}
function vwap(cumulative_tp_vol, cumulative_vol) {
  if (cumulative_vol <= 0) {
    return 0;
  } else {
    return cumulative_tp_vol / cumulative_vol;
  }
}
function adx(plus_di, minus_di, prev_adx, period) {
  const di_sum = plus_di + minus_di;
  const dx = di_sum <= 0 ? 0 : Math.abs(plus_di - minus_di) / di_sum * 100;
  const p = period;
  return (prev_adx * (p - 1) + dx) / p;
}
function hurst_exponent(returns) {
  const n = returns.length;
  if (n < 20) {
    return 0.5;
  }
  const sum = fold_left2((function(acc, x) {
    return acc + x;
  }), 0, returns);
  const mean = sum / n;
  const deviations = map((function(x) {
    return x - mean;
  }), returns);
  const cumdev = make(n, 0);
  for (let i = 0; i < n; ++i) {
    set(cumdev, i, i === 0 ? get(deviations, i) : get(cumdev, i - 1 | 0) + get(deviations, i));
  }
  const mx = fold_left2(max, neg_infinity2, cumdev);
  const mn = fold_left2(min, infinity2, cumdev);
  const r = mx - mn;
  const sum_sq = fold_left2((function(acc, d) {
    return acc + d * d;
  }), 0, deviations);
  const $$var = sum_sq / n;
  const s = Math.sqrt($$var);
  if (s <= 0) {
    return 0.5;
  }
  const rs = r / s;
  if (rs <= 0) {
    return 0.5;
  } else {
    return Math.log(rs) / Math.log(n);
  }
}
function adf_statistic(series) {
  const n = series.length;
  if (n < 10) {
    return 0;
  }
  const m = n - 1 | 0;
  const fm = m;
  let sum_xy = 0;
  let sum_x = 0;
  let sum_y = 0;
  let sum_x2 = 0;
  for (let t = 1; t < n; ++t) {
    const dy = get(series, t) - get(series, t - 1 | 0);
    const x = get(series, t - 1 | 0);
    sum_xy = sum_xy + x * dy;
    sum_x = sum_x + x;
    sum_y = sum_y + dy;
    sum_x2 = sum_x2 + x * x;
  }
  const denom = fm * sum_x2 - sum_x * sum_x;
  if (Math.abs(denom) < 1e-12) {
    return 0;
  }
  const rho = (fm * sum_xy - sum_x * sum_y) / denom;
  const intercept = (sum_y - rho * sum_x) / fm;
  let sse = 0;
  for (let t$1 = 1; t$1 < n; ++t$1) {
    const dy$1 = get(series, t$1) - get(series, t$1 - 1 | 0);
    const x$1 = get(series, t$1 - 1 | 0);
    const predicted = intercept + rho * x$1;
    const e = dy$1 - predicted;
    sse = sse + e * e;
  }
  const s2 = sse / (fm - 2);
  let se_rho;
  if (s2 <= 0) {
    se_rho = 1e-12;
  } else {
    const var_rho = s2 * fm / denom;
    se_rho = Math.sqrt(Math.abs(var_rho));
  }
  if (se_rho <= 0) {
    return 0;
  } else {
    return rho / se_rho;
  }
}
export {
  adf_statistic,
  adx,
  bollinger_bands,
  ema,
  hurst_exponent,
  rsi,
  rvol,
  vwap,
  z_score
};
