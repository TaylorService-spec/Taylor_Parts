# EI Truck Registry — Rules Deployment Evidence (Gate C)

**Status: PRE-DEPLOY SCAFFOLDING. No deployment has occurred. No file here is live-capture evidence yet.**

This directory holds the checksummed evidence for the Tier 2 production deployment of the merged
Truck Registry Firestore Rules blocks (plus the Owner-acknowledged combined whole-file content).
The operator runbook is `docs/operations/truck-registry-rules-deploy-handoff.md`.

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
  hard-gate live-baseline capture (handoff §3 / Step 3).
- `deploy-output.txt` — full deploy stdout (Step 5).
- `post-deploy-production.rules` — extracted live source after deploy; its sha256 MUST equal
  `bb1492b9…` (Step 6).
- `smoke-results.json` — raw production matrix results (Step 8).
- `checksums.sha256` — checksums over every evidence file (Step 9); a `SENSITIVE-SCAN-CLEAN` note.

Nothing in this directory authorizes deployment. Deployment requires a separate explicit Owner
authorization (Tier 2, Delegation Charter).
