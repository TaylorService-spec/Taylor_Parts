# F-RULES-1 PR-1 — Rules Contract-Test Validation

**Gate:** F-RULES-1 PR-1 (Owner-authorized). Establishes automated Firestore Rules **contract tests only** — NOT an authorization to change production behavior.
**Governing:** `../../assessments/f-rules-1-legacy-job-technician-rules-assessment.md` · `../../specifications/f-rules-1-legacy-job-technician-rules-contract.md` · `../../implementation-plans/f-rules-1-contract-rules-test-suite.md`
**Suite:** `functions/test/legacyJobsTechniciansRules.test.js`

## Purpose

Encode the approved F-RULES-1 authorization contract for the legacy `fieldops_jobs` and `fieldops_technicians` collections as an executable, emulator-based Rules test suite, and — run against the **current permissive** Rules (`allow read, write: if isSignedIn()`) — prove the vulnerability while confirming that legitimate compatibility workflows are preserved. **No Firestore Rule is changed by this PR.**

## Harness & how to run

Same zero-new-dependency harness as the other `*Rules.test.js` suites: `firebase-admin` + Node `fetch` against the **local** Firestore/Auth emulator REST APIs (200 vs 403). It never touches the live project.

Deterministic direct command (from the repository root, so the emulator loads the repo `firestore.rules`):

```bash
firebase emulators:exec --only firestore,auth --project taylor-parts \
  "node functions/test/legacyJobsTechniciansRules.test.js"
```

Two modes:
- **default (PR-1):** proves the vulnerability against current permissive Rules. PASS iff every COMPAT assertion holds AND every HARDENING assertion is a confirmed currently-permitted gap.
- **strict (PR-3):** `F_RULES_1_STRICT=1`. PASS iff **every** assertion (COMPAT + HARDENING) matches the contract — i.e. the hardened Rules now deny what the contract denies. This is the mode used once PR-3's hardened Rules land and the suite is registered.

## Registration posture (why un-registered now)

The suite is intentionally **NOT** registered in `functions/scripts/rulesRegressionRunner.mjs`'s frozen `SUITES` / `EXPECTED_TOTAL` (still 423, unchanged) — a suite whose HARDENING assertions fail the contract against today's permissive Rules would otherwise break protected CI. It is reviewable and runnable standalone (command above). Its **removal-of-temporary-state gate** is PR-3: the hardened-Rules PR registers it in `SUITES` (bumping `EXPECTED_TOTAL`) and runs it in **strict** mode. It must not remain indefinitely unregistered.

## Run evidence (against current permissive Rules @ origin/main 8ebf140)

```
COMPAT: 13 pass, 0 fail
HARDENING: 17 currently-permitted gaps (PR-3 closes), 0 already-enforced, 0 unexpected
PR-1 OK: compatibility preserved; 17 vulnerability gap(s) confirmed present (to be closed by PR-3 hardened Rules).
exit 0
```

The 17 HARDENING gaps are **specific contract failures** (a permissive Rule allowing an operation the contract denies), not infrastructure/fixture failures — each returned HTTP 200 where the contract requires denial.

## Access Contract Matrix (normative; encoded by the suite)

Legend: A/D = admin or dispatcher · Tech = mapped technician (`users/{uid}.technicianId`) · Phase: COMPAT already holds under current Rules; HARDENING = contract denies but current Rules permit (gap).

### fieldops_jobs
| Operation | Actor | Contract | Phase |
|---|---|---|---|
| read job | unauthenticated | DENY | COMPAT |
| read job | A/D | ALLOW | COMPAT |
| read own-assigned job | Tech (own) | ALLOW | COMPAT |
| read another's job | Tech | DENY | HARDENING |
| create valid job (open, technicianId=null) | A/D | ALLOW | COMPAT |
| create job | unauthenticated / Tech / opRole-only | DENY | COMPAT (unauth) / HARDENING (Tech, opRole) |
| assign (technicianId + status) | A/D | ALLOW | COMPAT |
| change technicianId | Tech | DENY | HARDENING |
| status transition on own job (assigned→in_progress, in_progress→complete, status-only) | Tech (own) | ALLOW | COMPAT |
| status transition on another's job | Tech | DENY | HARDENING |
| status write + extra field (smuggling) | Tech | DENY | HARDENING |
| skip lifecycle (assigned→complete) | any | DENY | HARDENING |
| mutate a completed (terminal) job | any | DENY | HARDENING |
| update a job with no valid technicianId mapping | unmapped Tech | DENY (fail closed) | HARDENING |
| delete job | any | DENY | HARDENING |

### fieldops_technicians
| Operation | Actor | Contract | Phase |
|---|---|---|---|
| read technician record | unauthenticated | DENY | COMPAT |
| read technician record | A/D | ALLOW | COMPAT |
| read own record | Tech (own) | ALLOW | COMPAT |
| read another's record | Tech | DENY | HARDENING |
| create technician record | A/D | ALLOW | COMPAT |
| create technician record | Tech | DENY | HARDENING |
| update own record (self-write) | Tech | DENY | HARDENING |
| update another's record | Tech | DENY | HARDENING |
| set invalid status | any | DENY | HARDENING |
| delete technician record | any | DENY | HARDENING |

Coverage confirms the required areas: authentication states; admin/dispatcher/technician compatibility roles (`users/{uid}.role`); technician identity mapping (`users/{uid}.technicianId`, incl. unmapped fail-closed); cross-user isolation; trusted-writer boundaries (assignment/delete/terminal/self-write denied); operationalRoles-are-not-authorization; and the protected collections. Enterprise Access future fixtures are represented via the seeded compatibility roles; deployed Work Order / Saved Definition / Reporting / Effective-Access **Functions** are out of this Rules-suite's scope (verified separately under `../functions-live-state/`).

## Validation performed

- `node -c` syntax OK; `npm ci` (functions) clean.
- Emulator run (firestore + auth) via `emulators:exec`: exit 0, 13 COMPAT pass, 17 HARDENING gaps, 0 unexpected.
- `firestore.rules` and its mirror: **unchanged**. `rulesRegressionRunner.mjs` `SUITES`/`EXPECTED_TOTAL`: **unchanged** (423). Suite **un-registered**.
- No production access, no deployment, no production credentials, no Rules behavior change.

## PR-2 readiness assessment

PR-1 (this) is complete and green. **PR-2** (client query / UI compatibility) is the next gate and is **not** authorized here. PR-2 readiness:
- **Ready:** the contract's technician read scope (own technician doc + own-assigned jobs only) is fixed and tested, so PR-2 can migrate Field Mode from its current broad `useFirestoreCollection(JOBS_COLLECTION)` read to a `where("technicianId","==",callerTechnicianId)` query with a fail-closed missing-mapping state, verified against these COMPAT expectations.
- **Prerequisite already satisfied:** the production compatibility audit is **GO** (`../functions-live-state/` is a separate gate; the data-audit GO is under `../f-rules-1/`), so scoped reads won't strand existing records.
- **Sequencing:** PR-2 (queries) → PR-2A (lifecycle parity) → PR-3 (hardened Rules + register this suite in strict mode) → PR-4 (deploy package). Each is a separate Owner gate; every Rules deploy is separately authorized.
- **Open (unchanged, not resolved here):** Specification U-R1–U-R4 (admin/dispatcher non-lifecycle correction-field allowlist; additional non-admin broad-read needs; trusted-Function cascade timing; users-level disabled/suspended signal) — required before PR-3, not PR-1.

## Not authorized / not done

No Rules enforcement change · no deployment · no Function change · no Enterprise Access mutation activation · no Admin Portal activation · no inventory implementation · no hosting change · no GitHub Pages retirement · PR-2 not started.
