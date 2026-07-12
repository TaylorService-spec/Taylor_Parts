---
artifact_type: specification
gate: Sprint Specification
status: Approved
date: 2026-07-12
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/inventory-operational-queue.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 157
target_release: Post-Release 2.1 (Inventory -> Procurement chain)
---

# Sprint Specification: Inventory Operational Queue -- Manager Oversight, Complete-Catalog Browsing, History Discovery

**Architecture Review:** `docs/assessments/inventory-operational-queue.md` -- **APPROVED, 2026-07-12** (Issue #154 / PR #155, merged). Six decisions adopted there govern this Specification; each is restated where relevant below rather than re-litigated. **No Rules change is approved by that review.** This is Round 3. Round 1 re-introduced the exact page conflation Architecture Review required resolved, hid a production-data prerequisite inside an implementation PR, proposed an unbounded query for an unbounded collection, and repeated this codebase's existing error-swallowing hook pattern in new code -- corrected in Round 2. Round 2 still bundled a production index deployment into the same PR as its frontend/auto-deploying code, overstated what the client can ever detect about a security-role mismatch, and left the picker's safety behavior as an unresolved either/or. All three are corrected below.

## Executive summary

Six pieces of work, sequenced, not three:

- **A0 (prerequisite, no UI change) -- security-role mirror rollout.** Denormalizes `users/{uid}.role` onto the linked `employees/{employeeId}` document as `securityRole`, with a writer invariant, `BusinessEntityModel.md` documentation, and a drift-detection/repair verification script. No picker behavior changes yet.
- **Backfill (operational step, not a PR, not authorized here).** The Owner (or someone with production Admin SDK access) backfills `securityRole` onto every pre-existing Employee document and verifies the result -- zero drift, confirmed by the same script's read-only pass -- under its own separate Production Data Authorization. Recording that result is itself a **separate, docs-only tracking PR** opened after the operational audit completes, not a direct edit to `docs/DECISIONS.md` (see "Recording the backfill result," below).
- **PR A -- All Assigned Work oversight, plus the assignment-eligibility filter.** Sequenced strictly after the backfill is confirmed complete and its result recorded -- both pieces ship together once that gate clears, not before.
- **PR B -- Inventory Health and Parts Catalog become two genuinely separate surfaces**, correcting Round 1's design, which re-merged them. Parts Catalog becomes the one true "browse/show everything" experience, enriched with health/risk data where it exists; Inventory Health keeps exactly its two real filters (Critical & High, Needs Planning) and loses its ledger-scoped "Show All" tab entirely. Independent of A0/backfill/PR A.
- **C0 -- index-only PR.** Adds exactly one entry to `firestore.indexes.json` (`reorder_requests`: `status`, `createdAt`) -- no application code, no UI. Requires its own Owner Merge Authorization, then its own, separate Owner Deployment Authorization (`firebase deploy --only firestore:indexes`), then confirmation the index has reached `[READY]` in production -- **before** PR C merges.
- **PR C -- Reorder Request History, bounded and ordered**, not an unbounded live query -- deterministic newest-first pagination, exact-request-id lookup independent of the loaded page, and full loading/empty/error/end-of-history states. Contains **no** index-file change (that's C0's alone) -- merging PR C only after C0's index is confirmed `[READY]` is what prevents an ordered/paginated query from hitting production before the index it needs exists. Independent of PR A -- no shared-hook dependency (see Technical design).

## Recording the backfill result

The verified-zero-drift result is a production-data fact worth recording durably, the same as every other production verification in this project's history -- but it is **not** recorded by directly editing `docs/DECISIONS.md`. That file currently has an unrelated, unidentified, uncommitted working-tree change from a separate session, and this Specification (like every PR produced during that conflict) has been instructed to leave it untouched rather than risk clobbering another session's in-progress work. **The backfill result is instead recorded in its own, separate, docs-only tracking PR** -- opened fresh off `main` after the operational audit completes, adding one new `docs/DECISIONS.md` entry the normal way (a clean branch, a clean commit, no working-tree conflict, since a fresh checkout of `main` doesn't carry the other session's uncommitted change). **If the `docs/DECISIONS.md` ownership conflict is still unresolved when the backfill completes, that tracking PR waits until it is** -- the backfill itself is not blocked by this (it's an Admin-SDK operation against `employees`/`users`, unrelated to `docs/DECISIONS.md`), only the act of recording it in that specific file is.

## Sprint objective

An admin/dispatcher can see every Reorder Request currently assigned to any Parts Associate (not just their own), can browse the complete parts catalog -- enriched with whatever health/risk signal exists for each part -- in one place, and can find any terminal (closed-out) Reorder Request, paginated and ordered, without already knowing its part or id. Assigning Parts Associate work to a `technician`-security-role employee who could never see it becomes structurally harder, once (and only once) the security-role mirror this depends on is verified correct in production. No query in any new view silently presents a failure as "no work."

## Scope

### A0 -- Security-role mirror rollout (prerequisite, no UI change)

- `functions/scripts/provisionEmployeeAccess.js` writes `securityRole` onto `employees/{employeeId}` at the exact point it already writes `role` onto `users/{uid}` (`userUpdates: { role: securityRole }`) -- same script, same transaction/batch, one additional field on an existing write. **Invariant, stated explicitly: every code path that is authorized to change a user's security role must update both `users/{uid}.role` and the linked Employee's `securityRole` together, in the same write operation.** `provisionEmployeeAccess.js` is, today, the *only* such path (confirmed by inspection -- no other writer of `users/{uid}.role` exists in this codebase); if a second one is ever added, it inherits this same invariant, stated here so it isn't silently missed later.
- `docs/BusinessEntityModel.md` Section 8a's Employee field table gains a `securityRole` row: denormalized, read-only mirror of `users/{uid}.role`, populated by `provisionEmployeeAccess.js` only, **never itself a source of authorization** -- restated from Section 8a's own existing principle for `operationalRoles[]`.
- A drift-detection/repair verification script (Admin SDK, run by the Owner -- this environment has none) that reads every `employees/{employeeId}` with a non-null `userId`, reads the linked `users/{uid}.role`, and reports any employee where `securityRole` is missing or disagrees with the linked user's actual `role`. Read-only by default; a `--repair` mode writes the correct value. **Exact document IDs and before/after `securityRole` values are the audit output -- no other user field is read, logged, or exported**, consistent with "audit exact document IDs/results without exposing unnecessary user data."

### Backfill (operational step -- not a PR, not authorized by this Specification)

- The drift-detection script's `--repair` mode, run once against every pre-existing Employee document, under a separate, explicit Owner Production Data Authorization -- the same pattern already established in this project for every prior production-data-touching step (`docs/DECISIONS.md`'s entries on the `employees` composite index deploys and PR #114's authorized-command batch).
- **Verified complete** means: a follow-up read-only pass of the same script reports zero drifted/missing documents, recorded in `docs/DECISIONS.md` before PR A proceeds.

### PR A -- All Assigned Work oversight, plus the assignment-eligibility filter (gated on the backfill above)

- New hook `useReorderRequestsByStatuses(statuses[])` in `hooks/useReorderRequests.js` for the assignee-independent, currently-small, unordered "All Assigned Work" set (`ASSIGNED_TO_PARTS_ASSOCIATE` + `PURCHASING_IN_PROGRESS`) -- **returns an explicit error state**, not a silent empty array, see Technical design.
- New read-only "All Assigned Work" section on `PartsList.jsx`, with its own visible count, showing the linked part, the current assignee (`resolveActorDisplayName()`, never a raw uid), `status`, `urgency` (where applicable), and age. Rows are `<Link>`s into `PartDetail.jsx` carrying `?requestId=<id>` -- no action control renders.
- `useAssignableEmployees()`/`EmployeeAssignmentPicker.jsx` excludes `technician`-security-role candidates from `PARTS_ASSOCIATE` eligibility using `employees.securityRole`, client-side, **and** excludes any candidate whose `securityRole` is missing, `null`, or not one of the valid `ROLES` enum values -- both treated as a configuration error, both surfaced with a visible admin-facing warning. **This PR must not merge until the backfill above is confirmed complete and recorded** -- see Technical design for exactly what the client can and cannot ever detect here, and the one behavior this Specification fixes for PR A.

### PR B -- Inventory Health and Parts Catalog, separated (corrects Round 1)

- `QUEUE_FILTER_OPTIONS` shrinks to exactly two tabs: **Critical & High**, **Needs Planning**. The ledger-scoped "Show All"/`ALL` tab is removed from Inventory Health entirely -- not relabeled, not merged into anything, removed.
- The existing lower **Parts Catalog** table becomes the one true "show everything" experience: its default/"All Categories" state already shows every `PARTS_CATALOG` part; this PR enriches each row with whatever health/risk signal exists for that part (urgency badge, or an explicit "No ledger activity" note where none exists) -- **without** adding the catalog's own SKU/cost/price columns into `InventoryHealthPanel.jsx`, and without adding `InventoryHealthPanel.jsx`'s stock/usage columns into the catalog table wholesale. The catalog table's existing category filter, pagination, and `GlobalSearch` integration are preserved unchanged.
- Both remaining Inventory Health tabs (Critical & High, Needs Planning) gain populated `count` values via `FilterBar.jsx`'s existing support. The Parts Catalog table's own filter bar (`filterOptions`, `PartsList.jsx:190-193`) gains counts too, for the same reason.
- `InventoryHealthPanel.jsx`'s single hardcoded empty-state string is replaced with a caller-supplied, filter-specific message for its two remaining tabs (`emptyText` prop, defaulting to today's string so `Operations.jsx`'s own call site -- which has no filter tabs at all -- is byte-for-byte unaffected).

### C0 -- index-only PR (prerequisite for PR C, no application code)

- Exactly one new entry in `firestore.indexes.json`: `reorder_requests` (`status` ASC, `createdAt` DESC), required by PR C's ordered/paginated query. **No `.js`/`.jsx`/`.ts` file changes of any kind** -- this PR's diff is `firestore.indexes.json` alone, the same "one architectural concern per PR" discipline this project already applies to Rules-only PRs.
- Requires its own Owner Merge Authorization (merging C0 itself), then a **separate** Owner Deployment Authorization to actually run `firebase deploy --only firestore:indexes --project taylor-parts` -- merging C0 does not deploy anything by itself (an index-only change has no frontend/Hosting/Functions component to auto-deploy; deployment is a deliberate, separately-authorized CLI action, same as every Rules/index deploy already in this project's history).
- **Verified `[READY]`** means: `firebase firestore:indexes --project taylor-parts --pretty`, polled until the new index's build state reads `[READY]`, not merely "deploy command exited 0" -- the exact two-step confirmation pattern `docs/DECISIONS.md`'s PR #109/#111 entries already establish for this project's prior composite indexes.
- **PR C (below) must not merge until this index is confirmed `[READY]` in production.**

### PR C -- Reorder Request History (bounded, ordered, independent of PR A -- gated on C0)

- New, purpose-built hook (not shared with PR A -- see Technical design for why) reading `CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED` requests, ordered newest-first by `createdAt`, paginated with a bounded initial page and cursor-based "Load More." **Contains no `firestore.indexes.json` change -- that entry belongs to C0 alone**, so that merging PR C's frontend code (which auto-deploys immediately at merge, per this project's established frontend-only deploy behavior) never races ahead of the index it depends on.
- A separate, exact-request-id lookup path (direct `getDoc`, not scoped to whatever page of History happens to be loaded) so a request found by status/assignee/part elsewhere, or a pasted/typed exact id, is always reachable regardless of pagination position.
- Explicit loading, genuinely-empty, error, and end-of-history states -- no state is inferred from an empty array alone.
- A visible count for the History section (of the currently-loaded/filtered set, with an indication that more may exist if not yet fully loaded -- exact copy is an implementation detail, the requirement is that the count is never presented as if it were the collection's total unless it actually is).

## Explicitly out of scope

- **Any `firestore.rules` change.** Unchanged from Round 1 -- Architecture Review decision #1 keeps `reorder_requests`/`employees` visibility exactly as-is; C0's composite index is an index deployment, not a Rules change.
- **The Inventory Action Log redesign** -- Issue #152, confirmed separate again.
- **The Cancel/Void initiative** -- PR #151 (merged, deployed) not reopened or changed, not a dependency.
- **The broader page-restructuring into "Reorder Work" / "Inventory Health" / "Parts Catalog" top-level headings** the Assessment's "Live-page architecture finding" recorded as an adopted future direction. This Specification separates Inventory Health and Parts Catalog's *semantics* (PR B) without yet regrouping the whole page under that three-part heading structure -- a larger, separate follow-up.
- **Retrofitting error-state handling onto every pre-existing hook in this codebase.** `hooks/useReorderRequests.js`'s existing `useReorderRequestsByStatus()`/`useReorderRequestsAssignedTo()` and every other hook that currently swallows `onSnapshot` errors into an empty array are unchanged by this Specification -- only the new hooks introduced here (PR A's, PR C's) are required to surface errors. A repository-wide retrofit is a separate, larger effort not scoped here.
- **A full accessibility audit of `PartsList.jsx` or the wider app.** This Specification requires the *new* surfaces (oversight rows, History rows, the enriched catalog rows) to carry accessible filter labels, keyboard navigation, and announced loading/error/empty transitions -- it does not audit or fix pre-existing accessibility gaps elsewhere on the page.

## Technical design

### A0/Backfill: the security-role mirror, precisely

Unchanged from Round 1's finding, restated with the corrected sequencing: `employees/{employeeId}` has no security-role field today (confirmed against `docs/BusinessEntityModel.md` Section 8a's field table and `provisionEmployeeAccess.js`'s actual writes); `users/{uid}` is hard self-read-only (`firestore.rules:172-175`, no admin/dispatcher exception) -- an admin/dispatcher genuinely cannot read a candidate's sign-in role today, by any query shape. The fix is the denormalized `securityRole` mirror described in Scope above, **not** a Rules change.

**What the client can and cannot ever detect here -- corrected in this round.** The client cannot compare `employees.securityRole` against `users/{uid}.role` for any employee other than the signed-in user themselves -- this Specification's own earlier finding (`users/{uid}` is hard self-read-only, `firestore.rules:172-175`, no admin/dispatcher exception) applies just as much *after* the backfill as before it. **A valid-but-wrong mirror -- `securityRole` says `"dispatcher"` but the linked user's real `role` has since drifted to `"technician"` -- is structurally undetectable by the picker, at any point, forever.** Only the Admin-SDK drift-audit script (A0's own tool, run with real production credentials this environment and this app's client never have) can ever compare the two sides and catch that case. This is why the invariant in A0's Scope above -- every authorized role-change writer updates both fields together -- is load-bearing, not a nicety: it is the *only* thing keeping the two sides in agreement after the initial backfill, since nothing client-side can ever verify they still agree.

**What the client genuinely can detect, and what it does with it:**

- **Missing, `null`, or an invalid-enum value** (not one of `ROLES.ADMIN`/`ROLES.DISPATCHER`/`ROLES.TECHNICIAN`) on `employees.securityRole` -- these are directly readable on the document the picker already has, no cross-document read required.
- **Before the backfill is verified complete:** a missing `securityRole` fails open -- treated as not-technician, i.e., not additionally excluded. This is the only safe default before every document has been touched; the alternative would silently remove every already-provisioned employee from the picker before the data to judge them by even exists.
- **After the backfill is verified complete and recorded (per "Recording the backfill result" above): fixed now, not deferred to the Implementation Plan -- the picker excludes the candidate from the selectable list AND shows an admin-visible configuration warning** (e.g., "N employee(s) have unverified role data -- contact an admin"), for exactly the missing/`null`/invalid-enum case above. **Both together, not a choice between them.** This is never presented as "fine, just not technician" -- it's presented as what it is, a data-quality gap the picker can see, not a security judgment it's making.
- **The verified-zero-drift state established at backfill time is a point-in-time fact, not a standing guarantee.** Because the client can never re-verify agreement going forward, correctness after that point depends entirely on A0's writer invariant holding and, per Risks below, on the drift-audit script being re-run whenever role provisioning changes -- not on anything this Specification's UI can independently confirm.
- **Client-side filtering is a UI workflow narrowing, not server-side authorization**, stated explicitly and unambiguously: `firestore.rules` enforces zero of this. An admin/dispatcher with direct Firestore access (there is none in this app's client surface, but the distinction matters for anyone reading this Specification later) could still write an assignment to a technician-role employee's uid -- this filter only narrows what the *picker UI* offers, exactly the same non-guarantee `operationalRoles[]`-based eligibility already carries today for every other assignment-picker filter on this component.

### PR A: `useReorderRequestsByStatuses()` -- with a real error state

```js
// hooks/useReorderRequests.js
export function useReorderRequestsByStatuses(statuses, enabled = true) {
  const [state, setState] = useState({ data: [], loading: enabled, error: null });

  useEffect(() => {
    if (!enabled || !statuses?.length) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const q = query(reorderRequestsRef, where("status", "in", statuses));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setState({ data: toDocs(snap), loading: false, error: null }),
      (err) => setState({ data: [], loading: false, error: err.code ?? "unknown" })
    );
    return unsubscribe;
  }, [statuses.join(","), enabled]);

  return state;
}
```

`error` carries the Firestore SDK's own `err.code` (e.g. `"permission-denied"`, `"unavailable"`) -- not a boolean, so the UI can distinguish a permission failure from a network/query failure, not just "something went wrong." `PartsList.jsx`'s "All Assigned Work" section renders one of four states, never inferring one from another: **loading** (spinner/skeleton), **error** (the specific message, not a blank table), **genuinely empty** (`data.length === 0 && !error`, "No requests are currently assigned to anyone."), or **populated**. This is a single-field `in` query -- no composite index, same as Round 1's finding, unaffected by this correction.

### C0: the index deployment, precisely -- and why it cannot ride inside PR C

**Corrected in this round.** Round 2 put `firestore.indexes.json`'s new entry inside PR C, alongside the frontend/query code that consumes it. That's unsafe in this project's actual deployment model: PR C's frontend bundle auto-deploys the instant it merges (no separate Hosting-deploy step, per every prior frontend-only PR in this project's history), while an index deployment is always its own deliberate, separately-authorized CLI action that can take minutes to reach `[READY]`. Merging PR C would put the ordered/paginated History query live in production **before** the index it structurally requires exists there -- a predictable, avoidable failure window, not a hypothetical one (the exact live/emulator parity gap `docs/DECISIONS.md`'s PR #109 entry already documents once, for this identical class of mistake, on a different collection).

**Corrected sequence: C0 first, index deployed and confirmed `[READY]`, only then PR C.**

`firestore.indexes.json` gains exactly this entry, in C0, and nowhere else:
```json
{
  "collectionGroup": "reorder_requests",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```
Deployed via `firebase deploy --only firestore:indexes --project taylor-parts`, under its own separate Owner Deployment Authorization scoped to indexes only, after C0's own separate Owner Merge Authorization -- two distinct authorizations, matching this project's standing "merge authorization is never deploy authorization" rule, applied here across two different PRs (C0 for the merge, then deployment) rather than one. Verified `[READY]` via `firebase firestore:indexes --project taylor-parts --pretty`, polled, not assumed from a clean `deploy` exit code -- the exact same two-step confirmation already used for the `employees` composite indexes live in production. **Not a Rules change** -- restated here since it's easy to conflate an index deployment with one, given both require a separate Owner Deployment Authorization.

### PR C: purpose-built, not shared with PR A -- and why

Round 1 proposed one shared hook for both "All Assigned Work" (PR A) and "History" (PR C). **Corrected: they are not the same query shape and should not share an implementation.** All Assigned Work is unordered, unbounded-but-small-in-practice (bounded by how many requests are *currently* in flight, which churns and stays small). History is exactly the opposite -- unordered-by-default would be actively wrong for it (per this correction, it must be ordered), and it only ever grows, never churns down. Forcing one hook to serve both would mean either over-engineering All Assigned Work with pagination it doesn't need, or under-engineering History with the unbounded live query this correction rejects. **PR C introduces its own hook, independent of PR A -- no cross-PR dependency, no sequencing requirement between them.** PR C's only sequencing requirement is C0's index reaching `[READY]` first, per above.

```js
// hooks/useReorderRequests.js -- illustrative, exact shape is an implementation detail
export function useReorderRequestsHistory({ statuses, pageSize = 25 }) {
  // orderBy("createdAt", "desc") -- deterministic newest-first.
  // Depends on C0's index already being live -- PR C itself makes no
  // firestore.indexes.json change; it only queries against what C0 deployed.
  // Returns { data, loading, error, hasMore, loadMore(), isEndOfHistory }.
  // loadMore() re-queries with startAfter(lastVisibleDoc) -- a cursor,
  // not an offset, per Firestore's own pagination guidance.
}

// A second, independent function -- NOT part of the paginated hook above,
// so a known exact id is always reachable regardless of loaded page/filter state.
export function useReorderRequestById(requestId) {
  // Direct onSnapshot(doc(reorderRequestsRef, requestId)) -- same pattern
  // useReorderRequestForPart() already uses for its requestId branch.
}
```

**History's four states, explicitly:**
- **Loading** -- initial page fetch in flight.
- **Error** -- the hook's `error` field is non-null; render the specific failure, never an empty table.
- **Genuinely empty** -- zero terminal requests exist at all (`data.length === 0`, `!loading`, `!error`, first page).
- **End of history** -- `hasMore === false` after at least one page loaded; "Load More" is hidden or disabled, not silently absent with no explanation.

**Exact-id lookup independent of pagination:** the History UI's filter input, when it looks like a Firestore document id (or on an explicit "find by id" action), calls `useReorderRequestById()` directly rather than searching only the currently-loaded page(s) -- so a request several pages back, or not yet loaded, is still reachable without "Load More"-ing through the entire history.

### PR B: Inventory Health and Parts Catalog as genuinely separate surfaces

```js
// PartsList.jsx -- Inventory Health keeps only its two real filters.
const QUEUE_FILTER_OPTIONS = [
  { key: "ACTIONABLE", label: "Critical & High" },
  { key: "NEEDS_PLANNING", label: "Needs Planning" },
];
// No "ALL" option -- removed, not relabeled, not merged elsewhere in this component.
```

```js
// PartsList.jsx -- Parts Catalog enriched with health/risk data where it exists.
function enrichCatalogRow(part, healthByPartId) {
  const health = healthByPartId.get(part.sku);
  return { ...part, health: health ?? null }; // null -> render "No ledger activity"
}
```

The Parts Catalog table's existing rendering (SKU, cost, price, category filter, pagination, `GlobalSearch`) is unchanged; it gains one additional column (urgency badge, or "No ledger activity") sourced from the same `healthEntries` Inventory Health already computes -- **no duplicate computation, one `healthEntries` read, two different consumers now instead of one.** `InventoryHealthPanel.jsx` itself gains no new column and no catalog-specific rendering branch -- Round 1's `mergeCatalogWithHealth()`/no-ledger-activity-row-inside-`InventoryHealthPanel` approach is withdrawn. Critical & High and Needs Planning remain scoped to real `healthEntries` only, exactly as before -- unaffected by this section.

## Authorization

Unchanged from Round 1's analysis for every existing action -- PR A/B/C add zero new write paths and zero new action controls; every new view is `<Link>`-only. Restated for A0/backfill specifically: `provisionEmployeeAccess.js` is already Admin-SDK-only, already bypasses `firestore.rules` by design, already the sole writer of `employees`/`users`' identity-linkage fields -- adding one more field to its existing write is not a new authorization surface. The drift-detection/repair script is a new, Owner-run, Admin-SDK tool with the same posture -- it does not run in this environment, is not exposed to any client, and is not itself part of the deployed application.

## Firestore Rules impact

**None.** Confirmed again after this revision's corrections: no PR in A0/A/B/C0/C touches `firestore.rules`. C0's composite index is a `firestore.indexes.json` change and its own deployment step, in its own PR, separate from PR C's application code -- explicitly not a Rules change, called out with its own authorization boundary in Technical design above so it isn't mistaken for one, or silently skipped as if it were covered by "no Rules change."

## UI impact

- `PartsList.jsx` gains: "All Assigned Work" (PR A, own count, four explicit states), a two-tab (not three-tab) Inventory Health section (PR B), an enriched Parts Catalog table (PR B), and "History" (PR C, own count, four explicit states, pagination, exact-id lookup).
- `EmployeeAssignmentPicker.jsx`/`useAssignableEmployees()` (PR A, post-backfill) omits `technician`-role candidates from Parts Associate eligibility; a missing/`null`/invalid-enum `securityRole` -- the only condition the client can ever actually observe -- is excluded and surfaced with a visible configuration warning, not silently absorbed into "not eligible." A valid-but-drifted mirror is never claimed to be detectable here -- that's the drift-audit script's job alone, per Technical design.
- `InventoryHealthPanel.jsx` loses its `ALL`-tab-driven empty-state ambiguity (there are only two tabs now) and gains a caller-supplied `emptyText` for each; `Operations.jsx`'s own call site (no tabs, no `queueFilter`) is unaffected.
- **Responsive behavior:** "All Assigned Work," "History," and the enriched Parts Catalog table all add columns to already-wide tables. Each renders inside a horizontally-scrollable container on narrow viewports (matching this project's existing wide-table pattern -- confirmed present on `fo-table`'s current usage elsewhere) rather than silently clipping or wrapping into unreadable rows -- an explicit requirement for these three specifically, not assumed for free.
- **Accessibility, for the new/changed surfaces specifically:** every new filter control (the two remaining Inventory Health tabs, the Parts Catalog filter bar, History's status/text filter) has an accessible label (`aria-label` or an associated `<label>`, matching `FilterBar.jsx`'s existing button semantics) and is reachable/operable via keyboard alone (tab order, Enter/Space activation -- native `<button>`/`<input>` elements already provide this; the requirement is not to regress it with a custom widget). Loading, error, and empty-state transitions in "All Assigned Work" and "History" are announced to assistive technology (`aria-live="polite"` on the status region, or equivalent) rather than only being a silent visual change.
- No new route, no new nav entry -- every addition lives on the existing `/inventory` (Parts) page.

## Testing strategy

Primary test: extend the `run-field-ops-app-vite` Playwright skill's `driver.mjs`, same established pattern as `verify-notification-identity`/`verify-cancel-void` (PR #148/#151) -- one named command per PR (A0 has no browser-testable surface; its own verification is the drift-detection script's own read-only report, run against emulator fixtures).

Required coverage, corrected and expanded from Round 1:

- **A0/Backfill:** drift-detection script, run against emulator fixtures, correctly reports (a) an Employee with a correct `securityRole`, (b) one with a missing `securityRole` (pre-backfill simulation), (c) one with a mismatched `securityRole` (drift simulation) -- three distinct, named cases, not inferred from one generic pass/fail.
- **PR A:** Manager B sees, in "All Assigned Work," a request assigned to user A, without being the assignee. User A's own personal Waiting/In Progress views remain scoped to exactly user A. The section's count is accurate. A simulated `permission-denied` (or any) query failure renders the error state, not an empty table -- this is a new, required assertion Round 1 did not have. A `technician`-role employee with a correctly-backfilled `securityRole` does not appear in the Parts Associate picker; a `dispatcher`/`admin`-role employee does; a fixture with `securityRole` missing/`null`/invalid-enum is confirmed to be both excluded from the selectable list and to trigger the admin-visible configuration warning (the one fixed behavior this Specification specifies, not two alternatives) -- **this specific assertion only becomes meaningful, and testable, once PR A actually ships after the backfill gate -- recorded here so the Implementation Plan doesn't lose it.** No test asserts the picker detecting a valid-but-drifted `securityRole` -- that case is exclusively the drift-audit script's own test coverage, above.
- **PR B:** Inventory Health shows exactly two tabs, no third. The Parts Catalog table shows every catalog part, each with either a real urgency badge or "No ledger activity" -- confirmed by fixture including at least one part with real ledger activity and one without. Both Inventory Health tabs and the catalog's own filter bar show accurate counts.
- **PR C:** Deterministic newest-first ordering confirmed against a fixture with known relative `createdAt` values. Initial page is bounded to the configured page size; "Load More" fetches the next page via cursor, not by re-fetching from the start. A fixture request is found by exact id via the independent id-lookup path even when it is not on the currently-loaded page. Loading, genuinely-empty (a fixture with zero terminal requests), error (simulated failure), and end-of-history (all pages loaded, "Load More" no longer offered) are each their own named assertion.
- **Accessibility spot-check (not a full audit):** each new/changed filter control has an accessible name, confirmed via Playwright's `getByRole(..., { name })` locators (the same mechanism already used throughout this project's driver commands) -- if a control isn't reachable that way, it isn't accessibly labeled either, so this project's existing test style already doubles as the check.

## Rollback strategy

- **A0, before the backfill runs:** reverting the writer change is safe -- no existing data was altered, `securityRole` simply stops being written going forward; any Employee documents it already touched keep a harmless, unused field.
- **The backfill itself is never rolled back** -- it only ever adds/corrects a read-only mirror field on existing documents; no other Employee data is touched.
- **PR A, before merge (i.e., before the backfill gate clears):** does not exist yet by construction -- this Specification requires the gate to clear first. If a future incident requires reverting PR A after it ships, the oversight view and the picker filter both revert cleanly and independently -- `securityRole` data is unaffected either way.
- **PR B:** reverting removes the Parts Catalog enrichment column and restores Inventory Health's third tab -- a normal frontend revert, no data/schema component.
- **C0/PR C:** reverting PR C removes the History UI; C0's composite index, once deployed, is left in place regardless (an unused index is inert, not a rollback hazard) unless a future, separate Owner Deployment Authorization explicitly removes it -- consistent with this project's existing index-deployment rollback posture. Reverting PR C never implies reverting C0, and vice versa -- they are independent PRs with an ordering requirement, not a single unit.

## Acceptance criteria

- [ ] `employees/{employeeId}.securityRole` is written by `provisionEmployeeAccess.js` alongside `users/{uid}.role`, documented in `docs/BusinessEntityModel.md` Section 8a as a read-only, non-authorizing mirror field.
- [ ] A drift-detection/repair script exists, is Admin-SDK-only, and its read-only report distinguishes correct / missing / mismatched `securityRole` per employee, by exact document id, with no other user data in its output.
- [ ] The backfill is **not** claimed as done by any code in this Specification -- its completion is a `docs/DECISIONS.md` entry, under a separate Owner Production Data Authorization, verified by a zero-drift drift-detection re-run before PR A proceeds.
- [ ] PR A's "All Assigned Work" shows every currently-assigned request regardless of assignee, additive to personal queues, with an accurate count, four explicit states (loading/error/empty/populated), and `?requestId=` navigation; no action control renders.
- [ ] PR A's picker filter excludes `technician`-role candidates using `employees.securityRole`; post-backfill, a missing/`null`/invalid-enum value is excluded **and** shown with an admin-visible configuration warning (both, not either/or); the picker never claims to detect a valid-but-drifted mirror -- only the drift-audit script does.
- [ ] PR B: Inventory Health has exactly two tabs (Critical & High, Needs Planning), each with an accurate count and a filter-specific empty message; no ledger-scoped "Show All" tab exists anywhere in `InventoryHealthPanel.jsx`'s call sites.
- [ ] PR B: the Parts Catalog table remains the one complete-catalog view, every existing capability (category filter, pagination, `GlobalSearch`) preserved, enriched with a per-row health/risk indicator or an explicit "No ledger activity" state.
- [ ] C0: contains exactly one `firestore.indexes.json` entry (`reorder_requests`: `status`, `createdAt`), no application code; merged under its own Owner Merge Authorization, deployed under its own separate Owner Deployment Authorization, confirmed `[READY]` in production before PR C merges.
- [ ] PR C: History is ordered newest-first, deterministically; the initial page is bounded; "Load More" is cursor-based; an exact request id is findable independent of loaded page/filter state; loading/empty/error/end-of-history are each their own rendered state; contains no `firestore.indexes.json` change of its own.
- [ ] No hook introduced by this Specification (`useReorderRequestsByStatuses`, the History hook, `useReorderRequestById`) silently converts a query failure into an empty-array result -- each surfaces a distinct `error` value the UI renders.
- [ ] Every new filter control has an accessible name and is keyboard-operable; loading/error/empty transitions in the two new sections are announced to assistive technology.
- [ ] "All Assigned Work," "History," and the enriched Parts Catalog table each render inside a horizontally-scrollable container on narrow viewports.
- [ ] `npm run build && npm run lint` / `npx tsc --noEmit` clean for every PR.
- [ ] Browser verification (Playwright, `run-field-ops-app-vite` skill) covers every item in "Testing strategy" above, run against a fresh emulator, for each PR before it's considered complete.
- [ ] No `firestore.rules` diff in any of A0/PR A/PR B/PR C -- confirmed via `git diff firestore.rules` returning empty for each.
- [ ] `firestore.indexes.json`'s new entry lives in C0 alone -- confirmed absent from PR C's diff -- and is deployed under its own separate Owner Deployment Authorization, not bundled into any code-merge authorization.

## Expected file scope (exact, per stage)

- **A0:** `functions/scripts/provisionEmployeeAccess.js` (writer change); `docs/BusinessEntityModel.md` (Section 8a documentation); a new drift-detection script under `functions/scripts/`; a new emulator-fixture test file for that script (mirroring this project's existing `functions/test/*.test.js` convention).
- **Backfill:** no repository file change in the operation itself -- an operational run of A0's own script, `--repair` mode. Its result is recorded in a **separate, subsequent, docs-only tracking PR** (`docs/DECISIONS.md`, one new entry), opened fresh off `main` after the `docs/DECISIONS.md` ownership conflict is resolved -- see "Recording the backfill result" above. Neither the operation nor that tracking PR is authorized by this Specification.
- **PR A:** `field-ops-app-vite/src/hooks/useReorderRequests.js` (new hook); `field-ops-app-vite/src/modules/inventory/PartsList.jsx` (new section); `field-ops-app-vite/src/hooks/useAssignableEmployees.js` and/or `field-ops-app-vite/src/shared/assignment/EmployeeAssignmentPicker.jsx` (eligibility filter -- exact split between the two is an implementation detail); `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs` and `driver.mjs` (verification infrastructure, new fixture + command).
- **PR B:** `field-ops-app-vite/src/modules/inventory/PartsList.jsx`; `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` (`emptyText` prop only -- no catalog-specific rendering added here); verification infrastructure (`seed.mjs`/`driver.mjs`).
- **C0:** `firestore.indexes.json` only. No `.js`/`.jsx`/`.ts` file, no verification-infrastructure change -- an index has nothing for `driver.mjs` to browser-test; its own verification is the `[READY]` poll in Technical design above.
- **PR C:** `field-ops-app-vite/src/hooks/useReorderRequests.js` (new hook(s)); `field-ops-app-vite/src/modules/inventory/PartsList.jsx` (new section); verification infrastructure (`seed.mjs`/`driver.mjs`). **No `firestore.indexes.json` change** -- confirmed absent from this list deliberately, per the C0/PR C split above.

## Risks

- **The backfill is a real, separately-authorized dependency this Specification cannot close on its own** -- unchanged finding from Round 1, restated with the corrected consequence: PR A cannot merge, not merely "cannot be considered complete," until it clears.
- **The client can never re-verify `securityRole` correctness after the backfill.** A valid-but-drifted mirror is permanently undetectable by the picker (Technical design, above) -- ongoing correctness depends entirely on A0's writer invariant never being violated, and on the drift-audit script actually being re-run on every role-provisioning event (Open questions, above). If either lapses, the picker will confidently show stale-but-plausible role data with no way to know it's wrong from the client side alone.
- **C0's composite index must reach `[READY]` in production before PR C merges, not merely before its query is "relied on."** Corrected sequencing: PR C contains no index change of its own to even test against production until C0 is confirmed live -- the local emulator builds indexes implicitly and will not catch a missing production index, the same class of gap `docs/DECISIONS.md`'s PR #109 entry already documents once; a Final Review of PR C must independently confirm C0's index reached `[READY]` before PR C's own merge, not assume the code working locally proves it.
- **PR B's Parts Catalog enrichment reads the same `healthEntries` Inventory Health already computes** -- if a future change alters `healthEntries`' shape for Inventory Health's own needs without considering the catalog table's now-added dependency on it, both surfaces could silently drift out of sync. Worth a shared-source-of-truth comment at the read site, not solved further here.
- **`InventoryHealthPanel.jsx` is shared with `Operations.jsx`.** Removing the `ALL` tab and adding `emptyText` must leave `Operations.jsx`'s own rendering (no tabs, no `queueFilter` concept) byte-identical -- restated a third time across this Specification's revisions because it remains the single most likely place an unintended regression could hide.
- **History's growth is now bounded by design, not by "current volume is low."** The remaining risk is purely the composite index's own production readiness (above) and normal pagination UX polish -- not the unbounded-read risk Round 1 left unaddressed.

## Open questions

None blocking Implementation Plan drafting -- Architecture Review's own scope is closed (PR #155, merged). The picker's post-backfill safety behavior is fixed by this Specification (exclusion plus admin-visible warning, both, per Technical design above), not left as an implementation choice. One item remains an Implementation Plan-level detail:

1. The drift-audit script's **re-verification trigger is defined here, not left open**: it must be re-run, read-only, whenever `provisionEmployeeAccess.js` (or any future writer inheriting A0's invariant) runs against production -- i.e., every time a role is provisioned or changed, not on an arbitrary schedule. Whether that re-run is a manual step the Owner performs each time, or is later automated (a scheduled check, a CI hook on the script itself), is the only thing left to the Implementation Plan -- the *requirement that it happens every role-provisioning event* is fixed here.

## Approval

**Approved by ChatGPT on 2026-07-12**, after two REQUEST CHANGES rounds (Round 1: page-conflation, hidden production-data prerequisite, unbounded query, error-swallowing hooks; Round 2: unsplit index PR, overstated client-side drift detection, undecided picker behavior -- both corrected in Round 3, reviewed at head `8ede93086cf087f59a0e810a33df497e1521d17d`). No findings remain open. Per `docs/ai/workflow.md`'s stage 4/5, an Implementation Plan may now be drafted -- **but not yet**: this approval does not itself authorize opening A0, PR A, PR B, C0, or PR C, and does not substitute for the Owner Merge Authorization this Specification's own merge still requires, separately, per the standing "architecture approval is not merge authorization" rule. No code, Rules, deployment, or production-data change has been made while producing this document -- planning only.
