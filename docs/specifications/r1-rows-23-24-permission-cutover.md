---
artifact_type: specification
gate: R-1 Rows 23/24 — permission specifications for the Customer/Account and Inventory/Reorder/Purchasing cutovers
status: Specification — no permission created, no Rules change, no cutover executed
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: ab55c50
extends: docs/assessments/r1-permission-coverage-design.md · functions/src/access/legacyAuthorizationSurface.ts
scope: Specification only. Every permission creation and every Rules change remains Tier 2.
---

# R-1 Rows 23/24 — Permission Cutover Specification

Rows 23 and 24 are the two cutovers that can proceed independently: Row 25 is blocked on W4 domain convergence, and Rows 19/20/22 gate *activation* but not *specification*.

**Scope of this document:** exactly what each permission must mean, what parity requires, and what must be true before either row's Rules change is proposed. It creates nothing.

---

## 1. The parity principle that governs both rows

**A cutover must reproduce the legacy decision exactly — not improve on it.**

This is the single most important constraint and the easiest to violate with good intentions. The legacy helpers (`isAdminOrDispatcher()`, `isAdmin()`, `isTechnician()`) are **global**: they ask *what security role does this user hold*, never *which records may they touch*. Any narrowing introduced during a cutover is a **behaviour change disguised as a migration**, will fail the parity suite, and — worse — could pass the parity suite while breaking production if the fixtures encode the intended new behaviour rather than the current one.

**Scoping improvements are a separate, later, deliberately-specified change.** Cutover first, narrow second.

### 1a. Correction — Row 23 does not need parent-child Scope

The readiness assessment flagged as a watch item that Account-scoped permissions "require parent-child Scope confirmed in `resolveEffectivePermission` before Row 23." **That watch item is withdrawn, and the underlying premise was wrong.**

`Scope` supports `global | tenant | domain | location | ownAssignment` (`types/access.ts`), and `scopeMatches()` requires an exact `type`+`value` match for `tenant`/`domain`/`location`. There is no parent-child type — and **none is needed**, because the legacy Rules grant admin/dispatcher **global** access to `locations` and `contacts` with no per-Account narrowing whatsoever. Exact parity therefore requires **`{ type: "global" }`** assignments.

Introducing Account-level scoping at cutover would *narrow* access relative to production and break parity. Row 23 needs no Scope-model change.

## 2. Row 23 — Customer / Account

**Surface: 7 legacy sites across 3 collections.** `accounts` (5: `isAdminOrDispatcher` ×3, `isAdmin` ×2) · `locations` (2) · `contacts` (2).

### 2.1 Permissions

**No new permissions.** All four already exist in the catalog: `account.record.read`, `account.record.create`, `account.record.update`, `account.governedField.write`.

The specification work is to extend their **documented scope** to state that they govern the Account aggregate — the Account record together with its Locations and Contacts — consistent with `BusinessEntityModel.md`, which treats Location and Contact as belonging to an Account rather than as independent business objects with their own authority.

| Collection | Operation | Governing permission |
|---|---|---|
| `accounts` | read | `account.record.read` |
| `accounts` | create | `account.record.create` |
| `accounts` | update | `account.record.update` |
| `accounts` | governed-field write (`isAdmin` ×2) | `account.governedField.write` |
| `locations` | read / create / delete | `account.record.read` / `.create` / `.update` |
| `contacts` | read / create / delete | `account.record.read` / `.create` / `.update` |

**Delete maps to `.update` on the parent**, not to a new `.delete` permission: removing a Location or Contact modifies the Account aggregate. Introducing a delete permission would create authority the legacy model never expressed.

### 2.2 The `isAdmin` asymmetry — the one real subtlety

`accounts` carries **two `isAdmin()` sites** alongside three `isAdminOrDispatcher()` sites. That asymmetry is Issue #175 governed-field enforcement: **admin may write governed fields, dispatcher may not.**

`account.governedField.write` already encodes this and is already exercised by two parity fixtures (`"admin: governed field write"` and `"dispatcher: governed field write (Issue #175 withheld)"`). **This is the criterion-9 preservation requirement, and it is already covered.** The cutover must not collapse the two helpers into one permission.

### 2.3 Parity requirements

Existing fixtures cover the four permissions across admin / dispatcher / technician-without-operational-role. **Additional fixtures required before cutover:**

1. `locations` and `contacts` read/create/delete for each persona — the fixtures currently name Account operations, and the corpus must demonstrate the Location/Contact operations resolve identically.
2. An explicit **deny** fixture per persona per collection. A fixture set proving only ALLOW proves nothing about narrowing.
3. A technician fixture for `locations`/`contacts` proving **DENY**, matching the current legacy behaviour.

### 2.4 Why Row 23 is the correct first cutover

Smallest surface (7 sites), **zero new permissions**, no Scope-model change, the governed-field asymmetry already fixture-covered, and a well-understood aggregate boundary. If the cutover machinery is going to be wrong, this is the cheapest place to discover it.

## 3. Row 24 — Inventory / Reorder / Purchasing

**Surface: 25 legacy sites across 13 collections** — the largest row.

### 3.1 Already covered — no work

`reorder_requests` (10), `reorder_purchase_orders` (2), `reorder_purchase_order_voids` (2), `inventory_actions` (2), `inventory_transactions` (1). **17 of 25 sites** are already governed by existing permissions.

### 3.2 Three new permissions

| Permission | Covers | Semantics |
|---|---|---|
| **`inventory.catalog.read`** | `parts` (1 site) | Read the Part Master catalog. Distinct from the existing `inventory.catalog.manage`/`.activate`, which are **write** authorities — `.manage` is deliberately carried by exactly one temporary Role (`inventoryCreateExecutor`, Decision #42) and must not be widened into a read grant. Part writes stay trusted-only (ADR-008). |
| **`inventory.location.read`** | `warehouses`, `stock_locations`, `mobile_locations`, `trucks` (4 sites) | Read the physical/mobile stock-location registry. **One permission, four collections** — a warehouse, a stock location, a mobile location and a truck are the same authority viewed at different granularities (ADR-010 makes trucks MOBILE locations). Status *writes* remain trusted (`warehouses.status` is the governed Receiving eligibility authority, I-LA C2). |
| **`procurement.supplier.read`** | `suppliers`, `supplier_catalog` (2 sites) | Read supplier commercial-relationship data. Distinct from reorder authority: supplier terms are deliberately separated from Part (ADR-008). Aligns with the active Supplier Master direction (Supplier → governed `supplierId` → `reorder_purchase_orders`). |

### 3.3 Not governed

| Collection | Disposition |
|---|---|
| `purchase_orders` (1 site) | **DORMANT — no permission.** Owner Decision B: `reorder_purchase_orders` is the canonical operational PO model; `purchase_orders` is the dormant Epic-5 model, **DO-NOT-EXPAND**. Its legacy site is retired by **closing the surface**, not by governing it. Granting a permission here would make a dormant model load-bearing and create the second PO authority the decision exists to prevent. |
| `transfer_orders` (1 site) | **DEFER.** Transfers is an in-flight capability with an unsettled write path; specifying a permission now would encode a model about to change. |

### 3.4 Row 24 sequencing

Row 24 should be **split**, not attempted as one cutover:

1. **24a** — the 17 already-covered sites (reorder/inventory-action/transaction). No new permissions; pure cutover.
2. **24b** — the 7 sites needing the three new permissions.
3. **24c** — `purchase_orders` surface closure and `transfer_orders`, both dependent on decisions outside R-1.

24a is nearly as safe as Row 23 and could follow it immediately.

## 4. Preconditions common to both rows

| # | Precondition | State |
|---|---|---|
| P-1 | Permission added to `permissionCatalog.ts` (**both mirrors**) | not started — Tier 2 |
| P-2 | Compatibility Roles carry it, matching legacy behaviour exactly | not started |
| P-3 | Parity fixtures for **every persona × operation, ALLOW and DENY** (both mirrors) | partial |
| P-4 | `shadowParityHarness` still `fullParity === true` | ✅ currently green |
| P-5 | `legacyAuthorizationSurface.ts` updated in the **same change** as the Rules | drift gate enforces |
| P-6 | Rollback procedure followed, incl. live pre-cutover Rules capture | ✅ unblocked (Rules REST API) |
| P-7 | Trusted mutation backend deployed | ❌ **BLOCKED — Rows 19/20** |

**P-7 gates activation, not specification.** Everything above can be built and verified in the emulator against undeployed Functions; only the production Rules cutover requires the backend to be live.

## 5. What this specification does not do

No permission was added to `permissionCatalog.ts`. No Rules change, no fixture change, no grant, claim, role, or trusted-path change. No cutover proposed for execution. Each permission's creation is Tier 2; each Rules change is Tier 2 unconditionally; activation additionally requires Rows 19/20.
