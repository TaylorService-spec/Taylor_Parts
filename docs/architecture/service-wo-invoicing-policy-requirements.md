# Service Work Order invoicing: policy requirements (prepare only)

**Status:** REQUIREMENTS AND OWNER QUESTIONS. Nothing in this document is built. It creates no command, table, migration, capability, grant, rate, percentage or approval authority, and it invents none.
**Issued:** 2026-10-20 (America/Phoenix) · **Base:** `origin/main` `e19dc610da47280d8bebcc77bfa7b4c092fafb68` · **Lane:** DOC.
**Why this exists:** the Owner tracks Service Work Order invoicing as its own B5 gap. F-1 invoices Sales Orders; "F-1 Sales Order invoicing alone does not complete service billing" ([`owner-commercial-spec-rulings-2026-10-20.md`](../governance/owner-commercial-spec-rulings-2026-10-20.md) §5 item 1, §7 item 5). The Owner asked for the policy requirements to be prepared "without implementing unapproved financial authority".

**Question classes** (the vocabulary of the 2026-10-20 classification):

| Class | Meaning here |
|---|---|
| **Parity** | Firebase behaved a particular way; EOS keeps it unless the Owner says otherwise. |
| **Previously ruled** | An Owner or Controller ruling already answers it; the question is only whether it still applies to a Work Order. |
| **Technical** | Engineering can decide it without moving authority or money; the Owner is told, not asked. |
| **New Owner policy** | Business policy no repository fact can answer. Needs an Owner answer before any build. |

---

## 0. Summary

- **A service call cannot be invoiced anywhere today.** Firebase never had a service invoice. EOS opens a receivable only from a Sales Order billing package: the package table accepts `source_kind = 'SALES_ORDER'` and nothing else (`functions/migrations/1764450000000_operational-billing-packages.sql:26`). A Work Order that completes with no Sales Order produces no billing fact of any kind.
- **The anchor is already decided.** On 2026-08-25 the Owner ruled `InvoiceOrigin = SALES_ORDER | WORK_ORDER`, exactly one reference per invoice, with Work Order billing deriving its money "from governed service authority, never client-submitted amounts" ([`core-transaction-actionability-audit.md`](../assessments/core-transaction-actionability-audit.md), "Owner decisions", item 1).
- **The policy is deferred, by name.** DECISIONS #191 item 6 lists SERVICE BILLING POLICY (and TAX SOURCE) as deferred Owner policy "for later activation windows". FIN-BLOCK-002 (service billing rate/policy) is the open block. Until it is answered, every class of service work is UNBILLABLE by construction, and that is the intended fail-closed behaviour.
- **What EOS can say about a completed job today** is facts, not money: who worked, for how many minutes (onsite and travel), which parts were planned and recorded as used, when the technician travelled, arrived and finished, which customer, location and equipment, and which operating company. It holds **no rate, no price, no billable flag, no financial class, no payor, no tax, no trip charge and no agreement link** for service work.
- **Counts:** 31 numbered Owner questions (section 4). By class: 5 previously ruled, 1 parity, 4 technical, 21 new Owner policy. The 21 new policy questions are the ones that need an Owner answer; the recommendation under each is a default for the Owner to accept or change, not a rate or a rule in force.
- **Ordering.** Finance (F-1) comes first in the Owner's implementation order (rulings register, "Operating constraints"). Service WO invoicing builds on F-1's invoice document, numbering, adjustment and refund rules. Nothing here should be built before the new-policy questions are answered.

---

## 1. Authority already in place (cited, not restated)

| Authority | What it settles for a service invoice |
|---|---|
| Owner decision 2026-08-25, `core-transaction-actionability-audit.md` item 1 | Service invoicing anchors on the **Work Order** explicitly. A service call does not manufacture a Sales Order. One reference per invoice. Money derives from governed service authority, never client amounts. |
| DECISIONS #191 (finance target model) items 5-6 | EOS owns the operational **billing package**; the external accounting authority later creates the formal invoice. SERVICE BILLING POLICY and TAX SOURCE are deferred Owner policy. |
| [`FIN-BLOCK-002_SERVICE_BILLING_DECISION_PACKAGE.md`](../financials/FIN-BLOCK-002_SERVICE_BILLING_DECISION_PACKAGE.md) and [`SERVICE_BILLING_MODEL.md`](../financials/SERVICE_BILLING_MODEL.md) | The candidate classes, the missing facts, and the invariants: unclassified = UNBILLABLE; hours do not equal billable, cost or revenue; integer minor units; named governed source (`sourceType` / `sourceRecordId`), never the acting user; HELD blocks billing, not visibility. |
| F-1 spec (PR #2175) and the Owner rulings OD-F1-1, -2, -4, -9, -11, -12 | An invoice is a document over **one receivable obligation** (no second AR book); ordinary issue needs **no** second approver; nonzero credits, write-offs, adjustments, refunds and eligible voids need a **separate authorized Employee** (initial threshold $0); a void is allowed only before any settlement or adjustment; a refund records an obligation and **never** executes a payment; no historical Firebase invoice copy now; numbering stays seedable but **no continuity seed is applied** (Safeguard C). |
| Rulings register §8 Safeguard A | Discount authority fails closed: a missing limit is never unlimited authority, and no percentage is invented. |
| `technician-labor-domain-v1.md` and `workOrderLabor.ts` | Labor is **hours only by ratified design**: no rate, no cost, no billable flag; Employee is the actor. |
| W-1 spec (PR #2171, open) | A derived warranty status `IN_WARRANTY` / `OUT_OF_WARRANTY` / `UNKNOWN`; "who decides claim versus billable" is a person, with the status as the prompt (W-1 OD-10, not yet ruled). The WO type `WARRANTY` and a financial class "warranty" stay distinct. |

---

## 2. What a service invoice must contain, and where each fact comes from today

"Source today" is a repository fact at this head. "Missing" says what no authority holds yet.

| # | Component | Source today | Missing |
|---|---|---|---|
| 1 | **Header**: invoice number, issue date, due date, operating company, bill-to, currency | Operating company: `work_orders.operating_company_key`. Customer, site: `customer_id`, `location_id`. Number and document: F-1 design (`INV-<YYYY>-<######>` per company and year; allocator prepared, unwired). Issue/due date: F-1. | A **payor / bill-to distinct from the customer** (none modelled; the WO carries `customerId` only). An ACTIVE operating-company key binding for the issuing company (Ventana has none in nonprod). Payment terms source. |
| 2 | **References**: Work Order number, equipment/serial, complaint / diagnosis / resolution, technician(s), customer PO | `work_orders.work_order_number`, `equipment_id` (optional), `complaint` / `diagnosis` / `resolution`, `work_order_assignments`. Equipment dates `installed_on`, `warranty_expires_on`. | A **customer PO / authorization number on a service call** (missing authority per the audit). A truck link. A recall reference. A service-contract flag. |
| 3 | **Labor lines** | `work_order_labor_entries` (migration 1764330000000; `workOrderLabor.ts`): one row per entry, type `ONSITE` or `TRAVEL`, 1..960 minutes, work date, the recorder's own Employee, optional device timestamps, corrections append a replacement and reverse the original. Totals are a projection that excludes reversed entries. | **Everything monetary**: no bill rate, no rate source, no unit, no rounding, no minimum, no overtime or after-hours rule, no per-technician or per-class rate. Hours are not billable, cost or revenue. |
| 4 | **Parts lines** | Planned: `work_order_parts_plan` / `setWorkOrderPartsPlan`. Actual: `work_order_execution_records` (append-only deltas; the current actual is their sum), written by `workOrderExecution.ts`. Usage is clamped to `[0, qtyPlanned]` (Firebase parity, TW5). With `consumeFrom` a truck, the same transaction posts a `WORK_ORDER_CONSUMPTION` stock movement; otherwise "no stock was consumed" (`INVENTORY_BOUNDARY.COMPLETED`, NOT_YET_ACTIVATED). | A **sell price**: `InventorySnapshotItem` carries none, Part `sellPrice` is blocked, no price book exists. A rule for parts used **beyond plan** (not recordable today). Which evidence makes a part billable (recorded actual versus posted consumption). Returns, cores, freight, shop supplies. |
| 5 | **Travel** | Two facts exist: `TRAVEL` labor entries, and the lifecycle timestamps `en_route_at`, `arrived_at`. The audit says travel must be derived once and not duplicated. | Whether travel is billed by time, by a flat charge or by zone; which of the two sources is authoritative for billing. |
| 6 | **Trip charge, minimum charge, dispatch fee** | None. | The charge itself, its trigger, its amount source. No typed representation exists (audit section M: Sales Order line kinds are `EQUIPMENT_MODEL / PART / SERVICE` only). |
| 7 | **Other typed charges** (freight, refrigerant, refrigerant processing, brazing, service charge, steam clean; audit section M) | None. The audit's list is a package summary of an artifact, not a ratified set. | The closed set of charge categories and each category's price source. "Typed lines are the correct shape"; no `miscChargeMinor`. |
| 8 | **Warranty and no-charge work** | WO type `WARRANTY` (a bare category). `equipment.warranty_expires_on` (one optional date). Sales Agreement line `warranty` (free text, read by nothing). W-1 designs a derived status and a classification step, unbuilt. | A `serviceFinancialClass` on the Work Order; a manufacturer-claim record; a cost-attribution target (blocked on FIN-BLOCK-003, no cost authority). Work in these classes should appear in the queue with a named reason, not silently vanish. |
| 9 | **Contract or national-account pricing** | None. No WO-to-agreement link exists (`salesOrderId` / line refs only). Agreement lines hold free text. National-account status is not an operating company and is not modelled on the service path. | A governed WO-to-agreement link, a structured coverage term, and a price program (rate card per customer, account or agreement). |
| 10 | **Tax** | A billing package takes tax only when the Agreement's tax is DETERMINED; otherwise the exception `TAX_NOT_DETERMINED` and the dependent totals stay NULL ("a missing tax value is never zero"). F-1 keeps the same rule. A service call has no Agreement, so nothing determines tax. | The TAX SOURCE (deferred #191 item 6): jurisdiction, taxability of labor versus parts, exemptions. |
| 11 | **Totals and the receivable** | F-1: an invoice is 1:1 with a receivable obligation; line totals must equal the obligation's originated amount; integer minor units; outstanding read from the obligation. | A way for a service billing fact to open a receivable: billing packages are `SALES_ORDER` only. |
| 12 | **Authorization evidence** | D-1 designs delivery/install acknowledgment; completing DELIVERY or INSTALL needs an outcome (ruled). Legal language is held. | Any customer authorization or sign-off for a **service call** (estimate approval, not-to-exceed, completion acknowledgment). |
| 13 | **Attribution / business unit** | `deriveWorkOrderBusinessUnit` maps `INSTALL` to the INSTALLATION unit but has zero callers. FIN-002 attribution snapshot applies to invoices. | A stamped business unit and credited-salesperson rule for service revenue. |

---

## 3. What is missing, in one list

1. A way to open a billing fact and a receivable from a Work Order (`billing_packages` is `SALES_ORDER` only).
2. A `serviceFinancialClass` on the Work Order and a governed command to set and correct it.
3. Every price: labor rates, parts sell prices, trip/minimum/other charges. No price book.
4. A payor concept and a customer PO on a service call.
5. A WO-to-agreement link and a structured coverage term.
6. A tax source.
7. Parts-beyond-plan handling and a billable-parts evidence rule.
8. A customer-authorization record for service calls.
9. A cost side for warranty and no-charge work (FIN-BLOCK-003).
10. A business-unit stamp for service revenue.

None of these is decided by a repository fact. Nothing infers billability from Work Order status, route, location or labor hours.

---

## 4. Owner questions

Each question gives its class, the options, and a recommendation. A recommendation is a default to accept or change. No question invents a rate, a percentage or an authority; where a number is needed it is the Owner's to set.

### A. Route and classification

**SWO-1 · Previously ruled · Billing anchor.** Service work is invoiced against the Work Order (`InvoiceOrigin = WORK_ORDER`), not by creating a Sales Order. *Recommendation:* apply the 2026-08-25 ruling as written. The earlier FIN-BLOCK-002 Q3 option "bill through a Sales Order" is superseded for pure service calls.

**SWO-2 · Technical (Owner told) · A Work Order that also has a Sales Order.** A WO can carry `sales_order_id` (install and delivery work). To honour "exactly one reference per invoice" and avoid double billing: *Options:* (a) priced Sales Order lines bill through the Sales Order and the WO contributes only unpriced service facts as WORK_ORDER lines; (b) the WO origin never bills when a Sales Order covers the same work; (c) both, with an explicit allocation. *Recommendation:* (a), with a rule that a fact is billed on exactly one origin.

**SWO-3 · New Owner policy · The financial classes.** Ratify, amend or replace the candidate set CUSTOMER_PAY, AGREEMENT_COVERED, WARRANTY, INTERNAL, GOODWILL, CALLBACK_REWORK, NO_CHARGE (FIN-BLOCK-002 section 12.1). *Recommendation:* adopt the seven as the starting vocabulary, extendable only by an Owner decision; the WO type `WARRANTY` and the class WARRANTY stay separate facts.

**SWO-4 · New Owner policy · Who classifies, and when.** *Options:* at Work Order creation, at completion, or both (provisional at creation, confirmed at completion); which role holds the authority (service manager, dispatcher, finance). *Recommendation:* provisional class at creation, confirmed by an authorized person before the job becomes a billing candidate. Roles are the Owner's; nothing is granted by this document.

**SWO-5 · Previously ruled · Unclassified work.** Unclassified service work is UNBILLABLE; absence of a decision is never "billable" (`SERVICE_BILLING_MODEL.md` section 3; FIN-BLOCK-002 section 9). *Recommendation:* keep.

**SWO-6 · New Owner policy · Reclassification.** Does changing a class before an invoice exists need a second person? After an invoice exists the F-1 route applies (SWO-27). FIN-BLOCK-002 recommended approval "because it moves money". *Options:* none; second person always; second person only when a class moves toward NO_CHARGE or WARRANTY. *Recommendation:* second person for any move away from CUSTOMER_PAY, consistent with F-1 treating money reductions as two-person.

**SWO-7 · New Owner policy · Warranty determination.** Who decides that a job is manufacturer warranty, Taylor warranty or goodwill, and what evidence is required. W-1 supplies a derived status as a prompt (OD-10 open). *Options:* technician proposes, manager confirms; manager only; automatic when status is IN_WARRANTY. *Recommendation:* a person always decides; the derived status never classifies by itself; `UNKNOWN` is never read as in or out of warranty.

**SWO-8 · New Owner policy · What a no-charge job produces.** WARRANTY, GOODWILL, INTERNAL and NO_CHARGE work yields no customer charge. *Options:* (a) no document, excluded from the queue with a named reason; (b) a zero-value customer statement; (c) an internal cost document for the absorbing P&L. *Recommendation:* (a) now, because (c) needs a cost authority that does not exist (FIN-BLOCK-003); (b) only if the Owner wants the customer to see the saving.

**SWO-9 · New Owner policy · Callback and rework.** Whether a return visit within some period is chargeable, and how it links to the original job. *Options:* a lineage field only; a rule keyed to a period. *Recommendation:* record the link now; the period, if any, is the Owner's number and is not assumed here.

### B. Labor

**SWO-10 · New Owner policy · Is labor billable at all in the first version.** *Options:* not billed (parts and charges only); flat per job; time and materials. *Recommendation:* the Owner chooses; if time and materials, SWO-11 to SWO-14 are required first. Billing hours with no rate authority is refused.

**SWO-11 · New Owner policy · Rate source.** Where a bill rate comes from: per technician, per class of work, per customer or agreement, per operating company, per day-part. Who maintains the rate card, its effective dating and its audit; which capability changes it. *Recommendation:* a governed, effective-dated rate card owned by Finance with its own change authority and audit, never a free field on the Work Order. Bill rate stays separate from cost rate and from hours (the labor doctrine). No rate is proposed here.

**SWO-12 · New Owner policy · Billable time basis.** Which entries count: ONSITE only or ONSITE plus TRAVEL; rounding and increment rules; minimum hours; overtime or after-hours multipliers; treatment of reversed (corrected) entries. *Recommendation:* count only active (not reversed) entries; every increment, minimum and multiplier is an Owner-set value, not a default.

**SWO-13 · Technical (Owner told) · Travel source.** Travel time is derived once and not duplicated: either the `TRAVEL` labor entries or `en_route_at` to `arrived_at`. *Recommendation:* the labor entries, because they are Employee-attributed, auditable and correctable; the lifecycle timestamps remain the operational record.

**SWO-14 · New Owner policy · Trip charge, minimum charge, dispatch fee.** Whether any exist, their trigger (per visit, per mile, per zone), and their amount source. *Recommendation:* model each as a typed charge line with its own governed price; none is assumed to exist.

### C. Parts and other charges

**SWO-15 · New Owner policy · Parts price source.** *Options:* (a) Sales Order line price (needs service to flow through an SO, which SWO-1 rules out for pure service calls); (b) a price book stamping a frozen sell-price snapshot at consumption. *Recommendation:* (b), a new governed price authority; the snapshot at event time matches the existing doctrine. Any markup rule is the Owner's and is not assumed.

**SWO-16 · Parity · Usage is capped at the plan.** Firebase capped recorded usage at `qtyPlanned` (parity confirmed TW5). *Recommendation:* keep the cap; it is existing behaviour, not a billing rule.

**SWO-17 · New Owner policy · Parts used beyond plan.** Billing needs the quantity actually used, which the cap prevents recording. *Options:* require an authorized plan increase before use beyond plan; allow over-plan recording with a reason and approval; bill the plan only. *Recommendation:* require a plan increase first through the existing plan command, then bill the recorded actual. Changing the cap itself would break parity and is not recommended.

**SWO-18 · New Owner policy · Billable-parts evidence.** Which fact makes a part billable: a recorded actual (execution record), a posted stock movement (truck consumption), or both. Stock consumption on completion is NOT_YET_ACTIVATED outside the truck path. *Recommendation:* a recorded actual is the billing fact; where a truck consumption exists the two must agree; a part with an actual but no stock effect is shown as an exception, not silently billed.

**SWO-19 · New Owner policy · Typed charge categories.** The closed set of non-labor, non-part charges (the audit lists freight, refrigerant, refrigerant processing, brazing, service charge, steam clean from an artifact summary), and each category's price source. Returns, cores and shop supplies. *Recommendation:* ratify a closed set; unknown categories are refused, not free text.

### D. Agreements, pricing programs, payor

**SWO-20 · New Owner policy · Agreement-covered service.** What a service agreement covers (labor, parts, which equipment, which visits), and the governed WO-to-agreement link. Today agreements hold free text. *Recommendation:* a structured coverage term is a prerequisite; until it exists AGREEMENT_COVERED stays UNBILLABLE-with-reason.

**SWO-21 · New Owner policy · Contract and national-account pricing.** Whether negotiated service pricing exists, and which entity holds it (customer, account, agreement, program). National-account status is a different fact from operating company and is not assumed to select a price. *Recommendation:* the Owner names the price programs; none is assumed.

**SWO-22 · New Owner policy · Payor and customer PO.** Whether bill-to differs from the customer (national accounts, third parties, manufacturers paying warranty), and whether a service call carries a customer PO. *Recommendation:* a payor reference on the billing fact, defaulting to the customer only when stated explicitly; a customer PO field on the Work Order. The manufacturer as payor is a claim (W-1 OD-12 defers claims), not a bill-to.

### E. Tax, issue, approval, correction

**SWO-23 · New Owner policy · Tax source.** Deferred by #191 item 6. Jurisdiction determination, whether labor is taxable, exemption evidence. *Recommendation:* Owner and accounting/counsel decide; until then a service line has no tax and the package/invoice stays HELD with `TAX_NOT_DETERMINED`, never zero.

**SWO-24 · New Owner policy · The billing trigger and review gate.** *Options:* the job is a candidate at COMPLETED; at CLOSED; only after a billing review by an authorized person. Whether multi-visit jobs bill per visit or once at the end; partial or progress billing. *Recommendation:* a candidate only after the class is confirmed (SWO-4) and a billing review; one invoice per Work Order unless the Owner rules otherwise (the Sales Order billing package likewise bills only when eligible in full).

**SWO-25 · Previously ruled · Issue approval.** Ordinary invoice issuance needs no second approver (OD-F1-1 / OD-F1-4). *Recommendation:* apply to Work Order invoices unchanged; the review in SWO-24 is a billing-eligibility gate, not an invoice approval.

**SWO-26 · Previously ruled · Numbering and company.** Number format `INV-<YYYY>-<######>` per company and year; the issuing company comes from the Work Order's `operating_company_key` and needs an active operating-company key binding; no historical continuity seed without separate Owner approval (Safeguard C). *Recommendation:* apply unchanged.

**SWO-27 · Previously ruled · Credits, write-offs, refunds, voids.** The F-1 rules apply: second authorized Employee, $0 threshold, void only before any settlement or adjustment, a refund records an obligation and executes no payment (OD-F1-1, -4, -9, -11). *Recommendation:* apply to service invoices unchanged. Confirm in design that a service invoice reuses the same adjustment and refund operations.

**SWO-28 · Technical (Owner told) · Edits after invoicing.** Once a Work Order's billing fact is invoiced, labor corrections and part adjustments must not silently change the invoice. *Recommendation:* the billing fact freezes at issue; a later correction goes through the credit and rebill path, never an edit.

**SWO-29 · Technical (Owner told) · Evidence on the invoice.** The invoice shows the Work Order number, equipment and serial, technician(s), dates, complaint/diagnosis/resolution and line sources, each traceable to its governed record. *Recommendation:* as listed; no field is client-supplied.

### F. Authorization, attribution, discounts

**SWO-30 · New Owner policy · Customer authorization for service.** Whether a service call needs an estimate approval, a not-to-exceed amount or a completion sign-off before it can bill, and what counts as evidence. D-1 covers delivery and install only, and legal language is held for counsel. *Recommendation:* decide per class of work; no legal wording is drafted here.

**SWO-31 · New Owner policy · Business unit, price overrides and discounts.** Whether service revenue is stamped to a business unit (`deriveWorkOrderBusinessUnit` maps INSTALL to INSTALLATION and has no callers), who gets credit, and whether a line price may be overridden or discounted. Discount authority fails closed (Safeguard A): no configured limit means no discount beyond zero. *Recommendation:* wire the business-unit stamp when the Owner confirms the mapping; any service discount uses the Q-1 discount-authority limits when the Owner sets them, with no limit assumed.

**Tally (31):** previously ruled SWO-1, 5, 25, 26, 27 (5) · parity SWO-16 (1) · technical SWO-2, 13, 28, 29 (4) · new Owner policy the remaining 21, listed in section 5.

---

## 5. The questions that need an Owner answer

| # | Question (one line) | Class |
|---|---|---|
| SWO-3 | Which financial classes exist (CUSTOMER_PAY, AGREEMENT_COVERED, WARRANTY, INTERNAL, GOODWILL, CALLBACK_REWORK, NO_CHARGE)? | New Owner policy |
| SWO-4 | Who confirms the class, and at creation or at completion? | New Owner policy |
| SWO-6 | Does changing a class before invoicing need a second person? | New Owner policy |
| SWO-7 | Who decides warranty versus goodwill versus billable, and on what evidence? | New Owner policy |
| SWO-8 | What does a no-charge job produce: nothing, a zero statement, or an internal cost document? | New Owner policy |
| SWO-9 | Is a callback or rework visit chargeable, and within what period (the Owner's number)? | New Owner policy |
| SWO-10 | Is labor billable in the first version: none, flat per job, or time and materials? | New Owner policy |
| SWO-11 | Where do labor bill rates come from, who maintains them, and who may change them? | New Owner policy |
| SWO-12 | Which time counts, and what are the rounding, minimum and overtime rules? | New Owner policy |
| SWO-14 | Are there trip, minimum or dispatch charges, triggered how and priced from where? | New Owner policy |
| SWO-15 | Where does a part's sell price come from (price book snapshot, or other)? | New Owner policy |
| SWO-17 | How are parts used beyond the plan handled for billing? | New Owner policy |
| SWO-18 | What evidence makes a part billable (recorded actual, posted stock movement, or both)? | New Owner policy |
| SWO-19 | What is the closed set of other charge categories and their price sources? | New Owner policy |
| SWO-20 | What does a service agreement cover, and how is a Work Order linked to it? | New Owner policy |
| SWO-21 | Does negotiated or national-account service pricing exist, and who holds it? | New Owner policy |
| SWO-22 | Can the bill-to differ from the customer, and does a service call carry a customer PO? | New Owner policy |
| SWO-23 | What is the tax source for service labor and parts? | New Owner policy |
| SWO-24 | When does a job become a billing candidate, and is there a billing review gate? | New Owner policy |
| SWO-30 | Does a service call need a customer estimate approval, cap or sign-off before billing? | New Owner policy |
| SWO-31 | Is service revenue stamped to a business unit, and may a line price be overridden or discounted? | New Owner policy |

That is **21 new Owner policy questions**. Already answered and only to be confirmed as applying: SWO-1, 5, 25, 26, 27 (previously ruled). Kept for parity: SWO-16. Engineering decides and tells the Owner: SWO-2, 13, 28, 29.

---

## 6. Preparation that needs no policy answer (not started)

These are technical and carry no authority. None is built by this document, and none starts before the Owner's order allows it (Finance first).

1. Widen the billing-fact origin from Sales Order only to `SALES_ORDER | WORK_ORDER` with one reference per row. (This needs a new migration.)
2. A `serviceFinancialClass` column and a governed set/correct command, fail-closed (unset = UNBILLABLE), audited.
3. A pure read-side derivation of "service billing readiness" over (terminal state, class, priced facts), mirroring `deriveBillingQueueEntry`, with a named reason for every excluded job.
4. A frozen-fact rule: a billing fact is written once and corrections are new facts.
5. Tests the Owner's 2026-10-20 register requires for F-1 (refusals without a separate approver, void after settlement, original number preserved, a refund creates no payment) extended to the Work Order origin, plus: unclassified work is never billed, a missing price is never zero, a missing tax is never zero.

---

## 7. What this document does not do

- It sets no rate, markup, percentage, minimum, increment, threshold or period.
- It grants no capability and assigns no role; roles named as examples are the Owner's to decide.
- It does not touch `DECISIONS.md`, Firestore Rules, migrations, code or any environment.
- It does not copy or reinterpret historical Firebase invoices (held by Owner ruling).
- It does not decide legal wording for any customer-facing authorization (held for Owner and counsel).
