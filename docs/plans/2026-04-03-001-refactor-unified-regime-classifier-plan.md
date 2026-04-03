---
title: "refactor: Unify regime classifier to single OCaml source of truth"
type: refactor
status: completed
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-unified-regime-classifier-requirements.md
deepened: 2026-04-03
---

# Unify Regime Classifier to Single OCaml Source of Truth

## Overview

Replace two divergent regime classifiers (OCaml VIX/ADX and TypeScript realized vol/trend) with a single OCaml classifier using realized vol + trend strength as canonical inputs. Wire both engine and backtest to call the same compiled function, eliminating the dual-classifier divergence and the hardcoded regime bug.

## Problem Frame

The trading agent has two independent classifiers producing different regime labels for the same market period. Signal gate thresholds calibrated in backtest don't transfer to live trading. The engine hardcodes VIX=18, ADX=22, so regime is always Normal. (See origin: `docs/brainstorms/2026-04-03-unified-regime-classifier-requirements.md`)

## Requirements Trace

- R1. Single `Regime.classify` in OCaml accepts `~realized_vol:float` and `~trend_strength:float`, returns `market_regime`
- R2. Thresholds match backtest oracle: crisis_vol > 0.30, high_vol > 0.20 && trend < 0.5, low_vol < 0.15 && trend > 1.0, else Normal
- R3. Old VIX/ADX classify function deleted from `regime.ml`
- R4. Engine's `computeRegime()` computes realized vol and trend strength from price data
- R5. Backtest oracle calls compiled `Regime.classify` instead of reimplementing classification
- R6. `target_allocation` unchanged
- R7. Downstream consumers (strategy gating) receive integer-encoded regimes (0-3) with no interface changes
- R8. Orchestrator tracks `previousRegime` and logs regime transitions via pino for observability

## Scope Boundaries

- **In scope:** Unifying the classifier, replacing VIX/ADX inputs, wiring engine to compute from price data
- **Not in scope:** Confidence scores, hysteresis, dwell time, Bayesian updates, changing the 4-regime taxonomy, allocation weights, or dashboard changes

## Context & Research

### Relevant Code and Patterns

- **OCaml classifier:** `trading-core/lib/regime.ml` — `classify ~vix ~adx` returns `Types.market_regime` variant. Exports `classify`, `target_allocation`, `to_string`.
- **Compiled JS output:** `trading-core-js/trading-core/lib/regime.js` — ES module exports; regimes are integer-encoded (0=Low_vol_trending, 1=Normal, 2=High_vol_ranging, 3=Crisis).
- **Backtest oracle:** `backtest/src/regime-labels.ts` — `classifyRegime(realizedVol, trendStrength)` returns `RegimeId` (0-3). Private helpers: `annualizedRealizedVol(closes[])`, `trendStrength(closes[])`.
- **Engine regime consumer:** `engine/src/orchestrator.ts:1047-1053` — `computeRegime()` hardcodes VIX=18, ADX=22, calls `Regime.classify()`.
- **Engine bar buffer:** `engine/src/orchestrator.ts:91` — `barBuffer: Map<string, OHLCV[]>` holds up to 200 bars per symbol. Populated during warmup (lines 476-498) and live stream (lines 990-996).
- **Engine OCaml import pattern:** `import * as Regime from '../../trading-core-js/trading-core/lib/regime.js'` with `@ts-expect-error` for missing TS declarations.
- **Strategy data flow:** Strategies receive `SymbolMarketData` with full bar array (`.bars[].c` for closes). Indicators computed inline per tick — no shared indicator cache.
- **Test patterns:** `engine/test/ocaml-core.test.ts` tests OCaml regime classify with numeric pairs. `backtest/test/regime-backtest.test.ts` tests `classifyRegime` with vol/trend pairs and runs integration backtests.
- **No shared workspace:** No cross-workspace TypeScript modules exist. Both workspaces import OCaml output via relative paths to `trading-core-js/`.

### Institutional Learnings

No `docs/solutions/` directory exists. No prior documented solutions for regime classification or OCaml/Melange refactoring.

## Key Technical Decisions

- **Realized vol + trend strength as canonical inputs** — Computable from price data alone. No external VIX/ADX dependency. Works for daily and intraday bars. (See origin: Key Decisions)
- **Duplicate statistical helpers in engine rather than shared workspace** — `annualizedRealizedVol` and `trendStrength` are ~20 lines of stable math. Creating a new shared workspace or cross-workspace dependency for two small functions is over-engineering. Both engine and backtest compute these from their own bar data before calling the shared classifier.
- **Aggregate 1-min bars to daily closes before vol computation** — The engine's `barBuffer` holds 1-min bars, but the vol/trend formulas and thresholds assume daily data. Using `sqrt(252)` on 1-min returns would produce values ~20x too low, making regime always Normal. Solution: aggregate every 390 1-min bars into one daily close, then apply the standard daily vol formula. This preserves existing thresholds unchanged.
- **Extract helpers to `engine/src/regime-helpers.ts`** — Vol/trend computation as exported pure functions (not private orchestrator methods) so they are directly unit-testable. Follows the codebase pattern of pure functions in separate modules.
- **Prefer SPY as regime proxy symbol** — Use `barBuffer.get('SPY')` if available; otherwise fall back to first key. Avoids non-deterministic proxy selection from Map iteration order.
- **Normal as warm-up default** — During warm-up (< 21 daily-equivalent closes, i.e., < ~8190 1-min bars), regime defaults to Normal (balanced allocation). Crisis would suppress all strategies during early trading. Normal is the most neutral posture.
- **No rebalancer wiring in this refactor** — Deepening revealed that the `Rebalancer` class (`engine/src/rebalancer.ts`) is dead code — never instantiated or called from the orchestrator. `shouldRebalance()` has zero cooldown on regime-triggered rebalances. Wiring the rebalancer is out of scope for this refactor, but Unit 2 should add `previousRegime` tracking to the orchestrator so regime-change detection is ready for future rebalancer integration. This avoids a flapping risk when the rebalancer is eventually connected.
- **Parity test via helper function comparison, not cross-workspace import** — Deepening revealed no cross-workspace import path exists (engine can't import from backtest/). After the refactor, `classifyRegime` becomes a thin wrapper around `Regime.classify`, so classifier parity is structural (same function). The meaningful parity test is: engine's `annualizedRealizedVol`/`trendStrength` helpers produce identical output to backtest's helpers for the same close array. Test both in `engine/test/` by inlining the backtest formulas as reference implementations.

## Open Questions

### Resolved During Planning

- **Where does the 20-bar price buffer live?** → Use existing `this.barBuffer` in orchestrator. Aggregate 1-min bars to daily-equivalent closes (every 390 bars), then extract last 21 daily closes → 20 log returns → realized vol.
- **1-min bar annualization mismatch?** → Aggregate to daily closes before computing vol/trend. This preserves `sqrt(252)` and existing thresholds unchanged. Identified during document review as a P0 risk.
- **Shared TypeScript utility or duplicate?** → Extract to `engine/src/regime-helpers.ts` as exported pure functions. Duplicated from backtest helpers, but exported (not private methods) for direct testability.
- **Warm-up default regime?** → Normal. Most balanced allocation, doesn't suppress strategies. Warm-up period is ~21 trading days (8190 1-min bars) before regime can be computed.
- **Which symbol's vol for regime?** → Prefer SPY if in `barBuffer`; otherwise first available key. SPY is the most representative broad market proxy.

### Deferred to Implementation

- Exact error handling if `barBuffer` is empty for all symbols during the first tick (should not happen after warmup, but verify).
- Whether the OCaml `dune` build needs any changes to the module structure beyond editing `regime.ml` in place.

## Implementation Units

- [ ] **Unit 1: Replace OCaml regime classifier inputs**

  **Goal:** Change `regime.ml` from VIX/ADX to realized vol/trend strength inputs with backtest oracle thresholds.

  **Requirements:** R1, R2, R3

  **Dependencies:** None

  **Files:**
  - Modify: `trading-core/lib/regime.ml`
  - Test: `engine/test/ocaml-core.test.ts` (update regime classify tests)

  **Approach:**
  - Replace `classify ~vix ~adx` with `classify ~realized_vol ~trend_strength`
  - Use backtest oracle thresholds: crisis_vol > 0.30, high_vol > 0.20 && trend < 0.5, low_vol < 0.15 && trend > 1.0, else Normal
  - Delete the old VIX/ADX classify function entirely
  - **Argument order matters:** Melange compiles labeled OCaml arguments to positional JS in source order. The OCaml signature must declare `~realized_vol` before `~trend_strength` so the compiled JS matches the positional calling convention `classify(realizedVol, trendStrength)`. Verify the compiled `regime.js` argument order after build.
  - `target_allocation` and `to_string` remain unchanged
  - Run `npm run build:ocaml` to regenerate `trading-core-js/` output

  **Execution note:** Write OCaml unit tests first. The classify function is pure — test every regime boundary with exact threshold values (boundary-inclusive/exclusive).

  **Patterns to follow:**
  - Existing `regime.ml` structure (type alias, pattern match, pure function)
  - `signal_config.ml` for threshold constant naming conventions

  **Test scenarios:**
  - realized_vol=0.31, trend=0.5 → 3 (Crisis, vol > 0.30)
  - realized_vol=0.25, trend=0.3 → 2 (High_vol_ranging, vol > 0.20 && trend < 0.5)
  - realized_vol=0.10, trend=1.5 → 0 (Low_vol_trending, vol < 0.15 && trend > 1.0)
  - realized_vol=0.18, trend=0.7 → 1 (Normal, default)
  - Boundary: realized_vol=0.30 exactly → 1 (Normal, not > 0.30)
  - Boundary: realized_vol=0.20, trend=0.5 → 1 (Normal, not < 0.5)
  - Boundary: realized_vol=0.15, trend=1.0 → 1 (Normal, not < 0.15, not > 1.0)
  - **Build verification:** `classify(0.10, 1.5) === 0` — this differentiates new logic from old VIX/ADX logic (old would return Normal for these values)

  **Verification:**
  - `npm run build:ocaml` succeeds
  - `regime.js` exports `classify` with two numeric args returning 0-3
  - `classify(0.10, 1.5) === 0` confirms new thresholds are active (old VIX/ADX logic would return 1)
  - Updated `ocaml-core.test.ts` regime tests pass with new input pairs
  - No references to `vix` or `adx` remain in `regime.ml`

---

- [ ] **Unit 2: Wire engine `computeRegime()` to use live price data**

  **Goal:** Replace the hardcoded VIX=18/ADX=22 stub with realized vol and trend strength computed from the bar buffer.

  **Requirements:** R4, R7, R8

  **Dependencies:** Unit 1

  **Files:**
  - Create: `engine/src/regime-helpers.ts` (exported pure functions for vol/trend computation)
  - Modify: `engine/src/orchestrator.ts` (rewrite `computeRegime()`, import regime-helpers)
  - Test: `engine/test/regime-computation.test.ts` (new test file for helpers and computeRegime)

  **Approach:**
  - **Critical: 1-min bar annualization.** The `barBuffer` holds 1-min bars, but the vol/trend formulas use `sqrt(252)` daily annualization. Feeding 1-min closes directly would produce vol values ~20x too low, making the engine always-Normal. **Solution: aggregate 1-min closes to daily-equivalent closes before computing vol/trend.** Sample every ~390 bars (one trading day of 1-min data) to extract one close per day. This preserves the existing thresholds and `sqrt(252)` annualization unchanged.
  - Create `engine/src/regime-helpers.ts` with exported pure functions: `annualizedRealizedVol(closes: number[]): number`, `trendStrength(closes: number[]): number`, and `aggregateToDailyCloses(minuteBars: {c: number}[], barsPerDay: number): number[]`. The vol/trend formulas match `backtest/src/regime-labels.ts` helper logic. The aggregation function takes the last close from each barsPerDay-sized chunk.
  - Rewrite `computeRegime()`: use `this.barBuffer.get('SPY')` if available, otherwise first key from `barBuffer`. Aggregate 1-min bars to daily closes via `aggregateToDailyCloses(bars, 390)`. If fewer than 21 daily-equivalent closes (i.e., < ~8,190 1-min bars ≈ 21 trading days), return Normal (1) as warm-up default. Otherwise compute realized vol and trend strength from the daily closes, call `Regime.classify(realizedVol, trendStrength)`.
  - Remove the hardcoded VIX/ADX constants.
  - Add a `private previousRegime: number = 1` field to the orchestrator (R8). Update each tick after `computeRegime()` returns. Log regime changes via pino when `regime !== this.previousRegime`.
  - Downstream consumers (`processTradingTick`, `strategyRunner.runStrategies`) are unchanged — they still receive the integer regime (R7). The rebalancer is not wired and is not affected.

  **Patterns to follow:**
  - Existing `computeRegime()` call site at orchestrator line 600
  - Bar buffer access pattern: `this.barBuffer.get(symbol)?.slice(-N)` (seen in strategy modules)
  - `@ts-expect-error` import pattern for OCaml modules

  **Test scenarios:**
  - With < 8190 1-min bars (< 21 daily closes) → returns Normal (1)
  - With empty barBuffer → returns Normal (1)
  - `aggregateToDailyCloses`: 390 bars → 1 daily close; 780 bars → 2 daily closes; verifies last-close-per-chunk logic
  - `annualizedRealizedVol` unit tests: known daily close sequence → expected vol value
  - `trendStrength` unit tests: known daily close sequence → expected trend value
  - With sufficient bars and stable daily closes → returns Normal or Low_vol_trending
  - With sufficient bars and high-vol daily closes → returns High_vol_ranging or Crisis
  - SPY preference: if SPY is in barBuffer, it is used; if not, first available symbol is used
  - `previousRegime` updates correctly when regime changes; pino log emitted on regime transition

  **Verification:**
  - No hardcoded VIX or ADX values in `computeRegime()` or anywhere in the engine regime path
  - Regime value changes dynamically as bar buffer fills with different market conditions
  - `previousRegime` field tracks the last-emitted regime
  - All existing engine tests pass (regime is still an integer 0-3)
  - Helper functions are exported from `engine/src/regime-helpers.ts` and directly testable

---

- [ ] **Unit 3: Refactor backtest oracle to call unified classifier**

  **Goal:** Replace the TypeScript `classifyRegime` reimplementation with a call to the compiled OCaml `Regime.classify`.

  **Requirements:** R5

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `backtest/src/regime-labels.ts`
  - Test: `backtest/test/regime-backtest.test.ts`
  - Test: `backtest/test/calibrate-gates.test.ts`
  - Test: `backtest/test/run-regime-comparison.test.ts`

  **Approach:**
  - Import `Regime` from `../../trading-core-js/trading-core/lib/regime.js` (with `@ts-expect-error`)
  - Replace the body of `classifyRegime(realizedVol, trendStrength)` to call `Regime.classify(realizedVol, trendStrength)` and cast the return to `RegimeId`
  - Keep the exported function signature identical so callers (`computeOracleLabels`, tests) don't change
  - Keep `annualizedRealizedVol` and `trendStrength` as private helpers — they are the computation layer that feeds the classifier
  - Remove the hardcoded threshold constants from `regime-labels.ts` (they now live in OCaml)

  **Patterns to follow:**
  - Engine's OCaml import pattern: `import * as Regime from '../../trading-core-js/...'` with `@ts-expect-error`
  - Existing `classifyRegime` call sites in `computeOracleLabels` (line 59) and tests (line 60-63)

  **Test scenarios:**
  - All existing backtest tests pass unchanged (the function signature and return values are identical)
  - `classifyRegime(0.31, 0.5)` → 3 (Crisis) — same as before
  - `classifyRegime(0.10, 1.5)` → 0 (Low_vol_trending) — same as before
  - Threshold boundary values match Unit 1 tests exactly (proving engine and backtest agree)

  **Verification:**
  - All 24 backtest tests pass
  - No duplicate threshold constants in `regime-labels.ts` — thresholds live only in OCaml
  - `classifyRegime` is now a thin wrapper around `Regime.classify`

---

- [ ] **Unit 4: Parity tests — classifier correctness and helper-function equivalence**

  **Goal:** Prove the unified classifier produces correct outputs, and that engine and backtest vol/trend helper functions are equivalent.

  **Requirements:** Success criteria (property test for parity)

  **Dependencies:** Units 1, 2, 3

  **Files:**
  - Create: `engine/test/regime-parity.test.ts`

  **Approach:**
  - **Classifier correctness:** Import `Regime.classify` from `trading-core-js/`. Run a parameterized test over a matrix of (realized_vol, trend_strength) pairs covering all 4 regime zones and all boundary values. Assert expected regime for each pair. This is the single source of truth — both engine and backtest call this same function after the refactor, so classifier parity is structural.
  - **Helper-function equivalence:** Inline the backtest's `annualizedRealizedVol` and `trendStrength` formulas as reference implementations in the test file (the functions are ~10 lines each, pure arithmetic, no imports). Import the engine's helpers from `engine/src/regime-helpers.ts`. Feed identical daily close arrays to both and assert outputs match within floating-point epsilon (1e-10). This proves the duplication is correct. Both use `sqrt(252)` on daily closes, so the annualization scale is identical.
  - **Aggregation correctness:** Test `aggregateToDailyCloses()` separately — verify it produces the expected daily close sequence from synthetic 1-min bar arrays.
  - No cross-workspace import needed — engine can't import from backtest/ (no workspace dependency, incompatible tsconfig scopes).

  **Patterns to follow:**
  - `backtest/test/regime-backtest.test.ts` parameterized regime classification tests (lines 60-63)
  - `engine/test/ocaml-core.test.ts` OCaml interop test pattern

  **Test scenarios:**
  - 20+ (vol, trend) pairs spanning all 4 regimes and boundary values
  - Edge cases: vol=0.0, trend=0.0 → Normal
  - Edge cases: vol=1.0, trend=10.0 → Crisis (extreme values)
  - Boundary-exact values at each threshold (0.30, 0.20, 0.15, 0.5, 1.0)
  - 3-5 different close arrays (flat, trending up, high-vol, crash) fed to engine and reference vol/trend helpers → outputs within epsilon

  **Verification:**
  - All parity tests pass
  - Test covers all 4 regime classifications and all threshold boundaries
  - Engine and reference helper functions agree within 1e-10 for every test close array

---

- [ ] **Unit 5: Cleanup and regression verification**

  **Goal:** Remove dead code, verify no VIX/ADX references remain in the live path, and ensure full test suite passes.

  **Requirements:** R3, all success criteria

  **Dependencies:** Units 1-4

  **Files:**
  - Modify: `engine/test/ocaml-core.test.ts` (verify old VIX/ADX tests are replaced, not lingering)
  - Verify: `engine/src/orchestrator.ts` (no VIX/ADX references)
  - Verify: `trading-core/lib/regime.ml` (no VIX/ADX references)

  **Approach:**
  - Grep the codebase for remaining `vix`, `adx` references in the regime classification path. Remove any dead code or stale comments.
  - Run the full test suite across all workspaces: `npm test --workspace=engine`, `npm test --workspace=backtest`
  - Verify the Melange build is clean: `npm run build:ocaml`

  **Test scenarios:**
  - `grep -ri "vix\|adx" trading-core/lib/regime.ml engine/src/orchestrator.ts` returns no matches
  - All engine tests pass (195+)
  - All backtest tests pass (24+)
  - Build pipeline succeeds end-to-end

  **Verification:**
  - Zero VIX/ADX references in regime classification path
  - Full test suite green across engine and backtest
  - Melange build clean

## System-Wide Impact

- **Interaction graph:** `computeRegime()` is called every tick (1s interval) by the orchestrator (line 600). Its output flows to `strategyRunner.runStrategies()` which passes regime to each strategy for position-size gating. The integer interface (0-3) is unchanged, so all downstream consumers are unaffected.
- **Rebalancer (dead code — critical context):** The `Rebalancer` class (`engine/src/rebalancer.ts`) exists but is never instantiated or called from the orchestrator. `shouldRebalance()` has `regimeChanged` as its first check with zero cooldown — any regime change would trigger immediate rebalance. The allocation swings are large (Normal→Crisis: Momentum 25%→5%, Cash 5%→70%). **This refactor does not wire the rebalancer**, but regime will now actually change, so when the rebalancer is eventually connected, a cooldown/debounce mechanism must be added first to prevent flapping-induced churn.
- **Strategy position-size impact:** Strategies already gate on regime (e.g., `mean-reversion.ts`: `regime === 3 ? 0.03 : 0.08`). With regime now changing dynamically, position sizes will vary during trading. This is the intended behavior — but it means strategies may see position-size changes mid-session for the first time.
- **Error propagation:** If `barBuffer` is empty (all symbols), `computeRegime()` returns Normal. This is the same behavior as the current hardcoded stub, so the failure mode is identical. No new error paths introduced.
- **State lifecycle risks:** The classifier itself is stateless. However, Unit 2 adds `previousRegime` tracking to the orchestrator — this is a new piece of instance state that must survive the orchestrator lifecycle (initialized on construction, updated each tick, no persistence needed across restarts).
- **API surface parity:** The compiled `regime.js` export signature changes from `classify(vix, adx)` to `classify(realized_vol, trend_strength)`. Both engine and backtest imports must be updated before the refactor is considered complete (Units 2 and 3 can land separately, but the OCaml build output from Unit 1 should not be deployed until both are merged). The rebalancer's `target_allocation(regime)` call is unchanged.
- **Integration coverage:** The parity test (Unit 4) verifies helper-function equivalence between engine and backtest. Classifier parity is structural — both call the same compiled OCaml function after the refactor.

## Risks & Dependencies

- **Melange build in WSL2:** The OCaml build runs in WSL2. If the WSL environment is not set up, Unit 1's build step will fail. Mitigated by existing `npm run build:ocaml` script.
- **SPY preference with fallback:** `computeRegime()` prefers SPY as the regime proxy symbol, falling back to the first available key in `barBuffer`. If SPY is not in the symbol universe, the fallback may be an illiquid name. Acceptable for paper trading.
- **Extended warm-up period:** Aggregating to daily closes requires ~8190 1-min bars (~21 trading days) before regime can be computed. During this period, regime is always Normal. This is a longer warm-up than the previous always-Normal stub but produces identical behavior during that window.
- **Floating-point parity:** The vol/trend computation in TypeScript uses `Math.log`, `Math.sqrt`, etc. The OCaml classifier receives these as floats. No precision issues expected since the classifier uses inequality thresholds (not equality), but the parity test (Unit 4) should use epsilon comparison for the helper function outputs.
- **Rebalancer flapping risk (future):** The `Rebalancer` class is currently dead code (never instantiated in orchestrator). When it is eventually wired in, `shouldRebalance()` triggers immediately on any regime change with zero cooldown. With 1-second tick intervals and no hysteresis, regime flapping near thresholds could cause 60+ rebalances/minute. **Before wiring the rebalancer, a cooldown (30-60 min) and/or a stability filter (N consecutive ticks confirming new regime) must be added.** This refactor adds `previousRegime` tracking (Unit 2) as the foundation for that future work.
- **Strategy position-size changes during session:** Strategies gate position size on regime (e.g., Crisis=3% vs Normal=8%). With regime now computed live, position sizes will change mid-session. This is intended behavior but represents a behavioral change from the current always-Normal regime.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-03-unified-regime-classifier-requirements.md](../brainstorms/2026-04-03-unified-regime-classifier-requirements.md)
- **Ideation:** [docs/ideation/2026-04-03-regime-detection-tdd-ideation.md](../ideation/2026-04-03-regime-detection-tdd-ideation.md)
- Related code: `trading-core/lib/regime.ml`, `backtest/src/regime-labels.ts`, `engine/src/orchestrator.ts`
