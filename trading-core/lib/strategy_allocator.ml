(** Capital allocation across strategies.
    Uses regime-based targets adjusted by rolling Sharpe ratio.
    Maturity model governs Kelly sizing and constraint tightness. *)

type strategy_stats = {
  strategy_id: Types.strategy_id;
  sharpe_60d: float;
  maturity: Types.strategy_maturity;
  current_allocation: float;
}

type allocation = {
  strategy_id: Types.strategy_id;
  target_pct: float;   (** target allocation as fraction 0..1 *)
  kelly_mult: float;   (** Kelly multiplier: 0.25 for pilot, 0.5 for others *)
}

(** Kelly multiplier based on strategy maturity. *)
let kelly_multiplier = function
  | Types.Pilot _ -> 0.25          (* quarter-Kelly for pilots *)
  | Types.Evaluated _ -> 0.50      (* half-Kelly *)
  | Types.Mature _ -> 0.50         (* half-Kelly, tighter constraints elsewhere *)

(** Sharpe-based adjustment factor.
    Positive Sharpe increases allocation, negative decreases.
    Capped at +/-30% adjustment. *)
let sharpe_adjustment sharpe =
  let raw = sharpe /. 2.0 in  (* Sharpe of 2.0 -> +100% of base *)
  Float.max (-0.30) (Float.min 0.30 raw)

(** Get regime target for a specific strategy. *)
let regime_target ~(regime : Types.market_regime) ~(strategy : Types.strategy_id) =
  let alloc = Regime.target_allocation regime in
  match strategy with
  | Types.Mean_reversion -> alloc.mean_reversion
  | Types.Sector_rotation -> alloc.sector_rotation
  | Types.Calendar_seasonal -> alloc.calendar_seasonal
  | Types.Momentum -> alloc.momentum
  | Types.Market_making -> alloc.market_making

(** Build allocations from a list of enabled strategy stats *)
let build_allocations ~regime (enabled : strategy_stats list) =
  (* Step 1: compute raw targets from regime + Sharpe adjustment *)
  let raw_targets =
    List.map (fun (s : strategy_stats) ->
      let base = regime_target ~regime ~strategy:s.strategy_id in
      let adj = sharpe_adjustment s.sharpe_60d in
      let target = base *. (1.0 +. adj) in
      (s, Float.max 0.0 target)
    ) enabled
  in
  (* Step 2: normalize so allocations sum to <= 1.0 *)
  let total_raw =
    List.fold_left (fun acc (_, t) -> acc +. t) 0.0 raw_targets
  in
  let scale = if total_raw > 1.0 then 1.0 /. total_raw else 1.0 in
  let scaled =
    List.map (fun (s, t) -> (s, t *. scale)) raw_targets
  in
  (* Step 3: apply constraints -- min 10%, max 60% per active strategy *)
  let n_active = List.length scaled in
  let min_alloc = Float.max 0.10 (1.0 /. Float.of_int (n_active * 10)) in
  let constrained =
    List.map (fun (s, t) ->
      let t' = Float.max min_alloc (Float.min 0.60 t) in
      (s, t')
    ) scaled
  in
  (* Step 4: re-normalize after constraint application *)
  let total_constrained =
    List.fold_left (fun acc (_, t) -> acc +. t) 0.0 constrained
  in
  let final_scale =
    if total_constrained > 1.0 then 1.0 /. total_constrained else 1.0
  in
  List.map (fun ((s : strategy_stats), t) ->
    { strategy_id = s.strategy_id;
      target_pct = t *. final_scale;
      kelly_mult = kelly_multiplier s.maturity;
    }
  ) constrained

(** Allocate capital across strategies.
    @param regime  current market regime
    @param stats   per-strategy statistics
    @param phase   current account phase
    Returns allocation list with target percentages. *)
let allocate ~regime ~(stats : strategy_stats list) ~phase =
  (* Filter to strategies enabled for this phase *)
  let enabled =
    List.filter (fun (s : strategy_stats) ->
      Types.strategy_enabled_for_phase phase s.strategy_id
    ) stats
  in
  match enabled with
  | [] -> []
  | _ -> build_allocations ~regime enabled
