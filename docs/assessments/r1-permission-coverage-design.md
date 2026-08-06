---
artifact_type: assessment
gate: R-1 — permission-coverage design for the collections lacking governed permissions
status: Analysis complete — recommendations only; no permission created, no Rules/grant/claim change
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: 42cd3ee
extends: docs/assessments/r1-authorization-convergence-readiness.md · functions/src/access/legacyAuthorizationSurface.ts
scope: Design analysis. No permission added to the catalog, no Rules change, no grant, no claim, no trusted-path change.
---

# R-1 — Permission Coverage Design

`collectionsWithoutPermissionCoverage()` returns **15 collections** carrying **26 of the 47** legacy authorization sites with no governed permission defined. This is the concrete design work standing between R1-A and Rows 23–25.

**Governing constraint (Owner, 2026-08-06):** *do not create permissions merely to obtain numerical coverage.* Permission semantics must follow **actual business authority**. Applied literally below — the recommendation for several collections is **no new permission**.

---

## 1. Method

For each collection: the Rules operations actually allowed; client and server call-site counts; the business capability it serves; and whether an existing permission already expresses the authority. Call-site counts are file counts from the repository at `42cd3ee`; Rules operations are parsed from the live-equivalent `firestore.rules`.

## 2. The four dispositions

| Disposition | Meaning |
|---|---|
| **EXTEND** | An existing permission already expresses this authority; widen its documented scope. No new permission. |
| **NEW** | A genuinely distinct business authority with no existing expression. |
| **TRUSTED-ONLY** | Client access should not be permission-gated at all — the write path is already a trusted callable, and the Rules site is a *read* that should follow its domain's read permission. |
| **DEFER** | Cutover blocked on a prior architectural decision; designing a permission now would encode a model about to change. |

## 3. Row 23 — Customer / Account (4 sites, 2 collections)

| Collection | Rules ops | Client / Fn | Disposition | Recommendation |
|---|---|---|---|---|
| `locations` | create, delete, read | 5 / 2 | **EXTEND** | Locations are a component of the Account aggregate, not an independent business object with its own authority. Whoever may read/modify an Account may manage its Locations. Extend `account.record.read` / `.create` / `.update`; treat delete as `account.record.update` on the parent. **No new permission.** |
| `contacts` | create, delete, read | 4 / 2 | **EXTEND** | Same reasoning. `BusinessEntityModel.md` treats Contact as belonging to an Account. Extend the same three permissions. **No new permission.** |

**Row 23 is the cleanest cutover** — 4 of its 7 sites need no new permissions, and its 3 `accounts` sites are already covered. It is the correct first domain, and this analysis supports it.

> Watch item: an Account-scoped permission implies row-level scoping (this Account's Locations, not all Locations). `resolveEffectivePermission` already supports Scope; confirm the Scope shape covers parent-child before cutover.

## 4. Row 24 — Inventory / Reorder / Purchasing (11 sites, 9 collections)

| Collection | Rules ops | Client / Fn | Disposition | Recommendation |
|---|---|---|---|---|
| `parts` | create, read | 9 / 2 | **NEW** | `inventory.catalog.read`. Part Master reads are broad (9 client files); the existing `inventory.catalog.manage`/`.activate` cover *writes* only, and `.manage` is deliberately carried by exactly one temporary Role. A distinct **read** authority is genuinely missing. Writes stay trusted (ADR-008). |
| `warehouses` | create, read | 6 / 4 | **NEW** | `inventory.location.read`. Governed `warehouses.status` is the Receiving location-eligibility authority (I-LA C2), consumed by `listReceivingLocationOptions`. Status *writes* are already trusted; the read authority is real and distinct. |
| `stock_locations` | create, read | 2 / 2 | **EXTEND** | Same authority as `warehouses` — a stock location is a location. Fold into `inventory.location.read`. **No separate permission.** |
| `mobile_locations` | create, read | 2 / 2 | **EXTEND** | A mobile location is a location (trucks as MOBILE locations, ADR-010 Phase 4). Fold into `inventory.location.read`. |
| `trucks` | create, read | 2 / 2 | **EXTEND** | The truck **registry** is the same read authority; the 8 truck mutation callables are deployed and capability-gated already. Fold the read into `inventory.location.read`; **do not** create truck-specific permissions for a trusted-write surface. |
| `transfer_orders` | create, read | 2 / 2 | **DEFER** | Transfers are an in-flight capability (a Transfers workspace merged this window). Designing its permission before the transfer write path is settled would encode a model about to change. Revisit when Transfers reaches a write path. |
| `inventory_transactions` | — | — | *covered* | `inventory.transaction.read` exists. |
| `suppliers` | create, read | 3 / 2 | **NEW** | `procurement.supplier.read`. Distinct commercial-relationship authority; supplier terms are deliberately separated from Part (ADR-008). Not the same as reorder authority. |
| `supplier_catalog` | create, read | 2 / 2 | **EXTEND** | Supplier catalog is supplier data. Fold into `procurement.supplier.read`. |
| `purchase_orders` | create, read | 2 / 2 | **DEFER** | **Ambiguity flag.** This is distinct from `reorder_purchase_orders` (which *is* covered). Two purchase-order collections exist and only one is the governed reorder execution record. Which is authoritative for Purchasing is an **architecture question, not a permission question** — resolve it before granting either a permission. |

**Net for Row 24: 3 new permissions** (`inventory.catalog.read`, `inventory.location.read`, `procurement.supplier.read`) covering 7 collections, plus 2 deferrals. Naive coverage-chasing would have produced nine.

## 5. Row 25 — Service / Work Orders (9 sites, 3 collections)

| Collection | Rules ops | Client / Fn | Disposition | Recommendation |
|---|---|---|---|---|
| `equipment` | create, read, update, delete | 8 / 2 | **NEW** | `equipment.record.read` + `equipment.record.update`. A full CRUD surface with a live governed model (ADR-006/010) and an explicit Rules note that technicians are deliberately denied a general register read pending self-scoping. Genuinely its own authority. |
| `fieldops_jobs` | create, read, update, delete | 3 / 3 | **DEFER** | **Do not design a permission for the legacy domain model.** `fieldops_jobs` is one half of the R-2/W4 duplicate-domain problem; blueprint wave W4 owns its reconciliation onto `fieldops_wos`. A governed permission here would **entrench** the model the platform intends to retire. Sequence W4 first. |
| `fieldops_technicians` | create, read, update, delete | 3 / 3 | **DEFER** | Same reasoning, plus the Employee/User/Technician split is governance-approved but unimplemented (`CLAUDE_CONTEXT.md` rule 14). Designing a Technician permission before Employee identity converges would encode a superseded entity model. |

**Row 25 cannot complete before W4.** This is a newly-identified hard dependency: **R-1 Row 25 is blocked on the domain-model convergence**, not merely sequenced after it. Recorded as a cross-program dependency.

## 6. Unassigned

| Collection | Rules ops | Client / Fn | Disposition | Recommendation |
|---|---|---|---|---|
| `employees` | create, read | 4 / 5 | **NEW** + row assignment | `administration.employee.read`. Employee is the authoritative workforce identity (rule 14) and drives operational-role eligibility across domains — the Rules already read `employees` for `isActiveOperationalRole()`. It is genuinely distinct from application-access identity (`users`). **Also needs a cutover row**: it belongs with Row 26 (Navigation/shared-UI) or a new Administration row, since `EmployeeAssignmentPicker` is a shared surface. Owner/architecture call. |

## 7. Summary

| Disposition | Count | Collections |
|---|---|---|
| **EXTEND** (no new permission) | 6 | `locations`, `contacts`, `stock_locations`, `mobile_locations`, `trucks`, `supplier_catalog` |
| **NEW** (genuine authority) | 5 | `inventory.catalog.read`, `inventory.location.read`, `procurement.supplier.read`, `equipment.record.read`/`.update`, `administration.employee.read` |
| **DEFER** (blocked on a prior decision) | 4 | `transfer_orders`, `purchase_orders`, `fieldops_jobs`, `fieldops_technicians` |

**Five new permissions, not fifteen.** Six collections need none, and four must not be designed yet.

## 8. Parity and rollback requirements

Any permission added under this analysis must, before its domain's cutover:

1. Add fixtures to `PARITY_FIXTURES` (both mirrors) covering **every persona × operation** the legacy site allowed *and* denied — a fixture set proving only ALLOW proves nothing about narrowing.
2. Keep `shadowParityHarness` at `fullParity === true` (already CI-gated).
3. Update `legacyAuthorizationSurface.ts` **in the same change** that changes the Rules — the drift gate enforces this in both directions.
4. Follow [`../operations/authorization-cutover-rollback.md`](../operations/authorization-cutover-rollback.md), including P2 capture of live pre-cutover Rules — **now unblocked**: the live ruleset is retrievable via the Firebase Rules REST API (see this program's evidence set), so P2 no longer requires Owner console work.

## 9. Cross-program dependencies discovered

1. **Row 25 is blocked on W4** (domain-model convergence). New, and it changes R-1's critical path: Rows 23 and 24 can proceed independently; Row 25 cannot.
2. **`purchase_orders` vs `reorder_purchase_orders`** — two purchase-order collections, one governed. An architecture question that must precede a permission decision.
3. **Employee identity convergence** gates a correct `fieldops_technicians` permission.
4. **Account-scoped permissions need parent-child Scope** confirmed in `resolveEffectivePermission` before Row 23.

## 10. Boundaries honored

No permission was added to `permissionCatalog.ts`. No Rules, grant, claim, role, or trusted mutation path was changed. No production action. This is analysis; each permission's creation, and each domain cutover, remains a separate Tier-2 decision.
