# 09 — Cost to Budget

**Route:** /financials/cost-to-budget
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 09 Cost to Budget.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 09-cost-to-budget-1440.png · 09-cost-to-budget-375.png

## 1–3 · Name, route, purpose
Cost to Budget · /financials/cost-to-budget — Budget vs actual cost; no authoritative cost drawn before FIN-006.

## 4 · Information hierarchy
Contract sentence → missing-authority band → budget table with real Budget column (versioned) and honest Actual/Variance/Remaining single-state columns.

## 5 · Filters
Company · Business Unit · Period (Quarter default).

## 6 · Drilldowns
Budget figures → versioned records in Budget Management.

## 7 · Desktop behavior
Structure ships whole; columns reserved, not zero-filled.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Budget rows with per-row "Actual: no cost authority" line.

## 9 · Empty / unavailable / denied states
"No cost authority" per row + one banner; "No budget set" for Subcontractor; when FIN-006 lands, over-budget rows take exception treatment.

## 10 · Financial facts shown
Q3 budgets: Labor $96,000 (v2), Parts $41,500 (v2), Freight $6,200 (v1), Vehicle $18,400 (v1). Categories are the governed budget category list.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Budgets: FIN-003 Plan vs Actual (records designed in page 12). Cost actuals: FIN-006 (missing, stated; never zero-filled, never derived from sell price).

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-006.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-COST-MARGIN (the page IS the truthful state); FIN-AG-PLAN (budget records).

## 17 · PRODUCT QUESTIONS
Governed cost category vocabulary to confirm in FIN-006.

## 18 · Implementation dependencies
None until FIN-006; page renders from budget reads alone.

## 19 · Shared components / patterns
NS shell, missing-authority band, reserved-column table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 09 *.dc.html (project root; copy in design_handoff_financials/). Frames: 09-cost-to-budget-1440.png · 09-cost-to-budget-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
