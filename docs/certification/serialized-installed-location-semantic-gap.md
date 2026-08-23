# `SERIALIZED INSTALLED LOCATION SEMANTIC GAP`

**Status: OPEN — decision required. Not fixed, deliberately.**
Observed in the certification emulator, reproduced live in `eos-platform-sandbox` 2026-08-23.

---

## 1. The behaviour

When a serialized asset is installed at a customer, `installSerializedAsset` writes exactly two
fields on it:

```
inventoryState   -> "INSTALLED"
currentEquipmentId -> the new Equipment id
```

It does **not** touch `currentLocationId`. So an installed unit still names the warehouse it left:

```
E01  serial CW-E01-000001  currentLocationId = wh-main  inventoryState = INSTALLED
E02  serial CW-E02-000001  currentLocationId = wh-main  inventoryState = INSTALLED
```

Both units are physically at customer sites. Both records say they are at the main warehouse.

## 2. Why nothing is broken today

Every consumer that counts stock filters on `inventoryState` as well as location:

| consumer | predicate | installed unit |
|---|---|---|
| `cycleCountExpectedQuantity` | `currentLocationId === origin && inventoryState === "AVAILABLE"` | excluded by state |
| `getAvailableEquipment` | availability derived from state + link | excluded — live read returned 30 rows, both installed units absent |
| `transferOrderCommand` | `currentLocationId === origin && inventoryState === "AVAILABLE"` | excluded by state |
| Available Equipment UI | `availableForAssignment` re-derived from state + link | excluded |

The Equipment record separately carries `installedFromLocationId`, which records the same warehouse
as a deliberate historical fact.

## 3. Why it is still a gap

The safety rests entirely on **every future reader remembering to filter on state**. A query written
as "what serialized units are at `wh-main`" — the obvious phrasing — would count machines sitting at
customers as warehouse stock.

That is the same class of error as counting truck stock as warehouse stock, which this platform has
already had to name (`FALSE_COMFORT`) and design around. The difference is that scope confusion is
now encoded in a field's *value* rather than in a reader's *intent*, which is harder to see.

## 4. What must be decided — three coherent answers, none chosen

### Option A — clear it

`currentLocationId = null` on install.

*For:* a null cannot be misread. Any location query excludes the unit structurally rather than by the
reader's diligence.
*Against:* the field becomes nullable for every consumer, and "where is this unit" has no answer at
all — the Equipment's `locationId` is the customer site, but the asset no longer points anywhere.
Any code path treating the field as always-present would need auditing.

### Option B — move it to the customer location

`currentLocationId = <customer locationId>` on install.

*For:* the field stays populated and becomes *true* — the unit really is at that location.
*Against:* it silently widens what a location id means. Today `currentLocationId` is a **company**
location — a warehouse or a truck — resolved by `makeResolveWarehouseLocationActive` and rendered by
`getLocationDisplay`, neither of which knows customer sites. A location query would then return
customer premises alongside warehouses, which is a *different* wrong answer to the same question, and
arguably a worse one because it looks right.

### Option C — a separate custody field

Leave `currentLocationId` as the last company custody, and add an explicit custody state.

*For:* stops overloading one field with two meanings, and preserves "where did this come from"
without making it look like "where is it now".
*Against:* a new field on a governed record, and every reader must learn it. The information already
exists on the Equipment (`installedFromLocationId` plus `locationId`), so this may be duplication
rather than clarification.

## 5. What decides it

The question underneath all three is: **does `serialized_assets.currentLocationId` mean "the company
place this unit is at", or "the place this unit is at"?**

Today it means the first, and installation is the only event that makes those two differ. Nothing in
the schema says which was intended, which is why this is a product decision and not a bug fix.

## 6. Explicitly not done here

Changing this as part of the cohort build or the install-UI slice was prohibited and would have been
wrong regardless: it would alter the meaning of a governed field across every reader as a side effect
of unrelated work, with no record of the decision.

The behaviour is asserted in `runForwardLifecycle.mjs` so it cannot change silently while it is
undecided — if a future edit clears or moves the field, that check fails and whoever made the change
is sent here.
