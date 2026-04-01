---
status: ready
priority: p2
issue_id: "007"
tags: [risk, config, crud]
dependencies: []
---

# Extract Risk Thresholds to DynamoDB Config (Hot-Reloadable)

## Problem Statement

Risk thresholds (drawdown levels, daily loss limits, position concentration) are hardcoded in OCaml (`risk_config.ml`) and TypeScript. Changing any threshold requires code edit, recompile, and redeploy. Config poller already reads from DynamoDB but risk config defaults are in code.

## Proposed Solutions

1. Store all risk thresholds in DynamoDB `trading-config` table
2. Config poller loads and validates with Zod schema
3. Falls back to code defaults if DynamoDB unavailable
4. Add `PATCH /api/risk-config` endpoint for runtime updates (with auth)
5. Changes take effect on next config poll cycle (60s or less)

## Acceptance Criteria

- [ ] All risk thresholds loadable from DynamoDB
- [ ] Code defaults used as fallback when DynamoDB values missing
- [ ] `PATCH /api/risk-config` endpoint with API key auth
- [ ] Zod validation on config values (numeric bounds)
- [ ] Changes reflected within one config poll cycle
- [ ] Existing tests pass with both code defaults and DynamoDB values
