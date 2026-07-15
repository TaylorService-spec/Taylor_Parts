---
artifact_type: assessment
gate: Repository Assessment
status: Draft
date: 2026-07-15
owner: Claude Code (Customer)
related_adrs: []
depends_on: [docs/BusinessEntityModel.md, docs/PlatformCapabilityModel.md, docs/PROJECT_ARCHITECTURE.md]
implements: []
supersedes: []
superseded_by: []
related_pr: null
related_issue: 232
target_release: TBD
---

# Assessment: Equipment & Installed Asset Management

**Status: DRAFT (pending Architecture Review).** Assesses moving **Equipment / Installed Asset** from a named Future entity into active governed planning (Issue #232, Owner-authorized 2026-07-15). It inventories the current state (with citations), defines the entity, its boundaries, ownership, lifecycle, relationships, permissions, and audit needs, weighs architecture options, and records risks/rollback and explicitly deferred scope.

**Merging this Assessment authorizes NO implementation.** No collection, Firestore Rule, Cloud Function, index, route, component, deployment, or production-data change is authorized here. The chain is Assessment → Architecture (ADR) → Specification → Implementation Plan → bounded child PRs → pre-production review → separately-authorized production deployment → closeout. Each stage is its own Owner gate. Production Rules/indexes/Functions/Storage/fixtures/data remain **separately authorized** at their deployment gates.

Verified against `origin/main` @ `0124280`. Path convention: `firestore.rules`, `functions/…`, `docs/…` are repo-root-relative; `src/…` is relative to `field-ops-app-vite/`.

---

## 1. Current-state audit (evidence)

- **Named Future entity.** `docs/BusinessEntityModel.md` lists "Equipment / Asset — Serviceable asset located at a Location — **Future**"; models `Account 1:many Equipment (FUTURE)`, `Work Order optional → Equipment (FUTURE)`, and an `equipment` collection "New, **deferred** — `locationId` reference — not built in near-term sprints." `docs/PlatformCapabilityModel.md` lists "Equipment/Asset tracking per Location" and "Equipment-scoped service history" as Future Expansion.
- **No real code.** No Equipment domain module, collection constant, repository, hook, component, route screen, Rule, index, emulator fixture, or browser driver exists (verified). `src/domain/constants.js` defines `accounts`/`locations` collections but **no** `EQUIPMENT_COLLECTION`.
- **Retired/stub nav.** `src/navigation/navConfig.js` retains a customers-domain subnav stub `{ key: "equipment", label: "Equipment", path: "equipment" }` (alongside contacts/locations/serviceHistory stubs); the standalone global sub-navigation for these was removed by PR #194 ("Customer hierarchy nav cleanup"). There is **no built Equipment screen** — the stub is not a real capability.
- **Ownership pattern to mirror.** `locations` are `{ id, accountId, name, address, … }` (`src/domain/locations.js`) — a first-class collection related to Account by `accountId`. `firestore.rules` gates `accounts`/`locations`/`contacts` uniformly: `allow read, create, update: if isAdminOrDispatcher(); allow delete: if false`.
- **Work Order seam.** `WorkOrderWizard.jsx` selects Customer → Location (`selectedLocationId`) with a documented "future extension point" for Equipment after Location; `WorkOrder` carries `customerId`/`locationId` but **no** `equipmentId`.
- **Service history is derived.** `ServiceActivitySection.jsx` derives an account's service activity from linked Work Orders (no duplicate ledger) — the pattern Equipment service history should follow.
- **Parts ≠ Equipment already.** `src/data/partsCatalog.ts` is the stocked Inventory Parts catalog — a separate concept; no code conflates the two.
- **Warranty is a placeholder** nav item only (`navConfig` Service domain); no warranty logic exists.

**Conclusion:** Equipment is genuinely greenfield — no real, placeholder-with-logic, or demo Equipment behaviour to preserve beyond the *seam* (WO wizard extension point) and the *pattern* (Account→Location ownership, derived service history, `isAdminOrDispatcher` Rules). This lowers migration risk but means every contract is defined fresh.

## 2. Business purpose

Give service operations a first-class, searchable register of the **installed, customer-serviceable assets** they maintain (HVAC units, chillers, boilers, RTUs, etc.) so a Work Order can be tied to the specific asset serviced, an asset's **service history** is visible, and Customer/Location records show what equipment is installed where. This is the foundation later capabilities (service contracts, PM schedules, warranty) attach to — none of which are in this initiative.

## 3. Terminology — "Equipment" vs "Installed Asset"

The domain object is **Equipment** (the platform's existing name in `BusinessEntityModel.md`); "installed asset" is a synonym describing its nature (a physical asset installed at a customer Location). This Assessment uses **Equipment** as the canonical term to avoid a second vocabulary; "asset tag" remains a field name (§8). No separate "Asset" entity is introduced.

## 4. Ownership — Account and Location

- **One Account owns many Equipment records** (`equipment.accountId`), mirroring Account→Location.
- **Each Equipment record is installed at exactly one active Location** (`equipment.locationId`), and that Location must belong to the same Account (cross-Account reference is invalid, §12/§permissions).
- Ownership fields are **identity-class**: an ordinary edit must not silently change `accountId`/`locationId` — a Location change is an explicit, audited **move** (§7, and ADR/Spec).

## 5. Equipment vs Inventory Part boundary (hard)

- **Equipment** = a specific, serialized, installed/serviceable asset owned by a Customer Account at a Location, with its own lifecycle and service history.
- **Inventory Part** (`partsCatalog.ts`, reorder/PO domain) = a stocked, fungible catalog item counted in inventory and consumed on Work Orders.
- They are **separate collections, separate domains, separate UIs**. A part is not equipment; equipment is not stock. No shared identity, no cross-writes. (A future capability may record "parts consumed servicing this equipment" via Work Orders, but that is derived, not a merge.)

## 6. Lifecycle & status

Proposed statuses (finalized in the Spec): **ACTIVE** (installed and serviceable), **INACTIVE** (temporarily out of service), **RETIRED** (decommissioned — history retained, not deleted). Transitions: ACTIVE↔INACTIVE; ACTIVE/INACTIVE→RETIRED; RETIRED→ACTIVE only via an explicit **reactivate**. Retirement and reactivation are confirmed actions; **retiring never deletes service history or unlinks Work Orders**.

## 7. Move between Locations

Moving Equipment to a different Location is an **explicit, audited, atomic** action (not an ordinary edit): show current Location; restrict destination to Locations of the **same Account** (cross-Account move is out of scope, §deferred); require confirmation (and a reason if the Spec mandates); update the relationship atomically with an Audit Event; no partial move. If the approved authority is a trusted writer and production Functions are unavailable (Issue #15), the action stays **unavailable** rather than falling back to unsafe client writes.

## 8. Identity & human-readable references; core fields

- **Internal id:** Firestore document id (never rendered as the primary human reference).
- **Human-readable references:** a **display name** (required) and optional **asset tag** (customer/site tag) and **serial number** — the fields users search and recognize. Duplicate display names are allowed across an Account (real-world), so detail context (Location, manufacturer/model, serial) must disambiguate.
- **Descriptive fields:** `manufacturer`, `model`, `serialNumber`, `assetTag`, plus install/service context (e.g. `installedDate`, `notes`) finalized in the Spec. All optional except the display name + owning Account + Location.

## 9. Warranty boundaries

Capture warranty **reference** context only if the Spec includes it (e.g. `warrantyExpiresDate` as a plain date field). **No warranty adjudication, claims, or entitlement engine** — that is explicitly deferred (§18). Warranty display is informational text, never an authority.

## 10. Service-history derivation

Equipment Service History is **derived from linked Work Orders** (`workOrder.equipmentId`), exactly as `ServiceActivitySection` derives account activity today — **no independent duplicate history ledger** unless the ADR explicitly requires one. Chronological, each entry links to its Work Order; historical entries remain visible after the Equipment is retired.

## 11. Work Order relationships

- A Work Order **optionally** references one Equipment (`workOrder.equipmentId`, nullable) — added **after** Customer + Location are chosen in the wizard, querying only Equipment at the selected Location; a clear "No Equipment selected" option; changing Customer/Location clears an invalid selection.
- **Existing Work Orders are unaffected** — no required backfill/migration; `equipmentId` is absent on legacy Work Orders and that is valid.

## 12. Search & navigation

- A dedicated **Equipment register** (searchable list, filters, result count, Account/Location/manufacturer/model/serial/asset-tag/status context) built on the existing workspace + shared-state components (LoadingState/EmptyState/FailureState).
- Equipment surfaced **within Customer detail** (account-scoped list + Add) and **within Location** (location-scoped list) — **without** restoring the retired global sub-navigation (§1).
- Optionally an **Equipment provider in Global Search** (if the Spec approves), backward-compatible with existing providers, showing name/Account/Location/manufacturer-or-serial/status, **no raw ids**.

## 13. Permissions

Coordinate with **Enterprise Access (#226)**; do not invent a parallel authorization engine. Proposed stable permission ids (final ids per the #226 catalog): `equipment.view`, `equipment.create`, `equipment.edit`, `equipment.move`, `equipment.retire`, `equipment.viewServiceHistory`. Seed the three compatibility roles so **admin/dispatcher** get the full Equipment surface and **technician** gets only Equipment reachable through their authorized assigned Work Orders (self-scoped, fail-closed, direct-URL denial verified). `operationalRoles` are **never** turned into security permissions.

## 14. Audit requirements

Move, retire, and reactivate (and any trusted-writer mutation) emit **immutable, trusted Audit Events** (per #226's Audit Event contract) — actor, action, target, before/after summary, timestamp — **secret-free, id-minimal**. Ordinary create/edit auditing follows the #226 model. Until trusted Functions are deployed (#15), audited mutations run via controlled operator scripts.

## 15. Data retention

Equipment and its derived history are **retained, not deleted** — retirement is a status, `allow delete: if false` mirrors accounts/locations. Service history persists via the underlying Work Orders regardless of Equipment status.

## 16. Import / export

- **Import:** assessed separately (§Task 28) — not assumed required for core completion. If approved, a bounded CSV import reusing the Contact-CSV safety patterns (strict parser, explicit mapping, bounded rows, whole-file structural rejection, atomic bounded writes, zero-write denial tests).
- **Export:** only if authorized by the Spec + #226 permission catalog; no sensitive/cross-Account leakage.

## 17. Mobile / scanning implications

The register/detail must scale to 375px (per platform responsive standards). **Barcode/QR scanning is deferred** (§18) — but the data model should keep `assetTag`/`serialNumber` as first-class string fields so a future scanner can look up by them without a schema change.

## 18. Explicit deferred scope (named, not built)

Service Contracts; PM Schedules; warranty claims/adjudication; IoT/telemetry; customer portal; photos/files (needs Storage architecture); barcode/QR scanning; **bulk cross-Account moves**; tenant model (Issue #140); AI recommendations. Recorded in a deferred-capability register (§Task 30); future issues created only when approved or needed to preserve a confirmed gap.

## 19. Production dependencies

- **Firestore Rules + indexes** for the new `equipment` collection (deployed only under separate production authorization).
- **Trusted Cloud Functions** for move/lifecycle/audit if the ADR requires trusted writes — **gated by Issue #15** (Functions not yet deployed); until then those actions stay operator-script-only or unavailable, never unsafe client writes.
- **Enterprise Access #226** foundations for the eventual permission cutover (compatibility/shadow-mode until authoritative).

## 20. Architecture options

| Option | Summary | Pros | Cons |
|---|---|---|---|
| **A. First-class `equipment` collection, client-direct writes + Rules** (mirrors accounts/locations) | one top-level `equipment` collection; create/edit/move via client SDK gated by Rules | consistent with the existing Customer-domain pattern; ships without #15; simplest | move/audit are harder to make atomic+immutable purely client-side; audit depends on trusted writer later |
| **B. First-class collection, trusted-Function writes for sensitive ops** | reads + ordinary edits client-direct + Rules; move/retire/reactivate + Audit Events via trusted Functions | atomic + immutably audited sensitive ops; aligns with #226 | move/lifecycle blocked until #15; more infra |
| **C. Hybrid (recommended)** | first-class collection; **client-direct create/edit reads gated by Rules** (ships now); **move/retire/reactivate + audit via the #226 trusted-writer seam** (unavailable until #15, never unsafe fallback) | ships the register/create/edit/detail now on the proven Customer pattern; keeps sensitive/audited mutations correct and #226-aligned; clean rollback per stage | two enforcement paths (already the platform norm per ADR-005) |
| **D. Sub-collection under Account** (`accounts/{id}/equipment`) | nest equipment under its Account | ownership implicit | breaks the flat-collection pattern used everywhere else; harder cross-Account queries/search; diverges from locations |

**Preliminary lean: Option C (hybrid, first-class flat collection)** — it matches the repository's established Account→Location pattern, ships the core experience without waiting on #15, and routes exactly the sensitive/audited actions (move/lifecycle) through the #226 trusted-writer seam. **The choice is an Owner + Architecture-Review decision (ADR-005-style), recorded in the Equipment ADR, not here.**

## 21. Risks & rollback

- **Boundary erosion (Equipment/Part confusion)** → separate collection/domain/UI + review checks (§5).
- **Silent ownership change** → identity-class fields + explicit audited move (§4/§7); Rules deny ownership change on ordinary edit.
- **Hidden #15 dependency** → move/lifecycle/audit explicitly gated; unavailable-not-unsafe fallback (§7/§19).
- **Permission drift / eligibility-as-authority** → align to #226; `operationalRoles` never security permissions (§13).
- **Rollback:** each child PR is independently revertible; the new collection is additive (no existing data touched); Rules/index deploys are separate, reversible, and production-gated; no legacy behaviour changes.

## 22. Explicit Owner decisions still required (for the ADR/Spec)

1. Architecture option (A/B/C/D) — the write/enforcement model.
2. Which descriptive/warranty fields are in-scope for v1 (§8/§9).
3. Whether Global Search gets an Equipment provider in v1 (§12).
4. Whether CSV import is in the core scope or a separate follow-up (§16).
5. The technician Equipment view's exact scope (§13) — coordinated with #226.
6. Final permission identifiers (via the #226 catalog, §13).

## Scope honored

Single file: `docs/assessments/equipment-and-installed-asset-management.md`. No `ROADMAP.md`/`SPRINT_STATUS.md`/`CLAUDE_CONTEXT.md`, entity/capability model, ADR, Specification, application code, Rules, index, or Function touched. Inventory Parts remain a separate capability. **Draft — pending Architecture Review; merging authorizes no implementation.**
