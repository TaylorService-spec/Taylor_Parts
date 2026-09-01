# 01 — Financials Overview

**Route:** /financials
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 01 Financials Overview.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 01-overview-1440.png · 01-overview-375.png

## 1–3 · Name, route, purpose
Financials Overview · /financials — Executive/management landing for the EOS operational financial subledger.

## 4 · Information hierarchy
Custody sentence → company/unit/period filter rail → six-figure lifecycle scorecard (Booked, Billable, Billed, Collected, A/R, Unbilled) → Performance-against-plan table → exception rail → forecast teaser. Cost & margin: truthful missing-authority band.

## 5 · Filters
Company (Consolidated/Taylor/Ventana) · Business Unit · Period (Month/Quarter/YTD/Year/Custom).

## 6 · Drilldowns
Each scorecard figure → owning page; exception rows → Billing Queue / Payments / A-R; plan rows → Sales to Goal; forecast → Forecasting.

## 7 · Desktop behavior
Scorecard ribbon + 1fr/340px grid; no card farm.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
2×3 scorecard grid; exceptions outrank plan table; cost/margin band omitted (lives on its own pages).

## 9 · Empty / unavailable / denied states
Reconciliation exception line renders "No accounting authority" (never zero); Installation row: "No goal set"; cost/margin: missing-authority band.

## 10 · Financial facts shown
Booked $412,800; Billable $74,200; Billed $288,150; Collected $231,900; A/R $56,250; Unbilled $124,650 (labelled derived: booked − billed); goal actuals/attainment; forecast $438,000 (v-labelled). All OPERATIONAL_ACTUAL / GOAL / FORECAST fact-class labelled. Specimen Certification World fixtures.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Booked ← governed reporting attribution (FIN-002 COMPLETE: explicit operatingCompanyId at reportable boundary, line-level BU, creditedSalespersonId separate from ownership, immutable reporting snapshot). Billed/Collected/A-R ← invoice/payment command cores BUILT_DORMANT — not user-exposed, read/visibility authority pending. Goals/budgets ← FIN-003 Plan vs Actual (OPEN). Forecast ← FIN-005 (OPEN). Cost/margin ← FIN-006 (OPEN). Reconciliation ← FIN-010 (OPEN).

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-005, FIN-006 (absence state), FIN-010 (absence state); finance read activation/projections.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Refresh (read). No writes on this page.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): financial read scoped by visibility grants.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION (command cores BUILT_DORMANT; reads/projections not activated); FIN-AG-VISIBILITY (FIN-004).

## 17 · PRODUCT QUESTIONS
FIN-PQ-001 nav taxonomy for 20 routes.

## 18 · Implementation dependencies
Requires invoice/payment/goal/forecast reads; scorecard is a composed read, no new store.

## 19 · Shared components / patterns
NS shell (rail+breadcrumb+thick-thin rule), scorecard figure block w/ fact-class label, seg filter, exception rail, hover-ⓘ annotation. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 01 *.dc.html (project root; copy in design_handoff_financials/). Frames: 01-overview-1440.png · 01-overview-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
