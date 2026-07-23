# F-RULES-1 Gate D1 — Operator Deployment Handoff (Cloud Shell)

**Gate:** D1 — deploy `completeAssignedJob`, verify live, run the controlled backend smoke. **Operator-executed** (Cloud Shell, project `taylor-parts`); prepared by the Customer session per the Owner's D1 authorization. Governing: Decision #39 · `../implementation-plans/technician-self-write.md` · `../audits/f-rules-1/pr-c-completion-rules-validation.md`.

**Hard boundaries:** deploy ONLY `completeAssignedJob` · do NOT deploy Firestore Rules (D2 is later and depends on this gate) · do NOT touch other Functions · the frontend gate-flip is a SEPARATE held release PR that merges only after Step 5 passes.

**Pre-recorded rollback baseline (Customer session, pre-deploy):** `completeAssignedJob` absent from live Functions; pre-deploy `functions:list` captured; prior frontend release = GitHub Pages deploy of `ba99d72`; production gate OFF. Rollback: `firebase functions:delete completeAssignedJob --region us-central1 --project taylor-parts --force` (backend, only on a rollback trigger); the frontend has nothing to roll back until the held release PR merges.

**Stop conditions (abort + report, do not improvise):** deploy fails or callable not ACTIVE · smoke reports any FAIL (partial cascade, missing audit, replay mutation, authorization not denied) · any error exposes sensitive data · any command would touch a non-`d1smoke` document.

Run each step as one block; **pause after each and compare against the expected output** before continuing.

## Step 1 — Clone the handoff branch and install

```bash
git clone --branch ops/f-rules-1-d1-handoff https://github.com/TaylorService-spec/Taylor_Parts.git d1 && cd d1/functions && npm ci && npm run build
```
**Expected:** clean install, `tsc` completes with no errors. **PAUSE.**

## Step 2 — Pre-deploy verification (callable must be absent)

```bash
firebase functions:list --project taylor-parts | tee ../d1-evidence-pre-functions-list.txt | grep -c completeAssignedJob || echo ABSENT-OK
```
**Expected:** `0` then `ABSENT-OK`. If it prints `1`, STOP (already deployed — report). **PAUSE.**

## Step 3 — Deploy ONLY completeAssignedJob

```bash
cd .. && firebase deploy --only functions:completeAssignedJob --project taylor-parts
```
**Expected:** ends `Deploy complete!`; only `completeAssignedJob` created; no other function updated/deleted. If ANY other function is listed as changed, STOP. **PAUSE.**

## Step 4 — Verify the live Function

```bash
firebase functions:list --project taylor-parts | tee d1-evidence-post-functions-list.txt | grep completeAssignedJob && gcloud functions describe completeAssignedJob --region us-central1 --project taylor-parts --format="value(state,environment,serviceConfig.runtime)" | tee d1-evidence-describe.txt
```
**Expected:** table row `completeAssignedJob │ v2 │ callable │ us-central1 │ 256 │ nodejs20`, then `ACTIVE  GEN_2  nodejs20`. **PAUSE.**

## Step 5 — Controlled backend smoke (seed → run → inspect)

Fixtures are ALL prefixed `d1smoke` (fake customer name, no real records). The smoke proves: positive completion cascade, applied Audit Event, technician→available, **exact idempotent replay with no duplicate mutation**, wrong-technician denial, invalid-state denial.

> **Correction (operator run 1):** the original script used `auth.createCustomToken()`, which requires service-account signing that Cloud Shell user-ADC cannot perform (impersonation correctly denied; no IAM widened, no SA key created). The smoke now signs in exactly like the real client app: two deterministic `d1smoke` Auth users (synthetic `@d1smoke.example.com` emails) created at seed with a **session-only throwaway password from `D1_SMOKE_PASSWORD`**, exchanged via the public `signInWithPassword` endpoint. The password is never printed or written to evidence; the Auth users die at cleanup. Static validation: `node --test test/d1SmokeStatic.test.js` (8 checks).

```bash
export D1_SMOKE_PASSWORD="$(openssl rand -base64 18)" && cd functions && node scripts/d1SmokeCompleteAssignedJob.js seed && node scripts/d1SmokeCompleteAssignedJob.js run
```
**Expected (all 12 checks):** `PASS -- positive: HTTP 200` · `positive: response contract` · `cascade: job -> complete` · `cascade: technician -> available` · `audit: applied event at the idempotency key` · `replay: HTTP 200` · `replay: idempotentReplay true` · `replay: no duplicate cascade (perturbed tech status untouched)` · `replay: exactly one applied audit event` · `negative: wrong technician denied (permission-denied)` · `negative: assigned state denied (failed-precondition)` · `negative: no mutation from denied attempts` — ending `D1 SMOKE PASS: 12 passed, 0 failed`. Any FAIL → STOP, run Step 7 cleanup, report. **PAUSE.**

## Step 6 — Package evidence

```bash
mkdir -p d1-evidence && cp d1-smoke-evidence/d1-smoke-results.json ../d1-evidence-pre-functions-list.txt ../d1-evidence-post-functions-list.txt ../d1-evidence-describe.txt d1-evidence/ && (cd d1-evidence && sha256sum * > checksums.sha256 && grep -riE "token|password|secret|bearer" . || echo SENSITIVE-SCAN-CLEAN) && tar czf ../f-rules-1-d1-evidence.tgz d1-evidence
```
**Expected:** `SENSITIVE-SCAN-CLEAN`; tarball created. Download `f-rules-1-d1-evidence.tgz` and hand it back to the Customer session for import. **PAUSE.**

## Step 7 — Cleanup fixtures

```bash
node scripts/d1SmokeCompleteAssignedJob.js cleanup
```
**Expected:** `d1-smoke fixture documents and auth users removed (audit events retained, append-only)`. Then `unset D1_SMOKE_PASSWORD`. The two `d1smoke`-keyed Audit Events remain by design — auditEvents are append-only; they record genuine trusted-writer activity and are identifiable by their `d1smoke` ids. **DONE — report back with the evidence tarball.**

## Rerun after the run-1 correction (deploy already done)

Steps 2–4 are complete (callable ACTIVE/GEN_2/us-central1/nodejs20 — do NOT redeploy). From the existing `d1` clone:

```bash
cd d1 && git fetch origin && git checkout ops/f-rules-1-d1-handoff && git pull && cd functions && npm ci
```

then run **Step 5 → Step 6 → Step 7** exactly as written above (Step 5 now begins with the `D1_SMOKE_PASSWORD` export).

## After this handoff (Customer session, separately)

1. Evidence imported under `docs/audits/f-rules-1/d1-activation/` (immutable, checksummed).
2. The **held** release PR (`release/f-rules-1-d1-gate-flip` — one-line `trustedCompletion.js` flip) merges only after the evidence shows `D1 SMOKE PASS`; GitHub Pages then auto-publishes; the production bundle is verified to contain the callable path.
3. D2 (deploy hardened Rules) remains a separate later Owner gate — **never before** this gate completes.
