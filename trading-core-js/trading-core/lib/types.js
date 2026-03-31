// trading-core-js/trading-core/lib/types.js
function phase_of_equity(equity) {
  if (equity < 2500) {
    return (
      /* Micro */
      0
    );
  } else if (equity < 1e4) {
    return (
      /* Small */
      1
    );
  } else if (equity < 25e3) {
    return (
      /* Medium */
      2
    );
  } else {
    return (
      /* Standard */
      3
    );
  }
}
function strategy_enabled_for_phase(phase, strategy) {
  switch (phase) {
    case /* Micro */
    0:
      switch (strategy) {
        case /* Momentum */
        3:
        case /* Market_making */
        4:
          return false;
        default:
          return true;
      }
    case /* Small */
    1:
      if (strategy === /* Market_making */
      4) {
        return false;
      } else {
        return true;
      }
    case /* Medium */
    2:
    case /* Standard */
    3:
      return true;
  }
}
function hello(param) {
  return "Trading Core v0.1.0 - OCaml/Melange";
}
var version = "0.1.0";
export {
  hello,
  phase_of_equity,
  strategy_enabled_for_phase,
  version
};
