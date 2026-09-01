# 20 — Financial Settings & Governance

**Route:** /financials/governance
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 20 Financial Settings Governance.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 20-governance-1440.png · 20-governance-375.png

## 1–3 · Name, route, purpose
Financial Settings & Governance · /financials/governance — Financials-specific governed administration; not generic Admin; nothing here rewrites immutable history.

## 4 · Information hierarchy
Contract sentence → two columns: Authority & scope (authority mode, external authority FUTURE, reconciliation NOT CONFIGURED, cost NOT IMPLEMENTED, currency) + Structure (companies, units, periods) / Policy (goal, budget, correction FIN-007, visibility summary read-only, classifications FIN-009) + References (audit lens, recent governance changes).

## 5 · Filters
None (settings page).

## 6 · Drilldowns
Audit references → page 18.

## 7 · Desktop behavior
Every row carries one of four state chips: CONFIGURED / NOT CONFIGURED / AUTHORITY NOT IMPLEMENTED / FUTURE INTEGRATION REQUIRED.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Read-only state list; edits are desktop, permitted-role acts.

## 9 · Empty / unavailable / denied states
Four-state vocabulary is the page grammar; the period row reads AUTHORITY NOT IMPLEMENTED — FIN-008 Period & Close (no calendar configuration asserted; common practice is not authority).

## 10 · Financial facts shown
USD; Taylor/Ventana; four units; 2 governance changes this quarter (audit-linked).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Governed configuration records (mostly future); visibility summary reads platform role system (never duplicated).

## 12 · FIN-002..FIN-010 dependencies
FIN-003/006/007/008/009/010 each surface here as status rows.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Edit configured sections (future).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): governance-manage (CONCEPTUAL, ID TBD); all edits audited.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
Governed config records; FIN-AG-PERIOD (FIN-008 period & close governance).

## 17 · PRODUCT QUESTIONS
FIN-PQ-20a period close, late transactions, prior-period adjustment semantics (FIN-008).

## 18 · Implementation dependencies
Config store + status derivation from phase implementations.

## 19 · Shared components / patterns
NS shell, state chips (.st), settings rows (.row). Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 20 *.dc.html (project root; copy in design_handoff_financials/). Frames: 20-governance-1440.png · 20-governance-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
