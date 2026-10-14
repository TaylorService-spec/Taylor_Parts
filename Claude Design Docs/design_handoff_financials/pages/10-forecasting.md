# 10 — Forecasting

**Route:** /financials/forecasting
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 10 Forecasting.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 10-forecasting-1440.png · 10-forecasting-375.png

## 1–3 · Name, route, purpose
Forecasting · /financials/forecasting — Forecast presentation distinct from actual, budget and goal; every forecast exposes version + as-of.

## 4 · Information hierarchy
Version selector (first-class, header right) → unit table (Forecast / Goal side-by-side by basis / Actual-to-date / Method) → version history (immutable) → inputs rail with attributed judgment line.

## 5 · Filters
Company · Business Unit · Period.

## 6 · Drilldowns
Inputs name their source reads (pipeline, booked orders, scheduled work, open WOs, trailing demand).

## 7 · Desktop behavior
Method column carries provenance.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Consolidated figure + unit rows w/ goal-basis subline; versions read-only.

## 9 · Empty / unavailable / denied states
"Not forecast in v4"; no confidence fan (no governed model — named PQ); method content unresolved — METHOD TBD BY FIN-005 GOVERNED FORECAST AUTHORITY; Opportunity.expectedValue never passed through as revenue.

## 10 · Financial facts shown
v4 as of Aug 28: ES $236,000 / Service $128,000 / Parts $61,000; consolidated $425,000; inputs decomposition; version history v2-v4. All FORECAST fact class.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Forecast records, versioning AND methodology: FIN-005 Forecast Model (OPEN). Design does not choose methodology — method slots read "Method TBD — FIN-005"; inputs rail is illustrative. Standing constraint: Opportunity.expectedValue is never passed through as revenue.

## 12 · FIN-002..FIN-010 dependencies
FIN-005 (forecast); FIN-003 (goal comparison); read activation (actual-to-date).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
New forecast version (permitted users; not drawn as primary).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): forecast-create (CONCEPTUAL, ID TBD; future).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-FORECAST (collection/versioning/method registry — FIN-005).

## 17 · PRODUCT QUESTIONS
FIN-PQ-10a confidence/range model (FIN-005).

## 18 · Implementation dependencies
Immutable versions; method label part of record.

## 19 · Shared components / patterns
NS shell, version selector, side-by-side plan table, inputs rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 10 *.dc.html (project root; copy in design_handoff_financials/). Frames: 10-forecasting-1440.png · 10-forecasting-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
