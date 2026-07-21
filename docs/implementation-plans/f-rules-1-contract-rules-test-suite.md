# F-RULES-1 PR-1 — Firestore Rules Contract Test Suite

**Status:** DRAFT plan. This is PR-1 of the F-RULES-1 phased implementation. **Plan only — it authorizes no Rules implementation and no deployment.**
**Related:** `../audits/f-rules-1/production-legacy-job-technician-audit.md` (merged GO evidence) · `../governance/execution-environments.md` · `../governance/audit-artifact-standard.md`
**Tier:** Any eventual `firestore.rules` change is Tier 2 (separate Owner design approval, merge authorization, and deployment authorization). PR-1 itself adds **tests only**.

## Scope of PR-1

PR-1 delivers a **test-first Firestore Rules contract suite** for the legacy `fieldops_jobs` and `fieldops_technicians` collections. It encodes the approved F-RULES-1 authorization contract as executable emulator tests. It does **not** change `firestore.rules`, application code, indexes, Functions, or production data. The hardened Rules that make this suite pass are a later phase (PR-3).

## Current-state findings (grounded in `origin/main` @ 0bb622a)

1. **Rules are permissive (unchanged).** `firestore.rules` grants `allow read, write: if isSignedIn()` for both `fieldops_jobs` and `fieldops_technicians` (`match /fieldops_jobs/{jobId}`, `match /fieldops_technicians/{techId}`). Any authenticated user can read/create/update/delete/assign/transition/complete jobs and read/create/update/delete technician records via the SDK.
2. **Intended writer discipline is app-level only.** `field-ops-app-vite/src/domain/jobActions.js` (`createJob`, `createTechnician`, `assignJob`, `updateJobStatus`) is the intended sole writer; its checks (auth, `canTransitionJob`, demo `isWriteBlocked`) are **not** Rules-enforced.
3. **Lifecycle authority (client).** `field-ops-app-vite/src/domain/jobWorkflow.js` defines `open → assigned`, `assigned → {in_progress, open}`, `in_progress → complete`, `complete → (terminal)`. Statuses (`domain/constants.js`): `open|assigned|in_progress|complete`. Technician statuses: `available|on_job|off_shift`.
4. **Identity chain (Rules-provable).** `request.auth.uid → users/{uid}.technicianId → fieldops_technicians/{technicianId}`; a job's `technicianId` is that technician **document id** (not a Firebase UID). `users/{uid}` is `allow write: if false`; `users/{uid}.technicianId` is written only by the Admin-SDK script `functions/scripts/assignTechnicianToUser.js`, so the mapping is immutable to clients. `hooks/useCurrentTechnician.js` resolves it in two hops.
5. **Field Mode reads broadly.** `modules/mobile/FieldMode.jsx` uses `useFirestoreCollection(JOBS_COLLECTION)` (all jobs) then filters status client-side — a broad read that hardened per-doc Rules would deny for a technician. (Query migration is PR-2, sequenced before Rules deploy.)
6. **Compatibility authority helper exists.** `firestore.rules` `isAdminOrDispatcher()` = `userRole() ∈ {admin,dispatcher}` via `get(users/{uid}).role`. `operationalRoles` are used elsewhere for work eligibility, **not** as a security signal for these collections.
7. **No trusted disabled/suspended field at the users level.** The only "active" signal is `employmentStatus == "ACTIVE"` on the linked *Employee* (used by the operationalRole path). Per Owner decision, no activity-state model is invented here.
8. **Rules test infrastructure.** `functions/scripts/rulesRegressionRunner.mjs` runs a frozen `SUITES` list of `*Rules.test.js` files, each with an `expected` count, summing to `EXPECTED_TOTAL` (currently 423 across 11 suites) against a freshly-started Firestore+Auth emulator per suite. CI: `.github/workflows/firestore-rules-regression.yml` (pull_request, Node 20, Java 17/temurin). `firebase.json` emulator ports: firestore 8080, auth 9099.
9. **Production compatibility gate is GO.** The merged audit evidence (`docs/audits/f-rules-1/`) records GO (0 blockers; REVIEW: A4×4 unreferenced technicians, C1_createdAt×3), so hardened-Rules deployment is not data-blocked — but the two REVIEW findings remain and are not cleaned by this work.

### Governing artifacts (reconciled)

- The F-RULES-1 **Assessment** and **Specification** are now preserved as governing repository documents: `../assessments/f-rules-1-legacy-job-technician-rules-assessment.md` and `../specifications/f-rules-1-legacy-job-technician-rules-contract.md`. This **Implementation Plan** was itself committed via PR #365. Together with the merged audit evidence (`../audits/f-rules-1/`) and the audit tooling (`functions/scripts/auditLegacyJobTechnicianData.js`, `functions/test/auditLegacyJobTechnicianData.test.js`), these are the committed F-RULES-1 governance set.
- This PR-1 plan is grounded in the **actual current Rules and code** above and is reconciled with the Assessment and Specification (consistent terminology, scope, role semantics, `technicianId` identity contract, operationalRoles-are-not-permissions, test categories, Issue #140 deferral, and the "no deployment in PR-1" boundary). Where the Specification marks a decision **Unresolved** (e.g. the admin/dispatcher non-lifecycle correction-field allowlist), PR-1 does not invent it.

## Decisions

- **D-1 Test-first, un-registered.** PR-1 adds `functions/test/legacyJobsTechniciansRules.test.js` but does **not** register it in `rulesRegressionRunner.mjs` `SUITES`. Rationale: the runner asserts an exact per-suite count and a frozen `EXPECTED_TOTAL`; a suite whose negative cases fail against today's permissive Rules would break protected CI. The suite is reviewable and runnable standalone; PR-1's description carries the documented "red against current Rules" evidence proving the vulnerability. PR-3 registers it (and bumps `EXPECTED_TOTAL`) at the same time the hardened Rules make it green. This removal-of-temporary-state gate is explicit.
- **D-2 Reuse the existing compatibility authority.** Tests assert against `isAdminOrDispatcher()` (users/{uid}.role), not a new permission engine. Enterprise Access (RoleAssignments) is inert/fail-closed and is **not** assumed active.
- **D-3 operationalRoles are not security.** A test asserts an operationalRole-only principal (no admin/dispatcher role) is denied privileged job/technician operations.
- **D-4 Assignment proof via the immutable mapping.** Technician-scoped tests prove assignment via `users/{uid}.technicianId == resource.data.technicianId`, failing closed on a null/missing/malformed mapping.

## Test matrix (contract areas → representative cases)

| # | Area | Representative expectations |
|---|---|---|
| 1 | Authentication | unauthenticated read/write denied; authenticated follows domain policy |
| 2 | Seeded compatibility roles | admin & dispatcher: read all, create, assign; technician: scoped only |
| 3 | Operational roles | operationalRole-only principal (no a/d) denied privileged job/technician writes |
| 4 | Technician compatibility mapping | mapped tech resolves; missing/blank/whitespace/malformed `technicianId` fails closed; tech reads only its own technician doc |
| 5 | Job access | admin/dispatcher read all; technician reads only `technicianId == own`; cross-technician denied; unassigned-job read denied for technician; legacy fields tolerated where still required |
| 6 | Authorization source | assert the current compatibility model (users/{uid}.role); document dependency on future Enterprise Access cutover; do not pre-adopt unresolved custom permissions |
| 7 | Mutation boundaries | admin/dispatcher create/assign client-direct; technician own-assigned status-only transitions (`assigned→in_progress`, `in_progress→complete`), `hasOnly(status)`; deny technician setting `technicianId`; deny delete on both collections; deny terminal-state (`complete`) mutation |
| 8 | Regression protection | production-compatible records remain usable; malformed legacy records fail safely; no broad wildcard grant introduced; no raw role check retired before parity exists |
| 9 | Emulator & CI | runner = the `*Rules.test.js` pattern under `functions/`; Firestore+Auth emulator; deterministic fixtures; per-suite fresh emulator; CI via the rules-regression workflow; clear failure diagnostics |
| 10 | Scope exclusions | (see below) |

Actor fixtures: admin; dispatcher; mapped technician (T1); unmapped technician; technician assigned vs not-assigned to a job; a job at each status (`open`, `assigned`, `in_progress`, `complete`); a forged/whitespace `technicianId`; an operationalRole-only principal.

## Files expected to change in PR-1

- **NEW** `functions/test/legacyJobsTechniciansRules.test.js` — the contract suite (emulator, `*Rules.test.js` pattern).
- **NEW (optional)** deterministic fixture helper if the existing suites' seeding pattern isn't directly reusable.
- **NO CHANGE** to `firestore.rules`, `field-ops-app-vite/firestore.rules`, `firestore.indexes.json`, application code, Functions runtime, or `rulesRegressionRunner.mjs` `SUITES` (registration is deferred to PR-3 per D-1).

## Sequence

1. Author fixtures + the contract suite mirroring the existing `*Rules.test.js` emulator convention.
2. Run it standalone against **current** Rules; capture the "negative cases fail (vulnerability present)" evidence for the PR body.
3. Confirm the suite's positive cases (admin/dispatcher legitimate flows) pass today and the negative cases are precise (no false reds unrelated to the contract).
4. Open PR-1 with the suite un-registered; include the documented red-run evidence and this plan reference.

## Acceptance criteria

- The suite exists, is self-contained, and runs on the Firestore+Auth emulator.
- Every contract area (1–8) has explicit positive **and** negative cases.
- Against current permissive Rules, the negative cases fail (documented) — proving the F-RULES-1 vulnerability — while positive cases pass.
- The suite is **not** registered in `SUITES`, so `firestore-rules-regression` CI stays green.
- No non-test file changed; no Rules/indexes/Functions/frontend/production change.

## Risks

- **False reds** unrelated to the contract → keep cases precise; review the standalone run.
- **Fixture drift** from the existing suites' seeding → reuse their helper/pattern where possible.
- **Runner coupling** → do not touch `SUITES`/`EXPECTED_TOTAL` in PR-1 (deferred to PR-3).
- **Assuming Enterprise Access is live** → explicitly test the compatibility model only.

## Rollback strategy

PR-1 is test-only and un-registered; rollback is a plain revert of the PR. It cannot affect production, CI green state, or existing suites.

## Explicit next gate

After PR-1 review/merge: **PR-2** (Field Mode / technician client query migration to `where("technicianId","==",callerTechnicianId)`, with a fail-closed missing-mapping state), then **PR-2A** (lifecycle canonicalization + executable parity), then **PR-3** (hardened `firestore.rules` + register the suite), then **PR-4** (deployment package). Each is separately authorized; every Rules deploy requires its own Owner deployment authorization and is preceded by the merged audit **GO** already on record.
