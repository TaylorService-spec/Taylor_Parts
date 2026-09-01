# FIN-003 — Plan vs Actual Model (F6)

**Status:** plan-record + comparison core IMPLEMENTED (repository, dormant — no storage,
no capability, no surface). Recorded 2026-09-01, overnight financials run phase F6.
**Authority sources composed:** DECISIONS #145/#154; baseline invariant A; Frame 0 section
responsibilities (Goal Management = "versioned target authority and measurement basis",
Budget Management = "versioned planning authority").

## 1. The model

`functions/src/finance/planVsActual.ts` is the canonical core for Sales-to-Goal,
Cost-to-Budget, and every later plan comparison:

**Plan record** (`buildPlanRecord`, frozen): `planType GOAL|BUDGET` (a goal is not a
budget) · positive integer `version` · lifecycle `DRAFT → APPROVED → SUPERSEDED` · an
**explicit `measurementBasis`** from the closed set `BOOKED|BILLED|COLLECTED|COST` (a plan
with no declared basis cannot be measured — basis is never implied) · explicit currency ·
integer `amountMinor` · inclusive ISO period · scope = the FIN-002 reporting dimensions
(`operatingCompanyId`/`businessUnitId`/`creditedSalespersonId`, each nullable =
unconstrained).

**Comparison** (`comparePlanToActual`): actual facts each declare their OWN basis, currency,
date, and dimensions.

| Situation | Treatment |
|---|---|
| Plan not APPROVED | REFUSED (`PLAN_NOT_APPROVED`) — drafts and superseded versions are history, not measurement authority |
| Fact basis ≠ plan basis | REFUSED (`BASIS_MISMATCH`) — a category error; bases are compared, never blended (invariant A) |
| Fact currency ≠ plan currency | REFUSED — never converted silently |
| Fact outside period or outside a constrained scope dimension | NAMED exclusion in the result — a real fact that does not belong to this plan; nothing vanishes silently |
| Included facts | `varianceMinor = actual − plan` (goal shortfall negative; budget overrun positive) |

## 2. Deliberately not decided here

- **Approval authority** — WHO may approve/supersede a plan version → FIN-007 (F8)
  adjustment/approval governance.
- **Storage & capability ids** — persistence shape and `finance.goal/budget.manage`
  activation → F12/F14 with the rest of the dormant spine.
- **Where actual facts come from** — each basis maps to governed events (BOOKED =
  FIN-002 `bookedAtMillis` snapshots; BILLED = issued invoices; COLLECTED = payment
  applications (F3-attributed); COST = FIN-006 governed cost facts, today always absent).
  The comparison core consumes them as explicit inputs; wiring reads is a surface concern.

## 3. Invariants enforced

A (never blend bases), B (plans are versioned — a changed goal is a NEW version, the old
one SUPERSEDED history), D (explicit scope via FIN-002 dimensions — never inferred from
current org state), integer minor units.
