# 18 — Financial Audit & History

**Route:** /financials/audit
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 18 Financial Audit History.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 18-audit-1440.png · 18-audit-375.png

## 1–3 · Name, route, purpose
Financial Audit & History · /financials/audit — Financials-focused lens over the existing append-only audit authority; never a second audit system.

## 4 · Information hierarchy
Contract sentence → event-class seg + period + search → newest-first table (When, Actor, Action, Record links, Reason/approval, Correlation) → event detail (future) with before/after where captured.

## 5 · Filters
Event class · Period · actor/record search.

## 6 · Drilldowns
Rows → financial records; correlation ids for request tracing.

## 7 · Desktop behavior
Read-only always.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Two-line event rows.

## 9 · Empty / unavailable / denied states
Rows exist only for event types whose authorities exist; audit rows about restricted numbers obey financial visibility scopes.

## 10 · Financial facts shown
Specimen events: correction submitted/approved, budget revision, payment applied, invoice issued — actor, timestamp, reason, correlation id.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Append-only auditEvents IS the audit authority (exists). This page is a financial lens/filter/projection over it — never a second financial audit ledger or new storage. Financial filter/index: FIN-AG-AUDIT-LENS (FIN-010 traceability). FIN-004 visibility protects restricted facts in audit views.

## 12 · FIN-002..FIN-010 dependencies
All FIN phases feed events; no new authority created.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None (read-only).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped by financial visibility.

## 15 · DESIGN GAPS
Event-detail frame deferred until before/after capture semantics confirmed.

## 16 · AUTHORITY GAPS
FIN-AG-AUDIT-LENS.

## 17 · PRODUCT QUESTIONS
FIN-PQ-CORRELATION-IDS: correlation/request ids may expose sensitive implementation detail — exposure policy TBD (FIN-010).

## 18 · Implementation dependencies
Saved lens/index over audit log; no writes.

## 19 · Shared components / patterns
NS shell, event table, correlation cell. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 18 *.dc.html (project root; copy in design_handoff_financials/). Frames: 18-audit-1440.png · 18-audit-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
