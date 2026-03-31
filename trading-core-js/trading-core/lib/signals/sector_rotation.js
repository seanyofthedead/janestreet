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

// trading-core-js/node_modules/melange.js/caml.js
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

// trading-core-js/node_modules/melange/sys.js
var executable_name = caml_sys_executable_name();
var os_type2 = os_type();
var unix = os_type() === "Unix";
var win32 = os_type() === "Win32";
var max_array_length = 2147483647;

// trading-core-js/node_modules/melange/obj.js
var max_ephe_length = max_array_length - 2 | 0;

// trading-core-js/node_modules/melange/array.js
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
function exists(p, a) {
  const n = a.length;
  let _i = 0;
  while (true) {
    const i = _i;
    if (i === n) {
      return false;
    }
    if (_1(p, a[i])) {
      return true;
    }
    _i = i + 1 | 0;
    continue;
  }
  ;
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
function rev_append(_l1, _l2) {
  while (true) {
    const l2 = _l2;
    const l1 = _l1;
    if (!l1) {
      return l2;
    }
    _l2 = {
      hd: l1.hd,
      tl: l2
    };
    _l1 = l1.tl;
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
function filteri_dps(_dst, _offset, p, _i, _param) {
  while (true) {
    const dst = _dst;
    const offset = _offset;
    const i = _i;
    const param = _param;
    if (!param) {
      dst[offset] = /* [] */
      0;
      return;
    }
    const l = param.tl;
    const x = param.hd;
    const i$p = i + 1 | 0;
    if (_2(p, i, x)) {
      const block = {
        hd: x,
        tl: 24029
      };
      dst[offset] = block;
      _param = l;
      _i = i$p;
      _offset = "tl";
      _dst = block;
      continue;
    }
    _param = l;
    _i = i$p;
    continue;
  }
  ;
}
function filteri(p, l) {
  let _i = 0;
  let _param = l;
  while (true) {
    const param = _param;
    const i = _i;
    if (!param) {
      return (
        /* [] */
        0
      );
    }
    const l$1 = param.tl;
    const x = param.hd;
    const i$p = i + 1 | 0;
    if (_2(p, i, x)) {
      const block = {
        hd: x,
        tl: 24029
      };
      filteri_dps(block, "tl", p, i$p, l$1);
      return block;
    }
    _param = l$1;
    _i = i$p;
    continue;
  }
  ;
}
function stable_sort(cmp, l) {
  const rev_merge = function(_l1, _l2, _accu) {
    while (true) {
      const accu = _accu;
      const l2 = _l2;
      const l1 = _l1;
      if (!l1) {
        return rev_append(l2, accu);
      }
      if (!l2) {
        return rev_append(l1, accu);
      }
      const h2 = l2.hd;
      const h1 = l1.hd;
      if (_2(cmp, h1, h2) <= 0) {
        _accu = {
          hd: h1,
          tl: accu
        };
        _l1 = l1.tl;
        continue;
      }
      _accu = {
        hd: h2,
        tl: accu
      };
      _l2 = l2.tl;
      continue;
    }
    ;
  };
  const rev_merge_rev = function(_l1, _l2, _accu) {
    while (true) {
      const accu = _accu;
      const l2 = _l2;
      const l1 = _l1;
      if (!l1) {
        return rev_append(l2, accu);
      }
      if (!l2) {
        return rev_append(l1, accu);
      }
      const h2 = l2.hd;
      const h1 = l1.hd;
      if (_2(cmp, h1, h2) > 0) {
        _accu = {
          hd: h1,
          tl: accu
        };
        _l1 = l1.tl;
        continue;
      }
      _accu = {
        hd: h2,
        tl: accu
      };
      _l2 = l2.tl;
      continue;
    }
    ;
  };
  const sort2 = function(n, l2) {
    if (n !== 2) {
      if (n === 3 && l2) {
        const match = l2.tl;
        if (match) {
          const match$1 = match.tl;
          if (match$1) {
            const x3 = match$1.hd;
            const x2 = match.hd;
            const x1 = l2.hd;
            const s = _2(cmp, x1, x2) <= 0 ? _2(cmp, x2, x3) <= 0 ? {
              hd: x1,
              tl: {
                hd: x2,
                tl: {
                  hd: x3,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x1, x3) <= 0 ? {
              hd: x1,
              tl: {
                hd: x3,
                tl: {
                  hd: x2,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : {
              hd: x3,
              tl: {
                hd: x1,
                tl: {
                  hd: x2,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x1, x3) <= 0 ? {
              hd: x2,
              tl: {
                hd: x1,
                tl: {
                  hd: x3,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x2, x3) <= 0 ? {
              hd: x2,
              tl: {
                hd: x3,
                tl: {
                  hd: x1,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : {
              hd: x3,
              tl: {
                hd: x2,
                tl: {
                  hd: x1,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            };
            return [
              s,
              match$1.tl
            ];
          }
        }
      }
    } else if (l2) {
      const match$2 = l2.tl;
      if (match$2) {
        const x2$1 = match$2.hd;
        const x1$1 = l2.hd;
        const s$1 = _2(cmp, x1$1, x2$1) <= 0 ? {
          hd: x1$1,
          tl: {
            hd: x2$1,
            tl: (
              /* [] */
              0
            )
          }
        } : {
          hd: x2$1,
          tl: {
            hd: x1$1,
            tl: (
              /* [] */
              0
            )
          }
        };
        return [
          s$1,
          match$2.tl
        ];
      }
    }
    const n1 = n >> 1;
    const n2 = n - n1 | 0;
    const match$3 = rev_sort(n1, l2);
    const match$4 = rev_sort(n2, match$3[1]);
    return [
      rev_merge_rev(
        match$3[0],
        match$4[0],
        /* [] */
        0
      ),
      match$4[1]
    ];
  };
  const rev_sort = function(n, l2) {
    if (n !== 2) {
      if (n === 3 && l2) {
        const match = l2.tl;
        if (match) {
          const match$1 = match.tl;
          if (match$1) {
            const x3 = match$1.hd;
            const x2 = match.hd;
            const x1 = l2.hd;
            const s = _2(cmp, x1, x2) > 0 ? _2(cmp, x2, x3) > 0 ? {
              hd: x1,
              tl: {
                hd: x2,
                tl: {
                  hd: x3,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x1, x3) > 0 ? {
              hd: x1,
              tl: {
                hd: x3,
                tl: {
                  hd: x2,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : {
              hd: x3,
              tl: {
                hd: x1,
                tl: {
                  hd: x2,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x1, x3) > 0 ? {
              hd: x2,
              tl: {
                hd: x1,
                tl: {
                  hd: x3,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : _2(cmp, x2, x3) > 0 ? {
              hd: x2,
              tl: {
                hd: x3,
                tl: {
                  hd: x1,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            } : {
              hd: x3,
              tl: {
                hd: x2,
                tl: {
                  hd: x1,
                  tl: (
                    /* [] */
                    0
                  )
                }
              }
            };
            return [
              s,
              match$1.tl
            ];
          }
        }
      }
    } else if (l2) {
      const match$2 = l2.tl;
      if (match$2) {
        const x2$1 = match$2.hd;
        const x1$1 = l2.hd;
        const s$1 = _2(cmp, x1$1, x2$1) > 0 ? {
          hd: x1$1,
          tl: {
            hd: x2$1,
            tl: (
              /* [] */
              0
            )
          }
        } : {
          hd: x2$1,
          tl: {
            hd: x1$1,
            tl: (
              /* [] */
              0
            )
          }
        };
        return [
          s$1,
          match$2.tl
        ];
      }
    }
    const n1 = n >> 1;
    const n2 = n - n1 | 0;
    const match$3 = sort2(n1, l2);
    const match$4 = sort2(n2, match$3[1]);
    return [
      rev_merge(
        match$3[0],
        match$4[0],
        /* [] */
        0
      ),
      match$4[1]
    ];
  };
  const len = length(l);
  if (len < 2) {
    return l;
  } else {
    return sort2(len, l)[0];
  }
}
var filter = find_all;
var sort = stable_sort;

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
var compare$1 = caml_float_compare;

// trading-core-js/node_modules/melange/string.js
function equal(prim0, prim1) {
  return prim0 === prim1;
}

// trading-core-js/trading-core/lib/signals/sector_rotation.js
import * as Trading_core__Symbol from "../symbol.js";
var sector_etfs = [
  "XLK",
  "XLF",
  "XLE",
  "XLV",
  "XLI",
  "XLU",
  "XLC",
  "XLP",
  "XLB",
  "XLRE",
  "XLY"
];
function formation_return(s) {
  return s.return_6m - s.return_1m;
}
function generate(sectors, is_month_end, now) {
  if (!is_month_end) {
    return (
      /* [] */
      0
    );
  }
  const with_formation = map((function(s) {
    return [
      s,
      formation_return(s)
    ];
  }), to_list(sectors));
  const positive = filter((function(param) {
    return param[1] > 0;
  }), with_formation);
  const make_signal = function(sym, side, conf) {
    const s = Trading_core__Symbol.create(sym);
    let s$1;
    s$1 = s.TAG === /* Ok */
    0 ? s._0 : sym;
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
        /* Sector_rotation */
        1
      ),
      symbol: s$1,
      side,
      strength,
      target_price: 0,
      max_position_pct: 0.15,
      timestamp: now
    };
  };
  if (length(positive) === 0) {
    return {
      hd: make_signal(
        "BND",
        /* Buy */
        0,
        0.6
      ),
      tl: (
        /* [] */
        0
      )
    };
  }
  const sorted = sort((function(param, param$1) {
    return compare$1(param$1[1], param[1]);
  }), positive);
  const top_n = filteri((function(i, param) {
    return i < 2;
  }), sorted);
  const max_fr = top_n ? max(top_n.hd[1], 0.01) : 0.01;
  return map((function(param) {
    const conf = min(1, 0.5 + 0.5 * param[1] / max_fr);
    return make_signal(
      param[0].symbol,
      /* Buy */
      0,
      conf
    );
  }), top_n);
}
function is_sector_etf(sym) {
  return exists((function(s) {
    return equal(s, sym);
  }), sector_etfs);
}
export {
  formation_return,
  generate,
  is_sector_etf,
  sector_etfs
};
