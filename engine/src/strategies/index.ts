/**
 * Strategy registry — canonical source for all strategy modules and names.
 */

import type { StrategyId, StrategyModule } from './types.js';
import meanReversion from './mean-reversion.js';
import sectorRotation from './sector-rotation.js';
import calendarSeasonal from './calendar-seasonal.js';
import momentum from './momentum.js';
import marketMaking from './market-making.js';

/** All registered strategy modules */
export const STRATEGY_REGISTRY: readonly StrategyModule[] = [
  meanReversion,
  sectorRotation,
  calendarSeasonal,
  momentum,
  marketMaking,
];

/** Canonical strategy name lookup by ID */
export const STRATEGY_NAMES: Record<StrategyId, string> = Object.fromEntries(
  STRATEGY_REGISTRY.map((m) => [m.id, m.name]),
) as Record<StrategyId, string>;

// Re-export types for consumer convenience
export type { StrategyId, StrategySignal, SymbolMarketData, Regime, Phase, StrategyModule } from './types.js';
