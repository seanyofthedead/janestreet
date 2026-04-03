open Trading_core

(** Mean reversion strategy signal generator.
    Entry on z-score extremes, exit at mean, with stationarity gating.
    Thresholds are configurable via Signal_config for different timeframes. *)

(** Generate a mean reversion signal.
    @param config    signal configuration (thresholds for ADF, Hurst, z-score)
    @param symbol    ticker to trade
    @param price     current market price (unused, kept for interface consistency)
    @param sma20     20-period simple moving average
    @param std_dev20 20-period standard deviation (unused, kept for interface consistency)
    @param z         z-score of current price vs SMA(20)
    @param adf_stat  augmented Dickey-Fuller test statistic
    @param hurst     Hurst exponent of recent returns
    @param now       current timestamp *)
let generate ?(config = Signal_config.intraday_defaults.mean_reversion)
    ~symbol ~price:(_price : float) ~sma20 ~std_dev20:_ ~z ~adf_stat ~hurst ~now () =
  (* Stationarity gate: configurable thresholds *)
  let is_stationary =
    adf_stat < config.adf_threshold && hurst < config.hurst_threshold
  in
  if not is_stationary then None
  else
    (* Determine signal direction from z-score *)
    let signal_side =
      if z <= -.(config.z_entry_threshold) then Some Types.Buy
      else if z >= config.z_entry_threshold then Some Types.Sell
      else if Float.abs z < config.z_exit_threshold then None
      else None
    in
    match signal_side with
    | None -> None
    | Some side ->
      (* Confidence: scale linearly from 0.5 at entry threshold to 1.0 at stop threshold *)
      let abs_z = Float.abs z in
      let range = config.z_stop_threshold -. config.z_entry_threshold in
      let raw_conf =
        if range <= 0.0 then 1.0
        else (abs_z -. config.z_entry_threshold) /. range
      in
      let conf = Float.max 0.5 (Float.min 1.0 (0.5 +. raw_conf *. 0.5)) in
      let strength =
        if conf > 0.8 then Types.Strong conf
        else if conf > 0.5 then Types.Moderate conf
        else Types.Weak conf
      in
      let target_price = sma20 in
      let sym = match Symbol.create symbol with Ok s -> s | Error _ -> symbol in
      Some ({
        Signal.strategy = Types.Mean_reversion;
        symbol = sym;
        side;
        strength;
        target_price;
        max_position_pct = config.max_position_pct;
        timestamp = now;
      } : Signal.t)

(** Check if we should exit: z-score near zero *)
let should_exit ?(config = Signal_config.intraday_defaults.mean_reversion) ~z =
  Float.abs z < config.z_exit_threshold

(** Check if stop is hit: z-score beyond stop threshold *)
let is_stopped ?(config = Signal_config.intraday_defaults.mean_reversion) ~z =
  Float.abs z >= config.z_stop_threshold

(** Quick check: is the series suitable for mean reversion? *)
let passes_stationarity_gate ?(config = Signal_config.intraday_defaults.mean_reversion) ~adf_stat ~hurst =
  adf_stat < config.adf_threshold && hurst < config.hurst_threshold
