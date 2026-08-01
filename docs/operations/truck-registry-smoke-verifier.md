# EI Truck Registry — Governed Production Smoke Verifier (Gate C)

Governed verifier for the deployed Truck Registry Firestore Rules. It runs a matrix DERIVED from
`firestore.rules` @ the governed commit (not from any historical count), proves
`LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED` before creating any fixture, exercises the deployed Rules
with real client REST + password-auth ID tokens against disposable prefixed fixtures, and — in a
finally-style lifecycle — always cleans up and independently verifies zero residuals. It emits the
required recapture artifact `smoke-results.json`.

> **This document authorizes NO production execution.** Running the verifier against production is a
> SEPARATE, explicit Owner authorization. The verifier does not self-execute (`node
> verifyTruckRegistryDeployment.js` exits non-zero). The historical operator-attested
> "80 passed / 0 failed" is deployment history only and is NOT reconciled against this matrix.

## Governed sources for coverage
- `firestore.rules` @ the governed commit — the authoritative allow/deny.
- `docs/audits/truck-registry-rules-deployment/verification-matrix.md` — the probe intent.
- `docs/DECISIONS.md` #60 · ADR-010 — admin/dispatcher-only reads; truck-scoped driver access
  stays with Issue #100 (operational roles get no authorization here).

## Derived matrix — 128 checks (4 ALLOW, 124 DENY)
8 collections × 4 personas × 4 operations. Personas: `admin`, `dispatcher`, `technician`,
`unauthenticated`. Operations: single-document `get`, `create`, `update`, `delete` (collection
`list` is INTENTIONALLY excluded — `allow read` covers get+list and the governed posture probes
single-doc reads). Denial statuses: `unauthenticated` → 401 or 403; authenticated-unauthorized →
403. An ALLOWED read targets a seeded doc and must return 200 (a 404 is never accepted as proof).

### Crosswalk (governed rule → checks)
| Collection | Rule | read (admin/dispatcher) | read (technician/unauth) | create/update/delete (all personas) |
|---|---|---|---|---|
| `trucks` | read: isAdminOrDispatcher(); writes: false | ALLOW (200) | DENY | DENY |
| `mobile_locations` | read: isAdminOrDispatcher(); writes: false | ALLOW (200) | DENY | DENY |
| `location_truck_claims` | read: false; writes: false | DENY | DENY | DENY |
| `equipment_models` (D4) | read, write: false | DENY | DENY | DENY |
| `equipment_model_aliases` (D4) | read, write: false | DENY | DENY | DENY |
| `equipment_part_compatibility` (D4) | read, write: false | DENY | DENY | DENY |
| `equipment_compatibility_sources` (D4) | read, write: false | DENY | DENY | DENY |
| `equipment_compatibility_operations` (D4) | read, write: false | DENY | DENY | DENY |

Each block contributes 16 checks (4 personas × 4 operations). ALLOW cells: `trucks`/`mobile_locations`
`get` for `admin` and `dispatcher` only = 4. The tool independently regenerates and cardinality-checks
this matrix at run time and fails if the generated matrix and the crosswalk disagree.

## Prerequisites (operator, separate Owner authorization)
- Node 20+; authenticated `gcloud` read access to project `taylor-parts`; a Firebase Web API key;
  three governed disposable test identities (admin/dispatcher/technician) OR the ability to
  provision disposable prefixed Auth users; the Rules-only deployment log; the predeploy Functions
  inventory JSON.
- Copy `config/truck-registry-deployment-verification.example.json` → a LOCAL `*.local.json`
  (never committed); set `governedCommit` + `governedRulesSha256` for the deploy commit; put
  credentials ONLY in the referenced environment variables.

## Invocation — the exact operator command (under separate Owner authorization only)
The committed operator entry point is `functions/scripts/truckRegistryVerifierCli.js`. It wires the
reviewed real dependencies (firebase-admin, the Rules/Firestore REST APIs, a gcloud token) and runs
ONLY on an explicit invocation with the confirmation arguments — it never runs on import, and the
compiled governed pin (`bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907`) plus the
authorized project cannot be weakened by the local config.

Prerequisite environment (never in the repo): an authenticated `gcloud`; `TRC_WEB_API_KEY`;
`TRC_ADMIN_EMAIL`/`TRC_ADMIN_PASSWORD`, `TRC_DISPATCHER_EMAIL`/`TRC_DISPATCHER_PASSWORD`,
`TRC_TECHNICIAN_EMAIL`/`TRC_TECHNICIAN_PASSWORD` (or the names your local config references).

```bash
# From the repo root, on a clean checkout of the governed commit, under Owner authorization:
node functions/scripts/truckRegistryVerifierCli.js \
  --config        config/truck-registry-deployment-verification.local.json \
  --evidence-dir  ~/trc/evidence \
  --recovery-dir  ~/trc/recovery \
  --recapture-date 2026-08-01 \
  --confirm-project taylor-parts
```
The CLI: validates the config (pins the compiled governed hash + the authorized project +
`--confirm-project`) and the args BEFORE building any dependency; generates a high-entropy run-unique
prefix; then runs the core, which (1) asserts live == governed BEFORE any fixture; (2) provisions
disposable prefixed personas (recorded after success); (3) seeds one doc per collection
(absence-preflighted, recorded after success); (4) probes all 128 rows, failing closed on the first
mismatch; (5) emits `smoke-results.json` (recaptured/recapture_date/note/governedCommit/
governed_rules_sha256 + 128 sanitized `{label,status,expected,pass}` rows) + `production-matrix.json`
+ `crosswalk.json` into `--evidence-dir`; (6) ALWAYS cleans up and independently verifies
`RESIDUAL-DOCS 0 ; RESIDUAL-AUTH-USERS 0`. The durable recovery manifest is written to `--recovery-dir`
(NOT the sanitized evidence dir) and is retained on any cleanup/residual failure, marked `COMPLETE`
only when both succeed.

The pure core (`runVerification`) remains injectable for the unit tests; the CLI is the only
production entry point.

## Fixture, manifest, cleanup, residual contract
- Fixtures + Auth users carry a high-entropy run-unique `$prefix`. Seeded docs and users are recorded
  in the manifest only AFTER successful creation; a client-create probe target is recorded BEFORE the
  attempt so an unexpectedly-allowed write is still cleaned up.
- Manifest entries: `DOC <collection>/<id>` (including each persona's uid-keyed `users/<uid>` role
  doc) and `USER <uid>`. Entries are flushed to a DURABLE recovery file under `--recovery-dir`
  (protected, OUTSIDE the sanitized evidence dir — it holds temporary uids/fixture identities).
- Cleanup runs on success, failure, and partial creation. It is idempotent, surfaces per-entry
  delete failures (never silent success), and operates only on this run's validated paths/uids plus
  a prefix re-sweep. The recovery manifest is RETAINED (marked `RETAINED-FOR-RECOVERY`) if cleanup or
  residual verification fails, and marked `COMPLETE` only when both succeed.
- Residual verification checks every manifest entry is gone (catching uid-keyed `users/<uid>` docs a
  prefix sweep cannot find) AND, independently, sweeps each fixture collection + the Auth directory
  for the run prefix; it fails unless both counts are zero.
- The original matrix/probe error is preserved even when cleanup succeeds (the lifecycle never masks
  the primary failure).

## Evidence safety
No credentials, tokens, passwords, emails, UIDs, run prefix, fixture ids, or absolute paths enter
durable evidence — the tool asserts this against the run's actual secret values and generic
token/email/path shapes before writing, while permitting the governed collection/persona/operation
labels (which are plain identifiers).

## Unit tests (repository, no production)
`npm run test:truckRegistryVerifier` (in `functions/`) — pure `node --test` with injected fakes:
matrix completeness/cardinality/uniqueness, expected allow/deny mapping, fail-closed interpretation,
manifest recording, cleanup, residual document + Auth-user detection, and sanitized output. No
emulator, no credentials, no production access.
