# Retrospective Equivalence Findings: Firebase Retirement F2, F4, F3a, F3b and `recordPutAway`

Audited 2026-10-11 at main `acc65f2e`, under the Owner directive "Firebase retirement is a
business-functionality migration, not simply code deletion".

These are **historical findings**, not approvals. The gate that enforces future retirements is
specified separately in
[`docs/architecture/firebase-capability-equivalence-gate.md`](../../architecture/firebase-capability-equivalence-gate.md).
Its machine-readable records are in `docs/architecture/firebase-capability-equivalence.json`. Both
arrive in the guard PR.

Companion documents:

- [Business Capability Matrix](../../architecture/firebase-retirement-capability-matrix.md)
- [Employee Accessibility Verification](employee-accessibility.md)
- [Remaining Retirement Roadmap](../../architecture/firebase-retirement-roadmap.md)

## Method

For every retired export, the audit established the 15 points the directive lists:

1. purpose
2. users
3. original UI
4. inputs and outputs
5. rules
6. authorization
7. ownership
8. audit
9. persistence
10. EOS replacement
11. current UI
12. dependencies
13. PostgreSQL tests
14. end-to-end evidence
15. gaps

Each export was then scored on gates A–E and audit.

- **Static evidence** came from the deleted sources (`git show <commit>^:…`), the current tree and the
  frontend history (`git log -S`).
- **PostgreSQL evidence was executed, not just cited.** These suites ran against a real local
  PostgreSQL 16, one at a time, on 2026-10-11. All passed: **10 suites, 141 tests, 0 failures**.

  | Suite | Tests |
  |---|---|
  | `eosBinPlacementPostgres` | 8/8 |
  | `inventoryWarehouseJourneyPostgres` | 11/11 |
  | `workOrderLaborPostgres` | 14/14 |
  | `serviceTechnicianJourneyPostgres` | 11/11 |
  | `catalogPartAliasPostgres` | 22/22 |
  | `catalogReadAuthorizationPostgres` | 9/9 |
  | `catalogCutoverPostgres` | 32/32 |
  | `supplierAdministrationPostgres` | 7/7 |
  | `supplierCatalogPostgres` | 20/20 |
  | `workOrderFieldContextPostgres` | 7/7 |

- **No live UI or live persona run was performed by this audit.** None was found recorded in the
  repository for any of the 22 operations. `docs/financials/UAT_FIN_BILLING_PACKAGE.md` is a write-up
  of the PostgreSQL and client test suites. It is not a run against a deployed environment, so it
  counts as `doc` evidence, not live UAT. **Gate B is therefore not VERIFIED for any historical
  retirement.** That is the directive's own rule: "If live UI testing is unavailable, classify that
  gate as unverified."

## Results

| | Count |
|---|---|
| Retired operations audited | **22** |
| REPLACED (verified) | **0** |
| SUPERSEDED (verified) | **0** |
| UNVERIFIED (a replacement exists; evidence incomplete) | **6** |
| GAP | **16** |

_Update (CAT-1, #2059): `createPart` and `updatePart` moved GAP → UNVERIFIED once the client defect was fixed and
proven against the real server (now 8 UNVERIFIED / 14 GAP). The manifest is authoritative._

Four operations with an unruled material behaviour change (`recordWorkOrderLabor`, `getWorkOrderLabor`,
`probePartAlias`, `resolveScannedPartIdentifier`) are classified **GAP**, not UNVERIFIED. Under the
gate, a material change without an Owner decision is a gap until the Owner rules (adversarial review of
#2057, finding N8).

Of the 6 UNVERIFIED, these are a single gate away from their candidate disposition:

- `recordPutAway` is `REPLACED` except for gate B (live proof).
- `lookupScannedPart` is `REPLACED` except for gate B.
- `createSupplier`, `activateSupplier` and `deactivateSupplier` are `SUPERSEDED` under DECISIONS #196,
  except for gate B and denial-audit parity.

**Did F2/F4/F3a/F3b themselves remove a working capability?** No.

- Every retired callable was already inert when it was removed. The Firestore catalog writer had been
  FROZEN since 2026-09-28 (`catalogWriterState.ts:53`), so the supplier, part and alias callables
  could only refuse.
- The labor callables were registered `active: false` and held by no Role.
- Each client had already been cut over to EOS before its retirement: `6228d9bb` (2026-09-20) for
  catalog and `3e10ba85` for labor.

**But the EOS replacements they relied on have real gaps.** The capability was lost or degraded at
the freeze or the client cutover, not at the deletion. Several gaps are invisible to CI, because the
UI tests mock the retired callable shapes.

## Findings

Severity is the effect on an employee doing the business activity in the one environment where the
path is enabled (platform-sandbox). Production has neither path for these operations, as before.

### P1, business capability broken in the UI

**CAT-1. Part Master writes report success as failure.**
- `field-ops-app-vite/src/domain/partMasterWrite.js:114-120`, `outcomeFromResult`, requires
  `result.outcome === "applied" | "replayed"`.
- The EOS writer returns `{partId, version}` (`postgresPartMasterWriter.ts:110, 166, 221`), and the
  client passes it through unchanged (`partMasterCommandClient.js:37`).
- Every successful create, edit or status change shows "The request could not be completed." The
  reload is skipped. The data is written exactly once.
- `outcomeFromError` is keyed on Firebase codes, so `FORBIDDEN`, `CONFLICT`, `PRECONDITION_FAILED`,
  `INVALID_INPUT` and `NOT_FOUND` all render as a generic error.
- Affects `createPart`, `updatePart` and `changePartStatus`.
- Hidden from CI because `partWriteModal.test.jsx` and `partMasterWrite.test.mjs` mock
  `{outcome: "applied"}`.

**CAT-2. The Part identifier (alias) list is always empty.**
- `usePartIdentifiers.js:69` reads `result.aliases`, and `PartIdentifiersSection.jsx:193, 238` reads
  `alias.value`.
- PostgreSQL `listPartAliases` returns a bare array with `originalValue`
  (`postgresPartAliasWriter.ts:368-375`).
- Every Part shows no identifiers, so **Deactivate and Reactivate are unreachable** from any screen.
- Hidden from CI because `partIdentifiersSection.test.jsx` mocks the retired shape.

**SUP-1. Part-supplier terms cannot be maintained.**
- `createPartSupplierItem`, `updatePartSupplierItem`, `changePartSupplierItemStatus` and
  `setPreferredSupplier` have only repository functions in `eosOps/supplierCatalogRepository.ts`.
- Those functions have no governed command, no capability check (the header says "NO
  AUTHORIZATION"), no audit, no route, no screen and no runtime consumer.
- There is no PostgreSQL equivalent at all for updating item terms.
- The F2 commit message pointed at a repository, not at an employee operation.

### P2, authority or access gap

**CAT-3. Nobody in the business can activate a Part.**
- `inventory.catalog.activate` is held only by `admin`, through the sample-company seed
  (`roleCapabilityAuthorityBaseline.json`; census `DECISIONS.md:7599-7601`).
- The designed holder, `inventoryCatalogAdministrator` (`governedBusinessRoles.ts:1365`), has no
  PostgreSQL grant.
- Parts created by Parts, Service or Warehouse Managers stay DRAFT, and reorder, bin placement and
  cycle count all require ACTIVE.
- The same key gates supplier status, so supplier deactivation is admin-only in practice.
- This can be fixed through Administration (a Roles & Permissions grant) without code, but it is an
  Owner/Administrator decision.

**SUP-2. Suppliers cannot be maintained after creation.**
- `updateSupplierFields` (`partsOperationsReads.js:48`) is imported by nothing.
- Phone, address, payment terms and notes cannot be entered from any screen.
- A supplier cannot be renamed. The name is authored from CRM (#196) and nothing re-syncs it.

**WOL-1. Labor correction has no UI.**
- `correctWorkOrderLabor` works server-side, held by fieldManager under ruling D.
- There is no client function and no screen (`docs/architecture/technician-offline-runtime.md`).
- It never had a UI, so this predates F4.

**WOL-2. Offline labor can double-count or collapse.**
- The online send key `lab_…_{attemptToken}` (`technicianLaborEntry.js:83-87`) differs from the queued
  key `int_{hash}` (`technicianIntentCapture.js:67-98`). If a commit's response is lost, sync records
  a second entry.
- Separately, the queue intent id `labor:{date}:{type}:{minutes}` (`JobLabor.jsx:105`) collapses two
  genuine identical entries made on one day.
- Both predate F4.

**PA-1. Parts Associate put-away is undecided.**
- The Firebase-era scanner harness used `partsAssociate`, and EOS now refuses that persona
  `CAPABILITY_MISSING`.
- `docs/testing/persona-object-workflow-access-matrix.md:412` marks `inventoryPutAwayOperator` as
  COMPOSE_BY_DEFAULT into partsAssociate, but no ruling applies it.
- **Owner decision needed. This audit does not widen authority.**

### P3, behaviour changed without a recorded Owner decision

The SUPERSEDED dispositions need the Owner. None is recorded in DECISIONS.

**ALS-1. `resolveScannedPartIdentifier` was replaced by the alias half of `lookupScannedPart`.**
1. A blank or oversize scan is now `INVALID_INPUT`; it used to return `MALFORMED`.
2. The `manufacturerId` / `MANUFACTURER_PN` scan path is gone.
3. The gate is now `catalog.read` AND `alias.read`; it used to be `alias.read` alone.
4. The response is wrapped.

No persona or UI regressed, because no UI ever passed `manufacturerId`, and every holder has both keys.

**WOL-3. Labor record changed in three ways:**
- no `audit_events` row, where Firebase staged one;
- the subject is the Employee, not `technicianId`;
- the record authority is now `workOrder.execution.record`.

**WOL-4. Labor read authority widened.**
- It used to be record/correct holders only. It is now every `workOrder.record.read` holder: admin,
  dispatcher, fieldManager, GM, operationsManager, owner, partsAssociate, partsManager,
  shopAssociate and shopManager.
- The code calls it "the governed answer" (`workOrderLabor.ts:36-38`), but there is no ruling.

**ALS-2. The alias read gate narrowed.**
- `listPartAliases` and `probePartAlias` now need `catalog.read` AND `manage`; they used to need
  `manage` alone.
- operationsManager and inventoryCreateExecutor hold manage but not read, so they lose the list.

**SUP-3. Supplier status changes are attributed to the system, not the employee.**
- The status reason is now mandatory (#196), but the UI sends a hard-coded
  "deactivated in Supplier administration".

**CAT-4. Idempotency moved from key-addressed to content-addressed** across the catalog. An identical
resend replays, and the same-key/different-request conflict no longer exists.

### Audit parity

**AUD-1. Authorization denials are not audited.** This is the separate finding the directive asks
for; its full detail is below.

**AUD-2. The labor writers write no audit row.** That covers record and correct. Firebase audited
both.

**AUD-3. The part-supplier item repository writes no audit row.** This is part of SUP-1.

### Stale or dead material (no behaviour)

- **Dead code still naming retired callables:**
  - `recordPutAwayCallable`, unexported, at `binCallables.ts:246`;
  - `partAliasCallableClient.resolveScannedIdentifier`, which names the retired operation.
- **Stale ledger and metadata:**
  - `catalogWriterState.ts:220` still lists `partAliasCallableClient.js` as reaching the frozen
    Firestore writer.
  - In `part.js`, `readModel`, the representation and `blockedBy` still describe Firestore
    authority.
  - The `catalogMasterKernel.ts:19-20` header says "NOT WIRED".
  - `workOrderFieldParityMatrix.ts:283` still names the Firebase labor command.

## Put-away scenarios 6/7: resolution

`scripts/runSandboxScannerScenarios.mjs` scenario 6 (put-away recorded, wrong-warehouse bin, unknown
bin, replay), scenario 7 (pick/stage) and the technician refusal in scenario 12 still call the
**retired Firebase `recordPutAway`** through `callAs`.

- **Do not run them as they are.** If the deployed sandbox copy still answers, they write Firestore
  `bin_placements`, a frozen, retired authority. That would be a split-write hazard.
- **The EOS put-away workflow is functional.**
  - Route: `POST /operations/placement` `recordPutAway`, with stock-moving put-away through
    `POST /operations/relocation` `relocateStock` + `recordPlacement`.
  - Proven by the executed `eosBinPlacementPostgres` (8/8) and `inventoryWarehouseJourneyPostgres`
    test B (11/11).
  - The screens (`PutAwayScan`, `PickScan`) already call EOS with no Firebase fallback.
  - The only missing proof is a live persona run.
- **Recommendation: migrate scenarios 6, 7 and the scenario-12 put-away refusal to EOS. Do not retire
  them.** Retiring them would leave no live coverage of put-away at all.
  - Route the calls through a `placement:` / `inventory:` prefix in `scripts/sandboxScannerScenarios.mjs`
    to `${envEntry.eosApi.baseUrl}/operations/placement`. The platform-sandbox `eosApi.baseUrl` is the
    nonprod EOS API.
  - Map EOS HTTP statuses into the harness's gate/validation vocabulary. The catalog mapping returns
    raw codes, which would misread `BIN_NOT_FOUND` as "callable missing", so it can't be reused.
  - Persona: `warehouseAssociate`, unless the Owner rules PA-1 the other way.
  - Warehouse: `taylor-main`.
  - Bins: existing ACTIVE bins from `inventory:listInventoryLocations`. Do not use the Firebase
    `createBin`.
  - Replace the `getPartBalance` invariance check, which reads the frozen Firestore ledger, with
    `inventory:readInventoryOnHand`.
  - The migrated scenarios mutate nonprod data, so running them is an operator action that needs
    authorization.
  - This migration is a separate change and is **not** in the guard PR.
- **The F3b sandbox-refresh safeguard is preserved and re-verified.**
  - No retired name is in any `--force` named deploy batch. `scripts/sandboxDeployableFunctions.test.mjs`
    still pins this.
  - `recordPutAway` stays only in the read-only `SCANNER_CALLABLES` presence check. Drop it from that
    list at the bounded deletion window.
- **Wider stale harness calls.** The same harness also calls other callables retired in `5d6a84ac`:
  - `getAvailableEquipment` and `getLocationDisplay`;
  - the transfer and cycle-count callables;
  - `listMyReceivableTransfers`.

  `scripts/runSandboxBinMoveScenarios.mjs` calls the retired `relocateStock` callable. These are
  listed in the roadmap.

## AUD-1: catalog authorization denials are refused but not audited (separate finding)

| | |
|---|---|
| Scope | `catalogMasterKernel.runCatalogCommand` throws `CAPABILITY_REQUIRED` / `ACTOR_CONTEXT_REQUIRED` before `BEGIN` (`:131-139`). It rolls back `ACTOR_NOT_TENANT_MEMBER` (`:150`). It writes audit rows on success only (`:152-159`). Catalog read refusals (`catalogHttp.ts:196-205`) and the silent `aliasDenied` partial answer are not recorded either. **It is EOS-wide, not a catalog outlier.** Supplier administration (`supplierAdministration.ts:45-47`), workforce (`employeeCommandKernel.ts:86-110`), adminPolicy (`adminPolicyApi.ts:584-587, 1304-1308`), eosOps and CRM all refuse without auditing. No EOS/PostgreSQL code writes a denial row. |
| Evaluation against governed audit policy | The only written rule requiring audited denials is the Firestore-era enterprise-access specification (§5.8, outcome `applied \| denied`; §14), implemented by `requireCapabilityOrAudit` → `recordStandaloneAuditEvent` (`partMasterCommands.ts:131-152`) and `trustedWriterCommands.ts:549`. No PostgreSQL-era decision requires it or waives it. `eos_policy.audit_events` has no outcome column (migration `1757462400000:347-358`). This is therefore a **parity regression against the last written policy**, not a breach of an accepted PostgreSQL ruling. |
| Other logging | None. The caller receives the 403 JSON. There is no server access log, denial counter or metric (`eosApi/server.ts`). |
| Impact | Attempted unauthorized writes, reads and non-member access cannot be reconstructed from `audit_events`. The same blind spot covers role-grant and employee-change denials, which is evidence segregation-of-duties reviews rely on. Enforcement itself is correct and fails closed; tests prove no domain row is left behind. |
| Severity | LOW for the catalog in nonprod (forensic only, SAMPLE data). **MEDIUM as an EOS-wide item** to close before production or any compliance claim. |
| Proposed correction (not implemented) | A shared EOS helper. After rollback it makes one best-effort standalone insert with action `<domain>.<object>.<verb>.denied`. `after = {operation, requiredCapability, refusalCode}`; the request payload is never recorded. The id is deterministic per (tenant, principal, action, code, minute) with `ON CONFLICT DO NOTHING`, which bounds volume because the table is append-only. It applies only to resolved principals, and an audit failure never changes the 403. Tests: a kernel unit test, PostgreSQL rows per refusal, dedupe, non-member, read denial, insert failure still 403, and no payload text. |
| **Owner decision required** | **Either adopt "authorization denials are audited, rate-bounded" as an EOS-wide rule (to be implemented under separate authorization), or formally waive denial auditing for the EOS/PostgreSQL era in DECISIONS.** Until then the catalog, supplier and alias records carry `audit: PARTIAL`, and none of them can be `REPLACED`. |

## Owner decisions this audit surfaces

1. **AUD-1:** adopt or waive denial auditing EOS-wide.
2. **ALS-1:** accept, or reject, the `resolveScannedPartIdentifier` supersession and its four
   behaviour changes.
3. **WOL-3 / WOL-4 / AUD-2:** accept the labor audit, identity and authority changes, and the widened
   labor read.
4. **PA-1:** should Parts Associates hold put-away (`inventoryPutAwayOperator`)?
5. **CAT-3:** who holds `inventory.catalog.activate` (designed: `inventoryCatalogAdministrator`)? This
   is granted through Administration.
6. **SUP-1:** build governed part-supplier term maintenance, or formally defer that capability.
7. **SUP-2 / SUP-3:** supplier maintenance UI, supplier rename/CRM re-sync, and an employee-entered
   status reason.

Items CAT-1, CAT-2, WOL-2 and the error/replay mapping are **defects with an obvious correct
behaviour**. They need remediation PRs, not rulings. None was fixed under this workstream.
