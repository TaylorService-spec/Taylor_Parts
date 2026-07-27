# INV-CONVERGENCE-E C2 — Hosting-only Production Deployment Handoff (Cloud Shell)

**Unit:** deploy the merged **C2 PartDetail cutover** frontend to Firebase **Hosting
only**, verify the deployed experience read-only, preserve rollback. **Operator-executed**
in Cloud Shell / an approved credentialed environment; prepared by the Inventory session.
The Inventory session holds **no production credentials** and performs **no** `firebase
deploy`, **no** live production reads, and **no** production mutation of any kind — those
are operator actions. This document is the operator runbook; the Inventory session imports
the returned sanitized evidence.

> **STATUS: PREPARED — NOT AUTHORIZED TO EXECUTE.** This runbook is under Codex review.
> **Production deployment requires a separate, explicit Owner authorization** naming the
> exact commit, granted **after** this runbook passes review. Nothing below may be run
> until then.

**Project:** `taylor-parts` · **Scope:** Hosting only · **Merged C2 source:**
`2d08e2e495448e6f0bb523a58675c195a805c13e`

Precedents: the C1 Hosting deploy handoff (this runbook's parent — pinned-version
rollback, self-derived pre/post inventories, sanitized evidence) and the I-1 hosting
deploy (`build:firebase` base=`/` gotcha).

**What is new in C2 versus C1** (all four are Owner requirements for this gate):

1. **Step 5 — fresh live parity immediately before deployment.** C1 relied on the
   Decision #46 Stage A parity. C2 runs a live parity check against the canonical
   collection *minutes before* the deploy, and a non-PASS **blocks the deploy**.
2. **Direct PartDetail browser verification (Step 8).** C1's per-persona rendered
   behavior was *inferred* from bundle equality + live REST reads, which Codex correctly
   flagged as not directly observed. C2's two ratified decisions are **directly visible**
   in a browser, so this runbook observes them per persona and says exactly which claims
   the browser does and does not establish.
3. **Exact build/commit correspondence including the deploy-commit question** (§0.1).
4. **Automatic evidence sanitization** — the scan is a scripted gate, not a manual step.

---

## 0. Local preflight (already performed by the Inventory session — credential-free)

From a clean checkout of this prep branch (`field-ops-app-vite/`), all green:

- `npm ci` → exit 0.
- `npm test` (full client chain, **168** assertions incl. `partDetailView` 34/34,
  `partsCatalogView` 23/23, **`c2LiveParity` 15/15**) → exit 0.
- `npm run lint` (oxlint) → exit 0 (pre-existing react-refresh warnings only; **zero**
  findings in the new files).
- `npm run typecheck` (tsc --noEmit) → exit 0.
- `npm run build:firebase` (`vite build --base=/`) → exit 0.
- `npm run verify:build-base` → **12 passed, 0 failed**.
- `dist/index.html` references `/assets/...` with **0** `/Taylor_Parts/field-ops`
  occurrences (Firebase base correct — the I-1F fix holds).
- Governed root `firestore.rules` **Git/LF** sha256 at `2d08e2e` =
  `cf6681c61f7c93a6b5b5385212518636b855b24a751225564429e0f8932bc381` — **identical to the
  value C1 recorded**, confirming **C2 changed no Rules**. Used only for the post-deploy
  "Rules unchanged" assertion, never for a Rules deploy.
  (Compute with `git show HEAD:firestore.rules | sha256sum` — a Windows CRLF working-copy
  hash will differ and is not the governed value.)

**⚠ Build command:** the Firebase Hosting build MUST be `npm run build:firebase`
(base `/`). `npm run build` uses the GitHub-Pages base `/Taylor_Parts/field-ops/` and
would 404 all assets on the Firebase site (the original I-1 blank-site bug).

### 0.1 Which commit is deployed — resolved

The C2 application code was merged at **`2d08e2e`**. This runbook and the Step 5 parity
tool (`field-ops-app-vite/scripts/c2LiveParity.mjs`) are added by *this* preparation PR,
so the operator must clone a commit that **contains the tool**. Therefore:

> **AUTHORIZED_COMMIT = the merge commit of this preparation PR**, to be pinned by the
> Owner in the separate deployment authorization. Write it into every command below in
> place of `<AUTHORIZED_COMMIT>`.

**This does not change what ships.** Verified empirically by the Inventory session: a
`build:firebase` from `2d08e2e` and a `build:firebase` from this prep branch produce a
**byte-identical** `dist/` — same five files, same SHA-256 for each:

| file | sha256 |
|---|---|
| `assets/index-DadxuIqI.js` | `02a667c4df2a9fdc77bc37ce35c405be43feeb3461f5097ce5342032be557722` |
| `assets/index-CSg6YUa7.css` | `3417e1faa227f9c2aa8757f2c5489cece2f36500c1cbc3d0e2b25c8567b029b5` |
| `index.html` | `bdc62e06d7a48149d3f077041f5db3a8a02e7879611b11d259b1e9aab12c7ac8` |
| `404.html` | `0ae843d4180e83a5a5e99064e0f50693ac3a0a1c0d2a9bd7c63cefa67d545cc4` |
| `favicon.svg` | `61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66` |

The prep PR adds only `scripts/`, `test/`, and `docs/` — none imported by `src/`. So the
deployed artifact is exactly the reviewed C2 frontend. **These hashes are from a Windows
build and are corroborating, not authoritative** — the Step 6 correspondence check binds
the live bytes to the operator's own Cloud Shell build manifest, which is the governing
comparison (Vite content hashes can differ across OS/EOL).

## 1. Hard boundaries

Deploy **ONLY** `hosting`. **No** Firestore Rules, Functions, indexes, or config deploy.
**No** Firestore write, **no** Auth/identity mutation, **no** role/claim change, **no**
Parts data migration. Single operator. Build from the exact authorized commit.

## 2. Stop conditions (do NOT deploy)

- `HEAD != <AUTHORIZED_COMMIT>`, or the checkout is dirty.
- Active project != `taylor-parts`.
- The deploy command could target anything besides Hosting.
- Current Hosting release / rollback target cannot be identified or pinned.
- Any preflight (test/lint/typecheck/build:firebase/build-base) fails, or
  `dist/index.html` contains any `/Taylor_Parts/field-ops` occurrence.
- **Step 5 fresh live parity is anything other than `PASS`.**
- Rules / Functions scope cannot be proven unchanged (pre-capture missing).
- Credentials or production records would enter committed evidence.

---

## Step 1 — Clean checkout + preflight (operator re-confirmation)

```bash
git clone https://github.com/TaylorService-spec/Taylor_Parts.git c2 && cd c2 \
 && git checkout <AUTHORIZED_COMMIT> \
 && test "$(git rev-parse HEAD)" = "<AUTHORIZED_COMMIT>" && echo HEAD-OK \
 && test -z "$(git status --porcelain)" && echo CLEAN \
 && ( cd field-ops-app-vite && npm ci && npm test && npm run lint && npm run typecheck \
      && npm run build:firebase && npm run verify:build-base ) \
 && HP=$(grep -c "/Taylor_Parts/field-ops" field-ops-app-vite/dist/index.html || true) \
 && echo "host-path occurrences: $HP" && [ "$HP" = "0" ] && echo HOST-PATH-ZERO
```

**Expected:** `HEAD-OK`, `CLEAN`, all scripts exit 0 (`verifyBuildBase: 12 passed`),
`host-path occurrences: 0`, then `HOST-PATH-ZERO`. (`grep -c` exits nonzero on zero
matches — wrapped in `|| true`, with the count asserted explicitly, so an expected-zero
does not break the `&&` chain.) Any failure → STOP. **PAUSE.**

## Step 2 — Confirm project + Hosting-only scope

```bash
firebase use taylor-parts && firebase projects:list | grep taylor-parts \
 && cat firebase.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('HOSTING_PUBLIC', d['hosting']['public'])"
```

**Expected:** active project `taylor-parts`; `HOSTING_PUBLIC field-ops-app-vite/dist`.
The deploy in Step 6 uses `--only hosting`. **PAUSE.**

## Step 3 — Capture current Hosting release + pin the rollback VERSION ID (REST)

`firebase hosting:releases:list` and `firebase hosting:rollback` are **not** supported/
documented CLI commands — **do not use them**. Capture releases via the Hosting **REST**
`sites.releases.list` endpoint (or the authenticated Console Release History) and **pin
the exact predeploy version ID**.

The raw REST response may carry operator identity metadata, so it is fetched to `/tmp`,
only approved fields are normalized into evidence, and the raw response is deleted.

```bash
set -euo pipefail
RAW=$(mktemp)
trap 'rm -f "$RAW"' EXIT
mkdir -p c2-evidence
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
open("c2-evidence/predeploy-release-pin.json", "w").write(json.dumps(rec, indent=2))
print("CURRENT_VERSION_NAME", rec["version_name"])
print("PREDEPLOY-RELEASE-FIELDS-VALID")
PY
```

**Expected:** `PREDEPLOY-RELEASE-FIELDS-VALID` and `c2-evidence/predeploy-release-pin.json`
with four strictly validated fields (script exits nonzero otherwise). **Record that exact
`<VERSION_ID>` — the pinned rollback target.** Do not rely on "immediately previous"
without pinning the ID. If no prior version exists, **STOP** (no rollback target).
The raw response is deleted, never committed.

**Expected predeploy state:** the pinned version should be the **C1** release
(`sites/taylor-parts/versions/0bd9029d010914b7`, per the C1 Hosting evidence). If it is
not, a release occurred outside this workstream — **STOP and report** before deploying.
**PAUSE.**

## Step 4 — Capture predeploy Rules + Functions inventories (unchanged-assertion baseline)

```bash
set -euo pipefail
FRAW=$(mktemp)
trap 'rm -f "$FRAW"' EXIT
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c2-evidence/predeploy-live-firestore.rules
echo "predeploy live Rules EXTRACTED-SOURCE sha256:"
sha256sum c2-evidence/predeploy-live-firestore.rules
curl -fsS -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > "$FRAW"
FRAW="$FRAW" node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync(process.env.FRAW,"utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c2-evidence/predeploy-functions-inventory.normalized.json",j);console.log("predeploy functions NORMALIZED sha256:",s.sha256(j));'
```

**Expected:** the live Rules extracted-source sha256 and
`c2-evidence/predeploy-functions-inventory.normalized.json` + its sha256. The normalized
inventory (governed `normalizeFunctionsInventory`) is deterministic and **hashes**
service-account identities; the raw Functions payload is deleted, never committed.
Baselines for Step 9. **PAUSE.**

## Step 5 — ⭐ FRESH LIVE PARITY, IMMEDIATELY BEFORE DEPLOY (C2-specific gate)

Decision #46 requires live parity "immediately before the switch"; DECISIONS #49 placed
that requirement on **this** gate. Run it **now**, immediately before Step 6 — not hours
earlier.

**Deterministic run boundary (Stage A §A.1):** capture **one** immutable canonical
payload first; the checker is a pure function of that single frozen file plus the in-repo
static catalog. It performs no network I/O of its own and holds no credentials, so no
temporal skew between the compared models is possible.

```bash
set -euo pipefail
CAP=$(mktemp)
trap 'rm -f "$CAP"' EXIT
TOKEN=$(gcloud auth print-access-token)
CAPTURE_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/taylor-parts/databases/(default)/documents/parts?pageSize=1000" \
  > "$CAP"
CAPTURE_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
( cd field-ops-app-vite && node scripts/c2LiveParity.mjs "$CAP" ../c2-evidence "$CAPTURE_START" "$CAPTURE_END" )
echo "C2-LIVE-PARITY-STEP-EXIT=$?"
```

**Expected:** `C2-LIVE-PARITY PASS` … `C2-LIVE-PARITY-PASS`, exit **0**, and
`c2-evidence/c2-live-parity.json` written with `"status": "PASS"`,
`canonicalValid: 190`, `staticCatalog: 200`, `detailReady: 200`, `canonicalMatch: 190`,
`staticOnlyExcluded: 10`, `nameDivergenceCount: 0`, `unitDivergenceCount: 0`,
`divergences: []`, and the capture provenance (`payloadSha256`, `staticCatalogSha256`,
capture start/end, deterministic `runId`).

**⚠ Do not pipe this command into `tee`/`tail` without `set -o pipefail`** — a pipeline
returns the last command's status and would mask a nonzero parity exit. The block above
uses `set -euo pipefail` and does not pipe the checker.

**Any non-PASS is a hard STOP — do not deploy.** The checker fails closed by design and
each of these is proven by `test/c2LiveParity.test.mjs` (15/15):

| Live condition | Result | Deploy |
|---|---|---|
| denied canonical read | `BLOCKED_PERMISSION` | **STOP** |
| unavailable / read error | `BLOCKED_UNAVAILABLE` | **STOP** |
| paginated (truncated) capture | `BLOCKED_INCOMPLETE_INPUT` | **STOP** |
| malformed JSON / unexpected shape | `BLOCKED_INCOMPLETE_INPUT` | **STOP** |
| **empty** canonical result | `BLOCKED_INCOMPLETE_INPUT` (never "success") | **STOP** |
| a Part omitted or duplicated | `BLOCKED_*` | **STOP** |
| canonical unit/identity divergence | `FAIL_PARITY` | **STOP** |

A `BLOCKED_*` is **never** reported as an empty catalog, "190 missing", or a parity
failure. Nothing has been deployed at this point, so a STOP here needs **no rollback** —
simply do not proceed. **PAUSE.**

## Step 6 — Deploy ONLY Hosting

```bash
set -euo pipefail
firebase deploy --only hosting --project taylor-parts 2>&1 | tee c2-evidence/deploy-output.txt
```

**Expected:** `hosting: ... file upload complete`, `hosting: release complete`,
`Deploy complete!` — **nothing** about firestore/functions/indexes. If the output
mentions any non-Hosting target, STOP → the deploy scope was wrong. **PAUSE.**

## Step 7 — Verify the deployed release corresponds to the authorized C2 build

Asset health alone does **not** bind the live release to the authorized build. Record the
full chain: source commit → build command → deterministic local artifact manifest →
deploy output/version ID → live asset names/hashes.

```bash
set -euo pipefail
PRAW=$(mktemp)
ASSETTMP=$(mktemp)
trap 'rm -f "$PRAW" "$ASSETTMP"' EXIT
SITE=taylor-parts
SITE_URL="https://taylor-parts.web.app"
TOKEN=$(gcloud auth print-access-token)
( cd field-ops-app-vite/dist && find . -type f | sort | while read -r f; do echo "$(sha256sum "$f" | cut -d' ' -f1)  ${f#./}"; done ) > c2-evidence/local-dist-manifest.sha256
echo "AUTHORIZED_COMMIT=<AUTHORIZED_COMMIT>" > c2-evidence/release-correspondence.txt
echo "MERGED_C2_SOURCE_COMMIT=2d08e2e495448e6f0bb523a58675c195a805c13e" >> c2-evidence/release-correspondence.txt
echo "BUILD_COMMAND=npm run build:firebase (vite build --base=/)" >> c2-evidence/release-correspondence.txt
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebasehosting.googleapis.com/v1beta1/sites/$SITE/releases?pageSize=5" > "$PRAW"
PRAW="$PRAW" python3 - <<'PY'
import json, os, re
VER_RE = re.compile(r"^sites/taylor-parts/versions/[A-Za-z0-9][A-Za-z0-9._-]*$")
REL_RE = re.compile(r"^sites/taylor-parts/releases/[A-Za-z0-9][A-Za-z0-9._-]*$")
TS_RE  = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
TYPES  = {"DEPLOY", "ROLLBACK", "SITE_DISABLE"}
def validate_release(rec, label):
    vn = rec.get("version_name"); assert isinstance(vn, str) and VER_RE.match(vn), f"{label} version_name malformed: {vn!r}"
    rn = rec.get("release_name"); assert isinstance(rn, str) and REL_RE.match(rn), f"{label} release_name malformed: {rn!r}"
    rt = rec.get("release_type"); assert isinstance(rt, str) and rt in TYPES, f"{label} release_type unsupported: {rt!r}"
    tt = rec.get("release_time"); assert isinstance(tt, str) and TS_RE.match(tt), f"{label} release_time invalid: {tt!r}"
d = json.load(open(os.environ["PRAW"]))
r = (d.get("releases") or [{}])[0]
rec = {
    "release_name": r.get("name"),
    "version_name": (r.get("version") or {}).get("name"),
    "release_type": r.get("type"),
    "release_time": r.get("releaseTime"),
}
validate_release(rec, "postdeploy")
pre = json.load(open("c2-evidence/predeploy-release-pin.json"))
validate_release(pre, "predeploy(reloaded)")
assert rec["version_name"] != pre["version_name"], "postdeploy version equals the pinned predeploy version -- no new release occurred"
open("c2-evidence/postdeploy-release-pin.json", "w").write(json.dumps(rec, indent=2))
with open("c2-evidence/release-correspondence.txt", "a") as f:
    for k, v in rec.items():
        f.write(f"POSTDEPLOY_{k.upper()}={v}\n")
print("POSTDEPLOY_VERSION_NAME", rec["version_name"])
print("POSTDEPLOY-RELEASE-FIELDS-VALID")
print("NEW-RELEASE-CONFIRMED")
PY
curl -fsS "$SITE_URL/index.html" > c2-evidence/postdeploy-live-index.html
HP=$(grep -c "/Taylor_Parts/field-ops" c2-evidence/postdeploy-live-index.html || true)
echo "live host-path occurrences: $HP"
[ "$HP" = "0" ] || { echo "FAIL: live host-path present"; exit 1; }
echo LIVE-HOST-PATH-ZERO
ASSET=$(grep -oE "/assets/[^\"]+\.js" c2-evidence/postdeploy-live-index.html | head -1)
[ -n "$ASSET" ] || { echo "FAIL: no JS asset path found in live index.html"; exit 1; }
CT=$(curl -fsS -o "$ASSETTMP" -w '%{content_type}' "$SITE_URL$ASSET")
case "$CT" in *javascript*) : ;; *) echo "FAIL: live asset content-type not JavaScript: $CT"; exit 1;; esac
BYTES=$(wc -c < "$ASSETTMP")
HASH=$(sha256sum "$ASSETTMP" | cut -d' ' -f1)
MANIFEST_HASH=$(awk -v p="assets/${ASSET#/assets/}" '$2==p{print $1}' c2-evidence/local-dist-manifest.sha256)
[ -n "$MANIFEST_HASH" ] || { echo "FAIL: live asset path $ASSET not in the Cloud Shell build manifest"; exit 1; }
[ "$HASH" = "$MANIFEST_HASH" ] || { echo "FAIL: live asset sha256 != build manifest (live=$HASH manifest=$MANIFEST_HASH)"; exit 1; }
echo LIVE-ASSET-EQUALS-BUILD-MANIFEST
printf 'LIVE_ASSET_PATH=%s\nLIVE_ASSET_CONTENT_TYPE=%s\nLIVE_ASSET_BYTES=%s\nLIVE_ASSET_SHA256=%s\nMANIFEST_MATCH=EXACT\n' "$ASSET" "$CT" "$BYTES" "$HASH" >> c2-evidence/release-correspondence.txt
echo "live asset: $ASSET  ct=$CT  bytes=$BYTES  sha256=$HASH  (== build manifest)"
```

All of the above are **hard assertions** (any failure exits nonzero under
`set -euo pipefail` → STOP → ROLLBACK):

- **`NEW-RELEASE-CONFIRMED`** — postdeploy version differs from the Step 3 pinned version.
- **`LIVE-HOST-PATH-ZERO`** — zero GitHub-Pages host paths in live `index.html`.
- Live JS asset found, content-type is JavaScript (not `text/html`).
- **`LIVE-ASSET-EQUALS-BUILD-MANIFEST`** — the live asset SHA-256 **exactly equals** the
  Cloud Shell build manifest hash. Fetched with identity encoding (no `--compressed`), so
  live bytes are the deployed bytes. **A mismatch is a hard STOP → ROLLBACK; no
  OS/encoding explanation is permitted** (build and deploy happen on the same Cloud Shell).

Committed evidence is only the sanitized `release-correspondence.txt`,
`*-release-pin.json`, `local-dist-manifest.sha256`, and `postdeploy-live-index.html` —
no raw release JSON, no bundle bytes. **PAUSE.**

## Step 8 — ⭐ Direct PartDetail browser verification (read-only, per persona)

C1's per-persona rendered behavior was *inferred*, not observed. **C2's two ratified
decisions are directly visible in a browser**, so observe them. Use governed test
personas (from the DPAPI vault; never printed, never committed). **Read-only — issue no
write, create no Reorder Request, record no PO, void nothing.**

Site: `https://taylor-parts.web.app`

### 8a. Authorized personas — admin, dispatcher, PARTS_MANAGER, WAREHOUSE_MANAGER

For each, navigate Inventory → Parts → open a part detail page and confirm:

1. **PartDetail renders the governed page** — not a loading state, not a blocked banner,
   not `Unknown part`.
2. **D-C2-1 is directly observable:** the header line under the part name shows the
   **canonical normalized unit token** — e.g. `EACH`, `KIT`, `BOTTLE` — **not** the old
   raw static token (`ea`, `kit`, `bottle`). *This is the single most visible C2 change;
   record the exact token seen for at least two parts.*
3. **Routing continuity:** arriving from a PartsList row lands on `/inventory/<sku>` and
   the page shows that same SKU — spot-check a canonical part and an **approved
   static-only** part (e.g. `TST-1047`, `TST-1193`); both must render normally.
4. **Ledger pairing:** the Stock Position card and Recent Transactions correspond to
   *that* part (no cross-part bleed). Where a part has no ledger activity, the expected
   copy is the "no ledger activity yet" message — that is correct, not a failure.
5. **Catalog card:** Cost / Price / Warehouse baseline / Reorder threshold render values
   (these remain unchanged `STATIC_FALLBACK` figures pending UD-3/UD-4).
6. **Write surface present but untouched:** reorder/PO/receive/cancel/void controls
   appear per the persona's normal permissions. **Do not activate any of them.**

### 8b. Unauthorized persona — fail-closed (D-C2-2), directly observable

Use a principal **without** canonical `parts` read access (e.g. a technician with no
permitted operational role). **Either outcome is valid fail-closed behavior; accept
whichever the app produces:**

- (i) the application denies the Inventory workspace/route entirely, exposing **no** Parts
  data; **or**
- (ii) direct navigation to `/inventory/<sku>` reaches PartDetail and shows the
  **BLOCKED** message — "You do not have access to the canonical Parts catalog…".

In **both** cases prove all three:

- the canonical `parts` read is denied;
- **no static metadata is presented as successful canonical data** (no name/category/
  cost page rendered from the static catalog);
- **no write surface is exposed** — under D-C2-2 the *entire* page body is withheld, so
  there must be **no** reorder/PO/inventory-action controls on a blocked page;
- the blocked page is **not** the `Unknown part "<sku>"` copy (that wording is reserved
  for a genuinely unknown id under a verified catalog).

### 8c. What the browser does and does not establish — state this honestly

**Directly observed:** the rendered unit token (D-C2-1), the blocked-page behavior and
absence of a write surface (D-C2-2), route→detail continuity, and per-part ledger
correspondence.

**NOT observable in the browser, proven elsewhere:** `CANONICAL_MATCH` /
`STATIC_ONLY_EXCLUDED` are adapter-internal classifications with **no visible UI label** —
do not instruct anyone to "see" them. The 190 + 10 = 200 composition is proven by the
Step 5 fresh live parity plus the committed governed tests
(`partDetailView` 34/34, `partsCatalogView` 23/23, `partsCompatibilityAdapter`). Cite
those; do not claim the browser proves the classification.

Record **sanitized PASS/FAIL per persona/assertion only** (persona label, PASS/FAIL, the
observed unit tokens, the two spot-check SKUs, the unauthorized outcome). **Never** UID,
email, reset link, JWT, raw records, or PII screenshots.

**STOP → ROLLBACK (Step 3 pinned version)** on any: an authorized persona does not get
the C2 PartDetail; a raw static unit token (`ea`) still renders; a route is unstable or
lands off PartDetail; an approved static-only part fails to render; the unauthorized
persona sees **static-as-success**, a partial page, or **any write control on a blocked
page**; or any write/Auth mutation would be required. Preserve all evidence on failure;
do **not** repair identities/roles/data/Rules/Functions/config — Hosting rollback only.

## Step 9 — Confirm Rules / Functions / indexes / data unchanged

```bash
set -euo pipefail
FRAW=$(mktemp)
trap 'rm -f "$FRAW"' EXIT
TOKEN=$(gcloud auth print-access-token)
REL=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json;rs=json.load(sys.stdin)['releases'];print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])")
curl -fsS -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json;sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" > c2-evidence/postdeploy-live-firestore.rules
diff c2-evidence/predeploy-live-firestore.rules c2-evidence/postdeploy-live-firestore.rules
echo RULES-UNCHANGED
curl -fsS -H "Authorization: Bearer $TOKEN" "https://cloudfunctions.googleapis.com/v2/projects/taylor-parts/locations/-/functions" > "$FRAW"
FRAW="$FRAW" node -e 'const s=require("./functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");const norm=s.normalizeFunctionsInventory(JSON.parse(fs.readFileSync(process.env.FRAW,"utf8")));const j=JSON.stringify(norm,null,2);fs.writeFileSync("c2-evidence/postdeploy-functions-inventory.normalized.json",j);console.log("postdeploy functions NORMALIZED sha256:",s.sha256(j));'
diff c2-evidence/predeploy-functions-inventory.normalized.json c2-evidence/postdeploy-functions-inventory.normalized.json
echo FUNCTIONS-NORMALIZED-IDENTICAL
echo FUNCTIONS-UNCHANGED
```

**Expected:** `RULES-UNCHANGED`, `FUNCTIONS-NORMALIZED-IDENTICAL`, `FUNCTIONS-UNCHANGED`.
The pre/post **normalized** Functions inventories are byte-identical, so no function was
redeployed or reconfigured. Indexes and Firestore data are not deployed by a Hosting
deploy (scope asserted by Step 6's output). The live Rules extracted-source should also
correspond to the governed repository Rules — note that the **governed repo hash**
(`cf6681c6…2bc381`, Git/LF) and a **live ruleset export hash** are different artifact
types and are **not** asserted equal (the C1/#46 precedent). If any diff differs, STOP and
report — a Hosting deploy must not change Rules or Functions. **PAUSE.**

## Step 10 — Package sanitized evidence (scripted gate)

Sanitization is an **automatic, scripted gate**, not a manual review: first assert no
raw/forbidden artifact remains, then run the **governed structured scanner**
(`assertEvidenceSecretFree` / `SECRET_PATTERN` from
`functions/scripts/firestoreDeploymentVerificationShared.js`), then regenerate checksums.

The governed scanner targets real credential/identity **structures** (`AIza…` API keys,
JWT `eyJ….ey….`, `password`, `refreshToken`, `idToken`, `email`) and deliberately does
**not** match the generic word `token` — legitimate Rules source contains token-related
identifiers that would false-positive. **Do not reintroduce a generic-keyword grep.**

```bash
set -euo pipefail
cd c2-evidence
FORBIDDEN=$(ls | grep -E "raw|-asset\.js$|\.tgz$|token" || true)
if [ -n "$FORBIDDEN" ]; then echo "FORBIDDEN-ARTIFACT-PRESENT: $FORBIDDEN"; exit 1; fi
echo "NO-RAW-OR-BUNDLE-ARTIFACTS"
node -e 'const s=require("../functions/scripts/firestoreDeploymentVerificationShared.js");const fs=require("fs");let bad=[];for(const f of fs.readdirSync(".")){if(f==="SHA256SUMS.txt"||!fs.statSync(f).isFile())continue;const t=fs.readFileSync(f,"utf8");try{s.assertEvidenceSecretFree(t);}catch(e){bad.push(f);}}if(bad.length){console.log("SENSITIVE-FOUND -- REDACT:",bad.join(", "));process.exit(1);}console.log("SENSITIVE-SCAN-CLEAN");'
rm -f SHA256SUMS.txt
find . -maxdepth 1 -type f ! -name SHA256SUMS.txt -printf '%P\n' | sort | xargs -r sha256sum > SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt
cd ..
tar czf inv-convergence-e-c2-hosting-deploy-evidence.tgz c2-evidence
sha256sum inv-convergence-e-c2-hosting-deploy-evidence.tgz
```

**Expected:** `NO-RAW-OR-BUNDLE-ARTIFACTS`, `SENSITIVE-SCAN-CLEAN`, all checksums `OK`,
then the tarball + its sha256 (record it).

Note: `c2-live-parity.json` contains only counts, hashes, timestamps, and SKU-level
divergence codes — no records, no identities. If the scan flags any file, redact or hash
the offending value before committing; **never** commit a raw secret or identity.

**Evidence set:** pre/post release pins; `c2-live-parity.json` (fresh live parity);
deploy output; pre/post live Rules extracted-source + `RULES-UNCHANGED`; pre/post
**normalized** Functions inventories + `FUNCTIONS-UNCHANGED`; `local-dist-manifest.sha256`
+ live `index.html` + live asset content-type/hash (release-to-build correspondence);
sanitized per-persona C2 browser matrix (8a/8b) with the observed unit tokens.

**Archive retention (C1 lesson):** a Cloud Shell home-directory tarball is **mutable and
not repository-retained**. Download it for the evidence-import PR; the **committed
sanitized transcription is the repository-review evidence**, and the archive is recorded
as a pointer with a stated retention limitation — never cited as durable evidence.

**DONE — report the tarball + sanitized results.**

## Rollback (only on a Step 7/8/9 stop condition — Hosting only, pinned version)

Do **not** use `firebase hosting:rollback` (unsupported). Use one verified method with the
**exact `<VERSION_ID>` pinned in Step 3** (expected: the C1 release
`sites/taylor-parts/versions/0bd9029d010914b7`):

- **Console:** Hosting → Release History → select the pinned prior version → **Roll back**; or
- **Exact-version clone:**
  ```bash
  firebase hosting:clone taylor-parts:@<VERSION_ID> taylor-parts:live --project taylor-parts
  ```

Then re-run Step 7's live checks and confirm the live release matches the pinned Step 3
predeploy version. Report immediately.

**Rollback target semantics:** rolling back restores the **C1 PartsList** frontend, which
is a fully governed, previously verified live state — PartDetail returns to its pre-C2
static-backed behavior. **No** Firestore/Rules/Functions/identity change is part of a
Hosting version clone, and **no data effect** exists in either direction (C2 performs no
writes). Do not repair identities, roles, mappings, data, Rules, Functions, or
configuration — Hosting version rollback only.

**A Step 5 stop needs no rollback** — nothing has been deployed at that point.

## After this handoff (Inventory session)

Import the sanitized evidence bundle byte-exact into
`docs/audits/inv-convergence-e-c2-hosting-deploy/` (with its own `SHA256SUMS.txt`, a
`-text` EOL pin, and a sensitive scan), record the C2 Hosting deployment in
`docs/SPRINT_STATUS.md` and an append-only `DECISIONS.md` entry, and open the governed
evidence PR for independent repository review.

## Non-authorizations (explicit)

This runbook, once separately authorized, permits a **Hosting-only** production deploy of
C2 from `<AUTHORIZED_COMMIT>`. It permits **no** Rules/Functions/index/data deploy or
change; **no** Firebase configuration or billing change; **no** Auth/identity/role/claim
mutation; **no** Firestore write; **no** Parts data migration, rename, restructure,
deletion, or rewrite; **no** Customer/Auth stream change; and **no** static-catalog or
Functions-mirror retirement (Phase F). Decisions #43–#49 unchanged.
