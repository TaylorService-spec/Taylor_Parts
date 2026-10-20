# Q-1 PR 2: the quote and approval specification

**Issued:** 2026-10-20 (America/Phoenix) · **Base:** `origin/main` b3d09dc3 · **Lane:** Q-1 · **Status:** SPECIFICATION ONLY. Nothing here is built, migrated, granted or deployed. Every material choice is a numbered **OWNER DECISION** with options and a recommendation; until the Owner rules, the recommendation is a proposal, not a plan of record.

**Why this exists.** B5 acceptance matrix, stage 6: "Quote object; quote/discount approval workflow: MISSING (hard authority refusal only), BLOCKED, lane Q-1". Commercial scenarios A (retail sale: customer, **quote**, order, ...) and E (sales exception: **quote revision, declined approval, cancellation**, unavailable inventory, corrections) cannot pass without it. PR 1 (#2169) gave every Commercial and CRM command an audit row; this document specifies the rest.

**Sources read.** Firebase: `functions/src/index.ts` (the exported Agreement commands), `salesAgreement/*`, `access/{permissionCatalog,compatibilityRoles,governedBusinessRoles}.ts`. EOS: `eosCommercial/commands/*`, `eosCommercial/reads/salesAgreementReadProjection.ts`, `salesAuthority/salesDiscountAuthority.ts`, `eosFinance/billingPackage.ts`, migrations `1759449600000`, `1764500000000`. Records: DECISIONS #121, #134, #203, #204, #226, ND-14 and ND-15 (`docs/design/north-star-open-product-decisions.md`), `docs/assessments/core-transaction-actionability-audit.md`, `docs/implementation-plans/sales-agreement-north-star.md`. Holder evidence: [`q1-quote-parity-2026-10-20.json`](q1-quote-parity-2026-10-20.json).

---

## 1. What exists today (read from the code, not recalled)

### 1.1 Firebase

- **There is no quote object, no quote code and no approval code.** A case-insensitive word search for quote/quotes/quoting over `functions/src` and `field-ops-app-vite/src` finds only: the Opportunity stage name `QUOTING`, comments saying "EOS has no quote object" (`opportunityNorthStar.js`), CSV-parsing prose, and the governed-role note that "quote ... capabilities are a recorded permission-catalog gap". The quote *equivalent* is the **Sales Agreement**, which the lifecycle file itself calls "the Taylor signed Sales & Security Agreement" (Owner Decision 2, core-transaction audit gap 2).
- **Three Agreement commands only:** `createSalesAgreement`, `updateSalesAgreementDraft`, `acceptSalesAgreement` (`salesAgreement.create / .updateDraft / .accept`). No decline (ND-14), no revise, no cancel/withdraw (ND-15).
- **No discount and no approval in Firebase.** The only balance-reducing fields were a down payment and a bare, client-stated `tradeInMinor`. Discount, discount authority and trade-in approval are EOS additions (DECISIONS #203/#204, 2026-10-02/03).
- **Firebase holders (compiled catalogs):** create/updateDraft: admin, dispatcher, generalManager, owner, salesManager, salesperson. accept: admin, dispatcher, generalManager, salesManager, salesperson (the Owner Role does **not** hold accept). All flat, none scoped or conditioned.

### 1.2 EOS today (the path the Owner asked to rebuild in EOS)

| Topic | What the code does | Where |
|---|---|---|
| Object | `eos_commercial.sales_agreements`, numbered `SAG-YYYY-######`, ONE per Opportunity (`sales_agreements_one_per_opportunity`) | migration `1759449600000`; `salesAgreementCommandService.ts` |
| States | `DRAFT`, `ACCEPTED`, `DECLINED`. Accepted and declined are terminal. **Nothing produces DECLINED** (ND-14). No withdraw state. | `salesAgreementLifecycle.ts` |
| Edit | DRAFT only, by `updateDraft`: lines, charges, tax evidence, customer discount, trade-in proposals, terms. No history: only the audit row (PR 1) records what changed. | `updateSalesAgreementDraft` |
| Price rules | Accept needs every line priced (`UNPRICED_LINE`). Totals are computed on read, never stored. | `buildAcceptSalesAgreement`, `computeAgreementTotals` |
| Discount | `PERCENT` (1..10000 bp) or `FIXED_AMOUNT`, stored on the Agreement. A stated discount (or a standing fixed amount whose effective percentage rose because the price fell) must be within the actor's configured maximum (`sales_discount_authorities`, per Principal, basis points). **Over the maximum = hard refusal** (`DISCOUNT_EXCEEDS_AUTHORITY`); no row = `DISCOUNT_AUTHORITY_NOT_CONFIGURED`, fail closed. DECISIONS #204 §5: "the smallest governed mechanism, since no existing approval engine fits. A user with a higher limit ... may apply it." #204 §9: "a discount-approval workflow" is **not built**. | `requireDiscountAuthority` |
| Trade-in | The only approval that exists. A salesperson **proposes** a value; `approveSalesAgreementTradeIn` / `declineSalesAgreementTradeIn` (decline needs a reason) decide it; reserved to a global `owner` / `generalManager` Role (#226). A pending proposal blocks accept (`TRADE_IN_APPROVAL_PENDING`); a changed item returns to PROPOSED. | `decideTradeIn` |
| Accept | `salesAgreement.accept` records the customer's acceptance (`accepted_by` is the salesperson Principal, not a customer signature). Stamps `accepted_at/by`. | `acceptSalesAgreement` |
| To the Sales Order | `closeOpportunityAsWon` / `createSalesOrderFromOpportunity` require an ACCEPTED Agreement; the Order derives its lines (and owner, credit, company, site, PO) from it and stores `sales_agreement_id`. `sales_orders_one_per_agreement` and `sales_orders_one_per_opportunity` allow ONE order ever, even a cancelled one. | `stageSalesOrderFromAgreement` |
| Downstream reads | The billing package reads the Agreement's **live row** (discount, trade-in, charges) through `sales_orders.sales_agreement_id`. The Order itself carries unit prices only, not the discount. | `billingPackage.ts` |
| Scope | Writes are narrowed by sales channel only (DQ-020). **No operating-company authority check exists in Commercial commands or reads** (the stored `operating_company_key` is data, not an authority). | `commercialCommandKernel.ts` |
| Audit | One `audit_events` row per applied command since PR 1 (#2169). Before that, receipts only. | `commandAuditEvent.ts` |

### 1.3 Gaps against scenarios A and E

| Needed | Today | Gap |
|---|---|---|
| A: a quote the customer can be given | An Agreement exists as DRAFT; no "sent / presented" notion (deliberately: the lifecycle comment refuses PRESENTED/SENT/EXPIRED) | Q1-1, Q1-12 |
| E: quote revision | Edit in place; one Agreement per Opportunity; the previous terms are not kept | Q1-3, Q1-4 |
| E: declined approval | A discount over the limit is simply refused; nobody can be asked | Q1-7 to Q1-10 |
| E: cancellation | No withdraw for a quote; order cancel exists but burns the one-order-per-opportunity slot | Q1-5, Q1-6 |
| E: unavailable inventory | No availability in sales flows (matrix stage 5, lane S-1) | Q1-13 (contract only) |
| E: corrections with inventory and financial effects | Billing reads the live Agreement; there is no governed way to change terms after acceptance (ND-15) | Q1-4, section 7 |

---

## 2. The quote object

**OWNER DECISION Q1-1. Is the quote a separate object, or is the Sales Agreement the quote?**

- **Option A (recommended): the Sales Agreement IS the quote.** Add revisions, withdraw, decline and approvals to the existing object. One customer-facing commercial document from first draft to signed commitment, which is how the paper form works ("signed quote", D2). Reuses numbering (`SAG-...`), lines, charges, tax evidence, discount, trade-ins, the Opportunity link, the read projection and the screens (`SalesAgreementDetail`). No second pricing authority to keep in step. The Owner's earlier Decision 2 already chose this object as "the smallest correct object". Cost: the word "Agreement" is used for a document the customer has not yet agreed to; the screen label can say "Quote" while it is DRAFT (a presentation decision, not a data one).
- **Option B: a new `Quote` object that converts to an Agreement on acceptance.** A separate number series and lifecycle (DRAFT, SENT, EXPIRED, ACCEPTED, DECLINED), then an Agreement created from it. Cost: two price-bearing objects with overlapping fields, a conversion command, a second set of approvals/revisions, and the ND-15 problem moved rather than solved. Worth it only if the business wants an Agreement to exist *only* once the customer has committed.

*Nothing below depends on the label; it is written for Option A. Under B, every "Agreement" in sections 3 to 7 reads "Quote" until acceptance.*

**OWNER DECISION Q1-2. Lifecycle: which states?**

- **Option A (recommended): keep `DRAFT`, `ACCEPTED`, `DECLINED`; add only `WITHDRAWN`.** "Awaiting approval" is **not a state**: it is derived from open approval rows (as a pending trade-in already is), so the state machine stays three-plus-one. DECLINED becomes reachable (Q1-5); WITHDRAWN is the seller's cancel before acceptance (Q1-6). Revisions are rows, not states (Q1-3).
- **Option B: add `PENDING_APPROVAL`, `APPROVED`, `SENT`, `EXPIRED`.** More expressive pipeline reporting; each state must change an invariant to earn its keep (the lifecycle file's own test), and each adds a transition to maintain and to audit.

---

## 3. Revisions

**OWNER DECISION Q1-3. Quote revision before acceptance (scenario E).**

- **Option A (recommended): a revision counter on the one Agreement plus immutable snapshots.** `sales_agreements.revision` (starts at 1). A *freeze point* (submitted for approval, accepted, declined, withdrawn, or an explicit "revise" after approval/decline) writes an append-only `sales_agreement_revisions` row holding the full priced content (lines, charges, tax evidence, discount, trade-ins, terms) and a content hash. Editing after a freeze starts revision n+1 in the same DRAFT. Approvals and acceptance bind to a **revision number**; a change to any priced element after an approval makes that approval `SUPERSEDED` (the #204 principle: "an approval never survives a change to what was approved", now applied to the whole price). One Agreement per Opportunity is kept, so no second-quote rule and no new numbering.
- **Option B: several Agreements per Opportunity** (relax `sales_agreements_one_per_opportunity`), each superseding the last, each with its own SAG number. Natural audit trail, but the Opportunity's "the Agreement" becomes ambiguous in every read, in `closeOpportunityAsWon` and in the screens, and numbering churn confuses customers.
- **Option C: no revision history.** Edit the DRAFT in place as today; history only in the audit rows. Cheapest, but scenario E's "quote revision" would have no customer-visible record of the earlier price.

**Hard design constraint (all options).** Billing and the Order read the Agreement row live. An ACCEPTED revision's content must therefore never be edited in place; a later revision lives beside it (Q1-4), and the Order and billing bind to `accepted_revision`.

**OWNER DECISION Q1-4. Changing agreed terms after acceptance (ND-15; scenario E "corrections").**

- **Option A: none.** An ACCEPTED Agreement is final. A changed mind is a new Opportunity (the one-per-Opportunity rule blocks a second Agreement on the same one) and the old Order is cancelled. Simple; wastes the Opportunity and its history.
- **Option B (recommended): reopen as the next revision, only while the Order has done nothing.** One command ("change order") allowed when the Sales Order is `CONFIRMED` with **no allocation, fulfilment, work order, billing package or financing arrangement** (checkable today for fulfilment and billing; allocation arrives with RES/S-1). It needs approver-tier authority (Q1-7/Q1-14) and a reason; in one transaction it cancels that Order, marks the accepted revision `SUPERSEDED`, and returns the Agreement to DRAFT at revision n+1. Re-acceptance then creates a **new** Order (new number) from the new revision. Requires relaxing the two one-per constraints to "one *active* (non-cancelled) Order per Opportunity / per Agreement revision". No financial or inventory effect is possible because none has happened; that is exactly why the gate is there.
- **Option C: amend in place at any time**, with compensating corrections. Needs the invoice adjustment/refund machinery (lane F-1/F-2) and returns/reservation release (RES/S-1); not specifiable honestly before those exist.

*After fulfilment or billing starts, a change is a correction, not a re-quote: Finance owns credit/adjustment and Inventory owns returns. Those belong to lanes F-1/F-2 and RES/S-1 and are out of scope here.*

---

## 4. Decline, withdraw, cancel

**OWNER DECISION Q1-5. Customer decline (ND-14).**

- **Option A (recommended): build `declineSalesAgreement`.** DRAFT to DECLINED, reason mandatory, terminal, one audit row, capability `salesAgreement.decline`. A decline is final for that Agreement (terminal, like ACCEPTED). It changes **nothing else automatically**: the Opportunity is not marked LOST; the salesperson decides whether to mark it LOST or to carry on commercially on a new Opportunity. Any open approval becomes `WITHDRAWN`.
- **Option B: remove the unreachable DECLINED state** and its workflow-seed action; "the customer said no" is recorded as Opportunity LOST with a reason. ND-14 says this is as legitimate as building it.
- **Option C: leave it** (not recommended: a vocabulary the system cannot reach).

**OWNER DECISION Q1-6. Cancellation (scenario E).**

- **Before acceptance, option A (recommended): `withdrawSalesAgreement`.** The seller cancels its own quote: DRAFT to `WITHDRAWN`, reason mandatory, open approvals `WITHDRAWN`. Distinct from DECLINED (the customer's act) so reports can tell "we pulled it" from "they refused". Option B: reuse DECLINED with a flag (cheaper, loses the distinction).
- **After acceptance, before an Order exists:** a withdraw by approver-tier authority with a reason (it voids a customer commitment), or refuse and require the Order path. Recommendation: allow, approver tier only.
- **After an Order exists:** the existing `salesOrder.transition CANCEL` (before FULFILLED) is the cancel; the Agreement stays ACCEPTED as history. Whether that frees the Opportunity for a new Agreement is Q1-4.

---

## 5. Discount authority and approval

Today's model: each Principal has a maximum (basis points; no row means no authority; 0 means none; there is no "unlimited"); a stated discount above it is refused. Cost and margin are **not usable** as a basis: FIN-006 makes margin UNKNOWN unless every line carries a governed cost fact, so a margin-based floor cannot be enforced honestly today.

**OWNER DECISION Q1-7. Discount thresholds: who needs approval, and who can give it.**

- **Option A (recommended): "your own limit, then someone with a higher limit".** No new threshold table. A discount at or under the author's own maximum needs no approval (unchanged). A discount over it can be **requested** (instead of refused); the approver must (i) hold the approval capability, (ii) hold a configured maximum **at or above** the requested discount (measured exactly as today: percent in basis points; fixed amount as `amount x 10000 <= max x selling subtotal`), (iii) be inside the Agreement's sales-channel scope and operating company (Q1-11), and (iv) not be the requester (Q1-8). The limits themselves are set per person on the existing Sales Configuration screen, so the tiers are whatever the Owner configures there; **this specification invents no percentages**. A request above the highest configured maximum in the tenant is refused with the maximum named (it cannot be approved by anyone until a limit is raised, an Administration act, audited).
- **Option B: an explicit tier table** the Owner states (for example "up to X% a salesperson, up to Y% a sales manager, above Y% only the General Manager or Owner"), stored once and applied regardless of individual limits. Clearer to read; a second authority beside the per-person limits to keep consistent. The numbers X and Y are the Owner's.
- **Option C: every discount, however small, needs approval.** Strongest control, highest friction.

**OWNER DECISION Q1-8. Is approval two-person?**

- **Option A (recommended): yes: requester and approver are different people.** Distinct **Employees**, not merely distinct Principals (the rule G-1 settled for goals: "the two people are distinct EMPLOYEES"), with the refusal named `SELF_APPROVAL_FORBIDDEN` as in P-1. One approver is enough.
- **Option B: dual control above a threshold**: a second, different approver for discounts or totals above a dollar or percentage line the Owner states. Builds on A; the number is the Owner's.
- **Option C: self-approval allowed** when the actor holds the authority. That is exactly the status quo (a person with a high limit just applies the discount); it would make "approval" a no-op for senior sellers and is not recommended for any discount above the person's own configured maximum.

**OWNER DECISION Q1-9. How an approval is requested, and where an unapproved discount lives.**

- **Option A (recommended): an explicit `requestSalesAgreementApproval` command.** The draft may hold an over-authority discount **flagged as awaiting approval** (the same shape as a PROPOSED trade-in), accept is refused while any approval for the current revision is open or declined (`APPROVAL_PENDING` / `APPROVAL_DECLINED`), and an approval row snapshots what is being approved (kind DISCOUNT, discount kind and value, selling subtotal, effective basis points, revision, requester, request reason).
- **Option B: the over-authority discount is never stored on the Agreement.** It sits only inside the approval request, and approving it writes it to the Agreement in the same transaction. The Agreement then never carries an unapproved discount (cleaner invariant), at the cost of a two-place UI (the requested value is not on the draft) and the approver needing a write path onto the draft.
- **Option C: implicit**: saving a draft with an over-limit discount silently opens a request. Rejected in the recommendation: a draft edit should not have a hidden side effect on another person's queue.

**OWNER DECISION Q1-10. What an approval is bound to, and how long it lasts.**

- **Option A (recommended): bound to the revision; no clock.** An approval covers exactly one revision's discount. Any change to a priced element (lines, quantities, prices, charges, discount) supersedes it; there is **no expiry** (this specification will not invent a number of days).
- **Option B: add a validity window** the Owner states (N days after the decision, then `EXPIRED` and re-request).

**Declined approval (scenario E).** An approver declines with a **mandatory reason**; the approval is `DECLINED`; the Agreement stays DRAFT and its price is untouched; accept is refused (`APPROVAL_DECLINED`). The requester may (i) revise the discount down and re-request (a new approval on a new revision), (ii) withdraw the request, or (iii) withdraw the quote (Q1-6). A decline is never silent: the audit row carries the reason and the requester sees it on the Agreement and in the work-area read. Approve may carry an optional note and an optional **approved maximum below the request** (the approver can grant less than asked, as a trade-in approver can assign a different value); the draft's discount is then refused above that value until revised.

**Trade-in stays as built.** The reserved owner/General Manager trade-in decision (#204/#226) is unchanged, not folded into the new approval row, and keeps blocking accept. Only the "pending decision blocks accept" rule is shared.

---

## 6. Authority, company isolation, and the parity derivation

**OWNER DECISION Q1-11. Operating-company scope of approval and of Commercial writes.**

- **Option A (recommended): company authority applies to Commercial.** An approver (and, as the same fix, any Commercial writer) must hold authority for the Agreement's operating company, as inventory and finance already do (`resolveInventoryCompanyAuthority` pattern); a foreign company's record reads as nonexistent. Finding behind it: today Commercial commands and reads are narrowed by sales channel only, so a Taylor seller's authority does not stop at Ventana's record. Scenario D (Ventana isolation) cannot pass without this; approval makes it more pressing because approval authority is the sensitive one. This is a cross-cutting security-authorization change and is a separate build, gated on the Owner.
- **Option B: channel scope only** (today). Acceptable only if one person never spans both companies' quotes.

**OWNER DECISION Q1-12. Quote validity, "sent" status and acceptance evidence.**

- **Option A (recommended for now): none of the three.** Keep the lifecycle's deliberate "no PRESENTED/SENT/EXPIRED"; acceptance stays "the salesperson records the customer's acceptance" with an **optional free-text evidence reference** (no signature capture). Signature and customer acknowledgement belong to lane D-1 and can attach to the same record later without a state change.
- **Option B:** an informational `valid_until` date (no state change, no enforcement).
- **Option C:** an enforced EXPIRED state, or required signature capture now (pulls D-1 forward).

**OWNER DECISION Q1-13. Availability at quote time (scenario E "unavailable inventory").** The contract this document sets for lanes RES and S-1:
- **Option A (recommended):** a quote **reserves nothing** and acceptance does not reserve; availability is shown as advisory information on the lines; reservation and allocation start when the Sales Order is created, under the reservation specification; an order for stock that is not there is allowed and visibly short (it feeds scenario C: requisition, supplier PO). Never blocks the sale.
- **Option B:** block acceptance when a stocked line cannot be covered (simple to say, wrong for purchased-equipment sales, scenario C).
- **Option C:** reserve at acceptance (couples quoting to inventory and to the order that does not yet exist).
This decision is S-1's to confirm; it is listed so the quote does not silently pre-empt it.

**OWNER DECISION Q1-14. New capabilities and their holders.** None of these exists in Firebase, so **none is a parity item and none is granted by this document** (lane rule: non-parity grants are an Owner decision). Proposed keys and holders:

| Capability (proposed) | Does | Proposed holders (recommendation) |
|---|---|---|
| `salesAgreement.approval.request` | request an approval; revise after a decline | exactly the holders of `salesAgreement.updateDraft` |
| `salesAgreement.discount.approve` | approve or decline a discount request; capped by the approver's own configured maximum (Q1-7), sales-channel scoped, never the requester | `salesManager`, `generalManager`, `owner`. **Not `admin`**: #204 "System Administration is not Business Approval". Not reserved like trade-in, because limits already cap it. |
| `salesAgreement.decline` | record the customer's decline (Q1-5) | exactly the holders of `salesAgreement.accept` |
| `salesAgreement.withdraw` | withdraw a quote before acceptance (Q1-6) | the holders of `salesAgreement.updateDraft`; after acceptance, approver tier only |
| `salesAgreement.reopen` | change order (Q1-4 option B) | approver tier: `salesManager`, `generalManager`, `owner` |

Each capability is salesChannel-evaluable, flat (no conditions), and added by a grant-bearing migration the controller writes (Owner ruling E), never by this lane.

### 6.1 The Firebase-parity derivation (A7-style, additive only)

[`q1-quote-parity-2026-10-20.json`](q1-quote-parity-2026-10-20.json) holds, for each quote-path key, the Firebase holders (compiled catalogs at b3d09dc3) beside the EOS holders (the repository's nonprod baseline), the `toAdd` list, and `"toRemove": []` **by rule**: a parity pass never removes an EOS holder. Findings, for the Owner and the controller:

1. `salesAgreement.accept` and `opportunity.createSalesOrder`: Firebase gives them to `salesManager`; the repository baseline does not. They are granted through an Administration decision on record (**Controller DQ-021, re-approved DQ-1**, `salesManagerParityDelta.ts`, channel-scoped), so they are expected to be held live; **the live nonprod table must be read to confirm** (this lane has no database access). Not a new grant.
2. `salesOrder.fulfill` and `salesOrder.service` (Firebase: admin, dispatcher, owner) have **no EOS holder at all** (B5 matrix permission gaps). Lane S-1 owns them. Listed, not proposed here.
3. `salesAgreement.tradeIn.approve` (owner, generalManager) and `sales.discountAuthority.manage` (accountingManager, admin, controller, financeManager, generalManager, owner) have no Firebase counterpart; they are Owner rulings (#204), shown for completeness.
4. Every other quote-path key matches exactly: no divergence.

---

## 7. The link to the Sales Order

- The Order derives from the **accepted revision**. It stores `sales_agreement_id` and `agreement_revision`; its lines are unit prices (as today). The discount and trade-in stay on the Agreement and reach Finance through the billing package, which must read the accepted revision (the constraint in section 3), never the working draft.
- One **active** Order per Opportunity and per accepted revision (a cancelled Order frees the slot; Q1-4 option B). The cancelled Order and its Agreement revision remain readable lineage.
- Acceptance requires: every line priced (as today), no open or declined approval on the current revision, no PROPOSED trade-in, and the discount either within the accepter's own limit or covered by an APPROVED approval for **this** revision at or above it.
- Cancelling an Order after inventory is allocated or an invoice exists is not a quote concern: reservation release is RES/S-1, credit and adjustment is F-1/F-2. The change-order gate (Q1-4) is what keeps this lane clear of both.

---

## 8. Proposed data model (sketch for the later build; no migration is written here)

- `sales_agreements`: add `revision INT NOT NULL DEFAULT 1`, `accepted_revision INT NULL`, state enum `+ WITHDRAWN`, `decline_reason`, `withdraw_reason`, optional `acceptance_evidence_reference TEXT`.
- `sales_agreement_revisions` (append-only, trigger-protected like `audit_events`): `(tenant_id, sales_agreement_id, revision)` key, `frozen_at/by`, `freeze_reason` (SUBMITTED, ACCEPTED, DECLINED, WITHDRAWN, SUPERSEDED), `content JSONB`, `content_hash`.
- `sales_agreement_approvals`: `id`, tenant, agreement, `revision`, `kind` (DISCOUNT), `requested_discount_kind/bp/amount`, `selling_minor`, `effective_bp`, `requested_by` (Principal and Employee), `requested_at`, `request_reason`, `status` (PENDING, APPROVED, DECLINED, WITHDRAWN, SUPERSEDED, plus EXPIRED if Q1-10 option B), `decided_by` (Principal and Employee), `decided_at`, `decision_reason`, `approved_max_bp`; CHECK constraints shaped like `sales_agreement_trade_ins` (a decline has a reason; a decision has an actor and a time).
- `sales_orders`: add `agreement_revision`; replace the two one-per constraints with partial uniques over non-cancelled orders.
- Commands (each: one transaction, `command_receipts` idempotency, one `audit_events` row with the reason, capability first): `requestSalesAgreementApproval`, `decideSalesAgreementApproval` (approve/decline), `withdrawSalesAgreementApprovalRequest`, `declineSalesAgreement`, `withdrawSalesAgreement`, `reopenSalesAgreementAsRevision`; `updateSalesAgreementDraft` and `acceptSalesAgreement` gain the revision and approval gates.
- Reads: the Agreement detail states the revision, the approvals (with who/when/why), and the actions **this caller may take now** (the P-1 pattern, so OFFERED equals ACCEPTED); a "waiting on me" read for approvers.

## 9. How the scenarios would run (after the Owner rules and the build)

**A, retail sale.** Customer, Opportunity, Agreement DRAFT (the quote), discount within own limit, accept, close as won, Order, then reservation (RES/S-1), delivery (D-1), invoice (F-1), warranty (W-1). The quote part needs only the Q1-1 label decision and the accept gate.

**E, exception.** (1) Quote rev 1 with a 12% discount against a 5% limit: request approval. (2) Approver declines "too deep": rev 1 stays DRAFT, accept refused. (3) Seller revises to 8%, a new revision, requests again; a manager with a 10% limit approves. (4) Customer accepts, Order created. (5) Customer changes the quantity before anything ships: change order (reopen as rev 3, Order cancelled, new Order on re-accept). (6) Or the customer walks: withdraw (before acceptance) or cancel the Order (after). (7) Stock short: the Order is booked visibly short and feeds requisition (Q1-13). (8) Corrections after invoicing are F-1/F-2 and RES/S-1.

## 10. Build slices (a later lane, after the Owner rules; nothing starts tonight)

1. **Q-1a decline + withdraw** (no migration beyond the enum value and two reason columns): Q1-5, Q1-6, the two capabilities.
2. **Q-1b revisions** (revision column, snapshot table, billing/Order bind to the accepted revision): Q1-3, Q1-4 without the change order.
3. **Q-1c discount approval** (approval table, request/decide commands, accept gate, work-area read): Q1-7 to Q1-10, Q1-14.
4. **Q-1d change order** (reopen; relaxed Order uniques): Q1-4 option B, depends on S-1 for the allocation check.
5. **Q-1e company authority for Commercial** (Q1-11): its own security change.
Each slice ships with Postgres tests (one audit row per applied command, none on replay or refusal, the refusal matrix), the screen changes, user how-to docs and DECISIONS entries; production execution stays with the operator.

## 11. Owner decision index

| # | Decision | Recommendation |
|---|---|---|
| Q1-1 | Quote: separate object or the Sales Agreement | The Agreement is the quote |
| Q1-2 | Lifecycle states | Keep DRAFT/ACCEPTED/DECLINED, add WITHDRAWN; "awaiting approval" is derived |
| Q1-3 | Revision before acceptance | Revision counter + immutable snapshots on the one Agreement |
| Q1-4 | Change after acceptance (ND-15) | Reopen as next revision only while the Order is CONFIRMED and untouched |
| Q1-5 | Customer decline (ND-14) | Build `declineSalesAgreement` with a mandatory reason |
| Q1-6 | Cancellation | `withdrawSalesAgreement` before acceptance; after acceptance approver tier; Order cancel after an Order |
| Q1-7 | Discount thresholds and approvers | Own limit, then an approver with a higher configured limit; no invented percentages |
| Q1-8 | Two-person approval | Yes: requester and approver are distinct Employees; dual control later on an Owner-stated threshold |
| Q1-9 | Request mechanism and where the discount lives | Explicit request; over-limit discount flagged on the draft, accept blocked |
| Q1-10 | Approval binding and expiry | Bound to the revision; no expiry |
| Q1-11 | Operating-company scope of Commercial and approval | Apply company authority to Commercial (separate security build) |
| Q1-12 | Validity, "sent", acceptance evidence | None for now; optional evidence text; signature with D-1 |
| Q1-13 | Availability at quote time | Advisory only; no reservation at quote or acceptance (S-1 confirms) |
| Q1-14 | New capabilities and holders | Five keys as tabled; none is Firebase parity; none applied |

## 12. Explicitly not done

No code, migration, capability, grant, screen or Firebase change; no production action. No percentage, dollar threshold or expiry period is invented: where a number is needed it is the Owner's (Q1-7 option B, Q1-8 option B, Q1-10 option B). The live nonprod grants were not read.
