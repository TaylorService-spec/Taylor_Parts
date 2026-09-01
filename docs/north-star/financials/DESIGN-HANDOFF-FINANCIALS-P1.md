# DESIGN HANDOFF — FINANCIALS NORTH STAR P1 (pages 01–20)

Status: READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 complete, corrections applied 2026-09-01 · design direction APPROVED · implementation NOT performed.
Master review package (final-review entry point): `docs/north-star/financials/FINANCIALS-NORTH-STAR-P1-DESIGN-REVIEW-PACKAGE.md` (copy in this folder).
Family README: `README.md` · Frames: `frames/` + `frames/README.md` · Editable sources: the `.dc.html` files here (mirrors of root).

Three-authority model applies. The 20 corrected per-page handoffs follow, verbatim.

---

# 01 — Financials Overview

**Route:** /financials
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 01 Financials Overview.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 01-overview-1440.png · 01-overview-375.png

## 1–3 · Name, route, purpose
Financials Overview · /financials — Executive/management landing for the EOS operational financial subledger.

## 4 · Information hierarchy
Custody sentence → company/unit/period filter rail → six-figure lifecycle scorecard (Booked, Billable, Billed, Collected, A/R, Unbilled) → Performance-against-plan table → exception rail → forecast teaser. Cost & margin: truthful missing-authority band.

## 5 · Filters
Company (Consolidated/Taylor/Ventana) · Business Unit · Period (Month/Quarter/YTD/Year/Custom).

## 6 · Drilldowns
Each scorecard figure → owning page; exception rows → Billing Queue / Payments / A-R; plan rows → Sales to Goal; forecast → Forecasting.

## 7 · Desktop behavior
Scorecard ribbon + 1fr/340px grid; no card farm.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
2×3 scorecard grid; exceptions outrank plan table; cost/margin band omitted (lives on its own pages).

## 9 · Empty / unavailable / denied states
Reconciliation exception line renders "No accounting authority" (never zero); Installation row: "No goal set"; cost/margin: missing-authority band.

## 10 · Financial facts shown
Booked $412,800; Billable $74,200; Billed $288,150; Collected $231,900; A/R $56,250; Unbilled $124,650 (labelled derived: booked − billed); goal actuals/attainment; forecast $438,000 (v-labelled). All OPERATIONAL_ACTUAL / GOAL / FORECAST fact-class labelled. Specimen Certification World fixtures.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Booked ← governed reporting attribution (FIN-002 COMPLETE: explicit operatingCompanyId at reportable boundary, line-level BU, creditedSalespersonId separate from ownership, immutable reporting snapshot). Billed/Collected/A-R ← invoice/payment command cores BUILT_DORMANT — not user-exposed, read/visibility authority pending. Goals/budgets ← FIN-003 Plan vs Actual (OPEN). Forecast ← FIN-005 (OPEN). Cost/margin ← FIN-006 (OPEN). Reconciliation ← FIN-010 (OPEN).

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-005, FIN-006 (absence state), FIN-010 (absence state); finance read activation/projections.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Refresh (read). No writes on this page.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): financial read scoped by visibility grants.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION (command cores BUILT_DORMANT; reads/projections not activated); FIN-AG-VISIBILITY (FIN-004).

## 17 · PRODUCT QUESTIONS
FIN-PQ-001 nav taxonomy for 20 routes.

## 18 · Implementation dependencies
Requires invoice/payment/goal/forecast reads; scorecard is a composed read, no new store.

## 19 · Shared components / patterns
NS shell (rail+breadcrumb+thick-thin rule), scorecard figure block w/ fact-class label, seg filter, exception rail, hover-ⓘ annotation. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 01 *.dc.html (project root; copy in design_handoff_financials/). Frames: 01-overview-1440.png · 01-overview-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 02 — Billing Queue

**Route:** /financials/billing-queue
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 02 Billing Queue.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 02-billing-queue-1440.png · 02-billing-queue-375.png · 02-billing-queue-item-1440.png · 02-billing-queue-item-375.png

## 1–3 · Name, route, purpose
Billing Queue · /financials/billing-queue — Work financially eligible or potentially eligible to invoice; billing readiness ≠ WO COMPLETE.

## 4 · Information hierarchy
Header totals (eligible $ / blocked $) → tabs (Eligible/Blocked/Partially invoiced/All) → one table, blocked reasons inline → bulk Create invoices. Item drill-in sheet: blocking banner → readiness checklist → amount breakdown → invoice history → gated action.

## 5 · Filters
Company · Business Unit · Period (All open default).

## 6 · Drilldowns
Row → item inspection sheet (1b); source → WO/SO record; pricing link → Parts surface.

## 7 · Desktop behavior
Single table, no card-per-row; checkbox selection for bulk issue.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Two-line rows (identity+amount / dimensions+state); no bulk actions; blocked reason verbatim.

## 9 · Empty / unavailable / denied states
Blocked rows carry governed reason inline; Create invoice disabled with capability-inactive one-liner while blocked; "No portion invoiced" empty history line.

## 10 · Financial facts shown
Eligible $74,200/14; blocked $31,450/6; row amounts w/ cents; partial-invoice amounts; readiness facts (work complete, labor priced, parts priced, customer billable).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Source WO/SO facts exist. Commercial Sales Order billing eligibility: governed logic already exists. Service billing readiness (WO COMPLETE ≠ billed): the remaining gap — FIN-AG-SERVICE-BILLING-READINESS; the two models stay separate, no universal readiness model implied. Invoice command core: BUILT_DORMANT.

## 12 · FIN-002..FIN-010 dependencies
Read activation + FIN-004 visibility; FIN-007 where exception governance applies.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Create invoices (bulk), Create invoice (item), Apply-filter/tabs.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): invoice-create (CONCEPTUAL, ID TBD); blocked items never expose the action regardless of capability.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-SERVICE-BILLING-READINESS; FIN-AG-02b no governed pricing-resolution action (links out to Parts); FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
Partial-invoicing policy (who may split, on what units) — FIN-007 governance question.

## 18 · Implementation dependencies
Needs readiness projection over WO/SO + pricing; blocking reasons as governed enum.

## 19 · Shared components / patterns
NS shell, tabs-with-counts, exception-tinted banner (#F7EFE4), readiness checklist rows, capability-inactive line. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 02 *.dc.html (project root; copy in design_handoff_financials/). Frames: 02-billing-queue-1440.png · 02-billing-queue-375.png · 02-billing-queue-item-1440.png · 02-billing-queue-item-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 03 — Invoices

**Route:** /financials/invoices
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 03 Invoices.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 03-invoices-1440.png · 03-invoices-375.png · 03-invoice-record-1440.png · 03-invoice-record-375.png

## 1–3 · Name, route, purpose
Invoices · /financials/invoices — Governed invoice collection and immutable invoice record.

## 4 · Information hierarchy
Collection: tabs All/Open/Paid/Corrected → table (Invoice, Customer, Company·Unit, Issued, Due, Total, Applied, Outstanding, Status). Record: identity header + outstanding summary → immutable lines w/ line-level BU + lineage → payments & corrections ledger → rail (record facts, reconciliation absence, audit).

## 5 · Filters
Company · Period · search (invoice # / customer).

## 6 · Drilldowns
Row → invoice record; lines → source SO/WO; payments → payment record; credits → correction record; customer → Account.

## 7 · Desktop behavior
Issuing happens only from Billing Queue — no New Invoice button here (deliberate).

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Two-line collection rows; record recomposes to summary → lines → payments/corrections → reconciliation line.

## 9 · Empty / unavailable / denied states
Mixed invoice shows "Mixed (2 units)" at collection level (line-level BU is the only unit truth); Corrected rows keep issued value visible with derivation label; Reconciliation section: honest no-authority statement; Overdue in red.

## 10 · Financial facts shown
41 invoices; $288,150 billed; per-row totals/applied/outstanding with cents; record: issued $2,240.00, applied $1,890.00, credited $350.00, outstanding $0.00; line-level business units; terms; currency USD.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Invoice command authority BUILT_DORMANT — read/UI exposure not yet activated. Company authority: SalesOrder.operatingCompanyId (FIN-002 COMPLETE); line-level BU attribution complete. Corrections governance: FIN-007. Reconciliation column withheld: FIN-010.

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-007 (corrections shown on record); FIN-010 (reserved column).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating on collection; record links out. Corrections happen in Credits & Adjustments.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped by visibility.

## 15 · DESIGN GAPS
Reconciliation Status column withheld by design until FIN-010 (reserved slot, named).

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION (invoice read/UI exposure over the dormant core).

## 17 · PRODUCT QUESTIONS
None — INV-YYYY-NNNN is a SPECIMEN format; current governed numbering authority is used at implementation (not a new product decision).

## 18 · Implementation dependencies
Immutable issued lines; corrections as appended events; mixed-BU handling in filters.

## 19 · Shared components / patterns
NS shell, tabs, record header w/ amount summary rail, immutable-lines table, event ledger list. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 03 *.dc.html (project root; copy in design_handoff_financials/). Frames: 03-invoices-1440.png · 03-invoices-375.png · 03-invoice-record-1440.png · 03-invoice-record-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

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


---

# 05 — Payments

**Route:** /financials/payments
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 05 Payments.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 05-payments-1440.png · 05-payments-375.png · 05-payment-record-1440.png · 05-payment-record-375.png

## 1–3 · Name, route, purpose
Payments · /financials/payments — Governed operational payment workspace; RECEIVED ≠ APPLIED ≠ UNAPPLIED ≠ RECONCILED.

## 4 · Information hierarchy
Header (received $, unapplied $ exception) → tabs All/Unapplied/Fully applied → table → record: identity header → applications table → unapplied banner w/ gated Apply action → rail (record facts, reconciliation absence, audit).

## 5 · Filters
Company · Period · search (reference/customer).

## 6 · Drilldowns
Row → payment record; applications → invoice records; customer → Customer Financials.

## 7 · Desktop behavior
Unapplied cash is the sorted-first exception.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Unapplied first; apply action drills in; record recomposes.

## 9 · Empty / unavailable / denied states
Unapplied/Partially applied amber AND labelled FUTURE AUTHORITY in the design (unapplied-balance workflow not yet implemented; over-application refused today); "no remittance" note; reconciliation: honest absence ("applied-in-full is an operational state, not reconciliation").

## 10 · Financial facts shown
$231,900 received; $4,180 unapplied/2; per-payment amount/applied/unapplied with cents; method references (check #, ACH).
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Payment command core BUILT_DORMANT — supports cash receipt, application to an invoice, derived outstanding balance; over-application is REFUSED. A real unapplied-cash balance workflow is FUTURE AUTHORITY: FIN-AG-PAYMENT-UNAPPLIED. No banking/settlement authority drawn (deliberate).

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-AG-PAYMENT-UNAPPLIED (Owner policy if unresolved); FIN-010 (reserved reconciliation).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
Record payment; Apply to invoice.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): payment-record / payment-apply (CONCEPTUAL, IDs TBD).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PAYMENT-UNAPPLIED; FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
Refund flows route through Credits & Adjustments, not here — confirm. FIN-PQ-UNAPPLIED-POLICY: should a real unapplied-cash workflow exist at all (Owner decision).

## 18 · Implementation dependencies
Application events append-only; unapplied remainder derived.

## 19 · Shared components / patterns
NS shell, tabs, exception banner, applications table, record rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 05 *.dc.html (project root; copy in design_handoff_financials/). Frames: 05-payments-1440.png · 05-payments-375.png · 05-payment-record-1440.png · 05-payment-record-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

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


---

# 07 — Customer Financials

**Route:** /financials/customer-financials
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 07 Customer Financials.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 07-customer-financials-1440.png · 07-customer-financials-375.png

## 1–3 · Name, route, purpose
Customer Financials · /financials/customer-financials — Customer-centric composition of governed Sales and Service financial facts; never duplicates Customer identity.

## 4 · Information hierarchy
Customer search/selector → identity line (links to Account) → 5-figure summary (Booked/Billed/Collected/Outstanding/Credits) + Sales-vs-Service split → financial history (event ledger, newest first) → open-items rail + context rail.

## 5 · Filters
Customer selector · Period (YTD default).

## 6 · Drilldowns
Every event → owning record (invoice/payment/correction/SO); customer → Account North Star.

## 7 · Desktop behavior
1fr/320px grid; read-only ledger.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
2×2 summary grid → open items → recent history lines.

## 9 · Empty / unavailable / denied states
Unapplied/blocked open items carry their exception colors; unattributed lineage reported as "unattributed", never guessed.

## 10 · Financial facts shown
Canyon Foods YTD: booked $48,300; billed $41,050; collected $37,940; outstanding $3,110; credits $350; Sales $29,400 / Service $18,900 split from source lineage.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Composes invoice/payment/correction reads (cores BUILT_DORMANT, activation pending) over FIN-002-complete attribution; identity from the existing certified Customer record — no separate truth store.

## 12 · FIN-002..FIN-010 dependencies
Read activation; FIN-004; FIN-007.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating (composition page).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped by visibility.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION; FIN-AG-PAYMENT-UNAPPLIED (the unapplied open item carries the same future-authority label).

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Cross-collection composed read keyed by customer; figures must reconcile to owning pages to the cent.

## 19 · Shared components / patterns
NS shell, summary figures, event ledger, open-items rail. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 07 *.dc.html (project root; copy in design_handoff_financials/). Frames: 07-customer-financials-1440.png · 07-customer-financials-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 08 — Sales to Goal

**Route:** /financials/sales-to-goal
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 08 Sales to Goal.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 08-sales-to-goal-1440.png · 08-sales-to-goal-375.png

## 1–3 · Name, route, purpose
Sales to Goal · /financials/sales-to-goal — Actual performance against governed goals; every goal states its measurement basis.

## 4 · Information hierarchy
Basis sentence → filters → Company→unit→person table (Scope, Basis, Actual, Goal, Variance, Attainment bar) → period-summary rail grouped by basis (deliberately no single total).

## 5 · Filters
Company · Business Unit · Period.

## 6 · Drilldowns
Scope row → person rows → financial events behind the actual; admin → Goal Management.

## 7 · Desktop behavior
Attainment bars capped at 100% fill, number carries truth past 100.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Bar cards per scope, basis under each.

## 9 · Empty / unavailable / denied states
GROSS_MARGIN-basis goal renders "attainment cannot be computed truthfully (FIN-006)"; "No goal set" rows; over-goal green.

## 10 · Financial facts shown
Scope actuals vs goals; variance; attainment %; bases BOOKED/BILLED/COLLECTED/REVENUE/GROSS_MARGIN as vocabulary.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Goals: FIN-003 Plan vs Actual (OPEN). Actuals: per-basis reads over FIN-002-complete attribution (billed/collected pending read activation). Margin-basis attainment blocked by FIN-006.

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-006 (margin basis); read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating (set goals in Goal Management).
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Person rows only within viewer scope; attribution strictly creditedSalespersonId.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PLAN (goal records — FIN-003).

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Per-basis actual computation; rollups grouped by basis only.

## 19 · Shared components / patterns
NS shell, attainment bar, basis label, hierarchy-indented table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 08 *.dc.html (project root; copy in design_handoff_financials/). Frames: 08-sales-to-goal-1440.png · 08-sales-to-goal-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 09 — Cost to Budget

**Route:** /financials/cost-to-budget
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 09 Cost to Budget.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 09-cost-to-budget-1440.png · 09-cost-to-budget-375.png

## 1–3 · Name, route, purpose
Cost to Budget · /financials/cost-to-budget — Budget vs actual cost; no authoritative cost drawn before FIN-006.

## 4 · Information hierarchy
Contract sentence → missing-authority band → budget table with real Budget column (versioned) and honest Actual/Variance/Remaining single-state columns.

## 5 · Filters
Company · Business Unit · Period (Quarter default).

## 6 · Drilldowns
Budget figures → versioned records in Budget Management.

## 7 · Desktop behavior
Structure ships whole; columns reserved, not zero-filled.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Budget rows with per-row "Actual: no cost authority" line.

## 9 · Empty / unavailable / denied states
"No cost authority" per row + one banner; "No budget set" for Subcontractor; when FIN-006 lands, over-budget rows take exception treatment.

## 10 · Financial facts shown
Q3 budgets: Labor $96,000 (v2), Parts $41,500 (v2), Freight $6,200 (v1), Vehicle $18,400 (v1). Categories are the governed budget category list.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Budgets: FIN-003 Plan vs Actual (records designed in page 12). Cost actuals: FIN-006 (missing, stated; never zero-filled, never derived from sell price).

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-006.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Read scoped.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-COST-MARGIN (the page IS the truthful state); FIN-AG-PLAN (budget records).

## 17 · PRODUCT QUESTIONS
Governed cost category vocabulary to confirm in FIN-006.

## 18 · Implementation dependencies
None until FIN-006; page renders from budget reads alone.

## 19 · Shared components / patterns
NS shell, missing-authority band, reserved-column table. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 09 *.dc.html (project root; copy in design_handoff_financials/). Frames: 09-cost-to-budget-1440.png · 09-cost-to-budget-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

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


---

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


---

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


---

# 13 — Goal Management

**Route:** /financials/goals
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 13 Goal Management.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 13-goals-1440.png · 13-goals-375.png · 13-goal-create-1440.png · 13-goal-review-375.png

## 1–3 · Name, route, purpose
Goal Management · /financials/goals — Governed financial/performance goal administration; measurement basis unmissable.

## 4 · Information hierarchy
Collection: table (Scope incl. person rows, Basis chip, Target, Period, Version, Approval, Status). Create sheet: company/scope/period/basis/target + basis-consequence explainer. Mobile review: basis + target + prior-period + approve/decline.

## 5 · Filters
Company · scope type (unit/team/person) · Period.

## 6 · Drilldowns
Goal → Sales to Goal attainment; versions in place.

## 7 · Desktop behavior
Basis rendered as an outlined chip in its own column.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Cards with basis chip.

## 9 · Empty / unavailable / denied states
"Active · not computable" for margin-basis goals (FIN-006); Superseded quieted; percentage targets for margin basis (unit renders from basis, never assumed).

## 10 · Financial facts shown
11 goals; targets; bases; version chain; approvals.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Goals: FIN-003 Plan vs Actual; person goals attribute by creditedSalespersonId (a FIN-002-complete fact); SELF-visibility per FIN-004.

## 12 · FIN-002..FIN-010 dependencies
FIN-003, FIN-004, FIN-006 (margin basis), FIN-007 (approval).
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
New goal; Submit; Approve/Decline; Save draft.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): goal-create / goal-approve (CONCEPTUAL, IDs TBD).

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-PLAN; FIN-AG-APPROVALS.

## 17 · PRODUCT QUESTIONS
FIN-PQ-TEAM-GOAL: team-roster semantics on mid-period roster change — recorded, not answered by Design (FIN-003).

## 18 · Implementation dependencies
Versioned immutable records; basis fixed per goal.

## 19 · Shared components / patterns
NS shell, basis chip (.basis), sheet form, review diff. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 13 *.dc.html (project root; copy in design_handoff_financials/). Frames: 13-goals-1440.png · 13-goals-375.png · 13-goal-create-1440.png · 13-goal-review-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 14 — Company & Business Unit Performance

**Route:** /financials/company-performance
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 14 Company Business Unit Performance.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 14-company-performance-1440.png · 14-company-performance-375.png

## 1–3 · Name, route, purpose
Company & Business Unit Performance · /financials/company-performance — Cross-company and cross-unit operational performance; Taylor vs Ventana easy without intercompany accounting.

## 4 · Information hierarchy
Contract sentence (arithmetic consolidation, not accounting) → metric × company table (Taylor / Ventana / Consolidated / fact class) → unit bar breakdown. Cost/margin/budget-variance rows reserved with one-line truth.

## 5 · Filters
Period · view seg (metrics table / by unit).

## 6 · Drilldowns
Each cell → owning page with company filter pre-applied (hierarchy is navigation, not new data).

## 7 · Desktop behavior
Metric rows appear only where authority exists.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
Compact $k table (display treatment only — noted on page).

## 9 · Empty / unavailable / denied states
Consolidated attainment deliberately "—" (would silently mix bases); reserved rows for cost/margin/budget variance.

## 10 · Financial facts shown
Booked/Billed/Collected/A-R by company + consolidated (sum to Overview figures); attainment per company; forecast v4 split.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Same reads as Overview (attribution FIN-002-complete; lifecycle reads pending activation). Consolidated = arithmetic operational consolidation — NOT accounting reconciliation, GL consolidation or intercompany elimination. FIN-009 owns classification; the external authority owns eliminations.

## 12 · FIN-002..FIN-010 dependencies
FIN-003/004/005/006(absence)/009; read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): CONSOLIDATED visibility required for full table; narrower scopes see their slice.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-READ-ACTIVATION; FIN-AG-VISIBILITY.

## 17 · PRODUCT QUESTIONS
None new.

## 18 · Implementation dependencies
Composed read; consolidated = arithmetic sum, flagged intercompany via page 17 classification.

## 19 · Shared components / patterns
NS shell, metric×company matrix, unit bars. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 14 *.dc.html (project root; copy in design_handoff_financials/). Frames: 14-company-performance-1440.png · 14-company-performance-375.png under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

# 15 — Salesperson & Employee Performance

**Route:** /financials/employee-performance
**Design status:** READY_FOR_FINAL_AUTHORITY_AND_FEASIBILITY_REVIEW · authority review pass 1 COMPLETE — corrections applied 2026-09-01. Design direction APPROVED; implementation NOT authorized from this package.
**Source artifact:** North Star - Financials 15 Salesperson Employee Performance.dc.html (root) · copy: design_handoff_financials/
**Frames:** design_handoff_financials/frames/ → 15-employee-performance-1440.png (TEAM) · 15-employee-performance-375-self.png (SELF)

## 1–3 · Name, route, purpose
Salesperson & Employee Performance · /financials/employee-performance — Individual/team financial performance with visibility as the composition.

## 4 · Information hierarchy
Scope statement in header (TEAM view drawn) → view seg (Salesperson credit / Service responsibility — never merged) → team table (person, basis, actual, goal, attainment) w/ per-row attribution label → "Outside your scope" withheld panel (explicit DENIED design) → team summary rail; margin-by-person honest absence. Mobile frame = SELF scope (salesperson sees only themself + withheld note).

## 5 · Filters
View (credit/responsibility) · Period.

## 6 · Drilldowns
Person → credited events; manager rollups by scope.

## 7 · Desktop behavior
TEAM scope specimen.

## 8 · Mobile behavior (375 recomposition, never horizontal shrink)
SELF scope specimen — deliberate second visibility state.

## 9 · Empty / unavailable / denied states
DENIED = named withheld panel (never zeros, never silent absence); "No goal set"; margin unavailable (FIN-006 + FIN-PQ-15a).

## 10 · Financial facts shown
Team actuals/goals/attainment; credited order list (SELF view). Attribution: creditedSalespersonId ≠ ownerEmployeeId ≠ createdBy ≠ responsibleEmployeeId — labelled per row.
All values are Certification World specimen fixtures showing the shape of the read, not live claims. Fact classes OPERATIONAL_ACTUAL / ACCOUNTING_RECONCILED_ACTUAL / FORECAST / BUDGET / GOAL stay labelled and separate; ACCOUNTING_RECONCILED_ACTUAL appears nowhere (no accounting authority).

## 11 · Authority source per fact
Booked attribution FIN-002-complete (creditedSalespersonId separate from ownership); billed reads pending activation; goals FIN-003. Visibility scopes are owned by FIN-004 (OPEN) — visible page controls are never financial authority.

## 12 · FIN-002..FIN-010 dependencies
FIN-004 (primary), FIN-003; FIN-006 (margin section absence); read activation.
Canonical FIN map: FIN-001 Authority & State Model (COMPLETE) · FIN-002 Reporting Attribution (COMPLETE) · FIN-003 Plan vs Actual · FIN-004 Financial Visibility · FIN-005 Forecast · FIN-006 Cost & Margin · FIN-007 Adjustments/Approvals/Exceptions · FIN-008 Period & Close · FIN-009 Allocation & Intercompany · FIN-010 Reconciliation/Traceability/Audit (003–010 OPEN).

## 13–14 · Actions and required capability
None mutating.
Capabilities (CONCEPTUAL — exact governed IDs TBD; Design does not declare permission vocabulary): Visibility scopes SELF/TEAM/BUSINESS_UNIT/OPERATING_COMPANY/CONSOLIDATED enforced at read.

## 15 · DESIGN GAPS
None.

## 16 · AUTHORITY GAPS
FIN-AG-VISIBILITY (FIN-004 scope-filtered projection); FIN-AG-READ-ACTIVATION.

## 17 · PRODUCT QUESTIONS
FIN-PQ-15a margin visibility by person.

## 18 · Implementation dependencies
Scope must be enforced in the read layer; page renders whatever slice returns.

## 19 · Shared components / patterns
NS shell, attainment bars, withheld panel, attribution sublabels. Annotations behind hover-ⓘ (.hlp/.tip) per the binding convention; only contract copy stays visible.

## 20–21 · Artifact & frame paths
Source: North Star - Financials 15 *.dc.html (project root; copy in design_handoff_financials/). Frames: 15-employee-performance-1440.png (TEAM) · 15-employee-performance-375-self.png (SELF) under design_handoff_financials/frames/

## Visibility
SELF / TEAM / BUSINESS_UNIT / OPERATING_COMPANY / CONSOLIDATED — restriction follows the number into reports, exports, search, APIs; UI hiding alone is never authority.


---

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


---

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


---

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


---

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


---

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


---

