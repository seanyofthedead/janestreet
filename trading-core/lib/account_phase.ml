(** Account phase logic - determines trading capabilities based on equity. *)

let determine_phase (equity : float) : Types.account_phase =
  Types.phase_of_equity equity

let min_position_size (phase : Types.account_phase) (equity : float) : Money.t =
  let pct = match phase with
    | Micro -> 0.05
    | Small -> 0.03
    | Medium -> 0.02
    | Standard -> 0.01
  in
  Money.of_float (equity *. pct)

let max_positions (phase : Types.account_phase) : int =
  match phase with
  | Micro -> 3
  | Small -> 6
  | Medium -> 12
  | Standard -> 20

let strategies_enabled (phase : Types.account_phase) : Types.strategy_id list =
  match phase with
  | Micro -> [ Mean_reversion; Sector_rotation; Calendar_seasonal ]
  | Small -> [ Mean_reversion; Sector_rotation; Calendar_seasonal; Momentum ]
  | Medium -> [ Mean_reversion; Sector_rotation; Calendar_seasonal; Momentum; Market_making ]
  | Standard -> [ Mean_reversion; Sector_rotation; Calendar_seasonal; Momentum; Market_making ]

let use_notional_orders (phase : Types.account_phase) : bool =
  match phase with
  | Micro | Small -> true
  | Medium | Standard -> false
