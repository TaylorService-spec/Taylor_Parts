# 16 — Reconciliation & Exceptions

**Route:** /financials/reconciliation
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 16 Reconciliation Exceptions.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 16-reconciliation-1440.png · 16-reconciliation-375.png

## 1–3 · Name, route, purpose
Reconciliation & Exceptions · /financials/reconciliation — Provider-neutral operational-to-accounting reconciliation workspace; no provider selected.

## 4 · Information hierarchy
Leading truth band ("no counts, not zero counts") → link to Governance provider status → dimmed structural specimen of the exception queue (columns: record, source, company, EOS amount, external amount, difference, external ref, state).

## 5 · Filters
(future) state tabs, company, period.

## 6 · Drilldowns
(future) exception → EOS record + external reference.

## 7 · Desktop behavior
Specimen table at 62% opacity, values deliberately empty.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Truth band + one-paragraph description of the future queue.

## 9 · Empty / unavailable / denied states
Working state names NOT_SENT/PENDING/ACCEPTED/REJECTED/EXCEPTION/RECONCILED marked as FIN-010 placeholders; no vendor UI drawn.

## 10 · Financial facts shown
None drawn (deliberate). The absence is the fact.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
FIN-AG-RECON — FIN-010 entirely: provider, final state vocabulary (working names retained as PROVISIONAL VOCABULARY), reads, exception actions, ACCOUNTING_RECONCILED_ACTUAL.

## 12 · FIN-002..FIN-010 dependencies
FIN-010.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None available; permitted exception actions are FIN-PQ-16a.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): TBD by FIN-010.

## 15 · DESIGN GAPS
Detail frame skipped: with no state vocabulary an exception-detail composition would assert FIN-010 decisions — named, not drawn.

## 16 · AUTHORITY GAPS
FIN-010 provider + state vocabulary + reads.

## 17 · PRODUCT QUESTIONS
FIN-PQ-16a permitted actions on exceptions; final state names.

## 18 · Implementation dependencies
None until FIN-010.

## 19 · Shared components / patterns
NS shell, truth band, dimmed specimen table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 16 *.dc.html (project root; copy in design_handoff_financials/). Frames: 16-reconciliation-1440.png · 16-reconciliation-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
