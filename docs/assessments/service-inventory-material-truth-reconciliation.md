# Service ↔ Inventory — Material Truth Reconciliation (Assessment)

**Status:** Assessment (repository-truth-first). No code changed. No universal procurement state proposed.
**Question:** five inventory/material surfaces appear to disagree — trace each to its authority and classify the
disagreement before touching any UI number.

## TL;DR

**There is no single number in conflict.** The five surfaces are backed by **two independent authorities** and
represent **legitimately different concepts**. The real problems are (1) a **shared "needs/attention"
vocabulary** that makes distinct concepts read as one, and (2) the **absence of any reconciliation view**
linking a live reorder *recommendation* to the durable reorder *request* it spawned. Do **not** unify them into
one procurement state; do **not** make the numbers match.

## The two authorities (verified)

| Authority | Collection | Nature | Read path |
|---|---|---|---|
| **Inventory ledger** | `inventory_transactions` | Live-recomputed forecast every load | `services/operationsQueries.ts` (Operations) **and** `hooks/useInventoryLedger.js` (Parts) — two independent one-shot reads |
| **Reorder workflow** | `reorder_requests` | Durable workflow documents with their own lifecycle | `hooks/useReorderRequests.js` realtime `onSnapshot`, shared across surfaces 2/3/4 |

A reorder **request** *originates from* a **recommendation** — `domain/reorderRequestPayload.js`
`buildReorderRequestFields({ recommendationStatus, recommendedQty, … })` **snapshots** those at creation
(status starts `PENDING_REVIEW`). After that the request lives its own life; **nothing reconciles it back to the
ledger** — the recommendation engine (`domain/inventoryAnalyticsEngine.ts`, `procurementDraftEngine.ts`,
`ProcurementPanel.jsx`) never reads `reorder_requests`, and no path retires a request when the ledger's live
recommendation for that part later clears.

## Per-surface trace

| # | Surface | Authority | Projection | Status semantics | Concept |
|---|---|---|---|---|---|
| 1 | Operations Overview — "nothing currently needs reordering" | `inventory_transactions` (live) | `generateInventoryHealthDashboard` → filter `recommendedOrderQty>0` → `generateProcurementDrafts` (`Operations.jsx:126-149`) | CRITICAL/HIGH/MED/LOW by `availableStock` vs `reorderPoint`/days-cover (`inventoryAnalyticsEngine.ts:180`) | **REORDER_RECOMMENDATION** (explicitly "proposals only") |
| 2 | Purchasing — "Needs attention → PRT-1001" | `reorder_requests` + `reorder_purchase_orders` | `buildPurchaseOrdersView` (`domain/purchaseOrdersView.js`) | `ORPHAN` = request says `ORDERED` but its PO doc is missing/unreadable — a **data-integrity** subcase, not a stock/risk level | **PURCHASING_ACTION** (integrity exception) |
| 3 | Inventory Parts queue — "Assigned work → PRT-1006" | `reorder_requests` | status filter `[ASSIGNED_TO_PARTS_ASSOCIATE, PURCHASING_IN_PROGRESS]` (`PartsList.jsx`) | "assigned" = request handed to a Parts Associate (workflow stage) | **WORK_ASSIGNMENT** |
| 4 | Notifications — "PRT-1003 pending review" | `reorder_requests` | raw `status == PENDING_REVIEW` list (`NotificationPanel.jsx`) | awaiting human review (workflow stage); the urgency shown is a creation-time snapshot field, not recomputed | **NOTIFICATION** |
| 5 | Inventory "Critical & High (0)" | `inventory_transactions` (live) | same `generateInventoryHealthDashboard` as #1, filtered `urgency ∈ {CRITICAL,HIGH}` (`PartsList.jsx:470`) | identical thresholds to #1 | **REORDER_RECOMMENDATION** (severity-filtered) |

## Classification of the "contradictions"

| Pair | Verdict | Why |
|---|---|---|
| **1 vs 5** | **Consistent** (not a conflict) — minor freshness smell | Same collection, **same computation**; they agree by construction. The only risk is **transient drift**: two *independent* one-shot ledger reads with no shared cache. |
| **1/5 vs 2/3/4** | **LEGITIMATELY_DIFFERENT_CONCEPTS** | Live recommendation (ledger) vs durable workflow request (`reorder_requests`). "Nothing needs reordering" (recommendation cleared) **legitimately coexists** with open requests PRT-1001/1003/1006 (created earlier, still moving through review/assignment/order). Neither is wrong; nothing links them. |
| **2 vs 3 vs 4** | **TERMINOLOGY_PROBLEM** | Same `reorder_requests` collection, three different `status` values presented under three different attention-flavored labels ("Needs attention" / "Assigned work" / "pending review"). Expected state-machine diversity, not disagreement. |

**Not found:** no fixture inconsistency (the `demo/InventoryContext.jsx` seed layer is a separate demo path none
of these five read — all five are governed live Firestore). No real authority conflict. PR #673 (`fd213a6`)
touches the Warehouse *reconciliation* panel only, unrelated to these surfaces.

## Root cause

1. **Shared vocabulary collapses distinct concepts.** "needs reordering", "needs attention", "assigned work",
   "pending review" all read as one "attention" bucket, so a recommendation, a purchasing integrity exception, a
   work assignment, and a notification look like they should agree on one number. They shouldn't.
2. **No reconciliation view.** Recommendation (ledger) and request (workflow) are linked only at request
   *creation*; there is no read that shows, per part, *both* the live recommendation *and* any open request — so
   their legitimate coexistence looks like a contradiction.

## Recommendations (ranked; repository-truth-first)

1. **Terminology separation (highest value, lowest risk — presentation only).** Label each concept for what it
   *is*: recommendation surfaces → "Reorder recommendation (live forecast)"; request surfaces → "Purchasing
   requests" with the **status named** (Pending review / Assigned / Ordered / **needs attention = integrity
   exception**). No authority change, no number change. *(Panel labels/subtitles are Design-safe; any nav/route
   restructuring is UX-owned — see below.)*
2. **Reconciliation READ — a projection, NOT a new authority (assess, then build).** Per part, cross-reference
   `{live recommendation}` × `{open reorder_requests}` so coexistence is explained ("no live recommendation; 1
   open request PENDING_REVIEW"). Pure projection over the two existing authorities — no universal procurement
   state, no request auto-retire.
3. **Single ledger read for surfaces 1 & 5 (freshness).** They compute the same thing from two independent
   one-shot reads; sharing one read removes transient drift. Small, optional refactor.
4. **Name the integrity exception.** ORPHAN (request `ORDERED`, PO doc missing) is a genuine integrity signal
   currently shown under a generic "Needs attention" — surface it explicitly as an integrity/exception state,
   distinct from stock attention.

## Do NOT

- Invent a universal "procurement state" to make the surfaces agree.
- Make the UI numbers match — they are measuring different things.
- Auto-retire a `reorder_request` when the recommendation clears — that is a **workflow-authority** decision
  (a business rule about request lifecycle), not a UI reconciliation, and would need its own governed decision.

## Boundary

Terminology/label clarity on existing inventory panels is Design-safe and repo-only. The **reconciliation
projection** (rec 2) is a buildable next increment (projection over existing authorities). Anything that
restructures navigation, retires routes, or consolidates the inventory/purchasing IA is **UX-owned** and waits
on UX evidence. Nothing here needs a capability grant, callable deploy, or Rules change.
