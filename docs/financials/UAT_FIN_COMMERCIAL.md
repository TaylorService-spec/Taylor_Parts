# UAT — Commercial Finance Activation: DQ-015 + Fulfillment → Billing Eligibility

Recorded 2026-10-02 (DECISIONS #195). These are **local** proofs, executed by
`functions/test/financeCommercialFulfillmentPostgres.test.mjs` against real PostgreSQL. They run on the governed Work Order
path over the Operations transport. The Sales Order and Agreement rows are fixtures, because Commercial creation is proven
in its own suites. Nothing has been executed on nonprod.

## Chain

1. An INSTALL Work Order is created and linked to Sales Order lines.
2. The technician installs serialized Equipment and records ordinary Part usage.
3. The technician completes the Work Order.
4. In that same transaction, the Commercial fulfillment authority records the fulfillment.
5. Billing eligibility is then derived.

There is no invoice, no AR, no billing package and no posting.

## Scenarios

| ID | Scenario | Result |
|---|---|---|
| UAT-FIN-COM-001 | Direct equipment sale fulfilled through an INSTALL Work Order | **PASS.** The EQUIPMENT_MODEL line is fulfilled with quantity 1 from the installed unit, carrying Equipment id and serial SN-A1, company `taylor`, customer, site, and the recording technician. |
| UAT-FIN-COM-002 | Equipment + ordinary Parts on the same INSTALL Work Order | **PASS.** The PART line is fulfilled with quantity 2 from the recorded usage, and it points at the usage records. Completion moved no stock and created no Equipment: inventory movements and Equipment counts are unchanged. |
| UAT-FIN-COM-003 | Agreed install charge fulfilled | **PASS.** The SERVICE line is fulfilled with quantity 1, at its existing price of 30000 (price source SALES_ORDER_LINE), never priced from labor. |
| UAT-FIN-COM-004 | Work Order completion replay | **PASS.** The replay gets 409 STALE_WORK_ORDER_STATE, and no fulfillment, movement or Equipment consequence is duplicated. |
| UAT-FIN-COM-005 | Technician attempts direct Commercial fulfillment | **PASS.** The technician holds no salesOrder, opportunity, agreement or finance capability. No operation exists to call (UNKNOWN_OPERATION). Fulfillment rows are append-only, and eligibility is a view, so nothing can be written into it. |
| UAT-FIN-COM-006 | Confirmed Sales Order with no fulfillment | **PASS.** Every line is NOT_YET, the order is NOT_YET, and there are 0 fulfillment rows. |
| UAT-FIN-COM-007 | Partial fulfillment | **PASS.** 2 of 3 gives PARTIALLY_ELIGIBLE, and ADVANCE is refused (SALES_ORDER_NOT_FULLY_FULFILLED). A second job brings it to 3 of 3, ELIGIBLE, sourced from both Work Orders, and ADVANCE then moves the order to FULFILLED. A line this job did not cover stays NOT_YET, so the order stays PARTIALLY_ELIGIBLE. An overage fails closed and the Work Order is not completed. |
| UAT-FIN-COM-008 | Wrong-company and missing linkage | **PASS (fail closed).** All of these are refused: an unknown Sales Order, another company's Sales Order, another customer's, another site's, a linked Work Order with no linked lines, a cross-company link written outside the governed path, and a CONSOLIDATED company. |
| UAT-FIN-COM-009 | Financed / lease disposition preserved | **PASS.** Dispositions show as LEASE, SALE or DIRECT_ORDER as applicable. The obligor is `DEFERRED_TO_BILLING_PACKAGE`, and no column asserts that the customer is the obligor. |

## Dependencies (recorded, not built)

- A Saratoga / financed-sale marker in PostgreSQL Commercial.
- Partial-billing policy, which belongs to the billing package.
- Commercial correction or cancellation of already-recorded fulfillment.
- Work Order un-completion.
- HELD inputs (an operational block, or pending additional work).
- The Operational Billing Package, the next Finance package, which consumes this eligibility.
