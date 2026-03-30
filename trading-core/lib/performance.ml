(** Performance metrics computation.
    Pure functions for Sharpe, Sortino, drawdown, win rate, profit factor. *)

type metrics = {
  sharpe: float;
  sortino: float;
  max_drawdown: float;
  win_rate: float;
  profit_factor: float;
  trade_count: int;
  avg_win: float;
  avg_loss: float;
}

(** Annualization factor: sqrt(252 trading days). *)
let sqrt_252 = Float.sqrt 252.0

(** Mean of a float array. Returns 0. for empty arrays. *)
let mean arr =
  let n = Array.length arr in
  if n = 0 then 0.0
  else Array.fold_left (fun acc x -> acc +. x) 0.0 arr /. Float.of_int n

(** Standard deviation (population). *)
let std_dev arr =
  let n = Array.length arr in
  if n < 2 then 0.0
  else
    let m = mean arr in
    let sum_sq = Array.fold_left (fun acc x ->
      let d = x -. m in acc +. d *. d
    ) 0.0 arr in
    Float.sqrt (sum_sq /. Float.of_int n)

(** Downside deviation -- std dev of negative returns only (below target). *)
let downside_dev arr ~target =
  let n = Array.length arr in
  if n < 2 then 0.0
  else
    let sum_sq = Array.fold_left (fun acc x ->
      let d = Float.min 0.0 (x -. target) in
      acc +. d *. d
    ) 0.0 arr in
    Float.sqrt (sum_sq /. Float.of_int n)

(** Maximum drawdown from a return series (simple returns).
    Computes cumulative equity curve and finds worst peak-to-trough. *)
let max_drawdown returns =
  let n = Array.length returns in
  if n = 0 then 0.0
  else begin
    let peak = ref 1.0 in
    let max_dd = ref 0.0 in
    let equity = ref 1.0 in
    for i = 0 to n - 1 do
      equity := !equity *. (1.0 +. returns.(i));
      if !equity > !peak then peak := !equity;
      let dd = (!peak -. !equity) /. !peak in
      if dd > !max_dd then max_dd := dd
    done;
    !max_dd
  end

(** Calculate comprehensive performance metrics from a return series. *)
let calculate_metrics ~(returns : float array) ~(risk_free_rate : float) =
  let n = Array.length returns in
  if n = 0 then
    { sharpe = 0.0; sortino = 0.0; max_drawdown = 0.0;
      win_rate = 0.0; profit_factor = 0.0; trade_count = 0;
      avg_win = 0.0; avg_loss = 0.0 }
  else
    let daily_rf = risk_free_rate /. 252.0 in
    let m = mean returns in
    let sd = std_dev returns in
    let dd = downside_dev returns ~target:daily_rf in

    (* Sharpe ratio annualized *)
    let sharpe =
      if sd < 1e-12 then 0.0
      else (m -. daily_rf) /. sd *. sqrt_252
    in
    (* Sortino ratio annualized *)
    let sortino =
      if dd < 1e-12 then 0.0
      else (m -. daily_rf) /. dd *. sqrt_252
    in
    (* Win / loss stats *)
    let wins = Array.to_list returns |> List.filter (fun x -> x > 0.0) in
    let losses = Array.to_list returns |> List.filter (fun x -> x < 0.0) in
    let n_wins = List.length wins in
    let n_losses = List.length losses in
    let sum_wins = List.fold_left (fun a x -> a +. x) 0.0 wins in
    let sum_losses = List.fold_left (fun a x -> a +. Float.abs x) 0.0 losses in
    let win_rate = Float.of_int n_wins /. Float.of_int n in
    let profit_factor =
      if sum_losses < 1e-12 then
        if sum_wins > 0.0 then Float.infinity else 0.0
      else sum_wins /. sum_losses
    in
    let avg_win = if n_wins > 0 then sum_wins /. Float.of_int n_wins else 0.0 in
    let avg_loss = if n_losses > 0 then sum_losses /. Float.of_int n_losses else 0.0 in
    { sharpe; sortino;
      max_drawdown = max_drawdown returns;
      win_rate; profit_factor;
      trade_count = n;
      avg_win; avg_loss }

(** Rolling Sharpe over a window (default 60-day).
    Returns the Sharpe computed from the last [window] returns. *)
let rolling_sharpe ~(returns : float array) ~(window : int) =
  let n = Array.length returns in
  if n = 0 || window <= 0 then 0.0
  else
    let w = min window n in
    let start = n - w in
    let slice = Array.sub returns start w in
    let m = mean slice in
    let sd = std_dev slice in
    if sd < 1e-12 then 0.0
    else m /. sd *. sqrt_252
