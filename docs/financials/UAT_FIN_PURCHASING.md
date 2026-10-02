# UAT — Finance Activation 1: Purchasing / Receiving → Financial Consequence

Recorded 2026-10-01 on branch `lane/finance-foundation`. Governed by DECISIONS #145, #190 and #191. These are
**local** proofs, executed by `functions/test/financePurchasingConsequencePostgres.test.mjs` against real PostgreSQL.
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
| UAT-FIN-PUR-007 | Correction | **PARTIAL (dependency recorded).** EOS has no command to cancel, void or correct a receipt; `CANCELLED` is a status that nothing writes, and a cancelled receipt is refused by projection. The Finance fact is corrected only by the existing `correctFinancialFact` (reversal plus replacement linked to the same receipt line). The original fact and the operational evidence stay untouched. |
| UAT-FIN-PUR-008 | One building, two owners | **PASS.** Two governed warehouses share one site label. Taylor's receipt is Taylor's fact and Ventana's is Ventana's. Evidence frozen as Ventana's while the stock sits in a Taylor warehouse still produces a Ventana fact: the company comes from who owns the stock, not where it sits. |

## Held / dependencies

- **Counterparty on Reorder receipts is HELD (NEXT ACTIVATION).** A Reorder PO names its supplier only by text
  (`purchase_orders.supplier_name`; `canonical.supplierId` is always null), so these facts carry
  `counterparty_id = null` rather than a guess. The adapter path is already proven: a governed `supplier_id` linked to
  a CRM organization resolves to exactly one `EXTERNAL_ORGANIZATION` counterparty, with no duplicate counterparty or
  organization. What's missing is a governed supplier id on the PO.
- **Internal Taylor ↔ Ventana purchase is HELD.** Nothing in the PO identifies an internal-company supplier, so
  `INTERNAL_OPERATING_COMPANY` is not inferred.
- **Vendor payable is DEFERRED.** No accepted obligation trigger exists. Commitment, cost evidence and obligation stay
  distinct, and no obligation is opened.
