---
artifact_type: implementation-plan
gate: Implementation Plan
status: Draft
date: 2026-07-10
owner: Claude Code
related_adrs: []
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr: [88, 89]
target_release:
---

# Implementation Plan: Zero-history reorder behavior (recommendation status, manual quantity entry, role-gated authorization)

**Sprint Specification:** `docs/specifications/inventory-zero-history-reorder-behavior.md` — Approved 2026-07-10, commit `4bdf360ca01e657a220e8073e6e2822235218e6d` (PR #89).

Multi-PR sprint (three distinct architectural concerns: analytics/schema, authorization/Firestore Rules, UI/write-path) with a real sequencing dependency — PR 2 and PR 3 both require the types/fields PR 1 introduces; PR 3's writes are only meaningfully enforced once PR 2's rules are live. A standalone plan, per this repo's own threshold for when one is warranted.

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | `recommendationStatus`/nullable `urgency` + `OPERATIONAL_ROLE`/`QUANTITY_SOURCE` constants | Analytics engine + client/server mirror + type/schema foundation | None | Not started |
| 2 | `firestore.rules` role-gated `create` validation + emulator Rules test | Authorization/security (Firestore Rules) | PR 1 (new field names must be final before rules reference them) | Not started |
| 3 | `requestedQty`/`quantitySource` write path + manual-quantity UI + queue visibility | UI + domain write path | PR 1 (types/fields), PR 2 (rules must accept the new shape before this PR's writes can succeed against a deployed ruleset) | Not started |

## Sequencing notes

- **PR 1 before PR 2 and PR 3**: `recommendationStatus`, nullable `urgency`, `requestedQty`, `quantitySource`, and the `OPERATIONAL_ROLE`/`QUANTITY_SOURCE` constants are referenced by both later PRs. Landing the types/constants first means PR 2's rules and PR 3's UI are written against a settled shape, not a moving target.
- **PR 2 before PR 3**: PR 3 introduces the first real writes of `requestedQty`/`quantitySource`/`recommendationStatus` to `reorder_requests`. Per this repo's established Firestore Rules discipline (Sprint 2.1.4/2.1.10's REQUEST-CHANGES history — rules changes get their own dedicated review round), the rules must exist, pass their own emulator test, and be merged (and, before any real use, deployed — a separate Owner-authorized step, not part of this plan) before PR 3's write path is exercised for real. PR 3 can still be *built* in parallel once PR 1 lands, but should not merge ahead of PR 2, and must not be relied on for authorization on its own — client-side eligibility gating in PR 3 is a UX nicety, not the enforcement boundary (that's PR 2's job).
- **`docs/BusinessEntityModel.md` update** rides with PR 1 (schema fields are defined there) with a small addendum in PR 3 if the manual-entry UI surfaces anything not already captured (expected to be none — PR 1 should capture the full field list up front).
- **Client/server mirror consistency** (`domain/inventoryAnalyticsEngine.ts` / `functions/src/inventoryAnalyticsService.ts`) is entirely within PR 1 — both files change together, in the same commit, so there is never a merged state where they've drifted.

## PR 1 — `recommendationStatus`/nullable `urgency` + constants

**Scope:**
- `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts`: add `RecommendationStatus` type (`"READY" | "NEEDS_PLANNING"`); `ReplenishmentRecommendation.urgency` becomes `RiskLevel | null`; add `recommendationStatus: RecommendationStatus` field; `generateReplenishmentRecommendation()` branches on `hasUsageHistory(usage)` (existing PR #88 helper) to set both. `RiskLevel`/`URGENCY_ORDER` are **not modified** — this PR must not add any member to either.
- `functions/src/inventoryAnalyticsService.ts`: identical mirrored change, same commit.
- `field-ops-app-vite/src/domain/constants.js`: new `OPERATIONAL_ROLE = { PARTS_MANAGER: "PARTS_MANAGER", WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER" }` and `QUANTITY_SOURCE = { ANALYTICS: "ANALYTICS", MANUAL_ZERO_HISTORY: "MANUAL_ZERO_HISTORY" }`. Comment explicitly distinguishing `OPERATIONAL_ROLE.PARTS_MANAGER` (new: an Employee `operationalRoles[]` entry) from the existing, unrelated `REORDER_REQUEST_OWNER.PARTS_MANAGER` (a `currentOwner` value) — same string, two different fields, different meanings, per the Specification's explicit call-out.
- `docs/BusinessEntityModel.md`: Reorder Request field list gains `recommendationStatus`, `requestedQty`, `quantitySource`; `urgency` documented as nullable with the condition.
- **Audit every existing `urgency` read for null-safety** (the Specification's own flagged risk — e.g. `InventoryHealthPanel.jsx`'s `fo-badge-${recommendation.urgency.toLowerCase()}` would throw on `null`). This PR does not yet change consumer UI (that's PR 3), but must not merge a nullable type that immediately breaks an existing consumer at runtime — either fix the null-unsafe call sites in this same PR (minimal, defensive) or confirm via `npx tsc`/build that nothing currently null-unsafe actually executes with a `NEEDS_PLANNING` recommendation before PR 3 lands (recommend the former: cheap, removes a latent landmine).

**Testing:** inline Node assertion script (this repo's established no-framework pattern, same as PR #85/#88) covering: `NEEDS_PLANNING` + `urgency: null` + `recommendedOrderQty: 0` when `!hasUsageHistory`; unchanged `READY` + existing `urgency` formula when usage history exists; regression assertion that `RiskLevel`'s value set is exactly the original four. `npx tsc --noEmit` + `npm run build` (functions), `npm run build` + `npm run lint` (field-ops-app-vite).

**Explicitly not in this PR:** no Firestore Rules change, no write-path change (`createReorderRequest()` untouched), no UI change beyond the null-safety audit above.

## PR 2 — Firestore Rules validation + emulator test

**Scope:**
- Both `firestore.rules` copies (`/firestore.rules`, `/field-ops-app-vite/firestore.rules`, changed identically): add `hasOperationalRole(role)` and `canSubmitManualZeroHistoryQuantity()` helpers; extend `reorder_requests`'s `create` rule per the Specification's exact schema (positive-integer `requestedQty`, allowed `recommendationStatus`/`quantitySource`/`urgency` combinations, `canSubmitManualZeroHistoryQuantity()` gating the `NEEDS_PLANNING` branch only). `READY` path's existing `isAdminOrDispatcher()` gate is unchanged — this PR must not touch it.
- New Firestore Rules emulator test, extending the `functions/test/employeesRules.test.js` pattern (this repo's only existing precedent — same zero-new-dependency posture: `firebase-admin` + Node's built-in `fetch` against the emulator's REST APIs). Minimum scenarios (from the Specification's Testing strategy): reject non-positive/non-integer `requestedQty`; reject `READY` with `quantitySource != "ANALYTICS"`; reject `NEEDS_PLANNING` from a `dispatcher` with no `operationalRoles`; accept `NEEDS_PLANNING` from `admin`; accept `NEEDS_PLANNING` from a `dispatcher` whose linked Employee has `operationalRoles: ["WAREHOUSE_MANAGER"]`.
- Since this PR writes real, valid `reorder_requests` documents against the emulator to prove the rule accepts them, the test's fixtures should send the exact field shape PR 3 will send in production — coordinate field names precisely, but no dependency the other direction (PR 2 does not need PR 3's actual UI code, only the agreed shape from the Specification).

**Given this is a Firestore Rules change**, per `docs/ai/workflow.md`'s Codex-optional criteria, request a Codex review on this PR specifically (independent engineering review of the rules logic) — not mandatory-blocking, but recommended given the security-sensitive nature (this is the actual enforcement boundary for who can enter a manual quantity).

**Not deployed** as part of this PR — deploy is a separate, explicit, Owner-authorized step after merge (per this repo's standing practice and its own documented incident history of assuming merged-means-deployed).

**Explicitly not in this PR:** no analytics-engine change (PR 1's job), no UI change (PR 3's job), no `operationalRoles` data populated for any real Employee (out of scope for the whole sprint, per the Specification).

## PR 3 — Write path + manual-quantity UI + queue visibility

**Scope:**
- `field-ops-app-vite/src/domain/inventoryReorderRequests.js`: `createReorderRequest()` gains `recommendationStatus`, `requestedQty`, `quantitySource` as required parameters, per the Specification's per-path contract table (`READY`: `requestedQty = recommendedOrderQty`, `quantitySource: ANALYTICS`; `NEEDS_PLANNING`: manager-entered `requestedQty`, `quantitySource: MANUAL_ZERO_HISTORY`, `recommendedQty: null`).
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx`: "Needs Reorder" queue gains a `recommendationStatus === "NEEDS_PLANNING"` section/grouping, distinct from the existing `ACTIONABLE_URGENCIES` (`CRITICAL`/`HIGH`) filter — `URGENCY_ORDER`-based sorting within the existing set is unaffected. `handleRequestReorder()` branches: `READY` keeps today's one-click submit; `NEEDS_PLANNING` requires (a) client-side eligibility check (current user is `admin` or has a linked Employee with `operationalRoles` containing `PARTS_MANAGER`/`WAREHOUSE_MANAGER` — read via the existing `AuthContext` exposure from PR #84, no new read path) gating whether the control is even offered, and (b) a positive-whole-number quantity input before submit.
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx`: same manual-entry path for the per-part action; new "Requested qty," "Recommendation status," "Quantity source" rows on the Reorder Request review card (`ReorderRequestReview`'s existing "Recommended qty" row becomes strictly the historical-snapshot display, per the Specification).
- `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx`: grouping/display awareness of `recommendationStatus` (this is a read-only, Operations-side view — no "Request Reorder" action here per the existing `onRequestReorder` optional-prop pattern, unchanged).
- Confirm the PR 1 null-safety audit actually covers every `urgency` read this PR's diff touches or relies on; do not reintroduce an unsafe `.toLowerCase()`-style call on a nullable `urgency` while building the new UI.

**Testing:** `npm run build` + `npm run lint` (field-ops-app-vite). Manual verification against the local emulator (per the Specification's testing strategy, no full lifecycle emulator run required unless this PR's actual diff touches transition rules beyond `create` — it should not).

**Explicitly not in this PR:** no further Firestore Rules change (PR 2's job, already merged/deployed by this point), no analytics formula change (PR 1's job, already merged), no governed stocking-policy UI (out of scope for the whole sprint, per the Specification).

## External dependencies

- **`operationalRoles` population**: per the Specification's own flagged risk, no real Employee has `operationalRoles` set in production yet (PR #85 confirmed zero production consumers). Until an admin actually assigns `PARTS_MANAGER`/`WAREHOUSE_MANAGER` to at least one Employee — an operational/data task via `functions/scripts/provisionEmployeeAccess.js`, not a code change — only `admin` accounts can exercise the manual-entry path in practice after PR 3 merges. This is expected, not a defect to chase during implementation or verification.
- **`firestore.rules` deploy**: PR 2's rules changes are not live until explicitly deployed (`firebase deploy --only firestore:rules --project taylor-parts`), a separate Owner-authorized step after merge — same standing practice as every prior rules change in this repo.
- **Cloud Functions remain undeployed** (issue #15, Blaze plan) — unrelated to and unblocked by this sprint; the `READY`/analytics path continues to always resolve to `NEEDS_PLANNING` in production until that separate decision changes, which is the entire reason this sprint exists.

## Tracking

| PR # | GitHub PR | Status |
|---|---|---|
| 1 | Not yet opened | Not started |
| 2 | Not yet opened | Not started |
| 3 | Not yet opened | Not started |

Update this table as each PR opens/merges. Per the Owner's standing instruction, this sprint stays separate from Parts and Purchase Order Assignment Adoption and the broader governed Part and Inventory Administration initiative — do not link or merge tracking with either.
