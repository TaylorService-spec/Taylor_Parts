# Truck Registry — Gate D Functions Deployment Verification (evidence)

**Populated 2026-08-01.** One governed, Owner-authorized operator run deployed the eight trusted truck
callables to `us-central1` and ran the merged verifier once; its sanitized evidence is imported here
byte-exact under `verify-2026-08-01/`. This import is repository/docs-only — no production access and no
verifier rerun occurred. Provenance (imported-evidence facts vs operator-relayed facts) is recorded in
[`verify-2026-08-01/import-validation.md`](verify-2026-08-01/import-validation.md).

See the operator runbook: [`docs/operations/truck-registry-functions-deploy-handoff.md`](../../operations/truck-registry-functions-deploy-handoff.md).

## Contents

- `verify-2026-08-01/verification-report.json` — the single **sanitized** evidence object emitted by the
  verifier (discovery + denial + governed success sequence + expected fail-closed deactivate, with pass
  counts, `matrix_total`, `governedCommit`, project, region, and the zero-residual lifecycle fields).
  No tokens, keys, credentials, emails, uids, run prefix, or production data. SHA-256
  `66e41b7c2e5a1edec21346fa9fdb7f8a6fabdb8f8049af7d3ffaa226e023b80e`.
- `verify-2026-08-01/SHA256SUMS.txt` — checksum of the report (`sha256sum -c` → OK).
- `verify-2026-08-01/truck-functions-gate-d-evidence.tgz.sha256` — transit-integrity anchor: the
  published archive SHA-256 `fade7013…` (recomputed = posted). The `.tgz` itself is intentionally not
  committed (matching the Gate C recapture precedent).
- `verify-2026-08-01/import-validation.md` — the import validation + provenance separation.
- `verify-2026-08-01/.gitattributes` — `* -text`, preserving the evidence bytes.
- `deployment-report.md` — populated from the imported evidence (evidence-backed vs operator-relayed).

## Guarantees the evidence attests

- All eight callables discovered at **us-central1**.
- **Unauthenticated** and **unauthorized-authenticated** denial for all eight.
- Governed authorized sequence applied (version 1..7); **`deactivateTruckCallable` fail-closed**
  (`failed-precondition`) as expected.
- Cleanup completed; **zero** residual documents and **zero** residual temporary Auth users
  (independently verified).

## What this evidence is NOT

- Not a readiness activation. `TRUCK_MANAGEMENT_WRITE_READY` stays `false` through Gate D.
- Not a Gate D closure. Closure is a separate Owner decision (below).
- Not fabricated: the imported values are the operator run's sanitized report; the deploy exit code,
  inventory/deploy-log hashes and other deployment facts are not fields of that JSON — they are recorded
  separately as operator-relayed facts (supplied through the governed execution channel, not
  re-queried here), clearly attributed in `verify-2026-08-01/import-validation.md` §C.

## Gate D closure assessment (recommendation — closure is a separate Owner decision)

The technical bar for Gate D closure is met on the correctly-separated combination of imported evidence
and operator-relayed execution facts (see `verify-2026-08-01/import-validation.md` §A/§C):

Imported evidence (fields of `verification-report.json`; project/region `taylor-parts` / `us-central1`):
- Verifier matrix **32/32 PASS** — live `discovery` 8/8, `denial` 16/16, `sequence` 8/8.
- Deactivate **FAIL_CLOSED_AS_EXPECTED** (the intended posture until a real inventory predicate).
- Lifecycle clean: `cleanup_complete = true`, residual documents **0**, residual Auth users **0**.
- Integrity: archive SHA `fade7013…` (= posted + sidecar), report SHA `66e41b7c…` (`sha256sum -c` OK),
  sensitive-scan clean, byte-exact import.

Operator-relayed execution facts (not JSON fields; not re-queried here):
- Deployed from the clean exact-head checkout at `1d9d685…` using the exact eight-name Functions-only
  allowlist (no broad deploy); deploy **exit 0**.
- Pre-deploy 8 targets **absent** (12 existing Functions; inventory SHA `d9b23f1e…`) → post-deploy 8
  **present / 0 missing** (deploy-log SHA `b03ea75f…`, post-deploy inventory SHA `952b39bd…`).
- Readiness remained **false**; **recovery not invoked**.

Repository-verifiable: `TRUCK_MANAGEMENT_WRITE_READY = false` at the governed head; no
callable-implementation / frontend / Rules / Hosting change.

Recommendation: **RECOMMEND CLOSE Gate D** — the targeted deployment and its single governed verification
are complete and clean on the combined record above. Optional caveat the Owner may weigh:
`deactivateTruckCallable` remains intentionally fail-closed pending the real inventory predicate (a
separate, later gate); this does not affect the deploy/verification outcome. **This document does not
itself close Gate D.** Note the `governedCommit` JSON field proves the verifier's checkout pin; the
deployed-source claim rests on the operator-relayed checkout→build→deploy sequence, not the field alone.

Next (each separately authorized): Gate D closure decision → Gate E (flip `TRUCK_MANAGEMENT_WRITE_READY`
→ `true` + Hosting release + visual acceptance) → later, the real deactivate inventory predicate.
