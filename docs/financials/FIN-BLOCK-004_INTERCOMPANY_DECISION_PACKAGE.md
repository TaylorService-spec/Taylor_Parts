# FIN-BLOCK-004 — Intercompany Treatment: Owner Decision Package

**Status:** ASSESSMENT ONLY — nothing implemented, no policy coded. Prepared 2026-09-01
(continuation run, Tranche 5) from a full read-only audit of every governed flow where the
two operating companies can interact. Starting authority: **D-3** ("Ventana is the upstream
SUPPLIER, not cross-franchise. RULED." — `ventana-ice-machine-lifecycle-responsibility-model.md:88`)
and **D-1** (Taylor takes title on purchase/receipt from Ventana, `:86`). Elimination logic
remains prohibited to invent (FIN-001 FIN-GAP-011).

> Citation correction found in passing: FIN-001 and the run ledger cite D-3 as
> `BusinessEntityModel.md:1236-1244`; that range does not exist in the current 352-line
> file. The live ruling text is in the Ventana lifecycle responsibility model (above).

## 1. The audited flow classification

| Flow | Evidence | Classification |
|---|---|---|
| Procurement (Taylor PO on Ventana) | Ventana representable only as an ordinary supplier record (`supplierMasterTypes.ts:29-46` — no company link); PO family COMPANY-owned, unstamped (`ownershipMatrix.ts:348-353`); the lifecycle doc maps "Taylor purchases from Ventana" onto the ordinary reorder/PO path | **SUPPLIER_TRANSACTION** |
| Warehouse ownership | 8 families matrix-designed to inherit company from the owning warehouse; census shows **0 of every count stamped** (`eos-ownership-model-reconciliation.md:296-305`) | **PHYSICAL_CUSTODY_ONLY** |
| Inventory transfer | `transferOrder` designed PARTICIPATING_COMPANIES (`sourceOperatingCompanyId`/`destinationOperatingCompanyId`, `ownershipMatrix.ts:364-387`) but **zero such fields exist in code**; the 8 cross-company-ambiguous `inventory_transactions` (`reconciliation.md:448-451`) are movement records, not money | **PHYSICAL_CUSTODY_ONLY** |
| Equipment (Ventana ice machines) | Purchase leg = ordinary PO cost under D-1; `resolveVentanaChainTitle` exists but has **zero production callers** (governed-inert) | **SUPPLIER_TRANSACTION** (purchase) / **PHYSICAL_CUSTODY_ONLY** (custody/title) |
| Parts catalog | part/alias/supplier-item/model all REFERENCE, company-neutral by design | **NO_FINANCIAL_EVENT** |
| Customer sale, Ventana-attributed | Chain propagation designed (`commercialCompanyScope.ts`) but inert: no production writer stamps `operatingCompanyId` on the sales chain today | **NO_FINANCIAL_EVENT** (dormant axis, not a cross-company transaction) |
| Service / installation | Work Orders are single-company by design; no cross-company service or labor-sharing concept exists | **NO_FINANCIAL_EVENT** |
| Freight / internal transfer | No freight model (D-6 deferred to receiving exception/claims); transfers carry no money field | **NO_FINANCIAL_EVENT** |
| `operating_companies` seeding | Seed script exists, **not run anywhere** (refuses production; declared "NOT RUN") | — (authority inert) |
| Intercompany/elimination/AR-AP code | None anywhere; only comments documenting the deliberate absence (`financialAllocation.ts` UNELIMINATED_SUM) | **NO_FINANCIAL_EVENT** |

**No flow qualifies as TRUE_INTERCOMPANY_EVENT_CANDIDATE or OPERATING_COMPANY_CHARGE under
current operations.** Every modeled Taylor↔Ventana interaction routes through ordinary
single-company supplier/PO/custody machinery, exactly as D-3 directs.

## 2. Recommendation

**NO GENERIC INTERCOMPANY LEDGER IS NEEDED YET.** The evidence supports treating
Taylor↔Ventana activity as ordinary supplier transactions (D-3) plus explicit per-record
company attribution (FIN-002 spine + the ownership-matrix stamping program):

- The one real money flow (Taylor buying from Ventana) is an ordinary purchase: Ventana is
  a supplier record; the PO/receiving cost (when the FIN-BLOCK-003 cost decision lands) is
  ordinary acquisition cost on Taylor's books. No paired intercompany event is required.
- Cross-company *movement* (transfers, the 8 ambiguous ledger rows) is custody, not money —
  the matrix's participating-companies design covers it when stamping activates.
- Consolidated reporting stays typed `UNELIMINATED_SUM`. Note: if intercompany activity is
  ruled to be ordinary supplier transactions, a consolidated revenue sum does NOT double
  count customer revenue (Ventana's sale to Taylor is Taylor's cost, not consolidated
  customer revenue) — but presenting any eliminated-looking figure still requires an
  explicit elimination ruling, which this package does not request.

## 3. Exact Owner choices remaining

1. **Ratify or amend the recommendation**: intercompany = ordinary supplier transactions
   (extending D-3 into financial treatment) — vs commissioning a first-class intercompany
   event type now (no current operation produces one).
2. **Elimination policy**: keep `UNELIMINATED_SUM` indefinitely (recommended until an
   external accounting authority is selected — DECISIONS #145), or define what, if
   anything, is ever eliminated (only relevant if choice 1 changes).
3. **The 8 cross-company-ambiguous `inventory_transactions`**: dispose via the ownership
   stamping program (participating-companies fields) — custody data, no financial event.
4. **`supplier_company_terms`** (planned, unbuilt): whether Ventana-specific commercial
   terms get a governed home there when supplier terms work resumes.
5. **Cross-company customer work**: no evidence of it operating today; confirm it stays
   out of scope until a real case exists (recorded as UNKNOWN_REQUIRES_DECISION in FIN-001).

None of these block activation of the merged financial spine; consolidated honesty is
already enforced by type.
