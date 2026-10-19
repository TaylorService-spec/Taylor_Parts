# Receipt correction: proposed eligible-role matrix (for Owner approval)

Firebase exit B3-x. Status: **PROPOSAL. Nothing is granted.** `inventory.receipt.correct` is registered and held by nobody (migration `1764430000000`: "Granted to NOBODY: the holder is a Controller decision, applied through Administration"). Activation is an Owner decision; this document is the input to it. The grant, if approved, is applied through Administration or by the controller's Owner-approved path, never by this lane.

## What the capability does

`inventory.receipt.correct` is the narrowest authority for "we recorded the receipt wrong". It is distinct from ordinary receiving (`inventory.stock.receive`) because it removes received stock and reverses a Finance consequence. Two commands use it, with no fallback between them:

- `correctReorderReceipt` (VOID or CORRECTED), for Reorder receipts (DECISIONS #193).
- `correctSupplierPurchaseOrderReceipt` (VOID only), for canonical supplier purchase order receipts (DECISIONS #B3-x).

Both require, after the capability: company authority (#235/#237), then the WAREHOUSE operational scope over the receipt's location. Administration reach (G2) applies to the Reorder VOID only and is **not** extended to the supplier correction.

## What a correction preserves (all already true, proved in Postgres)

| Preserved | How |
|---|---|
| The original receipt | Becomes `CANCELLED`; never deleted or edited. A voided receipt stays visible in Recent Receipts. |
| The reason | Required; stored in the append-only `receiving_corrections` row and in the audit event. |
| Who did it | `corrected_by` (the acting principal) in `receiving_corrections`; the audit event records the actor and the employee authority. |
| The adjustment ledger | The stock leaves through compensating `ADJUSTED` movements; the original `RECEIVED` movements are untouched. |
| The audit | One `inventory.receipt.correct` audit event with before, after, every compensating movement, every reversed Finance fact and every resolved exception. |
| Replay safety | One idempotency key per correction; the same request writes nothing twice; a different request under the same key is `IDEMPOTENCY_CONFLICT`. |
| Finance consequence | The payable and intercompany correlation are retired/reversed by the existing governed reversal; the Finance exception is resolved, never edited. |

## Proposed eligibility

Granted per Role, never to an individual by default. Every row additionally needs the WAREHOUSE scope over the receipt location to act, so a Role without scope can hold the capability and still act nowhere.

| Role | Proposal | Reason |
|---|---|---|
| warehouseManager | **Eligible** | Owns the receiving floor and its stock accuracy; already scoped to its warehouses. |
| partsManager | **Eligible** | Owns the Parts and Reorder process; the Reorder VOID is already within this Role's domain. |
| controller | **Eligible, only with a warehouse scope assigned** | The reversal is a Finance act; the Controller is the natural reviewer of it, but without a warehouse scope the command refuses, which is the intended safeguard. |
| operationsManager | Not proposed | Broad read authority; no ownership of receiving. Revisit if the Owner wants a second manager path. |
| purchasingManager | **Not eligible** | Segregation of duties: the Role that raises and records purchase orders should not remove the stock a receipt recorded against them. |
| inventoryReceivingClerk, warehouseAssociate, partsAssociate | **Not eligible** | The person who made the receiving error should request the correction, not perform it. A request-then-approve flow is a possible later capability and is out of scope here. |
| technician | Not eligible | No receiving authority. |
| admin | Not by position | Administration holds the whole catalog by derivation; it does not gain the act. The Reorder VOID reach (G2) is a separate, already-ruled path. |
| owner | Not by position | Owner is a position, not a function; grant to the functional Role instead. |

## Decisions for the Owner

1. Approve, change or reject the eligible rows above (recommended: warehouseManager and partsManager; controller with scope).
2. Whether a correction by the same employee who made the receipt should be refused (not enforced today; recommended as a follow-up, not a blocker, because the audit records both).
3. Whether Administration reach (G2) should ever extend to the supplier correction (recommended: no).
4. Timing: after the nonprod runtime proof of the screen (Inventory › Receiving › Recent Receipts › Correct…). The screen is offered only to a holder, so it stays dark until the grant.
