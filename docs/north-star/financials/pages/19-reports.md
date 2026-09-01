# 19 — Reporting & Exports

**Route:** /financials/reports
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 19 Reporting Exports.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 19-reports-1440.png · 19-reports-375.png

## 1–3 · Name, route, purpose
Reporting & Exports · /financials/reports — Governed reporting hub; reports compose the same authority, never a new truth source; export re-authorizes.

## 4 · Information hierarchy
Catalog rail grouped Sales / Revenue & collections / Plan / Margin & cost (awaits FIN-006) / Governance → selected-report preview with filters + basis → export actions with scope-recheck note → restricted-example panel (explicit DENIED design).

## 5 · Filters
Per-report: company, period, basis.

## 6 · Drilldowns
Preview rows → owning records/pages.

## 7 · Desktop behavior
Catalog covers all 20 brief-listed reports; unavailable ones named with their blocking phase.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Catalog list; run/view on mobile, export desktop.

## 9 · Empty / unavailable / denied states
Margin/cost reports listed but inactive (FIN-006); Reconciliation Exceptions inactive (FIN-010); restricted report = named panel stating required authority + scope vs yours; never partial render.

## 10 · Financial facts shown
Preview: Sales by Salesperson (booked basis) — same figures as pages 08/15.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Reports read existing/future governed reads; export is a governed audited act.

## 12 · FIN-002..FIN-010 dependencies
All FIN phases per report; export audit → page 18.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Export CSV / Export PDF (re-authorized at request time).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): report-export (CONCEPTUAL, ID TBD); scope re-checked at execution time; no download-everything.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-REPORT-REGISTRY (definitions, scope-checked execution, audited export).

## 17 · PRODUCT QUESTIONS
Scheduling/sharing semantics — shared report must re-authorize per viewer (FIN-004).

## 18 · Implementation dependencies
Report registry + scope-checked execution + audited export.

## 19 · Shared components / patterns
NS shell, catalog rail, preview table, restricted panel. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 19 *.dc.html (project root; copy in design_handoff_financials/). Frames: 19-reports-1440.png · 19-reports-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
