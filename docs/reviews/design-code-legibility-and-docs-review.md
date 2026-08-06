---
artifact_type: review
gate: Design-Code Legibility & Docs Review
status: Accepted — Blueprint input (finalized 2026-08-05)
verification_note: "Live-environment verifications recommended in this review are governed by Blueprint rulings R2/C4 — build proceeds repository-only; live checks are separately authorized and are NOT a prerequisite to the repo work."
date: 2026-08-05
owner: Claude Code
method: 12-unit fan-out workflow + synthesis
---

# Codebase Legibility & Documentation Review — Taylor_Parts (frontend + domain)

_Date: 2026-08-05 · Scope: `field-ops-app-vite/src` (domain engines, modules, hooks, shared UI, app shell) · 12 review units, ~90 files_

## 1. Executive summary

The codebase is **not "crap" — it is above-average legible, but carrying a specific and self-inflicted debt: stale comments around a completed migration.** The house style is unusually strong: nearly every file opens with a module-intent header, the Jobs-vs-Work-Orders domain split is documented in `constants.js` and `SYSTEM_AUTHORITIES.md`, and 84 of the ~90 reviewed files came back clean. That signposting convention is the codebase's biggest legibility asset.

The debt is concentrated in one place: the **Work Order Engine v1.2 migration** (fieldops_wos + Cloud Functions replacing the old jobs-aggregate model) shipped its code but did **not** finish updating the comments, enums, dead helpers, and one legacy screen that the old model left behind. The result is a cluster of "active traps" — headers and constants that confidently describe a superseded model as current, plus several fully-orphaned modules whose headers still claim they are live. A new developer reading `constants.js`, `workOrders.js`, or `Jobs.jsx` first would be **actively misled** about how Work Orders are created and where their state lives.

The other recurring smell is **demo/in-memory write surfaces that look like real persistence** (`PartsScanner.jsx`, `InventoryContext.jsx`) and a handful of **inconsistent-with-siblings** files (fire-and-forget writes, hardcoded role strings, inline styles). None of these are correctness bugs today; all are comprehension costs. Most are fixable with comment-only edits, which is why the safe-fix list below is large and low-risk.

**Bottom line:** good bones, honest headers where they were maintained, but a migration that was 90% finished in code and 40% finished in documentation. The fixes are cheap.

## 2. Findings by severity

### High (5)

**H1 — `domain/workOrders.js:10` · code-vs-docs-coherence / dead-code trap.**
Exported `workOrdersStore = makeCollectionStore("workOrders")` is a zero-consumer direct client-write path (`.add/.update/.remove`) into a phantom collection literally named `"workOrders"` — not `fieldops_wos`. Its header documents a fictional status vocabulary (`open|scheduled|in_progress|closed`) that matches neither `JOB_STATUS` nor the 11-value `WorkOrderStatus`. This directly contradicts `SYSTEM_AUTHORITIES.md` (Work Order writes go exclusively through `createWorkOrder`/`transitionWorkOrder` Cloud Functions; Rules deny all direct client writes). A new dev could import `workOrdersStore.add(...)` as "the way to create a work order," bypassing the entire governed engine. **Code is the stale side.** _Direction: replace the header with an explicit "unused, non-canonical" note (safe-fix); deleting the export is the better end-state but is a human decision._

**H2 — `domain/constants.js:266` · code-vs-docs-coherence.**
The `WORK_ORDER_STATE` NOTE (265–282) states "JOB_STATUS remains the single source of truth; a Work Order's state is always an aggregate computed from its child Jobs" with no deprecation marker — but `workOrderLifecycle.js`'s own header declares that exact aggregate model DEPRECATED as of Engine v1.2, and `SYSTEM_AUTHORITIES.md` names `fieldops_wos.status` (Cloud-Function-written) as the real authority. `constants.js` is the first file a new dev reads. **Constants NOTE is stale.** _Direction: mark the jobs-aggregate model deprecated, point to `fieldops_wos.status`/`workOrderWorkflow.js` (safe-fix)._

**H3 — `modules/jobs/Jobs.jsx:9` (+ `domain/jobActions.js:12`) · code-vs-docs-coherence.** _(dedup: same invariant, two files)_
Both headers assert "Jobs MUST NOT carry customer fields / Jobs never own customer data directly — they resolve upward via `workOrderId`." The code does the opposite: `Jobs.jsx` holds a `customer` state, renders a Customer input, and passes it to `createJob`, which persists `customer` onto the job doc **and always sets `workOrderId: null`** — so the documented resolution path can never fire. `jobRiskScoring.js:179` reads `job.customer` directly. A dev trusting the invariant would resolve customer through a null `workOrderId` and never find `job.customer`. **The comment asserts an invariant the code violates — needs a human decision** (is the comment aspirational, or is the write wrong?), so it is not a safe-fix.

**H4 — `modules/jobs/Jobs.jsx:55` · internal-consistency.**
This is the jobs module (`JOBS_COLLECTION`, `createJob`) yet every user-facing string says "Work Orders" (h2, "Add Work Order" button, "No work orders yet", "Loading work orders…"). `navConfig.js:89` mounts it under label "Job Assignments," and the real Work Orders surface is `WorkOrdersList.jsx` (whose header says it replaced this "placeholder-adjacent legacy Jobs.jsx"). Two components now render "Work Orders" to the user; a dev opening `Jobs.jsx` would conclude it is the Work Orders screen and misfile changes. **In-file strings are stale vs. navConfig + the WorkOrdersList relocation note.** _Direction: relabel strings to Jobs vocabulary — deferred as a user-visible text change, not a mechanical comment fix._

**H5 — `modules/mobile/FieldMode.jsx:23` (+ `App.jsx:101`) · dead-code / documentation-consistency.** _(dedup: one orphan, two sides)_
`FieldMode.jsx` is orphaned and unreachable: the only nav item with `legacyKey "fieldMode"` (Service → "Technician Workspace", `navConfig.js:91`) is special-cased in `App.jsx:101-103` to return `<PartsScanner/>` **before** the generic `legacyKey` branch, so `LEGACY_COMPONENTS.fieldMode → FieldMode` never executes. Three-way name mismatch: nav label "Technician Workspace" vs `legacyKey "fieldMode"` vs rendered `PartsScanner`. Every other special-case in that same function (parts, workOrders, customers) carries a detailed rationale comment; this one — in untracked WIP — has none. A dev told to change the Technician Workspace screen will edit `FieldMode.jsx` and see zero effect. _Direction: add the missing rationale comment in `App.jsx` (safe-fix); deleting `FieldMode.jsx` + its map entry is the cleaner end-state but is a structural human decision._

### Medium (14)

**M1 — `domain/workOrderScoring.js:37` · dead-code.** `computeWorkOrderSignal(workOrderId, jobs)` has zero consumers (only `computeWorkOrderSignalFromDoc` is imported). The header still calls `explainWorkOrderState()` "the single source of truth," but that is a FROZEN/DEPRECATED export whose only caller is this dead function. _Safe-fix: header correction._

**M2 — `domain/workOrderLifecycle.js:9` · documentation-quality.** Header claims the four frozen exports have "exactly one remaining consumer: timelineBuilder.js." Actually `timelineBuilder` imports only `computeWorkOrderState`; `isActiveWorkOrder`, `isCompletedWorkOrder`, and `explainWorkOrderState` are fully orphaned. Header overstates how load-bearing the file is. _Safe-fix: header correction._

**M3 — `domain/inventoryReorderRequests.js:17` · documentation.** The "A Reorder Request is: {…}" canonical shape enumeration omits eight fields the writer always persists (`receivedBy/At`, `cancelledBy/At`, `cancellationReason`, `voidedBy/At`, `voidReason`). Later sprint comments added the fields to the write but never updated the header list. _Safe-fix: extend the enumeration._

**M4 — `domain/accountWorkOrders.js:32` · internal-consistency.** `COMPLETED_/OPEN_WORK_ORDER_STATUSES` re-list the `WorkOrderStatus` enum as hand-split string literals with no cross-reference — effectively the "third copy" that `constants.js:38-40` explicitly warned against. A new 11th status silently omitted from both buckets would drop those Work Orders from **both** server counts with no error. _Safe-fix: add a cross-reference/maintenance-obligation signpost._

**M5 — `domain/eventValidation.js:38` · dead/orphaned code.** The whole module is orphaned — `validateEvents` has zero consumers. The header frames it as an active read-only guard "mirroring workOrderValidation.js," implying it runs in the render/build path. _Direction: wire it in or mark it intentionally-inert; header is misleading._

**M6 — `domain/technicianRecommendationEngine.ts:37` · internal-consistency.** Two technician-scoring engines coexist with **no cross-reference**: `dispatchScoring.js` (weights .35/.3/.25/.1, Signal output, scores OPEN Jobs for Control Tower) and `technicianRecommendationEngine.ts` (weights .4/.25/.2/.15, bespoke `RecommendedTechnician[]`, scores Work Orders for DispatcherBoard). The split is defensible but documented nowhere; it reads as accidental drift. _Direction: add a signpost in each distinguishing the two — deferred (needs author intent on the exact boundary)._

**M7 — `modules/inventory/PartDetail.jsx:1246` · legibility / misleading name.** All ~9 action callbacks wire to `refresh: refreshReorderRequest`, which is a documented no-op (`useReorderRequests.js:138-141`; the hook is realtime `onSnapshot`). Nothing local signals the callback does nothing; the name implies a refetch. _Safe-fix: one-line comment at the destructure._

**M8 — `modules/mobile/PartsScanner.jsx:1` · documentation / consistency.** No module-intent header at all — the lone deviation from the review's strongest convention. Its ACTIONS ("Receive inventory," "Cycle count," "Load my truck") call `demo/InventoryContext.jsx`'s in-memory, reset-on-reload mutations, but nothing tells the reader these are demo-only and not a real inventory write path. This is the component actually shown as "Technician Workspace." _Safe-fix: add a signposting header._

**M9 — `modules/technicians/Technicians.jsx:21` · internal-consistency.** `addTechnician()` clears inputs then calls `createTechnician(...)` fire-and-forget — no `await`, no try/catch, no error state — while every sibling create flow (`AccountsList`, all technicianDashboard writers) awaits inside try/catch and surfaces errors. Any failure is silently swallowed with optimistic input-wipe. _Direction: adopt the awaited+error-handled house pattern — deferred (behavior change)._

**M10 — `modules/dispatcherBoard/TechnicianBoard.jsx:42` · consistency.** `canDispatch` uses `getAllowedActions(status, "dispatcher", false)` with a hardcoded role literal (same in `WorkOrderPreview.jsx:51`), while the actual dispatch call uses the real `useAuth()` role and the sibling ControlTower path threads the real role prop. Benign only because the board is admin/dispatcher-only today; the display gate and real gate would silently diverge if the permission matrix changes. _Direction: thread the real role — deferred (behavior/logic change)._

**M11 — `modules/controlTower/ControlTower.jsx:63` · legibility.** The headline stat cards "Open Work Orders / In Progress / Completed" are computed from the `fieldops_jobs` array via `JOB_STATUS`, not from the `workOrders` array (rendered separately below). This contradicts the file's own header and `constants.js` insistence that Jobs and Work Orders are distinct post-v1.2. A pre-migration label holdover. _Direction: relabel or re-source the cards — deferred (user-visible/logic decision)._

**M12 — `hooks/useSessionActivityFeed.js:15` · code-vs-comment contradiction.** Header says "a status **or assignedTechId** difference … becomes one feed entry," but the diff loop only compares `status` (`if (prevState.status === wo.status) continue;`); `assignedTechId` is stored (line 65) but never read back, so a pure reassignment produces no entry and the stored field is dead data for the diff. Masked in practice because reassignment coincides with the DISPATCHED status change. _Safe-fix: correct the header to match the status-only gate._

**M13 — `shared/ui/AppHeader.jsx:81` · internal-consistency.** Defines an inline `styles` object with hardcoded hexes (`#eee/#fff/#2e4a50`) applied via `style={}` **alongside** `fo-appheader` CSS classes on the same nodes. Every other shared UI component is pure `fo-*` class with zero inline styling; a dev can't tell which layer is authoritative, and the hardcoded hexes sit outside the `fo-*` theming. _Direction: migrate to `fo-*` classes — deferred (CSS refactor)._

**M14 — `firebase/firebase.js:7` · legibility.** `apiKey: "AIzaSy…" + "…"` splits a literal into a concatenation for no functional reason (almost certainly to dodge a secret-scanner), with no comment. A dev may "tidy" it back into one literal and re-trip push protection, or misread a public Firebase web apiKey as a secret. _Safe-fix: one-line explanatory comment._

### Low (19)

- **L1 — `domain/workOrderValidation.js:38`** — `validateWorkOrder` is a fully-built invariant checker with zero consumers; nothing signposts it as unwired. _Deferred (delete-or-annotate decision)._
- **L2 — `domain/locations.js:4`** — Header shape lists `updatedAt`, but `createLocation()` stamps only `createdAt`; a freshly-created Location has no `updatedAt`. _Deferred (comment vs. seed-field choice)._
- **L3 — `domain/inventoryReorderRequests.js:36`** — Comment says `quantitySource` is "now required," but the function validates only `recommendationStatus` and `requestedQty`; `quantitySource` writes through unvalidated (Rules-enforced server-side). _Deferred (add-validation vs. soften-comment)._
- **L4 — `domain/eventModel.js:59`** — `groupEvents` has zero consumers; its comment cites concrete Activity-Timeline usages that don't exist (panels use only `describeEvent`). _Safe-fix: soften the comment to "generic helper, no current consumer."_
- **L5 — `modules/inventory/PartDetail.jsx:1056`** — `ReorderRequestDecision` renders `purchasingStartedBy/At` rows that never fire (reachable only for REJECTED requests). **Self-documented** as intentional dead conditionals kept to minimize diff. _No action (documented keep-decision)._
- **L6 — `modules/inventory/PartDetail.jsx:29`** — 1470-line file, ~14 co-located components + ~90-line sprint-changelog header, no component index. Consistent with repo house style; flagged as a real navigation cost only. _No action (house style)._
- **L7 — `modules/jobs/Jobs.jsx:26`** — `const [state, setState] = useState("")` names the US-state field's setter `setState`, colliding with React convention. _Deferred (rename = behavior-neutral but user-code edit)._
- **L8 — `modules/workOrders/WorkOrderWizard.jsx:46`** — Header ends with a dangling, ticket-less TODO ("re-check both branches fire during this sprint's validation"); unverifiable whether done. _Deferred (needs author to confirm)._
- **L9 — `modules/dispatcherBoard/WorkOrderPreview.jsx:106`** — "Dispatch to…" picker maps all technicians with no status filter; siblings (`WorkOrderActions`, `Dispatch`) filter to AVAILABLE. Partially defensible for the board's all-capacity model; no comment explains the divergence. _Deferred (behavior decision)._
- **L10 — `modules/accounts/AccountForm.jsx:8`** — Header calls it "a 3-4 field form"; it now renders ~a dozen fields. Inline-vs-wizard decision still holds; only the count drifted. _Safe-fix: update the field-count phrasing._
- **L11 — `modules/registry/moduleRegistry.ts:39`** — Entire file is unused, self-admittedly "STALE AS OF SPRINT 2.0.1" aspirational metadata describing a nav model that doesn't exist. _Deferred (whole-file deletion / move-to-docs decision)._
- **L12 — `hooks/useReorderRequests.js:245`** — Effect body guards `!statuses?.length` but the dep array computes `statuses.join(",")` unguarded (repeated at 301); the safer-looking body guard is dead if the dep key throws first. _Deferred (pick-one-contract decision)._
- **L13 — `hooks/useAssignableEmployees.js:30`** — Comment routes to evidence "recorded as a comment on PR #164, not yet in docs/DECISIONS.md" — a dangling, unresolvable pointer inside an 18-line comment. _Deferred (needs the backfill doc to exist first)._
- **L14 — `shared/ui/AppHeader.jsx:60`** — "Refresh" link is an unexplained full-page hard-link to `/Taylor_Parts/field-ops/`, sitting right after a heavily-commented "Home" link warning that exact hard-link anti-pattern. Reader can't tell if it's intentional. _Deferred (needs author intent)._
- **L15 — `shared/address/AddressFields.jsx:15`** — `idPrefix` is interpolated into DOM ids with no default; if omitted, inputs get `undefined-street` ids and a11y silently breaks. Comment frames it as "defensive"/optional; it is effectively required. _Deferred (default/assert = behavior change)._
- **L16 — `shared/ui/AppHeader.jsx:1`** — Unused `import React from "react"`; every sibling omits it under the automatic JSX runtime. _Safe-fix: remove the dead import._
- **L17 — `demo/InventoryContext.jsx:40`** — `transferPart`/`setCount` hardcode `"Truck 14"` while `heroConfig.js:15` defines the canonical demo truck as `"Truck 12"`; the demo layer disagrees with itself. _Deferred (changes logged content; must choose the intended id)._
- **L18 — `navigation/navConfig.js:6`** — Header cites "docs/CLAUDE_CONTEXT.md's 'Navigation' row in SYSTEM_AUTHORITIES.md," garbling two docs; the row lives in `SYSTEM_AUTHORITIES.md` (`App.jsx:34` cites it correctly). _Safe-fix: correct the citation._
- **L19 — `lib/demoControls.js:19`** — `window.demoStatus()` logs `ENV: window.location.search` — the `ENV:` label prints the raw query string, not the resolved `ENV` from `config/env.js`. _Safe-fix: relabel the key (do not change the logged value)._

## 3. Cross-cutting themes (most useful section)

1. **The v1.2 migration finished in code, not in prose.** The single largest legibility liability. `workOrders.js`, `constants.js` (WORK_ORDER_STATE NOTE), `workOrderScoring.js`, `workOrderLifecycle.js`, `accountWorkOrders.js`, and `ControlTower.jsx` all still describe or compute the deprecated jobs-aggregate Work Order model as if it were current. The **code is the correct side**; the comments/enums/labels are the stale side. Fix the prose to catch up with the engine.

2. **Orphaned modules with "I am live" headers.** `workOrders.js` (`workOrdersStore`), `workOrderValidation.js`, `eventValidation.js`, `workOrderScoring.js` (`computeWorkOrderSignal`), `eventModel.js` (`groupEvents`), three of four `workOrderLifecycle.js` exports, and `moduleRegistry.ts` are all zero-consumer, yet several headers actively claim they run somewhere. The excellent header convention becomes a liability when the header outlives its code. **Recommendation: adopt a one-line `@orphaned`/`@superseded` marker convention** so a dead module's header stops lying.

3. **Demo/in-memory writes that impersonate real persistence.** `PartsScanner.jsx` (the live Technician Workspace) and `InventoryContext.jsx` present "Receive inventory / Cycle count / Load truck" affordances that only mutate reset-on-reload demo state. Sibling files signpost this ("nothing here writes to Firestore"); these two don't. High confusion-per-line for a newcomer.

4. **"Same question, two answers, no cross-reference."** Recurring pattern where a duplicated concept lacks a pointer between the copies: two technician-scoring engines (M6), the `WorkOrderStatus` enum's "third copy" in `accountWorkOrders.js` (M4), and three different technician-availability filters in dispatch pickers (M10/L9). None is wrong today; each is a silent-divergence trap. The cheap fix is a signpost, not a merge.

5. **Inconsistent-with-siblings outliers.** `Technicians.jsx` (fire-and-forget vs. awaited house pattern), `AppHeader.jsx` (inline hex styles vs. `fo-*` classes; stray React import), and hardcoded role literals in dispatcherBoard. The codebase has strong conventions; these are the handful of files that predate or missed them, and they read as "the one that forgot the pattern."

6. **Nav label ↔ legacyKey ↔ rendered-component drift.** The `App.jsx` special-case + `navConfig.js` `legacyKey` + `LEGACY_COMPONENTS` map indirection is powerful but under-commented in exactly one spot (fieldMode → PartsScanner), producing an unreachable imported component. The parts/workOrders precedents show the fix: every screen-swap gets a rationale comment.

## 4. Code-vs-docs coherence (which side is stale)

Every place code contradicts a governance doc or a same-repo authority, and the stale side:

| Location | Contradicts | Stale side |
|---|---|---|
| `workOrders.js:10` (`workOrdersStore`, `"workOrders"` collection, fictional statuses) | `SYSTEM_AUTHORITIES.md` (Cloud-Function-only WO writes; Rules deny direct writes) | **Code** (dead ungoverned trap) |
| `constants.js:266` WORK_ORDER_STATE NOTE (jobs-aggregate = source of truth) | `workOrderLifecycle.js` header (model DEPRECATED v1.2); `SYSTEM_AUTHORITIES.md` (`fieldops_wos.status`) | **Comment** |
| `Jobs.jsx:9` + `jobActions.js:12` ("Jobs never own customer data") | Actual `createJob` (writes `customer`, sets `workOrderId: null`); `jobRiskScoring.js:179` reads `job.customer` | **Comment** (asserts violated invariant — human call) |
| `Jobs.jsx:55` ("Work Orders" UI strings) | `navConfig.js:89` label "Job Assignments"; `WorkOrdersList.jsx` relocation note | **Code strings** |
| `FieldMode.jsx` + `App.jsx:101` (fieldMode legacyKey → FieldMode) | Actual render is `PartsScanner`; nav label "Technician Workspace" | **Wiring/comment** (unrouted, unexplained) |
| `workOrderScoring.js:5` header ("single source of truth") | `workOrderLifecycle.js` FROZEN/DEPRECATED list | **Comment** |
| `workOrderLifecycle.js:9` ("one remaining consumer: timelineBuilder") | timelineBuilder imports only 1 of 4 exports | **Comment** |
| `inventoryReorderRequests.js:17` field enumeration | Same file's `createReorderRequest` writes 8 more fields | **Comment** |
| `inventoryReorderRequests.js:36` (`quantitySource` "required") | Function validates only 2 of 3 | **Comment** (overstates) |
| `accountWorkOrders.js:32` bucket literals | `constants.js:38-40` ("not duplicated a third time here") | **Code** (missing pointer) |
| `eventValidation.js:38` header ("active guard, mirrors workOrderValidation") | Zero consumers | **Comment** |
| `eventModel.js:59` `groupEvents` comment (cites live filter) | Panels use only `describeEvent` | **Comment** |
| `ControlTower.jsx:63` cards labeled "…Work Orders" | File header + `constants.js` Jobs≠WorkOrders split; cards read `fieldops_jobs` | **Code labels** |
| `useSessionActivityFeed.js:15` ("status **or assignedTechId**") | Diff loop compares status only | **Comment** |
| `AccountForm.jsx:8` ("3-4 field form") | Renders ~12 fields | **Comment** |
| `navConfig.js:6` doc citation | Navigation row lives in `SYSTEM_AUTHORITIES.md`, not `CLAUDE_CONTEXT.md`; `App.jsx:34` cites correctly | **Comment** |
| `demoControls.js:19` (`ENV:` label) | `config/env.js` resolved `ENV`; label prints raw `location.search` | **Label** |
| `locations.js:4` shape (`updatedAt`) | `createLocation` stamps only `createdAt` | **Comment** (overstates create-time shape) |

Overwhelmingly the **comment/label side is stale**, which is the good direction — the code is right, the prose lagged. The two exceptions where **code is the liability** (`workOrders.js` dead trap, `accountWorkOrders.js` missing pointer) are both addressed by the safe-fixes.

## 5. Safe-fix appendix — PROPOSED / QUEUED, NOT APPLIED (behavior-preserving only)

> Correction (C2, 2026-08-05): these safe-fixes were never auto-applied. They are
> proposed/queued and are applied under Blueprint wave **W0**, not before.

All 16 fixes below are comment/label/dead-import edits with **no** behavior, write-path, Rules, or control-flow change. Grouped by file.

**`domain/constants.js`** — L266: mark the WORK_ORDER_STATE jobs-aggregate NOTE as DEPRECATED per Engine v1.2; point to `fieldops_wos.status`/`workOrderWorkflow.js`.
**`domain/workOrderLifecycle.js`** — L9: correct the consumer claim (only `computeWorkOrderState` is imported, by `timelineBuilder`; the other three exports are orphaned).
**`domain/workOrderScoring.js`** — L5: header no longer presents `computeWorkOrderSignal`/`explainWorkOrderState` as the live path; note `computeWorkOrderSignalFromDoc` is the sole live consumer.
**`domain/workOrders.js`** — L10: replace the misleading schema/status header with an explicit "unused, non-canonical; governed WO path is `fieldops_wos` via Cloud Functions" note. _(Narrowed to comment-only; the export deletion option was dropped as a code change / human decision.)_
**`domain/inventoryReorderRequests.js`** — L23: extend the record-shape enumeration with the 8 omitted receiving/cancel/void fields.
**`domain/accountWorkOrders.js`** — L31: add a cross-reference signpost above the status buckets (canonical `WorkOrderStatus`; keep-in-sync obligation; CANCELLED intentionally in neither).
**`domain/eventModel.js`** — L55: soften the `groupEvents` comment to a generic-helper framing (no current consumer) rather than asserting a live filter usage.
**`modules/inventory/PartDetail.jsx`** — L1246: one-line note that `refreshReorderRequest` is an intentional no-op retained for call-site compatibility (hook is realtime `onSnapshot`).
**`modules/accounts/AccountForm.jsx`** — L8: update the "3-4 field" phrasing to reflect the real field set; keep the inline-vs-wizard justification.
**`modules/mobile/PartsScanner.jsx`** — L13: add a module-intent header — live Technician Workspace screen; all five ACTIONS mutate `demo/InventoryContext.jsx` in-memory state only (no Firestore, resets on reload); not a real inventory write path.
**`hooks/useSessionActivityFeed.js`** — L15: correct the header to the actual status-only diff gate; remove the false "or assignedTechId difference" claim.
**`shared/ui/AppHeader.jsx`** — L1: remove the unused `import React from "react"` (provably dead; siblings compile without it).
**`App.jsx`** — L101: add a rationale comment on the `technicianWorkspace → PartsScanner` special-case (fieldMode legacyKey retained for ROLE_NAV_ACCESS gating; screen swapped), matching the parts/workOrders precedent. _(Comment-only; import and map entry untouched.)_
**`firebase/firebase.js`** — L7: one-line comment — apiKey split intentionally to avoid secret-scanner matches; Firebase web apiKey is a public client identifier, not a secret.
**`navigation/navConfig.js`** — L6: correct the citation to `docs/architecture/SYSTEM_AUTHORITIES.md`'s Navigation row (matching `App.jsx:34`).
**`lib/demoControls.js`** — L19: relabel the mislabeled `ENV:` key in `demoStatus()`'s `console.log` to `search:` (the value it actually prints). _(Relabel only; the "log the resolved ENV value instead" alternative was dropped as a behavior/output-value change.)_

## 6. What was NOT changed, and why

These require human judgment or alter behavior, so they are deliberately excluded from the queued safe-fix set (the §5 fixes queued for W0, not yet applied):

- **Deleting dead code** — `workOrdersStore` export, `workOrderValidation.js`, `eventValidation.js`, `computeWorkOrderSignal`, `groupEvents`, three `workOrderLifecycle.js` exports, and the whole `moduleRegistry.ts` file. All provably zero-consumer, but whole-export/whole-file removal is a structural decision (and some may be intentional safety-net scaffolding). Safe-fixes only re-label their headers honestly.
- **`FieldMode.jsx` disposition** (H5) — delete-and-remove-map-entry vs. keep-as-superseded is a structural call; only the `App.jsx` rationale comment is in the queued safe-fix set.
- **The customer-invariant contradiction** (H3) — the comment asserts an invariant the code violates; resolving it means either changing the write (drop `customer`, set `workOrderId`) or rewriting the domain rule. Needs an owner decision.
- **`Jobs.jsx` "Work Orders" → Jobs relabel** (H4) and **`ControlTower.jsx` KPI-card relabel/re-source** (M11) — user-visible text/semantics changes.
- **`Technicians.jsx` fire-and-forget → awaited+try/catch** (M9) — behavior change (adds error handling/await ordering).
- **`TechnicianBoard.jsx`/`WorkOrderPreview.jsx` role threading** (M10) and **dispatch-picker availability filter** (L9) — authorization/filter logic changes.
- **`AppHeader.jsx` inline-styles → `fo-*` classes** (M13) — CSS refactor.
- **Two-scoring-engines signpost** (M6), **`useReorderRequests` nullish contract** (L12), **`AddressFields` idPrefix default** (L15), **`locations.js` `updatedAt` seed** (L2), **`quantitySource` validation** (L3), **`Truck 12`/`Truck 14` reconciliation** (L17) — each needs the author to choose the intended contract/value; not mechanical.
- **`setState` rename** (L7), **dangling-TODO / PR-#164-pointer resolution** (L8/L13), **`AppHeader` Refresh-link intent** (L14) — need author confirmation of intent, or an external doc to exist first.
- No Firestore Rules, Cloud Function, or write-path files were touched by any fix.
