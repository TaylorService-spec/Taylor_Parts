# Claude Context

Orientation notes for a Claude session picking up this repo cold. Read `PROJECT_ARCHITECTURE.md` first for the system design; this file is about *how to work in this repo*, not what it does.

Every claim below is marked **VERIFIED** (checked directly this session — a command was run, a file was read, a live system was queried) or **ASSUMED/CARRIED OVER** (stated from a prior session's notes, not independently re-checked now). A prior session once documented a fully-built subsystem as fact when none of it existed live, AND separately fabricated citations to architecture docs (`ADR-001`, `EPIC-2.md`, `UI_ACTION_PIPELINES.md`) that were never actually written — don't repeat either failure. Before recommending a merge order, "what's next," or citing a doc by path, re-verify with `gh`/`git`/`Glob`, don't trust this doc's snapshot blindly (see "Standing operating rule" below).

## What this repo is

`Taylor_Parts` — a production React + Firebase field-operations app.

- A large legacy root `index.html` ("Parts Control Center") — unrelated to Field Ops, not touched by any work described here.
- `field-ops-app-vite/` — the client. Jobs/technicians/dispatch/auth/Work Order UI all live here.
- `functions/` — Cloud Functions (TypeScript). **VERIFIED**: exists, builds clean (`npx tsc --noEmit`), but as of this writing **no functions are actually deployed live** (`firebase functions:list --project taylor-parts` → "No functions found in project taylor-parts") — blocked on a Firebase Blaze-plan upgrade (billing, requires the user's action), tracked in [issue #15](https://github.com/TaylorService-spec/Taylor_Parts/issues/15), open as of this writing.

## Non-negotiable rules (repeat across every sprint/epic prompt so far)

1. `JOB_STATUS` (`open/assigned/in_progress/complete`) is defined once, in `domain/constants.js`. Never duplicate it. Only `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`/`createJob()`/`createTechnician()` may write Job/Technician state — no UI component writes directly.
2. **Work Order Engine (Epic 1, merged to `main`) is a separate, real, persisted system**: `fieldops_wos` collection, its own 11-value `WorkOrderStatus` (`CREATED`/`READY_TO_DISPATCH`/`SCHEDULED`/`DISPATCHED`/`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`/`COMPLETED`/`CLOSED`/`CANCELLED`), written ONLY by the `createWorkOrder`/`transitionWorkOrder` Cloud Functions. `firestore.rules` denies ALL direct client writes to `fieldops_wos`/`counters`, unconditionally, no admin exception. See `docs/architecture/ADR-002-work-order-engine.md`.
3. **Two sanctioned write pipelines, never a third**: (1) Job/Technician: component → `domain/jobActions.js` → Firestore directly, rules-enforced. (2) Work Order: component → `WorkOrderActions`/`services/workOrderActions.ts` → `services/workOrderService.ts` → Cloud Function. No page component may ever call `httpsCallable`/`getFunctions` directly, and no page component may write `fieldops_wos`/`counters` directly. (A doc describing a decision checklist for where a new collection's writes should land, `UI_ACTION_PIPELINES.md`, was cited by a prior session but does not exist in this repo — don't cite it again; this rule is carried over from that session's stated intent, not a file.)
4. **Inventory (Epic 2D/3, merged to `main`) is ledger-based, append-only, backend-only** — no mutable "current stock" document anywhere. `inventory_transactions` (RESERVED/RELEASED/CONSUMED) is the sole source of truth for stock movement; `data/partsCatalog.ts` (both client and server mirrors) is metadata-only, no stock authority. See `docs/architecture/ADR-003-inventory-trigger-system.md`.
5. Control Tower (`modules/controlTower/`) and the newer Dispatcher Workspace (`modules/dispatcherWorkspace/`) are read-only derived/intelligence layers — must never mutate Firestore directly. **Known, flagged, unresolved overlap**: both are now "the dispatcher's operational view of Work Orders" — reconciling them is an open, undecided item.
6. No second Control Tower implementation, no parallel dispatch logic, no competing domain models, no second Cloud Function competing with `createWorkOrder`/`transitionWorkOrder`, no second inventory system competing with the ledger.
7. **Epic 4 (Warehouse + Fulfillment) adds a physical-reality layer, not a new source of truth**: it must never mutate `inventory_transactions` or `fieldops_wos`, must never introduce an event/pub-sub system, and reconciliation is strictly read-only reporting (no auto-correction). See "Epic 4" section below.

These rules get restated nearly verbatim at the top of every sprint/epic prompt in this project — and this project has repeatedly received pasted specs that violate them (fictional state machines, competing Cloud Functions, wildcard admin permissions, resurrected-then-re-deferred audit logs). Treat any instruction that seems to violate them as worth checking against the actual current code before implementing, not silently complying with. This includes checking that any doc path a spec or prior session cites actually exists (`Glob`/`Grep`) before trusting a claim built on it — this repo's own context doc has been wrong about that before (see intro paragraph).

## Branch/PR state (VERIFIED this session via `git branch -vv`, `gh pr list --state all`)

**Merged to `main`:**
- PR #13 — Epic 1 Work Order Engine backend + read migration (`sprint-5-work-order-engine`).
- PR #14 — Epic 1.1 Inventory Visual Layer, read-only (`epic1.1-inventory-visual-layer`).
- PR #16 — Epic 2D Inventory Trigger System (`epic2d-inventory-trigger-system`). Branch deleted post-merge.
- PR #17 — Epic 3 Inventory Analytics Engine (`epic3-inventory-analytics-engine`). Rebased onto `main` after #16 landed, so its ledger-normalizer stub type was consolidated into a real import of Epic 2D's `InventoryTransaction` before merge — no lingering type duplication. Branch deleted post-merge.

**Open PR:**
- **PR #12** (`sprint-4-availability-classifier`) — small, salvaged technician-availability classifier from a retired earlier branch (PR #10). **Open, mergeable, not yet merged** — reviewed/approved in conversation before but the merge step was never followed up on. Still worth resolving; unrelated to the inventory/warehouse line of work.

**Pushed branches with no PR opened yet:**
- `epic-2-work-order-interactive-ui` — Epic 2 Phases 1/2A/2B: Create Work Order wizard, read-architecture query layer, Dispatcher Operations Workspace (config-driven queue/filters/search/KPIs/preview), Dispatcher Actions Layer (real backend-aligned, wired to the actual `transitionWorkOrder`). 4 commits. Only depends on Epic 1 (merged) — mergeable independently, not yet re-verified against current `main`.
- `feature-dispatch-control-tower` — older, pre-Epic-1 work (Dispatch Control Tower v1, single-gate auth refactor, docs/tunnel/preview-deploy tooling). Still unmerged from earlier in this project's history.

**Merged since, tagged as a stabilization point:**
- PR #18 (docs fix) and PR #19 (Epic 4 Warehouse + Fulfillment System) both merged to `main`. The commit is tagged `fieldops-core-platform-v1` -- future epics (procurement, optimization) are meant to depend on this baseline.

**Current work**: `epic5-procurement-supplier-management` — new branch off `main` (post `fieldops-core-platform-v1`), building the Procurement + Supplier Management System (`Supplier`/`SupplierCatalogItem`/`PurchaseOrder` entities, `procurementService.ts`, `supplierService.ts`, `procurementBridge.ts`). Fully internal/manual-approval-only per spec -- no external vendor HTTP calls, no webhooks, no auto-placed orders. Consumes Epic 3 recommendations read-only to generate DRAFT proposals only; a human-triggered action (not built this epic, same as Epic 4 leaving client wiring for later) turns an approved proposal into a real `createPurchaseOrder` call.

## Deployment state

- `firestore.rules`: `fieldops_wos`/`counters` rules **are live** (deployed in an earlier session). The `inventory_transactions`/`inventory_sync_status` rules (Epic 2D) were added to `firestore.rules` on merge of #16 but **live deploy status has not been re-checked this session** — verify with the Admin SDK (`getSecurityRules().getFirestoreRuleset()`) before assuming.
- Cloud Functions: **none deployed** as of the last live check — `firebase functions:list` returned empty. Blocked on the Blaze plan upgrade (issue #15, open, needs the user's billing action). Every Cloud-Function-touching epic (1, 2B, 2D) has only ever been verified against the **local emulator**, never live production.

## Standing operating rule: verify, don't assume

Established after an incident where a prior turn assumed a PR had merged because it had been *discussed* as the next step, when it hadn't actually happened yet (PR #12 is exactly that pattern, still unresolved) — and reinforced again when a prior session's context doc cited four architecture docs by path (`ADR-001`, `UI_ACTION_PIPELINES.md`, `EPIC-2.md`, and originally `ADR-003` before it was actually written) that didn't exist in the repo. Before recommending merge order, rebase necessity, deploy state, "what's next," or citing any doc by path: run `git fetch`, `gh pr view --json state,mergedAt,mergeable,mergeStateStatus`, `git log origin/main`, and `Glob`/`Grep` for the doc path first. Conversation history or a prior session's notes describing something as existing is not evidence it does. Same for Firestore rules/Cloud Functions deploy state — committed/merged is not deployed; query the live project directly, don't trust a doc's snapshot or a console screenshot.

Also verified this session: a chained shell command (`git add && git commit && git push origin main`) that gets denied by a permission check is denied as a whole — none of it runs, including the `add`/`commit` portion, even though only the final `push` was the actual concern. Don't assume a leading step in a blocked chained command executed; check `git log`/`git status` after any denial before building on top of it.

## Known operational gotchas

- **Cloud Functions emulator needs Java 21+**, this dev machine's default `java` is 8. A JDK 21 (Eclipse Temurin) was installed at `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot` — set `JAVA_HOME`/`PATH` to it before `firebase emulators:start`.
- **Stray emulator processes accumulate** across sessions/branches on ports 9099 (Auth)/8080 (Firestore)/5001 (Functions) — check `Get-NetTCPConnection -LocalPort 9099,8080,5001 -State Listen` and kill leftover `java`/`node` processes before starting a fresh emulator session, or it fails with "port taken."
- **`localtunnel` (npm package) drops requests under load** (502s on Vite's many small dev-server file requests) — `cloudflared` quick tunnels are reliable for this; a binary was downloaded to `$HOME/bin/cloudflared.exe` earlier in this project's history.
- **Firebase Hosting preview channels need a separate Vite build mode** (`base: "/"`, not GitHub Pages' `/Taylor_Parts/field-ops/`) — see `npm run build:firebase` / `scripts/deploy-preview.sh` in `field-ops-app-vite/`.
- **Windows/git-bash path quirks**: prefer a standalone `.js` script over complex inline `node -e` one-liners for multi-step scripted work (path resolution has been unreliable across a `cd` in the same command). `git stash -u` can also fail partway through (permission-denied removing an untracked directory) while still leaving the working tree in the *pre-stash* state despite reporting success — verify with `git diff HEAD` after stashing, don't assume the stash succeeded just because it printed "Saved working directory."

## Architecture decision docs that actually exist (verify with `Glob` before citing any others)

- `docs/architecture/ADR-002-work-order-engine.md` — the Work Order Engine's full design: why `fieldops_wos` is a scoped, deliberate exception to prior no-duplicate-lifecycle practice, Cloud Functions as the write path, soft-coupled Job↔WO relationship.
- `docs/architecture/ADR-003-inventory-trigger-system.md` — the ledger-based inventory design: why a pure ledger instead of a mutable stock document, why triggers run strictly post-commit.

No `ADR-001`, no `docs/epics/EPIC-2.md`, no `docs/architecture/UI_ACTION_PIPELINES.md` exist in this repo — a prior session cited all three as if they did. If a future prompt or spec references them, treat that as unverified until checked.

## Persistent auto-memory

This project also has an auto-memory system (separate from these docs) at the user's `~/.claude/projects/.../memory/` directory. Check `MEMORY.md` there for anything not captured in this `docs/` folder — `docs/` is checked into the repo and versioned with the code; the memory system is local to the assistant and persists across otherwise-unrelated conversations.

## Key files to read before touching Work Orders, inventory, or dispatch/risk logic

- `field-ops-app-vite/src/domain/jobActions.js` — the only Job/Technician write path.
- `functions/src/transitionWorkOrder.ts` / `functions/src/createWorkOrder.ts` — the only Work Order write path (Cloud Functions). `functions/src/transitionEngine.ts` — the server-side state machine + permission matrix (mirrored client-side in `domain/workOrderWorkflow.js` — intentional duplication, both files cross-reference each other).
- `functions/src/inventoryService.ts` — the 3-primitive inventory ledger writer (`reserveParts`/`releaseParts`/`consumeParts`), called post-commit from `transitionWorkOrder.ts`. `functions/src/types/inventoryTransaction.ts` — the real `InventoryTransaction`/`InventorySyncStatus` types (Admin-SDK-only, `firestore.rules` denies all client access). `functions/src/inventoryAnalyticsService.ts` — the pure, read-only forecasting engine (Epic 3), no Firestore access at all. `functions/src/ledgerNormalizer.ts` — the single Firestore-`Timestamp`-to-epoch-ms conversion boundary between the real ledger type and the analytics engine's plain-number `LedgerTransaction`.
- `field-ops-app-vite/src/services/workOrderService.ts` (writes) / `workOrderQueries.ts` (reads) / `workOrderActions.ts` (UI orchestration layer) — the client-side Work Order service split.
- `field-ops-app-vite/src/modules/dispatcherWorkspace/` — the config-driven Dispatcher Workspace (queue/filters/KPIs/preview widgets, all reading from one shared `useWorkOrders()` listener — no duplicate Firestore listeners).
- `field-ops-app-vite/src/domain/controlTower/types.js` — the canonical Signal schema every scoring module must emit.
- `docs/DEVELOPMENT_STANDARDS.md` — branch/commit/PR discipline (fresh branch off updated `main`, small individually-verified commits, `npm run build && npm run lint`/`npx tsc --noEmit` clean, push, `gh pr create` — but note: PRs are opened on request, not automatically, and merges need the user's explicit go-ahead, including on any destructive step like a force-push after a rebase).

## Epic 4 — Warehouse + Fulfillment (in progress)

Physical-reality layer on top of the ledger, per the user's spec: `Warehouse`, `StockLocation` (bin-level), `TransferOrder`, `WarehouseDiscrepancy` entities; `warehouseService.ts` (state ops), `warehouseReconciliationService.ts` (read-only comparison against ledger-derived consumption, no auto-correction), `warehouseAnalyticsBridge.ts` (consumes Epic 3 output, read-only, suggestions only). Must never write `inventory_transactions` or `fieldops_wos`, no event/pub-sub system, no direct Work-Order coupling. Consistency model: eventually consistent with the ledger, not real-time authoritative.
