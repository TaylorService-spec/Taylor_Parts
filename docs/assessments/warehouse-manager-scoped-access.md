---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-16
owner: Claude Code (Inventory)
related_adrs: [docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
depends_on: [docs/specifications/enterprise-access-and-administration-platform.md, docs/specifications/inventory-nav-access-alignment.md]
implements: []
supersedes: []
superseded_by: []
related_pr: 332
related_issue: 226
target_release: TBD
---

# Assessment: `WAREHOUSE_MANAGER` Scoped Warehouse Access

**Continues Issue #226 from PR #332.** PR #332 closed the Warehouse permission-catalog gap for `admin`/`dispatcher`/Operations Manager, and explicitly recorded (Spec §27.5) that `WAREHOUSE_MANAGER`'s own lack of access to `warehouses`/`stock_locations`/`transfer_orders` was an open question for the Owner: intentional boundary, or product gap? **The Owner has now resolved that question: it is a product gap.** This Assessment defines the least-privilege fix.

## 1. Current-state evidence (repository, not inferred)

- **`WAREHOUSE_MANAGER`** is an Issue #100 `operationalRoles` value on an Employee document, held by a `technician`-security-role principal. Its entire current capability set (`compatibilityRoles.ts`'s `TECHNICIAN_ROLE`, mirroring live `firestore.rules`):
  - `inventory_transactions` read (unconditioned `isActiveOperationalRole("WAREHOUSE_MANAGER")` branch, shared with `PARTS_MANAGER`).
  - `inventory_actions` read (`WAREHOUSE_MANAGER`-only branch).
  - `reorder_requests` manual-create (`canSubmitManualZeroHistoryQuantity()`, shared with `PARTS_MANAGER`).
  - **Nothing else.** No branch of any kind exists in `firestore.rules` for `warehouses`/`stock_locations`/`transfer_orders` referencing `isActiveOperationalRole("WAREHOUSE_MANAGER")` or any operational role at all — those three collections are `isAdminOrDispatcher()`-only (PR #332, Spec §27.1).
- **UI evidence:** `WarehouseManagerHome.jsx` (Issue #100 PR 2b) renders Inventory Health/Parts Catalog (from `inventory_transactions`) and Part Activity (from `inventory_actions`) only — it has no surface for `warehouses`/`stock_locations`/`transfer_orders` at all, consistent with the Rules gap.
- **No existing "assigned warehouse" concept anywhere in the repository.** The Employee document (`employees/{employeeId}`, canonical writer `functions/scripts/provisionEmployeeAccess.js`) has `employeeId`, `displayName`, `employmentStatus`, `operationalRoles`, `userId`, `securityRole`, `createdAt`, `updatedAt` — no location/warehouse/territory field of any kind. `Warehouse` (`functions/src/types/warehouse.ts`) has `id`/`name`/`location` — no "manager"/"assignedEmployeeIds" field either. This is a genuine, two-sided gap: no data model exists to express "this `WAREHOUSE_MANAGER` is responsible for warehouse X," and no Rules branch exists to enforce it even if the data did.

## 2. The problem with the two easy answers

- **"Just grant `WAREHOUSE_MANAGER` the same `isAdminOrDispatcher()`-shaped global read PR #332 gave Operations Manager"** — rejected. The Owner's own direction is explicit: "Do not grant global Warehouse visibility merely from `WAREHOUSE_MANAGER`." A title/operational-role match alone is not a least-privilege justification for seeing every warehouse's stock and every transfer order company-wide (Assessment's own standing "do not widen wholesale" principle, restated in every prior addendum in this series).
- **"Leave it as an intentional boundary, do nothing"** — rejected by the Owner's direction ("treat...as a product gap").

The correct shape, consistent with least-privilege and this repository's existing per-role data-scoping precedent (Issue #100's own `assignedToUserId`-scoped `PARTS_ASSOCIATE` reads), is: **a `WAREHOUSE_MANAGER` sees only the warehouses (and their stock locations and transfer orders) they are explicitly assigned to** — nothing by default, nothing company-wide.

## 3. Assignment-model options considered

| Option | Shape | Assessment |
|---|---|---|
| **A. Employee-document field** | `employees/{employeeId}.assignedWarehouseIds: string[]` | **Adopted.** Matches this repository's own established Issue #100 pattern exactly — `operationalRoles`/`employmentStatus` already live directly on the Employee document and are read by `isActiveOperationalRole()`'s existing `get()`. A Rules check for warehouse assignment would be one more field on the same already-fetched document, no new read. Directly enforceable by a narrow, Issue #100-scale Rules change, independent of the full Enterprise Access rollout (Rows 3/6/7 of that Plan, still gated). |
| **B. Governed `RoleAssignment` + `Scope.type: "location"`** | One `RoleAssignment` per warehouse, `Scope = { type: "location", value: warehouseId }` | Rejected **for now**, not permanently. The `Scope`/`RoleAssignment` infrastructure already exists (Issue #226 Rows 1/2) and a `"location"` `ScopeType` is already defined — architecturally the more "correct" long-term home for this. But it cannot be enforced by real Rules until the governed storage/Rules foundation (Row 3) is built and deployed, which is its own, much larger, separately-gated initiative. Blocking a real, Owner-flagged product gap on that timeline is disproportionate. |
| **C. New top-level `warehouse_assignments` collection** | `{ employeeId, warehouseId }` join documents | Rejected. Duplicates Option A's information in a second collection for no query benefit Firestore's own array-membership (`array-contains`) operators don't already provide on the Employee document; adds a second document Rules would need to `get()`, without adding any capability Option A lacks. |

**Adopted: Option A**, with **Option B recorded as the eventual governed-model destination** once Issue #226's storage/Rules foundation exists — §5 below defines both the immediate (Issue #100-scale) and the future (Issue #226-governed) representations, so this fix is not a dead end the Enterprise Access model has to later unwind.

## 4. Least-privilege access definition (adopted)

Given an Employee document with `operationalRoles` containing `"WAREHOUSE_MANAGER"`, `employmentStatus == "ACTIVE"`, a reciprocal `users/{uid}.employeeId` link (all three already required by `isActiveOperationalRole()`, unchanged), **plus** a non-empty `assignedWarehouseIds` array containing the target warehouse:

- **`warehouses/{warehouseId}`** — read allowed iff `warehouseId` is a member of the caller's own `assignedWarehouseIds`.
- **`stock_locations/{stockLocationId}`** — read allowed iff `resource.data.warehouseId` is a member of the caller's `assignedWarehouseIds` (the field already exists on every `StockLocation` document — no new field needed on that side).
- **`transfer_orders/{transferOrderId}`** — read allowed iff **either** `resource.data.fromWarehouseId` **or** `resource.data.toWarehouseId` is a member of the caller's `assignedWarehouseIds` ("transfer orders involving those warehouses," per the Owner's own phrasing — an inbound-only or outbound-only assignment still sees the transfer, since it is fully "involving" that warehouse either direction).

**Fail-closed, explicitly (per the Owner's own requirement, restated from first principles, not assumed):**

| Condition | Result |
|---|---|
| No reciprocal Employee link (broken linkage) | Deny — `isActiveOperationalRole()` already denies before `assignedWarehouseIds` is ever consulted. |
| `employmentStatus != "ACTIVE"` | Deny — same, already denied upstream. |
| `operationalRoles` does not contain `"WAREHOUSE_MANAGER"` | Deny — same, already denied upstream. |
| `assignedWarehouseIds` field absent (existing Employee documents, migration state) | Deny — treated identically to an empty array; a missing field is never treated as "all warehouses." |
| `assignedWarehouseIds: []` (explicitly empty) | Deny for every warehouse — matches the Owner's "missing…Warehouse assignment must deny access" literally. |
| `assignedWarehouseIds` contains warehouse X, target is warehouse Y | Deny for Y — no accidental broadening beyond the explicit list. |

No new capability is granted beyond **read**. This Assessment does not propose any write path for `WAREHOUSE_MANAGER` against these three collections — none exists for any role today (PR #332, Spec §27.2) and none is being introduced here.

## 5. Two representations, one adopted meaning (§3's "not a dead end")

1. **Issue #100 scale (immediate, this initiative's own future Rules PR):** the check above expressed directly in `firestore.rules`, reading `linkedEmployeeData().assignedWarehouseIds` (or an equivalent inlined field access) inside `isActiveOperationalRole()`-adjacent branches — the same style `inventory_actions`' `WAREHOUSE_MANAGER`-only branch already uses.
2. **Issue #226 governed scale (future, once Row 3 exists):** a new `ConditionKind`, `"assignedToWarehouse"`, evaluated the same way `operationalRoleActive` already is — a caller-supplied predicate (`ConditionContext.assignedToWarehouse?: (warehouseId: string) => boolean`), never the resolver deriving it itself — attached to `TECHNICIAN_ROLE`'s `warehouse.*.read` grants **alongside** (ANDed with, via the existing `conditions.every(...)` semantics) an `operationalRoleActive` Condition scoped to `WAREHOUSE_MANAGER`. See Specification §3 for the exact proposed shape.

Both representations encode the **identical** least-privilege rule from §4 — the governed representation is a later restatement of the same policy in the newer contract layer, not a divergent design.

## 6. Query/Rules implications (for the Owner's final-report line item)

- **`warehouses`/`stock_locations`**: single-field membership check (`resource.data.warehouseId in ...` for `stock_locations`; the document id itself for `warehouses`) — the same shape Firestore Rules already evaluate cheaply for every other per-document Condition in this repository (e.g. `reorder_requests`' `assignedToUserId == request.auth.uid`). No composite index implication for **Rules evaluation** (Rules aren't query-planned the way client queries are).
- **`transfer_orders`**: a two-field OR (`fromWarehouseId` OR `toWarehouseId`) — still a single-document Rules evaluation, no index implication for Rules. **Client query implication, however:** a future `WarehouseManagerHome.jsx` surface wanting to *list* "my transfer orders" cannot express "fromWarehouseId in [...] OR toWarehouseId in [...]" as a single Firestore query (Firestore has no native OR across two different fields pre-`or()` query support in this SDK version, and even with it, mixing two `array-contains-any`-shaped constraints on different fields is not supported) — the client-side implementation would need **two separate queries** (one per field) merged client-side, the same "two independent queries, merged and de-duplicated" shape `useReviewedRequestsHistory()` (Issue #100 PR 1b) already established for an analogous two-field OR. Recorded here so a future Implementation Plan doesn't have to re-derive it.
- **No new Firestore index is required** by anything in this Assessment — every field involved (`warehouseId`, `fromWarehouseId`, `toWarehouseId`) is already a plain top-level field on its respective document; array-membership (`array-contains`) queries against `assignedWarehouseIds` need no composite index either (single-field).

## 7. Explicitly out of scope

- **Equipment and Reporting** — Customer-owned (per the Owner's direction), not referenced anywhere in this Assessment.
- **Who assigns `assignedWarehouseIds`, and how** — a future Implementation Plan's concern (likely `provisionEmployeeAccess.js`, matching how `operationalRoles` is already assigned today) — not designed here.
- **Any actual `firestore.rules`, schema, Employee-document, `ConditionKind`, or `compatibilityRoles.ts` change** — this Assessment (and its accompanying Specification/Implementation Plan) authorize none of them; each is its own later, separately-gated PR per this series' established discipline.
- **Epic 5 Procurement** (`purchase_orders`/`suppliers`/`supplier_catalog`) — remains its own separate, still-open gap (PR #332, Spec §27.1), not addressed here.

## 8. Approval

Repository-Assessment-Draft, pending independent review and merge under this session's established docs-only merge authority. Merging records the problem framing and the adopted assignment-model decision only — it authorizes no schema, Rules, Functions, index, claims, enforcement, deployment, or production-data change. Issue #226 remains OPEN/In Progress. **AI assesses; it never grants, revokes, or approves access.**
