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
var compare$1 = caml_float_compare;

// trading-core-js/trading-core/lib/money.js
function of_float(f) {
  return f;
}
function to_float(t) {
  return t;
}
function add2(a, b) {
  return a + b;
}
function sub2(a, b) {
  return a - b;
}
function mul_scalar(t, s) {
  return t * s;
}
function abs(t) {
  return Math.abs(t);
}
function $great(a, b) {
  return compare$1(a, b) > 0;
}
function $less(a, b) {
  return compare$1(a, b) < 0;
}
function $great$eq(a, b) {
  return compare$1(a, b) >= 0;
}
var min2 = min;
var max2 = max;
function negate(t) {
  return -1 * t;
}
var zero2 = 0;
export {
  $great,
  $great$eq,
  $less,
  abs,
  add2 as add,
  max2 as max,
  min2 as min,
  mul_scalar,
  negate,
  of_float,
  sub2 as sub,
  to_float,
  zero2 as zero
};
