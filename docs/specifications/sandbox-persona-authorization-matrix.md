---
artifact_type: specification
gate: Sandbox persona authorization matrix (v1 — evidence-based)
status: v3 — 8 personas verified against live transactional scenario SBX-SCN-001. Sandbox only.
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
environment: eos-platform-sandbox (platform-sandbox)
scope: Sandbox constructs only. Creates no production authority.
---

# Sandbox Persona Authorization Matrix — v1

The single version-controlled matrix for sandbox personas. **These are test constructs.** Nothing here creates production authority, and a persona needing a future capability is *not* a reason to build one.

## Concept separation (never collapsed)

`JOB TITLE` (what they're called) · `BUSINESS PERSONA` (responsibility) · `GOVERNED ROLE` (reusable authority grouping) · `CAPABILITY` (specific action authority) · `SCOPE` (where it applies) · `AGENT` (synthetic actor) · `LEGACY SECURITY ROLE` (temporary R-1 compatibility) · `OPERATIONAL ROLE` (work eligibility, **not** security authority).

Target: `PERSONA → GOVERNED ROLE(S) → CAPABILITIES → SCOPE → ALLOW/DENY`. Never `if jobTitle == X then allow Y`.

---

## Part 1 — Implemented and VERIFIED (7 personas)

Verified 2026-08-06 by **real client sign-in** (REST Auth + Firestore REST), Rules-enforced, **no Admin SDK bypass**. Evidence: [`../audits/sandbox-a7-verification-20260806/`](../audits/sandbox-a7-verification-20260806/).

| personaId | job title | legacy securityRole | operationalRoles | sign-in | `accounts` | `parts` | `reorder_requests` | `employees` | `auditEvents` write | status |
|---|---|---|---|---|---|---|---|---|---|---|
| `sbx-owner` | Owner | admin | — | ✅ | 200 | 200 | 200 | 200 | **403** | IMPLEMENTED + VERIFIED |
| `sbx-admin` | Platform Administrator | admin | — | ✅ | 200 | 200 | 200 | 200 | **403** | IMPLEMENTED + VERIFIED |
| `sbx-dispatcher` | Dispatcher | dispatcher | — | ✅ | 200 | 200 | 200 | 200 | **403** | IMPLEMENTED + VERIFIED |
| `sbx-partsmgr` | Parts Room Manager | technician | `PARTS_MANAGER` | ✅ | **403** | 200 | **403** | **403** | **403** | IMPLEMENTED + VERIFIED |
| `sbx-partsassoc` | Parts Associate | technician | `PARTS_ASSOCIATE` | ✅ | 403 | **403** | 403 | 403 | **403** | IMPLEMENTED + VERIFIED |
| `sbx-tech` | Field Technician | technician | — | ✅ | 403 | 403 | 403 | 403 | **403** | IMPLEMENTED + VERIFIED |
| `sbx-restricted` | Restricted User | technician | — | ✅ | 403 | 403 | 403 | 403 | **403** | IMPLEMENTED + VERIFIED |

All seven: bidirectional `employees`↔`users` linkage, `employmentStatus: ACTIVE`, self-read of `users/{uid}` = 200, `.invalid` addresses (RFC 2606 — cannot be real people).

**Both directions proven.** Every persona has at least one verified ALLOW and one verified DENY, so none is "allow-path only".

### Findings this immediately produced (R-1 evidence, §17)

**P-1 — `dispatcher` reads exactly like `admin`.** Identical 200s across all four collections. This is `isAdminOrDispatcher()` — the single helper behind **41 of 47** legacy sites — behaving as measured. **R-1 must reproduce this breadth before narrowing it.** Narrowing during convergence would be a policy change disguised as a migration.

**P-2 — `PARTS_MANAGER` cannot read `reorder_requests`.** It reads `parts` (200) but is denied the reorder queue (403) — the very workflow the role is named for. Either the queue read requires a condition this persona doesn't satisfy, or reference data absence changes the outcome. **Must be resolved before Row 24; do not "fix" it by widening Rules.**

**P-3 — `PARTS_ASSOCIATE` is denied `parts` while `PARTS_MANAGER` is allowed.** A real differentiation, but it means a Parts Associate currently cannot read the catalog they work from.

**P-4 — operational roles do differentiate.** `partsmgr` ≠ `partsassoc` ≠ `tech` despite all three sharing `securityRole: technician`. The operational-role model works as designed.

> P-2/P-3 were observed against an **empty** database. Some Rules paths evaluate reference data, so these must be re-verified once the baseline pack exists. Recorded as observations, **not** yet as defects.

---

## Part 1b — v2 update: baseline reference data seeded, warehouse scoping proven

The baseline reference pack is live (3 warehouses, 2 suppliers, 6 parts, 6 part-supplier items, 2 accounts, 3 locations, 2 contacts, 3 equipment) as one coherent relationship graph. Re-verified by real client sign-in. Evidence: [`../audits/sandbox-baseline-20260806/`](../audits/sandbox-baseline-20260806/).

| personaId | job title | securityRole | operationalRoles | `parts` | `reorder_requests` | `wh-main` (assigned) | `wh-north` (NOT assigned) | `accounts` | status |
|---|---|---|---|---|---|---|---|---|---|
| `sbx-owner` | Owner | admin | — | 200 | 200 | 200 | 200 | 200 | IMPLEMENTED + VERIFIED |
| `sbx-admin` | Platform Administrator | admin | — | 200 | 200 | 200 | 200 | 200 | IMPLEMENTED + VERIFIED |
| `sbx-dispatcher` | Dispatcher | dispatcher | — | 200 | 200 | 200 | 200 | 200 | IMPLEMENTED + VERIFIED |
| `sbx-whmgr` | Warehouse Manager | technician | `WAREHOUSE_MANAGER` | 200 | 403 | **200** | **403** | 403 | **IMPLEMENTED + VERIFIED** |
| `sbx-partsmgr` | Parts Room Manager | technician | `PARTS_MANAGER` | 200 | 403 | 403 | 403 | 403 | IMPLEMENTED + VERIFIED |
| `sbx-partsassoc` | Parts Associate | technician | `PARTS_ASSOCIATE` | 403 | 403 | 403 | 403 | 403 | IMPLEMENTED + VERIFIED |
| `sbx-tech` | Field Technician | technician | — | 403 | 403 | 403 | 403 | 403 | IMPLEMENTED + VERIFIED |
| `sbx-restricted` | Restricted User | technician | — | 403 | 403 | 403 | 403 | 403 | IMPLEMENTED + VERIFIED |

### W-1 — record-level warehouse scoping is REAL and proven in both directions

`sbx-whmgr` reads **`wh-main` (200)** — its assigned warehouse — and is **denied `wh-north` (403)**, which it is not assigned to. This is `isAssignedToWarehouse()` enforcing per-record scope through the full reciprocal-link chain (`users/{uid}` → `employees/{id}.userId` → `ACTIVE` → `operationalRoles` → `assignedWarehouseIds`).

**This is the only record-level scope currently enforced anywhere in the platform**, and it is the working precedent for the business/team scope model G-2 says is missing.

The governed provisioning validator also still **fails closed**: assigning a Warehouse Manager to `wh-does-not-exist` was refused after the baseline existed, so the guard is real and not an artifact of an empty database.

### P-2 — CLASSIFIED: **EXPECTED CURRENT BEHAVIOR / R-1 PARITY REQUIREMENT**

`PARTS_MANAGER` still cannot list `reorder_requests` (403) with real data present, so it was never a missing reference dependency.

The Rules are explicit: `reorder_requests` **read** is `isAdminOrDispatcher()`, while `PARTS_MANAGER` and `PARTS_ASSOCIATE` have **write/lifecycle** branches (assign, update, start-purchasing). **The role can act on reorder requests it cannot list.**

**Not a defect** — it is the deliberate current design, and R-1 must reproduce it exactly. It is, however, genuine **product** evidence: an operator who can advance a workflow but cannot see its queue depends entirely on being handed a specific record. Recorded for roadmap sequencing, **not** to be "fixed" by widening Rules during convergence.

### P-3 — CLASSIFIED: **EXPECTED CURRENT BEHAVIOR**

`PARTS_ASSOCIATE` is denied `parts` (403) while `PARTS_MANAGER` and `WAREHOUSE_MANAGER` are allowed (200) — with a populated catalog. The Rules deliberately grant the parts read to admin/dispatcher plus `PARTS_MANAGER`/`WAREHOUSE_MANAGER` and **deliberately exclude `PARTS_ASSOCIATE`** per the Owner-adopted role matrix.

**Not a defect.** Both provisional observations are now closed as expected behavior.

---

## Part 1c — v3: verified against live operating data (scenario SBX-SCN-001)

Re-verified with the transactional pack present. Evidence: [`../audits/sandbox-scenario-001-20260806/`](../audits/sandbox-scenario-001-20260806/).

| persona | `fieldops_jobs` (list) | `ro-sbx-001` (get) | `po-sbx-001` (get) | `parts` write |
|---|---|---|---|---|
| owner / admin / dispatcher | 200 | 200 | 200 | **403** |
| partsmgr | 403 | **200** | 403 | **403** |
| partsassoc | 403 | **200** | 403 | **403** |
| whmgr | 403 | 403 | 403 | **403** |
| tech / restricted | 403 | 403 | 403 | **403** |

### S-1 — P-2 REFINED: it is a *list* restriction, not a read restriction

`PARTS_MANAGER` and `PARTS_ASSOCIATE` **can read an individual reorder request** (`ro-sbx-001` → **200**) but **cannot list the collection** (403). This is Firestore's get-vs-list distinction: a document read is permitted, an unconstrained collection query is not.

So the accurate statement is **not** "cannot read reorder requests" — it is **"can read any request it is pointed at, but cannot discover the queue."** That sharpens the product question already recorded: the persona needs a governed queue projection or a scoped query, **not** broader raw collection access.

### S-2 — unconstrained probes UNDERSTATE real persona access (methodology)

`sbx-tech` is denied a bare `fieldops_jobs` list (403), yet the application never issues one: `useAssignedJobs` queries `where("technicianId","==",me)`. Firestore Rules evaluate a **constrained** query differently from an unconstrained list, so a bare-list probe measures something the product does not do.

**Every persona result above is therefore a floor, not a ceiling.** Agent-based verification (which issues the app's real queries) will measure higher and is the correct instrument. Recorded so these numbers are not later misread as the product's actual behaviour.

### S-3 — `parts` is client-closed for everyone, including owner and admin

Write attempts returned **403 for all eight personas**, exactly as `allow create, update, delete: if false` specifies. Part Master writes are trusted-service-only (ADR-008). A clean negative control that proves the probe detects denials rather than reporting them by accident.

---

## Part 2 — Designed, NOT yet created

| personaId | function | blocker | status |
|---|---|---|---|
| `sbx-warehouse-manager` | Warehouse-scoped operations | Needs a real synthetic warehouse — governed script correctly refuses a nonexistent one | **BLOCKED — reference data** |
| `sbx-service-manager` | Service oversight, dispatch oversight, KPIs | No distinct governed role; would be `dispatcher` today, indistinguishable from Dispatcher | **MISSING ROLE** |
| `sbx-catalog-admin` | Part/Supplier/Manufacturer catalog admin | `inventory.catalog.manage` is carried by exactly one temporary Role (`inventoryCreateExecutor`, Decision #42); `.activate` ungranted | **DESIGNED / NOT DEPLOYED** |
| `sbx-retail-sales`, `sbx-retail-sales-manager`, `sbx-national-sales`, `sbx-national-account-manager`, `sbx-vp-sales` | Sales | Sales & CRM is **Level 1 — nav placeholder, no capability** | **NOT APPLICABLE (capability absent)** |
| `sbx-financial-manager`, `sbx-accounting` | Finance | Financial Operations is **Level 1 — no invoicing, payments, or reconciliation exists** | **NOT APPLICABLE (capability absent)** |

**Five sales and two finance personas cannot be honestly created**, because the capabilities they would exercise do not exist. Creating them would produce accounts that prove nothing and imply coverage the platform does not have. Per §5: *do not manufacture authority merely to make the matrix appear complete.*

---

## Part 3 — Structural gaps blocking the fuller model

| # | Gap | Consequence | Status |
|---|---|---|---|
| **G-1** | No `owner` legacy securityRole | Owner is indistinguishable from admin by security role; the distinction lives only in the governed model | **BLOCKED BY R-1** |
| **G-2** | No business/team scope model | A Service Manager cannot be scoped to a team; Sales cannot be scoped to a territory. `Scope` supports global/tenant/domain/location/ownAssignment — with `tenant` **inert** | **MISSING SCOPE MODEL** |
| **G-3** | No tenancy | Multi-business simulation (§13) **cannot be honestly represented**. Two operating businesses cannot be isolated | **BLOCKED BY FUTURE TENANCY** |
| **G-4** | Sales + Finance capabilities absent | ~7 personas and the accounting half of the cross-functional scenario (§11) are unreachable | **NOT APPLICABLE** |

**§13 multi-business simulation is blocked.** Per the instruction not to fake tenancy, this is recorded as **BLOCKED BY TENANCY / BUSINESS-SCOPE ARCHITECTURE** rather than simulated.

---

## Part 4 — Where the cross-functional scenario (§11) actually stops

```
Retail Sales → customer need ........................ ✗ Sales capability absent
Service Manager → operational review ................ ~ dispatcher-equivalent only
Dispatcher → technician assignment .................. ✓ supported
Technician → parts/equipment need ................... ✓ supported
Parts Associate → fulfil from stock ................. ✓ supported
Parts Room Manager → shortage / reorder ............. ✓ supported
Purchasing → supplier / PO .......................... ✓ supported
Receiving → inventory received ...................... ✓ supported (sandbox readiness true)
Technician → complete work .......................... ✓ supported
Accounting → financial workflow ..................... ✗ Financial Operations absent
Financial Manager → review .......................... ✗ absent
VP Sales → outcome visibility ....................... ✗ absent
```

**The honest boundary: the chain runs end-to-end from Dispatch through Receiving and completion, and stops at both ends** — no sales entry point, no financial consequence. That is the product-roadmap evidence §11 asked for, not a defect to paper over.

---

## Part 5 — Agent contract (§8–§10), for the deterministic agents that follow

`AGENT AUTHORITY ≤ PERSONA AUTHORITY`, always. Agents authenticate as their persona through the **same** Auth, governed roles, scope, Rules, trusted commands, and validation as a human. **No agent receives Admin SDK bypass** — privileged seeding stays strictly separate from simulated-user execution.

Each definition references a `personaId` here and carries: `agentId`, synthetic identity, org/location relationship, goals, allowed workflow families, activity profile, expected allow paths, expected deny paths, scenario participation, required seed data, success criteria, bounded failure behaviour, and max action/time limits. **No credentials in agent definitions** — sandbox passwords are generated at activation and written only to a gitignored local file.

## Part 6 — Credential handling (F-7 resolved)

Sandbox personas are activated with **randomly generated passwords, created at runtime, written only to a gitignored local file, never committed**. The activation script refuses to run against `taylor-parts`. This satisfies §16 (Owner signs in as personas) and §8 (agents authenticate as personas) without embedding credentials (§19) — and it is confined to the non-production project.
