# Gate D — Functions Deployment Verification: Evidence Import Validation (2026-08-01)

Repository/docs-only import of the sanitized Gate D evidence produced by one governed, Owner-authorized
operator run of the merged verifier. **No production access, no verifier rerun, no deployment** was
performed in this import. This document separates (A) facts read from the imported evidence, (B) the
integrity verification performed here, and (C) operator-relayed deployment facts — with an explicit
note on which of those were, and were not, supplied to this import.

## A. Evidence provenance — READ FROM `verification-report.json`

Every value below is a field of the imported, sanitized `verification-report.json` (SHA-256
`66e41b7c2e5a1edec21346fa9fdb7f8a6fabdb8f8049af7d3ffaa226e023b80e`):

| Field | Value |
| --- | --- |
| `verified` | `true` |
| `verify_date` | `2026-08-01` |
| `governedCommit` | `1d9d6854ba531dfd13d467f9d02a03656b37c18a` |
| `project` | `taylor-parts` |
| `region` | `us-central1` |
| `matrix_total` / `passed` | `32` / `32` |
| `discovery` | `8 / 8` (all eight callables present @ us-central1) |
| `denial` | `16 / 16` (unauthenticated + unauthorized-authenticated, all eight) |
| `sequence` | `8 / 8` (create→assign→reassign→unassign→status→home-warehouse→deactivate→reactivate) |
| deactivate step | `FAIL_CLOSED_AS_EXPECTED` (`seq:deactivate:deactivateTruckCallable`) |
| `cleanup_complete` | `true` |
| `residual_documents` | `0` |
| `residual_auth_users` | `0` |

The report is sanitized: it contains governed labels only (no tokens, keys, credentials, emails, uids,
run prefix, or production data). It carries no deploy exit code, no deployment command, and no
pre/post-deploy function-inventory hashes — those are not report fields.

## B. Integrity verification performed during import (repository-side)

- `origin/main` reconciled to the exact governed head `1d9d685…` before import — no drift.
- Archive SHA-256 recomputed = `fade7013389813efef5cf198a72188079d636aa92db6789fff7134a5f5b9c9e4`,
  equal to the separately posted SHA and the transit sidecar.
- Archive members inspected before extraction: exactly two regular files
  (`verification-report.json`, `SHA256SUMS.txt`) — no absolute paths, no `..` traversal, no symlinks,
  hardlinks, or device entries.
- `SHA256SUMS.txt` reverified against `verification-report.json` → `verification-report.json: OK`
  (recomputed report SHA equals the listed and separately posted `66e41b7c…`).
- Sensitive-content scan (JWT/API-key/bearer/email/absolute-path/secret shapes) → clean.
- Both files imported byte-exact; post-copy SHA and `sha256sum -c` re-verified in the worktree.
- This matches Codex's independent intake result (archive SHA, member set, report SHA, `verified=true`,
  governed commit/project/region, 32/32, 8/8/8, deactivate fail-closed, cleanup_complete, 0/0 residual,
  sensitive-scan clean).

## C. Operator-relayed deployment facts — provenance note

The runbook's deployment record (deploy exit code, the exact eight-name deploy command used, and the
pre/post-deploy function-inventory hashes) are **operator terminal facts**, not fields of the imported
evidence. This evidence-import authorization relayed only the Codex intake result (all of which is
derived from the report in §A) — it did **not** include a separate operator terminal transcript with
the deploy exit code or inventory hashes. To avoid the provenance weakness corrected in Gate C, those
values are therefore **NOT recorded here as facts and are NOT fabricated**; if required for closure they
must be supplied by the operator in a subsequent, clearly-attributed relay.

What the imported evidence independently attests about the deployment outcome:
- **All eight target callables are deployed and reachable at us-central1** — the verifier's
  `discovery` = 8/8 (a positive verification against the live project), which the report records.
- The eight governed flows behave correctly in production (denial 16/16, applied sequence, deactivate
  fail-closed) with a clean lifecycle (cleanup complete, zero residual docs/users).

Separately repository-verifiable (not from the report): at the governed head `1d9d685…`,
`field-ops-app-vite/src/config/truckManagementReadiness.js` has `TRUCK_MANAGEMENT_WRITE_READY = false`
— **readiness remains false**; this import changes nothing.

## Files imported (byte-exact) under `verify-2026-08-01/`

- `verification-report.json` — the single sanitized evidence object.
- `SHA256SUMS.txt` — checksum of the report (`sha256sum -c` OK).
- `truck-functions-gate-d-evidence.tgz.sha256` — transit-integrity anchor (archive SHA; the `.tgz`
  itself is intentionally **not** committed, matching the Gate C recapture precedent).
- `.gitattributes` — `* -text`, preserving the evidence bytes.
