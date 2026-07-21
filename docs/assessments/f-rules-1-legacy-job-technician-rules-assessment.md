---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-21
owner: Claude Code
related_adrs: []
depends_on: [docs/audits/f-rules-1/production-legacy-job-technician-audit.md, docs/governance/execution-environments.md, docs/governance/audit-artifact-standard.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: F-RULES-1 (review-derived workstream; no standalone GitHub issue number assigned)
target_release: TBD
---

# F-RULES-1 Legacy Job and Technician Rules Assessment

> **Provenance note.** This Assessment was authored as a repository-grounded document. It is **not** a verbatim copy of any prior session transcript; every current-state claim below is grounded in the repository at `origin/main` (as of the merge of PR #365, commit `74cacb1`) and the merged production audit evidence under `docs/audits/f-rules-1/`. Items that cannot be grounded in committed repository material are explicitly marked **Unresolved**.

## Purpose

Determine whether production legacy job and technician data is compatible with a future Firestore Rules hardening of `fieldops_jobs` and `fieldops_technicians`, and whether the program may proceed to test-first Rules contract work. This Assessment is the governance predecessor to the merged implementation plan `docs/implementation-plans/f-rules-1-contract-rules-test-suite.md` (PR-1) and does not authorize any Rules deployment.

## Current State

Grounded in the repository at `74cacb1`:

- **Rules posture (permissive).** `firestore.rules` — `match /fieldops_jobs/{jobId} { allow read: if isSignedIn(); allow write: if isSignedIn(); }` and `match /fieldops_technicians/{techId} { allow read, write: if isSignedIn(); }`. Any authenticated user can read/create/update/delete/assign/transition/complete jobs and read/create/update/delete technician records via the SDK. The root Rules file and its client mirror `field-ops-app-vite/firestore.rules` are kept byte-identical (enforced by the Rules regression runner).
- **Identity mapping.** `request.auth.uid → users/{uid}.technicianId → fieldops_technicians/{technicianId}`; a job's `technicianId` is the technician **document id** (not a Firebase UID). `users/{uid}` is `allow write: if false`; `users/{uid}.technicianId` is written only by the Admin-SDK script `functions/scripts/assignTechnicianToUser.js`, so the mapping is immutable to clients. `field-ops-app-vite/src/hooks/useCurrentTechnician.js` resolves it in two hops.
- **Seeded compatibility roles.** `users/{uid}.role ∈ {admin, dispatcher, technician}`. `firestore.rules` `isAdminOrDispatcher()` = `userRole() ∈ {admin, dispatcher}` via `get(users/{uid}).role`; `technician` is the technician-scoped role.
- **Security roles vs operationalRoles.** `operationalRoles` (on the linked Employee) represent **work eligibility** (used elsewhere with `employmentStatus == "ACTIVE"`), **not** security authority for these collections. The legacy job/technician path authorizes on `users/{uid}.role`, not `operationalRoles`.
- **Job/technician behavior.** Intended sole writer: `field-ops-app-vite/src/domain/jobActions.js` (`createJob`, `createTechnician`, `assignJob`, `updateJobStatus`) — its checks are app-level, **not** Rules-enforced. Lifecycle: `field-ops-app-vite/src/domain/jobWorkflow.js` — `open → assigned`, `assigned → {in_progress, open}`, `in_progress → complete`, `complete → (terminal)`. Statuses: `open|assigned|in_progress|complete`; technician statuses: `available|on_job|off_shift`. `field-ops-app-vite/src/modules/mobile/FieldMode.jsx` reads the **whole** jobs collection (`useFirestoreCollection(JOBS_COLLECTION)`) then filters client-side.
- **Rules test infrastructure.** `functions/scripts/rulesRegressionRunner.mjs` runs a frozen `SUITES` list of `*Rules.test.js` files (each with an `expected` count, summing to `EXPECTED_TOTAL = 423` across 11 suites) against a fresh Firestore+Auth emulator per suite. CI: `.github/workflows/firestore-rules-regression.yml` (pull_request, Node 20, Java 17). `firebase.json` emulator ports: firestore 8080, auth 9099.
- **Known enforcement gap.** The permissive `isSignedIn()` grant is the core defect: no Rules-level enforcement of role, assignment, lifecycle, field allowlists, or deletion for these two collections. There is **no** committed Rules test suite covering `fieldops_jobs`/`fieldops_technicians` (the 11 existing suites cover other collections, including `fieldops_wos` — the target Work Order model — but not these legacy collections).

## Production Audit Result

Reference: governed evidence under `docs/audits/f-rules-1/` (`production-legacy-job-technician-audit.json` / `.md`).

- `readOnly`: `true`
- `finalDecision`: `GO`
- `blockerCount`: `0`
- users inspected: `16`
- `fieldops_jobs` inspected: `12`
- `fieldops_technicians` inspected: `8`
- A4 (unreferenced technician documents) review findings: `4`
- C1_createdAt (technician documents missing `createdAt`) review findings: `3`
- all BLOCKER classifications: resolved (count 0)

**GO** means the defined production compatibility BLOCKERS were absent at audit time (`generatedAt` `2026-07-21T19:16:46.151Z`). It does **not** authorize Rules deployment, and does **not** authorize cleanup of the two REVIEW findings (A4, C1_createdAt), which remain untouched and require their own separately governed plan if ever actioned.

## Initial NO-GO and Correction

Documented factually, per the merged evidence and the governance record:

- An initial read-only production audit run returned **NO-GO**: a technician-role user was missing the required `technicianId` mapping (audit checks A1 and D1), plus the same REVIEW findings.
- The missing mapping was corrected through an **independently executed production operation** by the operator in an authenticated environment (not by this repository-side agent, which has no production access).
- A **fresh** read-only audit then produced the preserved **GO** artifact.
- The original NO-GO result was **not edited or relabeled**; the preserved GO artifact is a distinct run (different `generatedAt`).
- No personal names, emails, phone numbers, or unnecessary production identifiers are introduced by this evidence; the artifact is identifier-and-count only.

## Risks

- **Permissive Rules remain in place** until PR-3; every authenticated user retains full read/write/delete on both collections in the interim.
- **Regression of technician mappings** — a future user without a valid `users/{uid}.technicianId` would fail closed under hardened Rules (Field Mode empty state); the audit gates this pre-deploy.
- **Cross-technician access** — must be denied by the assignment proof; a mistake here leaks or lets a technician mutate another's job.
- **operationalRoles mistaken for permissions** — must never independently grant Firestore access.
- **Client-direct writes bypassing trusted/audited paths** — sensitive/audited changes must not become client-direct.
- **Malformed legacy records** — must fail safely, not grant access; the audit's REVIEW findings (A4/C1_createdAt) are non-blocking but must remain visible.
- **Test-suite registration / CI sequencing** — an intentionally-red suite must not break the frozen aggregate CI total; registration is deferred to the hardened-Rules PR.
- **Future tenant/company scope (Issue #140)** — deferred; must not be pre-implemented in this workstream.

## Assessment Decision

**Proceed to test-first Firestore Rules contract work.** Do **not** deploy hardened Rules until all of the following hold:

- contract tests exist (PR-1);
- the expected current vulnerabilities are demonstrated (the suite's negative cases fail against today's permissive Rules);
- hardened Rules pass the complete suite (PR-3);
- valid production-compatible behavior remains supported (Field Mode / Dispatch positive paths, verified);
- rollback and verification procedures are approved (pre-deploy Rules SHA capture; post-deploy positive + direct-SDK-negative verification).

The merged production audit is **GO**, so hardened-Rules deployment is not data-blocked; the two REVIEW findings remain open and out of scope for this workstream unless separately authorized.

## Unresolved items

- **U-1 Exact admin/dispatcher correction-path allowlist** for `fieldops_jobs` updates (which non-lifecycle fields, if any, admin/dispatcher may correct client-direct) is not yet fixed by committed repository material; to be settled in the Specification/PR-3. Marked Unresolved rather than invented here.
- **U-2 Trusted-Function migration timing** for the cross-document assign/complete cascade depends on Issue #15 (Functions deployment) and is deferred; the interim client-direct cascade is a known integrity limitation, not an authorization risk.
- **U-3 Whether any disabled/suspended signal is available to Rules at the users level** — none is committed today (only `Employee.employmentStatus`); `isActiveUser()` degrades to signed-in + recognized role. Marked Unresolved pending a future authorization-model decision.
