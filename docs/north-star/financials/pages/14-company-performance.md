# 14 — Company & Business Unit Performance

**Route:** /financials/company-performance
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 14 Company Business Unit Performance.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 14-company-performance-1440.png · 14-company-performance-375.png

## 1–3 · Name, route, purpose
Company & Business Unit Performance · /financials/company-performance — Cross-company and cross-unit operational performance; Taylor vs Ventana easy without intercompany accounting.

## 4 · Information hierarchy
Contract sentence (arithmetic consolidation, not accounting) → metric × company table (Taylor / Ventana / Consolidated / fact class) → unit bar breakdown. Cost/margin/budget-variance rows reserved with one-line truth.

## 5 · Filters
Period · view seg (metrics table / by unit).

## 6 · Drilldowns
Each cell → owning page with company filter pre-applied (hierarchy is navigation, not new data).

## 7 · Desktop behavior
Metric rows appear only where authority exists.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Compact $k table (display treatment only — noted on page).

## 9 · Empty / unavailable / denied states
Consolidated attainment deliberately "—" (would silently mix bases); reserved rows for cost/margin/budget variance.

## 10 · Financial facts shown
Booked/Billed/Collected/A-R by company + consolidated (sum to Overview figures); attainment per company; forecast v4 split.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Same reads as Overview (attribution FIN-002-complete; lifecycle reads pending activation). Consolidated = arithmetic operational consolidation — NOT accounting reconciliation, GL consolidation or intercompany elimination. FIN-009 owns classification; the external authority owns eliminations.

## 12 · FIN-002..FIN-010 dependencies
FIN-003/004/005/006(absence)/009; read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): CONSOLIDATED visibility required for full table; narrower scopes see their slice.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION; FIN-AG-VISIBILITY.

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Composed read; consolidated = arithmetic sum, flagged intercompany via page 17 classification.

## 19 · Shared components / patterns
NS shell, metric×company matrix, unit bars. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 14 *.dc.html (project root; copy in design_handoff_financials/). Frames: 14-company-performance-1440.png · 14-company-performance-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
