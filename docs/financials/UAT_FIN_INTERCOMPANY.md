# UAT — Taylor / Ventana intercompany (DECISIONS #202)

Recorded 2026-10-02. These are **local** proofs only, from `functions/test/financeIntercompanyPostgres.test.mjs`. That suite runs over the real governed Reorder → PO → Receipt → correction path on the Operations transport, against real PostgreSQL. All data is SAMPLE/UAT, and nothing is deployed.

| # | Proof | Result |
|---|---|---|
| 1 / 2 / 3 | Both companies identify the other as an internal supplier, explicitly | **PASS.** Taylor's supplier options include Ventana as INTERNAL_OPERATING_COMPANY. A Taylor PO records supplier_kind INTERNAL_OPERATING_COMPANY, seller `ventana` and buyer `taylor`. A Ventana PO records seller `taylor` and buyer `ventana`. |
| 4 | Supplier text manufactures nothing | **PASS.** A legacy PO whose text names "Ventana", and an external-supplier PO, are both received and write no intercompany transaction. |
| 5 / 6 / 7 | Self-purchase and CONSOLIDATED | **PASS.** Taylor buying from Taylor and Ventana buying from Ventana are refused (412). The database refuses a same-company correlation (`intercompany_two_companies`) and either side being CONSOLIDATED. CONSOLIDATED can't be a counterparty. |
| 8 | Location never decides the company | **PASS.** The two warehouse records share the site label "Shared Building" but belong to different companies, and each purchase follows its own record. Receiving Taylor's purchase into Ventana's warehouse record is refused (412, "received into its own destination warehouse"), and the PO stays Taylor's. |
| 9 / 10 | Buyer and seller preserved, both directions | **PASS.** Taylor ← Ventana: the correlation records buyer taylor, seller ventana, REORDER_RECEIPT, the PO, 500000 USD, AWAITING_OBLIGATION_TRIGGER. Ventana ← Taylor: buyer ventana, seller taylor, 12600. A replayed receipt writes no second correlation. |
| 11–16 | Paired obligations | **PASS (trigger activated by Owner ruling #202 — see below).** Earlier mechanism proof: Nothing exists until the trigger is invoked; a static check confirms nothing in the runtime invokes it. Invoked by the test, it creates exactly one INTERCOMPANY_PAYABLE (taylor → ventana, 500000) and one INTERCOMPANY_RECEIVABLE (ventana → taylor, 500000). They share the currency, sit in their own companies and are linked by one correlation. A replay creates nothing more. The reverse direction pairs symmetrically (12600). The database refuses a swapped or rewritten pair, an amount change and a delete. |
| 17 | No netting | **PASS.** Both sides stay at their full outstanding amount, and the static check finds no netting, elimination or settlement. |
| 18 | No CONSOLIDATED-owned obligation | **PASS.** |
| 19 | Acquisition cost stays company-correct | **PASS.** The evidence and fact belong to `taylor`, with Ventana as the INTERNAL_OPERATING_COMPANY counterparty. |
| — | Unpriced internal receipt / correction | **PASS.** An unpriced receipt's correlation is COST_EVIDENCE_MISSING with no amount, and nothing can be established from it. A VOID correction supersedes the correlation and voids both established obligations, with history kept. |
| 20 | Taylor's downstream outside resale | **PASS.** The package belongs to `taylor`, with the outside customer as counterparty and Taylor's destination. Ventana gets no package obligation. Provenance traces the part to its acquisition (supplied by ventana, acquired by taylor). |
| 21 | Ventana's direct outside sale | **PASS.** The package belongs to `ventana`, with Ventana's destination. |
| 22 | Taylor Service on Ventana-sold equipment | **PASS.** The real fulfillment authority refuses a Taylor Work Order linked to the Ventana Sales Order (SALES_ORDER_COMPANY_MISMATCH), and no fulfillment is recorded. |
| 23 | Separate destinations | **PASS.** Taylor's and Ventana's destinations are distinct. |
| 24 | No Firebase | **PASS (static).** |

## Owner ruling #202 — the receipt trigger and NET 90

| Proof | Scenario | Result |
|---|---|---|
| Terms | Governed terms | **PASS.** Taylor's profile of Ventana is "Net 90" with `payment_terms_net_days` 90, set by configuration. Ventana's profile of Taylor is not governed. Negative days are refused. |
| A / B / C | A priced Taylor ← Ventana receipt | **PASS.** In the receipt's transaction it creates exactly one INTERCOMPANY_PAYABLE (taylor → ventana, 500000) and one INTERCOMPANY_RECEIVABLE (ventana → taylor, 500000). They share the currency and one ESTABLISHED correlation, with trigger "GOVERNED_PRICED_RECEIPT (Owner ruling #202)". |
| D / E | Dates | **PASS.** The obligation date is the receipt's business date. The due date is the receipt date + 90, on the correlation and on both obligations. Due dates can't be rewritten. |
| F / G | Before payment, no invoice | **PASS.** The only facts are origination facts: no settlement and 0 invoices. |
| H | Replay | **PASS.** A receipt replay and a mechanism replay create no new obligations. |
| I / J | Unpriced, then completed | **PASS.** An unpriced receipt is COST_EVIDENCE_MISSING with no amount, no obligations and the exception retained, and recovery holds it. Once the cost evidence is complete (the test supplies the evidence row a future governed pricing path would write), recovery establishes the pair once (60000, NET 90). A second run establishes nothing. |
| K | Correction | **PASS.** A VOID correction supersedes the correlation and voids BOTH sides. Each side keeps its origination plus one reversal, with outstanding 0. |
| L / M / N | Self-purchase and CONSOLIDATED | **PASS.** Refused by the command and by the database. |
| O | Reverse direction | **PASS.** Ventana ← Taylor establishes the pair (12600) with no terms and no due date: NET 90 is never assumed. |
| P / Q / R / S | Static | **PASS.** No netting, no settlement or payment, no invoice or GL, no stored overdue, no NET 90 in code, no Firebase, no transport operation. |

## Recorded gaps (subsequent bounded work)

- Ventana-side inventory relief when Ventana sells equipment to Taylor.
- Fulfillment by Taylor Service (delivery or install) of a Ventana-originated sale. A Taylor Work Order is refused for a Ventana sale.
- An intercompany accounting-provider handoff, one per side, anchored on each company's obligation and carrying the correlation id.
- A governed path that completes a receipt's cost evidence later. #193 has no PO price amendment; the establishment mechanism is ready.
