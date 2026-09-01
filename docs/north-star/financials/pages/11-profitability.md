# 11 — Gross Margin & Profitability

**Route:** /financials/profitability
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 11 Gross Margin Profitability.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 11-profitability-1440.png · 11-profitability-375.png

## 1–3 · Name, route, purpose
Gross Margin & Profitability · /financials/profitability — Operational profitability; before FIN-006 the truthful unavailable state IS the page.

## 4 · Information hierarchy
"Margin cannot be reported yet" band (leading, explanatory) → "What is reportable today" table: revenue at full strength, cost/GM/GM% reserved with one quiet phrase per row → rails: what activates with FIN-006; what is never on this page (statutory net profit, overhead, tax).

## 5 · Filters
Company · dimension pivot (unit/salesperson/customer/source) · Period.

## 6 · Drilldowns
Future margin figures drill back to composing events; today revenue drills to Invoices.

## 7 · Desktop behavior
Fact outranks absence (family rule applied).

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Banner + revenue rows with per-row absence line.

## 9 · Empty / unavailable / denied states
GROSS_MARGIN_AUTHORITY = MISSING rendered as the composition itself; pivots inactive until authority.

## 10 · Financial facts shown
Billed revenue by unit: Service $121,300 / ES $102,050 / Parts $64,800 (OPERATIONAL_ACTUAL).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Revenue: billed reads (activation pending) over FIN-002-complete attribution. Cost/margin: FIN-006 missing — never derived from sell price.

## 12 · FIN-002..FIN-010 dependencies
FIN-006; read activation (revenue).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped; margin visibility policy itself is FIN-PQ-15a.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-COST-MARGIN (FIN-006).

## 17 · PRODUCT QUESTIONS
FIN-PQ-15a who may see margin by person when it exists.

## 18 · Implementation dependencies
None until FIN-006; layout gains values, not structure.

## 19 · Shared components / patterns
NS shell, missing-authority band, reserved-column table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 11 *.dc.html (project root; copy in design_handoff_financials/). Frames: 11-profitability-1440.png · 11-profitability-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
