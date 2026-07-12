---
artifact_type: assessment
gate: Repository Assessment
status: Architecture-Approved
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 155
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Assessment Report: Inventory Operational Queue Visibility, Filter Semantics, and Action Authorization

**Business Request:** Issue #154. The Inventory workspace's operational queue (`PartsList.jsx`) is not behaving as the Owner intends: visibility should be broadly available to the appropriate Inventory audience, separate from permission to act; managers should retain oversight after assigning work; personal Waiting/In Progress views should not make assigned work disappear from manager oversight; Needs Planning and Critical/High filters should show matching records when they exist and clear empty states when they don't; Show All should be the complete catalog. This assessment investigates the current implementation against that intent, with no code, Rules, production-data, or deployment change.

**Architecture Review: APPROVED, 2026-07-12** (reviewed at head `a60ab4b5856e2e6ca2417a4e4a087bb05447f069`, corrections applied at head recorded in this PR's own history). Decisions, resolving this assessment's open questions:

1. **Visibility audience -- current phase.** `firestore.rules` is **not** widened in this initiative. Shared operational oversight remains visible to existing `admin`/`dispatcher` users; personal Waiting/In Progress remains scoped to the signed-in assignee; a new assignee-independent manager-oversight view is added for `admin`/`dispatcher` users. Broader authorization based on `Employee.operationalRoles` is **deferred to a separate Tier-2 identity/authorization design, coordinated with Issue #100** ("Product gap: `ROLES.TECHNICIAN` has no Inventory nav access, independent of `operationalRoles` eligibility"). This avoids treating advisory `operationalRoles` as security roles without a complete Rules/nav/identity design. Resolves Open Question #1.
2. **Show All -- true complete-catalog semantics adopted.** The top queue's Show All view must merge `PARTS_CATALOG` with available `healthEntries`: every catalog part appears; parts lacking ledger-derived health display an explicit "No ledger activity" state; Critical & High and Needs Planning remain calculated subsets, unaffected. The future Specification must address the now-duplicated lower Parts Catalog table through consolidation or relocation -- it must not leave two indistinguishable complete-catalog experiences indefinitely. Resolves Open Question #2, in the direction §"Live-page architecture finding" already recorded.
3. **Empty states and counts -- differentiated states adopted.** Critical & High and Needs Planning each get a matching count and a truthful, filter-specific empty message; Show All gets a catalog count and no silent empty result. `InventoryHealthPanel` receives an optional caller-supplied `emptyText`/default contract so `Operations.jsx` remains unchanged.
4. **Technician assignment dead end -- interim safety constraint adopted.** Until broader operational-role authorization is designed and approved, assignments the assignee cannot access are prevented: `technician`-security-role employees are excluded from Parts Associate assignment eligibility in this workflow. Prefer client-side filtering of the already-authorized Employee result if that avoids a new composite index/query contract -- the Specification must verify the exact implementation. **This is an interim safety constraint, not a permanent rejection of technician + operational-role combinations** -- Issue #100 remains the broader authorization problem. Resolves Open Question #3.
5. **Manager oversight layout -- confirmed additional, not replacement.** Personal Waiting and Personal In Progress are preserved unchanged. A new "All Assigned Work" view is added, independent of the current assignee, covering `ASSIGNED_TO_PARTS_ASSOCIATE` and `PURCHASING_IN_PROGRESS` with assignee identity and status visible. Resolves Open Question #4.
6. **Queue actions -- unchanged, PartDetail only.** Actions stay on `PartDetail` only for this initiative. Queue rows navigate to the exact request using `requestId`. No action-authorization logic is duplicated in queue rows.

**Planning boundary:** the future Specification separates implementation into **at least** (a) manager oversight plus safe assignment eligibility, and (b) complete-catalog Show All plus counts/differentiated empty states and catalog-view consolidation -- matching "Proposed delivery breakdown" PR A and PR B below. **No Rules change is approved. No implementation is authorized by this Assessment review.**

**Supersedes Issue #153 and PR #156.** A duplicate, independently-produced assessment chain (Issue #153, "manager oversight queue -- no way to locate existing assigned/ordered Reorder Requests," and PR #156, `docs/assessments/manager-oversight-queue.md`) covered overlapping ground. Both are closed as duplicates of this Issue #154 / PR #155 chain; PR #156 was not merged. Its two unique, code-supported findings not already covered here have been folded in: `FilterBar.jsx` already supports per-option counts (§4 above), and `InventoryHealthPanel.jsx`'s single hardcoded empty-state string cannot distinguish "no filter matches" from "no ledger activity" (§4 above, and the "Verification requirements" section below).

## Scope of this assessment

Investigated: `field-ops-app-vite/src/modules/inventory/PartsList.jsx`, `modules/operations/panels/InventoryHealthPanel.jsx`, `domain/inventoryAnalyticsEngine.ts`, `hooks/useInventoryLedger.js`, `hooks/useReorderRequests.js`, `hooks/useAssignableEmployees.js`, `domain/employees.js`, `domain/constants.js` (`ROLES`, `OPERATIONAL_ROLE`, `REORDER_REQUEST_OWNER`), `modules/inventory/PartDetail.jsx` (assign/review/start-purchasing action sites), and the `reorder_requests` / ledger-related sections of `firestore.rules`.

Explicitly **not** investigated or addressed here, per the Owner's instruction:
- The Cancel/Void initiative (PRs 1-6) -- untouched, not referenced as a dependency.
- The Inventory Action Log (`inventory_actions` collection, `domain/inventoryActions.js`) redesign -- it exists and is referenced below only where it bears directly on queue/action design; a full redesign is recorded as a **related but separate product finding**, not scoped into this assessment.

No application code, Firestore Rules, deployment, or production-data change was made while producing this assessment -- read-only investigation only.

## Current repository state

### 1 & 2. How Needs Planning and Critical/High are calculated, and what they operate on

`PartsList.jsx`'s top "Inventory Operational Queue" section has three filter tabs (`QUEUE_FILTER_OPTIONS`, `PartsList.jsx:106-110`): **Critical & High**, **Needs Planning**, **Show All**. All three filter the *same single array*, `healthEntries` (`PartsList.jsx:142-148`) -- none of them read the parts catalog or `reorder_requests` directly:

```js
// PartsList.jsx:142-148
const queueEntries = useMemo(() => {
  if (queueFilter === "ALL") return healthEntries;
  if (queueFilter === "NEEDS_PLANNING") {
    return healthEntries.filter((entry) => entry.recommendation.recommendationStatus === "NEEDS_PLANNING");
  }
  return healthEntries.filter((entry) => ACTIONABLE_URGENCIES.has(entry.recommendation.urgency));
}, [healthEntries, queueFilter]);
```

`healthEntries` comes from `useInventoryLedger()` (`hooks/useInventoryLedger.js:18-48`), which is pure **analytics output** derived from `inventory_transactions` (the ledger), *not* the parts catalog and *not* `reorder_requests`:

```js
// hooks/useInventoryLedger.js:24-34
fetchInventoryTransactions().then((raw) => {
  const transactions = raw.map(normalizeLedgerTransaction);
  const availableByPart = computeAvailableStockByPart(transactions);
  const stockSnapshots = [...availableByPart.entries()].map(([partId, availableStock]) => ({ partId, availableStock }));
  const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);
  ...
});
```

`recommendationStatus` (`NEEDS_PLANNING` vs `READY`) and `urgency` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`/`null`) are computed per entry by `generateReplenishmentRecommendation()` (`domain/inventoryAnalyticsEngine.ts:156-194`): a part with **zero `CONSUMED` ledger transactions** (`hasUsageHistory()` false, `:99-101`) is `NEEDS_PLANNING` with `urgency: null`; otherwise `urgency` is derived from available stock vs. reorder point.

### 3. Why the filters currently return no visible items

Two independent, compounding causes:

**(a) `healthEntries` itself is scoped to a subset of the catalog, not the catalog.** `generateInventoryHealthDashboard()` (`domain/inventoryAnalyticsEngine.ts:220-233`) maps over `stockSnapshots`, not the full parts catalog. `stockSnapshots` is built by `computeAvailableStockByPart()` (`:243-258`), which only creates a map entry for a `partId` that has **at least one `RESERVED` or `RELEASED`** ledger transaction (`:245-249`). A part with zero `RESERVED`/`RELEASED` activity -- including a part that has never had a Work Order reserve it at all -- gets **no `healthEntry`, in any filter**, not even `Show All`. `InventoryHealthPanel.jsx`'s own header comment confirms this is intentional for its original context: "Only shows parts with at least one ledger transaction (i.e. actually in play)" (`InventoryHealthPanel.jsx:6-9`). In an environment where ledger reservation activity is sparse (e.g. few open Work Orders touching Inventory), all three tabs -- including `Show All` -- can legitimately render zero rows, independent of any bug.

**(b) `Show All` is not the complete catalog, contrary to the Owner's stated intent.** The genuinely complete catalog (`PARTS_CATALOG`, all SKUs) is rendered separately, further down the same page, in the unrelated "Parts Catalog" table (`PartsList.jsx:354-415`) -- unaffected by `queueFilter`. The top section's `Show All` tab (`queueFilter === "ALL"`) returns `healthEntries` unfiltered, which per (a) is already a ledger-activity-gated subset of the catalog, not the catalog itself. This is a semantic mismatch between the label "Show All" and Owner intent #6 ("Show All remains the complete catalog"): today, two different "show everything" views exist on one page, and only one of them is actually the complete catalog.

**(c) Separately, for the two lower reorder-request-backed queues (Parts Manager Queue, Parts Associate Waiting/In Progress) — see §5-7 below** for a distinct, role/assignment-driven cause of empty results that compounds (a) and (b) for those sections.

### 4. How counts and empty states are produced

- **Top Operational Queue section:** `PartsList.jsx:207` passes `isEmpty={false}` to `LoadingEmptyState` **unconditionally**, regardless of `queueEntries.length`. `PartsList.jsx` itself therefore never produces a queue-specific empty-state message for any of the three tabs. What renders when a filter is empty is entirely delegated to `InventoryHealthPanel.jsx:61-62`, which shows exactly one hardcoded string for all callers and all filter states: `"No ledger activity yet -- nothing to forecast."` This message does not vary by which tab is active (`Critical & High` vs `Needs Planning` vs `Show All`) and does not distinguish "there is ledger activity but nothing matches this filter" from "there is no ledger activity at all" -- e.g. selecting `Critical & High` with real ledger data present but nothing currently urgent shows the same "no ledger activity" message as an empty ledger, which is misleading.
- **Parts Manager Queue / Parts Associate Waiting / In Progress:** each has its own `LoadingEmptyState` with a distinct, section-specific `emptyText` (`"No requests awaiting the Parts Manager."`, `"No requests currently waiting on you."`, `"No purchasing currently in progress."`) driven by the actual query result length (`PartsList.jsx:221-226, 265-270, 306-311`). These three empty states are correctly differentiated per section already -- the gap described in item 4 is confined to the top Operational Queue section's three-tab filter.
- **No counts (badge/number) are shown anywhere on any of the five queue sections today** -- only the presence/absence of rows and the section heading text. **This is not a missing capability -- it's an unused one:** `shared/ui/FilterBar.jsx` (the shared tab-renderer already used by `QUEUE_FILTER_OPTIONS` above) already supports a per-option `(N)` count suffix (`FilterBar.jsx:29` -- `{option.count !== undefined ? ` (${option.count})` : ""}`); `PartsList.jsx`'s `QUEUE_FILTER_OPTIONS` array (`:106-110`) simply never populates a `count` field on any of its three options. Wiring counts in is a call-site change only -- no new shared-component work is needed.

### 5, 6 & 7. Which queues filter by what, where assigned work disappears, and who can see/act

**Sign-in roles are exactly three** (`domain/constants.js:231-235`): `admin`, `dispatcher`, `technician` (`ROLES`). `firestore.rules`' `reorder_requests` collection gates **every read** with `isAdminOrDispatcher()` (`firestore.rules:324-325`) -- there is no read path for a `technician`-role user at all, and no separate "Parts Manager" or "Parts Associate" sign-in role exists in Firestore Rules. Nav access (`ROLE_NAV_ACCESS`, `domain/constants.js:245-248`) further restricts the `inventory` tab itself to `admin`/`dispatcher` only -- a `technician` cannot even navigate to this page.

"Parts Manager" and "Parts Associate" are **not authorization roles**; they are `OPERATIONAL_ROLE` values (`domain/constants.js:155-167`) stored on an `Employee.operationalRoles[]` array, used **only** to filter the assignment picker's eligible-employee list (`hooks/useAssignableEmployees.js`, `domain/employees.js`'s `buildAssignableEmployeesQuery`). Critically, that eligibility query filters by `operationalRoles` and `ACTIVE`+linked-user status only -- **it does not also require the employee's sign-in `role` to be `admin` or `dispatcher`.** An `Employee` whose sign-in role is `technician` can be selected as an assignee if they separately hold `operationalRoles: ["PARTS_ASSOCIATE"]`. If assigned, that person can never see the assignment: they have no nav access to `/inventory`, and even a direct URL visit would hit `permission-denied` on every `reorder_requests` read under `isAdminOrDispatcher()`. `useReorderRequestsAssignedTo()`'s `onSnapshot` error callback silently resolves to `data: []` (`hooks/useReorderRequests.js:120`) with no error surfaced to the UI -- so this failure mode is indistinguishable, from the screen, from "you have no assigned work."

Per-queue filter shape, confirmed by reading each hook's query:

| Queue | Backing collection | Filter | Visible to (Rules) | Visible to (query) |
|---|---|---|---|---|
| Top Operational Queue (3 tabs) | `inventory_transactions` (via analytics) | urgency / recommendationStatus, client-side | admin, dispatcher (nav-gated) | everyone who reaches the page (no per-user filter) |
| Parts Manager Queue | `reorder_requests` | `status == READY_FOR_PARTS_MANAGER` | admin, dispatcher only | everyone who reaches the page (no per-user filter) |
| Parts Associate Waiting | `reorder_requests` | `assignedToUserId == <signed-in uid>` AND `status == ASSIGNED_TO_PARTS_ASSOCIATE` | admin, dispatcher only | **only the exact signed-in uid that matches `assignedToUserId`** |
| Parts Associate In Progress | `reorder_requests` | `assignedToUserId == <signed-in uid>` AND `status == PURCHASING_IN_PROGRESS` | admin, dispatcher only | **only the exact signed-in uid that matches `assignedToUserId`** |

**Where assigned work disappears from manager oversight (item 6), precisely:** `PartsList.jsx`'s own header comment states the intended behavior plainly: "assigned work automatically leaves the Parts Manager Queue above once its status moves to `ASSIGNED_TO_PARTS_ASSOCIATE`, no extra removal logic needed" (`PartsList.jsx:65-71`). This is correct and by design for the Parts Manager Queue. But **the only other place that status/assignment combination is ever queried is `useReorderRequestsAssignedTo(user.uid, status)` -- always scoped to the currently signed-in user's own `uid`.** There is no query anywhere in the codebase for "every request currently assigned, regardless of assignee" or "every request assigned to employees I manage." The instant a request's status becomes `ASSIGNED_TO_PARTS_ASSOCIATE` or `PURCHASING_IN_PROGRESS`, it is visible to exactly one person -- the assignee -- and to no one else, including the Parts Manager who made the assignment, any admin, or any dispatcher, unless that specific person happens to be signed in as the assignee themselves. This is the root cause of Owner intent violation: "Managers must retain oversight after assigning work" / "must not make assigned work disappear from manager oversight."

**Who should see each queue vs. who may act (item 7), as implemented today:** visibility for every reorder-request-backed queue is role-level only (`admin`/`dispatcher`, all-or-nothing) at the Rules layer -- there is no Rules-level distinction between "may view this queue" and "may act on this request." Action eligibility (approve/reject, assign, start purchasing) is enforced entirely in `PartDetail.jsx`'s per-action UI conditionals plus `firestore.rules`' write-side field/status checks (e.g. `firestore.rules:376` update conditions, and the `PURCHASING_IN_PROGRESS`-scoped create rules at `:679-706` requiring `request.auth.uid == ...assignedToUserId`). So today: **visibility == "is admin or dispatcher"; action authorization == role + assignment + status**, correctly separated on the write side, but visibility is not separated from the broader Inventory audience the Owner describes -- it is narrower (admin/dispatcher only) and, for the assigned-work case, narrower still (single assignee only).

### 8. Whether queue rows can expose existing actions without duplicating PartDetail logic

Today they do not attempt to: every row in all five queue sections (`PartsList.jsx`'s Parts Manager Queue, Waiting, In Progress, top Operational Queue, and the Parts Catalog table) renders as a `<Link>` into `PartDetail.jsx` and nothing else, except the top Operational Queue's "Request Reorder" action (`onRequestReorder`, wired through `RequestReorderControl.jsx`). Approve/Reject (`handleApprove`/`handleReject`, `PartDetail.jsx:272-359`), Assign (`handleAssign`, `:397-453`), and Start Purchasing (`handleStart`, `:470-523`) exist **only** on `PartDetail.jsx`, each gated by its own eligibility conditional there. No queue row duplicates any of this eligibility logic. This is consistent with the Owner's constraint ("without duplicating PartDetail logic") as a starting point, but it also means an admin/dispatcher scanning any queue must open each row individually to act -- there is no in-line action affordance on any queue row today besides the top section's reorder request.

### 9. Firestore query/index/Rules impact

- Every existing query in `hooks/useReorderRequests.js` uses only equality (`==`) filters (single or double field) -- Firestore does not require a composite index for these (confirmed already working in production for the existing hooks); a new query following the same pattern (e.g. `where("status", "in", [...])`, or an additional `assignedToUserId`-independent status-only query reusing the existing `useReorderRequestsByStatus()`) needs no new index.
- **No Rules read-path exists today for anyone other than `admin`/`dispatcher`** to read `reorder_requests`. Any future design that wants a real "Parts Manager" or "Parts Associate" *authorization* concept (as opposed to today's advisory `operationalRoles[]` used only for assignment-picker eligibility) to gate visibility or action independently of `admin`/`dispatcher` sign-in role would be a `firestore.rules` change -- Tier 2 under `docs/DelegationCharter.md` ("Changes to `firestore.rules` that alter who can read or write what"), requiring the Owner's explicit decision, not assumed or implemented here.
- A "manager oversight" query that simply drops the `assignedToUserId` filter (i.e., reuses `useReorderRequestsByStatus()` for `ASSIGNED_TO_PARTS_ASSOCIATE` and `PURCHASING_IN_PROGRESS`, the same pattern already used for the Parts Manager Queue) requires **no** Rules or index change -- it is visible today to exactly the same admin/dispatcher audience that can already read the Parts Manager Queue.

### 10. Browser coverage needed (for a future Implementation Plan, not performed here)

Not exercised in this assessment (no code changed, nothing to verify yet). A future Specification/Implementation Plan should require Playwright coverage, signed in as more than one `admin`/`dispatcher` account, for at minimum: (a) a request assigned to user A remains visible in a manager-oversight view while signed in as user B; (b) the Parts Associate Waiting/In Progress personal views still correctly scope to "my own work" and are not broadened by any oversight-view change; (c) Critical & High / Needs Planning tabs each show their own correctly differentiated empty state when genuinely empty, and show matching rows when ledger data produces them; (d) Show All's actual scope (whatever Architecture Review decides it should be) renders correctly; (e) no new action affordance appears for a role/assignment/status combination that shouldn't have one, per existing `PartDetail.jsx` eligibility rules.

## Affected files (for a future implementation; unchanged by this assessment)

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/modules/inventory/PartsList.jsx` | Renders all five queue/catalog sections, owns `queueFilter` state and all five Firestore-hook call sites | Central file for any visibility/filter/empty-state change |
| `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` | Shared renderer for the top Operational Queue (and Operations' own Inventory Health panel) | Owns the single hardcoded empty-state string; shared with a read-only executive dashboard that must not gain queue-specific behavior |
| `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` | Computes `recommendationStatus`/`urgency`, and scopes `stockSnapshots` to ledger-active parts only | Root of finding 3(a) -- any "true complete catalog" queue needs a different input than `healthEntries` |
| `field-ops-app-vite/src/hooks/useReorderRequests.js` | All `reorder_requests` query hooks | Where a manager-oversight (assignee-independent) query would be added, reusing the existing status-only pattern |
| `field-ops-app-vite/src/hooks/useAssignableEmployees.js`, `domain/employees.js` | Assignment-picker eligibility | Root of the technician-assignee dead-end finding in §5-7 |
| `firestore.rules` (`reorder_requests` match block, `isAdminOrDispatcher()`) | Read-gates every reorder-request-backed queue | Any change to who may *view* (as opposed to act on) these queues is a Rules change -- Tier 2 |

## Dependencies

- Does not touch, and does not reopen, the Cancel/Void initiative -- confirmed no shared file requires a code change here. Corrected status (was stale in an earlier draft of this assessment): **PR #151 (Cancel/Void UI, PR 6 of 6) is merged and deployed** (merge commit `e642e93468e325a62dfebe4a19156f59307da9e2`, auto-deployed same as every prior frontend-only PR in this initiative). Emulator verification is **22/22** (`verify-cancel-void`, per PR #151's own body). A read-only production Cancel validation has passed. Production Cancel/Void *execution* was not performed. Void/terminal-card production checks remain deferred because no suitable existing `ORDERED`/`CANCELLED`/`VOIDED` record could be located (the exact gap Issue #153's original finding #1/#2 identified, now consolidated into this Issue #154/PR #155 chain -- see the "Business process model" section's History view for how this assessment proposes closing that discoverability gap). This queue Assessment is separate from, and does not reopen, PR #151.
- The Inventory Action Log (`inventory_actions`) is a related but explicitly separate product finding (see below) -- not a dependency of, and not combined into, this assessment's scope.
- Builds on, and does not conflict with, the already-merged notification-identity fix (PR #148) -- that work fixed *which exact request* a link resolves to; this assessment is about *which requests are queryable/visible at all* to which users, a different layer of the same feature area.

## Risks

- **Any change widening `reorder_requests` visibility beyond `admin`/`dispatcher` is a Rules change (Tier 2).** A design that keeps visibility at "admin/dispatcher can see everything, scoped by query, not by Rules" avoids this, but does not, by itself, solve the "appropriate Inventory audience" language in Owner intent if that audience is meant to include non-admin/dispatcher operational roles (e.g. an actual Parts Associate signing in as themselves) -- that would require the Rules change and is an Owner decision, not assumed here.
- **`InventoryHealthPanel.jsx` is shared with Operations.jsx's read-only executive dashboard.** Any change to its empty-state text or behavior must not alter Operations.jsx's own rendering (per `docs/CLAUDE_CONTEXT.md` Rule 8, cited in that file's own comments) -- differentiating empty states by `queueFilter` most likely needs the string(s) passed in from `PartsList.jsx` (which already knows the active tab) rather than computed inside `InventoryHealthPanel.jsx` itself, since Operations.jsx's call site has no `queueFilter` concept at all.
- **A manager-oversight query change must not alter the Parts Associate's own personal Waiting/In Progress semantics.** Owner intent is explicit that a personal view "must not make assigned work disappear from manager oversight" -- the safest interpretation is *add* an oversight view, not *replace* the existing per-assignee query, so the Associate's own filtered view is unchanged.
- **The technician-assignee dead-end (§5-7) is a pre-existing defect independent of any new feature work** -- worth flagging to the Owner as a decision point regardless of which design is chosen for the rest of this assessment (e.g., should the assignment picker exclude `technician`-role employees entirely, or should Rules/nav be extended to let them see their own assignment).

## Recommended smallest safe design (for Architecture Review, not a decision)

1. **Manager oversight:** add a new, assignee-independent query for `ASSIGNED_TO_PARTS_ASSOCIATE` + `PURCHASING_IN_PROGRESS` (reusing `useReorderRequestsByStatus()`, already status-only, no new index/Rules), rendered as a new read-only "All Assigned Work" section alongside (not replacing) the existing personal Waiting/In Progress sections. No Rules change; visibility stays admin/dispatcher, matching every other queue on this page today.
2. **Show All semantics:** either (a) rename the top section's `ALL` tab to something that doesn't imply "complete catalog" (e.g. "All Tracked"), or (b) change its data source so it merges the full `PARTS_CATALOG` with `healthEntries` (parts with no ledger activity shown as "No activity yet", matching the pattern the lower Parts Catalog table already uses at `PartsList.jsx:387-388`). This is an Owner/Architecture decision with real UX trade-offs (row count, page weight) -- not decided here.
3. **Differentiated empty states:** pass an explicit `emptyText` prop into `InventoryHealthPanel.jsx` (optional, defaulting to today's string so Operations.jsx is unaffected) so `PartsList.jsx` can supply a filter-specific message per tab (e.g. "No parts are currently Critical or High priority." vs "No parts need planning right now." vs whatever Show All's new semantics require).
4. **Technician-assignee dead-end:** flag to the Owner as a required decision -- either constrain `useAssignableEmployees({ requiredOperationalRole: PARTS_ASSOCIATE })`'s eligibility to also require `role !== "technician"` (smallest fix, preserves current Rules), or treat it as a prerequisite for a broader visibility model if one is adopted.
5. **Action exposure on queue rows:** no change recommended -- current PartDetail-only action model already satisfies "without duplicating PartDetail logic" and needs no Rules/query change. If the Owner wants in-line actions later, that is a separate, larger UI decision (each action's existing eligibility conditional would need extracting into a reusable check, not copy-pasted).

None of the above have been implemented or decided -- this section exists to give Architecture Review a concrete starting point, per this assessment's own PENDING status.

## Live-page architecture finding

`PartsList.jsx` currently combines **three separate business functions on one page**, each with its own data source, audience, and purpose, without a heading or structural boundary that makes that separation legible to the person using it:

1. **Inventory Health analytics** (the top "Inventory Operational Queue" section, `healthEntries`-backed) -- a computed, ledger-derived risk signal (`recommendationStatus`/`urgency`), not a work item in itself.
2. **Reorder Work** (Parts Manager Queue, Parts Associate Waiting, Parts Associate In Progress -- all `reorder_requests`-backed) -- the actual workflow objects with status, ownership, and lifecycle actions.
3. **Parts Catalog browsing** (the lower "Parts Catalog" table, `PARTS_CATALOG`-backed) -- the complete static SKU list, independent of ledger or workflow state.

These three are conflated today in a way that directly produces the "Show All" confusion documented above (§3(b)): there are two different "show everything" experiences on one page (the top section's `queueFilter === "ALL"`, and the lower table's own category filter), and only one of them is actually the complete catalog. A user who reaches for "Show All" expecting the catalog, but lands on the top section's ledger-scoped `Show All` instead, has no structural cue that a different, truly-complete view exists further down the same page.

**Recorded recommended future information hierarchy** (not decided or implemented here -- an input to Architecture Review, consistent with the "Recommended smallest safe design" section above, expressed as page structure rather than individual fixes):

- **a. Reorder Work** -- the actual workflow: **Review** (Pending Review), **Assigned** (Ready for Parts Manager / Assigned to Parts Associate), **Purchasing** (Purchasing In Progress / Ordered), **History** (terminal: Received / Rejected / Cancelled / Voided). Each stage groups the existing `reorder_requests`-backed queues (and, per the "Business process model" section below, the new manager-oversight and History views) under one coherent lifecycle heading, rather than presenting them as unrelated sections on a flat page.
- **b. Inventory Health** -- **Critical & High** and **Needs Planning**, kept as the computed analytics/risk signal they actually are, each with an accurate count and a truthful, filter-specific empty state (per §4 and the "Recommended smallest safe design" §3 above) -- explicitly *not* relabeled or repurposed to imply it is a work queue or a catalog view.
- **c. Parts Catalog** -- the complete, searchable catalog (today's lower table), unconditionally showing every SKU regardless of ledger or workflow state.

**Show All's meaning is recorded as belonging to (c), not (b):** "Show All" should mean *the complete catalog*, matching Owner intent stated in Issue #154 ("Show All remains the complete catalog and must not be the only view where useful work can be found or actioned") -- not the ledger-active subset the top section's `Show All` tab currently returns. This resolves Open Question #2 above in the direction Owner intent already points, though the question remains formally open for Architecture Review to confirm rather than treated as decided by this note.

## Business process model

Recorded here as the target behavioral model this assessment's recommendations are meant to satisfy -- not implemented, not itself an authorization to build it:

- **"My Work" remains a personal convenience view.** The existing Parts Associate Waiting/In Progress sections (and the Notification Panel's "Assigned to You") continue to scope to the signed-in user's own `assignedToUserId` exactly as they do today -- unchanged, not broadened, not replaced.
- **"All Assigned Work" is an additional manager-oversight view, not a replacement.** A new, separate, read-only section (per "Recommended smallest safe design" §1 above) shows every request currently `ASSIGNED_TO_PARTS_ASSOCIATE` or `PURCHASING_IN_PROGRESS`, regardless of assignee -- additive to, never hiding, the personal views.
- **Oversight rows show: request identity, part, assignee, status, urgency, and age.** At minimum, each row in the "All Assigned Work" view surfaces enough to triage without opening the request: the Reorder Request's own id (or a stable reference to it), the linked part (name/SKU), the current `assignedToUserId` resolved to a display name (`resolveActorDisplayName()`, per PR #107 -- never a raw uid), `status`, `urgency` (where applicable), and an age indicator (e.g. time since `assignedAt` or `createdAt`).
- **Actions remain on `PartDetail` -- queue rows navigate, they don't act.** Consistent with "Recommended smallest safe design" §5 (no change recommended to today's PartDetail-only action model): oversight rows are `<Link>`s into `PartDetail.jsx`, exactly like every other queue row today, not a new surface duplicating approve/assign/start-purchasing/Cancel/Void eligibility logic.
- **Queue-row navigation uses the exact `requestId`.** Per the already-merged notification-identity fix (PR #148), any link built from a queue row that already has `request.id` available must carry `?requestId=<id>` so `PartDetail` resolves the exact document clicked, not a status-agnostic "most recent for this part" fallback -- the oversight view's rows are no exception to that established pattern.
- **Terminal requests remain discoverable through a History view.** `CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED` requests -- today invisible once they leave every active-status query (confirmed in §1/§5-7 above and in Issue #153's original finding) -- become findable through a dedicated History view, not by broadening any active-status queue's own filter.
- **The Inventory Action Log redesign remains separate, under Issue #152.** Not folded into this business process model or any PR proposed below -- confirmed again here per the Owner's repeated instruction.

## Proposed delivery breakdown (not implemented)

Recorded as a proposed sequencing for a future Implementation Plan -- **no PR listed here has been started, authorized, or scoped beyond this outline.** Sizing, exact file lists, and dependency order remain the Implementation Plan's own job, per `docs/ai/workflow.md`.

- **PR A -- All Assigned Work oversight, plus safe assignment eligibility.** The manager-oversight query/section from "Recommended smallest safe design" §1 (assignee-independent `ASSIGNED_TO_PARTS_ASSOCIATE`/`PURCHASING_IN_PROGRESS` view, additive to personal queues, no Rules change), together with closing the technician-assignee dead-end from §5-7/§4 of "Recommended smallest safe design" (constraining `useAssignableEmployees()` so a `technician`-role employee is never selectable as a Parts Associate assignee who then has no way to ever see the assignment).
- **PR B -- complete-catalog Show All, filter counts, and differentiated empty states.** Resolves the "Live-page architecture finding" above: Show All becomes the true complete catalog (or is relabeled, per Open Question #2 -- Architecture Review's call); `QUEUE_FILTER_OPTIONS` gains populated `count` values via `FilterBar.jsx`'s existing support; `InventoryHealthPanel.jsx`'s single hardcoded empty string is replaced with a caller-supplied, filter-specific message (guarded so `Operations.jsx`'s own call site is unaffected, per the "Risks" section above).
- **PR C -- Reorder Request History/terminal-status discovery.** The History view from the "Business process model" section above -- a new query/section surfacing `CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED` requests, closing the "terminal requests become invisible" gap confirmed in §5-7 and Issue #153's original finding.

**Explicitly deferred, not part of A/B/C:** any change broadening `reorder_requests` visibility to non-admin/dispatcher sign-in roles (an actual authenticated Parts Manager/Parts Associate role, as opposed to today's advisory `operationalRoles[]`), and any accompanying `firestore.rules` change. Per "Risks" above, that is a Tier 2 decision requiring a later, separate Owner architecture decision -- not assumed or pre-scoped into any of PR A/B/C.

## Verification requirements (for a future Implementation Plan)

Recorded as the required coverage a future Implementation Plan's browser verification (`run-field-ops-app-vite` skill, same pattern as PR #148/#151) must satisfy -- not performed by this assessment, since no code exists yet to verify:

- Manager B (a second admin/dispatcher account) can see, in the "All Assigned Work" oversight view, a Reorder Request currently assigned to user A -- without being the assignee themselves.
- User A's own personal Waiting/In Progress views remain scoped to exactly user A's own assignments, unchanged and unbroadened by the oversight view's addition.
- Every lifecycle section (Review, Assigned, Purchasing, History, Inventory Health's two filter tabs) displays an accurate count reflecting its actual current contents.
- Empty messages are verified to distinguish three genuinely different states, not one undifferentiated string: **no records exist for this section at all**, **records exist but none match the active filter**, and **no ledger history exists for this part/scope**.
- Show All is verified to contain the complete catalog, including at least one part with zero ledger activity (proving it is no longer scoped to `computeAvailableStockByPart()`'s RESERVED/RELEASED-only subset).
- Terminal requests (at least one each of `CANCELLED`, `VOIDED`, `RECEIVED`, `REJECTED` in the verification fixture) are each findable through the History view by status, by assignee, by part, and by their exact request id.
- No action control (Approve/Reject, Assign, Start Purchasing, Cancel, Void, or any future action) appears anywhere in the oversight or History views unless the signed-in account already passes `PartDetail.jsx`'s existing authorization for that exact action -- oversight/History rows are verified to be navigation-only, never a second place the same eligibility logic must be independently re-proven correct.

## Estimated PR count

**Superseded by the "Proposed delivery breakdown" section above (PR A/B/C)** -- retained here only as the earlier, coarser two-PR estimate for traceability. That breakdown folds the technician-assignee decision into PR A (rather than treating it as a variable-sized fourth item) and adds a third PR (PR C) for terminal-status/History discovery, which this earlier estimate did not yet account for. Final PR count remains the Implementation Plan's own call, not fixed by either estimate, pending Architecture Review's actual decisions.

## Related but separate product finding: Inventory Action Log

`inventory_actions` (Sprint 2.1.9, `domain/inventoryActions.js`, `domain/constants.js:178-194`) is a separate, already-shipped append-only audit collection (`RECEIVE_STOCK`/`ADJUST_STOCK`/`CORRECT_MISTAKE`) rendered on `PartDetail.jsx`. It surfaced during this investigation because it is adjacent to the same "who can see, who can act" question this assessment addresses, and because a future redesign of it could reasonably want to reuse whatever manager-oversight/visibility pattern this assessment's recommendations establish. Per the Owner's explicit instruction, it is **not** included in this assessment's scope or recommendations -- recorded here only as a pointer for a future, separate assessment.

## Open questions for Architecture Review -- RESOLVED, see Architecture Review decision above

1. **Resolved: `firestore.rules` is not widened in this initiative.** Visibility stays at the existing admin/dispatcher population; `operationalRoles[]` stays advisory-only for assignment eligibility. Broader authorization is deferred to a separate Tier-2 design coordinated with Issue #100.
2. **Resolved: Show All becomes the true complete catalog.** `PARTS_CATALOG` merged with available `healthEntries`; parts with no ledger activity show an explicit "No ledger activity" state. The now-duplicated lower Parts Catalog table must be consolidated or relocated by the future Specification, not left indefinitely as a second indistinguishable complete-catalog view.
3. **Resolved: the assignment picker is constrained.** `technician`-security-role employees are excluded from Parts Associate assignment eligibility, as an interim safety constraint (not a permanent rejection of technician + operational-role combinations) -- Issue #100 remains the broader authorization problem.
4. **Resolved: manager oversight is additional, not a replacement.** Personal Waiting/In Progress are preserved unchanged; "All Assigned Work" is a new, additive, read-only view.
