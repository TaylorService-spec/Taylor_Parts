# F-RULES-1 Read-Scoping Slice — Validation

**Gate:** F-RULES-1 read-scoping prerequisite (Owner-authorized). Bounded slice that migrates Field Mode to a technician-scoped query **and** scopes the `fieldops_jobs` / `fieldops_technicians` **read** rules. **Not** the final PR-3 (strict-suite registration + hardened-Rules deploy remain a separate gate). **No deployment.**
**Governing:** `../../assessments/f-rules-1-legacy-job-technician-rules-assessment.md` · `../../specifications/f-rules-1-legacy-job-technician-rules-contract.md` · `../../implementation-plans/f-rules-1-contract-rules-test-suite.md` · PR-1 (`pr1-contract-test-validation.md`) · PR-2 (`pr2-enforcement-validation.md`).

## Baseline reconciliation

The authorization named baseline `origin/main = 797e871`. On fetch, actual `origin/main = 0b82009` — advanced by one merged PR (#373, *INV-1 Phase 0 PR 0.1 inventory-effect detection engine*). Its diff (`inventoryEffectDetection.ts`/`.test.mjs`, that plan doc, its validation doc, `functions/package.json`) does **not** touch `firestore.rules`, the mirror, Field Mode, the jobs/technician hooks, or the contract suite — **no overlap**. This slice was therefore rebased onto current `origin/main` (`0b82009`) rather than the now-stale stated baseline.

## Objective & scope

Close the two **read**-scoping gaps deferred by PR-2 — a technician must read only (a) their own mapped technician record and (b) jobs assigned to their mapped technicianId — while preserving every admin/dispatcher workflow. This requires a matched client change: Field Mode must issue a **scoped query**, because a technician's unconstrained (full-collection) read is denied under the scoped rule. The technician **self-write** gap stays deferred (needs the cross-doc cascade to move to trusted Functions, Spec §17). Files changed: `firestore.rules`, `field-ops-app-vite/firestore.rules` (byte-identical mirror), the contract suite (phase reclassification), `field-ops-app-vite/src/modules/mobile/FieldMode.jsx`, and a new hook `field-ops-app-vite/src/hooks/useAssignedJobs.js`.

## The read-scoping interlock (why client + Rules land together)

Firestore evaluates a **list** query against the rule for *every possible* returned doc; it cannot post-filter. A scoped read rule (`resource.data.technicianId == callerTechnicianId()`) therefore **denies** an unconstrained technician list — the query must itself be constrained `where("technicianId","==",callerTechnicianId)` so all results provably satisfy the rule. Shipping the rule without the query would break Field Mode on deploy; shipping the query without the rule would leave the gap open. Both are in this slice.

## Rules changes

- **`fieldops_jobs` read** — `if isAdminOrDispatcher() || (isSignedIn() && callerTechnicianId() != null && resource.data.technicianId == callerTechnicianId())`.
- **`fieldops_technicians` read** — `if isAdminOrDispatcher() || (isSignedIn() && callerTechnicianId() != null && techId == callerTechnicianId())`.

Both reuse the PR-2 `callerTechnicianId()` helper (trusted `users/{uid}.technicianId`, fail-closed to `null`); `operationalRoles` are not consulted. CREATE/UPDATE/DELETE are unchanged from PR-2. Both Rules files remain byte-identical.

## Frontend changes (query migration)

- New `useAssignedJobs(technicianId)` — subscribes to `fieldops_jobs` constrained `where("technicianId","==",technicianId)` (the client half of the interlock). Fail-closed: no `technicianId` → empty, no broad fallback. Mirrors the existing scoped `useAssignedWorkOrders` pattern and the app's `onSnapshot` convention.
- `FieldMode.jsx` — replaced the full-collection `useFirestoreCollection(JOBS_COLLECTION)` read with `useCurrentTechnician()` (own technicianId, first hop) → `useAssignedJobs(technicianId)`. Added a fail-closed **unmapped** state (a user with no linked technician profile sees a clear prompt and no jobs). Status filtering and all existing write paths (`updateJobStatus`) are unchanged.
- The technician's **own-record** read was already a scoped direct-doc read via `useCurrentTechnician` (no change needed).
- The admin/dispatcher surfaces (ControlTower, Dispatch, DispatcherBoard, Jobs, Operations) keep their full-collection reads — allowed by the `isAdminOrDispatcher()` branch; only the technician-facing Field Mode read required migration.

## Closed-gap matrix (2 read gaps now enforced → deny)

| Gap (contract = DENY) | Collection | Mechanism |
|---|---|---|
| technician cannot read another technician's **job** | jobs | read: `resource.technicianId == callerTechnicianId()` (else a/d) + Field Mode scoped query |
| technician cannot read another technician's **record** | technicians | read: `techId == callerTechnicianId()` (else a/d) |

## Remaining deferred gap (1)

| Gap | Why deferred | Blocked by | Owning future gate |
|---|---|---|---|
| technician cannot **update own** technician record (no self-write) | the client-direct assign/complete cascade has the technician write their own tech `status`; denying it now would break completion on deploy | architectural — cross-doc cascade must move to **trusted Functions** (Spec §17), Issue #15-gated | trusted-Function cascade migration |

## Compatibility verification (13 approved behaviors preserved)

All COMPAT assertions still pass: unauthenticated read/create denied (jobs + technicians); admin/dispatcher read; admin create job/technician; dispatcher assign; technician start/complete own job; technician read own job; technician read own technician record. No approved workflow was broken; admin/dispatcher full-collection reads remain allowed.

## Validation results

| Check | Command | Result |
|---|---|---|
| Contract suite | `firebase emulators:exec --only firestore,auth "node functions/test/legacyJobsTechniciansRules.test.js"` | **exit 0** — COMPAT 13/13 · ENFORCED 16/16 now-denied · DEFERRED 1 (self-write) · 0 unexpected |
| Full Rules regression | `npm run test:rules` (functions) | **423 passed, 0 failed** (11 suites) — no registered suite affected |
| Root/mirror parity | regression runner byte-identity check | **byte-identical** |
| FE lint | `npm run lint` (field-ops-app-vite) | pass (pre-existing warnings only; none in changed files) |
| FE typecheck | `npm run typecheck` | pass (0 errors) |
| FE build | `npm run build` | pass (pre-existing chunk-size advisory only) |
| Index posture | `firestore.indexes.json` diff | **unmodified** — single-field `technicianId ==` equality is auto-single-field-indexed; no composite index required |
| Whitespace | `git diff --check` | clean |
| Scope | `git status` | only the two `.rules` files, the contract suite, `FieldMode.jsx`, `useAssignedJobs.js`, + this doc |

No production access; no production credentials; no deploy command run; no production data accessed or mutated. Suites run only against the local emulator.

## Suite registration posture

The contract suite remains **UN-REGISTERED** in `rulesRegressionRunner.mjs` `SUITES` (`EXPECTED_TOTAL` unchanged at **423**). Strict CI registration stays deferred to **PR-3**: 1 DEFERRED DENY-gap (technician self-write) remains, so a strict all-deny run would still (correctly) fail. This slice reclassified the two read assertions HARDENING→ENFORCED (default-mode result: COMPAT 13, ENFORCED 16, DEFERRED 1).

## Rollback approach

Code rollback is a plain revert of this PR (restores `allow read: if isSignedIn()` on both collections and Field Mode's full-collection read). No production Rules were deployed, so there is no live-state to roll back. When these Rules are later deployed (a separate Owner gate), the pre-deploy Rules SHA must be captured and the standard rollback-to-SHA procedure applies.

## PR-3 readiness

After this slice, only two prerequisites remain before PR-3 (strict registration + hardened-Rules deploy):
1. The **cross-doc cascade** decision (move assign/complete to trusted Functions vs. accept interim) — the last deferred gap; Issue #15-gated.
2. Specification **U-R1–U-R4** resolution (a/d correction-field allowlist, etc.).
Then PR-3 registers this suite in strict mode and (separately) an Owner deploy gate deploys the hardened Rules (pre-deploy SHA capture + post-deploy verification required).

## Not authorized / not done

No deployment · no strict-suite registration · no Function change · no Enterprise Access mutation deployment · no Admin Portal activation · no custom-claims/accessVersion rollout · no index change · no tenant/company work · no Work Order redesign · no inventory/warehouse implementation · no hosting cutover · no unrelated frontend/CI change · **no PR-3 work**.
