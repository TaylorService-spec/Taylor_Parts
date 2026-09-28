// Pass 11 Fix Wave 1 -- the client half of the governed record read: which collections route to the governed
// callable, only where the environment is ready, and how wire rows come back to the direct-read shape.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.__APP_READINESS__ = globalThis.__APP_READINESS__ ?? { GOVERNED_RECORD_READ_READY: false };
const { GOVERNED_SURFACE_BY_COLLECTION, governedSurfaceFor, fromWire } = await import("../src/services/governedRecordReadClient.js");
const { GOVERNED_RECORD_READ_READY } = await import("../src/config/governedRecordReadReadiness.js");

test("the readiness flag is strictly boolean and false unless the registry says true", () => {
  assert.equal(GOVERNED_RECORD_READ_READY, false);
});

test("not ready: every collection keeps its direct read", () => {
  for (const c of Object.keys(GOVERNED_SURFACE_BY_COLLECTION)) assert.equal(governedSurfaceFor(c, false), null, c);
});

test("ready: exactly the server registry's collections route to a governed surface; nothing else does", () => {
  assert.deepEqual(Object.values(GOVERNED_SURFACE_BY_COLLECTION).sort(),
    ["accounts", "inventoryTransactions", "parts", "purchaseOrders", "reorderRequests", "transferOrders", "warehouses", "workOrders"]);
  assert.equal(governedSurfaceFor("fieldops_wos", true), "workOrders");
  assert.equal(governedSurfaceFor("accounts", true), "accounts");
  for (const c of ["users", "roleAssignments", "employees", "fieldops_technicians", "invoices", "suppliers", "opportunities"]) {
    assert.equal(governedSurfaceFor(c, true), null, c);
  }
});

test("wire rows come back with Timestamps and nested values intact", () => {
  const out = fromWire({ createdAt: { __timestamp: "2026-09-27T12:00:00.000Z" }, lines: [{ at: { __timestamp: "2026-09-27T13:00:00.000Z" } }], ref: { __ref: "accounts/a1" }, n: 3 });
  assert.equal(out.createdAt.toDate().toISOString(), "2026-09-27T12:00:00.000Z");
  assert.equal(typeof out.createdAt.toMillis, "function");
  assert.equal(out.lines[0].at.toDate().toISOString(), "2026-09-27T13:00:00.000Z");
  assert.equal(out.ref, "accounts/a1");
  assert.equal(out.n, 3);
});
