# PartsList / Inventory Health — Scale + Paging + Phone Cards

**2026-08-24.** Two halves were asked for. One shipped; one is **blocked**, and the blocker is the
useful output.

| | |
|---|---|
| **Phone cards + structured fields** (§18–§21) | **DONE** — `PARTS PHONE-CARD READABILITY` closed |
| **Server paging + health at scale** (§2–§14) | **BLOCKED** — three independent structural reasons |

---

## A — Current semantics trace

```
/inventory  ──┬─ fetchPartMasterList()          UNBOUNDED read of `parts`
              │        │
              │        └─→ composeGovernedPartsWorkspace(canonical, PARTS_CATALOG)
              │                 └─→ RECONCILIATION with a full-accounting invariant
              │                        → BLOCKS the whole catalogue if it cannot account
              │                          for every canonical Part
              │
              └─ useInventoryLedger()
                       └─ fetchInventoryTransactions()   UNBOUNDED read of the ledger
                              └─ computeAvailableStockByPart()   NETS every transaction
                                     └─ generateInventoryHealthDashboard()
                                            → health entries, one per partId THE LEDGER HAS SEEN
```

Then: `PAGE_SIZE = 25`, `filteredParts.slice(...)` — everything is fetched and paged **in the
browser**.

**Two populations, and they are already separate.** Health is computed over the *ledger*, never over
the catalogue rows on screen — so §4's requirement is structurally true today rather than something
this package had to build. `stockSnapshots` derives from the transactions; the catalogue is not an
input to it.

### PartMaster vs Inventory Parts — genuinely two surfaces (§5)

| | `/inventory/part-master` | `/inventory` |
|---|---|---|
| question | *what does the catalogue say about this part?* | *which parts need attention?* |
| source | `parts` alone | `parts` ⋈ static catalog ⋈ ledger |
| shape | a list | a **reconciliation** + a health overlay |
| writes | governed create / edit / status | reorder-request lifecycle |

**Not duplicates.** Master-data administration and operational inventory health are different jobs,
and the second is a composite that the first has no notion of.

---

## B — Why paging is blocked

### 1. The catalogue is a reconciliation, and its invariant is whole-set

`composeGovernedPartsWorkspace` asserts **every canonical Part resolves to exactly one row**:

```js
const canonicalAccounted = ws.totals.canonicalMatch + ws.totals.canonicalOnly;
const fullyAccounted = canonicalAccounted === ws.totals.canonicalCount;
```

A cursor page makes `canonicalCount` the page size, so the comparison becomes 50 against 50 — it
passes and proves nothing. Its answer to *"I only have some of the Parts"* is to show **nothing**,
deliberately, rather than a subset that looks whole.

> **Refused:** paging the composed rows while keeping the invariant's name. A guarantee that
> silently changes scope is worse than one that is removed, because the screen still claims it.

### 2. Health nets a ledger, and a netted total over a page is *wrong*, not partial

The codebase already wrote this rule down, in `operationsQueries.ts`:

> *"Capping the shared factory would have bounded both, and a total computed over a truncated input
> is not 'partial' — it is **WRONG, presented as complete**. That is a worse outcome than the
> unbounded read it replaces, because an unbounded read is slow and honest while a
> silently-netted-over-a-page total is fast and false."*

**Demonstrated, not asserted.** A page holding a receipt but not the reservation against it:

| | available |
|---|---|
| full ledger | **4** |
| truncated to the receipt | **16** |

The truncated figure is **higher**. A capped ledger *overstates* what is on hand, which sends
somebody to a shelf emptier than the screen claims — the dangerous direction.

### 3. The ledger cannot be ordered without deleting an era of it

`inventoryTransaction.js` already records why it declares no INDEX list:

> LEGACY documents carry `timestamp`; OPERATIONAL documents carry `recordedAt`; **no document carries
> both**. Firestore's `orderBy` silently **excludes** any document missing the ordered field.

So a cursor order over `inventory_transactions` removes an entire era of live entries from the
result **with no error** — the same silent-exclusion failure the Customers list was already bitten
by, where 101 of 103 rows vanished behind an `updatedAt` sort.

**Cursor paging requires a total order. This collection does not have one.**

### What would unblock it

`INVENTORY_HEALTH_QUERY_PROJECTION_GAP` — a trusted server-side health projection maintained by the
ledger's own writers, defining source facts, freshness, `UNKNOWN`, the `onOrder` and mobile/company
splits, paging, filtering, sorting, and its **update authority**. That is a backend package with its
own contract (§31/§32), not something a list migration can bolt on — and a cached health field with
no update authority would be worse than none.

**Not built here, deliberately.** §40: *return the exact blocker rather than faking PASS.*

---

## C — Inventory Health, as it stands

| | |
|---|---|
| **population** | every `partId` the ledger has seen — **not** the catalogue, **not** the page |
| **classifier** | `generateReplenishmentRecommendation` → `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` |
| **three outcomes** | never seen by the ledger · seen but no usage history · a computed urgency |
| **correct today** | yes — *because* the read is unbounded |
| **filterable / sortable by health** | **no** — `INVENTORY_HEALTH_QUERY_PROJECTION_GAP` |

The three outcomes stay three different statements. Collapsing *"the ledger has never seen this
part"* into *"healthy"* would be the worst available default, and collapsing it into a risk level
would invent one.

---

## D — What shipped

**Phone cards.** The `/inventory` catalogue table was the last migrated list still compressing its
columns into ~320px — nothing overflowed, and nothing was readable either. It now carries
`fo-table--stack`, the same modifier the shared metadata grid uses, with `data-label` on every cell.
Measured at 320px:

```
Part                 Beater assembly
Part Number          PRT-1001
Category             Drive
Warehouse Available  4
Inventory Health     Critical
```

**Structured cells, not strings.** The availability cell rendered `` `${part.warehouseQty} (baseline)` ``
— a number welded to a caveat, which nothing could sort, filter or report on. Now the number is
machine-readable on the cell (`data-raw`) and the caveat is its own element.

**Human words.** `CRITICAL` was rendering as the raw stored token to whoever was deciding what to
reorder. `INVENTORY_URGENCY_LABEL` now lives beside the tone map — one authority, because colour and
wording are two representations of one value and splitting them across files is how they come to
disagree. Colour reinforces; the label carries the meaning.

**Headings that name the concept.** `Risk` → **Inventory Health**; `SKU` → **Part Number**;
`Available` → **Warehouse Available** — the scope is in the name, per the FALSE_COMFORT rule.

### Found by measuring (§21)

> **A link inside a stacked card is the card's tap target, and at desk density it is a 19px line of
> text.** `Compressor` measured **74×19** at 320px. The row whose name wrapped to three lines cleared
> 44px *by accident*, so the failing targets were the **short** names — which is most of them.

Fixed inside the phone breakpoint only, so desktop table density is untouched. Pinned as a
regression test.

---

## E — Performance and regressions

**No N+1, and there never was one here.** `PartsList` makes **zero** `getPartBalance` calls — it
reads the ledger once and overlays. `PART LIST BALANCE N+1 GAP` is about adding balance *columns* to
the Part Master list, and remains open and untouched.

| read | shape |
|---|---|
| catalogue | 1 unbounded `parts` read |
| ledger | 1 unbounded `inventory_transactions` read |
| per-part balance calls | **0** |
| paging | client-side, `PAGE_SIZE = 25` — **unchanged**, because the two reads above cannot be bounded |

Bundle unchanged. No backend files touched: no functions, no `firestore.rules`, no capability, no
role, no index.

### The existence rule (§7, §33–§36)

Nothing was paged, so nothing can newly fail to be found — and that is asserted rather than assumed.
`fetchPartMasterList()` takes no plan, no cursor and no page size, and **every existence-proving
consumer still uses it**: scanner lookup, receiving, the Work Order parts plan, the canonical name
resolver, and this list. A test fails if any of them starts calling `fetchPartMasterPage` instead.

> `NOT IN CURRENT PAGE` ≠ `PART DOES NOT EXIST` — and the way to keep that true was to not page the
> read those consumers depend on.

---

## F — The whole-catalogue read matrix (§8)

| consumer | classification | why |
|---|---|---|
| `useCanonicalPartNames` | **NEEDS LOOKUP AUTHORITY** | resolves any id a screen mentions; a page renders raw ids |
| `LookupScan` | **NEEDS LOOKUP AUTHORITY** | a scan is a point query wearing a list's clothes |
| `ReceiveAgainstPurchaseOrder` | **NEEDS SEARCH AUTHORITY** | a PO line names a part; the picker must find it |
| `WorkOrderPartsPlanEditor` | **NEEDS SEARCH AUTHORITY** | same shape |
| `WarehouseManagerHome` | **CAN PAGE** | a user-facing catalogue list |
| `PartsList` (`/inventory`) | **MUST REMAIN WHOLE** | the reconciliation invariant is whole-set |
| `PartDetail` | **NEEDS PROJECTION** | composes one part through a whole-set composer |

**Four of seven are the wrong primitive, not the wrong bound.** Adding `limit()` to them would make
a real part look missing. They want a *lookup* or a *search* authority; that is a different package.

---

## G — Tests

**15 proofs** in `test/inventoryHealthScaleSemantics.test.jsx`, most of them pinning the blocker so
it cannot be quietly removed by somebody well-intentioned adding `limit()` in six months:

- the reconciliation invariant compares whole-set counts
- an incomplete or invalid canonical read **blocks** rather than rendering a subset (and leaks no
  document contents)
- health's population is the ledger, not the page
- **netting a truncated ledger overstates availability** — 16 where the truth is 4
- the shared unbounded fetcher stays unbounded, and still says why
- the ledger has no total-order field, so no INDEX list is declared for it
- every existence-proving consumer still reads the whole catalogue
- cards, labelled cells, separated figure-and-caveat, human urgency words, three distinct outcomes,
  and the 44px card link

Gates: node **229/229** · client **1,897** · lint 0 errors · typecheck clean · build ok · index
coverage **32/32** · index drift guard green.

---

## Carried, not solved

`INVENTORY_HEALTH_QUERY_PROJECTION_GAP` · `PART_CATALOGUE_RECONCILIATION_CANNOT_BE_PAGED` ·
`PART_CATALOGUE_BASELINE_IS_NOT_AVAILABILITY` *(new, all three registered on the Part entity)* ·
`PART_LIST_BALANCE_N1_GAP` · `PART_CATALOGUE_WHOLE_COLLECTION_READ` · `PART_INVENTORY_VALUATION_AUTHORITY_GAP` ·
`PART_BUSINESS_LINE_NOT_AUTHORITATIVE` · `PART_SUPPLIER_IS_MANY_TO_MANY` ·
`PART_DESCRIPTION_SEARCH_INDEX_GAP` · `CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS` ·
the 8 Account gaps · the PO money-collection split.
