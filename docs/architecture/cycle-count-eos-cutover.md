# Inventory EOS cutover — Cycle Count (built, not activated) and Transfer (requirements)

Controller rulings 2026-09-28 (multilane DQ rulings):

- **DQ-017.** The EOS server enforces warehouse scope. There is no launch limitation and no interim Firebase or legacy check.
- **DQ-018.** The cutover order is Cycle Count first, then Transfer. The existing engines are preserved and only the seams are cut over.
- **DQ-019.** Authoritative ledger results fail closed on malformed rows, and a pre-activation census runs first.

This document records what is built, what activation needs, and why Transfer stops at requirements.

## 1. Cycle Count on EOS — what is built

| Piece | Where |
|---|---|
| Transport route `POST /operations/cycle-count` (closed table of 9 operations) | `functions/src/eosOps/eosOpsHttp.ts` |
| Commands and reads (one transaction each, audited in `eos_policy.audit_events`) | `functions/src/eosOps/cycleCountOperations.ts` |
| Repository (existing engine, extended with sheet lifecycle and scoped list) | `functions/src/eosOps/cycleCountRepository.ts` |
| Activation constant (`firestore: OPEN`, `postgres: INACTIVE`) | `functions/src/cycleCount/cycleCountWriterState.ts` |
| Proof (real PostgreSQL, 14 tests) | `functions/test/eosCycleCountOperationsPostgres.test.mjs` |

**Operations:**
- **Commands:** `createCycleCountSheet`, `openCycleCountLine`, `submitCycleCountLine`, `reconcileCycleCountLine`, `cancelCycleCountLine`, `closeCycleCountSheet`, `cancelCycleCountSheet`.
- **Reads:** `getCycleCountSheet`, `listCycleCountSheets`.

**Scope rule (DQ-017), evaluated per record.** Each operation needs its capability, plus two predicates bound to the **sheet's own warehouse**:

- `WORK_ELIGIBILITY WAREHOUSE_OPERATIONS`;
- `OPERATIONAL_SCOPE WAREHOUSE=<warehouseId>`.

The warehouse is always read from eos_ops. A WAREHOUSE sheet uses its own id; a BIN sheet uses the bin's immutable parent. These are the predicates the governed persona model already attaches to cycle counting (CX-11/CX-12), evaluated by the one contextual evaluator (`contextualAuthorization.ts`).

The list query puts the caller's WAREHOUSE scopes in its `WHERE` clause, so sheets outside that scope are never fetched. The results are:
- no Employee link → `EMPLOYEE_LINK_REQUIRED`;
- no eligibility → `WORK_ELIGIBILITY_MISSING`;
- no scope → an empty list, which is true.

**Capabilities (PostgreSQL authority):**

| Capability | Covers |
|---|---|
| `inventory.cycleCount.create` | create sheet, open line |
| `.submit` | submit a count |
| `.reconcile` | approve or reject a line |
| `.cancel` | cancel a line or a sheet |
| `.close` | close a sheet |

The Firestore engine gates close with `.reconcile`. The EOS path uses the registered `.close`, held by `inventoryCycleCountReconciler`.

**Refused rather than guessed:**
- **MOBILE (truck) counts** are scoped ONLY by the truck location's explicit governed binding (DQ-024: `eos_ops.mobile_location_scope_bindings`, migration `1764115200000`, resolver `eosOps/inventoryScopeAuthority.ts`). No binding → `MOBILE_SCOPE_BINDING_MISSING` (fail closed); never the technician's, driver's or user's warehouse, never the truck's descriptive `home_warehouse_id`.
- **Parts missing from `eos_ops.parts`** are refused with `PART_NOT_FOUND`. There is no Firestore fallback.
- **Impossible ledger balances**, meaning a negative sum or a serial that does not net to 0 or 1, are refused with `LEDGER_INTEGRITY`.
- **SERIAL approve with a serial discrepancy** is refused by the repository, because it cannot stage per-unit signed rows.

**Separation of duties** is stricter than the Firestore engine: any non-zero variance cannot be approved by the person who submitted the count. The Firestore engine only blocks this for *material* variances. This is a known parity difference, and it errs toward safety.

## 2. Cycle Count activation — the governed gate (not performed)

Run these in order. Stop at any failure.

1. **Zero-population census.** `node functions/scripts/cycleCountActivationCensus.js --snapshot <cycle_counts snapshot>`.
   - `ZERO_POPULATION` (exit 0) is required.
   - Per the 2026-09-20 ruling, the v1 records (24 in sandbox) are LEGACY_HISTORICAL_EVIDENCE. They are counted, kept and never deleted.
   - Any schemaVersion 2 sheet means **STOP**. A real migration is then required, and this cutover does not perform one.
   - Any unclassifiable document means STOP, and it goes to a governed decision.
2. **Ledger census (DQ-019).** `node functions/scripts/inventoryLedgerCensus.js --snapshot <inventory_transactions snapshot>`.
   - Any `MALFORMED_ROWS_PRESENT` blocks each listed part, because the authoritative reads refuse it.
   - Repair of those rows is a governed decision and is never done by a tool.
3. **Snapshots (DQ-025, APPROVED; tooling prepared, NOT run).** `node functions/scripts/exportInventorySnapshot.js --projectId <nonprod project> --out <file outside the repo>` -- the fenced, read-only, checksummed migration-only export of exactly `cycle_counts`, `inventory_transactions`, `transfer_orders` (enumerated in `docs/architecture/inventory-snapshot-export-evidence.json`). The three census tools read its `EOS_INVENTORY_SNAPSHOT` file directly and require its `.sha256`. Running it is a separate, authorized execution step.
4. **Catalog COPY/VERIFY done** (L0 window). `eos_ops.parts` is the Part authority these commands read.
5. **Warehouses and bins present in `eos_ops`** (warehouse/bin COPY, `warehouseBinMigrationSource.ts`). Also assign WAREHOUSE operational scope and WAREHOUSE_OPERATIONS eligibility to the counting Employees, through Administration.
6. **Opening balances in `eos_ops.inventory_movements`.** The PG expected snapshot is only as true as the PG ledger. Until the operational ledger is copied, a PG count would expect 0 everywhere. **This is a prerequisite, not a detail.** The ledger COPY (`legacyInventoryMovementMapping.ts` / `legacyInventoryMovementRun.ts`) must be VERIFIED before activation.
7. **Freeze the Firestore sheet/line writers.** Then set `CYCLE_COUNT_WRITER_AUTHORITY` to `{ firestore: "FROZEN", postgres: "ACTIVE" }`, deploy, and cut the client over to `/operations/cycle-count`.
8. Prove the Firestore Cycle Count callables are unavailable.

## 3. Transfer — requirements (implementation STOPPED, recorded)

The ruled order puts Transfer second. The transport pattern extends to Transfer, but its **PostgreSQL engine does not exist yet**, and building it is outside this lane:

- `eos_ops.transfer_orders` exists (migration `1758672000000`). The pure legacy mapper and reconciliation exist too (`purchasingMigrationMapping.ts`: `mapLegacyTransferOrder`, `reconcileTransferOrderMigration`).
- The repository has only `createTransferOrder` and `readTransferOrder`, in `eosOps/purchasingRepository.ts`. It has **no dispatch, receive or cancel transition and no ledger staging** (TRANSFER_OUT / TRANSFER_IN in `inventory_movements`).
- `purchasingRepository.ts` is **L0's single-writer file** until Reorder activation closes. Adding the lifecycle there would breach that boundary. Building a second Transfer repository beside it would create a competing authority.
- **Scope rule not yet ruled.** Which warehouse scope authorizes each act? The candidates are the origin's scope for create, dispatch and cancel, and the destination's scope for receive. It is also undecided how a **MOBILE** (truck) endpoint maps to scope. Today a technician receives by truck assignment (`listMyReceivableTransfers`), which is not an operational scope.

**The Transfer COPY lane needs:**
- **Census.** The 47 sandbox records are governed business records (2026-09-20 ruling), 23 of them cross-company. They need a status distribution, typed-endpoint totality, and scalar/typed disagreement counts.
- **Migration-only snapshot.** A migration-only Firebase read of `transfer_orders` is required. It is not yet authorized.
- **Upstream populations.** Parts, warehouses, bins and MOBILE locations (truck fleet COPY) must all be present in `eos_ops`, because endpoints resolve against them.
- **DRY RUN and COPY.** DRY RUN through `mapLegacyTransferOrder` -- tooling built: `node functions/scripts/transferCopyCensus.js --snapshot <transfer_orders snapshot>` (mapped/refused by code with ids, status distribution, cross-company split, the IN_TRANSIT ids that need ledger agreement; exit 0 COPY_READY / 3 REFUSALS_PRESENT): every refusal is listed, none is repaired. Then COPY ONCE → VERIFY against the same snapshot.
- **IN_TRANSIT orders.** These carry a TRANSFER_OUT already staged in the Firestore ledger. The ledger COPY and the transfer COPY must agree on it, or a receive would double or lose stock.
- **Then:** freeze the Firestore writers, build the lifecycle commands (after the L0 boundary lifts), expose the transport route with scope enforcement, cut the client over, and run E2E.

## 4. Controller rulings DQ-024 / DQ-026 (2026-09-28)

**DQ-024 — Transfer scope.** Scope follows the inventory location acted upon: `create`, `cancel` and `dispatch` need the ORIGIN's warehouse scope; `receive` and put-away need the DESTINATION's. An act is not required to satisfy both ends just because the transfer has two. Encoded in `TRANSFER_ACT_SCOPE_END` / `requiredTransferScope` (`eosOps/inventoryScopeAuthority.ts`), proven in `inventoryScopeAuthorityPostgres.test.mjs`. Only the end the act works on is resolved, so a missing binding at the far end neither blocks nor grants.

**Truck binding.** The binding TABLE, its invariants (same operating company, one current, append-only, no seed) and its fail-closed READ are built (migration 1764115200000). Its writer is the DQ-029 Administration command in §5. Until a binding is set, a truck location fails closed on the EOS path.

**DQ-026 — activation order.** Catalog COPY/VERIFY → inventory baseline/ledger COPY + reconciliation → Cycle Count activation → Transfer activation. The Catalog is not the source of quantity; Cycle Count is never activated against an artificial zero (hence §2 step 6). Cycle Count stays INACTIVE; Transfer stays HELD.

## 5. DQ-029 — truck location → warehouse scope binding Administration (2026-09-28)

**Capability.** `inventory.location.scopeBinding.manage` (object `mobileLocation`, action `manageScopeBinding`, ADMIN_ACTION, "Manage Truck Location Warehouse Scope"). It is registered by migration 1764118800000 and GRANTED TO NOBODY. It is absent from both PERMISSION_CATALOGs, so the policy seed and the Sample Company reconcile cannot default-grant it. It is not implied by any inventory, transfer or cycle-count capability, by technician assignment, by the Parts, Warehouse or Dispatcher Roles, or by owning a vehicle. No code path checks for an Administrator.

**Command.** Four Administration CONFIGURATION operations are served on the existing `/admin/policy` transport (`adminPolicy/configurationOperations.ts`):
- `listMobileLocationScopeBindings`
- `readMobileLocationScopeBinding` (READ/explain)
- `setMobileLocationScopeBinding` (CREATE / CHANGE / NO_CHANGE)
- `removeMobileLocationScopeBinding`

`executeAdminOperation` gates every one on the capability, using the same effective-access resolver as every other gate. The PostgreSQL implementation is `eosOps/mobileLocationScopeBindingAdministration.ts`, composed in `eosApi/server.ts`. It enforces these rules:
- The truck location must be a governed `eos_ops.mobile_locations` row in the tenant, and it must be active to be bound.
- The warehouse must be a governed `eos_ops.warehouses` row, in the tenant, and ACTIVE.
- Company compatibility is checked through `resolveActiveOperatingCompanyId` on both authored keys. Both keys must resolve to an ACTIVE governed company, and it must be the same company. Nothing is inferred from a person, UID, tenant default, customer or vehicle.
- A stated reason is required.
- Each change writes one `eos_policy.audit_events` row in the same transaction: `mobileLocationScopeBinding.created|changed|removed`, carrying the actor, time, location, previous and new warehouse, and the reason.
- A change ends the current row and inserts a new one, so history is never rewritten and only future operations are affected.
- After a remove, `resolveScopeLocation` refuses with MOBILE_SCOPE_BINDING_MISSING until a new valid binding exists.

**UI.** Administration → Warehouse Racking → "Truck location warehouse scope" (`TruckLocationScopeBindings.jsx`). The server decides access and the section renders FORBIDDEN or NOT_CONFIGURED as that state. Effective Access lists the capability through `explainEffectiveAccess`.

**Self-administration finding.** The execution packet cannot be `grantObjectActionToRole … roleKey:"admin"` when it is run by the Administrator. Administration refuses a grant to a Role the actor holds (SELF_ADMINISTRATION), and it also refuses assigning a Role to oneself. `mobileLocationScopeBindingAdministrationPostgres.test.mjs` proves both refusals. It also proves the route an Administrator CAN execute alone:
1. `createRole` a dedicated Security Role.
2. `grantObjectActionToRole` the capability to that Role.
3. `assignRole` that Role to the configuring principal, who is someone other than the Administrator.

Which principal configures truck scope in nonprod is an Administration decision, and the packet in the lane ledger is written to that route.

## 6. DQ-033 / DQ-034 (2026-09-28)

**DQ-033 — who holds the scope-binding capability.** An ordinary, narrow Security Role, "Operational Configuration Administrator", holds it. The Role is built entirely through Administration:
1. The Administrator creates the Role.
2. The Administrator grants it `ownership.handoff.correct` and `inventory.location.scopeBinding.manage`.
3. The Owner assigns the Role to a separate principal.

`operationalConfigurationAdministratorPostgres.test.mjs` proves the chain, and proves that SELF_ADMINISTRATION still refuses self-grants and self-assignment. There is no migration grant, no direct grant and no Firebase step. Which synthetic persona receives the Role is open. None of the 16 canonical personas fits without a new persona.

**DQ-034 — J6/J7 Catalog readers on EOS.**
- **Cycle Count open.** Reads the Part's status and control type from `eos_ops.parts` through `postgresPartPolicyAuthority`, with no Firestore fallback.
- **Cycle Count reconcile.** Uses the tracking mode frozen on the line at open.
- **Both** are activated by the Cycle Count writer authority, after the Catalog COPY and the inventory baseline.
- **Transfer.** Has no EOS lifecycle yet. It is gated on L0's `purchasingRepository.ts` release, and is last in the DQ-026 order.
- **Stock relocation and serialized acquisition.** Have no EOS implementation. Relocation is not coupled to `purchasingRepository.ts`. Acquisition's capability is Firebase-only. Both await authorization. Until then those operations run only on the deployed Firebase callables.

## 7. Relocation and Transfer on EOS (DQ-036; L0 shared-file release, 2026-09-28)

Both are **built and not activated**. Each has its own writer-authority constant with `postgres: INACTIVE`, and every operation refuses NOT_ACTIVATED before it reads anything.

| | Route | Constant | Activates after |
|---|---|---|---|
| Stock relocation | `POST /operations/relocation` (`relocateStock`) | `inventoryLocation/stockRelocationWriterState.ts` | Catalog COPY, then inventory baseline COPY |
| Transfer | `POST /operations/transfer` (`createTransfer`, `dispatchTransfer`, `receiveTransfer`, `cancelTransfer`) | `inventoryTransfer/transferWriterState.ts` | Everything above, then Cycle Count, then Transfer COPY. Last in the DQ-026 order. |

- **Same business behavior as the Firestore commands.** Relocation's request validation, identity and row keys are pinned identical by `stockRelocationParity.test.mjs`. Transfer imports the pure `validateCreateTransferInput` unchanged.
- **Governed scope added.** Relocation needs WAREHOUSE_OPERATIONS and the scope of the custody warehouse. Transfer applies the DQ-024 per-act end: create, cancel and dispatch use the ORIGIN; receive uses the DESTINATION.
- **Fails closed on bad evidence (DQ-019).** A negative ledger balance, or custody the ledger does not support, is refused.
- **Storage support.** Migration `1764122400000` adds a serial `IN_TRANSIT` state and TO-YYYY-###### numbering.
- **Open item (DQ-037).** The put-away placement record has no PostgreSQL authority. An EOS relocation that asks for one is refused with PLACEMENT_NOT_ON_EOS rather than performed without it.

## 8. Bin placement and serialized acquisition on EOS (DQ-038, DQ-036(b), 2026-09-29)

Both are **built and not activated**.

| | Route | Constant | Migration |
|---|---|---|---|
| Put-away placement | `POST /operations/placement` (`recordPutAway`) | `inventoryLocation/placementWriterState.ts` | `1764126000000`, `eos_ops.bin_placements` |
| Acquire an existing serialized unit | `POST /operations/serialized-asset` (`acquireSerializedAsset`) | `serializedAsset/acquireWriterState.ts`, mirrored in the client | `1764129600000`, capability + `serialized_asset_acquisitions` |

**Placement keeps the Firestore behavior exactly** (`binPlacementParity.test.mjs` pins this):
- **It is an append-only event.** One row per serial or per quantity stow. It moves no stock.
- **It belongs to a governed warehouse.** The server resolves the bin, and the table refuses a bin that is not a bin of the stated warehouse.
- **Warehouse scope is authoritative.**

The EOS relocation now records the same placement in the same transaction. PLACEMENT_NOT_ON_EOS is gone.

**`inventory.serializedAsset.acquire` is Administration-grant-only.** It is fenced in `roleCapabilityAdministration.ADMINISTRATION_GRANT_ONLY_CAPABILITIES`. Its initial Taylor holders (Parts Associate, Parts Manager, Warehouse Associate, Warehouse Manager) are granted by an execution packet.

The capability alone is not enough. An acquisition also requires:
- the Warehouse Operations eligibility and scope for the receiving warehouse;
- Catalog identity (the Part is ACTIVE and SERIAL);
- an ACTIVE warehouse belonging to a governed company;
- a unit that is not already in custody.

The acquisition writes the custody row, the provenance row, and one `ADJUSTED` +1 serial movement (the opening-balance model) in a single transaction. At activation the client switch and the server switch flip together, and the Firebase `acquireSerializedAsset` callable is retired.
