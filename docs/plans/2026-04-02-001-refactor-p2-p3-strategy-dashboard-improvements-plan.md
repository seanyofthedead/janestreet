---
title: "refactor+feat: Decompose strategy runner, dashboard UX improvements"
type: refactor
status: active
date: 2026-04-02
deepened: 2026-04-02
---

# Decompose Strategy Runner + Dashboard UX Improvements

## Overview

Three TODO items covering architecture and UX improvements: (1) extract monolithic strategy runner into individual strategy modules, (2) add tooltips and empty-state guidance to the dashboard, and (3) add a help modal for new users. Items 1 is a pure refactor; items 2-3 are UX features.

Related: TODOs 007/008 (risk config API + signal persistence) are covered by [2026-04-01-001-feat-engine-data-persistence-plan.md](2026-04-01-001-feat-engine-data-persistence-plan.md).

## Problem Frame

**Strategy Runner (TODO 005):** All 5 signal generation strategies are embedded as functions inside `engine/src/strategy-runner.ts`. Strategies cannot be tested, added, or removed independently. The "Tools as Primitives" audit scored 41%, with this monolith as a key contributor.

**Dashboard Tooltips (TODO 006):** The dashboard provides no explanations for metrics (Sharpe ratio, win rate, allocation %), states (Warming up, Pilot, Live), or empty conditions. Capability Discovery scored 14%.

**Help Modal (TODO 009):** No guided introduction for new users — no help button, feature tour, or glossary. Depends on tooltip work being in place first.

## Requirements Trace

- R1. Each strategy in its own file under `engine/src/strategies/` with consistent `generate()` interface
- R2. StrategyRunner becomes a thin dispatcher; no behavior change (pure refactor)
- R3. Health tracking remains per-strategy after decomposition
- R4. All existing engine tests pass after refactor
- R5. Key dashboard metrics have tooltip/title attributes explaining what they measure
- R6. Empty states include actionable guidance instead of generic "No data"
- R7. Strategy states have visible legend or tooltips (Warming up, Pilot, Live)
- R8. Risk dashboard metrics explain what's normal vs abnormal
- R9. "?" button in dashboard header opens help modal with system overview and glossary
- R10. Help modal is dismissable and non-intrusive
- R11. No new dependencies added for any of these changes

## Scope Boundaries

- No new strategy logic — extraction only for TODO 005
- No first-visit onboarding tour (TODO 009 optional stretch; skip for now)
- No tooltip library — use a thin Tailwind `group`/`group-hover` component, no external deps
- No i18n for tooltip/help text
- No standardization of component rendering patterns (early-return vs inline) — limit scope to text/content changes
- Dashboard UI for signal history and threshold editing are separate TODOs
- No comprehensive accessibility audit — add minimum viable a11y only for new features (modal, tooltips)

## Context & Research

### Relevant Code and Patterns

- **StrategyRunner** (`engine/src/strategy-runner.ts`): Contains `StrategyRunner` class with `runStrategies()`, five signal generators (`meanReversionSignal`, `momentumSignal`, `sectorRotationSignal`, `calendarSeasonalSignal`, `marketMakingSignal`), health tracking (`consecutiveMisses`/`consecutiveSuccesses`), phase-aware enabling via `Types.strategy_enabled_for_phase()`
- **Strategy types** (`StrategyId` enum 0-4, `StrategySignal` interface with strategy/symbol/side/strength/target_price/max_position_pct/timestamp)
- **Dashboard components** (`dashboard/app/components/`): `portfolio-summary.tsx`, `position-table.tsx`, `risk-dashboard.tsx`, `strategy-panel.tsx`, `order-blotter.tsx`, `kill-switch-button.tsx`, `price-chart.tsx`, `pnl-chart.tsx`
- **Dashboard layout** (`dashboard/app/page.tsx`): Grid-based responsive layout, dark theme (gray-950 bg)
- **Existing empty states**: Skeleton screens with `animate-pulse` divs, generic loading/error patterns
- **No existing tooltip library** — only Recharts `<Tooltip>` used for chart hover states
- **Dashboard header**: Currently in `dashboard/app/layout.tsx` with minimal content

### Institutional Learnings

- No component library — raw HTML/Tailwind throughout the dashboard
- Dashboard uses TanStack Query for data, Recharts + lightweight-charts for visualization
- Strategy health dots are color-coded (green/yellow/red) with conditional Tailwind classes

## Key Technical Decisions

- **Strategy module interface**: Each strategy exports `generate(data: SymbolMarketData, regime: Regime): StrategySignal | null`. All 5 existing generators already share this exact signature (confirmed via the `generators` Map type in strategy-runner.ts:266-269). Strategy functions use zero OCaml imports — only the runner uses `Signal.is_actionable` and `Types.strategy_enabled_for_phase`, so extracted modules will be pure TypeScript with no `@trading-core/*` dependencies.
- **Runner stamps `signal.strategy`**: Currently each generator hardcodes its own strategy ID in the returned signal (e.g., `strategy: 0` at line 90). This is a copy-paste bug waiting to happen. After extraction, the runner should overwrite `signal.strategy = module.id` post-generate, so generators no longer need to know their own numeric identity.
- **Co-locate `minBarsForPrimed` per module**: `MIN_BARS_FOR_PRIMED` is currently a per-strategy constant map (mean-reversion=20, momentum=50, sector-rotation=50, calendar-seasonal=30, market-making=10). Each extracted module should export its own `minBars` value, giving strategies ownership of their warmup requirement.
- **Consolidate `STRATEGY_NAMES`**: Two independent copies exist — one in `strategy-runner.ts` (imported by orchestrator, rebalancer) and a duplicate in `config-poller.ts` (line 74-80, used for strategy toggle lookup). Move the canonical constant to `strategies/index.ts` and update all consumers. Divergence between copies is a silent strategy-toggle bug risk.
- **Strategy registry pattern**: Use a simple array/map of strategy modules rather than a plugin system. Over-engineering for 5 strategies isn't warranted. Replace `for (let i = 0; i <= 4; i++)` loops with `for (const module of registry)` to eliminate the hidden assumption that IDs are contiguous.
- **Extract all strategies at once, not incrementally**: All five generators have identical signatures and no structural variation. A hybrid state (some inline, some in registry) requires two dispatch paths — more complex than either the current or fully extracted state. Extract all five in one unit, then clean up in a second unit.
- **Tooltips via Tailwind hover spans, not `title` attributes**: Native `title` attributes render with OS chrome (light yellow on Windows 11), creating a jarring mismatch against the dark theme (bg-gray-950). They also have an unconfigurable ~500ms delay and do nothing on mobile/touch. Instead, use a thin `<Tooltip>` wrapper component (~20 lines) with `group`/`group-hover` Tailwind pattern for dark-theme-consistent hover text. This component will serve ~30+ tooltip sites across 5 components, so it pays for itself immediately. Place at `dashboard/app/components/ui/tooltip.tsx`.
- **Generic `<Modal>` wrapper, not one-off**: No modal/dialog/overlay pattern exists in the dashboard. Rather than building a one-off `HelpModal`, create a minimal `<Modal isOpen onClose>` wrapper (~35 lines) that renders a dark backdrop (`bg-black/60`), centers content, handles Escape, and traps focus. Place at `dashboard/app/components/ui/modal.tsx`. The `HelpModal` becomes content passed as children.
- **Shared strategy state constants**: Strategy maturity labels ("Warming up", "Pilot", "Live") are implicit — they exist nowhere as explicit constants. Extract to `dashboard/lib/constants.ts` with labels and descriptions. Both the strategy-panel legend and help modal glossary import from it.
- **Minimum viable accessibility**: The dashboard has zero `aria-*` attributes anywhere. For features being added: modal must have `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and focus trapping; tooltips should use `role="tooltip"` with `aria-describedby`.
- **No localStorage first-visit flag**: Keep help modal manual-only ("?" button). Simpler and less intrusive.

## Open Questions

### Resolved During Planning

- **Should strategies use a class or function pattern?**: Functions. The current generators are already functions; wrapping them in classes adds ceremony with no benefit. Export a `generate()` function and a `config` object (name, id, minBars) per module.
- **Should the dispatcher use dynamic imports?**: No. Static imports with a registry array. There are only 5 strategies, and dynamic imports add async complexity.
- **Should tooltips use a third-party library (Radix, Floating UI)?**: No. The dashboard has zero component library dependencies. A thin Tailwind `group`/`group-hover` wrapper keeps it dependency-free (R11).
- **`title` attributes vs custom hover tooltip?**: Custom Tailwind hover. Native `title` attrs render with OS chrome (light yellow on Windows 11), clash with dark theme, have unconfigurable delay, and are invisible on touch devices.
- **Extract all strategies at once or incrementally?**: All at once. All 5 have identical signatures, no structural variation. A hybrid state requires two dispatch paths — more complex than either endpoint. Confirmed by architecture review.
- **One-off HelpModal vs generic Modal?**: Generic `<Modal>` wrapper. It's the first overlay in the dashboard — establishing a reusable pattern prevents future inconsistency. Kill-switch could adopt it later.
- **Should component rendering patterns be standardized?**: No. PriceChart renders inline because it must keep the container div mounted for the lightweight-charts ref. PnlChart is props-driven because page.tsx controls its data. These divergences are justified.

### Deferred to Implementation

- Exact tooltip copy for each metric — will be refined during implementation based on what each component displays and OCaml source definitions
- Whether to batch `signal.strategy` stamping or handle it inline in the dispatch loop
- Whether `formatCurrency` duplication (portfolio-summary.tsx and position-table.tsx) should be extracted to `lib/format.ts` during tooltip work — opportunistic cleanup if both files are being touched

## Implementation Units

- [ ] **Unit 1: Extract all 5 strategies into modules (mechanical move)**

  **Goal:** Create the strategy module structure and extract all 5 generators in one pass. Purely mechanical code movement — no behavior change.

  **Requirements:** R1, R2, R3, R4

  **Dependencies:** None

  **Files:**
  - Create: `engine/src/strategies/types.ts`
  - Create: `engine/src/strategies/mean-reversion.ts`
  - Create: `engine/src/strategies/momentum.ts`
  - Create: `engine/src/strategies/sector-rotation.ts`
  - Create: `engine/src/strategies/calendar-seasonal.ts`
  - Create: `engine/src/strategies/market-making.ts`
  - Create: `engine/src/strategies/index.ts`
  - Modify: `engine/src/strategy-runner.ts`
  - Modify: `engine/src/orchestrator.ts` (update `STRATEGY_NAMES` import)
  - Modify: `engine/src/rebalancer.ts` (update type imports: `STRATEGY_NAMES`, `StrategyId`, `Regime`, `Phase`)
  - Modify: `engine/src/conflict-resolver.ts` (update `StrategySignal` import)
  - Test: `engine/test/strategies/mean-reversion.test.ts`
  - Test: `engine/test/strategies/momentum.test.ts`
  - Test: `engine/test/strategies/sector-rotation.test.ts`
  - Test: `engine/test/strategies/calendar-seasonal.test.ts`
  - Test: `engine/test/strategies/market-making.test.ts`

  **Approach:**
  - Define `StrategyModule` interface in `types.ts`: `{ id: StrategyId, name: string, minBars: number, generate: (data: SymbolMarketData, regime: Regime) => StrategySignal | null }`
  - Also export shared types from `types.ts`: `StrategyId`, `StrategySignal`, `SymbolMarketData`, `Phase`, `Regime` (re-exported so consumers don't need to know the original source)
  - Extract all 5 generators at once (identical signatures confirmed, no structural variation):
    - `mean-reversion.ts` (line 72, minBars=20)
    - `momentum.ts` (line 100, minBars=50)
    - `sector-rotation.ts` (line 128, minBars=50)
    - `calendar-seasonal.ts` (line 164, minBars=30)
    - `market-making.ts` (line 219, minBars=10) — ignores regime (`_regime`), fine with uniform interface
  - Create `strategies/index.ts` with registry array and canonical `STRATEGY_NAMES` constant
  - Update `StrategyRunner` to iterate registry instead of internal `generators` Map — replace `for (let i = 0; i <= 4; i++)` loops with `for (const module of registry)` to eliminate contiguous-ID assumption
  - Replace `generators` Map (line 266-269) and `MIN_BARS_FOR_PRIMED` record (lines 253-259) with registry-based lookup
  - Update all consumer imports:
    - `orchestrator.ts`: `STRATEGY_NAMES` + types → `strategies/index.ts`
    - `rebalancer.ts`: `STRATEGY_NAMES`, `StrategyId`, `Regime`, `Phase` → `strategies/types.ts` or `strategies/index.ts`
    - `conflict-resolver.ts`: `StrategySignal` → `strategies/types.ts`
    - `config-poller.ts`: remove duplicate `STRATEGY_NAMES` (line 74-80), import from `strategies/index.ts`
  - Health tracking stays in `StrategyRunner` keyed by `StrategyId` — runner-level concern
  - Strategy modules remain pure TypeScript with no `@trading-core/*` imports

  **Patterns to follow:**
  - Current generator signatures (all identical: `(data: SymbolMarketData, regime: Regime) => StrategySignal | null`)
  - `generators` Map type (line 266-269) which enforces uniform signatures
  - `MIN_BARS_FOR_PRIMED` record (lines 253-259) for per-strategy values

  **Test scenarios:**
  - Each strategy module's `generate()` returns valid StrategySignal for qualifying data
  - Each returns null when conditions not met (e.g., mean-reversion: bars.length < 20)
  - Each module exports correct id, name, minBars
  - `StrategyRunner.runStrategies()` produces identical output as before (regression)
  - Health tracking still increments/resets per strategy (MISS_THRESHOLD=300, RECOVERY_THRESHOLD=10)
  - Phase-aware enabling still works via `Types.strategy_enabled_for_phase()`
  - `allPrimed()` works with per-module `minBars`
  - Existing tests in `engine/test/strategies.test.ts` and `engine/test/strategy-toggle.test.ts` pass unchanged (they only use public API, no mocking of internals)
  - Strategy toggle via config-poller still works after `STRATEGY_NAMES` consolidation

  **Verification:**
  - Full `npm test --workspace=engine` passes with zero behavior change
  - `strategy-runner.ts` contains no signal generation logic — only dispatching and health tracking
  - All consumer files compile with updated imports
  - No duplicate `STRATEGY_NAMES` remains in codebase

- [ ] **Unit 2: Strategy runner behavioral cleanup**

  **Goal:** Apply behavioral improvements now that extraction is complete: runner stamps signal IDs, and adds optional per-strategy health thresholds.

  **Requirements:** R2, R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/strategies/types.ts`
  - Modify: `engine/src/strategy-runner.ts`
  - Modify: `engine/src/strategies/calendar-seasonal.ts`
  - Modify: `engine/src/strategies/market-making.ts`

  **Approach:**
  - Runner stamps `signal.strategy = module.id` after `generate()` returns, instead of trusting each generator to self-identify. Remove hardcoded `strategy: N` from each generator's return value. This eliminates a class of copy-paste bugs.
  - Add optional `missThreshold` and `recoveryThreshold` fields to `StrategyModule` interface. Runner uses them if present, falls back to global defaults (MISS_THRESHOLD=300, RECOVERY_THRESHOLD=10) otherwise. Motivation: `calendarSeasonalSignal` has a fundamentally different signal cadence (date-driven, not tick-driven) and will naturally produce long runs of nulls mid-month without being "unhealthy". `marketMakingSignal` should signal on nearly every tick if spread exists.
  - Set `calendar-seasonal.ts` missThreshold higher (e.g., 1000) and `market-making.ts` missThreshold lower (e.g., 100) to match their natural cadences.

  **Test scenarios:**
  - Signals returned by runner have correct `strategy` field even if generator returns wrong ID
  - Calendar seasonal strategy is not marked unhealthy during normal mid-month quiet periods
  - Market making strategy detects unhealthy state faster
  - Default thresholds still apply to strategies without custom values

  **Verification:**
  - All existing tests pass
  - Signal `strategy` field always matches the module that generated it

- [ ] **Unit 3: Create shared UI primitives and constants, then add tooltips**

  **Goal:** Create a reusable `<Tooltip>` component and shared constants, then add contextual explanations to all dashboard metrics (~30+ tooltip sites across 5 components).

  **Requirements:** R5, R7, R8, R11

  **Dependencies:** None (parallel with Units 1-2)

  **Files:**
  - Create: `dashboard/app/components/ui/tooltip.tsx`
  - Create: `dashboard/lib/constants.ts`
  - Modify: `dashboard/app/components/portfolio-summary.tsx`
  - Modify: `dashboard/app/components/strategy-panel.tsx`
  - Modify: `dashboard/app/components/risk-dashboard.tsx`
  - Modify: `dashboard/app/components/position-table.tsx`
  - Modify: `dashboard/app/components/order-blotter.tsx`

  **Approach:**
  - Create `ui/tooltip.tsx`: thin wrapper (~20 lines) using Tailwind `group`/`group-hover` with absolutely positioned span. Dark-theme-styled (matches bg-gray-800/900), no delay, `role="tooltip"` + `aria-describedby` for accessibility. Replaces the HealthDot's bare `title` attr.
  - Create `lib/constants.ts`: strategy maturity phases with labels and descriptions ("Warming up = collecting data", "Pilot = live testing", "Live = full allocation"). Both strategy-panel and help modal import from here.
  - Wrap metric labels with `<Tooltip>` in:
    - `portfolio-summary.tsx` (6 metrics: Equity, Cash, Buying Power, PnL, etc.)
    - `strategy-panel.tsx` (5 metrics per card: Sharpe, Win Rate, Signals, PnL, Allocation %)
    - `risk-dashboard.tsx` (~7 rows: Missed Heartbeats, Daily PnL, Order Rate, etc. — include normal vs abnormal ranges)
    - `position-table.tsx` (6 column headers)
    - `order-blotter.tsx` (7 column headers)
  - Add strategy state legend to `strategy-panel.tsx` using shared constants from `lib/constants.ts`
  - Replace HealthDot's bare `title` attr with the new `<Tooltip>` component for consistency
  - Tooltip copy should reference OCaml source for precise definitions (risk thresholds from `risk_config.ml`, signal strength from `signal.ml`)

  **Patterns to follow:**
  - Tailwind `group`/`group-hover` pattern for hover interactions
  - Existing `text-gray-500` for secondary text
  - Color-coded status dots pattern for strategy state legend

  **Test scenarios:**
  - `<Tooltip>` component renders hint text on hover
  - `<Tooltip>` includes `role="tooltip"` and `aria-describedby`
  - Strategy state legend renders with all 3 states from shared constants
  - All 5 components render tooltip hints without visual regression

  **Verification:**
  - Hovering over any metric shows a dark-theme-styled explanation
  - Strategy states section includes a visible legend
  - Risk metrics explain what values are concerning
  - HealthDot uses new Tooltip component instead of bare `title` attr

- [ ] **Unit 4: Improve empty states with actionable guidance**

  **Goal:** Replace generic empty states with contextual messages that help users understand what to expect.

  **Requirements:** R6, R11

  **Dependencies:** None (parallel with Unit 3)

  **Files:**
  - Modify: `dashboard/app/components/position-table.tsx`
  - Modify: `dashboard/app/components/order-blotter.tsx`
  - Modify: `dashboard/app/components/strategy-panel.tsx`
  - Modify: `dashboard/app/components/pnl-chart.tsx`
  - Modify: `dashboard/app/components/price-chart.tsx`

  **Approach:**
  Current empty state text is inconsistent and unhelpful:
  - `position-table.tsx`: "No open positions" (text-gray-500 text-sm)
  - `order-blotter.tsx`: "No orders"
  - `strategy-panel.tsx`: "No strategies registered"
  - `pnl-chart.tsx`: "No equity data available" (props-driven, no loading skeleton — parent delegates data)
  - `price-chart.tsx`: "No chart data available" (renders inline, different pattern from other components)
  
  Replace each with context-specific messages:
  - Positions: "No open positions. Strategies will open positions when market opportunities are identified."
  - Orders: "No active orders. Orders appear here when strategies submit trades."
  - Strategies: "Awaiting market data. Signals will appear once strategies complete their warmup period."
  - PnL chart: "PnL history will appear after the first completed trade."
  - Price chart: "Price chart will appear once market data is available."
  
  Note: `portfolio-summary.tsx` and `risk-dashboard.tsx` have no empty-data state (only loading/error) — these always render when data exists, so no change needed there.
  
  Style empty states with muted text and an informational icon (using Unicode or inline SVG, no library). Keep skeleton/loading states for actual loading conditions — only change the "loaded but empty" state.

  **Patterns to follow:**
  - Existing three-branch pattern: loading (skeleton pulse) → error (text-gray-500) → data/empty
  - `position-table.tsx` as the cleanest example of this pattern
  - Tailwind `text-gray-500 text-sm` for empty state text

  **Test scenarios:**
  - Position table shows guidance message when positions array is empty
  - Order blotter shows guidance when no active orders
  - PnL chart shows guidance when chartData is empty array
  - Messages are visible and readable against dark background (gray-950)

  **Verification:**
  - Each component shows contextual empty state instead of generic text
  - Loading states (skeleton) remain unchanged
  - Empty states are visually distinct from error states

- [ ] **Unit 5: Create generic Modal wrapper and help modal content**

  **Goal:** Add a reusable `<Modal>` wrapper and a "?" help button that opens a modal with system documentation and glossary.

  **Requirements:** R9, R10, R11

  **Dependencies:** Unit 3 (shared constants for strategy states; tooltip copy informs glossary)

  **Files:**
  - Create: `dashboard/app/components/ui/modal.tsx`
  - Create: `dashboard/app/components/help-modal.tsx`
  - Modify: `dashboard/app/page.tsx`

  **Approach:**
  - Create `ui/modal.tsx`: generic `<Modal isOpen onClose>` wrapper (~35 lines). Renders dark backdrop (`bg-black/60`), centers content, handles Escape key, traps focus (tab cycle within modal, focus returns to trigger on close). Must include `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to heading. This is the **first overlay in the dashboard** — establishing a clean reusable pattern.
  - Create `help-modal.tsx`: content component using `<Modal>` as wrapper. Sections:
    - **System Overview**: Trading agent architecture (engine, strategies, watchdog, risk management)
    - **Strategy States**: Import from `lib/constants.ts` (shared with strategy-panel legend)
    - **Key Metrics Glossary**: Sharpe ratio, win rate, allocation %, PnL, drawdown, etc.
    - **Kill Switch**: What it does, when to use it, two-step activation
    - **Risk Dashboard**: What each risk metric monitors
  - Add "?" icon button in the dashboard header — this is in `page.tsx` (lines 50-57). The header is a flex row with title + `EngineStatusBanner`; the "?" button goes as a third element in the `md:justify-between` flex container.
  - Style with Tailwind: dark theme colors (gray-800/900 card, gray-100 text), scrollable content

  **Patterns to follow:**
  - Existing Tailwind dark theme colors throughout dashboard components
  - `lib/constants.ts` strategy phase definitions from Unit 3

  **Test scenarios:**
  - `<Modal>` renders children when `isOpen={true}`, nothing when `false`
  - `<Modal>` calls `onClose` on Escape key and backdrop click
  - `<Modal>` includes `role="dialog"` and `aria-modal="true"`
  - Focus is trapped within modal when open
  - "?" button visible in header, opens help modal on click
  - Help modal renders all 5 sections
  - Modal content is scrollable for smaller viewports

  **Verification:**
  - Help modal accessible from any dashboard page
  - All documented sections present and readable
  - Strategy states in modal match legend in strategy-panel (same source of truth)
  - Modal is non-intrusive, properly dismissable, and accessible

## System-Wide Impact

- **Strategy runner refactor — full consumer list**: The following files import from `strategy-runner.ts` and need import path updates:
  - `engine/src/orchestrator.ts` — imports class, `STRATEGY_NAMES`, and 4 types (`SymbolMarketData`, `Phase`, `Regime`, `StrategySignal`). Calls 4 public methods: `checkPrimed()`, `allPrimed()`, `getMetrics()`, `runStrategies()`. None of these method signatures change.
  - `engine/src/rebalancer.ts` — imports `STRATEGY_NAMES`, `StrategyId`, `Regime`, `Phase`
  - `engine/src/conflict-resolver.ts` — imports `StrategySignal`
  - `engine/src/main.ts` — imports `StrategyRunner` class, constructs it
  - `engine/src/config-poller.ts` — has a **duplicate** `STRATEGY_NAMES` (line 74-80) that must be consolidated
  - `engine/test/strategies.test.ts` — imports class and types (public API only, no internal function refs)
  - `engine/test/strategy-toggle.test.ts` — imports class and types (public API only)
- **Strategy runner refactor — behavioral change in Unit 2**: Runner stamps `signal.strategy = module.id` post-generate. This is a subtle behavior change: if any generator currently returns a wrong strategy ID, the stamping would fix it silently. Verify that all generators currently return the correct ID before applying the change.
- **Dashboard — new UI primitives**: Two new shared components (`ui/tooltip.tsx`, `ui/modal.tsx`) and a constants file (`lib/constants.ts`) establish patterns that future features should follow. The `<Tooltip>` replaces HealthDot's bare `title` attr.
- **Dashboard — empty state scope**: Only components with existing empty branches are modified (position-table, order-blotter, strategy-panel, pnl-chart, price-chart). Components without empty states (portfolio-summary, risk-dashboard) are unchanged — they always render data when present.
- **No new dependencies**: All changes use Tailwind CSS and React built-ins. Tooltip and modal are Tailwind-only components.
- **Test surface**: New unit tests for individual strategy modules (enabling testing previously impossible since generators were unexported). New tests for `<Tooltip>` and `<Modal>` components. Dashboard visual changes should be verified by browser inspection.

## Risks & Dependencies

- **Strategy extraction regression risk**: Low. All tests use the public API only; no internal functions are referenced. Mitigated by keeping `StrategyRunner` public API identical and running full test suite.
- **`STRATEGY_NAMES` duplication**: Two independent copies exist (strategy-runner.ts and config-poller.ts line 74-80). If these diverge, strategy toggling silently breaks. Unit 1 consolidates to a single source in `strategies/index.ts`. Verify both copies are identical before removing the duplicate.
- **Import chain breadth**: 6 source files + 2 test files import from `strategy-runner.ts`. All import paths must be updated in Unit 1. Risk: missing one file causes a compile error, but this is caught immediately by TypeScript and tests.
- **Signal ID stamping (Unit 2)**: Runner overwriting `signal.strategy` is a subtle behavior change. Before applying, verify all 5 generators currently return the correct ID. If any are wrong, the stamping would silently fix a pre-existing bug — document this.
- **Per-strategy health thresholds (Unit 2)**: Calendar seasonal's different cadence is a real concern — it will be falsely marked unhealthy during quiet calendar periods. Setting a higher missThreshold mitigates this. However, the "right" values depend on observation, so initial values are estimates to be tuned.
- **Tooltip text accuracy**: Copy needs review to ensure metric explanations match actual calculation behavior. Mitigated by referencing OCaml source (`signal.ml`, `risk_config.ml`) for precise definitions.
- **Dark-theme tooltip styling**: The Tailwind `group-hover` tooltip must be tested on dark backgrounds. Ensure sufficient contrast (WCAG AA: 4.5:1 for normal text).
- **Modal focus trapping**: Focus trapping without a library requires careful implementation (tab cycle, shift+tab, focus return on close). Keep the implementation simple — a minimal focus trap on first/last focusable elements.
- **TODO 009 depends on 006**: Help modal glossary uses shared constants and should match tooltip copy. Sequencing Units 3-4 before Unit 5 ensures this.

## Sources & References

- Related TODOs: `.context/compound-engineering/todos/005-ready-p2-decompose-strategy-runner.md`, `006-ready-p2-add-dashboard-tooltips-empty-states.md`, `009-ready-p3-add-dashboard-help-modal.md`
- Related plan: [2026-04-01-001-feat-engine-data-persistence-plan.md](2026-04-01-001-feat-engine-data-persistence-plan.md) (covers TODOs 007, 008)
- Strategy runner: `engine/src/strategy-runner.ts`
- Dashboard components: `dashboard/app/components/*.tsx`
- Dashboard layout: `dashboard/app/layout.tsx`
- OCaml types: `trading-core/lib/types.ml`, `trading-core/lib/signal.ml`, `trading-core/lib/risk_config.ml`
