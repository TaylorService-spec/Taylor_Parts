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

## Invocation (under separate Owner authorization only)
The verifier's testable core is `runVerification(deps)`; the operator wires real dependencies:
```js
const { runVerification } = require("./functions/scripts/verifyTruckRegistryDeployment");
await runVerification({
  config: require("./config/truck-registry-deployment-verification.local.json"),
  rules:  { fetchLiveSource },        // Firebase Rules API fetch (returns the ruleset JSON)
  auth:   { provisionPersona },       // creates a disposable prefixed Auth user + signs in -> {uid, token}
  probe,                              // real client REST probe -> HTTP status
  admin:  { docExists, seedDoc, deleteDoc, deleteUser, listUsersByPrefix, listDocIdsByPrefix }, // firebase-admin
  evidence: { write },                // writes sanitized files + checksums to the evidence dir
  prefix: `trc_gatec_${crypto.randomBytes(8).toString("hex")}`,  // high-entropy, run-unique
  recaptureDate: "2026-08-01",
  log: console.log,
});
```
The run: (1) asserts live == governed (`bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907`)
BEFORE any fixture; (2) provisions prefixed personas; (3) seeds one doc per collection
(absence-preflighted, recorded after success); (4) probes all 128 rows, failing closed on the first
mismatch; (5) emits `smoke-results.json` (recaptured/recapture_date/note/governedCommit/
governed_rules_sha256 + 128 sanitized `{label,status,expected,pass}` rows) + `production-matrix.json`
+ `crosswalk.json`; (6) ALWAYS cleans up and independently verifies `RESIDUAL-DOCS 0 ; RESIDUAL-AUTH-USERS 0`.

## Fixture, manifest, cleanup, residual contract
- Fixtures + Auth users carry a high-entropy run-unique `$prefix`. Seeded docs and users are recorded
  in the manifest only AFTER successful creation; a client-create probe target is recorded BEFORE the
  attempt so an unexpectedly-allowed write is still cleaned up.
- Manifest entries: `DOC <collection>/<id>` and `USER <uid>`.
- Cleanup runs on success, failure, and partial creation (finally-style). It is idempotent and
  operates only on this run's validated paths/uids plus a prefix re-sweep; the manifest is retained
  if cleanup or residual verification fails so recovery remains possible.
- Residual verification is independent of the manifest: it sweeps each fixture collection and the
  Auth directory for the run prefix and fails unless both counts are zero.

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
