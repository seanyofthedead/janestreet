---
title: "feat: Add P1 Action Parity APIs (Order Cancel, Halt Ack, Strategy Toggle)"
type: feat
status: completed
date: 2026-03-31
deepened: 2026-03-31
origin: .context/compound-engineering/todos/001-ready-p1-add-order-cancel-position-close-apis.md, .context/compound-engineering/todos/002-ready-p1-add-halt-acknowledgment-endpoint.md, .context/compound-engineering/todos/003-ready-p1-add-strategy-enable-disable-api.md
---

# feat: Add P1 Action Parity APIs (Order Cancel, Halt Ack, Strategy Toggle)

## Overview

Add three groups of mutating API endpoints to the engine to close the action parity gap identified in the agent-native audit. Currently the engine only exposes read-only endpoints and a blunt kill-switch. These additions enable selective order cancellation, halt recovery, and runtime strategy toggling — all essential for autonomous and user-driven operation.

## Problem Frame

The engine HTTP server has zero mutating endpoints. Users and agents cannot:
- Cancel a specific order or close a specific position (only "cancel ALL" via kill switch)
- Acknowledge a halt to recover the engine without restarting the process
- Enable or disable individual strategies at runtime

This blocks autonomous operation and forces manual intervention for routine actions. The agent-native audit scored Action Parity at 53% and CRUD Completeness at 33%, with these three gaps as the primary contributors.

## Requirements Trace

- R1. Individual order cancellation via API (see origin: TODO 001)
- R2. Individual position close via API (see origin: TODO 001)
- R3. Halt acknowledgment endpoint that transitions engine out of Halted state (see origin: TODO 002)
- R4. Strategy enable/disable endpoints with DynamoDB persistence (see origin: TODO 003)
- R5. All mutating endpoints require X-API-Key authentication
- R6. All actions emit events to the SSE stream for dashboard visibility
- R7. Error responses for invalid inputs (unknown order ID, symbol, strategy, wrong engine state)

## Scope Boundaries

- No dashboard UI changes — endpoints only (dashboard can consume via existing SSE)
- No new npm dependencies
- No changes to OCaml/Melange core
- No changes to watchdog (watchdog Alpaca duplication is TODO 010, separate scope)
- Strategy toggle uses DynamoDB persistence, not in-memory-only overrides

## Context & Research

### Relevant Code and Patterns

- **Engine HTTP server:** `engine/src/main.ts` — raw `node:http` with `switch(path)` routing, no method checking, no body parsing, no auth
- **Auth pattern:** `watchdog/src/main.ts` (lines 55-68) — `X-API-Key` checked against `config.localApiSecret`
- **Engine config:** `engine/src/config.ts` loads `LOCAL_API_SECRET` env var but never uses it in HTTP handlers
- **SSE/EventBus:** `engine/src/event-bus.ts` — typed event emitter; `handleSSE()` in `main.ts` subscribes to named events
- **AlpacaClient:** `engine/src/alpaca/client.ts` — has `cancelAllOrders()`, `closeAllPositions()`, but no single-order/position variants. SDK accessible via `this.sdk` getter
- **OrderManager:** `engine/src/alpaca/order-manager.ts` — has `submitOrder()`, `killSwitchCancelAll()`, `killSwitchCloseAll()`, but no `cancelOrder(id)` or `closePosition(symbol)`. Is `private` on Orchestrator
- **ConfigPoller:** `engine/src/config-poller.ts` — reads `trading-config` table from DynamoDB. Has `isHumanAcknowledged()` and `clearAcknowledgment()` but no setter. `enabledStrategies` field exists in `RuntimeConfig` but is never read in strategy runner
- **StrategyRunner:** `engine/src/strategy-runner.ts` — `runStrategies()` checks `Types.strategy_enabled_for_phase()` (OCaml) but ignores `enabledStrategies` from config
- **Orchestrator:** `engine/src/orchestrator.ts` — exposes `bus`, `state`, `strategyRunner`, `configPoller`, `alpacaClient` as `readonly`. `orderManager` is **private**
- **State machine:** Engine states include `Halted` with reason. Recovery via `checkHaltedRecovery()` which polls `configPoller.isHumanAcknowledged()`
- **DynamoDB:** `engine/src/dynamodb.ts` — `TABLE_CONFIG = 'trading-config'`, key structure `{ key: 'RUNTIME_CONFIG' }`
- **CORS:** Currently hardcoded to `'GET, OPTIONS'` and `'Content-Type, Authorization'` headers only

### Institutional Learnings

No `docs/solutions/` exists yet. Relevant knowledge from project memory:
- DynamoDB runs in-memory mode for reliability
- Alpaca SDK pinned to 3.1.3

## Key Technical Decisions

- **No router library — parameterized routes checked first:** The server currently has 7 exact-match GET routes in a `switch(path)` block. Adding 6 parameterized routes via `startsWith` inside the same switch would be inconsistent. Instead: check parameterized routes first via `if/else if` with method + `startsWith` guards, then fall through to the `switch` for existing exact-match GET routes. This keeps existing routes untouched while cleanly dispatching new ones.
- **Auth helper function, not middleware:** Extract a reusable `requireAuth(req, secret)` function that returns `true/false`. No middleware chain exists to hook into. The `config.localApiSecret` value is already loaded from `LOCAL_API_SECRET` env var in `engine/src/config.ts` but never used — this plan activates it.
- **Body parsing is forward-looking infrastructure only:** None of the 5 new endpoints actually need a request body — all parameters are in URL paths. Build `parseJsonBody(req)` as a utility for future use (e.g., TODO 007 risk config endpoint) but do not call it from any handler in this plan.
- **Expose OrderManager via Orchestrator:** Add a public `cancelOrder()` and `closePosition()` method on Orchestrator that delegates to OrderManager, rather than making OrderManager public. This preserves encapsulation and allows Orchestrator to emit events, record P&L, and trigger reconciliation.
- **Position close P&L must be recorded BEFORE reconciliation:** The `closePosition()` method on Orchestrator must: (1) read current position from `state.getPosition(symbol)` to get `unrealizedPl` and entry price, (2) submit the close order via AlpacaClient, (3) record P&L via `performanceTracker.recordTrade()`, (4) THEN call `state.reconcileWithAlpaca()`. If reconciliation happens first, the position data needed for P&L is gone.
- **SSE eventNames array must be updated explicitly:** The `handleSSE()` function in `main.ts` has a hardcoded `eventNames` array listing which events are forwarded to SSE clients. New events (`order-canceled`, `position-closed`, `halt-acknowledged`, `strategy-toggled`) must be added to this array or they will never reach the dashboard. Each unit that adds events is responsible for updating this array.
- **ConfigPoller needs a public `forcePoll()` method:** The existing `poll()` is private and only runs on a timer. The strategy toggle endpoint needs to trigger an immediate poll after writing to DynamoDB. Add `async forcePoll(): Promise<void>` that delegates to `poll()`.
- **Cancel order requires Alpaca UUID lookup:** The Alpaca SDK's `cancelOrder()` requires the Alpaca-generated UUID, not the client order ID. The endpoint must accept client order ID (what users see), look up the `AlpacaOrder` from `OrderManager.trackedOrders` to extract the `.id` (Alpaca UUID), then pass that to the SDK. If the order is not in tracked orders, fall back to `sdk.getByClientOrderId()` for lookup.
- **Position close triggers reconciliation:** `State` has no `removePosition()` method — positions are only updated via `reconcileWithAlpaca()`. After a position close order is confirmed, call `state.reconcileWithAlpaca()` to sync the positions map. Also record the closing P&L in `PerformanceTracker`.
- **ConfigPoller gets a `setAcknowledgment()` method:** For immediate halt recovery without waiting for the next poll cycle. Also persists to DynamoDB for durability.
- **Halt acknowledgment with pre-validation:** Before accepting acknowledgment, re-evaluate the conditions that caused the halt (fetch current equity from Alpaca, check drawdown/daily loss thresholds). Reject acknowledgment with explanation if danger conditions persist.
- **Strategy toggle is restrict-only (cannot override phase safety):** The OCaml `strategy_enabled_for_phase()` function is a hard safety constraint — it blocks risky strategies in small account phases (e.g., Market_making blocked below $10k due to PDT risk). The `enabledStrategies` config override can only *further restrict* (disable a phase-allowed strategy), never *enable* a phase-blocked strategy. The check in `runStrategies()` should be: skip if phase blocks it OR if config disables it (logical AND, not OR). Attempting to enable a phase-blocked strategy via API returns an error explaining the phase restriction.
- **Strategy toggle uses read-modify-write on DynamoDB:** The ConfigPoller does a full object replace on poll (`this.current = newConfig`). The strategy toggle endpoint must read the current `enabledStrategies` object from DynamoDB, modify the target strategy, then write the full object back. Do not mutate in-memory config directly — let the next poll pick it up, or force an immediate poll after the write completes.

## Error Handling Approach

The codebase has a consistent resilience pattern that new endpoints must follow:

- **Alpaca API calls:** No retry logic exists anywhere in the codebase. The rate limiter prevents 429s but does not handle them. All errors propagate to callers. New endpoints should wrap Alpaca calls in try/catch at the call site, return appropriate HTTP status codes (502 for Alpaca errors, 404 for not-found), and include enough context for the caller to retry or poll.
- **DynamoDB writes:** Treated as non-fatal throughout the codebase. `State.persistState()` uses fire-and-forget (`.catch(() => {})`). `ConfigPoller.fetchFromDynamoDB()` falls back to last-known-good config on failure. `PerformanceTracker.persistDaily()` catches per-strategy and continues. New endpoints should follow the same pattern: DynamoDB write failures logged but not propagated as 500s unless the write is the primary action (e.g., strategy toggle).
- **Tick resilience:** The orchestrator's `tick()` runs in a `setInterval` with `.catch()` — a single tick failure is logged and the loop continues. `submitOrder()` has its own try/catch to contain per-order failures. `handleKillSwitch()` catches cancel/close errors but proceeds with state transition regardless. New endpoint business logic should follow this pattern: contain errors per-operation, proceed with state updates.
- **Idempotency:** Alpaca cancel is effectively idempotent — canceling an already-canceled order returns 404/422. New cancel handler should catch these and return success with a note. Close-position is NOT idempotent (closing an already-closed position is an error).

## Test Strategy

Three testing patterns exist in the codebase. New endpoint tests should use the appropriate pattern:

1. **Pure logic replication** (Pattern A, see `engine/test/orchestrator.test.ts`): Replicate business logic locally in the test file. No imports from production code, no mocks. Used for state transitions, conflict resolution, strategy health. **Use for:** testing the new strategy enablement gate logic in isolation.

2. **Class import with vi.mock for infrastructure** (Pattern B, see `engine/test/state.test.ts`): Import the real class, mock only the DynamoDB layer at the module boundary via `vi.mock('../src/dynamodb.js', ...)`. **Use for:** testing new ConfigPoller methods (`setAcknowledgment`, `setStrategyEnabled`, `forcePoll`), testing new OrderManager `cancelOrder` method.

3. **Real class with synthetic data helpers** (Pattern C, see `engine/test/strategies.test.ts`): Import real class, generate synthetic data with file-local helpers. No mocks. **Use for:** testing StrategyRunner changes (config-based strategy skipping).

**Key convention:** No HTTP handler tests exist in the codebase — test the business logic layer (Orchestrator methods, ConfigPoller methods, StrategyRunner), not the HTTP routing. The HTTP layer is thin dispatch and auth checking, which is covered by the integration test at `test/integration/full-cycle.test.ts`.

**Test naming:** `{module-name}.test.ts`, kebab-case matching the source module. Directory structure mirrors `src/`.

## Open Questions

### Resolved During Planning

- **Q: Should auth be added to existing read-only endpoints?** No — scope is new mutating endpoints only. Existing read endpoints remain unauthenticated (consistent with current behavior).
- **Q: Should `cancelOrder` use Alpaca order ID or client order ID?** The API accepts client order ID (what users see). Internally, the handler looks up the Alpaca UUID from `OrderManager.trackedOrders` before calling the SDK. The SDK's `cancelOrder()` only accepts Alpaca UUIDs (`DELETE /orders/{id}`). Fallback: use `sdk.getByClientOrderId()` if not in tracked orders.
- **Q: Should halt acknowledgment bypass the config poll cycle?** Yes — set the flag directly on ConfigPoller for immediate pickup on the next orchestrator tick (~1s), and persist to DynamoDB as backup.
- **Q: Can the strategy enable/disable API override OCaml phase restrictions?** No. The OCaml `strategy_enabled_for_phase()` function is a safety constraint (blocks risky strategies in small accounts). The API can only further restrict (disable), never override safety limits. The OCaml risk engine at `risk.ml:check_strategy_enabled` independently enforces the same restriction, so an override attempt would be rejected there anyway.
- **Q: Should position close update internal state directly?** No — `State` has no `removePosition()` method and positions are only synced via `reconcileWithAlpaca()`. After close confirmation, trigger a reconciliation to sync state. This is simpler and safer than adding incremental position mutation.
- **Q: Should cancel/close be allowed in any engine state?** Yes — cancel and close are risk-reducing actions that should always be available, including during Halted state. Only order submission should respect the trading-allowed gate. A user may want to reduce exposure while halted.
- **Q: What happens when Alpaca is unreachable during cancel/close?** Return 502 with Alpaca's error category (timeout, rejected, not found). Include the clientOrderId/symbol in the response so the caller can poll for the final state. No retry queue — callers are responsible for retry.
- **Q: What happens when Alpaca is unreachable during halt pre-validation?** Allow the acknowledgment with a warning in the response body that pre-validation was skipped. The engine will re-halt on the next tick if conditions are still dangerous. This prevents a deadlock where Alpaca connectivity issues caused the halt and also block recovery.
- **Q: What about concurrent cancel requests for the same order?** Catch Alpaca 404/422 responses (order already canceled/not found) and return 200 with a note that the order was already in a terminal state. Alpaca cancel is idempotent in practice.
- **Q: Should cancel check order status locally before calling Alpaca?** Yes — check `trackedOrders[clientOrderId].status` first. If already in a terminal state (filled, canceled, expired), return 409 immediately with the current status. Faster and gives better error messages, with an acceptable TOCTOU gap.
- **Q: What happens if `forcePoll()` fails after DynamoDB write?** Fall back to directly mutating `this.current.enabledStrategies[strategyName]` as a best-effort local override, with a warning log. The next successful poll will reconcile from DynamoDB.
- **Q: What happens if reconciliation fails after position close?** If `reconcileWithAlpaca()` throws, manually remove the position from `state.positions` as a best-effort fallback and log the inconsistency. Over-restriction (thinking position is still open) is the safer failure mode. The next tick's reconciliation will correct it.
- **Q: Should strategy names be case-sensitive?** Normalize to canonical form. Build an explicit reverse map from lowercase names to strategy IDs at module scope. Accept both numeric IDs (0-4) and case-insensitive names.
- **Q: Should new endpoints include engine state in the response?** Yes — include `engineState` in the response body of cancel/close so callers can detect if the engine transitioned (e.g., halted) during their request.

### Deferred to Implementation

- **Exact error message wording** — will be determined during implementation based on Alpaca SDK error responses
- **Rate limiting on new endpoints** — not needed for paper trading; can be added later if needed
- **Cool-off period after position close** — whether to add a temporary symbol blocklist preventing strategies from immediately re-entering a manually closed position. Likely useful but details depend on strategy runner architecture. Without it, strategies may re-enter within 1-2 seconds of a manual close.
- **Alpaca call timeout** — the existing `rateLimitedCall` has no timeout. New endpoints should consider wrapping Alpaca calls with `AbortSignal.timeout(10_000)` to prevent hung HTTP connections. The exact timeout value depends on observed Alpaca latency.
- **Input validation on path parameters** — validate `clientOrderId` matches the expected `{strategy}_{symbol}_{timestamp}_{nonce}` format, validate `symbol` is alphanumeric 1-5 characters. Return 400 for malformed inputs with generic error messages (do not leak Alpaca SDK error details).

## Implementation Units

- [x] **Unit 1: HTTP Infrastructure (Auth, Response Helpers, CORS, Routing Structure)**

  **Goal:** Add the foundational HTTP utilities and routing structure needed by all endpoint groups.

  **Requirements:** R5, R6

  **Dependencies:** None

  **Files:**
  - Create: `engine/src/http-utils.ts`
  - Modify: `engine/src/main.ts` (CORS headers, routing structure, OPTIONS handling)
  - Test: `engine/test/http-utils.test.ts`

  **Approach:**
  - Create `requireAuth(req: IncomingMessage, secret: string): boolean` — checks `X-API-Key` header against secret. Mirrors watchdog pattern at `watchdog/src/main.ts:55-68`.
  - Create `parseJsonBody<T>(req: IncomingMessage): Promise<T>` — forward-looking utility for future endpoints (not called by any handler in this plan). Should handle empty bodies gracefully.
  - Create `sendJson(res: ServerResponse, status: number, data: unknown): void` — convenience for JSON responses.
  - Create `sendError(res: ServerResponse, status: number, message: string): void` — convenience for error responses.
  - Update CORS `Access-Control-Allow-Methods` to include `POST, DELETE`.
  - Update CORS `Access-Control-Allow-Headers` to include `X-API-Key`.
  - Handle `OPTIONS` preflight requests for new methods.
  - Restructure routing in `createHttpServer()`: parameterized routes checked first via `if/else if` with `req.method` + `startsWith` guards, then fall through to existing `switch(path)` for exact-match GET routes. The `config` object is already in scope inside `createHttpServer()` — pass it as an argument to handler functions that need auth.
  - Add 405 Method Not Allowed response for routes that exist but are called with wrong HTTP method.

  **Patterns to follow:**
  - Watchdog auth pattern at `watchdog/src/main.ts` (lines 55-68)
  - Existing `res.writeHead()` / `res.end()` pattern in engine handlers
  - Existing test patterns use `vi.mock()` for DynamoDB stubs and file-local helpers (see `engine/test/state.test.ts`)

  **Test scenarios:**
  - `requireAuth` returns false when header is missing
  - `requireAuth` returns false when header value is wrong
  - `requireAuth` returns true when header matches secret
  - `parseJsonBody` parses valid JSON
  - `parseJsonBody` returns null/empty for empty body (non-throwing mode)
  - `parseJsonBody` rejects invalid JSON with error
  - `sendJson` formats response correctly
  - `sendError` formats error response correctly

  **Verification:**
  - All utility functions exported and tested
  - CORS headers updated in main server
  - Routing structure ready for parameterized routes

- [x] **Unit 2: Order Cancel and Position Close Endpoints**

  **Goal:** Add `DELETE /api/orders/:clientOrderId` and `POST /api/positions/:symbol/close` endpoints.

  **Requirements:** R1, R2, R5, R6, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/alpaca/client.ts` (add `cancelOrder`, `closePosition` methods)
  - Modify: `engine/src/alpaca/order-manager.ts` (add `cancelOrder` method)
  - Modify: `engine/src/orchestrator.ts` (add public `cancelOrder`, `closePosition` methods)
  - Modify: `engine/src/event-bus.ts` (add `order-canceled`, `position-closed` event types)
  - Modify: `engine/src/main.ts` (add route handlers, wire into switch)
  - Test: `engine/test/order-cancel.test.ts`

  **Approach:**
  - **AlpacaClient:** Add `cancelOrder(alpacaOrderId: string)` that calls `this.sdk.cancelOrder(alpacaOrderId)` with rate limiting. The SDK requires the Alpaca UUID, not client order ID. Add `closePosition(symbol: string)` that calls `this.sdk.closePosition(symbol)`.
  - **OrderManager:** Add `cancelOrder(clientOrderId: string)` that: (1) looks up the `AlpacaOrder` from `this.trackedOrders.get(clientOrderId)`, (2) extracts the `.id` (Alpaca UUID), (3) calls `alpacaClient.cancelOrder(alpacaUuid)`. If the order is not in tracked orders, fall back to `alpacaClient.sdk.getByClientOrderId(clientOrderId)` for lookup. Remove from tracked orders on success.
  - **Orchestrator:** Add public `cancelOrder(clientOrderId: string)` and `closePosition(symbol: string)` methods. `closePosition` must follow this exact sequence: (1) read position from `this.state.getPosition(symbol)` to capture `unrealizedPl` and entry price, (2) call `this.alpacaClient.closePosition(symbol)`, (3) record closing P&L via `this.performanceTracker.recordTrade()` using captured data, (4) call `this.state.reconcileWithAlpaca(this.alpacaClient)` to sync positions map. Reconciliation must come LAST because it wipes position data. Both methods emit events via `this.bus`.
  - **EventBus:** Add `OrderCanceledEvent` and `PositionClosedEvent` interfaces to the `EngineEvents` map at `event-bus.ts:94-105`. Also add `'order-canceled'` and `'position-closed'` to the `eventNames` array in `handleSSE()` at `main.ts:126-137` — without this, new events will never reach SSE clients.
  - **Route handlers:** `handleCancelOrder(req, res, config, orchestrator)` — parse client order ID from path, auth check, call `orchestrator.cancelOrder()`. `handleClosePosition(req, res, config, orchestrator)` — parse symbol from path, auth check, call `orchestrator.closePosition()`.
  - **Path parsing:** Match `path.startsWith('/api/orders/')` for DELETE and `path.startsWith('/api/positions/')` with path ending in `/close` for POST. Extract parameter from path segments.

  **Patterns to follow:**
  - `OrderManager.submitOrder()` for the tracked-order lifecycle pattern
  - `AlpacaClient.cancelAllOrders()` for rate limiting pattern
  - `State.reconcileWithAlpaca()` for position sync after close
  - Existing handler functions in `main.ts` for response format

  **Test scenarios:**
  - Cancel order with valid client order ID succeeds (verifies Alpaca UUID lookup from trackedOrders)
  - Cancel order with unknown ID returns 404
  - Cancel order without auth returns 401
  - Cancel order where client order ID is not in tracked orders falls back to SDK lookup
  - Cancel order where order is already in terminal state (filled/canceled) returns 409 with status
  - Cancel order where Alpaca returns 404/422 (already canceled) returns 200 with note
  - Cancel order where Alpaca is unreachable returns 502 with clientOrderId for caller polling
  - Cancel/close allowed in Halted engine state (risk-reducing actions always available)
  - Close position with valid symbol succeeds
  - Close position P&L recorded BEFORE reconciliation (sequence: capture position -> close -> record P&L -> reconcile)
  - Close position records P&L in PerformanceTracker using captured unrealizedPl
  - Close position triggers `reconcileWithAlpaca()` — positions map updated
  - Close position where reconciliation fails — position removed manually as fallback
  - Close position with unknown symbol returns 404
  - Close position without auth returns 401
  - Response body includes current `engineState` for caller awareness
  - Events emitted on successful operations
  - Trade update for a just-cancelled order is handled gracefully (no crash)

  **Verification:**
  - Both endpoints respond correctly to valid and invalid requests
  - SSE stream includes new event types
  - Tracked orders map updated after cancellation
  - Positions map reflects closed position after reconciliation
  - PerformanceTracker metrics updated with closing P&L

- [x] **Unit 3: Halt Acknowledgment Endpoint**

  **Goal:** Add `POST /api/acknowledge-halt` endpoint that transitions engine out of Halted state.

  **Requirements:** R3, R5, R6, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/config-poller.ts` (add `setAcknowledgment` method with DynamoDB write)
  - Modify: `engine/src/main.ts` (add route handler, wire into switch)
  - Modify: `engine/src/event-bus.ts` (add `halt-acknowledged` event type to `EngineEvents` map)
  - Modify: `engine/src/main.ts` (add `'halt-acknowledged'` to `eventNames` array in `handleSSE()`)
  - Test: `engine/test/halt-acknowledgment.test.ts`

  **Approach:**
  - **ConfigPoller:** Add `async setAcknowledgment(): Promise<void>` that sets the in-memory `humanAcknowledged = true` flag AND writes to DynamoDB `trading-config` table via `PutCommand` (the codebase exclusively uses `PutCommand` for DynamoDB writes — no `UpdateCommand` is used anywhere). Read the current config item, set `humanAcknowledged: true`, write back. The next orchestrator tick's `checkHaltedRecovery()` will pick it up immediately.
  - **Pre-validation:** Before accepting acknowledgment, fetch current account equity from Alpaca and run a lightweight check against the drawdown/daily loss thresholds that commonly trigger halts. If the danger conditions that caused the halt still persist, reject with 409 and an explanation (e.g., "Drawdown still exceeds flatten threshold at X%. Resolve before acknowledging."). This prevents restart-into-danger loops where the engine immediately re-halts. **If Alpaca is unreachable during pre-validation**, allow the acknowledgment with a warning in the response body that pre-validation was skipped — this prevents a deadlock where Alpaca connectivity issues caused the halt and also block recovery.
  - **Route handler:** `handleAcknowledgeHalt(req, res, config, orchestrator)` — auth check, verify engine is in Halted state, run pre-validation (with Alpaca-unreachable fallback), call `configPoller.setAcknowledgment()`, emit `halt-acknowledged` event, return success.
  - **Guard:** Return 409 Conflict if engine is not in Halted state or if danger conditions persist and Alpaca is reachable.

  **Patterns to follow:**
  - `ConfigPoller.clearAcknowledgment()` for the flag management pattern
  - `orchestrator.checkHaltedRecovery()` for the existing recovery flow
  - `risk.ml:check_drawdown` and `check_daily_loss` for the threshold logic to validate against

  **Test scenarios:**
  - Acknowledge halt when engine is in Halted state and conditions resolved succeeds
  - Acknowledge halt when engine is not in Halted state returns 409
  - Acknowledge halt when danger conditions still persist returns 409 with explanation
  - Acknowledge halt when Alpaca is unreachable succeeds with pre-validation-skipped warning
  - Acknowledge halt without auth returns 401
  - `humanAcknowledged` flag set to true after successful call
  - `halt-acknowledged` event emitted on success
  - DynamoDB config updated with acknowledgment flag
  - DynamoDB write failure for acknowledgment returns 500 (this IS a primary action, unlike fire-and-forget state persistence)

  **Verification:**
  - Engine transitions from Halted to Starting after acknowledgment (on next tick)
  - Flag persisted to DynamoDB for durability across restarts
  - Engine does not restart into the same danger state that caused the original halt

- [x] **Unit 4: Strategy Enable/Disable Endpoints**

  **Goal:** Add `POST /api/strategies/:id/enable` and `POST /api/strategies/:id/disable` endpoints with DynamoDB persistence.

  **Requirements:** R4, R5, R6, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/config-poller.ts` (add `setStrategyEnabled` method with DynamoDB write, add public `forcePoll()` method)
  - Modify: `engine/src/strategy-runner.ts` (wire `enabledStrategies` config into `runStrategies()`)
  - Modify: `engine/src/main.ts` (add route handlers, wire into switch, add `'strategy-toggled'` to `eventNames` in `handleSSE()`)
  - Modify: `engine/src/event-bus.ts` (add `strategy-toggled` event type to `EngineEvents` map)
  - Test: `engine/test/strategy-toggle.test.ts`

  **Approach:**
  - **ConfigPoller:** Add `async setStrategyEnabled(strategyName: string, enabled: boolean): Promise<void>`. Uses read-modify-write on DynamoDB via `GetCommand` + `PutCommand` (the codebase pattern — no `UpdateCommand` used anywhere): reads the current full config item, modifies `enabledStrategies[strategyName]`, writes the full item back. Does NOT mutate in-memory config directly. After the DynamoDB write succeeds, calls `this.forcePoll()` to refresh in-memory state from DynamoDB, ensuring consistency. Also add `async forcePoll(): Promise<void>` as a public method that delegates to the private `poll()`. Validates strategy name against known list.
  - **Restrict-only for enable:** If `enabled: true` is requested, check `Types.strategy_enabled_for_phase(currentPhase, id)`. If the phase blocks this strategy, return an error explaining the phase restriction. The API can only re-enable a strategy that was previously disabled via API, not override OCaml safety logic.
  - **StrategyRunner:** Modify `runStrategies()` to check both gates: `if (!Types.strategy_enabled_for_phase(phase, id) || configDisabledStrategies.has(id)) { continue; }`. Phase check comes first (safety floor), then config check (additional restriction). If not present in config, fall back to phase-based enablement.
  - **Route handlers:** Parse strategy ID from path (accept both numeric ID and name). Auth check. Call `configPoller.setStrategyEnabled()`. Emit `strategy-toggled` event with strategy name and new state.
  - **Path parsing:** Match `path.startsWith('/api/strategies/')` and extract ID + action (`enable`/`disable`) from path segments.
  - **forcePoll failure fallback:** If the DynamoDB write succeeds but `forcePoll()` fails, fall back to directly mutating `this.current.enabledStrategies[strategyName]` as a best-effort local override with a warning log. The next successful poll will reconcile from DynamoDB.
  - **Validation:** Return 404 for unknown strategy IDs. Return 409 for enable requests that would violate phase restrictions. Strategy name mapping: `{0: 'Mean_reversion', 1: 'Sector_rotation', 2: 'Calendar_seasonal', 3: 'Momentum', 4: 'Market_making'}`. Build an explicit reverse map from lowercase names to IDs at module scope. Accept both numeric IDs (0-4) and case-insensitive names.

  **Patterns to follow:**
  - `ConfigPoller.getConfig()` for the in-memory config access pattern
  - `StrategyRunner.getMetrics()` for the strategy ID/name mapping
  - `ConfigPoller.poll()` for the DynamoDB read-replace pattern

  **Test scenarios:**
  - Disable strategy with valid numeric ID succeeds and persists to DynamoDB
  - Disable strategy with valid name (case-insensitive) succeeds
  - Re-enable a previously API-disabled strategy succeeds (phase allows it)
  - Enable a phase-blocked strategy returns 409 with phase restriction explanation
  - Toggle with unknown strategy ID returns 404
  - Toggle without auth returns 401
  - `strategy-toggled` event emitted with strategy name and state
  - Disabled strategy is skipped in `runStrategies()` on next cycle
  - Re-enabled strategy resumes in `runStrategies()`
  - Config survives engine restart (DynamoDB persistence)
  - Concurrent toggles on different strategies don't overwrite each other (read-modify-write)
  - DynamoDB write failure returns 500 (primary action)
  - forcePoll failure after successful write falls back to in-memory mutation with warning

  **Verification:**
  - Strategy enablement takes effect on next trading cycle
  - DynamoDB `trading-config` item updated with new `enabledStrategies` map
  - Phase-blocked strategies cannot be force-enabled via API
  - Existing strategy health tracking unaffected

## System-Wide Impact

- **Interaction graph:** New endpoints interact with Orchestrator, OrderManager, ConfigPoller, EventBus, AlpacaClient, State, PerformanceTracker, and DynamoDB. The SSE stream (`/events`) will carry new event types — dashboard will see them if subscribed.
- **Error propagation:** Alpaca SDK errors (network, invalid order ID) should be caught and returned as appropriate HTTP status codes (404, 502). DynamoDB write failures should return 500 but not crash the engine. The `processTradeUpdate` handler already handles unknown orders gracefully (logs warning, returns early — no crash risk).
- **Position state lifecycle:** `State.positions` is only synced via `reconcileWithAlpaca()` — there is no incremental position mutation path. Position close via API must trigger reconciliation afterward, otherwise the OCaml risk engine (`risk.ml:check_concentration`, `check_max_positions`) makes decisions on stale portfolio data. This also affects `PerformanceTracker` — closing P&L must be recorded explicitly since no automatic recording exists for externally-closed positions.
- **Order cancel timing:** A fill may arrive via WebSocket between the cancel request and the Alpaca API response. This is safe: `processTradeUpdate` at `order-manager.ts:345` unconditionally adds the order to tracked orders and processes the fill. `State.updateOrder` logs a warning for unknown orders and returns. The next tick self-corrects.
- **Strategy re-entry after manual close:** When a position is closed via API, strategies may generate new signals to re-enter the same symbol on the next tick. Consider a deferred cool-off mechanism (see Open Questions > Deferred to Implementation).
- **Halt recovery and watchdog coordination:** The watchdog's `HealthChecker.stop()` is called before kill switch activation and never restarted. After halt acknowledgment, the engine resumes trading but the watchdog is no longer monitoring health. This is out of scope for this plan (addressed by TODO 010) but implementers should be aware of the gap.
- **API surface parity:** These endpoints complete the CRUD surface for Orders (now has DELETE), Positions (now has close), and Strategies (now has toggle). RiskConfig remains read-only (addressed by TODO 007).
- **SSE event registration:** The `handleSSE()` function at `main.ts:126-137` has a hardcoded `eventNames` array. All 4 new event types must be added to this array or they will never be forwarded to SSE clients. This is a concrete implementation detail that must not be missed.
- **Kill switch pattern precedent:** The existing `handleKillSwitch()` at `orchestrator.ts:580-602` awaits cancel and close sequentially inside try/catch, with state transition happening regardless of success/failure. New endpoints should follow this resilience pattern — emit events and update state even if the Alpaca call partially fails.
- **DynamoDB write consistency:** The codebase exclusively uses `PutCommand` (full item replacement) and `GetCommand` (single item read). No `UpdateCommand` is used anywhere. Strategy toggle must do a `GetCommand` + modify + `PutCommand` cycle. This is a known trade-off: simpler SDK usage but requires read-modify-write for partial updates.
- **Test architecture:** No HTTP handler tests exist in the codebase. Existing tests (`engine/test/*.test.ts`, 10 files) use `vi.mock()` for DynamoDB stubs and replicate pure logic locally rather than mocking complex dependency graphs. New endpoint tests should follow this pattern — test the pure business logic (Orchestrator methods, ConfigPoller methods, StrategyRunner changes) rather than attempting to test the HTTP layer directly.
- **Integration coverage:** End-to-end flow tests should verify: cancel order -> SSE event -> tracked orders updated; close position -> P&L recorded -> reconciliation -> positions map updated; acknowledge halt -> pre-validation -> state transition -> engine resumes; toggle strategy -> next cycle skips/includes strategy.

## Risks & Dependencies

- **Alpaca SDK `cancelOrder` requires UUID (VERIFIED):** The SDK's `cancelOrder()` calls `DELETE /orders/{id}` with the Alpaca-generated UUID, not the client order ID. Mitigated: the handler looks up the Alpaca UUID from `OrderManager.trackedOrders`, with fallback to `sdk.getByClientOrderId()`.
- **Config poll full-replace race (VERIFIED):** `ConfigPoller.poll()` does `this.current = newConfig` — a full object replacement. `parseConfig()` takes the entire `enabledStrategies` object from DynamoDB, no per-strategy merge. Mitigated: strategy toggle uses read-modify-write on DynamoDB and forces an immediate poll rather than mutating in-memory config directly.
- **Halt restart-into-danger:** If the conditions that caused the halt (e.g., drawdown exceeding flatten threshold) still persist, acknowledging the halt would cause the engine to immediately re-halt on the first tick. Mitigated: pre-validation step checks current equity and risk thresholds before accepting acknowledgment.
- **Concurrent strategy toggles:** Two simultaneous toggle requests for different strategies could race on the read-modify-write of `enabledStrategies` in DynamoDB. Low risk for paper trading (single user), but the implementation should use DynamoDB conditional writes or handle the race gracefully.
- **Position close P&L accuracy:** The closing P&L recorded in PerformanceTracker depends on knowing the entry price from the current `State.positions` data. If the position data is stale (price not recently updated), the recorded P&L may be slightly inaccurate. Acceptable for paper trading. The definitive P&L comes from the trade update WebSocket fill event, not the API response.
- **No timeout on Alpaca API calls:** The `rateLimitedCall` wrapper has no timeout. If Alpaca's API hangs (TCP connection established, no response), the HTTP handler will hang indefinitely. Mitigated by deferring timeout implementation (see Open Questions > Deferred). For paper trading, the risk is low — a hung request affects one user, not a production system.
- **Reconciliation failure after position close:** If `reconcileWithAlpaca()` fails after a successful position close, `State.positions` still shows the closed position. The risk engine sees a phantom position. Mitigated: manually remove the position from state as a fallback. Over-restriction (thinking position is still open) is the safer failure mode.
- **Strategy re-entry race:** Strategies may re-enter a manually closed position within 1-2 seconds. Mitigated by deferring the cool-off mechanism. For paper trading, this is confusing but not dangerous.
- **Engine state transition during in-flight cancel/close:** If the engine halts while a cancel request is in progress, the kill switch cancels ALL orders. The individual cancel also succeeds. The user sees a 200 for their cancel but doesn't know everything was canceled. Mitigated: response body includes `engineState` so callers can detect transitions.

## Alternative Approaches Considered

- **Express/Fastify router:** Would simplify parameterized routing and middleware. Rejected: the server has 13 routes total, adding a framework dependency for routing convenience is disproportionate overhead. The existing raw `node:http` pattern is well-established.
- **Expose OrderManager as public:** Would allow route handlers to call OrderManager directly. Rejected: breaks encapsulation. The Orchestrator is the coordination point for state changes — it needs to emit events, record P&L, trigger reconciliation, and update state. Bypassing it creates the same kind of divergence the watchdog's independent Alpaca client causes (TODO 010).
- **Add `removePosition()` to State:** Would allow incremental position updates instead of full reconciliation. Rejected for now: reconciliation is the established pattern, and adding incremental mutation creates two paths to position state that could diverge. Full reconciliation is slower (~1 API call) but guarantees consistency.
- **Strategy toggle via Orchestrator method:** Could have added toggle methods to Orchestrator instead of ConfigPoller. Rejected: strategy enablement is a config concern, not an orchestration concern. ConfigPoller already manages `enabledStrategies` in the config schema, and writing through it ensures DynamoDB persistence and poll consistency.
- **Strategy enable as full override (not restrict-only):** Could have allowed the API to enable phase-blocked strategies. Rejected: the OCaml phase gating is a safety constraint (PDT risk, position sizing). The risk engine at `risk.ml:check_strategy_enabled` independently enforces the same restriction, so enabling would be either ineffective or dangerous.

## Sources & References

- Origin documents:
  - [TODO 001](.context/compound-engineering/todos/001-ready-p1-add-order-cancel-position-close-apis.md)
  - [TODO 002](.context/compound-engineering/todos/002-ready-p1-add-halt-acknowledgment-endpoint.md)
  - [TODO 003](.context/compound-engineering/todos/003-ready-p1-add-strategy-enable-disable-api.md)
- Related code:
  - `engine/src/main.ts` — HTTP server and route handlers
  - `engine/src/orchestrator.ts` — engine orchestration and state management
  - `engine/src/alpaca/client.ts` — Alpaca SDK wrapper
  - `engine/src/alpaca/order-manager.ts` — order lifecycle management
  - `engine/src/config-poller.ts` — DynamoDB config polling
  - `engine/src/strategy-runner.ts` — strategy execution
  - `engine/src/event-bus.ts` — typed event system
  - `watchdog/src/main.ts` — auth pattern reference
