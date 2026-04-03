(** Configurable signal generation thresholds.
    Allows tuning gates for different bar timeframes (daily vs intraday). *)

type mean_reversion_config = {
  adf_threshold: float;       (** ADF statistic must be below this (more negative = more stationary) *)
  hurst_threshold: float;     (** Hurst exponent must be below this (< 0.5 = mean-reverting) *)
  z_entry_threshold: float;   (** |z-score| must exceed this to generate entry signal *)
  z_exit_threshold: float;    (** |z-score| below this triggers exit *)
  z_stop_threshold: float;    (** |z-score| above this triggers stop *)
  max_position_pct: float;    (** maximum position size as fraction of equity *)
}

type momentum_config = {
  rvol_threshold: float;      (** relative volume must exceed this *)
  rsi_oversold: float;        (** RSI below this = oversold *)
  rsi_overbought: float;      (** RSI above this = overbought *)
  rvol_strong: float;         (** RVOL above this gives vol bonus to confidence *)
  max_position_pct: float;    (** maximum position size as fraction of equity *)
}

type t = {
  mean_reversion: mean_reversion_config;
  momentum: momentum_config;
}

(** Default thresholds for daily bars (original calibration). *)
let daily_defaults = {
  mean_reversion = {
    adf_threshold = -2.86;
    hurst_threshold = 0.50;
    z_entry_threshold = 2.0;
    z_exit_threshold = 0.5;
    z_stop_threshold = 3.0;
    max_position_pct = 0.15;
  };
  momentum = {
    rvol_threshold = 1.5;
    rsi_oversold = 30.0;
    rsi_overbought = 70.0;
    rvol_strong = 2.0;
    max_position_pct = 0.15;
  };
}

(** Calibrated thresholds for 1-minute intraday bars.
    Based on empirical analysis of SPY 1-min data (Jan-Mar 2026):
    - ADF relaxed from -2.86 to -1.50 (11.6% combined pass rate vs 0.62%)
    - Hurst relaxed from 0.50 to 0.55 (1-min data has slight trending bias)
    - Z-entry relaxed from 2.0 to 1.5 (28.5% pass rate vs 11.3%)
    - RVOL relaxed from 1.5 to 1.1 (30% pass rate vs 18.5%)
    Profitability at these thresholds: mean reversion 52% win rate, +0.48 bps avg. *)
let intraday_defaults = {
  mean_reversion = {
    adf_threshold = -1.50;
    hurst_threshold = 0.55;
    z_entry_threshold = 1.5;
    z_exit_threshold = 0.5;
    z_stop_threshold = 2.5;
    max_position_pct = 0.15;
  };
  momentum = {
    rvol_threshold = 1.1;
    rsi_oversold = 30.0;
    rsi_overbought = 70.0;
    rvol_strong = 2.0;
    max_position_pct = 0.15;
  };
}
