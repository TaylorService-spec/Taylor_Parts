# CERT-FIN-02 — Inventory Cost & COGS Authority Decision Sheet

> **SUPERSEDED IN FRAMING, 2026-09-03 — Owner ruling: EOS supports POLICY PROFILES, not one method.**
>
> This sheet was written on the premise that EOS must be told which single accounting method to
> implement. That premise is retired. EOS now implements a governed **financial policy profile** per
> operating company: the platform supports and tests several methods, each customer's accounting team
> selects one during deployment, and the choice **locks** when that company's financial authority is
> activated. Changing it afterwards is a separately governed migration that deliberately does not
> exist.
>
> **What that changes about this sheet.** Decisions 1, 2, 3, 6, 7 and 11–14 are no longer asking the
> platform to choose — they are asking **Taylor's accounting team to choose its deployment profile**,
> which is data entered on the Financial Policy screen rather than a code change. Decisions 4, 5, 8,
> 9, 10 and 15 concern platform behaviour and are answered in
> [`../assessments/cert-fin-02-policy-framework-reconciliation.md`](../assessments/cert-fin-02-policy-framework-reconciliation.md).
>
> **The sheet is still unsigned and still worth signing** — Taylor's profile has not been selected.
> But the platform no longer waits on it.

**Status: UNRATIFIED. Every ruling box below is blank, and no implementation is authorized.**

This is the ruling instrument for `CERT-FIN-02`, the last open item from the post-Certification
backlog. Part A is the Owner's decision sheet, recorded verbatim. Part B is an engineering
reconciliation measured against `b61c6931` — for each decision, what EOS already does, what approval
would actually require building, and what it depends on. Part B is **evidence for the signer, not a
recommendation and not an approval.**

Related: [`FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md`](FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md)
(source-by-source cost audit) ·
[`../assessments/post-certification-backlog-reconciliation-2026-09-02.md`](../assessments/post-certification-backlog-reconciliation-2026-09-02.md)
(the backlog disposition) · DECISIONS #164 (the acquisition-cost rulings already in force).

---

# PART A — OWNER DECISION SHEET

Decision package: `CERT-FIN-02`

Purpose: Establish the accounting rules EOS is allowed to implement for inventory value and Cost of
Goods Sold.

## Current EOS position

EOS already records the governed acquisition cost of purchased inventory when it is received.

EOS does not currently:

* calculate authoritative inventory value
* calculate authoritative COGS
* infer missing cost as zero
* choose FIFO, LIFO, weighted average, or another cost-flow method
* capitalize freight or other landed costs
* rewrite historical cost

Those behaviors remain intentionally blocked until the following policies are approved.

## DECISION 1 — PARTS INVENTORY COST METHOD

**Question:** How should EOS determine the cost of interchangeable parts remaining in inventory and
the cost relieved when those parts are sold or consumed?

**Recommended ruling:** Weighted Average Cost — Perpetual. Each governed receipt updates the average
cost of the applicable part inventory pool. When inventory leaves the pool, EOS uses the then-current
weighted-average unit cost.

**Owner ruling:**

- [ ] APPROVED — Weighted Average Cost
- [ ] DIFFERENT POLICY REQUIRED

If different: ______________________________________________

**Why recommended.** Taylor carries many interchangeable parts purchased repeatedly at changing
prices. Weighted average fits perpetual operational inventory; avoids artificial lot-selection
complexity; is easier for users to understand than FIFO layers; works naturally with partial
receipts; supports continuously updated inventory; and avoids pretending a technician or parts
employee selected a particular accounting lot.

## DECISION 2 — EQUIPMENT / HIGH-VALUE IDENTIFIABLE ITEMS

**Question:** Should individually identifiable equipment use the same weighted-average treatment as
interchangeable parts?

**Recommended ruling:** Specific Cost for individually identifiable equipment or serialized/high-value
units when their actual acquisition cost is known — Taylor equipment, ice machines, individually
serialized equipment, other high-value assets that retain a specific procurement identity.
Interchangeable parts remain weighted average.

**Owner ruling:**

- [ ] APPROVED — Specific Cost for identifiable equipment
- [ ] USE WEIGHTED AVERAGE FOR EVERYTHING
- [ ] DIFFERENT POLICY REQUIRED

Notes: ______________________________________________

## DECISION 3 — COST POOL BOUNDARY

**Question:** Across what inventory should average cost be calculated?

**Recommended ruling:** Cost remains partitioned by operating company. Do not blend the cost of
inventory belonging to different operating companies. Within an operating company, physical movement
between internal locations (warehouse, parts room, truck, staging, other company-owned inventory
locations) changes custody/location, not accounting cost.

**Owner ruling:**

- [ ] APPROVED
- [ ] DIFFERENT POLICY REQUIRED

Notes: ______________________________________________

## DECISION 4 — PARTIAL RECEIPTS

**Question:** When only part of a purchase order line arrives, when does cost enter inventory?

**Recommended ruling:** Only the quantity actually received enters inventory value. PO 20 @ $10,
first receipt 10 units ⇒ 10 units received, $100 acquisition cost entering inventory. The remaining
10 on order do not become inventory and do not enter inventory value until actually received.

**Owner ruling:**

- [ ] APPROVED
- [ ] DIFFERENT POLICY REQUIRED

## DECISION 5 — UNKNOWN / UNPRICED RECEIPTS

**Question:** What should EOS do if physical inventory is validly received but authoritative
acquisition cost is not yet known?

**Recommended ruling:** Receive the quantity but preserve cost as UNKNOWN. Never substitute $0. The
quantity may participate in operational inventory. EOS must not claim authoritative inventory
valuation for the affected quantity, COGS derived from the unknown cost, or gross margin dependent
upon that cost, until governed cost is supplied.

**Owner ruling:**

- [ ] APPROVED
- [ ] REFUSE RECEIPT UNTIL COST IS KNOWN
- [ ] DIFFERENT POLICY REQUIRED

Notes: ______________________________________________

## DECISION 6 — FREIGHT-IN / SHIPPING

**Question:** Should inbound freight paid to acquire inventory become part of inventory cost?

**Recommended starting ruling:** Do not automatically capitalize freight at initial launch. Record
the purchased item acquisition cost first. Freight capitalization should activate only when Taylor's
accounting policy provides a reliable, repeatable allocation method. This avoids inventing arbitrary
per-item allocations.

**Owner / Accountant ruling:**

- [ ] EXCLUDE FREIGHT FROM INVENTORY COST
- [ ] CAPITALIZE FREIGHT — allocation method below
- [ ] DECISION DEFERRED — keep outside authoritative inventory valuation for now

Allocation rule if applicable: ______________________________________________

## DECISION 7 — OTHER LANDED COSTS

How should these affect inventory value?

**Vendor / purchasing fees**

- [ ] Include in inventory cost
- [ ] Expense separately
- [ ] Depends — policy below

**Customs / duties**

- [ ] Include in inventory cost
- [ ] Expense separately
- [ ] Depends — policy below

**Other inbound costs** — Policy: ______________________________________________

**Recommended implementation principle.** EOS should not invent allocation rules. Only costs with an
approved accounting treatment and deterministic allocation method should modify governed inventory
cost.

## DECISION 8 — REBATES / VENDOR CREDITS

**Question:** What happens when Taylor receives a later vendor rebate, credit, discount, or purchasing
adjustment related to inventory already received?

**Recommended ruling:** Do not rewrite the original receipt. Create a separate governed cost
adjustment linked to the underlying purchase/receipt evidence. Accounting policy must determine
whether the adjustment affects inventory still on hand, COGS already recognized, or another
accounting account/treatment.

**Owner / Accountant ruling:**

- [ ] APPROVED — additive adjustment model
- [ ] ORIGINAL COST MAY BE REWRITTEN
- [ ] DIFFERENT POLICY REQUIRED

Notes: ______________________________________________

## DECISION 9 — COST CORRECTIONS

**Question:** What happens when the original recorded acquisition cost was simply wrong?

**Recommended ruling:** Historical financial facts remain historical. Corrections are
additive/superseding governed facts rather than silent edits. A correction should record: original
fact; correction amount or replacement fact; reason; evidence/reference; user; timestamp; operating
company; affected inventory/financial treatment.

**Owner / Accountant ruling:**

- [ ] APPROVED
- [ ] HISTORICAL COST MAY BE DIRECTLY EDITED
- [ ] DIFFERENT POLICY REQUIRED

Who may authorize a correction? ______________________________________________

Required evidence: ______________________________________________

## DECISION 10 — RETROACTIVE COST CHANGE

**Question:** If authoritative cost arrives after inventory has already moved or been sold, should
EOS recalculate prior accounting outcomes?

**Recommended ruling:** Do not silently rewrite previously recognized history. A later cost should
create a governed adjustment according to accounting policy. Whether that adjustment modifies current
inventory value, prior/current-period COGS, gross margin, or another financial account must be
explicitly defined.

**Owner / Accountant ruling:**

- [ ] APPROVED — adjustment rather than silent historical rewrite
- [ ] RETROACTIVE RECALCULATION REQUIRED
- [ ] DIFFERENT POLICY REQUIRED

Treatment: ______________________________________________

## DECISION 11 — COGS RECOGNITION POINT

**Question:** At what business event should inventory cost become Cost of Goods Sold? This must
distinguish physical movement from an actual sale/consumption event.

**Recommended ruling:** COGS should be recognized only when an authoritative business transaction
establishes that inventory has been consumed/sold — not merely because it moved locations. Examples
that should **not** by themselves create COGS: warehouse → truck transfer; warehouse → staging; bin
relocation; cycle-count adjustment; receipt. The accountant must confirm which Taylor transactions
constitute the accounting recognition event.

**Owner / Accountant ruling — COGS recognition event(s):** ______________________________________________

## DECISION 12 — SERVICE / WORK ORDER PARTS

**Question:** When a technician consumes a part during service, when does its cost become COGS or
another expense?

**Accountant ruling required:**

- [ ] On governed part consumption against the work order
- [ ] On invoice
- [ ] On work-order completion
- [ ] Other: ______________________________________________

This decision must not be inferred from inventory movement alone.

## DECISION 13 — SALES OF PARTS

**Question:** When should COGS be recognized for a normal parts sale?

**Accountant ruling required:**

- [ ] At shipment / fulfillment
- [ ] At customer pickup
- [ ] At invoice
- [ ] At another governed event: ______________________________________________

## DECISION 14 — EQUIPMENT SALES

**Question:** When should the specific cost of sold equipment become COGS?

**Accountant ruling required:**

- [ ] At delivery
- [ ] At installation / acceptance
- [ ] At invoice
- [ ] At another governed event: ______________________________________________

## DECISION 15 — NEGATIVE INVENTORY

**Question:** What happens if operational activity temporarily creates a negative quantity?

**Recommended ruling:** Do not fabricate accounting cost to make the mathematics work. EOS should
surface the inventory exception. The accountant must determine how valuation/COGS behaves until the
quantity discrepancy is reconciled.

**Owner / Accountant ruling:** ______________________________________________

## DECISION 16 — OPENING INVENTORY / MIGRATION

Before EOS becomes financially authoritative, existing Taylor inventory will require an opening cost
basis.

**Required decision:** How will opening inventory value be established? Potential sources: existing
accounting system; existing inventory system; verified item-level cost; approved
conversion/migration procedure.

Source of authoritative opening inventory cost: ______________________________________________

Effective conversion date: ______________________________________________

Historical uncertainty must remain identifiable; migration must not convert unknown historical cost
into invented precision.

## RECOMMENDED BASELINE FOR APPROVAL

Unless Taylor's accountant requires otherwise, the proposed EOS accounting model is:

1. Perpetual inventory
2. Weighted-average cost for interchangeable parts
3. Specific cost for identifiable/serialized high-value equipment
4. Operating-company-separated cost pools
5. Internal inventory transfers do not change cost
6. Only received quantity enters inventory
7. UNKNOWN cost remains UNKNOWN, never $0
8. No automatic freight/landed-cost capitalization until an allocation policy is approved
9. Historical cost facts are immutable
10. Corrections use governed adjustment/superseding facts
11. No silent retroactive financial rewriting
12. COGS occurs only at an approved sale/consumption recognition event
13. EOS must refuse to calculate authoritative margin when required cost authority is missing

## ACCOUNTANT SIGN-OFF

Reviewed by: ______________________________________________

Date: ______________________________________________

Approved with changes: ______________________________________________

## OWNER RULING

- [ ] APPROVED AS WRITTEN
- [ ] APPROVED WITH ACCOUNTANT CHANGES ABOVE
- [ ] NOT APPROVED — REVISE

Owner: ______________________________________________

Date: ______________________________________________

**Implementation boundary.** Approval of this sheet authorizes EOS design/implementation only for the
explicitly approved policies. It does not authorize production deployment, historical data migration,
opening-balance conversion, or modification of frozen Certification evidence.

---

# PART B — ENGINEERING RECONCILIATION (measured against `b61c6931`)

Not a recommendation. This is what the code does today, so that a signature lands on facts.

## B.1 Seven of the thirteen baseline items are ALREADY IN FORCE

These need ratification, not construction. Each is asserted by a test that fails if it erodes.

| Baseline item | Already true | Evidence |
|---|---|---|
| 4 — operating-company-separated cost pools | **YES**, for the cost fact | `operatingCompanyId` required, never inferred from warehouse/vendor/SKU/user/customer; DECISIONS #164 ruling 12; *"Taylor and Ventana cost facts stay distinguishable"* |
| 5 — internal transfers do not change cost | **YES** | ruling 19; *"transfers, picks and adjustments still cannot create acquisition cost"* |
| 6 — only received quantity enters inventory | **YES** | ruling 10; *"a partial receipt records cost for the quantity RECEIVED, not the quantity ordered"* |
| 7 — UNKNOWN stays UNKNOWN, never $0 | **YES** | a line with no governed price produces **no fact at all**; *"NEITHER field present is UNPRICED — null, which is not an error and is not zero"* |
| 8 — no freight/landed-cost capitalization | **YES** | ruling 14; *"freight, duty, tax and burden are excluded from v1 — no landed-cost allocation exists"* |
| 9 — historical cost facts immutable | **YES** | ruling 11; *"a cost fact is FROZEN — a caller cannot mutate one into a different number"* |
| 13 — refuse margin without cost authority | **YES** | `deriveGrossMargin` returns UNKNOWN; *"nothing converts an acquisition fact into a GovernedCostFact"* |

**Consequence for Decisions 3, 4, 5, 6, 7:** approving them ratifies shipped behaviour. Approving the
*alternative* on Decision 5 ("REFUSE RECEIPT UNTIL COST IS KNOWN") would be a **behaviour change**,
not a ratification — it would make an unpriced legacy PO unreceivable and block a physical workflow
on a financial field. Flagging that asymmetry, not arguing it.

## B.2 What each unbuilt decision would actually cost

| Decision | State today | What approval requires |
|---|---|---|
| **1 — weighted average** | **NOT BUILT.** Acquisition cost is a per-receipt-line immutable document. There is **no cost-pool state anywhere** — nothing holds a running average, and no collection is a candidate | A new governed running-balance authority per (operatingCompanyId, partId): pool quantity + pool value, updated in the receipt transaction, read at relief. It is a **new stateful financial record**, the first in EOS, with its own Rules, idempotency and correction path. This is the largest item on the sheet by a wide margin |
| **2 — specific cost for serialized** | **Derivable today; not stored.** `serialized_assets` carries `partId` + `activatedByReceivingId` (`serializedAssetRegistration.ts`); the cost fact carries `partId` + `receivingId` + `unitPriceMinor`. Joining on (receivingId, partId) yields a serial's actual acquisition cost **with no new field and no Rules change** | Only a read-side resolver — *if* one gap is closed: two lines on the same receipt for the same `partId` at different prices make the join ambiguous. Either forbid that at receipt, or record `receivingLineId` on the asset. `serialized_assets` has a fail-closed field allowlist (`VALUE_FIELDS`, `serializedAsset/types.ts:109`), so adding a field is a governed contract change; the join needs neither |
| **8 — rebates / vendor credits** | **NOT BUILT.** *"returns and rebates remain OPEN — no cost reversal or restoration exists"* | A new additive cost-adjustment fact type. Depends on Decision 11 to know whether it lands against on-hand value or recognized COGS |
| **9 — cost corrections** | **Partly.** Immutability is enforced; ruling 11 says corrections must be additive and that the **authority is OPEN** — nobody is named | The two blanks on the sheet (*who may authorize*, *required evidence*) are the whole decision. Once named, the mechanism is the same additive fact as Decision 8 |
| **10 — retroactive cost change** | **NOT BUILT**, and cannot be, without 11 | Depends entirely on Decision 11: "recalculate prior COGS" is meaningless until COGS exists |
| **11–14 — COGS recognition** | **NOT BUILT AT ALL.** `COST` is deliberately **not** a member of `FINANCIAL_SOURCE_TYPES` (`financialAttribution.ts:42` — SALES_AGREEMENT, SALES_ORDER, SALES_ORDER_LINE, WORK_ORDER, INVOICE, PAYMENT, ADJUSTMENT, REFUND). Adding it is the act that creates COGS | See B.3 — Decision 12 has a hard prerequisite |
| **15 — negative inventory** | **The exception is currently INVISIBLE.** Both on-hand readers clamp: `Math.max(onHand, 0)` (`cycleCountExpectedQuantity.ts:57`) and *"floored at 0 so a malformed ledger can never produce negative sellable stock"* (`fulfillmentAvailability.ts:83`) | Correct for an *availability* figure — you cannot sell negative stock — but it means EOS **cannot today detect the condition this decision is about**. Surfacing it needs a separate unclamped signal; the clamp on the sell-side figure should stay |
| **16 — opening inventory / migration** | **OUT OF SCOPE for any in-repo work.** Historical data migration and opening-balance conversion are excluded by this sheet's own implementation boundary | An Owner-run migration under separate authorization. Not implementable from an approval of this sheet |

## B.3 The hard prerequisite on Decision 12

**A part consumed on a Work Order does not remove physical stock today.** `inventoryService.ts:33`
states it directly: *"NOTHING REMOVES CONSUMED STOCK FROM PHYSICAL"*. Receive 5, consume 2, and
governed on-hand still reads 5 — pinned by `functions/test/inventoryConsumptionOnHandGap.test.mjs`
and `functions/test/consumptionCustodyBoundary.test.mjs`.

That defect has its own open Owner package —
[`../assessments/physical-consumption-location-authority.md`](../assessments/physical-consumption-location-authority.md),
classified `OWNER_LOCATION_AUTHORITY_REQUIRED`. It found that everything needed already exists and is
governed **except one fact: which location a CONSUMED quantity left.**

**So Decision 12 cannot be implemented before that ruling lands**, whichever option is chosen. "On
governed part consumption against the work order" has no governed physical event to attach to; "on
invoice" or "on work-order completion" would recognize COGS for stock the system still believes is on
the shelf. The two decisions should be ruled on together, or Decision 12 explicitly sequenced after.

## B.4 Suggested ruling order

Nothing here is a recommendation about *what* to rule — only about sequence, so that no ruling is made
on a foundation that a later one moves.

1. **Ratify B.1** (Decisions 3, 4, 5, 6, 7 and baseline 9/13). Costs nothing, is already true, and
   locks in what the guards already protect.
2. **Decision 11** — the COGS recognition point. Everything unbuilt depends on it: 8, 10, 12, 13, 14
   are all unanswerable without it.
3. **The consumption-location ruling** (separate package), which unblocks Decision 12.
4. **Decision 1** — the cost method, and the largest build. Worth ruling only once 11 defines what the
   pool is relieved *for*.
5. **Decisions 2, 8, 9, 10, 14, 15** — each small once the above are settled.
6. **Decision 16** — migration, last and separately authorized.

## B.5 What remains blocked until this sheet is signed

`CERT-FIN-02` stays `OPEN — AUTHORITY`. No valuation, no COGS, no cost-flow method, no landed-cost
allocation, no cost adjustment and no margin. The guards holding that line —
`functions/test/costAuthorityAbsence.test.mjs` and the "no speculative costing method is
pre-registered" assertion in `functions/test/acquisitionCost.test.mjs` — stay in force and were not
weakened by recording this sheet.
