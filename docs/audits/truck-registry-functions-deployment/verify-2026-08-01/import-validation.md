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
- Sensitive-content scan (token / key / credential / address / local-path shapes) → clean.
- Both files imported byte-exact; post-copy SHA and `sha256sum -c` re-verified in the worktree.
- This matches Codex's independent intake result (archive SHA, member set, report SHA, `verified=true`,
  governed commit/project/region, 32/32, 8/8/8, deactivate fail-closed, cleanup_complete, 0/0 residual,
  sensitive-scan clean).

## C. Operator-relayed terminal facts — not fields of `verification-report.json` and not independently re-queried during this docs-only import

These deployment facts were relayed by the operator run (via the Gate D authorization + review channel).
They are **not** fields of the imported `verification-report.json`, and this repository/docs-only import
did **not** independently re-query production for them. They are recorded here, clearly attributed, as
operator-relayed execution facts:

| Operator-relayed fact | Value |
| --- | --- |
| Pre-deploy inventory (existing Functions) | 12 |
| Target callables before deploy | 0 present / 8 absent |
| Pre-deploy inventory SHA-256 | `d9b23f1e8b900a974dc8e5296166ff462333963474b8e959e39ebe451a2ec438` |
| Deploy command exit code | `0` |
| Post-deploy target callables @ us-central1 | 8 present / 0 missing |
| Deploy-log SHA-256 | `b03ea75f6f6a14cac40b56a1dc2dc5c5ddf672d80a6d7f9f94d9ef642bff07d0` |
| Post-deploy inventory SHA-256 | `952b39bd884fb2d781b16d724deffb625433b8f9bb97b526e103e7977e13c5fd` |
| Deployment source | ran from the clean exact-head checkout at `1d9d6854ba531dfd13d467f9d02a03656b37c18a` |
| Deploy command | the exact eight-name Functions-only allowlist (no broad deploy) |
| Readiness during/after deploy | remained `false` |
| Recovery | not invoked |

Date: **2026-08-01** (no exact deployment timestamp was relayed; none is invented here).

**Source-attribution.** The imported JSON's `governedCommit` proves the **verifier's** governed checkout
pin (the commit the verifier ran from). That this same commit was the **deployed source** rests on the
operator-relayed clean-exact-head checkout → build → targeted deploy sequence above, **not** on the JSON
field alone. The imported JSON does **not** by itself prove the deploy exit code, the exact deploy
command, pre-deploy absence, the inventory/deploy-log hashes, or rollback status — those are the
operator-relayed facts in this section. "Recovery not invoked" is likewise an operator-relayed execution
fact, not an evidence field.

What the imported evidence **independently** attests about the live outcome (positive verification
against the live project, from the report): `discovery` 8/8 (all eight callables reachable @
us-central1), `denial` 16/16, applied sequence, deactivate fail-closed, cleanup complete, zero residual
docs/users. Repository-verifiable (not from the report): `TRUCK_MANAGEMENT_WRITE_READY = false` at the
governed head — readiness remains false; this import changes nothing.

## Files imported (byte-exact) under `verify-2026-08-01/`

- `verification-report.json` — the single sanitized evidence object.
- `SHA256SUMS.txt` — checksum of the report (`sha256sum -c` OK).
- `truck-functions-gate-d-evidence.tgz.sha256` — transit-integrity anchor (archive SHA; the `.tgz`
  itself is intentionally **not** committed, matching the Gate C recapture precedent).
- `.gitattributes` — `* -text`, preserving the evidence bytes.
