# Purchase Order Structured List + Dollars

**First post-pilot object migration, 2026-08-23.** Built on the field-metadata contract from the
Structured Object UX pilot (`6ab5533e`).

---

## A — Purchase Order authority

### Two PO shapes, and which is which

| shape | where | carries |
|---|---|---|
| `CanonicalPurchaseOrder` | `purchasing/purchaseOrderNormalization.ts` | `purchaseOrderId`, `supplierId`, **`supplierName`**, `status`, `lines[{lineId, partId, quantity}]`, `origin: LEGACY_REORDER \| CANONICAL` |
| `PurchaseOrder` | `types/procurement.ts` + `procurementService.ts` | `supplierId`, `status`, `items[{partId, quantity, unitPrice}]`, **`totalCost`**, timestamps |

Both live in the **`purchase_orders`** collection. The normalizer is *total over both shapes*, which is
what lets legacy `reorder_purchase_orders` records and canonical ones coexist — and it deliberately
projects **quantities only**, because it exists to serve **receiving**, which has no business with
money.

**Legacy is compatibility-only.** It is normalized *into* the canonical shape and does not dictate the
list contract.

### Dollars — the authority EXISTS

> `purchase_orders.totalCost`, **stored** at write by `procurementService.createPurchaseOrder`.

```
totalCost = Σ (quantity × unitPrice)
```

- `unitPrice` is **required** on every line
- validation **rejects** an empty line set, a non-positive quantity, or a negative unitPrice — so the
  value cannot be silently zero or negative
- computed once at creation and **stored**; not derived at read

**Exact semantics:**

| | |
|---|---|
| **includes** | the extended cost of every ordered line |
| **excludes** | freight · tax · fees · discounts — **none of which exist as fields on the document**, so their absence is a fact about the model, not a choice made here |
| **timing** | the **ordered commitment**. Receiving does **not** change it; what has arrived is a separate derived question |
| **currency** | the document declares **none**. Single-currency, per `money.js`'s USD default |

### The unit convention — an inference, recorded as one

`totalCost` is a plain `number`. The type declares **no unit**, unlike `money.js` (explicit minor
units) or `invoiceCommands.ts` (`totalMinor`).

Evidence for **major units**:

1. `sumLineItems` multiplies quantity by unitPrice with **no scaling factor**
2. `procurementService`'s own validator comment calls an empty order *"a $0 PO"*
3. no currency field and no `*Minor` suffix

So it is formatted as dollars — but that is an **inference from evidence, not a declaration**, and it
is recorded as `PO_TOTAL_UNIT_CONVENTION` rather than left in a comment. **A 100× formatting error on
a purchasing total is severe.** The fix is a declared minor-unit migration in Financial Architecture.

### Vendor — the projection the Work Order is missing

`supplierName` is **already denormalised onto the PO document**. That single fact is why Vendor is the
only related field in this platform so far that is both **filterable and sortable** server-side, and
why this list has **no N+1** supplier lookup to avoid.

It is exactly what `customer.name` on the Work Order lacks — and precisely why that one is declared
`NOT_PROJECTED`.

**Its type is `STRING`, not `OBJECT_REF`** — and the metadata validator is what made that clear. The
first declaration used `OBJECT_REF` and the contract *refused* `CONTAINS` on it, correctly: a
reference is matched by identity, not substring. What is stored here is the **name**, so the field
genuinely is a string.

### Two gaps, refused rather than filled

> **PO BUYER FIELD NOT AUTHORITATIVE**

Neither shape stores a buyer, requestedBy or orderedBy. Attributing one from `createdBy` audit
metadata or fixture provenance would make a list column out of something the PO cannot prove.

> **PO BUSINESS LINE NOT DERIVABLE**

A PO carries no operating company, and its lines are Parts. A PO may legitimately mix Taylor and
Ventana parts, so there is **no single business line to assign even by inference**.

Both fields stay in the contract as `displayable: false` — and, importantly, **not reportable or
exportable either**, so an export cannot become the back door through which an unproven column ships.

### Financial visibility

`purchase_orders` is `allow read: if isAdminOrDispatcher()`, writes deny-all. `totalCost` is therefore
**already readable** by exactly those roles.

`finance.read` exists but is scoped to *"the minimal Finance AR projection … for an account"* and is
`active: false`. It is **not** a general financial-visibility capability, and gating PO Dollars on it
would be misusing a capability meant for AR. **No general financial-visibility model exists**, and
this package did not invent one — Dollars visibility is governed by the PO document's own Rules read.

---

## B — Field / query contract

| field | category | filter | sort |
|---|---|---|---|
| Purchase Order | OWNED · IDENTIFIER | ✅ | ✅ |
| Status | OWNED · ENUM | ✅ | ✅ **lifecycle order** |
| Created Date | OWNED · DATETIME | ✅ | ✅ |
| Vendor | RELATED · STRING | ✅ | ✅ *(denormalised)* |
| **Dollars** | **FINANCIAL · CURRENCY** | ✅ `= > < between` | ✅ high/low |
| Ordered / Received / Remaining | DERIVED · QUANTITY | ❌ | ❌ |
| Receipt State | DERIVED · ENUM | ❌ | ❌ |
| Buyer | RELATED | ❌ `NO_AUTHORITY` | ❌ |
| Business Line | RELATED | ❌ `NO_AUTHORITY` | ❌ |

**Status vs Receipt State are two fields.** `status: SENT` is what the business did with the order;
`receiptState: PARTIALLY_RECEIVED` is what has physically arrived. Showing one as the other would let
a screen claim a persisted state the document never held. `CANCELLED` sits **last** in the lifecycle
order as a terminal exit — placing it between SENT and RECEIVED would imply it is a step on the way.

**Created Date is not labelled "Order Date."** The document stores a creation timestamp and no
separate ordered, sent or approved date, and relabelling it would assert a business meaning the field
does not carry.

Default order: `createdAt desc`, **declared with a reason** rather than defaulted into — a
user-selected sort overrides it explicitly.

Pagination, cursor reset on criteria change, and URL-backed state are inherited unchanged from the
pilot's shared contract.

---

## C — UX

Desktop columns: `Purchase Order · Vendor · Status · Ordered · Received · Remaining · Receipt State ·
Created Date · Dollars` (Dollars right-aligned). Mobile becomes label/value cards with identical field
semantics.

**Dollars never lies:**

- the **raw number** is kept on the field, so sorting compares values — `"$1,000.00"` sorts *before*
  `"$9.00"` as text, which is the classic way a money column misleads
- **unknown is not zero.** `$0.00` says an order is worth nothing; a missing total says we do not know
  what it is worth. On a purchasing list those are opposite facts
- **authoritative zero renders as `$0.00`**
- `NaN`, `Infinity` and a numeric *string* all render as an absence rather than reaching a screen

`Ordered / Received / Remaining` are three fields, not `18 ordered · 5 received · 13 remaining` — that
sentence reads fine and exposes nothing: no column can be sorted by what is outstanding, and no filter
can find part-received orders.

No Firestore ids anywhere; an unresolved vendor renders **"Vendor unavailable"**.

---

## D — Tests / performance

**41 new proofs**, covering the money traps specifically: formatted-string sorting, unknown-vs-zero,
non-finite amounts, status-vs-receipt-state separation, the unit-convention record, blocked fields
absent from filters *and* exports, and a three-filter + sort URL round trip
(`Status = Sent AND Vendor contains ABC AND Dollars > 5000`).

Gates: node **229/229** suites · client **1,818** tests · lint 0 errors · typecheck clean · build ok.

**No N+1**: `supplierName` is denormalised, so the list resolves no suppliers per row. **Zero backend
files touched** — no functions, no `firestore.rules`, no capability, no role.

---

## E — The repeatable migration template

1. **Trace the object's authority first.** Read the stored document and the write path — never the UI.
   Money especially: is a total stored, derived, or absent?
2. **Define the field metadata**, declaring `filterable`/`sortable` against what is *actually stored*.
3. **Classify** every field OWNED / RELATED / DERIVED / FINANCIAL.
4. **Define the business identity** — the governed number or name, never the document id.
5. **Remove raw-id presentation**; declare `unresolvedText` on every displayable reference.
6. **Mount the shared filter/sort controls.** Never a per-object filter registry.
7. **Produce a query plan** — unsupported fields fail honestly; a page size is always applied.
8. **Preserve list state** in the URL, and route back-navigation through `objectListPath`.
9. **Certify mobile** at 320/375/390/414.
10. **Add reporting metadata** — and make sure blocked fields are non-reportable too.

**Refuse rather than fill.** Two fields the brief asked for are absent here because the PO cannot prove
them. That is the template working, not the template failing.

### Next objects

1. **Parts / Part Master** — highest-volume list; filters matter most at scale
2. **Customers / Accounts** — the most common related object; projecting its name unblocks filters
   across every other list
3. **Transfers** — structured fields already exist from WO-05
4. **Opportunities**
5. **Invoices** — *has* authoritative money (`totalMinor`), and is the natural place to settle the
   minor-unit convention
6. **Employees / Technicians** — small, but unblocks technician-name sorting elsewhere

`SALES ORDER TOTAL AUTHORITY GAP` remains open and carried to Financial Architecture. The asymmetry
with Purchase Orders is real and acceptable: a purchasing commitment has an authoritative number
behind it and a sales order does not. Normalising by inventing sales money would be the wrong fix.
