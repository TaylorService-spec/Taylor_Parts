---
artifact_type: assessment
gate: Reconciliation
status: Complete
date: 2026-09-03
owner: Claude Code
related_adrs: ["ADR-014"]
related_decisions: ["#160", "#168", "#169"]
---

# BIN-P6 — Ruling-8 Transfer reconciliation, and what measuring it exposed

**Source verified against** `origin/main` @ `0dd5e104e2c5fe65179c7eceeb2e9c0d0c1adab0` on 2026-09-03. Analysis only: this document
changes no behaviour.

Decision #169 Ruling 8 requires that, **before Transfer behaviour changes**, P6 reconcile how existing
Warehouse-level Transfer orders choose exact source stock under Model A — and **STOP** if Transfer
cannot remain truthful without a new allocation/source-location contract.

## The answer: NO STOP

**Existing Transfer can remain truthful under Model A with no allocation contract.**

`functions/src/inventoryTransfer/transferOrderCommand.ts:137-155` computes NONE-mode sufficiency by
summing operational ledger rows, filtered on line 149:

```ts
if (v.location.type !== location.type || v.location.locationId !== location.locationId) continue;
```

This is an **exact-location match**, not an aggregate. Consequences, each of which is precisely what
Ruling 7 demands:

| Ruling 7 requirement | Current Transfer |
|---|---|
| A movement cannot invent which child Bin stock came from | **Cannot** — it never reads child bins at all |
| `WAREHOUSE` means direct / unbinned stock | **Already true** — it sums only rows whose location *is* that warehouse |
| Never subtract from a parent because aggregate exists in children | **Cannot** — sufficiency and debit use the same exact ref |

The debit is written at that same exact origin, so the location Transfer *verified* is the location
Transfer *decrements*. There is no gap between the two for a bin to fall into.

**What changes under Model A is capability, not correctness.** Once stock is put away, a
`WAREHOUSE`-origin transfer sees only the direct/unbinned balance and will **refuse as insufficient**
if that balance is short — even though the warehouse physically holds the goods in its bins. That is
an **honest refusal**, not a false success, and it is the behaviour Ruling 7 prescribes. The operator's
remedy is to originate from the exact Bin, which is the correct answer rather than a workaround.

### What Transfer does need (additive, and not an allocation contract)

`functions/src/inventoryTransfer/transferOrderValidation.ts:22-30` restricts endpoints:

> *"Phase-4-scoped location reference: `{type, locationId}`, type restricted to `WAREHOUSE|MOBILE`. A
> `CUSTOMER/BIN/VENDOR/VIRTUAL` endpoint (legal in the broader EI-P1a vocabulary) fails closed HERE."*

So **every BIN-endpoint transfer that Decision #169 Rulings 5 and Part B assign to Transfer is refused
today**: `BIN → MOBILE`, `MOBILE → BIN`, and `BIN in Warehouse A → Warehouse B`. Delivering the truck
journeys requires widening `TRANSFER_ENDPOINT_TYPES` to admit `BIN`. That is **additive**, preserves
the exact-location sufficiency above unchanged, and requires no allocation or source-selection
contract — so it does not trip Ruling 8's stop either.

## The larger finding: three readers, one unsafe assumption

Measuring Transfer surfaced something more dangerous than the question asked. **Three separate readers
treat a location scalar as a Warehouse, and silently drop BIN-located stock.**

### 1. The governed NONE on-hand derivation — the severe one

`functions/src/fulfillment/fulfillmentAvailability.ts:106`, inside `sumLedgerEligibleOnHand`:

```ts
if (!loc || loc.type !== "WAREHOUSE" || typeof loc.locationId !== "string") continue;
```

Every `BIN` row is skipped. Consider the ruling's own primary example once relocation is real:

| Row | Location | Counted? |
|---|---|---|
| `RELOCATION_OUT` −10 | `WAREHOUSE/WH-1` | yes, if added to the physical set |
| `RELOCATION_IN` +10 | `BIN/bin_x` | **no — skipped** |

**Net effect: a purely internal shelf-to-shelf move destroys 10 units of warehouse on-hand.** That
directly contradicts Decision #169 Ruling 4 ("Warehouse aggregate change: ZERO") and Ruling 7's
derived-read definition. It is the same class of error Decision #168 Ruling 7 pinned by test — a
subtraction that "would drive the warehouse negative and erase stock still on the shelf" — reached by a
new route.

### 2. Serialized analytics

`functions/src/inventoryAnalyticsCallables.ts:85`:

```ts
if (typeof asset.currentLocationId !== "string" || !eligibleWarehouseIds.has(asset.currentLocationId)) continue;
```

A serialized asset counts only while its `currentLocationId` is an **eligible warehouse id**. The
moment P6 sets a serial's location to a bin — which Decision #169 Part B requires, without a parallel
serial-location table — that unit **vanishes from analytics on-hand**.

### 3. Cycle Count expected quantity

`functions/src/cycleCount/cycleCountExpectedQuantity.ts:70`:

```ts
.where("currentLocationId", "==", location.locationId)
```

An exact scalar match. A binned serial disappears from a warehouse-level count expectation, which
would present as a phantom shortage during a count — the worst place to discover a projection gap.

### Why none of these is a defect today, and all become one

Nothing in the system is ever located at a `BIN`: P1–P5 built bins as *places* and deliberately moved
no stock. Each reader is correct under that condition and becomes wrong the instant the first
relocation commits. **They are invisible until then**, which is exactly why they are recorded now
rather than found later by a warehouse manager whose on-hand dropped overnight.

### This is P6 scope, not a new Owner decision

Decision #169 Ruling 7 **already states the correct behaviour** — the Warehouse aggregate is a derived
read over direct `WAREHOUSE` plus all child `BIN` locations. Making these readers bin-aware *executes*
that ruling. No further authority is required.

Two implementation notes for the P6 specification:

- Sites 2 and 3 need a **bin → warehouse parentage lookup** they do not currently have.
  `sumLedgerEligibleOnHand` takes only `eligibleWarehouseIds` today, so its signature has to learn
  about parentage without becoming a second custody authority.
- The derived read must **not** be implemented by widening the eligibility set to include bin ids: that
  would make a bin look like a sellable warehouse. Parentage must resolve a bin **to** its warehouse.

## Scope this reconciliation implies for BIN-P6

Beyond the relocation command and vocabulary themselves:

1. Make the three readers above Model-A-aware, with a parentage resolution that is not a second
   authority.
2. Widen `TRANSFER_ENDPOINT_TYPES` to admit `BIN`, preserving exact-location sufficiency.
3. Define serialized bin custody on `serialized_assets.currentLocationId` while preserving warehouse
   parentage — no parallel table.
4. Decide batch atomicity (Decision #169 Part C): all-or-nothing versus per-line results.

## What was NOT done

No relocation command, no ledger vocabulary, no Transfer change, no reader change, no scanner surface,
no serialized custody change, no activation or grant, no Rules change, **no deployment**. **BIN-P6 is
Tier-2 and remains unstarted.**
