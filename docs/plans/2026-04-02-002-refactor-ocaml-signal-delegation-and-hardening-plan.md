---
title: "refactor: Signal gate calibration for 1-minute intraday data"
type: refactor
status: active
date: 2026-04-03
---

# Signal Gate Calibration for 1-Minute Intraday Data

See `.claude/plans/expressive-forging-engelbart.md` for full context, empirical results,
and the original HMM/Markov chain investigation that led to this pivot.

## Summary

OCaml signal generators reject 99.8% of 1-minute bars due to gates calibrated for daily data.
This plan recalibrates those gates based on empirical analysis of real SPY 1-min data.
