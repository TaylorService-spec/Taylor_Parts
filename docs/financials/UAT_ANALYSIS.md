# UAT — Analysis & Reporting (DECISIONS #208, roadmap Package C)

Recorded 2026-10-03. The local proofs come from `functions/test/analysisPostgres.test.mjs` (real PostgreSQL, through
`/operations/analysis`) and `field-ops-app-vite/test/analysisWorkspace.test.jsx`. The nonprod evidence is appended below once
the package is deployed.

| Proof (C16) | Result |
|---|---|
| Static | **PASS.** `eosAnalysis/*` is read-only (no INSERT, UPDATE or DELETE), contains no Firebase and imports nothing from `ai/`. Every AVAILABLE measure has a governed basis, formula, source facts and a period event. Every ABSENT measure states why and computes nothing. Every read capability is registered. |
| Provenance | **PASS.** Overdue receivables → its definition (formula on due_on) → 1 contributing obligation → drill `readObligation` → the originating record, read through its own governed route. |
| Basis and missing ≠ zero | **PASS.** Every figure is labelled EOS operational actual. An unpriced National Accounts order is MISSING_PRICE: excluded, counted and never zero. The unpriced PO is excluded from 6,000. Targets/budget, forecast and accounting actual are ABSENT, and gross margin is STRUCTURALLY_UNKNOWN (FIN-BLOCK-003). |
| Taylor / Ventana / Consolidated | **PASS.** Open receivables: Taylor 50,000, Ventana 7,000, Consolidated 57,000, with by-company drivers. The Consolidated projection is labelled and owns nothing. |
| Comparison | **PASS.** Money received this month to date is 25,000 against 10,000 in the prior comparable window, a variance of +15,000 (150%) with an INCREASED_VS_PRIOR insight. Point-in-time measures state that they have no history snapshot. |
| Drill-through | **PASS.** <ul><li>Finance → `readObligation`</li><li>Sales (Retail SO) → `getSalesOrderDetail`</li><li>Service (WO) → `readWorkOrder` (opened through the route)</li><li>Purchasing → `readReorderRequest`</li><li>Inventory on-hand → `readInventoryOnHand` (by company: Taylor 8, Ventana 3)</li><li>Rental fleet → `readFleetUnit`; time-weighted utilization comes from the event log</li></ul> |
| Persona visibility | **PASS.** <ul><li>The Retail seller sees RETAIL only and is refused National Accounts and Finance (403).</li><li>The Technician is refused Finance. Its purchasing figures are REFUSED for lack of REORDER_QUEUE scope.</li><li>The Controller sees service as REFUSED.</li><li>The Reporting Analyst reads the catalog and no area.</li></ul> |
| Reach | **PASS.** Purchasing figures need the REORDER_QUEUE scope over the company. Inventory, receipts, transfers and cycle counts need a WAREHOUSE scope. Without them the figure is REFUSED, never shown. |
| Authorized actions | **PASS.** The overdue receivable offers "record settlement" to the Controller (available). For the Parts Manager it is shown as needing `finance.settlement.record`, and the Finance route refuses it (403). Reading analysis writes no grant. |
| Input | **PASS.** An unknown area, company, period, measure or field is refused. |
| Client | **PASS.** Exceptions first; basis labels; ABSENT and REFUSED shown with their reasons; an action is offered only as the server allows; drill-through panel; money per currency; missing shown as "—", never 0. |
