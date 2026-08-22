# `onOrder` is UNKNOWN for every canonical Purchase Order

**Status:** open — blocks Certification World Pass 2A (ON_ORDER cannot be derived)
**Found:** 2026-08-22, building canonical purchasing fixtures against the real adapter
**Severity:** the `onOrder` figure is silently UNKNOWN wherever canonical POs are used
**Fix size:** one line, plus a test that uses a stored shape

---

## What happens

`sumOpenOrderedQuantity` (`functions/src/inventory/partBalanceReadService.ts`) returns `null` — UNKNOWN — for every part on a canonical purchase order. Since `onOrder` feeds the ON_ORDER inventory condition, **no part can ever be classified ON_ORDER from a canonical PO.**

Proven against a real stored document in the emulator:

```
stored canonical PO keys: createdAt, id, items, status, supplierId, totalCost, updatedAt
has .items?  true      has .lines?  false
items: [{ "partId": "CW-P-0003", "quantity": 18, "unitPrice": 17.5 }]

sumOpenOrderedQuantity([storedDoc], "CW-P-0003")                      -> null
sumOpenOrderedQuantity([{ ...storedDoc, lines: storedDoc.items }], …) -> 18
```

Same data. Only the field name differs.

---

## Why

Two shapes exist, and the function reads the wrong one.

| | Field | Produced by |
|---|---|---|
| **Stored** document | `items` | `procurementService.createPurchaseOrder` |
| **Normalized** in-memory object | `lines` | `normalizeCanonicalPurchaseOrder`, *from* `data.items` |

`readPartBalance` passes **raw stored documents** straight through:

```ts
const openOrders = poSnap.docs
  .map((d) => d.data() as Record<string, unknown>)     // RAW — never normalized
  .filter((po) => …OPEN_PURCHASE_ORDER_STATUSES.includes(po.status));
…
openOrderedQuantity: sumOpenOrderedQuantity(openOrders, partId)
```

and `sumOpenOrderedQuantity` reads `po.lines`:

```ts
const rawLines = Array.isArray(po.lines) ? po.lines : null;
const lines = rawLines ?? (typeof po.partId === "string" ? [po] : []);
```

**`lines` is the normalized shape. It never appears in a stored purchase order.** The fallback only rescues the legacy single-line layout, where the order itself carries `partId`.

The function's own comment states the intent it does not fulfil:

> *"Reads the CANONICAL multi-line shape (Phase C) and the legacy single-line shape, because both exist in stored data"*

Both shapes do exist — but the canonical one is `items`, and this reads `lines`.

---

## Why the tests are green

Every existing case hand-builds the normalized shape:

```js
sumOpenOrderedQuantity([{ lines: [{ partId: "PRT-1001", quantity: 10, receivedQuantity: 3 }] }], "PRT-1001")
```

The function is exercised with **data that never occurs in storage**, so the suite proves the arithmetic and says nothing about whether the field is ever found. This is the failure mode of a test that encodes the wrong shape: it can be thorough, correct, and still describe a world the database does not contain.

The legacy fallback *is* tested with a realistic stored shape (`{ partId, quantity, receivedQuantity }` at the top level), which is why legacy POs work and canonical ones do not.

---

## Blast radius

Anything reading `PartBalanceProjection.onOrder`:

- the ON_ORDER inventory condition — **cannot occur** for canonical POs
- "is more already on order?" — answers UNKNOWN rather than a quantity
- any reorder/procurement view distinguishing *shortage* from *shortage with supply coming*

It fails **quietly**. `null` is a legitimate value meaning "no purchase order mentions this part at all", so the caller cannot distinguish *nothing is on order* from *the reader could not see the order*. A part with 18 units inbound reads identically to one nobody ordered.

---

## Suggested fix

Read both stored layouts, keeping `lines` for any already-normalized caller:

```ts
const rawLines = Array.isArray(po.lines) ? po.lines
  : Array.isArray(po.items) ? po.items          // canonical STORED shape
  : null;
```

`items` lines carry `{ partId, quantity, unitPrice }` — the same `partId`/`quantity` the existing arithmetic already reads, so nothing downstream changes.

**And add a test built from a real stored document**, not a hand-written normalized one. The gap was never in the arithmetic; it was in the shape the tests assumed.

---

## Why this was not fixed here

Changing what `onOrder` returns alters a product read path everywhere it is consumed, not just in fixtures. That is a material behaviour change and belongs to a decision, not to a fixture pass — so it is reported with evidence rather than patched in passing.

The Certification World purchasing fixtures are complete and correct: 5 canonical POs (4 `SENT`, 1 `APPROVED`), created through `procurementService` and its governed transitions, idempotent on re-run. They are waiting on this one line.
