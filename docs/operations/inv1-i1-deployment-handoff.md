# INV-1 I-1 — Read-only Part Master Visibility — Deployment Handoff (Cloud Shell)

**Gate:** I-1 deployment execution — deploy the already-merged `parts` read grant + read-only frontend so `admin`/`dispatcher` can view the 190 live production Parts. **Operator-executed** in Cloud Shell; this document is the exact governed sequence. Governing: `docs/deployment/inv1-i1-readonly-part-master-visibility-plan.md` (Owner decisions D-I1-1/2/3 recorded there). **Deploying is not authorized by this document** — it is prepared for a final Owner go at the deployment execution gate.

## Pinned facts

- **Deploy commit:** `22a185d7f371a86c8909b66621d4ae527339de35` (current `origin/main`; the intervening advance from the plan merge `6cc50b9` was Customer PR #410, **docs-only** — no `firestore.rules`/frontend change).
- **Zero runtime source changes:** I-1 deploys already-merged artifacts verbatim (D-I1-1 = compatibility posture, no Issue #100 matrix). No file is edited to perform I-1.
- **Deploy source files:**
  - Rules: **`firestore.rules`** (root) — the sole Firestore-rules deploy source per `firebase.json`. The byte-identical `field-ops-app-vite/firestore.rules` is a **sync-only mirror**, not deployed.
  - Frontend: the SPA bundle built into **`field-ops-app-vite/dist/`** from the merged read path (`PartMasterList.jsx`, `services/partMasterQueries.js`, `domain/partMasterView.js`, `types/partMaster.ts`, `navigation/navConfig.js`, `App.jsx`).
- **Governed Rules git-blob SHA-256** (derive at the deploy commit, never hand-copy: `git show HEAD:firestore.rules | sha256sum`): **`fda242399023b400c0f441b96e4103fc86f79f18e2bf04005cbc745e3785bac7`**.
- **Project:** `taylor-parts` (`.firebaserc`). **`PART_MASTER_REFERENCE` stays OFF.**

## Release-lock boundaries (shared `firestore.rules` — Customer coordination)

- **START:** immediately before Step 2 (rollback-baseline capture). From this point, **no `firestore.rules` change may merge to `main`** and the deploy commit `22a185d` is frozen.
- **END:** after Step 4 confirms the live ruleset byte-equals the governed blob.
- Combined-content acknowledgement: deploying `firestore.rules` at `22a185d` ships the ENTIRE current file — Inventory's `parts` read grant **plus** all Customer-owned blocks as they exist at `22a185d`. Confirm no Customer rules change is mid-flight before locking; if one is, re-pin to the merged commit and re-derive the blob, or defer.

## Step 1 — Clone the pinned commit and install
```
git clone https://github.com/TaylorService-spec/Taylor_Parts.git && cd Taylor_Parts
git checkout 22a185d7f371a86c8909b66621d4ae527339de35 && git rev-parse HEAD   # must match
git show HEAD:firestore.rules | sha256sum                                     # must print fda24239…3785bac7
cd functions && npm ci && npm run build && cd ..
mkdir -p rollback i1-evidence
```
**PAUSE.**

## Step 2 — TAKE THE RELEASE LOCK, then capture the production Rules baseline (rollback artifact)
```
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > rollback/firestore.rules
printf '{"firestore":{"rules":"firestore.rules"}}\n' > rollback/firebase.json
head -1 rollback/firestore.rules && sha256sum rollback/firestore.rules | tee i1-evidence/pre-deploy-production-rules.sha256 && cp rollback/firestore.rules i1-evidence/pre-deploy-production.rules
```
**Expected:** first line `rules_version = '2';` and a SHA-256 (the PRE-I1 production baseline — record it; it will differ from the governed blob because production still runs the pre-1.9 ruleset with `parts` closed). Empty/malformed ⇒ **STOP — do not deploy without a preserved baseline.** `rollback/` is now an independently deployable artifact. **PAUSE.**

## Step 3 — Deploy ONLY Firestore Rules
```
firebase deploy --only firestore:rules --project taylor-parts 2>&1 | tee i1-evidence/rules-deploy-output.txt
```
**PAUSE.**

## Step 4 — Byte-verify the live ruleset equals the governed repository blob
```
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > i1-evidence/post-deploy-live.rules
LIVE=$(sha256sum i1-evidence/post-deploy-live.rules | cut -d' ' -f1); GOV=$(git show HEAD:firestore.rules | sha256sum | cut -d' ' -f1)
[ "$LIVE" = "$GOV" ] && echo "LIVE-EQUALS-GOVERNED-BLOB $LIVE" | tee i1-evidence/byte-verify.txt || { echo "MISMATCH live=$LIVE gov=$GOV" | tee i1-evidence/byte-verify.txt; echo STOP-ROLLBACK; }
```
**Expected:** `LIVE-EQUALS-GOVERNED-BLOB fda24239…3785bac7`. If missing/mismatch ⇒ **STOP → ROLLBACK** (below). On success, the Rules leg is complete — **the release lock may now be released.** **PAUSE.**

## Step 5 — Production verification: Rules matrix (NO Part fixtures; existing 190 Parts only)
Verify with **disposable test principals** (users/roleAssignments) acting as each role and **safe denied-write probes** — **create or mutate NO `parts`/`part_aliases`/`part_supplier_items` document.**

| Actor | `parts` read | `parts` write probe | manufacturers / part_aliases / part_supplier_items |
|---|---|---|---|
| unauthenticated | **deny** | deny | deny |
| technician | **deny** | deny | deny |
| dispatcher | **ALLOW** — reads the existing 190 | **denied** (probe rejected, persists nothing) | deny |
| admin | **ALLOW** — reads the existing 190 | **denied** (probe rejected, persists nothing) | deny |

- Read checks: an admin/dispatcher principal lists `parts` and observes **190** documents (the live count; read-only, no mutation). Technician/unauth read → permission-denied.
- Write probes: an admin principal attempts a `parts` create/update/delete → **rejected by Rules** (expected). Because Rules deny it, nothing is written — this satisfies "safe denied-write probe" without touching Part data.
- Siblings: read+write denied for all roles.
- Record all outcomes to `i1-evidence/rules-matrix.txt`. Clean up the disposable test principals afterward. **PAUSE.**

## Step 6 — Build and deploy the frontend (hosting)
`firebase.json` has **no predeploy hook**, so the build is a manual prerequisite (a stale/absent `dist/` would ship stale assets):
```
cd field-ops-app-vite && npm ci && npm run build && cd ..    # produces field-ops-app-vite/dist/
firebase deploy --only hosting --project taylor-parts 2>&1 | tee i1-evidence/hosting-deploy-output.txt
```
**PAUSE.**

## Step 7 — Production verification: UI
Signed in as **admin** and as **dispatcher** (existing accounts; no Part fixtures): the `inventory` domain → **Part Master** (`inventory/part-master`) renders the **read-only** list of the 190 Parts — **no create/edit/delete controls, no forms, no buttons**. Signed in as **technician**: the Part Master nav is **not present** (ROLE_NAV_ACCESS) and a direct route load shows the access-denied state. Capture screenshots/attestations to `i1-evidence/`. **Reconciliation:** the UI/read count equals the production `parts` count (**190**); no non-`parts` collection became readable. **PAUSE.**

## Step 8 — Package evidence
Collect into `i1-evidence/` and checksum: `pre-deploy-production-rules.sha256` + `pre-deploy-production.rules` (rollback baseline), `rules-deploy-output.txt`, `post-deploy-live.rules` + `byte-verify.txt`, `rules-matrix.txt`, `hosting-deploy-output.txt`, UI attestations, and the final live-ruleset hash. `sha256sum i1-evidence/* > i1-evidence/checksums.sha256`. No secrets/tokens/PII in evidence; no Part data captured. Transfer for the import PR (verify by hash, not name).

## ROLLBACK (only on a stop condition)
- **Rules** (restores the pre-I1 baseline; `parts` returns to fully client-closed):
```
cd ~/Taylor_Parts/rollback && firebase deploy --only firestore:rules --project taylor-parts && sha256sum firestore.rules
```
Then re-run Step 4's fetch and confirm the live hash equals the Step 2 baseline hash. Report immediately.
- **Frontend:** `firebase hosting:rollback --project taylor-parts` (reverts to the prior hosting release) or redeploy a build without the route.
- The trusted-writer path and all `parts` write denials are unaffected by either rollback; **no data change** in any rollback.

**Rollback triggers:** live-ruleset hash ≠ governed blob (Step 4) · any Step-5 matrix row fails · any `parts` write unexpectedly **succeeds** · the UI exposes any write control · a Customer `firestore.rules` change is detected in the deployed file (combined-content drift).

## STOP CONDITIONS (halt, do not proceed, report)
- Step 1 blob hash ≠ `fda24239…3785bac7`, or checked-out HEAD ≠ `22a185d`.
- Step 2 baseline empty/malformed.
- Step 4 mismatch.
- Any Step-5 matrix deviation, or any successful `parts` write.
- Any need to create/mutate a `parts`/`part_aliases`/`part_supplier_items` document — **never do this**; if verification seems to require it, STOP.
- A shared-`firestore.rules` merge occurred after the lock was taken.

## Post-deploy evidence-import PR (Inventory, after the handoff)
One governed docs-only PR: import `i1-evidence/` byte-exact into `docs/audits/inv1-phase1/i1-deployment-<UTC>/` (`.gitattributes -text` pin; checksums re-verified from staged git blobs; sensitive scan CLEAN; no Part data), plus a short deployment-closure record (deploy commit, pre/post ruleset hashes, matrix results, UI attestations, reconciliation count 190). STOP before merge for Owner review — mirrors the CREATE-execution import (`docs/audits/inv1-phase1/create-execution-20260724/`).

## Guardrails (this handoff and the execution gate)
Rules-first then hosting · release lock held only Step 2→4 · no runtime source edit · `PART_MASTER_REFERENCE` OFF · no Part fixtures / no Part-data mutation · no Functions/index/config change · no alias/supplier-item/quantity/UPDATE/Customer-runtime work · Inventory owns the deploy lane (Customer stays docs-only/runtime-blocked).
