---
date: 2026-04-03
topic: unified-regime-classifier
---

# Unified Regime Classifier

## Problem Frame

The trading agent has two independent regime classifiers that use different inputs and can produce different labels for the same market period:

- **OCaml core** (`trading-core/lib/regime.ml`) — classifies from VIX + ADX thresholds
- **Backtest oracle** (`backtest/src/regime-labels.ts`) — classifies from realized vol + trend strength

This means signal gate thresholds calibrated in backtest don't transfer to live trading. The engine also hardcodes `vix=18, adx=22`, so the live regime is always Normal regardless of market conditions.

The fix is to extract one canonical classifier in OCaml that both engine and backtest call, using realized vol + trend strength as inputs (computable from price data, no external dependencies).

## Requirements

- R1. A single `Regime.classify` function in OCaml accepts `~realized_vol:float` and `~trend_strength:float` and returns `market_regime`. This is the sole regime classification path for the entire system.
- R2. The classification thresholds match the current backtest oracle: `crisis_vol > 0.30`, `high_vol > 0.20 && trend < 0.5`, `low_vol < 0.15 && trend > 1.0`, else Normal.
- R3. The old VIX/ADX `classify ~vix ~adx` function is deleted from `regime.ml`. No legacy/deprecated path.
- R4. The engine's `computeRegime()` in `orchestrator.ts` computes realized vol and trend strength from its price data (using the same formulas as the backtest oracle) and passes them to the unified `Regime.classify`.
- R5. The backtest oracle in `regime-labels.ts` is refactored to call the compiled `Regime.classify` from `trading-core-js/` instead of reimplementing classification logic in TypeScript. The statistical helper functions (`annualizedRealizedVol`, `trendStrength`) remain in TypeScript as the computation layer that feeds the classifier.
- R6. The `target_allocation` function in `regime.ml` is unchanged — it already operates on `market_regime` variants and is not affected by the input change.
- R7. All downstream consumers (strategy signal gating, rebalancer) continue to receive integer-encoded regimes (0-3) with no interface changes.

## Success Criteria

- Both engine and backtest produce identical regime labels when given the same price history
- The engine no longer returns a hardcoded Normal regime — it computes from live price data
- All existing 24 backtest tests pass without modification (or with minimal adaptation to the new import path)
- Property test: for any valid `(realized_vol, trend_strength)` pair, engine and backtest return the same regime
- Zero hardcoded VIX/ADX numeric literals remain in the live engine regime path

## Scope Boundaries

- **In scope:** Unifying the classifier, replacing VIX/ADX inputs, wiring the engine to compute from price data
- **Not in scope:** Adding confidence scores, hysteresis, dwell time, or Bayesian updates (these are separate ideation items that build on top of the unified classifier)
- **Not in scope:** Changing the 4-regime taxonomy or the allocation weights
- **Not in scope:** Dashboard changes (dashboard doesn't consume regime data directly)

## Key Decisions

- **Canonical inputs: realized vol + trend strength** — Computable from price data alone. No external VIX/ADX dependency. Works for both daily and intraday bars. Eliminates the hardcode bug.
- **Classifier is a pure function taking pre-computed values** — `Regime.classify ~realized_vol ~trend_strength`. Each caller (engine, backtest) computes vol/trend from its own data source. Keeps the classifier testable with no windowing logic.
- **Backtest oracle thresholds adopted directly** — Already calibrated for realized vol/trend strength on the current branch. No re-derivation needed.
- **Old VIX/ADX function deleted entirely** — No legacy/deprecated path. Clean break.

## Dependencies / Assumptions

- The engine has access to sufficient price history (20+ bars) to compute realized vol and trend strength. During warm-up, regime defaults to Normal until enough bars accumulate.
- The Melange build pipeline (`npm run build:ocaml`) produces the updated `regime.js` that the engine and backtest can import.
- The `annualizedRealizedVol` and `trendStrength` formulas currently in `regime-labels.ts` are correct and should be reused (or ported to a shared TypeScript utility) for the engine's computation.

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Where in the engine should the 20-bar price buffer live? The orchestrator already has indicator caches — should vol/trend computation plug into the existing indicator pipeline or be a standalone computation in `computeRegime()`?
- [Affects R5][Technical] Should the TypeScript statistical helpers (`annualizedRealizedVol`, `trendStrength`) move to a shared utility module importable by both engine and backtest, or stay duplicated?
- [Affects R4][Needs research] During the engine warm-up period (< 20 bars of history), what is the safest default regime? Normal is the current implicit default but may not be conservative enough.

## Next Steps

→ `/ce:plan` for structured implementation planning
