# ATLAS OBSERVATION BASE
Named code-state baselines for CURRENT EOS findings. A code-derived claim cites a baseline id (OBSERVED AGAINST: ATLAS-BASE-…), never "see github.md" / "current repo" / "current EOS". A finding from any other branch/commit names its own baseline. Seeded pages not yet reverified state: OBSERVED AGAINST: REVERIFICATION REQUIRED AT FAMILY OPEN.

## ATLAS-BASE-2026-09-10-A
- repository: TaylorService-spec/Taylor_Parts
- branch: main (merged main)
- commit: 078fd5dd (short SHA as recorded at observation; full SHA to be captured on next read)
- observed: 2026-09-10 (Cycle Counts Owner-correction pass; A4 governed read verified merged)
- status: VALID for findings made on/before 2026-09-10. main has since advanced.

## ATLAS-BASE-2026-09-12-A — PIN REQUIRED
- repository: TaylorService-spec/Taylor_Parts
- branch: main (merged main)
- commit: UNPINNED — compare run 2026-09-12T15:18Z shows main is 36 commits ahead of 078fd5dd, including authority-relevant change under docs/architecture (firebase-exit baseline/manifest/ratchet, inventory capability parity P1a evidence, inventory reference authority P1b census, operational-data-plane inventory-authority cutover) and scan-workspace user-guide updates.
- rule: no CURRENT EOS claim may cite this baseline until the exact head SHA is recorded here at the next governed repo read (first family open). Until pinned, all pre-2026-09-12 authority findings are REVERIFICATION REQUIRED AT FAMILY OPEN — the firebase-exit and inventory-authority churn makes stale findings likely.

## Related repository
- TaylorService-spec/project-keystone @ productization/verenward-data-platform-a-b, baseline fd4febd86f52efdfa5b4d3e8beaa1d4914a21af2 (Keystone family findings only) — ATLAS-BASE-KEYSTONE-A.
