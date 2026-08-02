# EI Truck Registry — Gate D Trusted Functions Deployment & Verification (Operator Runbook)

**Status:** Repository-only preparation. This runbook does **not** authorize deployment. The targeted
deploy and the production verifier run only under a **separate, explicit Owner authorization**, from a
clean checkout of the exact governed commit. **`TRUCK_MANAGEMENT_WRITE_READY` remains `false`
throughout Gate D** — deploying the callables does **not** activate any UI write path.

## Scope — exactly eight callables

```
createTruckCallable
assignTruckDriverCallable
reassignTruckDriverCallable
unassignTruckDriverCallable
changeTruckStatusCallable
changeTruckHomeWarehouseCallable
deactivateTruckCallable
reactivateTruckCallable
```

- Region: **us-central1**. Authorization: admin/dispatcher security role (`users/{uid}.role`).
- **`deactivateTruckCallable` is intentionally fail-closed** (default `UNKNOWN` inventory predicate →
  `failed-precondition`) until a separate later gate injects a real predicate. Deploying it is safe;
  its fail-closed result is the **expected** outcome, not a defect.
- No App Check is enabled or disabled by this gate (unchanged governance posture).

## 0. Preflight

1. **Runtime/tools:** Node 20 (matches `functions/package.json` engines), `firebase-tools` and
   `gcloud` authenticated to the **authorized project** only. Confirm: `node -v` → v20.x;
   `gcloud config get-value project` → `taylor-parts`; `firebase projects:list` shows access.
2. **Clean exact-head checkout (required):** the working tree must be clean and `HEAD` must equal the
   Owner-approved governed commit. The verifier CLI re-checks both and refuses otherwise.
   ```bash
   git fetch origin && git checkout <APPROVED_COMMIT> && git status --porcelain   # must print nothing
   git rev-parse HEAD                                                             # must equal <APPROVED_COMMIT>
   ```
3. **Build before deploy (required — no predeploy hook):**
   ```bash
   cd functions && npm ci && npm run build && cd ..
   ```

## 1. Pre-deploy function inventory (record the "before" state)

```bash
gcloud functions list --project taylor-parts --format json > /tmp/functions-before.json
```
Confirm the eight truck callables are **absent** (first-time deploy) so recovery = delete-only.

## 2. Targeted, Functions-only deployment — exact allowlist

Deploy **only** the eight callables. **Do NOT run a broad `firebase deploy --only functions`** (that
would touch every function). This command deploys no Hosting, Rules, indexes, Storage, or unrelated
Functions, and does not delete unlisted functions:

```bash
firebase deploy --project taylor-parts \
  --only functions:createTruckCallable,functions:assignTruckDriverCallable,functions:reassignTruckDriverCallable,functions:unassignTruckDriverCallable,functions:changeTruckStatusCallable,functions:changeTruckHomeWarehouseCallable,functions:deactivateTruckCallable,functions:reactivateTruckCallable
```

> Prohibited: `firebase deploy`, `firebase deploy --only functions`, or any wildcard/broad target.
> Only the explicit eight-name `functions:<name>,…` allowlist above is authorized.

## 3. Post-deploy verification (governed, sanitized)

Run the committed verifier from the **same clean exact-head checkout**. Credentials come only from the
ambient authenticated environment (ADC for the Admin SDK; the Firebase Web API key via the env var
named by `config.webApiKeyEnv`). Copy `config/truck-functions-deployment-verification.example.json` to a
local, **uncommitted** `*.local.json`, set `governedCommit` to `<APPROVED_COMMIT>`:

```bash
export TRUCKFN_WEB_API_KEY=...   # in the operator env only; never committed, never logged
node functions/scripts/truckFunctionsVerifierCli.js \
  --config config/truck-functions-deployment-verification.local.json \
  --evidence-dir docs/audits/truck-registry-functions-deployment/verify-<YYYY-MM-DD> \
  --recovery-dir /secure/local/recovery \
  --verify-date <YYYY-MM-DD> \
  --confirm-project taylor-parts
```

The verifier (fail-closed; exits non-zero on any failed assertion, cleanup failure, or residual):
- discovers all eight exports @ us-central1;
- proves **unauthenticated** and **unauthorized-authenticated** denial for all eight;
- seeds disposable prefixed fixtures, then drives create → assign → reassign → unassign → status →
  home-warehouse → **deactivate (expected `failed-precondition`)** → reactivate (version 1..7);
- **always** cleans up and independently verifies **zero** residual documents and **zero** residual
  temporary Auth users;
- emits **one sanitized evidence object** (`verification-report.json`) — no tokens, keys, credentials,
  emails, uids, run prefix, or production data.

## 4. Recovery / rollback (first-time functions only)

Because these are first-time deployments, recovery = **delete exactly these eight**, returning to the
exported-but-undeployed state (readiness is still `false`, so no client path can invoke them):

```bash
for fn in createTruckCallable assignTruckDriverCallable reassignTruckDriverCallable \
          unassignTruckDriverCallable changeTruckStatusCallable changeTruckHomeWarehouseCallable \
          deactivateTruckCallable reactivateTruckCallable; do
  firebase functions:delete "$fn" --project taylor-parts --region us-central1 --force
done
```

Do **not** delete or modify any other function. Verify against `/tmp/functions-before.json`.

## 5. Evidence packaging, checksum, sanitized return

```bash
cd docs/audits/truck-registry-functions-deployment/verify-<YYYY-MM-DD>
sha256sum verification-report.json > SHA256SUMS.txt
tar -czf ../truck-functions-verify-<YYYY-MM-DD>.tgz verification-report.json SHA256SUMS.txt
sha256sum ../truck-functions-verify-<YYYY-MM-DD>.tgz > ../truck-functions-verify-<YYYY-MM-DD>.tgz.sha256
```
Return **only** the sanitized `verification-report.json` (and its checksum). The durable recovery
manifest stays in `--recovery-dir` (outside the evidence dir) — it holds temporary uids/identities and
is **never** committed or returned.

## 6. Stop conditions & escalation

- **Verifier exits non-zero** → HALT. Read the printed `lifecycleFailure` / residual counts and the
  `recoveryLocation` (the durable manifest). Do not re-run against production until resolved.
- **Incomplete cleanup or non-zero residual** → HALT and escalate to the Owner with the recovery
  manifest path; run the recovery/rollback (§4) and re-verify residual = 0 before any retry.
- **Deploy touched anything beyond the eight** → HALT, roll back (§4), escalate.
- **Working tree not clean / HEAD ≠ governed commit** → the CLI refuses; re-checkout and retry.

## 7. Readiness stays false

Gate D deploys and verifies the backend only. Flipping `TRUCK_MANAGEMENT_WRITE_READY` to `true` and
releasing Hosting is a **separate** repository + Hosting gate (Gate E) under its own Owner authorization,
performed only after this verification passes.
