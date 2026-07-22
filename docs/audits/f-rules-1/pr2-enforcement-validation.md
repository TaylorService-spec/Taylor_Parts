# F-RULES-1 PR-2 — Incremental Enforcement Validation

**Gate:** F-RULES-1 PR-2 (Owner-authorized). First bounded Firestore Rules **enforcement** slice for `fieldops_jobs` / `fieldops_technicians`. **No deployment**; no Function/Enterprise-Access/Admin-Portal activation.
**Governing:** `../../assessments/f-rules-1-legacy-job-technician-rules-assessment.md` · `../../specifications/f-rules-1-legacy-job-technician-rules-contract.md` · `../../implementation-plans/f-rules-1-contract-rules-test-suite.md` · PR-1 validation (`pr1-contract-test-validation.md`).

## Objective & scope

Close the highest-risk confirmed **integrity** gaps on the two legacy collections while preserving every approved compatibility workflow. Bounded — WRITE/CREATE/DELETE enforcement only; reads left permissive (deferred). Files changed: `firestore.rules`, `field-ops-app-vite/firestore.rules` (byte-identical mirror), and the contract-test suite (phase reclassification).

## Sequencing reconciliation (plan vs this PR)

The merged Implementation Plan sketched PR-2 as *client query migration* and PR-3 as *hardened Rules*. The Owner's authorization re-scopes **PR-2 as an incremental Rules-enforcement slice**. These are reconciled by choosing a **write-only** slice: hardening WRITE/CREATE/DELETE does **not** require the Field Mode query migration (that is only needed for a scoped *read* rule), so Field Mode remains fully functional even on eventual deploy. The two read-scoping gaps (which *do* depend on the query migration) and the full technician self-write denial (which depends on the cross-doc cascade moving to trusted Functions, Specification §17) are explicitly **deferred**. No Specification conflict arises; the compatibility contract is unchanged.

## Rules changes implemented

New helpers (root + mirror): `callerTechnicianId()` (trusted `users/{uid}.technicianId`, fail-closed to `null`), `isValidJobTransition(from,to)`, `isTechnicianJobTransition(from,to)`, `isTechnicianStatus(s)`, `jobStatusOnlyChange()`. Compatibility authority is the existing `isAdminOrDispatcher()` (`users/{uid}.role`); `operationalRoles` are **not** consulted. Both rules files remain byte-identical.

**`fieldops_jobs`** — `read: if isSignedIn()` (deferred); `create: if isAdminOrDispatcher() && status=='open' && technicianId==null`; `update: if resource.status != 'complete' && ( (a/d && validJobTransition) || (technician own-assigned && status-only diff && technician transition) )`; `delete: if false`.
**`fieldops_technicians`** — `read: if isSignedIn()` (deferred); `create: if isAdminOrDispatcher() && status=='available'`; `update: if isTechnicianStatus(new status) && ( a/d || (own doc && status-only diff) )`; `delete: if false`.

## Closed-gap matrix (14 gaps now enforced → deny)

| # | Gap (contract = DENY) | Collection | Mechanism |
|---|---|---|---|
| 1 | technician cannot create a job | jobs | create = a/d only |
| 2 | operationalRole-only principal cannot create a job | jobs | create = `isAdminOrDispatcher()` (opRole ignored) |
| 3 | technician cannot forge a job (arbitrary status/technicianId) | jobs | create shape: status=='open', technicianId==null |
| 4 | technician cannot update another technician's job | jobs | update: `resource.technicianId == callerTechnicianId()` |
| 5 | technician cannot change technicianId (assignment is a/d-only) | jobs | update: technician branch `hasOnly(['status'])` |
| 6 | technician status write cannot smuggle an extra field | jobs | `jobStatusOnlyChange()` |
| 7 | technician cannot skip lifecycle (assigned→complete) | jobs | `isTechnicianJobTransition()` |
| 8 | a completed job is terminal (no reopen) | jobs | update guard `resource.status != 'complete'` |
| 9 | unmapped technician cannot update a job (fail closed) | jobs | `callerTechnicianId() != null` |
| 10 | no client can delete a job | jobs | `delete: if false` |
| 11 | technician cannot create a technician record | technicians | create = a/d only |
| 12 | technician cannot update another technician's record | technicians | update: `techId == callerTechnicianId()` (else a/d) |
| 13 | a technician record cannot be set to an invalid status | technicians | `isTechnicianStatus()` guards every write |
| 14 | no client can delete a technician record | technicians | `delete: if false` |

## Deferred-gap list (3 gaps intentionally left open)

| Gap | Why deferred | Blocked by | Owning future gate |
|---|---|---|---|
| technician cannot **read** another technician's **job** | a scoped technician read would deny Field Mode's current broad `useFirestoreCollection(JOBS_COLLECTION)` read on deploy | frontend compatibility (Field Mode client **query migration**) | query-migration slice → then a read-scoping slice (before/with PR-3 deploy) |
| technician cannot **read** another technician's **record** | same read-scoping dependency | frontend query migration | same |
| technician cannot **update own** technician record (no self-write) | the client-direct assign/complete **cascade** has the technician write their own tech `status`; denying it would break job completion on deploy | architectural — cross-doc cascade must move to **trusted Functions** (Spec §17), which is Issue #15-gated | trusted-Function cascade migration |

Interim: PR-2 allows a technician to write **only** their own tech-doc `status` (with enum validation), and denies everything else — a narrower predicate than the current permissive rule, consistent with Spec §17's "accepted temporary integrity limitation."

## Compatibility verification (13 approved behaviors preserved)

All PR-1 COMPAT assertions still pass under the PR-2 Rules: unauthenticated read/create denied (jobs + technicians); admin/dispatcher read; admin create job/technician; dispatcher assign (open→assigned + technicianId); technician start own job (assigned→in_progress, status-only); technician complete own job (in_progress→complete); technician read own job; technician read own technician record. **No approved workflow was broken.**

## Validation results

| Check | Command | Result |
|---|---|---|
| Contract suite (PR-2 Rules) | `firebase emulators:exec --only firestore,auth "node functions/test/legacyJobsTechniciansRules.test.js"` | **exit 0** — COMPAT 13/13 pass · ENFORCED 14/14 now-denied · DEFERRED 3 still-permitted · 0 unexpected |
| Full Rules regression | `npm run test:rules` | **423 passed, 0 failed** (11 suites) — no existing collection affected |
| Root/mirror parity | regression runner byte-identity check | **byte-identical** |
| FE lint / typecheck / build | `npm run lint` / `typecheck` / `build` (field-ops-app-vite) | PASS (unaffected by the `.rules` change) |
| Whitespace | `git diff --check` | clean |
| Scope | `git status` | only `firestore.rules`, the Vite mirror, the test suite, + this doc |

No production access; no production credentials; no deploy command run; no production data accessed or mutated. The contract suite and regression run only against the **local emulator**.

## Suite registration posture

The suite remains **UN-REGISTERED** in `rulesRegressionRunner.mjs` `SUITES` (`EXPECTED_TOTAL` unchanged at **423**). Strict CI registration is **not yet ready**: 3 DEFERRED DENY-gaps remain, so a strict all-deny run would (correctly) fail. Per the approved plan, registration + strict mode land in **PR-3** once every gap is closed. (Partial registration is not cleanly separable here and is not implemented.)

## Rollback approach

Code rollback is a plain revert of this PR (restores `allow read, write: if isSignedIn()` on both collections; helpers removed). No production Rules were deployed, so there is no live-state to roll back. When these Rules are later deployed (a separate Owner gate), the pre-deploy Rules SHA must be captured and the standard rollback-to-SHA procedure applies.

## PR-3 readiness recommendation

PR-3 (or the intervening query-migration slice) is **not** ready to start from this PR alone. Before PR-3 hardened-read Rules + strict registration:
1. **Field Mode query migration** (technician jobs read → `where("technicianId","==",callerTechnicianId)`, own-tech-doc read, fail-closed missing-mapping state) must land and be verified — prerequisite for the two deferred **read**-scoping gaps.
2. The **cross-doc cascade** decision (move assign/complete to trusted Functions vs. accept interim) must be resolved — prerequisite for the deferred **technician self-write** gap; Issue #15-gated.
3. Specification **U-R1–U-R4** must be resolved (a/d correction-field allowlist, etc.).
Then PR-3 registers this suite in strict mode and (separately) an Owner deploy gate deploys the hardened Rules (audit GO already on record; pre-deploy SHA capture + post-deploy verification required).

## Not authorized / not done

No deployment · no Function change · no Enterprise Access mutation deployment · no Admin Portal activation · no custom-claims/accessVersion rollout · no tenant/company work · no Work Order redesign · no inventory/warehouse/procurement implementation · no hosting cutover · no GitHub Pages retirement · no unrelated frontend/CI change · **no PR-3 work**.
