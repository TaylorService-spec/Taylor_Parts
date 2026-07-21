---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-21
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/f-rules-1-legacy-job-technician-rules-assessment.md, docs/implementation-plans/f-rules-1-contract-rules-test-suite.md, docs/audits/f-rules-1/production-legacy-job-technician-audit.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: F-RULES-1 (review-derived workstream)
target_release: TBD
---

# F-RULES-1 Legacy Job and Technician Rules Contract

> **Provenance note.** Repository-grounded specification, **not** a verbatim copy of any prior session transcript. Grounded in `origin/main` at `74cacb1`. Any point not grounded in committed repository material is marked **Unresolved**. This contract defines what implementation (PR-3 hardened Rules) and tests (PR-1 contract suite) must enforce. It authorizes **no** implementation and **no** deployment.

## Purpose

Define the security and compatibility contract that the F-RULES-1 Firestore Rules implementation and its contract tests must enforce for the legacy `fieldops_jobs` and `fieldops_technicians` collections, replacing the current permissive `allow read, write: if isSignedIn()` posture without breaking valid production-compatible behavior.

## Scope

- `users` (read-only compatibility profile: `role`, `technicianId`; already `allow write: if false`).
- `fieldops_jobs`.
- `fieldops_technicians`.
- Seeded compatibility roles (`admin`, `dispatcher`, `technician`).
- Technician identity mapping (`users/{uid}.technicianId`).
- Client-direct read/write boundaries for the two legacy collections.
- Compatibility with existing production-valid records (per the merged GO audit).

## Explicit Non-Scope

- Tenant/company implementation from **Issue #140**.
- Full permission-catalog implementation.
- Custom access-condition builders.
- Broad custom-claims catalogs.
- Inventory or procurement changes.
- Unrelated Field Ops refactors.
- **Production deployment in PR-1** (and no deployment authorized by this document at all).

## Identity Contract

- The authenticated `request.auth.uid` is the user identity.
- `users/{uid}` is the compatibility access profile; it remains `allow write: if false` (client-immutable).
- Technician-scoped access requires a **valid** `users/{uid}.technicianId` (a non-empty string with no surrounding whitespace) resolving to an existing `fieldops_technicians/{technicianId}`.
- Missing, malformed (blank/whitespace-only/whitespace-padded/non-string), or mismatched mappings **fail safely** (deny), never trim-and-match.
- A caller is "assigned" to a job iff `get(users/{request.auth.uid}).technicianId == resource.data.technicianId` and that value is a valid identifier.
- `operationalRoles` indicate work eligibility only and **do not** independently grant security access.

## Seeded Compatibility Roles

Expected compatibility behavior (authorized via `users/{uid}.role`, i.e. the existing `isAdminOrDispatcher()` helper — reused, not replaced):

- **admin** — read all legacy jobs/technicians; create jobs/technicians; assign/reassign/unassign; perform valid lifecycle transitions.
- **dispatcher** — same as admin for these collections (the current `isAdminOrDispatcher()` gate treats them equivalently).
- **technician** — read only its own technician document and only jobs assigned to its proven `technicianId`; perform status-only transitions on its own assigned jobs; no other writes.

These roles **must not** be prematurely replaced (e.g. by Enterprise Access RoleAssignments) before parity tests, production verification, rollback coverage, and removal of all direct dependencies on the raw-role checks.

## Read Contract

| Actor | Jobs read | Technician read |
|---|---|---|
| unauthenticated | DENY | DENY |
| admin | all | all |
| dispatcher | all | all |
| assigned technician | own-assigned job (`technicianId == own`) | own technician doc only |
| non-assigned technician | DENY (other job) | DENY (other technician) |
| unassigned job (technician) | DENY | n/a |
| malformed job/technician | fail safely (deny where identity/assignment cannot be proven) | fail safely |
| operationalRole-only principal (no admin/dispatcher) | DENY privileged reads | DENY |

Broad-collection reads vs individual-document reads: technician-facing surfaces must use **assignment-scoped queries** (`where("technicianId","==",callerTechnicianId)`), because Firestore Rules are per-document and cannot filter a broad list. admin/dispatcher broad reads remain permitted. **Unresolved (U-R1):** whether any additional legacy compatibility read (e.g. a specific dispatch-support read) must remain broader than per-assignment for a non-admin actor — marked Unresolved rather than invented; to be confirmed against Field Ops consumers during PR-2/PR-3.

## Write Contract

- **Client-direct permitted (current contract):** admin/dispatcher create jobs (canonical shape, `status == "open"`, `technicianId == null`) and technicians (`status == "available"`); admin/dispatcher assignment (set/change `technicianId`) and valid lifecycle transitions; technician **own-assigned** status-only transitions (`assigned → in_progress`, `in_progress → complete`) with `hasOnly(['status'])`.
- **Require trusted Functions (later / Issue #15):** the cross-document assign/complete **cascade** (job + technician status atomically) and any server-derived actor/audit; these must move to trusted Functions when Issue #15 lands, if the subsystem has not retired.
- Sensitive or audited changes **must not** become client-direct.
- Server-maintained identity or lifecycle fields (`technicianId` by a technician, `createdAt`, `workOrderId`, `customer`) **cannot** be arbitrarily changed by clients; `technicianId` writes are admin/dispatcher-only.
- The `technicianId` compatibility field must be protected from unauthorized mutation.
- Delete is denied for all clients on both collections.
- Terminal state (`complete`) is immutable via any client path.

## operationalRoles Contract

- `operationalRoles` are used for job eligibility, assignment matching, skills, or operational workflows.
- `operationalRoles` are **not** authorization permissions.
- Possessing an operational role **alone** grants **no** Firestore access to these collections.

## Audit and Logging Contract

- Grants, revocations, role assignments, suspensions, and approval-sensitive changes require trusted, append-only auditing under the wider authorization architecture (Enterprise Access, ADR-005).
- **F-RULES-1 does not itself implement the complete audit platform**, and the legacy job/technician collections carry no trusted actor-attribution today (a documented limitation).
- Rules **must not** create a client-direct bypass around trusted audit requirements — i.e. hardened Rules must not open a client-direct path to a mutation that the wider architecture requires to be trusted/audited.

## Test Contract

Required contract-test categories (PR-1):

- unauthenticated denial;
- admin behavior;
- dispatcher behavior;
- technician self/assigned behavior;
- cross-technician denial;
- malformed mapping denial (blank/whitespace/padded/non-string `technicianId`);
- unassigned-job behavior;
- operationalRoles non-authorization;
- trusted-function write boundaries (deny client-direct where a trusted path is required);
- valid legacy compatibility (production-valid records remain usable);
- broad wildcard regression protection (no `if isSignedIn()`-style grant reintroduced).

## PR-1 Test Registration and Sequencing

- PR-1 **may** add the new contract suite (`functions/test/legacyJobsTechniciansRules.test.js`) **without** registering it in the Rules regression runner's frozen aggregate CI total (`rulesRegressionRunner.mjs` `SUITES` / `EXPECTED_TOTAL`) **only** because that repository constraint requires the sequence — a suite whose negative cases fail against today's permissive Rules would otherwise break protected CI.
- PR-1 **must** provide a **deterministic, direct command** to run the suite (e.g. `firebase emulators:exec --only firestore,auth "node --test functions/test/legacyJobsTechniciansRules.test.js"`, or the exact runner-equivalent the repository adopts), so reviewers can reproduce the run outside the aggregate runner.
- The expected failures against current permissive Rules **must be specific contract failures** (a permissive Rule allowing something the contract denies), **not** infrastructure, emulator, or fixture failures.
- **Manual/direct execution evidence** (the red-against-current run) must be included in the PR-1 report.
- The suite becomes **mandatory CI coverage** — registered in `SUITES` with its `expected` count and folded into `EXPECTED_TOTAL` — in the **same later PR that introduces the hardened Rules** (PR-3).
- The suite **must not remain indefinitely unregistered**: its unregistered state is a bounded, temporary sequencing measure whose removal gate is the hardened-Rules PR.

## Migration and Compatibility Contract

- Valid existing records remain usable.
- Malformed records fail safely.
- Raw role checks (`isAdminOrDispatcher()`) are retired only **after** parity with any successor model exists.
- Deployment requires pre-deploy validation (audit GO, on record) and post-deploy verification (positive Field Mode/Dispatch + direct-SDK-negative checks).
- Rollback remains available (capture the exact pre-deploy Rules SHA; revert on any regression).

## Acceptance Criteria

Measurable gates:

1. **Test readiness (→ Rules hardening):** the contract suite exists, covers every Test-Contract category with explicit positive **and** negative cases, and — run directly against current permissive Rules — its negative cases fail as **specific contract failures** (not infrastructure/fixture failures), while positive cases pass. Manual/direct-run evidence is included in the PR report.
2. **Rules hardening (→ deployment readiness):** hardened `firestore.rules` (root + byte-identical mirror) make the complete suite pass; the suite is registered into the Rules regression runner and CI in the **same** PR as the hardened Rules; no broad wildcard grant remains; existing 11 suites stay green.
3. **Deployment (separate Owner gate):** production audit GO on record; pre-deploy Rules SHA captured; post-deploy positive + direct-SDK-negative verification passes; rollback verified available.

## Unresolved contract decisions

- **U-R1** additional non-admin broad read requirements (see Read Contract).
- **U-R2** exact admin/dispatcher non-lifecycle correction-field allowlist for `fieldops_jobs` updates (assessment U-1).
- **U-R3** whether the assign/complete cascade moves to trusted Functions before or is superseded by legacy retirement (depends on Issue #15).
- **U-R4** availability of any users-level disabled/suspended signal to Rules (assessment U-3); until resolved, `isActiveUser()` = signed-in + recognized role.
