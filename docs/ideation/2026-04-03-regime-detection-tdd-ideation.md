---
date: 2026-04-03
topic: regime-detection-tdd
focus: Review key observations (no transition probs, no state memory, regime flapping, dual classifier divergence) and create a TDD plan for successful implementation
---

# Ideation: Regime Detection TDD Improvements

## Codebase Context

**Project:** Autonomous multi-strategy trading agent (OCaml/Melange + TypeScript, Alpaca paper trading, $1k starting balance).

**Current regime detection:** Two independent stateless threshold classifiers:
- OCaml core (`trading-core/lib/regime.ml`) — VIX/ADX thresholds: `vix>30 -> Crisis`, `vix>25 && adx<20 -> High_vol_ranging`, `vix<15 && adx>25 -> Low_vol_trending`, else `Normal`
- Backtest oracle (`backtest/src/regime-labels.ts`) — realized vol/trend strength: `vol>0.30 -> Crisis`, `vol>0.20 && trend<0.5 -> High_vol_ranging`, `vol<0.15 && trend>1.0 -> Low_vol_trending`, else `Normal`

**Key problems identified:**
1. **No transition probabilities** — regimes flip instantly on threshold crossings
2. **No state memory** — can't distinguish entering vs exiting a regime
3. **Regime flapping** — indicators hovering near thresholds cause rapid oscillation
4. **Dual classifier divergence** — engine and backtest produce different regime labels for the same market period
5. **Engine hardcodes VIX=18, ADX=22** — regime is always Normal in live engine
6. **No confidence/uncertainty** — binary classification only

**Existing infrastructure:** Backtest runner with regime-comparison.ts, signal_config.ml with daily/intraday defaults, DynamoDB persistence, 225 tests across workspaces.

**Past learnings:** No docs/solutions/ directory exists yet. No institutional knowledge on regime detection approaches.

## Ranked Ideas

### 1. Unified Regime Classifier
**Description:** Extract one canonical regime classification function in OCaml that both the engine and backtest oracle call. Delete the separate `backtest/src/regime-labels.ts` classifier. Both paths consume the same `Regime.classify` with the same inputs. The backtest synthesizes VIX-equivalent signals from price data to feed the shared classifier.
**Rationale:** Dual-classifier divergence means backtest-calibrated thresholds don't transfer to live. This is a correctness bug, not a feature. Ships first because every subsequent improvement must be validated in both engine and backtest — impossible if they disagree.
**Downsides:** Requires deciding which input features are canonical (VIX/ADX vs realized vol/trend). May require the backtest to synthesize VIX-equivalent signals from price data.
**Confidence:** 90%
**Complexity:** Medium
**Key problems addressed:** #4 (dual classifier divergence)
**TDD approach:**
- Property test: for any price+VIX input, live and backtest classifiers return identical regime
- Unit test: construct a regime_features record with known values, assert both paths agree
- Compile-time: adding a feature field causes type errors in any consumer that doesn't use it
- Regression: existing 24 backtest tests pass with unified module
**Status:** Explored (brainstorm 2026-04-03)

### 2. Regime Confidence Score as First-Class OCaml Type
**Description:** Extend the regime record to `{ regime: regime_label; confidence: float; dwell_bars: int }`. Confidence = sigmoid(distance_from_nearest_threshold / band_width). The compiler forces every consumer to handle confidence. Position sizing becomes proportional to confidence (Kelly-inspired).
**Rationale:** Without confidence, the system treats a borderline Normal (VIX=14.9) the same as a definitive Normal (VIX=10). This type change is the prerequisite for confidence-gated sizing, Bayesian updates, and smooth allocation blending. The OCaml design principle "make illegal states unrepresentable" means a regime without confidence is a representable illegal state.
**Downsides:** Ripple effect across OCaml core and all TypeScript consumers. Moderate refactor surface.
**Confidence:** 92%
**Complexity:** Medium
**Key problems addressed:** #6 (no confidence/uncertainty)
**TDD approach:**
- Unit test: feature vector exactly at a threshold -> confidence ~0.5
- Unit test: feature vector far from all thresholds -> confidence ~1.0
- Property test: confidence is monotonically increasing with distance from nearest threshold
- Property test: position_size(regime, conf=0.4) < position_size(regime, conf=0.9)
- Compile-time: any module that pattern matches on regime and ignores confidence fails to compile
**Status:** Unexplored

### 3. Hysteresis Bands + Minimum Dwell Time
**Description:** Combined anti-flapping mechanism: (a) dual entry/exit thresholds per regime (e.g., enter Crisis at VIX>35, exit at VIX<28), and (b) per-regime minimum dwell time (Crisis=1 bar, Normal=5 bars, High_vol_ranging=3 bars). Implemented as a state machine with `locked_until: int option` in the regime record.
**Rationale:** Addresses regime flapping and state memory in one shot. Hysteresis prevents threshold-boundary oscillation; dwell time prevents rapid-fire transitions. Asymmetric dwell respects the Crisis-responsiveness vs. Normal-stability tradeoff.
**Downsides:** Introduces statefulness into a currently stateless classifier. Two tunable parameter sets (bands + dwell times) to calibrate.
**Confidence:** 88%
**Complexity:** Medium
**Key problems addressed:** #2 (no state memory), #3 (regime flapping)
**TDD approach:**
- Unit test: VIX oscillates 17.8-18.2 — assert regime stays locked, never flips
- Unit test: enter Normal, receive 4 consecutive High_vol signals — assert regime stays Normal until bar 5
- Unit test: enter Normal, receive 1 Crisis signal — assert immediate transition (dwell=1 for Crisis)
- Unit test: enter High_vol_ranging, receive 2 Normal signals then 1 High_vol signal — queued transition discarded
- Property test: for monotonically increasing VIX, regime transitions are monotonically ordered
- Property test: total transitions over noisy 100-bar sequence <= transitions from clean sequence with same underlying truth
**Status:** Unexplored

### 4. Bayesian Regime Probability Update
**Description:** Replace the threshold classifier's point-estimate output with a probability vector P(regime) updated each bar via Bayes rule. Prior = previous bar's posterior. Likelihood = Gaussian emission per regime. Hand-specified transition priors (from backtest data). ~20 lines of OCaml. The regime enum becomes a convenience accessor (argmax) over the underlying distribution. Allocation weights become expected values over the distribution.
**Rationale:** Solves transition probabilities, state memory, and confidence scoring simultaneously — the lightweight path to HMM benefits without EM training. This is mathematically equivalent to a discrete HMM with a fixed transition matrix, but 20 lines of code instead of an EM fitting loop.
**Downsides:** Requires specifying emission parameters and transition priors. Gaussian assumption may not hold for all features. Harder to explain to non-quant observers.
**Confidence:** 78%
**Complexity:** High
**Key problems addressed:** #1 (no transition probabilities), #2 (no state memory), #6 (no confidence)
**TDD approach:**
- Unit test: after 10 bars of consistent Low_vol signals, posterior for Low_vol_trending > 0.90
- Unit test: single anomalous Crisis bar in Low_vol sequence -> posterior shifts but does not spike to 1.0
- Property test: posterior always sums to 1.0 across all 4 regimes
- Convergence test: synthetic stationary time series -> posterior converges to true regime within 20 bars
- Allocation test: expected allocation under distribution equals weighted average of per-regime allocations
- Calibration test: train transition priors on historical data, assert Crisis->Normal probability < 0.3/day
**Status:** Unexplored

### 5. Regime Transition Audit Log + TDD Fixture Generator
**Description:** Persist every regime transition to DynamoDB: `{ timestamp, from_regime, to_regime, indicator_snapshot, confidence }`. Score transitions retrospectively (was the regime "correct" given realized outcomes in the following K bars?). Auto-generate vitest fixtures from the growing transition corpus.
**Rationale:** Closes the feedback loop. Without ground truth, regime improvements are untestable. The fixture generator means the test suite grows automatically as the system runs — directly serving the TDD mandate. Every future classifier change is regression-tested against real observed transitions.
**Downsides:** Retrospective scoring requires defining "correct" per-regime (e.g., Crisis is correct if realized vol > 1.5x normal in following K bars). DynamoDB write adds a side effect to a currently pure path.
**Confidence:** 85%
**Complexity:** Medium
**Key problems addressed:** Enables TDD for all other improvements; closes feedback loop
**TDD approach:**
- Replay test: record 1 hour of classification log, replay inputs, assert 100% output match
- Schema test: every log entry passes zod validation against RegimeAuditEntry schema
- Completeness test: for every regime transition in engine, assert exactly one log entry
- Unit test: given a transition log entry and realized returns for next 10 bars, correctness score computed correctly
- Integration test: write 10 synthetic transition events to DynamoDB, run scorer, assert all have non-null scores
- Fixture generation test: generated fixtures produce deterministic test results
**Status:** Unexplored

### 6. Intraday Regime via Microstructure Proxies + Autocorrelation
**Description:** For intraday bars, replace VIX (unavailable) with computable proxies: realized vol acceleration (rate of change of 20-day vol), high-low range / ATR(20), and lag-1 return autocorrelation over a rolling 30-minute window. Calibrate proxy thresholds against known VIX regimes from daily data. Mirrors the existing `signal_config.ml` daily/intraday split.
**Rationale:** The VIX=18 hardcode is the most damaging bug — regime is always Normal in the live engine. These proxies are computable from price data already flowing through the engine. Autocorrelation adds a directional signal (trending vs mean-reverting) that VIX doesn't capture.
**Downsides:** Proxy-VIX correlation may degrade during unusual market structure. Multiple proxies need weighting or voting logic.
**Confidence:** 75%
**Complexity:** High
**Key problems addressed:** #5 (engine hardcodes regime inputs)
**TDD approach:**
- Unit test: high spread ratio (0.8) + wide ATR-normalized range -> High_vol_ranging or Crisis
- Unit test: tight spread (0.1) + narrow range -> Low_vol_trending or Normal
- Unit test: flat vol series -> acceleration = 0 -> no Crisis signal
- Calibration test: both VIX-based and proxy-based classifiers on daily data -> Pearson correlation >= 0.7
- Correlation test: verify vol acceleration correlates >= 0.65 with VIX on historical data
- Regression test: grep for hardcoded vix/adx numeric literals in live engine path -> assert zero
- Property test: synthetic AR(1) series with known rho -> autocorrelation correctly identifies trending vs mean-reverting
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Full HMM via Viterbi Decoding | Research project, not incremental improvement. $1k paper account lacks training data for EM. |
| 2 | Confidence-Gated Sizing (Functor) | Derivative of idea #2; a plain function, not a separate initiative. Bundled into confidence type. |
| 3 | EMA Smoothing of Raw Inputs | Subsumed by hysteresis (#3) and Bayesian smoothing (#4). Minor standalone value. |
| 4 | Rolling Percentile Thresholds | 252-day window mostly empty at project maturity. Premature adaptation. |
| 5 | Abolish 4-Regime Taxonomy | Full research sprint. 4 regimes haven't been falsified by data yet. |
| 6 | Order Flow Imbalance | Alpaca paper trading doesn't provide reliable aggressor-side data. |
| 7 | Outcome-Based Ground Truth | Valuable but better framed as part of audit log's retrospective scoring (#5). |
| 8 | Earnings Gap Sentinel | Practical but narrow scope; doesn't address the 4 key problems. |
| 9 | Open/Close Blackout Windows | Narrow; composes with dwell time but doesn't justify separate effort. |
| 10 | Ensemble Vote + Dissent | Entropy from Bayesian update (#4) gives the instability signal cheaper. |
| 11 | Regime-Conditional Thresholds | 3-deep dependency chain before delivering value. Per-regime config lookup is 80% as good. |
| 12 | Shadow Stalker | Subsumed by Bayesian update's fast/slow prior blending. |
| 13 | Regime Sharpe Attribution | Good but depends on audit log (#5); bundle into dashboard work after. |
| 14 | Volatility Cone (Multi-Horizon Vol) | Good input feature but better as part of proxy set (#6) than separate initiative. |
| 15 | TDD Fixture Generator | Merged into audit log (#5) — same infrastructure. |
| 16 | Regime Detection Microservice | Over-engineered for a monorepo with 3 services. Adds a failure mode for no benefit. |

## Session Log
- 2026-04-03: Brainstorm started for idea #1 (Unified Regime Classifier)
- 2026-04-03: Initial ideation — 40 raw ideas generated across 5 frames (pain/friction, inversion/removal, assumption-breaking, leverage/compounding, edge cases), ~26 unique after dedup, 6 survived two rounds of adversarial filtering. Focus: TDD plan for regime detection improvements addressing 4 key observations.
