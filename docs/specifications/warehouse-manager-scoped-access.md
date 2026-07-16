---
artifact_type: specification
gate: Sprint Specification
status: Draft
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/assessments/warehouse-manager-scoped-access.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 332
related_issue: 226
target_release: TBD
---

# Specification: `WAREHOUSE_MANAGER` Scoped Warehouse Access

**Architecture input:** `docs/assessments/warehouse-manager-scoped-access.md` — Option A (Employee-document `assignedWarehouseIds` field) adopted; Option B (governed `RoleAssignment`/`Scope.location`) recorded as the future destination once Issue #226's storage/Rules foundation exists. This Specification fixes the exact contracts for both representations. **No code, schema, Rules, Functions, index, or production change is made by this document** — every clause below is a contract for a later, separately-gated Implementation Plan row to build.

## 1. Executive summary

A `WAREHOUSE_MANAGER`-eligible technician gains **read-only, per-warehouse-scoped** access to `warehouses`, `stock_locations`, and `transfer_orders` — exactly the set of warehouses recorded in a new `assignedWarehouseIds` field on their linked Employee document, and nothing beyond it. No default access; a missing or empty assignment list denies every warehouse. No write capability is introduced (none exists for any role today).

## 2. Employee-document schema addition (Assessment §3, Option A)

```
employees/{employeeId} {
  ...existing fields (employeeId, displayName, employmentStatus, operationalRoles, userId, securityRole, createdAt, updatedAt), unchanged...
  assignedWarehouseIds?: string[]   // NEW. Absent or [] => no warehouse access, for any role.
}
```

- **Type:** array of `Warehouse.id` strings (`functions/src/types/warehouse.ts`). No uniqueness/ordering constraint.
- **Default/absence:** an Employee document written before this field existed has no `assignedWarehouseIds` key at all. **Absence must be treated identically to `[]`** — never as "all warehouses" (Assessment §4's fail-closed table). This is the same "new optional field, old documents are simply absent, treated as the empty/no-grant case" pattern `employmentStatus`/`operationalRoles` themselves already established when Issue #100 introduced them.
- **Not role-exclusive:** the field lives on the Employee document generically (like `operationalRoles`), not nested under a `WAREHOUSE_MANAGER`-specific sub-object — a future role needing warehouse scoping (there is none proposed here) could reuse the same field without a schema fork. It has **no effect** for an Employee whose `operationalRoles` doesn't contain `WAREHOUSE_MANAGER` — Issue #100's own "operational role never becomes a security Permission by itself" invariant (Enterprise Access Spec §9) applies here too: the field alone grants nothing without the accompanying `isActiveOperationalRole("WAREHOUSE_MANAGER")` check.
- **Who writes it:** `functions/scripts/provisionEmployeeAccess.js` (Admin-SDK, matching how `operationalRoles` is already assigned) — a future Implementation Plan's own task, not designed further here (Assessment §7).

## 3. Firestore Rules contract (illustrative — not implemented by this Specification)

Restates Assessment §4/§5 (item 1) as the exact intended `firestore.rules` shape, for a **future, separately-authorized** Rules PR to implement verbatim or adapt:

```
// Helper (new, alongside isActiveOperationalRole()):
function isAssignedToWarehouse(warehouseId) {
  return isActiveOperationalRole("WAREHOUSE_MANAGER")
    && linkedEmployeeData().assignedWarehouseIds is list
    && linkedEmployeeData().assignedWarehouseIds.hasAny([warehouseId]);
}

match /warehouses/{warehouseId} {
  allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);
  allow create, update, delete: if false;   // unchanged
}

match /stock_locations/{stockLocationId} {
  allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(resource.data.warehouseId);
  allow create, update, delete: if false;   // unchanged
}

match /transfer_orders/{transferOrderId} {
  allow read: if isAdminOrDispatcher()
    || isAssignedToWarehouse(resource.data.fromWarehouseId)
    || isAssignedToWarehouse(resource.data.toWarehouseId);
  allow create, update, delete: if false;   // unchanged
}
```

- **Additive only:** every `allow read` above is `isAdminOrDispatcher() || ...` — the existing admin/dispatcher branch is preserved byte-for-byte; only a new `||` arm is added, matching every prior Issue #100 Rules PR's own additive-widening discipline.
- **`isAssignedToWarehouse()` re-derives the linked Employee via the existing `linkedEmployeeData()`/`isActiveOperationalRole()` helpers** — no new `get()` call pattern, reusing the exact performance-conscious binding (Issue #100 PR 3a's own "one `get()` per invocation" optimization) those helpers already provide.
- **`assignedWarehouseIds is list` guard** mirrors this codebase's own established defensive pattern (`operationalRoles is list` inside `isActiveOperationalRole()` itself, `resource.data.operationalRoles is list` in PR #332's own `employees` branch) — fails closed on a malformed/legacy document shape rather than throwing.

## 4. Governed-model contract (Issue #226 layer, future — Assessment §5 (item 2))

### 4.1 New `ConditionKind`

```typescript
// types/access.ts
export type ConditionKind =
  | "statusEquals"
  | "statusIn"
  | "isOwnAssignment"
  | "employmentActive"
  | "operationalRoleActive"
  | "assignedToWarehouse";   // NEW
```

### 4.2 `ConditionContext` addition

```typescript
// resolveEffectivePermission.ts
export interface ConditionContext {
  status?: string;
  isOwnAssignment?: boolean;
  employmentActive?: boolean;
  operationalRoleActive?: (role: string) => boolean;
  assignedToWarehouse?: (warehouseId: string) => boolean;   // NEW
}
```

Same posture as `operationalRoleActive` (Spec §9 of the Enterprise Access Specification, restated here): the resolver never derives this itself — the caller (a future Rules `get()` result or trusted Function) supplies the closure, since only the caller has the linked Employee document. `params` carries the specific `warehouseId` the target resource is being checked against:

```typescript
{ kind: "assignedToWarehouse", params: { warehouseId: "<target's warehouseId>" } }
```

evaluated (illustrative, matching `evaluateConditions()`'s existing `switch` shape exactly):

```typescript
case "assignedToWarehouse":
  return (
    typeof condition.params.warehouseId === "string" &&
    typeof context.assignedToWarehouse === "function" &&
    context.assignedToWarehouse(condition.params.warehouseId) === true
  );
```

### 4.3 `TECHNICIAN_ROLE` grant (compatibilityRoles.ts, future)

```typescript
permissions: [..., "warehouse.record.read", "warehouse.stockLocation.read", "warehouse.transferOrder.read"],
conditionsByPermission: {
  ...
  "warehouse.record.read": [
    { kind: "operationalRoleActive", params: WAREHOUSE_MANAGER_ONLY },
    { kind: "assignedToWarehouse", params: {} },   // params.warehouseId supplied per-call by the caller's target context, not statically here
  ],
  // same shape for warehouse.stockLocation.read / warehouse.transferOrder.read
},
```

**Open representational question (not resolved by this Specification — see §7):** `conditions.every(...)`'s existing AND semantics work cleanly when a Condition's `params` is fully static (e.g. `operationalRoleActive`'s `role`/`roles`). `assignedToWarehouse`'s `warehouseId` is **per-target**, not knowable when the Role is declared — the illustrative `params: {}` above is deliberately incomplete; the real mechanism is that `TargetContext.condition.assignedToWarehouse` (the caller-supplied closure) already closes over the specific target's warehouse id(s), and the Condition's own `params.warehouseId` field may turn out to be **unnecessary** for this particular `ConditionKind` (unlike `operationalRoleActive`, which needs `params.role` to know *which* role to check). This ambiguity is flagged, not silently resolved, in §7.

### 4.4 `transfer_orders`' two-field OR, in the governed model

The Rules-layer contract (§3) ORs two Rules calls. The governed-model equivalent cannot express "OR across two target fields" as a single Condition evaluation against one `TargetContext` — the same limitation Assessment §6 already identified at the client-query layer. The two realistic options, **neither adopted here** (Assessment §7 defers "who/how" questions; this is a "how would the contract even shape it" question, equally deferred):

1. The caller evaluates `resolveEffectivePermission()` twice (once per warehouse field) and ORs the two `ResolveResult`s itself — the resolver's own contract already supports this (Spec §8: "a pure function... same inputs always yield the same decision"), no resolver change needed.
2. `ConditionContext.assignedToWarehouse` itself accepts an array (`warehouseIds: string[]`) and internally checks membership against either — pushes the two-field problem into the caller's own closure construction instead of the resolver.

## 5. Fail-closed behaviour (restates Assessment §4's table as normative contract)

| Input state | Required decision |
|---|---|
| Broken/missing Employee linkage | DENY (upstream, via existing `isActiveOperationalRole()`/`operationalRoleActive` failure) |
| `employmentStatus != "ACTIVE"` | DENY (upstream) |
| `operationalRoles` lacks `WAREHOUSE_MANAGER` | DENY (upstream) |
| `assignedWarehouseIds` absent | DENY for every warehouse |
| `assignedWarehouseIds: []` | DENY for every warehouse |
| `assignedWarehouseIds` non-empty but excludes target warehouse | DENY for that warehouse |
| Malformed `assignedWarehouseIds` (not a list) | DENY (the `is list` guard, §3) |

No state in this table ever resolves to ALLOW by falling through an unhandled branch — every row is an explicit DENY, matching this Specification series' own standing fail-closed discipline (Enterprise Access Spec §13).

## 6. Explicitly out of scope

Identical to Assessment §7: Equipment/Reporting (Customer-owned); the assignment-writing mechanism; any actual code/schema/Rules/Functions/index/claims change; Epic 5 Procurement.

## 7. Open questions (for the Owner — genuinely not inferable)

- **§4.3's representational gap:** whether `assignedToWarehouse`'s per-target `warehouseId` belongs in the Condition's static `params` (requiring some new per-call binding mechanism the resolver doesn't have today) or is fully carried by the caller-supplied `ConditionContext` closure (making `params` empty/unused for this one `ConditionKind`, an asymmetry with `operationalRoleActive`'s own `params.role`). This affects the resolver's own type contract and is not safely inferable from existing precedent, since no prior `ConditionKind` has needed a per-target (not per-Role-declaration) parameter.
- **§4.4's two-field OR:** which of the two options (double-resolve-and-OR vs. array-accepting closure) the governed model should adopt, if/when this ever needs real enforcement.
- Whether the Issue #100-scale Rules PR (§3) should be authorized to proceed **independently** of the full Enterprise Access governed-model rollout (§4), given the two are designed to encode identical policy but ship on very different timelines (Assessment §3's own reasoning for adopting Option A specifically to avoid blocking on Row 3).

## 8. Approval

Specification-Draft, pending independent review and merge under this session's established docs-only merge authority. Merging records the contracts only — it authorizes no schema, Rules, Functions, index, claims, enforcement, deployment, or production-data change. Issue #226 remains OPEN/In Progress. **AI specifies; it never grants, revokes, or approves access.**
