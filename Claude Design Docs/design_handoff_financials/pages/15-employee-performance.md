# 15 — Salesperson & Employee Performance

**Route:** /financials/employee-performance
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 15 Salesperson Employee Performance.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 15-employee-performance-1440.png (TEAM) · 15-employee-performance-375-self.png (SELF)

## 1–3 · Name, route, purpose
Salesperson & Employee Performance · /financials/employee-performance — Individual/team financial performance with visibility as the composition.

## 4 · Information hierarchy
Scope statement in header (TEAM view drawn) → view seg (Salesperson credit / Service responsibility — never merged) → team table (person, basis, actual, goal, attainment) w/ per-row attribution label → "Outside your scope" withheld panel (explicit DENIED design) → team summary rail; margin-by-person honest absence. Mobile frame = SELF scope (salesperson sees only themself + withheld note).

## 5 · Filters
View (credit/responsibility) · Period.

## 6 · Drilldowns
Person → credited events; manager rollups by scope.

## 7 · Desktop behavior
TEAM scope specimen.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
SELF scope specimen — deliberate second visibility state.

## 9 · Empty / unavailable / denied states
DENIED = named withheld panel (never zeros, never silent absence); "No goal set"; margin unavailable (FIN-006 + FIN-PQ-15a).

## 10 · Financial facts shown
Team actuals/goals/attainment; credited order list (SELF view). Attribution: creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId — labelled per row.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Booked attribution FIN-002-complete (creditedSalespersonId separate from ownership); billed reads pending activation; goals FIN-003. Visibility scopes are owned by FIN-004 (OPEN) — visible page controls are never financial authority.

## 12 · FIN-002..FIN-010 dependencies
FIN-004 (primary), FIN-003; FIN-006 (margin section absence); read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Visibility scopes SELF/TEAM/BUSINESS_UNIT/OPERATING_COMPANY/CONSOLIDATED enforced at read.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-VISIBILITY (FIN-004 scope-filtered projection); FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
FIN-PQ-15a margin visibility by person.

## 18 · Implementation dependencies
Scope must be enforced in the read layer; page renders whatever slice returns.

## 19 · Shared components / patterns
NS shell, attainment bars, withheld panel, attribution sublabels. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 15 *.dc.html (project root; copy in design_handoff_financials/). Frames: 15-employee-performance-1440.png (TEAM) · 15-employee-performance-375-self.png (SELF) under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
