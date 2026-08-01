# Gate C — Production Recapture Evidence: Import Validation (2026-08-01)

Repository/docs-only import of the sanitized Gate C production-verification evidence produced by the
governed Truck Registry smoke verifier (merged at `55a449882c649027fb5018458a62ab377f79c9b3`). This
record documents the INDEPENDENT verification performed at import; it does not modify, replace, or
reinterpret the evidence bytes. No production access, deployment, or verifier rerun occurred here.

## Source artifact
- Archive: `truck-registry-rules-deployment-evidence.tgz`
- Archive SHA-256 (independently recomputed at import, matches the separately-relayed value):
  `38690963ee43584b0799f7ea6111b653e32f87cc4ef355cf2a68e68ad7f15e96`
- Sidecar `truck-registry-rules-deployment-evidence.tgz.sha256` (imported here) — exactly one SHA,
  equal to the archive hash above.

## Import-time verification (all PASS)
- **Transit integrity:** recomputed archive SHA-256 == the relayed value == the sidecar value.
- **Safe inspection:** the archive members are 4 regular files (+ the `./` dir); no absolute paths,
  no `..` traversal, no symlinks/hardlinks, no device nodes.
- **Internal checksums (3/3):** `sha256sum -c SHA256SUMS.txt` OK for `smoke-results.json`,
  `production-matrix.json`, `crosswalk.json` — re-verified again after copy into this directory.
- **Sensitive scan:** CLEAN — no credential material, bearer/ID tokens, API keys, email addresses,
  Auth UIDs, or absolute local paths appear in any evidence file.
- **Byte preservation:** imported byte-exact; this directory carries `.gitattributes` (`* -text`,
  also inherited from the parent audit dir) so the bytes are preserved verbatim.

## Evidence provenance (read FROM the imported JSON files and verified at import)
These fields are present IN `smoke-results.json` (cross-checked against `production-matrix.json`)
and were read/verified from the byte-exact imported bytes — nothing here is taken from chat:
| Field | Value |
|---|---|
| recaptured | `true` |
| recapture_date | `2026-08-01` |
| note | post-deployment recapture — NOT original deployment-time output |
| governedCommit | `55a449882c649027fb5018458a62ab377f79c9b3` |
| governed_rules_sha256 | `bb1492b98cba95cb30ac23f7078f0fdba24befa64fa604da27d84ddc9ebac907` |
| matrix_total | 136 |
| passed / failed | 136 / 0 |
| list checks (collection reads) | 8 |

The verifier asserts `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED` (against the compiled pin
`bb1492b9…07`) BEFORE creating any fixture, so this run re-establishes that the LIVE production
Firestore Rules equal the governed source, and then proves the full 136-check allow/deny matrix
(incl. the 8 collection-`list` checks the real UI performs) passes in production. **Cleanup and
residual counts are NOT fields in these JSON files** — see the operator-relayed terminal result below.

## Operator-relayed terminal result (NOT read from the imported JSON; not independently re-verified here)
The following sanitized terminal lines were produced by the governed verifier's own run and relayed
by the operator (and independently confirmed by Codex's separate intake). The governed verifier
performs cleanup and independent residual verification INSIDE the run itself; this docs-only import
did NOT query production and therefore cannot independently re-verify them here:
```
CLEANUP-DONE for trc_gatec_6d411242cacef3e9
RESIDUAL-DOCS 0 ; RESIDUAL-AUTH-USERS 0
GATE-C RECAPTURE OK matrix_total=136 passed=136 failed=0 residual-docs=0 residual-users=0
GATE-C-EXECUTION-PASS
```

## Imported files (this directory)
- `smoke-results.json` — the required recapture artifact (136 sanitized `{label,status,expected,pass}` rows).
- `production-matrix.json` — the per-check matrix (136 rows, all pass).
- `crosswalk.json` — the governed rule → check crosswalk.
- `SHA256SUMS.txt` — the bundle's internal checksums (verified 3/3).
- `truck-registry-rules-deployment-evidence.tgz.sha256` — the archive-hash sidecar (provenance anchor).
- `.gitattributes` — `* -text` (byte preservation).

## Gate C closure assessment (for Codex + Owner review — NOT a unilateral closure)
This recommendation rests on TWO clearly-separated sources:
1. **Byte-exact imported evidence** (verified at import): the LIVE rules equal the governed pin and
   the deployed rules enforce the full 136-check governed allow/deny matrix with 0 failures
   (`smoke-results.json` / `production-matrix.json`).
2. **The separately-recorded successful verifier terminal result** (operator-relayed, above; also
   confirmed by Codex's independent intake): the governed verifier's in-run cleanup completed and
   its independent residual verification reported 0 documents / 0 Auth users
   (`CLEANUP-DONE …` / `RESIDUAL-DOCS 0 ; RESIDUAL-AUTH-USERS 0` / `GATE-C-EXECUTION-PASS`).

This docs-only import did not itself query production, so the cleanup/residual facts are attributed
to source (2), not to the imported JSON.

Recommendation: this satisfies the governed production verification required to **close Gate C**.
The deploy-event provenance (rollback baseline, `firebase deploy` output, and pre/post Functions
inventory) belongs to the earlier Rules-deployment operator run and is NOT part of this recapture
bundle; the recapture instead re-proves the durable end-state (live == governed + full matrix pass)
independently. Any decision to close Gate C on this basis is the Owner's, after Codex review of
this PR.
