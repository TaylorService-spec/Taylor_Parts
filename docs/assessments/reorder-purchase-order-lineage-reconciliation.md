---
artifact_type: assessment
gate: Repository Assessment — Workstream 2 pre-implementation
status: Draft
date: 2026-08-30
owner: Claude Code
related_adrs: []
depends_on: [docs/assessments/eos-ownership-model-reconciliation.md]
implements: []
supersedes: []
superseded_by: []
related_pr:
target_release:
---

# Reorder Request → Purchase Order lineage — measured reconciliation

Owner ruling R-13 asked four questions before any creation-path change. **Nothing was implemented.**
No schema write, no sandbox mutation, no Rules change, no deploy.

## 1 — Can one PO contain more than one request?

**No. One PO is exactly one request, enforced by DOCUMENT IDENTITY.**

The PO's document id **is** the reorder request's id (`match /reorder_purchase_orders/{requestId}`),
and the create rule additionally pins `reorderRequestId == requestId`. The document is immutable
(`allow update, delete: if false`).

`functions/src/purchasing/purchaseOrderNormalization.ts` states the consequence outright: *"a
multi-line PO spanning three parts has no single reorder request to be named after."* One PO also
carries exactly one `partId`, pinned equal to the request's.

**Consequence for R-13:** the mixed-company PO case the ruling guards against **cannot arise** in
this collection. `resolvePurchaseOrderCompany()` — written inert for exactly that risk — has no
reachable multi-request input here. It remains correct and unused, and should be kept for the
separate multi-line `purchase_orders` collection, not this one.

## 2 — Where is the lineage stored?

| | |
|---|---|
| **Collections** | `reorder_requests` ↔ `reorder_purchase_orders` |
| **Forward** | `reorder_requests.purchaseOrderId` |
| **Reverse** | `reorder_purchase_orders.reorderRequestId`, **plus the document id itself** |
| **Cardinality** | strictly **1:1** |
| **Authoritative?** | **Authoritative**, and enforced atomically |
| **Both directions?** | **Yes** — and they are pinned equal to each other and to the id |

Authority is unusually strong: the create rule uses `existsAfter`/`getAfter`, so the PO create and
the request's transition to `ORDERED` must land **in the same commit**. Neither can exist without
the other, and the request's `purchaseOrderId` must equal the PO's id in that same post-state.

## 3 — Can a PO exist with no originating request?

Three different answers, and they disagree — which is the finding.

| Layer | Answer |
|---|---|
| **Schema/Rules** | **No.** Create requires the request to exist, to be `PURCHASING_IN_PROGRESS`, and the caller to be its `assignedToUserId`. |
| **Trusted command** | **No such command exists.** There is no callable that creates a reorder PO. The write path is the CLIENT, through Rules. |
| **Sandbox data** | **YES — one orphan exists.** |

**`ro-sbx-005` is an orphan.** Its `reorderRequestId` is `ro-sbx-005`, and no request with that id
exists. It is `VOIDED`, seeded directly by `functions/scripts/seedSandboxTransactional.js:518` via
the Admin SDK, which bypasses Rules.

Two further Rules divergences in the same seeded data, all three POs:
- they carry **`supplierId`**, which the create allowlist does **not** permit;
- they carry **no `supplierName`**, which the create rule **requires**.

So all three sandbox POs are shapes the governed client path could not have produced. They are
fixture artefacts, not evidence about the live contract.

## 4 — Where does supplier selection sit?

**ON THE PO ONLY, and strictly AFTER request selection.**

The trusted sequence, as actually implemented:

1. a reorder request is raised — it has **no supplier field at all** (confirmed: 0 of 6 sandbox
   requests carry one, and the request's Rules-pinned shape has none);
2. it is reviewed, approved, assigned, and moved to `PURCHASING_IN_PROGRESS`;
3. **only then** may its assignee create the PO, supplying `supplierName` as **free text**;
4. the request flips to `ORDERED` in that same commit.

**Supplier does not drive grouping, because there is no grouping.** One request produces one PO.
Supplier is a downstream attribute of the PO, chosen after the request already exists.

Supplier *identity* is a live seam: `supplierMaster/reorderPurchaseOrderSupplierCompatibility.ts`
derives a governed `supplierId` from the free-text name but explicitly **does not persist it** —
writing it needs a protected Rules update first, which has not happened. The `supplierId` values in
sandbox data were seeded around that boundary, not written through it.

## Measured sandbox state

**6 requests · 3 POs.**

| PO | request id | id == requestId | request exists | supplierId | supplierName | warehouse |
|---|---|---|---|---|---|---|
| `ro-sbx-001` | `ro-sbx-001` | yes | yes | `sup-arcticparts` | — | — |
| `ro-sbx-005` | `ro-sbx-005` | yes | **NO — orphan** | `sup-coldchain` | — | — |
| `ro-sbx-006` | `ro-sbx-006` | yes | yes | `sup-coldchain` | — | — |

| Request | PO | status | supplierId | warehouseId |
|---|---|---|---|---|
| `eA7o3t8DyUXmtg8MCKjT` | — | PENDING_REVIEW | — | — |
| `ro-sbx-001` | `ro-sbx-001` | ORDERED | — | — |
| `ro-sbx-002` | — | PENDING_REVIEW | — | — |
| `ro-sbx-003` | — | PURCHASING_IN_PROGRESS | — | — |
| `ro-sbx-004` | — | REJECTED | — | — |
| `ro-sbx-006` | `ro-sbx-006` | ORDERED | — | — |

- requests linked to **zero** POs: **4** (`eA7o3t8DyUXmtg8MCKjT`, `ro-sbx-002`, `ro-sbx-003`, `ro-sbx-004`) — all legitimately pre-`ORDERED`
- requests linked to **more than one** PO: **0**
- POs whose request does not exist: **1** (`ro-sbx-005`)
- forward/reverse disagreement among linked pairs: **0**
- `supplierId` on requests: **0 of 6** · on POs: **3 of 3**
- `warehouseId` / any location field: **0 of 6 requests, 0 of 3 POs**

## What this means for R-13

**Confirmed by measurement:**
- warehouse is absent on both sides — the domain correction R-13 identifies is real;
- request → PO company inheritance is **1:1 and unambiguous**, so a request that carries a company
  gives its PO exactly one company with no grouping question.

**Needs Owner refinement before implementation:**

1. **The mixed-company PO rule has no reachable input here.** R-13 requires refusing a PO combining
   companies; identity makes that impossible for `reorder_purchase_orders`. Confirm the rule is
   intended for the separate multi-line `purchase_orders` collection, and that `reorder_purchase_orders`
   simply inherits its single request's company.

2. **The orphan (`ro-sbx-005`).** It can never inherit a company — there is no request to inherit
   from. It is a seeded fixture that violates the live create contract. Options: leave unresolved
   (consistent with every other protected record), or correct the seed so the fixture stops
   contradicting Rules. **No inference is available and none was invented.**

3. **The client is the writer.** There is no trusted command to add `warehouseId` resolution to.
   Adding a required field and a governed company derivation means either a **Rules change** (Tier 2,
   and the create allowlist is `hasOnly`, so any new field needs it) or introducing a trusted
   callable where none exists today. R-13 said "implement company consistency at the narrowest
   trusted authority" — measured, that authority does not currently exist for this collection.

4. **The supplier-identity seam is already half-open.** The compatibility layer derives `supplierId`
   and deliberately does not persist it, pending the same protected Rules update. A `warehouseId`
   addition would need that same gate, so the two should probably move together rather than opening
   the allowlist twice.

Nothing above has been implemented.
