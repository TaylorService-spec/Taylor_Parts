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
 && HP=$(grep -c "/Taylor_Parts/field-ops" field-ops-app-vite/dist/index.html || true) \
 && echo "host-path occurrences: $HP" && [ "$HP" = "0" ] && echo HOST-PATH-ZERO
```
**Expected:** `HEAD-OK`, `CLEAN`, all scripts exit 0 (`verifyBuildBase: 12 passed`), `host-path occurrences: 0`, then `HOST-PATH-ZERO`. (Note: `grep -c` exits nonzero on zero matches — it is wrapped in `|| true` and the count is asserted explicitly with `[ "$HP" = "0" ]`, so an expected-zero does not break the `&&` chain.) Any failure → STOP. **PAUSE.**

## Step 2 — Confirm project + Hosting-only scope

```bash
firebase use taylor-parts && firebase projects:list | grep taylor-parts \
 && cat firebase.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('HOSTING_PUBLIC', d['hosting']['public'])"
```
**Expected:** active project `taylor-parts`; `HOSTING_PUBLIC field-ops-app-vite/dist`. The deploy in Step 5 uses `--only hosting` (Hosting scope proven). **PAUSE.**

## Step 3 — Capture current Hosting release + pin the rollback VERSION ID (REST)

`firebase hosting:releases:list` and `firebase hosting:rollback` are **not** supported/
documented CLI commands — do not use them. Capture releases via the Firebase Hosting
**REST** `sites.releases.list` endpoint (or the authenticated Firebase console Release
History) and **pin the exact predeploy version ID**.

```bash
mkdir -p c1-evidence \
 && SITE=taylor-parts \
 && TOKEN=$(gcloud auth print-access-token) \
 # REST: sites.releases.list -> record the CURRENT live release + its version name/id
 && curl -s -H "Authorization: Bearer $TOKEN" \
      "https://firebasehosting.googleapis.com/v1beta1/sites/$SITE/releases?pageSize=10" \
      > c1-evidence/predeploy-hosting-releases.json \
 && python3 -c "import json;d=json.load(open('c1-evidence/predeploy-hosting-releases.json'));r=d.get('releases',[]);cur=r[0] if r else None;print('CURRENT_RELEASE_NAME',(cur or {}).get('name'));print('CURRENT_VERSION_NAME',((cur or {}).get('version') or {}).get('name'));print('RELEASE_TIME',(cur or {}).get('releaseTime'))" | tee c1-evidence/predeploy-release-pin.txt
```
**Expected:** `predeploy-hosting-releases.json` captured; `CURRENT_VERSION_NAME` is a
concrete version resource name like `sites/taylor-parts/versions/<VERSION_ID>`. **Record
that exact `<VERSION_ID>` — it is the pinned rollback target** (do NOT rely on
"immediately previous" without pinning its ID). If no prior version exists, **STOP** (no
rollback target). (Console alternative: Hosting → Release History → note the exact
current version, which becomes the pinned rollback target.) **PAUSE.**

**Pinned rollback procedure (one verified method, only on a Step 6/7/8 stop condition):**
- **Console:** Release History → select the pinned prior version → **Roll back**; or
- **Exact-version clone:**
  `firebase hosting:clone taylor-parts:@<VERSION_ID> taylor-parts:live --project taylor-parts`
  using the `<VERSION_ID>` pinned above. **No data/Rules/Functions/identity change** in a
  Hosting version clone.

## Step 4 — Capture predeploy Rules + Functions inventories (unchanged-assertion baseline)

```bash
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/predeploy-live-firestore.rules \
 && echo -n "predeploy live Rules EXTRACTED-SOURCE sha256: " && sha256sum c1-evidence/predeploy-live-firestore.rules \
 # Functions: reuse the GOVERNED normalized-inventory tooling (identity/generation/
 # region/runtime/service/trigger, service-account email hashed) -> hash the normalized
 # form. The RAW payload (contains service-account emails) is NOT committed.
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > /tmp/predeploy-functions-raw.json \
 && node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync("/tmp/predeploy-functions-raw.json","utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c1-evidence/predeploy-functions-inventory.normalized.json",j);console.log("predeploy functions NORMALIZED sha256:",s.sha256(j));' | tee c1-evidence/predeploy-functions-normalized.sha256 \
 && rm -f /tmp/predeploy-functions-raw.json
```
**Expected:** the live Rules extracted-source sha256 (should equal the governed
`cf6681c6…2bc381` from Stage B — records the pre-deploy Rules state), and a
`predeploy-functions-inventory.normalized.json` + its sha256. The normalized inventory
(via the governed `normalizeFunctionsInventory`) is deterministic and includes each
function's name, environment, state, updateTime, build (entryPoint/runtime), a HASHED
service-account identity, and event-trigger (type/region) — sorted by name. These are
the baselines Step 8 asserts unchanged. The raw Functions payload is deleted (it
contains service-account emails; only the normalized, email-hashed form is kept).
**PAUSE.**

## Step 5 — Deploy ONLY Hosting

```bash
firebase deploy --only hosting --project taylor-parts 2>&1 | tee c1-evidence/deploy-output.txt
```
**Expected:** `hosting: ... file upload complete`, `hosting: release complete`,
`Deploy complete!` — **nothing** about firestore/functions/indexes. If the output
mentions any non-Hosting target, STOP → the deploy scope was wrong. **PAUSE.**

## Step 6 — Verify the deployed release corresponds to the authorized C1 build

Asset health (`/assets` path + JS content-type) alone does **not** bind the live
release to the authorized C1 build. Record the full correspondence chain: source
commit → clean build command → deterministic local artifact manifest → deploy
output/version ID → live asset names/hashes.

```bash
SITE=taylor-parts && SITE_URL="https://taylor-parts.web.app" \
 && TOKEN=$(gcloud auth print-access-token) \
 # (a) deterministic LOCAL artifact manifest from the just-built dist (the operator's
 #     Cloud Shell/Linux build of the authorized commit via build:firebase):
 && ( cd field-ops-app-vite && (cd dist && find . -type f | sort | while read f; do echo "$(sha256sum "$f" | cut -d' ' -f1)  ${f#./}"; done) ) > c1-evidence/local-dist-manifest.sha256 \
 && echo "AUTHORIZED_COMMIT=3827ce370b26af7cbf66acdf391267a0afa4092c" | tee c1-evidence/release-correspondence.txt \
 && echo "BUILD_COMMAND=npm run build:firebase (vite build --base=/)" | tee -a c1-evidence/release-correspondence.txt \
 # (b) REST sites.releases.list -> the NEW current release + version id (post-deploy):
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebasehosting.googleapis.com/v1beta1/sites/$SITE/releases?pageSize=5" > c1-evidence/postdeploy-hosting-releases.json \
 && python3 -c "import json;d=json.load(open('c1-evidence/postdeploy-hosting-releases.json'));r=(d.get('releases') or [{}])[0];print('POSTDEPLOY_RELEASE_NAME',r.get('name'));print('POSTDEPLOY_VERSION_NAME',(r.get('version') or {}).get('name'));print('POSTDEPLOY_RELEASE_TIME',r.get('releaseTime'))" | tee -a c1-evidence/release-correspondence.txt \
 # (c) live index.html + asset resolution + live asset hash (caching/encoding permitting):
 && curl -s "$SITE_URL/index.html" > c1-evidence/postdeploy-live-index.html \
 && HP=$(grep -c "/Taylor_Parts/field-ops" c1-evidence/postdeploy-live-index.html || true) && echo "live host-path occurrences: $HP" && [ "$HP" = "0" ] && echo LIVE-HOST-PATH-ZERO \
 && ASSET=$(grep -oE "/assets/[^\"]+\.js" c1-evidence/postdeploy-live-index.html | head -1) && echo "live JS asset: $ASSET" \
 && echo "content-type: $(curl -s -o c1-evidence/postdeploy-live-asset.js -w '%{content_type}' "$SITE_URL$ASSET")" \
 && echo "live asset sha256: $(sha256sum c1-evidence/postdeploy-live-asset.js | cut -d' ' -f1)" | tee -a c1-evidence/release-correspondence.txt
```
**Expected & correspondence assertions (record all in `release-correspondence.txt`):**
- `AUTHORIZED_COMMIT` = `3827ce37…`; `BUILD_COMMAND` = `build:firebase`.
- A **new** `POSTDEPLOY_VERSION_NAME` / `POSTDEPLOY_RELEASE_TIME` distinct from the
  Step 3 pinned predeploy version (proves a release occurred).
- `LIVE-HOST-PATH-ZERO`; live `index.html` references `/assets/...`; the referenced
  `.js` serves a JavaScript content-type (not `text/html`).
- The live JS asset filename appears in the **local dist manifest**
  (`local-dist-manifest.sha256`) built from the authorized commit; where CDN
  caching/content-encoding does not alter bytes, the live asset sha256 equals the
  local manifest entry. **Any OS/encoding-dependent hash difference must be explained
  in writing** (e.g. gzip/br transfer-encoding, or a Windows-vs-Linux CRLF source
  delta — note that the operator's build is Linux Cloud Shell, so the deployed bytes
  are the Linux build, and the local Windows preflight manifest is informational only;
  the operator's own Cloud Shell dist manifest is the authoritative local reference).
- If a new release did not appear, or the live bundle does not correspond to the
  authorized-commit build, **STOP → ROLLBACK.** **PAUSE.**

## Step 7 — Governed read-only production verification (C1 experience)

Using governed test personas (from the DPAPI vault; never printed/committed),
verify in a browser against `https://taylor-parts.web.app` — **read-only, no writes**:

**Note:** PartsList does **not** render identity-state labels — `CANONICAL_MATCH` /
`STATIC_ONLY_EXCLUDED` are internal classifications, NOT visible UI text. The browser
proves *observable* behavior only; the 190+10 governed composition is proven separately
by the adapter/tests (below). Do not instruct the operator to "see" an invisible label.

### 7a. Browser verification (observable behavior only) — per authorized persona
For each authorized Parts persona (admin, dispatcher, PARTS_MANAGER, WAREHOUSE_MANAGER):
- The Inventory > Parts workspace renders the **C1 PartsList** (the governed catalog,
  not a loading/blocked state).
- The Parts Catalog shows a **total of 200 records** (the "All Categories" count / row
  total across pages = 200).
- **Known approved-exclusion SKUs are present and reachable** — spot-check e.g.
  `TST-1047` and `TST-1193` appear as normal catalog rows (they are visible, not hidden;
  no visible "excluded" label is expected or required).
- A catalog row's link routes to `/inventory/<sku>` and lands on **PartDetail
  unchanged** (pre-C2 source); SKU/partId routing stable.
- Category filter, counts, and Global Search over parts work (search → route → detail).
- **No write** is issued; no Reorder Request is created.

Fail-closed (observable): a principal **without** canonical `parts` read access (e.g. a
technician with no permitted operational role) sees the **BLOCKED banner** for the Parts
Catalog — **not** an empty list and **not** static rows shown as if canonical.

### 7b. Governed composition evidence (proves the invisible 190+10 classification)
The **190 canonical matches + 10 approved STATIC_ONLY_EXCLUDED** classification is an
adapter-internal fact, proven — not by the browser — by the committed governed tests
against the production read-back: `field-ops-app-vite/test/partsCatalogView.test.mjs`
(23/23) and `partsCompatibilityAdapter.test.mjs` (200 static / 190 canonical-match / 10
static-only / 0 divergence), plus the Decision #46 live shadow-parity. Cite these as the
composition evidence; do **not** claim the browser directly proves the classification.

Record **sanitized PASS/FAIL per persona/assertion only** (labels, PASS/FAIL, the 200
total, the two spot-check SKUs present, route→PartDetail stable, BLOCKED for the
unauthorized persona). **Never** UID/email/reset link/JWT/raw records/PII screenshots.

**STOP → ROLLBACK (Step 3 pinned-version procedure)** on any: authorized persona does
NOT get the C1 PartsList; total != 200; a known exclusion SKU is missing/hidden; a route
is unstable or lands off PartDetail; the unauthorized persona sees static-as-success or
an empty list instead of BLOCKED; PartDetail changed; or any write/Auth mutation would be
required. Preserve all evidence on failure; do NOT repair identities/roles/data/Rules/
Functions/config — Hosting version-clone rollback only.

## Step 8 — Confirm Rules / Functions / indexes / data unchanged

```bash
TOKEN=$(gcloud auth print-access-token) \
 && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") \
 && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/postdeploy-live-firestore.rules \
 && diff c1-evidence/predeploy-live-firestore.rules c1-evidence/postdeploy-live-firestore.rules && echo RULES-UNCHANGED \
 # Functions: normalized-inventory hash compare (same governed tooling as Step 4):
 && curl -s -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > /tmp/postdeploy-functions-raw.json \
 && node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync("/tmp/postdeploy-functions-raw.json","utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c1-evidence/postdeploy-functions-inventory.normalized.json",j);console.log("postdeploy functions NORMALIZED sha256:",s.sha256(j));' | tee c1-evidence/postdeploy-functions-normalized.sha256 \
 && rm -f /tmp/postdeploy-functions-raw.json \
 && diff c1-evidence/predeploy-functions-inventory.normalized.json c1-evidence/postdeploy-functions-inventory.normalized.json && echo FUNCTIONS-NORMALIZED-IDENTICAL \
 && test "$(cut -d: -f2 c1-evidence/predeploy-functions-normalized.sha256 | tr -d ' ')" = "$(cut -d: -f2 c1-evidence/postdeploy-functions-normalized.sha256 | tr -d ' ')" && echo FUNCTIONS-UNCHANGED
```
**Expected:** `RULES-UNCHANGED`, `FUNCTIONS-NORMALIZED-IDENTICAL`, and
`FUNCTIONS-UNCHANGED` — the pre/post **normalized** Functions inventories (identity,
generation/state, updateTime, runtime/build, hashed service-account identity, trigger
config; via the governed `normalizeFunctionsInventory`) are byte-identical and their
sha256 match, so no function was redeployed/reconfigured. Indexes and Firestore data are
not deployed by a Hosting deploy (scope asserted by the Step 5 output). If any diff/hash
differs, STOP and report (a Hosting deploy must not change Rules/Functions). **PAUSE.**

## Step 9 — Package sanitized evidence

Use the **governed evidence scanner** (`assertEvidenceSecretFree` / `SECRET_PATTERN`
from `functions/scripts/firestoreDeploymentVerificationShared.js`) — it targets actual
credential/identity STRUCTURES (`AIza…` API keys, JWT `eyJ….ey….` patterns, `password`,
`refreshToken`, `idToken`, `email`) and deliberately does **not** match the generic word
`token` (legitimate Rules source contains token-related identifiers, which would false-
positive). Do not reintroduce a generic-keyword grep.

```bash
cd c1-evidence \
 && sha256sum * > SHA256SUMS.txt \
 # governed structured scan over every evidence file (no false-positive keywords):
 && node -e 'const s=require("../functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");let bad=[];for(const f of fs.readdirSync(".")){const t=fs.readFileSync(f,"utf8");try{s.assertEvidenceSecretFree(t);}catch(e){bad.push(f);}}if(bad.length){console.log("SENSITIVE-FOUND -- REDACT:",bad.join(", "));process.exit(1);}console.log("SENSITIVE-SCAN-CLEAN");' \
 && cd .. && tar czf inv-convergence-e-c1-hosting-deploy-evidence.tgz c1-evidence && sha256sum inv-convergence-e-c1-hosting-deploy-evidence.tgz
```
Note: the governed `SECRET_PATTERN` matches the literal substring `email`; the
normalized Functions inventory deliberately **hashes** service-account emails
(`serviceAccountIdentityHash`) and the raw payload is discarded (Steps 4/8), so the
committed evidence contains no raw email. If the scan flags a file, redact/hash the
offending value before committing — never commit the raw secret/identity.
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + sha256 (record it). Evidence set:
predeploy/postdeploy hosting releases (REST JSON) + the pinned version IDs
(`predeploy-release-pin.txt`, `release-correspondence.txt`); deploy output;
predeploy+postdeploy live Rules extracted-source + sha + `RULES-UNCHANGED`;
predeploy+postdeploy **normalized** Functions inventory JSON + sha256 +
`FUNCTIONS-NORMALIZED-IDENTICAL`/`FUNCTIONS-UNCHANGED`; `local-dist-manifest.sha256` +
postdeploy live index.html + live asset content-type/hash (release-to-build
correspondence); sanitized per-persona C1 browser matrix (7a) + citations to the
governed composition tests (7b). Download for the Inventory-session evidence import PR.
**DONE — report the tarball + sanitized results.**

## Rollback (only on a Step 6/7/8 stop condition — Hosting only, pinned version)

Do **not** use `firebase hosting:rollback` (unsupported). Use one verified method with
the **exact `<VERSION_ID>` pinned in Step 3**:

- **Console:** Hosting → Release History → select the pinned prior version → **Roll back**; or
- **Exact-version clone:**
  ```bash
  firebase hosting:clone taylor-parts:@<VERSION_ID> taylor-parts:live --project taylor-parts
  ```

Then re-run Step 6's live checks and confirm the live release matches the pinned Step 3
predeploy version. Report immediately. **No** Firestore/Rules/Functions/identity change
is part of a Hosting version clone. Do not repair identities, roles, mappings, data,
Rules, Functions, or configuration — Hosting version rollback only.

## After this handoff (Inventory session)

Import the sanitized evidence bundle byte-exact into
`docs/audits/inv-convergence-e-c1-hosting-deploy/` (with its own `SHA256SUMS.txt` + a
sensitive scan), record the C1 Hosting deployment as complete in `docs/SPRINT_STATUS.md`,
and open/update the governed evidence PR for independent repository review.

## Non-authorizations (explicit)

Hosting-only production deploy of C1 from `3827ce37`. **No** Rules/Functions/index/data
deploy or change; **no** Auth/identity/role/claim mutation; **no** Firestore write; **no**
PartDetail change; **no C2.** Decisions #43–#46 unchanged.
