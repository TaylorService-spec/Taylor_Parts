---
artifact_type: assessment
title: Cycle Count A1/A2 — reconciliation of the 2026-09-01 branch against current main
date: 2026-09-10
authority: Owner ruling B5 (Decision #178) — "do not merge claude/cycle-count-a1-spec as-is; preserve it, then reconcile"
result: Spec Revision 2 written; A1 implementation BLOCKED on Owner ruling M-1 (persisted v1 records)
---

# Cycle Count A1/A2 reconciliation (2026-09-10)

## 1. Preservation

| Item | State |
|---|---|
| Branch `claude/cycle-count-a1-spec` | Untouched. Head `f585125d272b592627682054b217aa38eb8dd64e` (as the Owner expected), parent `7e457d7f`. |
| Archive | Tag **`archive/cycle-count-a1-spec-f585125d`** pushed to origin, pinning that exact commit. |
| Content of the branch vs main | Two documents only: `docs/specifications/cycle-count-multi-part-sheet.md` (438 lines) and `docs/implementation-plans/cycle-count-multi-part-and-scheduling.md` (571 lines). Its other files (`cycle-count-submit-accepts-unknown-fields.md`, the cycle-count workflow) are already on main. |
| Rewritten? | **No.** The reconciled spec is a new Revision 2 on a new branch from main; Revision 1 text is retained inside it and verbatim at the tag. |

## 2. The untracked local file — provenance

`docs/implementation-plans/cycle-count-multi-part-and-scheduling.md`, untracked in the `cycle-count-addon-review-ce12ad`
worktree, present before this execution session.

| Check | Result |
|---|---|
| sha256 | `d46c9c35be015d34950d61ea1ed888f1390bb0fbdb8bf7b97a93021312314df3` (571 lines) |
| vs `claude/cycle-count-a1-spec` @ `f585125d` | **byte-identical** (same sha256) |
| vs `7e457d7f` (the plan's own approval commit) | **identical** (the file did not change between the two commits) |
| vs current `main` | absent from main |
| vs other Cycle Count plans on main | none at that path; no divergent copy anywhere |

**Conclusion: IDENTICAL HISTORICAL DRAFT** — a working-tree copy of the approved plan exactly as committed on the A1
branch. It contains no decision that is not preserved at the tag. It was **not** deleted, added, or overwritten, and it
is not treated as authoritative. Because it occupies the plan's path, the reconciled plan is referenced at the archive
tag rather than re-committed to that path from this worktree.

## 3. Facts that changed since 2026-09-01 (measured, not assumed)

| Revision 1 assumed | Current truth | Evidence |
|---|---|---|
| All four `inventory.cycleCount.*` are `active: false` and held by no Role | Activated in platform-sandbox (all four) and platform-certification (create/submit/reconcile); granted through `inventoryCycleCountCounter` / `inventoryCycleCountReconciler`; sandbox personas hold them | `config/environments.json`; `docs/releases/scanner-sandbox-validation-2026-08-21.md` |
| No persisted `cycle_counts` can exist | **24** in `eos-platform-sandbox`, **1** in `eos-platform-certification` | Firestore `runAggregationQuery` count, operator gcloud read, 2026-09-10 |
| BIN out of scope | BIN admitted by BIN-P7 behind the conversion gate | #1840, `cycleCountLocationEligibility.ts` |
| Expected quantity: its own RECEIVED/TRANSFER/ADJUSTED branches | One sign rule (`locationOnHand.signedQuantity`), exact location; includes RELOCATION_* and WORK_ORDER_CONSUMPTION | #1835 |
| Location check: `makeResolveTransferLocationActive` + a `countableLocationTypes` seam | `makeResolveCycleCountLocationEligible` pinned in the composition (shared resolver + BIN gate) | #1840 |
| Track B location labels need `bwip-js` | Delivered by BIN-P5 with a local Code 128 renderer, no dependency | #1773/#1774 |
| Scan session: `cycleCountScanSession.js` refuses `WRONG_PART` | Still true today; the shared `scanObservationQueue.js` now exists (Receiving + Move stock) and is the base for A2/P8 | #1836 |

## 4. Decision-by-decision

| Ref | Ruling (2026-09-01) | Reconciled status |
|---|---|---|
| D0(i) one governed Location authority | APPROVED | **Retained**; satisfied by the shared resolver (WAREHOUSE/MOBILE/BIN). |
| D0(ii) countable types are governed | APPROVED | **Retained and implemented** by BIN-P7 as a pinned policy seam, no Admin data. The `countableLocationTypes` parameter is superseded by that seam. |
| D1 materiality per line | APPROVED | **Retained.** |
| D2 partial per-line disposition | APPROVED | **Retained.** |
| D3 truthful per-line `expectedSnapshotAt` | APPROVED | **Retained**; Rev 2 adds a relocation-between-lines test (35). |
| D4 discovered part uses normal authority | APPROVED | **Retained**; the authority is now the one on-hand rule. |
| D5 one part, one line per sheet | APPROVED | **Retained.** |
| D6 line-atomic, sheet-resumable | APPROVED | **Retained.** Same posture as Move stock's per-line replay-safe batches. |
| D7 concurrent counters: posture only | POSTURE | **Retained.** |
| A1-first ordering; "do not activate the one-part shape merely to gather history" | APPROVED | **Overtaken.** The one-part shape was activated in sandbox (2026-08-20/21 scanner promotion) and certification (CERT-CYCLE-11); 25 records now exist. This is the migration debt the plan warned about — hence M-1. |
| A4 durable read path before A5 activation | APPROVED | **Inverted in sandbox**: A5-equivalent activation and grants exist, A4 does not. Recorded, not changed here; A4 remains the next Cycle Count build item after A1. |
| B1 labels | — | Location labels done (BIN-P5); Part labels remain. |

## 5. Blockers produced by this reconciliation

**M-1 — What happens to the 25 persisted v1 `cycle_counts` records when A1 bumps the schema to v2?** Revision 1
forbids a dual-version reader and instructed a stop if non-emulator records were found; they were. Options are set out in
the spec's *Migration* section (A: close out + export + let the bump retire them — recommended; B: one-time v1→v2
migration; C: dual reader — rejected). No option touches production.

**A1 spec approval.** Revision 1 was itself still pending approval; Revision 2 needs the same.

## 6. Consequence for BIN-P8

BIN-P8 (scan a Bin once, count many Parts, per-line materiality/SoD/resumable reconciliation) **is** the A1 sheet plus
the A2 scan session, scoped to a BIN. Built on today's single-part commands it would be one `cycle_counts` record per
part — the exact shape A1 retires, adding to M-1's debt. BIN-P8 therefore waits for M-1 and A1, as the Owner's
sequence already states ("once P7 and the reconciled A1/A2 foundation are complete").
