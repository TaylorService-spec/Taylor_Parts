# Inventory Health Projection V1

**2026-08-24.** Unblocks `/inventory` scale without weakening inventory truth — and reaches a
different answer than the package assumed, for a reason worth recording.

---

## The design decision

The package anticipated a **materialized** projection: stored health rows, trigger-maintained, with
freshness, repair, rebuild and concurrency contracts (§11–§13, §31–§33).

**V1 is a derive-at-read projection instead**, and §12 explicitly permits that choice
(*"recomputed on trusted read … choose based on repo architecture"*). The repo architecture is
unambiguous. `financeReadProjection.ts`:

> *"DERIVING the AR position from the durable facts (**never trusting a possibly-stale stored
> balance**)"*

That is the same question — a running total over an append-only history — answered once already.

**A cached health number is a number somebody will believe after it stops being true**, and unlike a
slow read it fails silently. Materializing would trade a truth problem for a performance one; the
whole point of the package title is not to weaken inventory truth.

So the diagnosis had to be sharper than "the read is unbounded". It is not. The reads were
**unbounded in the wrong dimension**:

| | per-part path | what a page needs |
|---|---|---|
| ACTIVE warehouses | read **once per part** | once |
| open purchase orders | read **once per part** | once |
| committed receipts | read **once per part, per order** | once |
| ledger rows | genuinely per-part | batched by `in` |

Three of the four inputs **do not vary by part**. A page of 50 was re-reading identical data 50
times. Batching is not a cache — it is reading each fact once.

```
per-part, 50 parts   50 ledger + 50 warehouse + 50 PO + (50 × R) receipts   ≈ 150 + reads
batched,  50 parts    2 ledger +  1 warehouse +  1 PO + R receipts          =  4 + R reads
```

---

## A — Projection contract

`getPartBalances({ partIds })` → `{ balances[], unresolvedPartIds[] }`, in
`functions/src/inventory/partBalanceBatchReadService.ts`.

**Not a second authority.** Every number comes from `composePartBalance` — the *same pure function*
the single-part read uses, unchanged, over the same ratified inputs
(`sumLedgerEligibleOnHand`, `openWorkOrderReserved`, `deriveReceiptState`). This module owns the read
**shape** and nothing else. A parity test composes each part directly and asserts deep equality with
the batch, because a batch that grouped ledger rows slightly differently would return plausible
numbers for every part and correct ones for none.

### The dimensions stay separate

| figure | meaning |
|---|---|
| `onHand` | physical stock at **ACTIVE warehouses**, from the ledger. **Excludes truck/mobile by design** |
| `reserved` | open Work Order commitments |
| `available` | `onHand − reserved`, floored at 0 |
| `onOrder` | outstanding on orders that can still be received |
| `byLocation` | where the on-hand sits, from the **same function** with a one-warehouse set |

There is no `stock` field, and there will not be one.

### UNKNOWN is a value

`BalanceFigure` = `KNOWN` | `UNKNOWN` | `NOT_COUNTED_BY_QUANTITY`, and `null` is never coerced to 0.

- **no physical evidence at all** → `UNKNOWN`. A shelf nobody has looked at is not an empty shelf.
- **evidence that nets to zero** → `KNOWN 0`. A real, empty shelf.
- **no commitment rows** → `KNOWN 0`, not UNKNOWN: the reservation ledger is written on every
  reservation, so its silence genuinely means nothing is reserved.
- **UNKNOWN is infectious.** Subtracting a known reservation from an unknown on-hand cannot produce
  a trustworthy available figure.

### Serialized parts

A SERIAL-tracked part reports `NOT_COUNTED_BY_QUANTITY` and points at the serialized registry.
Summing ledger quantities would report **0 for a shelf holding two units** — and whether a part is
serial-tracked is a fact **the server owns**, resolved from the Part Master. A part that cannot be
resolved is **omitted**, never assumed quantity-tracked; assuming would reintroduce the confident
zero by another route, and `unresolvedPartIds` names exactly which ones so a caller cannot mistake a
short result for a complete one.

---

## B — Maintenance

**There is none, and that is the point.**

| | |
|---|---|
| stored state | none |
| update triggers | none required |
| freshness | **exact at read** — no lag to define |
| repair / rebuild | **vacuous** — nothing to rebuild |
| concurrency divergence | **impossible** — no copy to diverge from |
| write authority | **none** — a balance read never writes, guarded at source |

§13's rebuild mechanism, §31's source/projection parity, §32's rebuild parity and §33's concurrency
convergence are all **satisfied by construction** rather than by machinery: the projection *is* the
source calculation. Parity is not a property to test for drift; it is an identity, and the test
asserts it as one.

The no-write guard forbids every write and transaction token by name in the source. The receipt map
is built from entries rather than assembled entry by entry precisely because a text guard cannot
tell a `Map` mutator from a `DocumentReference` mutator — restructuring the code is the right answer
to that rather than loosening a real protection.

---

## C — Query

`inventory.balance.read` — **the same capability**, not a new one. Asking about fifty parts is the
same question asked fifty times, and a second capability would invent an audience split the domain
does not have (§27).

It inherits that capability's gate exactly: `active: false`, resolved per environment, still
requiring a qualifying Role grant. **A throwing resolver denies.**

**Bounded at 50** — the page size. Over-limit requests are **refused, not truncated**: returning the
first fifty of a larger request answers a question nobody asked and looks like a complete answer to
the one they did. Ids are de-duplicated *before* the limit, so a caller repeating one id fifty times
asks about one part rather than being refused.

> **INVENTORY_HEALTH_SUMMARY_AND_GLOBAL_SORT_GAP** — whole-population health counts, and global
> filter or sort **by** health, remain unavailable. Health is derived at read, so there is no
> stored, indexable value for Firestore to order by. Per-row health and bounded paging are not
> affected. Closing it means accepting staleness in exchange for queryability — a decision, not a
> technical gap.

---

## D — Inventory semantics, regression-tested

| | proven |
|---|---|
| **FALSE_COMFORT** | 2 in a warehouse + 8 on a truck → `onHand` is **2**, not 10. A warehouse shortage coexists with company-owned stock on trucks |
| inactive warehouse | stock at a non-ACTIVE warehouse is **not** availability |
| **on order** | SENT contributes; **APPROVED-only does not**; a partial receipt reduces inbound (10 ordered, 4 received → **6**); fully received → **KNOWN 0**; never mentioned → **UNKNOWN** |
| both PO shapes | canonical `items` nets **committed receipts**; legacy single-line nets its **own stored** `receivedQuantity`. Neither is normalized into the other |
| **transfers** | a completed transfer conserves company-owned stock; the per-warehouse breakdown **adds up to its own total**, because both come from the same function |
| **returns** | `RETURN_INTAKE` alone leaves availability **unchanged**. Intake records that something came back, not that it is sellable |
| serialized | `NOT_COUNTED_BY_QUANTITY`, never a confident zero |

---

## E — The client, and what changed today

### The catalogue is not an availability authority

**Owner ruling, applied now** — it needed no deployment. The `/inventory` availability column fell
back to the static catalogue's `warehouseQty` for a Part with no ledger activity.

That cell has been wrong twice, in the same direction. It first rendered `12 (baseline)` — a number
welded to a caveat that nothing could sort, filter or report on. The previous package separated the
two, which made it readable and stopped short of the actual problem: **the number**.

> The catalogue proves a Part **exists**. It does not prove we physically have N of it.

It now reads **"Not known"**, carried as `null` — never `0`, because a formatter handed a zero would
print one.

`PART_CATALOGUE_BASELINE_IS_NOT_AVAILABILITY` is **resolved**, and kept in the register rather than
deleted: a closed gap is the record of a decision.

### What has NOT changed

`/inventory` still reads the whole catalogue and the whole ledger. **The batched callable is
`active: false` and undeployed**, so switching the list onto it now would replace a working screen
with an empty one for every user. The read exists, is tested, and is repo-complete behind the same
gate every other governed callable sits behind.

**Migrating the list is a deploy-gated follow-on, not a code gap.**

### Existence remains independent of any page

Unchanged and still enforced by test: scanner lookup, receiving, the Work Order parts plan and the
canonical name resolver all read the **whole** catalogue. `NOT IN CURRENT PAGE ≠ DOES NOT EXIST`.

---

## F — Tests

**19 proofs** in `functions/test/partBalanceBatchReadService.test.mjs`, against a **recording fake
Firestore** — it records every query, because the read shape is what this service changes and a stub
that ignored queries would pass every value assertion while still issuing one read per part.

The two load-bearing ones: **deep-equality parity** with the per-part composition, and the
**read-count** assertion (50 parts → 2 ledger + 1 warehouse + 1 PO, with `in` clauses never
exceeding Firestore's ceiling of 30).

Gates: functions **45** balance tests · node **229/229** · client **1,897** · lint 0 errors ·
typecheck clean (both packages) · build ok.

**No new capability, no new role, no new collection, no writes, no Rules change.**

---

## Remaining, and why

| | |
|---|---|
| `INVENTORY_HEALTH_SUMMARY_AND_GLOBAL_SORT_GAP` | needs materialization — a staleness decision |
| `PART_CATALOGUE_RECONCILIATION_CANNOT_BE_PAGED` | needs the §8 split of reconciliation from list rendering |
| `/inventory` bounded paging | **deploy-gated**: activate + grant `inventory.balance.read`, deploy `getPartBalances` |
| 2 Accounts composite indexes | still pending operator deploy — deliberately **not** folded in (§36) |

Carried untouched: `PART_LIST_BALANCE_N1_GAP` (Part Master balance columns) ·
`PART_INVENTORY_VALUATION_AUTHORITY_GAP` · `PART_BUSINESS_LINE_NOT_AUTHORITATIVE` ·
`PART_SUPPLIER_IS_MANY_TO_MANY` · `PART_DESCRIPTION_SEARCH_INDEX_GAP` ·
`CUSTOMER_NAME_NOT_SORTABLE_ON_RELATED_LISTS` · the 8 Account gaps · the PO money-collection split.
