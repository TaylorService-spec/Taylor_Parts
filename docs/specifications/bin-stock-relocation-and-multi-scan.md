---
artifact_type: specification
gate: Sprint Specification
status: Approved
date: 2026-09-10
owner: Claude Code
related_adrs: ["ADR-014"]
related_decisions: ["#116", "#160", "#168", "#170", "#171"]
depends_on: ["bin-stable-identity-and-racking-structure", "bin-administration-racking-generator", "bin-location-labels-and-export"]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: BIN-P6 — Stock relocation authority and warehouse multi-scan

**Authority:** [Decision #170](../DECISIONS.md) (the relocation ruling, its scanner operating model and
its batch-scanning acceptance requirement), [ADR-014](../architecture/ADR-014-warehouse-and-bin-inventory-custody-model.md)
(Model A roll-up, Decision #160), Decisions #168 / #171 (Work Order physical consumption), and the
Owner's BIN completion execution directive of 2026-09-10, which approved the per-line batch posture
recorded in §9. **Source verified against** `origin/main` @ `c1d691337c8d87bcee1a0b8b692e13a6b0081c69`.

**Decision number.** The relocation ruling is **Decision #170**. It was drafted as #169 and renumbered
when PR #1779 took #169 first; the renumber reached `DECISIONS.md` but was never staged in ADR-014, the
reconciliation assessment, the capability description, or the capability-graph artifact. Those stale
references are corrected alongside this specification. No append-only decision was rewritten.

---

## 1. Executive summary

BIN-P1 through P5 built the Bin as a governed **place**: stable identity, bulk creation, and labels.
Not one unit of stock has ever moved into a Bin. P6 is where it does, so P6 changes what an existing
quantity *means*: a Warehouse's on-hand stops being "the rows at the Warehouse" and becomes "the rows
at the Warehouse plus the rows at every Bin inside it".

P6 delivers four things, in this order, because each is unsafe without the one before it:

1. **One on-hand authority.** The census found the same movement-sign rule implemented five times,
   and three copies are already wrong. Every reader moves onto one module before any Bin row exists.
2. **The relocation authority.** `relocateStock`, gated on `inventory.stock.relocate`, writing
   `RELOCATION_OUT` / `RELOCATION_IN` for movement inside one Warehouse custody parent.
3. **Bin endpoints on Transfer.** Every movement that crosses a custody boundary — including a Bin in
   Warehouse A to Warehouse B, and any Bin to or from a truck — stays a Transfer.
4. **Warehouse multi-scan.** One session, many items, one confirmation, one truthful result per line.

---

## 2. Verified current state

### 2.1 The on-hand rule is implemented five times, and three copies are wrong today

| Site | Scope | Reads `WORK_ORDER_CONSUMPTION`? | Reads `BIN`? |
|---|---|---|---|
| `fulfillment/fulfillmentAvailability.ts` `sumLedgerEligibleOnHand` | eligible-Warehouse aggregate | **yes** | **no** — skips every non-WAREHOUSE row |
| `inventoryTransfer/transferOrderCommand.ts` `computeNoneOnHandThroughTxn` | exact location | **no** | n/a (exact) |
| `cycleCount/cycleCountExpectedQuantity.ts` | exact location | **no** | n/a (exact) |
| `inventoryLedger/mobileLocationPresenceProbe.ts` | exact MOBILE | **no** | n/a |
| `inventoryAnalyticsCallables.ts` (serialized) | eligible Warehouse | n/a | **no** — a serial at a Bin vanishes |

**The consumption column is a live defect, not a P6 hazard.** Decision #171 made physical consumption
live. Since then:

- **Transfer sufficiency overstates** origin on-hand after a consumption, so it can authorize moving
  stock already fitted to a machine.
- **Cycle Count expected quantity overstates**, so a count "finds" the shortage, reconciliation posts
  an `ADJUSTED` for it, and the consumption is **subtracted twice** — once by `WORK_ORDER_CONSUMPTION`,
  again by the correction. Sales Order availability, which *does* read consumption, then reports less
  than is on the shelf.

The Bin column becomes a defect the moment P6 writes its first row: `RELOCATION_OUT` at the Warehouse
would count, `RELOCATION_IN` at the Bin would be skipped, and a purely internal move would destroy
Warehouse on-hand — directly contradicting Decision #170 Ruling 4.

Five copies of one rule are how both happened. §4 replaces them with one.

### 2.2 The ledger is ready to extend

`inventoryLedger/operationalMovementTypes.ts` owns the closed movement vocabulary, the direction map and
a one-to-one `MOVEMENT_SOURCE_TYPE` map. `stageOperationalMovement` gives deterministic doc ids,
fingerprint replay and `IdempotencyConflictError`. `counterpartyLocation` is currently permitted only on
the Transfer pair. The client mirror is `domain/inventoryLedgerEvent.js`, parity-tested.

### 2.3 Transfer is exact-location and refuses Bins

Transfer sufficiency filters on both `type` and `locationId` and debits the ref it verified.
`TRANSFER_ENDPOINT_TYPES` is `WAREHOUSE | MOBILE`, so every Bin endpoint is refused today.
`makeResolveTransferLocationActive` resolves WAREHOUSE and MOBILE only. Transfer stages ledger rows
through a **buffered store** — reads during staging, writes flushed at the end — which P6 reuses,
because a relocation stages two rows in one transaction and Firestore requires every read first.

### 2.4 Serialized custody is a typeless scalar

`serialized_assets.currentLocationId` is a scalar id with no type; Transfer completion is its only
movement writer. BIN-P1 made Bin ids globally unique, so a serial can sit at a Bin with **no new
field**. What must never happen is inferring its type or parentage from the `bin_` prefix: §6 resolves
both by looking the id up in governed collections.

### 2.5 The scanner platform exists

`domain/receivingScanQueue.js` holds raw observations with a derived aggregate (`createQueue`,
`addScan`, `undoLastScan`, `removeEntry`, `setEntryQuantity`); only `reconcile` is purchase-order
specific. `domain/scanInputPolicy.js` owns repeat and feedback policy; `domain/scannedIdentity.js` owns
resolution. `PutAwayScan`, `TransferScan`, `PickScan`, `CycleCountScan`, `ReturnIntakeScan` live under
`modules/scan/`.

---

## 3. Authority model

| Concern | Authority | Ledger | Source object |
|---|---|---|---|
| Movement inside one Warehouse custody parent | `inventory.stock.relocate` | `RELOCATION_OUT` / `RELOCATION_IN` | `STOCK_RELOCATION` |
| Movement crossing a custody boundary, incl. every MOBILE endpoint | existing Transfer commands | `TRANSFER_OUT` / `TRANSFER_IN` | `TRANSFER_ORDER` |
| A part used on a job | Decisions #168 / #171 consumption | `WORK_ORDER_CONSUMPTION` | `WORK_ORDER` |
| Where stock was stowed (evidence only) | `inventory.placement.record` | none | none |

**The operator never chooses a ledger type.** The scanner derives the command from the endpoint pair;
the server re-derives and refuses a mismatch. Placement never implies movement: a put-away that moves
stock requires **both** capabilities, each enforced independently on the server.

**No new capability.** `inventory.stock.relocate` was registered inert by Decision #170; activation and
grants are BIN-P4.

---

## 4. The on-hand authority — one module

New `functions/src/inventoryLedger/locationOnHand.ts`, pure.

### 4.1 One sign rule

```
signedQuantity(movement):
  RECEIVED, RETURNED, TRANSFER_IN, RELOCATION_IN     →  +quantity
  TRANSFER_OUT, SCRAPPED, RELOCATION_OUT             →  −quantity
  ADJUSTED, WORK_ORDER_CONSUMPTION                   →   quantity  (already signed)
```

Total over `OPERATIONAL_MOVEMENT_TYPES`, asserted by test: a new movement type without a sign fails the
build rather than silently contributing zero.

### 4.2 Exact location

`sumExactLocationOnHand(movements, location)` — rows whose location equals the ref on **both** type and
id. Used for every movement sufficiency check; it never aggregates.

### 4.3 Custody parent

`resolveCustodyWarehouseId(location, parentage)`: `WAREHOUSE` → its own id; `BIN` →
`parentage.get(locationId)` or `null` if unknown; anything else → `null`. `parentage` is built from
governed reads of `bins` — never the id prefix, never the code.

### 4.4 Warehouse aggregate

`sumWarehouseAggregateOnHand(movements, warehouseIds, parentage)` = direct WAREHOUSE rows plus rows at
every Bin whose governed parent is in the set. **Each row is counted exactly once**, because a row has
exactly one location and one custody parent; there is no path that counts a parent row and its
children as two contributions.

### 4.5 Readers moved onto it

| Reader | Uses |
|---|---|
| `sumLedgerEligibleOnHand` (fulfillment, analytics) | aggregate, with parentage |
| Transfer origin sufficiency | exact |
| Cycle Count expected quantity | exact |
| mobile presence probe | exact |
| serialized analytics | custody parent via parentage |

**UNKNOWN stays UNKNOWN**: `sumLedgerEligibleOnHand` keeps its *no physical evidence → null* contract.
A Bin that cannot be resolved contributes nothing and is **never** read as zero stock at its parent.

---

## 5. The relocation command

`relocateStock` in `functions/src/inventoryLocation/stockRelocationCommand.ts`, exported as the
callable `relocateStock`.

### 5.1 Request

```
{
  partId, source: { type: "WAREHOUSE"|"BIN", locationId }, destination: { type: "WAREHOUSE"|"BIN", locationId },
  quantity?: positive integer        (NONE)
  serialNumbers?: non-empty string[] (SERIAL)
  idempotencyKey: non-blank string,
  recordPlacement?: true             (put-away: also write placement evidence)
  pickedForWorkOrderId?: string      (context only; with recordPlacement)
}
```

Exactly one of `quantity` / `serialNumbers`; unknown fields refused. LOT parts are refused
(`lot_not_supported`): no lot custody model has been decided, and guessing one here would be a second
authority.

### 5.2 Order of checks — one transaction, every read before any write

1. Authenticated caller; `inventory.stock.relocate` through the trusted effective-access path. With
   `recordPlacement`, `inventory.placement.record` is **also** required, independently.
2. Request shape.
3. Part exists; tracking mode from the Part authority, never the request.
4. Endpoints resolve: `WAREHOUSE` → governed warehouse `ACTIVE`; `BIN` → `bins/{id}` at the current
   schema, `ACTIVE`, with its governed parent Warehouse `ACTIVE`.
5. **Same custody parent**, else `CROSS_WAREHOUSE` (*use a Transfer*). Source ≠ destination.
6. `recordPlacement` requires a `BIN` destination.
7. **NONE:** `sumExactLocationOnHand(source) ≥ quantity`, else `INSUFFICIENT_STOCK`. Nothing is borrowed
   from direct stock, another Bin, another Warehouse or a truck.
   **SERIAL:** every serial exists for this part, sits at `source.locationId`, is `AVAILABLE`, is not
   installed, and is not repeated.
8. Stage through the buffered store: `RELOCATION_OUT` at source (counterparty destination) and
   `RELOCATION_IN` at destination (counterparty source); per serial for SERIAL.
9. SERIAL: set `currentLocationId` to the destination id. Nothing else about the asset changes.
10. `recordPlacement`: stage placement records through the put-away module's stager (that module still
    never imports the ledger).
11. Stage the audit event; flush writes.

### 5.3 Idempotency

Row keys derive from the request key (`${key}:out`, `${key}:in`, plus `:${serial}`). The command
fingerprint covers part, source, destination, quantity or sorted serials, and `recordPlacement`. Same
key + same intent → `replayed`, no new rows. Same key + different intent → `IDEMPOTENCY_CONFLICT`. A
partial prior write is an integrity failure, never "finish the rest".

### 5.4 Result

`{ outcome: "relocated" | "replayed", partId, source, destination, quantity | serialNumbers,
movementIds, placementIds? }`

### 5.5 Failure taxonomy — never collapsed

| Code | Meaning | Retry |
|---|---|---|
| `UNAUTHENTICATED` / `DENIED` | no caller / missing capability | no |
| `INVALID` | request shape | no |
| `NOT_FOUND` | part, bin, warehouse or serial unknown | no |
| `RETIRED_BIN` | Bin or its Warehouse not ACTIVE | no |
| `CROSS_WAREHOUSE` | different custody parents — use Transfer | no |
| `INSUFFICIENT_STOCK` | exact source cannot cover the line | no |
| `SERIAL_NOT_AT_SOURCE` | serial elsewhere, or not AVAILABLE | no |
| `IDEMPOTENCY_CONFLICT` | same key, different intent | no |
| `RETRYABLE_TECHNICAL_FAILURE` | contention / unavailable / deadline | **yes, same key** |

Each maps to its own sanitized `HttpsError` detail token so the client can name it.

---

## 6. Serialized Bin custody

A serial at a Bin has `currentLocationId = binId`. Its **type** is established by governed lookup (the
id is a `bins` document) and its **Warehouse parent** by that document's `warehouseId`. No parallel
table, no new field, no prefix inference. Quantity math never substitutes for serial custody. Transfer
completion and relocation are the only movement writers of `currentLocationId`.

---

## 7. Transfer Bin endpoints

- `TRANSFER_ENDPOINT_TYPES` becomes `WAREHOUSE | BIN | MOBILE`.
- `makeResolveTransferLocationActive` resolves `BIN` exactly as §5.2 step 4.
- **Transfer refuses a same-custody-parent pair** (`same_custody_parent`, *use a relocation*). Without
  this the two authorities overlap and the route depends on which screen was open.
- Sufficiency stays exact-location and reads the shared sign rule, fixing its missing consumption term.

---

## 8. Routing

| Source | Destination | Command |
|---|---|---|
| WAREHOUSE A / BIN in A | WAREHOUSE A / BIN in A | `relocateStock` |
| WAREHOUSE A / BIN in A | WAREHOUSE B / BIN in B | Transfer |
| WAREHOUSE / BIN | MOBILE | Transfer |
| MOBILE | WAREHOUSE / BIN | Transfer |
| MOBILE | Work Order | #168 / #171 consumption |

The client derives the route with the **same** custody-parent rule; the server re-checks. No
`quickMove`, `scannerMove`, `binTransferLite`, `truckQuickTransfer` or generic movement writer.

---

## 9. Warehouse multi-scan

### 9.1 Session

A movement session fixes the **source** (emptying a Bin) or the **destination** (filling one), then
accepts any number of item scans.

- **SCAN = OBSERVATION. CONFIRMED GOVERNED COMMAND = MOVEMENT.**
- Observations reuse the shared queue primitives, extracted from `receivingScanQueue.js` into
  `scanObservationQueue.js` with Receiving re-exporting them unchanged — **one** queue.
- Repeated NONE scans add intentionally; a repeated serial is a duplicate and is blocked.
- Unresolved identity is its own visible state, never dropped.
- Observations group into **movement lines**: one per part for NONE, one per serial for SERIAL.

### 9.2 Approved batch posture — per-line, replay-safe

Approved by the Owner on 2026-09-10; this closes the question Decision #170 Part C left open.

- Each line gets its **own** governed command and its **own** truthful result.
- A successful line stays applied; a failure on line 7 never fabricates failure for lines 1–6.
- Failed and unresolved lines stay visible with their specific code.
- A retry reuses **that line's** idempotency key, so an applied line replays rather than moving twice,
  and changed intent under the same key is a conflict.
- Each line's key derives from the session id plus the line identity, so no line can replay another's.
- No aggregate "Success" may conceal a partial failure; the summary counts each outcome.
- Business refusals are not retried automatically; `RETRYABLE_TECHNICAL_FAILURE` is.

This is **not** whole-batch atomicity, and nothing in the approved authority requires it.

### 9.3 Journeys

| Journey | Session | Route |
|---|---|---|
| Put away | destination = Bin; source = Warehouse direct; placement recorded | relocation (+ placement) |
| Move Bin → Bin | source- or destination-locked | relocation |
| Remove from Bin | source = Bin, destination = Warehouse direct | relocation |
| Send to truck | destination = MOBILE | Transfer |
| Receive from truck | source = MOBILE | Transfer receipt |

Technician journeys (Receive Stock, Return Stock, Use on Job) reuse Transfer and #171 consumption.
Capability, not persona, decides which controls appear; missing authority is stated, never faked.

---

## 10. Non-goals

No lot custody. No part-to-bin exclusivity, preferred bins or assignments. No whole-batch atomicity.
No historical backfill: existing WAREHOUSE rows stay truthful direct stock. No Admin toggle for any
domain invariant. No BIN Cycle Count (P7), no multi-part counting (P8). No activation or grants (P4).
No deployment.

---

## 11. Tests

**On-hand authority.** Conservation below; sign rule total over the vocabulary; consumption now
reduces Transfer and Cycle Count on-hand; an unresolvable Bin is excluded, never zero; UNKNOWN stays
null; every reader imports the shared module (static proof).

```
receive 10 at WH        direct 10               aggregate 10
relocate 4 WH → A       direct 6, A 4           aggregate 10
relocate 3 A → B        direct 6, A 1, B 3      aggregate 10
relocate 2 B → WH       direct 8, A 1, B 1      aggregate 10
company total                                   unchanged throughout
```

**Relocation command.** Every failure code; exact-source sufficiency never borrows; cross-Warehouse
refused; retired Bin refused; parentage from the Bin document only; serial moves and stays unique;
replay writes nothing; changed intent conflicts; placement needs both capabilities and a Bin
destination; LOT refused.

**Transfer.** BIN endpoints across Warehouses and to/from MOBILE; same-custody-parent pairs refused.

**Multi-scan.** Observation retention, repeat/duplicate policy, grouping, per-line keys, partial
success, retry replay, no aggregate success; Receiving regression unchanged.

## 12. Acceptance criteria

1. One on-hand module; no reader re-implements the sign rule.
2. Conservation holds for every same-Warehouse relocation; cross-Warehouse goes through Transfer.
3. Consumption is subtracted exactly once everywhere.
4. Relocation is exact-source, same-parent, idempotent, and names every failure.
5. Serial custody moves through `currentLocationId`, resolved by lookup, never by prefix.
6. Multi-scan: many items, one confirmation, per-line results, safe retry.
7. Receiving multi-scan regression unchanged.
8. No activation, grant, Rules change or deployment in P6.

## 13. Rollback

The vocabulary is additive and the readers change only by consolidation, so reverting before any
relocation row exists leaves no residue. **After rows exist, rollback is not a code revert**: reverting
the readers would silently drop Bin stock from every aggregate. Once relocation is live, fixes go
forward.

---

## Implementation evidence — P6 inventory authority (§3–§8)

| Piece | File |
|---|---|
| Relocation vocabulary (`RELOCATION_OUT`/`IN`, `STOCK_RELOCATION`, `COUNTERPARTY_MOVEMENT_TYPES`) | `functions/src/inventoryLedger/operationalMovementTypes.ts` (+ validation, repository, client mirror `domain/inventoryLedgerEvent.js`) |
| One on-hand authority | `functions/src/inventoryLedger/locationOnHand.ts` |
| Governed bin parentage | `functions/src/inventoryLocation/binParentage.ts` |
| Relocation command + callable | `functions/src/inventoryLocation/stockRelocationCommand.ts`, `stockRelocationCallables.ts`, exported as `relocateStock` |
| Readers moved onto the one rule | `fulfillment/fulfillmentAvailability.ts` (+ its callers `allocateSalesOrder`, `inventoryService`, `partBalanceReadService`, `partBalanceBatchReadService`, `inventoryAnalyticsCallables`), `inventoryTransfer/transferOrderCommand.ts`, `cycleCount/cycleCountExpectedQuantity.ts`, `inventoryLedger/mobileLocationPresenceProbe.ts` |
| Transfer Bin endpoints + same-custody-parent refusal | `inventoryTransfer/transferOrderTypes.ts`, `transferLocationResolver.ts`, `transferOrderCommand.ts`, `transferCallables.ts` |
| Put-away composition | `putAwayCommand.ts` exports `buildPlacementEntries`, the one definition of a placement record's shape |
| Audit action | `relocateStock` in `types/access.ts` and `access/auditEventWriter.ts` |

### Decisions the implementation had to reach

**`sumLedgerEligibleOnHand` takes parentage as a REQUIRED argument.** Optional would have let a caller
that forgot to resolve it silently drop every binned unit from availability. Making it required meant
the compiler — not a review — found all five call sites.

**Parentage is resolved only for the bins the rows reference.** An availability check reads a handful of
bin documents in a batched get inside its existing transaction, not the whole racking.

**A non-positive IN/OUT quantity contributes nothing.** The first draft took the absolute value, which
would have let a corrupt negative receipt manufacture stock; the reader it replaced treated such rows as
zero, and the shared rule now does too.

**Replay reproduces the stored row.** Ledger fingerprints include `occurredAt`, so a retry stamped with
a fresh clock would read as a conflict. The command reproduces its prior rows from the stored clock and
actor, so replay compares intent.

**The Transfer custody check is not an injectable dependency.** It reads the governed bin documents
through the transaction inside the command, so no caller can supply a stub that skips it.

### A second latent defect, found and fixed

`recordPutAway` looked serials up by `${partId}__${serial}` and then by a bare serial id. Seven other
call sites — and the registration itself — use the canonical `serializedAssetDocId`, and no writer
produces either convention put-away tried. **Every serialized put-away of a real registered unit was
refused as `serial_unknown`.** No test exercised a real serial, which is how it survived. Fixed to the
canonical id; covered by `stockRelocationCommand.test.mjs`.

### Tests

| Suite | Result |
|---|---|
| `functions/test/stockRelocationCommand.test.mjs` (new, emulator) | **27/27** |
| `functions/test/locationOnHandAuthority.test.mjs` (new, static + pure) | **9/9** — and proven to detect main's old copies (3 and 2 matches) |
| Inventory-adjacent emulator suites | **74 green** of 83 run; the rest: 4 hard-code port 8080 (CI runs them), 3 fail on `config/environments.json` declaring two sandbox projects — pre-existing and importing nothing P6 touched |
| `auditEventWriter` (via a temporary 8099 copy) | 59/59 |
| Client `npm test` manifest | **286 suites** |
| `inventoryLedgerEvent.test.mjs` (client mirror) | 31/31 |
| `ciTriggerCoverage` · `ciSuiteCoverage` | green |

**Test pins moved, each with its argument:** the P1 "BIN must not become a movement endpoint" fence
(lifted by Decision #170 Ruling 5, restated to assert where the fence now is); the consumption custody
boundary's "WAREHOUSE type filter is the gate" (the gate moved into `resolveCustodyWarehouseId`, which
still admits no truck); and the client vocabulary pins, which exist so an addition is argued.

---

## Implementation evidence — warehouse multi-scan (§9)

| Piece | File |
|---|---|
| The ONE observation queue, extracted | `field-ops-app-vite/src/domain/scanObservationQueue.js` — Receiving re-exports it unchanged (`receivingScanQueue.js`) |
| Session domain (routing, lines, frozen batches, failure vocabulary) | `field-ops-app-vite/src/domain/stockMovementSession.js` |
| Shared bounded runner | `field-ops-app-vite/src/domain/boundedRun.js` — BIN-P3 racking apply now uses it too |
| Relocation transport | `field-ops-app-vite/src/services/stockMovementClient.js` |
| Targeted Part read | `fetchPartMasterByIds` in `services/partMasterQueries.js` — the screen is **not** an eighth whole-catalogue reader |
| Screen | `field-ops-app-vite/src/modules/scan/MoveStockScan.jsx`, registered as `SCAN_WORKFLOW.MOVE_STOCK` |

### Decisions the implementation had to reach

**A confirmed batch is frozen, and its keys include the batch number.** A key of only "session + part"
would let a second batch of the same part replay the first batch's quantity, so the new units would
silently never move. Retries re-run the frozen line under its original key; later scans form a new batch.

**A new batch cannot silently replace one with failures.** Confirm is blocked until the failed lines are
retried or the operator explicitly records that they have dealt with them — "no failed line silently
disappears" is enforced by the screen, not left to attention.

**Item scans are processed strictly in order.** A wedge scanner delivers "part, serial" faster than the
part lookup returns; handled concurrently, the serial was resolved as an unknown part and the next scan
mistaken for the serial. Found by the test harness racing exactly this, then reproduced as its own test.

**Lot-tracked and unmapped parts are refused before sending**, with their own line state, rather than
falling through to the quantity path and appearing "Ready".

**Scope of a session.** Bin resolution is warehouse-scoped, so a session is anchored to one warehouse.
Its cross-custody destination is a truck (create + dispatch Transfer, dispatch being replay-safe from
IN_TRANSIT). A bin-to-another-warehouse transfer stays in the existing Transfer form; the server accepts
it (§7), and the scanner does not yet offer it.

### Tests

| Suite | Result |
|---|---|
| `test/stockMovementSession.test.mjs` (new) | **21/21** |
| `test/moveStockScan.test.jsx` (new) | **14/14** — including the wedge-scanner race |
| Receiving regression: `receivingScanQueue` 28/28, `multiScanReceiving` 36/36 | green after the queue extraction |
| Scanner + receiving vitest (8 suites) | **198/198** |
| `scanWorkflows` (pins moved, argued) | 37/37 |
| `adminWarehouseRacking` (shared runner) | 27/27 |
| CSS coverage · `ciSuiteCoverage` · lint · Vite build | green |
