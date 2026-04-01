---
status: ready
priority: p2
issue_id: "008"
tags: [api, crud, observability]
dependencies: []
---

# Add Signal Persistence and Query API

## Problem Statement

Signals are fire-and-forget events. They are generated, emitted to the event bus, and lost. No historical record of signals exists for analysis, debugging, or strategy evaluation. Signal entity has 2/4 CRUD (Create, Read-via-SSE only).

## Proposed Solutions

1. Add `recordSignal()` to performance tracker or dedicated signal store
2. Persist to DynamoDB `trading-history` table with `pk=signal#YYYY-MM-DD`, `sk=timestamp#strategy`
3. Add `GET /api/signals?date=YYYY-MM-DD&symbol=AAPL` query endpoint
4. Include: strategy, symbol, side, confidence, timestamp, outcome (if known)

## Acceptance Criteria

- [ ] Every generated signal persisted to DynamoDB
- [ ] `GET /api/signals` endpoint with date and symbol filters
- [ ] Signals include strategy, symbol, side, confidence, timestamp
- [ ] Dashboard can display signal history (future UI work)
- [ ] No performance impact on trading loop (async persistence)
