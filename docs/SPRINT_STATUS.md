# Sprint Status

Snapshot as of 2026-07-14 (Combined Release Checkpoint after PR #205 + PR #206; the older tables below remain accurate through their own dates). This file is a point-in-time record, not a live dashboard — re-verify against `git log`/`gh pr list` before relying on it, especially PR merge state and Firestore Rules/Cloud Functions **deploy** state (merged ≠ deployed, checked separately every time in this repo). See `docs/CLAUDE_CONTEXT.md` for the full narrative (why decisions were made, what was learned); this file is the compact status table.

## Combined Release Checkpoint — 2026-07-14 (`origin/main` @ `414ea95`)

Stable checkpoint after **PR #205** (accessible Work Order Customer picker + query-error recovery) and **PR #206** (Issue #152 Repository Assessment). Full checkpoint verification — unit, lint, typecheck, build, and all 18 `verify-*` browser suites — passed green at this head; the automatic GitHub Pages deploy at current `main` succeeded.

**Customer**

| Item | PR(s)/Issue | State |
|---|---|---|
| Commercial Profile | #179, #187, #189 | Merged/live |
| Service Activity harness hardening | #193 | Merged |
| Customer hierarchy cleanup | #194 | Merged |
| Customer results dashboard | #196 | Merged |
| Demo customer records — **emulator fixtures only, NOT production data** | #198 | Merged (fixtures) |
| Customer creation overlay + filter-chip contrast | #201 | Merged |
| Remaining Issue #175 work | Issue #175 | **Outstanding** |
| Contact CSV import (column-to-field mapping) | — | Queued, not started |
| Consistent creation-overlay + page-formatting migration | — | Queued, not started |
| Production demo-customer creation | — | **Separate & unconfirmed** |

**Platform**

| Item | PR(s)/Issue | State |
|---|---|---|
| Work Order wizard layout/error clarity | #199 | Merged |
| Grouped Service navigation | #203 | Merged |
| Service Operations top-level area | #204 | Merged |
| Accessible Work Order Customer picker + query-error recovery | #205 | Merged |
| CRM/Sales top-level rename + remove superseded main tab | — | Queued (next Platform item) |
| Cloud Functions deployment gate | Issue #15 | **Open — no production Functions confirmed; WO production creation NOT exercised** |

**Inventory**

| Item | PR(s)/Issue | State |
|---|---|---|
| Issue #100 infrastructure / Rules / deploys | Issue #100 | Merged & deployed (Rules) |
| Issue #100 production verifier | #200 | Merged |
| Issue #100 bootstrap/cleanup tooling | #202 | Merged |
| Authenticated production verification / bootstrap | — | **UNRUN** (distinct from the merged/deployed Rules above) |
| Issue #152 Repository Assessment | #206 | Merged; **Issue #152 CLOSED (completed)** — recommendation + five deferred future decisions preserved in the Assessment; **no Specification exists** |
| Issue #182 | Issue #182 | Separate & **open** |

**Repository / Project**

- Open issues: **#15, #100, #140, #175, #182**. Open PRs: **#180, #188**.
- **PR #180** — stale/Todo; must not resume without merging current `main` and an exact-head review.
- **PR #188** — obsolete global-snapshot PR; to be **superseded, not merged/rebased/reused**.
- Taylor Freezer (Project 1) contains all current repository issues/PRs; keep the zero-missing audit step (`gh project item-list 1 --owner TaylorService-spec --format json --limit 500`; the default 30-item page hides later items).

**Known gaps (expected, not defects):** production Functions absent (Issue #15 gate); WO production creation not exercised; PR #198 demo customers are emulator fixtures; Inventory authenticated production bootstrap/verification unrun.

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

## Completed / merged (Zero-history reorder behavior sprint — CLOSED, all 4 PRs live)

Root cause: the sole writer of `CONSUMED` ledger transactions (`transitionWorkOrder` Cloud Function) has never been deployed, so `avgDailyUsage` is `0` for every part in production, unconditionally — every reorder recommendation showed a misleading `0`/`LOW`. **Kept deliberately separate from Employee Foundation and from the broader Part and Inventory Administration initiative** (Owner instruction). Full narrative, including two real Specification-stage REQUEST CHANGES rounds and a Codex `[P1]` finding, in `docs/CLAUDE_CONTEXT.md`'s dedicated section — this table is status only. Closing summary: `docs/DECISIONS.md` entry #8.

| PR | Status | Summary |
|---|---|---|
| #89 (Assessment/Specification/Implementation Plan) | Merged | Docs-only governance chain. |
| #90 (PR 1 — `recommendationStatus`/nullable `urgency`) | Merged (`a668718`) | `RiskLevel`/`URGENCY_ORDER` unchanged; `recommendationStatus` is a separate field. |
| #91 (PR 2 — transitional Firestore Rules) | Merged (`41392de`), **deployed and verified live 2026-07-11** | Dual-shape `create` rule; Codex `[P1]` fix (complete-schema validation) applied to both branches. 28/28 Rules-test assertions. |
| #92 (PR 3 — write path + UI) | Merged (`79a64c1`), **confirmed live 2026-07-11** | `requestReorderForRecommendation()`, `getDisplayQty()` legacy fallback, `RequestReorderControl.jsx`. Frontend-only — auto-deployed via GitHub Actions at merge, per `docs/Deployment.md`. |
| #103 (PR 4 — Rules tightening) | Merged (`2317695`), **deployed and verified live 2026-07-11** | Removes PR 2's transitional legacy-shape branch — legacy-shape `create` now rejected unconditionally, for every caller. ChatGPT Rules-focused review: Approved with documentation corrections, applied before merge. 32/32 Rules-emulator assertions passing. |

**Sprint closed.** Every Reorder Request `create` now goes through the canonical `recommendationStatus`/`requestedQty`/`quantitySource` schema unconditionally; the transitional dual-shape gap opened by PR 2 and closed by PR 4 no longer exists. Sprint 2.1.11 (Receiving, PR #98) also merged and deployed during this same session — see the Release 2.1 chain table above.

PR #81 (Employee Foundation governance docs) and PR #93 (`run-field-ops-app-vite` skill) have both since merged — see `docs/DECISIONS.md` for the full history.

## Completed / merged (Employee provisioning tooling + Reorder Request assignment follow-ups)

| Item | PR | Summary |
|---|---|---|
| Reorder assignment name picker | #105 | `EmployeeAssignmentPicker` wired into Reorder Request assignment (`PartDetail.jsx`) — bounded correction, not the broader Assignment Adoption initiative. |
| Employee query index fix | #109 | `employees` composite index (`employmentStatus`/`userId`), deployed — the picker's live query had never existed in production. |
| `PARTS_ASSOCIATE`-eligibility restriction | #111 | `EmployeeAssignmentPicker` now filters to `operationalRoles` containing `PARTS_ASSOCIATE` — previously any `ACTIVE` linked-user Employee was selectable, including an Owner or Driver. New composite index, deployed and confirmed `[READY]`. |
| `provisionEmployeeAccess.js` `--requireExistingAuthUser` | #114 | Existing-account-only linkage mode — fails loudly (zero mutation) instead of silently creating a passwordless account. Also fixed a latent `require.main === module` guard bug discovered while building PR #116. |
| Six-persona provisioning record | #115 | Docs-only record of the six production test personas (`docs/DECISIONS.md` entry #11) — no UIDs/emails, per standing credential-boundary discipline. |
| `onboard-employee` skill | #116 | Root-level Claude Code skill wrapping `provisionEmployeeAccess.js` for future Employee onboarding — reviewable plan, stop-on-failure execution, read-only verification. |
| Post-assignment display-name resolution | #107 | `hooks/useEmployeeDirectory.js`'s `resolveActorDisplayName()` — fixes raw-uid displays on "Assigned to"/"Ordered by"/"Received by". Issue #118 tracked two remaining sites this PR didn't cover. |
| Cancel/Void schema — transitional Rules (PR 1 of 6) | #117 | `hasCanonicalReorderRequestKeys()`/`...CreationBaseline()` now dual-shape (old 29-key OR new 35-key with six Cancel/Void fields, all null) — step A of PR #108's five-step expand/contract sequence. Merged and deployed. |
| Raw-uid display follow-up (Issue #118 close-out) | #122 | `lastPurchasingUpdateBy` and `InventoryActionsPanel`'s `createdBy` now resolve through `resolveActorDisplayName()` — no raw Firebase Auth UID renders anywhere in `field-ops-app-vite/src`. First PR to add a matching `docs/user-guide/` page (`reorder-requests.md`) under the new every-user-visible-sprint-updates-the-guide rule. |

## In progress / not yet started

**Reorder Request assignment now uses `EmployeeAssignmentPicker`** (PR #105, merge `d6a60f8`; display-name resolution follow-up **PR #107, merged and deployed**, `5911fd9`; `PARTS_ASSOCIATE`-eligibility restriction **PR #111, merged and deployed**, index confirmed `[READY]`) — a **bounded correction** the Owner explicitly distinguished from the broader initiative below: same workflow, same write path, no schema/Rules/authorization change, one field. **Issue #118**'s two remaining raw-uid display sites (`lastPurchasingUpdateBy`, `InventoryActionsPanel`'s `createdBy`) are fixed — see the table above once merged. The broader **Parts and Purchase Order Assignment Adoption** initiative (every remaining manual-uid pattern, across every workflow) remains **not started**, still needs its own fresh Specification (the old one was chat-only, never committed) through the standing `docs/ai/workflow.md` gates — PR #105/#107/#111 do not retroactively satisfy that for anything beyond the fields they touched.

**Reorder Request Cancellation/Void** (PR #108, docs only, Assessment Architecture-Approved, Specification **Approved**, Implementation Plan **Draft** — six-PR breakdown, awaiting review) — see `docs/CLAUDE_CONTEXT.md`'s dedicated section for the full design (append-only void-record model, permanent never-delete repository rule, five-step schema expand/contract deployment sequence). **PR 1 of 6 (transitional Rules) already shipped separately as PR #117, merged and deployed.** PRs 2-6 (writer, tightened Rules, Cancel, Void, UI) not started.

**Six production test personas — DONE.** All six (Owner, Parts Manager, Warehouse Manager, Parts Associate, Sales Manager, Driver) provisioned and verified via `provisionEmployeeAccess.js --requireExistingAuthUser` (PR #114) — full evidence in `docs/DECISIONS.md` entry #11. No longer blocked or planning-only.

**Customer Record Page and Structured Address Experience** (Issue #119, PR #120, docs only, Assessment Architecture-Approved, Specification **Approved** after two REQUEST CHANGES rounds, Implementation Plan **Approved** — two-PR breakdown, one REQUEST CHANGES round applied and re-approved) — redesigns the Customer (`Account`) record page (header, tabs, two-column layout, distinct address fields) per Owner-supplied Salesforce-style screenshots used for information architecture only. Retains the existing `{ street, city, state, zip }` address shape (Option A) — see `docs/CLAUDE_CONTEXT.md`'s dedicated section for the eight Owner business decisions already resolved. **Roadmap placement, per Owner direction:** after PR #107/#108/Issue #118 (all now merged/drafted); implementation priority remains behind PR #108 unless the Owner explicitly reprioritizes. PR 1 implementation has not begun -- awaiting the docs PR's own merge and the Owner's selection of this initiative for implementation. No code yet.

## Standing backlog items (none yet scoped as their own sprint)

1. ~~Replace manual-uid Reorder Request assignment (Sprint 2.1.6) with a controlled, role-filtered user picker~~ — **RESOLVED as a bounded correction, PR #105/#107/#111.** The broader multi-workflow adoption initiative is the still-not-started item above, not this one.
2. Notification Panel is at 4 sections (Pending Review / Ready for Parts Manager / Assigned to You / Purchasing Started) — evaluate a "My Work" view before adding a 5th.
3. If full purchasing communication history is ever needed (not just latest-state), consider a child progress-log collection under Reorder Request.
4. Apply `inventory_actions` to `inventory_transactions` via a Cloud-Function-mediated trusted write path once Firebase Blaze is enabled — genuinely blocked on that decision, not on engineering effort.
5. When full Procurement enters active planning, explicitly assess whether `reorder_purchase_orders` should migrate into or be consolidated with the existing full `purchase_orders` model (Epic 5) — **the Reorder Request Cancellation/Void initiative above deliberately does not touch this question either.**
6. ~~Modernize `functions/tsconfig.json`'s deprecated `moduleResolution: "node"`~~ — **RESOLVED, PR #87, merged.**
7. Governed fallback demand model / minimum-stock policy for zero-usage-history parts (tier 2 of the Zero-history reorder behavior sprint's hybrid model) — explicitly out of scope for that sprint's PRs 1-4; not yet scoped as its own sprint.
8. ~~Once PR #92 deploys, evaluate whether an Employee needs `operationalRoles` populated for real~~ — **IN PROGRESS**, see the six-persona provisioning plan above (blocked on PR #111).
9. `ROLES.TECHNICIAN` has zero Inventory nav access, independent of Employee `operationalRoles` — a real product gap, tracked in issue #100, not fixed. Relevant to the provisioning plan above: the Driver persona (`securityRole: technician`) will never be able to reach Inventory to be assigned anything, regardless of any `operationalRoles` it's given.

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
- **A browser-driving agent skill exists for `field-ops-app-vite`** (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/`, merged via PR #93) — use it instead of a manual smoke-test checklist for any future UI-touching PR in that app; write one-off scratch verification scripts alongside it in that same directory (untracked, delete when done) rather than modifying the skill's own committed files for a single check.
- **This project now runs on `docs/DelegationCharter.md`** (Active, adopted 2026-07-11) — Tier 1/2/3 decision authority, replacing case-by-case owner approval for bounded work. Read it and `docs/DECISIONS.md` before assuming what needs to be asked versus just done.
- **`firestore.indexes.json` deploys need the same two-step discipline as `firestore.rules`** (deploy, then verify), but the verification command is different and easy to miss: `firebase firestore:indexes --project <id> --pretty` shows build state (`[CREATING]`/`[READY]`); the plain/default JSON output from `firebase firestore:indexes` omits build state entirely and will look identical whether an index is ready or still building. Index builds are asynchronous — poll until `[READY]`, don't assume "deploy complete" means queryable yet.
- **Never search for, request, or use production credentials to work around a blocked read or write** — no service-account keys, no ADC, no recreating a removed credential-bypassing tool, even when explicitly offered. Ask the Owner to check the Console or report the data directly instead. Tested and held firmly multiple times in this project's history; the credential-free path always existed.
