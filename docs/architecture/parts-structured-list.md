# Parts / Part Master — Structured List + Field Metadata Migration

**Second post-pilot object migration, 2026-08-24.** Built on the field-metadata contract from the
Structured Object UX pilot (`6ab5533e`) and the Purchase Order migration (`14f9480d`).

Parts is expected to become the highest-volume list in EOS, so this migration was scoped around
**scale**, not around adding columns.

---

## A — Part authority

### Stored vs projected — two different sets

**STORED** on the canonical Part (`functions/src/partMaster/types.ts`):

```
partId · internalPartNumber · name · description? · category? · status · stockingUnit ·
controlType · stockingClass · flags{expiryTracked, consumable, returnableCore} ·
manufacturerId? · manufacturerPartNumber? · oemStatus? · wholeUnit? · equipmentModelId?
```

**PROJECTED** to the client (`domain/partMasterView.js`) is *smaller*: it drops `manufacturerId`,
`manufacturerPartNumber`, `wholeUnit`, `equipmentModelId`, `flags` and `oemStatus`.

That gap is recorded as `PART_STORED_NOT_PROJECTED` and is a **different fact** from unsupported: the
value exists on the document and the fix is a projection change, not a domain decision. Marking those
fields `NO_AUTHORITY` would have made a solvable problem look like a blocked one.

**ABSENT ENTIRELY** — no cost, no price, no reorder point, no business line. Those are not fields the
Part is missing values for; they are fields the Part does not have.

### The business identity

`internalPartNumber`. The document id is **not a field in the contract at all** — not hidden, not
`displayable: false`, absent. `PRT-1001` and `CW-P-0004` are what people read to each other.

### Two tracking vocabularies, and why they stay two

| | |
|---|---|
| Part Master | `controlType`: `STANDARD` · `SERIALIZED` · `LOT` · `SERIALIZED_LOT` |
| Inventory ledger | `trackingMode` |

`partMaster/controlTypeTrackingMode.ts` is the **one** mapping between them, and it exists because the
mapping had already been copied twice. This list shows the **Part's** value, labelled in Part Master's
own words — `STANDARD` reads as **"Quantity"**, because that is what it means to the business.

Normalising one into the other for display convenience is how two surfaces come to disagree about
whether a part is counted by quantity or by serial.

**A defect this found:** `domain/structuredFields.partFields()` read
`part.trackingMode ?? part.controlType` and labelled *either* one "Tracking" — silently preferring the
ledger's word on a Part Master record. Fixed to prefer the Part's own value in the Part's own
vocabulary, with the label map **imported** rather than restated.

---

## B — Field / query contract

21 fields. 15 displayable, 5 default columns.

| field | category | filter | sort |
|---|---|---|---|
| Part Number | OWNED · IDENTIFIER | ✅ | ✅ |
| Description | OWNED · STRING | ❌ `NEEDS_INDEX` | ✅ |
| Status | OWNED · ENUM | ✅ | ✅ **lifecycle order** |
| Tracking | OWNED · ENUM | ✅ | ❌ `NO_CANONICAL_ORDER` |
| Stocking Class | OWNED · ENUM | ✅ | ❌ `NO_CANONICAL_ORDER` |
| Unit · Category | OWNED | ✅ | ❌ |
| Item Type · Manufacturer · Equipment Model · Mfr Part Number | mixed | ❌ `NOT_PROJECTED` | ❌ |
| Warehouse Available · On Order | DERIVED · QUANTITY | ❌ `NOT_PROJECTED` | ❌ |
| Reorder Point | DERIVED · QUANTITY | ❌ `DERIVED_AT_READ` | ❌ |
| Unit Cost · Sell Price · Business Line · Truck Stock · Company Owned · Preferred Supplier | blocked | ❌ `NO_AUTHORITY` | ❌ |

**Default columns:** `Part Number · Description · Status · Tracking · Stocking Class`.

**Classifications are filterable but never sortable.** `STOCKED` and `KIT` are different *kinds* of
thing, not different stages of one. Alphabetical order on a classification is a coincidence dressed as
meaning.

**Status IS ordered** — `DRAFT → ACTIVE → INACTIVE → SUPERSEDED → DISCONTINUED`. Alphabetical would
open the list with `DISCONTINUED`.

**Default order preserved, not chosen:** `internalPartNumber asc`, tie-broken on `partId`. That is
exactly what `toPartListView` already sorted by. Without the tie-break, two parts sharing a number
swap places between reads, and a list that reorders itself is a list nobody trusts.

### The honesty rule

Every unqueryable field states a reason, with no exemptions — asserted by test across all 21.

---

## C — Scale: what changed and what did not

### The first attempt was wrong, and the way it was wrong is the useful part

`fetchPartMasterList` read the whole `parts` collection and sorted in the browser. The obvious fix was
to make it bounded so the list inherited paging for free.

That silently truncated **seven** surfaces:

| surface | what a first page does to it |
|---|---|
| `hooks/useCanonicalPartNames` | renders a raw id for any part past page 1 |
| `modules/scan/LookupScan` | scanning part 51 reports *the part does not exist* |
| `receiving/ReceiveAgainstPurchaseOrder` | part picker missing parts |
| `workOrders/WorkOrderPartsPlanEditor` | part picker missing parts |
| `inventoryRole/WarehouseManagerHome` | incomplete catalogue |
| `inventory/PartsList` | catalog composition truncated |
| `inventory/PartDetail` | composer expects the whole set; looks like missing data |

Those are **wrong answers dressed as a performance win**, and nothing on screen would have said so.

So the design was inverted: **paging is opted into by name, never inherited.**

```
fetchPartMasterList()                    the whole collection. Unchanged.
fetchPartMasterPage({ plan, cursor })    ordered, LIMITED, cursored, server-side filters.
```

The remaining whole-collection reads are recorded in
`services/partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ` so the count can only go down
deliberately. Each wants a **targeted read** — lookup by part number, a searched picker, a
single-document detail read — not a page size imposed on a question that needs the catalogue.

### What the paged read sends

```
where(...)                     only filters the metadata declares server-executable
orderBy(sortField, direction)
orderBy("partId", "asc")       the tie-break, always
limit(pageSize + 1)            the extra doc ANSWERS "is there more"
startAfter(...cursor)
```

`STARTS_WITH` becomes a prefix **range** (`>= "Valve"` and `< "Valvf"`) — which Firestore can do, and
which does not pretend to be a substring search.

Asserted against a **recording fake** Firestore, not a stub returning rows: a stub that ignored its
query would pass a row-shape test while shipping a full-collection scan.

### Paging is tied to the plan it came from

A cursor taken under different criteria is discarded rather than replayed — **including** when the
criteria change by browser Back rather than by the controls.

---

## D — Inventory semantics

> **PART LIST BALANCE N+1 GAP**

`getPartBalance` is a **single-part** callable. A "Warehouse Available" column would issue one callable
per row, on the largest list in the platform. Those fields are `defaultVisible: false` and the figures
stay on Part **detail** and scanner lookup, where they are one part at a time and genuinely cheap.

Refused: rendering the columns anyway and hiding the cost behind a spinner.

> **FALSE_COMFORT, again**

The field is named **"Warehouse Available"**, never "Stock". `onHand` is warehouse-only by design and
**excludes truck stock**. A picker reading "Stock: 8" cannot tell whether the vans are in that number.
There is no field labelled `Stock` in the contract, and `Truck Stock` / `Company Owned` are blocked
outright because no mobile figure is projected.

> **PART INVENTORY VALUATION AUTHORITY GAP**

The canonical Part carries **no cost and no price of any kind**. There is no inventory value to
display and no basis on which one could be computed.

Refused: multiplying a quantity by whichever cost happened to exist elsewhere (a supplier item's
`unitPrice`, say). That would invent a valuation policy inside a list component. **No `Dollars` column
exists for Parts** merely because the PO and Sales Order lists use that label.

> **PART REORDER POINT IS DERIVED, NOT STORED**

Computed by `inventoryAnalyticsService.calculateReorderPoint(usage, leadTimeDays, 1.5)`. Displayable
where the analytics read has already run; never filterable or sortable, because there is nothing
stored to order by.

> **PART BUSINESS LINE NOT AUTHORITATIVE**

No operating company on the Part. Refused: inferring Taylor vs Ventana from the manufacturer or from
description text.

> **PART SUPPLIER IS MANY-TO-MANY**

`PartSupplierItem{partId, supplierId, …, preferred}` is a separate collection. Refused: a single
Vendor column, which would hide every other supplier.

> **PART DESCRIPTION SEARCH INDEX GAP**

Firestore has no substring search. Identifier-first search now (part number and manufacturer part
number, both exact-resolvable); a search projection later. Refused: fetching every Part and running
`.includes()` over descriptions in the browser.

Every blocked field is **non-reportable and non-exportable too** — the export is the back door a
blocked column otherwise ships through.

---

## E — UX

The shared controls are mounted in the **actual** list, not declared in metadata and left unmounted:
`+ Add Filter`, `Sort`, active-filter chips, and a filtered empty state — all reading the Part field
metadata. There is **no Parts-specific filter registry**: a newly declared field becomes filterable
without anybody editing the screen.

**Nav:** `Part Master` was **re-promoted** out of `navHidden`. Wave 6 hid it because its unique
workflow — browse every Part by master-data status / tracking / stocking class — had no way to work at
catalogue scale, and its own comment said to re-promote if that changed. It has. Continuing to hide the
only door to that workflow would be keeping the workflow and hiding the way in. `Manufacturers` stays
hidden, because its read is still Rules-closed to every persona.

**Enum cells are business words with the canonical value preserved** on the element (`data-raw`), so a
filter, a sort or a test reaches the enum rather than the phrasing.

**Fields are not concatenated.** `Part 123 · Active · Serialized · Taylor` reads fine and exposes
nothing.

### Two defects found in the shared layer

**1. A bookmarked filter showed a storage token.** `valueLabel` is captured when somebody picks a
value, and the URL does not carry it — so a chip was human on the render that created it and read
`Status: ACTIVE` after any reload, bookmark or shared link. `describeFilter` now re-resolves the label
from the picker's own option list. Fixed once, for every object.

**2. A stale link degraded quietly.** `fromSearchParams` dropped criteria this build cannot execute and
said nothing, so a link asking for `name contains valve` rendered the **whole catalogue** with no chip
and no explanation — and somebody following it would read that as the filtered subset. The narrowing
they asked for silently became no narrowing at all. Rejected entries now come back in `dropped`, with
the reason the metadata gave, and the list says:

> Some criteria can't be applied to this list: Description. Everything else is applied, so this list is
> wider than the link asked for.

Two failure points, one banner: a criterion can fail at parse (a link from an older build) or at plan
(unqueryable). Both end with an unnarrowed list, so both have to say so.

**Empty states are two different statements.** A list filtered to nothing says so; an empty catalogue
says that instead. Telling somebody the catalogue is empty when they filtered it empty sends them
hunting a bug that is not there.

**No Firestore ids anywhere.** The raw-id guard now covers part document ids, equipment model ids and
manufacturer ids — with **mutation proofs**: deliberately rendering `part-8f21c4` or `model-c161` as a
label must make the guard fail. The other half of the contract is asserted too: `PRT-1001`,
`CW-P-0004`, `ISI-203SN`, `IM-0460-AH` must all pass, because a guard that rejects real part numbers
gets disabled within a week.

A second raw-id path was fixed at the source: `partFields()` fell back to `part.partId` as the SKU when
the business number was missing — showing the document id exactly when the record is malformed and
somebody is most likely to write the value down.

### Mobile

Structurally certified for 320 / 375 / 390 / 414: every control the list adds carries a `min-height:
44px` rule, the filter builder stacks below the phone breakpoint, the controls wrap, and the
eight-column table scrolls inside `.fo-table-scroll` so the page never scrolls sideways. jsdom does not
lay out, so what is asserted is the structure that produces the geometry — which is also what
regresses.

**The live browser pass was NOT performed, and that is a gap rather than a pass.** The local emulator
could not start (port 8080 held by another session's emulator; killing a process this session does not
own is not an acceptable way to get a measurement). Every prior package in this program found at least
one sub-44px target *only* by measuring in a real browser — twice in WO-03A, once in WO-05A — so the
structural gate above should be treated as necessary and not sufficient. **The four-width measurement
of `/inventory/part-master` is outstanding work**, and the two things worth measuring specifically are
the `+ Add Filter` builder's three stacked controls at 320px and the active-filter chip's `×` remove
button, which is the smallest new target on the screen.

---

## F — Tests

**74 new or extended proofs** across three files:

| file | covers |
|---|---|
| `test/partsStructuredList.test.jsx` (33) | field contract · refusals · the two vocabularies · query plan · the constraints actually sent · stale-link reporting |
| `test/partMasterStructuredListScreen.test.jsx` (17) | the real screen: labels, headings, controls, chips, empty states, paging, mobile structure |
| `test/rawIdPresentationGuard.test.jsx` (+7) | Part identities, business identifiers that must pass, two new mutation proofs |

Gates: node **229/229** suites · client **1,887** tests · lint 0 errors · typecheck clean · build ok.

**Backend untouched.** No functions, no `firestore.rules`, no capability, no role, no index.

---

## G — Next objects

1. **Customers / Accounts** — the most common related object; projecting its name unblocks filters and
   sorting across every other list
2. **Transfers** — structured fields already exist from WO-05
3. **Opportunities**
4. **Invoices** — *has* authoritative money (`totalMinor`), and is the natural place to settle the
   minor-unit convention `PO_TOTAL_UNIT_CONVENTION` records
5. **Employees / Technicians** — small, but unblocks technician-name sorting elsewhere

Carried forward, still open: `SALES ORDER TOTAL AUTHORITY GAP`, `PO BUYER FIELD NOT AUTHORITATIVE`,
`PO BUSINESS LINE NOT DERIVABLE`, and the seven entries in
`PART_CATALOGUE_WHOLE_COLLECTION_READ`.

### What this migration adds to the template

The Purchase Order migration's ten steps still hold. Two more, learned here:

11. **Check who else uses the read before you bound it.** A list's read is often the platform's
    catalogue reader, and paging it is a correctness change for every other consumer — not a
    performance change.
12. **A criterion that cannot be applied must be said, at every point it can fail.** Degrading safely
    and degrading quietly are different things, and the quiet version makes a full list look like a
    filtered one.
