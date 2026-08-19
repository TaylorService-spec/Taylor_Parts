# Provisioning Manifests — Prepare-Only Evidence (2026-08-18)

## Bottom line

**Nothing was provisioned. No Firestore write was made. No deploy, grant, or Rules change occurred.** This
branch is repository-only tooling and documentation, built in an isolated worktree per the assigned
PREPARE-ONLY LANE boundary. Every write path added by this branch defaults to dry-run, requires an explicit
`--execute` (or `--rollback`) plus `--acknowledge-production-write` plus a content-hash-pinned plan/manifest,
and is gated behind a separate sandbox authorization this branch does not itself grant.

## 1. What was queried (read-only)

`eos-platform-sandbox` was queried read-only via the Admin SDK, through the repo's own Application Default
Credentials pattern (the same non-interactive ADC resolution already used by
`functions/scripts/operatorAccessCommand.js` / `onboardEmployeePreflight.js` / `productionFoundationVerification.js`
— `initializeApp({ projectId })` with no explicit credential). No credential value was printed, logged, or
stored anywhere in this branch. Full verified facts (employee ids, uids, `operationalRoles`,
`assignedWarehouseIds`, and every warehouse id/name/status) are recorded in
[`warehouse-assignment-candidates-2026-08-18.md`](./warehouse-assignment-candidates-2026-08-18.md).

Cross-referencing confirms the Owner's stated context: 8 `employees` documents, 8 `users` documents, 10 active
`roleAssignments` documents across 9 distinct `roleId`s, and exactly 3 employees (`sbx-partsassoc`,
`sbx-partsmgr`, `sbx-whmgr`) carry a non-empty `operationalRoles`. Of those three, only `sbx-whmgr`
(WAREHOUSE_MANAGER) has a non-empty `assignedWarehouseIds` (`["wh-main"]`); `sbx-partsmgr` (PARTS_MANAGER) and
`sbx-partsassoc` (PARTS_ASSOCIATE) both have `[]`.

## 2. `employees` write path — confirmed Admin-SDK-only

`firestore.rules`, `match /employees/{employeeId}` block:

```
allow read: if isAdminOrDispatcher()
  || (isSignedIn() && userData().employeeId == employeeId)
  || (isActiveOperationalRole("PARTS_MANAGER") && ... );
allow create, update, delete: if false;
```

`allow create, update, delete: if false` applies to **every** client principal, unconditionally — there is no
admin/dispatcher exception, unlike several other collections in the same file. This is confirmed directly by
reading the live rule, not inferred. Every write this branch's tooling performs (when later authorized to run)
goes through the Admin SDK, exactly like the existing `functions/scripts/provisionEmployeeAccess.js`.

## 3. Deliverables on this branch

| File | What it is |
|---|---|
| `functions/scripts/warehouseAssignmentProvisioningCli.js` | New operator CLI: dry-run (default) / `--execute` / `--rollback` for the two missing `assignedWarehouseIds` gaps. Environment-guarded to `--environment sandbox` only, resolved from `config/environments.json`, checked before `firebase-admin` is ever required. Plan-hash pinned, atomic evidence, `updateTime`-precondition writes and rollback. |
| `functions/test/warehouseAssignmentProvisioningCli.test.mjs` | 27 offline unit tests: every refusal path, manifest validation, dry-run/execute/rollback logic against injected fake deps. All pass (`27 passed, 0 failed`). |
| `docs/provisioning/warehouse-assignment-candidates-2026-08-18.md` | Verified live facts + the two missing assignments + the 4 ACTIVE warehouse candidates for each, presented WITHOUT a pick — see §4 below. |
| `docs/provisioning/warehouse-assignment-manifest.template.json` | The manifest template the CLI consumes. Committed with `warehouseId: null` / `rationale: null` on both entries — refused by `validateManifestShape` as-is. |
| `functions/scripts/inventoryCreateExecutorGrantManifestCli.js` | Pure local validator (no Firestore, no `firebase-admin` at all) enforcing that an `inventoryCreateExecutor` grant manifest names a real recipient (`employeeId` + `principalUid` + `displayName`), a real `businessNeed` (≥20 chars, not a placeholder like `TBD`/`TODO`/`REPLACE_ME`), an `approvedBy`, and an `authorizationReference`. |
| `functions/test/inventoryCreateExecutorGrantManifestCli.test.mjs` | 11 offline unit tests, including one that asserts the COMMITTED template is refused as-is. All pass (`11 passed, 0 failed`). |
| `docs/provisioning/inventoryCreateExecutor-grant-manifest.template.json` | The unfilled template — every required field is `null`. |
| `docs/operations/warehouse-assignment-provisioning-runbook.md` | Operator runbook: required properties, preconditions, and command templates (none of which are an authorization to run them). |

## 4. Open decision for the Owner — not made by this tooling

**Which warehouse each of `sbx-partsmgr` and `sbx-partsassoc` should get is a business decision the live data
does not make unambiguous.** Four `ACTIVE` warehouses exist (`wh-main`, `wh-north`, `wh-sandbox-central`,
`wh-sandbox-north`); nothing in either employee's record or any warehouse's record ties one to the other. Full
candidate evidence is in §3 of the candidates document. This branch does not guess — the manifest template
ships unfilled, and the tool's own validator refuses to accept it until a human fills in both `warehouseId`
and a `rationale` per entry.

**`inventoryCreateExecutor` stays unassigned.** No recipient or business need has been presented for it; the
manifest template's validator refuses the template as committed (proven by a test against the actual committed
file, not a synthetic stand-in).

## 5. Verification run (evidence this document itself is honest)

Both test suites were run directly (not through a pipeline) and their exit codes captured:

```
$ node test/warehouseAssignmentProvisioningCli.test.mjs ; echo $?
... 27 passed, 0 failed
0

$ node test/inventoryCreateExecutorGrantManifestCli.test.mjs ; echo $?
... 11 passed, 0 failed
0
```

Two live refusal checks were run as real subprocess invocations of the new CLI (not the in-process test
harness), confirming the environment guard fires with a non-zero exit and a specific rejection message before
any Firestore/Firebase call:

```
$ node scripts/warehouseAssignmentProvisioningCli.js --project taylor-parts --confirm-project taylor-parts \
    --environment production --commit c --evidence-dir /tmp/ev --operator test --manifest /tmp/m.json ; echo $?
Failed: --environment must be exactly "sandbox"; refusing 'production' ...
1

$ node scripts/warehouseAssignmentProvisioningCli.js --project taylor-parts --confirm-project taylor-parts \
    --environment sandbox --commit c --evidence-dir /tmp/ev --operator test --manifest /tmp/m.json ; echo $?
Failed: --environment sandbox only accepts --project 'eos-platform-sandbox'; refusing 'taylor-parts' ...
1

$ node scripts/inventoryCreateExecutorGrantManifestCli.js \
    --manifest docs/provisioning/inventoryCreateExecutor-grant-manifest.template.json ; echo $?
REFUSED: manifest.recipient.employeeId is required and must not be null/blank/a placeholder ...
1
```

Note on how these were run: this worktree does not carry `functions/node_modules` (a pre-existing, unrelated
condition of the worktree, not something this branch changed). Verification used `firebase-admin` from a
sibling checkout via `NODE_PATH`, and, for the ESM test file (Node's ESM resolver does not honor `NODE_PATH`),
by running the identical committed file content from that sibling checkout's `functions/` directory, then
deleting the temporary copies immediately after. No source file differs between what was tested and what is
committed on this branch.

## 6. Explicitly NOT done on this branch

- No `--execute` or `--rollback` was ever run against `eos-platform-sandbox` or any other project.
- No `employees`, `warehouses`, `roleAssignments`, or any other Firestore document was written, updated, or
  deleted.
- No Cloud Function was deployed. No Firestore Rules were changed or deployed.
- No manifest was filled in on the Owner's behalf — both templates remain unfilled as committed.
- `docs/DECISIONS.md` was not touched (owned elsewhere, per the assigned boundary).
