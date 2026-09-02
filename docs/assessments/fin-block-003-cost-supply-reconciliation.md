# FIN-BLOCK-003 — Cost Supply / Inventory Valuation Reconciliation

**Status:** ASSESSMENT ONLY. No costing method adopted, no valuation policy chosen, no cost fact
created, no metric activated, no capability granted, no deployment. Measured 2026-09-02 against
`225052f3`.

**Result: CASE D — NO GOVERNED COST SUPPLY.** EOS has no governed cost fact. It is not partially
present and it is not in conflict with itself: the platform refuses to fabricate cost in several
independent places, deliberately and with tests. That is a healthy state, not a hole.

**What this reconciliation adds** is the guard the finding had been missing
(`functions/test/costAuthorityAbsence.test.mjs`) and one stale-documentation correction. The
authority gap itself is unchanged, because closing it requires an Owner accounting ruling that this
package was explicitly forbidden from making.

---

## 0. Three questions kept separate

The whole assessment turns on not collapsing these:

| | Question | Status |
|---|---|---|
| **1. COST SUPPLY** | What did the item or service actually cost, per governed evidence? | **ABSENT** |
| **2. VALUATION POLICY** | Which cost does reporting assign to units on hand? | **ABSENT** |
| **3. COGS / MARGIN RECOGNITION** | When does cost leave inventory and become cost against revenue? | **ABSENT** |

A repository can have one without the others. EOS has none of the three — but they fail for
*different* reasons, and a single ruling would not close all three.

---

## 1. Cost census

| Cost family | Source | Writer | Value type | Company | Location | Historical | Currency | Classification | Consumers | Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| Supplier quoted cost | `part_supplier_items.cost` | `createPartSupplierItem` / `updatePartSupplierItem` (trusted, `inventory.catalog.manage`) | **decimal STRING**, ≤4dp | no | no | **overwritten in place**; version increments, prior value not preserved | `currency`, required ISO-3 | **QUOTED_PRICE** — a term, not a cost event | gated read projection only (`inventory.catalog.cost.read`) | not a cost event; unlinked to any receipt |
| Canonical PO line price | `purchase_orders` → `PurchaseOrderLineItem.unitPrice` | `procurementService.createPurchaseOrder` | **float** (`number`), no currency | no | no | n/a | none | **LEGACY / dead** — writer has no caller; collection measured 0 documents | none | unwired; Epic-5 scaffolding |
| Canonical PO total | `purchase_orders.totalCost` | same | float | no | no | n/a | none | **LEGACY / dead** | none | as above |
| Supplier catalog price | `SupplierCatalogItem.unitPrice` | none in repo | float | no | no | n/a | none | **LIST_PRICE**, unwired | `procurementBridge` in-memory estimate only | never persisted |
| Reorder PO (the LIVE one) | `reorder_purchase_orders` | `recordReorderPurchaseOrder` (trusted) | **no money field at all** | **yes**, governed | no | immutable by Rules | n/a | **GOVERNED_INPUT_BUT_NOT_COST_AUTHORITY** | receiving | carries no cost |
| Receipt | `receiving_orders` / receipt lines | `receiveInventoryStock` (trusted, live) | **no money field at all** | no | `receivingLocation` | append-only | n/a | **GOVERNED_INPUT_BUT_NOT_COST_AUTHORITY** | ledger | carries no cost |
| Inventory ledger | `inventory_transactions` | `writeLedgerEntry` / `stageOperationalMovement` | **no money field at all** | **no** | schema-2 rows only | append-only | n/a | **GOVERNED_INPUT_BUT_NOT_COST_AUTHORITY** | balance projections | quantity only |
| Part `unitCost` | client metadata definition | none — no backing data | `CURRENCY_MINOR` (declared) | n/a | n/a | n/a | n/a | **PRESENTATION_ONLY, blocked** | none | `displayable`/`reportable`/`exportable` all false (ND-27) |
| Static catalog cost | `data/partsCatalog.ts` `.cost` | none — a checked-in table | float | no | no | n/a | none | **FIXTURE** | only `warehouseQty` is read; `.cost` reaches a shadow-parity diagnostics surface tagged `STATIC_FALLBACK` | synthetic data, no authority |
| Truck inventory value | `truck.metrics.inventoryValue` | none — registry emits `null` | pre-formatted string | n/a | n/a | n/a | n/a | **PRESENTATION_ONLY** | `TruckFleetCard` renders a dash | no valuation authority feeds it |
| Labour | `workOrderLabor` entries | `recordWorkOrderLabor` (trusted) | duration minutes | n/a | n/a | append-only | n/a | **GOVERNED_INPUT_BUT_NOT_COST_AUTHORITY** | operational | **records hours; refuses rate, cost and billable by design** |
| Governed cost fact | `costMargin.ts` `GovernedCostFact` | **none — zero producers** | `costMinor` integer | — | — | — | required | **the shape a cost fact must have** | `deriveGrossMargin` only | nothing constructs one |

**Searched and confirmed ABSENT everywhere** — no field, no writer, no type: `standardCost`,
`averageCost`, `weightedAverageCost`, `movingAverageCost`, `actualCost`, `purchaseCost`,
`acquisitionCost`, `invoiceCost`, `landedCost`, `freight`, `duty`, `burden`, `laborCost`,
`materialCost`, `vendorCost`, `replacementCost`, `costOfGoodsSold`, `cogs`, `bookValue`,
`extendedCost`, `carryingCost`, and any carrying/holding/shrink/obsolescence rate.

---

## 2. Path by path

**Purchase order.** Two systems share the name and neither supplies cost. The LIVE one
(`reorder_purchase_orders`, Rules-immutable, `operatingCompanyId` governed and refused if
client-supplied) carries `orderedQuantity` and **no money field of any kind**. The canonical
multi-line `purchase_orders` does carry `unitPrice`/`totalCost` — as **floats, with no currency** —
but its writer `procurementService.createPurchaseOrder` **has no caller anywhere in the repository**,
the collection was measured at **0 documents**, and Rules close it to all client writes. It is
scaffolding, not a cost supply.

**Receiving.** Live and deployed. The receipt, the ledger event and the audit event each carry
quantity, part, location, actor and time. **No monetary value at any layer.** Partial receipts are
fully supported and there is no per-receipt cost to retain, because there is none to begin with. No
freight, duty, burden or landed-cost allocation exists. **No vendor invoice record exists** distinct
from the PO.

**Inventory ledger.** `InventoryTransaction` is `{ id, workOrderId, partId, type, quantity,
timestamp, trackingMode? }`. **There is no cost field on the ledger.** The newer operational-movement
shape is likewise quantity/location/actor/time. The balance projection returns quantities only.

**Transfers.** A transfer moves quantity between locations and nets to zero across the pair. It
carries no cost, so it cannot carry one forward, recompute one, or create one. **A transfer cannot
create value because there is no value to create** — which is a stronger guarantee than a rule
forbidding it.

**Adjustments.** Quantity-only and signed. Cycle-count reconciliation requires a *reason string* for
a non-zero variance; nothing converts a counted variance into money. There is no value adjustment and
no cost-correction type.

**Consumption — the COGS gap.** When a Work Order consumes parts, the ledger write is
`{ workOrderId, partId, type: "CONSUMED", quantity, timestamp }`. **No cost is recorded on the
consumption event.** This is the single most consequential absence: consumption is where cost would
leave inventory and become cost against revenue, and the event carries nothing to carry.

**Returns.** Intake writes a return record with **no cost field**, and deliberately writes **no
ledger event** — because doing so at intake would be the automatic restock Decision #118 forbids.
Returns disposition remains an open authority; **no cost restoration or reversal semantics exist**,
and none were inferred here.

**Sales / billing.** An invoice line is revenue-only: `unitPriceMinor`, `subtotalMinor`,
`discountMinor`, `taxMinor`, `lineTotalMinor` — **no cost, no margin**. `FINANCIAL_SOURCE_TYPES` has
**no COST member**, so a cost fact cannot enter FIN-002 attribution at all; the type refuses it at the
door. The governed reporting read serves only INVOICE / PAYMENT_RECEIPT / PAYMENT_APPLICATION, and a
test greps its own source for `costMinor`/`marginMinor` to keep it that way.

**Service cost.** The labour domain records **work performed only** — duration, labour type
(ONSITE/TRAVEL), work date. Its own header names the three facts it refuses to collapse: work
performed, billable labour, and labour cost. There is no rate, no billable flag, no employee
compensation, no burden. No subcontractor cost and no warranty cost exist anywhere; travel exists as
an hours *type*, never a cost.

---

## 3. Cross-cutting properties

**Currency.** Required and never defaulted on every governed financial derivation — `costMargin`,
`financialAttribution` and `planVsActual` each throw `CURRENCY_REQUIRED`. No hardcoded `"USD"` was
found in any finance core, and the reporting read keeps money **per currency, never summed across**.
The only cost-like field with a currency is the supplier quote. Everywhere else there is no currency
because there is no money. **Current governed scope is effectively USD-only by data, not by
assumption in code.** No FX exists and none was built.

**Money representation.** Integer minor units, enforced by `Number.isSafeInteger` checks across every
governed money path. **One exception:** `part_supplier_items.cost` is a decimal string, and the
dormant Epic-5 PO uses floats. Neither is authoritative; the decimal string is a *deliberate*
procurement convention ("never floats"), and the float path is dead. **No floating-point money
arithmetic was introduced by this package, and none was removed** — changing the dead float path
would be redesign without a ruling.

**Negative money.** Structurally disallowed as a *sign*. `CREDIT_MEMO`, `DEBIT_CHARGE` and `WRITE_OFF`
all validate `amountMinor` as a **positive** integer; direction is carried by the TYPE, and the
outstanding formula subtracts credits and write-offs and adds charges. This is a deliberate model —
"distinct concepts, not one generic negative payment" — and it means a future negative cost fact
(a rebate, a return credit) would need its own type rather than a minus sign.

**Company attribution.** `operatingCompanyId` is governed on `reorder_purchase_orders` and refused
from client input. It is **absent from `purchase_orders`, `receiving_orders`, `part_supplier_items`
and every inventory ledger row.** A Part carries no operating company or line of business. So even if
a cost fact existed, most of the paths that would carry it could not attribute it to Taylor or
Ventana today.

**Historical cost.** The critical property, and the answer is stark: **there is no historical cost,
because there is no cost.** The nearest thing, the supplier quote, is **overwritten in place** on
update — the version counter increments and an audit event names *which fields* changed, but the
prior value is not preserved in a reconstructable form. `contractStart`/`contractEnd` date the
contract term, not the cost. **A current supplier quote could not truthfully price a transaction from
six months ago**, and nothing in the repository claims it can.

---

## 4. Classification of each blocked figure

| Figure | Status | The blocker that actually survives |
|---|---|---|
| **Inventory value** | **UNAVAILABLE** | Quantity authority exists; valuation-unit-cost authority does not. Company attribution is absent from the ledger. As-of behaviour and missing-cost behaviour are undefined because there is no cost to be missing. |
| **Inventory turns** | **UNAVAILABLE** | Neither term is defined. Turns is a ratio of a flow (COGS over a period) to a level (average inventory value); **both are absent**, and there is no periodic inventory snapshot of any kind to supply the level. G-05 now supplies the period — that was never the binding constraint. |
| **Carrying cost** | **UNAVAILABLE** | **No governed carrying rate exists** — no cost of capital, storage, insurance, shrink or obsolescence rate anywhere. Inventing an industry-standard percentage is expressly refused. |
| **Gross / product / parts / equipment margin** | **UNAVAILABLE** | `deriveGrossMargin` is correct and unconsumed: it returns UNKNOWN whenever a revenue line has no matched governed cost fact, and **no producer of a cost fact exists**, so every real invocation is UNKNOWN. |
| **Service margin** | **UNAVAILABLE** | Labour records hours and refuses rates. Deriving it from hours × a guessed rate is refused. FIN-BLOCK-002 (service billing) is separately open. |
| **COGS** | **ABSENT** | No COGS concept exists in any form, and the consumption event carries no cost to recognise. |
| **Waste avoided** | **UNAVAILABLE** | Three missing pieces, and cost is only one: no **prevention event**, no **cost basis**, and no stated **counterfactual**. Closing FIN-BLOCK-003 alone would not close this. |
| **Unit cost / extended cost** | **UNAVAILABLE** | The Part metadata field is blocked `displayable`/`reportable`/`exportable` together (ND-27, CLOSED — refuse display). |
| **Business-impact / savings metrics** | **UNAVAILABLE** | Every candidate is cost-dependent. |

---

## 5. Dashboard and metric-registry implications

**No metric changed status.** Re-measured after this pass: **37 registered, 12 active, 25 blocked** —
identical to the state G-05 left. That is the correct outcome: this reconciliation resolved no cost
authority, so no cost-dependent metric could become measurable.

The four metrics declaring a `COST` financial basis remain blocked and each still names its real
blocker: `inventory.value.amount`, `inventory.turns.ratio`, `inventory.carryingCost.amount`,
`inventory.wasteAvoided.amount`. `inventory.accuracy.rate` remains blocked for its own reasons
(activation plus an undefined rate population), of which cost is only one possible option.

Dashboard modules: `costImpact` remains **UNAVAILABLE** with all three of its missing pieces named on
screen. Nothing became AUTHORITY_READY.

---

## 6. What this run changed

**Fixed — permitted without a ruling:**

1. **A stale header that would have misdirected this very assessment.**
   `receiveInventoryStockCommand.ts` claimed to be "INERT, UNEXPORTED… NOT exported from
   `functions/src/index.ts`; no callable; production-inert (no caller)". That described Phase B and
   became false when Phase C wired it — the callable is defined in `receivingCallables.ts` and
   exported from `index.ts`. A reader asking "could receiving carry a cost fact?" would have read
   that header, concluded the path was not live, and stopped. It **is** live and records **no cost**,
   which is a materially different finding from "the path does not run".

2. **A guard over the measured absence** — `functions/test/costAuthorityAbsence.test.mjs`, 14 cases,
   routed into the existing finance CI lane along with the source paths it asserts about. It proves
   the ledger carries no money, a transfer and an adjustment cannot manufacture cost, the labour entry
   carries no rate, `COST` is not a financial source type, no COGS concept exists, the supplier quote
   is structurally unusable as a cost fact, no receiving path reads it, and — the central finding —
   **nothing in `functions/src` constructs a `GovernedCostFact`.**

**Deliberately NOT changed:** the dead Epic-5 float price path (retiring or converting it is Owner
decision 2 below), the supplier quote's decimal-string convention, any metric status, any capability,
any FIN-004 scope.

---

## 7. Open Owner decisions

The existing decision package (`docs/financials/FIN-BLOCK-003_COST_AUTHORITY_DECISION_PACKAGE.md`)
already frames four in dependency order, and this reconciliation confirms them against current code
rather than replacing them. Restated with what measurement adds:

1. **Basis vocabulary and admissibility per domain.** Which `costBasis` labels are legal, per domain.
   One method need not govern all — parts, serialized equipment and labour can differ.
2. **Capture point, and the fate of the Epic-5 price layer.** Is the dormant `purchase_orders` price
   layer the intended feed for receipt-time cost capture, or scaffolding to retire? *Measurement adds:*
   it is floats with no currency and no `operatingCompanyId`, so adopting it as-is would import three
   defects into the cost authority.
3. **Labour cost policy.** Whether labour cost enters v1 at all; if so, which rate authority (per-tech
   wage vs burdened standard per role) and where it lives — explicitly not on the Part and not on the
   labour entry.
4. **ND-27 valuation authority.** Whether inventory *valuation* is ever an EOS concern at all, or
   belongs to the external accounting authority of record (DECISIONS #145). **Margin needs cost
   EVENTS, not a valuation engine** — decidable separately, and the cheaper of the two.

**What measurement adds as a fifth, which the package does not currently name:**

5. **Company attribution on the cost path.** `operatingCompanyId` is absent from `purchase_orders`,
   `receiving_orders`, `part_supplier_items` and every inventory ledger row. Whatever cost authority is
   chosen, a Taylor-vs-Ventana cost figure needs a governed lineage that does not exist today, and it
   cannot be inferred from warehouse, vendor, SKU, user or customer.

---

## 8. Non-closures

- FIN-BLOCK-003 remains **OPEN**. Nothing here closes it and nothing here narrows it.
- **Returns disposition** remains a separate open authority; no cost restoration or reversal semantics
  were created or inferred.
- **FIN-BLOCK-002** (service billing rate/policy) remains open and is a prerequisite for service margin.
- **FIN-BLOCK-004** (intercompany elimination) remains open and is unaffected.
- **DECISIONS #145** (the external accounting authority of record) remains open and is entangled with
  Owner decision 4.
- No FX policy, no landed-cost allocation, no carrying-cost rate, no margin policy was created.
