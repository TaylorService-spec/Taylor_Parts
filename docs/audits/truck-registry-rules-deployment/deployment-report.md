# EI Truck Registry — Gate C Rules Deployment Report (TEMPLATE)

**Status: NOT DEPLOYED. This is the pre-deploy report template.** Every `‹TO BE CAPTURED AT DEPLOY›`
value is filled by the operator during the authorized run. Governing: `docs/DECISIONS.md` #60 ·
ADR-010 · runbook `docs/operations/truck-registry-rules-deploy-handoff.md`.

## 1. Pre-deploy validation (repository session)
- Deploy commit (pinned): `‹TO BE CAPTURED AT DEPLOY — origin/main at deploy›`
- Governed `firestore.rules` Git/LF source SHA-256: `bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907`
- Root == mirror byte-identical: **YES** (re-confirmed at deploy)
- Rules regression (emulator): **674/674 across 18 suites** (incl. truckRegistryRules 20/20 + truckRegistryWriteRules 10/10)
- Combined-content acknowledgement (Owner): **3 Truck Registry blocks + 5 D4 client-closed blocks** (handoff §2) — acknowledged.

## 2. Rollback baseline (captured BEFORE deploy; deploy gated on it — P2-B hard gate)
- Live baseline fetched via Firebase Rules API: `‹TO BE CAPTURED AT DEPLOY›`
- `pre-deploy-production.rules` source SHA-256: `‹TO BE CAPTURED AT DEPLOY›`
- Full API artifact SHA-256 (labeled API-artifact): `‹TO BE CAPTURED AT DEPLOY›`
- Baseline↔governed diff = exactly the §2 acknowledged blocks, nothing else: `‹TO BE CONFIRMED›`
- Rollback command staged: `‹TO BE CAPTURED AT DEPLOY›`

## 3. Deployment & rules identity
- `firebase deploy --only firestore:rules --project taylor-parts`: `‹TO BE CAPTURED AT DEPLOY — deploy-output.txt›`
- Post-deploy live extracted-source SHA-256 == governed `bb1492b9…` (`LIVE-EQUALS-GOVERNED`): `‹TO BE CONFIRMED›`

## 4. Post-deploy Functions inventory (MUST be unchanged)
- `firebase functions:list` before == after (Truck Registry callables remain undeployed): `‹TO BE CONFIRMED›`

## 5. Production verification — matrix (handoff §4 / `verification-matrix.md`)
- Result: `‹TO BE CAPTURED AT DEPLOY — D2-STYLE "N passed, 0 failed"›`
- Raw: `smoke-results.json`

## 6. Cleanup (MANDATORY — script authored+chmod'd in Step 0 before the trap)
- Success path: cleanup run EXPLICITLY → `CLEANUP-VERIFIED` → trap disarmed (`trap - EXIT`) BEFORE evidence packaging/report: `‹TO BE CONFIRMED›`
- Abnormal-exit / rollback path (if applicable): Step-0 trap invoked the already-authored `step9_cleanup.sh` → `CLEANUP-DONE for $TRC_PREFIX`: `‹TO BE CONFIRMED›`
- All disposable fixtures + temp Auth users removed by prefix/manifest (remaining = `[]`); smoke password cleared: `‹TO BE CONFIRMED›`

## 7. Final production posture after Gate C
| Item | State |
|---|---|
| Truck Registry Rules (`trucks`/`mobile_locations`/`location_truck_claims`) | `‹LIVE after deploy›` |
| D4 equipment-compatibility client-closed blocks | `‹LIVE after deploy — additive-deny›` |
| Truck Registry write callables | exported but **UNDEPLOYED** (Gate B) — unchanged |
| Client writes to all above | denied (Rules) — Admin-SDK-only |
| Rollback baseline | `‹captured, deployable, unused unless triggered›` |
| Gate D (Admin UI) / Gate A (inventory predicate) | not begun, separately authorized |

## 8. Evidence set (this directory)
Operator-produced, checksummed (`checksums.sha256`), sensitive-scan `‹SENSITIVE-SCAN-CLEAN›`:
`pre-deploy-production.rules` (+ `.sha256`) · `pre-deploy-production-rules-api.json` (+ `.sha256`) ·
`deploy-output.txt` · `post-deploy-production.rules` · `smoke-results.json`. `.gitattributes` (`* -text`)
preserves bytes.
