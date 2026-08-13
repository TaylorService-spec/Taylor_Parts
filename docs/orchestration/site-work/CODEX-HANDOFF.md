# Handoff to Codex — Taylor site-work loop (Claude out until next 5-hr window)

Repo: `TaylorService-spec/Taylor_Parts`, branch off `main` (head at handoff: `b9a80fc7`). Everything below is repo-only. **Never**: deploy, edit `firestore.rules`, touch production, or auto-merge without CI green.

## The operation (context)
We run a continuous **site-work loop**: read-only scouts identify concrete defects → Owner approves a prioritized batch → agents fix each on its own branch/PR → integrate/merge → **rescan for what was missed** → repeat until a rescan is empty → then move to roadmap features. Coordination + dedup lives in `docs/orchestration/site-work/register.json` (schema `eos.site-work.register/1`): `entries` (worked items, status QUEUED/IN_PROGRESS/FIXED, each with a stable `discriminator`) and `backlog` (23 identified-but-not-yet-worked items). Future scouts MUST exclude everything in the register.

## Done already (round 1 — do NOT redo)
10 items fixed + merged: PRs #874–#881. Register entries all `status:"FIXED"` with their `pr`.

## YOUR immediate work — 4 backend packets (functions/ ONLY)
Full briefs in the companion file **`codex-packets-round2.md`**. Summary:
- **C1** — `createOpportunity`/`createSalesOrder` idempotency guard. Files: `functions/src/opportunity/opportunityCallables.ts`, `functions/src/salesOrder/salesOrderCallables.ts` (pattern: `coverage/coverageCallables.ts`).
- **C2** — `updateWorkOrderExecutionData` terminal-status guard (reject writes on COMPLETED/CLOSED/CANCELLED). File: `functions/src/updateWorkOrderExecutionData.ts` (server-side only — do NOT touch frontend `ExecutionCapture*`).
- **C3** — Schedule-branch double-booking check. Files: `functions/src/transitionWorkOrder.ts` (Schedule branch), `functions/src/workOrderAvailability.ts` (reuse `findDoubleBookingConflict`).
- **C4** — `warehouseService` negative-stock floor + tests for `warehouseService.ts`/`procurementService.ts`/`supplierService.ts`.

Rules per packet: revalidate on main → smallest fix → focused tests that fail pre-fix / pass after → one PR to main, title `fix(...)/test(...) (site-work r2 C#)` → **do not merge** (Owner or you merge only after CI green). `functions/` tests: many run `npm run build` then `node --test test/<x>.mjs`; sibling command tests use the Firestore emulator — match the nearest sibling.

## In-flight Claude frontend items (#3–#7) — likely UNFINISHED at cutover
Claude dispatched 5 frontend agents that will probably be cut off with **no PR**. Before doing anything with them, check GitHub for open PRs titled `... (site-work r2 #3..#7)`:
- If a PR exists and is green → merge it, mark the register.
- If NO PR exists → the item is unstarted. **Leave #3–#7 for Claude next window** (keeps fleets file-disjoint), UNLESS the Owner asks you to take them. If you do take one, its files are below and must NOT overlap your backend work (they don't — all under `field-ops-app-vite/`):
  - #3 `usecurrenttechnician-no-snapshot-error-handler` → `hooks/useCurrentTechnician.js`, `modules/mobile/FieldMode.jsx`, `modules/technicianDashboard/TechnicianDashboard.jsx`
  - #4 `appheader-discards-reorder-error` → `shared/ui/AppHeader.jsx`, `shared/ui/NotificationPanel.jsx`, `hooks/useReorderRequests.js`
  - #5 `performancesnapshot-raw-error-leak` → `modules/technicianDashboard/PerformanceSnapshot.jsx` (use `domain/workflowActionError.js`)
  - #6 `executioncapture-unbounded-qtyused` → `modules/technicianDashboard/ExecutionCapture.jsx` (mirror `mobile/PartsScanner.jsx` guard; client-only)
  - #7 `cancelreorderrequest-no-status-guard` → `domain/inventoryReorderRequests.js` (mirror sibling writers' status guard)

## Integration duties while Claude is out
You are the integration hub in Claude's absence: review each PR, confirm CI is green, merge to main (squash), and update `docs/orchestration/site-work/register.json` — add each worked item to `entries` with `status:"FIXED"`, `pr:<n>`, and a `worker:"codex"` (or `"claude"`) field. Keep the two fleets file-disjoint.

## After this batch (the loop)
1. Drain the remaining `backlog` (23 items) in priority order — same one-item-one-PR discipline.
2. Then rescan (round 3): read-only scouts over the app, **excluding every register entry + backlog item + near-duplicates**, ranked into a new prioritized list for Owner approval.
3. Repeat until a rescan returns ~nothing → then roadmap features (Owner-gated).

## Notes
- PR #786 (`fix/issue-785...`) may already address the round-1 #4 area (customer-read) — reconcile, don't duplicate.
- Owner is the sole conduit between Claude and Codex; route status through the Owner.
- Claude resumes next 5-hr window and will re-sync from the register + open PRs.

---

## UPDATE — base correction + BACKLOG BLITZ (Claude window transition)

**Base:** always `git fetch origin && git checkout origin/main` and work from the LATEST `origin/main` (it moves as PRs merge). Do NOT trust a pinned commit — a checkout missing this file means you're on a stale main; re-fetch. Read this handoff + `codex-packets-round2.md` from current `origin/main`.

**Round-2 frontend (#3–#7) is DONE/MERGED** (#886–#890) — skip it (see `register.json` → `round2`).

**Your mission while Claude is out — two workstreams (no Claude fleet is running, so file-collision isn't a concern):**
1. **C1–C4 backend packets** — see `codex-packets-round2.md`.
2. **Crush the 23-item backlog** in `register.json` → `backlog[]`. Each entry carries `files`, `problem`, `impact`, `confidence`.
   - **DEDUP FIRST — do NOT redo anything already covered** by `register.json` → `entries` (round-1 FIXED) or `round2`. In particular these backlog items are ALREADY handled: `updateWorkOrderExecutionData` terminal-write (= packet **C2**), `warehouseService` negative-stock (= packet **C4**), any `useAccount` infinite-spinner (= round-1 #4 FIXED). If a backlog item near-duplicates a done/in-progress item, mark it resolved in the register and move on.
   - **Order:** HIGH-confidence first, then MED. One PR per item. Minimal scoped fix + a focused test that fails pre-fix / passes after.
   - **Integrate:** you own merge in Claude's absence — CI green, then squash-merge; update `register.json` (add each crushed item to `entries` with `status:"FIXED"`, `pr`, `worker:"codex"`). Keep PRs file-disjoint so several can land in parallel.
   - Hard limits unchanged: no deploy, no `firestore.rules`, no production, no unrelated refactors.

When Claude resumes it re-syncs from `register.json` + merged/open PRs, picks up anything left, then runs the round-3 rescan (excluding everything in the register).
