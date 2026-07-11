---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-11
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/notification-identity.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 146
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Sprint Specification: Notification/Queue Links Resolve by `reorderRequestId`, Not `partId`

**Architecture Review:** `docs/assessments/notification-identity.md`'s "Architecture Review" section -- Approved 2026-07-11 (Option A: optional `requestId` query parameter, validated against the route's `partId`, fail-safe on mismatch; existing no-id fallback preserved unchanged).

## Executive summary

Every Notification Panel section and `PartsList.jsx`'s three reorder-queue links currently navigate to `/inventory/:partId` using only the part's ID. `PartDetail`'s request-selection hook has no status filter and resolves to whichever `reorder_requests` document for that part has the newest `createdAt` -- so a click on a live notification can land on an unrelated, newer, possibly terminal (`REJECTED`/`CANCELLED`/`VOIDED`) request for the same part instead of the one that produced the notification. This sprint adds an optional `requestId` query parameter that every notification/queue link already has the data to supply (`request.id` is already present on every notification object, currently used only as a React list key), resolves the exact document by ID when present, validates it against the route's `partId`, and fails safely (a visible message, not a silent wrong-document render) if the ID is missing or mismatched. The existing `/inventory/:partId`-only, most-recent-by-`createdAt` fallback is preserved unchanged for every caller with no `requestId` (bookmarks, direct URLs, `PartsList.jsx:381`'s unrelated catalog-row link).

## Sprint objective

Clicking any Reorder Request notification or queue item always opens the exact request that produced it -- never a different, newer, or terminal request for the same part -- while every existing plain-`/inventory/:partId` caller keeps working exactly as it does today.

## Scope

- `field-ops-app-vite/src/hooks/useReorderRequests.js`'s `useReorderRequestForPart()`: gains an optional second parameter, `requestId`. When supplied, subscribes to the exact document by ID (`doc(db, REORDER_REQUESTS_COLLECTION, requestId)` + `onSnapshot`) instead of the `where("partId", "==", partId)` query. Validates the resolved document's own `partId` field equals the `partId` this hook was called with; surfaces a distinct error state (not a silent fallback) if the document doesn't exist or its `partId` doesn't match. When `requestId` is omitted (or empty/undefined), behavior is **byte-for-byte unchanged** from today: the existing `where("partId", "==", partId)` query, sorted by `createdAt` descending, most recent wins, no status filter.
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx`: reads `requestId` from the URL query string (`useSearchParams()`), passes it to the updated hook, and renders a clear, distinct message when the hook's error state is set (request not found for this part id, or malformed/foreign id) -- using this codebase's existing `LoadingEmptyState` component (`shared/ui/LoadingEmptyState.jsx`), the same pattern already used elsewhere on this page, not a new one-off UI element.
- `field-ops-app-vite/src/shared/ui/NotificationPanel.jsx`: `NotificationItem`'s single `Link to=` (used by all four sections -- Pending Review, Ready for Parts Manager, Assigned to You, Purchasing Started) gains `?requestId=${request.id}`.
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx`: the three equivalent `Link to=` call sites (Parts Manager Queue, Parts Associate Waiting, Parts Associate In Progress -- lines 240/284/326 as of this Specification) each gain the same `?requestId=${request.id}`.

## Explicitly out of scope

- **`PartsList.jsx:381`'s catalog-row link** (`/inventory/${part.sku}`) -- not a Reorder Request notification/queue link, no `request.id` exists in that context, untouched.
- **Narrowing the no-`requestId` fallback** to prefer non-terminal statuses -- Architecture Review explicitly did not adopt this; the fallback stays exactly as it behaves today, status-agnostic, most-recent-by-`createdAt`.
- **Any route-table change.** `App.jsx`'s `:partId`-only route is unchanged -- this sprint uses a query parameter, not a new path segment (Option A, not B).
- **Any `firestore.rules` change.** `reorder_requests`' `allow read: if isAdminOrDispatcher();` is unconditional on document fields or query shape (`get` vs `list`) -- a single-document `get`/`onSnapshot` by ID needs no Rules change.
- **Issue #140** (unrelated topic, confirmed in the Assessment) and **the manager oversight queue defect** -- both explicitly out of scope, not solved or combined here.
- **The Cancel/Void UI (PR 6)** -- unrelated, separate initiative; this sprint's fix is a clean precondition for it (a future terminal-state read-only card on `PartDetail` benefits from correct navigation identity) but does not implement or depend on any of its own scope.
- **No production data changes, no backfill, no migration.** Every existing `reorder_requests` document already has a stable Firestore document ID -- there is nothing to migrate.

## Technical design

### `useReorderRequestForPart(partId, requestId)` -- updated signature

```js
// Illustrative shape, not final implementation code.
export function useReorderRequestForPart(partId, requestId) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    if (requestId) {
      // Exact-document resolution path (Option A). Validates partId
      // agreement -- does NOT silently fall back to the most-recent
      // query on mismatch; that would defeat the entire point of this
      // sprint.
      const ref = doc(db, REORDER_REQUESTS_COLLECTION, requestId);
      const unsubscribe = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists()) {
            setState({ data: null, loading: false, error: "not_found" });
            return;
          }
          const data = { id: snap.id, ...snap.data() };
          if (data.partId !== partId) {
            setState({ data: null, loading: false, error: "mismatch" });
            return;
          }
          setState({ data, loading: false, error: null });
        },
        () => setState({ data: null, loading: false, error: "not_found" })
      );
      return unsubscribe;
    }

    // Unchanged from today -- no requestId supplied.
    const q = query(reorderRequestsRef, where("partId", "==", partId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const forPart = toDocs(snap).sort((a, b) => b.createdAt - a.createdAt);
        setState({ data: forPart[0] ?? null, loading: false, error: null });
      },
      () => setState({ data: null, loading: false, error: null })
    );
    return unsubscribe;
  }, [partId, requestId]);

  const refresh = useCallback(() => {}, []);
  return { ...state, refresh };
}
```

`error` is a new field on the returned state -- `null` in every case that behaves as today (including the entire no-`requestId` path, so existing callers that don't destructure `error` are unaffected). `"not_found"` and `"mismatch"` are the two fail-safe cases; `PartDetail.jsx` is the only caller that needs to branch on it.

### `PartDetail.jsx`

```js
// Illustrative -- exact hook names per this file's existing imports.
const [searchParams] = useSearchParams();
const requestId = searchParams.get("requestId") || undefined;
const { data: reorderRequest, loading: reorderRequestLoading, error: reorderRequestError } =
  useReorderRequestForPart(partId, requestId);
```

When `reorderRequestError` is set, the existing Reorder Request card area renders `LoadingEmptyState`'s empty state instead of any status-specific card, with copy distinguishing the two cases plainly (e.g. "This reorder request could not be found." for `not_found`; "This reorder request does not belong to this part." for `mismatch`) -- the rest of `PartDetail` (Catalog card, Stock Position, Recent Transactions) renders normally regardless, since the error is scoped to the Reorder-Request-by-id resolution only, not the whole page.

### `NotificationPanel.jsx`

```jsx
// NotificationItem, all four sections route through this one component.
<Link
  to={`/inventory/${request.partId}?requestId=${request.id}`}
  ...
```

### `PartsList.jsx`

The same `?requestId=${request.id}` suffix added to each of the three existing `Link to={`/inventory/${request.partId}`}` call sites (Parts Manager Queue, Parts Associate Waiting, Parts Associate In Progress). `PartsList.jsx:381`'s unrelated catalog-row link is untouched.

## Firestore Rules impact

**None.** `reorder_requests`' `allow read: if isAdminOrDispatcher();` (unconditional on document fields or query shape) already permits a single-document `get`/`onSnapshot` by ID exactly as it permits the existing `where()` query -- no Rules change, no Rules-focused Final Review needed for this sprint, no Owner Deployment Authorization gate applies.

## UI impact

- Clicking any Notification Panel item, or any `PartsList.jsx` queue item, now opens the exact request that produced it, every time -- including when a newer or terminal request exists for the same part.
- Visiting `/inventory/:partId` directly (no `requestId`) behaves exactly as it does today -- no visible change.
- The new failure case (a `requestId` that doesn't exist, or exists but belongs to a different part -- e.g. a stale link, a manually-edited URL, or a request deleted... though this collection is append-only/never deleted, so in practice this is reachable only via a malformed or foreign `requestId`) shows a clear, distinct empty-state message instead of silently rendering an unrelated request.

## Testing strategy

- **Unit/integration-level** (this repo's existing hook-testing conventions, or a lightweight Rules-emulator-adjacent script if no hook test harness exists yet -- confirmed during implementation): seed two `reorder_requests` documents for one `partId` -- one active (e.g. `PENDING_REVIEW`), one terminal (`CANCELLED`) with a **later** `createdAt` than the active one. Confirm `useReorderRequestForPart(partId, activeRequestId)` resolves to the active document, not the terminal one (proving the defect is actually fixed, not just no-longer-reproducible by coincidence of test data ordering).
- **No-`requestId` fallback regression**: same two-document fixture, call `useReorderRequestForPart(partId)` with no second argument, confirm it still returns the terminal (newer) document -- proving the fallback path is genuinely unchanged, not accidentally also filtered.
- **Mismatch fail-safe**: call `useReorderRequestForPart(partId, someOtherPartsRequestId)`, confirm `error: "mismatch"` and `data: null` -- not a silent wrong-document render.
- **Not-found fail-safe**: call with a `requestId` that doesn't exist, confirm `error: "not_found"` and `data: null`.
- **Browser/manual pass** (this repo's `run-field-ops-app-vite` skill): click through all four Notification Panel sections and all three `PartsList.jsx` queue sections against a seeded multiple-requests-per-part scenario, confirm each lands on its own correct request. Separately, confirm a direct `/inventory/:partId` visit (no query param) is visually and behaviorally unchanged. Separately, confirm refresh/bookmark persistence: open a notification link, hard-refresh the browser, confirm the same request still renders (proving the query-param approach survives a refresh, the reason Option A was chosen over Option C).

## Rollback strategy

Frontend-only change, no Rules, no schema, no production data -- fully and immediately reversible by reverting the PR and redeploying (this app's existing frontend-only auto-deploy-at-merge posture, per `docs/Deployment.md`). No irreversible step at any point in this sprint.

## Acceptance criteria

- [ ] `useReorderRequestForPart()` accepts an optional `requestId` second parameter; omitting it (or passing a falsy value) produces byte-for-byte the same behavior as today.
- [ ] When `requestId` is supplied and resolves to a document whose `partId` matches the route, that exact document is returned.
- [ ] When `requestId` is supplied but the document doesn't exist, `error: "not_found"` is returned, no document is rendered as if it were correct.
- [ ] When `requestId` is supplied but the document's `partId` doesn't match the route's `partId`, `error: "mismatch"` is returned, no document is rendered as if it were correct.
- [ ] All four `NotificationPanel.jsx` sections' links include `?requestId=${request.id}`.
- [ ] All three `PartsList.jsx` queue links (Parts Manager Queue, Parts Associate Waiting, Parts Associate In Progress) include `?requestId=${request.id}`.
- [ ] `PartsList.jsx:381`'s catalog-row link is unchanged.
- [ ] `PartDetail.jsx` renders a distinct, clear empty state on `error`, without breaking the rest of the page (Catalog/Stock Position/Recent Transactions cards still render).
- [ ] A hard refresh on a `?requestId=`-bearing URL still resolves to the same request (query-param persistence confirmed).
- [ ] No `firestore.rules` change. No new Firestore index required (single-document `get`/`onSnapshot` by ID and the existing `where("partId","==",...)` query both need none).
- [ ] No production data changed.

## Risks

- **Stale query-param links.** A bookmarked or externally-shared `?requestId=` URL for a request that's since been deleted (not possible today -- this collection is append-only) or that a user hand-edits to a foreign ID now surfaces the new "not_found"/"mismatch" empty state rather than silently showing something plausible-but-wrong -- an intentional, safer behavior change, not a regression, but worth confirming reads clearly to an end user rather than as a raw error.
- **`useReorderRequestForPart()` has other call sites.** Confirmed during Assessment: `PartDetail.jsx` is its only consumer today. If a future caller is added without passing `requestId`, it silently gets today's existing fallback behavior (safe default), not the new exact-match behavior -- worth a one-line reminder comment on the hook itself so a future caller knows the parameter exists.

## Open questions

None remaining -- Architecture Review resolved every open question the Assessment raised.

## Approval

Pending ChatGPT Sprint Specification review.
