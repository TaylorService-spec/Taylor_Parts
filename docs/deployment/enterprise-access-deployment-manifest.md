---
artifact_type: deployment-manifest
gate: Deployment Candidate
status: Candidate prepared -- NOT deployed; Owner production authorization (Row 19) still required
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md, docs/architecture/ADR-002-work-order-engine.md]
depends_on: [docs/implementation-plans/enterprise-access-and-administration-platform.md, docs/reviews/enterprise-access-consolidated-review.md]
implements: []
supersedes: []
superseded_by: []
related_pr: []
target_release: TBD
---

# Enterprise Access Deployment Manifest

**Prepared per the Owner's "ROW 19 HELD FOR DEPLOYMENT-CANDIDATE CORRECTION" response (2026-07-15).** This document is the exact deployment manifest the Owner requested, split into two sections: Section A documents the pre-existing, separately-tracked Issue #15 (Work Order Engine) surface for reconciliation purposes; Section B is the new Enterprise Access candidate this PR provides.

**This document authorizes no deployment.** Nothing in it has been deployed, no production credentials were used to produce it, no claims were bootstrapped, and no Rules/indexes/Functions were pushed to any live project. It exists so the Owner's actual Row 19 authorization -- when issued -- can name an exact, already-reviewed surface instead of "current main."

## Section A: Issue #15 prerequisite deployment (Work Order Engine v1.2)

Issue #15 ("Deploy Epic 1 Work Order Engine backend (firestore rules + functions)") is OPEN and pre-dates Issue #226; it is documented here only for sequencing reconciliation, not implemented or advanced by this PR.

**Exact Functions** (all `onCall({ region: "us-central1" }, ...)`, `functions/src/index.ts:8-10`):

| Function | File | Purpose |
|---|---|---|
| `createWorkOrder` | `functions/src/createWorkOrder.ts` | Admin/dispatcher-only; allocates a Work Order number and creates a `fieldops_wos` doc. |
| `transitionWorkOrder` | `functions/src/transitionWorkOrder.ts` | Action-based lifecycle transition on a `fieldops_wos` doc, role/ownership-gated via `transitionEngine.ts`. |
| `updateWorkOrderExecutionData` | `functions/src/updateWorkOrderExecutionData.ts` | Technician-only narrow write path for field execution capture. |

**Exact Rules surface** (`firestore.rules:326-341`, plus the `inventory_sync_status` block at `firestore.rules:363-366`):

```
match /fieldops_wos/{woId} {
  allow read: if isAdminOrDispatcher()
    || (isTechnician() && isOwnTechnician(resource.data.assignedTechId));
  allow create, update, delete: if false;
}

match /counters/{counterId} {
  allow read: if false;
  allow create, update, delete: if false;
}

match /inventory_sync_status/{workOrderId} {
  allow read: if false;
  allow create, update, delete: if false;
}
```

**Indexes:** `firestore.indexes.json` already defines two `fieldops_wos` composite indexes (`customerId ASC, createdAt DESC` and `customerId ASC, status ASC`). Neither is required by the three functions above (every query they issue is a direct document-id lookup); they appear to serve a UI query elsewhere and are not a new requirement introduced by this deployment.

**Rollback target:** No formal rollback runbook exists for this surface today (`docs/Deployment.md` and `docs/architecture/ADR-002-work-order-engine.md` do not document one). The standard, available rollback is: `firebase deploy --only firestore:rules` with the prior ruleset restored from Firebase Console's rules history (or the last-known-good commit checked out locally), and `firebase functions:delete createWorkOrder transitionWorkOrder updateWorkOrderExecutionData --region us-central1` (or redeploy the prior version) if a regression is found. This gap is flagged for the Owner's awareness, not filled by invention here -- Issue #15 remains the owning issue for closing it.

**Live verification:** per Issue #15's own body -- confirm the deployed ruleset includes the `fieldops_wos`/`counters` blocks (Admin SDK read, not console inspection alone), confirm all three functions appear in `firebase functions:list`, and smoke-test one real `createWorkOrder` call followed by a `fieldops_wos` read.

## Section B: Enterprise Access deployment (this PR's candidate)

**Exact six callable Functions** (all `onCall({ region: "us-central1" }, ...)`, `functions/src/access/accessCommandCallables.ts`, exported from `functions/src/index.ts`):

`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`

Each is a thin adapter over the already-independently-reviewed `functions/src/access/trustedWriterCommands.ts` (Row 7, 4 review rounds). The adapter itself adds exactly three properties, verified by `functions/test/accessCommandCallables.test.js` (13/13 passing against live Firestore+Auth emulators): `actorUid` is derived exclusively from `request.auth.uid` (never from client-supplied data -- verified by an explicit test asserting a client-supplied `actorUid` field is silently ignored); every command error is mapped to a safe, public `HttpsError` that never exposes internal Firestore paths or resolver reason codes; an unauthenticated call is rejected before any command logic runs.

**Rules:** `none`. The Admin SDK -- which every one of these six functions uses exclusively -- always bypasses Firestore Security Rules; no Rules deployment is required for these functions to operate correctly regardless of the current state of the five governed collections' client-facing Rules. (Whether/when those collections' Row 3 deny-all client Rules, already merged to `main` via PR #276, get deployed to production is a separate decision belonging to the broader Rules-deployment reconciliation Issue #15 already surfaces -- not a requirement of this Section B candidate.)

**Indexes:** `none`. Every Firestore query these six functions issue is either a direct document-id `.get()` or a two-field equality-only `.where()` (documented in `trustedWriterCommands.ts`'s own header comment, unchanged by this PR) -- both servable without any composite index.

**Claims bootstrap:** the exact, already-reviewed, Owner-authorized operator procedure (`functions/scripts/operatorAccessCommand.js`, Row 8/PR #294) -- not executed by this PR, documented here for the Owner's eventual use:

```
node scripts/operatorAccessCommand.js \
  --projectId taylor-parts --confirmProduction taylor-parts \
  --ownerAuthorization "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE" \
  --command grantRole \
  --actorUid <the-owner-or-first-operator-uid> \
  --principalUid <the-uid-being-granted-admin> \
  --roleId admin --scopeType global \
  --idempotencyKey <a-fresh-8-200-char-deterministic-key>
  # dry-run by default -- inspect the printed plan, then re-run with --execute to apply
```

- **Inputs:** a real Auth uid to grant `admin` to (the first bootstrap principal), a fresh caller-chosen `idempotencyKey`, the exact `--ownerAuthorization` phrase above (typo-exact match required), and `--confirmProduction taylor-parts` (required specifically because `--projectId` targets the live project).
- **Expected result:** a dry run prints the planned mutation and exits without writing; `--execute` performs the real `grantRole` transaction (creates a `roleAssignments` doc, bumps the principal's `accessVersion`, writes one immutable `auditEvents` doc, and syncs the `accessVersion` custom claim on the principal's Auth user) and prints `OK: grantRole -> {...}` with the resulting `CommandOutcome`.
- **Verification:** `firebase auth:export` or an Admin SDK `getUser(uid).customClaims` check confirms `accessVersion` is set; the `roleAssignments` and `auditEvents` docs are inspectable via the Firebase Console or an Admin SDK read.
- **Cleanup/rollback:** re-run the same script with `--command revokeRole --assignmentId <the-idempotencyKey-used-above>` and a fresh `--idempotencyKey`, which disables the assignment, bumps `accessVersion` again, and re-syncs claims -- fully reversing the grant through the same reviewed, audited path (never a manual Firestore edit).

**Rollback target (Functions):** if a regression is found post-deployment, `firebase functions:delete grantRole revokeRole assignApprovedRole setUserStatus approveAccessRequest rejectAccessRequest --region us-central1 --project taylor-parts` immediately removes all six callable endpoints (clients then receive `NOT_FOUND`, not a silent fallback to an insecure path -- there is no other route to these commands, since the operator-script path (`operatorAccessCommand.js`) remains available independently and unaffected). Any Firestore state a removed-then-redeployed command mutated before rollback (a `roleAssignments`/`auditEvents` write) is reversed the same way as the claims-bootstrap rollback above -- `revokeRole` via the still-available operator-script path -- never a manual Firestore edit. Redeploying a prior version is `git checkout <prior-good-commit> -- functions/src/access/accessCommandCallables.ts functions/src/index.ts && npm run build && firebase deploy --only functions:grantRole,functions:revokeRole,functions:assignApprovedRole,functions:setUserStatus,functions:approveAccessRequest,functions:rejectAccessRequest --project taylor-parts`.

**Production verification:** see `docs/deployment/enterprise-access-production-verification-plan.md` and `functions/scripts/productionFoundationVerification.js` (Row 21 prep -- prepared and tested against the emulator now, not yet run against production; itself performs no deployment).

**Firebase project:** `taylor-parts`
**Region:** `us-central1`

## What this manifest does not do

It does not deploy Rules, Functions, or indexes; does not use production credentials; does not bootstrap claims; does not enable Admin mutations; and does not begin any enforcement cutover. Actual Row 19 production authorization is a separate, later Owner decision, issued only against this exact reviewed candidate.
