---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-13
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Assessment Report: Inventory Navigation/Access Alignment (`ROLES.TECHNICIAN` has no Inventory nav access, independent of `operationalRoles` eligibility)

**Business Request:** Issue #100. An Employee may hold `operationalRoles: ["PARTS_MANAGER"]` or `["WAREHOUSE_MANAGER"]`, and `firestore.rules`' `canSubmitManualZeroHistoryQuantity()` correctly authorizes that operational role independently of the caller's security `role`. But a user whose security `role` is `technician` cannot reach the Inventory screen at all, because `navConfig.js`'s nav-gating (and, as this assessment finds, the route-mounting logic built on the same predicate) never consults `operationalRoles`. A pure-technician Parts Manager — a real org shape — is locked out by navigation/routing alone, not by any Rules or eligibility logic. This assessment investigates the current implementation with no code, Rules, index, schema, production-data, or deployment change.

**Revision note (this round):** §2 (round 2) added a complete `PartsList.jsx`/`PartDetail.jsx` surface matrix and recommended granting every eligible operational role the *identical* minimal capability set (manual entry + two narrow reads), finding no distinction in the current authorization model between `PARTS_MANAGER` and `WAREHOUSE_MANAGER`. **This round replaces that "identical minimal capability" conclusion with an Owner-adopted, per-role capability matrix (new §4a)** — the three operational roles are differentiated, each with a distinct, real set of query/action grants, not one shared minimal bundle. §7, §9, §11, §12, the Sequencing section, and the Recommended design are all revised accordingly. A boundary note (new §13) records a related-but-separate future initiative (truck parts sale-to-invoice) explicitly out of scope here.

## Scope of this assessment

Investigated: `field-ops-app-vite/src/domain/constants.js` (`ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE`), `field-ops-app-vite/src/navigation/navConfig.js`, `field-ops-app-vite/src/App.jsx` (routing), `field-ops-app-vite/src/auth/AuthContext.jsx`, `field-ops-app-vite/src/modules/inventory/PartsList.jsx` and `PartDetail.jsx` in full (every section, hook, and action), `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx`, `field-ops-app-vite/src/hooks/useAssignableEmployees.js`, `useEmployeeDirectory.js`, `useInventoryLedger.js`, `useInventoryActions.js`, `useReorderPurchaseOrders.js`, `useReorderPurchaseOrderVoids.js`, `field-ops-app-vite/src/domain/employees.js`, `firestore.rules` in full for every collection these two pages touch, `functions/scripts/provisionEmployeeAccess.js`, and the driver/seed test infrastructure (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs`, `seed.mjs`, `SKILL.md`).

Explicitly **not** investigated or addressed here:
- The broader manager-oversight/queue-visibility work from Issue #154 (PRs #164/#168/#173/#177) — that initiative explicitly deferred "any change broadening `reorder_requests` visibility to non-admin/dispatcher sign-in roles" to this issue, so this assessment picks that thread up rather than re-litigating it.
- The Inventory Action Log (`inventory_actions`) redesign (Issue #152) — its read/write surface is inventoried in §2 below only because `PartDetail.jsx` mounts it, not because this assessment proposes changing it.
- Truck parts sale-to-invoice / consumption from an assigned truck by a base Technician — a related but structurally separate future initiative, recorded as Issue #182 and named in the boundary note (§13). No access model for it is proposed here.
- Any other domain's (Customer, Service Activity, Financial) nav/route gating — this assessment is Inventory-scoped only.

No application code, Firestore Rules, index, schema, deployment, or production-data change was made while producing this assessment — read-only investigation only.

## Current repository state

### 1. Current navigation and route gating

`ROLE_NAV_ACCESS` — the actual source of truth for who sees what — lives in `field-ops-app-vite/src/domain/constants.js:245-263`, not in `navConfig.js` itself:

```js
export const ROLES = {
  ADMIN: "admin",
  DISPATCHER: "dispatcher",
  TECHNICIAN: "technician",
};

export const ROLE_NAV_ACCESS = {
  [ROLES.ADMIN]: ["controlTower", "jobs", "technicians", "dispatch", "fieldMode", "inventory", "operations", "dispatcherBoard"],
  [ROLES.DISPATCHER]: ["controlTower", "jobs", "technicians", "dispatch", "inventory", "operations", "dispatcherBoard"],
  [ROLES.TECHNICIAN]: ["fieldMode", "jobs", "technicianDashboard"],
};
```

`technician`'s allowed legacy keys never include `"inventory"`; both `admin` and `dispatcher` do.

`navConfig.js:163-176` defines `isNavItemVisible()`/`isDomainVisible()`, both driven by `ROLE_NAV_ACCESS`'s `allowedLegacyKeys` (for items/domains with a `legacyKey`) or `PLACEHOLDER_DEFAULT_ROLES = ["admin", "dispatcher"]` (for items/domains without one). The Inventory domain's `parts` subnav item carries `legacyKey: "inventory"`; every sibling item falls to `PLACEHOLDER_DEFAULT_ROLES`. Either path, `isDomainVisible(inventoryDomain, "technician", [])` is `false`.

**Route gating is not a separate layer from nav visibility — it is the identical predicate, reused.** `App.jsx` builds `<Route>` elements from the same calls (`App.jsx:117-133`, `171-179`). An ineligible role gets no matching `<Route>` mounted at all for `/inventory` or `/inventory/:partId` — react-router falls through to the catch-all (`App.jsx:191`, `Navigate to="/dashboard"`). A `technician` typing the URL directly is silently redirected, with no permission-denied page and no distinguishable signal that Inventory exists but is off-limits.

**Conclusion:** there is exactly one gate, applied twice (nav rendering and route mounting) from one source of truth, keyed only on security `role`. `operationalRoles` never enters this decision. That gate is also all-or-nothing at the page level: "reachable" and "renders `PartsList.jsx`/`PartDetail.jsx` in full" are the same thing today. §2 inventories what "in full" means; §7 revises the recommendation around per-role, per-capability grants rather than page-level reachability.

### 2. Complete surface/read/action matrix — `PartsList.jsx` and `PartDetail.jsx`

Every row below is a genuinely separate Firestore read or write, each with its own `firestore.rules` gate — the manual-reorder-entry flow is one of roughly a dozen.

#### 2a. `PartsList.jsx` — every rendered section

| Section | Hook | Collection | Query shape | User action |
|---|---|---|---|---|
| Inventory Operational Queue (Critical & High / Needs Planning tabs) | `useInventoryLedger()` | `inventory_transactions` | One-shot, **entire collection, no filter** | "Request Reorder" → **creates** a `reorder_requests` doc |
| — (de-dup check) | `useReorderRequests()` | `reorder_requests` | `where("status","==","PENDING_REVIEW")`, realtime | none |
| Parts Manager Queue | `useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)` | `reorder_requests` | `where("status","==",...)`, realtime, cross-user | Navigate only |
| Parts Associate Waiting | `useReorderRequestsAssignedTo(uid, ASSIGNED_TO_PARTS_ASSOCIATE)` | `reorder_requests` | `where("assignedToUserId","==",uid) && where("status","==",...)`, **self-scoped** | Navigate only |
| Parts Associate In Progress | `useReorderRequestsAssignedTo(uid, PURCHASING_IN_PROGRESS)` | `reorder_requests` | Same shape, **self-scoped** | Navigate only |
| All Assigned Work (manager oversight) | `useReorderRequestsByStatuses([ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS])` | `reorder_requests` | `where("status","in",[...])`, **no assignee filter — every user's assignments** | Navigate only |
| Parts Catalog | static `PARTS_CATALOG` + `useInventoryLedger()` | `inventory_transactions` (shared read) | — | Navigate only |
| History | `useReorderRequestsHistory(...)` + `useReorderRequestById()` | `reorder_requests` | `where("status","in",[CANCELLED,VOIDED,RECEIVED,REJECTED]), orderBy("createdAt","desc")`, **cross-user, cross-status, no scope** | Navigate/paginate/lookup only |

#### 2b. `PartDetail.jsx` — every write action

| Action | Writes to | `firestore.rules` gate | Scope |
|---|---|---|---|
| Approve / Reject | `reorder_requests/{id}` update | `isAdminOrDispatcher()` (outer gate) | Any admin/dispatcher |
| Assign | `reorder_requests/{id}` update | `isAdminOrDispatcher()` + `assignedBy == auth.uid` | Any admin/dispatcher |
| Start Purchasing | `reorder_requests/{id}` update | `isAdminOrDispatcher()` **AND** `auth.uid == assignedToUserId` (double-gated — the outer admin/dispatcher requirement is why an assignee-only Parts Associate cannot use this today even if reachable) | Assignee **and** admin/dispatcher |
| Post Purchasing Update | `reorder_requests/{id}` update | `auth.uid == assignedToUserId` only | Assignee only |
| Record Purchase Order | Atomic: `reorder_purchase_orders/{requestId}` create + `reorder_requests/{id}` → `ORDERED` | `auth.uid == assignedToUserId`, `status == PURCHASING_IN_PROGRESS` | Assignee only |
| Void Purchase Order | `reorder_purchase_order_voids/{requestId}` create + `reorder_requests/{id}` → `VOIDED` | `isAdminOrDispatcher()` **AND** assignee, double-gated | Assignee **and** admin/dispatcher |
| Mark Received | `reorder_requests/{id}` → `RECEIVED` | `auth.uid == assignedToUserId` only | Assignee only |
| Cancel | `reorder_requests/{id}` → `CANCELLED` | `isAdminOrDispatcher()` alone | Any admin/dispatcher |
| Manual quantity entry (`RequestReorderControl`) | Creates `reorder_requests` doc | `canSubmitManualZeroHistoryQuantity()` | **Already operational-role-aware** |
| Inventory Action Log entry | Creates `inventory_actions` doc | `isAdminOrDispatcher()` | Any admin/dispatcher |

Reads backing these actions on `PartDetail.jsx` (for the assignee's own request): the request document itself (currently only reachable via `isAdminOrDispatcher()` — **no self/assignee read branch exists on `reorder_requests` today**, per §11); `usePurchaseOrderForReorderRequest()`/`useReorderPurchaseOrderVoid()` (`reorder_purchase_orders`/`reorder_purchase_order_voids`, doc-id = request id, currently `isAdminOrDispatcher()`-only read, no self/assignee branch either).

#### 2c. Cross-user, unscoped reads

Both files call `useEmployeeDirectory()`, backed by `buildEmployeeDirectoryQuery()` (`domain/employees.js:51-53`) — **`query(employeesRef)` with zero `where` clauses: every document in `employees`**, unfiltered. Gated by `firestore.rules:199`, `isAdminOrDispatcher() || self`. `useAssignableEmployees()`'s query (`domain/employees.js:24-36`) **is** already scoped (`employmentStatus=="ACTIVE"`, `operationalRoles array-contains role`, `userId!=null`) — the right model to imitate.

### 3. Every affected collection and permission, by capability

Restructured this round to key off the Owner-adopted role matrix (§4a) rather than a single blanket "do not widen" posture. **No row below proposes granting any role the same unfiltered/unscoped read admin/dispatcher has** — every grant is either an already-correct existing gate, or a new, narrowly-scoped Rules branch keyed to a specific `operationalRoles` value plus `ACTIVE` employment (decision 9.1).

| Collection / query shape | Current gate | Needed for | New grant required? |
|---|---|---|---|
| `reorder_requests`, NEEDS_PLANNING create | `canSubmitManualZeroHistoryQuantity()` | PARTS_MANAGER, WAREHOUSE_MANAGER | No — already correct |
| `reorder_requests`, `status == READY_FOR_PARTS_MANAGER` (Parts Manager Queue) | `isAdminOrDispatcher()` only | **PARTS_MANAGER only** | Yes — new read branch: `hasOperationalRole("PARTS_MANAGER") && ACTIVE`, reusing the existing `useReorderRequestsByStatus()` query shape (already narrow/parameterized) |
| `reorder_requests`, Assign write (`READY_FOR_PARTS_MANAGER → ASSIGNED_TO_PARTS_ASSOCIATE`) | `isAdminOrDispatcher()` + `assignedBy==uid` | **PARTS_MANAGER only** | Yes — new write branch for the same role/employment condition |
| `employees`, `useAssignableEmployees({requiredOperationalRole: PARTS_ASSOCIATE})` (eligible-associate lookup for Assign) | Already scoped, admin/dispatcher-consumed today | **PARTS_MANAGER only** | Reuse as-is — already correctly scoped, no widening; only the *consumer* (who may call it) needs a new Rules branch matching this role |
| `reorder_requests`, `status in [ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS]` (All Assigned Work / oversight) | `isAdminOrDispatcher()` only | **PARTS_MANAGER only** | Yes — new read branch, same role/employment condition. This is a deliberate, Owner-adopted cross-user grant, not an accidental one — see §7 |
| `reorder_requests`, terminal-status History, **scoped to relevance** (not the full unscoped query) | No self-scoped path exists | **PARTS_MANAGER only ("relevant — not global — history")** | Yes — a **new, narrower** query than the existing History hook; exact relevance criterion (e.g. `reviewedBy==uid`, or requests tied to parts the Parts Manager has acted on) is Specification-level design, not resolved here. Explicitly **not** the unscoped `status in [...]` History query PartsList.jsx uses today |
| `inventory_transactions` (or a derived recommendation/stock view) — "catalog/health" and "stock visibility" | `isAdminOrDispatcher()` only, unfiltered | **PARTS_MANAGER and WAREHOUSE_MANAGER** | Yes — new read branch, same role/employment condition. Whether this reuses `useInventoryLedger()`'s existing query shape or a narrower derived read is Specification-level design (Risks section) |
| `inventory_actions`, scoped to "warehouse-relevant activity" | `isAdminOrDispatcher()` only | **WAREHOUSE_MANAGER only** | Yes — a **new, narrower** query than the existing `useInventoryActionsForPart()`'s admin/dispatcher-consumed shape; exact scope (e.g. by transaction type, by part) is Specification-level design |
| Purchasing-management actions (Assign, Start Purchasing's admin/dispatcher branch, Cancel, Void, Approve/Reject) | Various, per §2b | **Explicitly NOT WAREHOUSE_MANAGER** ("no purchasing-management authority") | None — must not be granted to this role under any new branch |
| `reorder_requests`, self-scoped by `assignedToUserId == uid` (Waiting/In Progress, exact assigned details) | **No self-read branch exists today** — read is `isAdminOrDispatcher()`-only, unconditionally, even for the assignee | **PARTS_ASSOCIATE only** | Yes — new read branch: `resource.data.assignedToUserId == request.auth.uid` (combined with `hasOperationalRole("PARTS_ASSOCIATE") && ACTIVE`) |
| `reorder_purchase_orders` / `reorder_purchase_order_voids`, self-scoped read (own request's PO/void record) | `isAdminOrDispatcher()`-only read, no self branch | **PARTS_ASSOCIATE only** | Yes — new read branch, matching the linked request's `assignedToUserId` |
| Start Purchasing write | Currently double-gated: `isAdminOrDispatcher()` **AND** assignee | **PARTS_ASSOCIATE only** | Yes — the outer `isAdminOrDispatcher()` requirement must gain an operational-role branch, or the assignee-only Rules used by Post Purchasing Update/Record PO/Receive (no outer admin/dispatcher requirement) must be extended to Start Purchasing consistently. Specification must resolve this asymmetry explicitly, not silently |
| Post Purchasing Update, Record Purchase Order, Mark Received writes | Assignee-only already (`auth.uid==assignedToUserId`, no outer admin/dispatcher requirement) | **PARTS_ASSOCIATE only** | Likely none at the write layer once reachable — these already work for any assignee regardless of security role; reachability (nav/route) is the actual gap for this role, not Rules, for these three actions specifically |
| Void Purchase Order write | Double-gated: `isAdminOrDispatcher()` **AND** assignee | **PARTS_ASSOCIATE, if "authorized PO actions" includes Void** | Open question (§14) — the double-gate is a deliberate existing design (`docs/assessments/inventory-operational-queue.md` precedent); whether it should gain an operational-role branch alongside/instead of the admin/dispatcher branch is not decided here |
| `reorder_requests`, Parts Manager Queue / All Assigned Work / full History | `isAdminOrDispatcher()` only | **Explicitly NOT PARTS_ASSOCIATE** ("no manager queue, cross-user oversight, or global history") | None |
| `employees` (full unscoped directory, `useEmployeeDirectory()`) | `isAdminOrDispatcher()` unconditional | **No role in the adopted matrix** | None — not granted to any operational role by this assessment |
| Ineligible technician (no `operationalRoles`, or none matching any of the above) | — | **No general Inventory access, any capability** | None — unchanged from today |

### 4. Employee `operationalRoles` versus security `role` authority

Three distinct fields across two documents:

- **`users/{uid}.role`** — the security role (`admin`/`dispatcher`/`technician`). The sole input to `ROLE_NAV_ACCESS` and `isAdminOrDispatcher()`.
- **`employees/{employeeId}.operationalRoles`** (array: `PARTS_MANAGER`/`WAREHOUSE_MANAGER`/`PARTS_ASSOCIATE`) — an assignment/task-eligibility marker, independent of security role.
- **`employees/{employeeId}.securityRole`** — a read-only mirror of `users/{uid}.role`, "NEVER a source of authorization."

`RequestReorderControl.jsx:23-46` is the one place client-side eligibility logic already reads `operationalRoles` (`role===ADMIN || operationalRoles.includes(PARTS_MANAGER) || operationalRoles.includes(WAREHOUSE_MANAGER)`) — blind to `isAdminOrDispatcher()`, correct once reached.

### 4a. Owner-adopted role capability matrix (this round — supersedes the prior "identical minimal capability" conclusion)

The prior round found no *existing* distinction between `PARTS_MANAGER` and `WAREHOUSE_MANAGER` in today's Rules/client logic, and recommended granting both the same minimal bundle on that basis. That finding about *today's code* was accurate; the recommendation drawn from it is superseded here by an explicit Owner decision to differentiate all three operational roles going forward:

| Role | May see | May do | Explicitly excluded |
|---|---|---|---|
| **`PARTS_MANAGER`** | Catalog/health (Parts Catalog + Inventory Health); the Parts Manager Queue (`READY_FOR_PARTS_MANAGER`); assigned-work oversight (`ASSIGNED_TO_PARTS_ASSOCIATE`/`PURCHASING_IN_PROGRESS`, cross-user); relevant — not global — History | Submit manual NEEDS_PLANNING quantities (existing); assign eligible Parts Associates to `READY_FOR_PARTS_MANAGER` requests | Purchasing-execution actions (Start Purchasing, Record PO, Void, Receive) — those belong to the assignee, not the manager who assigned the work |
| **`WAREHOUSE_MANAGER`** | Catalog/health; stock visibility; warehouse-relevant activity | Submit manual NEEDS_PLANNING quantities (existing) | **No purchasing-management authority** — no Parts Manager Queue, no Assign, no oversight view, no purchasing-execution actions |
| **`PARTS_ASSOCIATE`** | Personal Waiting/In Progress (their own assignments only); exact details of a request assigned to them | Purchasing progress updates and authorized PO actions (Post Purchasing Update, Record Purchase Order, Mark Received; Void PO status TBD, §14) on requests assigned to them | **No Parts Manager Queue, no cross-user oversight, no global History** |
| **Technician, no active eligible `operationalRoles`** | Nothing Inventory-related | Nothing | **No general Inventory access at all** — unchanged from today |

`admin`/`dispatcher` access is unchanged throughout (decision 9.2) — this matrix describes only the new, additive `operationalRoles`-derived access paths.

### 5. Why an eligible technician cannot reach Inventory (mechanism)

`ROLE_NAV_ACCESS[ROLES.TECHNICIAN]` never includes `"inventory"`, and `App.jsx`'s route tree is built from the identical predicate, so `/inventory` does not exist for a `technician` session regardless of `operationalRoles`. The gap is structurally earlier than any eligibility logic — the nav/route layer decides reachability using `role`, which has no relationship to `operationalRoles`. Already documented, unfixed, in `seed.mjs:634-644`, `SKILL.md`'s Gotchas, and `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4.

### 6. Loading, unresolved, and broken Employee/User linkage behavior

`AuthContext.jsx`'s `resolveEmployeeSession(uid)`: one-shot `getDoc(users/{uid})`; if `employeeId==null`, returns immediately with empty operational identity ("a valid, expected migration state, not an error"); if `employeeId` present but the Employee doc doesn't exist, `console.warn`s and returns the same empty shape; otherwise returns `role`/`employeeId`/`displayName`/`operationalRoles`.

**Unresolved and broken linkage are, today, indistinguishable in effect**, and neither affects nav/route gating since `operationalRoles` is never read there. Per decision 9.3, any new access path must fail closed on both states explicitly, not merely inherit today's incidental "denied either way" as a byproduct of the field never being consulted.

### 7. Redefining "capability-scoped" — per-role component/query/action design, with a design comparison

§2/§3/§4a together establish that "capability-scoped" now means: **for each of the three operational roles, a distinct, individually-reasoned set of query/action grants — not one shared minimal bundle, and not the shared `PartsList.jsx`/`PartDetail.jsx` pages with conditional sections.**

**Design (a) — dedicated, role-specific surfaces.** New routes/components, separate from `PartsList.jsx`/`PartDetail.jsx`, one per role's capability set from §4a. Each surface's reads may **reuse existing, already-parameterized query-building hooks** where the query shape itself matches (e.g. `useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)` for the Parts Manager Queue, `useReorderRequestsByStatuses([...])` for oversight, `useAssignableEmployees()` for the eligible-associate lookup — all already narrow, parameterized, and well-understood) — reusing a *hook*, which is just a parameterized query builder, is not the same risk as reusing a *shared page* with conditional rendering. What each surface must **not** do is reuse `useEmployeeDirectory()`'s unscoped read, `useInventoryLedger()`'s literal unfiltered call as-is without a new Rules branch reasoned specifically for that role, or the shared components themselves. Every reused hook still requires its own **new**, role-and-employment-conditioned Rules branch (per §3) — reusing the hook's query shape is not the same as inheriting its existing admin/dispatcher-only grant.

**Design (b) — the shared `PartsList.jsx`/`PartDetail.jsx` pages, with conditional sections and disabled hooks.** Rejected for the same reason as the prior round: a hook left un-gated by a missed conditional still fires its query, and once the underlying Rules are widened at all (as §3 now requires for several query shapes, given the richer adopted matrix), every other unconditionally-reused hook on the same shared page silently inherits reachability to that widened grant — the exact "widening the full Employee directory or all Reorder Request history merely to enable one capability" failure mode the directive warns against, now with *more* surface area to accidentally leak than the prior round's narrower recommendation had.

**Recommendation: Design (a), per role — three distinct, dedicated surfaces (or, if a Specification finds it cleaner, one shell route with three independently-gated, role-conditional sections, provided each section's own hooks/Rules grants remain individually reasoned exactly as if it were a separate route).** The critical property, regardless of exact componentization chosen at Specification time, is: **every read/write in §3's table gets its own explicit, role-and-employment-conditioned Rules branch — never a shared grant reused across roles or inherited from the admin/dispatcher-shaped hooks as-is.**

### 8. Route-level enforcement, not navigation visibility alone

Unchanged finding: nav and route are the same predicate (§1). Each new role-specific surface gets its own nav item and route, gated by that role's specific eligibility input (operational role + `ACTIVE` employment, decision 9.1) — the existing `parts`/Inventory-domain item and route remain untouched, still `admin`/`dispatcher`-only exactly as today (decision 9.2).

### 9. Architecture decisions adopted

Binding constraints on any Specification/Implementation Plan that follows this assessment:

1. **Operational-role-derived access requires `ACTIVE` employment.** No `operationalRoles` value grants any capability in §4a unless the linked Employee's `employmentStatus` is `ACTIVE`.
2. **Admin/dispatcher access remains unchanged.** Every grant in §3/§4a is strictly additive, for a new audience, over new or narrowly-scoped surfaces only.
3. **Unresolved or broken Employee/User linkage fails closed.** No `employeeId`, or an unreadable/nonexistent linked Employee document, denies every capability in §4a exactly as today — never a default grant.
4. **A nav-visible but permission-denied page is NOT an acceptable interim state, for any role or capability.** If a Specification cannot deliver a given role's reachability change together with its full matching set of Rules/query grants from §3, it does not ship that role's reachability change.
5. **Required Rules/query/index changes must be merged, separately deployed, and verified before *each corresponding* UI capability merges** — not once, generically, but per role/capability grouping (§3's rows), mirroring this initiative's own established C0-index-before-query discipline. A PARTS_ASSOCIATE capability's Rules work being live does not authorize merging a PARTS_MANAGER UI capability, and vice versa.
6. **The prior technician-assignee exclusion is reconsidered only after this initiative is safely complete, never automatically removed.** `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4 stays in force unchanged; any future change requires its own explicit, separate decision, made after this initiative ships and is verified safe.

### 10. Deny-by-default behavior and no raw IDs in human-facing flows

Deny-by-default confirmed throughout the chain investigated; decision 9.3 makes it explicit and binding for every new access path in §4a. The established no-raw-ID convention (`resolveAssigneeDisplay()`/`resolveActorDisplayName()`) applies to any future surface that must resolve another employee's identity — note that under §4a, **PARTS_MANAGER's oversight view is the one role-specific surface that does need this** (it resolves assignee display names across users, deliberately, per the adopted matrix), while `WAREHOUSE_MANAGER`'s and `PARTS_ASSOCIATE`'s surfaces do not need cross-user identity resolution at all and should not import `useEmployeeDirectory()`.

### 11. `firestore.rules`/schema/index implications, by role

**Already correct, no change needed:** `employees/{employeeId}` self-read; `canSubmitManualZeroHistoryQuantity()` (PARTS_MANAGER/WAREHOUSE_MANAGER manual entry); `useAssignableEmployees()`'s existing scoped query (reusable as-is for PARTS_MANAGER's Assign lookup); the three assignee-only writes with no outer admin/dispatcher requirement (Post Purchasing Update, Record PO, Mark Received — already correctly scoped for PARTS_ASSOCIATE once reachable).

**New grants needed, grouped by role (detail in §3):**
- **PARTS_MANAGER:** read branches for `READY_FOR_PARTS_MANAGER` (Parts Manager Queue), the Assign write, cross-user oversight (`status in [...]`), and a new narrower "relevant history" query (design TBD, Specification-level).
- **WAREHOUSE_MANAGER:** read branch for catalog/health/stock visibility (`inventory_transactions` or a derived view), and a new narrower "warehouse-relevant activity" query over `inventory_actions` (design TBD).
- **PARTS_ASSOCIATE:** a self-scoped read branch on `reorder_requests` (`assignedToUserId==uid`, currently absent entirely — read is `isAdminOrDispatcher()`-only even for the assignee today), a matching self-scoped read on `reorder_purchase_orders`/`reorder_purchase_order_voids`, and resolution of the Start Purchasing double-gate asymmetry (§3, §14).

**Schema:** no new fields required — `operationalRoles`, `employmentStatus`, `requestedBy`, `assignedToUserId` all already exist.

**Index:** the reused query shapes (`READY_FOR_PARTS_MANAGER`, `status in [...]`, `assignedToUserId==uid`) already work without a new composite index in their existing admin/dispatcher-gated form — adding a new Rules branch to an existing query shape does not, by itself, require a new index. The two genuinely new query shapes (relevant-history for PARTS_MANAGER, warehouse-relevant-activity for WAREHOUSE_MANAGER) may need one — Specification-level design. Per decision 9.5, whatever index is needed must be deployed and confirmed `[READY]` before that specific role's UI capability merges.

### 12. Browser and Rules test matrix (for a future Implementation Plan, not performed here)

| Account | Security `role` | `operationalRoles` | `employmentStatus` | Expected outcome |
|---|---|---|---|---|
| admin | admin | — | — | Unchanged: full access |
| dispatcher | dispatcher | — | — | Unchanged: full access |
| eligible technician (Parts Manager) | technician | `["PARTS_MANAGER"]` | ACTIVE | Reaches Parts Manager surface: catalog/health, Parts Manager Queue, assign eligible associates, assigned-work oversight, relevant history. **Does not** reach purchasing-execution actions, the full unscoped History, or the Employee directory beyond the scoped assignable-employees lookup |
| eligible technician (Warehouse Manager) | technician | `["WAREHOUSE_MANAGER"]` | ACTIVE | Reaches Warehouse Manager surface: catalog/health, stock visibility, manual entry, warehouse-relevant activity. **Does not** reach the Parts Manager Queue, Assign, or any purchasing-execution action |
| eligible technician (Parts Associate) | technician | `["PARTS_ASSOCIATE"]` | ACTIVE | Reaches Parts Associate surface: personal Waiting/In Progress, exact assigned-request details, purchasing progress updates, Record PO, Mark Received. **Does not** reach the Parts Manager Queue, oversight, or global History |
| ineligible technician (no operational role) | technician | `[]` or absent | ACTIVE | Denied all Inventory access — unchanged |
| technician, broken or unresolved Employee link | technician | N/A | N/A | Denied all capabilities — fails closed (decision 9.3) |
| technician, inactive eligible Employee | technician | any eligible value | INACTIVE / TERMINATED | Denied all capabilities despite otherwise-eligible `operationalRoles` (decision 9.1) |
| dispatcher/admin, no eligible operational role | dispatcher / admin | `[]` | — | Unchanged — full access via existing `role` (decision 9.2) |
| PARTS_MANAGER-only technician | technician | `["PARTS_MANAGER"]` | ACTIVE | Confirms exclusion: cannot Start Purchasing, Record PO, Void, or Receive on any request (those belong to the assignee) |
| WAREHOUSE_MANAGER-only technician | technician | `["WAREHOUSE_MANAGER"]` | ACTIVE | Confirms exclusion: cannot reach the Parts Manager Queue, Assign, or any purchasing-execution action |
| PARTS_ASSOCIATE-only technician | technician | `["PARTS_ASSOCIATE"]` | ACTIVE | Confirms exclusion: cannot reach the Parts Manager Queue, oversight view, or full History; a request assigned to a *different* Parts Associate is invisible to this account |

**Rules-level assertions**, per role: the new query/write grants succeed for an eligible `ACTIVE` account and are denied for the same account attempting a capability outside its own role's row in §4a (e.g. a WAREHOUSE_MANAGER technician attempting the Assign write, or a PARTS_ASSOCIATE technician attempting the oversight query) — proving each role's grants are exactly as scoped as §3 specifies, not accidentally shared across roles.

## Affected files (for a future implementation; unchanged by this assessment)

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/domain/constants.js` | Defines `ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE` | Source of truth for nav/route gating; each new role-specific surface's nav item and eligibility input are defined/consumed here |
| `field-ops-app-vite/src/navigation/navConfig.js`, `App.jsx` | Nav + route predicates | Up to three new nav items/routes (one per role in §4a); the existing `parts`/Inventory-domain item and route are **not** modified |
| `field-ops-app-vite/src/auth/AuthContext.jsx` | Resolves `role`/`employeeId`/`operationalRoles` per session | `employmentStatus` is not currently resolved into session state and would need to be, per decision 9.1 |
| New components/routes (not yet named) | N/A — do not exist today | The three role-specific surfaces (§7 Design (a)) |
| `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx`, `hooks/useReorderRequestsByStatus.js`-equivalents, `useAssignableEmployees.js` | Existing, already-parameterized hooks | Reused as query builders inside the new surfaces (§7); not modified themselves |
| `firestore.rules` | Gates every collection in §2/§3 | New, role-and-employment-conditioned grants added per §11 — Tier 2, requires explicit Owner decision, deployed and verified per role/capability (decision 9.5) before each corresponding UI PR merges |
| `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs`, `driver.mjs` | Test fixture/driver infrastructure | Needs `technician`-role `DRIVER_ACCOUNTS` fixtures for all three operational roles, per §12 |

## Dependencies

- `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4 (technician-assignee exclusion) stays in force per decision 9.6.
- `RequestReorderControl.jsx`'s existing eligibility check is unaffected — already correct once reached.
- No dependency on the Customer or Platform initiatives.
- Issue #182 (Truck Parts Sale-to-Invoice and Inventory Consumption, §13) is a related but structurally separate future initiative — not a dependency of this one, and this initiative is not a dependency of it either; the boundary is explicit, not merely sequential.

## Risks

- **The richer, per-role matrix (§4a) has materially more new Rules surface than the prior round's single minimal bundle** — six distinct new grant groups (§11) instead of two. Each must be independently reasoned and verified; treating them as one undifferentiated "Inventory access" Rules PR risks re-introducing the over-broad-grant failure mode this assessment has twice now been asked to correct.
- **The Start Purchasing double-gate asymmetry (§3, §14)** is a real, unresolved design question — the other three assignee-scoped writes (Post Purchasing Update, Record PO, Mark Received) have no outer admin/dispatcher requirement, but Start Purchasing does. A Specification must decide whether to remove that asymmetry (add an operational-role branch to Start Purchasing's outer gate) or intentionally preserve it (meaning a PARTS_ASSOCIATE technician could see an assigned request move to `ASSIGNED_TO_PARTS_ASSOCIATE` but not themselves start purchasing on it) — not assumed here.
- **"Relevant — not global — history" (PARTS_MANAGER) and "warehouse-relevant activity" (WAREHOUSE_MANAGER) have no existing query to reuse** — both need genuine new query design at Specification time, not merely a Rules branch on an existing hook.
- **`employmentStatus` is not currently part of `AuthContext`'s session state.** Decision 9.1 requires evaluating it, meaning either extending `resolveEmployeeSession()` or checking it Rules-side only — Specification-level decision.
- **Sequencing risk (decision 9.5), now compounded by three role-specific pairings instead of one:** if any single role's Rules work and UI work are not strictly gated by a verified production deployment, that role alone could regress into the explicitly-rejected nav-visible-but-permission-denied state even if the other two roles are sequenced correctly.

## Recommended smallest safe design (for Architecture Review, not a final decision)

1. **Build three dedicated, role-specific Inventory surfaces** (§7 Design (a)) — not a conditionally-gated version of `PartsList.jsx`/`PartDetail.jsx`, and not one shared minimal bundle. Each with its own nav item/route, gated by that role's specific eligibility input (operational role + `ACTIVE` employment).
2. **Every read/write is an individually-reasoned, role-and-employment-conditioned Rules grant** (§3/§11) — existing parameterized query hooks may be reused as query builders, but never their existing admin/dispatcher-only or unscoped grants as-is.
3. **Fail closed on every linkage and employment-status edge case**, for all three roles uniformly (decisions 9.1, 9.3).
4. **Sequence each role's Rules/query/index work strictly before that role's UI PR**, with a verified production deployment gate between them (decision 9.5) — per role, not once globally.
5. **Do not ship any role's nav-reachable, data-inaccessible interim state under any circumstance** (decision 9.4).
6. **Leave the technician-assignee exclusion untouched** (decision 9.6).
7. **Add `technician`-role `DRIVER_ACCOUNTS` fixtures for all three operational roles** to `seed.mjs`, per §12.
8. **Resolve the Start Purchasing double-gate asymmetry explicitly** (§14) before PARTS_ASSOCIATE's purchasing-progress capability is considered complete — not left as a silent gap discovered later.

## Sequencing (per role/capability, replacing the prior round's generic two-PR shape)

Derived directly from §3's per-role grant groups, each independently subject to decision 9.5's deploy-before-merge gate:

- **PR 0 — Shared infrastructure, no new capability.** `employmentStatus` added to `AuthContext` session state (if the Specification chooses client-side evaluation); the `technician`-role `DRIVER_ACCOUNTS` fixtures for all three roles. No Rules change, no new nav/route yet.
- **PR 1a (Rules) → PR 1b (UI) — PARTS_MANAGER.** 1a: new Rules branches for the Parts Manager Queue read, the Assign write, the oversight read, and the relevant-history query (once designed); deployed, confirmed live, verified via SDK/driver probes before 1b merges. 1b: the PARTS_MANAGER surface itself, wired to 1a's live grants, with browser coverage from §12.
- **PR 2a (Rules) → PR 2b (UI) — WAREHOUSE_MANAGER.** 2a: new Rules branches for catalog/health/stock-visibility and warehouse-relevant-activity reads; deployed and verified before 2b merges. 2b: the WAREHOUSE_MANAGER surface.
- **PR 3a (Rules) → PR 3b (UI) — PARTS_ASSOCIATE.** 3a: new self-scoped read branches on `reorder_requests` and `reorder_purchase_orders`/`voids`, plus the Start Purchasing double-gate resolution (§14); deployed and verified before 3b merges. 3b: the PARTS_ASSOCIATE surface.

The three role tracks (1, 2, 3) may proceed in parallel relative to each other — nothing in §4a makes one role's grant a prerequisite for another's — but within each track, the `a`→`b` deploy-then-merge gate is binding per decision 9.5, independently for each role.

## Boundary note

### 13. Truck parts sale-to-invoice — explicitly out of scope, tracked separately

A base Technician (no eligible `operationalRoles`, per §4a's last row) may eventually need to record parts sold/consumed from their own assigned truck stock directly through the current Work Order/invoice flow — e.g., scanning a part via their phone camera while closing out a job. **This grants no general Inventory access** — it is not covered by, and does not extend, any of the role-specific surfaces in §4a/§7; a base Technician remains denied all Inventory nav/route/query access exactly as today. This is a structurally separate capability (Work-Order-scoped, truck-stock-scoped, invoice-integrated), not an `operationalRoles`/Inventory-planning concern, and is tracked as its own Assessment-only issue: **Issue #182, "Truck Parts Sale-to-Invoice and Inventory Consumption"** (adopted phone-camera QR workflow; reservation/consumption/reversal lifecycle; assigned-truck scope; pricing/tax; offline/retry; idempotency; names-with-IDs audit evidence; Issue #15's trusted-writer/Cloud-Function precedent as a dependency to evaluate). No access model for it is proposed here, and no implementation is authorized by either this assessment or Issue #182 itself.

## Open questions for Architecture Review

1. **The relevant-history query design (PARTS_MANAGER)** and **the warehouse-relevant-activity query design (WAREHOUSE_MANAGER)** — both need genuine new query shapes; this assessment identifies the need but does not design them (§3, §11, Risks).
2. **Whether `employmentStatus` should be added to `AuthContext`'s client-side session state**, or checked only server-side (Risks).
3. **Whether the "what needs planning"/catalog-health read for PARTS_MANAGER and WAREHOUSE_MANAGER reuses `useInventoryLedger()`'s existing query shape (under a new Rules branch) or a narrower derived view** — Specification-level design (§3, §11).
4. **Confirmation of the per-role sequencing above as binding**, not merely advisory, across (up to) three independently-gated Rules-then-UI pairings.

### 14. Open question: the Start Purchasing double-gate asymmetry

Flagged in §3/Risks, restated here as its own item because it blocks declaring PARTS_ASSOCIATE's "purchasing progress and authorized PO actions" capability complete: Start Purchasing currently requires **both** `isAdminOrDispatcher()` **and** assignee, while Post Purchasing Update/Record PO/Mark Received require only assignee. Whether Void Purchase Order's own double-gate (`isAdminOrDispatcher()` **and** assignee) is intended to be part of PARTS_ASSOCIATE's "authorized PO actions" is likewise not decided here. Both require an explicit Architecture Review/Specification decision, not an assumption drawn from the asymmetry's current shape.
