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

**Revision note (this round):** `PartsList.jsx`/`PartDetail.jsx` — the pages a naive nav/route fix would make reachable — mount far more than the manual-reorder-entry flow: every reorder-request queue (including cross-user oversight and full History), the entire unscoped Employee directory, the full unfiltered `inventory_transactions` ledger, the Inventory Action Log, and Purchase Order/void/receiving actions. §2 below replaces the prior draft's narrower framing with a complete surface/read/action matrix, and the recommendation in §5/§10 is revised accordingly: capability-scoped access must be redefined at the component/query/action level, not merely "the `parts` nav item," because the `parts` nav item itself currently mounts all of the above.

## Scope of this assessment

Investigated: `field-ops-app-vite/src/domain/constants.js` (`ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE`), `field-ops-app-vite/src/navigation/navConfig.js`, `field-ops-app-vite/src/App.jsx` (routing), `field-ops-app-vite/src/auth/AuthContext.jsx`, `field-ops-app-vite/src/modules/inventory/PartsList.jsx` and `PartDetail.jsx` in full (every section, hook, and action — this round), `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx`, `field-ops-app-vite/src/hooks/useAssignableEmployees.js`, `useEmployeeDirectory.js`, `useInventoryLedger.js`, `useInventoryActions.js`, `useReorderPurchaseOrders.js`, `useReorderPurchaseOrderVoids.js`, `field-ops-app-vite/src/domain/employees.js`, `firestore.rules` in full for every collection these two pages touch, `functions/scripts/provisionEmployeeAccess.js`, and the driver/seed test infrastructure (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs`, `seed.mjs`, `SKILL.md`).

Explicitly **not** investigated or addressed here:
- The broader manager-oversight/queue-visibility work from Issue #154 (PRs #164/#168/#173/#177) — that initiative explicitly deferred "any change broadening `reorder_requests` visibility to non-admin/dispatcher sign-in roles" to this issue (its own assessment's Risks section names Issue #100 directly), so this assessment picks that thread up rather than re-litigating it.
- The Inventory Action Log (`inventory_actions`) redesign (Issue #152) — its read/write surface is inventoried in §2 below only because `PartDetail.jsx` mounts it, not because this assessment proposes changing it.
- Any other domain's (Customer, Service Activity, Financial) nav/route gating — this assessment is Inventory-scoped only, per the directive.

No application code, Firestore Rules, index, schema, deployment, or production-data change was made while producing this assessment — read-only investigation only.

## Current repository state

### 1. Current navigation and route gating

`ROLE_NAV_ACCESS` — the actual source of truth for who sees what — lives in `field-ops-app-vite/src/domain/constants.js:245-263`, not in `navConfig.js` itself (`navConfig.js`'s own header comment states it deliberately consumes this as a parameter "so this stays pure/testable and the actual permission source of truth stays in one place"):

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

`navConfig.js:163-176` defines the two visibility predicates, `isNavItemVisible()` and `isDomainVisible()`, both driven by `ROLE_NAV_ACCESS`'s `allowedLegacyKeys` (for items/domains carrying a `legacyKey`) or `PLACEHOLDER_DEFAULT_ROLES = ["admin", "dispatcher"]` (for items/domains without one). The Inventory domain's `parts` subnav item carries `legacyKey: "inventory"`; its sibling items (`warehouses`, `truckInventory`, `transfers`, `receiving`, `cycleCounts`, `backOrders`) have no `legacyKey` and fall to `PLACEHOLDER_DEFAULT_ROLES`, which also excludes `technician`. Either path, `isDomainVisible(inventoryDomain, "technician", [])` is `false`.

**Route gating is not a separate layer from nav visibility — it is the identical predicate, reused.** `App.jsx` builds `<Route>` elements from the same `isNavItemVisible`/`isDomainVisible` calls (`App.jsx:117-133`, `171-179`):

```js
{NAV_DOMAINS.filter((d) => !d.future).map((domain) => (
  <Route key={domain.key} path={domain.path}>
    {domain.subnav
      .filter((item) => isNavItemVisible(item, role, allowedLegacyKeys))
      .map((item) => (
        <Route key={item.key} path={item.path || undefined} index={item.path === ""} element={renderSubnavItem(domain, item, role)} />
      ))}
```

```js
{domain.key === "inventory" && isDomainVisible(domain, role, allowedLegacyKeys) && (
  <Route path=":partId" element={<PartDetail />} />
)}
```

An ineligible role gets no matching `<Route>` mounted at all for `/inventory` or `/inventory/:partId` — react-router falls through to the catch-all (`App.jsx:191`, `<Route path="*" element={<Navigate to="/dashboard" replace />} />`). A `technician` typing the URL directly is silently redirected to `/dashboard`, with no permission-denied page, no Firestore error, and no distinguishable signal that Inventory exists but is off-limits versus simply not being a route at all.

**Conclusion:** there is exactly one gate, applied twice (nav rendering and route mounting) from the same source of truth (`ROLE_NAV_ACCESS`/`PLACEHOLDER_DEFAULT_ROLES`), and it is keyed **only** on security `role`. `operationalRoles` never enters this decision at any point. **Critically — and this is the finding this revision corrects — that single gate is also all-or-nothing at the page level: today, "reachable" and "renders `PartsList.jsx`/`PartDetail.jsx` in full" are the same thing.** There is no existing mechanism that mounts only part of these pages for one audience and the rest for another. §2 inventories exactly what "in full" means; §5/§10 revise the recommendation to not conflate "make `/inventory` reachable" with "grant the complete `PartsList.jsx`/`PartDetail.jsx` surface."

### 2. Complete surface/read/action matrix — `PartsList.jsx` and `PartDetail.jsx`

This section replaces the prior draft's treatment of these two files as if they existed primarily for the manual-reorder-entry flow. They do not — that flow is one of roughly a dozen distinct sections/actions the two pages mount together. Every row below is a genuinely separate Firestore read or write, each with its own `firestore.rules` gate.

#### 2a. `PartsList.jsx` — every rendered section

| Section | Hook | Collection | Query shape | User action |
|---|---|---|---|---|
| Inventory Operational Queue (Critical & High / Needs Planning tabs) | `useInventoryLedger()` | `inventory_transactions` | One-shot, **entire collection, no filter** — client-derives health/urgency | "Request Reorder" button → **creates** a `reorder_requests` doc (NEEDS_PLANNING or READY branch) |
| — (de-dup check for the above) | `useReorderRequests()` | `reorder_requests` | `where("status","==","PENDING_REVIEW")`, realtime | none (read-only de-dup) |
| Parts Manager Queue | `useReorderRequestsByStatus(READY_FOR_PARTS_MANAGER)` | `reorder_requests` | `where("status","==",...)`, realtime, cross-user | Navigate only (Approve/Reject/Assign live on `PartDetail`) |
| Parts Associate Waiting | `useReorderRequestsAssignedTo(uid, ASSIGNED_TO_PARTS_ASSOCIATE)` | `reorder_requests` | `where("assignedToUserId","==",uid) && where("status","==",...)`, realtime, **self-scoped** | Navigate only |
| Parts Associate In Progress | `useReorderRequestsAssignedTo(uid, PURCHASING_IN_PROGRESS)` | `reorder_requests` | Same shape, **self-scoped** | Navigate only |
| All Assigned Work (manager oversight) | `useReorderRequestsByStatuses([ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS])` | `reorder_requests` | `where("status","in",[...])`, realtime, **no assignee filter — every user's assignments** | Navigate only; renders every assignee's display name (see §2c) |
| Parts Catalog | static `PARTS_CATALOG` + `useInventoryLedger()` (shared read, no second query) | `inventory_transactions` (via the same unfiltered ledger read above) | — | Navigate only |
| History | `useReorderRequestsHistory({statuses:[CANCELLED,VOIDED,RECEIVED,REJECTED], pageSize:10})` + `useReorderRequestById()` | `reorder_requests` | One-shot `getDocs`: `where("status","in",[...]), orderBy("createdAt","desc"), limit(n)`, cursor-paginated, **cross-user, cross-status, no `requestedBy`/assignee scope**; exact-id lookup is an independent `doc()` read | Navigate/paginate/lookup only |

#### 2b. `PartDetail.jsx` — every write action

| Action | Writes to | `firestore.rules` gate | Scope |
|---|---|---|---|
| Approve / Reject | `reorder_requests/{id}` update | `isAdminOrDispatcher()` (outer gate); Reject additionally requires non-blank `reviewNotes` | Any admin/dispatcher — not assignee-restricted |
| Assign | `reorder_requests/{id}` update | `isAdminOrDispatcher()` + `assignedBy == auth.uid`; **no rules-level check that the target holds `PARTS_ASSOCIATE`** (client-side `EmployeeAssignmentPicker` filter only — an existing, separately-flagged gap, not created by this assessment) | Any admin/dispatcher |
| Start Purchasing | `reorder_requests/{id}` update | `isAdminOrDispatcher()` **and** `auth.uid == resource.data.assignedToUserId` | Assignee only |
| Post Purchasing Update | `reorder_requests/{id}` update | `auth.uid == resource.data.assignedToUserId` | Assignee only |
| Record Purchase Order | Atomic: creates `reorder_purchase_orders/{requestId}` + updates `reorder_requests/{id}` → `ORDERED` | `auth.uid == assignedToUserId` on the linked request, `status == PURCHASING_IN_PROGRESS`, cross-document `getAfter()` invariant | Assignee only |
| Void Purchase Order | Creates `reorder_purchase_order_voids/{requestId}` + updates `reorder_requests/{id}` → `VOIDED` | `isAdminOrDispatcher()` **and** assignee, double-gated | Assignee **and** admin/dispatcher |
| Mark Received | `reorder_requests/{id}` update → `RECEIVED` | `auth.uid == assignedToUserId` | Assignee only |
| Cancel | `reorder_requests/{id}` update → `CANCELLED` | `isAdminOrDispatcher()` alone — explicitly **not** assignee-restricted | Any admin/dispatcher |
| Manual quantity entry (`RequestReorderControl`) | Creates `reorder_requests` doc | `canSubmitManualZeroHistoryQuantity()` (`userRole()=="admin"` OR `hasOperationalRole("PARTS_MANAGER"/"WAREHOUSE_MANAGER")`) | **The one action already operational-role-aware at the Rules layer** — this is Issue #100's entire evidenced scope |
| Inventory Action Log entry (Receive/Adjust/Correct) | Creates `inventory_actions` doc | `isAdminOrDispatcher()`, no field-level Rules validation | Any admin/dispatcher; audit-only, never touches `inventory_transactions` |

#### 2c. Cross-user, unscoped reads (the highest-risk surface if reachability alone is widened)

Both files call `useEmployeeDirectory()` (`hooks/useEmployeeDirectory.js`), backed by `buildEmployeeDirectoryQuery()` (`domain/employees.js:51-53`) — **`query(employeesRef)` with zero `where` clauses: every document in `employees`, unfiltered by `employmentStatus`, `operationalRoles`, or `userId`.** Gated by `firestore.rules:199`, `allow read: if isAdminOrDispatcher() || (isSignedIn() && userData().employeeId == employeeId)` — the admin/dispatcher branch is an unconditional, unfiltered grant over the entire collection, not a per-record or per-field scope. `PartsList.jsx` uses it to resolve every assignee's display name in "All Assigned Work"; `PartDetail.jsx` uses it for "Assigned to"/"Ordered by"/"Received by"/"Cancelled by"/"Voided by"/"Updated by" and the Inventory Action Log's "By" column — any of which may name a different employee than the one currently signed in.

This is architecturally distinct from `useAssignableEmployees()`'s query (`domain/employees.js:24-36`), which **is** already scoped: `where("employmentStatus","==","ACTIVE"), where("operationalRoles","array-contains",role), where("userId","!=",null)`. That scoped-query pattern already exists in this codebase and is the right model to reuse — `useEmployeeDirectory()`'s unscoped read is not.

### 3. Every affected collection and permission (do not widen wholesale)

| Collection | Current read gate | Current write gate | Relevant to Issue #100's evidenced capability? | Guidance |
|---|---|---|---|---|
| `reorder_requests` (NEEDS_PLANNING create) | — | `canSubmitManualZeroHistoryQuantity()` — **already correct** | **Yes — this is the actual capability** | No change needed |
| `reorder_requests` (own submissions, `requestedBy == uid`) | `isAdminOrDispatcher()` only today; no self-scoped read path exists | — | Plausibly, if the operational-role user needs to see what they submitted | A **new, narrowly-scoped** query (`where("requestedBy","==",uid)`), not access to the existing Parts Manager Queue / All Assigned Work / History queries |
| `reorder_requests` (Parts Manager Queue, All Assigned Work, History, Waiting/In Progress) | `isAdminOrDispatcher()` only | admin/dispatcher and/or assignee-gated, per §2b | **Not evidenced** by Issue #100 | **Do not widen.** These are cross-user oversight/workflow-management surfaces with no operational-role concept defined anywhere in Rules or client logic today |
| `inventory_transactions` (full ledger) | `isAdminOrDispatcher()` only, unfiltered full-collection read | Admin-SDK only | Only indirectly — needed to know *what* needs a manual quantity | **Do not grant the same unfiltered full-collection read.** If the new capability needs to see "what needs planning," that is a narrower, purpose-built read (see §5) — not the same `useInventoryLedger()` call `PartsList.jsx` uses today |
| `employees` (full directory, `useEmployeeDirectory()`) | `isAdminOrDispatcher()` unconditional, unscoped | Admin-SDK only | **No** — nothing in Issue #100 requires an operational-role user to resolve other employees' display names | **Do not widen.** This is explicitly the kind of grant the directive warns against — an operational-role technician does not need the same unscoped read admin/dispatcher has just because one component happens to import it |
| `employees` (self-read, own `employeeId`) | Already permitted (`userData().employeeId == employeeId`) | — | Yes — this is how the user's own `operationalRoles`/`employmentStatus` are evaluated | No change needed |
| `employees` (scoped, `useAssignableEmployees()`-style query) | Not applicable to this issue's scenario (that hook serves the *assigner*, not the eligible technician) | — | No | Not needed for this capability; cited only as the correct scoping *pattern* to imitate if a future need arises |
| `inventory_actions` | `isAdminOrDispatcher()` | `isAdminOrDispatcher()`, client-validated only | **No** — audit log, unrelated to manual quantity entry | **Do not widen.** Out of scope; Issue #152 territory if ever revisited |
| `reorder_purchase_orders` / `reorder_purchase_order_voids` | `isAdminOrDispatcher()` read; assignee-gated write | Assignee/admin-dispatcher, double-gated for void | **No** — these belong to the Parts Associate purchasing workflow, a different operational role than the PARTS_MANAGER/WAREHOUSE_MANAGER scenario Issue #100 evidences | **Do not widen** as part of this initiative |

**This table is the explicit answer to the directive's instruction not to propose widening the full Employee directory or all Reorder Request history merely to enable one capability: none of those broad reads are proposed here. Every "yes" in the third column is satisfied by either an already-correct existing gate, or a new, narrowly-scoped query — never by granting the existing broad admin/dispatcher-shaped reads to a new audience.**

### 4. Employee `operationalRoles` versus security `role` authority

Three distinct fields across two documents:

- **`users/{uid}.role`** — the security role (`admin`/`dispatcher`/`technician`). Read via `AuthContext`; the sole input to `ROLE_NAV_ACCESS` and to `firestore.rules`' `userRole()`/`isAdminOrDispatcher()`.
- **`employees/{employeeId}.operationalRoles`** (array: `PARTS_MANAGER`/`WAREHOUSE_MANAGER`/`PARTS_ASSOCIATE`, `domain/constants.js:152-181`) — an assignment/task-eligibility marker, explicitly documented in that file's own header comment as independent of security role.
- **`employees/{employeeId}.securityRole`** — a read-only *mirror* of `users/{uid}.role`, written only by `functions/scripts/provisionEmployeeAccess.js` or its drift-repair counterpart, explicitly "NEVER a source of authorization."

`RequestReorderControl.jsx:23-46` is the one place client-side eligibility logic already reads `operationalRoles`:

```js
const { role, operationalRoles } = useAuth();
const isEligible =
  role === ROLES.ADMIN ||
  operationalRoles.includes(OPERATIONAL_ROLE.PARTS_MANAGER) ||
  operationalRoles.includes(OPERATIONAL_ROLE.WAREHOUSE_MANAGER);
```

This check is blind to `isAdminOrDispatcher()` — it would render the eligible UI for a `technician` holding `operationalRoles: ["PARTS_MANAGER"]`, *if* that technician could ever reach the component. Per §1, they cannot. `operationalRoles` is authoritative for exactly one write action in this codebase today (manual-quantity-entry, per §2b/§3) and is never consulted for navigation, routing, or any of the reads inventoried in §2/§3.

**No differentiation exists today, anywhere in Rules or client logic, between what a `PARTS_MANAGER` and a `WAREHOUSE_MANAGER` may do** — `canSubmitManualZeroHistoryQuantity()` and `RequestReorderControl.jsx`'s mirror both treat the two values identically (either satisfies the same `OR` condition). This assessment does not invent a distinction that doesn't exist in the current authorization model — see §10.

### 5. Why an eligible technician cannot reach Inventory (mechanism)

Directly established by §1: `ROLE_NAV_ACCESS[ROLES.TECHNICIAN]` never includes `"inventory"`, and `App.jsx`'s route tree is built from the identical predicate, so the `/inventory` route itself does not exist for a `technician` session regardless of that user's linked Employee's `operationalRoles`. The gap is structurally earlier than any eligibility logic: the navigation/routing layer decides reachability using a field (`role`) that has no relationship to the field (`operationalRoles`) the actual business eligibility check uses — and, per §2, that reachability decision is currently all-or-nothing over a page that mounts far more than the one eligible action.

This is already documented as a known, live-discovered gap in three places in the repository today, none of which fix it: `seed.mjs:634-644`'s inline comment, `SKILL.md`'s Gotchas section, and `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4, which named Issue #100 as the place the real fix belongs.

### 6. Loading, unresolved, and broken Employee/User linkage behavior

`AuthContext.jsx`'s `resolveEmployeeSession(uid)` (lines ~43-77) is the sole resolver, called from `onAuthStateChanged`:

1. One-shot `getDoc(users/{uid})` reads `role` and `employeeId`.
2. `employeeId == null` → returns `{ role, employeeId: null, displayName: null, operationalRoles: [] }` immediately — "a valid, expected migration state, not an error."
3. `employeeId` present → one-shot `getDoc(employees/{employeeId})`.
4. Employee doc doesn't exist (broken link) → `console.warn`s the `employeeId` only, returns the same empty-operational-identity shape as step 2.
5. Otherwise → `{ role, employeeId, displayName, operationalRoles: employeeData.operationalRoles ?? [] }`.

**Loading:** `App.jsx` renders `<div className="fo-panel">Loading...</div>` and makes no role/nav decision while `loading` is true.

**Unresolved and broken linkage are, today, indistinguishable in effect:** both resolve to `operationalRoles: []`, and neither affects nav/route gating at all, since that gating never reads `operationalRoles`. A `technician` with a valid, `ACTIVE`, `PARTS_MANAGER`-tagged Employee link and a `technician` with no Employee link whatsoever are denied Inventory access **identically** today — clear evidence the gap is structural, not a data-quality edge case. **Per the architecture decisions adopted this round (§9), any new access path must fail closed on both of these states, not merely inherit today's incidental "denied either way" behavior as a byproduct of the field never being read at all.**

**Denied/failed read:** caught in a `try/catch`; all four fields reset to their empty/null defaults, never falls back to a default role.

**Related, narrower precedent:** `useAssignableEmployees.js`'s `applyPartsAssociateSecurityRoleEligibility()` filters out Employees whose `securityRole` mirror is missing/invalid and reports a count to an admin/dispatcher-visible warning banner. This is scoped to the assignment-picker's eligible-candidate list, not to the signed-in user's own session — a different mechanism from what a new nav/route eligibility check would need.

### 7. Redefining "capability-scoped" — component/query/action level, with a design comparison

The prior draft of this assessment defined "capability-scoped" as "gate the `parts` nav item, leave the rest of Inventory alone." §2 shows that framing was insufficiently granular: the `parts` nav item **is** `PartsList.jsx`, and `PartsList.jsx` mounts roughly a dozen distinct reads and the routes into `PartDetail.jsx`'s roughly ten distinct write actions. Gating only at the nav-item level, without also deciding which of those component-internal sections/hooks/actions the new audience may reach, would either (a) expose the entire matrix in §2 to a technician on the strength of one eligible action, or (b) require a second, undefined layer of gating inside the already-reached component. Two concrete designs resolve this, compared below.

**Design (a) — a dedicated, narrow Inventory-planning surface.** A new route/component, entirely separate from `PartsList.jsx`/`PartDetail.jsx`, that mounts *only*:
- A purpose-built, narrowly-scoped read of "what needs a manual quantity submitted" — **not** `useInventoryLedger()`'s unfiltered full-collection read (§3). This likely needs its own Specification-level design (a filtered/aggregated read, or a narrower query), explicitly not a reuse of the existing admin/dispatcher-shaped ledger read.
- `RequestReorderControl`'s existing, already-correct manual-entry action.
- A new, narrowly-scoped "my submitted requests" read: `where("requestedBy","==",uid)` on `reorder_requests` (the `requestedBy` field already exists, set at creation — `domain/inventoryReorderRequests.js:70`, `firestore.rules:132`) — not the Parts Manager Queue, All Assigned Work, or History queries.

Every read this surface needs is a **new, purpose-built query**, auditable in isolation, with its own Rules grant scoped to exactly that query shape — nothing reused wholesale from the existing admin/dispatcher-shaped hooks.

**Design (b) — the shared `PartsList.jsx`/`PartDetail.jsx` pages, with conditional sections and disabled hooks.** Reuse the existing pages, but wrap each section/hook call in a role/operationalRoles conditional so an eligible technician sees only the Operational Queue tabs and `RequestReorderControl`, with the Parts Manager Queue, Waiting/In Progress, All Assigned Work, History, Parts Catalog, and every `PartDetail.jsx` action other than manual entry conditionally hidden.

**Comparison and recommendation:** Design (b) is riskier for exactly the reason the directive is concerned about. Every one of the dozen-plus hooks in §2 is already wired into these two files; "conditionally hidden" describes UI rendering, not the underlying Firestore read/write authorization — a hook call left un-gated by a missed conditional (or a future edit to either file that doesn't preserve every existing conditional) still fires its query, and if any *future* change ever widens the underlying Rules grant to make the reused hooks work for this new audience at all (which several of them, per §3, are not designed to do without their own Rules change), every other unconditionally-reused hook on the same page inherits that same widened grant whether or not it was ever intended to. This is the literal shape of "widening the full Employee directory or all Reorder Request history merely to enable one capability" the directive warns against — design (b) makes that an easy, silent mistake, because the page's existing hooks already exist and are already imported; leaving one un-gated is an omission, not a new grant someone has to consciously add.

Design (a) has no such failure mode: a new surface starts with zero reads, and every read it gains is a deliberate, individually-scoped addition, reviewed once, on its own Rules grant.

**Recommendation: Design (a), a dedicated, narrow Inventory-planning surface — not Design (b).** This is the "smallest safe design" for the actual capability, superseding the prior draft's Option A/B framing (which compared nav-domain widths, not component/query/action granularity).

**Parts Manager vs. Warehouse Manager scope:** as established in §4, no distinction exists anywhere in the current authorization model between these two `operationalRoles` values — both satisfy `canSubmitManualZeroHistoryQuantity()` and `RequestReorderControl.jsx`'s client mirror identically. This assessment recommends the new dedicated surface grant **the identical minimal capability set to both roles** (the manual-entry action plus the two narrowly-scoped reads above), matching the existing authorization model exactly, unless a future Specification identifies and justifies a divergent need for one role over the other — not assumed or invented here.

### 8. Route-level enforcement, not navigation visibility alone

Established in §1: this codebase does not have a separate "nav visibility" layer and "route guard" layer — `isNavItemVisible`/`isDomainVisible` gate both simultaneously, from one call site each in `App.jsx`. Design (a) from §7 is compatible with this property without modification: the new dedicated surface gets its own nav item and route, gated by its own eligibility input (operational role + `ACTIVE` employment, per §9), exactly like every existing item is gated by `role` today — no new route-guard mechanism is invented, and the existing `parts`/Inventory-domain nav item and its route remain untouched, still `admin`/`dispatcher`-only exactly as today.

### 9. Architecture decisions adopted this round

The following are adopted as binding constraints on any Specification/Implementation Plan that follows this assessment — not options, not open questions:

1. **Operational-role-derived access requires `ACTIVE` employment.** An Employee whose `employmentStatus` is not `ACTIVE` never grants nav/route/query access via `operationalRoles`, regardless of what that array contains — matching the existing `useAssignableEmployees()` precedent (`where("employmentStatus","==","ACTIVE")`) rather than leaving this as an unstated assumption.
2. **Admin/dispatcher access remains unchanged.** Nothing in this initiative narrows, conditions, or re-gates any existing admin/dispatcher read or write path inventoried in §2/§3 — the new access path is strictly additive, for a new audience, over new or narrowly-scoped surfaces only.
3. **Unresolved or broken Employee/User linkage fails closed.** Per §6, a `technician` with no `employeeId`, or an `employeeId` pointing at a nonexistent/unreadable Employee document, is denied the new access path exactly as they are denied today — never granted by default, never treated as "eligible until proven otherwise."
4. **A nav-visible but permission-denied page is NOT an acceptable interim state.** The prior draft's Open Question #2 ("ship the nav fix, defer the Rules question, accept the resulting broken screen") is rejected outright. If a Specification cannot deliver both the reachability change and its matching, narrowly-scoped Rules/query grants together, it does not ship the reachability change.
5. **Required Rules/query/index changes must be merged, separately deployed, and verified before the UI access change merges.** Mirrors this initiative's own established C0-index-before-query discipline (Issue #154's PR #173 deployed and confirmed `[READY]` before PR #177's query code merged) — the new narrowly-scoped Rules grants and any supporting index must be live and confirmed in production before the PR that makes the new surface reachable is allowed to merge, not merely committed alongside it.
6. **The prior technician-assignee exclusion is reconsidered only after this initiative is safely complete, never automatically removed.** `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4 (excluding `technician`-role employees from Parts Associate assignment eligibility) stays in force unchanged by this initiative. Resolving Issue #100 does not, by itself, revisit or lift that constraint — any future change to it requires its own explicit, separate Owner/Architecture decision, made after this initiative's own access model has shipped and been verified safe, not bundled into or inferred from it.

### 10. Deny-by-default behavior and no raw IDs in human-facing flows

**Deny-by-default:** confirmed already correct throughout the chain investigated — `isNavItemVisible`/`isDomainVisible` default to exclusion; `App.jsx`'s catch-all redirects to `/dashboard`; every Rules read/write gate inventoried in §2/§3 defaults deny; `resolveEmployeeSession()` resets to empty/null on any failure. Decision 9.3 above makes this explicit and binding for the new access path specifically, not merely inherited incidentally.

**No raw IDs in human-facing flows:** the established convention is `PartsList.jsx`'s `resolveAssigneeDisplay()`: resolve to a display name via the Employee directory, or an explicit placeholder (`"Unknown assignee"`) — never a raw uid, in any surface held to that stricter bar. The new dedicated surface (§7, Design (a)) does not itself need to resolve *other* employees' identities (it has no cross-user oversight section), which is a further argument for Design (a) over (b): it structurally avoids needing `useEmployeeDirectory()` at all, rather than needing to remember to keep that convention correct on a reused page.

### 11. `firestore.rules`/schema/index implications

**Already correct, no change needed:** `employees/{employeeId}` self-read (`firestore.rules:198-202`); `canSubmitManualZeroHistoryQuantity()` (`firestore.rules:44-55`).

**New, narrowly-scoped grants needed** (per §7 Design (a), §3): a Rules read grant for the new "my submitted requests" query shape (`where("requestedBy","==",uid)` on `reorder_requests`, likely expressible as a per-document rule — `resource.data.requestedBy == request.auth.uid` — combined with the eligibility check from decision 9.1, rather than a blanket collection-level grant); and a Rules read grant (and/or a purpose-built narrower query/read mechanism, TBD at Specification time) for "what needs a manual quantity submitted," explicitly **not** the same unfiltered `inventory_transactions` collection-level grant `isAdminOrDispatcher()` currently has.

**Schema:** no new fields required — `operationalRoles`, `employmentStatus`, and `requestedBy` all already exist and are already populated by existing provisioning/creation paths.

**Index:** the existing `reorder_requests` queries are single/double equality filters requiring no composite index; a new `where("requestedBy","==",uid)` query is a single equality filter, also requiring no composite index. Whatever narrower mechanism is chosen for the "what needs planning" read may or may not need one — Specification-level design, not resolved here. Per decision 9.5, whatever index is needed must be deployed and confirmed `[READY]` before the UI access change merges.

### 12. Browser and Rules test matrix (for a future Implementation Plan, not performed here)

No test seam or driver change was made — this is scope only. A future Implementation Plan's browser coverage should include, at minimum:

| Account | Security `role` | `operationalRoles` | `employmentStatus` | Expected outcome (post-fix, Design (a) surface) |
|---|---|---|---|---|
| admin | admin | — | — | Unchanged: full `PartsList.jsx`/`PartDetail.jsx` access; new surface irrelevant/not needed |
| dispatcher | dispatcher | — | — | Unchanged: full `PartsList.jsx`/`PartDetail.jsx` access |
| eligible technician (Parts Manager) | technician | `["PARTS_MANAGER"]` | ACTIVE | Reaches the new dedicated surface; can submit a manual NEEDS_PLANNING quantity; sees only their own `requestedBy`-scoped submissions; **does not** reach `PartsList.jsx`/`PartDetail.jsx`, the Employee directory, or the full ledger |
| eligible technician (Warehouse Manager) | technician | `["WAREHOUSE_MANAGER"]` | ACTIVE | Identical outcome to Parts Manager (§7 — no differentiation in the current model) |
| ineligible technician (no operational role) | technician | `[]` or absent | ACTIVE | Denied — unchanged from today |
| technician, broken Employee link | technician | N/A (no Employee doc resolves) | N/A | Denied — fails closed per decision 9.3 |
| technician, unresolved linkage (no `employeeId`) | technician | N/A | N/A | Denied — fails closed per decision 9.3 |
| technician, inactive eligible Employee | technician | `["PARTS_MANAGER"]` | INACTIVE / TERMINATED | Denied — fails closed per decision 9.1, despite otherwise-eligible `operationalRoles` |
| dispatcher/admin with no eligible operational role | dispatcher / admin | `[]` | — | Unchanged — full access via existing `role`, proving decision 9.2 (additive, not a replacement) |

**Rules-level assertions** (SDK probe or driver-level, per this repo's existing `queryFailureProbe` pattern where a browser session cannot reach the negative case): an eligible, `ACTIVE` technician's new `requestedBy`-scoped query succeeds and returns only their own documents; the same account's attempt to read the Parts Manager Queue / All Assigned Work / History query shapes, or the unfiltered `employees`/`inventory_transactions` collections, is denied — proving the new grants are exactly as narrow as §3/§11 specify, not accidentally broader. An inactive-employment or broken-linkage technician's attempt at the new query is denied even though the query shape itself would otherwise match.

**Direct-URL-navigation assertions**, per §8: typing the new surface's URL and `/inventory`/`/inventory/:partId` directly for every account above, not merely checking nav-link presence.

## Affected files (for a future implementation; unchanged by this assessment)

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/domain/constants.js` | Defines `ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE` | Source of truth for nav/route gating; the new surface's nav item and its eligibility input are defined/consumed here |
| `field-ops-app-vite/src/navigation/navConfig.js`, `App.jsx` | Nav + route predicates | A **new** nav item/route is added for the dedicated surface (§7 Design (a)); the existing `parts`/Inventory-domain item and route are **not** modified |
| `field-ops-app-vite/src/auth/AuthContext.jsx` | Resolves `role`/`employeeId`/`operationalRoles` per session | Already exposes everything needed (`operationalRoles`); `employmentStatus` is not currently resolved into session state and would need to be, per decision 9.1 |
| A **new** component/route (not yet named) | N/A — does not exist today | The dedicated Inventory-planning surface itself (§7 Design (a)) |
| `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx` | Existing operational-role-aware client eligibility check | Reused as-is inside the new surface; not modified |
| `firestore.rules` | Gates every collection in §2/§3 | New, narrowly-scoped grants added per §11 — Tier 2, requires explicit Owner decision, deployed and verified per decision 9.5 before the UI PR merges |
| `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs`, `driver.mjs` | Test fixture/driver infrastructure | No `DRIVER_ACCOUNTS` entry today is seeded as `role: technician`; needs at least the fixtures in §12's matrix |

## Dependencies

- Directly named as deferred-to by `docs/assessments/inventory-operational-queue.md` (Issue #154's own assessment, Architecture Review decision #4 and Risks section): that constraint stays in force per decision 9.6 above — this initiative does not lift or reconsider it.
- `RequestReorderControl.jsx`'s existing `operationalRoles` eligibility check is unaffected — it already does the right thing once reached; this assessment's scope is entirely about what surface reaches it and what else that surface would otherwise expose.
- No dependency on the Customer or Platform initiatives.

## Risks

- **Design (b) (shared-page, conditional sections) was seriously considered and rejected** (§7) specifically because of how easily it produces exactly the over-broad grant the directive warns against — an un-gated hook left on a shared page is a silent omission, not a conscious new grant. This risk does not apply to the recommended Design (a), but is recorded here so a future Specification does not re-introduce it by reaching for the shared pages as a shortcut.
- **The "what needs planning" read (§7/§11) has no existing narrow query to reuse** — `useInventoryLedger()`'s full unfiltered `inventory_transactions` read is the only existing implementation, and it is not appropriately scoped for a new, narrower audience. This is real, unresolved design work for the Specification stage, not a solved problem this assessment is deferring casually.
- **`employmentStatus` is not currently part of `AuthContext`'s session state** — only `role`, `employeeId`, `displayName`, `operationalRoles` are resolved into `useAuth()` today. Decision 9.1 requires evaluating `employmentStatus`, which means either extending `resolveEmployeeSession()` to also read and expose it, or re-checking it at the Rules layer only (server-side) without surfacing it client-side — a Specification-level decision, not made here.
- **Sequencing risk (decision 9.5):** if the Rules/index PR and the UI-reachability PR are not strictly sequenced with a verified production deployment gate between them, the same "nav-visible but permission-denied" failure mode this round explicitly rejects (decision 9.4) could still occur by accident, not intent — the Implementation Plan must enforce the gate procedurally, not merely state it.

## Implementation options

Superseded by §7's Design (a) / Design (b) comparison at the component/query/action level, which replaces the prior draft's Option A/B (full-domain vs. `parts`-item-only nav gating) — that framing did not account for what the `parts` item actually mounts (§2). Design (a), the dedicated narrow surface, is recommended.

## Recommended smallest safe design (for Architecture Review, not a final decision)

1. **Build a new, dedicated, narrow Inventory-planning surface** (§7 Design (a)) — not a conditionally-gated version of `PartsList.jsx`/`PartDetail.jsx`. Its own nav item and route, gated by operational-role + `ACTIVE` employment (decision 9.1), entirely separate from the existing `parts`/Inventory-domain item, which remains admin/dispatcher-only and unmodified (decision 9.2).
2. **The new surface's read surface is exactly three items**, each individually and narrowly scoped, per §3/§7/§11: (i) a purpose-built "what needs a manual quantity" read, not the existing unfiltered ledger read; (ii) `RequestReorderControl`'s existing, already-correct write action; (iii) a new `requestedBy == uid`-scoped read of the user's own submissions. No Employee directory read, no Parts Manager Queue/All Assigned Work/History access, no Purchase Order/void/receiving/Inventory Action Log surface.
3. **Fail closed on every linkage and employment-status edge case** (decisions 9.1, 9.3) — unresolved, broken, or inactive-employment technicians get exactly the same denial as an ineligible one, never a default grant.
4. **Sequence Rules/query/index work strictly before the UI PR, with a verified production deployment gate between them** (decision 9.5) — mirroring this initiative's own established C0-before-PR-C precedent.
5. **Do not ship a nav-reachable, data-inaccessible interim state under any circumstance** (decision 9.4) — this supersedes the prior draft's Open Question #2, which is no longer open.
6. **Leave the technician-assignee exclusion (`inventory-operational-queue.md` decision #4) untouched** (decision 9.6) — record this initiative's completion as the trigger for a *future*, separate reconsideration, not an automatic side effect.
7. **Add a `technician`-role `DRIVER_ACCOUNTS` fixture** (with a linked, eligible, `ACTIVE` Employee) to `seed.mjs`, per §12 — today's fixture set has never been able to exercise this scenario in a real signed-in browser session.

## Sequencing (replaces the prior draft's two-PR estimate)

The prior draft's "Two PRs" estimate assumed capability-scoping meant a one-line nav-gate change plus an optional Rules PR. §2's complete surface matrix and §7's Design (a) recommendation both require materially more: a new surface, new narrowly-scoped queries, and a strictly-sequenced deployment gate (decision 9.5). Revised sequencing, derived directly from the completed capability matrix:

- **PR 1 — Rules, query, and (if needed) index changes only. No UI reachability change.** Adds the two new narrowly-scoped Rules grants from §11 (the "what needs planning" read and the `requestedBy`-scoped read), and any supporting index. Verified via SDK-level/driver probes (not a real browser session, since no reachable UI exists yet) that the new grants are exactly as narrow as specified — an eligible `ACTIVE` technician's new queries succeed; the same account's attempts at every existing admin/dispatcher-shaped query (Parts Manager Queue, All Assigned Work, History, full ledger, full Employee directory) are denied. **Must be merged, deployed to production, and confirmed [READY]/live before PR 2 merges** (decision 9.5).
- **PR 2 — The new dedicated Inventory-planning surface, nav item, and route**, wired to PR 1's already-deployed grants. Includes the `employmentStatus`-aware `AuthContext` extension if needed (per the Risks section), the new `technician`-role `DRIVER_ACCOUNTS` fixture, and full browser coverage per §12's matrix, run against the real, already-live Rules from PR 1 — not mocked or deferred.
- **PR 3 — reserved, not yet scoped.** Only if Architecture Review or a later Specification identifies a genuine divergence between Parts Manager and Warehouse Manager capability (§7's "no differentiation exists today" finding may not hold forever), or extends the surface beyond the three reads in §11. Not assumed, not started, not implied by this assessment.

This sequencing is itself an architecture decision this assessment recommends Architecture Review adopt explicitly, not merely a numbering convenience — it is what operationalizes decisions 9.4 and 9.5 into an enforceable PR order rather than a stated intention.

## Open questions for Architecture Review

1. **The "what needs planning" read mechanism** (§7, §11, Risks) — this assessment identifies that the existing `useInventoryLedger()` read is not appropriately scoped for the new audience, but does not design its replacement. Architecture Review/Specification must decide the shape of this new, narrower read.
2. **Whether `employmentStatus` should be added to `AuthContext`'s client-side session state**, or checked only server-side at the Rules layer for this new access path (Risks section) — affects whether the client can proactively explain "your account is not currently active" versus simply denying the query.
3. **Whether Parts Manager and Warehouse Manager will ever diverge in capability** — this assessment finds no existing basis for a distinction (§4, §7) and recommends treating them identically until a future need is evidenced; Architecture Review should confirm this is the intended posture, not an oversight.
4. **Confirmation of the sequencing in the "Sequencing" section above as binding**, not merely advisory — since decisions 9.4/9.5 depend on it being enforced procedurally across two separately-merged, separately-deployed PRs.
