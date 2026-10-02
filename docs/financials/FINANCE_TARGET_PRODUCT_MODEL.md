# Finance Target Product Model

**Status:** ACCEPTED (Controller, 2026-10-01), with the four Controller corrections applied — DECISIONS #191.
**Governing decisions:** #145 (EOS is the governed operational financial subledger, not a general ledger) and #190
(the Taylor / Ventana / Saratoga / Rental operating model).
**Baseline:** main `903fd1db`; it follows the read-only Finance & Reporting archaeology of the same date.
**Analysis:** the Financial & Operational Analysis Layer and Analysis UI / Persona Analytics are REQUIRED (#192) —
[`ANALYSIS_LAYER_ARCHITECTURE.md`](ANALYSIS_LAYER_ARCHITECTURE.md); this model's facts are their source of truth.
**Implementation status:** the foundation layer only — §13 and §21 step 1–2, local. Nothing is routed, granted or activated.

---

## 1. Product model

Finance is a **company-scoped operational subledger that consumes governed business events**. It does not drive the
workflows. The business domains own their workflows and emit events; Finance only receives them.

```
OPERATIONAL EVENT (Commercial / Service / Inventory / Purchasing / Rental — they own the workflow)
 → OPERATING COMPANY        resolved from the originating record's governed ownership; fail closed
 → COMMERCIAL RELATIONSHIP  disposition: direct sale, Saratoga-financed sale, rental, service-only, intercompany, vendor purchase
 → FINANCIAL CONSEQUENCE    an immutable financial fact (amount, basis, idempotency key)
 → FINANCIAL COUNTERPARTY   who owes / is owed — never assumed to be the customer
 → EOS FINANCIAL RECORD     facts → obligations → derived balance
 → ACCOUNTING DESTINATION   per-company outbox → provider adapter → acknowledgement
 → RECONCILIATION           EOS obligation ⇄ provider status
 → REPORTING                company-scoped projections; CONSOLIDATED = a projection over company records
```

Rules:

1. Domains emit events; Finance never reaches into a workflow. Work Order completion, fulfillment and rental return
   emit events; they never post a consequence themselves.
2. Every fact has exactly one operating company and, where one applies, exactly one counterparty. If either cannot be
   resolved, the fact is refused.
3. Facts are append-only. Statuses (billing, funding, acknowledgement, reconciliation) are separate mutable records,
   and they are never the financial truth.

## 2. Operating-company model

- Every fact, obligation, package and destination carries exactly one `operating_company_id`. It is resolved through
  the governed company and key binding, never entered by hand.
- **Correction #2 — governed ownership, not location:** the company comes from the *governed inventory or transaction
  ownership authority*:
  - the Sales Order's selling company;
  - the Work Order's company;
  - the Purchase Order and receipt's purchasing company;
  - the Rental Agreement's fleet owner;
  - each side's own record for an intercompany transaction.
- Physical location never decides ownership (#190 §5). Location–company consistency may be *validated*, never
  *inferred*.
- **Fails closed** when: no company resolves; the company is unknown or inactive; or the record would be attached to
  "CONSOLIDATED".
- Reporting projections are TAYLOR, VENTANA and CONSOLIDATED, each permission-scoped. CONSOLIDATED is computed at query
  time with intercompany pairs eliminable, and is never stored as a record.

## 3. Counterparty model

A **financial counterparty** is a governed party that can owe or be owed. It points at an existing identity rather
than duplicating one.

| Kind | Backing identity |
|---|---|
| EXTERNAL_ORGANIZATION | `eos_crm.accounts`, whose relationships are CUSTOMER / VENDOR / FINANCING_PROVIDER |
| INTERNAL_OPERATING_COMPANY | `eos_policy.tenant_operating_companies` (Taylor and Ventana are never CRM Accounts merely to be counterparties) |

- The supplier master (`eos_ops.suppliers`) is the operational vendor *profile* of an organization, **linked** to its
  CRM Account. It is not removed.
- The **counterparty-by-company profile** holds what differs per operating company for the same organization: payment
  terms, accounting reference and status.
- Required relationships:
  - customer owes Taylor or Ventana;
  - Saratoga owes Taylor (FUNDING_RECEIVABLE);
  - Taylor owes Ventana, which appears as two linked records (INTERCOMPANY_PAYABLE / INTERCOMPANY_RECEIVABLE);
  - Taylor or Ventana owes a vendor (PAYABLE);
  - a dealer owes Ventana;
  - a Taylor customer receives the Equipment while Saratoga owns the obligation.

## 4. Commercial disposition model

Disposition is an explicit attribute of the originating commercial record. It is never derived from location, custody,
installation or Work Order completion.

| Disposition | Originating record | Ownership effect | Receivable behaviour |
|---|---|---|---|
| DIRECT_SALE | Sales Order | Transfers on governed fulfillment (timing is policy) | Customer receivable |
| SARATOGA_FINANCED_SALE | Sales Order + Financing Relationship | **UNRESOLVED PENDING OWNER BUSINESS CONFIRMATION** (correction #1) — never inferred | Funding receivable from Saratoga for the financed amount; customer receivable only for any customer-paid portion |
| RENTAL | Rental Agreement | Never transfers (Taylor keeps ownership) | Recurring rental receivable |
| SERVICE_ONLY | Work Order | None | By billing responsibility (§8) |
| INTERCOMPANY_SALE | Ventana Sales Order ↔ Taylor Purchase Order | Ventana → Taylor on receipt | Ventana receivable / Taylor payable, linked by correlation |
| VENDOR_PURCHASE | Purchase Order | Vendor → company on receipt | Company payable |

For a Saratoga-financed sale, COMMERCIAL CUSTOMER = the customer and FINANCIAL OBLIGOR = Saratoga.

## 5. Operational financial event catalog

⚖ marks an item that needs an Owner policy input before the event is recognized. Every event's idempotency key is
built from the source record, the event and the line. Corrections are always new reversing or replacement facts (§15).

| Source | Event | Company | Counterparty | Consequence | When |
|---|---|---|---|---|---|
| Commercial | Opportunity | — | — | none (forecast) | — |
| Commercial | Agreement accepted | Seller | Customer | none financial (commercial commitment terms) | — |
| Commercial | Sales Order confirmed | Seller | Customer / Saratoga | **COMMITMENT fact** (correction #4: not revenue, receivable or posting) | Confirm |
| Commercial | Line fulfilled | Seller | Customer / Saratoga | billing-eligibility fact | Governed fulfillment write-back |
| Commercial | Equipment line fulfilled | Seller | Customer / Saratoga | eligibility + equipment cost relief ⚖ | Fulfillment |
| Service | Equipment installation | Work Order company | Billing responsibility | install charge eligibility (if billable) + unit cost relief ⚖ | Install transaction |
| Service | Labor | Work Order company | Billing responsibility | labor cost (cost rate ⚖) + billable eligibility | Labor entry / correction |
| Service | Parts / truck consumption | Work Order company | Billing responsibility | parts cost (§10) + billable eligibility | Consumption movement |
| Service | Work Order completion | Work Order company | Billing responsibility | closes job-cost accumulation; emits a billing-eligibility summary; **never itself a posting** | Completion |
| Rental | Start / period / return | Taylor | Rental customer | start; period charge eligibility ⚖; return and damage eligibility ⚖ | Per agreement |
| Purchasing | Purchase Order | Purchaser | Vendor / internal company | **COMMITMENT fact** (correction #4: not an expense, payable or posting) | PO record |
| Purchasing | Receipt | Purchaser (governed transaction company) | Vendor / internal company | priced: acquisition-cost fact; unpriced: **COST_EVIDENCE_MISSING exception** (correction #3); vendor obligation eligibility | Receipt |
| Inventory | Adjustment / cycle count | Owning company (governed) | — | quantity-variance value ⚖ | Reconcile approve |
| Inventory | Transfer / relocation | Same company | — | none (custody / location only) | — |
| Intercompany | Ventana sale ↔ Taylor purchase | Each side | The other company | two facts, linked by correlation id | Fulfillment / receipt |
| Finance | Payment / funding confirmation | Recipient company | Payer | settlement fact against an obligation | Recorded / imported |

## 6. Sales / billing flow (direct sale) — billing authority (#191)

1. Agreement → Sales Order → **Commercial fulfillment authority**.
2. Fulfillment creates billing-eligibility facts.
3. EOS assembles the **operational billing package**, which EOS owns as the authoritative package. It states: billable
   items, operating company, counterparty, originating transaction, quantities, prices, eligible charges, supporting
   references and readiness.
4. The package goes to the company's accounting outbox.
5. The **external accounting authority** creates and posts the formal invoice, assigns its document reference and owns
   GL treatment.
6. EOS keeps: facts, package, status, provider reference, acknowledgement, settlement status and reconciliation status.

**DQ-015 end state.** Work Order completion writes fulfillment quantities through the Commercial fulfillment authority
in the same transaction. Billing eligibility derives from that fulfillment, never from completion. **Implemented locally,
2026-10-02 (#195)**: `sales_order_fulfillments` plus the derived `sales_order_line_billing_eligibility`. UAT:
`UAT_FIN_COMMERCIAL.md`.

## 7. Saratoga flow

1. The Sales Order carries financing method SARATOGA, which creates a **Financing Relationship** (Commercial-owned).
   It records: provider, application reference, financed amount, customer-paid amount, deposit, financing status and
   funding status.
2. Fulfillment produces a **funding package**, not a customer invoice, for the financed amount. The obligor is
   Saratoga; customer, Equipment and site are retained as references.
3. Any customer-paid portion follows the ordinary receivable path.
4. Funding confirmations are settlement facts against the FUNDING_RECEIVABLE. Reconciliation follows.
5. Title, approval workflow, funding timing and conditions, partial financing and cancellation stay **UNRESOLVED** and
   are tracked at status level only until the business confirms them.

## 8. Service financial model

| Layer | Content | Owner |
|---|---|---|
| Operational fact | labor minutes by type, parts quantity, travel, equipment installed (exists today) | Service |
| Pricing | labor sell rate, parts sell price, equipment, travel and miscellaneous charges | price policy ⚖ |
| Cost | labor cost rate, parts cost basis (§10), equipment cost | Finance cost model |
| Billing responsibility | CUSTOMER_PAY, WARRANTY (vendor-paid), CONTRACT_COVERED, RENTAL_COVERED, INTERNAL; may vary per line | Work Order |

Cost always accrues to the job, so covered work still has a margin. Nothing assumes the customer pays.

## 9. Rental financial model

- **The Rental domain owns the workflow:** agreement, assignment, term, rates, frequency, delivery and installation,
  service coverage, swap, damage, pickup, extension, return and utilization.
- **Finance consumes the domain's events:** start and stop facts, period and one-time charge eligibility, rental
  service cost (RENTAL_COVERED Work Orders) and the fleet asset's cost basis.
- **Rental margin** = revenue − service, delivery and pickup cost, optionally less depreciation ⚖.
- Taylor keeps ownership while the Equipment is deployed.

## 10. Inventory cost model

- **Operational cost evidence (EOS-owned, exists today):** acquisition cost per priced receipt line, company-scoped and
  append-only.
  - Specific cost carries onto serialized units.
  - Parts use a labelled operational cost estimate for margin.
  - Landed cost can be added as further evidence lines.
- **Unpriced receipts:** a COST_EVIDENCE_MISSING exception, never a zero cost (correction #3).
- **Accounting valuation (weighted average, FIFO, standard, formal COGS) is not selected** ⚖. The dormant cost engine
  is not a policy. Job, equipment and rental margin work from operational evidence alone, and every figure is labelled
  with its basis.

## 11. Intercompany model

- An **intercompany transaction** is a correlation record linking the Ventana Sales Order and the Taylor Purchase Order.
  It is not a financial record.
- **Ventana side:** sale and intercompany receivable.
- **Taylor side:** purchase, receipt, acquisition cost and intercompany payable.
- Mismatches between the two sides go to an exception queue. The consolidated view can eliminate each pair.
- **A Ventana sale plus a Taylor installation** on the same serial number are two unrelated chains that share only a
  reference.

## 12. Purchasing model

- **Smallest subledger:**
  - PO commitment (COMMITMENT fact);
  - receipt;
  - acquisition-cost evidence, or the missing-cost exception;
  - vendor obligation from receipt (received-not-invoiced);
  - payable consequence to the company's outbox;
  - provider bill / payment status reconciled back.
- **PO price is not universally mandatory** (correction #3, deferred policy).
- Full AP (bill entry, three-way match workflow, payment runs) belongs to the accounting provider unless the Owner says
  otherwise.

## 13. Financial record model (PostgreSQL)

**Foundation implemented** (migration `1764420000000`, `functions/src/eosFinance/financeFoundation.ts`):

| Record | Purpose | Mutability |
|---|---|---|
| `eos_finance.financial_counterparties` | EXTERNAL_ORGANIZATION → CRM Account, or INTERNAL_OPERATING_COMPANY → company; one per identity | immutable identity |
| `eos_finance.counterparty_company_profiles` | per-company terms, accounting reference, status; never self | mutable profile |
| `eos_finance.financial_facts` | immutable facts: company (never CONSOLIDATED), counterparty, class (COMMITMENT / COST_EVIDENCE / OBLIGATION / SETTLEMENT), type, source domain / record / line, minor-unit amount, currency, basis, effective time, idempotency key + fingerprint, reverses / corrects links, correlation id, reason, audit | append-only |
| `eos_finance.obligations` | RECEIVABLE / PAYABLE / FUNDING_RECEIVABLE / INTERCOMPANY_RECEIVABLE / INTERCOMPANY_PAYABLE; one company, one counterparty, fitting kind | status only |
| `eos_finance.obligation_balances` (view) | originated / settled / outstanding derived from facts | derived |
| `eos_finance.cost_evidence_exceptions` | COST_EVIDENCE_MISSING per unpriced receipt line | append-only |
| `eos_finance.accounting_destinations` | provider-neutral, per company, at most one active; no credential | mutable config |
| `eos_crm.account_relationship_types` | + FINANCING_PROVIDER | — |
| `eos_ops.suppliers.crm_account_id` | supplier profile → organization | — |

**Later packages:** billing packages and lines, intercompany transactions, accounting outbox and acknowledgements,
reconciliation items, Financing Relationship (Commercial).

**Existing structures:**

| Structure | Disposition |
|---|---|
| `inventory_acquisition_costs` | KEEP (adapter projects facts from it; it remains the single source of the cost) |
| `invoices` / `invoice_lines` / `invoice_totals` (0 rows) | ADAPT into billing packages, or SUPERSEDE |
| `payments` / `payment_applications` / views (0 rows) | SUPERSEDE by settlement facts (keep the over-application idea) |
| PO and commercial price columns | KEEP (inputs) |
| `finance.*` PostgreSQL capabilities | ADAPT when the first Finance transport is routed |

## 14. Accounting integration boundary

```
financial facts → billing / funding / payable package → accounting outbox (company destination)
  → provider adapter (provider-neutral contract) → acknowledgement (provider reference) → reconciliation ↔ obligation status
```

- Each company has its own destination; Taylor and Ventana never have to share. Destinations hold no credentials.
  Saratoga is a counterparty, never a destination.
- **EOS keeps after acceptance:** facts, packages, provider reference, obligation and settlement status — enough to
  explain and re-reconcile any transaction without the provider's GL.

## 15. Correction / reversal model

| Action | Mechanism |
|---|---|
| Void | package / obligation VOID status + reversing facts (before acceptance) |
| Reverse | an equal-and-opposite fact, `reverses_fact_id`, at most once per fact |
| Correct | reverse + replacement fact (`corrects_fact_id`), same company / class / currency / source record |
| Replace / reissue | a new package referencing the replaced one |

Every correction keeps the original fact, the reversing fact, the replacement where there is one, the source
operational record and the reason. Operational corrections drive financial ones. Approval thresholds are deferred.

## 16–17. Workspaces

- **Finance / Accounting:** one exception-first workspace answering:
  - what needs attention;
  - what is ready for accounting;
  - what failed;
  - what doesn't reconcile;
  - what is awaiting payment or funding;
  - what we owe;
  - what needs review.
  Every row drills down to its source record.
- **Owner / GM:** a company-switchable view (Taylor | Ventana | Consolidated) of:
  - sales by disposition;
  - cost and margin, labelled with their basis;
  - outstanding amounts, including from Saratoga;
  - rental utilization and margin;
  - Saratoga-financed volume.
- **Sales:** financial clearance, Saratoga approval and funding, fulfillment readiness.
- **Service:** who pays, billable or covered, job cost.
- **Parts / purchasing:** what was bought, its cost, receipt, reconciliation.

## 18. Reporting target

All families except Rental, Operating Company and Consolidated are real-time; those three are daily.

| Family | Question | Source of truth | Dimensions | Measures | Drill-down |
|---|---|---|---|---|---|
| Sales | what sold, how financed | SO + fulfillment facts | company, channel, disposition, salesperson, customer | booked, fulfilled, financed, margin | SO → line → unit |
| Service | job earnings / cost | WO + labor / parts facts | company, type, responsibility, technician | hours, cost, billable, margin | WO → entries |
| Inventory | holdings / movement | ledger + cost evidence | company, location, part | quantity, estimated value, variance | part → movements |
| Purchasing | bought / owed | PO, receipts, obligations | company, vendor | committed, received, owed | PO → receipt |
| Rental | fleet performance | rental facts | company, equipment, customer | utilization, revenue, margin | agreement → periods |
| Finance | open / reconciled | obligations, outbox, reconciliation | company, counterparty, age | open, aged, failed, mismatched | obligation → facts |
| Operating company | Taylor vs Ventana | all above | company | revenue, margin, owed / owing | → family |
| Consolidated | group | union of company projections (intercompany eliminable) | company | same | → company |

## 19. Legacy disposition

| Item | Disposition |
|---|---|
| Firebase finance reads (`listFinancialFacts`, `listAccountInvoiceAr`) | REPLACE with PostgreSQL obligation reads → RETIRE |
| Firebase invoice / payment commands | RETIRE (they read retired Firestore Sales Orders) |
| Firebase adjustments / refunds | RETIRE → §15 |
| `finance.visibility.*` | REPLACE with PostgreSQL company / consolidated visibility |
| PostgreSQL invoices / payments | ADAPT / SUPERSEDE (§13) |
| Acquisition costs | KEEP |
| Cost engine | DEFER (valuation policy ⚖) |
| Margin engine | REPLACE with operational-basis margin |
| Forecasting | DEFER |
| Billing queue | REPLACE with eligibility-driven packages |
| Financial policy profile | DEFER |
| Report Builder / Saved Reports | KEEP the concept; REPLACE the Firebase backend later |
| Dashboard financial tiles | REPLACE with the Owner / GM view |

## 20. Deferred Owner policy (do not block the foundation — #191)

These are configuration and product decisions for later activation windows:

- **Service billing policy:** rates, minimums, travel, warranty / contract / rental coverage, who pays for Taylor
  service on Ventana-sold equipment.
- **Rental billing rules:** frequency, advance or arrears, proration, minimum term, damage, depreciation in margin.
- **Inventory margin cost basis.**
- **Saratoga workflow / title details:** approval, funding timing and conditions, partial financing, cancellation,
  title.
- **Tax source.**

The customer-invoice authority question is **answered** by #191: EOS owns the operational billing package; the
accounting authority posts the formal invoice.

## 21. Implementation sequence

1. **Foundations** — counterparties, company profiles, supplier link, FINANCING_PROVIDER. *Implemented locally.*
2. **Facts / obligations / corrections core**, plus the acquisition-cost adapter (cost evidence and missing-cost
   exceptions), plus the provider-neutral destination shape. *Implemented locally — not routed.*
   - **Finance Activation 1 (2026-10-01):** the Reorder receipt (`receiveReorderStock`) now records its Finance
     consequence in the receipt's own transaction (cost evidence → one COST_EVIDENCE fact, or a COST_EVIDENCE_MISSING
     exception). It adds no route, capability or grant. `recoverReceiptFinancialConsequences` is the governed recovery
     path. UAT: `UAT_FIN_PURCHASING.md`.
   - **Activation 1 completion (2026-10-01, #193):** purchase orders now carry explicit supplier identity
     (`EXTERNAL_ORGANIZATION` or `INTERNAL_OPERATING_COMPANY`, buyer and seller stated), and the counterparty resolves only
     from that identity. The governed receipt correction (`correctReorderReceipt`: VOID / CORRECTED) uses compensating
     movements plus Finance reversal and replacement. Receipt correction ≠ vendor return.
3. Purchasing subledger: vendor obligations from receipts; received-not-invoiced.
4. Commercial fulfillment authority (resolves DQ-015) → billing eligibility.
5. Billing packages + accounting outbox + the provider-neutral adapter contract. *Billing packages implemented (#196, nonprod-proven); READY → EOS operational receivable, tax evidence and the provider-neutral accounting handoff record implemented locally (#197); delivery adapter pending.*
6. Saratoga Financing Relationship + funding package (status level until mechanics are confirmed).
7. Service cost and billing responsibility (after the service billing policy).
8. Intercompany pairing.
9. Rental domain (after the rental billing rules), then rental financial consumption.
10. Finance workspace, Owner/GM view and reporting; then retire Firebase finance and `finance.visibility.*`.
