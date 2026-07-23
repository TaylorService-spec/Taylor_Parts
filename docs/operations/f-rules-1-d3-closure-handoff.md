# F-RULES-1 Gate D3 — Final Production Verification Handoff (Cloud Shell + Browser)

**Gate:** D3 — one end-to-end completion through the SHIPPED production Field Mode UI, proving the trusted flow in the real product; then workstream closure. **Operator-executed**; prepared by the Customer session per the Owner's D3 authorization. Governing: Decision #39 · D1/D2 evidence (`../audits/f-rules-1/`).

**Hard boundaries:** nothing is deployed or changed in this gate · fixtures strictly `d3smoke`-prefixed · **NEVER export a HAR file** (HARs embed Authorization tokens) — the network proof is recorded as attestation lines + the data-plane script · no real records touched.

**Stop conditions (abort → cleanup → report):** live Function or Rules hash mismatch · UI fails to load/sign in · Complete triggers anything other than a `completeAssignedJob` call · any direct Firestore completion write observed · verify script reports any FAIL · sensitive data in evidence.

## Step 1 — Clone, pre-checks (live Function + live Rules == governed blob)

```bash
git clone --branch ops/f-rules-1-d3-closure https://github.com/TaylorService-spec/Taylor_Parts.git d3 && cd d3 && EXPECTED_RULES_SHA=$(git show HEAD:firestore.rules | sha256sum | cut -d" " -f1) && echo "governed blob: $EXPECTED_RULES_SHA" && firebase functions:list --project taylor-parts | grep completeAssignedJob && TOKEN=$(gcloud auth print-access-token) && REL=$(curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/projects/taylor-parts/releases" | python3 -c "import sys,json; rs=json.load(sys.stdin)['releases']; print([r['rulesetName'] for r in rs if r['name'].endswith('cloud.firestore')][0])") && curl -s -H "Authorization: Bearer $TOKEN" "https://firebaserules.googleapis.com/v1/$REL" | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['source']['files'][0]['content'])" | sha256sum | cut -d" " -f1 | tee /tmp/live.sha && test "$(cat /tmp/live.sha)" = "$EXPECTED_RULES_SHA" && echo LIVE-RULES-EQUAL-GOVERNED-BLOB && cd functions && npm ci >/dev/null && cd ..
```
**Expected:** `governed blob: b37c666fff0018375df11afa5078f8499e10fea9df7a862d5c373e112f5903fd` · a `completeAssignedJob │ v2 │ callable │ us-central1` row · the same hash again · `LIVE-RULES-EQUAL-GOVERNED-BLOB`. Any mismatch → STOP. **PAUSE.**

## Step 2 — Seed the controlled fixture

```bash
export D3_SMOKE_PASSWORD="$(openssl rand -base64 18)" && cd functions && node scripts/d3SmokeUiVerification.js seed && echo "PASSWORD (for the browser sign-in only, then forget): $D3_SMOKE_PASSWORD"
```
**Expected:** `seeded d3smoke fixtures. Browser sign-in email: d3smoke-user-t1@d3smoke.example.com …` and the session password echoed once for you to type into the sign-in form. **PAUSE.**

## Step 3 — BROWSER: complete the job through the shipped UI (record attestations)

1. Open **https://taylorservice-spec.github.io/Taylor_Parts/field-ops/** in a fresh private/incognito window; open **DevTools → Network** first.
2. Sign in as `d3smoke-user-t1@d3smoke.example.com` with the Step 2 password.
3. Navigate to **Field Mode**. Expected: Active Job "D3 SMOKE (not a real customer)" with a **Complete Job** button (job is `in_progress`).
4. In the Network tab, type `complete` in the filter. Click **Complete Job** once.
5. **Attest (type YES/NO for each into `~/d3/attestation.txt` as lines `A1=YES` … `A6=YES`):**
   - **A1** exactly one request to `…cloudfunctions.net/completeAssignedJob`, status **200**.
   - **A2** clear the filter, filter by `firestore.googleapis.com` → **no** `Write`/`commit` channel activity fired at the moment of completion (only `Listen` channels, which are the app's normal reads).
   - **A3** the job left the Active Job slot (list refreshed via the live listener).
   - **A4** refresh the page: the job does not reappear as completable; **no second** `completeAssignedJob` request fires on its own.
   - **A5** no error banners; no raw backend detail shown.
   - **A6** you did NOT export a HAR or copy any token.
6. Sign out and close the window.

```bash
cd ~/d3 && printf 'A1=YES\nA2=YES\nA3=YES\nA4=YES\nA5=YES\nA6=YES\noperator=%s\nwhen=%s\n' "$(gcloud config get-value account 2>/dev/null)" "$(date -u +%Y%m%dT%H%M%SZ)" > attestation.txt && cat attestation.txt
```
Edit any line to `NO` if it did not hold — a `NO` is a STOP condition. **PAUSE.**

## Step 4 — Data-plane verification (proves cascade, single audit, no duplicates)

```bash
cd functions && node scripts/d3SmokeUiVerification.js verify
```
**Expected (all 7):** job complete · job otherwise untouched · technician available · exactly ONE applied audit · action/actor correct · audit id `cmpl-*` (the UI-minted idempotency key — proving the shipped completionFlow produced it) · scope ownAssignment — ending **`D3 VERIFY PASS: 7 passed, 0 failed`**. **PAUSE.**

## Step 5 — Package evidence

```bash
mkdir -p ../d3-evidence && cp d3-smoke-evidence/d3-smoke-results.json ../attestation.txt ../d3-evidence/ && cd ../d3-evidence && sha256sum * > checksums.sha256 && (grep -riE "token|password|secret|bearer" . | grep -v checksums.sha256 || echo SENSITIVE-SCAN-CLEAN) && cd .. && tar czf f-rules-1-d3-evidence.tgz d3-evidence && sha256sum f-rules-1-d3-evidence.tgz
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball + sha256 printed (record it). Download `f-rules-1-d3-evidence.tgz`. **PAUSE.**

## Step 6 — Cleanup

```bash
cd functions && node scripts/d3SmokeUiVerification.js cleanup && unset D3_SMOKE_PASSWORD
```
**Expected:** `d3smoke fixture documents and auth user removed (audit events retained, append-only)`. **DONE — hand back the tarball.**

## After this handoff (Customer session)

Evidence import + the single D3 closure PR: D3 report · closure documentation (implementation-plan status → F-RULES-1 COMPLETE · SYSTEM_AUTHORITIES completion-authority row · DECISIONS production-closure entry per the deployment-recording precedent) → merge on green CI. U-R1–U-R4 stays a separate open governance item.
