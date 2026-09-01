# 08 — Sales to Goal

**Route:** /financials/sales-to-goal
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 08 Sales to Goal.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 08-sales-to-goal-1440.png · 08-sales-to-goal-375.png

## 1–3 · Name, route, purpose
Sales to Goal · /financials/sales-to-goal — Actual performance against governed goals; every goal states its measurement basis.

## 4 · Information hierarchy
Basis sentence → filters → Company→unit→person table (Scope, Basis, Actual, Goal, Variance, Attainment bar) → period-summary rail grouped by basis (deliberately no single total).

## 5 · Filters
Company · Business Unit · Period.

## 6 · Drilldowns
Scope row → person rows → financial events behind the actual; admin → Goal Management.

## 7 · Desktop behavior
Attainment bars capped at 100% fill, number carries truth past 100.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Bar cards per scope, basis under each.

## 9 · Empty / unavailable / denied states
GROSS_MARGIN-basis goal renders "attainment cannot be computed truthfully (FIN-006)"; "No goal set" rows; over-goal green.

## 10 · Financial facts shown
Scope actuals vs goals; variance; attainment %; bases BOOKED/BILLED/COLLECTED/REVENUE/GROSS_MARGIN as vocabulary.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Goals: FIN-003 Plan vs Actual (OPEN). Actuals: per-basis reads over FIN-002-complete attribution (billed/collected pending read activation). Margin-basis attainment blocked by FIN-006.

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-006 (margin basis); read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating (set goals in Goal Management).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Person rows only within viewer scope; attribution strictly creditedSalespersonId.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PLAN (goal records — FIN-003).

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Per-basis actual computation; rollups grouped by basis only.

## 19 · Shared components / patterns
NS shell, attainment bar, basis label, hierarchy-indented table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 08 *.dc.html (project root; copy in design_handoff_financials/). Frames: 08-sales-to-goal-1440.png · 08-sales-to-goal-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
