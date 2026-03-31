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
function map_dps(_dst, _offset, f, _param) {
  while (true) {
    const dst = _dst;
    const offset = _offset;
    const param = _param;
    if (!param) {
      dst[offset] = /* [] */
      0;
      return;
    }
    const match = param.tl;
    const a1 = param.hd;
    if (match) {
      const r1 = _1(f, a1);
      const r2 = _1(f, match.hd);
      const block = {
        hd: r2,
        tl: 24029
      };
      dst[offset] = {
        hd: r1,
        tl: block
      };
      _param = match.tl;
      _offset = "tl";
      _dst = block;
      continue;
    }
    const r1$1 = _1(f, a1);
    dst[offset] = {
      hd: r1$1,
      tl: (
        /* [] */
        0
      )
    };
    return;
  }
  ;
}
function map(f, param) {
  if (!param) {
    return (
      /* [] */
      0
    );
  }
  const match = param.tl;
  const a1 = param.hd;
  if (match) {
    const r1 = _1(f, a1);
    const r2 = _1(f, match.hd);
    const block = {
      hd: r2,
      tl: 24029
    };
    return {
      hd: r1,
      tl: (map_dps(block, "tl", f, match.tl), block)
    };
  }
  const r1$1 = _1(f, a1);
  return {
    hd: r1$1,
    tl: (
      /* [] */
      0
    )
  };
}
function fold_left(f, _accu, _l) {
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

// trading-core-js/trading-core/lib/strategy_allocator.js
import * as Trading_core__Regime from "./regime.js";
import * as Trading_core__Types from "./types.js";
function kelly_multiplier(param) {
  switch (param.TAG) {
    case /* Pilot */
    0:
      return 0.25;
    case /* Evaluated */
    1:
    case /* Mature */
    2:
      return 0.5;
  }
}
function sharpe_adjustment(sharpe) {
  const raw = sharpe / 2;
  return max(-0.3, min(0.3, raw));
}
function regime_target(regime, strategy) {
  const alloc = Trading_core__Regime.target_allocation(regime);
  switch (strategy) {
    case /* Mean_reversion */
    0:
      return alloc.mean_reversion;
    case /* Sector_rotation */
    1:
      return alloc.sector_rotation;
    case /* Calendar_seasonal */
    2:
      return alloc.calendar_seasonal;
    case /* Momentum */
    3:
      return alloc.momentum;
    case /* Market_making */
    4:
      return alloc.market_making;
  }
}
function build_allocations(regime, enabled) {
  const raw_targets = map((function(s) {
    const base = regime_target(regime, s.strategy_id);
    const adj = sharpe_adjustment(s.sharpe_60d);
    const target = base * (1 + adj);
    return [
      s,
      max(0, target)
    ];
  }), enabled);
  const total_raw = fold_left((function(acc, param) {
    return acc + param[1];
  }), 0, raw_targets);
  const scale = total_raw > 1 ? 1 / total_raw : 1;
  const scaled = map((function(param) {
    return [
      param[0],
      param[1] * scale
    ];
  }), raw_targets);
  const n_active = length(scaled);
  const min_alloc = max(0.1, 1 / Math.imul(n_active, 10));
  const constrained = map((function(param) {
    const t$p = max(min_alloc, min(0.6, param[1]));
    return [
      param[0],
      t$p
    ];
  }), scaled);
  const total_constrained = fold_left((function(acc, param) {
    return acc + param[1];
  }), 0, constrained);
  const final_scale = total_constrained > 1 ? 1 / total_constrained : 1;
  return map((function(param) {
    const s = param[0];
    return {
      strategy_id: s.strategy_id,
      target_pct: param[1] * final_scale,
      kelly_mult: kelly_multiplier(s.maturity)
    };
  }), constrained);
}
function allocate(regime, stats, phase) {
  const enabled = filter((function(s) {
    return Trading_core__Types.strategy_enabled_for_phase(phase, s.strategy_id);
  }), stats);
  if (enabled) {
    return build_allocations(regime, enabled);
  } else {
    return (
      /* [] */
      0
    );
  }
}
export {
  allocate,
  build_allocations,
  kelly_multiplier,
  regime_target,
  sharpe_adjustment
};
