(** Pure indicator computations — no side effects, no mutable state.
    Each function computes a single incremental update or statistic. *)

(** Exponential moving average: incremental update.
    alpha = 2 / (period + 1) *)
let ema ~period ~prev ~price =
  let alpha = 2.0 /. (Float.of_int period +. 1.0) in
  alpha *. price +. (1.0 -. alpha) *. prev

(** Relative Strength Index from average gains/losses.
    RSI = 100 - 100/(1 + RS) where RS = avg_gain / avg_loss *)
let rsi ~gains ~losses =
  if losses <= 0.0 then 100.0
  else
    let rs = gains /. losses in
    100.0 -. (100.0 /. (1.0 +. rs))

(** Bollinger Bands from pre-computed SMA and standard deviation. *)
type bollinger = { upper: float; middle: float; lower: float }

let bollinger_bands ~sma ~std_dev ~multiplier =
  { upper = sma +. multiplier *. std_dev;
    middle = sma;
    lower = sma -. multiplier *. std_dev }

(** Z-score: how many standard deviations from the mean. *)
let z_score ~value ~mean ~std_dev =
  if std_dev <= 0.0 then 0.0
  else (value -. mean) /. std_dev

(** Relative volume: current volume vs average. *)
let rvol ~current_volume ~avg_volume =
  if avg_volume <= 0.0 then 0.0
  else current_volume /. avg_volume

(** Volume-weighted average price from cumulative totals. *)
let vwap ~cumulative_tp_vol ~cumulative_vol =
  if cumulative_vol <= 0.0 then 0.0
  else cumulative_tp_vol /. cumulative_vol

(** Simplified ADX from directional indicators.
    ADX smoothed = ((prev * (period-1)) + current_dx) / period *)
let adx ~plus_di ~minus_di ~prev_adx ~period =
  let di_sum = plus_di +. minus_di in
  let dx =
    if di_sum <= 0.0 then 0.0
    else Float.abs (plus_di -. minus_di) /. di_sum *. 100.0
  in
  let p = Float.of_int period in
  (prev_adx *. (p -. 1.0) +. dx) /. p

(** Simplified Hurst exponent via rescaled range (R/S) analysis.
    H > 0.5 = trending, H < 0.5 = mean-reverting, H ~ 0.5 = random walk.
    Uses a single-scale R/S estimate for speed. *)
let hurst_exponent ~(returns : float array) =
  let n = Array.length returns in
  if n < 20 then 0.5
  else
    let mean =
      let sum = Array.fold_left (fun acc x -> acc +. x) 0.0 returns in
      sum /. Float.of_int n
    in
    let deviations = Array.map (fun x -> x -. mean) returns in
    let cumdev = Array.make n 0.0 in
    for i = 0 to n - 1 do
      cumdev.(i) <-
        (if i = 0 then deviations.(i)
         else cumdev.(i - 1) +. deviations.(i))
    done;
    let r =
      let mx = Array.fold_left Float.max Float.neg_infinity cumdev in
      let mn = Array.fold_left Float.min Float.infinity cumdev in
      mx -. mn
    in
    let s =
      let var =
        let sum_sq =
          Array.fold_left (fun acc d -> acc +. d *. d) 0.0 deviations
        in
        sum_sq /. Float.of_int n
      in
      Float.sqrt var
    in
    if s <= 0.0 then 0.5
    else
      let rs = r /. s in
      if rs <= 0.0 then 0.5
      else Float.log rs /. Float.log (Float.of_int n)

(** Simplified Augmented Dickey-Fuller statistic.
    Computes t-stat of OLS regression: dy(t) = rho * y(t-1) + e.
    More negative = more stationary.  Threshold: < -2.86 ~ p<0.05. *)
let adf_statistic ~(series : float array) =
  let n = Array.length series in
  if n < 10 then 0.0
  else
    let m = n - 1 in
    let fm = Float.of_int m in
    let sum_xy = ref 0.0 in
    let sum_x = ref 0.0 in
    let sum_y = ref 0.0 in
    let sum_x2 = ref 0.0 in
    for t = 1 to n - 1 do
      let dy = series.(t) -. series.(t - 1) in
      let x = series.(t - 1) in
      sum_xy := !sum_xy +. x *. dy;
      sum_x := !sum_x +. x;
      sum_y := !sum_y +. dy;
      sum_x2 := !sum_x2 +. x *. x
    done;
    let denom = fm *. !sum_x2 -. !sum_x *. !sum_x in
    if Float.abs denom < 1e-12 then 0.0
    else
      let rho = (fm *. !sum_xy -. !sum_x *. !sum_y) /. denom in
      let intercept = (!sum_y -. rho *. !sum_x) /. fm in
      let sse = ref 0.0 in
      for t = 1 to n - 1 do
        let dy = series.(t) -. series.(t - 1) in
        let x = series.(t - 1) in
        let predicted = intercept +. rho *. x in
        let e = dy -. predicted in
        sse := !sse +. e *. e
      done;
      let se_rho =
        let s2 = !sse /. (fm -. 2.0) in
        if s2 <= 0.0 then 1e-12
        else
          let var_rho = s2 *. fm /. denom in
          Float.sqrt (Float.abs var_rho)
      in
      if se_rho <= 0.0 then 0.0
      else rho /. se_rho
