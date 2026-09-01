# 13 — Goal Management

**Route:** /financials/goals
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 13 Goal Management.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 13-goals-1440.png · 13-goals-375.png · 13-goal-create-1440.png · 13-goal-review-375.png

## 1–3 · Name, route, purpose
Goal Management · /financials/goals — Governed financial/performance goal administration; measurement basis unmissable.

## 4 · Information hierarchy
Collection: table (Scope incl. person rows, Basis chip, Target, Period, Version, Approval, Status). Create sheet: company/scope/period/basis/target + basis-consequence explainer. Mobile review: basis + target + prior-period + approve/decline.

## 5 · Filters
Company · scope type (unit/team/person) · Period.

## 6 · Drilldowns
Goal → Sales to Goal attainment; versions in place.

## 7 · Desktop behavior
Basis rendered as an outlined chip in its own column.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Cards with basis chip.

## 9 · Empty / unavailable / denied states
"Active · not computable" for margin-basis goals (FIN-006); Superseded quieted; percentage targets for margin basis (unit renders from basis, never assumed).

## 10 · Financial facts shown
11 goals; targets; bases; version chain; approvals.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Goals: FIN-003 Plan vs Actual; person goals attribute by creditedSalespersonId (a FIN-002-complete fact); SELF-visibility per FIN-004.

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-006 (margin basis), FIN-007 (approval).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
New goal; Submit; Approve/Decline; Save draft.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): goal-create / goal-approve (CONCEPTUAL, IDs TBD).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PLAN; FIN-AG-APPROVALS.

## 17 · PRODUCT QUESTIONS
FIN-PQ-TEAM-GOAL: team-roster semantics on mid-period roster change — recorded, not answered by Design (FIN-003).

## 18 · Implementation dependencies
Versioned immutable records; basis fixed per goal.

## 19 · Shared components / patterns
NS shell, basis chip (.basis), sheet form, review diff. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 13 *.dc.html (project root; copy in design_handoff_financials/). Frames: 13-goals-1440.png · 13-goals-375.png · 13-goal-create-1440.png · 13-goal-review-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
