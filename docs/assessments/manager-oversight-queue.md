---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 153
target_release: Not yet scheduled
---

# Assessment Report: Manager oversight queue -- locating existing requests, and empty operational-queue filters

**Business Request:** Issue #153. Two related gaps in Inventory's admin/dispatcher-facing views, surfaced during PR #151's (Cancel/Void UI) post-merge production smoke check:
1. No way to locate an existing Reorder Request by assignee or by terminal status, independent of the signed-in user's own Notification Panel.
2. The Inventory workspace's own "Needs Reorder" queue filters (**Needs Planning**, **Critical & High**) repeatedly showed no items in production, with **Show All** the only filter consistently showing rows.

This is a read-only investigation. **No application code, Firestore Rules, deployment, or production-data change was made while producing this assessment.** No fix is proposed or authorized here.

## Scope of this assessment

Investigated: `PartsList.jsx` (both its Reorder Request status queues and its separate "Needs Reorder" queue), `hooks/useReorderRequests.js`'s query hooks, `NotificationPanel.jsx`, `domain/inventoryAnalyticsEngine.ts`, `hooks/useInventoryLedger.js`, `shared/ui/FilterBar.jsx`, `shared/ui/LoadingEmptyState.jsx`, and `modules/operations/panels/InventoryHealthPanel.jsx`.

Explicitly not investigated here: any fix design, the Inventory Action Log's own placement question (tracked separately as Issue #152), or anything in the Cancel/Void or notification-identity initiatives themselves (both already merged, both correctly out of scope per prior Owner instruction).

## Current repository state

### 1. Finding 1 -- no assignee- or terminal-status-scoped view exists

`PartsList.jsx` renders four request-oriented views, each backed by a query hook in `hooks/useReorderRequests.js`:

| View | Hook | Scope |
|---|---|---|
| Parts Manager Queue | `useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)` | One exact status, every assignee |
| Parts Associate Waiting | `useReorderRequestsAssignedTo(user.uid, ASSIGNED_TO_PARTS_ASSOCIATE)` | One exact status, **signed-in user only** |
| Parts Associate In Progress | `useReorderRequestsAssignedTo(user.uid, PURCHASING_IN_PROGRESS)` | One exact status, **signed-in user only** |
| Notification Panel ("Assigned to You") | Same `useReorderRequestsAssignedTo(user.uid, ...)` hooks | Same signed-in-user restriction |

`useReorderRequestsAssignedTo()` (`hooks/useReorderRequests.js`) takes a `userId` parameter, but every call site in the codebase passes `user?.uid` (the signed-in user's own id) -- there is no call site, screen, or hook parameter anywhere that lets one user query another user's assignments. Confirmed by grep: `useReorderRequestsAssignedTo` has exactly these same-signed-in-user call sites, no others.

**No view queries by terminal status at all** (`CANCELLED`, `VOIDED`, `RECEIVED`, `REJECTED`) -- every existing query hook targets exactly one active, non-terminal status. Once a request leaves its active status, it structurally cannot appear in any of the four views above, and the only way to reach it again is `PartDetail.jsx`'s own `partId`-based lookup (bookmarked/typed URL, or the notification-identity fix's `?requestId=` param if the original notification link is still available) -- neither of which helps a user who doesn't already know the specific part or request.

**Net effect, confirmed by code inspection (not just the Owner's report):** there is no code path today, for any admin/dispatcher, to answer "show me every Reorder Request currently assigned to person X" (other than X themselves) or "show me every Cancelled/Voided/Received request." This matches Issue #153's report exactly.

### 2. Finding 2 -- why the Needs Reorder queue's filters showed no items

The Inventory workspace's "Needs Reorder" queue (`PartsList.jsx:201-215`, `QUEUE_FILTER_OPTIONS` at `:106-110`) is a **separate table from the Parts Catalog table further down the same page** (`:354-361`) -- both happen to have a filter tab, but they are unrelated data sources with unrelated filter semantics. This assessment concerns the Needs Reorder queue only; the Parts Catalog table's own "All Categories" filter is unaffected and was not the source of the Owner's observation.

**What determines whether a part appears in the Needs Reorder queue at all:**
```js
// hooks/useInventoryLedger.js
const availableByPart = computeAvailableStockByPart(transactions);
const stockSnapshots = [...availableByPart.entries()].map(...);
const healthEntries = generateInventoryHealthDashboard(transactions, stockSnapshots);
```
`computeAvailableStockByPart()` only produces an entry for a `partId` that has **at least one `inventory_transactions` document** (any type -- `RESERVED`, `CONSUMED`, or `RELEASED`). A catalog part with zero logged ledger activity ever does not appear in `healthEntries` at all, under **any** of the three queue filter tabs, including "Show All." (This is a pre-existing, documented design choice -- `InventoryHealthPanel.jsx`'s own comment: "Only shows parts with at least one ledger transaction ... so this doesn't become a 200-row wall of untouched catalog parts.")

**What determines which filter tab a part (that does have ledger activity) falls into:**
```js
// PartsList.jsx:142-148
const queueEntries = useMemo(() => {
  if (queueFilter === "ALL") return healthEntries;
  if (queueFilter === "NEEDS_PLANNING") {
    return healthEntries.filter((entry) => entry.recommendation.recommendationStatus === "NEEDS_PLANNING");
  }
  return healthEntries.filter((entry) => ACTIONABLE_URGENCIES.has(entry.recommendation.urgency)); // CRITICAL or HIGH
}, [healthEntries, queueFilter]);
```
- **Needs Planning**: only parts with `recommendationStatus === "NEEDS_PLANNING"` -- which `domain/inventoryAnalyticsEngine.ts`'s `hasUsageHistory()` sets whenever a part has **zero `CONSUMED` transactions in the trailing 30 days** (`totalConsumed > 0` is the only condition). A part with `RESERVED`-only activity, or `CONSUMED` activity older than 30 days, lands here.
- **Critical & High**: only parts whose computed `urgency` is `CRITICAL` or `HIGH` -- a part with real, recent consumption but a comfortable stock position relative to its computed reorder point lands in `MEDIUM`/`LOW` instead, and is excluded from this tab (but still counted in "Show All").
- **Show All**: every entry in `healthEntries`, unfiltered by `recommendationStatus`/`urgency`.

**Mechanically, this explains the Owner's exact observation without requiring a code defect:** if production's currently-active parts (the ones with any ledger activity at all) happen to all have recent consumption **and** a comfortable stock position (i.e., `LOW`/`MEDIUM` urgency, not `CRITICAL`/`HIGH`, and not lacking usage history), then **both** "Needs Planning" and "Critical & High" would correctly show zero rows at this moment, while "Show All" (which applies no `recommendationStatus`/`urgency` filter) would still show every one of them. This is consistent with this repository's own prior, independently-documented finding on this exact analytics engine (`SKILL.md`'s Gotchas: "Seeded 'high consumption' didn't reliably land a part in CRITICAL/HIGH ... TST-1002's seeded usage came out LOW urgency in practice"). **Whether this is what's actually happening in production, versus a genuine filtering defect, is not resolved by this assessment** -- it requires reading live production `inventory_transactions`/`reorder_requests` data, which this environment has no credentials for (this project's standing, repeatedly-established boundary -- see `docs/DECISIONS.md` entries #9/#10/#17/#20). **The Owner (or someone with production Firestore read access) would need to confirm which case applies.**

### 3. A confirmed, concrete defect: the empty-queue message doesn't distinguish "zero matches for this filter" from "zero ledger activity at all"

```jsx
// InventoryHealthPanel.jsx:61-62
{sorted.length === 0 ? (
  <p className="fo-muted">No ledger activity yet -- nothing to forecast.</p>
) : ( ... )}
```

This exact message renders whenever the **filtered** `healthEntries` passed in (`queueEntries`, already narrowed by the active tab) is empty -- regardless of whether zero parts platform-wide have any ledger activity, or plenty of parts have ledger activity but none happen to match the *currently selected* filter. A user on the "Needs Planning" tab seeing "No ledger activity yet" has no way to tell, from that message alone, whether they should try "Show All" (activity exists, just not in this bucket) or whether the queue is genuinely, platform-wide, empty. **This is confirmed by direct code inspection, not inferred from the Owner's report** -- `PartsList.jsx:207` passes the wrapping `LoadingEmptyState` a hardcoded `isEmpty={false}` regardless of `queueEntries.length`, meaning `InventoryHealthPanel` is the only place this empty case is actually handled, and it handles it with one undifferentiated message for every possible cause.

### 4. Filter tabs display no counts, though the shared component already supports them

```jsx
// FilterBar.jsx:29
{option.label}
{option.count !== undefined ? ` (${option.count})` : ""}
```
`FilterBar` already renders a `(N)` suffix when an option carries a `count` field. `PartsList.jsx`'s `QUEUE_FILTER_OPTIONS` (`:106-110`) is a static array that never populates `count` for any of its three options -- so a user cannot tell, without clicking each tab, whether "Needs Planning" has 0 matches or simply hasn't been checked yet. The underlying capability already exists in the shared component; only the call site's wiring is missing.

## Affected files

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/hooks/useReorderRequests.js` | `useReorderRequestsAssignedTo()` -- every assignee-scoped query | Structurally single-user-only; no call site or parameter exists for "someone else's assignments" |
| `field-ops-app-vite/src/modules/inventory/PartsList.jsx` | Renders all four Reorder Request views plus the Needs Reorder queue and its filter tabs | Owns `QUEUE_FILTER_OPTIONS` (no counts wired), and the `isEmpty={false}` hardcode that defers all empty-state handling to `InventoryHealthPanel` |
| `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` | Shared renderer for both Operations' Inventory Health panel and PartsList's Needs Reorder queue | Owns the single undifferentiated "No ledger activity yet" empty message (`:61-62`) |
| `field-ops-app-vite/src/shared/ui/FilterBar.jsx` | Shared filter-tab renderer | Already supports per-option counts; unused by `QUEUE_FILTER_OPTIONS` |
| `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` | `hasUsageHistory()`/`generateReplenishmentRecommendation()` | Defines exactly which parts land in `NEEDS_PLANNING` vs. `READY`+urgency -- the mechanical root of Finding 2 |
| `field-ops-app-vite/src/shared/ui/NotificationPanel.jsx` | "Assigned to You" section | Same single-user scoping as the queues above -- not a manager-oversight view |

## Dependencies

- Does not touch `firestore.rules` -- every relevant read (`reorder_requests`, `inventory_transactions`) is already unconditionally admin/dispatcher-readable; a broader query shape (e.g. removing the `assignedToUserId` filter, or adding a terminal-status query) needs no Rules change to become possible.
- Independent of the Cancel/Void initiative (PR #151, merged) and the notification-identity fix (PR #148, merged) -- neither implements or depends on this scope, confirmed by this investigation finding no code overlap.
- Independent of Issue #152 (Inventory Action Log placement) -- different card, different question, tracked separately per the Owner's instruction.

## Risks (of a future fix, not evaluated further here)

- **Broadening `useReorderRequestsAssignedTo()` or adding a new "all assignments" query** needs to preserve the existing per-user views unchanged (Parts Associate's own "Waiting"/"In Progress" tables, and the Notification Panel's "Assigned to You" section all currently rely on the single-user scoping being exactly what it is today).
- **A new terminal-status/all-requests view** would be a genuinely new screen or table, not a small tweak to an existing hook -- sizing that is a Specification-stage question, not decided here.
- **Distinguishing "zero matches" from "zero data" in the empty message** is a small, low-risk UI change in one place (`InventoryHealthPanel.jsx`), but needs a caller-supplied signal (e.g. "was the *unfiltered* `healthEntries` also empty") that the component doesn't currently receive -- a plumbing question, not a design one.
- **Root-causing Finding 2's actual production state** (data characteristic vs. defect) cannot be completed by this environment -- requires production Firestore read access this project's standing policy keeps out of Claude Code's hands. Blocks confirming whether Finding 2 needs a code fix at all, versus only the empty-state/counts improvements in Findings 3-4.

## Implementation options

Not decided here, listed only to frame the eventual Specification-stage discussion, consistent with the desired design direction the Owner already specified in Issue #153 (visibility separated from authorization; managers retain oversight after assignment; personal queues surface "my work" without hiding it from managers; only authorized users get action controls; accurate counts and explanatory empty states; Show All/Parts Catalog remains a browse view, not the only usable operational view):

- **A.** A new admin/dispatcher-facing "All Reorder Requests" view (any status including terminal, any assignee), separate from the existing per-status/per-assignee queues, which stay as convenience views.
- **B.** Extend the existing queue tables with optional assignee/status filters, rather than a wholly new screen.
- **C.** For Findings 3-4 specifically (independent of A/B): thread an "unfiltered count" into `InventoryHealthPanel`'s empty-state message, and populate `count` on `QUEUE_FILTER_OPTIONS`'s three options from the corresponding unfiltered/filtered `healthEntries` lengths.

## Estimated PR count

Not estimated here -- this Assessment intentionally covers two related but separable findings (assignee/terminal-status visibility, and queue-filter empty-state clarity) whose eventual PR count depends on which implementation option(s) a future Specification adopts. Per `docs/ai/workflow.md`, that sizing decision belongs to the Specification stage, not this Assessment.

## Open questions for Architecture Review

1. Is a new "All Reorder Requests" view (Option A) the right shape, or should oversight be folded into the existing queue tables (Option B)?
2. Should Finding 2's actual production root cause (data characteristic vs. defect) be confirmed by the Owner before any fix is scoped, given this environment cannot read production data itself?
3. Are Findings 3-4 (empty-state clarity, filter counts) worth a small, independent fix regardless of how Finding 1/2's larger oversight-view question is resolved, since they're low-risk and already isolated to two files (`InventoryHealthPanel.jsx`, `PartsList.jsx`)?
4. Does this initiative depend on, or block, any other open work? None identified during this investigation.
