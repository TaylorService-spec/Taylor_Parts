# Claude Context

Orientation notes for a Claude session picking up this repo cold. Read `PROJECT_ARCHITECTURE.md` first for the system design; this file is about *how to work in this repo*, not what it does.

Every claim below is marked **VERIFIED** (checked directly this session — a command was run, a file was read, a live system was queried) or **ASSUMED/CARRIED OVER** (stated from a prior session's notes, not independently re-checked now). A prior session once documented a fully-built subsystem as fact when none of it existed live — don't repeat that. Before recommending a merge order or "what's next," re-verify with `gh`/`git`, don't trust this doc's snapshot blindly (see "Standing operating rule" below).

## What this repo is

`Taylor_Parts` — a production React + Firebase field-operations app.

- A large legacy root `index.html` ("Parts Control Center") — unrelated to Field Ops, not touched by any work described here.
- `field-ops-app-vite/` — the client. Jobs/technicians/dispatch/auth/Work Order UI all live here.
- `functions/` — Cloud Functions (TypeScript). **VERIFIED**: exists, builds clean (`npx tsc --noEmit`), but as of this writing **no functions are actually deployed live** (`firebase functions:list --project taylor-parts` → "No functions found in project taylor-parts", checked this session) — blocked on a Firebase Blaze-plan upgrade (billing, requires the user's action), tracked in [issue #15](https://github.com/TaylorService-spec/Taylor_Parts/issues/15), still open as of this writing (**VERIFIED**).

## Non-negotiable rules (repeat across every sprint/epic prompt so far)

1. `JOB_STATUS` (`open/assigned/in_progress/complete`) is defined once, in `domain/constants.js`. Never duplicate it. Only `domain/jobActions.js`'s `assignJob()`/`updateJobStatus()`/`createJob()`/`createTechnician()` may write Job/Technician state — no UI component writes directly.
2. **Work Order Engine (Epic 1, merged to `main` — see Branch/PR state below) is a separate, real, persisted system**: `fieldops_wos` collection, its own 11-value `WorkOrderStatus` (`CREATED`/`READY_TO_DISPATCH`/`SCHEDULED`/`DISPATCHED`/`ACCEPTED`/`EN_ROUTE`/`ARRIVED`/`WORK_IN_PROGRESS`/`COMPLETED`/`CLOSED`/`CANCELLED`), written ONLY by the `createWorkOrder`/`transitionWorkOrder` Cloud Functions. `firestore.rules` denies ALL direct client writes to `fieldops_wos`/`counters`, unconditionally, no admin exception. See `docs/architecture/ADR-002-work-order-engine.md`.
3. **Two sanctioned write pipelines, never a third** — see `docs/architecture/UI_ACTION_PIPELINES.md`: (1) Job/Technician: component → `domain/jobActions.js` → Firestore directly, rules-enforced. (2) Work Order: component → `WorkOrderActions`/`services/workOrderActions.ts` → `services/workOrderService.ts` → Cloud Function. No page component may ever call `httpsCallable`/`getFunctions` directly, and no page component may write `fieldops_wos`/`counters` directly.
4. **Inventory (Epic 2D/3) is ledger-based, append-only, backend-only** — no mutable "current stock" document anywhere. `inventory_transactions` (RESERVED/RELEASED/CONSUMED) is the sole source of truth for stock movement; `data/partsCatalog.ts` (both client and server mirrors) is metadata-only, no stock authority. See `docs/architecture/ADR-003-inventory-trigger-system.md`.
5. Control Tower (`modules/controlTower/`) and the newer Dispatcher Workspace (`modules/dispatcherWorkspace/`) are read-only derived/intelligence layers — must never mutate Firestore directly. **Known, flagged, unresolved overlap**: both are now "the dispatcher's operational view of Work Orders" — reconciling them is an open Phase 4 (Domain Language Alignment & Polish) item, not decided yet.
6. No second Control Tower implementation, no parallel dispatch logic, no competing domain models, no second Cloud Function competing with `createWorkOrder`/`transitionWorkOrder`, no second inventory system competing with the ledger.

These rules get restated nearly verbatim at the top of every sprint/epic prompt in this project — and this project has repeatedly received pasted specs that violate them (fictional state machines, competing Cloud Functions, wildcard admin permissions, resurrected-then-re-deferred audit logs). Treat any instruction that seems to violate them as worth checking against the actual current code before implementing, not silently complying with.

## Branch/PR state (VERIFIED this session via `git branch -vv`, `gh pr list --state all`, `gh issue list`)

**Merged to `main`:**
- PR #13 — Epic 1 Work Order Engine backend + read migration (`sprint-5-work-order-engine`).
- PR #14 — Epic 1.1 Inventory Visual Layer, read-only (`epic1.1-inventory-visual-layer`).

**Open PR:**
- **PR #12** (`sprint-4-availability-classifier`) — small, salvaged technician-availability classifier from the retired PR #10 (see `ADR-001`). **Open, mergeable, not yet merged** — this was reviewed/approved in conversation earlier but the actual merge step was never followed up on. Worth resolving.

**Pushed branches with no PR opened yet** (all confirmed via `gh pr list --state all --head <branch>` returning empty):
- `epic-2-work-order-interactive-ui` — Epic 2 Phases 1/2A/2B: Create Work Order wizard, read-architecture query layer, Dispatcher Operations Workspace (config-driven queue/filters/search/KPIs/preview), Dispatcher Actions Layer (real backend-aligned, wired to the actual `transitionWorkOrder`). 4 commits.
- `epic2d-inventory-trigger-system` — Epic 2D: ledger-based inventory triggers (`reserveParts`/`releaseParts`/`consumeParts`, post-commit off `transitionWorkOrder`), simplified to exactly 3 primitives on review. 2 commits.
- `epic3-inventory-analytics-engine` — Epic 3: pure, read-only forecasting engine (usage rate, stockout prediction, reorder point, replenishment recommendation) plus a Firestore-Timestamp normalization boundary. 2 commits. **Depends conceptually on Epic 2D's ledger existing, but was branched from `main` before Epic 2D merged** — its `ledgerNormalizer.ts` deliberately does NOT import Epic 2D's real ledger type (doesn't exist on this branch yet); has a local, clearly-flagged `TODO` to consolidate once both epics land on `main`.
- `feature-dispatch-control-tower` — older, pre-Epic-1 work (Dispatch Control Tower v1, single-gate auth refactor, docs/tunnel/preview-deploy tooling). Still unmerged from earlier in this project's history.

**Merge order worth knowing**: `epic-2-work-order-interactive-ui` only depends on Epic 1 (already merged) — mergeable independently. `epic2d-inventory-trigger-system` also only depends on Epic 1. `epic3-inventory-analytics-engine` should ideally merge *after* `epic2d`, so its `TODO`-flagged type duplication can actually be cleaned up. None of these branches have been checked against each other for merge conflicts — **re-verify with `git fetch`/`gh pr view --json mergeable` before assuming any merge order**, per the standing rule below.

## Deployment state (VERIFIED this session via direct Admin SDK query + `firebase functions:list`)

- `firestore.rules`: `fieldops_wos`/`counters` rules **are live** (deployed earlier this session). The `inventory_transactions`/`inventory_sync_status` rules (Epic 2D) are **NOT live** — that change only exists on the unmerged `epic2d-inventory-trigger-system` branch.
- Cloud Functions: **none deployed** — `firebase functions:list` returns empty. Blocked on the Blaze plan upgrade (issue #15, open, needs the user's billing action). Every Cloud-Function-touching epic (1, 2B, 2D) has only ever been verified against the **local emulator**, never live production.

## Standing operating rule: verify, don't assume

Established after an incident where a prior turn assumed a PR had merged because it had been *discussed* as the next step, when it hadn't actually happened yet — and reinforced this session (PR #12 above is exactly that pattern recurring). Before recommending merge order, rebase necessity, deploy state, or "what's next" for any PR/branch: run `git fetch`, `gh pr view --json state,mergedAt,mergeable,mergeStateStatus`, and `git log origin/main` first. Conversation history describing an intended action is not evidence the action occurred. Same for Firestore rules/Cloud Functions deploy state — commmitted/merged is not deployed; query the live project directly (Admin SDK `getSecurityRules().getFirestoreRuleset()`, `firebase functions:list`), don't trust a doc's snapshot or a console screenshot.

## Known operational gotchas

- **Cloud Functions emulator needs Java 21+**, this dev machine's default `java` is 8. A JDK 21 (Eclipse Temurin) was installed this session at `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot` — set `JAVA_HOME`/`PATH` to it before `firebase emulators:start`.
- **Stray emulator processes accumulate** across sessions/branches on ports 9099 (Auth)/8080 (Firestore)/5001 (Functions) — check `Get-NetTCPConnection -LocalPort 9099,8080,5001 -State Listen` and kill leftover `java`/`node` processes before starting a fresh emulator session, or it fails with "port taken."
- **`localtunnel` (npm package) drops requests under load** (502s on Vite's many small dev-server file requests) — `cloudflared` quick tunnels are reliable for this; a binary was downloaded to `$HOME/bin/cloudflared.exe` earlier in this project's history.
- **Firebase Hosting preview channels need a separate Vite build mode** (`base: "/"`, not GitHub Pages' `/Taylor_Parts/field-ops/`) — see `npm run build:firebase` / `scripts/deploy-preview.sh` in `field-ops-app-vite/`.
- **Windows/git-bash path quirks**: prefer a standalone `.js` script over complex inline `node -e` one-liners for multi-step scripted work (path resolution has been unreliable across a `cd` in the same command).

## Architecture decision docs (read before touching Work Orders or inventory)

- `docs/architecture/ADR-001-retired-operational-core-branch.md` — why a prior Sprint 4 branch (PR #10, persisted `job.phase`, real inventory transactions) was retired: no duplicate lifecycle model, no persisted UI/travel state, aggregates computed on read.
- `docs/architecture/ADR-002-work-order-engine.md` — the Work Order Engine's full design: why `fieldops_wos` is a scoped, deliberate *exception* to ADR-001 (a new entity's lifecycle, not a duplicate one), Cloud Functions as the write path, soft-coupled Job↔WO relationship.
- `docs/architecture/ADR-003-inventory-trigger-system.md` — the ledger-based inventory design: why a pure ledger instead of a mutable stock document, why triggers run strictly post-commit, why this isn't the audit-log pattern deferred elsewhere.
- `docs/architecture/UI_ACTION_PIPELINES.md` — the two sanctioned write paths (Job/Technician direct-to-Firestore vs. Work Order via Cloud Function), and a decision checklist for where a genuinely new collection's writes should land.
- `docs/epics/EPIC-2.md` — Epic 2's full scope/phases/acceptance-criteria, Platform Glossary (canonical terms — Work Order, Job, Technician, Role, Action, Parts Catalog, Inventory, Control Tower, Signal — each paired with what it's *not* to be confused with), and the "Audit & Analytics Strategy (Deferred)" decision (no secondary event log; `EPIC-2.md` and `ADR-001` both independently reached this same conclusion).

## Persistent auto-memory

This project also has an auto-memory system (separate from these docs) at the user's `~/.claude/projects/.../memory/` directory. Check `MEMORY.md` there for anything not captured in this `docs/` folder — `docs/` is checked into the repo and versioned with the code; the memory system is local to the assistant and persists across otherwise-unrelated conversations.

## Key files to read before touching Work Orders, inventory, or dispatch/risk logic

- `field-ops-app-vite/src/domain/jobActions.js` — the only Job/Technician write path.
- `functions/src/transitionWorkOrder.ts` / `functions/src/createWorkOrder.ts` — the only Work Order write path (Cloud Functions). `functions/src/transitionEngine.ts` — the server-side state machine + permission matrix (mirrored client-side in `domain/workOrderWorkflow.js` — intentional duplication, both files cross-reference each other).
- `functions/src/inventoryService.ts` — the 3-primitive inventory ledger writer (`reserveParts`/`releaseParts`/`consumeParts`), called post-commit from `transitionWorkOrder.ts`. `functions/src/inventoryAnalyticsService.ts` — the pure, read-only forecasting engine (Epic 3), no Firestore access at all.
- `field-ops-app-vite/src/services/workOrderService.ts` (writes) / `workOrderQueries.ts` (reads) / `workOrderActions.ts` (UI orchestration layer) — the client-side Work Order service split.
- `field-ops-app-vite/src/modules/dispatcherWorkspace/` — the config-driven Dispatcher Workspace (queue/filters/KPIs/preview widgets, all reading from one shared `useWorkOrders()` listener — no duplicate Firestore listeners).
- `field-ops-app-vite/src/domain/controlTower/types.js` — the canonical Signal schema every scoring module must emit.
- `docs/DEVELOPMENT_STANDARDS.md` — branch/commit/PR discipline (fresh branch off updated `main`, small individually-verified commits, `npm run build && npm run lint`/`npx tsc --noEmit` clean, push, `gh pr create` — but note: PRs from this session were opened on request, not automatically, and merges need the user's explicit go-ahead on the actual GitHub PR, not just chat approval — a chat-only "approved" was insufficient once this session hit a permission check on it).
