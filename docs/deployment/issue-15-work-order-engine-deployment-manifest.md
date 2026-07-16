---
artifact_type: deployment-manifest
gate: Issue #15 production-authorization checkpoint
status: Audit complete; code/test gaps closed (part 2). NOT deployed; Owner production authorization still required. Live-state capture (section 5) remains the one gap requiring production credentials.
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-002-work-order-engine.md, docs/architecture/ADR-003-inventory-trigger-system.md, docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/deployment/enterprise-access-deployment-manifest.md]
implements: []
supersedes: []
superseded_by: []
related_pr: []
target_release: TBD
---

# Issue #15 (Work Order Engine v1.2) Production Deployment Manifest

**Prepared per the Owner's "ISSUE #15 PRODUCTION-READINESS CLOSEOUT" instruction (2026-07-16).** This document audits the complete Issue #15 backend at current main, identifies code/test gaps, and will carry the exact production-authorization package once those gaps are closed. **This document authorizes no deployment.** No production credentials were used to produce it; no live Rules query was performed (the "currently not deployed" fact below is Issue #15's own prior recorded finding, not re-verified here).

## 1. Complete Issue #15 backend audit (as of commit `242b8885582c31dbd4b5b7f6902d319581f18ad8`, current main)

### 1.1 Functions

All three are `onCall({ region: "us-central1" }, ...)`, exported from `functions/src/index.ts`, single `"default"` Firebase codebase, Node 20 runtime, no secrets, no `runWith`/memory/timeout overrides:

| Function | File | Purpose | Caller authorization |
|---|---|---|---|
| `createWorkOrder` | `functions/src/createWorkOrder.ts` | Allocates a `WO-YYYY-######` number (transaction-safe, via `woNumbering.ts`) and creates a `fieldops_wos` doc. | `admin`/`dispatcher` only (`callerContext.ts` role check). |
| `transitionWorkOrder` | `functions/src/transitionWorkOrder.ts` | Action-based lifecycle transition (`transitionEngine.ts`'s state machine), then a post-commit, best-effort inventory side effect (`inventoryService.ts`). | Role/ownership-gated per `transitionEngine.ts`'s `getAllowedActions()` -- varies by action and current status; a technician may only act on a Work Order where `assignedTechId` matches their own `technicianId`. |
| `updateWorkOrderExecutionData` | `functions/src/updateWorkOrderExecutionData.ts` | Narrow write path for `qtyUsedUpdates`/`executionNote` (parts-used deltas + append-only execution log). Never touches `status`/`assignedTechId`/lifecycle timestamps. | `technician` only, and only the technician the Work Order's `assignedTechId` names. |

**Shared dependencies** (all Admin-SDK-only, no client Rules dependency for their own operation):
- `functions/src/callerContext.ts` -- resolves `role`/`technicianId` from `users/{uid}` (Admin SDK read, bypasses Rules).
- `functions/src/woNumbering.ts` -- transaction-scoped `counters/work_orders_{year}` read+increment; must be called inside the same transaction as the `fieldops_wos` write it accompanies (enforced by `createWorkOrder.ts`'s call site, not by `woNumbering.ts` itself).
- `functions/src/transitionEngine.ts` -- **pure logic, no Firestore access** (`TRANSITIONS` state table, `canTransition()`, `getAllowedActions()`, `ACTION_TO_STATUS`, `ACTION_TIMESTAMP_FIELD`). Mirrored (not imported) at `field-ops-app-vite/src/domain/workOrderWorkflow.js` for client-side defense-in-depth; the two must be kept in sync by hand.
- `functions/src/inventoryService.ts` -- Epic 2D ledger side effects (`inventory_transactions`, `inventory_sync_status`), invoked strictly post-commit by `transitionWorkOrder.ts`; a failure here never rolls back or blocks the Work Order transition itself (logged for later retry, not surfaced as a `transitionWorkOrder` failure).

### 1.2 Firestore Rules surface (current main, `firestore.rules`)

Exact current line numbers (drifted slightly from the earlier deployment-candidate manifest's citation of 326-341, due to unrelated intervening changes -- re-confirmed here at `242b8885582c31dbd4b5b7f6902d319581f18ad8`):

```
firestore.rules:332  match /fieldops_wos/{woId} {
firestore.rules:333    allow read: if isAdminOrDispatcher()
firestore.rules:334      || (isTechnician() && isOwnTechnician(resource.data.assignedTechId));
firestore.rules:335    allow create, update, delete: if false;
firestore.rules:336  }

firestore.rules:338  match /counters/{counterId} {
firestore.rules:339    allow read: if false;
firestore.rules:340    allow create, update, delete: if false;
firestore.rules:341  }

firestore.rules:363  match /inventory_sync_status/{workOrderId} {
firestore.rules:364    allow read: if false;
firestore.rules:365    allow create, update, delete: if false;
firestore.rules:366  }
```

All writes to these three collections are unconditionally denied for clients (`allow create, update, delete: if false`, no admin/dispatcher exception) -- the three Functions above are the only writers, using the Admin SDK, which bypasses these Rules by design. `fieldops_wos` reads are role/ownership-scoped; `counters` and `inventory_sync_status` are fully closed (internal bookkeeping, no reporting value).

Note: `inventory_transactions` (the Epic 2D ledger, read-scoped to admin/dispatcher/PARTS_MANAGER/WAREHOUSE_MANAGER) is a related but functionally separate collection under a different ADR (ADR-003) and is not itself part of Issue #15's own scope (Issue #15's body names only `fieldops_wos`/`counters`) -- not audited as a deployment blocker here, though `transitionWorkOrder.ts`'s post-commit side effect does write to it.

### 1.3 Indexes

`firestore.indexes.json` already defines two `fieldops_wos` composite indexes (`customerId ASC, createdAt DESC` and `customerId ASC, status ASC`). Neither is required by the three Functions above -- every query they issue is a direct document-id `.get()` (confirmed by reading all three files and their dependencies). These composite indexes appear to serve a UI list-query elsewhere (not audited here) and are not a new requirement this deployment introduces.

### 1.4 Callers

`field-ops-app-vite/src/services/workOrderService.ts` already calls all three Functions live via `httpsCallable()` -- the production Field Ops UI (`WorkOrderWizard.jsx`, `WorkOrderActions.jsx`, `ExecutionCapture.jsx`, `DispatcherBoard.jsx`, `TechnicianBoard.jsx`, and others) is **already wired to call these Functions as if they existed in production.**

**This is a load-bearing finding, not a new decision:** Issue #15's own issue body already recorded (via a prior direct Admin SDK read of the live deployed ruleset, not re-verified here) that neither `fieldops_wos` nor `counters` exist in the currently-deployed ruleset, and that `createWorkOrder`/`transitionWorkOrder` do not exist live. Per that same record, `updateWorkOrderExecutionData` (added later, Epic 6 Phase 6.3) is not mentioned in Issue #15's body at all -- its live-deployed status is likewise unconfirmed. **Practical effect:** if this record is still accurate, the production Field Ops app's Work Order creation/transition/execution-capture UI currently fails at runtime for every real user attempting those actions -- not a hypothetical risk introduced by this audit, but the pre-existing, already-documented state of Issue #15. Confirming whether this is still the actual live state requires a production credential-backed query, which is out of scope for this audit (hard stop: no live Rules queries, no production-data access) -- **marked UNRESOLVED**, to be confirmed only by the Owner or an authorized operator with production access, ideally before or immediately after Row 20/Issue #15 deployment.

### 1.5 Interaction with the six merged Enterprise Access callables

The six Enterprise Access callables (`grantRole`, `revokeRole`, `assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`, from PR #310/#315/#316) share the same `functions/src/index.ts` file and the same single `"default"` Firebase codebase as Issue #15's three Functions, but have zero code-level dependency on Issue #15's Functions, Rules, or collections (confirmed by reading `accessCommandCallables.ts` and `trustedWriterCommands.ts` -- neither imports nor references `fieldops_wos`/`counters`/`callerContext.ts`/`transitionEngine.ts`/`woNumbering.ts`/`inventoryService.ts` in any way).

**Confirmed: a scoped Issue #15 deploy cannot unintentionally deploy or activate Enterprise Access, and vice versa.** `firebase deploy --only functions:<explicit-name-list>` only touches the named functions -- this is standard, documented Firebase CLI targeting behavior (already relied upon identically in `docs/deployment/enterprise-access-deployment-manifest.md`'s own Section B/C). The exact scoped commands for each surface are given in section 3 below.

**Correction to Issue #15's own recorded deploy steps:** Issue #15's issue body currently instructs `firebase deploy --only firestore:rules` followed by `firebase deploy --only functions` (both **blanket**, unscoped commands). Run today, against current main, `firebase deploy --only functions` would deploy **all nine** functions in the codebase -- Issue #15's three **and** the six Enterprise Access callables together, with no independent per-function control -- and `firebase deploy --only firestore:rules` would push the **entire current `firestore.rules` file**, including every Rules change accumulated since the last confirmed-live deployment (the Issue #226 deny-all blocks, Issue #100 changes, Issue #232 Equipment changes, and more), none of which this audit re-verifies as production-ready. Neither blanket command is authorized by this manifest. Section 3 below replaces them with exact, scoped commands.

## 2. Existing test coverage audit -- confirmed gaps, now closed (part 2)

**Functions -- CLOSED.** At the time of this audit, zero automated tests existed for `createWorkOrder.ts`, `transitionWorkOrder.ts`, `updateWorkOrderExecutionData.ts`, `woNumbering.ts`, `callerContext.ts`, `inventoryService.ts`, or `transitionEngine.ts` anywhere in `functions/test/` (confirmed: none of the 26 pre-existing files under `functions/test/` reference any of these modules by name). This is now closed: `functions/test/transitionEngine.test.mjs` (24 tests, no emulator needed, merged in PR #317) covers the pure state-machine/permissions module; `functions/test/workOrderEngineFunctions.test.js` (29 tests, live Firestore+Auth emulator) covers `createWorkOrder`/`transitionWorkOrder`/`updateWorkOrderExecutionData` end-to-end, including every documented error path (unauthenticated, wrong role, missing/invalid input, not-found, invalid transition, ownership gate) and the happy paths (real `fieldops_wos` doc creation with a genuine `WO-YYYY-######` number, real status transitions, real `executionLog`/`inventorySnapshot` mutation). `woNumbering.ts` and `callerContext.ts` are exercised indirectly through these same integration tests (both have no independent public surface to test in isolation -- `woNumbering.ts` requires an open transaction, `callerContext.ts` is a single Firestore read already covered by every role-gate test case).

**Rules Regression -- CLOSED.** The permanent Rules Regression runner (`functions/scripts/rulesRegressionRunner.mjs`) had zero coverage of the `fieldops_wos`/`counters`/`inventory_sync_status` Rules blocks across its original 8 suites (365 total expected passes). This is now closed: a 9th permanent suite, `functions/test/workOrderEngineRules.test.js` (20 tests), is registered in `SUITES`, bringing `EXPECTED_TOTAL` to 385. Confirmed via a live run of the full runner: `385 passed, 0 failed (9 suites)`.

**`inventoryService.ts` (Epic 2D post-commit side effect) is NOT separately tested by this closure** -- it is a related but functionally separate module under ADR-003, outside Issue #15's own scope (see section 1.2's note), and is not itself part of this manifest's production-authorization package.

**Frontend mirror:** `field-ops-app-vite/src/domain/workOrderWorkflow.js` (the client-side mirror of `transitionEngine.ts`'s state machine, used for defense-in-depth UI action disabling) has no test file exercising it either (confirmed: no file under `field-ops-app-vite/test/` imports it).

**Conclusion:** the entire Issue #15 backend surface -- three Cloud Functions, three Rules blocks, one pure state-machine module, one client-side mirror of that module -- currently has no automated regression coverage of any kind. This is a materially different starting point than the Enterprise Access surface (which had 4+ independent review rounds and extensive emulator test coverage before its own deployment-candidate status). Section 4 (this PR and its planned follow-ups) closes this gap.

## 3. Exact scoped deployment commands (replacing Issue #15's blanket commands)

**Issue #15 Functions only:**
```
cd functions && npm run build
firebase deploy --only functions:createWorkOrder,functions:transitionWorkOrder,functions:updateWorkOrderExecutionData --project taylor-parts
```

**Issue #15 Rules only** (scoped to *content*, not command -- Firestore has no per-collection Rules deploy; `--only firestore:rules` always deploys the whole `firestore.rules` file as one ruleset). Because of this, deploying Issue #15's Rules blocks **cannot** be scoped away from whatever else is currently in `firestore.rules` at deploy time. **This is a real constraint, not an oversight:** the Owner (or an authorized operator) must review the *entire* current `firestore.rules` file's diff against the last confirmed-live ruleset before running this command, not just the three Issue #15 blocks:
```
firebase deploy --only firestore:rules --project taylor-parts
```

**Rollback (Functions):**
```
firebase functions:delete createWorkOrder transitionWorkOrder updateWorkOrderExecutionData --region us-central1 --project taylor-parts
```

**Rollback (Rules):** restore the prior ruleset. Firebase Console's Rules history panel retains prior deployed rulesets and can restore one directly; the CLI-only equivalent is to check out the last-known-good `firestore.rules` from its commit and re-run `firebase deploy --only firestore:rules --project taylor-parts`. **This manifest cannot name the exact "last-known-good" commit** -- that requires knowing what ruleset is actually live today (section 1.4/5's unresolved item), which requires a live query this audit does not perform. **Do not claim rollback capability here beyond what can actually be captured**: until the currently-deployed ruleset is confirmed (via the procedure in section 5 below), the "prior ruleset" to roll back to is unknown, and Rules rollback for this surface is **NOT yet a real, actionable capability** -- it is a documented procedure gap, flagged rather than papered over.

## 4. What rollback preserves vs. removes

| Data/state | Effect of `functions:delete` (the three Issue #15 names) |
|---|---|
| The three Function endpoints themselves | Removed. Clients calling them receive `NOT_FOUND`. |
| `fieldops_wos` documents already created/transitioned | **Preserved**, untouched -- `functions:delete` performs no Firestore mutation. |
| `counters/work_orders_{year}` documents | **Preserved**, untouched. |
| `inventory_transactions`/`inventory_sync_status` documents already written by a prior successful `transitionWorkOrder` call | **Preserved**, untouched -- and note these are written by a **separate, already-committed** post-commit step; rolling back the Functions does not and cannot reverse a `transitionWorkOrder` call that already completed before rollback. |
| The six Enterprise Access callables | **Unaffected** -- `--only functions:<explicit-three-names>` never touches a function not named in that list. |

**Firestore writes already committed before a failure is detected:** because `createWorkOrder`/`transitionWorkOrder`/`updateWorkOrderExecutionData` each use a single `db.runTransaction(...)` for their core write, a mid-transaction failure leaves no partial write (Firestore transactions are all-or-nothing) -- but `transitionWorkOrder.ts`'s post-commit `triggerInventoryEffects()` call is **not** part of that transaction (see section 1.1); if the Work Order transition itself succeeds but the post-commit inventory side effect throws, the Work Order's own state is correctly committed and consistent, while the inventory ledger effect is only what `inventoryService.ts`'s own internal error handling records (logged to `inventory_sync_status` for retry, per its header comment) -- this is existing, by-design behavior, not a gap this rollback plan needs to newly account for, but it does mean "roll back the Functions" cannot retroactively undo a Work Order status change that already committed; only a further, deliberate write (through the same reviewed Functions, redeployed) can move a Work Order to a different status.

## 5. Current-live-state capture procedure (must run before deployment, requires production credentials -- not performed by this audit)

1. Admin SDK read of the deployed Firestore ruleset: `admin.securityRules().getFirestoreRuleset()` (or equivalent `firebase-admin` call) against the `taylor-parts` project -- **not** the Firebase Console UI, which can display an unsaved draft (this exact caveat is already recorded in Issue #15's own body and is repeated here because it remains correct and load-bearing).
2. `firebase functions:list --project taylor-parts` -- confirm which of the nine functions (three Issue #15 + six Enterprise Access) currently exist live, and cross-reference against `docs/deployment/enterprise-access-deployment-manifest.md`'s own Row 19/20 record of the six Enterprise Access callables' deployment status, so the two audits stay consistent with each other.
3. Save both outputs (ruleset text, function list) as the actual "last-known-good" baseline this manifest currently lacks (section 3's flagged gap) -- this becomes the artifact a future Rules rollback restores to.

## 6. Failure thresholds and immediate rollback triggers

- **Functions:** any of the following during or immediately after deployment triggers immediate `functions:delete` rollback: a deployed function fails to respond to a smoke-test call within a reasonable timeout; a smoke-test `createWorkOrder` call does not produce a readable `fieldops_wos` document; an unauthenticated or wrong-role call is NOT rejected (a fail-open regression); any unhandled exception rate visible in Cloud Functions logs immediately following deployment.
- **Rules:** any of the following triggers immediate Rules rollback (restore prior ruleset per section 3's caveat): a client-direct write to `fieldops_wos`/`counters`/`inventory_sync_status` succeeds (should always be denied); a technician can read a Work Order not assigned to them; admin/dispatcher reads regress (fail closed where they should be allowed, breaking the live UI).
- **Post-rollback:** confirm via `firebase functions:list --project taylor-parts` that the rolled-back names are gone (or the ruleset is restored, per section 5's capture procedure); confirm no `roleAssignments`/`auditEvents`/Enterprise Access state was disturbed (it shares no code path with Issue #15, per section 1.5, so it should never need attention here, but confirm rather than assume); re-diagnose using section 5's captured baseline before attempting redeployment.

## 7. Interaction and ordering with Enterprise Access Row 20

Per the Owner's explicit decision (2026-07-16): **Issue #15 must be deployed and verified before Enterprise Access Row 20 proceeds; the "deployed but inert" Enterprise Access callables are not decoupled from this governance gate** (ADR-005 §2.6, Spec §17, unchanged). This manifest's section 1.5 confirms the two surfaces are technically independent (a scoped Issue #15 deploy cannot touch Enterprise Access, and vice versa) -- that technical fact does not itself authorize skipping the sequencing decision above; it only means the two deployments, when both eventually authorized, can be executed and rolled back independently without cross-contamination risk.

## 8. Remaining gaps

Closed by this manifest's part 2 (PR pending independent review at time of writing):
- ~~No automated Functions test coverage for any of the three Issue #15 Functions or their four shared dependency modules~~ -- closed, see section 2.
- ~~No Rules Regression coverage for `fieldops_wos`/`counters`/`inventory_sync_status`~~ -- closed, see section 2 (385/385, 9 suites).

Still open, and out of this manifest's reach without production access:
- No production-verification script analogous to `functions/scripts/productionFoundationVerification.js` exists for Issue #15's own criteria (a smoke-test `createWorkOrder` → read cycle against a real deployed project, role-denial checks against real production, etc.) -- section 6's failure thresholds describe what such a check would need to verify, but no automated tooling exists yet. This is a reasonable next unit of work once Row 20/Issue #15 deployment is actually authorized (mirroring how `productionFoundationVerification.js` was built for Enterprise Access before its own deployment authorization).
- The "last-known-good ruleset" baseline needed for a real Rules rollback does not exist yet (section 5) -- requires a live, credential-backed query this manifest does not perform.
- Section 1.4's unresolved item: whether the production Field Ops UI's Work Order features are actually broken today (Issue #15's three Functions not yet deployed) remains unconfirmed without a production query.

## What this manifest does not do

It does not deploy Rules, Functions, or indexes; does not use production credentials; does not perform a live Rules query; does not access production data; and does not begin any enforcement cutover. It does not itself authorize Issue #15 production deployment -- that remains a separate, later Owner decision, issued only once section 8's gaps are closed and this manifest is updated with the resulting evidence.
