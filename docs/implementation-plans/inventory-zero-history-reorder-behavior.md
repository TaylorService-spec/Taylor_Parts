---
artifact_type: implementation-plan
gate: Implementation Plan
status: Approved
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

**Sprint Specification:** `docs/specifications/inventory-zero-history-reorder-behavior.md` — status `Approved`, commit `1cb4376bf87812a60c4ec7410390a4391d1f827c` (PR #89). (Sent back from `Approved` to `Draft` once, mid-sprint, when this Implementation Plan's own first review round found two defects in the Specification's drafted rules logic — both resolved and re-approved; see that document's "Approval" section for the full record.)

Multi-PR sprint (four distinct concerns: analytics/schema, transitional authorization/Firestore Rules, UI/write-path, and a rules-tightening step) with real sequencing dependencies — PR 2 and PR 3 both require the types/fields PR 1 introduces; PR 3's writes are only meaningfully *authorized* (not merely accepted) once PR 2's rules are live; PR 4 must not land until PR 3 is confirmed live, per the Specification's "Deployment / rollout sequence." A standalone plan, per this repo's own threshold for when one is warranted.

## PR breakdown

| # | PR title | Architectural concern | Depends on | Status |
|---|---|---|---|---|
| 1 | `recommendationStatus`/nullable `urgency` + `OPERATIONAL_ROLE`/`QUANTITY_SOURCE` constants | Analytics engine + client/server mirror + type/schema foundation | None | Not started |
| 2 | `firestore.rules` transitional (dual-shape) `create` validation + emulator Rules test | Authorization/security (Firestore Rules), step 1 of the expand/contract rollout | PR 1 (new field names must be final before rules reference them) | Not started |
| 3 | `requestedQty`/`quantitySource` write path + manual-quantity UI + queue visibility | UI + domain write path, step 2 of the rollout | PR 1 (types/fields), PR 2 deployed live (not just merged — the transitional rules must actually be serving before this PR's new-shape writes are exercised for real) | Not started |
| 4 | `firestore.rules` tightening — remove the legacy-shape (`: isAdminOrDispatcher()`) branch | Authorization/security (Firestore Rules), step 3 of the rollout — closes the temporary gap | PR 3 deployed live and confirmed (no legacy-shape writer remains in use) | Not started |

## Sequencing notes

- **PR 1 before PR 2 and PR 3**: `recommendationStatus`, nullable `urgency`, `requestedQty`, `quantitySource`, and the `OPERATIONAL_ROLE`/`QUANTITY_SOURCE` constants are referenced by both later PRs. Landing the types/constants first means PR 2's rules and PR 3's UI are written against a settled shape, not a moving target.
- **PR 2 before PR 3, and specifically PR 2's *deploy* before PR 3's *deploy***: this is a real deploy-ordering requirement, not just a merge-ordering one — per the Specification's "Deployment / rollout sequence," the transitional rules (accepting both the current live legacy shape and the new shape) must be live in production *before* the new writer ships, so there is never a moment where the live client sends a shape the live rules reject. PR 3 can still be *built* and even merged in parallel once PR 1 lands, but its **deploy** must wait for PR 2's rules deploy to be confirmed live.
- **PR 4 only after PR 3 is deployed and confirmed** — PR 4 removes the legacy-shape allowance the transitional rule (PR 2) intentionally left in place. Landing PR 4 before PR 3's new writer is fully live would reproduce Defect scenario 1 from the Specification (strict rules breaking the still-live legacy writer). This repo's low-traffic, no-real-production-users-yet posture for this initiative (per the Assessment's own findings) means the gap between PR 3 and PR 4 should be short and deliberate, not indefinite — see the Specification's rollout-sequencing risk.
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

## PR 2 — Firestore Rules transitional validation + emulator test (rollout step 1)

**Scope:**
- Both `firestore.rules` copies (`/firestore.rules`, `/field-ops-app-vite/firestore.rules`, changed identically): add `hasOperationalRole(role)` and `canSubmitManualZeroHistoryQuantity()` helpers; extend `reorder_requests`'s `create` rule with the **transitional, dual-shape** variant from the Specification's "Deployment / rollout sequence" — `request.resource.data.keys().hasAny(["recommendationStatus"]) ? (corrected new-shape rule) : isAdminOrDispatcher()`. The legacy branch must be **byte-identical in effect** to today's live rule (verify via the emulator test asserting a legacy-shape create still succeeds under `isAdminOrDispatcher()` alone, unchanged). The new-shape branch uses the corrected rule from the Specification: `READY` requires `isAdminOrDispatcher()` and allows `requestedQty >= 0`; `NEEDS_PLANNING` requires `canSubmitManualZeroHistoryQuantity()` **alone** (not layered under `isAdminOrDispatcher()`) and requires `requestedQty > 0`.
- New Firestore Rules emulator test, extending the `functions/test/employeesRules.test.js` pattern (this repo's only existing precedent — same zero-new-dependency posture: `firebase-admin` + Node's built-in `fetch` against the emulator's REST APIs). Minimum scenarios (from the Specification's Testing strategy, both branches): **legacy shape still succeeds under `isAdminOrDispatcher()` alone** (the transitional-safety check); accept `READY` with `requestedQty: 0`; reject `NEEDS_PLANNING` with `requestedQty <= 0`; reject non-integer `requestedQty` on either path; reject `READY` with `quantitySource != "ANALYTICS"`; reject `NEEDS_PLANNING` from a `dispatcher` with no `operationalRoles`; **accept `NEEDS_PLANNING` from a `technician` (or any non-admin/dispatcher security role) whose linked Employee has `operationalRoles: ["PARTS_MANAGER"]`** — this is the exact scenario the Specification's Defect 2 broke, must be explicitly covered, not inferred from the `admin`/`dispatcher` cases; accept `NEEDS_PLANNING` from `admin`.
- Since this PR writes real, valid `reorder_requests` documents against the emulator to prove the rule accepts them, the test's fixtures should send the exact field shape PR 3 will send in production — coordinate field names precisely, but no dependency the other direction (PR 2 does not need PR 3's actual UI code, only the agreed shape from the Specification).

**Given this is a Firestore Rules change**, per `docs/ai/workflow.md`'s Codex-optional criteria, request a Codex review on this PR specifically (independent engineering review of the rules logic) — not mandatory-blocking, but recommended given the security-sensitive nature (this is the actual enforcement boundary for who can enter a manual quantity), and given this PR already went through two drafting defects during Specification review.

**Deploy this PR's rules and confirm live** before PR 3 deploys (see Sequencing notes) — deploy itself is a separate, explicit, Owner-authorized step after merge (per this repo's standing practice and its own documented incident history of assuming merged-means-deployed), but for this PR specifically, "merged" is not sufficient to unblock PR 3 — "deployed and confirmed live" is the actual gate.

**Explicitly not in this PR:** no analytics-engine change (PR 1's job), no UI change (PR 3's job), no `operationalRoles` data populated for any real Employee (out of scope for the whole sprint, per the Specification), no removal of the legacy-shape branch (that's PR 4's job, and only after PR 3 is live).

## PR 3 — Write path + manual-quantity UI + queue visibility

**Scope:**
- `field-ops-app-vite/src/domain/inventoryReorderRequests.js`: `createReorderRequest()` gains `recommendationStatus`, `requestedQty`, `quantitySource` as required parameters, per the Specification's per-path contract table (`READY`: `requestedQty = recommendedOrderQty`, `quantitySource: ANALYTICS`; `NEEDS_PLANNING`: manager-entered `requestedQty`, `quantitySource: MANUAL_ZERO_HISTORY`, `recommendedQty: null`).
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx`: "Needs Reorder" queue gains a `recommendationStatus === "NEEDS_PLANNING"` section/grouping, distinct from the existing `ACTIONABLE_URGENCIES` (`CRITICAL`/`HIGH`) filter — `URGENCY_ORDER`-based sorting within the existing set is unaffected. `handleRequestReorder()` branches: `READY` keeps today's one-click submit; `NEEDS_PLANNING` requires (a) client-side eligibility check (current user is `admin` or has a linked Employee with `operationalRoles` containing `PARTS_MANAGER`/`WAREHOUSE_MANAGER` — read via the existing `AuthContext` exposure from PR #84, no new read path) gating whether the control is even offered, and (b) a positive-whole-number quantity input before submit.
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx`: same manual-entry path for the per-part action; new "Requested qty," "Recommendation status," "Quantity source" rows on the Reorder Request review card (`ReorderRequestReview`'s existing "Recommended qty" row becomes strictly the historical-snapshot display, per the Specification).
- `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx`: grouping/display awareness of `recommendationStatus` (this is a read-only, Operations-side view — no "Request Reorder" action here per the existing `onRequestReorder` optional-prop pattern, unchanged).
- Confirm the PR 1 null-safety audit actually covers every `urgency` read this PR's diff touches or relies on; do not reintroduce an unsafe `.toLowerCase()`-style call on a nullable `urgency` while building the new UI.

**Testing:** `npm run build` + `npm run lint` (field-ops-app-vite). Manual verification against the local emulator (per the Specification's testing strategy, no full lifecycle emulator run required unless this PR's actual diff touches transition rules beyond `create` — it should not).

**Explicitly not in this PR:** no further Firestore Rules change (PR 2's job, already merged/deployed by this point), no analytics formula change (PR 1's job, already merged), no governed stocking-policy UI (out of scope for the whole sprint, per the Specification).

## PR 4 — Firestore Rules tightening (rollout step 3)

**Scope:**
- Both `firestore.rules` copies: remove the `: isAdminOrDispatcher()` legacy branch from PR 2's transitional rule, leaving only the corrected new-shape rule unconditionally. This is the smallest possible diff — deleting the ternary's legacy arm and the now-unnecessary `keys().hasAny(["recommendationStatus"])` guard, not a rewrite.
- Update the emulator Rules test: the "legacy shape still succeeds" assertion from PR 2 is **inverted** here — a legacy-shape create (no `recommendationStatus` field) must now be **rejected**, proving the gap is actually closed, not just theoretically removed.

**Precondition, verified before this PR is opened (not just before it merges):** PR 3 is deployed live, and no `reorder_requests` document has been created via the legacy shape since PR 3's deploy timestamp (spot-check via the Firestore console or an admin-script read query — read-only, no production data modified, consistent with this initiative's standing constraint). Given this initiative currently has zero real production consumers (per the Assessment's own findings), this check is expected to be trivial, but must still be performed and stated explicitly in this PR's description, not assumed.

**Deploy and confirm live** — this is the step that actually closes the `MANUAL_ZERO_HISTORY` authorization gap described in the Specification's rollout risk. Do not treat PR 4 as optional cleanup; it is a required deliverable of this sprint, tracked to completion the same as PRs 1-3.

**Explicitly not in this PR:** no schema, UI, or analytics-engine change of any kind — this is a rules-only tightening step.

## External dependencies

- **`operationalRoles` population**: per the Specification's own flagged risk, no real Employee has `operationalRoles` set in production yet (PR #85 confirmed zero production consumers). Until an admin actually assigns `PARTS_MANAGER`/`WAREHOUSE_MANAGER` to at least one Employee — an operational/data task via `functions/scripts/provisionEmployeeAccess.js`, not a code change — only `admin` accounts can exercise the manual-entry path in practice after PR 3 merges. This is expected, not a defect to chase during implementation or verification.
- **`firestore.rules` deploy**: PR 2's rules changes are not live until explicitly deployed (`firebase deploy --only firestore:rules --project taylor-parts`), a separate Owner-authorized step after merge — same standing practice as every prior rules change in this repo.
- **Cloud Functions remain undeployed** (issue #15, Blaze plan) — unrelated to and unblocked by this sprint; the `READY`/analytics path continues to always resolve to `NEEDS_PLANNING` in production until that separate decision changes, which is the entire reason this sprint exists.

## Tracking

| PR # | GitHub PR | Status |
|---|---|---|
| 1 | [#90](https://github.com/TaylorService-spec/Taylor_Parts/pull/90) | Open |
| 2 | Not yet opened | Not started |
| 3 | Not yet opened | Not started |
| 4 | Not yet opened | Not started |

Update this table as each PR opens/merges. Per the Owner's standing instruction, this sprint stays separate from Parts and Purchase Order Assignment Adoption and the broader governed Part and Inventory Administration initiative — do not link or merge tracking with either.

## Approval

**Approved by ChatGPT, 2026-07-10**, at commit `ea7204975ca127c3856dcb4b417ba1457c9cb3a3` (PR #89). The four-PR decomposition confirmed to correctly implement the approved Specification, preserve one architectural concern per PR, include adequate Rules-emulator coverage, and make deployments — not merely merges — explicit sequencing gates.

**Authorized to proceed: PR 1 only.** PR 2 and PR 4 each require their own independent Rules-focused review before merge (per `docs/ai/workflow.md`'s Codex-optional criteria, already called out per-PR above). PR 3 must not deploy until PR 2's transitional rules are confirmed live in production — merge alone is not sufficient, per this plan's own Sequencing notes. PRs 2-4 are not yet authorized to begin.
