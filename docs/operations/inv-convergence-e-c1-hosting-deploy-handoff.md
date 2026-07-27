# INV-CONVERGENCE-E C1 — Hosting-only Production Deployment Handoff (Cloud Shell)

**Unit:** deploy the merged C1 PartsList cutover frontend to Firebase **Hosting only**,
verify the deployed experience read-only, preserve rollback. **Operator-executed** in
Cloud Shell / an approved credentialed environment; prepared by the Inventory session.
The Inventory session holds **no production credentials** and performs **no** `firebase
deploy` and **no** live production reads — those are operator actions. This document is
the operator runbook; the Inventory session imports the returned sanitized evidence.

**Authorized source:** commit `3827ce370b26af7cbf66acdf391267a0afa4092c` · project
`taylor-parts` · scope **Hosting only** · **C2 NOT authorized.**

Precedents: the I-1 hosting deploy (build:firebase base=/ gotcha) and the Stage B
deploy handoff (self-derived hashes, pre/post inventories, sanitized evidence).

---

## 0. Local preflight (already performed by the Inventory session — credential-free)

From a clean checkout of `3827ce37` (`field-ops-app-vite/`), all green:

- HEAD == `3827ce370b26af7cbf66acdf391267a0afa4092c`; worktree clean.
- `.firebaserc` default project = `taylor-parts`; `firebase.json` hosting.public = `field-ops-app-vite/dist`, SPA rewrite, **no predeploy hook** (build first).
- `npm ci` → exit 0.
- `npm test` (full client chain incl. `partsCatalogView` 23/23) → exit 0.
- `npm run lint` (oxlint) → exit 0 (pre-existing react-refresh warnings only).
- `npm run typecheck` (tsc --noEmit) → exit 0.
- `npm run build:firebase` (`vite build --base=/`) → exit 0.
- `npm run verify:build-base` → 12 passed, 0 failed.
- `dist/index.html` references `/assets/...` with **0** `/Taylor_Parts/field-ops`
  occurrences (Firebase base correct — the I-1F fix holds).
- Local (Windows) build fingerprint, **informational only** (Vite content hashes may
  differ across OS/EOL): `dist/index.html` sha256 `b896101c…0cee92`; assets
  `index-BJCJSmRw.js`, `index-CSg6YUa7.css`.
- Governed root `firestore.rules` Git/LF sha256 at `3827ce37` =
  `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381` (unchanged from
  Stage B; **C1 changed no Rules**) — used only for the post-deploy "Rules unchanged"
  assertion, NOT for a Hosting deploy.

**⚠ Build command:** the Firebase Hosting build MUST be `npm run build:firebase`
(base `/`). `npm run build` uses the GitHub-Pages base `/Taylor_Parts/field-ops/` and
would 404 all assets on the Firebase site (the original I-1 blank-site bug).

## 1. Hard boundaries

Deploy **ONLY** `hosting`. **No** Firestore Rules, Functions, indexes, or config
deploy. **No** Firestore write, **no** Auth/identity mutation, **no** role/claim change.
**No PartDetail/C2 work.** Single operator. Build from the exact authorized commit.

## 2. Stop conditions (do NOT deploy)

- HEAD != `3827ce370b26af7cbf66acdf391267a0afa4092c`, or the checkout is dirty.
- Active project != `taylor-parts`.
- The deploy command could target anything besides Hosting.
- Current Hosting release / rollback target cannot be identified.
- Any preflight (test/lint/typecheck/build:firebase/build-base) fails, or
  `dist/index.html` contains any `/Taylor_Parts/field-ops` occurrence.
- Rules / Functions / index scope cannot be proven unchanged (pre-capture missing).
- Credentials or production records would enter committed evidence.

---

## Step 1 — Clean checkout + preflight (operator re-confirmation)

```bash
git clone https://github.com/TaylorService-spec/Taylor_Parts.git c1 && cd c1 \
 && git checkout 3827ce370b26af7cbf66acdf391267a0afa4092c \
 && test "$(git rev-parse HEAD)" = "3827ce370b26af7cbf66acdf391267a0afa4092c" && echo HEAD-OK \
 && test -z "$(git status --porcelain)" && echo CLEAN \
 && ( cd field-ops-app-vite && npm ci && npm test && npm run lint && npm run typecheck \
      && npm run build:firebase && npm run verify:build-base ) \
 && grep -c "/Taylor_Parts/field-ops" field-ops-app-vite/dist/index.html
```
**Expected:** `HEAD-OK`, `CLEAN`, all scripts exit 0 (`verifyBuildBase: 12 passed`), and the final `grep -c` prints `0`. Any failure → STOP. **PAUSE.**

## Step 2 — Confirm project + Hosting-only scope

```bash
firebase use taylor-parts && firebase projects:list | grep taylor-parts \
 && cat firebase.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('HOSTING_PUBLIC', d['hosting']['public'])"
```
**Expected:** active project `taylor-parts`; `HOSTING_PUBLIC field-ops-app-vite/dist`. The deploy in Step 5 uses `--only hosting` (Hosting scope proven). **PAUSE.**

## Step 3 — Capture current Hosting release + rollback target

```bash
mkdir -p c1-evidence \
 && firebase hosting:releases:list --project taylor-parts 2>&1 | tee c1-evidence/predeploy-hosting-releases.txt \
 && firebase hosting:sites:list --project taylor-parts 2>&1 | tee c1-evidence/hosting-sites.txt
```
**Expected:** the current live release id/version is recorded (the rollback target). **Rollback procedure (tested intent):** `firebase hosting:rollback --project taylor-parts` (reverts to the immediately-previous release), or `firebase hosting:clone taylor-parts:<PREV_VERSION> taylor-parts:live`. Confirm a previous release exists to roll back to; if none, STOP. **No data/Rules/Functions change in a Hosting rollback.** **PAUSE.**

## Step 4 — Capture predeploy Rules + Functions inventories (unchanged-assertion baseline)

```bash
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/predeploy-live-firestore.rules \
 && echo -n "predeploy live Rules EXTRACTED-SOURCE sha256: " && sha256sum c1-evidence/predeploy-live-firestore.rules \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" | python3 -c "import sys,json;d=json.load(sys.stdin);print('FUNCTIONS_COUNT',len(d.get('functions',[])));[print('FN',f['name'].split('/')[-1]) for f in d.get('functions',[])]" | tee c1-evidence/predeploy-functions-inventory.txt
```
**Expected:** the live Rules extracted-source sha256 (should equal the governed
`cf6681c6…2bc381` from Stage B — records the pre-deploy Rules state) and the current
Functions inventory. These are the baselines Step 8 asserts unchanged. **PAUSE.**

## Step 5 — Deploy ONLY Hosting

```bash
firebase deploy --only hosting --project taylor-parts 2>&1 | tee c1-evidence/deploy-output.txt
```
**Expected:** `hosting: ... file upload complete`, `hosting: release complete`,
`Deploy complete!` — **nothing** about firestore/functions/indexes. If the output
mentions any non-Hosting target, STOP → the deploy scope was wrong. **PAUSE.**

## Step 6 — Verify the deployed release corresponds to the authorized C1 build

```bash
SITE_URL="https://taylor-parts.web.app" \
 && curl -s "$SITE_URL/index.html" > c1-evidence/postdeploy-live-index.html \
 && echo "live host-path occurrences (expect 0): $(grep -c "/Taylor_Parts/field-ops" c1-evidence/postdeploy-live-index.html)" \
 && echo "live references /assets (expect >=1): $(grep -c "/assets/" c1-evidence/postdeploy-live-index.html)" \
 && firebase hosting:releases:list --project taylor-parts 2>&1 | tee c1-evidence/postdeploy-hosting-releases.txt \
 && echo "fetch a referenced asset to confirm it serves JS (not the SPA HTML shell):" \
 && ASSET=$(grep -oE "/assets/[^\"]+\.js" c1-evidence/postdeploy-live-index.html | head -1) \
 && curl -s -o /dev/null -w "%{content_type}\n" "$SITE_URL$ASSET"
```
**Expected:** live `index.html` has **0** `/Taylor_Parts/field-ops` and references
`/assets/...`; a new release timestamp appears; the referenced `.js` asset serves with
a JavaScript content-type (not `text/html`). This confirms the C1 build (built from the
authorized commit with `build:firebase`) is live and assets resolve. **PAUSE.**

## Step 7 — Governed read-only production verification (C1 experience)

Using governed test personas (from the DPAPI vault; never printed/committed),
verify in a browser against `https://taylor-parts.web.app` — **read-only, no writes**:

For each **authorized Parts persona** (admin, dispatcher, PARTS_MANAGER,
WAREHOUSE_MANAGER):
- The Inventory > Parts workspace renders the **C1 PartsList** (governed catalog).
- The Parts Catalog shows **200 records accounted as 190 canonical matches + 10
  approved STATIC_ONLY_EXCLUDED** (spot-check totals + a couple of known excluded skus,
  e.g. TST-1047 / TST-1193, present and labeled).
- A catalog row's link routes to `/inventory/<sku>` (SKU/partId routing stable) and
  lands on **PartDetail unchanged** (pre-C2 source).
- Category filter, counts, and Global Search over parts work (search → route → detail).
- No write is issued; no Reorder Request is created during verification.

Fail-closed behavior (governed, read-only):
- A principal **without** canonical `parts` read access (e.g. a technician with no
  permitted operational role) sees the **BLOCKED** banner for the Parts Catalog —
  **not** an empty list and **not** static rows presented as canonical success.
- (If safely observable) an unavailable/incomplete canonical read likewise shows a
  BLOCKED state — never a silent static fallback.

Record **sanitized PASS/FAIL per persona/assertion only** — persona labels, PASS/FAIL,
counts. **Never** UID/email/token/reset link/raw records/screenshots of PII.

**STOP → ROLLBACK (Step 3 procedure)** on any: authorized persona does NOT get the C1
experience; totals != 190+10; a route is unstable or lands off PartDetail; a BLOCKED
condition renders static-as-success or an empty list; PartDetail changed; or any write/
Auth mutation would be required. Preserve all evidence on failure; do NOT repair
identities/roles/data/Rules/Functions/config — Hosting rollback only.

## Step 8 — Confirm Rules / Functions / indexes / data unchanged

```bash
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/postdeploy-live-firestore.rules \
 && diff c1-evidence/predeploy-live-firestore.rules c1-evidence/postdeploy-live-firestore.rules && echo RULES-UNCHANGED \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" | python3 -c "import sys,json;d=json.load(sys.stdin);print('FUNCTIONS_COUNT',len(d.get('functions',[])));[print('FN',f['name'].split('/')[-1]) for f in d.get('functions',[])]" > c1-evidence/postdeploy-functions-inventory.txt \
 && diff c1-evidence/predeploy-functions-inventory.txt c1-evidence/postdeploy-functions-inventory.txt && echo FUNCTIONS-UNCHANGED
```
**Expected:** `RULES-UNCHANGED` and `FUNCTIONS-UNCHANGED`. Indexes and Firestore data
are not deployed and are not touched by a Hosting deploy (assert scope by the Step 5
output). If either diff is non-empty, STOP and report (a Hosting deploy must not change
them). **PAUSE.**

## Step 9 — Package sanitized evidence

```bash
cd c1-evidence \
 && sha256sum * > SHA256SUMS.txt \
 && ( grep -riE "token|password|secret|bearer|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|eyJ[A-Za-z0-9_-]{10,}" . | grep -v SHA256SUMS.txt && echo "SENSITIVE-FOUND -- REDACT" || echo SENSITIVE-SCAN-CLEAN ) \
 && cd .. && tar czf inv-convergence-e-c1-hosting-deploy-evidence.tgz c1-evidence && sha256sum inv-convergence-e-c1-hosting-deploy-evidence.tgz
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + sha256 (record it). Evidence set:
predeploy/postdeploy hosting releases, deploy output, predeploy+postdeploy live Rules
source + sha + `RULES-UNCHANGED`, pre/post Functions inventory + `FUNCTIONS-UNCHANGED`,
postdeploy live index.html + asset content-type, sanitized per-persona C1 verification
matrix. Download for the Inventory-session evidence import PR. **DONE — report the
tarball + sanitized results.**

## Rollback (only on a Step 6/7/8 stop condition — Hosting only)

```bash
firebase hosting:rollback --project taylor-parts
```
Then re-run Step 6 and confirm the live release reverted to the Step 3 target. Report
immediately. **No** Firestore/Rules/Functions/identity change is part of a Hosting
rollback. Do not repair identities, roles, mappings, data, Rules, Functions, or
configuration — Hosting rollback only.

## After this handoff (Inventory session)

Import the sanitized evidence bundle byte-exact into
`docs/audits/inv-convergence-e-c1-hosting-deploy/` (with its own `SHA256SUMS.txt` + a
sensitive scan), record the C1 Hosting deployment as complete in `docs/SPRINT_STATUS.md`,
and open/update the governed evidence PR for independent repository review.

## Non-authorizations (explicit)

Hosting-only production deploy of C1 from `3827ce37`. **No** Rules/Functions/index/data
deploy or change; **no** Auth/identity/role/claim mutation; **no** Firestore write; **no**
PartDetail change; **no C2.** Decisions #43–#46 unchanged.
