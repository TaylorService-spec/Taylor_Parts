# FIN-BLOCK-003 — Governed Cost-Fact Supply: Owner Decision Package

**Status:** ASSESSMENT ONLY — no costing method adopted, no cost backfill, no synthetic
margin, nothing implemented. Prepared 2026-09-01 (continuation run, Tranche 4) from a full
read-only audit of every potential cost source. Constraints held throughout: supplier quote
alone is NOT admissible cost authority; sell price is not cost; ND-27
(`PART_INVENTORY_VALUATION_AUTHORITY_GAP`) respected; the FIN-006 core
(`deriveGrossMargin`) already refuses everything below until this decision lands.

> **RE-MEASURED 2026-09-02 against `225052f3`** —
> [`../assessments/fin-block-003-cost-supply-reconciliation.md`](../assessments/fin-block-003-cost-supply-reconciliation.md).
>
> Every finding below was re-verified against current code and **all of them held**. The
> reconciliation classified the platform **CASE D — no governed cost supply**, added a structural
> guard (`functions/test/costAuthorityAbsence.test.mjs`) so the absence cannot erode one field at a
> time, and corrected one stale header that claimed the receiving command was unexported when it is
> live. **No decision below was made, narrowed or pre-empted.**
>
> It adds ONE open decision this package does not currently name: **company attribution on the cost
> path**. `operatingCompanyId` is absent from `purchase_orders`, `receiving_orders`,
> `part_supplier_items` and every inventory ledger row, so whatever cost authority is chosen will
> need a Taylor-vs-Ventana lineage that does not exist today and cannot be inferred from warehouse,
> vendor, SKU, user or customer.
>
> It also sharpens decision 2: the dormant Epic-5 price layer is **floats, with no currency and no
> operating company**, so adopting it as the capture point as-is would import three defects into the
> cost authority.

## 1. Source-by-source classification

| Source | Finding (file:line evidence in audit) | Classification |
|---|---|---|
| PO unit cost (`purchase_orders.items[].unitPrice`/`totalCost`) | fields written by `procurementService.ts:34,50-51,71` — but the collection measured 0 documents and nothing downstream reads it; the LIVE `reorder_purchase_orders` carries **no money field at all** (rules-pinned, immutable) | **CANDIDATE** (the only purchase-money scaffolding in existence — currently dead) |
| Receiving cost | `ReceivingLineValue` has no price field (`receivingTypes.ts:73-89`); normalization strips POs to `{lineId, partId, quantity}` | **MISSING** (deliberate; the natural future capture point) |
| Part acquisition cost / part master | deliberately absent (`partMaster/types.ts:92-93`; client `unitCost`/`sellPrice` BLOCKED, `part.js:338-361`) | **PROHIBITED** on the Part core (ND-27) |
| Supplier cost (`part_supplier_items.cost`) | written + tier-gated read (`inventory.catalog.cost.read`), but explicitly "a term, not a cost event" (`costMargin.ts:3-4`; FIN-001 "do not approximate") | **PROHIBITED as margin basis; DISPLAY_ONLY/reference as a quote** |
| Equipment acquisition cost | no money field on models, serialized assets (`VALUE_FIELDS` fail-closed allowlist), install command, or SO equipment lines (revenue-side unitPrice only) | **MISSING** |
| Inventory valuation | ledger/analytics/cycle-count are quantity-only by explicit design | **MISSING** (deliberate — "a valuation basis is a policy decision, not a column") |
| Freight | `sales_agreements.totals.shippingMinor` written (a sales-side CHARGE, deliberately not propagated); procurement-side freight allocation absent (D-6 deferred) | charge: **AUTHORITATIVE (revenue side)** · cost allocation: **MISSING** |
| Labor hours | `work_order_labor_entries` durations + ONSITE/TRAVEL, append-only, dormant capability | **AUTHORITATIVE (hours only — hours ≠ cost, ratified)** |
| Labor wage/cost rate | no wage/rate field anywhere (labor command explicitly refuses; Employee master carries none) | **MISSING** (deliberate) |
| Labor bill rate | none | **MISSING** (FIN-BLOCK-002 Q4 owns the bill side) |
| Subcontractor cost | zero code presence; "UNKNOWN — not zero" doctrine | **MISSING** (deliberate) |
| Installation cost | install command `ALLOWED_KEYS` excludes money; `installChargeMinor` on agreements is a sales charge, not a cost | **MISSING** |
| Commission | explicitly deferred policy (credit/commission never computed) | **MISSING** (deliberate) |
| Warranty cost | WARRANTY is a WO type only; no cost semantics anywhere | **MISSING** |

**Net: there is exactly ONE candidate cost capture path in existence (the dead Epic-5 PO
price layer), one governed hours fact, and nothing else.** Every margin question today is
truthfully UNKNOWN, and the FIN-006 core enforces that.

## 2. Cost-model options evaluated (per domain — one method need not govern all)

| Domain | Options considered | Evidence-supported recommendation (NOT adopted) |
|---|---|---|
| **Parts** | ACTUAL_RECEIPT_COST · LANDED_COST · STANDARD_COST · MOVING_AVERAGE · LAST_COST | **ACTUAL_RECEIPT_COST first**, landed later: receiving is the one governed moment where quantity truth is already captured per line; adding a cost to `ReceivingLineValue` (from the PO the receipt fulfills) is the smallest honest capture. MOVING_AVERAGE/STANDARD need a valuation engine that doesn't exist; LAST_COST invites the quote shortcut FIN-001 prohibits. Landed (freight-in allocation) composes later via `allocateAmountExactly` once D-6 freight policy exists. |
| **Serialized equipment** | SPECIFIC_IDENTIFICATION vs any averaging | **SPECIFIC_IDENTIFICATION**: units are serialized and individually tracked; averaging a serialized asset discards information the repo already holds. Capture at receipt against the PO (D-1: Taylor takes title on purchase/receipt — that IS the cost event). |
| **Labor** | wage-rate table · burdened standard rate · none | **Undecidable from repo evidence** — no rate data of any kind exists. Whatever is chosen, the labor doctrine (hours ≠ cost ≠ billable) means cost is derived at reporting time from (hours × governed rate authority), never frozen into the operational labor entry — its own header prohibits that. |
| **Freight-in** | allocate to receipt lines vs expense-as-incurred | **Undecidable** — D-6 deferred; when ruled, allocation math already exists (F10, exact largest-remainder). |
| **Subcontractor / warranty / goodwill** | direct-charge to the classified WO | Depends on FIN-BLOCK-002's classification decision; a classified WO is the natural cost object. |

## 3. The freezing event (what makes a cost HISTORICAL)

Per invariants B/C and the FIN-002 snapshot doctrine, whatever basis is ruled must freeze
at a governed event and never re-derive:

- Parts/equipment: **the receiving receipt** (quantity + cost captured together; the
  receipt is the `sourceType`/`sourceRecordId` the `GovernedCostFact` shape already
  requires).
- Labor: the labor entry stays hours-only; the cost fact freezes when the rate authority is
  applied at the governed costing moment (period-close or invoice-time — Owner choice).
- Later revaluations (landed-cost true-ups) are new governed adjustment facts, never
  in-place rewrites.

## 4. Exact Owner choices remaining (dependency order)

> **SUPERSEDED AS THE RULING INSTRUMENT, 2026-09-03.** The §4 choices below are now carried, in
> signable form and with two additions (cost-correction authority; retroactive cost change), by
> [`CERT-FIN-02_INVENTORY_COST_AND_COGS_DECISION_SHEET.md`](CERT-FIN-02_INVENTORY_COST_AND_COGS_DECISION_SHEET.md).
> That sheet is **unsigned**; nothing below has been ruled on. This package remains the source-by-source
> audit that justifies the questions — rule on the sheet, not here.

1. **Basis vocabulary + admissibility per domain** — ratify/amend §2's per-domain shape
   (receipt cost for parts, specific identification for serialized equipment); name the
   admissible `costBasis` labels for `GovernedCostFact`.
2. **Capture point + the Epic-5 question** — is the dead `purchase_orders` price layer the
   PO-side source feeding receipt-time capture, or orphaned scaffolding to retire? The live
   reorder PO collection is rules-pinned with no money field — extending it is a Tier-2
   Rules change either way.
3. **Labor cost policy** — whether labor cost enters v1 at all; if yes, the rate authority
   (per-tech wage? burdened standard per role?) and where it lives (NOT the Part, NOT the
   labor entry).
4. **ND-27 valuation authority** — whether inventory VALUATION (balance-sheet flavor) is
   ever an EOS concern or belongs wholly to the future accounting authority of record
   (#145). Margin needs cost EVENTS, not a valuation engine — these can be decided
   separately.
5. **Freight-in (D-6)** — allocate vs expense; unblocks LANDED_COST only.

**No cost backfill under any outcome** (historical events without captured cost stay
UNKNOWN — honest history). No implementation was performed.
