# Issue #226 Row 20/21 Production-Gate Reconciliation

**Status: RECONCILIATION CHECKPOINT ONLY. No deployment, production write, RoleAssignment,
claims change, or Admin-mutation activation was performed to produce this document.**

| | |
|---|---|
| Exact head reviewed | `0320229036ac4790f249dda7d14a83ffb75e6f45` (`origin/main`, confirmed current) |
| Firebase project | `taylor-parts` |
| Region | `us-central1` |
| Prepared | 2026-07-20 |

---

## 1. Live-vs-repo delta (read-only inventory)

`firebase functions:list --project taylor-parts` (read-only, already-authenticated
developer session, no deploy):

**Exactly 11 Functions are live, in `us-central1`, all v2/Node.js 20** —
`createSavedDefinitionCallable`, `createWorkOrder`, `deleteSavedDefinitionCallable`,
`duplicateSavedDefinitionCallable`, `getSavedDefinitionCallable`,
`listSavedDefinitionsCallable`, `renameSavedDefinitionCallable`,
`resolveEffectiveAccessCallable`, `runReportDefinitionCallable`,
`transitionWorkOrder`, `updateWorkOrderExecutionData`.

**None of Row 7's six administration Functions are live**: `grantRole`, `revokeRole`,
`assignApprovedRole`, `setUserStatus`, `approveAccessRequest`, `rejectAccessRequest`
— confirmed absent from the list above.

This matches `docs/DECISIONS.md` entries #35/#36 exactly (read below, not
re-derived independently against production — this environment still has no
read-only Admin SDK/ADC access, same limitation as every prior package this
session; `firebase functions:list` is the one live-state read available without
credentials).

**Deployed commit vs. current head:** `docs/DECISIONS.md` entry #36 records the
live deploy as exact `main` commit `3a9c3ff71c66f228bcfc6c3479d08da63ebe467f`.
Confirmed: `git diff 3a9c3ff71c66f228bcfc6c3479d08da63ebe467f..0320229036ac4790f249dda7d14a83ffb75e6f45 -- firestore.rules field-ops-app-vite/firestore.rules functions/src`
produces **no output** — every commit between the deployed candidate and the
current head (`7944ccd` PR #358, `ec9afd8`/`0320229` PR #359) is documentation-
only. **Live Rules and Functions match the current repository head exactly**, not
merely the deployed commit.

---

## 2. Correction to the prior consolidated review's assumed Rules baseline

The prior package (`docs/deployment/consolidated-backend-catchup-review.md`, PR
#357) assumed, from `docs/DECISIONS.md`'s then-latest entry (#30), that the last
deployed Rules commit was `393f054883a970af2c39f1f193aff7dec8b12c11` (2026-07-11).
The Owner-operated deployment that actually ran (entry #35) captured the REAL
live ruleset first and found the true prior baseline was
**`e1d936ebaf9330ab37f09e637ca89066d45da219`** (2026-07-13, "Issue #100 PR 3a —
PARTS_ASSOCIATE Rules") — two days later than assumed, and never recorded as its
own `docs/DECISIONS.md` entry. **This is exactly the failure mode the prior
package's own stop condition #1 existed to catch, and it worked as designed**:
the deployment operator reconciled the discrepancy via a real, credentialed
capture before deploying, rather than trusting the documented record alone.

Flagging for the record (not fixed by this reconciliation, which is read-only/
docs-only): the 2026-07-11→2026-07-13 gap represents an undeployed-then-deployed
Rules change that was never logged as its own `docs/DECISIONS.md` entry — the
same class of documentation gap `docs/CLAUDE_CONTEXT.md` already documents once
before (the Sprints 2.1.3–2.1.7 `reorder_requests` incident). Recommend a future
short backfill entry once an Owner confirms the exact deploy date, purely for
the historical record — not blocking anything below.

**Current rollback target, confirmed twice (once for the rolled-back first
attempt, once as the still-current pre-catch-up baseline):**
`e1d936ebaf9330ab37f09e637ca89066d45da219`.

---

## 3. Issue/project reconciliation — actual state vs. tracked state

| Issue | GitHub state | Taylor Freezer board | Actual state | Correction needed |
|---|---|---|---|---|
| **#15** — Deploy Epic 1 Work Order Engine backend | **CLOSED** (2026-07-16, via PR #316/#317/#320) | **In Progress** (stale) | Functions genuinely live since entry #36 (2026-07-20); Rules (`fieldops_wos`/`counters`) have been live and unchanged since at least the `393f054`/`e1d936e` baseline. **Gap: no evidence found anywhere of the issue's own required smoke test** ("call `createWorkOrder` against the real deployment, then `getDoc`/`listCollection` against `fieldops_wos`") having actually been run — entry #36's verification covers accessVersion/RoleAssignment checks only, never a real Work Order create→transition cycle. | **Board corrected to Done** (§5) — GitHub closure + live Functions confirmed factual. Smoke-test gap logged as a follow-up, not reopened, since the issue's closing comment scoped closure to the docs/manifest deliverable, not to this specific smoke test, and reopening isn't authorized read-only/docs-only work. |
| **#226** — Enterprise Access & Administration Platform | OPEN | In Progress | Correct — ongoing governing program, not closable until Task 33's full closure criteria are met (Plan §18). | None. |
| **#261** — Row 19, Production authorization request | OPEN | Todo | **Nuanced.** Owner authorization *did* occur twice (entries #35 initial, #36 corrected) — but for the **expanded 11-function catch-up candidate**, not Row 19's originally-scoped surface (the six Row-7 callables, per the Implementation Plan §16 and the deployment manifest's own Section B). The six-callable Row 19 authorization has **not** happened. | Left **Todo** — its own original scope is genuinely outstanding. Comment added (§5) distinguishing the completed catch-up from the still-pending six-function ask. |
| **#262** — Row 20, Deploy trusted backend | OPEN | Todo | Same nuance as #261: "trusted backend" in the Plan's own language meant the six Row-7 callables (§16's Correction dated 2026-07-16 discusses exactly this surface). A *different*, broader, separately-authorized deployment happened instead. | Left **Todo**. Comment added (§5) with the same clarification. |
| **#263** — Row 21, Production foundation verification | **CLOSED** | Done | **Correctly scoped and correctly closed** — its own final comment already states the issue's scope was "build + validate the [verification] tooling," not running it against production, and explicitly says that dependency is "tracked separately." Confirmed accurate: `productionFoundationVerification.js`'s `CALLABLE_NAMES` (six Row-7 names) have never been run with `--execute` against `taylor-parts` — no result file, no `docs/DECISIONS.md` entry claims this. | None — already correct. This document's own task instruction ("do not treat Issue #263's tooling completion as proof Row 21 production verification ran") is independently confirmed true by inspection, not merely asserted. |

**Governance gate status (Implementation Plan §16, "Correction... 2026-07-16",
ADR-005 §2.6 / Spec §17):** "trusted-writer activation... is gated on Issue #15's
Cloud Functions being deployed and verified, regardless of technical
independence." Issue #15 is now closed and its three Functions are confirmed
live — the **deployment** half of this gate is satisfied. The **verification**
half is only partially evidenced (network-level auth-rejection yes, functional
Work-Order-lifecycle smoke test not found anywhere) — see the #15 row above.
**This reconciliation does not declare the gate fully satisfied**; it surfaces
the precise remaining gap for the Owner's own judgment, consistent with this
document's read-only authority.

---

## 4. The six-function candidate — exact manifest (Row 22 prerequisite, NOT authorized by this document)

Everything below is already fully specified in
`docs/deployment/enterprise-access-deployment-manifest.md` (Section B/C) and
`docs/deployment/enterprise-access-production-verification-plan.md` — this
section is a checkpoint-level confirmation that manifest is still accurate at
current head, not a new design.

**Exact functions:** `grantRole`, `revokeRole`, `assignApprovedRole`,
`setUserStatus`, `approveAccessRequest`, `rejectAccessRequest` — all
`onCall({ region: "us-central1" }, ...)`, exported from
`functions/src/index.ts`, thin adapters over `trustedWriterCommands.ts`. Confirmed
still exported, unchanged, at current head. Zero Rules dependency (Admin SDK
exclusive) — deployable independently of any Rules state.

**Deploy command (when authorized):**
```bash
cd functions && npm run build
firebase deploy --project taylor-parts --only \
  functions:grantRole,functions:revokeRole,functions:assignApprovedRole,\
functions:setUserStatus,functions:approveAccessRequest,functions:rejectAccessRequest
```

**Rollback command:**
```bash
firebase functions:delete grantRole revokeRole assignApprovedRole setUserStatus \
  approveAccessRequest rejectAccessRequest --region us-central1 --project taylor-parts --force
```
Preserves (does not revert) any `roleAssignments`/`auditEvents`/claims already
written by a call made before rollback — reversing those requires a real
`revokeRole` call via the operator script, never a manual Firestore edit (same
principle already governing the current 11-function candidate).

**Credentials required:** the Owner's own already-established pattern — a
secured, Owner-held service-account credential (same one used for entry #36's
corrected verification), never generated, requested, or handled by an AI
session. `productionFoundationVerification.js` additionally gates on
`--confirmProduction taylor-parts` (exact project-id match) and
`--ownerAuthorization "I CONFIRM OWNER AUTHORIZATION FOR THIS ACCESS CHANGE"`
(exact phrase match) before any write path, dry-run by default.

**Production test principal/data:** `productionFoundationVerification.js`
creates its **own** dedicated, self-contained fixtures per run — three Auth
users (`verify-<runId>-actor/-principal/-approver`) and their matching
`roleAssignments` docs — no separately-nominated real principal is needed for
this script's own S1/S3/S4/S5 checks (unlike the #325 saved-definition
verification matrix, which does need one Owner-nominated `owner`-Role
principal for its own separate purpose).

**Cleanup procedure:** built into the script itself — a `finally` block deletes
every dedicated `roleAssignments` doc and Auth user regardless of pass/fail/
thrown-error, unconditionally. The one deliberate exception: Audit Events the
run itself creates are **never** deleted (S5 requires proving immutability, and
deleting them would violate the exact guarantee being verified) — each carries
a `verify-` prefix on `actorUid`/`targetId`, trivially filterable from real
audit history.

**Current readiness:** the manifest and verification-plan docs remain accurate
and current-head-consistent (spot-checked in §1/§4 above). **Not run against
production** — this reconciliation did not execute it (network calls to
`taylor-parts` with `--confirmProduction`/production-shaped args are
appropriately blocked from this session by design, matching the hard stop).
Local/emulator evidence remains as recorded in the verification plan doc
(PR #315, 2026-07-16) plus this reconciliation's own fresh `accessCommandCallables.test.js`
re-run (§5, 13/13).

---

## 5. Full regression re-run at current head (`0320229`)

| Suite | Result |
|---|---|
| Firestore Rules Regression (pinned, 11 suites, fresh emulator per suite) | **423 passed, 0 failed** |
| `test:access` (6 files — `resolveEffectivePermission.test.mjs` gained one direct regression test per PR #358, 39→40) | **122 passed, 0 failed** |
| `test:audit` | **54 passed, 0 failed** |
| `test:trustedWriter` | **37 passed, 0 failed** |
| `test:effectiveAccess` | **23 passed, 0 failed** |
| `test:claims` | **5 passed, 0 failed** |
| `test:reporting` | **59 passed, 0 failed** |
| `test:operatorAccess` | **20 passed, 0 failed** |
| `test:operatorAccessExecute` | **2 passed, 0 failed** |
| `test:transitionEngine` | **24 passed, 0 failed** |
| `test:workOrderEngineFunctions` | **29 passed, 0 failed** |
| `accessCommandCallables.test.js` (Row 7 callable-adapter integration — the direct test for the six-function candidate's own wiring) | **13 passed, 0 failed** — re-run fresh this reconciliation; **note: not wired into any `functions/package.json` script**, must be invoked manually (`node --test test/accessCommandCallables.test.js` against a live Firestore+Auth emulator) — flagged as a minor tooling gap |
| `field-ops-app-vite` application suite (`npm test`, 40 files) | **499 passed, 0 failed** |
| **Total** | **1,310 passed, 0 failed** |

`productionFoundationVerification.js` was **not** re-executed (§4) — it is a
production-targeting operator tool by design, not a local regression suite, and
running it (even in dry-run form) requires production-shaped arguments this
session's own safety classifier correctly declines to execute.

---

## 6. Proposed verification matrix for the six-function candidate (Row 22, when authorized)

Carried forward from `docs/deployment/enterprise-access-production-verification-plan.md`,
restated here as the checkpoint's own proposed matrix so this document is
self-contained for the Owner's review:

| # | Criterion | Check | Pass condition |
|---|---|---|---|
| 1 | V1a — deployed | `firebase functions:list --project taylor-parts` | All six names present |
| 2 | V1b — network auth enforcement | Raw unauthenticated HTTPS POST to each of the six | Every one rejected (401/403/4xx) |
| 3 | S1 — fail-closed, missing assignment | `grantRole` from an actor with no `roleAssignments` doc | `UnauthorizedActorError` |
| 4 | S1 — fail-closed, stale assignment | `grantRole` from an actor whose `accessVersionAtGrant` exceeds their current `accessVersion` | `UnauthorizedActorError` |
| 5 | S4 — self-elevation denied | Actor grants themselves `admin` | `SelfApprovalError` |
| 6 | S4 — non-privileged approver denied | Privileged grant naming a non-privileged approver | `InsufficientApproverAuthorityError` |
| 7 | S3 — claims shape | Real `grantRole`, then read the principal's custom claims | Key set ⊆ `{accessVersion, companyId, platformAdmin, companyAdmin}` |
| 8 | S5 — audit immutability | Client-direct write attempt (real ID token, Firestore REST) to the just-created Audit Event | Denied by `firestore.rules` |
| 9 | S5 — audit secret-free | Scan the created Audit Event's JSON | No token/API-key-shaped substring |
| 10 | Cleanup | Post-run read-back | No `verify-`-prefixed Auth user/`roleAssignments` doc remains; Audit Events deliberately persist |
| 11 | Rollback trigger | Any of 1–9 fails | Run §4's rollback command; do not proceed to claims bootstrap or Admin-UI activation |

Additionally recommended, not in the original plan: a genuine Issue #15
functional smoke test (§3) — create a real Work Order, transition it, confirm
`inventory_transactions` — since it remains the one unclosed piece of the
"deployed and verified" governance gate this reconciliation found.

---

## 7. Precise authorization still needed

**Not authorized by this document, and none of the following was performed to
produce it:**

1. A fresh, explicit Row 19 Owner authorization naming the exact six Row-7
   functions, the exact commit, and the exact deploy command in §4 — the
   authorizations already on record (`docs/DECISIONS.md` #35/#36) cover a
   *different* 11-function surface and do not carry forward to this one.
2. A Row 20 deploy of those six functions under that authorization.
3. A Row 21 production run of `productionFoundationVerification.js --execute`
   against `taylor-parts` under that deploy, using the Owner's own secured
   credential — not before Issue #15's functional smoke-test gap (§3) is
   independently closed, since the governance gate names "deployed and
   verified," not "deployed."
4. Row 22 (Admin mutation activation) itself, which explicitly waits on 1–3.

**This document's own authority (read-only inspection, local/emulator testing,
documentation corrections, PR review, docs-only merge) ends here.**
