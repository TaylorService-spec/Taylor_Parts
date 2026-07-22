---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-22
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/technician-self-write.md, docs/specifications/technician-self-write.md, docs/implementation-plans/f-rules-1-contract-rules-test-suite.md]
implements: []
supersedes: []
superseded_by: []
related_pr: TBD
related_issue: F-RULES-1 (final deferred gap — technician self-write)
target_release: TBD
---

# Technician Self-Write — Implementation Plan

> Bounded plan for a **later** implementation, contingent on Owner approval of the Assessment/Specification. Nothing here is authorized by the design gate. Grounded in `origin/main` @ `cc94b9c`. Sequence adapted to the actual repository: the trusted-callable pattern (`updateWorkOrderExecutionData`) is deployed and production-verified, so PR-A mirrors it.

## Sequence overview

| Stage | Deliverable | Merge gate | Deploy? |
|---|---|---|---|
| **PR-A** | `completeAssignedJob` callable + Function/emulator tests (exported, **not** deployed) | Owner review | no |
| **PR-B** | Field Mode completion → callable; UX states; FE tests | Owner review | no |
| **PR-C** | Rules hardening + contract-suite finalization + **strict** registration | Owner review (Tier 2) | no |
| **Gate D1** | Deploy `completeAssignedJob` to `taylor-parts`/`us-central1` | Owner deploy gate | **yes** |
| **Gate D2** | Deploy hardened Firestore Rules (pre-deploy SHA capture) | Owner deploy gate | **yes** |
| **Gate D3** | Production smoke verification (read-only operator) | Owner verify gate | verify-only |

**Ordering constraint:** Gate D1 (Function live) **must precede** D2 (Rules that deny the direct-client completion), and PR-B (client calls the Function) must be merged before D2, so completion never breaks in production. PR-A/PR-B are safe to merge before any deploy because the interim Rules still permit the old path until D2.

## PR-A — Trusted callable + tests
- **Objective:** implement `completeAssignedJob` per Specification §1; export from `functions/src/index.ts` under the established "export ≠ deployment" posture. No client calls it yet.
- **Files likely affected:** `functions/src/completeAssignedJob.ts` (new); `functions/src/index.ts` (one export); `functions/src/types/access.ts` + `functions/src/access/auditEventWriter.ts` (add one `AuditAction` value — Owner decision O-5); `functions/test/completeAssignedJob.test.*` (new); possibly `functions/src/constants/collections.ts` (reuse existing legacy-collection constants).
- **Dependencies:** none deployed; reuses `getCallerContext`, `auditEventWriter`, `idempotencyKey` precedent.
- **Tests:** Function unit + emulator integration (see Test Plan A/B).
- **Rollback:** revert PR; nothing deployed, no live effect.
- **Merge gate:** Owner review. **Deploy gate:** none (export only).

## PR-B — Field Mode integration + FE tests
- **Objective:** replace the completion branch of `jobActions.js#updateJobStatus(COMPLETE)` with a `httpsCallable('completeAssignedJob')` call; wire the UX states in Specification §4. Leave `assigned→in_progress` (start work) as the existing client-direct write (single-doc, already Rules-safe).
- **Files likely affected:** `field-ops-app-vite/src/domain/jobActions.js` (completion path → callable; start-work unchanged); `field-ops-app-vite/src/modules/mobile/FieldMode.jsx` (pending/success/failure/retry/stale states); a small callable wrapper (e.g. `src/firebase/functions.js`) if none exists; FE tests.
- **Dependencies:** PR-A merged (callable exists in code); works against the emulator; does not require deployment.
- **Tests:** Test Plan D.
- **Rollback:** revert PR; completion reverts to the client transaction (still permitted by interim Rules).
- **Merge gate:** Owner review. **Deploy gate:** none.

## PR-C — Rules hardening + contract finalization + strict registration (Tier 2)
- **Objective:** apply the Rules target-state (Specification §2) to `firestore.rules` **and** the byte-identical `field-ops-app-vite/firestore.rules` mirror; update `functions/test/legacyJobsTechniciansRules.test.js` per Specification §3 (flip self-write to ENFORCED; re-express direct-write completion as ENFORCED-DENY; Function-path capability covered by PR-A tests); register the suite in `functions/scripts/rulesRegressionRunner.mjs SUITES` and enable strict mode; raise `EXPECTED_TOTAL`.
- **Files likely affected:** both `firestore.rules` files; `functions/test/legacyJobsTechniciansRules.test.js`; `functions/scripts/rulesRegressionRunner.mjs` (+ its runner test asserting the new total); a PR-C validation report under `docs/audits/f-rules-1/`.
- **Dependencies:** PR-A + PR-B merged **and** Gate D1 scheduled/committed before Gate D2 (so the client already uses the Function before Rules deny the direct path).
- **Tests:** Test Plan C (+ full 423→N regression, root/mirror parity).
- **Rollback:** revert PR; Rules return to interim; suite returns to unregistered/default mode.
- **Merge gate:** Owner review (Tier 2 per DelegationCharter). **Deploy gate:** D2 (separate).

## Gate D1 / D2 / D3 (separate Owner authorizations)
- **D1 — deploy Function:** `firebase deploy --only functions:completeAssignedJob`. Verify live via a read-only describe (extend the Functions live-state evidence set). Precede D2.
- **D2 — deploy Rules:** capture pre-deploy Rules SHA; `firebase deploy --only firestore:rules`; post-deploy verification that a technician direct `fieldops_technicians` write and a direct `in_progress→complete` write both deny, and that the Function path still completes. Standard rollback-to-SHA on failure.
- **D3 — production smoke:** read-only operator confirms a real technician completion succeeds via the Function and both documents reflect the cascade; capture immutable evidence per the audit-artifact standard.

## Test Plan

### A. Function unit tests (`completeAssignedJob`)
- unauthenticated → `unauthenticated`.
- caller role `admin`/`dispatcher` → `permission-denied` (unless O-2 changes this).
- missing `users/{uid}` / no `technicianId` → `failed-precondition`.
- caller-supplied `technicianId` in input → rejected/ignored (only resolved id used).
- job not found / technician doc not found → `not-found`.
- job not owned by caller → `permission-denied`.
- job not `in_progress` (open/assigned/complete) → `failed-precondition`.
- unknown/extra input field → `invalid-argument`; missing `jobId`/`idempotencyKey` → `invalid-argument`.
- happy path → job `complete` + technician `available`, both written.
- duplicate `idempotencyKey` same request → no-op success, single cascade.
- duplicate key, different request → `already-exists`.
- injected transaction failure → **no partial write** (neither doc changed).
- audit event written exactly once; no-op replay writes no second audit event.

### B. Emulator integration tests
- jobs and technician docs end **synchronized** after success (job `complete` ⇔ tech `available`).
- forced-failure path leaves **both** documents unchanged.
- retry with same `idempotencyKey` does not duplicate the cascade or the audit event.
- an `auditEvents` document exists for the completion.
- a **direct** client write to `fieldops_technicians` (technician token) remains **denied** under the PR-C Rules.

### C. Rules contract test
- `technician cannot update own technician record` → **ENFORCED**.
- `technician cannot directly complete a job (Function-only)` → **ENFORCED** (new/ re-expressed).
- remaining COMPAT assertions still pass (with the completion-by-direct-write assertion re-expressed per Spec §3; final counts fixed in PR-C).
- all prior ENFORCED assertions still deny.
- **DEFERRED = 0** → suite registered in `SUITES` + strict mode; `EXPECTED_TOTAL` raised; root/mirror byte-identical; full regression green.

### D. Frontend tests
- completion action calls the callable with **only** `{ jobId, idempotencyKey }` (no forbidden fields ever sent).
- missing-mapping state shown (reuses read-scoping slice state).
- success, failure-by-code, and stale/"already completed" states handled.
- duplicate submit prevented (in-flight key reuse); Retry reuses the same key.

## Validation each PR
lint · typecheck · build · Function tests · emulator/contract suite · root/mirror parity (PR-C) · `git diff --check` · scope check · **no Inventory-owned files** · primary checkout untouched.

## Registration of this dependency in the F-RULES-1 plan
The F-RULES-1 implementation plan (`docs/implementation-plans/f-rules-1-contract-rules-test-suite.md`) is updated **only** to register this design as the final-gap closure path and its PR-A/B/C + D1–D3 sequence — no prior governance history is rewritten.
