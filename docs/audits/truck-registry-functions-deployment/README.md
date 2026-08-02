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
- Not fabricated: the imported values are the operator run's sanitized report; operator terminal facts
  not supplied to this import are explicitly marked as such, not invented.

## Gate D closure assessment (recommendation — closure is a separate Owner decision)

On the imported, independently-verified evidence, the technical bar for Gate D closure is met:

- Governed commit / project / region match the merged Gate D-prep (`1d9d685…` / `taylor-parts` /
  `us-central1`).
- Verifier matrix **32/32 PASS** — discovery 8/8, denial 16/16, sequence 8/8.
- Deactivate is **FAIL_CLOSED_AS_EXPECTED** (the intended posture until a real inventory predicate).
- Lifecycle clean: `cleanup_complete = true`, residual documents **0**, residual Auth users **0**.
- Evidence integrity: archive SHA `fade7013…` (= posted + sidecar), report SHA `66e41b7c…`
  (`sha256sum -c` OK), sensitive-scan clean, byte-exact import.
- Readiness remains **false**; no callable-implementation / frontend / Rules / Hosting change.

Recommendation: **RECOMMEND CLOSE Gate D** (deploy + single verification complete and clean). Two
optional caveats the Owner may weigh before recording closure: (1) the operator terminal facts (deploy
exit 0, pre/post-deploy inventory hashes, exact allowlist command) were not relayed to this import and
could be attached for a fully self-contained deployment record; (2) `deactivateTruckCallable` remains
intentionally fail-closed pending the real inventory predicate (a separate, later gate). Neither blocks
the deploy/verification outcome. **This document does not itself close Gate D.**

Next (each separately authorized): Gate D closure decision → Gate E (flip `TRUCK_MANAGEMENT_WRITE_READY`
→ `true` + Hosting release + visual acceptance) → later, the real deactivate inventory predicate.
