---
title: "feat: Add off-hours simulation mode with historical data replay"
type: feat
status: active
date: 2026-03-30
---

# feat: Add off-hours simulation mode with historical data replay

## Overview

Add an environment-driven simulation mode (`SIMULATION_MODE=true`) that replays a previous trading day's market data through the full engine pipeline during off-hours. This exercises strategies, risk evaluation, order flow, and dashboard visualization exactly as if the market were open, with simulated order fills instead of live Alpaca API calls.

## Problem Frame

The engine sits idle in `Off_hours` state when the market is closed. There is no way to verify that strategies, risk evaluation, conflict resolution, order submission, and the dashboard render correctly during a live trading session without waiting for market hours. The user needs a way to see the full system behave in real-time during off-hours to build confidence before the next market open.

## Requirements Trace

- R1. `SIMULATION_MODE=true` env var activates simulation; unset = normal live trading (zero regression)
- R2. Historical 1-minute bars from a configurable date replayed through the full pipeline
- R3. Simulated order fills at next bar's open + slippage (no Alpaca order API calls)
- R4. Dashboard renders all components (charts, positions, orders, PnL, strategies) without changes
- R5. Configurable replay speed (1x real-time, 10x accelerated, etc.)
- R6. Full event bus emission (tick, signal, order-submitted, order-filled, risk-alert, state-transition)

## Scope Boundaries

- **Not** a full backtesting framework — no walk-forward, no parameter sweeps
- **Not** modifying the backtest workspace — only reusing its data loader
- **Not** simulating extended hours, pre-market, or holidays
- **Not** building a UI toggle in the dashboard — activation is env-var only
- **Not** persisting simulation results to DynamoDB (transient only)

## Context & Research

### Relevant Code and Patterns

- **Market hours gating**: `orchestrator.ts:47-69` — `getEasternTime()` and `isMarketOpen()` control all state transitions
- **Market hours transitions**: `orchestrator.ts:604-643` — `checkMarketHoursTransitions()` called every tick
- **Market close procedures**: `orchestrator.ts:579-602` — `checkMarketCloseProcedures()` for 3:50/3:55 unwind
- **Tick loop**: `orchestrator.ts:312-320` — `setInterval(tick, tickIntervalMs)` default 1000ms
- **Data wiring**: `orchestrator.ts:712-744` — `wireMarketDataEvents()` listens for `trade`, `quote`, `bar` events on `MarketDataStream` and updates `barBuffer`/`latestQuotes` maps
- **Order wiring**: `orchestrator.ts:746-764` — `wireOrderEvents()` listens for `orderUpdate` on `OrderManager` and emits `order-filled` on the EventBus
- **Data loader**: `backtest/src/data-loader.ts:50-111` — `downloadBars()` fetches from Alpaca REST with pagination and caching
- **MarketDataStream**: Extends `EventEmitter`, emits `trade`, `quote`, `bar` events — SimulationController can emit on the same instance
- **OrderManager**: Extends `EventEmitter`, emits `orderUpdate` events — MockOrderManager must match this
- **Constructor injection**: Orchestrator takes `MarketDataStream` and `OrderManager` via constructor (line 110-121) — clean seam for swapping implementations

### Key Architecture Insight

The orchestrator already has **two clean dependency injection seams**:
1. `MarketDataStream` — emits data events that `wireMarketDataEvents()` consumes
2. `OrderManager` — accepts `submitOrder()` calls and emits `orderUpdate` events

The simulation mode leverages these seams: we don't call `connect()` on the real MarketDataStream (preventing the live WebSocket), and we emit synthetic events on it from the SimulationController. We swap the OrderManager with a MockOrderManager that simulates fills locally.

## Key Technical Decisions

- **Emit events on existing MarketDataStream instance** rather than writing directly to orchestrator's private maps: The `wireMarketDataEvents()` handler (line 712) already processes `bar`, `quote`, `trade` events and updates `barBuffer`/`latestQuotes`. Emitting on the same EventEmitter reuses this code path identically. No need to expose private maps.

- **MockOrderManager as separate class** rather than a mode flag inside OrderManager: Keeps the live OrderManager untouched (zero risk). MockOrderManager only needs `submitOrder()`, `connectTradeUpdates()`, `disconnectTradeUpdates()`, and the kill switch stubs. TypeScript structural typing accepts it via cast in `main.ts`.

- **SimulationController manages its own replay timer** independent of the orchestrator's tick timer: The tick loop (1000ms) processes whatever data exists in the maps. The replay timer (60s/speed) adds new bars. At 10x speed, a new bar appears every 6 seconds — the tick loop processes it ~6 times before the next bar arrives, which is realistic (in live trading, ticks process the same data until new quotes arrive).

- **Reuse backtest's `downloadBars()`** for historical data: Already handles Alpaca pagination, caching, and rate limiting. Import via relative path from monorepo.

- **Skip `state.reconcileWithAlpaca()` in simulation mode**: Set synthetic initial state (equity=$1000, cash=$1000) to avoid hitting the Alpaca account API, which would overwrite our simulation state with real account data.

- **Three guard clauses in orchestrator** rather than a time provider abstraction: `checkMarketHoursTransitions()`, `checkMarketCloseProcedures()`, and `enterStarting()` each get a one-line `if (this.config.simulationMode) ...` guard. This is the minimum-invasive change that achieves the goal without over-engineering.

## Open Questions

### Resolved During Planning

- **Q: Should we simulate time progression or just bypass time checks?** A: Bypass time checks. The orchestrator uses real wall clock for heartbeats, tick timestamps, and event timestamps. Simulating time would require mocking `Date.now()` globally, which is fragile and would affect logging, DynamoDB timestamps, and SSE event delivery. Instead, the bars replay at wall-clock speed and the engine processes them in real time.

- **Q: Where does warmup data come from in simulation?** A: From the Alpaca REST API, same as live mode. `enterWarmingUp()` fetches the last 100 minutes of bars. This works 24/7 (Alpaca serves historical data anytime). After warmup completes, the SimulationController starts replaying the target date's bars.

- **Q: How do simulated fills integrate with the State class?** A: Through the existing `wireOrderEvents()` handler (line 746). The MockOrderManager emits `orderUpdate` events with the same shape as the real OrderManager. The orchestrator's handler updates `State.updateOrder()` and emits `order-filled` on the EventBus. Dashboard receives it via SSE — no changes needed.

### Deferred to Implementation

- **Exact fill timing**: Whether to fill on the bar immediately following the order or add a configurable delay. Start with immediate next-bar fills (matching backtest behavior).
- **Alpaca `downloadBars` error handling for weekends/holidays**: If the target date has no trading data, `downloadBars` returns empty arrays. The SimulationController should detect this and log a clear error.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
SIMULATION MODE DATA FLOW
==========================

[Alpaca REST API]  --historical bars-->  [SimulationController]
                                              |
                                    loads bars for target date
                                    builds merged timeline
                                              |
                              startReplay() on timer (60s / speed)
                                              |
                        emits bar/quote/trade events on MarketDataStream
                                              |
                    [Orchestrator.wireMarketDataEvents()]  (existing, unchanged)
                              |                    |
                    barBuffer updated        latestQuotes updated
                              |                    |
                    [tick() loop every 1s]  (existing, unchanged)
                              |
                    buildMarketDataSnapshots()
                              |
                    strategyRunner.runStrategies()
                              |
                    conflictResolver.resolve()
                              |
                    Risk.evaluate()
                              |
                    submitOrder() -----> [MockOrderManager]
                              |                |
                              |         stores pending order
                              |         on next bar: simulates fill
                              |         emits 'orderUpdate' event
                              |                |
                    [wireOrderEvents()]  <------+  (existing, unchanged)
                              |
                    State.updateOrder() + bus.emit('order-filled')
                              |
                    [Dashboard via SSE]  (existing, unchanged)
```

## Implementation Units

- [ ] **Unit 1: Config extension**

  **Goal:** Add simulation-related fields to `EngineConfig` so all components can check `config.simulationMode`.

  **Requirements:** R1, R5

  **Dependencies:** None

  **Files:**
  - Modify: `engine/src/config.ts`
  - Test: `engine/test/alpaca/client.test.ts` (config tests section)

  **Approach:**
  - Add `simulationMode: boolean` (from `SIMULATION_MODE` env var, default `false`)
  - Add `simulationDate: string | undefined` (from `SIMULATION_DATE`, default undefined = previous trading day)
  - Add `simulationSpeed: number` (from `SIMULATION_SPEED`, default `1`)
  - All fields have defaults that preserve existing behavior when unset

  **Patterns to follow:**
  - Existing `intEnv()` and `optionalEnv()` helpers in `config.ts`

  **Test scenarios:**
  - `simulationMode` is `false` when `SIMULATION_MODE` is unset
  - `simulationMode` is `true` when `SIMULATION_MODE=true`
  - `simulationSpeed` defaults to 1
  - `simulationDate` is undefined when unset
  - All existing config tests continue to pass

  **Verification:**
  - `npx vitest run` in engine passes with no regressions

---

- [ ] **Unit 2: SimulationController**

  **Goal:** Create the data replay controller that loads historical bars and drip-feeds them through the MarketDataStream EventEmitter.

  **Requirements:** R2, R5, R6

  **Dependencies:** Unit 1

  **Files:**
  - Create: `engine/src/simulation/controller.ts`
  - Test: `engine/test/simulation/controller.test.ts`

  **Approach:**
  - Import `downloadBars` from `../../backtest/src/data-loader.js` (relative monorepo path)
  - `loadData(symbols, date, apiKey, secret)`: For each symbol, call `downloadBars()` to fetch 1-minute bars for the target date (9:30 AM - 4:00 PM ET). Build a merged timeline sorted by timestamp.
  - `startReplay()`: Start an interval timer at `60000 / config.simulationSpeed` ms. Each tick advances the timeline index and emits `bar`, `quote`, and `trade` events on the MarketDataStream instance.
  - Synthetic quotes: `bid = bar.c * 0.9995`, `ask = bar.c * 1.0005` (10 bps spread)
  - Synthetic trades: `price = bar.c`, `size = bar.v`
  - `getNextBar(symbol)` / `getCurrentBar(symbol)`: Used by MockOrderManager for fill price calculation
  - `onBarReplayed` callback registration: MockOrderManager hooks in to trigger pending fills on each new bar
  - `getPreviousTradingDay()` helper: Returns most recent weekday as `YYYY-MM-DD`

  **Patterns to follow:**
  - Backtest runner's merged timeline pattern (`runner.ts` line 262-268)
  - Event emission matching `MarketDataEvents` interface in `market-data.ts:22-29`

  **Test scenarios:**
  - Loads bars for all provided symbols (mock `downloadBars`)
  - Merged timeline is sorted chronologically
  - Emits `bar` event with `{o, h, l, c, v}` shape matching what `wireMarketDataEvents` expects
  - Emits `quote` event with `{bp, ap, bs, as, t}` shape
  - Emits `trade` event with `{p, s, t}` shape
  - Replay speed: at speed=10, interval is 6000ms
  - `isComplete()` returns true after all bars replayed
  - `getNextBar(symbol)` returns the correct bar
  - Handles symbols with different bar counts gracefully
  - `getPreviousTradingDay()` skips Saturday/Sunday

  **Verification:**
  - All new tests pass
  - Can be instantiated with a real MarketDataStream and emit events that the stream's listeners receive

---

- [ ] **Unit 3: MockOrderManager**

  **Goal:** Create a mock order manager that accepts `submitOrder()` calls and simulates fills using the SimulationController's bar data.

  **Requirements:** R3, R6

  **Dependencies:** Unit 2

  **Files:**
  - Create: `engine/src/simulation/mock-order-manager.ts`
  - Test: `engine/test/simulation/mock-order-manager.test.ts`

  **Approach:**
  - Extends `EventEmitter` (same base as real OrderManager)
  - `submitOrder(params)`: Generate client_order_id via `makeClientOrderId()`, create synthetic `AlpacaOrder` with status `'new'`, store in tracked orders, return immediately
  - `processPendingFills(symbol, bar)`: Called when a new bar is replayed. For each pending order matching the symbol, calculate fill price: `bar.o * (1 + slippagePct)` for buys, `bar.o * (1 - slippagePct)` for sells. Emit `orderUpdate` event matching the shape expected by `wireOrderEvents()` (line 747): `{ type: 'fill', clientOrderId, order: AlpacaOrder, fillQty, fillPrice }`
  - Default slippage: 0.05% (5 bps), matching backtest convention
  - `connectTradeUpdates()`, `disconnectTradeUpdates()`, `killSwitchCancelAll()`, `killSwitchCloseAll()`: No-op stubs
  - Synthetic AlpacaOrder must include: `id`, `client_order_id`, `created_at`, `asset_id`, `symbol`, `qty`, `filled_qty`, `filled_avg_price`, `order_type`, `type`, `side`, `time_in_force`, `status`, `extended_hours`

  **Patterns to follow:**
  - `makeClientOrderId()` from `engine/src/alpaca/order-manager.ts`
  - `AlpacaOrder` type from `engine/src/alpaca/types.ts`
  - `wireOrderEvents()` event shape at `orchestrator.ts:747-764`

  **Test scenarios:**
  - `submitOrder()` returns valid AlpacaOrder with all required fields
  - Unique client_order_ids across multiple orders
  - Buy orders fill at `bar.open * 1.0005`
  - Sell orders fill at `bar.open * 0.9995`
  - `orderUpdate` event emitted on fill with correct shape
  - No fills for unrelated symbols
  - Kill switch methods are callable no-ops
  - Tracked orders retrievable via getter

  **Verification:**
  - All new tests pass
  - Event shape matches what `wireOrderEvents()` consumes (verified by reading orchestrator code)

---

- [ ] **Unit 4: Orchestrator guard clauses**

  **Goal:** Make the orchestrator respect simulation mode by skipping market hours checks and live connections.

  **Requirements:** R1

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/orchestrator.ts`
  - Test: `engine/test/orchestrator.test.ts` (existing tests must still pass)

  **Approach:**
  Three surgical changes, each a one-line guard:

  1. **`enterStarting()` (line ~198)**: When `this.config.simulationMode`, skip `state.reconcileWithAlpaca()`, `marketData.connect()`, and `orderManager.connectTradeUpdates()`. Instead, set synthetic state: `equity=1000, cash=1000, buyingPower=1000, peakEquity=1000`.

  2. **`checkMarketHoursTransitions()` (line ~604)**: Add `if (this.config.simulationMode) return;` at the top. This prevents the engine from transitioning to Off_hours based on real wall-clock time.

  3. **`checkMarketCloseProcedures()` (line ~579)**: Add `if (this.config.simulationMode) return;` at the top. This prevents the 3:50/3:55 PM unwind/cancel procedures.

  **Test scenarios:**
  - All 20 existing orchestrator tests pass unchanged (they don't set `simulationMode`)
  - Manual verification: with `simulationMode=true`, engine stays in Trading state regardless of real time

  **Verification:**
  - `npx vitest run` passes with no regressions
  - Diff is exactly 3 guard clauses + synthetic state initialization (under 15 lines total)

---

- [ ] **Unit 5: Main entry point integration**

  **Goal:** Wire everything together in `main.ts` with conditional initialization based on `simulationMode`.

  **Requirements:** R1, R2, R3, R4, R5, R6

  **Dependencies:** Units 1-4

  **Files:**
  - Modify: `engine/src/main.ts`
  - Test: `engine/test/simulation/integration.test.ts`

  **Approach:**
  - When `config.simulationMode`:
    - Still create `AlpacaClient` (needed for warmup bar fetching)
    - Still create `MarketDataStream` (needed as EventEmitter target) but don't call `connect()`
    - Create `SimulationController` with MarketDataStream reference
    - Create `MockOrderManager` with SimulationController reference
    - Call `simulationController.loadData()` to pre-fetch historical bars
    - Pass MockOrderManager (cast as `OrderManager`) to Orchestrator constructor
    - After orchestrator starts, listen for `warmup-complete` event on EventBus, then call `simulationController.startReplay()`
  - When not `config.simulationMode`: unchanged behavior

  **Patterns to follow:**
  - Existing component initialization pattern in `main()` (lines 192-240)

  **Test scenarios:**
  - Full pipeline: start in simulation mode with pre-loaded bars -> warmup completes -> replay starts -> at least one signal generated -> at least one order submitted and filled
  - Verify no `createOrder` calls to Alpaca SDK during simulation
  - Verify SSE events emitted (tick, signal, order-submitted, order-filled)
  - Verify live mode startup unaffected when `SIMULATION_MODE` is unset

  **Verification:**
  - All engine tests pass
  - Manual smoke test: set `SIMULATION_MODE=true` and `SIMULATION_SPEED=10` in `.env`, start engine, open dashboard, observe trading activity

---

- [ ] **Unit 6: Simulation end handling**

  **Goal:** Gracefully handle when all historical bars have been replayed.

  **Requirements:** R6

  **Dependencies:** Unit 5

  **Files:**
  - Modify: `engine/src/simulation/controller.ts`
  - Modify: `engine/src/main.ts` (listen for completion)

  **Approach:**
  - When `SimulationController.isComplete()` returns true, stop the replay timer
  - Emit a `simulation-complete` log message
  - The engine continues running in Trading state (tick loop still active, but no new data arrives)
  - Dashboard shows final state with all accumulated positions, orders, and PnL
  - User can restart with different date/speed by changing env vars and restarting

  **Test scenarios:**
  - Small dataset (10 bars) replays fully and stops without crash
  - Timer is cleaned up (no memory leak)
  - Engine remains responsive after replay completes (health endpoint works)

  **Verification:**
  - No error in logs after replay completes
  - Dashboard continues to show final state

## System-Wide Impact

- **Interaction graph:** SimulationController emits on MarketDataStream (EventEmitter) -> wireMarketDataEvents consumes. MockOrderManager emits `orderUpdate` -> wireOrderEvents consumes -> EventBus -> SSE -> Dashboard. All existing paths, no new ones.
- **Error propagation:** If `downloadBars()` fails for a symbol, log error and continue with remaining symbols. If all symbols fail, log error and stay in Warming_up state.
- **State lifecycle risks:** Simulation positions are ephemeral (in-memory only). No DynamoDB persistence of simulation trades. No risk of mixing simulation state with live account state since the Alpaca reconciliation is skipped.
- **API surface parity:** Dashboard needs zero changes. All engine HTTP endpoints (`/health`, `/api/account`, `/api/positions`, `/api/orders`, `/api/strategies`, `/events`) work identically.
- **Integration coverage:** The full pipeline from bar -> strategy -> risk -> order -> fill -> event -> dashboard is exercised. The only component NOT exercised is the real Alpaca WebSocket and REST order API.

## Risks & Dependencies

- **Alpaca REST API availability**: Historical data fetching (`downloadBars`) requires API access. If Alpaca is down, simulation can't load data. Mitigation: data is cached to disk after first fetch.
- **Backtest data-loader import**: Cross-workspace import (`../../backtest/src/data-loader.js`) relies on monorepo layout. If workspaces are restructured, this path breaks. Mitigation: low risk, monorepo layout is stable.
- **TypeScript structural compatibility**: MockOrderManager must structurally match `OrderManager` where used. If new methods are added to OrderManager in the future, MockOrderManager needs updating. Mitigation: TypeScript compiler will catch this.

## Sources & References

- Related code: `engine/src/orchestrator.ts` (state machine, tick loop, data wiring)
- Related code: `backtest/src/data-loader.ts` (historical data fetching)
- Related code: `engine/src/alpaca/market-data.ts` (MarketDataStream event interface)
- Related code: `engine/src/alpaca/order-manager.ts` (OrderManager interface, order event shape)
