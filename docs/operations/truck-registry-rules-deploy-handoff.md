# EI Truck Registry — Production Firestore Rules Deployment & Verification Handoff (Cloud Shell)

**Unit:** Gate C production deployment of the merged EI Truck Registry Firestore Rules blocks (`trucks`, `mobile_locations`, `location_truck_claims`) — plus the acknowledged combined whole-file content — with production verification, preserving rollback. **Operator-executed** in Cloud Shell; prepared by the Inventory session. **This document authorizes NO deployment.** Deployment is a separate, separately Owner-authorized gate (Tier 2, Delegation Charter). No fixture creation, no live smoke testing, and no Functions deployment are authorized by this handoff.

Follows the **F-RULES-1 D2 / INV-CONVERGENCE-E Stage B precedent** (`f-rules-1-d2-deployment-handoff.md`, `inv-convergence-e-stage-b-rules-deploy-handoff.md`): self-derive the governed hash from the Git/LF source, capture a rollback baseline (extracted live source) **before** deploying, verify the extracted live source equals the governed Git/LF source, run a production deny/allow matrix with disposable fixtures, package sanitized checksummed evidence.

**Governing inputs (all merged):** Decision #60 (Truck Registry write service) · `docs/DECISIONS.md` #60 · ADR-010 · the EI-P1d-2-2b read gate (PR #511) + Truck Registry write service (PR #512) that merged these Rules blocks · Gate B callables (PR #513, exported/undeployed) · this evidence directory `docs/audits/truck-registry-rules-deployment/`.

---

## 0. Baseline, governed commit, and Rules hash

- **Deploy commit (pinned at deploy time):** current `origin/main`. The governed `firestore.rules` blob is **byte-identical** across this docs-only handoff PR (it changes only `docs/**`), so the Rules bytes equal those merged at `3b6caa2`.
- **Canonical governed deployment hash — the Git/LF stored-source SHA-256** (self-derived by the operator, do not trust a copy):

  `bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907`

  This is the SHA-256 of the **LF-normalized Rules source content stored in Git**, produced by `git show <DEPLOY_COMMIT>:firestore.rules | sha256sum` (equivalently `git cat-file blob <DEPLOY_COMMIT>:firestore.rules | sha256sum`). Root and mirror `field-ops-app-vite/firestore.rules` produce the **same** hash → byte-identical (verify with `git diff --no-index` of the two extracted sources).

### 0.1 Hash terminology (two distinct artifact classes — do not conflate)

- **Source-content hash** — SHA-256 of the extracted `firestore.rules` LF source bytes (from Git, or extracted from a live ruleset's source file). Only source-content hashes are compared for equivalence, and the deployed one must equal `bb1492b9…`.
- **API-artifact hash** — SHA-256 of a **complete** Firebase Rules API JSON response saved verbatim. Captured for provenance **only**; **never** compared to a source-content hash. Always label it as such.
- If the authoring machine is Windows, a CRLF working-copy hash will differ from the Git/LF source hash by line-ending encoding only. **Deploy-side verification MUST use the Git/LF source hash `bb1492b9…`.** Identify the byte representation before stating any hash.

## 1. Hard boundaries

- **Rules only.** `firebase deploy --only firestore:rules --project taylor-parts`. NO Functions, NO Hosting, NO indexes, NO data.
- No IAM widened, no service-account keys, single operator, Cloud Shell.
- No production records created except **disposable** verification fixtures (Admin SDK), removed in Step 9.
- Merge/deploy authority ≠ this handoff. Deployment requires a **separate explicit Owner authorization**.

## 2. Combined whole-file content (Owner-acknowledged — P2-A, this deploy)

A whole-file Rules deploy ships the ENTIRE governed file. Against the newest recorded live baseline (`inv-convergence-e-c2`, 2026-07-27), the accumulated **undeployed** client-facing delta is **eight** blocks, all of which the Owner has acknowledged may deploy together:

**Truck Registry (Gate C target):**
| Collection | read | create/update/delete |
|---|---|---|
| `mobile_locations/{locationId}` | `isAdminOrDispatcher()` | `false` |
| `trucks/{truckId}` | `isAdminOrDispatcher()` | `false` |
| `location_truck_claims/{locationId}` | `false` | `false` |

**D4 equipment-compatibility (merged 2026-07-28, `1bae134`; fully client-closed — additive-deny, no client path):**
`equipment_models` · `equipment_model_aliases` · `equipment_part_compatibility` · `equipment_compatibility_sources` · `equipment_compatibility_operations` — each `allow read, write: if false;`.

All eight are **new collections** (previously default-deny). No existing collection's rules and no helper change. Strictly additive.

## 3. Live baseline is a HARD GATE (P2-B)

The repository snapshot is **NOT** authoritative live state. Before deploying, the operator MUST fetch the **current live** ruleset via the Firebase Rules API, save it as the rollback baseline (extracted source + full API artifact + sha256), and diff it against the governed file. **Deploy is gated on this capture succeeding and the diff being exactly the acknowledged combined content (§2) — nothing else.** If the diff shows any unexpected block, STOP and report.

## 4. Full production verification matrix (real client REST, password-auth ID tokens, disposable fixtures)

Seed exactly one Admin-SDK fixture doc per readable collection, mint short-lived password-auth ID tokens for one admin, one dispatcher, one technician principal, and probe:

| Collection | admin read | dispatcher read | technician read | unauth read | any client write (all principals) |
|---|---|---|---|---|---|
| `trucks` | ALLOW | ALLOW | DENY | DENY | DENY |
| `mobile_locations` | ALLOW | ALLOW | DENY | DENY | DENY |
| `location_truck_claims` | DENY | DENY | DENY | DENY | DENY |
| each D4 block (§2) | DENY | DENY | DENY | DENY | DENY |

This mirrors the merged emulator suites (`truckRegistryRules` 20/20, `truckRegistryWriteRules` 10/10, and the D4 rules suites) exactly. Every allow/deny is the **deployed** Rules' behavior.

---

## Step 1 — Clone the pinned commit and self-derive the governed hash
`git fetch`, check out the pinned `origin/main`, then `git show HEAD:firestore.rules | sha256sum` → MUST equal `bb1492b9…`. Confirm root == mirror (`git diff --no-index` of both extracted sources → identical).

## Step 2 — Confirm no Functions/index/data are in scope (pre-deploy inventory)
Confirm the deploy command targets `firestore:rules` only. Record the current deployed Functions list (`firebase functions:list`) for the post-deploy comparison in Step 7 — it MUST be unchanged (the Truck Registry callables stay **undeployed**).

## Step 3 — Capture the production Rules baseline as EXTRACTED SOURCE + full API artifact (rollback artifact)
Fetch the live ruleset via the Rules API. Save the extracted source as `pre-deploy-production.rules`, its `sha256` as `pre-deploy-production-rules.sha256`, and the full API JSON verbatim as `pre-deploy-production-rules-api.json` (+ `.sha256`, labeled API-artifact). **Diff the extracted baseline against the governed file — the only differences MUST be the acknowledged §2 blocks.** Deploy is gated on this.

## Step 4 — Validate the rollback baseline source (compile check)
Confirm the captured baseline is itself a syntactically valid, independently redeployable ruleset (so rollback is guaranteed to work).

## Step 5 — Deploy ONLY Firestore Rules
`firebase deploy --only firestore:rules --project taylor-parts` → capture full stdout to `deploy-output.txt`. Confirm the output shows Rules only, nothing else.

## Step 6 — Verify the live ruleset EXTRACTED SOURCE equals the governed Git/LF source
Re-fetch the live ruleset, extract its source, `sha256sum` → MUST equal `bb1492b9…` (`LIVE-EQUALS-GOVERNED`). Save as `post-deploy-production.rules`. (Do not compare a raw API JSON body to the source file.)

## Step 7 — Post-deploy Functions inventory comparison
`firebase functions:list` again → MUST be byte-identical to Step 2 (no Functions deployed; the exported-but-undeployed Truck Registry callables remain absent from the live project).

## Step 8 — Production verification matrix
Execute §4 with disposable fixtures + short-lived password-auth ID tokens. Record raw results as `smoke-results.json`. Every row must match §4.

## Step 9 — Cleanup + package sanitized evidence
Delete ALL fixture docs and temp Auth users (confirm remaining fixtures = `[]`); clear any smoke password. Compute `checksums.sha256` over every evidence file; run a sensitive-scan (`SENSITIVE-SCAN-CLEAN`). Fill `deployment-report.md`. A `.gitattributes` (`* -text`) preserves evidence bytes exactly.

---

## ROLLBACK (only on a stop/rollback condition — restores the pre-deploy baseline)
Redeploy the Step 3 `pre-deploy-production.rules` baseline (`firebase deploy --only firestore:rules` from a checkout of that exact source), then re-verify live source == baseline sha256. No data rollback is needed (Rules-only; only disposable fixtures existed, removed in Step 9).

## Stop conditions (abort → run ROLLBACK if already deployed → report)
- Step 1 governed hash ≠ `bb1492b9…`, or root ≠ mirror.
- Step 3 baseline capture fails, or the baseline↔governed diff shows any block outside §2.
- Step 6 live source ≠ governed.
- Step 7 Functions list changed.
- Any Step 8 matrix row fails.

## After this handoff (separately Owner-authorized)
Gate D (Truck Registry Admin UI) and Gate A (real governed inventory predicate) remain deferred.

## Non-authorizations (explicit)
This handoff authorizes NO deployment, NO Functions deployment, NO production data mutation beyond disposable Step 8 fixtures, NO Admin UI, NO inventory predicate, and NO Issue #100 change. Deployment requires a separate explicit Owner authorization.
