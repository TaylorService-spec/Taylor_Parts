# EOS Operational Data Plane — Inventory Authority Cutover

Owner ruling: 2026-09-10, "EOS Operational Data Plane P0". PostgreSQL (the existing Render
`eos-policy-nonprod` database, reused, not a second database) is the target authoritative
operational persistence for EOS, for inventory-affecting domains including Cycle Count. This PR
builds the `eos_ops` schema foundation and the operational capability extension to `eos_policy`. It
does **not** cut any client over, and this document is why: the smallest coherent migration
boundary is larger than Cycle Count alone, and cutting Cycle Count over by itself would create a
second, competing authority for on-hand quantity — forbidden by the ruling.

## 1. Why Cycle Count cannot move alone

Every quantity-affecting writer in this codebase today shares **one** Firestore ledger:
`inventory_transactions` (`functions/src/constants/collections.ts`). `serialized_assets` is the
parallel authority for SERIAL-tracked custody. Cycle Count's own `reconcileCycleCount` is one
producer among several of the ledger's `ADJUSTED` movement type — it does not own the ledger, it
writes into the same one every other operational command writes into.

If Cycle Count's `reconcile` moves to `eos_ops.inventory_movements` while Receiving, Transfer,
Relocation and Work Order Consumption keep writing `inventory_transactions`, on-hand quantity for
any Part touched by both would be the sum of two ledgers that never reconcile with each other. That
is the exact "two authoritative quantities" failure the ruling forbids. **The coherent migration
boundary is therefore every current writer of `inventory_transactions` / `serialized_assets`,
moved together, in one bounded cutover window — never Cycle Count alone.**

## 2. Inventory-authority writer census

**Reconciliation note (2026-09-10, addendum).** The census below was originally assembled from four
independent partial passes over the codebase, each looking at a different slice. Their headline
counts ("7 writers", "two Firestore write paths touch quantity/custody/location") were per-slice
observations, not a reconciled, repository-wide result — and one pass's finding
(`functions/src/inventoryService.ts` writing `RESERVED`/`RELEASED`/`CONSUMED` rows into
`inventory_transactions` from Work Order status triggers) was never merged into this table at all.
This section, and the "Legacy/dual event family reconciliation" section that follows it, is that
merge, done by direct, mechanical re-reading of every file involved: `inventoryService.ts`,
`fulfillment/fulfillmentAvailability.ts` (`sumLedgerEligibleOnHand`, `openWorkOrderReserved`),
`inventoryLedger/locationOnHand.ts` (`MOVEMENT_SIGN`, `isPhysicalMovementType`),
`inventory/partBalanceReadService.ts`, `workOrderConsumption/consumptionActivation.ts`
(`PHYSICAL_CONSUMPTION_ACTIVE`), and `updateWorkOrderExecutionData.ts` +
`workOrderConsumption/planPhysicalConsumption.ts`. The table below and its total are now the
deduplicated, repository-wide census — not the sum of independent partial passes.

Located mechanically: `grep -rl "inventory_transactions\|OPERATIONAL_MOVEMENT_TYPES" functions/src`
for ledger writers, `WORK_ORDER_CONSUMPTION\|RELOCATION_OUT\|RELOCATION_IN` for the movement-type
vocabulary's producers, and each command file read directly.

| Command | Source file | Persistence | Ledger row? | Changes balance? | Changes custody? | Changes location? | Current authorization | Current transport | Idempotency | Same boundary as Cycle Count? |
|---|---|---|---|---|---|---|---|---|---|---|
| Receive PO stock | `inventoryReceiving/receiveInventoryStockCommand.ts` | Firestore `inventory_transactions`, `receiving_orders` | Yes (`RECEIVED`) | Yes | No (NONE mode) / Yes (SERIAL, creates `serialized_assets` row) | Yes (lands at a WAREHOUSE/BIN) | Injected `authorize(txn, actorId, capability)` — Firestore-era operational role/capability model (`src/access/permissionCatalog.ts`, `operationalRoleContext.ts`), NOT `eos_policy` | Cloud Function callable | idempotencyKey → audit/id replay, same pattern as Cycle Count | **Yes — must move with Cycle Count** |
| Transfer (custody boundary, incl. any MOBILE endpoint) | `inventoryTransfer/transferOrderCommand.ts` | Firestore `inventory_transactions`, `transfer_orders` | Yes (`TRANSFER_OUT`/`TRANSFER_IN`) | Yes | Yes for SERIAL | Yes | Same injected `authorize(...)`, Firestore-era model | Cloud Function callable | idempotencyKey replay | **Yes** |
| Relocation (same-Warehouse, incl. BIN put-away) | `inventoryLocation/stockRelocationCommand.ts` | Firestore `inventory_transactions` | Yes (`RELOCATION_OUT`/`RELOCATION_IN`, Decision #170) | No net change to Warehouse aggregate, but IS a ledger-mutating pair | Yes for SERIAL | Yes (exact bin) | Same injected `authorize(...)` | Cloud Function callable | idempotencyKey replay | **Yes** |
| Work Order parts consumption | `workOrderConsumption/consumptionMovement.ts`, `planPhysicalConsumption.ts` | Firestore `inventory_transactions` | Yes (`WORK_ORDER_CONSUMPTION`) | Yes | Yes for SERIAL | Yes (decrements at the technician's MOBILE/truck location) | Same injected `authorize(...)` | Cloud Function callable (via Work Order completion) | structural (Complete is one-way) | **Yes** |
| Serialized asset install | `equipmentInstall/installSerializedAssetCommand.ts` | Firestore `serialized_assets`, `equipment` | No ledger row directly (custody-only) but changes the SERIAL authority | N/A (SERIAL mode has no NONE-style balance) | Yes | Yes (moves to INSTALLED / customer site) | Same injected `authorize(...)` | Cloud Function callable | idempotencyKey replay | **Yes** |
| Opening inventory balance (Data Import) | `dataImport/openingInventoryBalance.ts` | Firestore `inventory_transactions`, via the existing ledger primitives (`applyOpeningInventoryBalanceThroughTxn`) | Yes (opening balance movement) | Yes | No | Yes | Data Import's own trusted execution boundary (`admin.dataImport.execute`), per ADR-015 | Cloud Function callable (import job) | one-shot per import row, duplicate-position refused | **Yes** — it is not a "second balance authority" (ADR-015 §"What it bought") precisely because it goes through the same ledger primitives |
| Cycle Count reconcile | `cycleCount/cycleCountSheetCommand.ts` (`reconcileCycleCount` family) | Firestore `inventory_transactions`, `cycle_counts` | Yes (`ADJUSTED`) | Yes (on APPROVE with non-zero variance) | Yes for SERIAL | No (adjusts at the counted location) | Same injected `authorize(...)`, PLUS the M23 self-approval guard | Cloud Function callable | idempotencyKey replay + status-machine guard | **Yes — this PR's own subject** |
| Sales Order allocation | `fulfillment/allocateSalesOrder.ts`, `allocationProjection.ts` | Firestore `sales_orders` (line `allocatedQty`) | No | No — a soft reservation against availability, not a ledger movement | No | No | Governed commercial-object authorization | Cloud Function callable | idempotencyKey replay | **No** — it never writes the ledger; `fulfillmentAvailability.ts` reads the ledger to bound it, but allocation itself is a DERIVED reservation, not a quantity authority. Out of the ledger-cutover boundary; still Firestore's to keep. |
| Work Order reservation / commitment (legacy vocabulary) | `inventoryService.ts` (`reserveParts`, `releaseParts`, `consumeParts`, `reconcileReservation`, `finalizeInventoryTransaction`), driven by `transitionWorkOrder.ts`'s post-commit `triggerInventoryEffects()` on DISPATCHED / CANCELLED / COMPLETED | Firestore `inventory_transactions` (the SAME collection every other row above shares — `INVENTORY_TRANSACTIONS_COLLECTION`, not a second ledger) | Yes (`RESERVED`, `RELEASED`, `CONSUMED` — an older, disjoint `type` vocabulary from `ops_movement_type`'s physical set) | **No.** Confirmed by direct read of `inventoryLedger/locationOnHand.ts`'s `MOVEMENT_SIGN` map (the ONE place a row's physical effect is decided): `RESERVED`/`RELEASED`/`CONSUMED` are not keys in it, so `isPhysicalMovementType()` returns `false` for all three and `sumLedgerEligibleOnHand` ignores them entirely. These rows only ever move the derived commitment total (`openWorkOrderReserved` / this file's own `openCommitment`), never physical on-hand. | No | No — commitment rows carry no `location` at all | Same injected `authorize(...)`, Firestore-era model | Cloud Function trigger (server-only, never client-callable) | Per-(workOrderId, state) claim (`claimStateForProcessing`) + per-part reservation-lock document, not an `idempotencyKey` | **Yes — this was the missing 8th writer.** It shares the exact same Firestore collection as the other seven and therefore the same "two authorities" risk the ruling forbids; it was omitted from the original per-slice census entirely, not merely miscounted. See §2a. |

**Total: 8 writers share the one Firestore `inventory_transactions` collection and must move
together in any future cutover — the 7 originally identified (Receiving, Transfer, Relocation, Work
Order physical consumption, Serialized Install, Data Import opening balance, Cycle Count reconcile)
plus the previously-uncounted 8th, `inventoryService.ts`'s reservation/commitment triggers. Of these
8, 6 write rows that move PHYSICAL stock (Receiving, Transfer, Relocation, Work Order physical
consumption, Data Import opening balance, Cycle Count reconcile — Serialized Install changes SERIAL
custody rather than a ledger row) and 1 (`inventoryService.ts`) writes rows that are COMMITMENT-only
and never move physical stock — see §2a for the full reconciliation. One additional command (Sales
Order allocation) touches inventory *availability* but writes neither the ledger nor a commitment
row, and stays excluded from the boundary for that reason.**

## 2a. Legacy/dual event family reconciliation

This section answers, by direct code reading (not inference from naming or vintage), the question
the original per-slice census left open: does `inventoryService.ts`'s older `RESERVED` /
`RELEASED` / `CONSUMED` vocabulary belong in the physical-authority boundary alongside the newer
`TRANSFER_*` / `RELOCATION_*` / `ADJUSTED` / `RECEIVED` / `WORK_ORDER_CONSUMPTION` vocabulary
`operationalMovementRepository.ts`'s `stageOperationalMovement` writes?

**Physical movement event types** — exactly the keys of `MOVEMENT_SIGN` in
`functions/src/inventoryLedger/locationOnHand.ts`, the single place a row's physical effect is
decided (its own header explains it replaced five independent copies of this rule):
`RECEIVED`, `RETURNED`, `TRANSFER_IN`, `RELOCATION_IN`, `TRANSFER_OUT`, `SCRAPPED`,
`RELOCATION_OUT`, `ADJUSTED`, `WORK_ORDER_CONSUMPTION`. `isPhysicalMovementType()` is a total
function over exactly this set (`Object.prototype.hasOwnProperty.call(MOVEMENT_SIGN, type)`); a new
movement type added without a sign fails the TypeScript build by construction (`Record<
OperationalMovementType, SignRule>`).

**Commitment event types** — `RESERVED`, `RELEASED`, `CONSUMED`. Written ONLY by
`inventoryService.ts`. Not members of `MOVEMENT_SIGN`, so `isPhysicalMovementType()` returns
`false` for all three and `sumLedgerEligibleOnHand()` skips them unconditionally
(`if (!isPhysicalMovementType(r.type)) continue;`). They only ever feed the two commitment
derivations: `fulfillment/fulfillmentAvailability.ts`'s `openWorkOrderReserved` (`RESERVED −
RELEASED − CONSUMED`, WO-lineage-aware) and `inventoryService.ts`'s own `openCommitment`
(`RESERVED − RELEASED`, source-agnostic — see its docblock for why it is deliberately not
`openWorkOrderReserved`). `inventory/partBalanceReadService.ts`'s `composePartBalance` uses
`openWorkOrderReserved` for the same purpose.

**Ambiguous legacy event type: `CONSUMED`.** This is the one the open question was really about.
`CONSUMED` reads as if it should be a physical decrement — a Work Order was completed, parts were
fitted to a machine, stock should drop. It is not one. `sumLedgerEligibleOnHand`'s own comment
states the rule explicitly: *"CONSUMED is not a physical movement type ... on-hand therefore never
drops when parts are fitted to a machine."* This is a documented, ratified (if imperfect) design
decision (DECISIONS #165), not an oversight this reconciliation needs to correct: `CONSUMED` is a
commitment-ledger *transition*, converting an open `RESERVED` claim into a closed one, so that the
already-reserved quantity stays excluded from availability after completion instead of silently
becoming available again. `inventoryService.ts`'s own docblock even names the resulting known defect
("NOTHING REMOVES CONSUMED STOCK FROM PHYSICAL ON-HAND ... a REAL PRE-EXISTING OVER-AVAILABILITY
DEFECT ... proven in `inventoryConsumptionOnHandGap.test.mjs`") and explains it is deliberately not
fixed here because the fix is an inventory-semantics ruling this package isn't authorized to make.

**`PHYSICAL_CONSUMPTION_ACTIVE` current value: `true`**
(`functions/src/workOrderConsumption/consumptionActivation.ts:30`). This was closed by Decision
#171 and is live, not a dormant flag — direct grep of its only two call sites
(`finance/financialPolicyProfile.ts`, `updateWorkOrderExecutionData.ts:200`) confirms
`updateWorkOrderExecutionData` actively calls `planPhysicalConsumption()` and stages its resulting
movements through `stageOperationalMovement` — the SAME shared movement primitive Transfer,
Relocation, Receiving and Cycle Count use — whenever a technician records `qtyUsedUpdates`.

**Is `inventoryService.ts`'s `CONSUMED` trigger the live physical-consumption writer today? No.**
With `PHYSICAL_CONSUMPTION_ACTIVE = true`, the LIVE physical decrement for Work Order parts usage is
`updateWorkOrderExecutionData` → `planPhysicalConsumption` → `stageOperationalMovement`, writing
`WORK_ORDER_CONSUMPTION`-typed rows (a member of `MOVEMENT_SIGN`, sign `SIGNED`) at the
technician's location — these ARE summed by `sumLedgerEligibleOnHand`. `inventoryService.ts`'s
`consumeParts()` (the `CONSUMED` trigger) still fires on the same Work Order's COMPLETED
transition, but it only ever writes commitment-family rows (`CONSUMED`/`RELEASED`), which
`sumLedgerEligibleOnHand` ignores by construction. So both fire for the same Work Order lifecycle,
on different vocabularies, for different purposes: one records "how much physically left the
truck/warehouse," the other records "how much of the original reservation is now permanently
closed rather than releasable." Neither is dead code and neither is redundant with the other; they
answer different questions.

**Duplicate-authority risk found — real, but bounded and pre-existing, not a new defect this PR
introduces.** Because `inventoryService.ts`'s `RESERVED` commitment for a Work Order is opened in
full at DISPATCHED and stays open, warehouse-eligibility-agnostic and source-agnostic, until
`consumeParts()`/`COMPLETED` closes it, there is a window — between a technician's truck-level
`WORK_ORDER_CONSUMPTION` physical decrement (or an ordinary Transfer moving the reserved units to
the truck) and the Work Order's eventual COMPLETED transition — during which the SAME committed
units are excluded from availability TWICE: once because the physical movement already removed them
from eligible on-hand, and again because the commitment ledger still counts them as reserved.
`getAvailableQuantity()` (`onHand − openCommitment`, floored at 0) and every other
`openWorkOrderReserved`-based reader (`partBalanceReadService.ts`, `fulfillmentAvailability.ts`)
share this exposure. The effect is a transient UNDER-count of availability (stricter than the true
figure, never an over-promise), self-corrects the instant the Work Order completes, and never
creates a second physical-quantity authority — `inventory_movements`/`sumLedgerEligibleOnHand`
remains the sole physical truth throughout. This is documented here as a reconciliation finding, not
fixed: correcting the ATP formula is the same "inventory-semantics ruling this package isn't
authorized to make" `inventoryService.ts`'s own docblock already defers on for the sibling
over-availability defect, and reworking it is out of this PR's scope.

**On-hand readers.** `sumLedgerEligibleOnHand` (`fulfillment/fulfillmentAvailability.ts`) is the
sole physical on-hand derivation; every on-hand-producing caller (`inventoryService.ts`'s
`getAvailableQuantity`, `inventory/partBalanceReadService.ts`'s `composePartBalance` /
`readPartBalance`, `inventory/partBalanceBatchReadService.ts`) calls it rather than re-deriving.

**Available/reserved readers.** `openWorkOrderReserved` (`fulfillmentAvailability.ts`) and
`inventoryService.ts`'s local `openCommitment` are the only two commitment derivations, both over
the commitment event types above; `computePartAvailability` / `composePartBalance` compose
`onHand − reserved` from their outputs. No third implementation of either derivation exists in the
codebase — confirmed by grepping for `RESERVED"` / `"CONSUMED"` string-equality checks
repository-wide; the only matches are the two functions named here plus `inventoryService.ts`'s own
`getOutstandingReservation` / `outstandingByPart` (WO-scoped variants of the same arithmetic, used
only to size that WO's own reserve/release/consume writes, never exposed as a general reader).

**Postgres normalization decision.** Physical movement and commitment are DIFFERENT concepts with
different invariants (one is quantity-mutating evidence with no update/delete path; the other is a
mutable-until-closed claim against availability with no physical effect at all), and this
reconciliation's evidence supports keeping them structurally distinct if/when the commitment family
is ever migrated — but that migration is explicitly NOT this PR's job (see §5's "not deferred, out
of scope" list) and is not needed to prove out the P0 schema foundation this PR ships. See §6 for
why `eos_ops.inventory_movements` is NOT extended with the commitment vocabulary now.

**A second, load-bearing gap the census surfaced:** every ledger writer authorizes through the
*Firestore-era* operational capability model (`src/access/permissionCatalog.ts`,
`operationalRoleContext.ts`), not `eos_policy`. The real cutover therefore also re-points all eight
commands' authorization at the `eos_policy` Role/capability model this PR extends — the capability
foundation in migration 004 is not only for Cycle Count, it is the authorization target for the
whole boundary above.

## 3. Reference dependency census

| Dependency | Firestore collection(s) | Classification | Why |
|---|---|---|---|
| Parts (+ tracking mode) | `partsCatalog` (via `data/partsCatalog.ts`) | AUTHORITATIVE REFERENCE | Identity and tracking-mode policy for every ledger row; not itself quantity-mutating |
| Warehouses | `warehouses` | AUTHORITATIVE REFERENCE (custody parent, ADR-014) | Governed §3A record; not migrated in this PR — no Postgres copy exists yet, deliberately (see migration 005's own header) |
| BINs | `bins` (registry) | AUTHORITATIVE REFERENCE (physical position, ADR-014) | Elevated by ADR-014 to an authoritative inventory *position*, but bin identity/parentage itself stays Firestore's in this tranche |
| MOBILE locations | technician/truck-scoped location identifiers, resolved via the existing location resolver | AUTHORITATIVE REFERENCE | Same resolver Transfer/Cycle Count already share |
| Truck Registry | `truckRegistry/*` (operational reference probe) | AUTHORITATIVE REFERENCE | Assignment fact, independent of capability (this PR's ruling: capability = MAY COUNT, assignment = WHERE) |
| Technician identity / truck link | Firestore `employees` + truck assignment | AUTHORITATIVE REFERENCE | Not migrated; `eos_policy.principals` already carries the identity mapping needed for capability resolution, which is enough for THIS PR |
| Serialized assets | `serialized_assets` | AUTHORITATIVE MUTABLE (custody) | One of the seven ledger-adjacent writers above |
| Inventory balances | none stored — derived from `inventory_transactions` | DERIVED PROJECTION | ADR-003/ADR-014: `stock_locations` was retired for exactly this reason; `eos_ops` repeats the same non-decision (migration 005 has no balance table) |
| The ledger | `inventory_transactions` | AUTHORITATIVE MUTABLE | The one authority this document is about |

No Postgres copy of Warehouses, BINs, the Truck Registry or technician identity is created in this
PR — their authority classification is unclear enough (a live custody parent, a physical position
being elevated in place, an assignment fact) that copying them now, with no writer keeping the copy
in sync, would be exactly the "unclear authority" duplication the ruling forbids. `eos_ops`'s
location columns (`location_type`, `location_id`) are deliberately untyped strings rather than
foreign keys for this reason — see migration `1757808000000_eos-ops-foundation.sql`.

## 4. Migration / cutover sequence (future work — not this PR)

1. **Schema ready.** This PR: `eos_ops` foundation tables, `eos_policy` capability extension.
2. **Capability authority seeded/reconciled in Postgres.** ✅ **P1A shipped this step's tooling
   (not its execution against any real tenant — see below).** Migration 006
   (`1757894400000_operational-capability-vocabulary.sql`) catalogs the 13 additional capability
   keys the other 7 writer families need (9 of them preserved exactly from the existing legacy
   strings; 4 are genuinely new vocabulary — see the note below). A parity harness
   (`functions/scripts/inventoryCapabilityParityHarness.js`, MIGRATION_ONLY, read-only, deletable
   once every tenant reports `CAPABILITY_PARITY_READY`) compares each writer's legacy Firestore-era
   authorization decision against `eos_policy`'s. An operator-run, dry-run-by-default reconciliation
   tool (`functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts`, CLI in
   `functions/scripts/inventoryCapabilityGrantMigrationCli.js`) grants the matching
   `eos_policy.role_capabilities` row for every Role a nonprod tenant's own catalog already
   declares. Full evidence: `docs/architecture/inventory-capability-parity-p1a-evidence.md`.
   **Mechanical finding, not inferred from this document:** two of the eight writers — Work Order
   physical consumption (`updateWorkOrderExecutionData.ts`) and the Work Order
   reservation/commitment lifecycle (`transitionEngine.ts`'s `ACTION_PERMISSIONS` gating
   `inventoryService.ts`'s triggers) — were never authorized through the capability catalog at all;
   both hardcode a `users/{uid}.role` string check. Migration 006 catalogs a capability key for each
   so the parity harness and grant tool have something to compare/reconcile against, without
   changing either writer's actual runtime authorization (out of scope for this packet).
3. **Reference data resolved.** Warehouses, BINs and the Truck Registry get their own authority
   decision (a separate ADR) before `eos_ops.location_id` can become a real foreign key. Not
   required to be Postgres-authoritative before step 4, but their identity must be STABLE across the
   cutover — a bin id that changes mid-migration breaks every ledger row pointing at it.
4. **Operational source snapshot/export.** A read-only, operator-run export of
   `inventory_transactions` + `serialized_assets`, manifested (counts, hashes, source project,
   destination tenant), no deletes — the "optional, cheap" utility named in this PR's brief was not
   built here because the reference-data decision in step 3 is not yet made; building the export
   before that decision risks exporting a shape step 3 changes.
5. **Import into `eos_ops`.** Idempotent, resumable, against the schema this PR ships.
6. **Count/hash reconciliation.** Row counts and per-(tenant, part, location) sums must match
   between the Firestore ledger and the Postgres import before anything is authoritative.
7. **Freeze old writers for a bounded cutover window.** All eight writers pause simultaneously;
   this is the only point where "in-flight work" risk exists, and it is bounded, not indefinite.
8. **Switch the WHOLE writer boundary atomically.** All eight commands are re-pointed at
   `eos_ops` repositories and `eos_policy` capability authorization in the same deploy. Never
   fewer than all eight — that is what this document exists to prevent forgetting. This now
   explicitly includes `inventoryService.ts`'s commitment triggers (§2a) — a commitment-only
   schema addition (or a decision that the commitment family stays a derived Postgres read over a
   future `eos_ops` reservation table) must exist BEFORE this step, not be improvised during it.
9. **Switch reads/client transports.** `cycleCountCommandClient.js` and every other client caller
   moves from `httpsCallable` to the trusted HTTP transport (`/operations/inventory` and its
   siblings) only after step 8, never before — the blocker tracked in PR #1857 stays open until
   this step, because switching the client transport with no live backend behind it would trade one
   non-operational surface for another.
10. **Prove no old writes remain.** A monitoring window (bounded, named) asserting nothing appends
    to `inventory_transactions` / `serialized_assets` after the cutover instant.
11. **Old Firestore state retained read-only**, as migration evidence, not deleted and not written
    to again.

**Explicitly no dual-write phase, at any step.** A steady-state dual-write (Postgres and Firestore
both authoritative for a time) is the exact shape the ruling forbids, and no step above proposes
one — the freeze window in step 7 exists precisely to avoid needing it.

## 5. What this PR actually ships (P0 — proven, not deferred)

- `eos_ops` schema: `inventory_movements` (the immutable ledger), `serialized_custody`,
  `cycle_count_sheets`, `cycle_count_lines`. No balance table, no locations table (see §3).
- `eos_policy` capability extension: `capabilities` catalog (system vocabulary, not
  tenant-customizable) + `role_capabilities` (tenant-scoped grant, same shape as
  `role_object_permissions` / `workflow_role_bindings`). The five Cycle Count capability keys are
  preserved exactly: `inventory.cycleCount.create`, `.submit`, `.cancel`, `.reconcile`, `.close`.
- A minimal operational capability resolver (`functions/src/eosOps/capabilityAuthority.ts`) reusing
  `resolvePrincipalContext` unchanged, adding only the last hop — Role key → granted capability.
- A Cycle Count repository foundation (`functions/src/eosOps/cycleCountRepository.ts`) proving the
  blind-open/submitted-reveal read contract, the sheet/line lifecycle, and the atomic
  ledger-row + line-update transaction a future `reconcileCycleCount` command will use.
- A domain-separated Operations HTTP transport (`functions/src/eosOps/eosOpsHttp.ts`,
  `POST /operations/inventory`), mirroring `adminPolicyHttp.ts`'s closed-operation-list shape,
  exposing exactly one bounded, non-mutating operation in this PR (`resolveMyCapabilities`) to prove
  the full path end to end: HTTP → identity verification → principal/tenant resolution → Postgres
  capability authorization.
- **No client cutover.** `cycleCountCommandClient.js` is untouched. PR #1857 (the Cycle Count
  runtime blocker) stays open.

## 6. Read census — the parity contract Postgres must reproduce

Every canonical reader that turns ledger rows into a quantity or custody fact, and exactly which
event-type family / collection each one reads. A future Postgres cutover reproduces this table's
right-hand column exactly, or it has changed the answer to a question a live surface depends on.

| Produces | Canonical function | Event-type family read | Collection(s) read |
|---|---|---|---|
| onHand (physical, warehouse-eligible) | `sumLedgerEligibleOnHand` (`fulfillment/fulfillmentAvailability.ts`) | Physical types only (`MOVEMENT_SIGN` keys); NONE-mode quantity only, SERIAL rows counted as evidence but not summed | `inventory_transactions` |
| Warehouse aggregate (direct + child bins) | `sumWarehouseAggregateOnHand` (`inventoryLedger/locationOnHand.ts`) | Physical types only, same sign rule | `inventory_transactions` + `bins` (parentage) |
| Bin quantity (exact location) | `sumExactLocationOnHand` (`inventoryLedger/locationOnHand.ts`) | Physical types only | `inventory_transactions` |
| MOBILE quantity (truck presence) | `probeNoneStockPresentAtLocation` (`inventoryLedger/mobileLocationPresenceProbe.ts`) | Physical types only, NONE-mode | `inventory_transactions` |
| Serialized custody (current) | `serialized_assets` registry reads (not a ledger sum — SERIAL units are never counted by quantity math) | N/A — custody pointer, not an event-type sum | `serialized_assets` |
| Available (part-level ATP) | `computePartAvailability` (`fulfillmentAvailability.ts`), `composePartBalance` (`inventory/partBalanceReadService.ts`) | `onHand` (physical types) minus `openWorkOrderReserved`/`reserved` (commitment types) | `inventory_transactions` |
| Reserved / committed | `openWorkOrderReserved` (`fulfillmentAvailability.ts`), `openCommitment` (`inventoryService.ts`) | Commitment types only: `RESERVED`, `RELEASED`, `CONSUMED` | `inventory_transactions` (same collection, disjoint `type` values from the physical readers) |

The load-bearing fact this table makes explicit: **on-hand readers and reserved/committed readers
partition the SAME `type` column into two disjoint sets and never cross-read the other set's
values.** A Postgres schema that merges physical and commitment rows into one undifferentiated
`movement_type` column, with no equivalent partition available to a reader, would not reproduce this
contract — see §7.

## 7. Why `eos_ops`'s schema does not change in this PR

The reconciliation in §2a raises an eighth writer and a second (commitment) event-type family that
the existing `eos_ops.inventory_movements` table and its `ops_movement_type` enum do not represent.
That is evaluated here against this PR's own stated scope, and the answer is **no schema change**,
for reasons specific to this evidence rather than by default:

1. **The existing table's own header already draws the boundary this reconciliation confirms.**
   Migration `1757808000000_eos-ops-foundation.sql` documents `inventory_movements` as "THE SOLE
   QUANTITY-MUTATING RECORD in eos_ops" with "no update or delete path," an immutability invariant
   that is correct exactly because every row in it is meant to be physical evidence. Adding
   `RESERVED` / `RELEASED` / `CONSUMED` to `ops_movement_type` would put commitment rows — which are
   provisional, source-agnostic, and explicitly mean "no physical effect" — inside a table whose own
   documented contract is "if it's in here, it moved physical stock." That would recreate, inside
   Postgres, the exact ambiguity §2a spent its length resolving in Firestore.
2. **No writer for the commitment family is migrating in this PR.** This PR ships schema only, no
   cutover (§4, §5); `inventoryService.ts` keeps writing Firestore `inventory_transactions` exactly
   as it does today. A Postgres table with no writer pointed at it yet is the same "unclear
   authority, unmaintained copy" failure §3 already refuses for Warehouses/BINs/Truck Registry —
   building a commitment table now, before any writer boundary decision names who writes it, would
   be that failure again, self-inflicted.
3. **Building it now would be exactly the "large implementation expansion" out of scope for this
   reconciliation pass.** A real commitment/reservation table needs its own invariants worked out
   (is it a ledger like the physical one, or a mutable claim like Firestore's reservation-lock
   documents? does it need the same WO-lineage exclusion `openWorkOrderReserved` applies?) — those
   are inventory-semantics decisions, not documentation corrections, and belong with the writer
   cutover that actually needs them (§4 step 8's added note above), not bundled into a P0 foundation
   PR whose own scope statement (§5) is "proven, not deferred," meaning proven for what it actually
   ships.

**What §2a's findings DO change, concretely, about the existing schema:** nothing structural. They
confirm `ops_movement_type`'s exclusion of `RESERVED`/`RELEASED`/`CONSUMED` was already the right
call, not an oversight to correct — the physical ledger this PR ships is correctly physical-only.
The correction this reconciliation makes is entirely to the DOCUMENTED writer census and cutover
sequencing (§2, §2a, §4 step 8), not to the SQL.
