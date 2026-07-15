---
artifact_type: implementation-plan
gate: Implementation Plan
status: Plan-Approved
date: 2026-07-15
owner: Claude Code (Customer)
related_adrs: [docs/architecture/ADR-006-equipment-and-installed-asset-management.md]
depends_on: [docs/specifications/equipment-and-installed-asset-management.md, docs/architecture/ADR-006-equipment-and-installed-asset-management.md]
implements: [docs/specifications/equipment-and-installed-asset-management.md]
supersedes: []
superseded_by: []
related_pr: null
related_issue: 232
target_release: TBD
---

# Implementation Plan: Equipment & Installed Asset Management

**Status: PLAN-APPROVED.** Sequences the [Specification](../specifications/equipment-and-installed-asset-management.md) (ADR-006) into small, reversible, independently-reviewable PRs. **Merging this plan authorizes NO implementation** — each PR below is its own bounded gate; production Rules/indexes/Functions/Storage/data remain **separately authorized** at their deployment gates. Issue #232 stays OPEN. **AI plans; it never grants, revokes, or approves access.**

Verified against `origin/main` @ `b68c7b1`. Path convention as prior Equipment docs.

**Re-audited against current `main` (2026-07-15).** The governing artifacts are unchanged — the merged [Assessment](../assessments/equipment-and-installed-asset-management.md) (PR #233), [ADR-006](../architecture/ADR-006-equipment-and-installed-asset-management.md) (PR #234) and [Specification](../specifications/equipment-and-installed-asset-management.md) (PR #235) all still govern this plan verbatim. One current-source change matters: the **Enterprise Access (#226) foundation primitives have since landed on `main`** (`src/access/permissionCatalog.ts`, `compatibilityRoles.ts`, `resolveEffectivePermission.ts`, `shadowParityHarness.ts`, `parityFixtures.ts`, plus the Functions-side audit writer). No `equipment.*` permission exists yet, so E18 is unchanged in intent but is now concrete: it **registers into those landed primitives** rather than anticipating them, and E19 remains gated on #226 becoming *authoritative* plus #15. Equipment itself remains greenfield (no Equipment domain module, collection, Rules, fixtures, or UI on `main`).

---

## Principles

- **Small & reversible:** each PR is independently revertible; the `equipment` collection is additive (touches no existing data); no legacy behaviour changes.
- **Union, never wholesale:** shared files (`driver.mjs`, `seed.mjs`, `navConfig.js`, `App.jsx`, `firestore.rules`, `index.css`) are edited by union, preserving concurrent Customer/Inventory/Platform/Enterprise-Access work.
- **Unavailable-not-unsafe:** move/retire/reactivate/audit route through the #226 trusted-writer seam and stay **disabled with a clear reason** while Issue #15 is unresolved — never a client-direct fallback.
- **Gate discipline:** every code PR runs unit/lint/typecheck/build + relevant browser verification; Rules PRs run the full Firestore Rules Regression; production deploy + production data are separate Owner-authorized gates.

## Work breakdown → child PRs (each a bounded child issue, §Task 7)

| # | PR (child) | Scope | Task map | Depends on | Gate |
|---|---|---|---|---|---|
| E1 | **Domain foundation** | `src/domain/equipment.js` + constants: types/status enum, validation, status normalization, display-name/summary formatting, safe error categorization, Account/Location relationship helpers, search ranking, service-history grouping — **pure, no write path**; pure unit tests | T8 | — | unit/lint/typecheck/build |
| E2 | **Firestore data access** | approved repository/hooks: bounded Account query, bounded Location query, detail subscription, create/update ops, lifecycle/move operation **contracts** (client path only for create/edit; move/lifecycle call the trusted-writer seam), safe loading/error, no per-record loops, no raw Firebase details | T9 | E1 | unit/build |
| E3 | **Rules & indexes** (security-reviewed, separate PR) | `firestore.rules` `match /equipment/{id}`: authenticated + compatibility roles; ownership (`accountId`/`locationId`) unchangeable via ordinary edit; cross-Account denied; self-grant/trusted-field writes denied; `delete:false`; `firestore.indexes.json` for the bounded queries; **complete emulator Rules tests**; Rules Regression stays green | T10 | E1 | Rules Regression 178+/all Equipment Rules tests |
| E4 | **Emulator fixtures** | additive `seed.mjs` Equipment fixtures: multiple Accounts/Locations, duplicate names, manufacturer/model/serial variations, active/inactive/retired, with/without Work Orders, moved, invalid-relationship attempts, each persona | T11 | E1 | seed runs; no prod fixtures |
| E5 | **Equipment register** | list/search/filter/count/ordering/states/375px/keyboard on shared workspace + state primitives; route `/equipment`; `navConfig` (union) | T12 | E1,E2,E4 | unit + `verify-equipment-register` |
| E6 | **Equipment creation** | shared Modal + form primitives; Account-fixed/selected + Location-restricted-to-Account; safe failure; duplicate-submit/close-during-save guards; success live-insert + focus | T13 | E2,E5 | `verify-equipment-*` |
| E7 | **Equipment detail** | route `/equipment/:id`; identity/status/Account/Location/fields/service-info/linked-WOs/Service-History/lifecycle-actions/states/safe-Back | T14 | E2,E5 | detail verify |
| E8 | **Equipment editing** | governed edit; immutable identity/ownership; retire/reactivate/move as separate actions (not ordinary-edit side effects) | T15 | E6,E7 | edit verify |
| E9 | **Move Equipment** | explicit move flow (current Location shown, same-Account destination, confirm/reason, atomic, audited, no partial); **trusted-writer; unavailable-not-unsafe if #15 unresolved** | T16 | E3,E8 | move verify (+#15 gating test) |
| E10 | **Lifecycle actions** | active/inactive/retired/reactivate; confirmations for retire; never delete history/WOs; trusted-writer + #15 gating for audited transitions | T17 | E8 | lifecycle verify |
| E11 | **Customer detail integration** | Equipment summary/count + account-scoped list + Add + live insert + detail links + states, **preserving current Contacts/Locations/Commercial-Profile behaviour**; no retired global subnav | T18 | E5,E6 | `verify-account-detail-*` regression + equipment |
| E12 | **Location integration** | location-scoped Equipment list + Add(Account/Location fixed) + detail links; no cross-Account leakage | T19 | E5,E6 | verify |
| E13 | **Global Search provider** (if Spec-approved) | Equipment provider (name/Account/Location/mfr-or-serial/status, no raw ids), backward-compatible | T20 | E5 | `verify-*search*` |
| E14 | **Work Order creation integration** | optional Equipment after Customer+Location in the wizard; Location-scoped query; "No Equipment" option; invalid selection cleared on Customer/Location change; existing WO creation intact; no backfill | T21 | E2 | `verify-wo-wizard` regression + equipment |
| E15 | **Work Order detail integration** | linked-Equipment context on WO detail; preserve WO lifecycle/assignment/technician/Customer behaviour | T22 | E14 | WO detail verify |
| E16 | **Equipment service history** | derived from linked Work Orders (no duplicate ledger); chronological + WO link + states; visible after retirement | T23 | E7,E14 | service-history verify |
| E17 | **Technician experience** | self-scoped to assigned-WO Equipment; no general register; no financial/governed fields; fail-closed; direct-URL denial verified; coordinated with #226 | T24 | E3,E7 | technician verify + denial |
| E18 | **Permission catalog + compatibility/shadow** | register the `equipment.*` ids **into the existing #226 primitives now on `main`** — `src/access/permissionCatalog.ts` (ids), `src/access/compatibilityRoles.ts` (admin/dispatcher full; technician self-scoped per E17), evaluated through `src/access/resolveEffectivePermission.ts`; run parity via `src/access/shadowParityHarness.ts` + `src/access/parityFixtures.ts` while #226 is **not yet authoritative** (existing authorization stays authoritative). **No new/duplicate engine** — extend the landed catalog, never fork it. | T25,T26 | E3 + the #226 foundation on `main` | parity tests (shadow harness) |
| E19 | **Authorization cutover** | activate Equipment permissions through the governed model once **#226 is authoritative** and its production gates + #15 are satisfied; nav/UI/Rules/Functions/audit/direct-denial all agree | T27 | E18 + #226 authoritative + #15 | full matrix |
| E20 | **CSV import assessment** (separate bounded initiative, only if approved) | assess need; if approved implement with Contact-CSV safety patterns | T28 | E2 | strict-parser tests |
| E21 | **Export** (only if authorized) | permissioned, no sensitive/cross-Account leakage | T29 | E18 | verify |
| E22 | **Deferred-capability register** | record (not build) service contracts/PM/warranty-adjudication/IoT/portal/Storage-files/scanning/bulk-cross-Account/tenant/AI; future issues only when approved | T30 | — | docs |

## Rules / index changes (E3, security-reviewed)

`match /equipment/{equipmentId}` mirroring accounts/locations with the ownership-immutability + cross-Account-denial + self-grant-denial + `delete:false` invariants (Spec §11); indexes for the bounded Account-scoped and Location-scoped queries + status/name ordering. **Deploy is a separate production gate (Phase J), not part of the merge.**

## Emulator fixtures (E4) & browser verification

Additive `seed.mjs` fixtures per Spec §Task 11; new driver commands `verify-equipment-register` / `-create` / `-detail` / `-edit` / `-move` / `-lifecycle` / `-service-history` / `-technician`, plus regressions (`verify-account-detail-forms`, `verify-wo-wizard`, Customer/Location, shared-state). **No production fixtures until Phase J.**

## Production deployment (Phase J — separately authorized)

E3 Rules/indexes (and E9/E10 Functions, if built) deploy only under explicit Owner **production authorization** stating exact head, `taylor-parts` project, resources, verification, cleanup, rollback (Tasks 32–35). Marked production fixtures created + fully deleted (zero remain) before any real-data onboarding, which itself needs separate Production Data Authorization.

## Data / bootstrap strategy

No real Equipment data is created/migrated without separate Production Data Authorization (Task 35): dry run → duplicate/conflict report → backup → bounded batches → write-ahead recovery → verification → rollback → audit evidence.

## Rollback & closeout

Every PR revertible; additive collection; separate reversible Rules/index deploys with tested runbooks. Closeout (Task 38): register/create/edit/detail complete; Customer/Location + Work Order/service-history integration working; authorization enforced; backend deployed+verified; production fixtures cleaned; rollback proven; docs reconciled (Task 37); Project zero-missing — then close #232 and move it + all completed children to Done.

## Sequencing summary

Foundation **E1 → E2 → (E3 Rules ∥ E4 fixtures)** → experience **E5 → E6 → E7 → E8** → sensitive **E9/E10** (#15-gated) → integration **E11/E12/E13/E14/E15/E16** → permissions **E17/E18 → E19** (after #226+#15) → optional **E20/E21** → **E22** register → Phase I review → Phase J deploy (authorized) → Phase K closeout.

## Scope honored

Single new file: `docs/implementation-plans/equipment-and-installed-asset-management.md`. No application code, Rules, indexes, Functions, deployment, or production data. Issue #232 stays OPEN. **AI plans; it never grants, revokes, or approves access.**
