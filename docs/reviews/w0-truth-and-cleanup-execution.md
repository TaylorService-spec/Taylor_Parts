---
artifact_type: review
gate: W0 — Truth & Cleanup Foundation (execution record)
wave: W0
status: Complete — awaiting Codex review + Owner approval at section boundary
date: 2026-08-05
owner: Claude Code
base_commit: 7b7546d (origin/main)
branch: chore/w0-truth-cleanup
blueprint: docs/specifications/rough-complete-build-blueprint.md
---

# W0 — Truth & Cleanup Foundation: execution record

W0 is the first Blueprint section. Its job is **repository truth**: make the
codebase's comments/labels tell the truth, mark placeholder/demo surfaces
honestly, and relabel the legacy Jobs surfaces so they cannot masquerade as the
canonical Work Order experience — all **operationally behavior-preserving** (W0 ≠ W4;
no data migration, no module retirement, no routing/write-path change). "Operationally
behavior-preserving" is precise: two changes ARE observable — the Jobs.jsx heading
text and the demoControls console key (`ENV`→`search`) — but both are intended
presentation/developer-interface changes, not operational logic.

## Headline finding: the design review is not authoritative

The design review's "16 safe-fixes" are **not** purely mechanical — several assert
factual consumer/orphan claims, and at least one was **wrong**. The review called
`explainWorkOrderState` orphaned, but it is **live-consumed** by
`workOrderScoring.js`. Its line numbers were also stale (it cited constants.js:266
for a note that is actually near line 330). Per the Owner's direction, W0 treated
the review as **input, not authority**: every consumer/orphan claim was verified by
grepping real consumers before any comment was written.

## Safe-fixes: 13 applied (verified), 1 not-applicable, 2 deferred

Each applied fix is comment/label/JSX-text only, corrected to the **verified** truth:

| # | File | What was corrected (verified) |
|---|------|-------------------------------|
| 1 | `domain/workOrderLifecycle.js` | Replaced the false "all four exports serve timelineBuilder" claim with the real map: `computeWorkOrderState`→timelineBuilder; `explainWorkOrderState`→workOrderScoring's legacy signal; `isActiveWorkOrder`/`isCompletedWorkOrder`→genuinely orphaned. |
| 2 | `domain/workOrderScoring.js` | `computeWorkOrderSignalFromDoc` is the LIVE path (→WorkOrderDetail.jsx); `computeWorkOrderSignal(jobs)` is orphaned/legacy. |
| 3 | `domain/eventModel.js` | `groupEvents` verified zero-consumer; softened the "Activity Timeline filter" claim. |
| 4 | `domain/workOrders.js` | `workOrdersStore` verified zero-consumer + non-canonical; the canonical WO model is `fieldops_wos`. |
| 5 | `domain/inventoryReorderRequests.js` | Enumerated the 8 omitted receiving/cancel/void fields the writer actually sets. |
| 6 | `domain/constants.js` | `WORK_ORDER_STATE` marked DEPRECATED (legacy jobs-aggregate); canonical is `fieldops_wos.status`. |
| 7 | `domain/accountWorkOrders.js` | Added canonical-`WorkOrderStatus` keep-in-sync signpost (verified in sync with `workOrderWorkflow.js`). |
| 8 | `modules/inventory/PartDetail.jsx` | Documented `refreshReorderRequest` as a verified no-op (onSnapshot; `useReorderRequests.js:204`). |
| 9 | `hooks/useSessionActivityFeed.js` | Corrected the false "status **or assignedTechId** difference" gate → the real gate is **status-only** (`:50`). |
| 10 | `shared/ui/AppHeader.jsx` | Removed the verified-dead `import React`. |
| 11 | `firebase/firebase.js` | Documented the intentional apiKey split (public client id, not a secret). |
| 12 | `navigation/navConfig.js` | Corrected the muddled citation → `docs/architecture/SYSTEM_AUTHORITIES.md`. |
| 13 | `lib/demoControls.js` | Relabeled the misleading console key `ENV:` → `search:` (it prints `window.location.search`). |

**Not applicable (1):** `modules/accounts/AccountForm.jsx` — the review's "3-4 field"
phrasing **no longer exists** in the file (already superseded). Verify-first
prevented a spurious edit; no change made.

**Deferred to the parallel session (2) — coordination item, NOT W0's to touch:**
`modules/mobile/PartsScanner.jsx` (not on `main` — the parallel session's untracked
file) and `field-ops-app-vite/src/App.jsx` (parallel WIP has it modified). Their two
safe-fixes are *about labeling that session's own demo file*, so they belong to its
owner. See "Batched coordination" below.

## Legacy Jobs surfaces relabeled (R1 / criterion #3)

- `modules/jobs/Jobs.jsx` — heading `<h2>Work Orders</h2>` → `<h2>Job Assignments</h2>`
  (the masquerade), plus a LEGACY module-header note: this "Service › Job Assignments"
  screen operates on the legacy `JOBS_COLLECTION`, not the canonical `fieldops_wos`.
- `modules/dispatch/Dispatch.jsx` — heading is honestly "Dispatch" (no user-visible
  change needed); added a LEGACY module-header note distinguishing it from the
  canonical `fieldops_wos` Work Order dispatch.

## Placeholder/demo honesty (criterion #2): already satisfied

Verified across the codebase — placeholder/demo surfaces **already carry honest
labels** and needed no new edits: `PlaceholderPage.jsx` ("This area isn't built
yet…"), legacy demo `Inventory.jsx` ("Visual/demo layer only… in-memory, no
Firestore"), the equipment surfaces ("not yet connected… Nothing here is
simulated"), the administration surfaces ("not yet deployed and verified (Issue
#15)"), and `TruckInventory` ("not yet enabled"). The **one** unlabeled
demo surface is `PartsScanner.jsx` — deferred (parallel-owned).

## Acceptance criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | All safe-fixes applied; build/lint/typecheck green | **PASS** — 13 applied, 1 N/A, 2 deferred; `lint`/`typecheck`/`build` all exit 0 |
| 2 | Every placeholder/demo surface honestly labeled | **PASS** — verified already honest (except deferred PartsScanner) |
| 3 | Legacy `Jobs.jsx`/`Dispatch.jsx` relabeled | **PASS** |
| 4 | Stale WO-Engine-v1.2 comments/enum corrected | **PASS** (constants/workOrderLifecycle/workOrderScoring/workOrders) |
| 5 | Zero operational logic, routing, persistence, lifecycle, or write-path change | **PASS** — changes are limited to comments, truthful labels/presentation text, one developer-console key correction, and one dead-import removal. (The Jobs.jsx heading and the demoControls `ENV`→`search` key ARE observable presentation/dev-interface changes — intended, and not operational behavior.) |

Verification commands (worktree, deps installed): `npm run lint` (only pre-existing
unrelated warnings), `npm run typecheck` (exit 0), `npm run build` (exit 0, 447ms).

## Batched coordination (for the parallel-session owner — not routed as routine)

The parallel session owns `PartsScanner.jsx` and `App.jsx`. Two items belong to it:
1. **`PartsScanner.jsx` is a governance-drift risk:** it is (or will be) live-routed
   in the production nav but is backed entirely by the in-memory demo
   `InventoryContext`, with no label. A developer would mistake it for the real
   `inventory_transactions` write path. It needs a demo-backed module header (the two
   deferred safe-fixes cover exactly this).
2. **`App.jsx`** — the `technicianWorkspace → PartsScanner` special-case wants a
   provenance comment matching its siblings. Deferred with PartsScanner.

## Not done / boundaries

No deploy, no production, no Firestore Rules change, no identity/Blaze, no data
migration, no module retirement (that is W4). Nothing merged — this is a repo-only
branch awaiting Codex review + Owner approval at the W0 section boundary.
