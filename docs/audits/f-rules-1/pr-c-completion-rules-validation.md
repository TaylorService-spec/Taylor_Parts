# F-RULES-1 PR-C — Completion Rules Hardening & Strict-Suite Registration — Validation

**Gate:** F-RULES-1 PR-C (Owner-authorized). Final Firestore Rules hardening for technician job completion + strict-suite CI registration. **No deployment** — repository + emulator only. Governing: Decision #39, `../../specifications/technician-self-write.md` §2–3, `../../implementation-plans/technician-self-write.md`.

## Before-state (proven, not inferred — characterization run on merged Rules @ `27c06a0`)

Contract suite (pre-PR-C, default mode): **COMPAT 13 / ENFORCED 16 / DEFERRED 1** — with these two payloads **PERMITTED (HTTP 200)**:
- `PASS [COMPAT] assigned technician can complete own job (in_progress->complete) (ALLOW, status 200)` — the exact legacy production completion payload (`{status:"complete"}`).
- `GAP [DEFERRED] technician cannot update own technician record (no self-write) -- still PERMITTED (status 200)` — the interim own-`status` grant.

### Before/after matrix (actor × operation)

| Operation | unauth | tech (owner) | other tech | dispatcher | admin | Admin SDK |
|---|---|---|---|---|---|---|
| assigned→in_progress (status-only) | deny | **allow → allow** | deny | allow (PR-2) | allow (PR-2) | bypass |
| assigned→complete | deny | deny → deny | deny | deny (invalid transition) | deny | bypass |
| in_progress→complete | deny | **ALLOW → DENY** | deny | allow (PR-2, preserved) | allow (PR-2, preserved) | bypass |
| change technicianId | deny | deny (hasOnly) | deny | allow (PR-2 assignment) | allow | bypass |
| alter workOrderId | deny | deny (hasOnly) | deny | (PR-2 posture, unchanged¹) | ¹ | bypass |
| add completedAt/completedBy | deny | deny (hasOnly) | deny | ¹ | ¹ | bypass |
| unrelated fields during start | deny | deny (hasOnly) | deny | ¹ | ¹ | bypass |
| technician doc → available/off_shift | deny | **ALLOW(status-only) → DENY** | deny | allow (PR-2 correction, preserved) | allow | bypass |
| write auditEvent | deny | deny → deny | deny | deny | deny | bypass |
| delete job | deny | deny | deny | deny | deny | bypass |
| create job as complete | deny | deny (create shape) | deny | deny (must be open+unassigned) | deny | bypass |

¹ The a/d update branch is the **previously-approved PR-2 contract** (valid-transition check, no field allowlist — the open Specification questions U-R1–U-R4 about an a/d correction-field allowlist remain out of PR-C scope by direction: "preserve only the previously approved operations"). No a/d client path was widened or narrowed.

## Rules changes (root + byte-identical mirror; nothing else)

1. **`isTechnicianJobTransition`** narrowed to `assigned→in_progress` only (was: also `in_progress→complete`). Comment records the Function-only completion authority and the **D1-before-D2 deploy dependency**.
2. **`fieldops_technicians` update** → `isAdminOrDispatcher() && isTechnicianStatus(new)` — the interim technician own-`status` branch **removed**. A technician holds **no** direct write on this collection.
3. `fieldops_jobs` update comment updated (start-only technician branch; `jobStatusOnlyChange()`'s `hasOnly(['status'])` remains the strict changed-keys allowlist — matching the actual client start payload `{status}` exactly; `technicianId`/`workOrderId`/`customer`/`address`/`completedAt`/`completedBy`/anything else is client-immutable in this transition).
- **Unchanged:** read scoping (both collections), create/delete postures, users `write:false`, `auditEvents` `read,write:false` (already client-deny-all — verified, tests added), all a/d approved operations, every other collection.

## Strict suite (registered)

- `functions/test/legacyJobsTechniciansRules.test.js` — **STRICT by default** (`F_RULES_1_STRICT=0` = local debug escape only), emits the runner-standard `N passed, M failed` summary.
- **43 assertions: COMPAT 13 / ENFORCED 30 / DEFERRED 0.** New coverage beyond the prior 30: workOrderId-smuggle during start · completedAt/completedBy injection · arbitrary status (`cancelled`) · multi-field overwrite-as-complete · technician self-`available` (completion imitation) · dispatcher tech-status correction preserved (COMPAT) · 6 auditEvents cases (unauth/tech/admin/dispatcher forge-create incl. a forged `completeAssignedJob` action+actorUid, update, delete — against a seeded trusted-writer event).
- Registered in `rulesRegressionRunner.mjs` `SUITES` (12th suite); **`EXPECTED_TOTAL` 423 → 466**; runner self-test cross-check updated (10/10 pass). Existing CI workflow (`firestore-rules-regression.yml`) already triggers on every touched path — no workflow change, no parallel CI, no continue-on-error.
- Commands: full governed run `npm run test:rules` (functions; spawns its own emulators; expect **466 passed, 0 failed (12 suites)**); focused run `npm run test:fRules1` against a running firestore+auth emulator (expect **43 passed, 0 failed**). Emulator-only; no production access or credentials.

## After-state validation results

| Check | Result |
|---|---|
| Strict contract suite | **43 passed, 0 failed** — `STRICT: all contract assertions satisfied.` |
| Full Rules regression | **466 passed, 0 failed (12 suites)** — all 11 prior suites unchanged |
| Root/mirror parity | byte-identical |
| Runner self-test (`test:runner`) | 10/10 pass (466 cross-check) |
| Frontend payload parity | start payload `{status:"in_progress"}` (exact `jobActions` write) **passes**; legacy completion payload `{status:"complete"}` **fails** — both as in-suite assertions |
| Read-scoping regression | preserved (scoped-read assertions still pass; no read broadened) |
| `git diff --check` | clean |

## Deploy-order dependency (CRITICAL — recorded here, in the suite header, in the Rules comment, and in both plans)

These hardened Rules **deny the currently-active legacy production completion payload**. Deploying them before Gate D1 (deploy `completeAssignedJob` + flip the frontend `trustedCompletion` gate + verify) **would break production completion**. Sequence is fixed: **D1 → D2** (deploy Rules → verify direct completion denied, `assigned→in_progress` still allowed, callable completion succeeds, rollback plan ready). After PR-C merges, **production Rules remain unchanged** and production behavior remains operational on the legacy route.

## Rollback

Pre-deployment: revert the PR (restores prior Rules source + suite + runner counts + docs). Future D2 rollback: retain the pre-deploy Rules SHA; callable stays live; restore prior Rules only under coordinated rollback; never auto-re-enable a frontend direct-write fallback.

## Known limitations

1. A/d update branch has no field-level allowlist (PR-2 posture; U-R1–U-R4 remain open Specification questions for a later gate).
2. "Suspended/disabled caller" has no representation in the legacy Rules identity model (`users/{uid}.role` + `technicianId`); documented, not solved here.
3. The characterization (insecure-before) evidence lives in this report, not as a committed always-passing insecure test — per gate §14.

## Not authorized / not done

No Rules deployment · no Function deployment or change · no frontend change (`completionFlow`/`completionService`/`trustedCompletion`/Field Mode untouched) · no production gate flip · no production smoke · no index change · no Inventory change · no Enterprise Access mutation deployment · no Admin Portal activation · no D1/D2 execution.
