# Sprint Status

Snapshot as of 2026-07-11. This file is a point-in-time record, not a live dashboard — re-verify against `git log`/`gh pr list` before relying on it, especially PR merge state and Firestore Rules/Cloud Functions **deploy** state (merged ≠ deployed, checked separately every time in this repo). See `docs/CLAUDE_CONTEXT.md` for the full narrative (why decisions were made, what was learned); this file is the compact status table.

## Completed / merged (Release 1.0 + early Release 2.0)

| Sprint/Epic | PR(s) | Summary |
|---|---|---|
| Vite migration | #1, #2 | Migrated the field ops app to Vite + React; initial Control Tower dashboard. |
| Sprint 2 (integration) | #3 | Work Order → Jobs hierarchy, readiness scoring, technician workload view. |
| Sprint 3.1–3.4 | #4, #5, #6 | Transactional job completion, dispatch intelligence layer, canonical Signal schema. |
| Epic 1–8 (Work Order Engine through Operations Intelligence) | #13–#37 | Work Order Engine (Cloud Functions), Inventory ledger (Epic 2D/3), Warehouse/Procurement (Epic 4/5), Dispatcher Board + TRE-v1, Technician Execution Workspace, Execution Analytics, Operations Intelligence Unification. |
| Sprint 0 (Product Governance) | #40 | `ProductVision.md`/`PlatformConstitution.md`/`ProductBlueprint.md`/`GuidingPrinciples.md`/`MobileStrategy.md`. |
| Sprint 2.0.1 (Navigation Foundation) | #41, #42 | Real `react-router-dom` routing, business-domain nav tree. |
| Sprint 2.0.2 (Customer Foundation) | #44, #45 | `accounts`/`locations`/`contacts` collections + rules, Global Search (Accounts), Customer/Location/Contact UI. |
| Sprint 2.0.3 (Work Order Experience) | #46, #47 | Real Work Orders workspace, creation wizard, detail route. Real Work Order creation still blocked on Cloud Functions deployment (Blaze plan, issue #15, deliberate standing decision). |
| Governance docs (`PlatformCapabilityModel.md` → `DeploymentModeStrategy.md` → `PlatformOperatingModel.md` → `IntegrationArchitecture.md`) | #48, #51, #52, #53, #54 | Release 2.0 Governance Foundation, complete and closed. |
| Sprint 2.1.1 (Inventory Domain Foundation) | #58 | Real Inventory > Parts workspace. |
| Epic 9 (Platform Workspace Framework) | #63 | `WorkspaceHeader`/`FilterBar`/`LoadingEmptyState`, extracted from 3 existing screens, zero workflow/routing change. |

## Completed / merged (Release 2.1 — Inventory → Procurement workflow chain)

The platform's longest continuous object lifecycle: the workflow was extended across ten implementation sprints (2.1.2–2.1.11), but one Reorder Request itself moves through seven workflow `status` values (`PENDING_REVIEW` → `READY_FOR_PARTS_MANAGER` → `ASSIGNED_TO_PARTS_ASSOCIATE` → `PURCHASING_IN_PROGRESS` → `ORDERED` → `RECEIVED`, or the alternate terminal branch `PENDING_REVIEW` → `REJECTED`). `APPROVED` is retained in `reviewDecision` as a historical record of the review outcome, not a continuing `status` value — after Sprint 2.1.5, approval advances `status` to `READY_FOR_PARTS_MANAGER`. Sprint 2.1.9 (Inventory Actions Foundation) is a separate audit foundation, not another Reorder Request status transition. See `docs/CLAUDE_CONTEXT.md`'s "Sprints 2.1.2–2.1.10" section for the full narrative and lessons learned; `docs/BusinessEntityModel.md` Sections 4/4a/4b for the authoritative schema.

| Sprint | PR | Status | Summary |
|---|---|---|---|
| Sprint 2.1.2 (Inventory Operational Queue) | #65 | Merged | "Needs Reorder" urgency-ranked queue on `PartsList.jsx`. |
| Sprint 2.1.3 (Reorder Request & Notification Foundation) | #67 | Merged | `reorder_requests` collection, `createReorderRequest()`, Notification Panel v0.1. |
| Sprint 2.1.4 (Reorder Review & Decision) | #69 | Merged | `reviewReorderRequest()`, `PENDING_REVIEW` → `APPROVED`/`REJECTED`. Rules hardened after first review requested changes. |
| Sprint 2.1.5 (Inventory → Parts Manager Handoff) | #70 | Merged | `currentOwner` (role-level), approval advances to `READY_FOR_PARTS_MANAGER`. |
| Sprint 2.1.6 (Parts Manager → Parts Associate Assignment) | #71 | Merged | `assignedToUserId`/`assignedBy`/`assignedAt` — first per-user ownership field. |
| Sprint 2.1.7 (Purchase Execution Foundation) | #72 | Merged | `startPurchasing()` — first update restricted to one individual, enforced in rules. |
| Sprint 2.1.8 (Purchasing Progress Update) | #75 | Merged | `updatePurchasingProgress()` — first non-transition (repeatable) write. |
| Sprint 2.1.9 (Inventory Actions Foundation) | #76 | Merged | New `inventory_actions` collection, logged-only. First REQUEST CHANGES verdict — UI initially implied stock changed when it didn't. |
| Sprint 2.1.10 (Purchase Order Foundation) | #77 | Merged | `recordPurchaseOrder()`, `PURCHASING_IN_PROGRESS` → `ORDERED`, atomic via client transaction + `getAfter()`/`existsAfter()` rules invariant. Second REQUEST CHANGES verdict — rules initially validated each write independently. |
| Sprint 2.1.11 (Receiving — Reorder Request closeout) | #98 | Open | `receiveReorderRequest()`, terminal `ORDERED` → `RECEIVED`, assignee-only. Status-closeout note only — does not touch `inventory_transactions`; reconciling against real stock stays Blaze-blocked backlog (see `docs/BusinessEntityModel.md` Section 4a). Scoped under `docs/DelegationCharter.md` Tier 1 (`docs/DECISIONS.md` entry #3, issue #96); the `firestore.rules` change itself was Tier 2, escalated and approved (issue #97, `docs/DECISIONS.md` entry #4). |

**Two production bug-fix PRs against this chain, both merged:**

| PR | Summary |
|---|---|
| #73 | `handleRequestReorder()` had no error handling — any failure was silent. Added try/catch, visible error, double-click guard. |
| #74 | Notification Panel/queues only updated after a browser refresh — `useReorderRequests.js` used one-shot reads with no cross-component invalidation. Converted to `onSnapshot()` realtime subscriptions, reusing the platform's existing pattern. User live-tested and confirmed working. |

**Critical incident, resolved**: the live `taylor-parts` project's deployed `firestore.rules` had no `reorder_requests` match block at all for the entire span of Sprints 2.1.3–2.1.7 — every rules change in that span was merged but never actually deployed. Every reorder-request-touching feature silently failed in production the whole time. Found while investigating the PR #73 bug report, fixed via an explicit `firebase deploy --only firestore:rules` (user-authorized), verified live. Rules are deployed and current as of PR #77's merge (2026-07-10). See `docs/CLAUDE_CONTEXT.md`'s "Known operational gotchas" for the full incident and the standing lesson (merged ≠ deployed for `firestore.rules`, always confirm after merge).

## Completed / merged (Governance + AI-SDLC + Employee Foundation Phase 3)

| Item | PR | Status | Summary |
|---|---|---|---|
| Docs completion sync | #78 | Merged | Sprints 2.1.2–2.1.10 narrative, corrected across 3 ChatGPT review rounds. |
| Employee Identity / Platform Assignment governance | #79 | Merged | `PROJECT_ARCHITECTURE.md` Person Assignment Platform Service Standard, `BusinessEntityModel.md` Section 8a, `GuidingPrinciples.md` principle, `CLAUDE_CONTEXT.md` rule 14. |
| AI-SDLC operating manual | #80 | Merged | `docs/ai/` — the standing ChatGPT/Claude Code/Codex process this project now runs on. See `CLAUDE_CONTEXT.md`'s dedicated section. |
| Employee Foundation PR 1 (Employee Data and Read Foundation) | #82 | Merged | `employees/{employeeId}` Rules (dual read path), `domain/employees.js`, `useAssignableEmployees()`, first Firestore Rules test in this repo. |
| Employee Foundation PR 2 (Trusted Employee/User Provisioning) | #83 | Merged | `provisionEmployeeAccess.js` — atomic link transaction, passwordless, project-target gated. Replaced `createPartsManagerTestUsers.js`. |
| Employee Foundation PR 3 (Current Employee Session Resolution) | #84 | Merged | `AuthContext` exposes `employeeId`/`displayName`/`operationalRoles`; one-shot read mechanism preserved, not converted to `onSnapshot()`. |
| Employee Foundation PR 4 (EmployeeAssignmentPicker Foundation) | #85 | Merged | `shared/assignment/EmployeeAssignmentPicker.jsx`, zero production consumers. Two review rounds (focus/keyboard/ARIA; ArrowUp/ArrowDown landing fix). |
| Docs session-context refresh | #86 | Merged | `CLAUDE_CONTEXT.md`/`SPRINT_STATUS.md` refresh through PR #85. |
| `functions/tsconfig.json` modernization | #87 | Merged | `moduleResolution: "node"` (deprecated) → `NodeNext`. Resolves standing backlog item 6 below. |
| Inventory "Insufficient usage history" display fix | #88 | Merged | Presentational-only fix for the misleading `0` reorder-quantity display — precursor to the Zero-history reorder behavior sprint below. |

## Completed / merged (Zero-history reorder behavior sprint — PRs #90–#92, governance chain on PR #89)

Root cause: the sole writer of `CONSUMED` ledger transactions (`transitionWorkOrder` Cloud Function) has never been deployed, so `avgDailyUsage` is `0` for every part in production, unconditionally — every reorder recommendation showed a misleading `0`/`LOW`. **Kept deliberately separate from Employee Foundation and from the broader Part and Inventory Administration initiative** (Owner instruction). Full narrative, including two real Specification-stage REQUEST CHANGES rounds and a Codex `[P1]` finding, in `docs/CLAUDE_CONTEXT.md`'s dedicated section — this table is status only.

| PR | Status | Summary |
|---|---|---|
| #89 (Assessment/Specification/Implementation Plan) | **Open** | Docs-only governance chain. Has the live PR-by-PR tracking table and Deployment status section — check there first. |
| #90 (PR 1 — `recommendationStatus`/nullable `urgency`) | Merged (`a668718`) | `RiskLevel`/`URGENCY_ORDER` unchanged; `recommendationStatus` is a separate field. |
| #91 (PR 2 — transitional Firestore Rules) | Merged (`41392de`), **deployed and verified live 2026-07-11** | Dual-shape `create` rule; Codex `[P1]` fix (complete-schema validation) applied to both branches. 28/28 Rules-test assertions. |
| #92 (PR 3 — write path + UI) | Merged (`79a64c1`), **confirmed live 2026-07-11** | `requestReorderForRecommendation()`, `getDisplayQty()` legacy fallback, `RequestReorderControl.jsx`. Frontend-only (no `firestore.rules` change) — auto-deployed via GitHub Actions at merge, per `docs/Deployment.md`; verified via the deploy workflow's success run at the merge commit and by inspecting the live bundle directly. No manual deploy step existed or was needed. |
| PR 4 (Rules tightening) | Implemented, in review | Precondition verified (Rudy's Console spot-check: zero legacy-shape writes since PR #92's live cutoff). Removes PR 2's transitional legacy branch — legacy-shape create now rejected unconditionally. 32/32 Rules-emulator assertions passing (3 inverted from PR 2's original expectation). Awaiting Rules-focused review + Owner Merge Authorization + separate Owner Deployment Authorization. |

**Merged since the table above was last complete:** #89 (this sprint's governance docs chain), #98 (Sprint 2.1.11, Receiving — Reorder Request closeout; frontend live, `firestore.rules` change deployed under separate Owner Deployment Authorization, see `docs/DECISIONS.md` entry #7).

**Open now** (verify with `gh pr list --state open` before trusting this): PR 4 above ([#103](https://github.com/TaylorService-spec/Taylor_Parts/pull/103)).

PR #81 (Employee Foundation governance docs) and PR #93 (`run-field-ops-app-vite` skill) have both since merged — see `docs/DECISIONS.md` for the full history.

## In progress / not yet started

The Employee Foundation implementation plan is fully merged (4/4). **Not started, and explicitly not to begin until Phase 3 fully lands**: the Parts and Purchase Order Assignment Adoption sprint (replacing Sprint 2.1.6's manual-UID Reorder Request assignment with `EmployeeAssignmentPicker`). A specification for that sprint was produced once, early in this initiative, but only as chat output — **it was never committed to the repository** and predates the `docs/specifications/` convention. Treat it as needing to be reassessed and (re-)written fresh through the standing `docs/ai/workflow.md` gates, not as an existing artifact to look up. **Deliberately kept separate from the Zero-history reorder behavior sprint above** — do not fold the two together.

## Standing backlog items (none yet scoped as their own sprint)

1. ~~Replace manual-uid Reorder Request assignment (Sprint 2.1.6) with a controlled, role-filtered user picker~~ — **the underlying model now exists** (Employee Foundation, PRs #82–#85, all merged). The actual Reorder Request adoption itself is the not-yet-started item described above, not this one.
2. Notification Panel is at 4 sections (Pending Review / Ready for Parts Manager / Assigned to You / Purchasing Started) — evaluate a "My Work" view before adding a 5th.
3. If full purchasing communication history is ever needed (not just latest-state), consider a child progress-log collection under Reorder Request.
4. Apply `inventory_actions` to `inventory_transactions` via a Cloud-Function-mediated trusted write path once Firebase Blaze is enabled — genuinely blocked on that decision, not on engineering effort.
5. When full Procurement enters active planning, explicitly assess whether `reorder_purchase_orders` should migrate into or be consolidated with the existing full `purchase_orders` model (Epic 5).
6. ~~Modernize `functions/tsconfig.json`'s deprecated `moduleResolution: "node"`~~ — **RESOLVED, PR #87, merged.**
7. Governed fallback demand model / minimum-stock policy for zero-usage-history parts (tier 2 of the Zero-history reorder behavior sprint's hybrid model) — explicitly out of scope for that sprint's PRs 1-4; not yet scoped as its own sprint.
8. Once PR #92 deploys, evaluate whether an Employee needs `operationalRoles` containing `PARTS_MANAGER`/`WAREHOUSE_MANAGER` assigned for real (via `provisionEmployeeAccess.js`) before the manual-quantity-entry path has any real, non-`admin` user who can exercise it — currently zero real Employees have this populated.

Don't build any of these speculatively — wait for the triggering condition to actually arise.

## Discipline notes for whoever picks this up

- Always re-verify PR/branch state before recommending next steps — see `DEVELOPMENT_STANDARDS.md`'s PR discipline section, and `CLAUDE_CONTEXT.md`'s "Standing operating rule: verify, don't assume."
- After merging any `firestore.rules` change, confirm it's actually been deployed (`firebase deploy --only firestore:rules --project taylor-parts`) — don't assume merged means live. This is not hypothetical; see the incident above.
- If a PR's `pull_request`-triggered CI check gets stuck `queued` with no runner assigned for several minutes, try closing and reopening the PR before assuming the code broke something.
- A feature named after an operational verb (Receive/Adjust/Correct/etc.) implies the operation actually happened unless the UI says otherwise explicitly — check for this before a "record an action" feature reaches review (see Sprint 2.1.9).
- When a domain function performs more than one document write for a single user action, reach for Firestore's `getAfter()`/`existsAfter()` in the rules by default, not just prior-state pinning on each write independently (see Sprint 2.1.10) — the same principle reappeared in PR #83's Firestore-side `runTransaction()` for the Employee↔User link.
- **A doc referenced by a PR is not necessarily on `main`.** This was true of `docs/assessments/`, `docs/specifications/`, `docs/implementation-plans/`, and `docs/reviews/` for the entire span PR #81 sat open (all four merged to `main` only on 2026-07-11, well after the implementation PRs they govern) — the general lesson stands even though that specific instance is now resolved. Still verify with `git ls-tree main --name-only` or `gh pr view` before assuming any doc referenced by an open PR is actually committed.
- **This project now runs on `docs/ai/workflow.md`'s gate sequence** (Business Objective → ChatGPT Architecture Review → Claude Code Assessment/Specification → ChatGPT Approval → Implementation → ChatGPT Final Review → Owner Merge Authorization) — Architecture Approval and Owner Merge Authorization are two separate gates; an "APPROVED" is not itself merge permission.
- Never generate, print, log, return, store, or commit a credential/password/reset-link — even a "one-time terminal disclosure" is not acceptable (see PR #83's second review round). `provisionEmployeeAccess.js` is the reference pattern: a newly created Firebase Auth account is created genuinely passwordless.
- **Deploy authorization is always separate from merge authorization, even within the same conversation turn.** Never run `firebase deploy` (rules or otherwise) off a merge approval alone — ask again, explicitly, even if the owner just said "yes, merge."
- **Results, validation summaries, and any question needing an answer go inside one copy-paste code block** — not split across prose before/after it, and that includes trailing status reminders, not just the primary result. See `CLAUDE_CONTEXT.md`'s "Working format this project has standardized on."
- **A browser-driving agent skill now exists for `field-ops-app-vite`** (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/`, pending merge on PR #93) — use it instead of a manual smoke-test checklist for any future UI-touching PR in that app. See `CLAUDE_CONTEXT.md`'s "AI-agent skills available in this repo."
