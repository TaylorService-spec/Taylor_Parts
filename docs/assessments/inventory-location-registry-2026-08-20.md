# Authoritative location registry — reconciliation and the decision it requires

**Date:** 2026-08-20 · **Baseline:** `origin/main` at `989d731f` (Phase H, #1359)
**Status:** ANALYSIS COMPLETE — **blocked on an Owner decision**. No code was written.

Scanner program Phase I asked for *"one authoritative physical location hierarchy suitable for
receiving, staging, bins, trucks and later movement"*, and instructed: *"If establishing the registry
requires a new material custody/business-policy decision, stop and present that decision."*

It does. This file records what exists, what does not, and the exact decision.

---

## 1. What exists today

| Thing | Where | State |
| --- | --- | --- |
| Location **types** | `domain/inventoryLocation.js` | `WAREHOUSE`, `BIN`, `MOBILE`, `VENDOR`, `CUSTOMER`, `VIRTUAL` — a pure, fail-closed reference contract |
| Location **reference** | same | `{ type, locationId }`, carried by the ledger and every movement command |
| `warehouses` | collection + Rules | Real. `status` (ACTIVE/INACTIVE) is the governed receiving-eligibility authority (I-LA C2) |
| `mobile_locations` | collection + Rules (`firestore.rules:1235`) | Real. Trucks; `displayLabel` resolved by `getLocationDisplay` |
| `getLocationDisplay` | `inventoryLocation/locationDisplayReadService.ts` | Resolves **WAREHOUSE and MOBILE only**. Every other category resolves UNRESOLVED, deliberately |
| `stock_locations` | collection + Rules | One doc per `(warehouseId, partId, binCode)` — see §2 |
| `locations` | collection + Rules (`firestore.rules:1347`) | **Customer service sites (CRM)**, not inventory locations. Different concept entirely |

## 2. There is no bin registry

`binCode` exists, but only as a **field on a quantity record**: `stock_locations` documents are keyed
`${warehouseId}__${partId}__${binCode}`. That is a quantity-at-a-bin record, not a bin.

There is **no bin document anywhere** — no `bins` collection, no Rules match block, no bin identity,
no bin status, no bin function (receiving / staging / quarantine), no parent-child hierarchy, and no
validation that a scanned bin code refers to anything real.

And `stock_locations` itself is not a live authority:

- **Nothing in the codebase writes it.** It is a seeded legacy projection.
- The Owner **superseded it** as a stock authority on 2026-08-17 in favour of the ledger, after the
  two diverged in both directions in the sandbox — real stock refused, imaginary stock promised.
- `warehouseReconciliationEngine.ts` documents that its own bin-vs-ledger check "structurally never
  executes", because the ledger carries no `warehouseId`.

## 3. BIN is a type nothing accepts

The reference contract admits `BIN`. **Every governed authority rejects or ignores it:**

| Authority | Line | Behaviour |
| --- | --- | --- |
| Availability / on-hand | `fulfillmentAvailability.ts:100` | `if (loc.type !== "WAREHOUSE") continue;` — BIN rows are **not counted** |
| Receiving | `receivingCallables.ts:86` | `if (loc.type !== "WAREHOUSE") throw` |
| Receiving location resolver | `receivingLocationResolver.ts:36` | WAREHOUSE only |
| Transfer | `transferCallables.ts:51` | WAREHOUSE or MOBILE only |
| Cycle count | `cycleCountCallables.ts:48` | WAREHOUSE or MOBILE only |
| Location display | `locationDisplayReadService.ts` | WAREHOUSE or MOBILE; BIN → UNRESOLVED |

So a bin is currently a vocabulary word with no registry, no writer, no reader and no command.

## 4. Why this is a business decision, not an engineering one

**The blocking issue is custody roll-up.**

`sumLedgerEligibleOnHand` counts a movement only when `location.type === "WAREHOUSE"`. Put-away
(Phase J) moves stock from where it was received to where it is stored. If that destination is a
`BIN`, then **the moment a receipt is put away, every existing availability calculation stops seeing
it** — the stock would silently vanish from sellable on-hand, from transfer sufficiency, and from
cycle-count expected quantity.

There are three coherent answers, and they are materially different businesses:

| Option | What it means | Consequence |
| --- | --- | --- |
| **A — Bins are sub-locations that roll up** | A BIN belongs to a warehouse; availability sums the warehouse *and* its bins | Existing math must learn the parent-child rule. Stock stays sellable once put away. Requires the registry to be authoritative about parentage |
| **B — Bins are a label, not a location** | Put-away records a bin *attribute* on the movement; `location` stays the WAREHOUSE | Nothing existing changes; availability keeps working untouched. Bins become descriptive, so bin-level counting and bin-to-bin moves are weaker |
| **C — Bins are full custody locations** | A BIN is a first-class location like a truck; stock at a bin is not warehouse stock until moved | Cleanest model, largest change: every authority above must be taught bins, and existing ledger history (all at WAREHOUSE level) becomes a different meaning from new history |

**These are not equivalent.** A determines that "on hand at the warehouse" includes binned stock; B
determines that bins never affect any number; C determines that binning stock changes what it is
available for. Picking one silently would embed a warehouse-operations policy in a code change.

## 5. The rest of the registry raises its own questions

Answering §4 is necessary but not sufficient. The registry also needs:

1. **Granularity.** Is a bin a rack, a shelf, or a slot? One level, or `zone → aisle → rack → bin`?
   This decides label printing, scan effort, and how long a cycle count takes.
2. **Function.** Phase I lists receiving/staging and "inspection/quarantine **where already
   supported**". Quarantine is **not** supported anywhere today — no state, no command, no field.
   Whether received goods are quarantined pending inspection is a quality-control policy, and
   Ventana ice machines may answer differently from Taylor parts.
3. **Scope.** Bins per warehouse is obvious; whether bin identity is unique per operating company
   (Taylor vs Ventana) is not.
4. **Existing history.** Every ledger row ever written is at WAREHOUSE level. Under option A or C
   that history means something slightly different from new history, and the registry has to say
   what.

## 6. What is NOT blocked

Warehouse and truck locations are already authoritative and complete: `warehouses` with governed
ACTIVE/INACTIVE eligibility, `mobile_locations` for trucks, and `getLocationDisplay` resolving both.
Receiving, transfer and cycle count all operate on them today. **No work is needed there**, and
nothing in the scanner program so far depends on bins.

What is blocked is everything below the warehouse: put-away (Phase J), pick/stage (Phase L) and
bin-level counting (Phase N) all need a destination that can be validated and resolved.

## 7. Recommendation

**Option B for the first slice**, then A or C later if warehouse operations justify it.

Rationale: B is the only option that adds bin *visibility* without changing what any existing number
means. Put-away would record "these units are in rack 14" as an attribute of the movement, the stock
stays warehouse stock, and every existing authority keeps working untouched. It is also the only
option that can be reversed cheaply — a descriptive attribute can become a real location later,
whereas ledger history written under C cannot easily be reinterpreted.

The cost is honest and worth stating: under B, a bin-to-bin move is not an inventory movement, and
"how many are in rack 14" is only as good as the last movement's attribute. If warehouse operations
need bin-level accuracy for counting, A or C is the right answer and the existing math must be
taught parentage.

**This recommendation is not a decision, and no code has been written either way.**
