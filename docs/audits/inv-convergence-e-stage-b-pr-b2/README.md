# INV-CONVERGENCE-E Stage B — PR-B2 clean-checkout emulator evidence

Governed, reproducible evidence that the **exact merged Stage B Rules
implementation** (PR #432) passes from a **clean checkout** using **local
Firestore emulation only**, before any production deployment is considered.

**This evidence authorizes no deployment.** It is docs/evidence-only.

## Validated commit

- PR #432 merge commit (validated): `60dc8458a61a83b6121d7841b51a7e480356b2df`
- Checkout HEAD at validation time: `60dc8458a61a83b6121d7841b51a7e480356b2df` (exact match)
- Worktree before execution: CLEAN

## Results (all green)

| Check | Result |
|---|---|
| Stage B suite (`inventoryConvergenceStageBPartsRules.test.js`) | **142 passed, 0 failed** |
| Full Rules regression (`npm run test:rules`, 16 suites) | **644 passed, 0 failed** |
| `partMasterRules.test.js` (within the regression) | **20 passed, 0 failed** (no regression) |
| Regression-runner unit tests (`rulesRegressionRunner.test.mjs`) | **10 passed, 0 failed** |
| Rules compile/load through emulator | PASS |
| Root vs mirror byte-equality | PASS |

- root `firestore.rules` SHA-256 = `02663e0a730c3e70339f35b78245306ac4a14781b896be67d618f720fb1aa139`
- mirror `field-ops-app-vite/firestore.rules` SHA-256 = `02663e0a730c3e70339f35b78245306ac4a14781b896be67d618f720fb1aa139`
- Both equal the expected PR-B1 hash.

## Files

| File | Contents |
|---|---|
| `checkout.txt` | exact commit + clean-worktree confirmation |
| `rules-hashes.txt` | root/mirror SHA-256 vs expected |
| `rules-consistency.txt` | root/mirror byte-identity result |
| `stage-b-matrix-summary.txt` | 12-principal × 11-op matrix + 10 proofs (142) |
| `full-rules-regression-summary.txt` | 16-suite regression, 644 total |
| `runner-test-summary.txt` | runner unit tests (10) |
| `commands-and-exit-codes.txt` | exact commands + exit codes |
| `attestation.md` | signed attestation of scope + boundaries |
| `SHA256SUMS.txt` | manifest of the above (verifiable with `sha256sum -c`) |

`SHA256SUMS.txt` covers every evidence file except itself.

## Boundaries

Local Firestore emulator only. No production deployment, no production data or
credentials, no user/employee/role/claim/accessVersion change, no Functions /
indexes / Hosting / data deploy, no C1/C2. **PARTS_ASSOCIATE remained DENIED;
all client Parts writes and all adjacent-collection access remained DENIED.**
C1 (PartsList cutover) remains BLOCKED. Decisions #43–#46 unchanged.
