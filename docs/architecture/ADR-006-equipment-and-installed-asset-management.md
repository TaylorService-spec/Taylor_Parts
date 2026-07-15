# ADR-006 — Equipment & Installed Asset Management

Status: Accepted (Owner-authorized architecture for Issue #232)
Phase: Equipment & Installed Asset Management — Architecture (chain: Assessment → **ADR** → Specification → Implementation Plan → bounded child PRs → pre-production review → separately-authorized production deployment → closeout)
Depends on:

- `docs/assessments/equipment-and-installed-asset-management.md` (the merged #232 Assessment — current-state inventory + option matrix this ADR decides; PR #233)
- Issue #232 (Equipment program), Issue #226 (Enterprise Access — permission/trusted-writer/audit seam), Issue #140 (tenant model — not resolved here), Issue #15 (Functions deployment — gating)
- Established platform patterns: `accounts`/`locations` first-class collections + `isAdminOrDispatcher()` Rules; `ServiceActivitySection` derived-from-Work-Orders service history; the `WorkOrderWizard` Customer→Location extension seam.

**Design-stage only. Docs-only. Merging this ADR authorizes NO implementation** — no collection, Rule, Function, index, route, component, deployment, or production-data change. Each later stage is its own separately-authorized Owner gate; production Rules/indexes/Functions/Storage/data remain separately authorized. Issue #232 stays OPEN. **AI records the Owner-authorized decision; it never grants, revokes, or approves access.**

Relationship to prior ADRs: **purely additive.** ADR-006 does not supersede or modify ADR-001..005; it consumes ADR-005's Enterprise Access model for Equipment authorization and references ADR-002 (Work Order lifecycle authority) where Equipment links to Work Orders.

Verified against `origin/main` @ `5c89a74`. Path convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…` relative to `field-ops-app-vite/`.

---

## 1. Context

The merged Assessment (PR #233) inventoried Equipment as greenfield (no real code; only the Account→Location pattern, derived service history, `isAdminOrDispatcher` Rules, and the WO-wizard seam to mirror) and presented four write/enforcement options. The Owner's authorization (Issue #232, TASK 4) specifies the entity/relationship architecture directly; this ADR records those decisions and the write-model choice.

## 2. Decision

### 2.1 Entity & relationships (Owner-specified, TASK 4)

- **Equipment is a first-class serviceable entity** — a top-level `equipment` collection (flat, like `accounts`/`locations`), not a sub-collection.
- **One Account owns many Equipment records** (`equipment.accountId`).
- **Each Equipment record belongs to exactly one active Location** (`equipment.locationId`), which must belong to the same Account.
- **Moving Equipment between Locations is an explicit, audited action** — never a silent side effect of an ordinary edit.
- **Inventory Parts describe stocked items; Equipment describes installed/customer-serviceable assets** — separate collections, domains, and UIs (hard boundary).
- **Work Orders reference Equipment optionally** (`workOrder.equipmentId`, nullable; existing Work Orders unaffected, no backfill).
- **Service history is derived from linked Work Orders, not duplicated** (mirrors `ServiceActivitySection`).

### 2.2 Write & enforcement model — Option C (hybrid, evidence-backed self-authority)

Consistent with the Assessment's lean, the established Account→Location pattern, and "no client-direct security administration":

- **Reads, create, and ordinary edit** are **client-direct, gated by Firestore Rules** (`isAdminOrDispatcher()` seed authority; §2.3), exactly as `accounts`/`locations` work today — this ships the register/create/edit/detail without waiting on Issue #15.
- **Sensitive/audited mutations — move, retire, reactivate, and the emission of Audit Events** — go through the **Enterprise Access #226 trusted-writer seam** (trusted Cloud Function). Because Functions are undeployed (Issue #15), these actions are **unavailable (disabled with a clear reason), never a fallback to unsafe client writes** — the same "unavailable-not-unsafe" discipline the Assessment requires.
- **Ordinary edits must not change `accountId`/`locationId`** — Rules deny ownership change on update (§2.3); a Location change is only the audited move command.

### 2.3 Authorization & compatibility (coordinated with #226/ADR-005)

- Authenticated access only; the current **admin/dispatcher/technician** compatibility roles are preserved: admin/dispatcher get the full Equipment surface; **technician access is self-scoped to Equipment reachable through their authorized assigned Work Orders**, fail-closed on missing assignment/linkage, direct-URL denial verified.
- Equipment permissions (`equipment.view/create/edit/move/retire/viewServiceHistory`) are defined and cut over via the **#226 catalog + compatibility/shadow-mode** — not a parallel engine; **`operationalRoles` are never turned into security permissions**; **no client-direct security administration**.
- Rules deny malformed or **cross-Account** Location references; a client cannot grant itself permissions or write trusted/audited fields directly.

### 2.4 Boundaries this ADR fixes (Owner-specified, TASK 4)

- **No tenant schema before Issue #140** (Scope is #140's authority; Equipment Rules/queries are shaped to accept a tenant Scope later without redesign, but define none).
- **No Service Contract or PM Schedule** implementation in this initiative.
- **No warranty adjudication engine** (warranty is at most a reference date field, informational only).
- **No client-direct security administration.**

## 3. Reasoning

- **Pattern fidelity.** A flat first-class `equipment` collection with `accountId`/`locationId` mirrors `locations` exactly, so reads/create/edit reuse the proven Customer-domain patterns (shared Modal, form primitives, shared states, `isAdminOrDispatcher` Rules) with the least new surface and the cleanest rollback.
- **Correctness where it matters.** Move/retire/reactivate are relationship/lifecycle changes that must be atomic and immutably audited; routing exactly those through the #226 trusted-writer seam keeps them correct and #226-aligned, while leaving the everyday surface shippable now.
- **No unsafe shortcuts.** Gating the sensitive ops on #15 (unavailable, not client-fallback) prevents a partial/unaudited move and keeps the security posture honest.
- **Derived history** avoids a duplicate ledger and keeps a retired asset's history intact via its Work Orders.
- **Additive & reversible.** A new collection touches no existing data; every child PR reverts cleanly; Rules/index deploys are separate and production-gated.

## 4. Consequences

- The Specification defines: the Equipment document contract + required/optional fields; lifecycle statuses/transitions; Account/Location invariants; the `workOrder.equipmentId` reference contract; move/retire/reactivate rules and their trusted-writer command contracts; search/create/edit/detail behaviour + loading/empty/error states; permissions + fail-closed; Rules vs trusted-writer boundaries; Audit Event shape; accessibility/responsive; import/export boundaries; acceptance/rollback/production-verification criteria; and deferred capabilities.
- Move/lifecycle/audit are **#15-gated**; until Functions deploy, they are unavailable — the register/create/edit/detail ship without them.
- Permission cutover follows #226 (compatibility/shadow-mode first).
- Deferred (named, not built): Service Contracts, PM Schedules, warranty adjudication, IoT/telemetry, customer portal, Storage-backed photos/files, barcode/QR scanning, bulk cross-Account moves, tenant model (#140), AI recommendations.

## 5. Departures from the Owner's preferred result

**None.** Every TASK 4 preferred decision is adopted verbatim; the only decision added is the write/enforcement model (§2.2 Option C), which the Assessment already leaned to and which follows established patterns, preserves current behaviour, weakens no security, and is fully reversible — within Customer's standing self-authority. Recorded here with its evidence (the Account→Location pattern + the "explicit audited move" + "no client-direct security administration" requirements).

## 6. Governance & scope

Single new file: `docs/architecture/ADR-006-equipment-and-installed-asset-management.md`. No application code, Rules, indexes, Functions, schemas, routes, deployment, production data, or roadmap/status-document change. Purely additive to ADR-001..005. Issue #232 stays OPEN/In Progress. This ADR records an Owner-authorized decision; **AI never grants, revokes, or approves access.**
