---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: 146
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Assessment Report: Notification Panel links by `partId` instead of `reorderRequestId`

**Business Request:** Issue #145. `NotificationPanel` links every Reorder Request notification using `partId`, while `PartDetail` selects the newest `reorder_requests` document for that part with no status filter. Because a part can have more than one Reorder Request over time, clicking an active notification can open a different request than the one that produced it, including a terminal (`REJECTED`/`CANCELLED`/`VOIDED`) one.

## Scope of this assessment

Investigated: `NotificationPanel.jsx`, `PartsList.jsx`'s three equivalent notification/queue links, `hooks/useReorderRequests.js` (all four query hooks), `PartDetail.jsx`'s request-selection call site, `App.jsx`'s route table, and every notification section's underlying Firestore query.

Explicitly **not** investigated or addressed here, per the Owner's instruction: the manager oversight queue defect. That is a separate, already-identified issue, kept out of this assessment and not solved or combined with it.

No application code, Firestore Rules, deployment, or production-data change was made while producing this assessment -- read-only investigation only.

## Current repository state

### 1. Where notification records obtain and retain identity

Every notification-list hook in `hooks/useReorderRequests.js` builds its result set via `toDocs()`:

```js
// hooks/useReorderRequests.js:40-42
function toDocs(snap) {
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
```

This is the full Firestore document, including its own document ID (`id` -- the exact `reorderRequestId`) alongside every field (`partId`, `status`, etc.). All four Notification Panel sections (Pending Review, Ready for Parts Manager, Assigned to You, Purchasing Started) are built from this same function via `useReorderRequestsByStatus()` (`:69-90`) and `useReorderRequestsAssignedTo()` (`:106-127`). `NotificationPanel.jsx` already uses `request.id` today -- as the React list `key` (lines 79, 87, 95, 103) -- but never in the navigation target.

### 2. Whether every relevant notification can carry the exact `reorderRequestId`

Yes, unconditionally. Every notification object already has `.id` populated by `toDocs()` before it ever reaches `NotificationPanel.jsx` -- there is no notification type or code path where the id is missing, deferred, or would need a schema/query change to obtain. This is a pure navigation-layer gap, not a data-availability gap.

### 3. Every navigation path currently using `partId` instead of request identity

- `NotificationPanel.jsx:38-39` -- the single `NotificationItem` component every one of the four sections renders through:
  ```jsx
  <Link to={`/inventory/${request.partId}`} ...>
  ```
- `PartsList.jsx:240, 284, 326` -- three equivalent `<Link to={`/inventory/${request.partId}`}>` calls in that module's own queue-item rendering (Parts Manager Queue / Parts Associate Waiting / Parts Associate In Progress). Each `request` here comes from the same `useReorderRequestsByStatus()`/`useReorderRequestsAssignedTo()` hooks, so `request.id` is equally available and equally unused there.
- `PartsList.jsx:381` is a separate, unrelated `<Link to={`/inventory/${part.sku}`}>` for a plain catalog row (no Reorder Request involved) -- not in scope.
- Route table: `App.jsx:178` -- `<Route path=":partId" element={<PartDetail />} />`. There is no `:requestId` (or equivalent) route segment anywhere in the app today for any of the above links to target even if they wanted to.

### 4. How `PartDetail` selects a request when multiple requests share a `partId`

`PartDetail.jsx` calls `useReorderRequestForPart(partId)` (from `useParams()`, route-supplied) with no other identity available. That hook:

```js
// hooks/useReorderRequests.js:142-163
export function useReorderRequestForPart(partId) {
  ...
  const q = query(reorderRequestsRef, where("partId", "==", partId));
  const unsubscribe = onSnapshot(q, (snap) => {
    const forPart = toDocs(snap).sort((a, b) => b.createdAt - a.createdAt);
    setState({ data: forPart[0] ?? null, loading: false });
  }, ...);
  ...
}
```

queries **every** `reorder_requests` document for that `partId`, with **no `status` filter of any kind**, sorts client-side by `createdAt` descending, and returns index 0. This hook has no parameter or code path to accept a specific request id -- it cannot currently be pointed at "the request the user actually clicked," only "whichever request for this part happens to be newest by creation time," regardless of that request's status.

### 5. How active notification queries treat `REJECTED`/`CANCELLED`/`VOIDED`/other terminal states

Each of the four notification queries uses a single exact `where("status", "==", <one status>)` match (`PENDING_REVIEW`, `READY_FOR_PARTS_MANAGER`, `ASSIGNED_TO_PARTS_ASSOCIATE`+uid, `PURCHASING_IN_PROGRESS`). Terminal statuses are excluded from every section as a side effect of that exact-match filter, not by any explicit terminal-state logic -- there is nothing to change on the notification-query side.

The defect is entirely on the `PartDetail`/`useReorderRequestForPart` side: because that hook has no status filter at all, a `REJECTED`, `CANCELLED`, or `VOIDED` request for the same part -- if it happens to have a newer `createdAt` than the request the user actually clicked from an active notification -- wins the "most recent" sort and is what actually renders. This is precisely the reported defect scenario.

### 6. Preserving the approval -> Ready-for-Parts-Manager transition

`reviewReorderRequest()` (`domain/inventoryReorderRequests.js:165-184`) updates the **same document** in place (`reorderRequestsStore.update(requestId, { status: READY_FOR_PARTS_MANAGER, ... })`) -- there is no separate "remove old / create new" notification record. Because both notification queries are live (`onSnapshot`) exact-status matches, the request naturally drops out of the `PENDING_REVIEW` query's result set and naturally appears in the `READY_FOR_PARTS_MANAGER` query's result set the instant Firestore pushes the updated document. The document's `id` is stable across this transition (it never changes) -- confirming that a `reorderRequestId`-based navigation fix would remain correct across the whole lifecycle a `partId`-based one cannot guarantee, and confirming this existing behavior needs no change to be preserved.

## Affected files

| File | Current role | Why it's affected |
|---|---|---|
| `field-ops-app-vite/src/shared/ui/NotificationPanel.jsx` | Renders all four notification sections via one shared `NotificationItem` | Its `Link to=` (lines 38-39) is the primary defect site |
| `field-ops-app-vite/src/modules/inventory/PartsList.jsx` | Renders the Parts Manager Queue / Parts Associate Waiting / In Progress queue items | Three equivalent `partId`-only links (lines 240, 284, 326), same defect pattern |
| `field-ops-app-vite/src/hooks/useReorderRequests.js` | `useReorderRequestForPart()` -- `PartDetail`'s request-selection hook | Has no status filter and no way to accept an explicit request id -- the actual resolution-ambiguity site |
| `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` | Renders whichever request `useReorderRequestForPart()` resolves | Consumes the ambiguous result; itself unaware of which notification (if any) the user actually clicked |
| `field-ops-app-vite/src/App.jsx` | Route table | No `:requestId` (or equivalent) route/param exists today for a fix to target |

## Dependencies

- Does not touch `firestore.rules` -- `reorder_requests`' read rule (`allow read: if isAdminOrDispatcher();`) is unconditional on document fields or query shape; any additional query-by-id or route-param plumbing needs no Rules change.
- Does not depend on, and is independent of, the still-not-started Cancel/Void UI (PR 6) -- though PR 6's forthcoming `ReorderRequestCancelled`/`ReorderRequestVoided` read-only cards will render on `PartDetail` and are exactly the kind of terminal-state content a misrouted notification click could currently land a user on unexpectedly. Fixing navigation identity first is a clean precondition for PR 6, not a blocker on it.
- Does not depend on the Customer Record Page initiative, the Parts and Purchase Order Assignment Adoption initiative, or Issue #140 (unrelated topic, confirmed).
- Explicitly separate from, and does not touch, the manager oversight queue defect (out of scope per the Owner's instruction).

## Risks

- **Route/URL shape change risk.** Any fix that changes the URL structure (e.g. adding a route segment) needs to preserve today's plain `/inventory/:partId` direct-navigation behavior (bookmarks, `PartsList`'s own catalog-row links at `PartsList.jsx:381`, and any other caller not going through a notification) -- those callers have no request id to supply and must keep working via the existing "most recent" fallback.
- **Fallback ambiguity is not fully eliminated, only bypassed.** When no explicit request id is available (a bare `/inventory/:partId` visit), `useReorderRequestForPart()`'s status-agnostic "most recent" selection remains inherently ambiguous by design -- fixing the notification-originated path (this issue's actual scope) does not, by itself, make the no-id fallback path resolve to a "correct" request in some deeper sense, since there may genuinely be no single correct answer without an explicit id. Whether to also narrow that fallback (e.g. prefer non-terminal statuses when no id is given) is a real but separate design question for the Specification stage, not assumed here.
- **Four call sites, one shared component.** `NotificationPanel.jsx`'s `NotificationItem` is reused by all four sections -- a fix there is naturally uniform across Pending Review/Ready for Parts Manager/Assigned to You/Purchasing Started, lowering the risk of an inconsistent fix across sections. `PartsList.jsx`'s three call sites are separate and must each be updated for the fix to be complete.
- **No data migration risk.** Every existing/historical `reorder_requests` document already has a stable Firestore document id -- there is no legacy document missing the identity a fix would need; this is purely a client-side navigation/routing change.

## Implementation options

All three preserve `useReorderRequestForPart()`'s current partId-only/most-recent behavior as the fallback for any caller that has no explicit request id (direct URL visits, bookmarks, `PartsList.jsx:381`'s unrelated catalog-row link) -- they differ only in how a request id reaches `PartDetail` when one *is* known (i.e., every notification/queue click).

- **Option A -- query string param** (e.g. `/inventory/:partId?requestId=<id>`). No route-table change. `PartDetail` reads `requestId` via `useSearchParams()` if present and passes it to an updated `useReorderRequestForPart(partId, requestId)`, which does a targeted `getDoc`/`onSnapshot` by id when supplied, falling back to today's query when not. Preserves every existing plain-`partId` URL unchanged. Bookmarkable and shareable.
- **Option B -- new route segment** (e.g. `/inventory/:partId/reorder/:requestId`, with the existing `:partId`-only route kept as a second, fallback route to the same element). More explicit/RESTful, but adds a second route definition to maintain and a small amount of route-matching complexity in `App.jsx`.
- **Option C -- React Router `location.state`** (`<Link to={...} state={{ requestId: request.id }}>`, read via `useLocation().state?.requestId` in `PartDetail`). No URL change at all -- smallest possible diff. Trade-off: the id is lost on a hard refresh or if the link is opened in a new tab/copied, silently falling back to the ambiguous "most recent" behavior in those cases without any visible difference to the user.

**Recommendation:** Option A. It is bookmarkable/shareable (unlike C), requires no new route definition (unlike B), and cleanly preserves every existing plain-`partId` caller's behavior with a single, optional, purely-additive query parameter. This is a recommendation, not a decision -- Architecture Review should confirm or select an alternative.

## Estimated PR count

**One PR**, per `docs/ai/workflow.md`'s "one architectural concern per PR" guidance -- this is a single, cohesive navigation/identity concern spanning a small, bounded set of files (`NotificationPanel.jsx`, `PartsList.jsx`'s three call sites, `useReorderRequestForPart()`, `PartDetail.jsx`'s call site, and `App.jsx` only if Option B is selected). No Rules change, no schema change, no new collection -- there is no natural expand/contract or dependency boundary that would require splitting this into more than one PR.

## Open questions for Architecture Review

1. Confirm or select among Options A/B/C above (recommendation: A).
2. Should the no-explicit-id fallback path (`useReorderRequestForPart()` called with only a `partId`, no `requestId`) also be narrowed to prefer non-terminal statuses, or left exactly as-is (status-agnostic, most-recent-by-`createdAt`)? This assessment surfaces the question but does not decide it -- it's a real behavior change beyond the reported defect's own scope if adopted.
3. Confirm the "smallest safe correction" boundary: this assessment's recommendation is navigation-identity only (pass and prefer an explicit `reorderRequestId` when available) -- confirm that is the intended scope, and that any fallback-narrowing from question 2 above, if wanted, is either included in the same Specification explicitly or deliberately deferred as its own follow-up.
4. Required automated/browser coverage for Specification: at minimum, (a) a unit/integration-level test seeding two `reorder_requests` documents for one `partId` (one active, one terminal, terminal with the later `createdAt`) and confirming a notification click for the active one resolves to that same document, not the terminal one; (b) a browser/manual pass confirming all four Notification Panel sections and all three `PartsList.jsx` queue sections navigate correctly under this scenario; (c) confirming the no-id fallback path (direct `/inventory/:partId` visit) is unchanged from today's behavior unless question 2 is answered otherwise.
