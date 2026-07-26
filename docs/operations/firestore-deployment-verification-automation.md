# Governed Firestore deployment verification automation

This operator workflow automates the read-only verification that follows a separately authorized Firestore Rules deployment. It does **not** deploy anything, create or alter Firebase Auth users, change role/claim data, write Firestore data, merge a PR, or begin C1/C2.

## Safety model

- The exact production project, full governed Git commit, and Git/LF Rules SHA-256 are pinned in configuration.
- The five required persona credentials are supplied only through environment variables. Values, emails, UIDs, ID tokens, refresh tokens, API keys, and live Rules API payloads are never written to evidence.
- Authentication for **all** personas completes before the first Firestore production request. Any missing or invalid identity aborts the run.
- Firestore REST is used so HTTP semantics remain explicit: `200` is an allowed collection read, `404` is an authorized missing-document read, and `403` is Rules denial.
- Every attempted write targets the governed probe ID and must return `403`; a different status fails immediately. No successful Firestore write is accepted.
- The extracted live `firestore.rules` source must be byte-identical to `git show <commit>:firestore.rules` and match its configured Git/LF SHA-256.
- A normalized, read-only live Functions inventory must exactly match a separately captured governed predeployment baseline. The supplied deployment log must prove `firestore:rules` scope and contain no Functions, Hosting, Storage, or Extensions deployment.
- Evidence is sanitized, secret-scanned, written with restrictive permissions, and checksummed. Tokens live only in memory and are cleared before evidence writing.

## Operator contract

Prerequisites are Node 20+, authenticated `gcloud` read access, the five existing governed test identities, a Firebase Web API key, the Rules-only deployment log, and the full predeployment Cloud Functions v2 API inventory JSON. The workflow normalizes the inventory before comparison and evidence capture.

Start from a clean checkout of the governed verification branch. Copy `config/firestore-deployment-verification.example.json` to a local `*.local.json` file if a different governed commit/hash is being verified; local config files must not be committed. Put credential values in the environment names referenced by that config. Then run:

```text
cd functions
npm run verify:firestore-deployment -- \
  --config ../config/firestore-deployment-verification.example.json \
  --deployment-log ../sb-evidence/deploy-output.txt \
  --functions-baseline /secure/path/predeploy-functions-api.json \
  --evidence-dir /secure/path/governed-evidence
```

The command is intentionally all-or-nothing. It returns PASS only after 55/55 matrix checks, live Rules byte equality, Rules-only scope proof, and exact Functions-inventory equality. A failure produces no success evidence and requires operator review; it never attempts rollback or deployment.

## Evidence

Successful output contains:

- `verification-summary.json`
- `production-matrix.json`
- `production-matrix.md`
- `functions-inventory.normalized.json`
- `SHA256SUMS.txt`

The evidence intentionally contains persona labels and status codes only. It excludes identity identifiers and credentials.

## Genuine approval points

An owner approves the governed commit/hash and any deployment separately. An owner also reviews the resulting evidence PR and decides whether to merge it. Credential entry can be performed by the authorized operator or a managed secret-injection system; the owner does not need to run repository commands.
