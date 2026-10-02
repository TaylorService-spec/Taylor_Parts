# UAT — Finance Activation 1: Purchasing / Receiving → Financial Consequence

Recorded 2026-10-01 on branch `lane/finance-foundation`. Governed by DECISIONS #145, #190, #191 and #193 (supplier identity and
receipt correction, added by the Activation 1 completion). These are
**local** proofs, executed by `functions/test/financePurchasingConsequencePostgres.test.mjs` (001–008) and
`functions/test/financePurchasingIdentityCorrectionPostgres.test.mjs` (009–018) against real PostgreSQL.
They have **not** been executed on nonprod; that needs a separate authorization.

## Chain

`PURCHASE ORDER → RECEIPT → ACQUISITION-COST EVIDENCE → FINANCIAL FACT`

- **Receiving point.** `receiveReorderStock` (Operations transport, `/operations/inventory`), run by
  `functions/src/eosOps/receiveReorderStockCommand.ts`.
- **Acquisition-cost point.** Step 15 of that command, `insertAcquisitionCostFact`. It writes
  `eos_finance.inventory_acquisition_costs`. This step is unchanged.
- **Finance point.** Step 15b of the same command, `projectReceiptAcquisitionCostOn`. It runs in the same database
  transaction as the receipt, the evidence, the inventory movement and the Reorder closeout. One of two things
  happens:
  - a priced line becomes exactly one `COST_EVIDENCE / ACQUISITION_COST` fact, with idempotency key
    `acq:<evidence id>`;
  - an unpriced line becomes one `COST_EVIDENCE_MISSING` exception.
- **Failure is atomic.** If the consequence cannot be recorded, the whole receipt is refused (`PRECONDITION_FAILED`)
  and rolls back. A receipt can never exist without its evidence, and evidence can never exist without its fact.
- **Replays write nothing.** A replay returns the original receipt.
- **Recovery.** `recoverReceiptFinancialConsequences(pool, actor, { limit })` handles durable evidence that has no
  consequence, such as receipts recorded before this activation. It re-projects deterministically and idempotently.
  It is a server-side function, not a route. No database is ever edited by hand.

## Scenarios

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-PUR-001 | Taylor priced external receipt: 4 × 41.00 USD into Taylor's warehouse | **PASS.** One evidence row and one fact: company `taylor`, amount 16400, basis `PURCHASE_ORDER_LINE_PRICE`, effective at the receipt time, created by the receiver's principal. |
| UAT-FIN-PUR-002 | Ventana priced external receipt: 3 × 1250.00 USD | **PASS.** One fact: company `ventana`, amount 375000. |
| UAT-FIN-PUR-003 | Unpriced receipt: 5 belts | **PASS.** The receipt is applied and the stock arrives. There is no evidence and no fact, and nothing is recorded at zero cost. One `COST_EVIDENCE_MISSING` exception records company `taylor`, part, quantity and PO. The unpriced-PO policy is still undecided (correction #3). |
| UAT-FIN-PUR-004 | Replay of 001 | **PASS.** Outcome `replayed` with the same receipt id. Evidence and fact counts do not change, and an explicit re-projection also reports `replayed`. |
| UAT-FIN-PUR-005 | Unauthorized attempt to manufacture a fact | **PASS.** `recordFinancialFact` on the transport returns 404 `UNKNOWN_OPERATION`. No Operations operation names a Finance fact. Only the receipt command imports the Finance writer. Facts are append-only: UPDATE and DELETE are refused. The receiver holds no Finance write capability. |
| UAT-FIN-PUR-006 | Wrong or missing company | **PASS (fail closed).** An unbound company key gives `OPERATING_COMPANY_UNRESOLVED` and writes nothing. A `consolidated` company gives `CONSOLIDATED_NOT_A_COMPANY`. |
| UAT-FIN-PUR-007 | Correction | **PASS (updated by #193).** A Finance-only fact correction still goes through `correctFinancialFact` (reversal plus replacement on the same receipt line). The operational receipt correction now exists and originates in Operations: see 014–018. The original fact and evidence are never edited. |
| UAT-FIN-PUR-008 | One building, two owners | **PASS.** Two governed warehouses share one site label. Taylor's receipt is Taylor's fact and Ventana's is Ventana's. Evidence frozen as Ventana's while the stock sits in a Taylor warehouse still produces a Ventana fact: the company comes from who owns the stock, not where it sits. |

| UAT-FIN-PUR-009 | External supplier identity | **PASS.** The PO carries `EXTERNAL_ORGANIZATION` / `SUP-ACME`, the buyer `taylor`, and a display name authored from the supplier master. Supplier text sent alongside identity is refused, and an unknown supplier is refused. The receipt fact's counterparty is the `EXTERNAL_ORGANIZATION` behind CRM organization `acct-acme`. The evidence names `SUP-ACME`. A replay records nothing. |
| UAT-FIN-PUR-010 | Taylor buying from Ventana | **PASS.** The PO records `INTERNAL_OPERATING_COMPANY`, seller `ventana`, buyer `taylor`, display name "Ventana". The fact is Taylor's, with an `INTERNAL_OPERATING_COMPANY` counterparty of `ventana` and correlation = the PO id. No CRM Account was created. Buyer and seller can be queried explicitly; no matching is performed. |
| UAT-FIN-PUR-011 | Ventana buying from Taylor | **PASS.** The fact is Ventana's (19800), with an `INTERNAL_OPERATING_COMPANY` counterparty of `taylor`. |
| UAT-FIN-PUR-012 | Self-company refusal | **PASS (fail closed).** Taylor naming Taylor as its internal supplier is refused ("cannot purchase from itself"), and so is `consolidated`. Nothing is recorded and the Reorder stays `PURCHASING_IN_PROGRESS`. A direct database insert is refused by `purchase_order_supplier_identity`. |
| UAT-FIN-PUR-013 | Legacy text-only supplier | **PASS.** The text "Taylor Freezer of Arizona" on a Ventana-warehouse PO is kept as display text only. The PO has no identity and the fact counterparty is null. Nothing is inferred from the text or the building. |
| UAT-FIN-PUR-014 | Full receipt void | **PASS.** The receipt is `CANCELLED`, not deleted; its lines and `RECEIVED +4` movement are unchanged. A compensating `ADJUSTED −4` movement is written for company `taylor` with source `RECEIVING_CORRECTION`, and on-hand nets to 0. The original fact is byte-identical; one linked reversal (−16400, with reason and actor) nets the receipt to 0. The evidence is unchanged. The Reorder returns to `ORDERED` and can be re-received normally. Audit records actor, reason, original receipt, correction, movements and reversed facts. A replay returns `replayed`; a different request on the same key gets 409; a second correction gets 412. |
| UAT-FIN-PUR-015 | Receipt correction | **PASS.** A wrong-location receipt is CORRECTED into a bin of the same warehouse. The replacement receipt is `PUTAWAY_COMPLETE` in the BIN for company `taylor`; warehouse stock goes to 0 and bin stock to 3. The facts are ORIGINAL, REVERSAL and REPLACEMENT (the replacement carries `corrects_fact_id` = the original). Their net is 6000, counted once. The correction links the original receipt to its replacement. |
| UAT-FIN-PUR-016 | Unsafe correction after downstream consumption | **PASS (fail closed).** 2 of 3 units were consumed, so the void is refused ("only 1 of the 3 received remain"). Nothing is written and stock is never negative. |
| UAT-FIN-PUR-017 | Wrong-company correction | **PASS (fail closed).** A replacement in Ventana's warehouse is refused (the replacement must be in the Reorder's own destination warehouse), and a supplied `operatingCompanyKey` is refused. The original receipt, stock and fact are untouched. |
| UAT-FIN-PUR-018 | Unpriced receipt corrected | **PASS.** Voiding an unpriced receipt reverses nothing and resolves its `COST_EVIDENCE_MISSING` exception with an append-only `RECEIPT_VOIDED` row linked to the correction. The exception row itself is unchanged and no zero-cost fact is created. There is no governed later-price path, and the vocabulary refuses one (dependency). |

## Held / dependencies

- **Counterparty on Reorder receipts: RESOLVED by #193** for purchase orders that carry governed identity
  (009–011). Legacy text-only purchase orders stay `counterparty_id = null` and are never guessed (013).
- **Internal Taylor ↔ Ventana purchase: RESOLVED by #193.** An explicit `INTERNAL_OPERATING_COMPANY` supplier states
  buyer and seller. Correlation, elimination and settlement are **not** built.
- **Vendor payable is DEFERRED.** No accepted obligation trigger exists. Commitment, cost evidence and obligation stay
  distinct.
- **Receipt correction ≠ vendor return.** Vendor return / RMA is a future workflow and is not implemented.
- **Dependencies:**
  - a governed price amendment, or a later cost-evidence path (the unpriced-PO policy is still deferred);
  - serialized receipt correction (refused today);
  - the employee supplier picker on the PO screen (it needs a supplier-read grant decision) before identity becomes
    mandatory for new POs.
