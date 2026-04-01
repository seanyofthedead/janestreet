---
status: ready
priority: p3
issue_id: "009"
tags: [dashboard, capability-discovery, ux]
dependencies: ["006"]
---

# Add Dashboard Help Modal / Onboarding Tour

## Problem Statement

New users landing on the dashboard have no guided introduction. There is no help button, feature tour, or "getting started" guide.

## Proposed Solutions

1. Add "?" icon button in dashboard header
2. Opens modal with system overview, metric glossary, strategy state legend, kill switch explanation
3. Optional: first-visit onboarding modal (localStorage flag)

## Acceptance Criteria

- [ ] "?" button visible in dashboard header
- [ ] Help modal contains system overview
- [ ] Glossary of key trading metrics
- [ ] Strategy states explained
- [ ] Kill switch behavior documented
- [ ] Modal dismissable and non-intrusive
