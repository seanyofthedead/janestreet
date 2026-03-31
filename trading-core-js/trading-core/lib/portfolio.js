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

// trading-core-js/node_modules/melange.js/caml_option.js
function some(x) {
  if (x === void 0) {
    return {
      MEL_PRIVATE_NESTED_SOME_NONE: 0
    };
  } else if (x !== null && x.MEL_PRIVATE_NESTED_SOME_NONE !== void 0) {
    return {
      MEL_PRIVATE_NESTED_SOME_NONE: x.MEL_PRIVATE_NESTED_SOME_NONE + 1 | 0
    };
  } else {
    return x;
  }
}

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
function find_opt(p, _param) {
  while (true) {
    const param = _param;
    if (!param) {
      return;
    }
    const x = param.hd;
    if (_1(p, x)) {
      return some(x);
    }
    _param = param.tl;
    continue;
  }
  ;
}

// trading-core-js/trading-core/lib/portfolio.js
import * as Trading_core__Money from "./money.js";
import * as Trading_core__Position from "./position.js";
import * as Trading_core__Symbol from "./symbol.js";
var empty = {
  positions: (
    /* [] */
    0
  ),
  cash: Trading_core__Money.zero,
  equity: Trading_core__Money.zero,
  buying_power: Trading_core__Money.zero,
  daily_pnl: Trading_core__Money.zero,
  total_pnl: Trading_core__Money.zero
};
function total_market_value(portfolio) {
  return fold_left((function(acc, pos) {
    return Trading_core__Money.add(acc, Trading_core__Position.market_value(pos));
  }), Trading_core__Money.zero, portfolio.positions);
}
function total_unrealized_pnl(portfolio) {
  return fold_left((function(acc, pos) {
    return Trading_core__Money.add(acc, Trading_core__Position.unrealized_pnl(pos));
  }), Trading_core__Money.zero, portfolio.positions);
}
function position_count(portfolio) {
  return length(portfolio.positions);
}
function gross_exposure(portfolio) {
  return fold_left((function(acc, pos) {
    return Trading_core__Money.add(acc, Trading_core__Money.abs(Trading_core__Position.market_value(pos)));
  }), Trading_core__Money.zero, portfolio.positions);
}
function net_exposure(portfolio) {
  return fold_left((function(acc, pos) {
    return Trading_core__Money.add(acc, Trading_core__Position.market_value(pos));
  }), Trading_core__Money.zero, portfolio.positions);
}
function concentration(portfolio, symbol) {
  const eq = Trading_core__Money.to_float(portfolio.equity);
  if (eq === 0) {
    return 0;
  }
  const pos_value = fold_left((function(acc, pos) {
    if (Trading_core__Symbol.equal(pos.symbol, symbol)) {
      return Trading_core__Money.add(acc, Trading_core__Money.abs(Trading_core__Position.market_value(pos)));
    } else {
      return acc;
    }
  }), Trading_core__Money.zero, portfolio.positions);
  return Trading_core__Money.to_float(pos_value) / eq;
}
function find_position(portfolio, symbol) {
  return find_opt((function(pos) {
    return Trading_core__Symbol.equal(pos.symbol, symbol);
  }), portfolio.positions);
}
function cash_pct(portfolio) {
  const eq = Trading_core__Money.to_float(portfolio.equity);
  if (eq === 0) {
    return 100;
  } else {
    return Trading_core__Money.to_float(portfolio.cash) / eq * 100;
  }
}
export {
  cash_pct,
  concentration,
  empty,
  find_position,
  gross_exposure,
  net_exposure,
  position_count,
  total_market_value,
  total_unrealized_pnl
};
