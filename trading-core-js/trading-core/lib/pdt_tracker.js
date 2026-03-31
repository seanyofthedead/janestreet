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

// trading-core-js/node_modules/melange/int.js
function max(x, y) {
  if (x >= y) {
    return x;
  } else {
    return y;
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

// trading-core-js/trading-core/lib/pdt_tracker.js
function empty(equity) {
  return {
    trades: (
      /* [] */
      0
    ),
    equity
  };
}
var five_business_days_ms = 5 * 24 * 60 * 60 * 1e3;
function prune_old_trades(current_time, trades) {
  return filter((function(trade) {
    const age = current_time - trade.date;
    return age < five_business_days_ms;
  }), trades);
}
function add_trade(tracker, trade) {
  const trades = prune_old_trades(trade.date, {
    hd: trade,
    tl: tracker.trades
  });
  return {
    trades,
    equity: tracker.equity
  };
}
function day_trade_count(tracker) {
  return length(tracker.trades);
}
function trades_remaining(tracker) {
  if (tracker.equity >= 25e3) {
    return 999;
  }
  const used = length(tracker.trades);
  return max(0, 3 - used | 0);
}
function can_day_trade(tracker) {
  return trades_remaining(tracker) > 0;
}
function status(tracker) {
  if (tracker.equity >= 25e3) {
    return (
      /* Unrestricted */
      0
    );
  }
  const used = length(tracker.trades);
  if (used >= 3) {
    return (
      /* Blocked */
      1
    );
  } else {
    return {
      TAG: (
        /* Restricted */
        0
      ),
      trades_used: used
    };
  }
}
export {
  add_trade,
  can_day_trade,
  day_trade_count,
  empty,
  five_business_days_ms,
  prune_old_trades,
  status,
  trades_remaining
};
