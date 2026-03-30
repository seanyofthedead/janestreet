type t = Types.market_regime

(* Classify regime from VIX and ADX values *)
let classify ~vix ~adx =
  if vix > 30.0 then Types.Crisis
  else if vix > 25.0 && adx < 20.0 then High_vol_ranging
  else if vix < 15.0 && adx > 25.0 then Low_vol_trending
  else Normal

(* Target allocation percentages by regime *)
type allocation = {
  mean_reversion: float;
  sector_rotation: float;
  calendar_seasonal: float;
  momentum: float;
  market_making: float;
  cash: float;
}

let target_allocation = function
  | Types.Low_vol_trending -> {
      mean_reversion = 0.25; sector_rotation = 0.10; calendar_seasonal = 0.05;
      momentum = 0.40; market_making = 0.15; cash = 0.05 }
  | Normal -> {
      mean_reversion = 0.30; sector_rotation = 0.15; calendar_seasonal = 0.10;
      momentum = 0.25; market_making = 0.15; cash = 0.05 }
  | High_vol_ranging -> {
      mean_reversion = 0.35; sector_rotation = 0.10; calendar_seasonal = 0.10;
      momentum = 0.10; market_making = 0.05; cash = 0.30 }
  | Crisis -> {
      mean_reversion = 0.10; sector_rotation = 0.05; calendar_seasonal = 0.05;
      momentum = 0.05; market_making = 0.05; cash = 0.70 }

let to_string = function
  | Types.Low_vol_trending -> "Low_vol_trending"
  | Normal -> "Normal"
  | High_vol_ranging -> "High_vol_ranging"
  | Crisis -> "Crisis"
