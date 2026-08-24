# PartDetail — decomposition map

**Analysis only.** No Part code was changed by the record-page package; this is the map its
migration needs. Measured from source at `main` after PR #1460.

## The headline

`PartDetail.jsx` is **1,685 lines**, and **978 of them — 58% — are the reorder-request workflow.**

It is not a record page carrying some extras. It is a **procurement workflow surface with a record
page attached**, and that is why it is the one core object whose migration is a decomposition rather
than a re-layout.

## Where the lines go

| lines | responsibility | belongs |
|---:|---|---|
| 346 | Inventory Action Log | related panel / subpage |
| 146 | Reorder — Purchasing In Progress | reorder workflow |
| 122 | Reorder Request (host + routing) | reorder workflow |
| 118 | Reorder — Pending Review | reorder workflow |
| 93 | Cancel Reorder Request action | reorder workflow |
| 90 | Reorder — Ordered | reorder workflow |
| 85 | Reorder — Voided | reorder workflow |
| 85 | Stock Position & Reorder Status | inventory panel |
| 82 | Reorder — Assigned to Parts Associate | reorder workflow |
| 75 | Reorder — Ready for Parts Manager | reorder workflow |
| 70 | Record Purchase Order | procurement action |
| 53 | Reorder — Cancelled | reorder workflow |
| 46 | Catalog | **record page** |
| 29 | Recent Transactions | inventory panel |
| 24 | Reorder — Received | reorder workflow |
| 21 | Mark Received | procurement action |

Eleven of those sixteen blocks are one workflow rendered eleven times, once per state.

## Responsibilities, grouped

**Part Master record** — the only part that is a record page. Catalog identity, identifiers,
manufacturer resolution. `PartIdentifiersSection` is already a shared component.

**Inventory** — stock position, ledger, recent transactions, the action log. Reads
`useInventoryLedger`, writes through `recordInventoryAction`.

**Procurement / reorder** — the 58%. Eleven request states, each with its own panel, plus Record
Purchase Order and Mark Received. Writes through `recordPurchaseOrder` / `voidPurchaseOrder`.

**Demand** — `PartWorkOrderDemandSection`, already extracted.

**Where-used** — `UsedInEquipmentSection`, already extracted.

## Governed write contracts

| command | what it writes | notes |
|---|---|---|
| `PartWriteModal` → Part Master write | catalogue fields | **the only field-level write**; the editable allowlist derives from here |
| `recordInventoryAction` | inventory_transactions | an ACTION, never a field patch |
| `recordPurchaseOrder` | reorder PO + request transition | atomic; an action |
| `voidPurchaseOrder` | void + request transition | an action |
| reorder request transitions | request status | lifecycle, per-state |

**Only the first produces pencils.** Everything else is action authority and must stay action
authority — the same finding that made Sales Order and Work Order read-only records.

## Suggested density, once decomposed

- **summary** — part number, description, status, stocking class, on-hand
- **details** — catalogue/master fields the Part Master write accepts
- **secondary** — manufacturer, supplier references, where-used
- **system** — identifiers, timestamps

## What should move off the page

1. **The reorder workflow (978 lines)** → its own surface, keyed by request. Eleven per-state panels
   on a record page is a workflow wearing a record page's clothes, and it is why this file is the
   size it is.
2. **The Inventory Action Log (346 lines)** → a related panel or subpage. It is history, not a
   record fact.
3. **Recent Transactions / Stock Position** → an inventory panel, adjacent to the log.

That leaves roughly **200–250 lines** of genuine Part record page, which the existing shell renders
without modification.

## Duplicated responsibility worth resolving first

`PARTS_CATALOG` (static) and `fetchPartMasterList` (canonical) are **both** imported here. Which is
authoritative for a given field is the question the migration has to answer before any layout work,
because it decides what the record page is even showing.

## Effort

**Large**, and mostly not layout. The record page itself is small once the workflow moves; the work
is extracting the reorder surface without changing any of its transitions, and settling the
catalogue-vs-canonical authority question. Recommend it stays its own package, as scoped.
