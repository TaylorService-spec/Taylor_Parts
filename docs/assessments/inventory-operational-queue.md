---
artifact_type: assessment
gate: Repository Assessment
status: Pending Review
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

**Architecture Review: PENDING.** This assessment has not yet been reviewed or approved. No implementation should begin against it until Architecture Review completes.

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
- **No counts (badge/number) are shown anywhere on any of the five queue sections today** -- only the presence/absence of rows and the section heading text.

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

- Does not touch the Cancel/Void initiative (PRs 1-6) -- confirmed no shared file requires a code change here; `PartDetail.jsx`'s Cancel/Void UI (PR 6, not yet started) is unrelated to queue visibility.
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

## Estimated PR count

Likely **two PRs**, pending Architecture Review's actual decisions: one for the manager-oversight query/section addition (#1 above, no Rules change, small and independently shippable), and one for the Show All/empty-state semantics change (#2 and #3 above, which are coupled -- both touch `InventoryHealthPanel.jsx`'s empty-state contract and `PartsList.jsx`'s top section). The technician-assignee decision (#4) is either a one-line query change (if constrained) or folds into a larger Rules-change PR (if visibility is later broadened) -- size depends entirely on which the Owner chooses, not assumed here.

## Related but separate product finding: Inventory Action Log

`inventory_actions` (Sprint 2.1.9, `domain/inventoryActions.js`, `domain/constants.js:178-194`) is a separate, already-shipped append-only audit collection (`RECEIVE_STOCK`/`ADJUST_STOCK`/`CORRECT_MISTAKE`) rendered on `PartDetail.jsx`. It surfaced during this investigation because it is adjacent to the same "who can see, who can act" question this assessment addresses, and because a future redesign of it could reasonably want to reuse whatever manager-oversight/visibility pattern this assessment's recommendations establish. Per the Owner's explicit instruction, it is **not** included in this assessment's scope or recommendations -- recorded here only as a pointer for a future, separate assessment.

## Open questions for Architecture Review

1. Should `reorder_requests` visibility ever extend beyond `admin`/`dispatcher` sign-in roles to reach an actual signed-in Parts Manager/Parts Associate (a Rules change, Tier 2), or does "appropriate Inventory audience" mean the existing admin/dispatcher population, with `operationalRoles[]` staying advisory-only for assignment eligibility?
2. Should `Show All` become the true complete catalog (merging `PARTS_CATALOG` with `healthEntries`), or should it be relabeled to accurately describe its current ledger-scoped meaning, leaving the existing separate Parts Catalog table as the one true "everything" view?
3. Should the assignment picker (`useAssignableEmployees`) be constrained to exclude `technician`-role employees from `PARTS_ASSOCIATE` eligibility, closing the visibility dead-end identified in §5-7, independent of any other decision here?
4. Confirm: manager oversight should be an *additional* read-only section, not a replacement of the existing personal Waiting/In Progress views (per Owner intent's explicit "must not make assigned work disappear" framing) -- is that reading correct?
