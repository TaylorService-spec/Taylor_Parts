# EI Truck Registry — Rules Deployment Evidence (Gate C)

**Status (2026-08-01): production RECAPTURE evidence imported and independently verified —**
**see `recapture-2026-08-01/` (136/136 PASS, live == governed, residual 0/0).**

This directory holds the Gate C evidence for the merged Truck Registry Firestore Rules blocks (plus
the Owner-acknowledged combined whole-file content). The operator runbook for the Rules deployment
is `docs/operations/truck-registry-rules-deploy-handoff.md`; the governed production smoke verifier
that produced the recapture is documented in `docs/operations/truck-registry-smoke-verifier.md`.

## `recapture-2026-08-01/` — production-verification evidence (imported, verified)
Sanitized output of the governed smoke verifier (merged commit
`55a449882c649027fb5018458a62ab377f79c9b3`), run once against production on 2026-08-01. Independently
verified at import (archive SHA `38690963…`, internal checksums 3/3, sensitive-scan clean, and the
provenance READ FROM the JSON: `recaptured=true` / `2026-08-01` / governed commit + pin / **136/136
PASS, 0 FAIL**). Provenance distinction: cleanup completion and residual docs/users 0/0 are NOT
fields in the imported JSON — the governed verifier performed cleanup + independent residual
verification IN-RUN, and those facts come from the separately-recorded operator terminal result
(`CLEANUP-DONE …` / `RESIDUAL-DOCS 0 ; RESIDUAL-AUTH-USERS 0`), not from this docs-only import (which
did not query production). See `recapture-2026-08-01/import-validation.md` for the full verification
record, the operator-relayed terminal result, and the Gate C closure assessment. The archive-hash sidecar
(`truck-registry-rules-deployment-evidence.tgz.sha256`) is the provenance anchor; the byte-exact
evidence files are `smoke-results.json` (the required artifact), `production-matrix.json`,
`crosswalk.json`, and `SHA256SUMS.txt` (the bundle's internal checksums).

The pre-deploy scaffolding below (deployment-report template, verification-matrix, governed-rules
source hash) documents the earlier Rules-deployment run structure; the recapture re-proves the
durable end-state (live == governed + full matrix pass) independently.

## Present now (repository scaffolding, review-only)
- `README.md` — this file.
- `.gitattributes` — `* -text`, so evidence bytes are preserved exactly when the operator imports them.
- `governed-rules-source.sha256` — the canonical Git/LF source-content SHA-256 of the governed
  `firestore.rules` (`bb1492b9…`), self-derived by the operator at deploy time via
  `git show <DEPLOY_COMMIT>:firestore.rules | sha256sum`.
- `deployment-report.md` — the report **template**; every live value is a `TO BE CAPTURED AT
  DEPLOY` placeholder until the operator run.
- `verification-matrix.md` — the exact production deny/allow probe specification (Step 8).

## Added by the operator AT deploy time (NOT present now)
- `pre-deploy-production.rules` + `pre-deploy-production-rules.sha256` — the live rollback baseline
  (extracted source), and `pre-deploy-production-rules-api.json` (+ `.sha256`, API-artifact) — the
  hard-gate live-baseline capture (handoff Step 3).
- `predeploy-functions-inventory.txt` / `postdeploy-functions-inventory.txt` — the Functions list
  before/after, proving `FUNCTIONS-UNCHANGED` (Steps 2 + 7).
- `deploy-output.txt` — full deploy stdout (Step 5).
- `post-deploy-production.rules` + `.sha256`, and `post-deploy-production-rules-api.json`
  (+ `.sha256`, API-artifact) — extracted live source after deploy; the source hash MUST equal
  `bb1492b9…` (Step 6).
- `smoke-results.json` — raw production matrix results, all four principals for writes (Step 8).
- `checksums.sha256` — checksums over every evidence file (Step 9); a `SENSITIVE-SCAN-CLEAN` note.

The operator run also carries a guaranteed cleanup (`step9_cleanup.sh`, invoked by a Step-0
`trap` on every exit path) so fixtures / temp Auth users cannot survive a mid-run failure or rollback.

Nothing in this directory authorizes deployment. Deployment requires a separate explicit Owner
authorization (Tier 2, Delegation Charter).
