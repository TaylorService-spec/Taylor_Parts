---
artifact_type: assessment
gate: Repository Assessment
status: Repository Assessment
date: 2026-07-14
owner: Claude Code
related_adrs: [docs/architecture/ADR-003-inventory-trigger-system.md]
depends_on: []
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release: Not yet scheduled -- Architecture Review decision required first
---

# Assessment Report: Inventory Action Log's Role -- Remain Prominent, Relocate, or Replace with Future Receiving-to-Ledger Capability

**Business Request:** Issue #152. Recorded by the Owner during PR #151 (Cancel/Void UI) post-merge production smoke check, explicitly deferred out of that PR's scope: *"Create a dedicated Assessment issue... Do not change or remove it inside the Cancel/Void initiative."* The question, verbatim from the issue: now that the Cancel/Void UI has added more state/cards to `PartDetail.jsx`, and given the standing Blaze-blocked backlog item to eventually apply Inventory Actions to `inventory_transactions` through a trusted Cloud-Function-mediated write path, should the Inventory Action Log (1) remain as-is, prominently placed, (2) be relocated/de-emphasized, or (3) be replaced once the future receiving-to-ledger capability ships?

## Scope of this assessment

Covers the Inventory Action Log card (`InventoryActionsPanel`, `field-ops-app-vite/src/modules/inventory/PartDetail.jsx`), its data layer (`domain/inventoryActions.js`, the `inventory_actions` collection), its authorization (`firestore.rules`), and its relationship to `inventory_transactions`, Reorder Requests, receiving, and Cancel/Void. No code, Rules, Specification, Implementation Plan, deployment, or production-data change is made or authorized by this document -- read-only investigation only, per the issue's own instruction and this project's standing Repository Assessment gate.

**Explicitly out of scope, confirmed no dependency in either direction:**
- **Issue #100** (Inventory nav/role access) -- remains paused at its own production-authorization gate. This assessment does not reopen, extend, or depend on it, though §7 below notes one concrete coordination point with its still-Draft, unapproved Specification.
- **Issue #182** (Truck Parts Sale-to-Invoice and Inventory Consumption) -- a structurally separate, Work-Order-scoped capability. See §8 below for the explicit boundary.
- Any Cancel/Void behavior itself (PR #151, merged and deployed) -- not reopened, not revisited.
- The Inventory Operational Queue's own visibility/filter questions (Issue #154, `docs/assessments/inventory-operational-queue.md`) -- that assessment already flagged the Inventory Action Log as "a related but separate product finding," explicitly deferred to this issue. This document is that deferred assessment.

## Current repository state

### 1. Current behavior, storage, authorization, users, placement, and audit-note-only semantics

**Placement.** `InventoryActionsPanel` (`PartDetail.jsx:1109-1226`, mounted at `PartDetail.jsx:1439`) is the **fifth of six cards**, top to bottom, on the Part detail page:

1. Header (part name/SKU/category/unit)
2. Conditional Reorder Request status card (whichever of eight statuses currently applies -- Pending Review through Received, including the Cancel/Void terminal cards)
3. "Catalog" card
4. "Stock Position & Reorder Status" card
5. **"Inventory Action Log" card**
6. "Recent Transactions" card (the real ledger, reads `inventory_transactions`)

The Inventory Action Log sits directly above the real ledger's own read-only display -- two activity-shaped lists, one above the other, that differ in real operational effect but not in visual weight or card styling.

**What an operator does.** The card exposes a form (`PartDetail.jsx:1144-1191`): an action-type selector ("Stock Received (log only)" / "Stock Adjustment (log only)" / "Correction Note (log only)" -- every option's label itself appends "(log only)"), a required numeric "Quantity for this note (not applied to stock)" field, and a reason/notes pair required only for Correct Mistake. Submitting calls `recordInventoryAction()` and the entry appears in a "Recent Logged Actions" table (most recent 10) with a `"Qty (logged, not applied)"` column header.

**Audit-note-only semantics -- stated three separate times on this one card:**
- Directly under the card heading (`PartDetail.jsx:1141`): *"This records an audit note only. It does not update stock yet."*
- Above the recent-actions table (`:1194`): *"Audit notes only -- none of these have been applied to stock."*
- The quantity field's own label (`:1158`): *"Quantity for this note (not applied to stock)"*.

This wording is not incidental -- the header comment above the component (`PartDetail.jsx:95-101`) records that it exists **because** an earlier version didn't say this clearly enough: *"per ChatGPT's PR #76 review, this card and its UI copy are deliberately explicit that these are audit notes, not live inventory adjustments."* Sprint 2.1.9 shipped this way on purpose, already once corrected for exactly the ambiguity this Assessment's §3 revisits.

**Storage.** `recordInventoryAction()` (`domain/inventoryActions.js:38-65`) writes one document per submission to the `inventory_actions` collection: `{ partId, transactionType, quantityDelta, reason, notes, createdBy, createdAt }`. The collection is append-only by design -- no update or delete path exists in the domain layer or in Rules (`allow update, delete: if false`, `firestore.rules:975`); correcting a mistake means logging a new Correction Note, never editing history.

**Authorization** (`firestore.rules:972-976`):

```
match /inventory_actions/{actionId} {
  allow read: if isAdminOrDispatcher() || isActiveOperationalRole("WAREHOUSE_MANAGER");
  allow create: if isAdminOrDispatcher();
  allow update, delete: if false;
}
```

Create is `admin`/`dispatcher` only. Read was widened to include `WAREHOUSE_MANAGER` under Issue #100 PR 2a -- but see §6 below: no UI surface today actually reaches that grant.

**Who can reach the card at all.** `/inventory` (the route hosting `PartDetail.jsx`) is nav-gated to `admin`/`dispatcher` only (`ROLE_NAV_ACCESS`, `domain/constants.js:300-302`) -- no operational role (`PARTS_MANAGER`, `WAREHOUSE_MANAGER`, `PARTS_ASSOCIATE`) can navigate to this page today, independent of the Rules grant above. `InventoryActionsPanel` itself has no internal role check (unlike, e.g., `CancelReorderRequestAction`, which checks `user.uid === assignedToUserId`) -- it renders unconditionally for whoever reaches the page, which today means admin/dispatcher only. The Rules-level read grant to `WAREHOUSE_MANAGER` and the route-level admin/dispatcher gate are therefore currently consistent by omission (no live gap), not by design coordination -- see §6.

### 2. Relationship to `inventory_actions`, `inventory_transactions`, Reorder Requests, receiving, Cancel/Void, and the future trusted receiving-to-ledger path

**`inventory_transactions` is a completely separate object, never touched by this feature.** `firestore.rules:315-320` denies all client writes unconditionally (`allow create, update, delete: if false`); it is populated exclusively by `functions/src/transitionWorkOrder.ts`'s Cloud Function trigger (`docs/architecture/ADR-003-inventory-trigger-system.md`). `recordInventoryAction()`'s own header comment (`domain/inventoryActions.js:5-18`) states this is deliberate: not "a modification of `inventory_transactions`," which "remains Admin-SDK-only/Work-Order-driven and completely untouched."

**Reorder Requests and receiving never call `recordInventoryAction()` either.** `receiveReorderRequest()` (`domain/inventoryReorderRequests.js:263-269`, the "Mark Received" action) writes only `{ status: RECEIVED, receivedAt, receivedBy }` to the `reorder_requests` document -- its own comment (`:254-262`) is explicit: *"Deliberately a status-closeout note only -- does NOT call `recordInventoryAction()`... or touch `inventory_transactions`... in any way."* The "Mark Received" card carries its own, separately-worded disclaimer (`PartDetail.jsx:856`): *"This records that the parts arrived and closes out this Reorder Request. It does not update stock yet -- stock reconciliation against this receipt is a separate, not-yet-built step."* Two different cards, two different objects, two independently-worded "does not update stock" disclaimers, describing two structurally unrelated no-op-on-stock behaviors -- see §3.

**Cancel/Void (PR #151) is likewise unconnected.** Neither `CancelReorderRequestAction` nor `VoidPurchaseOrderAction` reference `inventory_actions` or `inventory_transactions` anywhere in their write paths -- Cancel writes only `reorder_requests` status fields; Void writes `reorder_requests` status fields plus a new, separate `reorder_purchase_order_voids` audit record (`docs/BusinessEntityModel.md` §4b), an append-only pattern structurally identical in spirit to `inventory_actions` itself (both exist "solely to prove an event happened," per that section's own text) but entirely independent of it -- no cross-reference, no shared collection, no shared write path.

**The future trusted receiving-to-ledger path.** `docs/BusinessEntityModel.md` Section 4a records the standing backlog item, quoted in full:

> *"Backlog note (not yet scoped): apply Inventory Actions to `inventory_transactions` through a Cloud-Function-mediated trusted write path once Firebase Blaze is enabled. Direct client writes to `inventory_transactions` must never be added (it stays Admin-SDK-only, per ADR-003) -- a trusted server-side write (mirroring `functions/src/inventoryService.ts`'s `reserveParts`/`releaseParts`/`consumeParts`) is the only sanctioned way to make these actions actually move stock. This is blocked on the platform's standing decision not to enable Blaze yet..., not on anything Sprint 2.1.9 could have built differently."*

This item is **not scoped** -- there is no target release, no design for how "apply Inventory Actions to the ledger" would actually reconcile against real Work-Order-driven `RESERVED`/`RELEASED`/`CONSUMED` entries, and no committed timeline, because it is entirely blocked on enabling Firebase Blaze (Issue #15), a standing platform decision this Assessment does not revisit. Reorder Request receiving's own stock reconciliation is recorded as a **separate**, similarly Blaze-blocked, not-yet-built step (§ above) -- the two "does not update stock yet" gaps (Inventory Action Log, and Reorder Request receiving) are not the same gap and are not guaranteed to close the same way or on the same schedule, even though both are blocked on the same underlying platform dependency.

### 3. Whether current prominence could mislead users into believing it changes stock

**Text: no.** Every disclaimer is unambiguous, appears at three separate points on the one card, and this exact ambiguity was already caught and corrected once (PR #76 review, Sprint 2.1.9's own history) -- there is no reasonable reading of the current copy that claims a stock effect.

**Structure and placement: a real, if softer, risk remains.** Three factors compound, independent of wording:

1. **Visual parity with cards that do drive real workflow.** The Inventory Action Log renders as the same kind of card, in the same visual register, as the Reorder Request/Purchasing/Cancel/Void cards immediately above it -- all of which represent real, consequential state transitions. A user scanning the page by shape and position, not by reading every disclaimer in full, has no structural cue (heading level, color, icon, section boundary) that this card is categorically different in kind (a note-taking tool) from its neighbors (a workflow engine).
2. **Direct adjacency to the real ledger.** It sits immediately above "Recent Transactions" -- the actual `inventory_transactions` read. Two lists that look alike, stacked back to back, one of which is real and one of which is not, is a plausible source of exactly the confusion Issue #152 asks about, even with correct per-card copy.
3. **Terminology collision with "Mark Received."** The Inventory Action Log's own "Stock Received (log only)" option and the Reorder Request lifecycle's "Mark Received" action describe two different objects (`inventory_actions` vs. `reorder_requests`) using nearly the same words, on the same page, in adjacent cards. Neither changes stock today -- but an operator who has just used one is primed to assume the other behaves the same way, in either direction, which is a naming problem independent of, and not resolved by, either card's own disclaimer text.

**Conclusion for this item:** the wording is not misleading; the page's structural presentation, adjacency, and naming overlap create a real but moderate risk that a user forms an incorrect operational mental model, especially under time pressure or with partial attention -- exactly the condition disclaimers are weakest against. This is the concrete, evidence-based basis for §5's recommendation.

## 4. Overlap, gaps, audit value, and operational risk across the four options

| | **Remain prominent (status quo)** | **Relocate / de-emphasize** | **Retain temporarily, then replace/absorb** | **Retain permanently alongside stock-moving receiving** |
|---|---|---|---|---|
| **Overlap with `inventory_transactions`** | Visual overlap (adjacent, similar card shape) without functional overlap -- confirmed zero shared code path (§2). | Same zero functional overlap; visual overlap reduced by separating the two lists structurally. | Overlap intentionally collapses to one system once/if the trusted write path ships -- but "once/if" is unscoped (§2), so this column describes a future state with no committed date. | Overlap persists indefinitely by design: two permanently separate concepts (audit note vs. ledger entry) that happen to describe the same physical event (a stock change) through two different objects. |
| **Overlap with Reorder Request receiving** | Both are "does not update stock yet" gaps on the same page, independently worded, independently timed (§2, §3) -- no coordination between them today. | Unchanged relationship; de-emphasis doesn't resolve or worsen the underlying dual-gap fact. | If receiving's own reconciliation ships first (or together), "Receive Stock (log only)" as an Inventory Action Log entry type becomes redundant with a real, stock-moving "Mark Received" -- a genuine absorption candidate, not merely a coincidence of naming. | The naming collision (§3, point 3) persists permanently unless deliberately renamed -- see §6. |
| **Gaps** | No structural distinction from workflow cards (§3). No deep-history view beyond "recent 10" (§6). WAREHOUSE_MANAGER's Rules-level read grant has no UI surface (§6). | Same underlying gaps (history depth, WAREHOUSE_MANAGER surface) remain -- de-emphasis is a placement change only, not a capability change. | Gaps persist until the (unscoped) replacement ships; no interim mitigation unless combined with relocation. | Gaps persist permanently unless separately addressed -- "retain forever, unchanged" does not imply "gaps close themselves." |
| **Audit value today** | High and immediate -- the only mechanism in the app for a human note about a stock event of any kind, right now, with zero platform dependency (no Blaze, no Cloud Function). | Identical audit value -- relocation does not remove or degrade the underlying append-only record; only its on-page prominence changes. | Audit value is preserved until replacement, then depends entirely on the unscoped future design retaining an equivalent (or superior) note-taking capability -- not guaranteed by the backlog note's current wording, which describes *applying* actions to the ledger, not *preserving* free-text audit notes once that happens. | Audit value is explicitly preserved forever by construction -- the only option that treats "human note, independent of stock-moving mechanics" as a permanent product need rather than a bridge. |
| **Operational risk** | Moderate, ongoing (§3) -- every day this page is used, the structural-confusion risk recurs; unmitigated by this option. | Low -- addresses the concrete risk in §3 directly, with no functional/data-layer change, hence minimal implementation risk (UI-only). | Risk shifts from "confusion today" to "possible loss of a still-valuable note-taking capability" if the future design assumes replacement means removal rather than convergence -- a risk created by an unscoped future decision, not by this option itself. | Risk is that "permanently alongside" is adopted by default (because it's the path of least resistance) rather than by deliberate Owner/Architecture decision once the real shape of the trusted write path is known -- premature permanence, not wrong permanence. |

## 5. Recommended product shape, rationale, sequencing, rollback boundaries, and decisions required before Specification

**Recommended shape (for Architecture Review, not a decision):** relocate/de-emphasize now; do not replace, absorb, or commit to permanence yet.

**Rationale.**
- §3 established a concrete, evidence-based risk (structural/adjacency/naming, not wording) that a UI-only change can address directly, today, with no dependency on Blaze, Issue #15, or any unscoped future design.
- §2 and §4 established that "replace" has no scoped target to replace *into* -- the backlog note is explicitly "not yet scoped." Committing to replacement now would mean designing against an unknown future shape.
- §4's audit-value analysis found no evidence that the Inventory Action Log's free-text note-taking value is subsumed by a future stock-moving receiving path -- "Adjust Stock" and "Correct Mistake" describe corrections and adjustments that a trusted, structured ledger write may never fully capture in free-text form (a damaged-goods write-off with a human explanation is a different kind of record than a validated `CONSUMED` ledger entry). "Retain permanently" may turn out to be correct, but that is a decision to make once the trusted write path's actual shape is known, not now, by default.
- De-emphasis is safe to do independent of, and without blocking or being blocked by, the Blaze/Issue #15 dependency -- it requires no schema, Rules, or write-path change at all.

**Sequencing.**
1. This Assessment (no code).
2. Owner/Architecture Review decides the exact de-emphasis treatment (§ "Decisions required," below) and confirms or revises "not permanence yet."
3. A future Specification (separate gate, not authorized here) implements the approved placement change -- UI-only, `PartDetail.jsx` and possibly a shared collapsible-section component if one doesn't already exist.
4. The "replace/absorb vs. retain permanently" decision is revisited **only once** Issue #15 (Blaze) is resolved and the trusted receiving-to-ledger path has an actual scoped design -- not before, and not assumed by this Assessment.

**Rollback boundaries.** The recommended change is UI-only: no Firestore Rules change, no schema change, no data migration, no write-path change. A relocation/de-emphasis PR is a pure frontend change to `PartDetail.jsx` (and possibly a new or reused collapsible-section component) -- fully reversible by reverting that one PR, with zero data-layer consequence in either direction. This is the safest possible rollback profile available among the four options in §4: "replace/absorb" and "retain permanently" both carry decisions that are far more costly to reverse once a future Specification builds against them.

**Decisions required before a future Specification (Owner/Architecture Review, not resolved here):**
1. **Exact de-emphasis treatment.** Options observed elsewhere in this codebase's own conventions: move the card below "Recent Transactions" (last, not fifth-of-six); collapse it into a closed-by-default expandable section; or move it into a separate, secondary tab/area off the main lifecycle-card stack. This Assessment does not select among these -- it is a UI/UX call, not an architectural one.
2. **"Receive Stock (log only)" naming.** Given §3's point 3, should this action-type label be renamed to reduce collision with "Mark Received" independent of any ledger-write-path decision? This is available today, has zero platform dependency, and directly reduces the concrete risk §3 identifies.
3. **WAREHOUSE_MANAGER create capability.** Today WAREHOUSE_MANAGER can read `inventory_actions` (Rules) but cannot create an entry, and no UI reaches even the read grant (§6). Is admin/dispatcher-only create a permanent, intentional scope boundary, or should it be revisited alongside relocation?
4. **Coordination with the pending, unapproved `inventory-nav-access-alignment` Specification.** That Draft Specification (§7) already plans to reuse `useInventoryActionsForPart()`'s query shape "as-is" for a new, separate, read-only WAREHOUSE_MANAGER "Part Activity" panel elsewhere in the app -- explicitly stating "no redesign of that collection or its write path." Any future Specification for this Assessment's recommendation must confirm it does not disturb that already-planned reuse, or must coordinate the two efforts if it does.
5. **Deep-history access.** Today's "Recent Logged Actions" table shows only the most recent 10 entries per part; the underlying data is fully retained (append-only, never deleted) but has no dedicated full-history view. Is this a gap worth closing now, independent of the placement decision, or deferred?

## 6. Accessibility, human-facing naming, audit-history retention, and role visibility

**Accessibility.** The quantity field uses an associated `<label htmlFor="inventory-action-qty">` (`PartDetail.jsx:1158`) -- a correct basic pattern. This Assessment did not perform a runtime accessibility audit (keyboard navigation, screen-reader behavior, color contrast) -- consistent with its own "no code change, read-only investigation" boundary, this is recorded as **not verified**, not as a pass, and should be confirmed as part of any future Implementation Plan's own verification requirements, not assumed here.

**Human-facing naming.** §3's finding stands as the concrete naming issue: "Stock Received (log only)" (an `inventory_actions` entry) and "Mark Received" (a `reorder_requests` status transition) name two unrelated objects with near-identical language on the same page. §5 records this as an available, low-risk, zero-dependency improvement independent of the placement decision.

**Audit-history retention.** The underlying `inventory_actions` collection is genuinely permanent -- `allow update, delete: if false` at the Rules layer means no client, including admin, can ever alter or remove a logged entry; correcting a mistake is recorded as a new entry, never an edit. This is a real, durable audit trail today, regardless of the placement/prominence decision. The **display** of that trail is limited to the 10 most recent entries per part (§5, decision 5) -- a UI limitation, not a data-retention gap.

**Role visibility, precisely.** Three independent layers, currently consistent by omission rather than by explicit design coordination:
- **Route/nav:** admin/dispatcher only reach `PartDetail.jsx` at all (`ROLE_NAV_ACCESS`) -- no operational role can navigate here today.
- **Component:** `InventoryActionsPanel` has no internal role check of its own -- it renders for whoever reaches the page.
- **Rules:** create is admin/dispatcher only; read additionally includes `isActiveOperationalRole("WAREHOUSE_MANAGER")` (Issue #100 PR 2a) -- a grant with **no corresponding UI surface today**. The still-Draft, unapproved `inventory-nav-access-alignment` Specification (§7) plans to give WAREHOUSE_MANAGER a route to this data, but explicitly through a **new, separate, read-only** "Part Activity" panel -- not this card, and not write access. If that Specification is later approved and implemented, the Rules grant and a real UI surface become consistent for the first time; until then, the grant exists without an operator-facing path to use it.

## 7. Explicit separation from Issue #182's truck-sale workflow

Issue #182, **"Truck Parts Sale-to-Invoice and Inventory Consumption,"** is a structurally separate, Work-Order-scoped capability: a Technician recording parts consumed/sold from their own assigned truck stock directly into a Work Order's invoice, via a QR-scanned opaque identifier resolved server-side, through a mandatory trusted Cloud-Function-mediated writer -- blocked on Issue #15 (the same Blaze/deployed-execution-substrate dependency §2's backlog note is blocked on, but a structurally different feature with a different trigger, different actor (Technician, not admin/dispatcher/Warehouse Manager), and different destination object (a Work Order invoice, not `inventory_actions` or a general ledger entry)). No collection, Rules, Cloud Function, or UI is authorized for it yet (Issue #182's own body: *"Assessment-only tracking issue. No implementation authorized here."*).

This Assessment makes **no scope claim, no dependency, and no design decision** touching Issue #182 in either direction. The only structural relationship between the two is that both are, independently, downstream of the same platform gate (Issue #15/Blaze) before either can gain a trusted server-side write path -- that shared dependency does not make them the same initiative, does not imply a shared timeline, and does not imply either should be designed with the other in mind. This mirrors the boundary already recorded in `docs/specifications/inventory-nav-access-alignment.md` (line 63): *"The Truck Parts Sale-to-Invoice initiative (Issue #182). Structurally separate, no dependency in either direction."*

## Affected files (for a future Specification; unchanged by this assessment)

| File | Current role | Why it's relevant |
|---|---|---|
| `field-ops-app-vite/src/modules/inventory/PartDetail.jsx` | Renders `InventoryActionsPanel` as the 5th of 6 lifecycle cards | Central file for any placement/relocation/de-emphasis change; also owns the "Mark Received" card whose naming (§3, §6) would need to change together with any Inventory Action Log rename |
| `field-ops-app-vite/src/domain/inventoryActions.js` | Sole write path for `inventory_actions`, `recordInventoryAction()` | Unaffected by relocation; would be affected only by a future action-type rename (§5, decision 2) or a future trusted-ledger-write redesign (out of scope until Issue #15 resolves) |
| `field-ops-app-vite/src/hooks/useInventoryActions.js` | `useInventoryActionsForPart()`, realtime query for a part's logged actions | Already planned for reuse "as-is" by the still-Draft `inventory-nav-access-alignment` Specification's WAREHOUSE_MANAGER Part Activity panel (§5, decision 4) -- any redesign here must coordinate with that plan |
| `firestore.rules` (`inventory_actions` match block) | Admin/dispatcher create, admin/dispatcher + WAREHOUSE_MANAGER read | Unaffected by a placement-only change; would be affected only by decision 3 (WAREHOUSE_MANAGER create) if adopted |
| `docs/BusinessEntityModel.md` Section 4a | Authoritative schema/backlog reference for `inventory_actions` | Would need a changelog entry documenting whichever placement/naming decision is approved |

## Dependencies

- **Issue #100** -- paused at its own production-authorization gate; not reopened, not extended, no code dependency. One documentation coordination point noted (§5, decision 4; §6) with its still-Draft, unapproved `inventory-nav-access-alignment` Specification, which already plans to reuse this feature's existing query shape as-is.
- **Issue #182** -- explicitly separate (§7), no dependency in either direction.
- **Issue #15 (Firebase Blaze)** -- the platform gate blocking any future trusted receiving-to-ledger write path (§2, §4); this Assessment's recommendation (§5) is deliberately structured to require no dependency on Issue #15's resolution.
- **PR #151 (Cancel/Void)** -- merged and deployed; the originating context for Issue #152, not reopened or revisited here.

## Risks

- **Adopting "retain permanently" or "replace" by default, absent an explicit Architecture Review decision, forecloses options prematurely.** §5 recommends against committing to either until the trusted write path's actual shape is known.
- **A future de-emphasis Specification could, if implemented carelessly, also collapse the underlying data access** (e.g. lazy-loading the panel's data only on expand) in a way that changes read/query timing for WAREHOUSE_MANAGER's Rules grant or the pending Part Activity panel reuse (§5, decision 4) -- the future Specification must confirm any lazy-loading/collapse mechanism is presentation-only and does not alter `useInventoryActionsForPart()`'s query contract.
- **Renaming "Receive Stock (log only)" (§5, decision 2) without also revisiting "Mark Received"'s own copy** could shift, rather than resolve, the naming-collision risk identified in §3 -- any future naming change should treat both cards' copy as one coordinated decision, not two independent edits.

## Open questions for Architecture Review

1. Which exact de-emphasis treatment (§5, decision 1) -- moved lower, collapsed section, or separate tab/area?
2. Approve, defer, or reject the "Receive Stock (log only)" naming change (§5, decision 2; §6)?
3. Is admin/dispatcher-only create for `inventory_actions` a permanent scope boundary, or should WAREHOUSE_MANAGER (or another operational role) gain create capability (§5, decision 3)?
4. Confirm the recommended relocation must not disturb the still-Draft `inventory-nav-access-alignment` Specification's planned reuse of `useInventoryActionsForPart()` (§5, decision 4) -- or, if that Specification is itself revised first, resequence accordingly.
5. Is deep-history access (beyond the current 10-most-recent display) worth a dedicated future Specification item now, or deferred indefinitely (§5, decision 5)?
6. Confirmed out of scope for this Assessment, restated for Architecture Review's own record: no decision on the eventual shape of the trusted receiving-to-ledger write path itself (§2, §4) -- that remains genuinely unscoped, blocked on Issue #15, and is not this Assessment's question to answer.
