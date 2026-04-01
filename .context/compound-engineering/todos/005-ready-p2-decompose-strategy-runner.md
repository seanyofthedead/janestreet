---
status: ready
priority: p2
issue_id: "005"
tags: [architecture, tools-as-primitives]
dependencies: []
---

# Decompose StrategyRunner into Individual Strategy Modules

## Problem Statement

All 5 signal generation strategies are embedded as functions inside `engine/src/strategy-runner.ts` (lines 72-245). This creates a monolithic workflow that encodes business logic, violating "tools as primitives." Strategies cannot be tested, added, or removed independently.

## Findings

- `strategy-runner.ts` contains `meanReversionSignal()`, `momentumSignal()`, `calendarSeasonalSignal()`, `marketMakingSignal()`, `sectorRotationSignal()`
- All 5 strategies are called in sequence by `runStrategies()`
- Health tracking, priming, and enablement logic are interleaved
- Tools as Primitives audit scored 41% — this is a key contributor

**Audit scores affected:**
- Tools as Primitives: 41%

## Proposed Solutions

1. Create `engine/src/strategies/` directory
2. Extract each strategy into its own module: `mean-reversion.ts`, `momentum.ts`, `sector-rotation.ts`, `calendar-seasonal.ts`, `market-making.ts`
3. Each exports `generate(data: MarketSnapshot, regime: MarketRegime): StrategySignal | null`
4. `StrategyRunner` becomes a dispatcher that iterates enabled strategies

## Recommended Action

Extract strategies into separate files. StrategyRunner becomes a thin dispatcher.

## Acceptance Criteria

- [ ] Each strategy in its own file under `engine/src/strategies/`
- [ ] Each exports a `generate()` function with consistent interface
- [ ] StrategyRunner dispatches to individual strategies
- [ ] Health tracking remains per-strategy
- [ ] All existing tests pass
- [ ] No behavior change — pure refactor
