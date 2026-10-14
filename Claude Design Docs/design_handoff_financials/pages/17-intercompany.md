# 17 — Intercompany

**Route:** /financials/intercompany
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 17 Intercompany.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 17-intercompany-1440.png · 17-intercompany-375.png

## 1–3 · Name, route, purpose
Intercompany · /financials/intercompany — Classified Taylor/Ventana cross-company operational activity; classification, never elimination.

## 4 · Information hierarchy
Five-facts contract sentence → direction seg (incl. Unclassified) → table (Event, Direction, Inventory owner, Charge bears on, Amount, Classification, Reporting treatment) → unclassified rows as the loud exception, excluded from splits.

## 5 · Filters
Direction · Period.

## 6 · Drilldowns
Events → transfer/WO records; classifications → Financial Audit.

## 7 · Desktop behavior
Physical ownership / supplier relationship / charge / classification / reporting treatment kept as separate columns.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Unclassified first; two-line rows.

## 9 · Empty / unavailable / denied states
Unclassified = amber, excluded-from-splits note; no GL eliminations drawn or implied.

## 10 · Financial facts shown
3 specimen events (transfer $4,440, labor $860, freight $312 unclassified); directions derived from governed custody/charge facts (never warehouse names/routes).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Custody facts exist (Parts/Receiving); classification schema: FIN-009 (not built).

## 12 · FIN-002..FIN-010 dependencies
FIN-009; external authority for eliminations (never in EOS).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Classify (governed act, audited).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): financial.intercompany.classify (FIN-009); who may classify is FIN-PQ-17a.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-INTERCO (classification schema — FIN-009).

## 17 · PRODUCT QUESTIONS
FIN-PQ-17a classification rules/actors (FIN-009).

## 18 · Implementation dependencies
Classification as appended governed events; exclusion logic for unclassified.

## 19 · Shared components / patterns
NS shell, direction seg, five-fact table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 17 *.dc.html (project root; copy in design_handoff_financials/). Frames: 17-intercompany-1440.png · 17-intercompany-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
