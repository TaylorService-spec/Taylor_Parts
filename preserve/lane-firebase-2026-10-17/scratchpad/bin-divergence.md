# Warehouse Racking planner vs PostgreSQL bin authority -- divergence investigation

Read-only. Head: afead3bf (branch work/eos-firebase-exit). Paths relative to D:\eos-fb-exit.

## 0. Bottom line

- The racking planner (Administration > Warehouse Racking) is the ONLY consumer of the Firebase bin callables, and it
  writes a Firestore bin registry (`bins`, `bin_code_claims`) that NOTHING on the EOS/PostgreSQL side reads.
- Every employee reader (scan resolve, put-away, move stock, pick staging, cycle count, transfers, receiving location
  options, warehouse list) already resolves from PostgreSQL `eos_ops.bins` through `/operations/inventory`
  (`listInventoryLocations`). There is no sync, backfill or dual-write between the two stores.
- So: a planner-created bin is invisible to every scanner/picker; a planner label (EOS-LOC:bin_<hash>) resolves to
  NOT_FOUND; a planner relabel/deactivate changes nothing PostgreSQL sees. Worse, the planner's own warehouse picker is
  the Firestore `warehouses` collection (sample data), so it cannot even target the real `eos_ops.warehouses`.
- The same page already hosts the PostgreSQL path (`WarehouseMasters`, `/admin/policy` createBin/relabelBin/setBinStatus/
  listWarehouseBins). The PG path is single-bin only: no preview, no batch, no replay-safe create, different capability.

## 1. Firebase path (what the planner does today)

Reachability
- Nav item: field-ops-app-vite/src/navigation/navConfig.js:700 (`administration/warehouseRacking`, path
  `warehouse-racking`); in ADMINISTRATION_NAV_GROUPS systemIntegrations (navConfig.js:1893). Route render:
  field-ops-app-vite/src/App.jsx:707-709 `<AdminWarehouseRacking hasCapability={operationalContext?.hasCapability} />`.
- It is a declared nav gap (navConfig.js:885: "Gated today by the Firebase capability feed; inventory.location.bin.* is not
  in eos_policy.capabilities") and in the legacy placeholder set (navConfig.js:1197). docs/architecture/
  eos-native-identity-firebase-coexistence.md:65 classifies it FIREBASE-REQUIRED [unreachable-EOS]: with an EOS-native
  (non-Firebase) session `hasCapability` is always false, so the planner is dead; WarehouseMasters/TruckRegistry/
  TruckLocationScopeBindings subpanels still call /admin/policy.
- Capability ids: `inventory.location.bin.read` / `.manage` (field-ops-app-vite/src/access/shellCapabilityGates.js:93-96,
  WAREHOUSE_RACKING_GATE; registered `active:false` in functions/src/access/permissionCatalog.ts:1241-1252).
  Role: `inventoryBinAdministrator` carries both (functions/src/access/governedBusinessRoles.ts:1577-1583).
- Environments (config/environments.json): bin.read/manage are activated ONLY in `platform-sandbox`
  (capabilityActivationOverrides, lines ~183-184) and mirrored in functions/src/access/environmentCapabilityOverrides.ts:198-199,
  522-523. platform-certification/integration/local/production: not activated -> the planner renders its "not available to
  you" state. Production has `eosApi: null` and every readiness flag false (config/environments.json production entry), i.e.
  neither planner nor WarehouseMasters is usable there today.
- Readiness flags (EOS_NAVIGATION_AUTHORITY_READY etc.) do not gate this page; its gate is the Firebase `hasCapability` only.

Per UI action -> client -> callable -> handler -> Firestore write (AdminWarehouseRacking.jsx; client
field-ops-app-vite/src/services/binCommandClient.js:10-40; exports functions/src/index.ts:484-499 via
functions/src/inventoryLocation/binCallables.ts)

| UI action | Client call | Callable (exported name) | Handler | Writes |
|---|---|---|---|---|
| Load warehouse picker | `fetchWarehouses` (operationsQueries.ts:170, client-direct Firestore `warehouses`) | none | none | read only |
| Existing Bins list | `listBins` (JSX:242) | `listBins` (binCallables.ts:224) | `listBinsForWarehouse` binCommands.ts:390 | read `bins` where warehouseId==, limit 500 (+truncated flag the UI ignores) |
| Preview These Bins / Preview This Bin | `previewBinCreates({proposals})` chunked 250 (JSX:59,276-279) | `previewBinCreates` (binCallables.ts:211) | `previewBinCreates` binPreviewService.ts:104 | none (read `warehouses`, `bins/{id}`, `bin_code_claims/{id}`) |
| Create N Bins | `applyProposals` -> N x `createBin` at concurrency 4 (rackingApply.js:21,33) | `createBin` (binCallables.ts:112) | `createBin` binCommands.ts:143 | per bin ONE Firestore txn: `txn.create` `bin_code_claims/binclaim_<wh>__<code>` + `txn.create` `bins/<binId>` |
| Rename (UI edits NAME only, JSX:419) | `renameBin({binId,name})` | `renameBin` (binCallables.ts:129) | `renameBin` binCommands.ts:229 | see note |
| Deactivate / Reactivate | `deactivateBin`/`reactivateBin({binId})` | same names (binCallables.ts:138,147) | `setBinStatus` binCommands.ts:303 | txn.update status, version+1 |
| Label (BinLabelsAndExport) | none; reuses list rows | none | none | none |

Note on rename: the callable validates area/aisle/bay/position ALWAYS (validateBinRenameDraft, binRegistry.ts:308-329 ->
normalizeAttributes requires area/aisle/bay/position), so the UI's name-only `renameBin({binId,name})` would fail
`area_invalid`; the test stub hides this. Probably a latent UI bug (name-only edit cannot work); the server contract is
a full relabel (attrs + optional name). Not verified live.

Firestore document shapes
- `bins/{binId}`: warehouseId, area, aisle, bay (int), position (int), code, name|null, status ACTIVE|INACTIVE, version,
  schemaVersion 2, idempotencyKey, fingerprint (16-hex sha256 of canonical {warehouseId,area,aisle,bay,position,
  idempotencyKey}), createdAt/By, updatedAt/By (binCommands.ts:193-210). No operatingCompanyId, no audit event.
- `bin_code_claims/binclaim_<wh>__<code>`: binId, warehouseId, code, claimState HELD|SUPERSEDED, claimedAt/By,
  supersededAt/By, schemaVersion 1 (binCommands.ts:184-192, 265-276).
- binId = `bin_` + sha256(idempotencyKey)[0:40] (binRegistry.ts:86-88). Planner key = `binadm:v1:<wh>:<area>:<aisle>:<bay>:<pos>`
  (rackingLayoutGenerator.js:74-76). code = aisle + bay(2-pad) + "-" + position(3-pad) (binRegistry.ts:167-183).
- `bins` and `bin_code_claims` have no firestore.rules block (deny-all to clients; callable Admin SDK only).

Guards
- Auth: `request.auth.uid` required (binCallables.ts:46-51). Reads (list/preview/resolve): `inventory.location.bin.read` via
  Firebase `resolveEffectiveAccess` (binCallables.ts:54-68); a throwing resolver = deny. Writes: `inventory.location.bin.manage`
  resolved INSIDE the txn (binCommands.ts:145,238,310).
- Warehouse validity: the id must exist in Firestore `warehouses` (read inside the txn, binCommands.ts:149). No check of
  warehouse status, no operating-company check/scope (a bin carries no company; any manager can write any Firestore
  warehouse). No audit/history row beyond createdBy/updatedBy/version.
- Other exported bin callables: `resolveBin`, `resolveBinToken` (client wrappers exist in binCommandClient.js:35-36 but no
  caller; scan screens use PG). `recordPutAwayCallable` is unexported dead code (index.ts:500-502).

## 2. PostgreSQL path

Schema: functions/migrations/1758240000000_warehouse-and-bin-location-authority.sql (migration 008)
- `eos_ops.warehouses`: id PK, tenant_id FK, operating_company_key NOT NULL (no default), name, site_label,
  status ops_location_status(ACTIVE|INACTIVE), provenance(NATIVE|MIGRATED), created/updated by/at,
  UNIQUE(tenant_id,id).
- `eos_ops.bins`: id PK CHECK `^bin_[0-9a-f]{40}$`; tenant_id; warehouse_id with COMPOSITE FK (tenant_id,warehouse_id) ->
  warehouses; area CHECK `^[A-Z][A-Z0-9_]{0,31}$`; aisle CHECK `^[A-Z]{1,2}$`; bay 0..9999; "position" 0..99999;
  code CHECK `^[A-Z0-9][A-Z0-9.\-_]{0,31}$`; name; status; idempotency_key; audit cols.
  UNIQUE(tenant_id,warehouse_id,area,aisle,bay,"position"), UNIQUE(tenant_id,idempotency_key), UNIQUE(tenant_id,id).
  No operating_company column on a bin: company is the parent warehouse's (header "COMPANY LIVES ON THE WAREHOUSE").
- `eos_ops.bin_code_claims`: PK(tenant_id,warehouse_id,code); bin_id; claim_state HELD|SUPERSEDED;
  partial UNIQUE (tenant_id,bin_id) WHERE HELD; superseded_at CHECK. Permanent: never released.
- No quantity anywhere; later migrations add bin_placements (1764126000000) etc.

Repository: functions/src/eosOps/warehouseBinRepository.ts -- `createBin` :272 (bin row + HELD claim in one txn;
reuses binRegistry.formatBinCode/deriveBinId so code derivation is shared), `renameBin` :330 (claim old->SUPERSEDED, new
HELD, bin UPDATE; bin id stable; throws CLAIM_INTEGRITY if no HELD claim), `setBinStatus` :395, `selectBin`, `listBinsForWarehouse`
(limit 500), `resolveBinCode`, `resolveOpsLocation` (typed pair; MOBILE refused). Header (lines 12-14) says "NOT wired to
an HTTP operation" -- stale; warehouseBinAdministration.ts now wires it.

Admin commands: functions/src/eosOps/warehouseBinAdministration.ts
- ops (WAREHOUSE_ADMIN_OPERATIONS :248): listWarehouses, listWarehouseBins, createWarehouse, updateWarehouse,
  setWarehouseStatus, createBin, relabelBin, setBinStatus. Single-bin only.
- createBin :201 input: warehouseId, area, aisle, bay, position, name?, idempotencyKey (+reason). Requires ACTIVE warehouse.
  Replay is NOT idempotent: the INSERT hits PK/UNIQUE -> 23505 -> `DUPLICATE` CONFLICT (tx() :88). There is no `unchanged` outcome.
- relabelBin :216 input: binId + area, aisle, bay, position (all required) + name?; `warehouseId` refused; writes audit even if nothing changed.
- setBinStatus :233 input: binId, status; returns changed:false if already there.
- listWarehouseBins :130: unbounded (no LIMIT), ORDER BY code; returns binId,warehouseId,area,aisle,bay,position,code,name,status.
- Each mutation: reason REQUIRED (:64), one `eos_policy.audit_events` row in the same txn (:95; actions bin.created/
  bin.relabelled/bin.statusChanged; before/after JSON), tenant from the authenticated actor, never the body.
- Routing: adminPolicy/configurationOperations.ts:59-72 (all 8 gated by `warehouse.record.manage`, mutation flags);
  gate in adminPolicyApi.ts:531-541 (effective access via eos_policy resolver; reason pass-through); composition
  eosApi/server.ts:273-278 (isWarehouseAdminOperation). Client name list: field-ops-app-vite/src/services/adminPolicyApiClient.js:135+.
- Capability `warehouse.record.manage`: registered by migration 1764380000000 (cap_warehouse_record_manage); delta grants it
  only to Role operationalConfigurationAdministrator (adminPolicy/partsPurchasingReceivingDelta.ts:37,44). "Configuration
  authority, deliberately NOT operational" (warehouseBinAdministration.ts:7). It is tenant-wide: no company-reach check inside the ops.
- UI that calls it today: field-ops-app-vite/src/modules/administration/WarehouseMasters.jsx (rendered by
  AdminWarehouseRacking.jsx:609). Single "Add Bin" form with its OWN key `bin-<wh>-<area>-<aisle>-<bay>-<pos>` (JSX:88; raw
  inputs, NOT `binadm:v1:`) and Deactivate/Activate toggle; no relabel UI, no preview, no batch. No UI test for WarehouseMasters found.
- Scan reads (employees): `/operations/inventory` `listInventoryLocations` (partsReads.ts:373): caller's WAREHOUSE-scoped,
  fixture-excluded warehouses and their bins (id, code, name, status), plus trucks. Gate `warehouse.record.read` or
  `inventory.transaction.read`. Client resolve is done in JS over that list (services/inventoryLocationClient.js:60-76).

## 3. Reader -> store matrix

| Reader | Store | Evidence |
|---|---|---|
| Scanner bin resolve (human code & token), Put-away, Pick staging, Move stock | PostgreSQL | placementClient.js:11,33-34 -> inventoryLocationClient.js:59-76 -> listInventoryLocations (partsReads.ts:373) |
| Put-away/relocation writes | PostgreSQL | eosOps/stockRelocationOperations.ts, binPlacementOperations.ts (resolveOpsLocation) |
| Cycle count location pick + sheets | PostgreSQL (EOS) | CycleCounts.jsx:48 listInventoryWarehouses; eosOps/cycleCountOperations.ts |
| Transfers / TransferOrderForm | PostgreSQL | Transfers.jsx:42, TransferOrderForm.jsx:10-12 |
| Receiving location options | PostgreSQL | eosOpsHttp.ts:104,184 listReceivingLocationOptions; receiveReorderStockCommand.ts |
| Warehouse list/workspace (Inventory > Warehouses) | PostgreSQL | metadata/warehouseListSource.js:1-10 |
| Truck/MOBILE locations | PostgreSQL (`eos_ops.mobile_locations`, TruckRegistry via /admin/policy) | partsReads.ts:407-415 |
| Racking planner list/preview/labels/warehouse picker | FIRESTORE only | AdminWarehouseRacking.jsx:12,242,278; operationsQueries.ts:170 |
| Operations dashboard netted totals | Firestore warehouses (fetchWarehouses) -- unrelated to bins | metadata/definitions/warehouse.js:16-17 |
| Legacy Firestore readers still in tree (cycleCountSheetRead.ts, binConversionReport.ts (operator script), binParentage.ts, putAwayCommand.ts, stockRelocationCommand.ts, transferLocationResolver.ts) | Firestore `bins` | not exported callables (index.ts:496-516 comments); only the 8 bin callables remain exported; scripts/binConversionReconciliation.mjs is operator-run |

## 4. Divergence quantified

Today, in an environment where the planner is usable (platform-sandbox with the Firebase session and inventoryBinAdministrator):
1. Create: lands ONLY in Firestore `bins`/`bin_code_claims`. No trigger, no dual-write, no backfill/import runner. The only
   mapping code is functions/src/eosOps/migration/warehouseBinMigrationSource.ts (`reconcileLocationSource` :224, pure);
   its sole caller is functions/test/eosOpsWarehouseBinAuthority.test.mjs. grep of functions/scripts and scripts finds NO
   operator script that reads Firestore bins and writes eos_ops.bins (the inventory baseline cutover reads an offline
   snapshot and only checks that a legacy bin id already exists in eos_ops.bins: eosOps/migration/inventoryBaselineCutover.ts:20,188,240).
   docs: cycle-count-eos-cutover.md:71,88 lists "bins present in eos_ops" as an unmet upstream population ("warehouse/bin COPY");
   no doc records a run. => never ran / no evidence it ran.
2. Not scannable: a printed planner label carries `EOS-LOC:<binId>` (domain/binLabel.js:20-45). PG resolve compares the token
   to eos_ops.bins ids (inventoryLocationClient.js:70-76) -> NOT_FOUND. Typing the code: NOT_FOUND unless PG has the code.
3. Relabel/status mismatch: relabel (code claim SUPERSEDED) and deactivate happen in Firestore only. PG bin (if one exists
   with the same position) stays ACTIVE and at its old code -> stock can still be put into a bin the planner "retired".
4. Duplicate / split identity: the same physical position can exist twice with DIFFERENT binIds: planner key
   `binadm:v1:<fsWh>:...` vs WarehouseMasters key `bin-<pgWh>-<rawArea>-...` (and warehouse ids differ across stores).
   PG's UNIQUE(rack position) and claim PK stop two PG rows, but nothing relates a Firestore row to a PG row.
5. Warehouse universe mismatch: planner warehouses = Firestore `warehouses` (global owner ruling in
   inventoryBaselineCutover.ts:~52 "NOTHING CURRENTLY STORED IN FIREBASE IS REAL TAYLOR BUSINESS DATA"; fixture ids wh-main/
   wh-north are FORBIDDEN identities in PG). It can never create bins in `taylor-main`-style real warehouses.
6. Stock into an unknown bin: PG relocation/put-away/cycle count/receipt resolve the destination bin via resolveOpsLocation
   in PG; an unknown id is refused LOCATION_NOT_FOUND (warehouseBinRepository.ts resolveOpsLocation). So the failure mode is
   REFUSAL, not silent mis-posting: stock cannot be placed into a Firestore-only bin. (Verified for resolveOpsLocation; per-
   operation behaviour for every command not individually re-read.)
7. Company isolation: Firestore bins have none (no company on bin, no per-company check; warehouse.operatingCompanyId is
   optional legacy). PG isolates by tenant (composite FKs) and company via warehouse.operating_company_key, but the admin
   ops are tenant-wide under `warehouse.record.manage` (no company-reach narrowing for an administrator).
   Taylor vs Ventana separation is therefore preserved at row level in PG (via warehouse) and NOT at all in Firestore.
8. Auth: planner needs a Firebase session; under EOS-native login it is inert (coexistence doc :65).
9. Fail modes in the planner's own plumbing: list truncation (`truncated` ignored), preview verdicts only for Firestore state.

Net: today the planner is a self-consistent but orphaned Firestore island. Risk is operational confusion (operator believes
racking is configured; scanners disagree) rather than data corruption, because PG refuses unknown bins. It becomes a
corruption risk only if someone later imports Firestore bins and PG already holds the same positions under other ids.

## 5. `previewBinCreates` exact behaviour (to specify the EOS equivalent)

Source: functions/src/inventoryLocation/binPreviewService.ts:104-214; client contract AdminWarehouseRacking.jsx:272-288.
- Input: `{ proposals: [{ warehouseId, area, aisle, bay, position, name?, idempotencyKey }] }`; must be array (else
  `proposals_required`); [] -> `{rows: []}`; > 250 (BIN_PREVIEW_MAX_PROPOSALS :64) -> refused `too_many_proposals` (never truncated).
- Per proposal runs createBin's own `validateBinDraft` (binRegistry.ts:266): rejects caller-supplied `binId` (`bin_id_not_accepted`)
  or `code` (`code_not_accepted`); warehouseId safe segment (`warehouse_invalid`) and in the known set (`warehouse_unknown`);
  idempotencyKey non-blank; area normalized upper + whitespace->`_`, `^[A-Z][A-Z0-9_]{0,31}$` (`area_invalid`); aisle
  `^[A-Z]{1,2}$`; bay int 0..9999; position int 0..99999; name <=120 (`name_too_long`); code via formatBinCode default policy.
- Output: `{ rows: [{ idempotencyKey, warehouseId, area, aisle, bay, position, code (server canonical), classification, reason }] }`.
- Classifications: NEW; ALREADY_EXISTS (== createBin would return `unchanged`: same binId, coherent attrs, fingerprint recomputes,
  claim points back); CODE_RESERVED (`code_reserved_by_another_bin`: claim exists for the code, held by a different bin, HELD or
  SUPERSEDED); INVALID (reason = validation token); INTEGRITY_ERROR (`claim_unreadable`, `bin_schema_version`,
  `bin_disagrees_with_request`, `bin_fingerprint_mismatch`, `claim_points_elsewhere`).
- Reads: one `warehouses` collection read per call, then bin doc + claim doc per proposal. Writes nothing (test proves it:
  functions/test/binPreviewService.test.mjs fake db records writes).
- Client-only pure part (kept): domain/rackingLayoutGenerator.js (generateRackingLayout, odd positions 1,3,5.., aisle range/list,
  per-aisle/bay overrides, in-request DUPLICATE detection, `binIdempotencyKey`, `toCreateRequest`).
- EOS already has NO preview or batch-create operation (checked WAREHOUSE_ADMIN_OPERATIONS and ADMIN_CONFIGURATION_OPERATIONS).

## 6. Tests today

Firebase side: functions/test/binPreviewService.test.mjs, binRegistry.test.mjs, stockRelocationCommand.test.mjs,
binP4RelocationRoles.test.mjs, binCycleCountEligibility.test.mjs, binConversionReconciliation.test.mjs;
field-ops-app-vite/test/adminWarehouseRacking.test.jsx (UI + BIN_CALLABLES), rackingLayoutGenerator.test.jsx,
binLabelsIntegration.test.jsx, binLabelsSurface.test.jsx, binLabel.test.jsx.
PostgreSQL side: functions/test/eosOpsWarehouseBinPostgres.test.mjs (schema/constraints/claims/rename/resolve, SKIP without DB),
eosOpsWarehouseBinAuthority.test.mjs (migration source mapping/absences), inventoryWarehouseJourneyPostgres.test.mjs,
partsPurchasingReceivingJourneyPostgres.test.mjs, truckInventoryActivationJourneyPostgres.test.mjs (call the createBin/
setBinStatus/listWarehouseBins admin ops), eosBinPlacementPostgres.test.mjs, eosStockRelocationPostgres.test.mjs,
field-ops-app-vite/test/adminPolicyApiClient.test.mjs (operation name list). GAPS: no direct unit test of
warehouseBinAdministration relabelBin/duplicate-replay/refusal paths, no UI test for WarehouseMasters.

## 7. Docs and decisions

- docs/specifications/bin-administration-racking-generator.md (BIN-P3 spec; ratified choices: deterministic `binadm:v1:` key,
  trusted preview over createBin, "No giant transaction ... bounded client orchestration ... partial success is normal" :328-330,
  `bins/{binId}` is the racking authority :116, no stored form).
- docs/implementation-plans/bin-location-authority-and-scanning.md; docs/specifications/bin-location-labels-and-export.md;
  docs/runbooks/bin-warehouse-conversion.md; bin-phoenix-pilot-worksheet.md; docs/user-guide/administration/set-up-warehouse-racking.md.
- docs/DECISIONS.md #160 (Model A roll-up, ruling O-3 stable bin id, O-7 warehouse-scoped codes) at :4547; :5675 (BIN-P3 apply
  runner precedent); #170 (BIN-P6 relocation); Controller DQ-E 2026-10-01 (warehouseBinAdministration.ts header: "Administration UI/API ->
  governed server command -> PostgreSQL ... DO NOT build a second warehouse model").
- docs/architecture/firebase-exit-baseline.json (baseline entries listed in section 9), firebase-exit-ratchet.md,
  firebase-capability-equivalence.json (bin callables are in exportBaseline lines 15-76 but have NO equivalence record yet),
  eos-native-identity-firebase-coexistence.md:65.
- docs/architecture/cycle-count-eos-cutover.md:71,88 (bin COPY as upstream population).

## 8. PROPOSAL (design only)

### 8.1 Capability (Owner decision D1)
The Firebase ids `inventory.location.bin.*` do not exist in eos_policy (navConfig.js:885), so "same capability" is literal-impossible.
Options: (A) reuse `warehouse.record.manage` for all (existing; read of racking then needs manage -> loses read-only audience);
(B) A + keep the scoped employee read `warehouse.record.read`/`inventory.transaction.read` via listInventoryLocations for read-only
viewing; (C) register new `warehouse.bin.read` + `warehouse.bin.manage` in eos_policy (migration + role delta; an authorization-
model/catalog change = Owner). Recommend (A) now with (B) for view-only if wanted; (C) only if the Owner wants the
bin-administrator persona (inventoryBinAdministrator) to keep working without holding warehouse master authority.
Also: role mapping inventoryBinAdministrator (Firebase) -> EOS role is an Owner/grant action.

### 8.2 EOS `previewBinCreates` (read op on /admin/policy, same capability family)
- Pure module `functions/src/eosOps/binRackingPlan.ts` (no pg): `planBinCreates({proposals, warehouse, existing})` where
  `existing = {binsByPosition, binsById, claimsByCode}` loaded by the op. Reuses `validateBinDraft` (pass knownWarehouseIds =
  Set([warehouseId])), `deriveBinId`, `formatBinCode`, `fingerprint`-equivalent compare on structured attrs. Deterministic: stable
  ordering, no clock/random.
- Operation `previewBinCreates` input `{ warehouseId, proposals:[{area,aisle,bay,position,name?}] }`; max 500 per call (see D4);
  ONE warehouse and ONE batch of queries (SELECT bins/claims for the warehouse by (area,aisle,bay,position)/code ANY($..)), no
  per-row round trips; read snapshot (REPEATABLE READ read-only) so classifications are internally consistent.
- Server derives idempotencyKey = `binadm:v1:<warehouseId>:<area>:<aisle>:<bay>:<position>` from the NORMALIZED structured attrs
  (client stops authoring keys; one derivation, same as the ratified key so a later import yields the same binId).
- Output `rows[{ index, warehouseId, area, aisle, bay, position, code, classification, reason, binId? }]` + `summary` + `planDigest`
  (sha256 of canonical rows) used by createBins to prove "what you reviewed is what is applied".
  Classifications: NEW, ALREADY_EXISTS (same position/key, coherent), CODE_RESERVED (claim held/superseded by another bin),
  POSITION_TAKEN (position row exists under a different idempotency key), INVALID, WAREHOUSE_NOT_ACTIVE, INTEGRITY_ERROR
  (claim without bin, bin without HELD claim, code != formatBinCode(attrs)).
- Dispatch: add to WAREHOUSE_ADMIN_OPERATIONS, ADMIN_CONFIGURATION_OPERATIONS (mutation:false), adminPolicyApi dispatch case list
  (:1133-1164 exhaustiveness), adminPolicyApiClient.js list, tests.

### 8.3 `createBins` batch command (mutation)
- Input `{ warehouseId, proposals:[...], previewDigest?, batchId (client idempotency key), reason }`; max 250-500 per call.
- ONE transaction (BEGIN..COMMIT) via the existing `tx()`; lock the warehouse row FOR SHARE (status ACTIVE check); re-run the same
  pure plan inside the txn; insert only NEW rows (INSERT ... ON CONFLICT DO NOTHING RETURNING on bins, then claims) so no row-level
  23505 poisons the transaction; replay (ALREADY_EXISTS) is `unchanged`, not an error. All-or-nothing: if ANY row is CODE_RESERVED/
  POSITION_TAKEN/INVALID/INTEGRITY_ERROR -> reject whole batch with the per-row verdict list (nothing written). If previewDigest
  supplied and the re-plan differs -> `PLAN_CHANGED` refusal.
- Audit: ONE `eos_policy.audit_events` row per batch (action `bins.batchCreated`, target warehouse, after = {count, binIds digest, codes range})
  PLUS reuse of per-bin `bin.created` rows only if the Controller wants per-bin history (D5); at minimum one batch row with the reason.
- Batch idempotency: batchId + digest stored in the audit row's after or a tiny `eos_ops.bin_batches` table (decision D6: no new table
  preferred; derive idempotency from the structural per-bin keys, so a re-submitted identical batch is all ALREADY_EXISTS = success).
- Fix single `createBin` to be replay-safe too (return unchanged when key+attrs equal) -- a PG-side bug independent of the planner.
- Conflict semantics: bins are NEVER moved/overwritten; deactivated bins are not revived by a create; claims never released.

### 8.4 Relabel / status reuse
Existing `relabelBin` and `setBinStatus` are reused unchanged for per-bin edits, with small fixes: UI name edit must send the current
area/aisle/bay/position with the new name (relabelBin requires them); make relabelBin a no-op (no audit row) when nothing changed.
Per-bin reason UX: the planner needs a reason field (Administration requires one for EVERY mutation); one reason per batch.

### 8.5 Client cutover (AdminWarehouseRacking.jsx)
- `client` default -> new `warehouseBinAdminClient` over `callPolicyApi` (services/adminPolicyApiClient.js) with the same method names
  (listBins -> listWarehouseBins; previewBinCreates -> previewBinCreates; createBin(s) -> createBins; renameBin -> relabelBin; deactivate/
  reactivate -> setBinStatus). Map response shapes (`items` vs `bins`, outcome vocabulary) in the adapter so rackingApply/labels stay.
- Replace `applyProposals` N-calls with one `createBins` call per <=250 chunk (UI: per-chunk result instead of per-bin); keep
  generator + normalization pure modules.
- Warehouse picker: `listWarehouses` (admin) instead of Firestore `fetchWarehouses` (drops this consumer of operationsQueries.ts but
  that file stays in baseline for other readers). Decision D3: show fixtures? (admin op lists all tenant warehouses incl. forbidden fixture ids).
- Gate: replace WAREHOUSE_RACKING_GATE Firebase ids with the EOS surface/capability per D1; remove `hasCapability` dependence so it works
  in EOS-native sessions (also removes the "FIREBASE-REQUIRED" classification). Keep the Ungated copy but derive posture from the
  server refusal (FORBIDDEN) like WarehouseMasters.
- Merge/retire the duplicate `WarehouseMasters` "Add Bin" form (same op, different idempotency key scheme) so there is one create path
  with one key derivation.
- BinLabelsAndExport consumes `bins` rows (binId, code, area, aisle, bay, position, name, status): the adapter must keep that shape
  (listWarehouseBins already returns these; truncated flag not needed since unbounded -- add a cap, see D4).

### 8.6 Reconciliation (read-only first, operator-run, then governed import)
1. Read-only diff report script (`functions/scripts/binRegistryDiffReport.mjs`, runs ONLY with operator credentials, emulator/sandbox;
   production refused by name like binConversionReconciliation.mjs): reads Firestore `warehouses`, `bins`, `bin_code_claims` and PG
   `eos_ops.warehouses/bins/bin_code_claims` for a warehouse mapping manifest {firestoreWarehouseId -> eosWarehouseId}; per mapped
   warehouse emits: planner-only bins, PG-only bins, same position different binId, same code different bin, status mismatches,
   claim-state mismatches, malformed rows (reuses migration/warehouseBinMigrationSource.ts mapping + refusals). Output JSON +
   sha256; writes nothing anywhere. Company: asserts Firestore warehouse.operatingCompanyId == PG warehouse company; mismatch = blocking.
2. Owner decision D7: are Firestore bins real? (Global ruling says Firebase data is not real Taylor data.) If NO planner-only bin is
   real, the import is not needed: archive the report, freeze Firestore writes (retire callables), done. If YES for specific warehouses:
3. Governed import = a new operator script reusing warehouseBinMigrationSource + warehouseBinRepository.createBin-equivalent with the
   bin id CARRIED (bin_<hash> shape check), warehouse mapped through the manifest, claims copied (HELD+SUPERSEDED), idempotent,
   dry-run default, `--execute` requires the manifest + report sha. Never silent; never automatic on deploy.
Order: report -> Owner decision -> (import) -> cutover client -> retire Firebase callables.

### 8.7 Serialized PR plan (each gated by: functions build + node --test of listed files, field-ops vitest, firebase-exit guard,
equivalence guard, lint/typecheck; Owner-gated deploy not part of any PR)

PR-1 (server, additive; no baseline change): `binRackingPlan.ts` pure planner + `previewBinCreates` + `createBins` ops + replay-safe
 single createBin + relabel no-op fix. Files: functions/src/eosOps/binRackingPlan.ts (new), warehouseBinAdministration.ts,
 adminPolicy/configurationOperations.ts, adminPolicy/adminPolicyApi.ts (exhaustive cases), field-ops-app-vite/src/services/
 adminPolicyApiClient.js (+ its test list), docs (spec delta). Tests: new functions/test/binRackingPlan.test.mjs (pure, deterministic,
 limits, classifications, digest), new functions/test/eosOpsBinBatchPostgres.test.mjs (all-or-nothing, replay, concurrency, position/
 code conflict, audit row, tenant/company isolation, inactive warehouse), extend inventoryWarehouseJourneyPostgres.test.mjs.
 Baseline: none removed. Gates: new serialized PG test added to the package.json Postgres script + CI workflow (new-subsystem trap).
 Needs D1, D3, D4, D5, D8 first.
PR-2 (read-only reconciliation tooling): `functions/scripts/binRegistryDiffReport.mjs` + `functions/src/eosOps/migration/binRegistryDiff.ts`
 (pure) + tests. Baseline: none (script uses firebase-admin; scripts are not in live-runtime baseline -- verify guard scope).
 Operator runs it (Owner-credential boundary); output committed as evidence only after Owner review.
PR-3 (client cutover, depends on PR-1 deployed to sandbox + D7 answered): AdminWarehouseRacking.jsx, new services/warehouseBinAdminClient.js,
 rackingApply.js (chunked apply), BinLabelsAndExport adapter, WarehouseMasters Add Bin merged/removed, navConfig gate/NAV_SURFACE_GAPS
 line 885, shellCapabilityGates.js (WAREHOUSE_RACKING_GATE removal), tests: update adminWarehouseRacking.test.jsx, rackingLayoutGenerator
 (unchanged), binLabelsIntegration (shape), new warehouseBinAdminClient.test. Baseline removed: field-ops-app-vite/src/services/
 binCommandClient.js (firebase_functions_client) once PR-3 deletes it; AdminWarehouseRacking stops using operationsQueries.ts (file stays).
 Also add equivalence records for createBin/renameBin/deactivateBin/reactivateBin/previewBinCreates/listBins/resolveBin/resolveBinToken.
PR-4 (conditional, only if D7 = import): governed import script + tests; operator-run; no baseline change.
PR-5 (server retirement): remove 8 exports from functions/src/index.ts:484-499, delete binCallables.ts, binPreviewService.ts, putAwayCommand.ts
 (orphaned dead), binCommands.ts only after re-homing BINS_COLLECTION consumers (cycleCountSheetRead.ts, binConversionReport.ts,
 binParentage.ts, stockRelocationCommand.ts, transferLocationResolver.ts -- separate retirement chains) ; delete matching Firebase tests
 (binPreviewService.test.mjs etc.). Baseline removed: server.firebase_admin_firestore {binCallables, binPreviewService, putAwayCommand,
 (+binCommands when unblocked)}, server.firebase_functions_server {binCallables}. Deployed copies stay DEPLOYED_NOT_CALLED until the
 bounded Firebase removal window (index.ts comment convention); a Functions deploy/delete is an Owner/operator action.
 Keep binRegistry.ts (pure; PG repository imports it).
PR-6 (docs): user guide set-up-warehouse-racking.md, spec delta to bin-administration-racking-generator.md (supersedes "no giant transaction"
 if D5 chooses batch), DECISIONS entry, ACTIVE_WORKSTREAMS lane, firebase-exit baseline/ratchet census.

## 9. Baseline entries touching this chain (docs/architecture/firebase-exit-baseline.json)
- frontend.firebase_functions_client: field-ops-app-vite/src/services/binCommandClient.js (:38)
- frontend.firestore_client: field-ops-app-vite/src/services/operationsQueries.ts (stays; other readers)
- server.firebase_admin_firestore: functions/src/inventoryLocation/{binCallables,binCommands,binPreviewService,binParentage,putAwayCommand,
  stockRelocationCallables,stockRelocationCommand,binConversionGate,locationDisplayReadService}.ts, functions/src/inventoryLedger/binConversionReport.ts
- server.firebase_functions_server: binCallables.ts, stockRelocationCallables.ts, locationDisplayReadService.ts
- runtimeCollectionNames.LIVE_FRONTEND_RUNTIME includes "warehouses" (planner picker is one of its readers).
Planner-specific removable set: binCommandClient.js, binCallables.ts (2 classes), binPreviewService.ts, putAwayCommand.ts (orphaned once
binCallables goes), binCommands.ts (after BINS_COLLECTION importers are re-homed).

## 10. Owner / Controller decisions to flag
D1 Capability model for racking admin on EOS (reuse warehouse.record.manage vs new bin read/manage capabilities) and role mapping for
   inventoryBinAdministrator (authorization-model/role grant = Owner boundary).
D2 Whether racking admin is allowed without a Firebase session / is the nav gap (navConfig.js:885) closed by an EOS surface key
   (server experienceAuthority change).
D3 Which warehouses the planner may target (all tenant warehouses incl. fixture ids vs governed non-fixture only; company reach for a
   company-scoped administrator -- current ops are tenant-wide).
D4 Max batch size (Firestore preview 250; PG list cap 500; DB allows thousands) and whether listWarehouseBins gets a hard cap.
D5 Batch atomicity: spec BIN-P3 ratified "no giant transaction, partial success is normal"; all-or-nothing batch reverses that for the
   planner (material product/architecture call) and audit granularity (one batch row vs per-bin rows).
D6 Client-authored idempotency keys vs server-derived `binadm:v1` keys (affects WarehouseMasters' different key scheme and future import ids).
D7 Are any Firestore planner bins real? (decides import vs archive+freeze). Import itself is a migration = Owner/operator.
D8 Reason requirement UX for bulk (one reason per batch) -- Administration requires a stated reason for every mutation.
D9 Retiring deployed Firebase bin callables = Functions deploy/removal (operator, Owner-gated); keep DEPLOYED_NOT_CALLED until window.
D10 Rename semantics: UI today edits name only but the server contract is a full relabel; confirm intended UX (name-only edit vs
    physical relabel with code move and SUPERSEDED claim).

## 11. Unverified / caveats
- Whether the planner works at all today in sandbox (name-only renameBin vs required area fields) -- inferred from source; not run.
- Whether warehouse.record.manage is currently granted/active in any environment (migration + delta exist; application not verified).
- Per-command PG behaviour for every destination-bin consumer was not individually re-read beyond resolveOpsLocation callers.
- No live data inspected (read-only, no network).
