<!-- ARCHIVED AI WORKING NOTES — NOT AUTHORITY -->
> **Historical AI working notes**, moved out of Claude's private memory on 2026-08-16 so they are
> visible and auditable in the repository. **This file is not authoritative.** The authoritative
> record for this workstream is the linked `docs/` specification, DECISIONS entry, or PR history.
> Retained verbatim so nothing is lost; do not cite it as a decision of record.

---
name: project_receiving_location_authority
description: "I-LA gate ratified C2 -- warehouses.status is the governed first-slice Receiving location-eligibility authority; spec merged (PR #539), NO code yet; phased roadmap I-LA1..I-LA5/E1/E2/F/G each needs its own gate"
metadata: 
  node_type: memory
  type: project
  originSessionId: 394aea59-4c68-4754-ac8d-9ec5ca864f81
  modified: 2026-08-04T03:16:39.681Z
---

Receiving needs a governed "is this location eligible?" authority for the Phase-B
`resolveLocationActive` seam. The CUSTOMER reconciliation doc
(docs/specifications/receiving-selectable-location-authority.md) had HALTed at Option D,
listing options C1 (existence-eligible) / C2 (warehouses.status) / C3 (inventory_locations).

**I-LA gate RATIFIED C2** (Owner ratification 2026-08-03; spec
docs/specifications/receiving-location-authority-i-la-c2-warehouse-status.md merged via
PR #539, merge-commit e042165, docs-only 1 file). C3's `inventory_locations` does not
exist at any layer; C1 can't distinguish retired warehouses. Owner approved O-1..O-5.

Ratified contract (spec only -- NOTHING implemented):
- **Governed field**: `warehouses.status` = `ACTIVE|INACTIVE`. Receiving fails closed on
  missing/malformed/unknown/INACTIVE -- NO runtime inference (stricter than the merged
  truckRegistry `isWarehouseActive`, which infers absence=>active; that reader stays
  compatible after migration removes `active`).
- **§3A shared governed-record schema** (one validator shared by validator/migration/
  verifier/writer/tests): status + integer version>=1 + updatedAt/By (all required) +
  required `provenance` discriminator NATIVE|MIGRATED; createdAt/By optional but
  never-fabricated; governanceInitialized* present iff MIGRATED; legacy `active` must be
  ABSENT. Provenance complete-pair invariants enforced (§3A.1).
- **Migration (I-LA3)** initializes the full schema + removes `active`; legacy
  contradictions require an Owner-authored resolution manifest bound to project +
  governed-commit + content-hash + LIVE pre-state fingerprint (re-read/compare before
  write); fail closed on drift/missing/extra/out-of-set/invalid.
- **Resolver (I-LA5)** reads through txn and validates the COMPLETE §3A record (not just
  status); a partially-migrated `{status:"ACTIVE"}` is ineligible.
- **inventory.stock.receive grant is a SEPARATE explicit gate** (Phase C registered it
  ungranted; E1 export does not grant it).
- **Phase-D receiving_orders Rules deploy is UNCONDITIONAL** before callable activation
  (E2 ordering pinned).

Ratified decisions: O-1 status subsumes active (migration removes active) · O-2 dedicated
`inventory.warehouse.status.set` capability, ungranted · O-3 trusted backend-served
eligible-location options · O-4 active PARTS_ASSOCIATE only after I-LR + the receive grant
gate · O-5 single `version` + required `provenance` discriminator.

Phased roadmap (each its own DRAFT->Codex->Owner gate; repo-only unless noted): I-LA1
types/validation -> I-LA2 trusted warehouse writer (create default + ACTIVE<->INACTIVE
version-CAS transitions) -> I-LA3 migration+verifier (inert) -> I-LA4 Rules/read-auth
(I-LR) -> I-LA5 wire resolver -> E1 callable+capability -> E2 deploy Rules+migrate (Owner/
operator) -> F Customer frontend cutover -> G prod verify. On ratification, add a
DECISIONS.md entry + SYSTEM_AUTHORITIES.md row when code lands. Builds on
[[project_ei_phase2_receiving]].

PROGRESS:
- **I-LA1a MERGED** (PR #540, main 9e57b83, 2026-08-03), INERT/additive/backend-only, 5 files:
  functions/src/types/warehouse.ts (WAREHOUSE_STATUSES ACTIVE|INACTIVE, WAREHOUSE_PROVENANCES
  NATIVE|MIGRATED, GovernedWarehouse type, result type) + functions/src/warehouseGovernance/
  governedWarehouseValidation.ts (the SHARED pure validator
  `validateGovernedWarehouse(input, expectedWarehouseId)` -- binds stored id to doc id;
  enforces §3A + §3A.1 provenance pairs; firebase-admin Timestamp instanceof; rejects
  unknown/active; 20 bounded snake_case reasons incl expected_id_invalid/id_mismatch;
  never throws, deterministic, no mutation) + offline test (29 cases) + package.json
  test:warehouseGovernance + .github/workflows/warehouse-governance-tests.yml. Zero runtime
  consumers, not in index.ts. CUSTOMER I-LA1b (RawWarehouse mirror) is the frontend follow-on.
- Truck verifier pin repair MERGED (PR #542, main 5e52a8d): verifyTruckRegistryDeployment.js
  GOVERNED_RULES_SHA256 + example config re-pinned bb1492b9->ec1f0a9b to track the merged
  Phase-D receiving_orders firestore.rules change (the whole-file hash the truck smoke-verifier
  pins drifted when PR #537 merged). docs/audits evidence left immutable. NOTE: this re-pins to
  REPO rules; Phase-D receiving_orders is still repo-only/undeployed, so a production truck
  verifier run needs the current rules deployed + fresh recapture first.
- **I-LA2 MERGED** (PR #544, main 4c64057, 2026-08-03), INERT/unexported, 4 files:
  functions/src/warehouseGovernance/warehouseStatusWriter.ts (createWarehouse +
  setWarehouseStatus) + emulator test (19 cases) + package.json test:warehouseStatusWriter +
  .github/workflows/warehouse-status-writer-tests.yml. Trusted writer governed by the merged
  §3A validator: createWarehouse => NATIVE record (v1/ACTIVE/server metadata, no active);
  setWarehouseStatus => ACTIVE<->INACTIVE under expectedVersion CAS, version+1 exactly,
  idempotent same-status no-op, ungoverned record => MALFORMED_RECORD (never initializes
  history). One runTransaction, reads-before-writes, trusted deps.actor, INJECTED authorize +
  stageAudit seams referencing capability string inventory.warehouse.status.set (single seam
  for both ops per O-2; UNREGISTERED/ungranted). Request-key allowlists reject unknown fields
  (embedded actor/overrides) as INVALID_REQUEST. Commit-time revocation proven (separate-conn
  revoke after auth read => no commit). Error codes PERMISSION_DENIED/INVALID_REQUEST/
  ALREADY_EXISTS/NOT_FOUND/MALFORMED_RECORD/VERSION_CONFLICT/WRITER_INTEGRITY.
- **I-LA3 MERGED** (PR #547, main 33b41c6, 2026-08-03), INERT/unexported, 9 files:
  functions/src/warehouseGovernance/warehouseGovernance{Migration,Verifier,Evidence}.ts +
  functions/scripts/warehouseGovernanceMigrationCli.js (operator CLI, require.main-guarded, lazy
  firebase-admin, DRY-RUN default) + 3 tests + package.json + CI workflow. Dry-run migration
  planning (classification per §4 matrix: GOVERNED no-op/DERIVE ACTIVE|INACTIVE/AMBIGUOUS),
  manifest validation (fails closed on missing/extra/dup/invalid-status/wrong-project/wrong-commit/
  stale-prestate), executeMigration through an injected store.readAll() seam BOUND TO THE COMPLETE
  live set (exact id-set match => LIVE_SET_DRIFT on add/delete; per-record fingerprint recheck incl
  GOVERNED => STALE_PRESTATE on change; build+validate all before staging any). MIGRATED envelope
  (v1/updatedAt-By/provenance MIGRATED/governanceInitialized*; preserve authentic createdAt/By only
  when both valid, never fabricated; drop legacy active). CLI execute requires --manifest-sha256
  (hash exact bytes before parse; zero writes on mismatch) + --acknowledge-production-write; verifier
  runs AFTER staging; evidence published ATOMICALLY only on pass (temp->secret-scan->rename, no dir on
  fail); verifiedManifestSha256 recorded. 38 tests (23+6 offline, 9 emulator). NO migration EXECUTION
  (dry-run tooling only, no production run).
- **I-LA4/I-LR MERGED** (PR #548, main 1b04441, 2026-08-03), INERT/unexported, 5 files:
  functions/src/warehouseGovernance/receivingLocationOptionsService.ts
  (listEligibleReceivingLocationOptions) + 2 tests + package.json + CI workflow. Ratified O-3: trusted
  backend service returns eligible Receiving WAREHOUSE options as {value,label,type:"WAREHOUSE"} DTOs;
  the Customer RawWarehouse mirror is SUPERSEDED for Receiving (no I-LA1b). Reads complete candidate set
  + authorization through ONE injected read-consistent txn seam; validateGovernedWarehouse(data,docId)
  per record => only governed status===ACTIVE become options; excludes missing/malformed/mismatched/
  legacy-active/partial/INACTIVE/unknown; label=trimmed name else warehouseId; deterministic sort
  (label,then id); dedupe; sanitized DTO allowlist. Fail closed: INVALID_REQUEST (no request fields) /
  PERMISSION_DENIED (unauthorized/invalid actor) / SOURCE_UNAVAILABLE (read failure); commit-time
  revocation cannot return options (txn-control errors propagate for SDK retry, sanitize only at outer
  boundary). Admin/dispatcher only via injected authorize seam (no client warehouse read broadened);
  PARTS_ASSOCIATE deferred to the receive grant gate; inventory.stock.receive NOT granted. 17 tests
  (13 offline + 4 emulator incl persona matrix + commit-time revocation).
- **I-LA5 MERGED** (PR #549, main 292c835, 2026-08-03), INERT/unexported, 7 files:
  functions/src/inventoryReceiving/receivingLocationResolver.ts (makeResolveWarehouseLocationActive +
  isSafeDocumentIdSegment) + receiveInventoryStockComposition.ts (buildReceiveInventoryStockDeps /
  receiveInventoryStockProduction / runReceiveInventoryStockSanitized) + receiveInventoryStockCommand.ts
  (added test-only __afterLocationReadHook) + 2 tests + package.json + CI. Concrete resolveLocationActive
  reads warehouses/{locationId} THROUGH the command's txn; true IFF type==WAREHOUSE ∧ locationId is a
  path-safe single doc-id segment (isSafeDocumentIdSegment: no "/", not "."/"..", not "__..__", <=1500B)
  ∧ doc exists ∧ validateGovernedWarehouse(data,locationId) ∧ status==ACTIVE; else false (no leak).
  Composition PINS the resolver (input type omits resolveLocationActive + hooks -> no arbitrary resolver);
  production entry runs through a sanitized boundary (governed ReceiveCommandError passes through; any raw
  Firestore/txn error -> ReceivingIntegrityError, no raw code/msg/path/retry leak). Concurrent
  ACTIVE->INACTIVE after the resolver read cannot commit (same-txn read conflicts). Tests prove fail-closed
  zero-writes (no receiving_orders doc, no inventory_transactions ledger event, reorder ORDERED, no audit)
  across concurrent/path-unsafe/INACTIVE/missing/non-WAREHOUSE. 36 tests (10 resolver offline + 8
  integration + 18 existing regression).
- **C2 I-LA CHAIN REPOSITORY-COMPLETE**: I-LA1a schema+validator -> I-LA2 writer -> I-LA3 migration+verifier
  -> I-LA4/I-LR option service -> I-LA5 resolver. ALL inert/unexported, nothing deployed.
- **E1 MERGED** (PR #551, main 0927642, 2026-08-03), repo-only, 9 files: index.ts now EXPORTS two trusted
  callables under exact frozen names `receiveInventoryStock` + `listReceivingLocationOptions` (v2 onCall;
  suffixed impl consts aliased, not exposed). functions/src/inventoryReceiving/receivingCallables.ts
  (handlers + exact request/response contracts + sanitized HttpsError matrix) + receivingCallableWiring.ts
  (real seams read THROUGH txn: resolveReceivePermissionThroughTxn via roleAssignments+users->
  resolveEffectivePermission(inventory.stock.receive, global)->ALLOW [UNGRANTED=deny all]; Part adapter
  partMasterRepository.getById + status->active/controlType->NONE; stageReceiveAuditEvent via
  auditEventWriter.stageAuditEvent) + composition sanitizer now passes governed ReceivingError (idempotency/
  stored->failed-precondition; raw txn->internal). Receive uses receiveInventoryStockProduction (pinned §3A
  resolver); options uses trusted backend service (no client warehouses read). Actor from request.auth.uid
  only. Exact {} options + one-line receive enforced pre-auth. EXPORT != DEPLOY/GRANT: not deployed, no
  grant, no Rules/index/firebase.json. 24 tests + regressions.
- **C2 I-LA chain + E1 all MERGED repo-only, NOTHING deployed/granted.** NEXT: (1) GRANT GATE (separately
  authorized: grant inventory.stock.receive to pinned personas), then (2) E2 (deploy Phase-D Rules + verify
  denial -> warehouse migration + verify -> targeted callable deploy -> backend verify -> Customer activation).
  Customer LF1b (readiness=false callable transport adapter over frozen E1 contracts) now unblocked. Standing
  boundaries still open: prod Rules lack repo Phase-D; inventory.stock.receive ungranted;
  inventory.warehouse.status.set unregistered/ungranted; Receiving callables EXPORTED but UNDEPLOYED/UNGRANTED
  (deny every user); all C2 I-LA modules inert; Customer LF1/LF2 runtime blocked; Truck ID 1 quarantined;
  created-in-error delete undeployed.
