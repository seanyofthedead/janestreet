(** Core trading types - make illegal states unrepresentable.
    Jane Street style: sum types for state machines, Result for errors. *)

type side = Buy | Sell

type strategy_id =
  | Mean_reversion
  | Sector_rotation
  | Calendar_seasonal
  | Momentum
  | Market_making

type signal_strength =
  | Strong of float    (** confidence > 0.8 *)
  | Moderate of float  (** 0.5 < confidence <= 0.8 *)
  | Weak of float      (** confidence <= 0.5 *)

type risk_action =
  | Allow
  | Reduce_size of float
  | Reject of string
  | Flatten_all of string
  | Kill_switch of string

type engine_state =
  | Starting
  | Warming_up
  | Trading
  | Off_hours
  | Read_only
  | Cooldown of { until: float; reason: string }
  | Halted of { reason: string }

type account_phase =
  | Micro      (** < $2,500 *)
  | Small      (** $2,500 - $10,000 *)
  | Medium     (** $10,000 - $25,000 *)
  | Standard   (** $25,000+ *)

type pdt_status =
  | Unrestricted
  | Restricted of { trades_used: int }
  | Blocked

type market_regime =
  | Low_vol_trending
  | Normal
  | High_vol_ranging
  | Crisis

type strategy_maturity =
  | Pilot of { days_active: int }
  | Evaluated of { sharpe: float }
  | Mature of { sharpe: float; correlation: float array }

(** Determine account phase from equity *)
let phase_of_equity equity =
  if equity < 2500.0 then Micro
  else if equity < 10000.0 then Small
  else if equity < 25000.0 then Medium
  else Standard

(** Check if a strategy is enabled for a given phase *)
let strategy_enabled_for_phase phase strategy =
  match phase, strategy with
  | Micro, Mean_reversion -> true
  | Micro, Sector_rotation -> true
  | Micro, Calendar_seasonal -> true
  | Micro, Momentum -> false
  | Micro, Market_making -> false
  | Small, Market_making -> false
  | Small, _ -> true
  | Medium, _ -> true
  | Standard, _ -> true

(** Trivial test function for integration verification *)
let hello () = "Trading Core v0.1.0 - OCaml/Melange"

(** Version info for JS interop verification *)
let version = "0.1.0"
