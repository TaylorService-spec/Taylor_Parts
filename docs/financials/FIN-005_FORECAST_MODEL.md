# FIN-005 — Forecast Model (F7)

**Status:** forecast core IMPLEMENTED (repository, dormant — no storage, no capability, no
surface). Recorded 2026-09-01, overnight financials run phase F7.
**Authority sources composed:** DECISIONS #145/#154; baseline invariant A; FIN-003 (F6)
never-blend accumulator; FIN-001 §1.6 (forecast authority MISSING; the account-page forecast
surfaces are display seams structurally unable to render a figure; Opportunity
`expectedValue` is a currency-less forecast-flavored number that flows nowhere).

## 1. The model

`functions/src/finance/forecasting.ts`:

**Forecast record** (`buildForecastRecord`, frozen): an expectation about future
performance, stamped with **`asOfMillis` — when the expectation was formed**. Explicit
measurement basis (`BOOKED|BILLED|COLLECTED|COST`), explicit currency, integer
`amountMinor`, inclusive ISO period, scope = FIN-002 reporting dimensions, and a required
`method` label saying how it was produced (salesperson commit, pipeline derivation,
management call — an open label; forecast METHODOLOGY is not policy minted here).

**Supersession** (`selectCurrentForecast`): a forecast is never edited — a newer as-of for
the SAME target (basis+currency+period+scope) supersedes; older versions remain history
("what did we expect on that date?"). Mixed targets refuse (`TARGET_MIXED`); an as-of tie
is ambiguous and refused (`AS_OF_AMBIGUOUS`) — never resolved by array order, never
averaged.

**Comparison** (`compareForecastToActual`): reuses the F6 shared accumulator
(`accumulateActualFacts`) — basis/currency mismatch is a thrown category error (a forecast
is NEVER an actual and never blends into one); out-of-period/scope facts are named
exclusions; `variance = actual − forecast`.

## 2. Deliberately not decided

- Forecast **methodology/cadence** (who forecasts, how often, commit vs derived) — Owner
  process policy.
- Whether Opportunity pipeline data ever FEEDS a derived forecast — requires the
  `expectedValue` currency gap to be closed first (FIN-001) and is an explicit future
  decision; nothing reads it today.
- Storage + capability activation → F12/F14; approval semantics do not apply (a forecast
  is not an approval object — that is a plan).
