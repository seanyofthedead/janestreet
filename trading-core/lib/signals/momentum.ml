open Trading_core

(** Momentum strategy signal generator.
    EMA 12/26 crossover with 50/200 SMA trend filter, RSI confirmation,
    and relative volume gate. Thresholds configurable via Signal_config. *)

(** Generate a momentum signal.
    @param config      signal configuration (RVOL threshold, RSI levels)
    @param symbol      ticker to trade
    @param ema12       current 12-period EMA
    @param ema26       current 26-period EMA
    @param prev_ema12  previous bar's 12-period EMA
    @param prev_ema26  previous bar's 26-period EMA
    @param sma50       50-period SMA (trend filter)
    @param sma200      200-period SMA (trend filter)
    @param rsi14       14-period RSI value
    @param rel_volume  relative volume (current / average)
    @param price       current price
    @param now         current timestamp *)
let generate ?(config = Signal_config.intraday_defaults.momentum)
    ~symbol ~ema12 ~ema26 ~prev_ema12 ~prev_ema26
    ~sma50 ~sma200 ~rsi14 ~rel_volume ~price ~now () =
  (* Volume gate: configurable RVOL threshold *)
  if rel_volume < config.rvol_threshold then None
  else
    (* Trend filter: 50 SMA above 200 SMA = uptrend, below = downtrend *)
    let uptrend = sma50 > sma200 in
    let downtrend = sma50 < sma200 in
    (* EMA crossover detection *)
    let bullish_cross = prev_ema12 <= prev_ema26 && ema12 > ema26 in
    let bearish_cross = prev_ema12 >= prev_ema26 && ema12 < ema26 in
    (* RSI confirmation *)
    let rsi_oversold = rsi14 < config.rsi_oversold in
    let rsi_overbought = rsi14 > config.rsi_overbought in
    (* Signal logic: crossover in direction of trend with RSI confirmation *)
    let signal_side =
      if bullish_cross && uptrend && not rsi_overbought then Some Types.Buy
      else if bearish_cross && downtrend && not rsi_oversold then Some Types.Sell
      else None
    in
    match signal_side with
    | None -> None
    | Some side ->
      (* Confidence: base 0.6, +0.15 for RSI confirmation, +0.1 for strong RVOL *)
      let base_conf = 0.6 in
      let rsi_bonus =
        match side with
        | Types.Buy -> if rsi_oversold then 0.15 else 0.0
        | Types.Sell -> if rsi_overbought then 0.15 else 0.0
      in
      let vol_bonus = if rel_volume >= config.rvol_strong then 0.1 else 0.0 in
      let conf = Float.min 1.0 (base_conf +. rsi_bonus +. vol_bonus) in
      let strength =
        if conf > 0.8 then Types.Strong conf
        else if conf > 0.5 then Types.Moderate conf
        else Types.Weak conf
      in
      (* Target price: project from EMA difference *)
      let ema_diff = Float.abs (ema12 -. ema26) in
      let target =
        match side with
        | Types.Buy -> price +. ema_diff
        | Types.Sell -> price -. ema_diff
      in
      let sym = match Symbol.create symbol with Ok s -> s | Error _ -> symbol in
      Some ({
        Signal.strategy = Types.Momentum;
        symbol = sym;
        side;
        strength;
        target_price = target;
        max_position_pct = config.max_position_pct;
        timestamp = now;
      } : Signal.t)

(** Check if momentum strategy is enabled for the given phase *)
let is_enabled ~phase =
  Types.strategy_enabled_for_phase phase Types.Momentum
