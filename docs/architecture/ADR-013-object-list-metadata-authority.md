# ADR-013 — Object List Metadata Authority

**Status:** ACCEPTED. Owner decision, 2026-08-24 (Option A).
**Supersedes:** the object-list portions of PRs #1442, #1443, #1444.

---

## Decision

> **`src/metadata/` is the canonical metadata authority for object lists.**

It owns, for every business object list in EOS:

- object and field definitions
- column, filter and sort definitions
- query and index requirements
- field visibility
- list presentation metadata
- reporting and export metadata

**There is exactly one definition of any object.** A second one is not a variant; it is a second
system, and the two will disagree.

---

## Why this one

`src/metadata/` was already the incumbent, and by a wide margin:

| | `src/metadata/` | retired `domain/fieldMetadata.js` |
|---|---|---|
| entity definitions | **30** | 6 (5 duplicating an existing one) |
| screens mounted | **10** | 1 |
| paging | bounded, cursor-only, no offset concept | bounded |
| **index coverage** | **enforced in CI** (`scripts/listIndexCoverage.mjs`) | declared, never verified |
| reference resolution | states + batched `documentId() in` read | `unresolvedText` only |
| record pages, saved views, board scope | yes | no |

The decisive column is index coverage. Both architectures held that *a declared filter is a promise*.
Only one of them **proved** it, and the difference was not theoretical:

> **The defect that settled this.** The retired Parts read appended an explicit
> `orderBy("partId", "asc")` tie-break. `partId` is a stored field, so
> `where(status ==) + orderBy(internalPartNumber) + orderBy(partId)` demands a composite index on
> `(status, internalPartNumber, partId)`. The repository declares `(status, internalPartNumber)` —
> Firestore appends `__name__` implicitly, and for `parts` the document id **is** the partId.
>
> **Every filtered Parts query would have failed at read time with "index required"**, in front of a
> user, on a surface nobody touched. CI was green throughout.
>
> The canonical runtime had already solved this: it appends `__name__` as the tiebreaker, in the same
> direction as the clause before it, which is what keeps the query on the index Firestore maintains
> for free.

Three more duplications the same trace found:

1. **A second label map.** The pilot's `CONTROL_TYPE_LABEL` read `STANDARD → "Quantity"`;
   `domain/partVocabulary.js` reads `"Standard"`. Two maps for one enum is exactly what put
   *"0 Active"* beside a table of `ACTIVE` rows in #1093.
2. **A Dollars column for the wrong collection.** The pilot's Purchase Order contract traced
   `purchase_orders.totalCost`. The canonical `purchaseOrder` entity models **`reorder_purchase_orders`**,
   which the definition already recorded as having *"no price/amount/total field of any kind"*. Two
   collections wear the name; nothing shipped, because no PO screen was ever mounted.
3. **A raw document id as a fallback label.** `partFields()` fell back to `part.partId` as the SKU
   when the business number was missing — showing the id exactly when a record is malformed.

## How it was NOT decided

Not on age, not on line count, and not because the pilot was wrong to exist. The pilot was written
without finding the incumbent — five of its six contracts duplicated an existing definition — and its
five genuinely new ideas are the reason this is a convergence rather than a deletion.

---

## The five features converged in

Each was a **feature**, not an architecture. None changed how the 10 incumbent screens work.

### 1. URL-backed list state — `metadata/listUrlState.js`

The metadata runtime had **none**: no `useSearchParams` anywhere under `src/metadata/`. Filters and
sort did not survive opening a record and coming back, and a narrowed list could not be shared or
bookmarked.

`useListCriteria` is the one hook every list uses. The **cursor is never written to the URL** — a
bookmarked page-3 cursor is meaningless once the data moves, and restoring it would show a stranger
somebody else's arbitrary window into the list.

A descriptor-shaped `toUrlParams`/`fromUrlParams` pair already existed in `listRuntime.js` — tested
since it was written, **never mounted on a screen**, and unable to report what it dropped. It was
retired rather than kept alongside; two URL layers is the duplication this ADR removes.

### 2. Named unsupported reasons — `metadata/unsupportedReason.js`

`NOT_PROJECTED` · `DERIVED_AT_READ` · `NO_CANONICAL_ORDER` · `NEEDS_INDEX` · `NO_AUTHORITY` ·
`NOT_AUTHORIZED`.

A disabled control with no explanation is a dead end. `NOT_PROJECTED` is a week of work;
`NO_AUTHORITY` is a business decision — and a person cannot tell which they are looking at, nor can
the next engineer. The validator rejects a reason on a field that *can* do the thing, and rejects a
reason it does not know.

### 3. The gap register — `metadata/gapRegister.js`

> *This field or behaviour exists conceptually, and cannot truthfully be provided yet.*

That sentence gets written constantly during a migration, and used to live in a comment beside the
field it disabled — invisible to the three consumers that most need it: architecture review deciding
what to build next, reporting deciding what it can honestly offer, and migrations deciding what a
projection must carry.

A gap is a validated record with a stable, quotable `SCREAMING_SNAKE` id. `finding` is required
(*"a gap records what a trace found, not what somebody suspects"*), and so is `refused` **or**
`resolution` — without one, the refusal gets quietly reversed by somebody who does not know why it
was made.

Registered so far: 8 on Part, 4 on Purchase Order, 1 on Work Order, 1 on Equipment.

### 4. Dropped-criteria reporting — `metadata/listUrlState.js`

Degrading **safely** and degrading **quietly** are different things, and the quiet version misleads in
the dangerous direction. A link asking for `name contains valve` on a build where that is unqueryable
rendered the whole collection with no chip and no explanation — and the person following it read that
as the filtered subset. The narrowing they asked for silently became **no narrowing at all**.

Every rejected entry now comes back in `dropped` with two levels — `reason` (what went wrong at the
URL) and `detail` (the field's own `UNSUPPORTED_REASON`) — and the list says it is **broader than
requested**.

### 5. Structured absence — `metadata/absence.js`

`NOT_RECORDED` · `NOT_AVAILABLE_TO_USER` · `UNRESOLVED` · `UNKNOWN` — and authoritative **zero**,
which is not an absence at all.

> **UNKNOWN IS NOT ZERO. ZERO IS NOT ABSENCE. AN ID IS NEVER A FALLBACK.**

`$0.00` says an order is worth nothing; a missing total says we do not know what it is worth. "0
available" sends a technician to an empty shelf certain; "not counted" sends them to look. A formatter
never sees an absent value, so it cannot turn one into `"0"`.

Deliberately separate from `referenceResolution.js`, which models how a **reference** resolved. A
reference that resolved to nothing and a quantity nobody counted are different questions, and one enum
wide enough for both would give neither surface the right words.

---

## Migration map

| pilot module | canonical equivalent | pilot-only content | action |
|---|---|---|---|
| `domain/fieldMetadata.js` | `metadata/entityDefinition.js` | reasons, absence, displayable/reportable/exportable | folded → **deleted** |
| `domain/listQueryState.js` | `metadata/listRuntime.js` | URL state, dropped criteria | → `metadata/listUrlState.js`, **deleted** |
| `shared/ui/ListControls.jsx` | *(none — no filter UI existed)* | the whole builder | → `metadata/MetadataListControls.jsx`, **deleted** |
| `domain/objectFields.js` (WO, SO, Equipment) | `definitions/workOrder.js`, `salesOrder.js`, `equipment.js` | gaps | folded → **deleted** |
| `domain/purchaseOrderFields.js` | `definitions/purchaseOrder.js` | money-authority trace | folded as 4 gaps → **deleted** |
| `domain/partFields.js` | `definitions/part.js` | 7 gaps, derived + blocked fields, reasons | folded → **deleted** |
| `services/partMasterQueries.fetchPartMasterPage` | `metadata/firestoreListSource.js` | malformed-record accounting | → `services/partMasterPageQuery.js` |
| `listRuntime.toUrlParams` / `fromUrlParams` | — | never mounted | **deleted** |

`services/partMasterQueries.fetchPartMasterList` is **unchanged and stays** — seven surfaces need the
whole catalogue, and for each of them a silent first page is a wrong answer rather than a slow one.
That is `PART_CATALOGUE_WHOLE_COLLECTION_READ`, a recorded gap, not a leftover.

**Deletion over deprecation.** A "deprecated but still usable" parallel system is the one the next
person finds first, because it is the one that still works. `test/objectListMetadataAuthority.test.mjs`
enforces the boundary: no retired module exists, nothing imports one, entity and list definitions live
only under `src/metadata/`, there is one filter UI, one sort UI and one URL layer, and no module builds
its own bounded Firestore query.

**No remaining blocker.** Every duplicate is deleted.

---

## What consumers keep

**Parts.** Structured fields, Part Number as business identity, no raw ids, Add Filter, Sort, active
chips, dropped-criteria warning, URL state, bounded paging, `UNKNOWN != ZERO`, unsupported reasons,
report/export restrictions, Back-to-list state, and Part Master visible in Inventory nav.

**One deliberate reduction, and it is a correction.** The Part list now offers `status` and
`stockingClass` — the two filters with declared composite indexes — instead of the pilot's six. Part
number, tracking, unit and category had **no index**, so each would have failed at read time. An
offered filter that errors is worse than an absent one. Recorded as `PART_LIST_FILTER_INDEX_GAP`, with
the index cost of adding each back.

**Purchase Orders, Work Orders, Equipment, Sales Orders.** No pilot contract was ever mounted on a
screen, so what those migrations produced was *knowledge*, and the knowledge is what was preserved —
as gaps on the canonical definitions. Equipment keeps its six-fields-never-a-sentence rule, recorded
where the next reader of that definition will find it.

---

## The rules this ADR makes permanent

1. **Index enforcement wins.** Any filter or sort added through metadata participates in
   `scripts/listIndexCoverage.mjs`. A field does not become queryable because metadata says so —
   metadata, query planner and real Firestore indexes must agree.
2. **No fetch-all-and-filter.** No fetch-page-and-sort-page presented as global sorting. No N+1
   related lookup to satisfy a filter or sort promise. If Firestore cannot execute it:
   *unsupported + reason*.
3. **One filter UI, one sort UI.** A screen gets its filters from object metadata, never from a
   screen-local registry.
4. **A field a viewer may not read is ABSENT** from columns, the filter menu, the sort menu, reports
   and exports — not present-and-disabled, which still discloses that it exists. A capability resolver
   that **throws denies**.
5. **A blocked field is non-reportable and non-exportable too.** The validator enforces it: an export
   is the back door a blocked column otherwise ships through.
6. **No Firestore ids in normal UX**, and no global regex ban either — `WO-2026-000123`, `PRT-1001`,
   `CW-P-0004`, `CW-C161-0001`, `ISI-203SN` are business identifiers people read aloud, and a guard
   that rejects them is a guard nobody keeps.

---

## Carried forward, unresolved

- **`CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS`** — needs a denormalized `customerNameLower` on
  related operational documents *plus* a rename-propagation authority. Explicitly **not** solved
  incidentally here; display resolution via the batched resolver remains valid.
- **`PART_LIST_BALANCE_N1_GAP`**, **`PART_CATALOGUE_WHOLE_COLLECTION_READ`** — the queued
  *PartsList / Inventory Health — Scale + Paging* package.
- **`PARTS PHONE-CARD READABILITY`** — geometry passed at all four widths; an eight-column table
  compressed to 414px is still not a phone screen.
- **`PURCHASE_ORDER_MONEY_LIVES_ON_A_DIFFERENT_COLLECTION`** — Financial Architecture decides which
  collection is the Purchase Order.

## Next

`CUSTOMERS / ACCOUNTS — STRUCTURED LIST + RELATED-FIELD PROJECTION`, on this architecture, carrying
forward the authority trace already recorded in
[`two-list-metadata-systems.md`](two-list-metadata-systems.md) — which stands as the analysis behind
this decision and should be read as history, not as a live proposal.
