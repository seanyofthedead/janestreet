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
function get(xs, index) {
  if (index < 0 || index >= xs.length) {
    throw new MelangeError("Invalid_argument", {
      MEL_EXN_ID: "Invalid_argument",
      _1: "index out of bounds"
    });
  }
  return xs[index];
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

// trading-core-js/node_modules/melange/sys.js
var executable_name = caml_sys_executable_name();
var os_type2 = os_type();
var unix = os_type() === "Unix";
var win32 = os_type() === "Win32";
var max_array_length = 2147483647;

// trading-core-js/node_modules/melange/obj.js
var max_ephe_length = max_array_length - 2 | 0;

// trading-core-js/node_modules/melange/array.js
function sub2(a, ofs, len) {
  if (ofs < 0 || len < 0 || ofs > (a.length - len | 0)) {
    throw new MelangeError("Invalid_argument", {
      MEL_EXN_ID: "Invalid_argument",
      _1: "Array.sub"
    });
  }
  return sub(a, ofs, len);
}
function to_list(a) {
  let _i = a.length - 1 | 0;
  let _res = (
    /* [] */
    0
  );
  while (true) {
    const res = _res;
    const i = _i;
    if (i < 0) {
      return res;
    }
    _res = {
      hd: a[i],
      tl: res
    };
    _i = i - 1 | 0;
    continue;
  }
  ;
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

// trading-core-js/node_modules/melange/list.js
function length(l) {
  let _len = 0;
  let _param = l;
  while (true) {
    const param = _param;
    const len = _len;
    if (!param) {
      return len;
    }
    _param = param.tl;
    _len = len + 1 | 0;
    continue;
  }
  ;
}
function fold_left3(f, _accu, _l) {
  while (true) {
    const l = _l;
    const accu = _accu;
    if (!l) {
      return accu;
    }
    _l = l.tl;
    _accu = _2(f, accu, l.hd);
    continue;
  }
  ;
}
function find_all(p, _param) {
  while (true) {
    const param = _param;
    if (!param) {
      return (
        /* [] */
        0
      );
    }
    const l = param.tl;
    const x = param.hd;
    if (_1(p, x)) {
      const block = {
        hd: x,
        tl: 24029
      };
      find_all_dps(block, "tl", p, l);
      return block;
    }
    _param = l;
    continue;
  }
  ;
}
function find_all_dps(_dst, _offset, p, _param) {
  while (true) {
    const dst = _dst;
    const offset = _offset;
    const param = _param;
    if (!param) {
      dst[offset] = /* [] */
      0;
      return;
    }
    const l = param.tl;
    const x = param.hd;
    if (_1(p, x)) {
      const block = {
        hd: x,
        tl: 24029
      };
      dst[offset] = block;
      _param = l;
      _offset = "tl";
      _dst = block;
      continue;
    }
    _param = l;
    continue;
  }
  ;
}
var filter = find_all;

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
var infinity2 = infinity;

// trading-core-js/trading-core/lib/performance.js
var sqrt_252 = Math.sqrt(252);
function mean(arr) {
  const n = arr.length;
  if (n === 0) {
    return 0;
  } else {
    return fold_left2((function(acc, x) {
      return acc + x;
    }), 0, arr) / n;
  }
}
function std_dev(arr) {
  const n = arr.length;
  if (n < 2) {
    return 0;
  }
  const m = mean(arr);
  const sum_sq = fold_left2((function(acc, x) {
    const d = x - m;
    return acc + d * d;
  }), 0, arr);
  return Math.sqrt(sum_sq / n);
}
function downside_dev(arr, target) {
  const n = arr.length;
  if (n < 2) {
    return 0;
  }
  const sum_sq = fold_left2((function(acc, x) {
    const d = min(0, x - target);
    return acc + d * d;
  }), 0, arr);
  return Math.sqrt(sum_sq / n);
}
function max_drawdown(returns) {
  const n = returns.length;
  if (n === 0) {
    return 0;
  }
  let peak = 1;
  let max_dd = 0;
  let equity = 1;
  for (let i = 0; i < n; ++i) {
    equity = equity * (1 + get(returns, i));
    if (equity > peak) {
      peak = equity;
    }
    const dd = (peak - equity) / peak;
    if (dd > max_dd) {
      max_dd = dd;
    }
  }
  return max_dd;
}
function calculate_metrics(returns, risk_free_rate) {
  const n = returns.length;
  if (n === 0) {
    return {
      sharpe: 0,
      sortino: 0,
      max_drawdown: 0,
      win_rate: 0,
      profit_factor: 0,
      trade_count: 0,
      avg_win: 0,
      avg_loss: 0
    };
  }
  const daily_rf = risk_free_rate / 252;
  const m = mean(returns);
  const sd = std_dev(returns);
  const dd = downside_dev(returns, daily_rf);
  const sharpe = sd < 1e-12 ? 0 : (m - daily_rf) / sd * sqrt_252;
  const sortino = dd < 1e-12 ? 0 : (m - daily_rf) / dd * sqrt_252;
  const wins = filter((function(x) {
    return x > 0;
  }), to_list(returns));
  const losses = filter((function(x) {
    return x < 0;
  }), to_list(returns));
  const n_wins = length(wins);
  const n_losses = length(losses);
  const sum_wins = fold_left3((function(a, x) {
    return a + x;
  }), 0, wins);
  const sum_losses = fold_left3((function(a, x) {
    return a + Math.abs(x);
  }), 0, losses);
  const win_rate = n_wins / n;
  const profit_factor = sum_losses < 1e-12 ? sum_wins > 0 ? infinity2 : 0 : sum_wins / sum_losses;
  const avg_win = n_wins > 0 ? sum_wins / n_wins : 0;
  const avg_loss = n_losses > 0 ? sum_losses / n_losses : 0;
  return {
    sharpe,
    sortino,
    max_drawdown: max_drawdown(returns),
    win_rate,
    profit_factor,
    trade_count: n,
    avg_win,
    avg_loss
  };
}
function rolling_sharpe(returns, $$window) {
  const n = returns.length;
  if (n === 0 || $$window <= 0) {
    return 0;
  }
  const w = $$window < n ? $$window : n;
  const start = n - w | 0;
  const slice = sub2(returns, start, w);
  const m = mean(slice);
  const sd = std_dev(slice);
  if (sd < 1e-12) {
    return 0;
  } else {
    return m / sd * sqrt_252;
  }
}
export {
  calculate_metrics,
  downside_dev,
  max_drawdown,
  mean,
  rolling_sharpe,
  sqrt_252,
  std_dev
};
