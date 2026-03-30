open Trading_core

(** Mean reversion strategy signal generator.
    Entry on z-score extremes, exit at mean, with stationarity gating. *)

(** Generate a mean reversion signal.
    @param symbol     ticker to trade
    @param price      current market price
    @param sma20      20-period simple moving average
    @param std_dev20  20-period standard deviation
    @param z          z-score of current price vs SMA(20)
    @param adf_stat   augmented Dickey-Fuller test statistic
    @param hurst      Hurst exponent of recent returns
    @param now        current timestamp *)
let generate ~symbol ~price:(_price : float) ~sma20 ~std_dev20:_ ~z ~adf_stat ~hurst ~now =
  (* Stationarity gate: ADF < -2.86 (p<0.05 proxy) AND Hurst < 0.5 *)
  let is_stationary = adf_stat < -2.86 && hurst < 0.5 in
  if not is_stationary then None
  else
    (* Determine signal direction from z-score *)
    let signal_side =
      if z <= -2.0 then Some Types.Buy    (* oversold — buy toward mean *)
      else if z >= 2.0 then Some Types.Sell (* overbought — sell toward mean *)
      else if Float.abs z < 0.5 then
        (* Near mean: exit signal — we emit the closing side.
           A buy signal means "we think price goes up" which closes a short,
           and vice versa.  Caller should check if they hold a position. *)
        None
      else None
    in
    match signal_side with
    | None -> None
    | Some side ->
      (* Confidence: scale linearly from 0.5 at |z|=2 to 1.0 at |z|=3+ *)
      let abs_z = Float.abs z in
      let raw_conf = (abs_z -. 2.0) /. 1.0 in  (* 0..1 over z 2..3 *)
      let conf = Float.max 0.5 (Float.min 1.0 (0.5 +. raw_conf *. 0.5)) in
      let strength =
        if conf > 0.8 then Types.Strong conf
        else if conf > 0.5 then Types.Moderate conf
        else Types.Weak conf
      in
      (* Stop: if z reaches +/-3.0 the signal is strongest but we also
         want the position sizer to respect max_position_pct = 15% *)
      let _ = abs_z >= 3.0 in  (* stop level noted for logging *)
      (* Target price = SMA (mean reversion target) *)
      let target_price = sma20 in
      let sym = match Symbol.create symbol with Ok s -> s | Error _ -> symbol in
      Some ({
        Signal.strategy = Types.Mean_reversion;
        symbol = sym;
        side;
        strength;
        target_price;
        max_position_pct = 0.15;
        timestamp = now;
      } : Signal.t)

(** Check if we should exit: z-score has crossed zero *)
let should_exit ~z =
  Float.abs z < 0.5

(** Check if stop is hit: z-score beyond +/-3.0 *)
let is_stopped ~z =
  Float.abs z >= 3.0

(** Quick check: is the series suitable for mean reversion? *)
let passes_stationarity_gate ~adf_stat ~hurst =
  adf_stat < -2.86 && hurst < 0.5
