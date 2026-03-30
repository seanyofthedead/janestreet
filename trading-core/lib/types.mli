type side = Buy | Sell

type strategy_id =
  | Mean_reversion
  | Sector_rotation
  | Calendar_seasonal
  | Momentum
  | Market_making

type signal_strength =
  | Strong of float
  | Moderate of float
  | Weak of float

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
  | Micro
  | Small
  | Medium
  | Standard

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

val phase_of_equity : float -> account_phase
val strategy_enabled_for_phase : account_phase -> strategy_id -> bool
val hello : unit -> string
val version : string
