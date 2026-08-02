# Gate E4 — Truck ID 1 Backend Verification: Evidence Import Validation (2026-08-02)

Repository/docs-only import of the sanitized Gate E4 backend-verification evidence produced by **one**
governed, Owner-authorized, **read-only** operator run of the merged verifier
(`functions/scripts/truckBackendVerifierCli.js` at commit
`d9bd532dbdd8c6e38176f55274f993be2baabd38`). **No production access, no verifier rerun, no mutation of
Truck ID 1, and no deployment** was performed in this import. This document separates (A) facts read
from the imported evidence, (B) the integrity verification performed here, and (C) transit provenance —
with an explicit, accurate note on which artifact was downloaded and which was reconstructed.

## A. Evidence provenance — READ FROM `verification-report.json`

Every value below is a field of the imported, sanitized `verification-report.json` (SHA-256
`4b59eea7c87e80abc76c06b2fbeca42081f209068fb529174b90cfb7ee2802af`):

| Field | Value |
| --- | --- |
| `verified` | `true` |
| `verify_date` | `2026-08-02` |
| `governedCommit` | `d9bd532dbdd8c6e38176f55274f993be2baabd38` |
| `project` / `region` | `taylor-parts` / `us-central1` |
| `truckId` | `1` |
| `expected` | `displayLabel "10"`, `vehicleNumber "10"`, `status "IDLE"`, `homeWarehouseId "wh-main"`, `assignedDriverEmployeeId null` |
| `stored` | `version 3`, `active true`, `status "IDLE"`, `driverAssigned false` |
| `locationIdSha256` | `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b` (hash only; raw MOBILE location id not disclosed) |
| `audit_summary.appliedCreateTruck` | `1` |
| `audit_summary.appliedUnassignTruckDriver` | `1` |
| `audit_summary.appliedChangeTruckStatus` | `1` |
| `audit_summary.otherAppliedCount` / `deniedCount` / `uncertainCount` | `0` / `0` / `0` |
| `audit_summary.versionEqualsAppliedCount` | `true` |
| `audit_summary.creationPrecedesContainment` | `true` |
| `matrix_total` / `passed` | `30` / `30` (0 failed) |

The report is sanitized: it carries governed booleans, counts, the Owner-supplied ids/labels, the
stored `version`, a non-reversible `locationIdSha256`, and PASS/FAIL categories only — no tokens, keys,
credentials, emails, uids, actor identifiers, raw summaries, unrelated document ids, or production data.

### What the imported evidence independently attests (from the report)

- `trucks/1` exists exactly once; stored id == doc id; `version` is a positive integer (`3`); the
  expected label / vehicle / status / warehouse and a **null** driver; a valid `locationId`; `active`.
- `mobile_locations/{locationId}` exists once by id; `type == "MOBILE"`; `active`.
- `location_truck_claims/{locationId}` exists; id == doc id; `truckId == "1"`; the truck / location /
  claim identities are reciprocal.
- No hidden duplicates (bounded, deterministic queries; zero / one / multiple / malformed /
  query-failure distinguished; exactly one truck references the location and exactly one claim points
  to the truck).
- Exactly one **applied** `createTruck`, one `unassignTruckDriver`, one `changeTruckStatus`; no other
  applied action; no malformed / uncertain outcome (audit membership established by `targetType ==
  "truck"`, never inferred).
- Cross-record coherence: stored `version` (3) equals the applied-audit count (3); creation precedes
  the containment actions; final state is **IDLE + unassigned**; no write API was reachable.

## B. Integrity verification performed during import (repository-side)

- `origin/main` reconciled to the exact governed head `d9bd532…` before import — no drift.
- Archive SHA-256 recomputed = `be6e62ac5ff5b54478dc57060daad197168ba723865e90181e2ea2150bf00fba`,
  equal to the separately posted Cloud Shell hash **and** the transit sidecar value (3-way match).
- Archive members inspected before extraction: exactly two regular files
  (`verification-report.json`, `SHA256SUMS.txt`) — no absolute paths, no `..` traversal, no symlinks,
  hardlinks, or device/special entries.
- `SHA256SUMS.txt` reverified against `verification-report.json` → `verification-report.json: OK`
  (recomputed report SHA equals the listed `4b59eea7…`); **not** regenerated.
- Sensitive-content scan (token / key / credential / email / local-path / raw-locationId shapes) → clean.
- Both files imported byte-exact; post-copy SHA and `sha256sum -c` re-verified in the worktree with
  `.gitattributes` `* -text` preserving the bytes.
- This matches Codex's independent intake result (archive SHA, member set, report SHA, `verified=true`,
  governed commit / project / region, 30/30, applied audit counts, coherence, sensitive-scan clean).

## C. Transit provenance — accurate artifact attribution

| Artifact | Origin | Committed here |
| --- | --- | --- |
| `truck-1-gate-e4-backend-evidence.tgz` (the archive) | **Downloaded from Cloud Shell** after the single authorized read-only production run. | **No** — the `.tgz` binary is intentionally not committed (matches the Gate C/D precedent). |
| Separately posted archive SHA-256 | Posted from the Cloud Shell run: `be6e62ac…`. | Recorded in this document and matched. |
| `truck-1-gate-e4-backend-evidence.tgz.sha256` (sidecar) | **Reconstructed**, not downloaded — the browser failed to materialize the original Cloud Shell sidecar download. Codex reconstructed the deterministic 103-byte `sha256sum` sidecar from the separately posted hash + the exact archive basename. | **Yes** — as a **byte-equivalent reconstructed transit anchor**, explicitly not claimed to be the Cloud Shell-downloaded bytes. |
| `verification-report.json`, `SHA256SUMS.txt` | Extracted byte-for-byte from the downloaded, hash-verified archive. | **Yes** — byte-exact. |

**Attribution note.** The committed sidecar (`…tgz.sha256`) is a **reconstructed** byte-equivalent
transit anchor, **not** the original Cloud Shell download. Its value equals the independently recomputed
archive SHA-256, so it faithfully anchors the archive's integrity; it is recorded as a reconstructed
anchor rather than a downloaded artifact. The archive integrity itself does not depend on the sidecar
provenance — it rests on the recomputed archive hash matching the separately posted Cloud Shell hash
(Section B). The evidence facts in Section A rest on the byte-exact `verification-report.json` extracted
from that hash-verified archive.

## Files imported (byte-exact) under `verify-2026-08-02/`

- `verification-report.json` — the single sanitized evidence object (SHA-256 `4b59eea7…`).
- `SHA256SUMS.txt` — checksum of the report (`sha256sum -c` OK).
- `truck-1-gate-e4-backend-evidence.tgz.sha256` — reconstructed transit-integrity anchor (archive SHA
  `be6e62ac…`; the `.tgz` itself is intentionally **not** committed).
- `.gitattributes` — `* -text`, preserving the evidence bytes so the checksums keep verifying.
