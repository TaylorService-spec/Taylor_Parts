# EI Truck Registry — Gate E4 Read-Only Backend Verifier (Operator Runbook)

**Status:** repository-only, reviewed. **Not yet authorized for production execution.** This runbook
is prepared for a *later, separate* Owner authorization. It performs **no production reads or writes
during this gate**, and even when authorized it performs **only Firestore reads** — no mutation, no
Auth changes, no fixtures, no Functions/callable invocation, no deploy.

## What it does

Independently verifies the backend facts the production Truck Inventory UI does **not** expose, for a
single **Owner-named** truck:

- `trucks/{truckId}` — exactly one authoritative doc; stored `truckId` equals the doc id; a valid
  positive-integer `version`; the expected `displayLabel` / `vehicleNumber` / `status` /
  `homeWarehouseId` and a **null** driver; a valid `locationId`.
- `mobile_locations/{locationId}` — exists exactly once by id; `type === "MOBILE"`; `active === true`
  (consistent with an IDLE, non-deactivated truck).
- `location_truck_claims/{locationId}` — exists; `locationId` equals its doc id; `truckId` equals the
  requested truck; the truck/location/claim identities are reciprocal.
- **Duplicate detection** — no second truck references the location, no second claim points to the
  truck, no second MOBILE location is linked; bounded, deterministic queries; zero / one / multiple /
  malformed / query-failure are all distinguished and any non-`one` result **fails closed**.
- **Audit** — exactly one applied `createTruck`, exactly one applied `unassignTruckDriver`, exactly
  one applied `changeTruckStatus` (the session's containment actions), no other applied action, no
  malformed/uncertain outcome. Denied events are counted, not failed. (Queries `auditEvents` by a
  single-field `targetId` equality — an automatic index; **no composite index required**.)
- **Cross-record consistency** — stored `version` equals the applied-audit count; creation precedes
  the containment actions; the final state is **IDLE + unassigned**; and no write API is reachable.

On success it publishes a **sanitized** `verification-report.json` + `SHA256SUMS.txt` atomically. On
**any** failed check it exits non-zero and publishes **nothing**. Evidence contains only governed
booleans, counts, the Owner-supplied ids/labels, `version`, a non-reversible `locationIdSha256`, and
PASS/FAIL categories — never raw summaries, actor identifiers, unrelated doc ids, or PII.

## Preconditions (execution-time, later authorization)

1. A **clean detached checkout** pinned to the reviewed merge commit:
   ```bash
   git fetch origin
   git checkout --detach <REVIEWED_MERGE_COMMIT>
   git status --porcelain   # must be empty
   ```
2. Project is **taylor-parts** (confirmed twice — config + `--confirm-project`).
3. The repository-required Node version:
   ```bash
   nvm use 20   # or: node -v  -> v20.x
   ```
4. **Application Default Credentials only** — never a service-account key file:
   ```bash
   gcloud auth application-default login
   # GOOGLE_APPLICATION_CREDENTIALS must be UNSET (the verifier refuses a key file).
   ```
5. **No emulator** — `FIRESTORE_EMULATOR_HOST` and the other emulator vars must be unset (the
   verifier refuses to run if any are set).
6. A **local, uncommitted** config `config/truck-backend-verification.local.json` (matched by
   `.gitignore`'s `*.local.json`), copied from `config/truck-backend-verification.example.json` and
   filled with `governedCommit` (= the checked-out commit), `truckId`, and the exact Owner-approved
   `expected.*` visible values (`status: "IDLE"`, `assignedDriverEmployeeId: null`).

## Run (once)

```bash
cd functions
node scripts/truckBackendVerifierCli.js \
  --config ../config/truck-backend-verification.local.json \
  --evidence-dir ../docs/audits/truck-registry-backend-verification/verify-<YYYY-MM-DD> \
  --confirm-project taylor-parts \
  --verify-date <YYYY-MM-DD>
```

- Exit **0** = every check passed; the evidence directory now holds `verification-report.json` +
  `SHA256SUMS.txt`.
- Exit **non-zero** = at least one check failed (message lists the failed check labels); **no
  evidence is written**. Do not retry blindly — report the failed labels to the Owner.

## Validate the evidence

```bash
cd ../docs/audits/truck-registry-backend-verification/verify-<YYYY-MM-DD>
sha256sum -c SHA256SUMS.txt   # must report OK for verification-report.json
```

Then package the sanitized evidence for later import (a separate, authorized step):

```bash
tar -czf truck-backend-verification-evidence.tgz verification-report.json SHA256SUMS.txt
sha256sum truck-backend-verification-evidence.tgz > truck-backend-verification-evidence.tgz.sha256
```

## No cleanup

This verifier **creates nothing** in production — no Auth users, no fixtures, no documents, no
transactions/batches. Therefore there is **no cleanup step and no recovery manifest**. The only
artifacts are the local evidence files under `--evidence-dir` and your local `*.local.json` config
(never committed).

## Stop conditions

- **Stop before** evidence import, any remediation, any deletion, or any second truck creation.
- **Halt** and report (do not retry blindly) if: any check fails; the checkout is not clean or its
  HEAD ≠ `governedCommit`; `--confirm-project` ≠ `taylor-parts`; a service-account key file or an
  emulator target is detected; the report already exists at the target `--evidence-dir` (the
  verifier refuses to overwrite); or any read is denied / times out (fails closed).
- This runbook does **not** authorize deployment, activation of the ninth delete callable, the
  Created-in-Error deletion, or any modification of the quarantined record.
