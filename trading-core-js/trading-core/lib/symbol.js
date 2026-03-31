// trading-core-js/node_modules/melange.js/caml.js
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

// trading-core-js/node_modules/melange.js/caml_bytes.js
function caml_create_bytes(len) {
  if (len < 0) {
    throw new MelangeError("Invalid_argument", {
      MEL_EXN_ID: "Invalid_argument",
      _1: "String.create"
    });
  }
  const result = new Array(len);
  for (let i = 0; i < len; ++i) {
    result[i] = /* '\000' */
    0;
  }
  return result;
}
function bytes_to_string(a) {
  let i = 0;
  let len = a.length;
  let s = "";
  let s_len = len;
  if (i === 0 && len <= 4096 && len === a.length) {
    return String.fromCharCode.apply(null, a);
  }
  let offset = 0;
  while (s_len > 0) {
    const next = s_len < 1024 ? s_len : 1024;
    const tmp_bytes = new Array(next);
    for (let k = 0; k < next; ++k) {
      tmp_bytes[k] = a[k + offset | 0];
    }
    s = s + String.fromCharCode.apply(null, tmp_bytes);
    s_len = s_len - next | 0;
    offset = offset + next | 0;
  }
  ;
  return s;
}
function bytes_of_string(s) {
  const len = s.length;
  const res = new Array(len);
  for (let i = 0; i < len; ++i) {
    res[i] = s.charCodeAt(i);
  }
  return res;
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

// trading-core-js/node_modules/melange/char.js
function uppercase_ascii(c) {
  if (c > 122 || c < 97) {
    return c;
  } else {
    return c - 32 | 0;
  }
}

// trading-core-js/node_modules/melange/bytes.js
function map(f, s) {
  const l = s.length;
  if (l === 0) {
    return s;
  }
  const r = caml_create_bytes(l);
  for (let i = 0; i < l; ++i) {
    r[i] = _1(f, s[i]);
  }
  return r;
}
function uppercase_ascii2(s) {
  return map(uppercase_ascii, s);
}

// trading-core-js/node_modules/melange/string.js
function uppercase_ascii3(s) {
  return bytes_to_string(uppercase_ascii2(bytes_of_string(s)));
}
var compare = caml_string_compare;
function equal(prim0, prim1) {
  return prim0 === prim1;
}

// trading-core-js/trading-core/lib/symbol.js
function create2(s) {
  const s$1 = uppercase_ascii3(s);
  if (s$1.length >= 1 && s$1.length <= 5) {
    return {
      TAG: (
        /* Ok */
        0
      ),
      _0: s$1
    };
  } else {
    return {
      TAG: (
        /* Error */
        1
      ),
      _0: "Invalid symbol: " + s$1
    };
  }
}
function to_string3(t) {
  return t;
}
var equal2 = equal;
var compare2 = compare;
export {
  compare2 as compare,
  create2 as create,
  equal2 as equal,
  to_string3 as to_string
};
