# EOS Insight — in-house visual analytics, first dashboard: Inventory Lifecycle

Status: **DESIGNED → SANDBOX BUILD.** Owner direction 2026-10-23: build our own BI-grade visual layer instead of
embedding a third-party BI tool, to keep data access inside EOS authority; first dashboard = inventory lifecycle.
Developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools.

## 1. Why in-house

A third-party BI tool (Tableau, Power BI, Metabase, Superset) is a second system holding database credentials, its own
user directory, share links and patch cycle, with tenant/company isolation re-implemented in it. EOS Insight keeps
every figure behind the existing chain: verified token → Principal → tenant → capabilities → company authority →
Operational Scope. Nothing new is granted, and no data leaves the EOS API.

## 2. Architecture

```
browser (React page + chart kit on Apache ECharts, no network of its own)
   │  POST /operations/analysis  { operation: "readInventoryLifecycle", input: { operatingCompanyId } }
   ▼
EOS API ─ eosAnalysis/inventoryLifecycle.ts
   • closed input (unknown fields refused), no client SQL, fixed governed figure definitions
   • capability per section; company scope = companyScope() of the analysis engine (#235)
   • WAREHOUSE / REORDER_QUEUE reach = the same reach the record reads apply
   • one REPEATABLE READ READ ONLY snapshot, statement_timeout 10 s, aggregated output only
   ▼
Postgres eos_ops (inventory_movements, parts, receiving_orders, purchase_orders, supplier_purchase_orders)
```

It extends the existing governed analysis layer (`functions/src/eosAnalysis/`, DECISIONS #208) rather than adding a
parallel one: the measure catalog answers "what is the number", this read answers "what is the shape over time".
No migration, no new capability, no new experience surface (the page sits behind `analysis.workspace`).

## 3. Lifecycle model

Every unit moves through: **ordered → received → on hand → issued / returned / scrapped**. Movements map to stages
(`inventory_movements.movement_type`; relocations are internal handling and excluded from flow):

| Stage | Direction | Movement types |
|---|---|---|
| Received | in | RECEIVED |
| Returned | in | RETURNED, RENTAL_RETURN |
| Issued | out | WORK_ORDER_CONSUMPTION, INTERCOMPANY_SALE_RELIEF, RENTAL_DEPLOYMENT |
| Scrapped | out | SCRAPPED |
| Transfers & adjustments | net | TRANSFER_IN/OUT, ADJUSTED |

## 4. The dashboard (questions it answers)

| Section | Question | Form | Read capability (any) · reach |
|---|---|---|---|
| KPI row | How much stock, how fast does it turn, how much is dead? | stat tiles + sparklines | `inventory.transaction.read` · WAREHOUSE |
| Stock flow | What came in and went out each month? | diverging stacked columns (in above, out below) | same |
| On-hand trend | Is stock building or draining? | single line, month-end | same |
| Stock age | How long since this stock last moved? | ordinal bars, 5 buckets | same |
| Slow movers | Which parts tie up the most idle stock? | table (part names only with `inventory.catalog.read`) | same |
| Procure-to-receipt | How long from order to receipt? | median + p90 lines | `receivingOrder.record.read` · WAREHOUSE **and** per source: `reorder.purchaseOrder.read` · REORDER_QUEUE, or `supplier.record.read` |

Definitions (server-side, one place):
- **Window:** the 12 calendar months ending with the as-of month, in the companies' shared reporting calendar timezone.
- **On hand:** Σ `quantity_delta` at WAREHOUSE / BIN / MOBILE locations (the `inventory.onHand.quantity` basis).
- **Turns (12 mo):** issued units ÷ average month-end on hand. **Days of supply:** on hand ÷ (issued last 90 days ÷ 90).
- **Stock age:** days since the part's last non-relocation movement anywhere in your warehouses; buckets 0–30, 31–90,
  91–180, 181–365, 365+. **Dormant:** > 180 days.
- **Scrap rate:** scrapped ÷ (issued + scrapped).
- Missing is never zero: a ratio with a zero denominator is `null` and renders "—" with the reason.

Units only in v1: the sole valuation source (`inventory_acquisition_costs`) is cost-gated (`inventory.catalog.cost.read`)
and partial; value figures are a follow-up.

## 5. Visual standard

Charts follow the dataviz method: form chosen by question; one axis per chart (never dual-axis); fixed categorical
order; ordinal blue ramp for age buckets; thin marks, 4 px rounded data-ends, hairline solid grid; legend for ≥ 2
series; tooltip on every chart; one filter row above everything; every chart has a table-view twin; light and dark
steps selected, not flipped. Chart colors are tokens in `index.css` (`--viz-*`), so the kit can be re-themed in one place.

## 6. Out of scope (v1) / next

Reservation lifecycle (reserved → consumed/released, `inventory_commitments`); inventory value; warehouse and part
filters; drill from a chart mark to the governed record read; the Explore page (metric × dimension × filter);
scheduled exports. Production activation follows the normal release path (Owner-gated).
