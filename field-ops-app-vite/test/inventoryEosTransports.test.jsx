// THE INVENTORY / WAREHOUSE EOS TRANSPORTS (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01).
//
// Placement, relocation, transfer, cycle count and the warehouse / bin reads reach PostgreSQL through ONE generic
// operations client. These pin: the route + operation each method sends, the screens' request shapes passed through
// unchanged, the EOS projections adapted to the shapes the screens already render, the refusal translation (a server
// code in details.code; NOT_ACTIVATED shown and never retried), and that none of these modules imports Firebase.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const sent = [];
let reply = () => ({ status: 200, body: { ok: true, result: {} } });
vi.mock("../src/services/adminPolicyApiClient.js", () => ({
  policyApiBaseUrl: () => "https://eos.test",
  currentIdToken: async () => "tok",
}));
globalThis.fetch = vi.fn(async (url, init) => {
  const body = JSON.parse(init.body);
  sent.push({ url, body, auth: init.headers.authorization });
  const r = reply(url, body);
  return { ok: r.status < 300, status: r.status, json: async () => r.body };
});

const { callEosOperation, eosOperationOrThrow, EosOperationError, EOS_OPERATIONS_ROUTES } = await import("../src/services/eosOperationsClient.js");
const { resolveBin, resolveBinToken, fetchInventoryWarehouseOptions, fetchAcquireWarehouseOptions } = await import("../src/services/inventoryLocationClient.js");
const { stockMovementClient } = await import("../src/services/stockMovementClient.js");
const { placementClient, toPutAwayRelocation } = await import("../src/services/placementClient.js");
const { transferCommandClient, toTransferOrderDoc } = await import("../src/services/transferCommandClient.js");
const { cycleCountCommandClient, withSerialVariance } = await import("../src/services/cycleCountCommandClient.js");
const { fetchPage: fetchWarehousePage } = await import("../src/metadata/warehouseListSource.js");

beforeEach(() => { sent.length = 0; reply = () => ({ status: 200, body: { ok: true, result: {} } }); });

const LOCATIONS = { items: [
  { type: "WAREHOUSE", locationId: "taylor-main", warehouseId: "taylor-main", name: "Taylor Main Warehouse", status: "ACTIVE" },
  { type: "BIN", locationId: "bin_a", warehouseId: "taylor-main", code: "A01-001", name: "Shelf A1", status: "ACTIVE" },
  { type: "BIN", locationId: "bin_b", warehouseId: "taylor-main", code: "A01-002", name: "Retired", status: "INACTIVE" },
  { type: "BIN", locationId: "bin_x", warehouseId: "taylor-other", code: "A01-001", name: "Elsewhere", status: "ACTIVE" },
] };

describe("the generic EOS operations client", () => {
  it("posts { operation, input } to the named route with the bearer", async () => {
    reply = () => ({ status: 200, body: { ok: true, result: { x: 1 } } });
    const r = await callEosOperation(EOS_OPERATIONS_ROUTES.TRANSFER, "createTransfer", { a: 1 });
    expect(r).toEqual({ ok: true, operation: "createTransfer", result: { x: 1 } });
    expect(sent[0]).toEqual({ url: "https://eos.test/operations/transfer", body: { operation: "createTransfer", input: { a: 1 } }, auth: "Bearer tok" });
  });

  it("refuses an unknown route without sending anything", async () => {
    const r = await callEosOperation("/operations/nowhere", "x");
    expect(r.code).toBe("UNKNOWN_OPERATION");
    expect(sent).toHaveLength(0);
  });

  it("a refusal throws with the transport code and the server's own code in details.code", async () => {
    reply = () => ({ status: 403, body: { ok: false, code: "OUTSIDE_OPERATIONAL_SCOPE", message: "outside", details: { code: "spoof" } } });
    const err = await eosOperationOrThrow(EOS_OPERATIONS_ROUTES.RELOCATION, "relocateStock", {}).catch((e) => e);
    expect(err).toBeInstanceOf(EosOperationError);
    expect(err.code).toBe("permission-denied");
    expect(err.details.code).toBe("OUTSIDE_OPERATIONAL_SCOPE");
  });

  it("NOT_ACTIVATED (503) is a shown precondition refusal, never a retryable outage", async () => {
    reply = () => ({ status: 503, body: { ok: false, code: "NOT_ACTIVATED", message: "not switched on" } });
    const err = await eosOperationOrThrow(EOS_OPERATIONS_ROUTES.PLACEMENT, "recordPutAway", {}).catch((e) => e);
    expect(err.category).toBe("NOT_ACTIVATED");
    expect(err.code).toBe("failed-precondition");
    expect(err.details.code).toBe("NOT_ACTIVATED");
    expect(sent).toHaveLength(1);
  });
});

describe("warehouse and bin reads (eos_ops)", () => {
  beforeEach(() => { reply = (_u, b) => ({ status: 200, body: { ok: true, result: b.operation === "listInventoryLocations" ? LOCATIONS : { items: [
    { warehouseId: "taylor-main", name: "Taylor Main Warehouse", siteLabel: "Taylor Main", status: "ACTIVE", operatingCompanyId: "taylor", binCount: 2 },
    { warehouseId: "taylor-closed", name: "Closed", siteLabel: null, status: "INACTIVE", operatingCompanyId: "taylor", binCount: 0 },
  ] } } }); });

  it("resolves a typed code within the warehouse; retired and unknown bins keep their own answers", async () => {
    expect(await resolveBin({ warehouseId: "taylor-main", code: " a01-001 " })).toMatchObject({ result: "FOUND", binId: "bin_a", warehouseId: "taylor-main" });
    expect((await resolveBin({ warehouseId: "taylor-main", code: "A01-002" })).result).toBe("INACTIVE");
    expect((await resolveBin({ warehouseId: "taylor-main", code: "Z99-999" })).result).toBe("NOT_FOUND");
    expect(sent[0].body).toEqual({ operation: "listInventoryLocations", input: { warehouseId: "taylor-main" } });
  });

  it("a scanned token in another warehouse says WRONG_WAREHOUSE; a token outside scope is NOT_FOUND", async () => {
    expect((await resolveBinToken({ warehouseId: "taylor-main", token: "bin_x" })).result).toBe("WRONG_WAREHOUSE");
    expect((await resolveBinToken({ warehouseId: "taylor-main", token: "bin_nowhere" })).result).toBe("NOT_FOUND");
    expect((await resolveBinToken({ warehouseId: "taylor-main", token: "nope" })).result).toBe("MALFORMED");
  });

  it("warehouse options and the Warehouses list come from listInventoryWarehouses; acquire offers ACTIVE ones only", async () => {
    expect((await fetchInventoryWarehouseOptions()).map((w) => [w.id, w.name])).toEqual([["taylor-main", "Taylor Main Warehouse"], ["taylor-closed", "Closed"]]);
    expect(await fetchAcquireWarehouseOptions()).toEqual({ status: "ready", options: [{ value: "taylor-main", label: "Taylor Main Warehouse" }] });
    const page = await fetchWarehousePage({ filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }], pageSize: 50 });
    expect(page.rows.map((r) => [r.warehouseId, r.name, r.location, r.status])).toEqual([["taylor-main", "Taylor Main Warehouse", "Taylor Main", "ACTIVE"]]);
  });
});

describe("writers: the screens' requests, unchanged, to the EOS routes", () => {
  it("relocation and put-away", async () => {
    const req = { partId: "P", source: { type: "BIN", locationId: "bin_a" }, destination: { type: "BIN", locationId: "bin_b" }, quantity: 2, idempotencyKey: "k" };
    await stockMovementClient.relocateStock(req);
    expect(sent.at(-1)).toMatchObject({ url: "https://eos.test/operations/relocation", body: { operation: "relocateStock", input: req } });
    await placementClient.putAwayStock({ warehouseId: "taylor-main", partId: "P", binId: "bin_a", quantity: 3, idempotencyKey: "k2" });
    expect(sent.at(-1).body).toEqual({ operation: "relocateStock", input: { partId: "P", source: { type: "WAREHOUSE", locationId: "taylor-main" }, destination: { type: "BIN", locationId: "bin_a" }, quantity: 3, idempotencyKey: "k2", recordPlacement: true } });
    expect(toPutAwayRelocation({ warehouseId: "w", partId: "S", serialNumbers: ["SN-1"], idempotencyKey: "k" }, "bin_a")).toMatchObject({ serialNumbers: ["SN-1"], recordPlacement: true });
    await placementClient.recordPutAway({ warehouseId: "w", binCode: "A01-001", partId: "P", quantity: 1, idempotencyKey: "k3", pickedForWorkOrderId: "WO-1" });
    expect(sent.at(-1)).toMatchObject({ url: "https://eos.test/operations/placement", body: { operation: "recordPutAway" } });
  });

  it("transfer: the four acts, and the list adapted to { docId, data } rows", async () => {
    await transferCommandClient.createTransferOrder({ partId: "P", quantity: 1, origin: { type: "WAREHOUSE", locationId: "a" }, destination: { type: "WAREHOUSE", locationId: "b" }, idempotencyKey: "k" });
    await transferCommandClient.dispatchTransferOrder({ transferOrderId: "trf_1", extra: "dropped" });
    expect(sent.map((s) => s.body.operation)).toEqual(["createTransfer", "dispatchTransfer"]);
    expect(sent[1].body.input).toEqual({ transferOrderId: "trf_1" });
    const doc = toTransferOrderDoc({ transferOrderId: "trf_1", transferOrderNumber: "TO-2026-000001", status: "IN_TRANSIT", partId: "P", trackingMode: "NONE", quantity: 2,
      serialNumbers: [], origin: { type: "WAREHOUSE", locationId: "a", warehouseId: "a" }, destination: { type: "WAREHOUSE", locationId: "b", warehouseId: "b" }, canReceive: true });
    expect(doc.docId).toBe("trf_1");
    expect(doc.data).toMatchObject({ partId: "P", status: "IN_TRANSIT", quantity: 2, canReceive: true, origin: { type: "WAREHOUSE", locationId: "a" } });
  });

  it("cycle count: create returns the sheet's own fields; a revealed SERIAL line carries missing / unexpected", async () => {
    reply = () => ({ status: 200, body: { ok: true, result: { outcome: "applied", sheet: { sheetId: "ccs_1", status: "OPEN", location: { type: "BIN", locationId: "bin_a" } } } } });
    const created = await cycleCountCommandClient.createCycleCountSheet({ location: { type: "BIN", locationId: "bin_a" }, idempotencyKey: "k" });
    expect(created).toMatchObject({ sheetId: "ccs_1", outcome: "applied" });
    expect(sent[0]).toMatchObject({ url: "https://eos.test/operations/cycle-count", body: { operation: "createCycleCountSheet" } });
    const line = withSerialVariance({ trackingMode: "SERIAL", expectedSerialNumbers: ["A", "B"], countedSerialNumbers: ["B", "C"] });
    expect(line.serialVariance).toEqual({ missing: ["A"], unexpected: ["C"] });
    expect(withSerialVariance({ trackingMode: "SERIAL", status: "OPEN" }).serialVariance).toBeUndefined();
  });
});

describe("no Firebase in the inventory transports", () => {
  it("none of the EOS transport modules imports Firebase", () => {
    for (const f of ["eosOperationsClient.js", "inventoryLocationClient.js", "stockMovementClient.js", "placementClient.js", "transferCommandClient.js", "cycleCountCommandClient.js", "serializedAssetAcquireCallableClient.js"]) {
      expect(readFileSync(`src/services/${f}`, "utf8"), f).not.toMatch(/from "firebase\/|from "\.\.\/firebase\//);
    }
  });
});
