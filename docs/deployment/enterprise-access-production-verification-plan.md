---
artifact_type: verification-plan
gate: Row 21 -- Production Foundation Verification
status: Tooling merged via PR #315 (commit 549a7a5271df09acca8cdf3c219710a3df42e79f) and verified against the emulator -- NOT yet run against production; depends on Row 20 (deployment)
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/specifications/enterprise-access-and-administration-platform.md, docs/deployment/enterprise-access-deployment-manifest.md]
implements: [docs/implementation-plans/enterprise-access-and-administration-platform.md]
supersedes: []
superseded_by: []
related_pr: []
target_release: TBD
---

# Enterprise Access Production Foundation Verification Plan

**Row 21 (Task 26) preparation.** This document explains how and when to run `functions/scripts/productionFoundationVerification.js` -- built and tested against the Firestore+Auth emulator now, ready to run against the real deployed project once Row 20 (deployment) happens. **This document does not itself perform any verification against production, deploy anything, or authorize anything.**

## When to run this

Only after Row 20 (Task 25, "Deploy trusted backend") has actually deployed the six callable Functions named in `docs/deployment/enterprise-access-deployment-manifest.md` Section B, and only under the Owner's own go-ahead for this specific step (Issue #263's stop condition). Running it before deployment will simply show every `functionsDeployed`/`unauthenticatedRejection` check failing (network-unreachable), which is itself a correct, honest failure -- not a bug.

## What it checks (Spec sec21)

| Criterion | What the script does | Fixture-safe? |
|---|---|---|
| S1 (fail-closed) | Calls the real `grantRole` command with an actor who has no `roleAssignments` doc at all, and separately with one whose `accessVersionAtGrant` is impossible/stale -- both must be denied (`UnauthorizedActorError`). | Yes -- dedicated `verify-`-prefixed actor/principal uids, deleted after. |
| S3 (claims shape) | Performs one real `grantRole` call, then reads the granted principal's Auth custom claims and asserts the key set is a subset of `{accessVersion, companyId, platformAdmin, companyAdmin}` -- never a detailed permission/Scope/Condition. | Yes -- dedicated principal, deleted after. |
| S4 (separation-of-duty) | Attempts a self-granted privileged (`admin`) Role (must fail via `SelfApprovalError`) and a privileged grant with a non-privileged named approver (must fail via `InsufficientApproverAuthorityError`). | Yes -- dedicated actor/approver/principal, deleted after. |
| S5 (Audit immutability + secret-free) | Attempts a client-direct write to an Audit Event the verification run itself just created (must be denied by `firestore.rules`); scans that event's JSON for token/API-key-shaped substrings. | The Audit Event itself is **never deleted** -- see "Why Audit Events are not cleaned up" below. |
| V1 (deployed + authenticated) | Confirms all six function names appear in `firebase functions:list --project <id>`; makes a raw, unauthenticated HTTPS POST to each function's public Cloud Run URL and confirms it is rejected (no Authorization header, no `request.auth` possible). | Read-only network checks; no fixtures created for this criterion. |

**The Rules Regression suite (`node scripts/rulesRegressionRunner.mjs`) is deliberately NOT invoked by this script.** That runner starts and owns its own emulator instance for its run's duration, which would collide with the live Firestore+Auth emulator this script's own S1/S3/S4/S5 checks are already connected to -- the exact cross-process emulator collision this session hit once already with an unrelated PR. Run it as a fully separate step, either immediately before or after `productionFoundationVerification.js`, never concurrently with it.

Criteria not re-checked by this script because they are already exhaustively proven at the unit/parity level and do not change with deployment: A1/A2/A3 (`resolveEffectivePermission.test.mjs`, `permissionCatalog.test.mjs`), P1-P3 (`shadowParityHarness.test.mjs`, 100% parity per `docs/reviews/enterprise-access-parity-review.md`), S2 (proven structurally -- `operationalRole` is never a Permission id in the catalog, `permissionCatalog.test.mjs`).

## Why Audit Events are not cleaned up

Spec sec14/S5 requires Audit Events to be append-only and immutable. A verification run's own Audit Events are real, correctly-recorded events describing exactly what happened (a dedicated test principal was granted a Role, denied a self-elevation, etc.) -- deleting them after the fact would be the verification tooling violating the exact guarantee it exists to prove. Instead, every verification-run Audit Event's `actorUid`/`targetId` carries the `verify-<timestamp>-<random>` prefix, making it trivially identifiable and filterable out of any real audit review without ever requiring a mutation of audit history.

## How to run it

**Dry run (safe, no fixtures created, always safe to run):**
```
cd functions
node scripts/productionFoundationVerification.js \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --ownerAuthorization "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE"
```
This only checks `functionsDeployed` and `unauthenticatedRejection` (network-observable, read-only) and prints a note that S1/S3/S4/S5 were skipped.

**Full run (creates and cleans up dedicated fixtures):**
```
node scripts/productionFoundationVerification.js \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --ownerAuthorization "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE" \
  --execute
```
Exits 0 only if every criterion's `pass` is `true`. A result record is written to `.production-verification-results/<runId>.json` (mode `0o600`) regardless of outcome, including on a thrown error -- the write-ahead/recovery pattern already established by `operatorAccessCommand.js`.

## Evidence to collect for the Owner

After a full run: the printed JSON findings object (or the saved result file), confirming every criterion's `pass: true`; the Rules Regression suite's own pass count from its own, separately-run invocation (365+ expected, matching `docs/reviews/enterprise-access-consolidated-review.md`'s last recorded total, adjusted for any Rules changes merged since); and confirmation (from the script's own cleanup, which is unconditional) that no `verify-`-prefixed Auth user or `roleAssignments` document remains after the run except the immutable Audit Events by design.

## Rollback if verification fails

A failed verification (any criterion `pass: false`) is itself the signal to invoke Section B's Functions rollback in `docs/deployment/enterprise-access-deployment-manifest.md` -- `firebase functions:delete` the six names -- before any further production authorization (Row 22+) proceeds. The script's own fail-closed cleanup (`finally` block) ensures a failed run never leaves dedicated fixtures behind to confuse a retry.

## Local (emulator) test evidence for this plan

Before this plan is used against production, `functions/scripts/productionFoundationVerification.js` must be exercised against the Firestore+Auth emulator (not the Functions emulator, since `checkUnauthenticatedRejection`/`checkFunctionsDeployed` are inherently only meaningful against a real deployed project -- those two checks are expected to report `unreachable`/absent in an emulator-only run, which is correct and does not indicate a defect in the script). The S1/S3/S4/S5 fixture-based checks exercise the real `trustedWriterCommands.ts` functions against live Firestore+Auth and must show `pass: true` for each before this PR merges -- per PR #315's (commit `549a7a5271df09acca8cdf3c219710a3df42e79f`) recorded test plan and the session's own live emulator run at merge time: `s1FailClosedMissing`, `s1FailClosedStale`, `s4SelfElevation`, `s4NonPrivilegedApprover`, `s3ClaimsShape`, `s5AuditImmutable`, and `s5AuditSecretFree` all `pass: true`, exit code 0. (This run's raw JSON output is not separately archived as a PR artifact; it is recorded here and in the merging session's own transcript.)
