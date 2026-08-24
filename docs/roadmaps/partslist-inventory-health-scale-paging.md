# QUEUED PACKAGE — PartsList / Inventory Health: Scale + Paging

**Status:** QUEUED. Owner-authorized 2026-08-24 as a package of its own.
**Explicitly NOT to be folded into** the Customers / Accounts migration, or into any other object list
migration. Scope is defined here; implementation is a later package.

---

## Why this is separate

The Parts structured-list migration (`b7fd80d4`, PR #1444) bounded the **Part Master** list at
`/inventory/part-master` and left `/inventory` **PartsList** unbounded on purpose.

PartsList is not a list with a slow read. It is a **composition**:

```
fetchPartMasterList()  (whole canonical catalogue)
  × PARTS_CATALOG      (static compatibility input)
  × useInventoryLedger (one-shot inventory_transactions read)
  → buildPartsCatalogRows → the catalog table AND the Inventory Health / urgency queue
```

Paging the catalogue changes what the **health queue** is computed over. A queue derived from page 1
is not "the parts that need attention" — it is "the parts that need attention among the first fifty,
alphabetically". That is a different business statement wearing the same label, and nobody looking at
the screen would know.

So this is a **semantics** package that happens to involve paging, not a performance package.

---

## Scope

1. **`/inventory` PartsList catalogue paging** — bounded, ordered, cursored, reusing
   `fetchPartMasterPage` rather than a third read path.
2. **Inventory Health semantics under paging** — decide and record what the queue is computed over.
   The queue must not silently narrow. Options to evaluate: a server-side health projection, a
   materialized attention rollup, or an explicitly-scoped queue that says what it covers.
   **Constraint: paging must not redefine "Inventory Health" incidentally.**
3. **Ledger / balance relationship** — `useInventoryLedger` is itself a whole-collection read of
   `inventory_transactions`. Bounding the catalogue while leaving the ledger unbounded moves the cost
   rather than removing it.
4. **`PART LIST BALANCE N+1 GAP`** — `getPartBalance` is a single-part callable. A list-scoped balance
   projection or an explicitly bounded batch read is the resolution; the columns stay off the list
   until one exists.
5. **The seven remaining whole-catalogue readers**, tracked in
   `services/partMasterQueries.PART_CATALOGUE_WHOLE_COLLECTION_READ`. Each wants a **targeted** read of
   its own — lookup by part number, a searched picker, a single-document detail read.
6. **Structured filter / sort integration** — mount the shared metadata-driven controls in PartsList
   the way Part Master now has them, reusing `PART_FIELDS`. No second Parts filter registry.
7. **Mobile regression**, four widths, in a real browser — including the card treatment for the
   compressed-table readability finding recorded in the Parts migration doc.

---

## The hard constraint, restated

> A bounded catalogue read must **never** produce "part does not exist".

This is the defect the Parts migration caught in itself before shipping. `LookupScan` reports a scanned
part as non-existent if the catalogue read it consults was truncated — a **wrong answer**, not a slow
one, and nothing on screen says so. Any paging introduced here must be paired with a targeted lookup
for every consumer that asks an existence question.

---

## Out of scope

- Financial or valuation fields (`PART INVENTORY VALUATION AUTHORITY GAP` stays with Financial
  Architecture)
- Business line on the Part
- Any change to Part Master write authority or Rules

---

## Entry criteria

Customers / Accounts structured list + related-field projection returns and is approved. The projection
pattern established there is expected to inform how a list-scoped balance or health projection is
shaped here.
