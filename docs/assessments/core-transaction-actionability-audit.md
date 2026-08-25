# Core transaction actionability — artifact-grounded audit

**Slice 1 of the package. Audit only; nothing implemented.** Source-verified against `main`
`d03f004c`.

---

## BLOCKER, stated first

**The five Taylor artifacts are not available to me.** Not in the repository, not in this session,
not on disk under any matching name:

```
Service Invoice WO38957-1                    NOT FOUND
Signed Sales & Security Agreement / Quote    NOT FOUND
Sales Order / Invoice for order 239164       NOT FOUND
Pick Ticket for order 239164                 NOT FOUND
Sales Order Excel workbook + Site Survey     NOT FOUND
```

`git ls-files` returns no `.pdf/.xlsx/.docx/.png` anywhere in the tree, and nothing matches `38957`,
`239164`, `pick ticket`, `site survey` or `security agreement`.

**What that changes.** The *EOS side* of the matrix below is fully source-verified — definitions,
commands and callables read directly. The *artifact side* is taken from **the field lists enumerated
in the package text itself**, not from reading the documents. Those are not the same quality of
evidence and I will not present them as if they were.

Two sections cannot be attempted at all, because each explicitly requires deriving a field set from
a document:

- **§G service measurements** — the list ends "…and other equipment-specific measurements". That
  open tail *is* the design input.
- **§K site survey** — "Derive its real field set from the workbook and classify it."

Everything else below stands on its own evidence.

---

## The five authority gaps that matter

Ordered by how much of the lifecycle they block.

### 1. A service invoice has no path to exist

`IssueInvoiceInput` requires **`salesOrderId: string`** — not optional — and every line is
cross-checked against a Sales Order line (`SALES_ORDER_LINE_NOT_FOUND`, `PRICE_MISMATCH`).

**A Work Order cannot be invoiced.** There is no route from a completed service call to money.
`WO38957-1` is exactly that document, and no object in EOS can produce it.

This sits upstream of §F, §G, §H and §M — all of which describe facts belonging on a service invoice
that cannot currently be issued.

**Decision required:** does a service call create a Sales Order, or does invoicing gain a second
anchor? Financial Architecture, not a field.

### 2. There is no Quote / Agreement authority

Opportunity carries **10 fields**: `opportunityNumber, stage, outcome, salesChannel, expectedValue,
expectedCloseAt, need, accountId, ownerEmployeeId, salesOrderId`.

`expectedValue` is a single forecast number. There is **no** buyer contact, site contact, customer
PO, lease flag, ship-via, deliver/install, line pricing, warranty, trade-in, down payment, tax, or
acceptance/signature.

So §C resolves cleanly from source: **no governed authority owns commercial commitment.** The
Agreement is not a view of something that already exists.

**Decision required:** the smallest correct object, and with it the definition of what a CONFIRMED
Sales Order means.

### 3. CONFIRMED Sales Orders can be unpriced — measured, not theorised

```
salesOrderCommands.ts   unitPrice OPTIONAL ("optional passive pricing snapshot")
                        creation goes straight to CONFIRMED
invoiceCommands.ts      refuses an unpriced line (UNPRICED)
sandbox                 7 of 14 CONFIRMED orders carry NO unitPrice on any line
```

The system lets you commit to an order it will later refuse to bill.

Fully specified, needs no artifact, proven symptom. **Not implemented here** because §A gates
implementation on the matrix, and because closing it changes a governed write contract and strands
7 existing records — which §D correctly routes to a separate normalization plan, since inventing
prices is the one thing that must not happen.

### 4. A Work Order cannot say which machine it is about

Registered already as `WORK_ORDER_CARRIES_NO_EQUIPMENT_REFERENCE`. `types/workOrder.ts` declares
`customerId` and `locationId` and **no equipment reference at all**.

The service invoice identifies make / model / serial / install date *before* service begins. That is
unanswerable from a Work Order today.

The INSTALL direction already works: `workOrderInstallCommand` takes `workOrderId +
serializedAssetId` and yields an `equipmentId`. So §E's INSTALL case is **already modelled** — what
is missing is SERVICE / PM / WARRANTY / INSPECTION, where the equipment exists first.

### 5. Fulfillment has no pick / shipment authority

`allocateSalesOrder` allocates and **explicitly refuses to assign serials** — serialized availability
is fail-closed UNKNOWN by design in that slice. No object holds bin/shelf, UOM, qty picked, qty
shipped, backorder, ship-via or shipment date.

The Pick Ticket has no counterpart, and §I's lineage breaks between allocation and shipment.

---

## Matrix — artifact fact to EOS authority

Status vocabulary is the package's. **Artifact side = package text, not the documents.**

### Commercial commitment (§C)

| fact | EOS object | stored | write authority | status |
|---|---|---|---|---|
| account | Opportunity / SO `accountId` | yes | governed | EXISTING_AUTHORITY |
| billing address | Account `billingAddress` | yes | `updateAccount` | EXISTING_AUTHORITY |
| install location | Location | yes | client-direct | EXISTING_AUTHORITY |
| buyer contact | Contact | yes | client-direct | EXISTING_NOT_SURFACED |
| site contact | — | no | — | MISSING_AUTHORITY |
| national-account indicator | — | no | — | MISSING_AUTHORITY |
| customer PO | SO `customerPO` | yes | `createSalesOrder` | EXISTING_AUTHORITY |
| lease yes/no | — | no | — | MISSING_AUTHORITY |
| salesperson | SO `ownerEmployeeId` | yes | governed | EXISTING_AUTHORITY |
| shipping instructions / ship via | — | no | — | MISSING_AUTHORITY |
| deliver / install / both | — | no | — | MISSING_AUTHORITY |
| line quantity | SO line `orderedQty` | yes | governed | EXISTING_AUTHORITY |
| manufacturer / model | SO line `kind=EQUIPMENT_MODEL` + `ref` | yes | governed | EXISTING_AUTHORITY |
| condition | — | no | — | MISSING_AUTHORITY |
| estimated arrival | — | no | — | MISSING_AUTHORITY |
| sell price | SO line `unitPrice` | yes, **OPTIONAL** | governed | EXISTING_AUTHORITY *(incomplete — gap 3)* |
| extended total | `extendedMinor` | projected | — | DERIVED |
| warranty | — | no | — | MISSING_AUTHORITY |
| subtotal / tax / total | Invoice `*Minor` | invoice only | `issueInvoice` | MISSING_AUTHORITY *on the order* |
| shipping / install charge | — | no | — | MISSING_AUTHORITY |
| down payment / trade-in / balance | — | no | — | MISSING_AUTHORITY |
| agreement date / acceptance | — | no | — | MISSING_AUTHORITY |

### Service execution (§F)

| fact | EOS | status |
|---|---|---|
| complaint / diagnosis / resolution | `WorkOrder.complaint/diagnosis/resolution` | EXISTING_AUTHORITY |
| technician | `assignedTechId` | EXISTING_AUTHORITY |
| lifecycle timestamps | `dispatchedAt … closedAt` | EXISTING_AUTHORITY |
| labor hours | `laborHours` | EXISTING_AUTHORITY |
| planned parts | `partsPlan` + `setWorkOrderPartsPlan` | EXISTING_AUTHORITY |
| travel start / duration | — | DERIVABLE from `enRouteAt` → `arrivedAt`; must not be duplicated |
| time in / time out | — | DERIVABLE from `arrivedAt` / `completedAt`; must not be duplicated |
| truck | Truck registry exists, no WO link | MISSING_AUTHORITY |
| recall reference | — | MISSING_AUTHORITY |
| service contract flag | — | MISSING_AUTHORITY |
| customer authorization + title | — | MISSING_AUTHORITY |
| PO on a service call | — | MISSING_AUTHORITY |
| payer / who-pays | — | MISSING_AUTHORITY |
| manufacturer warranty responsibility | — | MISSING_AUTHORITY |

### Parts actually used (§H)

`WorkOrder.inventorySnapshot[].qtyUsed`, written by `updateWorkOrderExecutionData` as additive,
idempotency-keyed deltas. It is a **record of intent, not an inventory movement** — the source says
so: *"qtyUsed deltas are intent until updateWorkOrderExecutionData accepts them; inventory is never
claimed changed."*

**Status: PROJECTED_ONLY.** The chain `qtyUsed → inventory transaction → billable line` does not
exist. Inventory authority is `recordInventoryAction`; nothing joins the two.

### Fulfillment (§I)

Every Pick Ticket fact — bin/shelf, UOM, qty picked, qty shipped, backorder, shipment date, ship
via, serial assigned — is **MISSING_AUTHORITY**.

### Equipment profile (§J)

Equipment: 13 fields. `equipment_models`: 15 (`family, subtype, revision, status, sourceAuthority,
version` + provenance). **Neither carries voltage, phase, electrical characteristics or refrigerant
type.** By §J's own rule those are invariant model specifications belonging on the catalog.

`equipment_models` is deny-all in Rules and D4-governed, so this is a D4/D5 scope question, not a
field addition.

### Invoice charges (§M)

Sales Order line kinds are **`EQUIPMENT_MODEL | PART | SERVICE`** — three. Labor, travel, freight,
refrigerant, refrigerant processing, brazing, service charge and steam clean have no typed
representation, and per gap 1 no invoice to appear on.

---

## Canonical ownership (§B) — proposals

| repeated fact | classification | proposed owner |
|---|---|---|
| customer identity | canonical reference | Account |
| install / service site | canonical reference | Location |
| salesperson | canonical reference | Employee, referenced |
| customer PO | transaction-specific fact | the order it was given for |
| commercial terms at commitment | **immutable snapshot** | Agreement, snapshotted to the order |
| sell price at commitment | **immutable snapshot — already correct** | SO line `unitPrice` |
| serial number | canonical reference | Serialized Asset Registry — never typed onto an order line |
| make / model on a service invoice | derived display | Equipment → Equipment Model |
| install date | canonical | Equipment |

The already-correct pattern worth naming: **`unitPrice` is a committed-price snapshot and invoicing
is forbidden from disagreeing with it.** That is the shape the rest should copy.

---

## What I am deliberately NOT proposing

- No Agreement fields added to `sales_orders`. §C rules it out, and it would make the order the
  Agreement.
- No `miscChargeMinor`. Typed lines are the correct shape.
- No form-builder for the Site Survey.
- No replacement for Serialized Asset Registry.

---

## Unresolved Owner decisions

1. **Service invoicing anchor.** Does a service call create a Sales Order, or does invoicing gain a
   second anchor? *Blocks §F, §G, §H, §M.*
2. **Quote / Agreement object.** Does commercial commitment get its own governed object? *Blocks §C,
   and defines what CONFIRMED means.*
3. **Unpriced-order remediation.** The 7 existing sandbox records. Prices cannot be invented.
   *Blocks §D's rollout, not its design.*
4. **Equipment electrical / refrigerant specs.** D4/D5 scope for `equipment_models`. *Blocks §J.*
5. **The five artifacts.** Required for §G and §K, and to confirm the field lists above are the real
   ones rather than the package's summary of them.

## Recommended first implementation slice

**§D, pricing completeness** — once decision 3 has a route. Fully specified, source-grounded, no
artifact needed, proven symptom, and it is the smallest change that makes CONFIRMED mean something.
