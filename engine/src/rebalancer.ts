/**
 * Strategy rebalancer: computes target allocations based on regime,
 * rolling Sharpe, maturity model, and account phase constraints.
 */

import pino from 'pino';
import type { StrategyMetrics } from './performance-tracker.js';
import type { StrategyId, Regime, Phase } from './strategy-runner.js';
import { STRATEGY_NAMES } from './strategy-runner.js';

// ---------------------------------------------------------------------------
// Melange-compiled modules
// ---------------------------------------------------------------------------

import * as RegimeMod from '../../trading-core-js/trading-core/lib/regime.js';
import * as Types from '../../trading-core-js/trading-core/lib/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyPerf {
  strategyId: StrategyId;
  name: string;
  metrics: StrategyMetrics;
  rollingSharpe60d: number;
  maturity: 'pilot' | 'evaluated' | 'mature';
}

export interface Allocation {
  strategyId: StrategyId;
  name: string;
  targetPct: number;
  kellyMult: number;
}

export interface RebalanceResult {
  allocations: Allocation[];
  timestamp: number;
  regime: Regime;
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_ALLOCATION = 0.10;
const MAX_ALLOCATION = 0.60;
const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
const DEVIATION_THRESHOLD = 0.05; // 5% absolute

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Kelly multiplier based on strategy maturity.
 * Pilot = quarter-Kelly, Evaluated/Mature = half-Kelly.
 */
function kellyMultiplier(maturity: 'pilot' | 'evaluated' | 'mature'): number {
  switch (maturity) {
    case 'pilot':
      return 0.25;
    case 'evaluated':
    case 'mature':
      return 0.50;
  }
}

/**
 * Map regime enum to the field keys in OCaml Regime.target_allocation.
 */
function getRegimeAllocation(regime: Regime): Record<string, number> {
  const alloc = RegimeMod.target_allocation(regime);
  return {
    Mean_reversion: alloc.mean_reversion,
    Sector_rotation: alloc.sector_rotation,
    Calendar_seasonal: alloc.calendar_seasonal,
    Momentum: alloc.momentum,
    Market_making: alloc.market_making,
  };
}

/**
 * Strategies enabled for a given account phase.
 * Mirrors OCaml Types.strategy_enabled_for_phase.
 */
function enabledStrategies(phase: Phase): Set<StrategyId> {
  const all: StrategyId[] = [0, 1, 2, 3, 4];
  const enabled = new Set<StrategyId>();
  for (const s of all) {
    if (Types.strategy_enabled_for_phase(phase, s)) {
      enabled.add(s);
    }
  }
  return enabled;
}

/**
 * Sharpe-based adjustment: positive Sharpe increases allocation, negative decreases.
 * Capped at +/- 30%.
 */
function sharpeAdjustment(sharpe: number): number {
  const raw = sharpe / 2.0;
  return Math.max(-0.30, Math.min(0.30, raw));
}

// ---------------------------------------------------------------------------
// Rebalancer
// ---------------------------------------------------------------------------

export class Rebalancer {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino({ name: 'rebalancer' });
  }

  /**
   * Compute new target allocations.
   *
   * 1. Start from regime base allocation (OCaml regime.ml).
   * 2. Adjust by rolling 60-day Sharpe: over-weight high, under-weight low.
   * 3. Apply constraints: min 10%, max 60% per active strategy.
   * 4. Apply maturity-based Kelly multiplier.
   * 5. Filter strategies not enabled for the current account phase.
   */
  rebalance(
    strategyPerfs: StrategyPerf[],
    regime: Regime,
    phase: Phase,
    reason: string = 'scheduled',
  ): RebalanceResult {
    const enabled = enabledStrategies(phase);
    const regimeAlloc = getRegimeAllocation(regime);

    // Filter to enabled strategies only
    const active = strategyPerfs.filter((sp) => enabled.has(sp.strategyId));

    if (active.length === 0) {
      return { allocations: [], timestamp: Date.now(), regime, reason };
    }

    // Step 1: raw targets = regime base * (1 + sharpe adjustment)
    const rawTargets = active.map((sp) => {
      const base = regimeAlloc[sp.name] ?? 0;
      const adj = sharpeAdjustment(sp.rollingSharpe60d);
      return { sp, target: Math.max(0, base * (1 + adj)) };
    });

    // Step 2: normalize so sum <= 1.0
    const totalRaw = rawTargets.reduce((s, r) => s + r.target, 0);
    const scale = totalRaw > 1.0 ? 1.0 / totalRaw : 1.0;
    const scaled = rawTargets.map((r) => ({
      ...r,
      target: r.target * scale,
    }));

    // Step 3: apply min/max constraints
    const constrained = scaled.map((r) => ({
      ...r,
      target: Math.max(MIN_ALLOCATION, Math.min(MAX_ALLOCATION, r.target)),
    }));

    // Step 4: re-normalize after constraints
    const totalConstrained = constrained.reduce((s, r) => s + r.target, 0);
    const finalScale = totalConstrained > 1.0 ? 1.0 / totalConstrained : 1.0;

    const allocations: Allocation[] = constrained.map((r) => ({
      strategyId: r.sp.strategyId,
      name: r.sp.name,
      targetPct: r.target * finalScale,
      kellyMult: kellyMultiplier(r.sp.maturity),
    }));

    this.logger.info(
      { regime, phase, reason, allocations: allocations.map((a) => ({ name: a.name, pct: (a.targetPct * 100).toFixed(1) })) },
      'rebalance computed',
    );

    return { allocations, timestamp: Date.now(), regime, reason };
  }

  /**
   * Determine whether a rebalance should be triggered.
   *
   * Conditions (any triggers rebalance):
   * - Weekly minimum interval has elapsed.
   * - Any strategy's current vs target allocation deviates by >= 5% absolute.
   * - Regime has changed (regimeChanged flag).
   */
  shouldRebalance(
    lastRebalanceTimestamp: number,
    currentAllocations: Map<StrategyId, number>,
    targetAllocations: Allocation[],
    regimeChanged: boolean = false,
  ): { should: boolean; reason: string } {
    // Regime change is immediate
    if (regimeChanged) {
      return { should: true, reason: 'regime_change' };
    }

    // Weekly minimum interval
    const elapsed = Date.now() - lastRebalanceTimestamp;
    if (elapsed >= WEEKLY_MS) {
      return { should: true, reason: 'weekly_interval' };
    }

    // Deviation threshold
    for (const target of targetAllocations) {
      const current = currentAllocations.get(target.strategyId) ?? 0;
      const deviation = Math.abs(current - target.targetPct);
      if (deviation >= DEVIATION_THRESHOLD) {
        return {
          should: true,
          reason: `deviation_${target.name}_${(deviation * 100).toFixed(1)}pct`,
        };
      }
    }

    return { should: false, reason: 'no_trigger' };
  }
}
