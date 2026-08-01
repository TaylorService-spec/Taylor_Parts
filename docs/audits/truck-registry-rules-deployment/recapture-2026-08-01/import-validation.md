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

## Evidence provenance (read from `smoke-results.json`, cross-checked against `production-matrix.json`)
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
| production execution cleanup | complete |
| residual documents / Auth users | 0 / 0 |

The verifier asserts `LIVE-EXTRACTED-SOURCE-EQUALS-GOVERNED` (against the compiled pin
`bb1492b9…07`) BEFORE creating any fixture, so this run independently re-establishes that the LIVE
production Firestore Rules equal the governed source, and then proves the full 136-check
allow/deny matrix (incl. the 8 collection-`list` checks the real UI performs) passes in production,
with all disposable fixtures/Auth users cleaned up and residuals independently verified at 0/0.

## Imported files (this directory)
- `smoke-results.json` — the required recapture artifact (136 sanitized `{label,status,expected,pass}` rows).
- `production-matrix.json` — the per-check matrix (136 rows, all pass).
- `crosswalk.json` — the governed rule → check crosswalk.
- `SHA256SUMS.txt` — the bundle's internal checksums (verified 3/3).
- `truck-registry-rules-deployment-evidence.tgz.sha256` — the archive-hash sidecar (provenance anchor).
- `.gitattributes` — `* -text` (byte preservation).

## Gate C closure assessment (for Codex + Owner review — NOT a unilateral closure)
The imported evidence establishes the **production-verification** leg of Gate C for the merged
Truck Registry Rules: at 2026-08-01 the LIVE rules equal the governed pin, the deployed rules
enforce the full 136-check governed allow/deny matrix (0 failures), and the run created only
disposable prefixed fixtures/Auth users which were cleaned up with independently-verified 0/0
residuals. Codex's independent intake returned FINAL PASS on the same bundle.

Recommendation: this satisfies the governed production verification required to **close Gate C**.
The deploy-event provenance (rollback baseline, `firebase deploy` output, and pre/post Functions
inventory) belongs to the earlier Rules-deployment operator run and is NOT part of this recapture
bundle; the recapture instead re-proves the durable end-state (live == governed + full matrix pass)
independently. Any decision to close Gate C on this basis is the Owner's, after Codex review of
this PR.
