/**
 * Phase simulator: tracks account phase transitions during backtest.
 * Uses OCaml types.phase_of_equity for phase determination and applies
 * PDT constraints when equity < $25K.
 */

// @ts-expect-error Melange-compiled JS has no type declarations
import { phase_of_equity, strategy_enabled_for_phase } from '../../trading-core-js/trading-core/lib/types.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { max_positions, strategies_enabled } from '../../trading-core-js/trading-core/lib/account_phase.js';

import type { PdtTracker } from './pdt-tracker.js';
import { canDayTrade } from './pdt-tracker.js';

/**
 * Account phases matching OCaml types:
 *   Micro = 0, Small = 1, Medium = 2, Standard = 3
 */
export type Phase = 0 | 1 | 2 | 3;

export const PhaseLabel: Record<Phase, string> = {
  0: 'Micro',
  1: 'Small',
  2: 'Medium',
  3: 'Standard',
};

/**
 * Strategy enum matching OCaml:
 *   Mean_reversion = 0, Sector_rotation = 1, Calendar_seasonal = 2,
 *   Momentum = 3, Market_making = 4
 */
export type Strategy = 0 | 1 | 2 | 3 | 4;

export const StrategyLabel: Record<Strategy, string> = {
  0: 'Mean_reversion',
  1: 'Sector_rotation',
  2: 'Calendar_seasonal',
  3: 'Momentum',
  4: 'Market_making',
};

export interface PhaseState {
  phase: Phase;
  equity: number;
  maxPositions: number;
  enabledStrategies: Strategy[];
  pdtRestricted: boolean;
}

/**
 * Determine current phase from equity using OCaml phase_of_equity.
 */
export function determinePhase(equity: number): Phase {
  return phase_of_equity(equity) as Phase;
}

/**
 * Check if a strategy is enabled for a given phase.
 */
export function isStrategyEnabled(phase: Phase, strategy: Strategy): boolean {
  return strategy_enabled_for_phase(phase, strategy) as boolean;
}

/**
 * Get max positions for a phase.
 */
export function getMaxPositions(phase: Phase): number {
  return max_positions(phase) as number;
}

/**
 * Flatten Melange linked list to JS array.
 */
function melangeListToArray<T>(list: unknown): T[] {
  const result: T[] = [];
  let current = list as { hd: T; tl: unknown } | 0;
  while (current !== 0 && typeof current === 'object' && current !== null) {
    result.push(current.hd);
    current = current.tl as { hd: T; tl: unknown } | 0;
  }
  return result;
}

/**
 * Get all enabled strategies for the given phase.
 */
export function getEnabledStrategies(phase: Phase): Strategy[] {
  return melangeListToArray<Strategy>(strategies_enabled(phase));
}

/**
 * Compute the full phase state from equity and PDT tracker.
 */
export function computePhaseState(equity: number, pdtTracker: PdtTracker): PhaseState {
  const phase = determinePhase(equity);
  const enabled = getEnabledStrategies(phase);
  return {
    phase,
    equity,
    maxPositions: getMaxPositions(phase),
    enabledStrategies: enabled,
    pdtRestricted: !canDayTrade(pdtTracker),
  };
}

/**
 * Filter a list of strategy IDs to only those enabled in the current phase.
 * If pdtRestricted, day-trade-heavy strategies remain enabled but the caller
 * must check canDayTrade before opening new positions.
 */
export function filterStrategies(
  requestedStrategies: Strategy[],
  phase: Phase,
): Strategy[] {
  return requestedStrategies.filter(s => isStrategyEnabled(phase, s));
}

/**
 * Phase transition boundaries for reference:
 *   equity < $2,500  -> Micro (0)
 *   equity < $10,000 -> Small (1)
 *   equity < $25,000 -> Medium (2)
 *   equity >= $25,000 -> Standard (3)
 */
export const PHASE_THRESHOLDS = {
  MICRO_MAX: 2_500,
  SMALL_MAX: 10_000,
  MEDIUM_MAX: 25_000,
} as const;
