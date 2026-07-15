---
artifact_type: specification
gate: Sprint Specification
status: Specification-Approved
date: 2026-07-15
owner: Claude Code (Customer)
related_adrs: [docs/architecture/ADR-006-equipment-and-installed-asset-management.md]
depends_on: [docs/architecture/ADR-006-equipment-and-installed-asset-management.md, docs/assessments/equipment-and-installed-asset-management.md, docs/architecture/ADR-005-enterprise-authorization-migration-strategy.md]
implements: [docs/architecture/ADR-006-equipment-and-installed-asset-management.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 232
target_release: TBD
---

# Specification: Equipment & Installed Asset Management

**Status: SPECIFICATION-APPROVED.** Testable contracts derived from the Accepted, Owner-authorized **[ADR-006](../architecture/ADR-006-equipment-and-installed-asset-management.md)** and the merged [Assessment](../assessments/equipment-and-installed-asset-management.md). Tracking issue: #232.

**This Specification defines contracts; it authorizes NO implementation** and makes **no decision beyond ADR-006**. Where ADR-006 defers (tenant model #140, warranty adjudication, service contracts/PM, permission cutover timing via #226), this Spec defers identically. Each build stage is a separately-authorized Owner gate; production Rules/indexes/Functions/data remain separately authorized. **AI specifies; it never grants, revokes, or approves access.**

Verified against `origin/main` @ `fa24506`. Path convention: `firestore.rules`, `functions/…`, `docs/…` repo-root-relative; `src/…` relative to `field-ops-app-vite/`.

---

## 1. Equipment document contract

Collection **`equipment`** (flat, first-class). Document shape:

```
{
  id: string,                 // Firestore doc id (never the primary human reference)
  accountId: string,          // owning Account (required, immutable via ordinary edit)
  locationId: string,         // active install Location, same Account (required; changed only via move)
  name: string,               // display name (required, human reference)
  status: EquipmentStatus,    // "ACTIVE" | "INACTIVE" | "RETIRED" (required; default ACTIVE)
  manufacturer?: string|null,
  model?: string|null,
  serialNumber?: string|null,
  assetTag?: string|null,     // customer/site tag
  installedDate?: string|null,// ISO date
  warrantyExpiresDate?: string|null, // reference date only (no adjudication)
  notes?: string|null,
  createdAt: number,          // ms epoch, set on create
  updatedAt: number           // ms epoch, set on every write
}
```

**Invariants:** `accountId`, `locationId`, `name`, `status` always present; `locationId`'s Location `.accountId === equipment.accountId`; `status ∈` the enum; string fields trimmed, empty → `null`; unknown fields rejected by the write path and by Rules where enforceable. No financial/accounting fields (no cost, price, GL) — Equipment carries **no financial authority**.

## 2. Required vs optional fields

- **Required:** `accountId`, `locationId` (same Account), `name`, `status` (defaults ACTIVE on create).
- **Optional:** `manufacturer`, `model`, `serialNumber`, `assetTag`, `installedDate`, `warrantyExpiresDate`, `notes`.
- **Validation meaning:** `name.trim()` non-empty; `locationId` must resolve to a Location of `accountId`; optional strings are free-text, trimmed, nullable. Duplicate `name` within an Account is **allowed** (disambiguated by Location/manufacturer/model/serial in the UI).

## 3. Lifecycle statuses & transitions

`EquipmentStatus = ACTIVE | INACTIVE | RETIRED`. Allowed transitions:

| From → To | Action | Confirmation |
|---|---|---|
| ACTIVE ↔ INACTIVE | setStatus | plain |
| ACTIVE/INACTIVE → RETIRED | retire | **confirm (destructive)** |
| RETIRED → ACTIVE | reactivate | confirm |

Retire/reactivate are **trusted-writer, audited** actions (§10/§11), **#15-gated** (unavailable-not-unsafe). **Retiring never deletes service history or unlinks Work Orders.** No hard delete (`allow delete: if false`).

## 4. Account / Location invariants

- `equipment.accountId` is set on create and **never changed by an ordinary edit** (§6) — Rules deny an update that changes `accountId`.
- `equipment.locationId` is changed **only** by the move command (§5); an ordinary edit that alters `locationId` is denied.
- The referenced Location must exist and belong to `accountId`; a **cross-Account** `locationId` is invalid and **denied** (client validation + Rules).

## 5. Move / retire / reactivate rules

- **Move (`equipment.move`):** show current Location; destination restricted to **Locations of the same Account** (cross-Account move is deferred, §16); confirmation (reason if the field is required by config); **atomic** relationship update (`locationId` + `updatedAt`) with an Audit Event; **no partial move**; safe failure + retry. Trusted-writer only; **unavailable (disabled with a clear reason) while #15 unresolved — never a client-direct fallback.**
- **Retire (`equipment.retire`) / reactivate:** trusted-writer status transition (§3) + Audit Event; same #15 gating; retire is a confirmed destructive action.

## 6. Create / edit / detail behaviour

- **Create** (shared `Modal` + `Field`/`FormActions`/`FormError`/`FormStatus`): Account is **fixed** (from context) or explicitly selected; **Location selection is restricted to that Account**; labels above controls; text-required indicators on `name`+`locationId`; hints/errors; safe in-modal failure (never a raw error/code/id); duplicate-submit + close-during-save protection; success closes once, live-inserts, focuses the new row.
- **Edit** (shared primitives): edits descriptive/optional fields + status(ACTIVE↔INACTIVE via the plain path); **immutable identity/ownership fields** (`accountId`, and `locationId` except via move) are shown read-only or omitted; retire/reactivate/move are separate actions, not ordinary-edit side effects.
- **Detail** (dedicated route `/equipment/:equipmentId`): sections in §Detail below.

## 7. Search behaviour

- The register searches over `name`, `assetTag`, `serialNumber`, `manufacturer`, `model` (client-side over a bounded Account/Location-scoped set; no per-record query loop).
- Filters: by Location and by status; result count preserved as a live region.
- **Deterministic ordering:** by `name` ascending, tie-break `id` — stable and testable.
- Optional **Global Search provider** (§20) if approved: shows name/Account/Location/manufacturer-or-serial/status, **no raw ids**, backward-compatible with existing providers.

## 8. Detail page contents

Route `/equipment/:equipmentId`. Sections: **identity + status**; **Account**; **installed Location**; **manufacturer/model/serial/asset tag**; **service information** (installed/warranty dates, notes); **linked Work Orders**; **Service History** (§ derived); **lifecycle actions** (edit / move / retire|reactivate, each per §5 gating); **audit/activity** where approved; states = **loading / not-found / failure**; **safe Back** navigation. Direct links and active-nav state preserved (no raw ids rendered as the primary reference).

## 9. Loading / empty / error states

Reuse the shared `LoadingState` / `EmptyState` (database vs filtered variants) / `FailureState` primitives everywhere (register, detail, embedded lists). Distinguish loading / load-failure / database-empty / filtered-empty / not-found; never label an error as empty; never expose raw ids or provider errors.

## 10. Permissions & fail-closed

- Stable permission ids (final via the #226 catalog, §Task 25): `equipment.view`, `equipment.create`, `equipment.edit`, `equipment.move`, `equipment.retire`, `equipment.viewServiceHistory`.
- Seed compatibility: **admin/dispatcher** → full Equipment surface; **technician** → only Equipment reachable through their **authorized assigned Work Orders** (self-scoped), **no** general register, **no** financial/governed fields, **fail-closed on missing assignment/linkage**, **direct-URL denial verified**. `operationalRoles` are **never** security permissions.
- **Fail-closed:** missing/malformed/unavailable access or relationship data → **deny**; no default-allow, no fallback role.

## 11. Rules & trusted-writer boundaries

- **Firestore Rules (authoritative for client-direct):** authenticated access only; read/create/ordinary-edit gated by the seed authority (`isAdminOrDispatcher()` compatibility, technician self-scope per §10); an **update that changes `accountId` or `locationId` is denied** (§4); malformed/cross-Account references denied; a client cannot grant itself permissions or write trusted/audited fields; `allow delete: if false`. Complete emulator Rules tests; **existing Firestore Rules Regression stays green (178/178+)**.
- **Trusted Cloud Functions (authoritative for sensitive/audited):** move / retire / reactivate + Audit Event emission; **#15-gated** — unavailable until deployed+verified, never a client fallback.

## 12. Audit events

Each move / retire / reactivate (and any trusted-writer mutation) emits **exactly one immutable Audit Event** (per #226's contract): `{ at, actorUid, action, targetType:"equipment", targetId, scope?, summary, outcome }` — append-only, secret-free, id-minimal, never updated/deleted. Ordinary create/edit auditing follows the #226 model. Until #15, audited mutations run via controlled operator scripts.

## 13. Accessibility & responsive requirements

Labels above controls; text-required indicators; associated hints/errors; focus trap + restore in modals; keyboard-operable actions; landmark/heading structure; visible focus; polite success announcements; register/detail/modals **scale to 375px full-screen with no horizontal page overflow** and use a readable desktop measure.

## 14. Import / export boundaries

- **Import:** not in core scope; assessed separately (§Task 28). If approved: bounded CSV reusing the Contact-CSV safety patterns (strict parser, explicit mapping, bounded rows, whole-file structural rejection, atomic bounded writes, safe errors, zero-write denial tests). **This Spec does not require CSV import for core completion.**
- **Export:** only if authorized by a later Spec update + the #226 permission catalog; no sensitive/cross-Account leakage.

## 15. Production acceptance criteria

- **AC1** register: search/filter/count/ordering/states/375px/keyboard, bounded, no raw ids.
- **AC2** create: Account-fixed + Location-restricted-to-Account, validation, safe failure, duplicate-submit guard, success live-insert + focus.
- **AC3** edit: descriptive/status(ACTIVE↔INACTIVE) editable; `accountId`/`locationId` not changed by ordinary edit (UI + Rules).
- **AC4** move/retire/reactivate: correct transition, atomic, audited, confirmed, **unavailable-not-unsafe when #15 unresolved**.
- **AC5** detail: all §8 sections + linked WOs + derived service history + states + safe Back.
- **AC6** Customer + Location integration (§Tasks 18–19): scoped lists + Add, no cross-Account leakage, existing behaviour preserved.
- **AC7** Work Order integration (§Tasks 21–23): optional Equipment at the selected Location, "No Equipment" option, invalid selection cleared on Customer/Location change, existing WO creation intact, derived service history visible (incl. after retirement).
- **AC8** permissions: admin/dispatcher full; technician self-scoped + fail-closed + direct-URL denial; `operationalRoles` never security permissions.
- **AC9** Rules: all Equipment emulator Rules tests pass; **Firestore Rules Regression stays green**; cross-Account/ownership-change/self-grant denied.
- **AC10** production-verification (§Tasks 33–34, #15-gated): deployed Rules/indexes/(Functions) verified; authenticated production matrix passes; marked fixtures created + fully deleted (zero remain).

## 16. Rollback

Every child PR independently revertible; the `equipment` collection is **additive** (no existing data touched); Rules/index deploys are separate, reversible, and production-gated; a documented, **tested** rollback runbook accompanies each backend deploy; no legacy behaviour changes at any step.

## 17. Deferred capabilities (named, not built)

Service Contracts; PM Schedules; warranty claims/adjudication; IoT/telemetry; customer portal; Storage-backed photos/files; barcode/QR scanning; **bulk cross-Account moves**; tenant model (Issue #140); AI recommendations; Equipment export (unless later authorized). Recorded in the deferred-capability register (§Task 30).

## 18. Expected file scope

Exactly one new file for this Specification: `docs/specifications/equipment-and-installed-asset-management.md`. Implementation file scope is enumerated per bounded PR in the Implementation Plan (§Task 6). No application code, Rules, indexes, Functions, deployment, or production-data change here. Issue #232 stays OPEN.

## 19. Open questions (later gates — not resolved here)

- Final permission identifiers (via the #226 catalog).
- Whether Global Search gets an Equipment provider in v1 (§7/§20) — default: yes, small, backward-compatible, if the register ships first.
- Whether `warrantyExpiresDate` / `installedDate` are in v1 or a follow-up (default: include as plain optional dates).
- Exact technician Equipment view surface (coordinated with #226).

## 20. Approval

Specification-Approved as the contract layer for ADR-006. Merging records the contracts only; it authorizes **no** implementation. The Implementation Plan is the next gate; Issue #232 remains OPEN/In Progress. **AI specifies; it never grants, revokes, or approves access.**
