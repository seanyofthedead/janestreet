/**
 * Tests for Melange-compiled OCaml modules.
 * Verifies the actual OCaml trading core works correctly when called from TypeScript.
 * Unlike orchestrator.test.ts (which replicates logic locally), these tests
 * exercise the real Melange output.
 */

import { describe, it, expect } from 'vitest';

// Import actual Melange-compiled modules (resolved via vitest.config.ts aliases)
// @ts-expect-error - Melange-compiled JS modules lack TS declarations
import * as EngineState from '../../trading-core-js/trading-core/lib/engine_state.js';
// @ts-expect-error
import * as Signal from '../../trading-core-js/trading-core/lib/signal.js';
// @ts-expect-error
import * as Types from '../../trading-core-js/trading-core/lib/types.js';
// @ts-expect-error
import * as Performance from '../../trading-core-js/trading-core/lib/performance.js';
// @ts-expect-error
import * as Regime from '../../trading-core-js/trading-core/lib/regime.js';

// ---------------------------------------------------------------------------
// Module import smoke test
// ---------------------------------------------------------------------------

describe('OCaml module imports', () => {
  it('EngineState exports expected functions', () => {
    expect(typeof EngineState.apply_transition).toBe('function');
    expect(typeof EngineState.is_trading_allowed).toBe('function');
    expect(typeof EngineState.is_data_processing_allowed).toBe('function');
    expect(typeof EngineState.to_string).toBe('function');
  });

  it('Signal exports expected functions', () => {
    expect(typeof Signal.confidence).toBe('function');
    expect(typeof Signal.is_actionable).toBe('function');
    expect(typeof Signal.compare_priority).toBe('function');
    expect(typeof Signal.strategy_priority).toBe('function');
  });

  it('Types exports expected functions and constants', () => {
    expect(typeof Types.phase_of_equity).toBe('function');
    expect(typeof Types.strategy_enabled_for_phase).toBe('function');
    expect(typeof Types.hello).toBe('function');
    expect(Types.version).toBe('0.1.0');
    expect(Types.hello()).toBe('Trading Core v0.1.0 - OCaml/Melange');
  });

  it('Performance exports expected functions', () => {
    expect(typeof Performance.calculate_metrics).toBe('function');
    expect(typeof Performance.rolling_sharpe).toBe('function');
    expect(typeof Performance.max_drawdown).toBe('function');
    expect(typeof Performance.mean).toBe('function');
    expect(typeof Performance.std_dev).toBe('function');
  });

  it('Regime exports expected functions', () => {
    expect(typeof Regime.classify).toBe('function');
    expect(typeof Regime.target_allocation).toBe('function');
    expect(typeof Regime.to_string).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// EngineState — state machine transitions
// ---------------------------------------------------------------------------

describe('OCaml EngineState.apply_transition', () => {
  it('Starting + Watchdog_connected -> Warming_up', () => {
    const r = EngineState.apply_transition(0, 0);
    expect(r.TAG).toBe(0); // Ok
    expect(r._0).toBe(1); // Warming_up
  });

  it('Warming_up + Warmup_complete -> Trading', () => {
    const r = EngineState.apply_transition(1, 1);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(2); // Trading
  });

  it('Trading + Market_close -> Off_hours', () => {
    const r = EngineState.apply_transition(2, 3);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(3); // Off_hours
  });

  it('Off_hours + Market_open -> Warming_up', () => {
    const r = EngineState.apply_transition(3, 2);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(1); // Warming_up
  });

  it('Trading + Watchdog_lost -> Read_only', () => {
    const r = EngineState.apply_transition(2, 4);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(4); // Read_only
  });

  it('Trading + Data_gap -> Read_only', () => {
    const r = EngineState.apply_transition(2, 5);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(4); // Read_only
  });

  it('Read_only + Data_recovered -> Trading', () => {
    const r = EngineState.apply_transition(4, 6);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(2); // Trading
  });

  it('Read_only + Watchdog_recovered -> Trading', () => {
    const r = EngineState.apply_transition(4, 7);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(2); // Trading
  });

  it('Trading + Flatten_triggered -> Cooldown', () => {
    const r = EngineState.apply_transition(2, { TAG: 0, _0: 'drawdown' });
    expect(r.TAG).toBe(0);
    expect(r._0.TAG).toBe(0); // Cooldown
    expect(r._0.reason).toBe('drawdown');
    expect(typeof r._0.until).toBe('number');
  });

  it('Trading + Kill_triggered -> Halted', () => {
    const r = EngineState.apply_transition(2, { TAG: 1, _0: 'heartbeat timeout' });
    expect(r.TAG).toBe(0);
    expect(r._0.TAG).toBe(1); // Halted
    expect(r._0.reason).toBe('heartbeat timeout');
  });

  it('Cooldown + Cooldown_expired -> Warming_up', () => {
    const cooldown = { TAG: 0, until: Date.now() / 1000, reason: 'test' };
    const r = EngineState.apply_transition(cooldown, 8);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(1); // Warming_up
  });

  it('Halted + Human_acknowledged -> Starting', () => {
    const halted = { TAG: 1, reason: 'test' };
    const r = EngineState.apply_transition(halted, 9);
    expect(r.TAG).toBe(0);
    expect(r._0).toBe(0); // Starting
  });

  it('Any + Restart -> Starting', () => {
    expect(EngineState.apply_transition(2, 10)._0).toBe(0);
    expect(EngineState.apply_transition(3, 10)._0).toBe(0);
    expect(EngineState.apply_transition(4, 10)._0).toBe(0);
  });

  it('rejects invalid transitions', () => {
    const r = EngineState.apply_transition(0, 3); // Starting + Market_close
    expect(r.TAG).toBe(1); // Error
  });

  it('Off_hours + Kill_triggered -> Halted', () => {
    const r = EngineState.apply_transition(3, { TAG: 1, _0: 'test' });
    expect(r.TAG).toBe(0);
    expect(r._0.TAG).toBe(1); // Halted
  });

  it('Read_only + Kill_triggered -> Halted', () => {
    const r = EngineState.apply_transition(4, { TAG: 1, _0: 'test' });
    expect(r.TAG).toBe(0);
    expect(r._0.TAG).toBe(1); // Halted
  });
});

describe('OCaml EngineState helpers', () => {
  it('is_trading_allowed only for Trading state', () => {
    expect(EngineState.is_trading_allowed(0)).toBe(false); // Starting
    expect(EngineState.is_trading_allowed(1)).toBe(false); // Warming_up
    expect(EngineState.is_trading_allowed(2)).toBe(true);  // Trading
    expect(EngineState.is_trading_allowed(3)).toBe(false); // Off_hours
    expect(EngineState.is_trading_allowed(4)).toBe(false); // Read_only
  });

  it('is_data_processing_allowed for all except Starting', () => {
    expect(EngineState.is_data_processing_allowed(0)).toBe(false); // Starting
    expect(EngineState.is_data_processing_allowed(1)).toBe(true);  // Warming_up
    expect(EngineState.is_data_processing_allowed(2)).toBe(true);  // Trading
    expect(EngineState.is_data_processing_allowed(3)).toBe(true);  // Off_hours
    expect(EngineState.is_data_processing_allowed(4)).toBe(true);  // Read_only
  });

  it('to_string for all simple states', () => {
    expect(EngineState.to_string(0)).toBe('Starting');
    expect(EngineState.to_string(1)).toBe('Warming_up');
    expect(EngineState.to_string(2)).toBe('Trading');
    expect(EngineState.to_string(3)).toBe('Off_hours');
    expect(EngineState.to_string(4)).toBe('Read_only');
  });

  it('to_string for compound states', () => {
    expect(EngineState.to_string({ TAG: 0, until: 0, reason: 'drawdown' }))
      .toBe('Cooldown(drawdown)');
    expect(EngineState.to_string({ TAG: 1, reason: 'heartbeat' }))
      .toBe('Halted(heartbeat)');
  });
});

// ---------------------------------------------------------------------------
// Signal module
// ---------------------------------------------------------------------------

describe('OCaml Signal module', () => {
  it('is_actionable allows Strong signals', () => {
    expect(Signal.is_actionable({ strength: { TAG: 0, _0: 0.9 } })).toBe(true);
  });

  it('is_actionable allows Moderate signals', () => {
    expect(Signal.is_actionable({ strength: { TAG: 1, _0: 0.5 } })).toBe(true);
  });

  it('is_actionable rejects Weak signals', () => {
    expect(Signal.is_actionable({ strength: { TAG: 2, _0: 0.3 } })).toBe(false);
  });

  it('confidence extracts strength value', () => {
    expect(Signal.confidence({ strength: { TAG: 0, _0: 0.85 } })).toBe(0.85);
    expect(Signal.confidence({ strength: { TAG: 2, _0: 0.25 } })).toBe(0.25);
  });

  it('strategy_priority returns correct values', () => {
    expect(Signal.strategy_priority(0)).toBe(3); // Mean_reversion highest
    expect(Signal.strategy_priority(1)).toBe(2); // Sector_rotation
    expect(Signal.strategy_priority(2)).toBe(1); // Calendar_seasonal
    expect(Signal.strategy_priority(3)).toBe(2); // Momentum
    expect(Signal.strategy_priority(4)).toBe(0); // Market_making lowest
  });

  it('compare_priority: higher confidence wins', () => {
    const a = { strategy: 0, strength: { TAG: 0, _0: 0.9 } };
    const b = { strategy: 3, strength: { TAG: 0, _0: 0.8 } };
    expect(Signal.compare_priority(a, b)).toBeLessThan(0); // a first
  });

  it('compare_priority: equal confidence uses strategy priority', () => {
    const a = { strategy: 0, strength: { TAG: 0, _0: 0.8 } }; // priority 3
    const b = { strategy: 4, strength: { TAG: 0, _0: 0.8 } }; // priority 0
    expect(Signal.compare_priority(a, b)).toBeLessThan(0); // a first (higher priority)
  });

  it('compare_priority: same confidence same priority returns 0', () => {
    const a = { strategy: 1, strength: { TAG: 0, _0: 0.8 } }; // priority 2
    const b = { strategy: 3, strength: { TAG: 0, _0: 0.8 } }; // priority 2
    expect(Signal.compare_priority(a, b)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Types — phase and strategy enablement
// ---------------------------------------------------------------------------

describe('OCaml Types module', () => {
  it('phase_of_equity: $1000 -> Micro', () => {
    expect(Types.phase_of_equity(1000)).toBe(0);
  });

  it('phase_of_equity: boundary values', () => {
    expect(Types.phase_of_equity(2499)).toBe(0);  // Micro
    expect(Types.phase_of_equity(2500)).toBe(1);   // Small
    expect(Types.phase_of_equity(9999)).toBe(1);   // Small
    expect(Types.phase_of_equity(10000)).toBe(2);  // Medium
    expect(Types.phase_of_equity(24999)).toBe(2);  // Medium
    expect(Types.phase_of_equity(25000)).toBe(3);  // Standard
    expect(Types.phase_of_equity(100000)).toBe(3); // Standard
  });

  it('Micro phase: enables strategies 0,1,2; disables 3,4', () => {
    expect(Types.strategy_enabled_for_phase(0, 0)).toBe(true);  // Mean_reversion
    expect(Types.strategy_enabled_for_phase(0, 1)).toBe(true);  // Sector_rotation
    expect(Types.strategy_enabled_for_phase(0, 2)).toBe(true);  // Calendar_seasonal
    expect(Types.strategy_enabled_for_phase(0, 3)).toBe(false); // Momentum
    expect(Types.strategy_enabled_for_phase(0, 4)).toBe(false); // Market_making
  });

  it('Small phase: enables 0-3; disables 4', () => {
    expect(Types.strategy_enabled_for_phase(1, 0)).toBe(true);
    expect(Types.strategy_enabled_for_phase(1, 1)).toBe(true);
    expect(Types.strategy_enabled_for_phase(1, 2)).toBe(true);
    expect(Types.strategy_enabled_for_phase(1, 3)).toBe(true);
    expect(Types.strategy_enabled_for_phase(1, 4)).toBe(false);
  });

  it('Medium and Standard phases: enable all strategies', () => {
    for (const phase of [2, 3]) {
      for (let strategy = 0; strategy <= 4; strategy++) {
        expect(Types.strategy_enabled_for_phase(phase, strategy)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Performance module
// ---------------------------------------------------------------------------

describe('OCaml Performance module', () => {
  it('calculate_metrics with positive returns', () => {
    const returns = [0.01, -0.005, 0.008, -0.003, 0.012, 0.002, -0.001, 0.006];
    const m = Performance.calculate_metrics(returns, 0.05);
    expect(m.trade_count).toBe(8);
    expect(Number.isFinite(m.sharpe)).toBe(true);
    expect(Number.isFinite(m.sortino)).toBe(true);
    expect(m.max_drawdown).toBeGreaterThanOrEqual(0);
    expect(m.win_rate).toBeGreaterThan(0);
    expect(m.win_rate).toBeLessThanOrEqual(1);
  });

  it('calculate_metrics with empty returns', () => {
    const m = Performance.calculate_metrics([], 0.05);
    expect(m.sharpe).toBe(0);
    expect(m.sortino).toBe(0);
    expect(m.max_drawdown).toBe(0);
    expect(m.trade_count).toBe(0);
  });

  it('calculate_metrics: all positive returns have positive Sharpe', () => {
    const returns = [0.01, 0.02, 0.015, 0.005, 0.01];
    const m = Performance.calculate_metrics(returns, 0.0);
    expect(m.sharpe).toBeGreaterThan(0);
    expect(m.win_rate).toBe(1);
  });

  it('calculate_metrics: all negative returns have negative Sharpe', () => {
    const returns = [-0.01, -0.02, -0.015, -0.005, -0.01];
    const m = Performance.calculate_metrics(returns, 0.0);
    expect(m.sharpe).toBeLessThan(0);
    expect(m.win_rate).toBe(0);
  });

  it('max_drawdown computation', () => {
    // Returns: +10%, -20%, +5% -> peak at 1.1, trough at 0.88, dd = (1.1-0.88)/1.1 = 0.2
    const returns = [0.10, -0.20, 0.05];
    const dd = Performance.max_drawdown(returns);
    expect(dd).toBeGreaterThan(0.19);
    expect(dd).toBeLessThan(0.21);
  });

  it('rolling_sharpe returns finite number', () => {
    const returns = [0.01, -0.005, 0.008, -0.003, 0.012, 0.002, -0.001];
    const rs = Performance.rolling_sharpe(returns, 5);
    expect(Number.isFinite(rs)).toBe(true);
  });

  it('rolling_sharpe with empty returns', () => {
    expect(Performance.rolling_sharpe([], 5)).toBe(0);
  });

  it('mean and std_dev helpers', () => {
    expect(Performance.mean([1, 2, 3, 4, 5])).toBe(3);
    expect(Performance.std_dev([1, 1, 1, 1])).toBe(0);
    expect(Performance.std_dev([1, 2, 3, 4, 5])).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Regime module
// ---------------------------------------------------------------------------

describe('OCaml Regime module', () => {
  // classify now takes (realized_vol, trend_strength) instead of (vix, adx)
  it('classify: vol > 0.30 -> Crisis', () => {
    expect(Regime.classify(0.31, 0.5)).toBe(3); // Crisis
  });

  it('classify: vol > 0.20 + trend < 0.5 -> High_vol_ranging', () => {
    expect(Regime.classify(0.25, 0.3)).toBe(2); // High_vol_ranging
  });

  it('classify: vol < 0.15 + trend > 1.0 -> Low_vol_trending', () => {
    expect(Regime.classify(0.10, 1.5)).toBe(0); // Low_vol_trending
  });

  it('classify: moderate values -> Normal', () => {
    expect(Regime.classify(0.18, 0.7)).toBe(1); // Normal
  });

  // Boundary tests: exact threshold values should NOT trigger the regime
  it('classify: vol=0.30 exactly -> Normal (not > 0.30)', () => {
    expect(Regime.classify(0.30, 0.5)).toBe(1); // Normal
  });

  it('classify: vol=0.20 trend=0.5 -> Normal (not < 0.5)', () => {
    expect(Regime.classify(0.20, 0.5)).toBe(1); // Normal
  });

  it('classify: vol=0.15 trend=1.0 -> Normal (not < 0.15, not > 1.0)', () => {
    expect(Regime.classify(0.15, 1.0)).toBe(1); // Normal
  });

  // Build verification: this differentiates new logic from old VIX/ADX logic
  it('classify: vol=0.10 trend=1.5 -> Low_vol_trending (confirms new thresholds)', () => {
    expect(Regime.classify(0.10, 1.5)).toBe(0); // Old VIX/ADX logic would return 1 (Normal)
  });

  it('target_allocation returns all fields', () => {
    for (let regime = 0; regime <= 3; regime++) {
      const alloc = Regime.target_allocation(regime);
      expect(alloc.mean_reversion).toBeGreaterThan(0);
      expect(alloc.momentum).toBeGreaterThanOrEqual(0);
      expect(alloc.cash).toBeGreaterThanOrEqual(0);
      // Allocations should sum to ~1.0
      const sum = alloc.mean_reversion + alloc.sector_rotation +
        alloc.calendar_seasonal + alloc.momentum + alloc.market_making + alloc.cash;
      expect(sum).toBeCloseTo(1.0, 2);
    }
  });

  it('Crisis regime has 70% cash', () => {
    const alloc = Regime.target_allocation(3);
    expect(alloc.cash).toBe(0.7);
  });

  it('to_string for all regimes', () => {
    expect(Regime.to_string(0)).toBe('Low_vol_trending');
    expect(Regime.to_string(1)).toBe('Normal');
    expect(Regime.to_string(2)).toBe('High_vol_ranging');
    expect(Regime.to_string(3)).toBe('Crisis');
  });
});
