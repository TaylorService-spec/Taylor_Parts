# Inventory Health: derive-at-read vs materialized projection

**Owner decision memo.** Requested 2026-08-24 alongside the instruction to freeze Inventory Health
work until this returns. Analysis only — nothing in this memo has been built.

The question is not "which is better engineering". Both options are correct. They differ in **what
they are willing to be wrong about**, and that is a business choice.

---

## The two options, stated honestly

**A — derive at read (what exists today).** Every health figure is computed from durable facts on
each read: ledger, ACTIVE warehouses, open purchase orders, committed receipts. `composePartBalance`
is the single authority; `readPartBalances` batches the read shape so a page of 50 parts costs
2 ledger + 1 warehouse + 1 PO query instead of ~200. Nothing is stored, so nothing can go stale.
This mirrors `financeReadProjection.ts`, where a possibly-stale stored AR balance is deliberately
never trusted.

**B — materialized projection.** A stored per-part health document, updated by triggers on ledger,
warehouse, PO and receipt writes. Health becomes an indexable field: sortable, filterable and
countable across the whole population, at the cost of being a **copy** that can disagree with source.

---

## What each option can and cannot do

| requirement | A — derive at read | B — materialized |
|---|---|---|
| per-row health on a bounded page | **yes, today** | yes |
| bounded paging of `/inventory` | **yes** (deploy-gated, code complete) | yes |
| **sort the whole list by health** | **no** — nothing stored to `orderBy` | **yes** |
| **filter by health across all parts** | **no** | **yes** |
| whole-population counts ("how many parts are critical") | **no** | **yes** |
| Dollars / Goals Home rollups | **no** — cannot scan the population per page load | **yes** |
| reporting / export over health | **no** | **yes** |
| freshness | **exact** — no lag to define | lag = trigger latency, unbounded on failure |
| can it be wrong? | **no** — it *is* the source calculation | yes: drift, missed trigger, partial rebuild |
| rebuild / repair machinery | **vacuous** — nothing to rebuild | required, and must be tested |
| failure mode | read fails loudly | read succeeds and shows a **stale number nobody doubts** |

That last row is the whole memo. A is unable to answer some questions. B answers all of them and can
answer some of them wrongly, silently, in a way that looks authoritative.

`INVENTORY_HEALTH_SUMMARY_AND_GLOBAL_SORT_GAP` already records exactly this: closing it means
accepting staleness in exchange for queryability.

## Scale — the honest numbers

Measured in sandbox 2026-08-24: **52 parts, 103 ledger rows.** Production part volume and inventory
write frequency are **not measured** and are the one input this memo cannot supply. They decide the
answer, and they are cheap to obtain.

- At **hundreds** of parts: A is comfortable. Bounded paging at 50/page is 4 queries per page.
- At **thousands**: A still renders pages fine. What breaks is not the list — it is any question
  about the *population*: a Goals Home tile that says "18 parts are critical" must scan every part,
  and derive-at-read cannot do that on a page load at any volume.
- Write frequency matters only for B: every ledger, warehouse, PO and receipt write becomes a trigger
  fan-out, and each is a chance to drift.

**The load-bearing distinction is not part count. It is whether the product needs to ask questions
about the whole population.** Paging a list does not. Sorting by health, filtering by health,
counting criticals, and any Dollars/Goals rollup do.

---

## Recommendation

**A for the list. B only when a named population-level surface is actually authorized — and then
scoped to that surface, not made the general authority.**

Concretely:

1. **Do not materialize now.** The list work A enables is complete and deploy-gated; materializing
   first would add a staleness class before anything needs it.
2. **Measure production part count and inventory write rate.** One read-only script. It converts this
   from judgement to arithmetic.
3. **When a population question is authorized** (Goals Home health tile, health sort, health export),
   build B as a *summary* projection serving that surface, with `composePartBalance` remaining the
   only authority for any number a person acts on. A stored count that says "18 critical" is a
   navigational aid; the row a buyer commits money against is still derived at read.
4. If B is ever built, it needs, non-negotiably: a rebuild path, a source/projection parity test that
   compares stored against freshly derived, and a **visible staleness stamp**. An undated stale number
   is the failure mode this whole architecture exists to avoid.

**What is being refused:** making B the general balance authority. Two authorities for one number is
how a warehouse and a screen come to disagree, and the screen wins the argument because it is the one
somebody is looking at.

---

## Decision — MADE

**Owner, 2026-08-25: A NOW, B LATER, SCOPED.**

- [ ] ~~A only~~
- [x] **A now, B later, scoped** — **CHOSEN**
- [ ] ~~B now~~

`composePartBalance` remains the single authority for every number a person acts on. B is not
refused; it is **not yet justified**, because no authorized surface asks a population-level question.

What this decision permits now:

- continue deriving health at read, per bounded page;
- the deploy-gated bounded paging of `/inventory`, unchanged.

What it defers, and the trigger that reopens it: **B is revisited when a population-level surface is
authorized** — a Goals Home health tile, a health sort, a health filter, or a health export. Until
one of those is named, building B would be adding a staleness class to answer a question nobody has
asked.

The four non-negotiables recorded above survive the deferral and are conditions on ever building B:
a summary projection serving one named surface (never the general balance authority), a rebuild
path, a source/projection parity test, and a visible staleness stamp.

**Not authorized by this decision:** implementing B, adding triggers, or storing any health figure.
