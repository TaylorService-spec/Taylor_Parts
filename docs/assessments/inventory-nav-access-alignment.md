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

## Scope of this assessment

Investigated: `field-ops-app-vite/src/domain/constants.js` (`ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE`), `field-ops-app-vite/src/navigation/navConfig.js`, `field-ops-app-vite/src/App.jsx` (routing), `field-ops-app-vite/src/auth/AuthContext.jsx`, `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx`, `field-ops-app-vite/src/hooks/useAssignableEmployees.js`, `field-ops-app-vite/src/domain/employees.js`, `field-ops-app-vite/src/modules/inventory/PartsList.jsx` (raw-ID precedent), `firestore.rules` (`employees`, `reorder_requests`, `inventory_transactions`, `canSubmitManualZeroHistoryQuantity()`), `functions/scripts/provisionEmployeeAccess.js`, and the driver/seed test infrastructure (`field-ops-app-vite/.claude/skills/run-field-ops-app-vite/driver.mjs`, `seed.mjs`, `SKILL.md`).

Explicitly **not** investigated or addressed here:
- The broader manager-oversight/queue-visibility work from Issue #154 (PRs #164/#168/#173/#177) — that initiative explicitly deferred "any change broadening `reorder_requests` visibility to non-admin/dispatcher sign-in roles" to this issue (its own assessment's Risks section names Issue #100 directly), so this assessment picks that thread up rather than re-litigating it.
- The Inventory Action Log (`inventory_actions`) redesign (Issue #152) — unrelated to nav/access gating.
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

**Conclusion:** there is exactly one gate, applied twice (nav rendering and route mounting) from the same source of truth (`ROLE_NAV_ACCESS`/`PLACEHOLDER_DEFAULT_ROLES`), and it is keyed **only** on security `role`. `operationalRoles` never enters this decision at any point. Any fix must change route mounting, not merely nav-link visibility — a nav-only fix (rendering the link but leaving the route unmounted) would produce a broken link; a route-only fix (mounting the route but hiding the link) would produce an unreachable-except-by-typed-URL page. Both symptoms of the same single gate must move together.

### 2. Employee `operationalRoles` versus security `role` authority

Three distinct fields across two documents:

- **`users/{uid}.role`** — the security role (`admin`/`dispatcher`/`technician`). Read via `AuthContext`; the sole input to `ROLE_NAV_ACCESS` and to `firestore.rules`' `userRole()`/`isAdminOrDispatcher()`.
- **`employees/{employeeId}.operationalRoles`** (array: `PARTS_MANAGER`/`WAREHOUSE_MANAGER`/`PARTS_ASSOCIATE`, `domain/constants.js:152-181`) — an assignment/task-eligibility marker, explicitly documented in that file's own header comment as independent of security role: "OPERATIONAL_ROLE.PARTS_MANAGER and REORDER_REQUEST_OWNER.PARTS_MANAGER are the same string but mean two unrelated things on two unrelated fields."
- **`employees/{employeeId}.securityRole`** — a read-only *mirror* of `users/{uid}.role`, written only by `functions/scripts/provisionEmployeeAccess.js` or its drift-repair counterpart. `provisionEmployeeAccess.js:28-54` states explicitly it is "NEVER a source of authorization." It exists solely so admin/dispatcher-visible client code (the assignment picker) can filter by security role without a Rules exception on the otherwise self-read-only `users/{uid}` collection.

The one place client-side eligibility logic already reads `operationalRoles` is `RequestReorderControl.jsx:23-46`:

```js
const { role, operationalRoles } = useAuth();
const isEligible =
  role === ROLES.ADMIN ||
  operationalRoles.includes(OPERATIONAL_ROLE.PARTS_MANAGER) ||
  operationalRoles.includes(OPERATIONAL_ROLE.WAREHOUSE_MANAGER);
```

This check is blind to `isAdminOrDispatcher()` — it would render the eligible UI for a `technician` holding `operationalRoles: ["PARTS_MANAGER"]`, *if* that technician could ever reach the component. Per §1, they cannot: the nav/route gate rejects them before this logic ever runs. `operationalRoles` is authoritative for exactly one purpose in this codebase today (manual-quantity-entry eligibility, mirrored server-side in `canSubmitManualZeroHistoryQuantity()`) and is never consulted for navigation, routing, or `reorder_requests`/`inventory_transactions` read visibility (see §7).

### 3. Why an eligible technician cannot reach Inventory (mechanism)

Directly established by §1: `ROLE_NAV_ACCESS[ROLES.TECHNICIAN]` never includes `"inventory"`, and `App.jsx`'s route tree is built from the identical predicate, so the `/inventory` route itself does not exist for a `technician` session regardless of that user's linked Employee's `operationalRoles`. This is not a bug in eligibility logic — `canSubmitManualZeroHistoryQuantity()` and `RequestReorderControl.jsx`'s client mirror are both already correct and already operational-role-aware. The gap is structurally earlier: the navigation/routing layer decides reachability using a field (`role`) that has no relationship to the field (`operationalRoles`) the actual business eligibility check uses.

This is already documented as a known, live-discovered gap in three places in the repository today, none of which fix it:
- `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs:634-644` (inline comment explaining why the `eligiblePartsManager` driver account is seeded as `dispatcher`, not `technician`).
- `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/SKILL.md`'s Gotchas section (lines ~202-214) and its troubleshooting table (line ~239).
- `docs/assessments/inventory-operational-queue.md`'s Architecture Review decision #4 and Risks section, which adopted an *interim* safety constraint (excluding `technician`-role employees from Parts Associate assignment eligibility) explicitly because this issue was still open, and named Issue #100 as the place the real fix belongs.

### 4. Loading, unresolved, and broken Employee/User linkage behavior

`AuthContext.jsx`'s `resolveEmployeeSession(uid)` (lines ~43-77) is the sole resolver, called from `onAuthStateChanged`:

1. One-shot `getDoc(users/{uid})` reads `role` and `employeeId`.
2. `employeeId == null` → returns `{ role, employeeId: null, displayName: null, operationalRoles: [] }` immediately — documented as "a valid, expected migration state, not an error."
3. `employeeId` present → one-shot `getDoc(employees/{employeeId})`.
4. Employee doc doesn't exist (broken link) → `console.warn`s the `employeeId` only (never document contents), returns the same empty-operational-identity shape as step 2.
5. Otherwise → `{ role, employeeId, displayName: employeeData.displayName ?? null, operationalRoles: employeeData.operationalRoles ?? [] }`.

**Loading:** `AuthProvider` sets `loading: true` for the duration of every `onAuthStateChanged` cycle; `App.jsx` renders `<div className="fo-panel">Loading...</div>` and makes no role/nav decision while `loading` is true.

**Unresolved** (no `employeeId`) and **broken** (`employeeId` present but document missing) linkage are, today, indistinguishable in their effect: both resolve to `operationalRoles: []`, and neither affects nav/route gating at all, because that gating never reads `operationalRoles` in the first place (§1-3). A `technician` with a perfectly valid, `ACTIVE`, `PARTS_MANAGER`-tagged Employee link and a `technician` with no Employee link whatsoever are denied Inventory access **identically** — this is the clearest evidence that the gap is structural (wrong field consulted), not a data-quality edge case.

**Denied/failed read:** caught in a `try/catch`; all four fields reset to their empty/null defaults, never falls back to a default role.

**A related, narrower data-quality pattern already exists** (not the same mechanism, but relevant precedent for how this repo surfaces broken linkage today): `useAssignableEmployees.js`'s `applyPartsAssociateSecurityRoleEligibility()` filters out Employees whose `securityRole` mirror is missing or not a valid enum value, and reports a count consumed by `EmployeeAssignmentPicker.jsx` as an admin/dispatcher-visible warning banner ("N employees have unverified role data"). This is scoped to the assignment-picker's own eligible-candidate list, not to nav/route gating or to the signed-in user's own session — any future design that surfaces linkage problems to the signed-in *technician themselves* would need a new, session-scoped presentation, not a reuse of this admin-facing banner.

### 5. Whether access should be full Inventory or capability-scoped

Two structurally different designs are viable; this assessment does not decide between them (Architecture Review's job), but lays out what each implies:

**Option A — Full Inventory nav/route access, gated by presence of any eligible `operationalRoles` entry.** A `technician` with `operationalRoles` containing `PARTS_MANAGER` or `WAREHOUSE_MANAGER` (or, if extended, `PARTS_ASSOCIATE`) gets the same `/inventory` route tree and nav link as `admin`/`dispatcher` today. Simple to reason about (one gate, same shape as today, just a wider input), but grants nav/route reachability to the *entire* Inventory domain (Warehouses, Transfers, Receiving, Cycle Counts, Back Orders subnav items too — none of which have any operational-role-aware eligibility logic today) on the strength of eligibility for one narrow action (manual quantity entry). This would be a scope expansion beyond what Issue #100 actually evidences a need for.

**Option B — Capability-scoped access: only the specific Inventory surfaces the user's `operationalRoles` actually authorize.** A `technician` with `operationalRoles: ["PARTS_MANAGER"]` reaches only the Parts/Reorder-Request-adjacent surfaces (`PartsList.jsx`'s queue sections, `RequestReorderControl.jsx`), not the full Inventory domain (Warehouses/Transfers/Receiving/Cycle Counts/Back Orders, none of which have any operational-role concept defined). This requires either (a) a finer-grained nav/route predicate than the current single `role`-keyed `ROLE_NAV_ACCESS` map (e.g. a per-item eligibility function, not just a per-role static list), or (b) accepting that only the `parts` subnav item's `legacyKey` gate changes while every other Inventory subnav item remains `admin`/`dispatcher`-only via `PLACEHOLDER_DEFAULT_ROLES` — which the current `navConfig.js` structure already supports without inventing a new mechanism, since `isNavItemVisible()` already evaluates per-item.

**This assessment's reading of the evidence favors Option B's narrower framing** (see "Recommended smallest safe design" below) — Issue #100's own concrete scenario is specifically about the manual-quantity-entry/reorder-request flow, and `operationalRoles` today has zero defined relationship to Warehouses/Transfers/Receiving/Cycle Counts/Back Orders. Granting Option A's full-domain access would be authorizing surfaces this issue never evidenced a need for, and would need those other subnav items to define their own operational-role semantics from scratch — undefined territory, not a decision this assessment can make.

### 6. Route-level enforcement, not navigation visibility alone

Established in §1: this codebase does not have a separate "nav visibility" layer and "route guard" layer — `isNavItemVisible`/`isDomainVisible` gate both simultaneously, from one call site each in `App.jsx`. This is actually a favorable existing property for a fix: there is no separate route-guard component to find and update in parallel with a nav-config change — updating the *input* to these same two functions (i.e., what determines `allowedLegacyKeys`/eligibility, not the functions themselves) is sufficient to move both nav visibility and route mounting together, avoiding the failure mode of a nav-only fix (visible link, unreachable route) or a route-only fix (reachable-by-typed-URL, invisible link).

Any fix must therefore change the *input signal* consulted before nav/route decisions are made (today: `role` alone) rather than add a second independent enforcement point, to avoid introducing exactly the split-brain state a route-guard-plus-nav-config architecture would otherwise be prone to.

### 7. Deny-by-default behavior and no raw IDs in human-facing flows

**Deny-by-default:** confirmed already correct throughout the chain investigated. `isNavItemVisible`/`isDomainVisible` default to exclusion (an item/domain is visible only if explicitly listed or matched); `App.jsx`'s catch-all route redirects to `/dashboard`, never rendering a "Not Found" or exposing route structure; `firestore.rules`' `reorder_requests`/`inventory_transactions` reads default-deny (`allow read: if isAdminOrDispatcher()`, with no fallback `allow read: if true` anywhere in the collections investigated); `resolveEmployeeSession()` on any failure/denial resets to the empty/null identity shape rather than granting a default role. Any fix should preserve this property exactly — a new operational-role-based gate must be additive-allow, not a broadened default.

**No raw IDs in human-facing flows:** the established convention (already reviewed and adopted in PR A of the Issue #154 initiative) is `PartsList.jsx`'s `resolveAssigneeDisplay()` (lines ~258-277): resolve to a display name via the Employee directory, or fall back to an explicit human-readable placeholder (`"Unknown assignee"`) — never the raw Firebase uid, in any surface held to that stricter bar. This assessment's own scope (nav/route access) does not itself render an actor identity to a technician user, but if a future fix surfaces *why* access was denied or *what* operational role is required (e.g. an admin-visible "this Employee record has no eligible operationalRoles" message, mirroring `useAssignableEmployees.js`'s "unverified role data" banner pattern), that surface must follow this same convention — no raw `employeeId`/`uid` in any message a human reads.

### 8. `firestore.rules`/schema/index implications

**`employees/{employeeId}`** (`firestore.rules:198-202`) already permits a signed-in user to read their *own* linked Employee document (`isAdminOrDispatcher() || (isSignedIn() && userData().employeeId == employeeId)`) — this is what makes `resolveEmployeeSession()` work for a `technician` today. No Rules change is needed for a technician to continue reading their own `operationalRoles`.

**`canSubmitManualZeroHistoryQuantity()`** (`firestore.rules:44-55`) already authorizes `operationalRoles`-holding employees independent of security role, via `hasOperationalRole()`. No Rules change is needed here either — this function is already correct for the one write action it governs.

**The second, independent gap this assessment must flag: `reorder_requests` read access is `isAdminOrDispatcher()`-only, unconditionally** (`firestore.rules:324-325`), with no `operationalRoles` branch on the read side at all (only on the `allow create`'s NEEDS_PLANNING branch). **A nav/route fix alone, without a matching Rules change, would let a technician reach the Inventory screen and then immediately hit `permission-denied` reading the very `reorder_requests`/queue data the screen shows.** This is a Tier 2 decision under `docs/DelegationCharter.md` ("changes to `firestore.rules` that alter who can read or write what") — not assumed or scoped by this assessment, but it must be named explicitly as in-scope-or-explicitly-deferred by whatever Specification follows Architecture Review, or the nav fix alone would ship a broken, not merely incomplete, experience. `inventory_transactions` (`firestore.rules:228-231`) has the identical `isAdminOrDispatcher()`-only read gate with no `operationalRoles` path at all — relevant only if a capability-scoped design (§5, Option B) ever extends to the Inventory Health/ledger surfaces, not the reorder-request flow Issue #100 concretely evidences.

**Schema:** no new fields are required for either Option A or Option B in §5 — `operationalRoles` already exists and is already populated by the same provisioning path (`provisionEmployeeAccess.js`) that sets `role`/`employeeId`. **Index:** the existing `reorder_requests` queries (`useReorderRequestsByStatus`, etc.) are all single/double equality filters requiring no composite index; if a Rules change opens a *new* query shape for technician-scoped reads (e.g. filtering by the caller's own `operationalRoles`-linked assignments), that would need its own index review at Specification time, not assumed here — but nothing in this assessment's findings requires one for read-visibility alone (visibility is a Rules predicate, not a new query filter).

### 9. Browser test matrix (for a future Implementation Plan, not performed here)

No test seam or driver change was made — this is scope only. A future Implementation Plan's browser coverage should include, at minimum:

| Account | Security `role` | `operationalRoles` | `employmentStatus` | Expected Inventory nav/route outcome (post-fix) |
|---|---|---|---|---|
| admin | admin | — | — | Full access (unchanged) |
| dispatcher | dispatcher | — | — | Full access (unchanged) |
| eligible technician (Parts Manager) | technician | `["PARTS_MANAGER"]` | ACTIVE | Reaches the scoped Inventory surface (new); can submit manual NEEDS_PLANNING quantity per existing `canSubmitManualZeroHistoryQuantity()` |
| eligible technician (Warehouse Manager) | technician | `["WAREHOUSE_MANAGER"]` | ACTIVE | Same as above |
| ineligible technician (no operational role) | technician | `[]` or absent | ACTIVE | Denied, unchanged from today (nav link absent, direct URL redirects to `/dashboard`) |
| technician, broken Employee link | technician | N/A (no Employee doc resolves) | N/A | Denied, unchanged from today — proves the fix reads `operationalRoles` correctly rather than granting access on `role == technician` alone |
| technician, inactive eligible Employee | technician | `["PARTS_MANAGER"]` | INACTIVE/TERMINATED | Explicitly decide and test whether `employmentStatus` gates this new access path (today's assignment-eligibility query already filters on `employmentStatus == ACTIVE`; nav/route access has no precedent either way and must not silently diverge) |
| dispatcher/admin, no eligible operational role | dispatcher / admin | `[]` | — | Unchanged — full access via existing `role`, proving the new gate is additive, not a replacement of the existing `role`-based path |

Additionally: direct-URL-navigation assertions (typing `/inventory` and `/inventory/:partId` while signed in as each account above, not merely checking nav-link presence — per §6's finding that nav and route are the same gate, but a regression could still decouple them); and, if the Rules gap in §8 is addressed in the same or a coordinated change, an assertion that an eligible technician's `reorder_requests` reads no longer error once inside the screen.

## Affected files (for a future implementation; unchanged by this assessment)

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/domain/constants.js` | Defines `ROLES`, `ROLE_NAV_ACCESS`, `OPERATIONAL_ROLE` | Source of truth for nav/route gating; any new eligibility input is defined or consumed here |
| `field-ops-app-vite/src/navigation/navConfig.js` | `isNavItemVisible()`/`isDomainVisible()` predicates | Where a new operational-role-aware eligibility check would need to be threaded through, alongside or instead of the current `role`-only `allowedLegacyKeys` model |
| `field-ops-app-vite/src/App.jsx` | Builds nav + `<Route>` tree from the same predicates | Both the nav link and the route itself must move together (§6) |
| `field-ops-app-vite/src/auth/AuthContext.jsx` | Resolves `role`/`employeeId`/`operationalRoles` per session | Already exposes `operationalRoles`; no change needed to the resolver itself, only to what consumes its output |
| `field-ops-app-vite/src/shared/inventory/RequestReorderControl.jsx` | Existing operational-role-aware client eligibility check | Precedent pattern for how a nav-layer check should read `operationalRoles`, not a file this assessment's fix needs to change |
| `firestore.rules` (`reorder_requests`, `inventory_transactions` match blocks) | Read-gates every Inventory-adjacent collection at `isAdminOrDispatcher()` only | The second, independent gap (§8) — Tier 2, requires an explicit, separate Owner decision, not assumed by any nav-only fix |
| `field-ops-app-vite/.claude/skills/run-field-ops-app-vite/seed.mjs`, `driver.mjs` | Test fixture/driver infrastructure | No `DRIVER_ACCOUNTS` entry today is seeded as `role: technician`; a future Implementation Plan needs at least one, per §9 |

## Dependencies

- Directly named as deferred-to by `docs/assessments/inventory-operational-queue.md` (Issue #154's own assessment, Architecture Review decision #1 and #4, and its Risks section): that initiative kept `reorder_requests` visibility at admin/dispatcher-only and imposed an interim safety constraint on Parts Associate assignment eligibility, explicitly pending this issue. Any Specification following this assessment should re-read that document's decision #4 and Risks section, since resolving Issue #100 may allow revisiting (not automatically reversing) that interim constraint.
- `RequestReorderControl.jsx`'s existing `operationalRoles` eligibility check is unaffected either way — it already does the right thing once a user can reach it; this assessment's scope is entirely about reachability, not about that component's own logic.
- No dependency on the Customer or Platform initiatives.

## Risks

- **A nav/route-only fix without a coordinated Rules decision (§8) would trade one broken experience for another** — an eligible technician would gain a visible, reachable Inventory screen that then fails to load its own data (`permission-denied` on `reorder_requests`). The Specification that follows this assessment must explicitly decide whether the Rules change ships in the same PR, a tightly sequenced follow-up, or is consciously deferred with the resulting broken-screen behavior called out and accepted — not silently left as a surprise.
- **Full-domain access (§5 Option A) risks granting reachability to Inventory subnav items with no defined operational-role semantics** (Warehouses, Transfers, Receiving, Cycle Counts, Back Orders) — none of these have ever been evaluated for what a `technician` with `operationalRoles` should or shouldn't do there. This assessment recommends against Option A for exactly this reason (§5), but flags it as a real risk if Architecture Review chooses it anyway without separately scoping those surfaces.
- **`employmentStatus` has no precedent in nav/route gating today** (only in assignment-picker query filtering) — a Specification must explicitly decide whether an `INACTIVE`/`TERMINATED` Employee's otherwise-eligible `operationalRoles` should grant nav access, rather than leaving this as an unstated assumption that could silently diverge from the assignment-eligibility precedent.
- **Session-scoped Employee reads already work for a technician reading their own record** (`firestore.rules:198-202`), so a nav/route fix does not itself require a new Rules read path to *evaluate* eligibility client-side — only to *act* on the resulting screen (§8's `reorder_requests` gap). Conflating these two facts risks under-scoping the Rules work needed.

## Implementation options

See §5 for the full Option A / Option B comparison (full-domain vs. capability-scoped access) and its recommendation. Restated briefly:

- **Option A (full Inventory domain access for any eligible `operationalRoles`)** — simplest to implement (one input change to the existing single `role`-keyed gate model), but expands reachable surface area beyond what Issue #100 evidences a need for, into Inventory subnav items with no operational-role semantics defined.
- **Option B (capability-scoped: only the `parts`/reorder-request-adjacent surface)** — narrower, matches Issue #100's concrete scenario exactly, and is implementable today without inventing new mechanism (`navConfig.js`'s `isNavItemVisible()` already evaluates per-item, not only per-domain) by changing only the `parts` item's eligibility input, leaving every other Inventory subnav item's `admin`/`dispatcher`-only gate untouched.

## Recommended smallest safe design (for Architecture Review, not a decision)

1. **Adopt Option B (capability-scoped), not Option A.** Change only the `parts` subnav item's (and, if the same coordinated Rules decision is made, the underlying `reorder_requests`/queue data's) eligibility input to also admit a `technician` whose linked, `ACTIVE` Employee holds `operationalRoles` containing `PARTS_MANAGER` or `WAREHOUSE_MANAGER` — the same two values `canSubmitManualZeroHistoryQuantity()` already recognizes. Every other Inventory subnav item (Warehouses, Transfers, Receiving, Cycle Counts, Back Orders) remains exactly as gated as it is today (`admin`/`dispatcher`-only via `PLACEHOLDER_DEFAULT_ROLES`), unchanged.
2. **Move the nav link and the route together, from one shared eligibility input**, per §6 — do not add a second, independent enforcement point; change what `isNavItemVisible`/`isDomainVisible` are given as input for this one item, not the functions' own logic or structure.
3. **Explicitly decide the `reorder_requests`/`inventory_transactions` Rules question (§8) in the same Specification**, even if the decision is "defer, and the resulting screen will show a permission error for now" — the point is that it must be a stated decision, not an unexamined side effect of a nav-only change shipping alone.
4. **Explicitly decide the `employmentStatus` question** for this new access path (§8, Risks) — recommend matching the existing assignment-eligibility precedent (`ACTIVE` only) for consistency, but this is Architecture Review's call, not assumed here.
5. **Preserve deny-by-default throughout** — the new gate must be additive-allow on top of the existing `role`-based gate, never a broadened default; every finding in §7 confirms this property already holds everywhere else in the chain and should not regress.
6. **Add a `technician`-role `DRIVER_ACCOUNTS` fixture** (with a linked, eligible Employee) to `seed.mjs`, per §9 — today's fixture set has never been able to exercise this exact scenario in a real signed-in browser session, which is part of why this gap went undetected until Issue #100's live discovery.

## Estimated PR count

**Two PRs**, matching the Specification's likely natural boundary once Architecture Review decides §8's Rules question:
- **PR 1 — Nav/route access** (Option B, `parts` item only), plus the new technician-eligible `DRIVER_ACCOUNTS` fixture and its browser coverage (§9's matrix, minus the `reorder_requests`-read assertion if PR 2 is sequenced after).
- **PR 2 — `reorder_requests`/`inventory_transactions` Rules change** (Tier 2, if Architecture Review approves widening read access for eligible technicians), sequenced after PR 1's index/deploy discipline precedent (this initiative's own C0 index-before-query pattern) if any new query shape is introduced.

If Architecture Review instead decides the Rules question is out of scope entirely (nav-reachable, permission-denied-on-data accepted as a documented interim state), this collapses to one PR — the Specification should state which of these two shapes it is choosing, not leave it implicit.

## Open questions for Architecture Review

1. **Full-domain (Option A) vs. capability-scoped (Option B) access** — this assessment recommends Option B (§5); Architecture Review must decide, since Option A has unscoped implications for Inventory subnav items with no defined operational-role semantics.
2. **Whether the `reorder_requests`/`inventory_transactions` Rules gap (§8) is addressed in the same initiative, a tightly sequenced follow-up, or consciously deferred** — and if deferred, whether shipping a nav-reachable-but-data-inaccessible screen is an acceptable interim state or a blocking condition on the nav fix itself.
3. **Whether `employmentStatus` gates this new access path** (§8, Risks) — recommend matching the existing `ACTIVE`-only assignment-eligibility precedent, but not assumed here.
4. **Whether resolving this issue should prompt revisiting `docs/assessments/inventory-operational-queue.md`'s interim technician-assignee exclusion** (its Architecture Review decision #4) — that constraint was explicitly adopted as an interim measure pending this issue, not a permanent one.
