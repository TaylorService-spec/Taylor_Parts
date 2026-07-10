---
artifact_type: specification
gate: Sprint Specification
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

# Sprint Specification: Zero-history reorder behavior (recommendation status, manual quantity entry, role-gated authorization)

**Architecture Review:** `docs/assessments/inventory-zero-history-reorder-behavior.md`'s "Architecture Decision" section — Approved 2026-07-10, revised 2026-07-10 per ChatGPT's REQUEST CHANGES on the first Specification round (`recommendationStatus`/`urgency` separation, manual-entry role eligibility).

## Executive summary

When a part has no `CONSUMED` ledger history, `avgDailyUsage`/`reorderPoint`/`recommendedOrderQty` are all `0` and urgency collapses to `LOW` regardless of actual stock (root-caused in the linked assessment: Cloud Functions, the sole writer of `CONSUMED` entries, are not deployed to production). PR #88 already fixed the *display* of this (shows "Insufficient usage history" instead of a bare `0`) without changing any underlying value or write behavior. This sprint implements the approved permanent, three-tier model: usage analytics when reliable history exists, a governed stocking policy when configured (not built this sprint), and a manager-entered quantity for everything else — introducing a `recommendationStatus` field (orthogonal to `urgency`, not a new risk level) and a role-gated, Firestore-Rules-enforced manual-entry path.

## Sprint objective

A part with no usage history:
1. Is classified `recommendationStatus: "NEEDS_PLANNING"` with `urgency: null` — never labeled a `LOW` risk it has no evidence for — and appears in a distinct queue/section a manager can actually see.
2. Can still be reorder-requested, but only by an eligible person (Employee with `operationalRoles` containing `PARTS_MANAGER` or `WAREHOUSE_MANAGER`, or an `admin` override), entering a positive whole-number quantity — never a submitted `0`.
3. Has that entered quantity stored in `requestedQty`, distinct from `recommendedQty` (which stays an immutable historical snapshot — `null` when nothing was computed, the existing computed number when it was).
4. Records `quantitySource` (`ANALYTICS` | `MANUAL_ZERO_HISTORY`) as an immutable audit fact.
5. Is validated server-side: `firestore.rules` rejects a non-positive or non-integer `requestedQty`, a disallowed `recommendationStatus`/`urgency` combination, and a `MANUAL_ZERO_HISTORY` submission from someone without an eligible role — not just UI-hidden.

This sprint does **not** build a governed stocking-policy UI or storage model (minimum-stock/target-stock values) — it lays the schema/classification groundwork (tier 2 of the hybrid model is a reserved, not-yet-configurable no-op this sprint; see "Explicitly out of scope").

## Scope

- `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` — add `recommendationStatus` (new type, `"READY" | "NEEDS_PLANNING"`), make `urgency` nullable, `generateReplenishmentRecommendation()` sets `recommendationStatus: "NEEDS_PLANNING"`, `urgency: null` when `!hasUsageHistory(usage)` (no governed-policy lookup exists yet, so this path is unconditional this sprint). `RiskLevel`/`URGENCY_ORDER` are **unchanged** — no new value added to either.
- `functions/src/inventoryAnalyticsService.ts` — mirrored change, kept in sync per the file's own "authoritative" convention.
- `field-ops-app-vite/src/domain/constants.js` — **new** `OPERATIONAL_ROLE` constant (`PARTS_MANAGER`, `WAREHOUSE_MANAGER`) — the first canonical enum for Employee `operationalRoles[]` string values in this codebase (none exists today; PR #85's `EmployeeAssignmentPicker` has zero production consumers, so no operational-role string has ever been given a canonical home). New `QUANTITY_SOURCE` constant (`ANALYTICS`, `MANUAL_ZERO_HISTORY`).
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx` — "Needs Reorder" queue gains a `recommendationStatus === "NEEDS_PLANNING"` section, separate from the existing `ACTIONABLE_URGENCIES` (`CRITICAL`/`HIGH`) filter; `handleRequestReorder()` requires manual quantity entry (and eligibility) when `recommendationStatus === "NEEDS_PLANNING"` instead of auto-submitting.
- `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` — sort/group awareness of `recommendationStatus` alongside the existing, unchanged `URGENCY_ORDER` sort.
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` — same manual-quantity entry path as `PartsList.jsx`; new "Requested qty" / "Recommendation status" rows on the Reorder Request review card.
- `field-ops-app-vite/src/domain/inventoryReorderRequests.js` — `createReorderRequest()` gains `requestedQty` and `quantitySource` as new required fields.
- `firestore.rules` (both copies: `/firestore.rules` and `/field-ops-app-vite/firestore.rules`, kept identical per existing convention) — `reorder_requests` `create` rule gains schema/type/positivity validation, plus a new operational-role check for the `MANUAL_ZERO_HISTORY` path specifically. New `hasOperationalRole(role)` rules helper.
- `docs/BusinessEntityModel.md` — Reorder Request field list update (`recommendationStatus`, `requestedQty`, `quantitySource`; `urgency` now nullable), per this repo's standing convention of keeping that doc as the schema reference.

## Explicitly out of scope

- Any governed minimum-stock/target-stock policy UI, storage model, or admin workflow (tier 2 of the hybrid model). This sprint only ensures tier 2's *absence* is handled safely (falls through to `NEEDS_PLANNING` + manual entry) — it does not build tier 2 itself. A future sprint, separately specified.
- Re-evaluating or migrating `data/partsCatalog.ts`'s existing `reorderThreshold` field. Per the Architecture Decision, it is explicitly not reused as-is; any future migration is its own decision.
- Parts and Purchase Order Assignment Adoption (separate initiative, kept apart per Owner instruction).
- The broader governed Part and Inventory Administration initiative (per Owner instruction, kept separate).
- Any correction/edit flow for an existing Reorder Request's quantity. Per the Architecture Decision, corrections are cancel-and-recreate — no new "edit" capability, no new mutable window on `recommendedQty`, `requestedQty`, or `quantitySource`.
- Actually deploying Cloud Functions or generating real `CONSUMED` data (blocked on the Blaze plan decision, issue #15 — unrelated to this sprint).
- Any change to `urgency`'s meaning, values, or thresholds for parts that DO have usage history — `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` and their existing formulas are completely unchanged for that case; this sprint adds a sibling field, not a new member of that enum.
- Populating `operationalRoles` for any real Employee record, or building any UI to manage it. This sprint only defines the `OPERATIONAL_ROLE` constant and the rules check that reads it — actually assigning `PARTS_MANAGER`/`WAREHOUSE_MANAGER` to specific Employees is an operational/data task, not a code change, and is not this sprint's concern (same posture as Employee Foundation's existing `provisionEmployeeAccess.js`-mediated assignment, unaffected here).

## Technical design

**`recommendationStatus`, not a new risk level** (`domain/inventoryAnalyticsEngine.ts`, `functions/src/inventoryAnalyticsService.ts`):
```ts
export type RecommendationStatus = "READY" | "NEEDS_PLANNING";
// RiskLevel is UNCHANGED:
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ReplenishmentRecommendation = {
  partId: string;
  availableStock: number;
  reorderPoint: number;
  daysRemaining: number;
  recommendedOrderQty: number;      // unchanged meaning; see per-path contract below
  recommendationStatus: RecommendationStatus; // NEW
  urgency: RiskLevel | null;        // now nullable
  modelVersion: "EPIC3_LINEAR_V1";
};
```
`generateReplenishmentRecommendation()`: if `!hasUsageHistory(usage)` (existing PR #88 helper) → `recommendationStatus: "NEEDS_PLANNING"`, `urgency: null`, `recommendedOrderQty: 0` (unchanged internal computed value — PR #88's display fix already handles rendering this honestly; this sprint's display work is about *grouping*, not re-solving the already-solved display problem). Otherwise (existing behavior, completely unchanged) → `recommendationStatus: "READY"`, `urgency` computed exactly as today. `URGENCY_ORDER` is **not touched** — it continues to rank only `CRITICAL`/`HIGH`/`MEDIUM`/`LOW`, and is never evaluated for a `NEEDS_PLANNING` recommendation (queue grouping keys on `recommendationStatus` instead, see UI impact).

**Reorder Request schema addition** (`domain/inventoryReorderRequests.js`, `docs/BusinessEntityModel.md`):
- New field: `recommendationStatus: "READY" | "NEEDS_PLANNING"` — copied from `recommendation.recommendationStatus` at creation time, immutable.
- New field: `requestedQty: number` — the actual quantity a human is requesting, always present, always a positive whole number, always the field downstream purchasing reads. Populated as `recommendedOrderQty` when `recommendationStatus === "READY"` (today's behavior, unchanged value), or from manual entry when `"NEEDS_PLANNING"`.
- New field: `quantitySource: "ANALYTICS" | "MANUAL_ZERO_HISTORY"` — immutable audit fact, `ANALYTICS` for the `READY` path, `MANUAL_ZERO_HISTORY` for the `NEEDS_PLANNING` path. No third value this sprint (a future governed-policy tier would add one, out of scope here).
- `recommendedQty` **contract, finalized**: `null` when `recommendationStatus === "NEEDS_PLANNING"` (nothing was computed — matches this codebase's existing convention for not-yet-applicable fields, e.g. `assignedToUserId`/`purchaseOrderId` default `null`); the existing computed number (including a legitimate `0`) when `recommendationStatus === "READY"`. Kept purely as the immutable historical snapshot — downstream consumers must read `requestedQty` for the actionable number. (Investigation found `PartDetail.jsx`'s `ReorderRequestReview` currently displays `request.recommendedQty` as "Recommended qty" — this becomes strictly the historical-snapshot display; `requestedQty` needs its own, separately labeled row.)
- `createReorderRequest({ partId, urgency, recommendedQty, recommendationStatus, requestedQty, quantitySource })` — `recommendationStatus`, `requestedQty`, `quantitySource` become new required parameters, always sent by both call sites (`PartsList.jsx`, `PartDetail.jsx`).

**Per-path contract** (from the Architecture Decision, restated for implementers):

| Field | `READY` (analytics-backed) | `NEEDS_PLANNING` (zero-history) |
|---|---|---|
| `recommendationStatus` | `READY` | `NEEDS_PLANNING` |
| `urgency` | `LOW`\|`MEDIUM`\|`HIGH`\|`CRITICAL` (unchanged formula) | `null` |
| `recommendedQty` | existing computed number (`0` is valid) | `null` |
| `requestedQty` | `= recommendedQty` at creation, `>= 0` (0 is a legitimate computed value) | manager-entered, `> 0` (must be a meaningful request) |
| `quantitySource` | `ANALYTICS` | `MANUAL_ZERO_HISTORY` |

**Manual quantity entry UX** (`PartsList.jsx`, `PartDetail.jsx`):
- When `recommendation.recommendationStatus === "NEEDS_PLANNING"`, "Request Reorder" is only enabled/actionable for an eligible user (see Firestore Rules impact — client-side gating mirrors the rules check but is not a substitute for it) and opens a quantity input (positive whole number, client-side validated before submit) instead of submitting immediately. When `recommendationStatus === "READY"`, today's one-click behavior is completely unchanged.
- Exact component structure (inline form vs. modal) is an implementation-time UI decision, not specified here.

**Role eligibility — new concept, defined here** (`domain/constants.js`, `domain/employees.js` conventions):
```js
export const OPERATIONAL_ROLE = {
  PARTS_MANAGER: "PARTS_MANAGER",
  WAREHOUSE_MANAGER: "WAREHOUSE_MANAGER",
};
```
This is the first canonical `operationalRoles[]` value enum in the codebase — `PARTS_MANAGER` already exists as a *string* (`REORDER_REQUEST_OWNER.PARTS_MANAGER`, a `currentOwner` value, role-level not per-Employee) but has never been used as an Employee `operationalRoles[]` entry; this sprint gives the same string a second, additional meaning in a different field, which implementation should comment explicitly to avoid future confusion between "who currently owns this request" (`currentOwner`) and "who is allowed to manually enter a quantity" (`operationalRoles`). `WAREHOUSE_MANAGER` is entirely new. Client-side eligibility check reads the current user's linked Employee (`AuthContext`'s existing `operationalRoles` exposure, from PR #84 — already available, no new read path needed) and checks membership in `[PARTS_MANAGER, WAREHOUSE_MANAGER]`, OR `role === "admin"` (existing `ROLES.ADMIN`, unconditional override).

## Firestore Rules impact

Both copies (`/firestore.rules`, `/field-ops-app-vite/firestore.rules` — kept identical, existing convention) need:

**New helper** (alongside the existing `isSignedIn()`/`userData()`/`isAdminOrDispatcher()` block):
```
function hasOperationalRole(role) {
  return isSignedIn()
    && userData().employeeId != null
    && get(/databases/$(database)/documents/employees/$(userData().employeeId)).data.operationalRoles.hasAny([role]);
}

function canSubmitManualZeroHistoryQuantity() {
  return isSignedIn()
    && (userRole() == "admin"
        || hasOperationalRole("PARTS_MANAGER")
        || hasOperationalRole("WAREHOUSE_MANAGER"));
}
```
`hasOperationalRole()` reuses the exact `users/{uid}.employeeId` → `employees/{employeeId}` read pattern already established and already allowed by the existing `employees/{employeeId}` `read` rule's self-read clause (`userData().employeeId == employeeId`) — no new read permission is opened, this only adds a new *consumer* of an already-readable relationship.

**`reorder_requests` `create` rule**, extended (currently `allow create: if isAdminOrDispatcher();`, no field validation at all). **Revised 2026-07-10 per ChatGPT's REQUEST CHANGES** — the first drafted version (below, struck through for the record) had two real defects:

~~`allow create: if isAdminOrDispatcher() && ... && request.resource.data.requestedQty is int && request.resource.data.requestedQty > 0 && (recommendationStatus == "READY" ? (...) : (... && canSubmitManualZeroHistoryQuantity()))`~~

**Defect 1 — `requestedQty > 0` applied unconditionally to both paths, but `recommendedQty: 0` (and therefore `requestedQty: 0` on the `READY` path, where `requestedQty = recommendedQty`) is a legitimate, already-reachable value today**: `PartsList.jsx`'s "Needs Reorder" queue has an `ALL` filter (`queueFilter === "ALL"`, not just the default `ACTIONABLE` — `CRITICAL`/`HIGH` — filter), which renders "Request Reorder" for every urgency including `LOW`/`MEDIUM`, where `recommendedOrderQty` can genuinely be `0` (a healthy-stock part). A global `requestedQty > 0` requirement would have silently broken this already-working case. Fixed by scoping the positivity requirement to the `NEEDS_PLANNING` branch only — a *manually entered* quantity must be meaningful and positive; an *analytics-computed* `0` is an honest "no reorder needed" and must remain valid, exactly as it behaves today (no rules validation exists on it today, so this is a new constraint that must not be stricter than current real usage).

**Defect 2 — the outer, unconditional `isAdminOrDispatcher()` silently blocked the entire operational-role path it was supposed to enable**: `ROLES` (`admin`/`dispatcher`/`technician`, `users/{uid}.role`) and Employee `operationalRoles[]` are two independent fields on two independent documents (see this Specification's own "Role eligibility" section above). A real Parts Manager whose `users/{uid}.role` is `technician` (or anything other than `admin`/`dispatcher`) has `hasOperationalRole("PARTS_MANAGER") == true` but `isAdminOrDispatcher() == false` — under the first draft's unconditional outer AND, that person could never pass the `create` rule at all, regardless of `canSubmitManualZeroHistoryQuantity()`. The Architecture Decision's intent ("Eligible operational roles: PARTS_MANAGER, WAREHOUSE_MANAGER" as its own, additional path — not a path gated behind also being a dispatcher) requires `canSubmitManualZeroHistoryQuantity()` to stand alone as the `NEEDS_PLANNING` branch's authorization, not be ANDed with `isAdminOrDispatcher()`.

**Corrected rule:**
```
allow create: if request.resource.data.partId is string && request.resource.data.partId.size() > 0
  && request.resource.data.recommendationStatus in ["READY", "NEEDS_PLANNING"]
  && request.resource.data.quantitySource in ["ANALYTICS", "MANUAL_ZERO_HISTORY"]
  && (request.resource.data.recommendationStatus == "READY"
        ? (isAdminOrDispatcher()
           && request.resource.data.urgency in ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
           && request.resource.data.quantitySource == "ANALYTICS"
           && request.resource.data.recommendedQty is number
           && request.resource.data.requestedQty is int && request.resource.data.requestedQty >= 0)
        : (canSubmitManualZeroHistoryQuantity()
           && request.resource.data.urgency == null
           && request.resource.data.quantitySource == "MANUAL_ZERO_HISTORY"
           && request.resource.data.recommendedQty == null
           && request.resource.data.requestedQty is int && request.resource.data.requestedQty > 0));
```
Notes:
- Authorization is now **branch-scoped, not layered**: `READY` requires `isAdminOrDispatcher()` — identical to today's live rule, no regression, any `admin`/`dispatcher` can still create it exactly as now. `NEEDS_PLANNING` requires `canSubmitManualZeroHistoryQuantity()` **alone** (which already includes the `admin` override internally) — an eligible Parts Manager/Warehouse Manager no longer needs to *also* hold a `dispatcher`/`admin` security role, matching the Architecture Decision's actual intent. `dispatcher` alone (no eligible `operationalRoles`, not `admin`) is still correctly denied for this path — it simply fails `canSubmitManualZeroHistoryQuantity()` directly now, rather than via an outer gate that also (incorrectly) blocked legitimate operational-role holders.
- `requestedQty`'s positivity requirement is now **branch-scoped**: `>= 0` for `READY` (matches `recommendedQty`'s own valid range, including the legitimate `0` case above), `> 0` for `NEEDS_PLANNING` (a manual entry must represent a real, meaningful request — there is no equivalent "the analytics engine legitimately computed zero" justification on the manual path).
- Per the Architecture Decision, rules are **not** expected to reproduce the analytics formula — no relationship check between `requestedQty` and `availableStock`/`reorderPoint`/anything computed. Only structural/authorization validity is enforced.
- No change to any existing `update` transition rule — `recommendedQty`'s immutability (line 295 today) is preserved unchanged; `recommendationStatus`, `requestedQty`, `quantitySource` join it as equally immutable after creation (none appears in any `update` branch's allowed `affectedKeys()`), consistent with "corrections use cancel-and-recreate."
- Requires the standard emulator Rules test pass before merge, per this repo's established Firestore Rules discipline (Sprint 2.1.4/2.1.10's REQUEST-CHANGES history) — implementation should add or extend a Rules test analogous to `functions/test/employeesRules.test.js`'s pattern (this repo's only existing precedent), covering at minimum: accept `READY` with `requestedQty: 0`; reject `NEEDS_PLANNING` with `requestedQty <= 0`; reject non-integer `requestedQty` on either path; reject a `READY` request with non-`ANALYTICS` `quantitySource`; reject a `NEEDS_PLANNING` request from a `dispatcher` with no `operationalRoles`; **accept a `NEEDS_PLANNING` request from a `technician` (or any non-admin/dispatcher security role) whose linked Employee has `operationalRoles: ["PARTS_MANAGER"]`** (the exact case Defect 2 broke — must be explicitly covered, not just the `admin`/`dispatcher` cases); accept a `NEEDS_PLANNING` request from `admin`.

### Deployment / rollout sequence

**New — added 2026-07-10 per ChatGPT's REQUEST CHANGES.** The corrected rule above is a real behavior change for the `create` path (previously: `isAdminOrDispatcher()` and nothing else; now: field-shape and branch-specific authorization required). Because `firestore.rules` deploy and the client (hosting) deploy are two separate, non-atomic steps in this repo's standing practice, naively deploying them in either order creates a real window:
- **Strict rules deployed before the new writer (PR 3) ships**: the *current, live* client still calls `createReorderRequest({ partId, urgency, recommendedQty })` — no `recommendationStatus`/`requestedQty`/`quantitySource` fields at all. The corrected rule's `recommendationStatus in [...]` check fails on a missing field, so **every reorder request creation breaks immediately** for every user, the moment rules deploy, until the new client also deploys.
- **New writer deployed before strict rules ship**: the live rules are still today's `allow create: if isAdminOrDispatcher();`, which has no field validation at all — it will happily accept the new-shaped documents, **but without enforcing `canSubmitManualZeroHistoryQuantity()`**. A `dispatcher` without an eligible `operationalRoles` entry could submit a `NEEDS_PLANNING` request during this window even though the UI attempts to hide the control from them (client-side gating is not the enforcement boundary, per this Specification's own "do not rely only on UI hiding" requirement) — a real, if temporary, authorization gap.

**Resolution — three-step expand/contract rollout, not a single rules swap:**
1. **Transitional rules** (ships with PR 2): accept **either** shape.
   ```
   allow create: if request.resource.data.keys().hasAny(["recommendationStatus"])
     ? ( /* the full corrected rule above, unchanged */ )
     : isAdminOrDispatcher();  // legacy shape -- byte-identical to today's live rule, TRANSITIONAL ONLY
   ```
   This is safe to deploy immediately: the current live client (legacy shape, no `recommendationStatus` key) continues to work exactly as it does today (falls into the `: isAdminOrDispatcher()` branch, unchanged behavior); a new client (once deployed) gets the full corrected validation.
2. **New writer ships** (PR 3, deployed after step 1's rules are confirmed live). From this point, all new writes use the new shape and are fully validated/authorized by the transitional rule's first branch.
3. **Tightening step** (a follow-up, rules-only change — either its own PR 4 or a documented manual rules edit, not bundled into PR 2 or PR 3): once verified no client is still sending the legacy shape (this is a single internal SPA with no long-tail mobile app-store version skew — practically, once step 2's hosting deploy is live and given this initiative has zero production consumers/real end users so far per the Assessment's own findings, the legacy path can be retired essentially immediately, but should still be an explicit, deliberate step, not assumed automatic), remove the `: isAdminOrDispatcher()` legacy branch entirely, leaving only the strict corrected rule. This closes the temporary authorization gap for good.

This sequencing is reflected in the Implementation Plan's PR breakdown (a new PR 4 for the tightening step) and Sequencing notes.

## UI impact

- "Needs Reorder" queue (`PartsList.jsx`) gains a `recommendationStatus === "NEEDS_PLANNING"` section, distinct from the existing `CRITICAL`/`HIGH` `ACTIONABLE_URGENCIES` set — exact placement (merged into one queue vs. a separate tab/section) is implementation-time, but must be visually distinguishable, not silently absent as it is today. `URGENCY_ORDER`-based sorting is unaffected; `NEEDS_PLANNING` records are grouped, not urgency-ranked.
- `InventoryHealthPanel.jsx`'s Avg Daily Usage / Recommended Reorder Qty columns keep PR #88's "Insufficient usage history" text for `NEEDS_PLANNING` rows (unchanged) — the fix already covers the display half; this sprint adds the classification/grouping and eligibility-gated manual entry PR #88 explicitly deferred.
- `PartDetail.jsx`'s Reorder Request review card needs new "Requested qty," "Recommendation status," and "Quantity source" rows alongside the existing "Recommended qty" row, since the values can now legitimately differ or be absent (`null`).
- New manual-quantity entry control on "Request Reorder," gated on `recommendationStatus === "NEEDS_PLANNING"` AND the current user's eligibility (client-side mirror of the rules check — the control should not even be offered to an ineligible user, consistent with "do not rely only on UI hiding" meaning rules enforcement is required, not that UI affordance-matching is prohibited).

## Testing strategy

- Unit-level (this repo's established no-framework pattern, inline Node assertion scripts, same as PR #85/#88's approach): `generateReplenishmentRecommendation()` returns `recommendationStatus: "NEEDS_PLANNING"`, `urgency: null`, `recommendedOrderQty: 0` when `!hasUsageHistory(usage)`; unchanged `recommendationStatus: "READY"` + existing `urgency` formula when usage history exists (regression coverage) — `URGENCY_ORDER`/`RiskLevel` values themselves get a regression check confirming no new member was added.
- Firestore Rules emulator test (new, extending the `employeesRules.test.js` pattern) for the `create` validation and role-eligibility scenarios described above.
- Manual/build verification: `npm run build` + `npm run lint` in `field-ops-app-vite/`, `npx tsc --noEmit` + `npm run build` in `functions/`, matching this repo's standing validation bar for every PR in this initiative.
- No emulator run of the full Reorder Request lifecycle is required unless the implementation PR's actual diff touches transition rules beyond `create` — scope this sprint intentionally avoids.

## Rollback strategy

Additive schema change (`recommendationStatus`, `requestedQty`, `quantitySource` new fields; `urgency` becomes nullable but no existing non-null value/meaning changes) — no existing field is removed or repurposed, no existing rule is loosened (the `READY` path's `isAdminOrDispatcher()` gate is unchanged; the new role check only narrows the new `NEEDS_PLANNING` path). Rollback is a straightforward revert of the implementation PR(s) plus a `firestore.rules` redeploy of the prior ruleset. Not irreversible. The one genuinely hard-to-reverse element is `firestore.rules`'s live deploy step itself (as with every rules change in this repo) — must be explicitly redeployed after merge, not assumed automatic (no CI auto-deploys, per this repo's own documented incident history).

## Acceptance criteria

- [ ] A part with zero `CONSUMED` history is classified `recommendationStatus: "NEEDS_PLANNING"`, `urgency: null` — never `"LOW"`.
- [ ] `RiskLevel`/`URGENCY_ORDER` are unchanged — no `NEEDS_PLANNING` (or any new) member added to either.
- [ ] `NEEDS_PLANNING` parts appear in a visibly distinct queue/section, not silently absent from "Needs Reorder."
- [ ] "Request Reorder" on a `NEEDS_PLANNING` part is only actionable for `admin`, or a user whose linked Employee has `operationalRoles` containing `PARTS_MANAGER` or `WAREHOUSE_MANAGER` — verified both in the UI (control not offered) and in `firestore.rules` (write rejected regardless of UI state).
- [ ] It is impossible to submit a `NEEDS_PLANNING` request with `requestedQty: 0`, a non-integer, or a negative number, through the UI or directly against `firestore.rules`. (A `READY` request with `requestedQty: 0` remains valid — it mirrors a legitimately-computed `recommendedQty: 0`, not a manual entry.)
- [ ] `firestore.rules` (both copies, identical) rejects: non-positive/non-integer `requestedQty` on the `NEEDS_PLANNING` path specifically; a negative or non-integer `requestedQty` on the `READY` path; a `NEEDS_PLANNING` submission from a `dispatcher` with no eligible `operationalRoles`; a `READY` submission with `quantitySource != "ANALYTICS"`. And **accepts**: a `READY` submission with `requestedQty: 0`; a `NEEDS_PLANNING` submission from a non-admin/dispatcher security role (e.g. `technician`) whose linked Employee has an eligible `operationalRoles` entry. All verified via an emulator Rules test.
- [ ] The rollout sequence (transitional rules → new writer → tightening step) is followed in order — the strict rules variant is never deployed before the new writer, and the transitional (legacy-shape-accepting) rule is never left in place indefinitely.
- [ ] `recommendedQty` is `null` for every `NEEDS_PLANNING` request and unchanged (existing computed number) for every `READY` request — no existing reader of `recommendedQty` breaks on the `READY` path.
- [ ] `requestedQty` is the field every downstream display (Parts Manager review, etc.) reads for the actionable quantity.
- [ ] Parts with existing usage history see zero behavior change — same one-click "Request Reorder," same `urgency` classification, same formulas, same `isAdminOrDispatcher()` gate.
- [ ] `npm run build`/`npm run lint` (field-ops-app-vite) and `npx tsc --noEmit`/`npm run build` (functions) all pass.
- [ ] Not deployed as part of implementation — deploy is a separate, explicit, Owner-authorized step per this repo's standing practice.

## Risks

- **Two-file rules edit risk**: both `firestore.rules` copies must be changed identically — this repo's established pattern, but a real diff-review risk if only one is edited.
- **`operationalRoles` is currently unpopulated for every real Employee** (PR #85 confirmed zero production consumers) — until an admin actually assigns `PARTS_MANAGER`/`WAREHOUSE_MANAGER` to at least one Employee (an operational task, out of scope here), only `admin` accounts can use the manual-entry path in practice. Not a code defect, but worth flagging so it isn't mistaken for a bug during verification.
- **`requestedQty`/`recommendationStatus` becoming a de facto required migration for any code that currently reads `recommendedQty`/`urgency` operationally** — the investigation above found at least one such read (`PartDetail.jsx`'s `ReorderRequestReview`); implementation must audit for others (Parts Manager assignment card, Purchase Order recording, any urgency-based sort/filter beyond `PartsList.jsx`'s `ACTIONABLE_URGENCIES`) rather than assuming that's the only one.
- **`urgency` becoming nullable is a type-widening change** — any existing code doing `recommendation.urgency.toLowerCase()` or similar without a null check (e.g. `InventoryHealthPanel.jsx`'s badge rendering: `fo-badge-${recommendation.urgency.toLowerCase()}`) will throw on a `NEEDS_PLANNING` record unless updated. Implementation must audit every `urgency` read, not just the ones already known from this investigation.
- **UI complexity of a blocking, role-gated manual-entry step** on what is today a one-click action for `READY` — needs to stay usable, not become a heavyweight form, while still clearly communicating *why* a given user can't submit (ineligible role) versus *how* to (needs a quantity).
- **Rollout sequencing risk**: the transitional rules variant (accepting both legacy and new shapes) must not be deployed and then forgotten — leaving it in place indefinitely means the `MANUAL_ZERO_HISTORY` authorization gap (any `admin`/`dispatcher` bypassing `canSubmitManualZeroHistoryQuantity()` via the legacy branch) never actually closes. The Implementation Plan's tightening-step PR must be tracked as a real, required deliverable, not an optional cleanup.

## Open questions

- Exact manual-quantity-entry UI shape (inline expand vs. modal) — implementation-time UI decision, not architecturally significant.
- Whether the Notification Panel (currently 4 sections, already flagged in `docs/CLAUDE_CONTEXT.md` as near its intended limit) needs a `NEEDS_PLANNING`-aware addition, or whether the "Needs Reorder" queue's own new section is sufficient — recommend deferring to a follow-up if it comes up, not expanding this sprint's scope.
- Whether `PARTS_ASSOCIATE` (an existing `REORDER_REQUEST_OWNER` value, distinct from the new `OPERATIONAL_ROLE` enum this sprint introduces) should ever gain manual-entry eligibility — not requested by the Architecture Decision, not assumed here; flagged only so a future reviewer doesn't read its absence as an oversight.

## Approval

**Approved by ChatGPT, 2026-07-10**, at commit `4bdf360ca01e657a220e8073e6e2822235218e6d` (PR #89), then **sent back to Draft the same day** when the Implementation Plan review (also 2026-07-10) surfaced two real defects in this Specification's own drafted rules logic that the Specification-stage review had not caught:
1. `requestedQty > 0` applied unconditionally would have broken the already-legitimate `recommendedQty: 0` case on the `READY` path (reachable today via `PartsList.jsx`'s `ALL` queue filter).
2. The `NEEDS_PLANNING` branch's authorization was incorrectly layered under the outer `isAdminOrDispatcher()` gate, which would have silently blocked every eligible Parts Manager/Warehouse Manager whose security role isn't also `admin`/`dispatcher` — defeating the entire operational-role path this Specification was written to enable.

Both fixed in the "Firestore Rules impact" section above (branch-scoped positivity, branch-scoped authorization), and a new "Deployment / rollout sequence" subsection added to address a third finding: a naive single-step rules swap would either break the legacy writer (strict rules first) or leave a temporary authorization gap (new writer first) — resolved via a three-step expand/contract rollout (transitional rules accepting both shapes → new writer ships → tightening step removes the legacy allowance).

Not yet re-approved — awaiting this round's review.
