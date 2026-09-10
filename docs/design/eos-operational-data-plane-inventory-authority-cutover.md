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

**Total: 7 writers share the one ledger authority and must migrate together (Receiving, Transfer,
Relocation, Work Order Consumption, Serialized Install, Data Import opening balance, Cycle Count
reconcile). One additional command (Sales Order allocation) touches inventory *availability* but
never the ledger, and is excluded from the boundary for that reason — moving it would not remove or
create a quantity authority, it would just be unrelated work.**

**A second, load-bearing gap the census surfaced:** every ledger writer authorizes through the
*Firestore-era* operational capability model (`src/access/permissionCatalog.ts`,
`operationalRoleContext.ts`), not `eos_policy`. The real cutover therefore also re-points seven
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
2. **Capability authority seeded/reconciled in Postgres.** Every Role that currently holds one of
   the seven writers' Firestore-era capabilities gets the matching `eos_policy` capability grant,
   proved by a parity harness (same shape as `adminPolicy/migration/firestorePolicyParityHarness.ts`
   — read-only, deletable once every tenant is in parity).
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
7. **Freeze old writers for a bounded cutover window.** All seven writers pause simultaneously;
   this is the only point where "in-flight work" risk exists, and it is bounded, not indefinite.
8. **Switch the WHOLE writer boundary atomically.** All seven commands are re-pointed at
   `eos_ops` repositories and `eos_policy` capability authorization in the same deploy. Never
   fewer than all seven — that is what this document exists to prevent forgetting.
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
