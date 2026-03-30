(** Half-Kelly position sizing with phase-aware clamping.
    Ported from the Omaha Oracle allocation model. *)

(** Half-Kelly fraction: f* = (b*p - q) / (2*b)
    where b = avg_win/avg_loss, p = win_prob, q = 1-p.
    Returns fraction of equity to risk (0..1). *)
let half_kelly ~win_prob ~avg_win ~avg_loss =
  if avg_loss <= 0.0 || win_prob <= 0.0 || win_prob >= 1.0 then 0.0
  else
    let b = avg_win /. avg_loss in
    let p = win_prob in
    let q = 1.0 -. p in
    let full_kelly = (b *. p -. q) /. b in
    let hk = full_kelly /. 2.0 in
    Float.max 0.0 (Float.min 0.5 hk)  (* cap at 50% — half-Kelly should never exceed this *)

(** Phase-aware minimum position size.
    Micro:    max($50,  5% of equity)
    Small:    max($125, 3% of equity)
    Medium+:  $2000 *)
let phase_minimum ~equity ~(phase : Types.account_phase) =
  match phase with
  | Micro    -> Float.max 50.0  (0.05 *. equity)
  | Small    -> Float.max 125.0 (0.03 *. equity)
  | Medium   -> 2000.0
  | Standard -> 2000.0

(** Maximum position size: always 15% of equity. *)
let max_position ~equity =
  0.15 *. equity

(** Calculate the dollar-denominated position size.
    @param equity            total account equity
    @param phase             current account phase
    @param kelly_fraction    half-Kelly fraction from half_kelly
    @param signal_confidence signal confidence (0..1)
    @param target_price      target price for the instrument
    Returns Money.t: the notional dollar amount to allocate. *)
let calculate_position_size ~equity ~phase ~kelly_fraction
    ~signal_confidence ~target_price:(_ : Price.t) =
  (* Scale Kelly fraction by signal confidence *)
  let scaled_fraction = kelly_fraction *. signal_confidence in
  (* Raw dollar amount *)
  let raw_amount = equity *. scaled_fraction in
  (* Apply phase minimum and max position clamps *)
  let min_pos = phase_minimum ~equity ~phase in
  let max_pos = max_position ~equity in
  let clamped =
    if raw_amount < min_pos then min_pos
    else if raw_amount > max_pos then max_pos
    else raw_amount
  in
  (* Final safety: never exceed equity *)
  let final = Float.min clamped equity in
  Money.of_float final
