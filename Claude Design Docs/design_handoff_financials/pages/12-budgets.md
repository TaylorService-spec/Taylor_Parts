# 12 — Budget Management

**Route:** /financials/budgets
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 12 Budget Management.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 12-budgets-1440.png · 12-budgets-375.png · 12-budget-revise-1440.png · 12-budget-review-375.png

## 1–3 · Name, route, purpose
Budget Management · /financials/budgets — Governed creation, revision, review and approval of versioned budgets; plan history never rewritten.

## 4 · Information hierarchy
Collection: tabs Active/Awaiting approval/Superseded/Draft → table (Scope, Category, Period, Amount, Version w/ supersession, Approval, Status); version chain visible in place. Revise sheet: fixed scope/category/period + amount + reason → approval-routing banner → submit/draft. Mobile review: v2 vs v3 diff + approve/decline.

## 5 · Filters
Company · fiscal period.

## 6 · Drilldowns
Row → version record; pending → review sheet.

## 7 · Desktop behavior
Superseded rows stay listed, quieted.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Approval triage; diff view.

## 9 · Empty / unavailable / denied states
Awaiting approval (tinted), Superseded (quieted), Draft; approval-required banner defers thresholds/routing to FIN-007 governance and marks the capability conceptual.

## 10 · Financial facts shown
14 active lines; amounts; version chains (v1 superseded → v2 active → v3 pending); approver + timestamp; currency USD (single-currency op; multi-currency named FUTURE).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Budgets: FIN-003 Plan vs Actual. Approval/exception governance: FIN-007 — no thresholds, self-approval rules or routing asserted by Design.

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-007.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
New budget; Revise (new version); Submit for approval; Approve/Decline; Save draft.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): budget-create / budget-approve (CONCEPTUAL, IDs TBD).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PLAN (budget collection/versioning — FIN-003); FIN-AG-APPROVALS (FIN-007).

## 17 · PRODUCT QUESTIONS
Scope granularity (unit vs team budgets). Thresholds/self-approval are FIN-007 governance, not design questions.

## 18 · Implementation dependencies
Immutable versions; scope/category/period immutable on revision.

## 19 · Shared components / patterns
NS shell, version-chain rows, sheet form pattern (.fld/.inp), approval banner. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 12 *.dc.html (project root; copy in design_handoff_financials/). Frames: 12-budgets-1440.png · 12-budgets-375.png · 12-budget-revise-1440.png · 12-budget-review-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
