---
artifact_type: assessment
gate: Repository Assessment
status: Architecture-Approved
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

# Assessment Report: Reorder recommendation and Request Reorder behavior when a part has no CONSUMED usage history

**Business Request:** Follow-up from PR #88 (merged, presentational-only fix). PR #88 corrected the *display* of a misleading "0" recommended-reorder quantity to "Insufficient usage history," but explicitly deferred the underlying business decision per instruction not to invent a reorder quantity or business rule without approval. This assessment scopes that deferred decision. Per Owner direction, this is a separate inventory-planning concern and must NOT be folded into the Parts and Purchase Order Assignment Adoption initiative.

## Scope of this assessment

Inspected: the full reorder-recommendation calculation path (`domain/inventoryAnalyticsEngine.ts`, mirrored in `functions/src/inventoryAnalyticsService.ts`), its three UI consumers (`InventoryHealthPanel.jsx`, `PartDetail.jsx`, `PartsList.jsx`'s "Needs Reorder" queue), the Reorder Request write path (`domain/inventoryReorderRequests.js`'s `createReorderRequest()`), and the relevant `firestore.rules` `reorder_requests` match block. Also inspected `data/partsCatalog.ts` for any existing catalog-level reorder metadata.

Not inspected / explicitly out of scope: the Parts and Purchase Order Assignment Adoption sprint (separate initiative, not yet specified), Supplier/Procurement (`purchase_orders`, Epic 5), and any live Firestore data (no production read performed — this assessment is code/rules-derived only, per standing instruction not to touch production data).

## Current repository state

**Why every part with no usage history collapses to the same broken state** (`domain/inventoryAnalyticsEngine.ts:82-159`, mirrored server-side in `functions/src/inventoryAnalyticsService.ts`):

- `calculateUsageRate()` only counts `type: "CONSUMED"` ledger transactions within a 30-day window. The sole writer of `CONSUMED` entries is `functions/src/inventoryService.ts`'s `triggerInventoryEffects()`, invoked only from the `transitionWorkOrder` Cloud Function — and Cloud Functions have never been deployed to production (blocked on the Firebase Blaze plan upgrade, issue #15, an existing documented standing decision). So `avgDailyUsage = 0` today for every part, unconditionally — not a per-part data gap.
- `calculateReorderPoint()`: `reorderPoint = avgDailyUsage * leadTimeDays + avgDailyUsage * safetyFactor` → `0` whenever `avgDailyUsage = 0`.
- `generateReplenishmentRecommendation()`: `recommendedOrderQty = Math.max(reorderPoint * 2 - availableStock, 0)` → `0` whenever `reorderPoint = 0`, **regardless of `availableStock`** — including a literal stockout (`availableStock = 0`).
- **Urgency is also degraded, not just the quantity** (new finding, not covered by PR #88): `urgency = CRITICAL` only if `availableStock <= reorderPoint * 0.5` (`= 0`), i.e. only at `availableStock <= 0` exactly. `HIGH` requires `availableStock <= reorderPoint` (`= 0`) — same condition, so `HIGH` is mathematically unreachable whenever there's no usage history; a part only ever jumps straight from `LOW` to `CRITICAL`, never through `HIGH`. `MEDIUM` requires `daysRemaining < 14`, but `daysRemaining` is forced to `Infinity` whenever `avgDailyUsage = 0`, so `MEDIUM` is also unreachable. **Net effect: any part with zero usage history and `availableStock > 0` is always classified `LOW`, no matter how low the actual stock is (e.g. 1 unit left).**
- `PartsList.jsx`'s "Needs Reorder" queue (`ACTIONABLE_URGENCIES = new Set(["CRITICAL", "HIGH"])`, line 98) filters on urgency. Because `HIGH` is unreachable and `LOW` is the default, **a genuinely low-stock part with no usage history will not appear in the actionable queue at all** unless it's already at zero. This is a visibility gap on top of the quantity/urgency defect PR #88 addressed.

**An unused catalog field already exists that's relevant to any fallback model** (new finding): `data/partsCatalog.ts` defines a static `reorderThreshold: number` per part (e.g. `TST-1001: reorderThreshold: 1`), currently displayed read-only in `PartDetail.jsx` ("Reorder threshold (catalog)" row) but **never consumed by `inventoryAnalyticsEngine.ts` or any urgency/quantity calculation**. It is dead data as far as the recommendation engine is concerned. Any manager-entered or catalog-based fallback model should account for whether this field is the intended input or a separate, unrelated concept.

**Write path and data-contract state** (`domain/inventoryReorderRequests.js:35-40`, `firestore.rules:197-211`):

- `createReorderRequest({ partId, urgency, recommendedQty })` writes `recommendedQty` as given by the caller — `PartsList.jsx` passes `Math.ceil(recommendation.recommendedOrderQty)` unconditionally, so a zero-history part currently submits `recommendedQty: 0` into a real, persisted Reorder Request document today, unchanged by PR #88.
- `firestore.rules`'s `reorder_requests` `allow create: if isAdminOrDispatcher();` (line 199) has **no field-level validation on create at all** — no schema/range check on `recommendedQty`, `urgency`, or `partId` at creation time. Any future minimum-quantity rule would need to be added here if it's to be enforced server-side, not just client-side.
- `recommendedQty` is immutable after creation (`firestore.rules:295`, part of the "core identity fields are immutable" invariant) — so a later correction to a bad `recommendedQty` is not a supported operation today; it would require either a new immutable-field exception or a different remediation path (e.g. cancel-and-recreate).

## Affected files

| File | Current role | Why it's affected |
|---|---|---|
| `field-ops-app-vite/src/domain/inventoryAnalyticsEngine.ts` | Client analytics engine: `calculateUsageRate`, `calculateReorderPoint`, `generateReplenishmentRecommendation`, `hasUsageHistory` (added PR #88) | Any fallback demand model or urgency change lands here |
| `functions/src/inventoryAnalyticsService.ts` | Server mirror of the above, authoritative per its own header comment | Must stay in sync with any client-side formula change |
| `field-ops-app-vite/src/modules/inventory/PartsList.jsx` | "Needs Reorder" queue (`ACTIONABLE_URGENCIES` filter), `handleRequestReorder()` → `createReorderRequest()` | Queue visibility gap; is where a manual-quantity-entry requirement or a blocked-submission rule would be implemented |
| `field-ops-app-vite/src/domain/inventoryReorderRequests.js` | `createReorderRequest()` — the only writer of `reorder_requests` | Would need a new required parameter (e.g. `manualQty`) if manual entry is approved |
| `firestore.rules` (`reorder_requests` match block, lines 197-211) | `create` rule, currently unvalidated; `recommendedQty` pinned immutable at line 295 | Any server-enforced minimum/validation or any change to what's immutable requires a rules change, which needs deploy + emulator test per this repo's standing Firestore Rules discipline |
| `field-ops-app-vite/src/data/partsCatalog.ts` | Static catalog with an existing, currently-unused `reorderThreshold` field | Candidate governed-fallback input if a catalog-based model is chosen |
| `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` | Displays `reorderThreshold` read-only; would show any new fallback/manual-entry UI | UI surface for whatever model is approved |

## Dependencies

- Blocked, not just related: the actual root cause (zero `CONSUMED` transactions) is not fixable by any UI or rules change — it requires Cloud Functions deployment, which is blocked on the Firebase Blaze billing decision (issue #15). Any fallback model approved here is a mitigation for that blocked state, not a replacement for eventually deploying Cloud Functions.
- Sprint 2.1.6's original "manual-uid Reorder Request assignment" backlog item (already resolved at the model level via Employee Foundation) is unrelated — this is a separate, quantity/urgency concern, not an identity/assignment one.
- Whatever is decided here is a prerequisite-in-spirit, but not a hard blocker, for the Parts and Purchase Order Assignment Adoption sprint — per Owner instruction, keep these two initiatives separate; do not let this assessment's scope creep into that one.

## Risks

- **Silent under-ordering risk today, independent of any fix**: a part can sit at 1 unit of stock with zero usage history and never surface in the actionable queue, never get flagged above `LOW`, and if manually requested still submits `recommendedQty: 0` — a real operational gap that predates PR #88 and is not resolved by it.
- **Immutability conflict**: `recommendedQty`'s current rules-level immutability means any "manager can correct a bad recommendation after the fact" flow is not a small change — it either needs a new rules exception (weakens an existing invariant) or a cancel/recreate flow (new UX).
- **Client-authored quantities remain fundamentally unvalidated server-side** regardless of what fallback model is chosen, unless the `create` rule itself gains validation — a governance gap this assessment surfaces but does not resolve.
- **Divergence risk between client/server mirrors**: `inventoryAnalyticsEngine.ts` and `functions/src/inventoryAnalyticsService.ts` must be changed together; the existing header comment already flags server-as-authoritative, but there's no automated check enforcing they stay in sync.

## Implementation options

Not deciding here — listed for Architecture Review, per this assessment's boundary:

1. **Block "Request Reorder" when usage history is insufficient**, forcing manual quantity entry instead. Simplest to reason about, but changes existing UX (currently a one-click action) and touches `createReorderRequest()`'s required parameters.
2. **Require manual quantity entry only when insufficient**, otherwise keep the existing one-click flow. Smaller UX change, but means `createReorderRequest()` needs an optional/conditional manual-quantity path — more branching logic.
3. **Catalog-based fallback (`reorderThreshold`)**: use the already-existing but currently-unused catalog field as a governed minimum when no usage history exists. Reuses existing data, but that field's current values (e.g. `reorderThreshold: 1`) were set for unknown purposes/at an unknown time and may not reflect real business intent for this use — would need explicit re-validation, not just re-purposing.
4. **Manager-entered per-part minimum-stock override**, stored where (catalog vs. a new collection) is itself an open design question, plus who is authorized to set it and whether it needs its own rules/audit trail.
5. **No fallback quantity at all — always "Insufficient usage history," always require a human decision.** Safest from a "don't invent a number" standpoint (consistent with PR #88's posture), but leaves the "Needs Reorder" queue visibility gap unresolved unless urgency classification is separately fixed to not require usage data to detect a low raw stock count.

Recommendation for Architecture Review's consideration only (not a decision): option 5's urgency-visibility half (flag low `availableStock` independent of usage data) seems separable from the quantity question and could be resolved without inventing any quantity — but that's an architectural call, not this assessment's to make.

## Estimated PR count

Likely 2, pending Architecture Review's decision: (1) urgency/queue-visibility fix (if approved as separable from the quantity question), (2) whatever fallback-quantity/manual-entry model is approved, which likely touches `createReorderRequest()`, `PartsList.jsx`'s submit flow, and `firestore.rules` together (rules changes in this repo have consistently required their own dedicated review round per `docs/CLAUDE_CONTEXT.md`'s Sprint 2.1.x history). Could be 1 PR if scope stays UI+domain-only with rules changes deferred.

## Open questions for Architecture Review

1. Should "Request Reorder" be blocked, allowed with a warning, or require manual quantity entry when usage history is insufficient?
2. Should a minimum-stock/fallback model exist at all, or should the platform always require a human-entered quantity when there's no consumption data (i.e. never compute a fallback number)?
3. If a fallback model is approved, what should it be based on: the existing (currently unused, unvalidated) `reorderThreshold` catalog field, a new manager-entered per-part minimum, or something else?
4. Should urgency classification be fixed to detect low raw `availableStock` even without usage history (separable from the quantity question), so the "Needs Reorder" queue doesn't silently exclude genuinely low-stock, zero-history parts?
5. Is `recommendedQty`'s current rules-level immutability still correct once a fallback/manual-entry model exists, or does that model need a correction path?
6. Should `firestore.rules`'s `reorder_requests` `create` rule gain server-side validation on `recommendedQty` (currently none exists), independent of which client-side model is chosen?
7. Given Cloud Functions deployment remains blocked (issue #15), should this fallback model be treated as permanent product behavior or an explicitly temporary mitigation to be revisited once Cloud Functions deploy and real `CONSUMED` data starts flowing?

## Architecture Decision (2026-07-10)

Approved. Answers to the seven open questions above, in order:

1. **Request Reorder remains available, but requires a manager-entered positive quantity when usage history is insufficient.** Never submit `0`.
2. **No automatic fallback quantity is calculated yet.** The manual-entry requirement in (1) is the entire near-term behavior — no formula fills the gap.
3. **Do not reuse `data/partsCatalog.ts`'s existing `reorderThreshold` field.** Future fallback planning will use new, governed, manager-maintained minimum-stock and target-stock values instead — `reorderThreshold`'s current values are unreviewed and not to be repurposed as-is.
4. **Yes — urgency is fixed, decoupled from usage history — REVISED 2026-07-10 per ChatGPT's Specification-stage REQUEST CHANGES.** "Needs planning" describes *recommendation readiness*, not *inventory risk*, and must not be a value inside the `RiskLevel`/`urgency` enum alongside `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` — mixing the two concepts was flagged as an architectural error during Specification review. Corrected model: a separate `recommendationStatus` field (`READY` | `NEEDS_PLANNING`), orthogonal to `urgency`. `urgency` remains exactly `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` and is `null` when `recommendationStatus == NEEDS_PLANNING` (there is no risk classification to report when nothing was computed). The queue may group `NEEDS_PLANNING` records into their own visible section, but `URGENCY_ORDER` (or any risk-ranking construct) stays limited to actual risk values — zero-history parts are not ranked by pretend risk, they're grouped by pretend readiness.
5. **`recommendedQty` remains an immutable historical snapshot, unchanged.** The actual manager-entered/requested quantity is stored as a **separate, distinct field** (`requestedQty`) — not by relaxing `recommendedQty`'s immutability. Corrections use **cancel-and-recreate**, not editing an existing request. **Clarified 2026-07-10**: for zero-history requests, `recommendedQty` is stored as `null` (not `0`) — "nothing was computed" is a distinct fact from "zero was computed," and `null` matches this codebase's existing convention for not-yet-applicable fields (e.g. `assignedToUserId`, `purchaseOrderId` default `null`). For analytics-backed requests, `recommendedQty` is unchanged (the computed number, `0` is a legitimate computed value in that case).
6. **Yes — `firestore.rules`'s `reorder_requests` `create` rule must validate create-time schema, allowed values, and that the submitted quantity is a positive whole number.** Rules are explicitly **not** expected to reproduce the analytics formula — only to reject structurally invalid submissions (non-positive, non-integer, wrong type, disallowed `urgency`/`recommendationStatus` values).
7. **Permanent hybrid product behavior, not a temporary mitigation**, structured as three tiers:
   - Usage analytics (existing `calculateUsageRate`/`generateReplenishmentRecommendation` path) when reliable history exists — `recommendationStatus: READY`.
   - Governed stocking policy (new minimum-stock/target-stock values, per (3)) when configured — not built this sprint (see Specification's "Explicitly out of scope").
   - Manual manager-entered quantity for exceptions or when no policy is configured — `recommendationStatus: NEEDS_PLANNING`.
8. **NEW — Manual quantity entry eligibility, added 2026-07-10 per ChatGPT's Specification-stage REQUEST CHANGES** ("manager-entered" was ambiguous — this repo has two separate role systems: `ROLES` (`admin`/`dispatcher`/`technician`, security/application access, `users/{uid}.role`) and Employee `operationalRoles[]` (Employee Foundation Phase 3, workforce/domain roles, currently **entirely unpopulated in production** — PR #85 confirmed zero production consumers of `requiredOperationalRole` exist yet). Decision:
   - Eligible **operational roles**: `PARTS_MANAGER`, `WAREHOUSE_MANAGER`. **`WAREHOUSE_MANAGER` does not exist as a concept anywhere in this codebase today** — this decision is what establishes it. `PARTS_MANAGER` already exists as a string, but only as a `REORDER_REQUEST_OWNER` value (`currentOwner`, role-level) — it has never been used as an Employee `operationalRoles[]` entry; using it as one now is a new, additional meaning for the same string, not a reuse of existing enforced behavior.
   - Firestore Rules must enforce this via the authenticated User → Employee relationship (`users/{uid}.employeeId` → `employees/{employeeId}.operationalRoles`), **not UI hiding alone**.
   - Existing `admin` access remains a valid override (unchanged from today's `isAdminOrDispatcher()` gate).
   - `dispatcher` alone does **not** grant manual-quantity-entry authority — this is a **narrowing** of today's `reorder_requests` `create` rule (currently any `admin`/`dispatcher` may create any Reorder Request unconditionally) specifically for the `MANUAL_ZERO_HISTORY` path. The existing analytics-backed (`READY`) create path is unchanged — still gated by `isAdminOrDispatcher()` only, no regression there.
9. **NEW — Audit field, added 2026-07-10**: `quantitySource` (`ANALYTICS` | `MANUAL_ZERO_HISTORY`), immutable, recorded at creation, so every Reorder Request's `requestedQty` origin is auditable independent of `recommendationStatus`/`urgency`.

**Final per-path contract** (supersedes the informal "0 or null, choose one" framing from the original Specification round):

| Field | Analytics-backed (`READY`) | Zero-history (`NEEDS_PLANNING`) |
|---|---|---|
| `recommendationStatus` | `READY` | `NEEDS_PLANNING` |
| `urgency` | `LOW`\|`MEDIUM`\|`HIGH`\|`CRITICAL` (existing formula, unchanged) | `null` |
| `recommendedQty` | existing computed number (unchanged, `0` is a valid computed value) | `null` |
| `requestedQty` | `= recommendedQty` at creation time | manager-entered positive whole number |
| `quantitySource` | `ANALYTICS` | `MANUAL_ZERO_HISTORY` |

This decision set is the input to the Specification (`docs/specifications/inventory-zero-history-reorder-behavior.md`) — implementation does not begin from this assessment alone.
