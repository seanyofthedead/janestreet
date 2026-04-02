/**
 * Shared types for strategy modules.
 * Re-exports core types so consumers don't need to know the original source.
 */

/** Strategy identifier matching the OCaml strategy variant */
export type StrategyId = 0 | 1 | 2 | 3 | 4;

/** Signal object compatible with OCaml risk engine */
export interface StrategySignal {
  strategy: StrategyId;
  symbol: string;
  side: number; // 0 = Buy, 1 = Sell
  strength: { TAG: number; _0: number }; // Strong=0, Moderate=1, Weak=2
  target_price: number;
  max_position_pct: number;
  timestamp: number;
}

/** Market data snapshot for a single symbol */
export interface SymbolMarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  bars: Array<{ o: number; h: number; l: number; c: number; v: number }>;
}

/** Regime enum (mirrors OCaml): 0=Low_vol_trending, 1=Normal, 2=High_vol_ranging, 3=Crisis */
export type Regime = 0 | 1 | 2 | 3;

/** Phase enum: 0=Micro, 1=Small, 2=Medium, 3=Standard */
export type Phase = 0 | 1 | 2 | 3;

/** Interface that all strategy modules must implement */
export interface StrategyModule {
  id: StrategyId;
  name: string;
  minBars: number;
  /** Override default miss threshold (300) for health tracking */
  missThreshold?: number;
  /** Override default recovery threshold (10) for health tracking */
  recoveryThreshold?: number;
  generate: (data: SymbolMarketData, regime: Regime) => StrategySignal | null;
}
