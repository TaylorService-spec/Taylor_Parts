# Firebase business-authority retirement plan — Phase 2 lane P2-B census

**Question answered:** after all 29 Wave-1 PRs (`#1866`–`#1896`, branches `origin/impl/w1-*`) land,
what Firebase business authority is actually retirable, and in what dependency order?

**Answer, stated first, because it is not the expected one:** *nothing new becomes retirable.*
Wave 1 moves the Firebase business-runtime baseline from **369 entries to exactly 366**, and every
one of those three removals is already performed by PR #1884. Eleven migrations land eleven new
PostgreSQL table sets; **not one of them is read or written by any deployed process**, and **not one
Firestore reader or writer anywhere in the repository is re-pointed at them**. The wave builds the
floor the retirement will one day stand on. It does not retire anything, and a plan that assumes
otherwise would delete live reads.

This document is evidence, not aspiration. Every claim below was re-derived in this worktree from
the branch trees themselves (`git show origin/impl/<name>:<path>`), never from a PR title or a
sibling's summary. Where a sibling's summary and the tree disagree, the tree is recorded and the
summary is corrected by name. Where something could not be verified locally it is marked
**UNPROVEN** and listed in §8.

**Base:** `33945090d66d2287fe0cdc362c80ad6e4e311067` (`origin/main`, unchanged — no Wave-1 PR is merged).
**Worktree:** `/home/rudy2/.local/share/eos-worktrees/w2-retirement-census`, branch `phase2/firebase-retirement-census`.
**This lane retired nothing.** No deletion, no baseline edit, no manifest edit, no Rules change, no
data change, no seed, no backfill, no deploy, no production contact. The only file this lane adds is
this document.

---

## 0. The three measurements everything else rests on

### 0.1 The whole wave moves the baseline by three files

`scripts/firebaseExitGuard.mjs`'s `evaluateGuard` is an **exact-match** check in both directions: a
file that uses a fenced dependency the baseline does not record is a *violation*, and a baseline
entry the scan no longer observes is a *stale entry*. Both fail the build. It follows that **any**
branch that removed a Firebase business-runtime import from a source file would have had to edit
`docs/architecture/firebase-exit-baseline.json` in the same change, or fail CI.

Exactly one branch edits that file, and exactly one branch adds or removes a fenced import
specifier anywhere under the three business-runtime roots. They are the same branch.

```
$ for b in $(git branch -r | grep 'origin/impl/w1-'); do
    git diff origin/main $b -- field-ops-app-vite/src functions/src integrations \
      | grep -E '^[+-].*(from|require|import\() *["'"'"']firebase(-admin|-functions)?(/[a-z0-9]+)*["'"'"']'
  done

##### origin/impl/w1-firebase-retirement
-import { collection, getDocs } from "firebase/firestore";
-import { collection, onSnapshot, query, where } from "firebase/firestore";
-import { getFirestore } from "firebase-admin/firestore";
```

Three removals, zero additions, across all 31 `impl/w1-*` branches. The post-wave business-runtime
baseline is **366** entries over **296** unique files (pre-wave: 369 entries over 299 unique files;
the identity keys hold a further 7 entries and are untouched).

### 0.2 Every Wave-1 migration says, in its own header, that it cuts nothing over

Eleven branches add a migration. Their headers are unambiguous and mutually consistent:

| Branch | Migration | Header, verbatim |
|---|---|---|
| `w1-truck-mobile` | `1758326400000_truck-and-mobile-location-registry.sql` | "It cuts **NOTHING** over — no deployed process reads or writes these tables, the Firestore Truck Registry stays authoritative until a separately authorized import runs" |
| `w1-account-contact-location` | `1758758400000_crm-account-contact-location.sql` | "Additive: 001-007 are not edited, and **nothing deployed reads or writes these tables yet**" |
| `w1-inventory-commitment` | `1758067200000_inventory-commitment-and-work-order-replay.sql` | "It imports nothing, **cuts nothing over, and is read and written by no deployed process**" |
| `w1-invoice` | `1758931200000_invoice-authority.sql` | "There is **NO data migration** in this packet, and **nothing deployed writes these tables yet**" |
| `w1-supplier-manufacturer` | `1758499200000_supplier-and-supplier-catalog-authority.sql` | "It creates no Firestore collection, **reads none, and mirrors none**" |
| `w1-warehouse-bin` | `1758240000000_warehouse-and-bin-location-authority.sql` | the Firestore collections "are the **MIGRATION SOURCE** … the target state is that they stop being written at all" (future tense, by a "future authorized import") |

Independently corroborated by the branch trees: **no new repository module has a runtime importer.**

```
warehouseBinRepository            0 importers in its own branch tree
truckFleetRepository              0
purchasingRepository              0
customerRepository                0
commercialOwnershipRepository     0
inventoryCommitmentRepository     0
equipmentCustody                  0
employeePrincipalLinkRepository   0
supplierCatalogRepository         1 — supplierCatalogMigration.ts (the pure mapping, test-only)
invoiceAuthority                  1 — an Administration→Objects `cite()` string, not an import
cashApplicationAuthority          1 — an Administration→Objects `cite()` string, not an import
```

`w1-warehouse-bin`'s own handoff states it plainly: *"The eos_ops repository is not wired to an HTTP
operation or a callable, so it introduces no capability."*

### 0.3 The guard still passes with both retirement PRs landed — verified locally

Composed the post-#1884 + post-#1892 state in a scratch tree (main's three scan roots, minus the
three files #1884 deletes, with #1884's baseline and #1892's 12-category guard) and ran it:

```
$ node scripts/firebaseExitGuard.mjs --previous-baseline=<main baseline>
no new Firebase business-runtime dependencies beyond the committed baseline
EXIT=0
```

So #1884 and #1892 are compatible *in substance*. They are **not** compatible *textually* — see §6.

---

## 1. Per-collection authority census

65 Firestore collections carry a declared constant or Rules match block. "Current authority" is
where the system of record is on `origin/main`; "post-wave-1" is where it is after all 29 PRs land.

**Legend.** *PG-schema* = a PostgreSQL table now exists, is read and written by nothing, and the
Firestore collection remains the sole authority. *Firestore-only* = no Wave-1 Postgres target at all.

### 1.1 Collections that gain a PostgreSQL table in Wave 1 (none gain authority)

| Collection | Current authority | Wave-1 branch / migration | Postgres target | Post-wave authority | Retirable? | Blocked by |
|---|---|---|---|---|---|---|
| `warehouses` | Firestore | `w1-warehouse-bin` / `1758240000000` | `eos_ops.warehouses`, `bins`, `bin_code_claims` | **PG-schema; Firestore still authority** | No | 8 frontend + 23 server + 18 seed refs; live Rules block `:1176`; live index; `Operations.jsx` reads it |
| `mobile_locations` | Firestore | `w1-truck-mobile` / `1758326400000` | `eos_ops.mobile_locations` | PG-schema | No | live Rules `:1229`; 3 FE / 5 SRV / 11 seed; truck registry callables |
| `trucks` | Firestore | `w1-truck-mobile` / `1758326400000` | `eos_ops.trucks` | PG-schema | No | live Rules `:1234`; 5 FE / 6 SRV / 6 seed; Truck drawer is a live surface |
| `suppliers` | Firestore | `w1-supplier-manufacturer` / `1758499200000` | `eos_ops.suppliers` | PG-schema | No | `Operations.jsx:95` → `operationsQueries.ts:174`; live Rules `:1255`; composite index; supplierMaster commands |
| `part_supplier_items` | Firestore | `w1-supplier-manufacturer` / `1758499200000` | `eos_ops.supplier_catalog_items` | PG-schema | No | `partMaster/partSupplierItems.ts` is the live governed writer; live Rules `:1652` |
| `equipment` | Firestore | `w1-equipment` / `1758585600000` | `eos_ops.equipment` | PG-schema | No | 20 FE / 16 SRV / 15 seed — one of the most-read collections in the app |
| `equipment_models` | Firestore | `w1-equipment` / `1758585600000` | `eos_ops.equipment_models` | PG-schema | No | live Rules `:1714`; catalog reads |
| `reorder_requests` | Firestore | `w1-purchasing` / `1758672000000` | `eos_ops.reorder_requests` | PG-schema | No | live Rules `:638`; 8 FE / 7 SRV; `operationsQueries.ts:237` queries it by status |
| `purchase_orders` | Firestore | `w1-purchasing` / `1758672000000` | `eos_ops.purchase_orders`, `purchase_order_voids` | PG-schema | No | live Rules `:1265`; Epic-5 read path. **Distinct from `reorder_purchase_orders`** — see §1.3 |
| `receiving_orders` | Firestore | `w1-purchasing` / `1758672000000` | `eos_ops.receiving_orders`, `receiving_order_lines` | PG-schema | No | live Rules `:548`; receiving command family |
| `transfer_orders` | Firestore | `w1-purchasing` / `1758672000000` | `eos_ops.transfer_orders` | PG-schema | No | live Rules `:1199`; `operationsQueries.ts:142,164`; **current** transfer authority, explicitly not legacy |
| `accounts` | Firestore | `w1-account-contact-location` / `1758758400000` | `eos_crm.accounts` | PG-schema | No | 13 FE / 12 SRV / 16 seed; 5 indexes; MIGRATE-class list surface |
| `contacts` | Firestore | `w1-account-contact-location` / `1758758400000` | `eos_crm.contacts` | PG-schema | No | 12 FE / 5 SRV; live Rules `:1555` |
| `locations` | Firestore | `w1-account-contact-location` / `1758758400000` | `eos_crm.account_locations` | PG-schema | No | 17 FE / 9 SRV; live Rules `:1341` |
| `opportunities` | Firestore | `w1-commercial` / `1758844800000` | `eos_commercial.opportunities` — **ownership spine only** | PG-schema, partial | No | migration header: "It is NOT the commercial object… no stage, no outcome, no state machine, no line item". 11 FE refs; Phase-2 reference list surface |
| `sales_agreements` | Firestore | `w1-commercial` / `1758844800000` | `eos_commercial.sales_agreements` — ownership spine only | PG-schema, partial | No | same; `salesAgreementCommands.ts` line model stays Firestore |
| `sales_orders` | Firestore | `w1-commercial` / `1758844800000` | `eos_commercial.sales_orders` — ownership spine only | PG-schema, partial | No | same; 11 SRV refs; 3 indexes |
| `invoices` | Firestore | `w1-invoice` / `1758931200000` | `eos_ops.invoices`, `invoice_lines` | PG-schema | No | `finance/invoiceCommands.ts` is the live writer; AR projection reads it |
| `payments` | Firestore | `w1-payment` / `1759017600000` | `eos_ops.payments` | PG-schema | No | `finance/paymentCallables.ts` live writer; live Rules `:1812` |
| `payment_applications` | Firestore | `w1-payment` / `1759017600000` | `eos_ops.payment_applications` | PG-schema | No | same transaction as `payments`; live Rules `:1815` |
| `inventory_sync_status` | Firestore | `w1-inventory-commitment` / `1758067200000` | `eos_ops.work_order_inventory_effects` | PG-schema | No | `inventoryService.ts` + `inventoryEffectCallables.ts` are the live idempotency guard; dropping it re-opens processed work orders to replay |
| `inventory_transactions` (RESERVED/RELEASED/CONSUMED rows) | Firestore | `w1-inventory-commitment` / `1758067200000` | `eos_ops.inventory_commitments` | **split by row type; Firestore still authority for all of it** | No | 3 FE / 23 SRV / 16 seed; ADR-003 ledger; the single largest read graph in the repo |
| `employees` | Firestore | `w1-employee-principal` / `1758412800000` | `eos_policy.employee_principal_links` — **link table only** | PG-schema for the *link*, Firestore for the Employee | No | migration header: "**THERE IS NO `employees` TABLE IN POSTGRESQL YET**". Also an identity-boundary object — §7 |

### 1.2 Collections with no Wave-1 PostgreSQL target at all — Firestore-only, before and after

`fieldops_wos` · `fieldops_jobs` · `fieldops_technicians` · `counters` · `cycle_counts` ·
`inventory_actions` · `supplier_catalog` · `reorder_purchase_orders` · `reorder_purchase_order_voids` ·
`location_truck_claims` · `serialized_assets` · `parts` · `part_aliases` · `manufacturers` ·
`equipment_part_compatibility` · `equipment_compatibility_sources` · `equipment_compatibility_operations` ·
`equipment_model_aliases` · `crm_activities` · `performance_goals` · `sales_territories` ·
`commercial_coverage_assignments` · `refunds` · `invoice_adjustments` · `reportDefinitions` ·
`technician_working_availability` · `technician_blocked_time` · `data_import_jobs` ·
`imported_service_history` · `email_connections` · `email_mailboxes` · `email_routing_rules` ·
`email_oauth_states` · `email_delivery_failures` · `inbound_work_requests` · `auditEvents` ·
`users` · `roles` · `roleAssignments` · `permissions` · `accessRequests` · `usernames` (declared, never used).

None of these is retirable in Wave 1, and none becomes closer to retirable: every one retains at
least one live source reference. The census measured file-level references (collection-name string
**and** every exported constant that resolves to it) across `field-ops-app-vite/src`, `functions/src`
and `functions/scripts`; **the minimum across all 65 collections is 1, and it is never 0.**

### 1.3 Two facts the census surfaced that a retirement planner must not miss

* **There are two purchase-order collections.** `purchase_orders` (Epic-5, Rules `:1265`) and
  `reorder_purchase_orders` (Rules `:1049`, 9 FE / 13 SRV refs) are different collections holding
  different money. `w1-purchasing`'s migration models the first; the live reorder flow reads the
  second. `w1-list-ns-migrations`'s disposition doc records the same hazard independently: *"Migration
  must not attach `totalCost` from `purchase_orders` to rows read from `reorder_purchase_orders`."*
  Retiring either by name alone would hit the wrong one.
* **`supplier_catalog` is not `supplier_catalog_items`.** `w1-supplier-manufacturer`'s migration
  header says so explicitly: its `supplier_catalog_items` table is the ADR-008 `part_supplier_items`
  authority, and the Epic-5 `supplier_catalog` collection "is a second, incompatible representation
  of the same business fact and which this migration deliberately does not model." So the collection
  that a sibling lane reported as dead gains *no* Postgres target in Wave 1 and keeps a live client
  read. See §3.1.

---

## 2. What is genuinely retirable once Wave 1 lands

### 2.1 The three modules PR #1884 already retires — re-derived, and they hold

All three were re-verified against `origin/main` and the twelve concurrent lane branches.

| Retired | Category cost | Unreachability, re-derived here |
|---|---|---|
| `functions/src/supplierService.ts` | `server.firebase_admin_firestore` −1 | Read the file on `origin/main`: `getFirestore()` over `suppliers` and `supplier_catalog`. Grep for importers across `functions/src`, `functions/test`, `functions/scripts`: the only production-tree mentions are a **prose comment** at `procurementBridge.ts:23` and a **seed comment** at `seedOperationsDemoData.js:6`. The only real importer is `functions/test/warehouseProcurementSupplierServices.test.mjs:11`, which the PR edits in the same change. Not exported from `functions/src/index.ts`. **Confirmed unreachable.** |
| `field-ops-app-vite/src/analytics/operationsIntelligenceService.ts` | `frontend.firestore_client` −1 | 288 lines; its only Firestore touch is `getDocs(collection(db, WORK_ORDERS_COLLECTION))` at `:82`. Absent from `field-ops-app-vite/test/suites.json`. **Confirmed unreachable.** |
| `field-ops-app-vite/src/hooks/useAssignedJobs.js` | `frontend.firestore_client` −1 | A scoped `onSnapshot` over `fieldops_jobs` by `technicianId`. No importer. Its former consumer `modules/mobile/FieldMode.jsx` no longer imports it. The scoped READ rule at `firestore.rules:353` stands untouched and still fails closed with or without a client hook. **Confirmed unreachable.** |

Baseline arithmetic re-derived from the branch diff: `frontend.firestore_client` 57→55,
`server.firebase_admin_firestore` 185→184, the other two unchanged. **369 → 366.** Identity keys
(7 entries) untouched. The sibling's stated numbers are correct.

**No Firestore collection becomes retirable as a result.** The four collections these modules touched
— `suppliers`, `supplier_catalog`, `fieldops_wos`, `fieldops_jobs` — each retain many other live
readers. Module retirement and collection retirement are different things, and Wave 1 delivers only
the first.

### 2.2 The one collection-shaped item that is genuinely dead: `usernames`

`USERNAMES_COLLECTION = "usernames"` (`field-ops-app-vite/src/domain/constants.js:20`) has
**zero importers** anywhere in `field-ops-app-vite` or `functions` — verified by direct grep. It has
no Rules match block, no index, no seed, no reader and no writer.

**And it should still not be retired.** The collection is the merged AUTH-PR-2 data model with
username login deferred by the Owner; `field-ops-app-vite/test/emulator/authPr2Boundary.mjs:50-58`
asserts it is client-denied by default-deny — a standing security proof that names the collection by
string, and would have to be deleted with it. Retiring it also has **zero Firebase-exit value**:
`constants.js` imports no Firebase module and appears in no baseline category. It is additionally on
the wrong side of the identity fence (§7). **Report; do not retire.** This is the single case in the
whole census where "provably unreachable" and "should be deleted" come apart, and it is worth
keeping visible for exactly that reason.

### 2.3 Nothing else clears the bar

The bar set by this lane's brief is: no importer, no caller, no Rules block, no index, no seed, no
test, no runtime path, and no sibling branch still using it. Applied to all 65 collections against
the post-wave tree, **the set of collections that clears it is empty.** `usernames` (§2.2) comes
closest and still fails the bar on two legs: a standing security test names it by string
(`authPr2Boundary.mjs:50-58`), and its declaration is a live line in a shared constants file.

---

## 3. What is NOT retirable, and the distinction that matters

### 3.1 Still has a live reader — retiring it is an outage

| Collection | The live reader, re-derived |
|---|---|
| `supplier_catalog` | `modules/operations/Operations.jsx:95` calls `fetchSupplierCatalog()`; `services/operationsQueries.ts:175` defines it as `listCollection(SUPPLIER_CATALOG_COLLECTION)` — an unbounded `getDocs(collection(db, "supplier_catalog"))`. A live Rules block at `firestore.rules:1260` (`allow read: if isAdminOrDispatcher()`), mirrored in `field-ops-app-vite/firestore.rules`. A writer exists: `functions/scripts/seedOperationsDemoData.js:142`. A governed EntityDefinition exists. **All four independently confirmed in this worktree.** |
| `inventory_actions` | The *write* side is retired — `domain/inventoryActions.js:recordInventoryAction()` unconditionally throws (Owner ruling 2026-08-30) and the `.add()`-capable store handle is gone. **Reads are untouched**: `hooks/useInventoryActions.js` still queries the collection and the Part record still shows the history. Write-retired ≠ retirable. |
| `warehouses`, `transfer_orders`, `suppliers`, `reorder_requests`, `reorder_purchase_orders`, `inventory_transactions` | all read by the same `Operations.jsx` dashboard `Promise.all` at `:91-100`, plus their own surfaces. |

**The `supplier_catalog` refutation is correct and I re-derived every leg of it.** A sibling lane
reported the collection as having "no write path"; that is true of *governed commands* and false of
the *system*. Retiring it on the strength of the write-path claim would have removed a live
Rules-governed client read used by the Operations dashboard. This is the exact failure mode the
method discipline exists to prevent, and it is the reason nothing in this document is repeated from
a sibling without being re-derived.

### 3.2 Deferred deliberately — the ledger of an executed authorization

`stock_locations` is the clean case, and the brief's framing of it needs one correction.

**What is true, and I verified all of it:**
* The collection is a retired duplicate balance authority (Decision #160 / ADR-014). It has no
  writer in business code and diverged from the ledger in both directions.
* `w1-warehouse-bin` removes its last seed writers (`seedOperationsDemoData.js`,
  `seedSandboxTransactional.js`, `seedSandboxPerformanceStory.mjs`), its fixture-pipeline entries,
  and its dead composite index from `firestore.indexes.json` — I read the diff hunks.
* One reference is **deliberately retained**: `functions/src/ownership/ownershipBackfillRules.ts:99`
  (the rule) and `:206` (`stock_locations: 5`, a measured blast-radius cap).
  `functions/test/eosOpsWarehouseBinAuthority.test.mjs:212-241` pins it by an exact `deepEqual` as the
  *only* remaining reference, with the reasoning inline: *"Removing the rule while the rows remain
  would make the plan silently incomplete. It goes when those rows do, which is a cutover step, not
  this one."*
* The authorization **was** executed. `sb-evidence/ownership-backfill-applied-eos-platform-sandbox.json`
  records `"applied": true, "written": 1015, "authorizedTotal": 1015`, and
  `sb-evidence/ownership-census-sandbox-postbackfill-2026-08-30.txt` shows `stock_locations` at
  `scan 5 / RESOLVED 5 / OWNERLESS 0`. **Both numbers confirmed by reading the artifacts.**

**Two corrections to the received account of this:**
1. **That evidence is not C31's.** Both artifacts are on `origin/main`, committed by `97b630e5`
   ("EOS Ownership Model v1", PR #1602), long before Wave 1. `w1-ownership-model`'s own handoff says
   the opposite of what it has been credited with: *"**No backfill was run**, and no operating company
   was stamped on any record"* and *"`ownershipBackfillRules.ts` is **unchanged**."* C31 *cites* the
   evidence in a test gate (`ownershipModel.test.mjs:684`). It did not produce it. The claim is true;
   the attribution is not, and an attribution error is how an unverified claim survives its next
   retelling.
2. **A different lane does edit that file.** `w1-truck-mobile` deletes the neighbouring
   `{ collection: "trucks", … }` rule and its `trucks: 2` cap, on the ground that deriving a truck's
   operating company from `homeWarehouseId` is *provably wrong* (cert-trk-04/05 are `ventana`
   vehicles homed at the `taylor` warehouse `wh-main`). The `stock_locations` rule and cap survive,
   so C3's `deepEqual` pin still passes — but `AUTHORIZED_TOTAL` silently drops **1015 → 1013**,
   while the applied-evidence JSON still records 1015. No test pins the constant (grep: only
   `warehouseRootCompanyAssignment.test.mjs:300`, which asserts the *operator code* does **not**
   mention it), so this is evidence drift, not a CI break. It should be recorded in the evidence
   artifact's provenance when C4 lands.

**Retirement condition for `stock_locations`:** the five sandbox rows are deleted (a cutover step,
explicitly out of scope for every lane so far). Only then may the backfill rule, the matching
`ownershipDerivation.ts:80` `stockLocation` family, the `entityRegistry.js` `stockLocation`
registration and `metadata/definitions/stockLocation.js` go — **and they must go together**, because
`entityRegistry.js` imports the definition file (deleting the definition alone breaks the import).

### 3.3 Deferred deliberately — frozen by ruling

`functions/src/cycleCount/cycleCountCallables.ts` holds two baseline entries
(`server.firebase_admin_firestore` + `server.firebase_functions_server`) and is **FROZEN on purpose**
(Decision #179 — certification history only). It is driven by
`functions/scripts/certificationWorld/executeCycleCount.mjs`, and `functions/test/cycleCountSheet.test.mjs`
pins that `index.ts` must *not* export it. Retained deliberately. Not a retirement candidate.

### 3.4 "Has only a test" is not proof of deadness

Five further baseline modules have no non-`docs/` reference outside their own tests
(`adminPolicy/migration/firestorePolicyParityHarness.ts`, `finance/financialPolicyProfileCommand.ts`,
`supplierMaster/reorderPurchaseOrderSupplierMigrationExecute.ts`, `services/completionService.js`,
`hooks/useInstalledEquipmentPage.js`). Each is migration/parity tooling with a registered suite.
Retiring any means deleting a suite registered in `field-ops-app-vite/test/suites.json`. Reported,
correctly, as *not* retired. I concur and add nothing to the list.

---

## 4. The dependency-ordered retirement sequence

Two orders matter and they are not the same. Conflating them is how a wave lands out of order.

### 4.1 Landing order for Wave 1 (a merge-conflict order, not a retirement order)

Verified with `git merge-tree --write-tree` between branch pairs. The wave **cannot** be merged in
parallel:

* `functions/package.json` — edited by **14** branches; every migration pair conflicts.
* `functions/test/adminPolicyPostgres.test.mjs` (9), `eosOpsPostgres.test.mjs` (9),
  `eosOpsOperatingCompanyCustody.test.mjs` (10), `eosOpsOperatingCompanyCustodyPostgres.test.mjs` (9)
  — these pin per-migration table counts and `eos_ops` table lists, so each landing migration shifts
  the others' expected indices. Confirmed conflicting: `w1-warehouse-bin` + `w1-purchasing`,
  `w1-equipment` + `w1-commercial`.
* `scripts/firebaseExitGuard.test.mjs` — **#1884 and #1892 conflict directly.** Confirmed:
  `CONFLICT (content): Merge conflict in scripts/firebaseExitGuard.test.mjs`. They are substantively
  compatible (§0.3); only the test file must be hand-merged. **Land #1892 first, then #1884**, so the
  ratchet is at its widest coverage before the baseline shrinks.
* `functions/src/workOrderConsumption/consumptionSourceService.ts` — `w1-serialized-asset` +
  `w1-workorder-authority` conflict.

Migration filenames do not collide (11 distinct timestamps), and no two migrations create the same
table in the same schema — `eos_ops` gains 21 distinctly-named tables, `eos_crm` 3, `eos_commercial`
4, `eos_policy` 1. Note every header calls itself "MIGRATION 008"; that is prose, not the runner's
ordering key.

### 4.2 Retirement order for Firebase business authority (the actual answer)

This is a **precondition graph**, not a schedule. Nothing below is authorized by this document.

```
  WAVE 1 (the 29 PRs) ── delivers schema + guard coverage only ── retires 3 modules, 0 collections
        │
        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ GATE A — wiring. A Postgres repository must have a caller before    │
  │ any Firestore reader can be re-pointed. Today: 0 of 11 are wired.   │
  └─────────────────────────────────────────────────────────────────────┘
        │
        ▼
  TIER 0 — reference data with no Firestore dependants of its own.
     warehouses + bins ──┐   (warehouse is the operating-company boundary ROOT:
     mobile_locations ───┤    ownershipMatrix declares "none -- this IS the root")
     trucks ─────────────┤
     suppliers ──────────┘
        │  must precede everything that names a location or a supplier
        ▼
  TIER 1 — records that REFERENCE tier-0 reference data.
     transfer_orders, receiving_orders, cycle_counts   (location_type/location_id typed pair)
     reorder_requests → purchase_orders → reorder_purchase_orders → *_voids
     part_supplier_items   (FK to suppliers — the migration's stated point)
     serialized_assets     (serialized_custody references warehouses/bins/mobile_locations)
        │
        ▼
  TIER 2 — the ledger and its idempotency guard, together or not at all.
     inventory_transactions  +  inventory_sync_status  +  inventory_commitments
     (dropping inventory_sync_status alone re-opens processed work orders to replay
      — NB-7, classified POSTGRES_AUTHORITY_REQUIRED_BEFORE_INVENTORY_CUTOVER)
        │
        ▼
  TIER 3 — customer master, then commercial, then finance. Strictly in this order.
     accounts → locations → contacts        (eos_crm; every commercial record names an account)
        → opportunities → sales_agreements → sales_orders   (lineage is one-directional)
        → invoices → payments → payment_applications → invoice_adjustments → refunds
     (the AR overlay cannot precede the invoice it overlays)
        │
        ▼
  TIER 4 — work execution. No Wave-1 Postgres target exists for any of it.
     fieldops_wos, fieldops_jobs, fieldops_technicians, counters
        │
        ▼
  OUT OF SCOPE — the identity fence. users, employees, roles, roleAssignments,
     permissions, accessRequests, usernames.  Retired separately, later.  See §7.

  INDEPENDENT of the above, gated only on a cutover:
     stock_locations — retires when its 5 sandbox rows are deleted. Its four residues
     (backfill rule + cap, ownershipDerivation family, entityRegistry registration,
      metadata definition file) must be removed in ONE change, because entityRegistry.js
      imports the definition file.
```

**The rule that generates this graph:** a collection that is the *migration source* for another
collection's Postgres import cannot retire before that import runs. `warehouses` is the sharpest
case — it is the operating-company boundary root, so `mobile_locations`, `bins`, `cycle_counts`,
`receiving_orders`, `transfer_orders` and every `operating_company_key NOT NULL` column downstream
resolve through it. Retiring `warehouses` first would strand every one of them.

---

## 5. The manifest / guard reconciliation

### 5.1 The disagreement, measured

| | Declares / enforces |
|---|---|
| `docs/architecture/firebase-exit-manifest.json` → `classification.BUSINESS_RUNTIME.baselineKeys` | **4** keys: `frontend.firestore_client`, `frontend.firebase_functions_client`, `server.firebase_admin_firestore`, `server.firebase_functions_server` |
| `scripts/firebaseExitGuard.mjs` **after PR #1892** | **12** categories — `{frontend, server, integrations} × {firestore_client, firebase_functions_client, firebase_admin_firestore, firebase_functions_server}` |

Re-derived from the branch: #1892 factors the four classes into `BUSINESS_RUNTIME_CLASSES`, adds
`SCAN_ROOTS = [frontend→field-ops-app-vite/src, server→functions/src, integrations→integrations]`,
and builds `FORBIDDEN_CATEGORIES` as the flat cross-product. `key` is `<section>.<name>`, matching
the baseline's `baseline.<section>.<name>` shape; a section or name absent from the baseline reads as
the empty set, so the eight cross categories with no entries are a ratchet pinned at zero.

### 5.2 What the manifest should declare

**All twelve keys**, exactly as the guard keys them:

```
frontend.firestore_client          frontend.firebase_functions_client
frontend.firebase_admin_firestore  frontend.firebase_functions_server
server.firestore_client            server.firebase_functions_client
server.firebase_admin_firestore    server.firebase_functions_server
integrations.firestore_client      integrations.firebase_functions_client
integrations.firebase_admin_firestore  integrations.firebase_functions_server
```

### 5.3 Is that a doc change or an authority change? **Both — and the split is the answer.**

**Eight of the twelve are a DOC change.** The four currently declared, plus the four cross-class keys
at the two existing roots (`frontend.firebase_admin_firestore`, `frontend.firebase_functions_server`,
`server.firestore_client`, `server.firebase_functions_client`). Those four were **already enforced
before #1892** — I verified this by reading the pre-#1892 guard on `origin/main`: old `scanTree`
collected the *set* of roots, walked them, and called `classifyFile(text)` with **no path filter**, so
every file from every walked root was tested against all four categories. A `functions/src` file
importing `firebase/firestore` would have been recorded under `frontend.firestore_client`, found
absent from that key's list, and reported as a violation. #1892's own header states the same
measurement and is why it crossed all classes with all roots rather than narrowing: *"restricting a
class to the root where it currently has entries would REMOVE coverage."* I confirm the reasoning is
sound — naive narrowing would have been a silent coverage regression. Declaring these four records
enforcement that already existed, now correctly keyed. **Doc change.**

**Four of the twelve are an AUTHORITY change.** The `integrations.*` keys fence a **third
business-runtime boundary that was fenced by nothing at all** before #1892: `integrations/` was not a
scan root, and `.mjs` was not a scanned extension, so the entire ChatGPT/MCP intake service was
invisible to the ratchet in both directions. Verified independently here: `integrations/` contains
exactly one subtree (`chatgpt-eos-intake`) and **zero** references to any `firebase*` module, and the
two original roots contain exactly one `.mjs` file
(`field-ops-app-vite/src/domain/inventoryControlLifecycle.cases.mjs`), which imports no Firebase
module. So widening the fence grows the baseline by zero while extending the *authority* to a new
boundary. That extension was made in the guard and in the workflow's `paths:` filter; the manifest —
the control document that names what must trend to zero — was not amended. **The manifest is behind
the authority, and amending it is a real authority statement, not bookkeeping.**

### 5.4 Mechanically, nothing reads the manifest

Verified: `baselineKeys` has **zero** programmatic readers. The guard cites the manifest only in two
comment strings (`:6`, `:306`); the workflow lists it only in `paths:`. The baseline's own `targets`
object is likewise read by nothing. So the reconciliation cannot break CI — which is precisely why it
will keep drifting unless it is written down. Two consequential recommendations:

1. Amend `BUSINESS_RUNTIME.baselineKeys` to the twelve keys, and record in the same change that eight
   are a restatement and four (`integrations.*`) are the new boundary, with #1892 named.
2. Consider adding an explicit `"integrations": { "firestore_client": [], … }` section to
   `firebase-exit-baseline.json`. The guard already treats an absent section as empty and fails
   closed, so this changes no behaviour — it makes "pinned at zero" a written fact rather than an
   inference from a missing key.

Neither is performed by this lane.

---

## 6. Landing-order note for the two retirement PRs

`scripts/firebaseExitGuard.test.mjs` is edited by **both** #1884 (which adds two pins that the three
retired paths stay absent from the tree and out of the baseline) and #1892 (which adds the
root-filter and `.mjs` coverage tests). They conflict textually and must be hand-merged.

**Recommended order: #1892, then #1884.** Reason: #1892 widens the fence and leaves the baseline at
369; #1884 then shrinks it to 366 under the wider fence. The reverse order works too, but lands a
baseline shrink under a narrower guard and then re-widens, which makes the ratchet history harder to
read. §0.3 verifies the end state passes either way.

---

## 7. The identity boundary — confirmed not crossed

`IDENTITY_ONLY` is explicitly outside this fence, and the guard implements that by *omission*:
`firebase/auth`, `firebase-admin/auth` and `firebase-admin/app` appear in no `FORBIDDEN_CATEGORIES`
entry. The seven identity baseline entries are:

```
frontend.firebase_auth       src/auth/AuthContext.jsx, src/firebase/firebase.js
server.firebase_auth         access/adminCredentialCallables.ts, access/claimsWriter.ts,
                             access/trustedWriterCommands.ts
server.firebase_admin_app    access/trustedWriterCommands.ts, index.ts
```

**Confirmation.** This document recommends the retirement of **nothing**. Its precondition graph
(§4.2) places `users`, `employees`, `roles`, `roleAssignments`, `permissions`, `accessRequests` and
`usernames` explicitly **out of scope**, below the fence line, and §2.2 declines to retire
`usernames` even though it is provably unreachable — partly for that reason. Two boundary facts were
checked directly rather than assumed:

* `firestore.rules:427` — `match /users/{userId} { allow read: if isSignedIn() && request.auth.uid == userId; }`.
  The document id **is** the Firebase UID. `users/{uid}.employeeId` is the UID→Employee correlation
  the Rules themselves depend on (`userData().employeeId == employeeId` gates the Employee self-read
  at `:476`). Retiring `users` would remove UID correlation — squarely inside the identity fence.
* `employees` appears in §1.1 because `w1-employee-principal` gives its *linkage* a Postgres home.
  That migration deliberately creates **no** `employees` table ("THERE IS NO `employees` TABLE IN
  POSTGRESQL YET"), and `employees` is also the correlation target above. It is listed as
  **not retirable**, on both business and identity grounds.

Nothing in §2, §3 or §4 touches `firebase/auth`, `firebase-admin/auth`, `firebase-admin/app`, an
identity baseline entry, a custom-claims path, or a UID-correlation record.

---

## 8. UNPROVEN — claims this lane could not verify locally

Listed as unproven rather than repeated. Each names what would settle it.

1. **PR numbers ↔ branches.** `gh` is unauthenticated in this environment
   (`gh auth login` required), so the mapping of `#1866`–`#1896` to `origin/impl/w1-*` could not be
   read from GitHub. All branch-level facts here were derived from git refs and are sound; the
   *specific PR numbers* attached to branches (e.g. "#1884 = `impl/w1-firebase-retirement`") are
   taken from the brief and are **UNPROVEN**. Also note **31** `impl/w1-*` branches exist against 29
   stated PRs — two branches may be PR-less or the count may be stale. Settle with `gh pr list`.
2. **Whether Wave 1 actually passes CI.** Every migration was read, not executed: no PostgreSQL
   instance was used, and the four shared Postgres suites conflict between branches (§4.1), so the
   post-merge state of `adminPolicyPostgres.test.mjs`'s pinned table counts is **UNPROVEN**. Settle by
   running `npm run test:adminPolicyPostgres` against PostgreSQL 16 on an integrated branch.
3. **Emulator-dependent Rules behaviour.** Firestore-emulator suites cannot run here — port 8080
   holds an unrelated uvicorn service and the Admin SDK retries forever. Every Rules claim in this
   document is from **reading** `firestore.rules`, not from executing it. Specifically **UNPROVEN**:
   that `field-ops-app-vite/firestore.rules` and the root `firestore.rules` are byte-identical in the
   blocks cited (both are recorded in the baseline's `rulesFiles` with the same
   33 `request.auth` references / 105 allow statements, which is consistent with but not proof of
   mirroring).
4. **Live Firestore contents.** No production or sandbox Firestore was contacted (prohibited, and
   correctly so). Document counts — including the five `stock_locations` rows whose continued
   existence is the sole reason the backfill rule is retained — rest on the 2026-08-30 `sb-evidence`
   artifacts. Whether those five rows **still exist today** is **UNPROVEN**, and it is the single
   fact that gates the `stock_locations` retirement in §4.2.
5. **Frontend `.test.jsx` suites.** `node --test` cannot run `.test.jsx` here, so claims resting on
   frontend component suites (e.g. that no component test exercises the retired
   `operationsIntelligenceService`) were checked by grep and by absence from
   `field-ops-app-vite/test/suites.json`, not by execution. Low risk; stated for completeness.
6. **Runtime reachability vs. static reachability.** The census is a static reference graph. A
   dynamic path — a collection name assembled at runtime, a Remote Config value, a callable reached
   by string — would not appear. No evidence of such a path was found, but its absence is
   **UNPROVEN**.

---

## 9. What this lane did

Produced this document. Ran `scripts/firebaseExitGuard.mjs` locally against the committed baseline
(pass), and against a composed post-#1884 + post-#1892 tree in a scratch directory (pass). Ran
`git merge-tree` to measure conflicts. Read eleven migrations, thirty-one branch trees, the guard on
both `main` and `impl/w1-guard-coverage`, `firestore.rules`, `firestore.indexes.json`, and the
`sb-evidence` ownership artifacts.

**Retired nothing.** No file deleted. No baseline entry removed. No manifest key added. No Rules
change. No index change. No seed. No backfill. No deploy. No production contact. No new Firebase
dependency. The baseline in this worktree is byte-identical to `origin/main`'s.
