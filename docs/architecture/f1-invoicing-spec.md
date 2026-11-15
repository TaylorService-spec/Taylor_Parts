# F-1 — Invoicing, adjustments, refunds and reporting on EOS: specification and Owner decisions

**Status:** DECISION DOCUMENT. Nothing in this spec is built. No command, table, migration, capability or grant is created by it.
**Issued:** 2026-10-20 (America/Phoenix) · **Lane:** F (Finance) · **Base:** `origin/main` `b3d09dc3` (contains `09a82d3e`) · **Companion:** F-2, PR #2168 (the read side).
**Authority:** the Owner rulings "invoicing: Build it now" and "no workflow may disappear because its Firebase implementation is retired"; commercial sequence item 1, *Finance invoicing, credits, refunds and reporting*. Replacement-matrix rows `issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund`, `listAccountInvoiceAr`; plan rows F1 and F2; B5 acceptance matrix stage 11. Evidence file for the holder tables: [`f1-invoicing-holder-parity.json`](f1-invoicing-holder-parity.json).

**How to read this.** Section 1 says what exists. Section 2 is the recommended design, written so that the Owner's answers change a clause, not the shape. Section 3 is the numbered **OWNER DECISION** list (each with options and one recommendation). Implementation waits for the answers; sections 4–6 say what will be built, in what order, and which pins move.

---

## 0. Summary for the Owner

- **Firebase invoicing was never exposed to users.** `issueInvoice`, `applyPayment`, `recordInvoiceAdjustment`, `recordRefund` are callables behind registered-but-inactive capabilities; the two screens (`FinancialsBillingQueue.jsx` "Create Invoices", `FinancialsCreditsAdjustments.jsx` "New Correction") have their buttons disabled. Only operator seed scripts have ever called them. So F-1 is not a port of a working workflow; it is the first time anyone can invoice. That is why the choices below are real choices.
- **EOS already holds the money, differently.** EOS opens a *receivable obligation* when a billing package is READY (DECISIONS #197) and records cash as *settlements* applied to obligations. It has no invoice document, no invoice number in use, no credit/debit/write-off and no refund. The Firebase model applies payments to *invoices*.
- **The four questions that decide the shape:** how an invoice relates to the obligation (OD-F1-2), whether cash lives in settlements or in a second payments model (OD-F1-3), whether adjustments and refunds need a second person (OD-F1-1, OD-F1-4), and who owns the formal invoice and its number now that the Owner has said to build it (OD-F1-5).
- **No new grant is needed for Firebase parity.** All four write keys are already registered in EOS with the Firebase holders, except Parts Manager (revoked on purpose, #193). New keys appear only if the Owner chooses approval steps or a void action (Section 2.9).
- **Recommended answers, in one line each:** see Section 3.

---

## 1. What exists today (evidence)

### 1.1 Firebase (Firestore + callables) — never user-facing

| Piece | Source | What it does |
|---|---|---|
| Issue | `functions/src/finance/invoiceCallables.ts` + `invoiceCommands.ts` | Capability `finance.invoice.issue` (registered `active:false`). Transaction: read the governed Sales Order, cross-check account, currency, company, per-line committed `unitPrice` and billing-eligible quantity (`min(ordered, fulfilled) − billed`), recompute every amount server-side from one shared derivation (`eosOps/invoiceTotals.ts`), allocate a per-company number `INV-######` (`invoiceNumbering.ts`), write the immutable `ISSUED` invoice with a frozen FIN-002 attribution snapshot, add `billedQty` to the Sales Order lines, stage an audit event; idempotent through a deterministic audit id. Requires `billingAction: BILL_NOW`, a caller-supplied `dueDate`, and an explicit tax per line (absent tax = `TAX_REQUIRES_REVIEW`, never zero). **Partial billing is supported** (any subset of eligible quantity, many invoices per order). |
| Adjust | `adjustmentCallables.ts` + `adjustmentCommands.ts` | `finance.adjustment.record`. Types `CREDIT_MEMO`, `DEBIT_CHARGE`, `WRITE_OFF`. Never rewrites the invoice; an explicit linked record plus a maintained projection (`outstanding = total − applied − credits + charges − writeOff`). Credit and write-off may not exceed outstanding; debit has no cap; reason and effective date required; refused on a VOID invoice. **No approval step.** |
| Pay | `paymentCallables.ts` + `paymentCommands.ts` | `finance.payment.apply`. One receipt applied to **one invoice**; over-application refused (no unapplied balance); state `ISSUED → PARTIALLY_PAID → PAID`. Receipt and application are separate records. |
| Refund | `refundCallables.ts` + `refundCommands.ts` | `finance.refund.record`. Reverses applied payment on an invoice (cannot exceed `applied`), reopens the invoice (`PAID → PARTIALLY_PAID → ISSUED`). Money is *recorded* as returned; no disbursement evidence is created. **No approval step.** |
| Approval machinery | `financialApprovals.ts`, `docs/financials/FIN-007_APPROVAL_GOVERNANCE_MODEL.md` | Pure and **dormant**: action types `INVOICE_ADJUSTMENT`, `WRITE_OFF`, `REFUND`, `PLAN_APPROVAL`, `ATTRIBUTION_CORRECTION`; fail-closed (no policy line = approval required); self-approval forbidden under any policy; an approval states an amount ("approving 100 is not approving 150"); a rejection is terminal. **No callable composes it. Policy values (which actions, thresholds, who approves, expiry) are undecided by the Owner.** |
| Reads | `financeReadCallables.ts`, `financialReportingRead.ts` | `listAccountInvoiceAr`, `listFinancialFacts` (INVOICE, PAYMENT_RECEIPT, PAYMENT_APPLICATION). Served from EOS since F-2 (PR #2168) with the receivable obligation standing in for the invoice. |
| Data | Firestore `invoices`, `payments`, `payment_applications`, `invoice_adjustments`, `refunds` | Appear only from operator fixtures; the production count is **unverified** (the callable is inactive). Any real invoices would carry `INV-######`. |

### 1.2 EOS (PostgreSQL) — what is built and what is not

| Piece | State |
|---|---|
| `eos_finance.invoices`, `invoice_lines`, view `invoice_totals` (migration `1758931200000`) | **Tables exist, unwired.** Header (company key, number, account, **Sales Order**, currency, due date, issued_at/by, tax provenance, void columns), lines with GENERATED amounts, totals view. Repository `eosOps/invoiceAuthority.ts` (`insertIssuedInvoice`, `readInvoiceTotals`); arithmetic `eosOps/invoiceTotals.ts`. **No link to an obligation. No adjustment, refund or counter table.** |
| Number allocator `eosFinance/invoiceNumberAllocator.ts` | **Prepared, not wired.** `INV-YYYY-######`, per (tenant, company key, UTC year); the counter table `eos_finance.invoice_number_counters` is **in no migration** (Owner ruling 4, 2026-10-17: preparation only). Legacy `INV-######` read, never produced. |
| `payments`, `payment_applications`, views `payment_balances`, `invoice_application_totals` (migration `1759017600000`) | **Tables exist, unwired.** A second cash model that applies receipts to *invoices* (composite FK on `(tenant, invoice, currency)`), with `eosOps/cashApplicationAuthority.ts`. |
| Receivable obligation `eos_finance.obligations` + `financial_facts` + view `obligation_balances` | **Live.** A READY billing package opens one RECEIVABLE obligation for the package total (#197); balances are derived (`originated = Σ OBLIGATION-class facts`, `settled = Σ SETTLEMENT-class facts`); status `OPEN/PARTIAL/SETTLED/VOID` is a projection. |
| Billing package `eosFinance/billingPackage.ts` | **Live.** Created only for a Sales Order that is eligible **in full** (partial-billing policy deferred) and a direct-sale disposition; tax only when the Agreement's tax is DETERMINED; exceptions TAX_NOT_DETERMINED, PRICE_EVIDENCE_MISSING, UNSUPPORTED_FINANCIAL_OBLIGOR, ACCOUNTING_DESTINATION_MISSING. States the package is *not an accounting invoice* (#191 §5). |
| Accounting handoff `accounting_handoffs`, `accountingDelivery.ts` | **Live up to delivery.** One provider-neutral record per READY package and receivable; provider document reference / acknowledgement columns exist and are empty. Nothing is sent. |
| Settlements `eosFinance/settlement.ts`, `/operations/finance` | **Live.** `recordSettlement`, `applySettlement` (many-to-many, partial, over-application refused twice), `reverseSettlementApplication`, `voidSettlement`, `reconcileSettlement`; keys `finance.settlement.record/apply/correct`, `finance.reconciliation.record`. Company reach by explicit assignment (`financeCompanyAccess.ts`); a restricted reader is refused every settlement command. |
| Reads `readFinanceOverview`, `listObligations`, `readObligation`, `listSettlements`, `readSettlement`, `readAccountBalanceSummary` | **Live** (F-2 adds the payment fact families, the Sales Order reference and the account narrowing). They show *receivables*, never an invoice number or an issue date (MD-B1-1, MD-B1-2). |
| Capabilities | `finance.invoice.issue`, `finance.adjustment.record`, `finance.payment.apply`, `finance.refund.record` are **registered** (migration `1761609600000`) with the Firebase holders (Section 2.9). They guard no operation. |

### 1.3 What a user can do today

Nothing in either system lets a person issue an invoice, record a credit, write off a balance or refund a customer. EOS lets Finance record and apply cash to an obligation and shows receivables; it does not let anyone correct the amount owed.

---

## 2. Recommended design

Each clause below is the recommendation; the OD number says which Owner answer it depends on. If the Owner picks another option the clause is replaced, and Section 5 is re-cut.

### 2.1 One receivable, one invoice document (OD-F1-2, OD-F1-5)

The **obligation stays the single source of "money is owed"** (#197). An **invoice is the customer-facing document issued against it**, 1:1 with a receivable obligation, carrying the number, issue date, due date, lines and tax. There is **no second AR book**: invoice outstanding is *read from* the obligation balance, never stored on the invoice.

- `eos_finance.invoices` gains `obligation_id` (NOT NULL, UNIQUE per tenant): an invoice names exactly one receivable, in the same company and currency, and the total of its lines must equal the obligation's originated amount (the database refuses a mismatch).
- **Sequence for a Sales Order billed in full:** fulfillment → eligibility → READY billing package → EOS receivable (today, unchanged) → **issue invoice** (new: attaches the document, allocates the number, freezes lines and tax from the package, writes `INVOICE_ISSUED` evidence) → accounting handoff carries the invoice number as the document it is delivering → provider acknowledgement stores the provider's reference separately.
- The invoice does **not** re-derive prices: its lines are the package lines (the package already froze price, tax evidence and eligibility). The Firebase cross-check against the Sales Order is therefore replaced by "the package is READY and unsuperseded".
- A superseded package's receivable is voided today (#197 §2); the invoice cannot be issued against a voided receivable, and a package cannot be superseded once its invoice is issued (the correction path is a credit memo, 2.3).

### 2.2 Numbering (OD-F1-5)

EOS issues the number: `INV-<YYYY>-<######>` per (tenant, company key, UTC year), in the issuing transaction (the allocator is already written to this policy). Firebase `INV-######` numbers are carried verbatim if any are ever copied (OD-F1-12). The accounting provider's own document reference, when the later delivery package exists, is stored as `provider_document_reference` on the handoff and **never replaces** the EOS number.

### 2.3 Adjustments (OD-F1-1, OD-F1-4, OD-F1-7)

Credit memo, debit charge and write-off are **explicit linked records plus signed facts on the same obligation**; the invoice and its lines are never edited.

- New table `eos_finance.invoice_adjustments` (append-only): `type` (`CREDIT_MEMO | DEBIT_CHARGE | WRITE_OFF`), `invoice_id`, `obligation_id`, amount, currency, reason, effective date, requested_by, recorded_by, approval reference (nullable), the OBLIGATION-class fact it wrote.
- The obligation effect is an **OBLIGATION-class fact** of type `RECEIVABLE_CREDITED` / `RECEIVABLE_CHARGED` / `RECEIVABLE_WRITTEN_OFF` with a negative (credit, write-off) or positive (debit) amount. `obligation_balances` already sums OBLIGATION facts, so outstanding is correct without changing the view; the pages show **original vs adjusted** by fact type, so a credit never silently rewrites the original total.
- Firebase rules kept: credit and write-off cannot exceed outstanding; reason and effective date required; refused on a void invoice or a void obligation; an adjustment never changes the payment state; idempotent on `(actor, invoice, idempotencyKey)`.
- A write-off keeps its own gravity (FIN-007 treats `WRITE_OFF` as its own approval type). **Customer credit balances are not built** (Firebase refused them; OD-F1-10).
- **Approval:** per OD-F1-1 / OD-F1-4. The command has two modes behind one operation: *record* (when the policy says no approval is required) and *request → decide* (when it does). The recommended default is fail-closed (FIN-007's own rule): every adjustment and every refund needs a second person until the Owner sets thresholds.

### 2.4 Cash: settlements are the only cash record (OD-F1-3)

Applying cash to an invoice **is** applying a settlement to the invoice's obligation (`applySettlement`, already live: partial, many-to-many, company-isolated, restricted readers refused). The Firebase `finance.payment.apply` behaviour maps onto `finance.settlement.record` + `finance.settlement.apply` with no new operation. The unwired `payments` / `payment_applications` tables are **not activated** and are retired by a later migration (they hold no data). Reads that still say "payment receipt / payment application" (the F-2 fact families) continue to be settlements and their applications.

One real gap: Firebase refused over-application; EOS keeps the unapplied remainder on the settlement (`settlement_balances.unapplied_minor`). That is the better model (it is where a refund or a customer credit would come from) and is kept; OD-F1-10 asks whether an unapplied remainder may be refunded.

### 2.5 Refunds (OD-F1-1, OD-F1-4, OD-F1-11)

Firebase's refund *records* money returned and reopens the invoice; it creates no evidence that money left. Recommended EOS shape, as **one command, two effects in one transaction**:

1. `reverseSettlementApplication` for the amount (existing; the original is kept, the receivable reopens); and
2. a **refund record** (`eos_finance.refunds`, append-only: invoice, settlement, application, amount, reason, requested_by, approved_by, effective date) with a **disbursement settlement** of a new kind `CUSTOMER_REFUND` (direction DISBURSEMENT, to the customer) so cash-out has the same evidence as cash-in and appears in reconciliation.

The new settlement kind is a vocabulary change in the settlement core (the kind CHECK and `SETTLES` map) — hence an Owner decision, not an engineering default. A refund cannot exceed the amount applied (Firebase `EXCEEDS_APPLIED`), cannot target an unreconciled-void settlement, and is two-person by default.

### 2.6 Void (OD-F1-9)

Firebase has a `VOID` invoice state but **no command** that sets it. Recommended: a `voidInvoice` command only for an invoice with no applications and no adjustments (a mistake caught before money moves): it voids the invoice and its receivable together with a reason, requires a second person, never reuses the number, and is the only way a wrongly issued invoice leaves the book. Everything else is corrected by credit memo.

### 2.7 Reporting on `/operations/finance` (OD-F1-14)

Reads only, behind the existing keys (no new read key): `listInvoices` (number, Sales Order, issue date, due date, total, adjustments, applied, outstanding, position), `readInvoice` (lines, tax provenance, adjustments, applications, refunds, handoff status), `listInvoiceAdjustments` and `listRefunds` (the two registers the disabled Credits & Adjustments page was built to show), and the existing overview extended with *credits / charges / write-offs / refunds by period*. The F-2 envelope then fills `invoiceNumber`, `issuedAtMillis`, `salesOrderId` from the invoice instead of leaving them absent, and the EOS-native Financials pages show a number where today they show the register id. Company reach, restricted-reader rules and the credited-salesperson reach are the existing ones (`financeCompanyAccess.ts`, `financeVisibility.ts`); no read bypasses them.

### 2.8 Screens

`FinancialsBillingQueue.jsx` (Create Invoices) becomes the list of READY packages with no invoice, with the action gated on `finance.invoice.issue` **and** a Finance company assignment; `FinancialsCreditsAdjustments.jsx` (New Correction) becomes the request/approve flow and the two registers. Both keep the approved North Star composition; neither asserts a capability's activation state in copy.

### 2.9 Capabilities and the exact Firebase-parity holders

Derived read-only (Appendix A) from the compiled Firebase Role catalog and the committed EOS grant baseline; full data in `f1-invoicing-holder-parity.json`.

| Key (Firebase) | Exact Firebase holders | EOS key / state | Parity |
|---|---|---|---|
| `finance.invoice.issue` | accountingManager, admin, controller, financeManager, generalManager, owner, **partsManager** | same key, registered, same holders in the committed baseline | partsManager: the Owner-ruled REVOKE (R3, DECISIONS #193) is an Administration act and the committed baseline still lists the migration grant; confirm it was applied in nonprod; do not restore |
| `finance.adjustment.record` | accountingManager, admin, controller, financeManager, generalManager, owner, **partsManager** | same key, same | same (partsManager as above) |
| `finance.payment.apply` | accountingManager, admin, controller, financeManager, generalManager, owner | no operation; cash is `finance.settlement.record/apply/correct` (accountingManager, controller, financeManager, generalManager, owner; admin by derivation) | functionally covered; confirm admin's derived standing at build |
| `finance.refund.record` | accountingManager, admin, controller, financeManager, generalManager, owner | same key, registered, same | parity |
| `finance.read` | accountingManager, admin, controller, fieldManager, financeManager, generalManager, owner, partsAssociate, partsManager, purchasingManager, salesManager, salesperson, shopAssociate, shopManager | replaced by `finance.payment.read` / `finance.invoice.read` (same 14 in the committed baseline); `finance.accountBalance.read` (A6) gives the operational roles a summary | the nonprod live holders are narrower for the full read (matrix row `listAccountInvoiceAr`); confirm intent before the migration |
| `finance.visibility.self` | admin, owner, salesperson | same | parity |
| `finance.visibility.team` | admin, owner, salesManager | same | parity |
| `finance.visibility.businessUnit` | admin, owner | same | parity |
| `finance.visibility.company` | admin, owner | same | parity |
| `finance.visibility.consolidated` | accountingManager, admin, financeManager, generalManager, owner | same | parity |

**Conclusion: no new grant is needed for Firebase parity.** The only grants that could appear are *not* parity and are Owner decisions: an approver key for adjustments/refunds (OD-F1-1, OD-F1-4), a void key (OD-F1-9). **No such grant is proposed here.** The EOS side of this table is the committed migration baseline; the nonprod database was not read (no credential in this lane), so a live holder comparison (the A7 method) is a pre-migration step.

---

## 3. OWNER DECISIONS

Each decision is numbered, has options and **one recommendation**. "Default if unanswered" is the fail-closed choice the build would take, so silence never widens authority.

**OD-F1-1 — FIN-007 approval policy for invoices and adjustments.** Which financial actions need a second person, and above what amount; who may approve.
- A. *Everything needs approval, no thresholds* (FIN-007's own fail-closed default): invoice issue, credit/debit, write-off, refund, void.
- B. *Issue invoice needs no approval; every adjustment, write-off, refund and void does.*
- C. *Thresholds*: issue and small credits/debits free; credit/debit at or above X, every write-off, every refund, every void need approval (X per company).
- D. *No approval anywhere* (Firebase's de-facto behaviour; the dormant core unused).
- **Recommendation: B**, with write-off and refund always approved and credit/debit approval thresholds left as a later setting (C) once the Owner names X. Rationale: issuing follows the READY package, which is already a governed gate; every later change to what a customer owes is a money-moving correction.
- Default if unanswered: A.

**OD-F1-2 — Invoice ↔ obligation ↔ settlement relation.**
- A. *One receivable, one invoice document, 1:1; invoice outstanding read from the obligation; cash applied to the obligation* (Section 2.1).
- B. *Invoice creates the obligation*; the billing package stops opening receivables for invoice-billed sales (changes DECISIONS #197 §1).
- C. *Invoice and obligation independent*, linked by Sales Order (two AR books).
- **Recommendation: A.** It keeps one source of AR truth, leaves #197 intact, and lets the already-live settlement/reconciliation machinery serve invoices unchanged. C is rejected: two books will disagree.
- Default if unanswered: A.

**OD-F1-3 — Payment alignment.**
- A. *Settlements are the only cash record*; `payments` / `payment_applications` are never activated and are retired.
- B. *Activate the Firebase-style payments model* beside settlements.
- C. *Migrate settlements onto payments.*
- **Recommendation: A.** Settlements are live, company-isolated, reconciled and support partial/many-to-many application; B/C duplicate them.
- Default if unanswered: A.

**OD-F1-4 — Two-person approval for adjustments and refunds.** Does the requester differ from the approver, and who may approve?
- A. *Two-person for every adjustment, write-off and refund* (self-approval already forbidden under any policy in `financialApprovals.ts`).
- B. *Two-person for write-offs and refunds only*; credit/debit by one Finance person.
- C. *Single person* (Firebase's behaviour).
- Approver: (i) any holder of an approver key other than the requester; (ii) Owner/Admin only; (iii) a named Role (controller / financeManager).
- **Recommendation: A with approver (i)** — a new approver key per action family granted to the Finance roles that already hold the record keys (accountingManager, controller, financeManager, generalManager, owner), never to the requester. This is not Firebase parity (Firebase had no approval) and is **not granted by this spec**.
- Default if unanswered: A, approver = Owner/Admin only.

**OD-F1-5 — Who owns the formal invoice and its number.** DECISIONS #191 §5 says the external accounting authority creates the formal invoice and assigns its document reference; the Owner has now said to build invoicing in EOS.
- A. *EOS issues the invoice and its `INV-YYYY-######` number; the accounting provider's reference is stored beside it* (Section 2.2).
- B. *EOS issues only a draft/proforma; the provider's number is the invoice number* (no EOS number allocated; nothing printable until a provider is chosen).
- **Recommendation: A.** No accounting provider is selected or delivering; B would leave nothing to bill with. The handoff keeps the provider reference separate, so adopting a provider later changes nothing here.
- Default if unanswered: A.

**OD-F1-6 — Partial billing.** Firebase billed any subset of eligible quantity (many invoices per order); the EOS billing package exists only for an order eligible in full (partial-billing policy deferred, #196).
- A. *One invoice per READY package for now* (full-order billing); partial billing waits for the package policy.
- B. *Allow partial invoices* (needs a partial-billing policy on the package and a `billed` projection on Sales Order lines).
- **Recommendation: A.** It matches what EOS can bill today; B is a package/Sales Order change that should be its own decision.
- Default if unanswered: A.

**OD-F1-7 — Tax on the invoice.** Firebase required an injected per-line tax or refused issuance; EOS packages use the Agreement's DETERMINED tax evidence (#197 §3).
- A. *Invoice tax = the package's tax; unknown tax blocks issuance* (unknown ≠ zero).
- B. *Allow an Owner/Finance-entered tax determination at issue.*
- **Recommendation: A.** No tax engine, rate or jurisdiction is introduced.
- Default if unanswered: A.

**OD-F1-8 — Due date and payment terms.** Firebase takes `dueDate` from the caller.
- A. *Due date comes from the Sales Agreement / company terms; the issuer may only choose a later date with a reason.*
- B. *Issuer enters the due date freely* (Firebase).
- C. *Fixed net-N per company setting.*
- **Recommendation: A**, falling back to B (reason required) where an Agreement states no terms. Aging begins at the due date (unchanged).
- Default if unanswered: B with a reason.

**OD-F1-9 — Void an issued invoice.**
- A. *Void only an invoice with no applications and no adjustments, with a reason and a second person; otherwise credit memo* (Section 2.6).
- B. *No void command at all*; credit memo only.
- C. *Void any invoice* (reverses applications and adjustments).
- **Recommendation: A.** Needs a void key if chosen (not parity; not granted here).
- Default if unanswered: B.

**OD-F1-10 — Credit balances / unapplied cash.** Firebase refused any amount above outstanding; EOS settlements keep an unapplied remainder.
- A. *Keep refusing credit-memo amounts above outstanding; unapplied cash stays on the settlement; no customer credit balance object.*
- B. *Build a customer credit balance* (a credit above outstanding becomes a balance usable on later invoices).
- **Recommendation: A.** (Matches the open Owner policy question FIN-PQ-UNAPPLIED-POLICY.)
- Default if unanswered: A.

**OD-F1-11 — What a refund is in EOS.**
- A. *Reversal of the application + refund record + a `CUSTOMER_REFUND` disbursement settlement* (Section 2.5).
- B. *Reversal of the application + refund record only* (Firebase parity: no cash-out evidence).
- C. *Refund only from an unapplied settlement remainder.*
- **Recommendation: A**, so cash leaving has the same evidence and reconciliation as cash arriving. It adds one settlement kind.
- Default if unanswered: B.

**OD-F1-12 — Existing Firebase invoices and numbering continuity.** The production count is unverified.
- A. *Start EOS invoicing fresh; do not copy Firebase invoices* (they appear only from fixtures); the `INV-YYYY-` series begins at the first EOS issue.
- B. *Copy any real Firebase invoices* (an Owner-authorized historical copy; legacy `INV-######` kept verbatim).
- **Recommendation: A**, after the operator confirms the production invoice count is zero. A historical data copy needs its own authorization either way.
- Default if unanswered: A, and nothing is copied.

**OD-F1-13 — Holders: Parts Manager and the visibility keys.**
- A. *Keep Parts Manager revoked from issue/adjust (R3, #193); keep all other holders exactly as Section 2.9.*
- B. *Restore Parts Manager to Firebase parity.*
- **Recommendation: A** (no accepted Decision authorizes Parts Manager finance execution).
- Default if unanswered: A.

**OD-F1-14 — Reporting scope.**
- A. *The registers and invoice reads in Section 2.7 only; no new Analysis measure yet.*
- B. *Also a DSO / credit-memo-rate / write-off measure set on Analysis.*
- **Recommendation: A.** Measures wait for real invoice data.
- Default if unanswered: A.

**OD-F1-15 — Where invoice events are recorded.** EOS settlements record to `eos_finance.financial_facts`, not `audit_events`; Firebase wrote an `auditEvents` row for each invoice command.
- A. *Both*: the facts for money, and an audit event for who issued/adjusted/refunded/voided (FIN-007 requires the actor and approver on the record).
- B. *Facts only; the actor columns on the new tables are the audit trail.*
- **Recommendation: A.** Finance is sensitive/audited; the cost is one extra row per command.
- Default if unanswered: A.

---

## 4. Build slices (after the Owner's answers; none is built tonight)

1. **Migration (operator-written; see 6).** `invoices.obligation_id`; `invoice_number_counters`; `invoice_adjustments`; `refunds`; the `CUSTOMER_REFUND` settlement kind (if OD-F1-11 = A); void columns already exist. No grants (Section 2.9) unless approval/void keys are chosen.
2. **Commands on `POST /operations/finance`:** `issueInvoice`, `recordInvoiceAdjustment` (+ `requestInvoiceAdjustment` / `decideInvoiceAdjustment` if OD-F1-1/4 require), `recordRefund` (+ request/decide), `voidInvoice` (if OD-F1-9 = A). Each re-decides company reach per call, refuses a restricted reader, is idempotent on `(actor, target, idempotencyKey)` with a request fingerprint, and writes in one transaction.
3. **Reads:** `listInvoices`, `readInvoice`, `listInvoiceAdjustments`, `listRefunds`; extend F-2's envelope with the invoice fields.
4. **Client:** enable `FinancialsBillingQueue.jsx` and `FinancialsCreditsAdjustments.jsx` behind capability and company assignment; port `functions/scripts/financialReviewFixtures.mjs` to the EOS commands so the review fixture exercises the real path.
5. **Retire** the Firebase finance server files only after the operations are live and exercised (a separate destructive step needing its own approval).

## 5. Pins and tests that will move at build (for the planner, not edited now)

Baseline and MIGRATION_BACKED grant counts only if a key is granted; migration count and the six migration-count-pinning tests (+1 migration); governed nonprod replay; `FINANCE_READ_OPERATIONS` / `FINANCE_COMMAND_OPERATIONS` in `financeApiClient.js` and the server operation list; the shell capability gates if a screen action is gated; `docs/governance/precedence-sweep.json` (DECISIONS hash) and `SYSTEM_AUTHORITIES.md` (invoice canonical ownership moves). New suites: `f1InvoiceIssue`, `f1InvoiceAdjustment`, `f1Refund` (offline) and their `…Postgres` pair; client transport and screen suites. Postgres proofs required: 1:1 invoice↔obligation, total equals originated, number allocation under concurrency (no gap, no reuse after rollback), credit cannot exceed outstanding, self-approval refused, restricted reader refused, company isolation, idempotent replay writes nothing.

## 6. Migration path (the lane cannot write `functions/migrations/*.sql`)

When the Owner answers, the build lane saves the SQL as `<scratchpad>/f/<slot>_<name>.sql.txt` (slot `1764700000000` or higher, lane F range `17647000xxxxx`) and the controller writes it into `functions/migrations/`. This spec writes no SQL.

## 7. Risks and evidence limits

- **Holder comparison is against the committed baseline, not the nonprod database.** Re-run the A7 method against nonprod before any grant migration.
- **No Postgres proof of the F-2 read changes** was possible in this lane; the Postgres suites in CI are the proof.
- **The production invoice count is unverified** (OD-F1-12).
- **Service billing is out of scope** (FIN-BLOCK-002: Work Orders carry no billable facts); invoices here are Sales Order / billing-package invoices.
- **Sales attribution / commission** (F-3) is separate; invoices carry the frozen credited salesperson the package already has.

---

## Appendix A — how the holder tables were derived (read-only)

Copy of the derivation run for this spec (no repository file is written; output saved as `f1-invoicing-holder-parity.json`):

```js
// node derive.cjs <worktree>/functions   (functions/lib built from the same main)
const path = require("node:path");
const root = path.resolve(process.argv[2]);
const comp = require(path.join(root, "lib/access/compatibilityRoles.js"));
const gov = require(path.join(root, "lib/access/governedBusinessRoles.js"));
const baseline = require(path.join(root, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"));
const roles = { ...comp.COMPATIBILITY_ROLES, ...gov.GOVERNED_BUSINESS_ROLES };
const fb = {};   // finance.* key -> { role: conditions|null }   (admin and owner hold the catalog by derivation)
for (const [id, role] of Object.entries(roles))
  for (const p of role.permissions)
    if (/^finance\./.test(p)) (fb[p] ??= {})[id] = role.conditionsByPermission?.[p]?.map((c) => c.kind) ?? null;
const eos = {};  // finance.* key -> { role: source }          (migration-derived grants; not the nonprod database)
for (const g of baseline.grants) if (/^finance\./.test(g.capabilityKey)) (eos[g.capabilityKey] ??= {})[g.roleKey] = g.source;
// then per key: firebaseHolders = keys(fb[k]); eosBaselineHolders = keys(eos[k]); onlyFirebase / onlyEos = the set differences.
```

## Appendix B — decision index

| # | Decision | Recommendation |
|---|---|---|
| OD-F1-1 | FIN-007 approval policy | B: issue free; adjustments, write-offs, refunds, voids approved |
| OD-F1-2 | Invoice ↔ obligation ↔ settlement | A: 1:1 document on the obligation; cash on the obligation |
| OD-F1-3 | Payment alignment | A: settlements only; payments tables never activated |
| OD-F1-4 | Two-person for adjustments/refunds | A: two-person for all, approver key for Finance holders |
| OD-F1-5 | Owner of the formal invoice/number | A: EOS issues `INV-YYYY-######` |
| OD-F1-6 | Partial billing | A: one invoice per READY package |
| OD-F1-7 | Tax on the invoice | A: package tax; unknown blocks |
| OD-F1-8 | Due date / terms | A: Agreement terms, later date needs a reason |
| OD-F1-9 | Void | A: only before money moves, two-person |
| OD-F1-10 | Credit balances | A: none; credit capped at outstanding |
| OD-F1-11 | What a refund is | A: reversal + record + `CUSTOMER_REFUND` disbursement |
| OD-F1-12 | Existing Firebase invoices | A: start fresh after confirming zero |
| OD-F1-13 | Parts Manager and other holders | A: keep Parts Manager revoked |
| OD-F1-14 | Reporting scope | A: registers and invoice reads only |
| OD-F1-15 | Audit record | A: facts and an audit event |
