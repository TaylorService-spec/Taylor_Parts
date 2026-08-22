# Seeded opening balances claim receipts that never existed

**Status:** open · fixture defect, not a product defect
**Found:** Pass 2A reference-integrity sweep, 2026-08-22
**Scope:** Certification World inventory baseline (emulator `demo-certworld`)
**Dangling references:** 32

## What the sweep found

Thirty-two seeded inventory movements carry:

```
type:         "RECEIVED"
sourceObject: { type: "RECEIVING_ORDER", id: "cw-seed-<partId>" }
```

No `receiving_orders/cw-seed-<partId>` document exists, and none ever did. The ids were minted by
the inventory-plan applier to satisfy a required field.

## Why the ledger required one

`MOVEMENT_SOURCE_TYPE` binds each movement type to exactly one source-object type, and `RECEIVED` is
bound to `RECEIVING_ORDER`. The validator checks that the source object is *well-formed* — a
discriminated `{ type, id }` whose type is in the closed set — but it does not, and cannot cheaply,
check that the named document exists. So a synthetic id passes.

The fixture therefore satisfied the contract's shape while asserting something untrue: that thirty-two
deliveries were received against thirty-two receiving orders.

## Why it is wrong in substance, not just in bookkeeping

An opening balance is not a receipt. Nothing arrived from a supplier; the world simply starts with
stock in the room. Modelling it as `RECEIVED` makes the ledger claim a causal history it does not
have, and any future feature that walks from a movement back to its receipt — a landed-cost report,
a supplier quality trace, a "why do we have these?" answer — will find nothing at the other end and
have no way to distinguish that from data loss.

It also quietly inflates receiving history. A report counting receipts by month would show
thirty-two deliveries that never happened.

## The fix

Model opening balances as what they are:

```
type:         "ADJUSTED"
sourceObject: { type: "ADJUSTMENT", id: <a real adjustment record, or an opening-balance id that IS created> }
```

`ADJUSTMENT` is already in `SOURCE_OBJECT_TYPES` and `ADJUSTED` already maps to it, so this needs no
product change.

## Why it was not fixed in Pass 2A

Changing the movement type rewrites the whole 142-movement baseline, which changes every balance the
Pass 2A evidence was derived from — including the G03 BEFORE/PARTIAL/COMPLETE snapshots that were
captured once, against a clean baseline, and are not supposed to be rebuilt. Correcting this and
re-running the receipt lifecycle in the same pass would mean the lifecycle evidence and the world it
describes were produced from two different baselines.

It is the first item of **Pass 3**, where the inventory baseline is being touched anyway for
transfers, cycle counts and returns.

## What this is not

Not a product defect. The ledger's source-object contract behaved exactly as designed: it validated
shape and left referential existence to whoever writes the data. The fixture is what asserted a
false link.

Worth noting nonetheless that **nothing in the system checks it**. The sweep that found this is a
certification tool, not a product guard. If real data ever acquires a movement pointing at a
receiving order that does not exist, no part of the running system will say so.
