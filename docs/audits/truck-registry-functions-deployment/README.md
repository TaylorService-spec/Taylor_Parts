# Truck Registry — Gate D Functions Deployment Verification (evidence)

Scaffolding only. **No deployment has occurred and no completed evidence exists in this gate.** This
directory will hold the sanitized post-deployment verification evidence produced by the governed
verifier (`functions/scripts/truckFunctionsVerifierCli.js`) when the targeted deployment of the eight
trusted truck callables is later executed under separate Owner authorization.

See the operator runbook: [`docs/operations/truck-registry-functions-deploy-handoff.md`](../../operations/truck-registry-functions-deploy-handoff.md).

## Contents (populated only at verification time)

- `verify-<YYYY-MM-DD>/verification-report.json` — the single **sanitized** evidence object emitted by
  the verifier (discovery + denial + governed success sequence + expected fail-closed deactivate,
  with pass counts, `matrix_total`, `governedCommit`, project, region). No tokens, keys, credentials,
  emails, uids, run prefix, or production data.
- `verify-<YYYY-MM-DD>/SHA256SUMS.txt` — checksum of the report.
- `truck-functions-verify-<YYYY-MM-DD>.tgz(.sha256)` — packaged evidence + checksum.
- `deployment-report.md` — operator-completed narrative (template provided).

## Guarantees the evidence attests

- All eight callables discovered at **us-central1**.
- **Unauthenticated** and **unauthorized-authenticated** denial for all eight.
- Governed authorized sequence applied (version 1..7); **`deactivateTruckCallable` fail-closed**
  (`failed-precondition`) as expected.
- Cleanup completed; **zero** residual documents and **zero** residual temporary Auth users
  (independently verified).

## What this evidence is NOT

- Not a readiness activation. `TRUCK_MANAGEMENT_WRITE_READY` stays `false` through Gate D.
- Not fabricated: nothing here is filled in until a real, Owner-authorized verifier run produces it.
