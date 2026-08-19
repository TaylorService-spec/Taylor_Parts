# Operator Runbook — Warehouse Assignment Provisioning (X-WAREHOUSE-ASSIGNMENT-PROVISIONING)

**Standard:** follows [`../governance/audit-artifact-standard.md`](../governance/audit-artifact-standard.md),
[`../governance/execution-environments.md`](../governance/execution-environments.md), and
[`../governance/privileged-approval-classification.md`](../governance/privileged-approval-classification.md).
**Tooling:** `functions/scripts/warehouseAssignmentProvisioningCli.js` — self-contained (no compiled `lib/`
pair; see the file header for why), modeled on `functions/scripts/salesOrderNumberBackfillCli.js`'s
environment guard / dry-run-default / plan-hash-pinning / atomic-evidence discipline and
`functions/scripts/warehouseGovernanceMigrationCli.js`'s Owner-authored-manifest pattern.

> **This runbook authorizes nothing.** The tool described below is repository-complete and inert: importing
> it performs no Firestore read or write, and running `--execute` (or `--rollback`) against any real project
> is a **protected action** requiring separate, explicit Owner authorization naming the exact project and
> plan. The presence of a command template in this document never authorizes its execution.

---

## A. Purpose and scope

Several Firestore Rules predicates gate warehouse-scoped behaviour on `employees/{id}.assignedWarehouseIds`.
Two ACTIVE employees currently carry a warehouse-scoped operational role (`PARTS_MANAGER`, `PARTS_ASSOCIATE`)
with `assignedWarehouseIds: []` — see
[`../provisioning/warehouse-assignment-candidates-2026-08-18.md`](../provisioning/warehouse-assignment-candidates-2026-08-18.md)
for the exact live facts. This tool fills exactly that gap, for exactly those employees, once a human has
decided which warehouse each gets.

**What this tool is NOT:** it is not a general Employee-provisioning tool (that is
`functions/scripts/provisionEmployeeAccess.js`, which can also set `assignedWarehouseIds` as part of a
broader onboarding call, but has no dry-run/plan-hash/rollback discipline), not a reassignment tool (a
manifest entry naming an employee whose `assignedWarehouseIds` is already non-empty is refused, never
overwritten), and not a warehouse-creation or warehouse-status tool.

## B. Why Admin SDK, not a client write

`firestore.rules`'s `match /employees/{employeeId}` block ends `allow create, update, delete: if false;` —
**every** client principal, including admin/dispatcher, is denied write access to `employees` unconditionally.
There is no client write path for `assignedWarehouseIds` under any role. All writes in this tool run through
the Admin SDK, the same posture `functions/scripts/provisionEmployeeAccess.js` already documents and relies
on.

## C. Required properties (each pinned by a test in `functions/test/warehouseAssignmentProvisioningCli.test.mjs`)

| Property | How it holds |
|---|---|
| Environment fail-closed | `--environment sandbox` is required; the only accepted `--project` is the single sandbox id resolved from `config/environments.json`. The check runs inside `parseArgs`, before `buildProductionDeps()` (the only place `firebase-admin` is required) — proven by asserting `getApps().length === 0` after every rejected call. |
| Business decision never guessed | The manifest is **Owner-authored**, not computed. `validateManifestShape` requires a non-empty `rationale` on every entry; the committed template ships with `warehouseId: null` / `rationale: null` and is refused as-is. |
| Narrow scope | Only entries whose live `assignedWarehouseIds` is absent/empty are ever planned; any entry that is already non-empty is `refused` (`ALREADY_ASSIGNED_NON_EMPTY`), never touched. |
| Referential integrity | Every `warehouseId` must reference a live `warehouses/{id}` document with `status == "ACTIVE"`; a missing or inactive warehouse is `refused`, not silently skipped. |
| Dry-run capable, dry-run is the DEFAULT | No flag combination other than `--execute --acknowledge-production-write --plan --plan-sha256` can write. |
| Plan-hash pinned | `--execute` re-hashes the exact `plan.json` bytes and refuses on any mismatch with `--plan-sha256` — the same content-hash binding as the Sales Order backfill CLI. |
| All-or-nothing | A plan containing **any** `refused` entry is rejected wholesale at execute — no partial batch ever writes. |
| Stale-prestate safe | Execute re-reads every targeted employee live, recomputes its pre-state fingerprint, and fails the WHOLE batch closed on ANY drift (already assigned, vanished, `updateTime` moved) before staging a single write. |
| Precondition-guarded writes | Every write uses a Firestore `{lastUpdateTime}` precondition bound to the value read immediately before the batch commits — a concurrent write to the same document between verification and commit fails the whole batch. |
| Documented rollback | `--rollback --execution-result <path>` re-reads each employee, refuses if it drifted since the execution being reversed (`updateTime` no longer equals the post-execute value, or `assignedWarehouseIds` no longer equals what was set), and otherwise restores the pre-execute value under the SAME precondition discipline. |
| Atomic evidence | `plan.json`/`plan-report.md` (dry-run), `execution-result.json`/`execution-report.md` (execute), and `rollback-result.json`/`rollback-report.md` (rollback) are each published to a temp dir, secret-scanned, checksummed, and renamed into place only on success — a run directory only ever appears complete. |

## D. Preconditions (all runs)

1. Current repository checkout at the approved commit (record `git rev-parse HEAD` in the run notes).
2. The Owner has filled a COPY of
   [`../provisioning/warehouse-assignment-manifest.template.json`](../provisioning/warehouse-assignment-manifest.template.json)
   with a real `warehouseId` and `rationale` per entry (see the candidates doc referenced above) — the
   template itself is refused.
3. `cd functions && npm ci` (this CLI has no compiled `lib/` dependency, unlike the Sales Order backfill CLI —
   it is fully self-contained CommonJS).
4. Working tree free of uncommitted changes that could contaminate evidence.

## E. Command templates (NOT an authorization to run them)

Dry-run:
```
node functions/scripts/warehouseAssignmentProvisioningCli.js \
  --environment sandbox --project eos-platform-sandbox --confirm-project eos-platform-sandbox \
  --manifest <path-to-filled-manifest.json> \
  --commit <git-sha> --evidence-dir docs/evidence/warehouse-assignment/<run-id>/dry-run --operator <name>
```

Execute (requires a prior clean dry-run plan and separate Owner authorization naming the exact
`--plan-sha256`):
```
node functions/scripts/warehouseAssignmentProvisioningCli.js \
  --environment sandbox --project eos-platform-sandbox --confirm-project eos-platform-sandbox \
  --execute --acknowledge-production-write \
  --plan docs/evidence/warehouse-assignment/<run-id>/dry-run/plan.json --plan-sha256 <owner-reviewed-hash> \
  --commit <git-sha> --evidence-dir docs/evidence/warehouse-assignment/<run-id>/execute --operator <name>
```

Rollback (requires separate Owner authorization naming the exact execution to reverse):
```
node functions/scripts/warehouseAssignmentProvisioningCli.js \
  --environment sandbox --project eos-platform-sandbox --confirm-project eos-platform-sandbox \
  --rollback --acknowledge-production-write \
  --execution-result docs/evidence/warehouse-assignment/<run-id>/execute/execution-result.json \
  --commit <git-sha> --evidence-dir docs/evidence/warehouse-assignment/<run-id>/rollback --operator <name>
```

## F. `inventoryCreateExecutor` — separately gated, not covered by this runbook

The `inventoryCreateExecutor` grant is a DIFFERENT governed action (an execution-scoped Role assignment
through the deployed `assignApprovedRole` trusted-writer command, not an `employees` field write) and is
deliberately NOT part of this tool. Its own manifest-validation gate is
`functions/scripts/inventoryCreateExecutorGrantManifestCli.js` — see
[`../provisioning/inventoryCreateExecutor-grant-manifest.template.json`](../provisioning/inventoryCreateExecutor-grant-manifest.template.json).
Per Owner ruling, it stays unassigned until a named recipient and a stated business need are presented and
approved; that validator enforces exactly that, and touches no Firebase project at all.
