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

Sequential script (no comments inside `&&` chains; `set -euo pipefail`). The raw REST
response may carry operator identity/email metadata, so it is fetched to `/tmp`, only
approved fields are normalized into evidence, and the raw response is deleted.

```bash
set -euo pipefail
RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT
mkdir -p c1-evidence
SITE=taylor-parts
TOKEN=$(gcloud auth print-access-token)
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/$SITE/releases?pageSize=10" \
  > "$RAW"
RAW="$RAW" python3 - <<'PY'
import json, os, re
VER_RE = re.compile(r"^sites/taylor-parts/versions/[A-Za-z0-9][A-Za-z0-9._-]*$")
REL_RE = re.compile(r"^sites/taylor-parts/releases/[A-Za-z0-9][A-Za-z0-9._-]*$")
TS_RE  = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
TYPES  = {"DEPLOY", "ROLLBACK", "SITE_DISABLE"}
def validate_release(rec, label):
    vn = rec.get("version_name"); assert isinstance(vn, str) and VER_RE.match(vn), f"{label} version_name malformed/incomplete/wrong-project: {vn!r}"
    rn = rec.get("release_name"); assert isinstance(rn, str) and REL_RE.match(rn), f"{label} release_name malformed: {rn!r}"
    rt = rec.get("release_type"); assert isinstance(rt, str) and rt in TYPES, f"{label} release_type unsupported/empty: {rt!r}"
    tt = rec.get("release_time"); assert isinstance(tt, str) and TS_RE.match(tt), f"{label} release_time invalid/empty: {tt!r}"
d = json.load(open(os.environ["RAW"]))
r = d.get("releases") or []
cur = r[0] if r else {}
rec = {
    "release_name": cur.get("name"),
    "version_name": (cur.get("version") or {}).get("name"),
    "release_type": cur.get("type"),
    "release_time": cur.get("releaseTime"),
}
validate_release(rec, "predeploy")
open("c1-evidence/predeploy-release-pin.json", "w").write(json.dumps(rec, indent=2))
print("CURRENT_VERSION_NAME", rec["version_name"])
print("CURRENT_RELEASE_TYPE", rec["release_type"])
print("CURRENT_RELEASE_TIME", rec["release_time"])
print("PREDEPLOY-RELEASE-FIELDS-VALID")
PY
```
**Expected:** `PREDEPLOY-RELEASE-FIELDS-VALID` prints and `c1-evidence/predeploy-release-pin.json`
contains the four normalized fields, each strictly validated (script exits nonzero
otherwise): `release_name` matches `^sites/taylor-parts/releases/<non-empty-id>$`;
`version_name` matches `^sites/taylor-parts/versions/<non-empty-id>$` (exact project +
non-empty version id — null/empty/wrong-project/incomplete all fail closed);
`release_type` ∈ {DEPLOY, ROLLBACK, SITE_DISABLE}; `release_time` is a valid RFC3339
timestamp. **Record that exact `<VERSION_ID>` — the pinned rollback target** (do NOT rely
on "immediately previous" without pinning its ID).
If no prior version exists, **STOP** (no rollback target). The raw REST response is
deleted (never committed). (Console alternative: Hosting → Release History → note the
exact current version.) **PAUSE.**

**Pinned rollback procedure (one verified method, only on a Step 6/7/8 stop condition):**
- **Console:** Release History → select the pinned prior version → **Roll back**; or
- **Exact-version clone:**
  `firebase hosting:clone taylor-parts:@<VERSION_ID> taylor-parts:live --project taylor-parts`
  using the `<VERSION_ID>` pinned above. **No data/Rules/Functions/identity change** in a
  Hosting version clone.

## Step 4 — Capture predeploy Rules + Functions inventories (unchanged-assertion baseline)

Sequential script. Rules extracted-source captured to evidence; Functions captured raw
to `/tmp` then reduced to the governed normalized (email-hashed) inventory — the raw
Functions payload (contains service-account emails) is deleted, never committed.

```bash
set -euo pipefail
FRAW=$(mktemp)
trap 'rm -f "$FRAW"' EXIT
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/predeploy-live-firestore.rules
echo "predeploy live Rules EXTRACTED-SOURCE sha256:"
sha256sum c1-evidence/predeploy-live-firestore.rules
curl -fsS -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > "$FRAW"
FRAW="$FRAW" node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync(process.env.FRAW,"utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c1-evidence/predeploy-functions-inventory.normalized.json",j);console.log("predeploy functions NORMALIZED sha256:",s.sha256(j));'
```
**Expected:** the live Rules extracted-source sha256 (should equal the governed
`cf6681c6…2bc381` from Stage B — records the pre-deploy Rules state), and
`c1-evidence/predeploy-functions-inventory.normalized.json` + its sha256. The normalized
inventory (via the governed `normalizeFunctionsInventory`) is deterministic — name,
environment, state, updateTime, build (entryPoint/runtime), a HASHED service-account
identity, and event-trigger (type/region), sorted by name. Baselines for Step 8. The
raw Functions payload is deleted (never committed). **PAUSE.**

## Step 5 — Deploy ONLY Hosting

```bash
set -euo pipefail
firebase deploy --only hosting --project taylor-parts 2>&1 | tee c1-evidence/deploy-output.txt
```
(`set -euo pipefail` + `pipefail` means a nonzero `firebase deploy` exit fails the block
even through the `tee` pipe.)
**Expected:** `hosting: ... file upload complete`, `hosting: release complete`,
`Deploy complete!` — **nothing** about firestore/functions/indexes. If the output
mentions any non-Hosting target, STOP → the deploy scope was wrong. **PAUSE.**

## Step 6 — Verify the deployed release corresponds to the authorized C1 build

Asset health (`/assets` path + JS content-type) alone does **not** bind the live
release to the authorized C1 build. Record the full correspondence chain: source
commit → clean build command → deterministic local artifact manifest → deploy
output/version ID → live asset names/hashes.

Sequential script. The postdeploy release JSON is fetched to `/tmp` and reduced to
approved fields (may carry operator identity). The live JS bundle (may contain the
Firebase web API key) is fetched to `/tmp`, reduced to path/content-type/byte-count/
sha256, and its bytes deleted — the bundle is never committed. `index.html` (config-
free SPA shell) is retained.

```bash
set -euo pipefail
PRAW=$(mktemp)
ASSETTMP=$(mktemp)
trap 'rm -f "$PRAW" "$ASSETTMP"' EXIT
SITE=taylor-parts
SITE_URL="https://taylor-parts.web.app"
TOKEN=$(gcloud auth print-access-token)
( cd field-ops-app-vite/dist && find . -type f | sort | while read -r f; do echo "$(sha256sum "$f" | cut -d' ' -f1)  ${f#./}"; done ) > c1-evidence/local-dist-manifest.sha256
echo "AUTHORIZED_COMMIT=3827ce370b26af7cbf66acdf391267a0afa4092c" > c1-evidence/release-correspondence.txt
echo "BUILD_COMMAND=npm run build:firebase (vite build --base=/)" >> c1-evidence/release-correspondence.txt
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebasehosting.googleapis.com/v1beta1/sites/$SITE/releases?pageSize=5" > "$PRAW"
PRAW="$PRAW" python3 - <<'PY'
import json, os, re
VER_RE = re.compile(r"^sites/taylor-parts/versions/[A-Za-z0-9][A-Za-z0-9._-]*$")
REL_RE = re.compile(r"^sites/taylor-parts/releases/[A-Za-z0-9][A-Za-z0-9._-]*$")
TS_RE  = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
TYPES  = {"DEPLOY", "ROLLBACK", "SITE_DISABLE"}
def validate_release(rec, label):
    vn = rec.get("version_name"); assert isinstance(vn, str) and VER_RE.match(vn), f"{label} version_name malformed/incomplete/wrong-project: {vn!r}"
    rn = rec.get("release_name"); assert isinstance(rn, str) and REL_RE.match(rn), f"{label} release_name malformed: {rn!r}"
    rt = rec.get("release_type"); assert isinstance(rt, str) and rt in TYPES, f"{label} release_type unsupported/empty: {rt!r}"
    tt = rec.get("release_time"); assert isinstance(tt, str) and TS_RE.match(tt), f"{label} release_time invalid/empty: {tt!r}"
d = json.load(open(os.environ["PRAW"]))
r = (d.get("releases") or [{}])[0]
rec = {
    "release_name": r.get("name"),
    "version_name": (r.get("version") or {}).get("name"),
    "release_type": r.get("type"),
    "release_time": r.get("releaseTime"),
}
validate_release(rec, "postdeploy")
pre = json.load(open("c1-evidence/predeploy-release-pin.json"))
validate_release(pre, "predeploy(reloaded)")
assert rec["version_name"] != pre["version_name"], "postdeploy version equals the pinned predeploy version -- no new release occurred"
open("c1-evidence/postdeploy-release-pin.json", "w").write(json.dumps(rec, indent=2))
with open("c1-evidence/release-correspondence.txt", "a") as f:
    for k, v in rec.items():
        f.write(f"POSTDEPLOY_{k.upper()}={v}\n")
print("POSTDEPLOY_VERSION_NAME", rec["version_name"])
print("POSTDEPLOY-RELEASE-FIELDS-VALID")
print("NEW-RELEASE-CONFIRMED")
PY
# identity encoding only (no --compressed) so live bytes == deployed file bytes
curl -fsS "$SITE_URL/index.html" > c1-evidence/postdeploy-live-index.html
HP=$(grep -c "/Taylor_Parts/field-ops" c1-evidence/postdeploy-live-index.html || true)
echo "live host-path occurrences: $HP"
[ "$HP" = "0" ] || { echo "FAIL: live host-path present"; exit 1; }
echo LIVE-HOST-PATH-ZERO
ASSET=$(grep -oE "/assets/[^\"]+\.js" c1-evidence/postdeploy-live-index.html | head -1)
[ -n "$ASSET" ] || { echo "FAIL: no JS asset path found in live index.html"; exit 1; }
echo "live JS asset: $ASSET"
CT=$(curl -fsS -o "$ASSETTMP" -w '%{content_type}' "$SITE_URL$ASSET")
case "$CT" in *javascript*) : ;; *) echo "FAIL: live asset content-type not JavaScript: $CT"; exit 1;; esac
BYTES=$(wc -c < "$ASSETTMP")
HASH=$(sha256sum "$ASSETTMP" | cut -d' ' -f1)
MANIFEST_HASH=$(awk -v p="assets/${ASSET#/assets/}" '$2==p{print $1}' c1-evidence/local-dist-manifest.sha256)
[ -n "$MANIFEST_HASH" ] || { echo "FAIL: live asset path $ASSET not in the Cloud Shell build manifest"; exit 1; }
[ "$HASH" = "$MANIFEST_HASH" ] || { echo "FAIL: live asset sha256 != deployed-build manifest hash (live=$HASH manifest=$MANIFEST_HASH)"; exit 1; }
echo LIVE-ASSET-EQUALS-BUILD-MANIFEST
printf 'LIVE_ASSET_PATH=%s\nLIVE_ASSET_CONTENT_TYPE=%s\nLIVE_ASSET_BYTES=%s\nLIVE_ASSET_SHA256=%s\nMANIFEST_MATCH=EXACT\n' "$ASSET" "$CT" "$BYTES" "$HASH" >> c1-evidence/release-correspondence.txt
echo "live asset: $ASSET  ct=$CT  bytes=$BYTES  sha256=$HASH  (== build manifest)"
```
The script above enforces these as **hard assertions** (any failure exits nonzero under
`set -euo pipefail` → STOP → ROLLBACK). Committed evidence is only the sanitized
`release-correspondence.txt`, `*-release-pin.json`, `local-dist-manifest.sha256`, and
`postdeploy-live-index.html` — no raw release JSON, no bundle bytes.
- `AUTHORIZED_COMMIT` = `3827ce37…`; `BUILD_COMMAND` = `build:firebase`.
- **`NEW-RELEASE-CONFIRMED`** — `POSTDEPLOY_VERSION_NAME` is a concrete `sites/.../versions/<ID>`
  and **differs** from the Step 3 pinned predeploy version (asserted in-script).
- **`LIVE-HOST-PATH-ZERO`** — live `index.html` has zero GitHub-Pages host paths and
  references `/assets/...` (asserted; a nonzero count exits nonzero).
- A live JS asset path was found (asserted non-empty) and its `LIVE_ASSET_CONTENT_TYPE`
  is a JavaScript type, not `text/html` (asserted via a `case` guard).
- **`LIVE-ASSET-EQUALS-BUILD-MANIFEST`** — the live asset path exists in the authoritative
  Cloud Shell `local-dist-manifest.sha256` **and** its live SHA-256 **exactly equals** the
  deployed-build manifest hash for that path (asserted). The live bytes are fetched with
  identity encoding (no `--compressed`), so they are the deployed file bytes. **A mismatch
  is a hard STOP → ROLLBACK — no OS/encoding explanation is permitted** between the Cloud
  Shell-built artifact and the live bytes (the operator builds and deploys on the same
  Linux Cloud Shell, so the deployed bytes must equal the manifest exactly).
- Any assertion failure → **STOP → ROLLBACK (Step 3 pinned version).** **PAUSE.**

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

Fail-closed (observable) — a principal **without** canonical `parts` read access (e.g. a
technician with no permitted operational role). **Either outcome is valid fail-closed
behavior; accept whichever the app produces:**
- (i) the application denies the Inventory workspace/route entirely (nav/access control),
  exposing **no** Parts data; **or**
- (ii) direct workspace access reaches PartsList and shows the **BLOCKED catalog banner**.

In **both** cases prove: the canonical `parts` read is denied; **no static catalog is
presented as successful canonical data**; and **no write occurs**. Do **not** require a
BLOCKED banner when the app correctly denies the whole workspace.

### 7b. Governed composition evidence (proves the invisible 190+10 classification)
The **190 canonical matches + 10 approved STATIC_ONLY_EXCLUDED** classification is an
adapter-internal fact, proven — not by the browser — by the committed governed tests
against the production read-back: `field-ops-app-vite/test/partsCatalogView.test.mjs`
(23/23) and `partsCompatibilityAdapter.test.mjs` (200 static / 190 canonical-match / 10
static-only / 0 divergence), plus the Decision #46 live shadow-parity. Cite these as the
composition evidence; do **not** claim the browser directly proves the classification.

Record **sanitized PASS/FAIL per persona/assertion only** (labels, PASS/FAIL, the 200
total, the two spot-check SKUs present, route→PartDetail stable, and the unauthorized
persona's fail-closed outcome — workspace-denied OR BLOCKED). **Never** UID/email/reset
link/JWT/raw records/PII screenshots.

**STOP → ROLLBACK (Step 3 pinned-version procedure)** on any: authorized persona does
NOT get the C1 PartsList; total != 200; a known exclusion SKU is missing/hidden; a route
is unstable or lands off PartDetail; the unauthorized persona sees **static-as-success or
an empty list** (instead of workspace-denied OR the BLOCKED banner); PartDetail changed;
or any write/Auth mutation would be required. Preserve all evidence on failure; do NOT
repair identities/roles/data/Rules/Functions/config — Hosting version-clone rollback only.

## Step 8 — Confirm Rules / Functions / indexes / data unchanged

```bash
set -euo pipefail
FRAW=$(mktemp)
trap 'rm -f "$FRAW"' EXIT
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c1-evidence/postdeploy-live-firestore.rules
diff c1-evidence/predeploy-live-firestore.rules c1-evidence/postdeploy-live-firestore.rules
echo RULES-UNCHANGED
curl -fsS -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > "$FRAW"
FRAW="$FRAW" node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync(process.env.FRAW,"utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c1-evidence/postdeploy-functions-inventory.normalized.json",j);console.log("postdeploy functions NORMALIZED sha256:",s.sha256(j));'
diff c1-evidence/predeploy-functions-inventory.normalized.json c1-evidence/postdeploy-functions-inventory.normalized.json
echo FUNCTIONS-NORMALIZED-IDENTICAL
echo FUNCTIONS-UNCHANGED
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

Sequential script: first assert no raw/forbidden artifact remains (raw REST/Functions
payloads, live bundle, access tokens), then run the governed structured scanner over the
normalized text/JSON evidence, then regenerate checksums and package.

```bash
set -euo pipefail
cd c1-evidence
FORBIDDEN=$(ls | grep -E "raw|-asset\.js$|\.tgz$|token" || true)
if [ -n "$FORBIDDEN" ]; then echo "FORBIDDEN-ARTIFACT-PRESENT: $FORBIDDEN"; exit 1; fi
echo "NO-RAW-OR-BUNDLE-ARTIFACTS"
node -e 'const s=require("../functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");let bad=[];for(const f of fs.readdirSync(".")){if(f==="SHA256SUMS.txt"||!fs.statSync(f).isFile())continue;const t=fs.readFileSync(f,"utf8");try{s.assertEvidenceSecretFree(t);}catch(e){bad.push(f);}}if(bad.length){console.log("SENSITIVE-FOUND -- REDACT:",bad.join(", "));process.exit(1);}console.log("SENSITIVE-SCAN-CLEAN");'
rm -f SHA256SUMS.txt
find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -printf '%P\n' | sort | xargs -r sha256sum > SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt
cd ..
tar czf inv-convergence-e-c1-hosting-deploy-evidence.tgz c1-evidence
sha256sum inv-convergence-e-c1-hosting-deploy-evidence.tgz
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
