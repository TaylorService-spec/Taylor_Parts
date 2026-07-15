---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/inventory-nav-access-alignment.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Sprint Specification: Inventory Operational-Role Access -- Parts Manager, Warehouse Manager, Parts Associate Surfaces

**Architecture Review:** `docs/assessments/inventory-nav-access-alignment.md` -- **APPROVED, 2026-07-13** (Issue #100 / PR #181, merged, merge commit `67795033c2100e63e0574a145b40325d90f64d40`). The Owner-adopted per-role capability matrix, the six architecture decisions, and the resolved Start Purchasing lifecycle gate are all binding inputs to this Specification, restated where relevant rather than re-litigated. This Specification resolves every design question that Assessment left open (catalog/health read mechanism, "relevant history," "warehouse-relevant activity," `employmentStatus` session-state placement, and the assignee-name-resolution question for cross-user oversight) -- none are deferred to the Implementation Plan.

## Executive summary

Three new, dedicated, least-privilege surfaces let a `technician`-security-role Employee with an `ACTIVE`, eligible `operationalRoles` entry reach exactly the Inventory capability their role grants -- nothing more -- without touching the existing `admin`/`dispatcher`-only `/inventory` (Parts) domain, which is unchanged in every respect. Every new read and write is gated by a new, explicit Firestore Rules helper requiring a **reciprocal** Employee/User link, `ACTIVE` employment, and the specific `operationalRoles` value the capability needs -- never a security-role check alone, and never the existing unscoped admin/dispatcher grants extended as-is. No new Firestore index is required anywhere in this Specification. Rules changes for each role are merged, deployed, and confirmed live independently before that role's UI becomes reachable -- three independently-gated tracks, not one combined rollout.

## Sprint objective

An Employee whose security `role` is `technician` but who holds an `ACTIVE`, eligible `operationalRoles` value can sign in and reach exactly the capability set the Owner-adopted matrix grants that role -- and nothing else -- with no nav-visible-but-permission-denied state ever occurring, at any point in the rollout.

## Scope

### 0. Shared infrastructure (no new capability, prerequisite for all three tracks)

- `AuthContext.jsx`'s `resolveEmployeeSession()` gains `employmentStatus` in its returned/exposed session shape, read from the same `employees/{employeeId}` document it already fetches for `operationalRoles` -- no new read, one additional field surfaced from an existing one. Resolves Assessment Open Question #2: client-side, so the UI can proactively state "your account is not currently active" rather than only ever observing a silent Rules denial.
- A new Firestore Rules helper, `reciprocallyLinkedEmployee()`, and a canonical `isActiveOperationalRole(role)` predicate (exact design, "Firestore Rules impact" below) -- every new grant in this Specification, and the existing `canSubmitManualZeroHistoryQuantity()`, are expressed through this one helper, not independently reimplemented per grant.
- `navConfig.js` gains a new, optional per-item field, `operationalRoleAccess: string[]`, and `isNavItemVisible()`/`isDomainVisible()` gain a third parameter, `operationalContext: { operationalRoles, employmentStatus }`, evaluated only when an item declares `operationalRoleAccess` (existing `legacyKey`/`PLACEHOLDER_DEFAULT_ROLES`-gated items are unaffected -- this is a new, additive branch in the same predicate, not a rewrite).
- `seed.mjs` gains three new `DRIVER_ACCOUNTS` entries -- `technicianPartsManager`, `technicianWarehouseManager`, `technicianPartsAssociate` -- each `role: "technician"`, a linked, `ACTIVE`, reciprocally-linked Employee with exactly one eligible `operationalRoles` entry, plus one negative fixture (`technicianIneligible`, no eligible `operationalRoles`) and one broken-linkage fixture (`technicianBrokenLink`, `employeeId` pointing at a nonexistent document).

### 1. `PARTS_MANAGER` surface -- `/inventory-role/manager`

- **Catalog/health.** Reuses `useInventoryLedger()`'s existing query shape verbatim (the full `inventory_transactions` read, client-derived health/urgency) and the static `PARTS_CATALOG`, under a new Rules branch (§ "Firestore Rules impact"). Resolves Assessment Open Question #3: **reused as-is, under a new role-gated branch** -- not a narrower derived view. "Catalog/health" is an Owner-adopted, genuine visibility capability for this role (and `WAREHOUSE_MANAGER`), not a data-minimization concern the way `reorder_requests` History was -- see "Why catalog/health reuses the broad read, while `reorder_requests` does not," below.
- **Parts Manager Queue.** Reuses `useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)` verbatim, under a new Rules branch.
- **Assign eligible Parts Associates.** Reuses `EmployeeAssignmentPicker`/`useAssignableEmployees({ requiredOperationalRole: PARTS_ASSOCIATE })` verbatim (already correctly scoped -- `employmentStatus=="ACTIVE"`, `operationalRoles array-contains "PARTS_ASSOCIATE"`, `userId!=null` -- no change). The Assign write itself gains a new Rules branch.

  > **Correction (recorded post-merge -- PR 1b dependency, missing from this Specification and the Implementation Plan).** This bullet, plus "No Rules change to `employees/{employeeId}` self-read" and "`employees` (full directory): no change, confirmed" below, all assumed the picker's *read* already worked for a `PARTS_MANAGER`. It did not: the `employees/{employeeId}` block allows only `isAdminOrDispatcher()` or self-read, so a `PARTS_MANAGER`'s `useAssignableEmployees` candidate read was **denied**. PR 1b therefore has a previously-unrecorded **read** dependency: a new, least-privilege `employees` read branch letting a `PARTS_MANAGER` read ONLY assignment-candidate docs (`ACTIVE` + `PARTS_ASSOCIATE`-eligible + linked user -- the exact three `buildAssignableEmployeesQuery()` constraints, so the picker's list query is within the grant and needs no new index; never the general directory). Added in a separate, security-reviewed Rules PR (Issue #100). PR 1b stays gated on **that Rules PR** being merged, deployed to production, and confirmed live -- in addition to PR 1a (non-Assign sections) and PR 3a (the Assign *write*).
- **Assigned-work oversight.** Reuses `useReorderRequestsByStatuses([ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS])` verbatim, under a new Rules branch. Assignee display names resolve via the **same already-scoped `useAssignableEmployees({ requiredOperationalRole: PARTS_ASSOCIATE })` result this surface already loads for the Assign picker** -- not `useEmployeeDirectory()`'s unscoped read (§ "Resolving names without widening the Employee directory," below). An assignee not found in that lookup (e.g., assigned before their eligibility changed) renders `"Unknown assignee"`, never a raw uid -- matching `PartsList.jsx`'s existing `resolveAssigneeDisplay()` convention exactly.
- **Relevant -- not global -- History.** A **new** hook, `useReviewedRequestsHistory(uid)`: two independent single-field equality queries, `where("reviewedBy","==",uid)` and `where("assignedBy","==",uid)`, each one-shot `getDocs`, merged and de-duplicated client-side, then client-filtered to the four terminal statuses (`CANCELLED`/`VOIDED`/`RECEIVED`/`REJECTED`) for display. "Relevant" is resolved concretely: **a request this Parts Manager personally reviewed (approved or rejected) or personally assigned** -- not every terminal request system-wide. Single-field equality queries require no composite index (§ "Firestore indexes impact").

### 2. `WAREHOUSE_MANAGER` surface -- `/inventory-role/warehouse`

- **Catalog/health and stock visibility.** The identical read as `PARTS_MANAGER`'s catalog/health (§1) -- one Rules branch condition covers both roles, since both need the same `inventory_transactions`-derived view and the Owner-adopted matrix draws no distinction between "catalog/health" and "stock visibility" at the data-source level (both are the same computed ledger view; there is no second, separate "stock visibility" query to design).
- **Needs Planning / manual reorder.** `RequestReorderControl`'s existing action, entirely unchanged -- already correctly gated by `canSubmitManualZeroHistoryQuantity()` (retrofitted in this Specification to route through the new canonical helper, § "Firestore Rules impact" -- behavior unchanged for every already-valid, `ACTIVE`, reciprocally-linked Employee; only tightens for the invalid/stale-linkage/inactive edge cases decision 9.1 requires fail-closed).
- **Warehouse-relevant activity.** Resolves Assessment Open Question (§11 of the Assessment): **reuses `useInventoryActionsForPart(partId)`'s existing query shape verbatim** (already `partId`-scoped, not a new query design) -- reached by selecting a part from the Catalog/Health view, which opens a read-only "Part Activity" panel (new, minimal component -- not `PartDetail.jsx`) showing that part's `inventory_actions` entries. Gated by one new Rules branch on the existing collection-level read condition. No new query shape; "warehouse-relevant" is resolved as **"activity for a part this role can already see in Catalog/Health,"** not a role-scoped subset of actor/transaction-type.
- **Explicitly excluded, confirmed by this Specification's Rules design containing no branch for any of them:** the Parts Manager Queue read, the Assign write, the assigned-work oversight read, and every purchasing-execution write (Start Purchasing, Post Purchasing Update, Record PO, Void, Mark Received, Cancel).

### 3. `PARTS_ASSOCIATE` surface -- `/inventory-role/mine`

- **Personal Waiting/In Progress.** Reuses `useReorderRequestsAssignedTo(uid, status)` verbatim for both `ASSIGNED_TO_PARTS_ASSOCIATE` and `PURCHASING_IN_PROGRESS`, under the new self-scoped Rules branch (§ "Firestore Rules impact") -- this query shape already exists and is already correctly self-scoped; only the Rules read gate (currently `isAdminOrDispatcher()`-only, with no self branch at all) needs the addition.
- **Exact assigned-request details.** A new, minimal read-only-plus-lifecycle-actions component (not `PartDetail.jsx`, which mounts the full admin/dispatcher action set and the Employee directory) -- reads the single `reorder_requests/{id}` document via `onSnapshot`, gated by the same self-scoped Rules branch, plus the linked `reorder_purchase_orders/{id}`/`reorder_purchase_order_voids/{id}` (read-only, self-scoped Rules branch, § below) for display once a PO exists.
- **Purchasing lifecycle actions -- resolved gate, applied uniformly, and correctly scoped this round.** Start Purchasing, Post Purchasing Update, Record Purchase Order, and Mark Received all call the existing, unmodified domain functions (`startPurchasing()`, `updatePurchasingProgress()`, `receiveReorderRequest()` in `domain/inventoryReorderRequests.js`, and `recordPurchaseOrder()` in `domain/reorderPurchaseOrders.js`) -- **only the Rules authorization condition changes**, per the Assessment's Architecture-Approved resolution: `(isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE")) && auth.uid == assignedToUserId`, identically across all four writes. **Corrected this round:** the prior draft of this Specification mischaracterized three of these four as already assignee-only with no outer admin/dispatcher requirement. In truth, `reorder_requests`' entire `allow update` (`firestore.rules:376-630`) is a single top-level `isAdminOrDispatcher() && (...)` gate shared identically across all eight status-transition branches (Approve/Reject, Assign, Start Purchasing, Post Purchasing Update, Record PO's `reorder_requests` half, Mark Received, Cancel, Void) -- all eight, including these four, currently require `isAdminOrDispatcher()` unconditionally today. This is therefore a real authorization change for all four writes, not three clarifications plus one real fix, and it requires restructuring the shared gate itself -- see "Restructuring `reorder_requests`' `allow update`" under Firestore Rules impact, below, for the exact design (simply adding `|| isActiveOperationalRole("PARTS_ASSOCIATE")` to the existing single shared outer condition would also incorrectly grant Approve/Reject/Assign/Cancel to `PARTS_ASSOCIATE`, which must never happen). Exact status transitions and existing allowed-field validation are unchanged throughout.
- **Explicitly excluded -- confirmed, no Rules branch added for either:** Cancel (`isAdminOrDispatcher()` alone, untouched) and Void Purchase Order (`isAdminOrDispatcher()` **and** assignee, untouched) -- `PARTS_ASSOCIATE` does not gain either, per the Assessment's Architecture Review decision.
- **Explicitly excluded, confirmed by this Specification's Rules design containing no branch for any of them:** the Parts Manager Queue, assigned-work oversight, and Relevant History reads; the Assign write.

## Explicitly out of scope

- **Any change to the existing `admin`/`dispatcher`-only `/inventory` (Parts) domain, `PartsList.jsx`, or `PartDetail.jsx`.** Every new surface is new code, new routes, new components -- the existing pages are not modified by this Specification in any way.
- **The Truck Parts Sale-to-Invoice initiative (Issue #182).** Structurally separate, no dependency in either direction, confirmed again per the Assessment's boundary note.
- **The Inventory Action Log redesign (Issue #152)** -- `useInventoryActionsForPart()`'s query shape is reused as-is for `WAREHOUSE_MANAGER`'s Part Activity panel; no redesign of that collection or its write path.
- **The prior technician-assignee exclusion** (`docs/assessments/inventory-operational-queue.md` decision #4, excluding `technician`-role employees from Parts Associate assignment eligibility generally). Per Architecture decision 9.6, reconsidering it is out of scope here -- this Specification builds the surface a `PARTS_ASSOCIATE`-eligible technician uses *once already assigned*; it does not touch the picker's own eligibility filter.
- **A new "Reorder Work"/"Inventory Health"/"Parts Catalog" top-level page restructuring** (the Issue #154 Assessment's "Live-page architecture finding," adopted as a future direction for the *existing* `admin`/`dispatcher` page) -- unrelated to and untouched by this Specification's three new, separate surfaces.
- **Live, mid-session propagation of role/employment-status changes.** § "Fail-closed behavior" below defines the exact, deliberate behavior instead -- this is a resolved design decision, not a deferred one, but it is not "live sync."

## Technical design

### Reciprocal linkage and the canonical eligibility helper

"Reciprocally linked" is defined precisely: `users/{uid}.employeeId == employeeId` **and** `employees/{employeeId}.userId == uid` -- both directions must agree. A one-directional pointer (e.g., a stale `employeeId` left on a `users` document after the corresponding Employee's own `userId` was reassigned elsewhere) does not satisfy this and fails closed.

```
// firestore.rules -- new helpers, additive, not replacing userData()/isAdminOrDispatcher()

function linkedEmployeeId() {
  return userData().employeeId;
}

function linkedEmployeeData() {
  return get(/databases/$(database)/documents/employees/$(linkedEmployeeId())).data;
}

function reciprocallyLinkedEmployee() {
  return isSignedIn()
    && linkedEmployeeId() != null
    && linkedEmployeeData().userId == request.auth.uid;
}

function isActiveOperationalRole(role) {
  return reciprocallyLinkedEmployee()
    && linkedEmployeeData().employmentStatus == "ACTIVE"
    && linkedEmployeeData().operationalRoles is list
    && linkedEmployeeData().operationalRoles.hasAny([role]);
}
```

`isActiveOperationalRole(role)` is the **one** predicate every grant in this Specification uses -- no grant re-implements reciprocal-link/ACTIVE/role-membership independently. An `operationalRoles` array containing an invalid/unrecognized string never matches any of the three literal role checks (`hasAny([role])` against a specific literal) -- invalid values fail closed automatically, with no separate validation branch required; stated here explicitly as verified, deliberate behavior, not an incidental side effect.

**Retrofit, not a new pattern:** `canSubmitManualZeroHistoryQuantity()` is redefined to use `isActiveOperationalRole()` instead of the existing, looser `hasOperationalRole()` (which checks neither reciprocal linkage nor `ACTIVE` employment):

```
function canSubmitManualZeroHistoryQuantity() {
  return isSignedIn()
    && (userRole() == "admin"
        || isActiveOperationalRole("PARTS_MANAGER")
        || isActiveOperationalRole("WAREHOUSE_MANAGER"));
}
```

Behavior is unchanged for every Employee who was already `ACTIVE` and reciprocally linked (the overwhelming majority, and the only state `provisionEmployeeAccess.js` is capable of producing today) -- it only tightens for the previously-unguarded inactive/mismatched-linkage edge cases, which is a bug fix consistent with Architecture decision 9.1, not a behavior change for any valid Employee.

### Why catalog/health reuses the broad read, while `reorder_requests` History does not

The Assessment's "do not widen wholesale" principle (its §3) was never "no role may ever see broad data" -- it was "do not grant a broad, unscoped read the Owner never evidenced a need for, merely to enable one narrow capability." **Catalog/health is different: it is itself an Owner-adopted capability**, not a side-effect need. `PARTS_MANAGER` and `WAREHOUSE_MANAGER` are meant to see real inventory health data, the same computed view `admin`/`dispatcher` already see -- there is no narrower "derived" version of that view to build that would still satisfy the adopted capability, and inventing one would be manufactured complexity, not least-privilege. The distinction that matters is: **is the broad read itself the adopted capability, or merely an implementation shortcut for a narrower one?** For `inventory_transactions`/catalog-health, it is the former (this Specification grants it deliberately, under its own new Rules branch, distinct from and auditable separately from the `admin`/`dispatcher` grant). For `reorder_requests` History and the Employee directory, it was the latter (the Assessment correctly rejected reusing those broad reads, since the adopted capability was "relevant" history and no cross-user directory need at all).

### Resolving names without widening the Employee directory

`PARTS_MANAGER`'s assigned-work oversight view is the only new surface that resolves another employee's identity. It does so by reusing the `useAssignableEmployees({ requiredOperationalRole: PARTS_ASSOCIATE })` result this same surface already loads for its Assign picker -- every legitimate current assignee is, by construction, drawn from that exact `ACTIVE`+`PARTS_ASSOCIATE`-eligible population, so no second, broader lookup is required. A `Map<userId, displayName>` is built from that already-scoped result; an assignee `userId` not found in it (assigned before their eligibility lapsed, or a data anomaly) renders `"Unknown assignee"` -- never a raw uid, matching `PartsList.jsx`'s existing `resolveAssigneeDisplay()` convention. `useEmployeeDirectory()` is not imported by any new surface in this Specification.

### Union behavior -- an Employee holding multiple `operationalRoles`

Each nav item's `operationalRoleAccess` check is independent and additive: an Employee with `operationalRoles: ["PARTS_MANAGER", "PARTS_ASSOCIATE"]` sees **both** the Parts Manager and My Purchasing subnav items simultaneously -- there is no exclusivity or precedence between roles, and no additional logic is required beyond each item's own independent membership check. This falls out of the design without special-casing; stated explicitly here because the directive calls it out as a case to resolve, not because the mechanism itself is novel.

### `admin`/`dispatcher` behavior -- unchanged, and not reachable through the new routes

`admin`/`dispatcher` sessions never see the three new nav items (`operationalRoleAccess` checks are gated on `role === "technician"` specifically, in addition to the eligibility check -- an `admin`/`dispatcher` session never satisfies that regardless of any `operationalRoles` data an Employee record might also carry) and, if an `admin`/`dispatcher` user navigates to a new route's URL directly, the route redirects to the existing `/inventory` (Parts) domain rather than rendering the narrower role-scoped view -- since that existing surface is already a strict superset of everything the new surfaces offer, this is never a loss of capability for that audience, only a redirect away from a view built for a different one.

### Fail-closed behavior -- loading, broken linkage, inactive employment, invalid roles, direct URLs, concurrent changes

- **Loading:** identical to the existing pattern -- `App.jsx` renders `Loading...` and makes no nav/route decision while `AuthContext`'s `loading` is `true`. No new loading state is introduced; the new nav items simply aren't evaluated until the existing loading gate clears.
- **Broken or unresolved linkage:** `reciprocallyLinkedEmployee()` returns `false` for both a missing `employeeId` and an `employeeId` pointing at a document whose own `userId` doesn't match back -- both fail closed identically, matching `AuthContext.resolveEmployeeSession()`'s existing "denied either way" client-side behavior, now made an explicit, verified Rules-layer property rather than an incidental byproduct of the field never being read.
- **Inactive employment:** `isActiveOperationalRole()` requires `employmentStatus == "ACTIVE"` explicitly -- `INACTIVE`/`TERMINATED`/`ON_LEAVE`/`CONTRACTOR` all fail closed, regardless of what `operationalRoles` otherwise contains.
- **Invalid/unrecognized `operationalRoles` values:** fail closed automatically via `hasAny([role])`'s exact-match semantics, per "Reciprocal linkage and the canonical eligibility helper" above -- no separate enum-validation branch needed or added.
- **Direct URLs:** identical mechanism to the existing `/inventory` gate (§1 of the Assessment) -- an ineligible session gets no matching `<Route>` for any of the three new paths, falling through to the same existing catch-all (`Navigate to="/dashboard"`). No new route-guard component is introduced; the new items are gated by the same `isNavItemVisible`/`isDomainVisible` predicates, now accepting `operationalContext` as a third input.
- **Concurrent role/employment-status changes mid-session:** `AuthContext` resolves session state from `onAuthStateChanged` (sign-in, sign-out, token refresh) -- it is **not** a live listener on the Employee document, matching this app's existing behavior for every other role-derived nav decision (a security-`role` change today doesn't live-propagate to an open tab either). This Specification does not add live Employee-document listening. **The resolved, explicit consequence:** a user who loses eligibility mid-session (role or `operationalRoles` or `employmentStatus` changed by an admin while they have a tab open) may continue to see a stale nav link until their next reload or sign-in -- but **every actual Rules-gated read/write is evaluated against current server state at request time**, independent of client staleness, and fails closed immediately regardless of what the stale UI still shows. This is a deliberate, stated design choice consistent with the rest of the app, not a gap silently introduced by this Specification.

## Firestore Rules impact

**New helpers** (`reciprocallyLinkedEmployee()`, `linkedEmployeeId()`, `linkedEmployeeData()`, `isActiveOperationalRole(role)`), additive alongside the existing `isSignedIn()`/`userRole()`/`isAdminOrDispatcher()`/`userData()`.

**Retrofitted:** `canSubmitManualZeroHistoryQuantity()` now calls `isActiveOperationalRole()` instead of the looser `hasOperationalRole()` (behavior unchanged for every valid, `ACTIVE`, reciprocally-linked Employee -- tightens only the previously-unguarded edge cases, per Architecture decision 9.1).

**New grants on `reorder_requests` READ, `reorder_purchase_orders`/`reorder_purchase_order_voids`, `inventory_transactions`, and `inventory_actions`, each an additive `||` branch on the existing condition -- nothing existing is narrowed or removed:**

- **`reorder_requests` read** (currently `isAdminOrDispatcher()` alone) gains four independent branches:
  - `isActiveOperationalRole("PARTS_MANAGER") && resource.data.status == "READY_FOR_PARTS_MANAGER"` (Parts Manager Queue)
  - `isActiveOperationalRole("PARTS_MANAGER") && resource.data.status in ["ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS"]` (assigned-work oversight)
  - `isActiveOperationalRole("PARTS_MANAGER") && (resource.data.reviewedBy == request.auth.uid || resource.data.assignedBy == request.auth.uid)` (relevant history)
  - `isActiveOperationalRole("PARTS_ASSOCIATE") && resource.data.assignedToUserId == request.auth.uid` (personal Waiting/In Progress, exact assigned details)

  This read-side widening is safe as a simple additive `||` because `allow read` is a single, undifferentiated boolean -- there is no "transition"/branch structure to accidentally cross, unlike `allow update` below.

- **`reorder_purchase_orders` / `reorder_purchase_order_voids` read** (currently `isAdminOrDispatcher()` alone) gains: `|| (isActiveOperationalRole("PARTS_ASSOCIATE") && get(/databases/$(database)/documents/reorder_requests/$(requestId)).data.assignedToUserId == request.auth.uid)`.
- **`inventory_transactions` read** (currently `isAdminOrDispatcher()` alone) gains: `|| isActiveOperationalRole("PARTS_MANAGER") || isActiveOperationalRole("WAREHOUSE_MANAGER")`.
- **`inventory_actions` read** (currently `isAdminOrDispatcher()` alone) gains: `|| isActiveOperationalRole("WAREHOUSE_MANAGER")`. Shape matches the existing grant exactly (collection-level, not per-document-scoped in Rules -- the client's own `where("partId","==",partId)` query, unchanged, is what bounds the result set, identical to how the existing admin/dispatcher grant is also not per-document-scoped).
- **`employees` (full directory, `useEmployeeDirectory()`'s unscoped query):** **no change, confirmed.** No new surface in this Specification imports or relies on it.
- **`reorder_purchase_orders` create (Record PO):** its own, single-condition `allow create` (`firestore.rules:680-706`, not shared with any other action) gains `|| isActiveOperationalRole("PARTS_ASSOCIATE")` alongside its existing `isAdminOrDispatcher()`, ANDed with its unchanged assignee/status/field validation -- this one is a safe additive `||`, same reasoning as the read-side widenings above, since this `allow create` is not shared with any other transition.
- **`reorder_purchase_order_voids` create (Void):** **no change** -- remains `isAdminOrDispatcher() && assignee`, confirmed by omission. Void is its own, separate, single-condition `allow create` (`firestore.rules:728-748`), unaffected by the `reorder_requests` restructuring below.

**No Rules change to:** `employees/{employeeId}` self-read (already correct), `users/{uid}` (unchanged), any Customer/Service-Activity/Financial collection.

### Restructuring `reorder_requests`' `allow update` (corrected this round)

**The prior draft of this Specification was wrong about this block's current structure**, and that error must not be repeated in implementation. `firestore.rules:376-630` today is **one single `allow update` statement**, shaped `isAdminOrDispatcher() && (branch1 || branch2 || ... || branch8) && (pinned-base-fields)` -- the outer `isAdminOrDispatcher()` gates **all eight** status-transition branches identically: Approve/Reject (377-387), Assign (388-400), Start Purchasing (401-415), Post Purchasing Update (416-432), Record PO's `reorder_requests` half (433-468), Mark Received (480-504), Cancel (525-549), and Void's `reorder_requests` half (578-625).

Because that gate is **shared**, simply adding `|| isActiveOperationalRole("PARTS_ASSOCIATE")` to the single outer condition would incorrectly grant `PARTS_ASSOCIATE`-eligible technicians Approve/Reject, Assign, and Cancel too -- all of which must remain `admin`/`dispatcher`-only. **The fix is structural, not additive:** the shared outer `isAdminOrDispatcher()` is removed from its single top-level position, and each of the eight branches gains its own, fully self-contained authorization condition instead -- still combined with `||` into one `allow update`, still ANDed with the unchanged pinned-base-fields tail at the very end. Every existing field-level validation clause inside each branch (the `request.resource.data...`/`resource.data...` checks already documented per-branch in the current `firestore.rules`) is preserved **exactly, unchanged** -- only the actor-authorization clause each branch is prefixed with changes.

```
// firestore.rules -- reorder_requests, allow update, restructured
// (illustrative shape; exact branch bodies are the EXISTING, unchanged
// field-level validation already in firestore.rules:377-630 -- only the
// leading authorization clause of each branch changes, as annotated)

allow update: if
  ( isAdminOrDispatcher()                                    // Approve/Reject -- unchanged, admin/dispatcher only
    && resource.data.status == "PENDING_REVIEW"
    && (...existing PENDING_REVIEW branch body, unchanged...) )
  || ( isAdminOrDispatcher()                                  // Assign -- unchanged, admin/dispatcher only
    && resource.data.status == "READY_FOR_PARTS_MANAGER"
    && request.resource.data.status == "ASSIGNED_TO_PARTS_ASSOCIATE"
    && (...existing Assign branch body, unchanged...) )
  || ( isActiveOperationalRole("PARTS_MANAGER")                // Assign -- NEW, separate PARTS_MANAGER branch
    && resource.data.status == "READY_FOR_PARTS_MANAGER"
    && request.resource.data.status == "ASSIGNED_TO_PARTS_ASSOCIATE"
    && request.resource.data.assignedBy == request.auth.uid
    && (...identical remaining field checks to the branch above...) )
  || ( (isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE"))   // Start Purchasing -- gains the new OR
    && resource.data.status == "ASSIGNED_TO_PARTS_ASSOCIATE"
    && request.resource.data.status == "PURCHASING_IN_PROGRESS"
    && request.auth.uid == resource.data.assignedToUserId
    && (...existing Start Purchasing branch body, unchanged...) )
  || ( (isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE"))   // Post Purchasing Update -- gains the new OR
    && resource.data.status == "PURCHASING_IN_PROGRESS"
    && request.resource.data.status == "PURCHASING_IN_PROGRESS"
    && request.auth.uid == resource.data.assignedToUserId
    && (...existing Post Purchasing Update branch body, unchanged...) )
  || ( (isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE"))   // Record PO (reorder_requests half) -- gains the new OR
    && resource.data.status == "PURCHASING_IN_PROGRESS"
    && request.resource.data.status == "ORDERED"
    && request.auth.uid == resource.data.assignedToUserId
    && (...existing Record PO branch body, unchanged, including the
         existsAfter()/getAfter() cross-document invariant...) )
  || ( (isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE"))   // Mark Received -- gains the new OR
    && resource.data.status == "ORDERED"
    && request.resource.data.status == "RECEIVED"
    && request.auth.uid == resource.data.assignedToUserId
    && (...existing Mark Received branch body, unchanged...) )
  || ( isAdminOrDispatcher()                                  // Cancel -- unchanged, admin/dispatcher only, NOT assignee-restricted
    && (...existing Cancel branch body, unchanged...) )
  || ( isAdminOrDispatcher()                                  // Void (reorder_requests half) -- unchanged, admin/dispatcher AND assignee, double-gated
    && request.auth.uid == resource.data.assignedToUserId
    && (...existing Void branch body, unchanged, including its
         exists()/existsAfter()/getAfter() cross-document invariants...) )
  && request.resource.data.partId == resource.data.partId                     // pinned base fields -- unchanged, applies to every branch
  && request.resource.data.urgency == resource.data.urgency
  && request.resource.data.recommendedQty == resource.data.recommendedQty
  && request.resource.data.requestedBy == resource.data.requestedBy
  && request.resource.data.createdAt == resource.data.createdAt;
```

This is a real, larger Rules diff than "one retrofit plus a handful of additive branches" -- it touches the structure of every branch in this `allow update`, not merely the four `PARTS_ASSOCIATE`-relevant ones, even though five of the eight branches' authorization clauses are unchanged in substance (still `isAdminOrDispatcher()` alone, or `isAdminOrDispatcher()` plus assignee for Void). The Implementation Plan's Rules diff and its verification must treat this as a full-block rewrite requiring line-by-line confirmation that every pre-existing field-level check survives unchanged, not a small additive patch.

## Firestore indexes impact

**None.** Every new query shape in this Specification is a single-field or already-existing equality/`in` filter, reusing query shapes already proven not to require a composite index in this codebase (`status==`, `status in [...]`, `assignedToUserId==`, and the two new single-field queries `reviewedBy==`/`assignedBy==` for Relevant History). No entry is added to `firestore.indexes.json` by this Specification. This is a deliberate design property, not an oversight -- every new hook in "Technical design" above was chosen specifically to reuse an existing query shape or stay single-field, avoiding the C0-style index-deploy dependency the Issue #154 initiative required.

## UI impact

- **Three new top-level nav domains/routes**, visible only to `role === "technician"` sessions with matching, `ACTIVE`, eligible `operationalRoles`: `/inventory-role/manager` (Parts Manager), `/inventory-role/warehouse` (Warehouse Manager), `/inventory-role/mine` (My Purchasing, Parts Associate). None visible to, or needed by, `admin`/`dispatcher`.
- **No change whatsoever** to the existing `/inventory` (Parts) domain, `PartsList.jsx`, or `PartDetail.jsx`.
- **Accessibility:** every new filter/action control carries an accessible name (matching `FilterBar.jsx`'s existing button semantics and native `<button>`/`<input>` elements); loading/error/empty-state transitions in each new surface are announced via `aria-live="polite"` or equivalent, matching the established pattern from the Issue #154 initiative's PR A/PR C.
- **Responsive:** each new surface's tables render inside a horizontally-scrollable container on narrow viewports, matching this project's existing wide-table convention.
- **Explicit states, per surface:** loading, error (rendering the Firestore `err.code`, never a blank table), genuinely-empty (a truthful, surface-specific message -- not a shared generic string), and populated. No new hook introduced by this Specification silently converts a query failure into an empty array.

## Testing strategy

Extends the `run-field-ops-app-vite` Playwright skill's `driver.mjs`, one named command per role: `verify-inventory-role-parts-manager`, `verify-inventory-role-warehouse-manager`, `verify-inventory-role-parts-associate`, plus emulator/SDK-level Rules probes for each new grant (since, per the established WebChannel-multiplexing finding from the Issue #154 initiative, some negative-authorization assertions may need the same real-navigation test-seam pattern PR C's History feature established, rather than network interception).

Required coverage, per role, against the browser/Rules matrix in the Assessment's §12 (restated and made concrete here):

- **Shared/negative cases (all three roles):** ineligible technician denied all three new domains; broken/unresolved-linkage technician denied; inactive-employment technician denied despite otherwise-eligible `operationalRoles`; direct-URL navigation to each of the three new paths, not merely nav-link-absence, for every negative case; `admin`/`dispatcher` sessions never see the three new nav items and are redirected away from their URLs to the existing `/inventory` domain.
- **`PARTS_MANAGER`:** Parts Manager Queue shows exactly the fixture's `READY_FOR_PARTS_MANAGER` requests; Assign succeeds for an eligible `PARTS_ASSOCIATE` candidate and the assignment-eligibility picker excludes ineligible ones (reusing existing, already-tested `useAssignableEmployees()` behavior); assigned-work oversight shows a request assigned to a *different* user, with a resolved display name (not a raw uid, not `useEmployeeDirectory()`); Relevant History shows only requests this account reviewed or assigned, not every terminal request; a second `PARTS_MANAGER` fixture account's own Relevant History does not include the first account's requests; catalog/health renders the same computed data the existing admin/dispatcher view shows for the same fixture.
- **`WAREHOUSE_MANAGER`:** catalog/health renders; manual NEEDS_PLANNING quantity submission succeeds (existing action, reused); Part Activity panel shows a fixture part's `inventory_actions` entries; this account cannot reach the Parts Manager Queue, Assign, or any purchasing-execution action, asserted as SDK-level Rules denials, not merely UI-absence.
- **`PARTS_ASSOCIATE`:** personal Waiting/In Progress shows only this account's own assigned requests, not another Parts Associate's; Start Purchasing/Post Purchasing Update/Record PO/Mark Received each succeed on an assigned fixture request and preserve exact status transitions; a *different* Parts Associate's assigned request is invisible and its lifecycle writes are denied (SDK-level); this account cannot reach the Parts Manager Queue, oversight, or Relevant History; Cancel and Void controls do not render for this account and the underlying writes are denied at the Rules layer if attempted directly (SDK-level probe).
- **Rules-only regression:** every existing `admin`/`dispatcher` read/write in "Firestore Rules impact" above is unchanged -- re-run `verify-pr-a`, `verify-service-activity`, `verify-inventory-health-catalog`, `verify-cancel-void`, and `verify-history` against the retrofitted Rules to confirm no admin/dispatcher regression from the `canSubmitManualZeroHistoryQuantity()` retrofit or any new branch.

## Rollback strategy

- **Rules changes (all additive `||` branches, one retrofit):** reverting the Rules file removes every new grant and restores `canSubmitManualZeroHistoryQuantity()`'s prior condition -- no data is altered by any grant in this Specification (every new grant is read-only or reuses an existing, unmodified write path), so a Rules revert is a clean, immediate, no-data-consequence rollback.
- **UI (three new surfaces):** each is new, additive code with no shared file modification to the existing `/inventory` domain -- reverting any one, or all three, leaves the existing Parts domain and every other surface in this codebase untouched.
- **Per-role independence:** because the three tracks are independently gated (§ "Sequencing"), a problem discovered in one role's rollout (e.g., `PARTS_MANAGER`) does not require rolling back the other two, which may already be live and correct.

## Acceptance criteria

- [ ] `AuthContext.jsx` exposes `employmentStatus` in session state, read from the existing Employee document fetch.
- [ ] `firestore.rules` gains `reciprocallyLinkedEmployee()`/`isActiveOperationalRole(role)`; `canSubmitManualZeroHistoryQuantity()` is retrofitted to use it; every grant in "Firestore Rules impact" above is present, each as an additive branch, with zero removal/narrowing of any existing `admin`/`dispatcher` condition.
- [ ] Cancel and Void gain no new branch anywhere in the Rules diff -- confirmed by `git diff firestore.rules` containing no change to either condition.
- [ ] No `firestore.indexes.json` change anywhere in this Specification's implementation -- confirmed via an empty diff on that file for every PR in the sequencing below.
- [ ] `navConfig.js`/`App.jsx` gain the three new domains/routes, each gated by `role === "technician"` plus `isActiveOperationalRole`-equivalent client-side eligibility (`operationalRoles`/`employmentStatus` from `AuthContext`) -- the existing `/inventory` domain's own gating is unchanged, confirmed by diff.
- [ ] Each of the three new surfaces reuses the exact existing hook/query shape named in "Scope" above wherever one exists (`useReorderRequestsByStatus`, `useReorderRequestsByStatuses`, `useReorderRequestsAssignedTo`, `useAssignableEmployees`, `useInventoryLedger`, `useInventoryActionsForPart`) -- confirmed by code review that no duplicate reimplementation of any of these exists.
- [ ] `PARTS_MANAGER`'s assigned-work oversight resolves assignee names via the same `useAssignableEmployees()` result already loaded for its Assign picker -- confirmed `useEmployeeDirectory()` is not imported anywhere in the three new surfaces.
- [ ] `reorder_requests`' `allow update` is restructured so each of its eight status-transition branches carries its own, fully self-contained authorization condition (no shared top-level gate) -- confirmed by code review that Start Purchasing/Post Purchasing Update/Record PO/Mark Received each independently read `(isAdminOrDispatcher() || isActiveOperationalRole("PARTS_ASSOCIATE")) && assignee`, while Approve/Reject/Assign(admin branch)/Cancel remain `isAdminOrDispatcher()` alone and Void remains `isAdminOrDispatcher() && assignee`, with every pre-existing field-level validation clause byte-for-byte unchanged inside each branch.
- [ ] `PARTS_ASSOCIATE`'s four lifecycle writes share one uniform Rules condition; Cancel/Void render no control and are denied at the Rules layer if attempted directly -- verified specifically as an SDK-level probe that a `PARTS_ASSOCIATE`-eligible technician assignee's Cancel/Void attempts are denied even though their Start Purchasing/Post Purchasing Update/Record PO/Mark Received attempts on the same request succeed, proving the restructuring did not leak authorization across branches.
- [ ] Fail-closed behavior (loading, broken linkage, inactive employment, invalid `operationalRoles`, direct URL, and the stated concurrent-change posture) is verified per the Testing strategy's negative-case matrix, for all three roles.
- [ ] An Employee holding multiple eligible `operationalRoles` sees the union of the corresponding nav items, verified with a dedicated multi-role fixture.
- [ ] `admin`/`dispatcher` sessions never see the three new nav items and are redirected away from their direct URLs to the existing `/inventory` domain.
- [ ] `npm run build && npm run lint` / `npx tsc --noEmit` clean for every PR in the sequencing below.
- [ ] Full regression suite (`verify-pr-a`, `verify-service-activity`, `verify-financial-summary`, `verify-notification-identity`, `verify-inventory-health-catalog`, `verify-cancel-void`, `verify-history`) passes clean against the retrofitted Rules before any UI PR merges.
- [ ] Each role's Rules PR is merged, deployed to production, and confirmed live (via an SDK/driver-level probe proving the new grant works and every excluded capability is still denied) **before** that role's corresponding UI PR merges -- verified per role, not once globally.

## Expected file scope (exact, per PR)

- **PR 0 (shared infrastructure, no new capability):** `field-ops-app-vite/src/auth/AuthContext.jsx` (`employmentStatus` exposure); `field-ops-app-vite/src/navigation/navConfig.js`, `App.jsx` (`operationalRoleAccess` field/parameter, no existing item changed); `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs` (five new `DRIVER_ACCOUNTS` fixtures). No `firestore.rules`/`firestore.indexes.json` change.
- **PR 1a (Rules -- `PARTS_MANAGER`):** `firestore.rules` only (helpers + the four `PARTS_MANAGER`-related grants + the `canSubmitManualZeroHistoryQuantity()` retrofit, since it's shared groundwork best landed once). Deployed, confirmed live, verified via SDK/driver probes before PR 1b.
- **PR 1b (UI -- `PARTS_MANAGER`):** new route/component tree under `field-ops-app-vite/src/modules/inventory-role/manager/` (exact internal file layout is an Implementation Plan detail); `hooks/useReorderRequests.js` (`useReviewedRequestsHistory`); `driver.mjs`/`seed.mjs` fixture and command additions for this role's browser coverage.
- **PR 2a (Rules -- `WAREHOUSE_MANAGER`):** `firestore.rules` only (`inventory_transactions` and `inventory_actions` grants). Deployed, confirmed live, verified before PR 2b.
- **PR 2b (UI -- `WAREHOUSE_MANAGER`):** new route/component tree under `.../inventory-role/warehouse/`; `driver.mjs`/`seed.mjs` additions.
- **PR 3a (Rules -- `PARTS_ASSOCIATE`):** `firestore.rules` only -- the `reorder_requests` `allow update` restructuring (§ "Restructuring `reorder_requests`' `allow update`", a full-block rewrite touching all eight status-transition branches' structure, though only four change in authorization outcome), the `reorder_purchase_orders` create widening, and the two self-scoped reads (`reorder_requests`, `reorder_purchase_orders`/`reorder_purchase_order_voids`). Deployed, confirmed live, verified before PR 3b -- verification must include the full existing regression suite (per Testing strategy) specifically because this PR's diff touches Approve/Reject/Assign/Cancel/Void's surrounding structure even though their own authorization outcome is unchanged.
- **PR 3b (UI -- `PARTS_ASSOCIATE`):** new route/component tree under `.../inventory-role/mine/`; `driver.mjs`/`seed.mjs` additions.

## Sequencing

Unchanged in structure from the Assessment's own Sequencing section, now expressed as concrete PRs above: **PR 0 first** (shared infrastructure, no Rules/capability change), then the three role tracks (`1a→1b`, `2a→2b`, `3a→3b`), each independently gated by a verified production Rules deployment before its own UI PR merges. The three role tracks may proceed in parallel relative to each other -- nothing in the adopted matrix makes one role's grant a prerequisite for another's -- but within each track, the Rules-then-UI gate is binding, independently, per Architecture decision 9.5.

## Risks

- **The `canSubmitManualZeroHistoryQuantity()` retrofit is a behavior change for a live, already-shipped Rules function**, even though this Specification asserts it's behavior-preserving for every valid Employee. PR 1a's verification must include an explicit regression assertion (an already-`ACTIVE`, reciprocally-linked `PARTS_MANAGER`/`WAREHOUSE_MANAGER` Employee's existing manual-entry capability is unaffected) alongside the new tightening's negative cases, not merely assume backward compatibility from the code's logic.
- **Corrected this round -- the `reorder_requests` `allow update` restructuring is a full-block rewrite, not four small additive branches.** The prior draft understated this: it claimed Post Purchasing Update, Record Purchase Order, and Mark Received were already assignee-only with no outer admin/dispatcher requirement, when in fact all eight status-transition branches share one single `isAdminOrDispatcher()` gate today (`firestore.rules:376-630`). PR 3a's diff touches every branch's structure (moving the authorization clause from a single shared position into each of the eight branches individually), even though five of the eight branches' actual authorization outcome is unchanged (Approve/Reject/Assign-admin-branch/Cancel stay admin/dispatcher-only; Void stays admin/dispatcher-and-assignee). Verification must confirm, branch by branch, that every pre-existing field-level validation clause survived the restructuring unchanged -- a line-by-line diff review, not a spot-check of the four `PARTS_ASSOCIATE`-relevant branches alone.
- **Six independent new Rules branches across four collections (`reorder_requests` read, `reorder_purchase_orders`/`reorder_purchase_order_voids` read and create, `inventory_transactions`, `inventory_actions`) plus the `reorder_requests` `allow update` restructuring is real, auditable surface area** -- each must be verified individually (per the Testing strategy's SDK-level negative-case matrix) rather than treated as one undifferentiated "Inventory operational-role access" change, consistent with why this Specification keeps the three tracks separately gated rather than merging all Rules work into one PR.
- **`PARTS_MANAGER`'s Relevant History reads two collections' worth of fields (`reviewedBy`, `assignedBy`) that exist on `reorder_requests` today but have never before been queried against directly** (only read incidentally as display fields) -- the Implementation Plan must confirm both fields are reliably populated on every historical document the fixture/production data actually contains, or Relevant History could silently under-report for older records written before either field was consistently set.
- **Redirecting `admin`/`dispatcher` away from the new routes to the existing `/inventory` domain** is a deliberate UX choice (§ "Technical design") but changes what an `admin`/`dispatcher` user experiences if they ever guess/bookmark one of the new URLs -- worth confirming this redirect, not a permission error, is what actually renders, since a permission-error page for an `admin`/`dispatcher` account would be confusing and technically wrong (they're not denied, they're just not the intended audience).

## Open questions

None blocking Implementation Plan drafting. Every design question the Assessment left open is resolved above: catalog/health reuses the existing broad read under a new role-gated branch (not a narrower derived view); "relevant history" is `reviewedBy`/`assignedBy` equality, not a broader relevance heuristic; "warehouse-relevant activity" reuses the existing per-part `inventory_actions` query verbatim; `employmentStatus` is added to client-side `AuthContext` state; assignee-name resolution for `PARTS_MANAGER`'s oversight view reuses the existing scoped `useAssignableEmployees()` result rather than the Employee directory; the Start Purchasing lifecycle gate is the Assessment's own Architecture-Approved resolution, applied uniformly here (correctly, this round, via a full per-branch restructuring of `reorder_requests`' `allow update` rather than an additive branch on its shared outer gate -- see "Restructuring `reorder_requests`' `allow update`" and the corrected Risks entry above); and multi-role union behavior requires no special-case logic.

## Approval

Not yet reviewed. Per `docs/ai/workflow.md`'s stage 4/5, this Specification is submitted for Specification Review following the Architecture-Approved Assessment (PR #181, merged). No code, Rules, index, deployment, or production-data change has been made while producing this document -- planning only.
