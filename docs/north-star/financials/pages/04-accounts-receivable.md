# 04 — Accounts Receivable

**Route:** /financials/accounts-receivable
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 04 Accounts Receivable.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 04-accounts-receivable-1440.png · 04-accounts-receivable-375.png

## 1–3 · Name, route, purpose
Accounts Receivable · /financials/accounts-receivable — Issued-but-unpaid operational exposure; explicitly not accounting-reconciled.

## 4 · Information hierarchy
Contract sentence → aging ribbon (Total/Current/1-30/31-60/61+) → by-customer table grouped by exposure → breakdown rail (company; unit from lines; salesperson where valid).

## 5 · Filters
Company · breakdown pivot (customer/company/unit/salesperson) · as-of date.

## 6 · Drilldowns
Invoice → invoice record; customer group → Customer Financials.

## 7 · Desktop behavior
Customer rowspan grouping, largest exposure first.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Aging strip 4-up; exposure list per customer.

## 9 · Empty / unavailable / denied states
"—" age for current invoices; 61+ bucket in red; no DSO/risk scores (no authority).

## 10 · Financial facts shown
Total A/R $56,250; buckets $34,320/$9,030/$0/$12,900; per-invoice original/applied/outstanding; company + line-level-unit breakdowns.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
A/R = issued invoices minus applications/credits (command cores BUILT_DORMANT). AGING BASIS: GOVERNED DUE DATE — established by current invoice authority.

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-007 (dispute/promise-to-pay policies); FIN-010 for the reconciled claim it explicitly does not make.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped; salesperson pivot only where creditedSalespersonId + visibility permit.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-DUEDATE-POLICY: disputed invoices, promise-to-pay, terms changes after issuance, special aging treatments not implemented (the aging basis itself IS governed).

## 17 · PRODUCT QUESTIONS
Whether 90+ bucket wording (brief) vs 61+/91+ split — bucket vocabulary to confirm.

## 18 · Implementation dependencies
Line-level unit sums for unit breakdown (mixed invoices).

## 19 · Shared components / patterns
NS shell, aging ribbon (scorecard variant), grouped exposure table, breakdown rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 04 *.dc.html (project root; copy in design_handoff_financials/). Frames: 04-accounts-receivable-1440.png · 04-accounts-receivable-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.
