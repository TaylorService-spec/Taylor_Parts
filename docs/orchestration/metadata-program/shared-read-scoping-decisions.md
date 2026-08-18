# Shared Read Scoping — Consolidated Decision Package

**Status:** DECISION REQUESTED (Owner)
**Ledger items:** `X-PART-MASTER-UNBOUNDED-READ`, `X-DISPATCH-QUEUE-UNBOUNDED-LISTENERS` (both phase 6,
both READY, both `NOT_APPLICABLE` deploy)
**Scope of this document:** analysis and recommendation only. No code changed.

## Why these two are bundled

The remediation lane (`A-BOUNDED-READ-INVENTORY`, PR #1248/#1249, baseline `9c30e311`) inventoried eight
unbounded reads, bounded one (Transfers), and left two open with the reason named rather than the
symptom: bounding either one, done the way the Transfers fix was done, ripples into surfaces the lane
did not own. Both share the same underlying shape — **a read built for one purpose is now load-bearing
for a second, different purpose** — so the Owner asked for one decision covering both rather than two
separate ones.

**The rule this package applies (established by the remediation lane, not re-litigated here):**
a **list** read must be bounded and must disclose the bound. An **aggregate** read must never be
bounded — a silently truncated aggregate is a wrong number presented as a right one, strictly worse
than an unbounded read. A **shared directory/lookup** read is neither until someone decides which role
it plays for which caller.

---

## Item 1 — `fetchPartMasterList` (Part Master)

- **File / symbol:** `field-ops-app-vite/src/services/partMasterQueries.js:15`, `fetchPartMasterList()`
- **Current read path:** `getDocs(collection(db, "parts"))` — a single, one-shot, unfiltered read of the
  entire `parts` collection. No `where`, no `orderBy`, no `limit`.
- **Current cap:** none. Confirmed by reading the file directly — no cap, no cursor, no page size.
- **Truncation disclosure:** none. `toPartListView()` returns `{ ok, parts, invalid }`; there is no
  `truncated` field anywhere in the return shape, and no consuming surface renders a "showing N of M" /
  partial-results notice (checked `PartsList.jsx`, `PartMasterList.jsx`, `WarehouseManagerHome.jsx`,
  `domain/partsCatalogView.js` — no `truncat`/`Showing`/`totalCount` string anywhere in that chain).
- **Does the UI present the result as complete?** Yes, by omission. Every list-role consumer treats the
  returned `parts` array as the entire catalog: substring search runs client-side over it
  (`shared/search/searchProviders.js`'s `parts` provider, per `PartsList.jsx:158-159`'s own comment,
  matches "against the FULL catalog"), and nothing in the UI hints that more rows could exist. An
  unbounded read that the UI treats as the whole set is a claim the system cannot support once the
  `parts` collection grows past whatever a single `getDocs` comfortably returns.

### Who actually calls it, and in what role

Traced every call site (excluding tests):

| File | Role | Evidence |
|---|---|---|
| `modules/inventory/PartsList.jsx` | **LIST** | Parts Catalog workspace; renders every part as a row; search is a client-side substring match over the full result (`PartsList.jsx:146-166`, its own comment block explaining why it can't move to the paginated metadata runtime without losing true substring search) |
| `modules/inventory/PartMasterList.jsx` | **LIST** | Catalog-admin workspace (create/edit/status via governed callables); reads the same full list to render + edit rows |
| `modules/inventoryRole/WarehouseManagerHome.jsx` | **LIST** | Browsable catalog by category for the WAREHOUSE_MANAGER role (`buildWarehouseCatalog`, category filter) |
| `modules/workOrders/WorkOrderPartsPlanEditor.jsx` | **LIST (picker)** | Parts-plan editor's part picker; loads the full catalog on `beginEditing()` and searches it client-side (`catalog.parts`, `search` state) |
| `modules/inventory/PartDetail.jsx` | **DIRECTORY** | Single-part detail page; fetches the *entire* collection just to resolve the one `partId` in the URL (`PartDetail.jsx:1264`) — the most wasteful shape here: O(collection) read to answer an O(1) lookup |
| `hooks/useCanonicalPartNames.js` | **DIRECTORY** | Explicitly a name-resolution hook, by its own header comment: "these surfaces render NO Parts Catalog list; they only resolve a reorder request's partId -> display name." Consumed by `PartsAssociateHome.jsx`, `PartsManagerHome.jsx`, `Operations.jsx`, `shared/ui/AppHeader.jsx` — each mounts its own independent full-collection read to resolve names for a handful of ids |
| `modules/receiving/ReceiveAgainstPurchaseOrder.jsx` | **DIRECTORY** | Resolves one known part's `trackingMode` (serial vs. none) by `partId` to gate the receive flow (`ReceiveAgainstPurchaseOrder.jsx:83`) |
| `modules/inventory/partsShadowParityReaders.js` | **AGGREGATE / diagnostic** | Feeds a canonical-vs-static-vs-ledger reconciliation (parity capture); by the remediation lane's own rule this role must never be bounded — a partial reconciliation is a false PASS/FAIL, worse than a slow one |

That is 4 LIST-role surfaces, 3 DIRECTORY-role surfaces (one of which fans out to 4 more UI mounts via
`useCanonicalPartNames`), and 1 AGGREGATE-role consumer — consistent with the "~10 surfaces" scale named
in the task and the PR #1249 record.

### Can the directory role and the list role be separated?

**Yes, on the evidence above, and the separation is structural, not cosmetic:**

- The **DIRECTORY** consumers (`PartDetail`, `useCanonicalPartNames`, `ReceiveAgainstPurchaseOrder`) all
  resolve **one or a handful of known `partId`s** — none of them need the full collection in principle,
  they need it only because `fetchPartMasterList` is the only read this service exposes. A true directory
  primitive would be `getDoc`/`in`-query by id list (Firestore's `where(documentId(), "in", [...])`, capped
  at 30 ids per Firestore's own `in` limit, or `Promise.all` of `getDoc`s for larger sets), returning
  exactly the requested rows. This is strictly cheaper than what runs today for every one of these three
  call sites and changes no observable behavior for them (they already only display data for ids they
  already know).
- The **LIST** consumers (`PartsList`, `PartMasterList`, `WarehouseManagerHome`,
  `WorkOrderPartsPlanEditor`) are the ones that legitimately need a bounded, disclosed, capped read of
  "the catalog" — and 3 of the 4 also need free-text substring search over more than one page, which is
  the open, unresolved `X-QUERY-MODEL-NO-FREE-TEXT` gap. Bounding these four's read without also solving
  free-text search would either (a) silently narrow search to one loaded page — a real regression, not a
  cosmetic one, already flagged in `PartsList.jsx`'s own comment — or (b) require these surfaces to keep
  their own full-catalog copy for search, which is just the unbounded read again under a different name.
- The **AGGREGATE** consumer (`partsShadowParityReaders.js`) must keep the unbounded full-collection read
  regardless of what happens to the other two roles — a diagnostics/parity tool that samples the catalog
  produces a false PASS, which is worse than the status quo.

**What a cap that ignores this split would break:** capping `fetchPartMasterList` itself (the one
function all 8 call sites share) to, say, 200 or 500 docs would silently truncate name resolution for
every id outside that window — `PartDetail` could load and show "unknown part" for a real, existing part
whose id sorts late; `useCanonicalPartNames` could start showing raw `partId`s instead of names on
`AppHeader`, `PartsAssociateHome`, `PartsManagerHome`, `Operations.jsx` for no reason a user could see.
That is exactly the "cap that breaks name resolution across ten surfaces" the task warned against — it
is not hypothetical, it is what happens if a single blanket `limit()` is added to this one function
without also splitting the directory calls onto an id-scoped read.

**What must never disappear under any bounded scope**, named concretely:
- Every part `PartDetail.jsx` is asked to render by id (a WO's execution log, a reorder request, a
  receiving line, or a direct URL) must resolve by that id, not by whether it falls inside a page/cap.
- Every `partId` any of the four `useCanonicalPartNames` mounts (`AppHeader`, `PartsAssociateHome`,
  `PartsManagerHome`, `Operations.jsx`) is asked to resolve a name for must resolve, or explicitly show
  the raw id (current fail-closed behavior) — never silently show a *wrong* name from a stale/partial
  cache.
- `partsShadowParityReaders.js`'s canonical snapshot must remain the true full collection; a partial
  snapshot invalidates every parity check it produces.

### Recommended ruling — Part Master

Split `partMasterQueries.js` into two primitives instead of bounding the one function every caller
shares:
1. **A directory primitive** — id-scoped lookup (batched `getDoc`/`in`-query) for `PartDetail`,
   `useCanonicalPartNames`, and `ReceiveAgainstPurchaseOrder`. Bounded by construction (you only ever ask
   for the ids you need), so there is nothing to disclose or truncate.
2. **A bounded, disclosed LIST read** for `PartsList`, `PartMasterList`, `WarehouseManagerHome`, and
   `WorkOrderPartsPlanEditor` — but only *after* (or explicitly alongside) a ruling on
   `X-QUERY-MODEL-NO-FREE-TEXT`, since three of those four surfaces' search behavior depends on the full
   result set today. Bounding the list without a free-text answer converts a known, working (if
   unscalable) search into a silently-narrower one — a regression, not a fix.
3. Leave `partsShadowParityReaders.js`'s aggregate/parity read untouched — full-collection, unbounded, by
   the established rule.

**Least sure about:** the exact shape of the directory primitive (batched `getDoc` vs. `in`-query, and
whether `in`'s 30-id Firestore ceiling ever binds for `useCanonicalPartNames`' actual id-set sizes in
production) is not established from this repository alone — it needs whoever picks this up to check real
id-list sizes at each of the four `useCanonicalPartNames` mounts before choosing the mechanism.

---

## Item 2 — Dispatch Queue reads (`subscribeToWorkOrders` + `useFirestoreCollection`)

### 2a. `subscribeToWorkOrders`

- **File / symbol:** `field-ops-app-vite/src/services/workOrderService.ts:82-93`
- **Current read path:** `onSnapshot(collection(db, WORK_ORDERS_COLLECTION), ...)` — unfiltered live
  listener on the whole `fieldops_wos` collection.
- **Current cap:** none. No `where`, `orderBy`, or `limit` — confirmed by reading the function directly.
  Contrast with the sibling function two dozen lines below it, `subscribeAssignedWorkOrders`
  (`workOrderService.ts:115-131`), which is scoped by `assignedTechId` **and** carries `limit(100)` with
  an explicit comment explaining why ("without this cap every historical assignment remains subscribed
  forever").
- **Truncation disclosure:** none — and structurally can't have one today, since no consumer even checks
  for a `truncated` flag.
- **Does the UI present the result as complete?** Yes. Every consumer (`WorkOrdersList.jsx`,
  `Dispatch.jsx`, `ControlTower.jsx`, `DispatcherBoard.jsx`, `Jobs.jsx`) filters/renders the returned
  array with no size check and no partial-result messaging (grep for `truncat`/`Showing`/`limit` across
  all five turned up nothing).

**Consumers, traced via `hooks/useWorkOrders.js` (the wrapper every one of these calls):**
`Dispatch.jsx`, `ControlTower.jsx`, `DispatcherBoard.jsx`, `Jobs.jsx`, `WorkOrdersList.jsx`, and
transitively `hooks/useSchedulingData.js` (feeding `SchedulingWorkspace.jsx` and
`DispatchSchedulingWorkspace.jsx`).

**Correction to the task framing:** the Technician Dashboard does **not** consume the unbounded
`subscribeToWorkOrders`. `TechnicianDashboard.jsx:72` uses `useAssignedWorkOrders(technicianId)`, which
is the already-bounded, already-scoped `subscribeAssignedWorkOrders` (technician-filtered, `limit(100)`).
This was deliberate — `TechnicianDashboard.jsx:22`'s own comment says "never the dispatcher-side
unfiltered useWorkOrders()." I could not find any call site where "Part Detail" reads
`subscribeToWorkOrders` or `fieldops_technicians` either — `modules/inventory/PartDetail.jsx` has no
reference to either symbol. If "Technician dashboard" and "Part Detail" were meant to name specific
consumers, that could not be corroborated from the code; the six real consumers are the five above plus
Scheduling.

### 2b. `useFirestoreCollection` (generic) on `fieldops_technicians`

- **File / symbol:** `field-ops-app-vite/src/hooks/useFirestoreCollection.js` — a generic hook,
  `onSnapshot(collection(db, path), ...)`, no `where`/`orderBy`/`limit`, usable against any path.
- **Current cap:** none, by construction — it is a bare collection listener parameterized only by path.
- **Truncation disclosure:** none.
- **Does the UI present the result as complete?** Yes, for every `TECHNICIANS_COLLECTION` caller found:
  `hooks/useSchedulingData.js`, `modules/controlTower/ControlTower.jsx`, `modules/dispatch/Dispatch.jsx`,
  `modules/dispatcherBoard/DispatcherBoard.jsx`, `modules/technicians/Technicians.jsx`,
  `modules/workOrders/WorkOrderDetailPage.jsx`. All six render the technician array directly with no size
  gate.
- **Note:** because the hook is generic (parameterized by `path`), bounding it changes behavior for
  *every* current and future caller against *any* collection, not just technicians — this is the
  remediation lane's own finding ("`useFirestoreCollection` is a generic primitive. Bounding it changes
  behaviour for every unrelated caller"), reconfirmed here by the six live call sites above, all on one
  path but sharing one un-parameterized cap-free implementation.

### The crux: the same read feeds both a board and a count

`ControlTower.jsx` is the sharpest example of why one number does not work for all six consumers. From
`ControlTower.jsx:64-95`, the **same** `workOrders` array returned by `useWorkOrders()` is used to:
- render an operational, per-phase **queue/board** (`unassigned` work orders, line 86), **and**
- compute **aggregate counts** displayed as dashboard tiles (`byPhase()`, line 67; `availableTechs`/
  `onJobTechs` off the technicians array, lines 71-72).

A cap on the underlying read would silently corrupt the counts (an aggregate must never be bounded — the
same rule the remediation lane already applied to the Operations dashboard) while a *lack* of a cap is
exactly what makes the board unbounded today. `ControlTower.jsx` needs both an aggregate-safe count path
and a bounded-and-disclosed board path from what is currently one shared read — it cannot be satisfied by
capping or not capping the single existing read.

**What each of the six should see when the cap bites — they do not all want the same answer:**

| Consumer | Natural scope | Reasoning |
|---|---|---|
| `Dispatch.jsx` / `DispatcherBoard.jsx` | **BOARD**, scoped to active/open statuses (not a raw row-count cap) | These are operational queues of *current* work; a technician-dispatcher does not need `COMPLETED`/`CLOSED` history in the live board. `firestore.indexes.json` already has a `status ASC, createdAt DESC` composite index on `fieldops_wos` (line ~64) — unused by this read path today — that would support exactly this query for free, no new index needed. |
| `WorkOrdersList.jsx` / `Jobs.jsx` | **LIST**, paginated, disclosed | These already render a `STATUS_GROUPS` filter UI (`WorkOrdersList.jsx:27`) — a real list surface with an "All" option users can knowingly ask for a lot of rows from. This is the one place a page-size cap with a "load more"/truncation notice is the right shape, not a silent board scope. |
| `ControlTower.jsx` | **AGGREGATE** (counts) **+ BOARD** (unassigned queue) as two separate reads, not one | As shown above; the aggregate half must stay unbounded (or move to a server-computed count), the board half can take the same active-status scope as Dispatch. |
| `SchedulingWorkspace.jsx` / `DispatchSchedulingWorkspace.jsx` (via `useSchedulingData`) | **BOARD**, scoped by date window (the visible week), not by row count | A weekly scheduling board's natural bound is the calendar range being viewed, not an arbitrary N. Needs a `scheduledStart`/`scheduledEnd` range query; no such composite index currently exists in `firestore.indexes.json` for `fieldops_wos`, so this scope would need a new index, unlike the status-scoped board above. |
| `Technicians.jsx` (roster) | **LIST**, effectively unbounded in practice | Technician headcount is operationally small (dozens, not thousands) for any single tenant; a generous cap (e.g. 500) with disclosure is defensible, but this is the lowest-risk of the six and the least urgent to change. |
| `WorkOrderDetailPage.jsx` (technicians) | **DIRECTORY** — resolves one assigned technician's name/status for a single WO | Same shape as Part Master's `PartDetail`: reads the whole technician collection to resolve one known id. Should move to a `getDoc(doc(db, TECHNICIANS_COLLECTION, techId))` lookup, not a capped list. |

### What must never disappear under any bounded scope, named concretely

- A work order that is `SCHEDULED`/`READY_TO_DISPATCH`/`CREATED` (open, not yet finished) must remain
  visible on the Dispatch/Control Tower/DispatcherBoard queues regardless of its `createdAt` age — an
  old-but-still-open WO disappearing from the active board because it aged out of a row-count cap would
  be a dispatch failure, not a cosmetic one.
- `ControlTower.jsx`'s phase counts (`byPhase()`) and technician availability counts must reflect the
  true total, not a windowed subset — this is the aggregate half of the crux above.
- A work order scheduled inside the calendar week currently being viewed in `SchedulingWorkspace.jsx`
  must appear on that week's board even if it is far outside any reasonable row-count cap ordered by
  `createdAt` (e.g., an old WO rescheduled far in the future).
- The one technician `WorkOrderDetailPage.jsx` needs to resolve for a given WO must resolve by id,
  identically to the Part Master directory case.

### Recommended ruling — Dispatch Queue

Do not put one `limit()` on the shared `subscribeToWorkOrders`/`useFirestoreCollection` primitives as
they exist. Instead:
1. **Split the aggregate need out of `ControlTower.jsx`** into its own read (or, longer-term, a
   server-computed count) so it is never subject to whatever bound the board gets — same rule the
   remediation lane already applied to Operations.
2. **Give the board consumers (`Dispatch`, `DispatcherBoard`, `ControlTower`'s queue half) a
   status-scoped query** (open/active statuses) instead of a row-count cap — the supporting composite
   index (`status ASC, createdAt DESC`) already exists and is unused, so this is close to free.
3. **Give the true list consumers (`WorkOrdersList`, `Jobs`) a paginated, disclosed cap** — they already
   have the filter-group UI to support it.
4. **Give Scheduling a date-window query**, not a row cap — new composite index required
   (`scheduledStart`/`scheduledEnd` on `fieldops_wos`), which is itself a decision (index cost, migration)
   this document is flagging but not making.
5. **Move `WorkOrderDetailPage.jsx`'s technician lookup (and, if reused elsewhere, any other single-id
   technician read) to a direct `getDoc` by id** rather than filtering the full roster client-side.
6. Leave `Technicians.jsx`'s roster read as the lowest-priority item — a generous disclosed cap, not an
   architecture change, is proportionate to its realistic scale.

**Least sure about:** whether Firestore Rules' `isTechnician() && isOwnTechnician(...)` get()-based check
(flagged as unverified in `workOrderService.ts:102-114` for `subscribeAssignedWorkOrders`) would also gate
a new status-scoped `where` query the same way for admin/dispatcher roles — this document did not attempt
to verify Rules behavior, only read the client query shape. Whether a status-scoped query on `fieldops_wos`
is actually authorized for the admin/dispatcher roles that read it today was not checked against
`firestore.rules` and should be confirmed before implementation, not assumed from this analysis.

---

## Cost and index implications (both items)

- **Part Master directory split:** batched `getDoc`/`in`-query reads are cheaper per-call than the current
  full-collection `getDocs` for every directory consumer (1-30 doc reads instead of the whole collection),
  at the cost of more round-trips if ids are resolved one at a time instead of batched — implementation
  detail, not a blocker.
- **Part Master list bound:** existing composite indexes already exist on `parts`
  (`status+internalPartNumber`, `stockingClass+internalPartNumber` — `firestore.indexes.json` ~line
  244-270) that a bounded, ordered list read could use without a new index deploy, though they were built
  for the metadata list runtime (`partIndexList`), not for `fetchPartMasterList`'s current shape.
- **Dispatch board status-scope:** the `status ASC, createdAt DESC` composite index on `fieldops_wos`
  already exists and is unused by the current unfiltered listener — a status-scoped query is closer to
  free than a new build.
- **Scheduling date-window:** would need a new composite index on `fieldops_wos` for a
  `scheduledStart`/`scheduledEnd` range query — not present today. This is itself a Tier-2-adjacent cost
  (index deploy) worth flagging as part of any ruling that adopts the date-window recommendation.
- **Aggregate reads (`partsShadowParityReaders`, Control Tower's counts):** no cost change recommended —
  they stay unbounded by rule, consistent with the remediation lane's Operations-dashboard finding.

---

## What was not established

- Real-world id-list sizes at each `useCanonicalPartNames` mount (needed to choose `getDoc` batching vs.
  `in`-query for the Part Master directory primitive).
- Whether a status-scoped `fieldops_wos` query is authorized under current `firestore.rules` for
  admin/dispatcher roles the same way the unfiltered collection read is today.
- Actual current row counts for `parts` and `fieldops_wos` in production — this document establishes the
  *shape* of the risk (unbounded + presented as complete), not how close either collection already is to
  the point where it matters in practice.

## Verification

No code was changed in this lane — this is an analysis/decision document only, so no test suite applies.
This is stated plainly rather than claiming a run that did not happen.
