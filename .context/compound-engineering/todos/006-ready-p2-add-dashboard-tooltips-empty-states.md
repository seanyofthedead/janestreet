---
status: ready
priority: p2
issue_id: "006"
tags: [dashboard, capability-discovery, ux]
dependencies: []
---

# Add Tooltips and Empty-State Guidance to Dashboard

## Problem Statement

The dashboard provides no explanations for any metrics, states, or concepts. Users see "Warming up", "Pilot", "Sharpe ratio", "Missed Heartbeats" with no context. Empty states show generic "No data" messages with no guidance. Capability Discovery scored 14%.

## Proposed Solutions

1. Add `title` attributes to metric cards (Sharpe ratio, win rate, allocation %, missed heartbeats)
2. Improve empty states with context: "No open positions. Strategies will open positions when opportunities are identified."
3. Add short descriptions under section headers
4. Add strategy state legend: "Warming up = collecting data, Pilot = live testing, Live = full allocation"

## Acceptance Criteria

- [ ] Key metrics have tooltip/title attributes explaining what they measure
- [ ] Empty states include actionable guidance
- [ ] Strategy states have visible legend or tooltips
- [ ] Risk dashboard metrics explained (what's normal vs abnormal)
- [ ] No new dependencies added
