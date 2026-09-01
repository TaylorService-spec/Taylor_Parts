# 06 — Credits & Adjustments

**Route:** /financials/credits-adjustments
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 06 Credits Adjustments.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 06-credits-adjustments-1440.png · 06-credits-adjustments-375.png

## 1–3 · Name, route, purpose
Credits & Adjustments · /financials/credits-adjustments — Governed correction-event workspace. Invariant (visible contract copy): corrections create new governed events; the original remains history.

## 4 · Information hierarchy
Invariant sentence → type filter (Credit/Adjustment/Refund/Write-off) → tabs by approval state → table (Correction, Original event, Type, Amount, Reason, Actor→Approver, Status).

## 5 · Filters
Company · Type · Period.

## 6 · Drilldowns
Correction → original event record; approver flows → approval detail (mobile approve/decline).

## 7 · Desktop behavior
Awaiting-approval rows tinted; declined shown, never hidden.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Pending-approval triage first; approve/decline on drill-in only.

## 9 · Empty / unavailable / denied states
Awaiting approval (amber), Approved, Declined (red, with decliner); the specimen "policy TBD" approver row asserts no auto-approval policy (FIN-007 decision).

## 10 · Financial facts shown
9 corrections; amounts w/ cents; reasons verbatim; actor/approver names; resulting effect via original-event link.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Adjustment/refund core: BUILT_DORMANT (dormant finance code exists — not greenfield). Missing authority is governance: approval thresholds, dual-control, write-off and discount/override policy (FIN-007). Future Attribution Adjustment named FUTURE, not drawn as available.

## 12 · FIN-002..FIN-010 dependencies
FIN-007 governance; read activation for original events.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
New correction; Approve/Decline.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): correction-create / correction-approve (CONCEPTUAL, IDs TBD); thresholds per future FIN-007 policy — none asserted by Design.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-APPROVALS (FIN-007 governance over the BUILT_DORMANT correction core).

## 17 · PRODUCT QUESTIONS
Attribution adjustments (salesperson recredit) scope and authority — named FUTURE.

## 18 · Implementation dependencies
Corrections reference originals immutably; approval routing from governance policy.

## 19 · Shared components / patterns
NS shell, tabs, type seg, actor→approver cell pattern. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 06 *.dc.html (project root; copy in design_handoff_financials/). Frames: 06-credits-adjustments-1440.png · 06-credits-adjustments-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
