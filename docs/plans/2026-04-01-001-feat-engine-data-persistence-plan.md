---
title: "feat: Add risk threshold write API and signal persistence"
type: feat
status: active
date: 2026-04-01
---

# feat: Add risk threshold write API and signal persistence

## Overview

Two engine data features: (1) a write API so the dashboard can dynamically update risk thresholds stored in DynamoDB, and (2) persistence of trading signals to a new DynamoDB table with a query endpoint, providing an audit trail and historical signal visibility in the dashboard.

## Problem Frame

Risk thresholds are already stored in DynamoDB (`trading-config` table) and polled by `ConfigPoller`, but there is no API to update them — changes require direct DynamoDB manipulation or code changes. Trading signals are ephemeral, existing only in-memory during the tick loop. If the engine restarts, all signal history is lost, and there's no way to review what signals were generated historically.

## Requirements Trace

- R1. Dashboard can update risk thresholds (maxPositionPct, maxDailyLossPct, drawdown limits, etc.) via authenticated API without engine restart
- R2. Config changes propagate to the engine's in-memory state immediately after write
- R3. Trading signals are persisted to DynamoDB after generation, before risk evaluation
- R4. Historical signals can be queried by symbol and optionally filtered by strategy and time range
- R5. Dashboard displays signal history via a new hook/fetcher
- R6. New `trading-signals` DynamoDB table is created by the setup script
- R7. All write endpoints require `X-API-Key` auth (matching existing pattern)

## Scope Boundaries

- No optimistic locking on config writes (single writer is the dashboard; matches existing pattern)
- No signal aggregation, analytics, or signal replay — just raw persistence and query
- No dashboard UI for editing thresholds (just the API; UI is a separate TODO)
- No dashboard UI for signal history table (just the hook/fetcher; UI is part of dashboard UX group)
- Signal persistence is fire-and-forget (non-blocking); DynamoDB write failures are logged but don't block trading

## Context & Research

### Relevant Code and Patterns

- **ConfigPoller write pattern** (`engine/src/config-poller.ts:152-233`): Read-modify-write with `GetCommand` → mutate → `PutCommand` → `forcePoll()` to refresh in-memory state. Methods: `setAcknowledgment()`, `setStrategyEnabled()`.
- **HTTP handler pattern** (`engine/src/main.ts`): Parameterized routes checked first via `if` chains, then exact-match GET routes via `switch`. Mutations use `requireAuth()`, `parseJsonBody<T>()`, `sendJson()`, `sendError()` from `http-utils.ts`.
- **Orchestrator delegation** (`engine/src/orchestrator.ts`): HTTP handlers call orchestrator methods (e.g., `toggleStrategy()`, `acknowledgeHalt()`) which delegate to `ConfigPoller`.
- **DynamoDB client** (`engine/src/dynamodb.ts`): Singleton `DynamoDBDocumentClient` with table constants. Uses `@aws-sdk/lib-dynamodb`.
- **Table setup** (`scripts/setup-tables.ts`): Array of `CreateTableCommandInput`, iterate and create with `PAY_PER_REQUEST` billing.
- **Signal flow** (`engine/src/orchestrator.ts:602-623`): `strategyRunner.runStrategies()` → `bus.emit('signal', ...)` → `conflictResolver.resolve()` → `Risk.evaluate()`.
- **Dashboard hooks** (`dashboard/lib/hooks/use-trading-data.ts`): TanStack Query `useQuery` with `queryKey`, `queryFn`, `refetchInterval`.
- **Dashboard API** (`dashboard/lib/api.ts`): Thin `fetchJson<T>(url)` wrappers around engine REST endpoints.

### Institutional Learnings

- DynamoDB is in-memory mode — tables lost on Docker restart. New tables must be in `scripts/setup-tables.ts`.
- Use `127.0.0.1` not `localhost` for DynamoDB endpoint (IPv6 issue).
- Use Zod-style validation at API boundaries (learned from Alpaca trade ID coercion bug).

## Key Technical Decisions

- **PATCH /api/config for threshold updates**: Partial update semantics (only send fields to change). PATCH is more natural than PUT for partial updates, and POST is already used for actions. Follows the read-modify-write pattern already in ConfigPoller.
- **`trading-signals` table with `symbol` HASH + `timestamp` RANGE**: Matches the primary query pattern (signals for a symbol over time). Strategy filtering is done application-side since signal volume is low.
- **Fire-and-forget signal writes**: Signal persistence must not slow down the tick loop. Write asynchronously, log errors, don't await.
- **Signal store as a separate module**: Keeps DynamoDB write logic out of the orchestrator, following how `PerformanceTracker` handles trade history writes.

## Open Questions

### Resolved During Planning

- **Should config writes use UpdateExpression or full PutCommand?**: Full PutCommand (read-modify-write), matching existing ConfigPoller pattern. Simpler and consistent.
- **Should we add a GSI on strategy for signal queries?**: No. Signal volume is low enough that filtering application-side after querying by symbol+timestamp is fine. Avoids DynamoDB cost and complexity.
- **Should signal persistence block the tick loop?**: No. Fire-and-forget with error logging. Trading is the priority.

### Deferred to Implementation

- Exact validation bounds for numeric threshold fields (min/max ranges) — will be determined by inspecting what the OCaml risk engine accepts.
- Whether to batch signal writes with `BatchWriteCommand` — depends on observed signal volume per tick (likely 0-3 signals, so individual puts are fine).

## Implementation Units

- [ ] **Unit 1: Add `updateRiskThresholds` to ConfigPoller**

  **Goal:** Add a method to ConfigPoller that accepts a partial RuntimeConfig and persists it to DynamoDB, following the existing `setStrategyEnabled()` pattern.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Modify: `engine/src/config-poller.ts`
  - Test: `engine/test/config-poller.test.ts`

  **Approach:**
  - Add `updateRiskThresholds(updates: Partial<RuntimeConfig>)` method
  - Validate that only numeric risk fields are accepted (not `enabledStrategies`, `humanAcknowledged`, `symbols` — those have dedicated methods)
  - Whitelist of updatable fields: `maxPositionPct`, `maxSectorPct`, `minCashReservePct`, `maxDailyLossPct`, `maxDrawdownReducePct`, `maxDrawdownFlattenPct`, `maxOrderRatePerMin`, `heartbeatTimeoutSeconds`, `maxPositionsByPhase`
  - Read-modify-write: `GetCommand` → merge updates → `PutCommand` → `forcePoll()`
  - Validate numeric values are positive and within reasonable bounds

  **Patterns to follow:**
  - `ConfigPoller.setStrategyEnabled()` (lines 190-233) — exact same read-modify-write-poll pattern
  - `ConfigPoller.setAcknowledgment()` (lines 152-182) — simpler variant of same pattern

  **Test scenarios:**
  - Updates single field and verifies DynamoDB PutCommand called with merged item
  - Updates multiple fields simultaneously
  - Rejects non-whitelisted fields (e.g., `enabledStrategies`)
  - Rejects negative values
  - Falls back to direct mutation if forcePoll fails (matching setStrategyEnabled behavior)

  **Verification:**
  - ConfigPoller can update thresholds and reflect them in `getConfig()` after poll
  - Non-risk fields are rejected

- [ ] **Unit 2: Add orchestrator method + HTTP endpoint for config updates**

  **Goal:** Wire the ConfigPoller method to an HTTP endpoint accessible from the dashboard.

  **Requirements:** R1, R2, R7

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `engine/src/orchestrator.ts`
  - Modify: `engine/src/main.ts`
  - Test: `engine/test/config-update.test.ts`

  **Approach:**
  - Add `Orchestrator.updateConfig(updates)` method that delegates to `configPoller.updateRiskThresholds(updates)` and returns the new config snapshot
  - Add `PATCH /api/config` handler in `main.ts` parameterized route section (before the switch), following the `handleStrategyToggle` pattern
  - Handler: auth check → `parseJsonBody` → `orchestrator.updateConfig()` → `sendJson(200, result)`
  - Emit `config-change` event (already happens via forcePoll in Unit 1)
  - Log the HTTP route in the server startup banner

  **Patterns to follow:**
  - `handleStrategyToggle()` (main.ts lines 360-398) — mutation handler pattern
  - `Orchestrator.toggleStrategy()` (orchestrator.ts lines 336+) — orchestrator delegation pattern

  **Test scenarios:**
  - PATCH with valid body updates config and returns new snapshot
  - PATCH without auth returns 401
  - PATCH with invalid fields returns 400
  - PATCH with empty body returns 400

  **Verification:**
  - `curl -X PATCH localhost:3001/api/config -H 'X-API-Key: ...' -d '{"maxDailyLossPct": 0.03}'` returns updated config
  - SSE emits `config-change` event

- [ ] **Unit 3: Create `trading-signals` DynamoDB table + signal store**

  **Goal:** Add the new table to the setup script and create a signal persistence module.

  **Requirements:** R3, R6

  **Dependencies:** None (parallel with Units 1-2)

  **Files:**
  - Modify: `scripts/setup-tables.ts`
  - Modify: `engine/src/dynamodb.ts`
  - Create: `engine/src/signal-store.ts`
  - Test: `engine/test/signal-store.test.ts`

  **Approach:**
  - Add `trading-signals` table to `setup-tables.ts`: `symbol` (HASH, S) + `timestamp` (RANGE, N), PAY_PER_REQUEST
  - Add `TABLE_SIGNALS = 'trading-signals'` constant to `dynamodb.ts`
  - Create `SignalStore` class with:
    - `persist(signal: SignalEvent): void` — fire-and-forget PutCommand (catch and log errors)
    - `query(symbol: string, since: number, until?: number, strategy?: string): Promise<SignalEvent[]>` — QueryCommand with KeyConditionExpression on symbol + timestamp range, optional FilterExpression on strategy

  **Patterns to follow:**
  - `PerformanceTracker.persistDaily()` for DynamoDB write pattern
  - `scripts/setup-tables.ts` table definition array pattern
  - `dynamodb.ts` table constant pattern

  **Test scenarios:**
  - `persist()` sends PutCommand with correct table and item shape
  - `persist()` logs error but doesn't throw on DynamoDB failure
  - `query()` returns signals filtered by symbol and time range
  - `query()` with strategy filter applies FilterExpression

  **Verification:**
  - `setup-tables.ts` creates 4 tables (was 3)
  - `SignalStore.persist()` writes to DynamoDB without blocking
  - `SignalStore.query()` returns results sorted by timestamp

- [ ] **Unit 4: Wire signal persistence into orchestrator tick loop**

  **Goal:** Persist signals after emission in `processTradingTick()`.

  **Requirements:** R3

  **Dependencies:** Unit 3

  **Files:**
  - Modify: `engine/src/orchestrator.ts`
  - Modify: `engine/src/main.ts` (inject SignalStore into Orchestrator)

  **Approach:**
  - Add `SignalStore` as a constructor dependency of `Orchestrator`
  - In `processTradingTick()` (line 614-623), after the `bus.emit('signal', ...)` call, also call `signalStore.persist(signalEvent)` for each signal — no await (fire-and-forget)
  - Instantiate `SignalStore` in `main.ts` and pass to Orchestrator constructor

  **Patterns to follow:**
  - How `PerformanceTracker` is instantiated in `main.ts` (line 456) and passed to Orchestrator
  - How signals are already emitted in the loop (orchestrator.ts lines 614-623)

  **Test scenarios:**
  - Signal persistence called for each signal emitted
  - Tick loop continues even if signal persistence throws

  **Verification:**
  - Signals appear in DynamoDB `trading-signals` table after trading ticks

- [ ] **Unit 5: Add signal query HTTP endpoint + dashboard integration**

  **Goal:** Expose signal history via REST API and wire into dashboard data layer.

  **Requirements:** R4, R5

  **Dependencies:** Unit 3

  **Files:**
  - Modify: `engine/src/main.ts`
  - Modify: `dashboard/lib/api.ts`
  - Modify: `dashboard/lib/hooks/use-trading-data.ts`

  **Approach:**
  - Add `GET /api/signals` route in `main.ts` switch statement (read-only, no auth)
  - Query params: `symbol` (required), `since` (epoch ms, default last 24h), `until` (epoch ms, optional), `strategy` (optional)
  - Delegates to `orchestrator.signalStore.query()`
  - Add `fetchSignals()` to `dashboard/lib/api.ts`
  - Add `useSignals(symbol, options)` hook to `use-trading-data.ts` with 30s refetch interval
  - SSE `signal` events can trigger `queryClient.invalidateQueries({ queryKey: ['signals'] })` in `use-engine-events.ts`

  **Patterns to follow:**
  - `handleBars()` (main.ts lines 404-435) — read-only handler with query params
  - `fetchAccount()` / `useAccount()` in dashboard — fetcher + hook pattern
  - `use-engine-events.ts` query invalidation pattern

  **Test scenarios:**
  - GET /api/signals?symbol=SPY returns signal array
  - Missing symbol param returns 400
  - Dashboard hook fetches and refetches signals

  **Verification:**
  - `curl localhost:3001/api/signals?symbol=SPY&since=...` returns signal history
  - Dashboard `useSignals()` hook returns data

## System-Wide Impact

- **Interaction graph:** Config write → ConfigPoller → DynamoDB → poll cycle → `config-change` event → SSE → dashboard cache invalidation. Signal persist → DynamoDB (fire-and-forget, no downstream impact on tick loop).
- **Error propagation:** Config write errors propagate to HTTP handler → 500 response. Signal persist errors are logged and swallowed (no impact on trading).
- **State lifecycle risks:** Config read-modify-write without optimistic locking could theoretically lose concurrent writes, but only the dashboard writes config, so this is acceptable.
- **API surface parity:** New endpoints (`PATCH /api/config`, `GET /api/signals`) need to be documented in the startup banner and accessible from dashboard.
- **Integration coverage:** Config round-trip (write via API → poll → verify in-memory change) should be tested. Signal round-trip (write during tick → query via API) should be tested.

## Risks & Dependencies

- DynamoDB Local is in-memory mode — `trading-signals` table will be lost on Docker restart. Mitigated by adding to `setup-tables.ts` (run on each startup).
- Signal write volume could grow if strategies become more active. Current design (individual PutCommands) is fine for ~0-10 signals/tick. If volume increases significantly, batch writes should be considered.

## Sources & References

- Related code: `engine/src/config-poller.ts`, `engine/src/orchestrator.ts`, `engine/src/main.ts`, `engine/src/dynamodb.ts`, `scripts/setup-tables.ts`
- Dashboard: `dashboard/lib/api.ts`, `dashboard/lib/hooks/use-trading-data.ts`, `dashboard/lib/hooks/use-engine-events.ts`
