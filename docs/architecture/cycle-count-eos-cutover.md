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
- **MOBILE (truck) counts** are refused with `LOCATION_TYPE_NOT_SUPPORTED`. The scope model has no rule placing a truck in a warehouse scope.
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
3. **Snapshots.** Both snapshots require a governed, migration-only Firebase read of `cycle_counts` and `inventory_transactions`. That read is **not yet authorized**; the Reorder/Catalog exception does not cover these collections.
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
