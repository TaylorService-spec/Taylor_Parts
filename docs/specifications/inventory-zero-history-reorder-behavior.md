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

# Sprint Specification: Zero-history reorder behavior (manager-entered quantity, Needs Planning state, governed stocking policy foundation)

**Architecture Review:** `docs/assessments/inventory-zero-history-reorder-behavior.md`'s "Architecture Decision" section — Approved 2026-07-10.

## Executive summary

When a part has no `CONSUMED` ledger history, `avgDailyUsage`/`reorderPoint`/`recommendedOrderQty` are all `0` and urgency collapses to `LOW` regardless of actual stock (root-caused in the linked assessment: Cloud Functions, the sole writer of `CONSUMED` entries, are not deployed to production). PR #88 already fixed the *display* of this (shows "Insufficient usage history" instead of a bare `0`) without changing any underlying value or write behavior. This sprint implements the approved permanent, three-tier model: usage analytics when reliable history exists, a governed stocking policy when configured, and a manager-entered quantity for everything else — plus a distinct `NEEDS_PLANNING` classification so zero-history parts stop being silently invisible in the "Needs Reorder" queue.

## Sprint objective

A part with no usage history:
1. Is classified `NEEDS_PLANNING`, never `LOW`, and appears in a distinct queue/section a manager can actually see.
2. Can still be reorder-requested, but only with a manager-entered positive whole-number quantity — never a submitted `0`.
3. Has that manager-entered quantity stored as its own field, distinct from `recommendedQty`, which remains an immutable historical snapshot of what the analytics engine (or governed policy) actually computed at request time (`0`/`null`, honestly, when there was nothing to compute).
4. Is validated server-side: `firestore.rules` rejects a non-positive or non-integer submitted quantity at create time, independent of whatever the client computed.

This sprint does **not** build a governed stocking-policy UI or storage model (minimum-stock/target-stock values) — it lays the schema/classification groundwork (tier 2 of the hybrid model is a reserved, not-yet-configurable no-op in this sprint; see "Explicitly out of scope").

## Scope

- `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` — add `NEEDS_PLANNING` to the risk/urgency model; `generateReplenishmentRecommendation()` returns it instead of computing `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` when `!hasUsageHistory(usage)` and no governed policy is configured (policy lookup itself is out of scope — always absent this sprint, so this path is unconditional for now).
- `functions/src/inventoryAnalyticsService.ts` — mirrored change, kept in sync per the file's own "authoritative" convention.
- `field-ops-app-vite/src/modules/inventory/PartsList.jsx` — "Needs Reorder" queue gains a `NEEDS_PLANNING` section/filter, separate from `ACTIONABLE_URGENCIES` (`CRITICAL`/`HIGH`); `handleRequestReorder()` requires a manager-entered quantity when `recommendation.urgency === "NEEDS_PLANNING"` instead of auto-submitting `Math.ceil(recommendation.recommendedOrderQty)`.
- `field-ops-app-vite/src/modules/operations/panels/InventoryHealthPanel.jsx` — display/sort awareness of `NEEDS_PLANNING` (new `URGENCY_ORDER` entry).
- `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` — same manual-quantity entry path as `PartsList.jsx` for the per-part "Request Reorder" action.
- `field-ops-app-vite/src/domain/inventoryReorderRequests.js` — `createReorderRequest()` gains a new required field for the actual submitted quantity, distinct from `recommendedQty`.
- `firestore.rules` (both copies: `/firestore.rules` and `/field-ops-app-vite/firestore.rules`, kept identical per existing convention) — `reorder_requests` `create` rule gains schema/type/positivity validation.
- `docs/BusinessEntityModel.md` — Reorder Request field list update (new field), per this repo's standing convention of keeping that doc as the schema reference.

## Explicitly out of scope

- Any governed minimum-stock/target-stock policy UI, storage model, or admin workflow (tier 2 of the hybrid model). This sprint only ensures tier 2's *absence* is handled safely (falls through to `NEEDS_PLANNING` + manual entry) — it does not build tier 2 itself. A future sprint, separately specified.
- Re-evaluating or migrating `data/partsCatalog.ts`'s existing `reorderThreshold` field. Per the Architecture Decision, it is explicitly not reused as-is; any future migration is its own decision.
- Parts and Purchase Order Assignment Adoption (separate initiative, kept apart per Owner instruction).
- The broader governed Part and Inventory Administration initiative (per Owner instruction, kept separate).
- Any correction/edit flow for an existing Reorder Request's quantity. Per the Architecture Decision, corrections are cancel-and-recreate — no new "edit" capability, no new mutable window on `recommendedQty` or the new manager-quantity field.
- Actually deploying Cloud Functions or generating real `CONSUMED` data (blocked on the Blaze plan decision, issue #15 — unrelated to this sprint).
- Any change to `urgency`'s meaning or thresholds for parts that DO have usage history — `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` and their existing formulas are unchanged for that case.

## Technical design

**New risk/urgency value** (`domain/inventoryAnalyticsEngine.ts` and `functions/src/inventoryAnalyticsService.ts`):
```
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "NEEDS_PLANNING";
```
`generateReplenishmentRecommendation()`: if `!hasUsageHistory(usage)` (existing PR #88 helper), set `urgency = "NEEDS_PLANNING"` and `recommendedOrderQty = 0` (unchanged value — still an honest "nothing computed," now correctly labeled rather than mislabeled `LOW`). The existing `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` branch only runs when `hasUsageHistory(usage)` is true. `URGENCY_ORDER` gains `NEEDS_PLANNING` — proposed ordering `{ CRITICAL: 0, HIGH: 1, NEEDS_PLANNING: 2, MEDIUM: 3, LOW: 4 }` (ranked above `MEDIUM`/`LOW` since "we don't know" warrants attention sooner than "known low risk," but below confirmed `CRITICAL`/`HIGH`) — final ordering is an implementation-time UI call, not re-litigated here.

**Reorder Request schema addition** (`domain/inventoryReorderRequests.js`, `docs/BusinessEntityModel.md`):
- New field: `requestedQty: number` — the actual quantity a human is requesting, always present, always the number used for downstream purchasing. Populated from `recommendation.recommendedOrderQty` when usage history exists (today's behavior, unchanged), or from manager manual entry when `urgency === "NEEDS_PLANNING"`.
- `recommendedQty` is **unchanged in meaning**: the analytics engine's own output at request time, `0` when nothing could be computed — kept purely as the immutable historical snapshot the Architecture Decision calls for. Downstream consumers (Parts Manager review, Purchase Order recording) should read `requestedQty`, not `recommendedQty`, for the actual actionable number — this sprint must audit and update any existing read of `recommendedQty` used for an operational (not historical/audit) purpose. (Investigation found `PartDetail.jsx`'s `ReorderRequestReview` currently displays `request.recommendedQty` as "Recommended qty" — this becomes a display of the historical snapshot; `requestedQty` needs its own row, labeled distinctly, e.g. "Requested qty.")
- `createReorderRequest({ partId, urgency, recommendedQty, requestedQty })` — `requestedQty` becomes a new required parameter, always sent by both call sites (`PartsList.jsx`, `PartDetail.jsx`).

**Manual quantity entry UX** (`PartsList.jsx`, `PartDetail.jsx`):
- When `recommendation.urgency === "NEEDS_PLANNING"`, "Request Reorder" opens a quantity input (positive whole number, client-side validated before submit) instead of submitting immediately. When usage history exists, today's one-click behavior is unchanged.
- Exact component structure (inline form vs. modal) is an implementation-time UI decision, not specified here.

## Firestore Rules impact

Both copies (`/firestore.rules`, `/field-ops-app-vite/firestore.rules` — kept identical, existing convention) need the `reorder_requests` `create` rule (currently `allow create: if isAdminOrDispatcher();`, no field validation at all) extended with:
- `request.resource.data.requestedQty is int && request.resource.data.requestedQty > 0` — the positive-whole-number requirement from the Architecture Decision, enforced server-side, not just client-side.
- `request.resource.data.urgency in ["LOW", "MEDIUM", "HIGH", "CRITICAL", "NEEDS_PLANNING"]` — allowed-value validation (currently absent).
- `request.resource.data.partId is string && request.resource.data.partId.size() > 0` — basic shape validation (currently absent).
- Per the Architecture Decision, rules are **not** expected to reproduce the analytics formula — `recommendedQty` itself gets a type check (`is number`) but no relationship check against `requestedQty`, `availableStock`, or anything computed. The two numbers are allowed to differ freely (that's the entire point of `requestedQty` existing).
- No change to any existing `update` transition rule — `recommendedQty`'s immutability (line 295 today) is preserved unchanged, and `requestedQty` joins it as equally immutable after creation (consistent with "corrections use cancel-and-recreate," not partial edits).
- Requires the standard emulator Rules test pass before merge, per this repo's established Firestore Rules discipline (Sprint 2.1.4/2.1.10's REQUEST-CHANGES history) — implementation should add or extend a Rules test analogous to `functions/test/employeesRules.test.js`'s pattern (this repo's only existing precedent), covering: reject `requestedQty <= 0`, reject non-integer `requestedQty`, reject disallowed `urgency`, accept a valid `NEEDS_PLANNING` request.

## UI impact

- "Needs Reorder" queue (`PartsList.jsx`) gains a `NEEDS_PLANNING` section/filter, distinct from the existing `CRITICAL`/`HIGH` actionable set — exact placement (merged into one queue vs. a separate tab/section) is implementation-time, but must be visually distinguishable, not silently absent as it is today.
- `InventoryHealthPanel.jsx`'s Avg Daily Usage / Recommended Reorder Qty columns keep PR #88's "Insufficient usage history" text for `NEEDS_PLANNING` rows (unchanged) — the fix already covers the display half; this sprint adds the classification and queue-visibility half PR #88 explicitly deferred.
- `PartDetail.jsx`'s Reorder Request review card needs a new "Requested qty" row alongside the existing "Recommended qty" row, since the two can now legitimately differ.
- New manual-quantity entry control on "Request Reorder," gated on `urgency === "NEEDS_PLANNING"`.

## Testing strategy

- Unit-level (this repo's established no-framework pattern, inline Node assertion scripts, same as PR #85/#88's approach): `generateReplenishmentRecommendation()` returns `NEEDS_PLANNING` + `recommendedOrderQty: 0` when `!hasUsageHistory(usage)`; unchanged `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` behavior when usage history exists (regression coverage).
- Firestore Rules emulator test (new, extending the `employeesRules.test.js` pattern) for the `create` validation described above.
- Manual/build verification: `npm run build` + `npm run lint` in `field-ops-app-vite/`, `npx tsc --noEmit` + `npm run build` in `functions/`, matching this repo's standing validation bar for every PR in this initiative.
- No emulator run of the full Reorder Request lifecycle is required unless the implementation PR's actual diff touches transition rules beyond `create` — scope this sprint intentionally avoids.

## Rollback strategy

Additive schema change (`requestedQty` new field, `NEEDS_PLANNING` new enum value) — no existing field is removed or repurposed, no existing rule is loosened. Rollback is a straightforward revert of the implementation PR(s) plus a `firestore.rules` redeploy of the prior ruleset. Not irreversible. The one genuinely hard-to-reverse element is `firestore.rules`'s live deploy step itself (as with every rules change in this repo) — must be explicitly redeployed after merge, not assumed automatic (no CI auto-deploys, per this repo's own documented incident history).

## Acceptance criteria

- [ ] A part with zero `CONSUMED` history is classified `urgency: "NEEDS_PLANNING"`, never `LOW`.
- [ ] `NEEDS_PLANNING` parts appear in a visibly distinct queue/section, not silently absent from "Needs Reorder."
- [ ] "Request Reorder" on a `NEEDS_PLANNING` part requires a manager-entered positive whole-number quantity before submission; it is impossible to submit `requestedQty: 0` or a non-integer through the UI.
- [ ] `firestore.rules` (both copies, identical) rejects a `create` with `requestedQty <= 0` or non-integer, verified via an emulator Rules test.
- [ ] `recommendedQty` is unchanged in meaning and value from today (still the raw analytics output, `0` when nothing computed) — no existing reader of `recommendedQty` is broken.
- [ ] `requestedQty` is the field any new/updated downstream display (Parts Manager review, etc.) reads for the actionable quantity.
- [ ] Parts with existing usage history see zero behavior change — same one-click "Request Reorder," same `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` classification, same formulas.
- [ ] `npm run build`/`npm run lint` (field-ops-app-vite) and `npx tsc --noEmit`/`npm run build` (functions) all pass.
- [ ] Not deployed as part of implementation — deploy is a separate, explicit, Owner-authorized step per this repo's standing practice.

## Risks

- **Two-file rules edit risk**: both `firestore.rules` copies must be changed identically — this repo's established pattern, but a real diff-review risk if only one is edited.
- **`requestedQty` becoming a de facto required migration for any code that currently reads `recommendedQty` operationally** — the investigation above found at least one such read (`PartDetail.jsx`'s `ReorderRequestReview`); implementation must audit for others (Parts Manager assignment card, Purchase Order recording) rather than assuming `PartDetail.jsx` is the only one.
- **UI complexity of a blocking manual-entry step** on what is today a one-click action — needs to stay usable, not become a heavyweight form for what may often be a small, obvious quantity.
- **`NEEDS_PLANNING`'s position in `URGENCY_ORDER`** is a genuine UX judgment call (proposed above, not locked) — could reasonably be argued either above or below `MEDIUM`; worth a quick confirm at implementation time rather than treating this spec's ordering as final.

## Open questions

- Exact `NEEDS_PLANNING` ranking within `URGENCY_ORDER` (proposed above, not locked).
- Exact manual-quantity-entry UI shape (inline expand vs. modal) — implementation-time UI decision, not architecturally significant.
- Whether the Notification Panel (currently 4 sections, already flagged in `docs/CLAUDE_CONTEXT.md` as near its intended limit) needs a `NEEDS_PLANNING`-aware addition, or whether the "Needs Reorder" queue's own new section is sufficient — recommend deferring to a follow-up if it comes up, not expanding this sprint's scope.

## Approval

Pending ChatGPT review of this Specification (this is a Specification artifact awaiting that gate — not yet approved for implementation).
