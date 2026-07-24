# Legacy Compatibility-Admin Bootstrap — one-time execution procedure

**Status:** governed technical migration (ADR-009 controlled exception). This document is the execution procedure only — running it is a separate, explicitly-authorized operator action. This PR does **not** execute it.

## What it does

Converts an existing **legacy** administrator — a principal with `users/{uid}.role === "admin"` (the pre-governed raw-role source of truth), an **enabled** Firebase Auth user, and the exact approved email — into a governed compatibility-`admin` `roleAssignment`, so the resolver grants `admin.roleAssignment.write` and the platform can operate entirely through the governed model thereafter.

It is the break-glass seam for the chicken-and-egg bootstrap: `grantRole`/`assignApprovedRole` require an *existing* governed admin (they resolve authority from `roleAssignments`, not `users.role`), so the **first** governed admin cannot be created by them.

## Authority & boundary

- Authority = (1) the existing legacy `users.role === "admin"` fact, (2) an enabled Auth user whose email exactly matches the approved binding, and (3) designated-technical-operator infrastructure access — **not** a governed grant.
- Migrates existing authority; grants nothing new. Does **not** weaken two-person approval for future privileged grants (those still route through `grantRole` with a distinct approver).
- Creates only a Firestore `roleAssignment`; never Firebase/Google Cloud IAM, never a manual document edit.
- Operator-run only via `functions/scripts/bootstrapCompatibilityAdmin.js`; **not** a deployed callable / client endpoint.

## Approved production binding (this migration)

| Field | Value |
|---|---|
| project | `taylor-parts` |
| target UID | `JBslDvmpq8RqQAiyzfvwne9yCWc2` |
| email (exact) | `fieldops@test.com` |
| source legacy role | `admin` (`users/{uid}.role`) |
| created roleAssignment role | `admin` (compatibility) |
| scope | global |
| approved commit | `d0dad859ca67fbcfc955c41f4713ec4467a7206c` |
| operator identity | the designated infrastructure operator (audit `actorUid`; **distinct** from the target UID) |

## Procedure (operator, Cloud Shell)

From a **clean working tree** at the approved commit:

```
git checkout d0dad859ca67fbcfc955c41f4713ec4467a7206c && git rev-parse HEAD   # must match
cd functions && npm ci && npm run build

# 1) DRY-RUN first (zero writes — validates enabled Auth user, exact email,
#    users.role=admin, and no conflicting active admin assignment):
node scripts/bootstrapCompatibilityAdmin.js \
  --project-id taylor-parts --confirm-project taylor-parts \
  --uid JBslDvmpq8RqQAiyzfvwne9yCWc2 --operator "<infra operator identity>" \
  --email fieldops@test.com --commit d0dad859ca67fbcfc955c41f4713ec4467a7206c

# 2) APPLY (single audited write) once the dry-run reports preconditions OK:
node scripts/bootstrapCompatibilityAdmin.js \
  --project-id taylor-parts --confirm-project taylor-parts \
  --uid JBslDvmpq8RqQAiyzfvwne9yCWc2 --operator "<infra operator identity>" \
  --email fieldops@test.com --commit d0dad859ca67fbcfc955c41f4713ec4467a7206c --apply
```

The script refuses `--apply` while `FIRESTORE_EMULATOR_HOST` is set (production only). It creates `roleAssignments/bootstrap-admin-<uid>` (roleId `admin`, scope global, `grantedBy: bootstrap:legacy-admin-migration`) plus exactly one applied `bootstrapCompatibilityAdmin` audit event whose `actorUid` is the operator and `targetId` is the migrated UID.

## Idempotency & safety

- Deterministic assignment id `bootstrap-admin-<uid>`: an existing **fully-equivalent** active bootstrap grant → `alreadyApplied` (no second `accessVersion` bump); any **non-equivalent** document at that id → **fails closed** with a denied audit.
- Use a fresh idempotency key per attempt (the script derives one from the timestamp) — a denied attempt burns only its own key.
- All refusals (unknown UID / disabled / wrong email / non-admin legacy role / conflicting active admin / non-equivalent deterministic doc) produce a **denied** audit and write no assignment and no version increment.

## Post-execution verification

- `roleAssignments/bootstrap-admin-<uid>` exists, active, roleId `admin`, scope global.
- The resolver grants `admin.roleAssignment.write` for the migrated UID.
- The applied audit event distinguishes operator (`actorUid`) from target (`targetId`) and records the provenance + project + commit (no email/PII).

## Next

Once the migrated admin resolves `admin.roleAssignment.write`, proceed to the INV-1 Rollback Export + temporary `inventoryCreateExecutor` assignment (via `assignApprovedRole`) → CREATE Execution.
