// Account-scoped Sales Orders view-model -- offline, pure. Proves empty is kept visually and
// semantically distinct from every failure mode, that a bounded/truncated page is honestly disclosed,
// and that NO price/amount field is ever synthesized (PR #991's exclusion holds on the client too).
import assert from "node:assert/strict";
import { accountSalesOrdersView, ACCOUNT_SALES_ORDERS_STATE } from "../src/domain/accountSalesOrdersView.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

ok("loading -> kind=loading", () => {
  assert.equal(accountSalesOrdersView({ loading: true }).kind, ACCOUNT_SALES_ORDERS_STATE.LOADING);
});

ok("denied transport error -> kind=denied, NEVER collapsed to empty", () => {
  const view = accountSalesOrdersView({ errorStatus: "denied" });
  assert.equal(view.kind, "denied");
  assert.notEqual(view.kind, ACCOUNT_SALES_ORDERS_STATE.EMPTY);
});

ok("unavailable transport error -> kind=unavailable, NEVER collapsed to empty", () => {
  const view = accountSalesOrdersView({ errorStatus: "unavailable" });
  assert.equal(view.kind, "unavailable");
  assert.notEqual(view.kind, ACCOUNT_SALES_ORDERS_STATE.EMPTY);
});

ok("no result at all -> unavailable, never empty", () => {
  assert.equal(accountSalesOrdersView({}).kind, ACCOUNT_SALES_ORDERS_STATE.UNAVAILABLE);
});

ok("genuinely succeeded read with zero rows -> kind=empty, distinct from every failure kind", () => {
  const view = accountSalesOrdersView({ result: { status: "ready", salesOrders: [], skipped: 0, truncated: false } });
  assert.equal(view.kind, ACCOUNT_SALES_ORDERS_STATE.EMPTY);
  assert.notEqual(view.kind, "denied");
  assert.notEqual(view.kind, "unavailable");
});

ok("populated ready read -> kind=ready with mapped rows, service-lineage indicator from serviceWorkOrderIds", () => {
  const view = accountSalesOrdersView({
    result: {
      status: "ready",
      truncated: false,
      skipped: 0,
      salesOrders: [
        {
          id: "SO-1", customerPO: "PO-9", state: "CONFIRMED", ownerEmployeeId: "EMP-1", updatedAtMillis: 5000,
          serviceWorkOrderIds: ["WO-1"],
          lines: [{ lineId: "line-1", kind: "PART", ref: "P1", orderedQty: 1, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }],
        },
        {
          id: "SO-2", customerPO: null, state: "FULFILLED", ownerEmployeeId: null, updatedAtMillis: 6000,
          serviceWorkOrderIds: [],
          lines: [],
        },
      ],
    },
  });
  assert.equal(view.kind, ACCOUNT_SALES_ORDERS_STATE.READY);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].hasServiceLineage, true);
  assert.equal(view.rows[0].serviceWorkOrderCount, 1);
  assert.equal(view.rows[1].hasServiceLineage, false);
  assert.equal(view.rows[1].serviceWorkOrderCount, 0);
});

ok("never surfaces a price/amount field -- PR #991's exclusion holds on the client view too", () => {
  const view = accountSalesOrdersView({
    result: {
      status: "ready",
      truncated: false,
      skipped: 0,
      salesOrders: [{ id: "SO-1", customerPO: null, state: "CONFIRMED", ownerEmployeeId: null, updatedAtMillis: 1, serviceWorkOrderIds: [], lines: [] }],
    },
  });
  const row = view.rows[0];
  assert.equal("unitPrice" in row, false);
  assert.equal("price" in row, false);
  assert.equal("amount" in row, false);
  assert.equal("total" in row, false);
});

ok("truncated page -> truncated=true rides the ready payload", () => {
  const salesOrders = Array.from({ length: 5 }, (_, i) => ({ id: `SO-${i}`, customerPO: null, state: "CONFIRMED", ownerEmployeeId: null, updatedAtMillis: i, serviceWorkOrderIds: [], lines: [] }));
  const view = accountSalesOrdersView({ result: { status: "ready", salesOrders, skipped: 0, truncated: true } });
  assert.equal(view.truncated, true);
  assert.equal(view.rows.length, 5);
});

console.log(`\n${passed} passed, 0 failed`);
