// trading-core-js/trading-core/lib/regime.js
function classify(realized_vol, trend_strength) {
  if (realized_vol > 0.30) {
    return (
      /* Crisis */
      3
    );
  } else if (realized_vol > 0.20 && trend_strength < 0.5) {
    return (
      /* High_vol_ranging */
      2
    );
  } else if (realized_vol < 0.15 && trend_strength > 1.0) {
    return (
      /* Low_vol_trending */
      0
    );
  } else {
    return (
      /* Normal */
      1
    );
  }
}
function target_allocation(param) {
  switch (param) {
    case /* Low_vol_trending */
    0:
      return {
        mean_reversion: 0.25,
        sector_rotation: 0.1,
        calendar_seasonal: 0.05,
        momentum: 0.4,
        market_making: 0.15,
        cash: 0.05
      };
    case /* Normal */
    1:
      return {
        mean_reversion: 0.3,
        sector_rotation: 0.15,
        calendar_seasonal: 0.1,
        momentum: 0.25,
        market_making: 0.15,
        cash: 0.05
      };
    case /* High_vol_ranging */
    2:
      return {
        mean_reversion: 0.35,
        sector_rotation: 0.1,
        calendar_seasonal: 0.1,
        momentum: 0.1,
        market_making: 0.05,
        cash: 0.3
      };
    case /* Crisis */
    3:
      return {
        mean_reversion: 0.1,
        sector_rotation: 0.05,
        calendar_seasonal: 0.05,
        momentum: 0.05,
        market_making: 0.05,
        cash: 0.7
      };
  }
}
function to_string(param) {
  switch (param) {
    case /* Low_vol_trending */
    0:
      return "Low_vol_trending";
    case /* Normal */
    1:
      return "Normal";
    case /* High_vol_ranging */
    2:
      return "High_vol_ranging";
    case /* Crisis */
    3:
      return "Crisis";
  }
}
export {
  classify,
  target_allocation,
  to_string
};
