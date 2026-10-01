// The Equipment client on the governed EOS register (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01): the
// closed operation lists mirror the server exactly, the register record maps onto the fields the screens render, the
// write path sends exactly the governed command (and stated facts), the list source and the scanner read EOS, and the
// install transport maps the server's refusals onto the closeout's vocabulary. Pure node -- every transport injected.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EQUIPMENT_COMMAND_OPERATIONS, EQUIPMENT_READ_OPERATIONS, EQUIPMENT_ROUTE, isEquipmentOperation, toEquipmentView }
  from "../src/services/equipmentApiClient.js";
import { createEquipment, updateEquipment } from "../src/domain/equipmentRepository.js";
import { fetchPage } from "../src/metadata/equipmentListSource.js";
import { fetchInstallableEquipmentForWorkOrder, parseUnitHandle, recordWorkOrderEquipmentInstall, unitHandle }
  from "../src/services/workOrderEquipmentInstallClient.js";
import { fetchLocationLabels, fetchSerializedUnits } from "../src/services/scanEquipmentReads.js";

const here = dirname(fileURLToPath(import.meta.url));
const server = readFileSync(resolve(here, "../../functions/src/eosOps/equipmentOperations.ts"), "utf8");

const RECORD = {
  id: "eq_1", tenantId: "t", operatingCompanyKey: "taylor", accountId: "acct-1", customerLocation: { namespace: "CRM_LOCATION", id: "loc-1" },
  equipmentModelId: "ACME--U-1", name: "Cooler", status: "ACTIVE", serialNumber: "S-1", assetTag: null, installedFrom: null,
  installedOn: "2024-01-02", warrantyExpiresOn: null, notes: null, version: 3, createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T01:00:00.000Z", accountName: "Acme Diner", customerLocationName: "Main St",
};

test("the operation lists mirror the server's closed table exactly; installation is not on the register route", () => {
  const table = server.slice(server.indexOf("export const EOS_EQUIPMENT_OPERATIONS"), server.indexOf("} satisfies Record<string, Op>);"));
  const keys = [...table.matchAll(/^ {2}([a-zA-Z]+)(?::|,)/gm)].map((m) => m[1]);
  const reads = server.match(/EQUIPMENT_READ_OPERATIONS[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/)[1].match(/"([a-zA-Z]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...EQUIPMENT_READ_OPERATIONS].sort(), [...reads].sort());
  assert.deepEqual([...EQUIPMENT_READ_OPERATIONS, ...EQUIPMENT_COMMAND_OPERATIONS].sort(), [...keys].sort());
  assert.equal(EQUIPMENT_ROUTE, "/operations/equipment");
  for (const n of ["installSerializedAsset", "recordWorkOrderEquipmentInstall", "", null]) assert.equal(isEquipmentOperation(n), false, String(n));
});

test("toEquipmentView: the customer SITE is locationId, dates are calendar days, the version travels", () => {
  const v = toEquipmentView(RECORD);
  assert.deepEqual([v.locationId, v.accountName, v.locationName, v.installedDate, v.version, v.equipmentModelId], ["loc-1", "Acme Diner", "Main St", "2024-01-02", 3, "ACME--U-1"]);
  assert.equal(v.createdAt, Date.parse(RECORD.createdAt));
  assert.equal(toEquipmentView(null), null);
});

test("createEquipment sends the governed command with the STATED company, model and a key; refuses without a company", async () => {
  const calls = [];
  const client = { call: async (op, input) => { calls.push([op, input]); return { ok: true, result: { equipment: RECORD } }; } };
  const location = { id: "loc-1", accountId: "acct-1" };
  const none = await createEquipment({ name: "Cooler", accountId: "acct-1", locationId: "loc-1" }, { location, client });
  assert.equal(none.ok, false);
  assert.equal(calls.length, 0, "no company, no write");
  const r = await createEquipment({ name: "Cooler", accountId: "acct-1", locationId: "loc-1", serialNumber: "S-1", installedDate: "2024-01-02" },
    { location, client, operatingCompanyId: "taylor", equipmentModelId: "ACME--U-1", idempotencyKey: "k-1" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls, [["createEquipment", { operatingCompanyId: "taylor", accountId: "acct-1", customerLocationId: "loc-1", name: "Cooler",
    idempotencyKey: "k-1", equipmentModelId: "ACME--U-1", serialNumber: "S-1", installedOn: "2024-01-02" }]]);
});

test("updateEquipment states the version it edited and sends only the changed governed fields", async () => {
  const calls = [];
  const client = { call: async (op, input) => { calls.push([op, input]); return { ok: true, result: { equipment: RECORD } }; } };
  const before = toEquipmentView(RECORD);
  const r = await updateEquipment("eq_1", { name: "Cooler #2" }, { before, client });
  assert.equal(r.ok, true);
  assert.equal(calls[0][0], "updateEquipment");
  assert.equal(calls[0][1].expectedVersion, 3);
  assert.equal(calls[0][1].changes.name, "Cooler #2");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][1].changes, "accountId"), false, "customer is never sent");
  const refused = { call: async () => ({ ok: false, code: "CONFLICT", reason: "VERSION_CONFLICT", message: "reload" }) };
  assert.equal((await updateEquipment("eq_1", { name: "x" }, { before, client: refused })).ok, false);
});

test("the list source sends the register's own filters to the server and pages the bounded result", async () => {
  const seen = [];
  const call = async (op, input) => { seen.push([op, input]); return { ok: true, result: { equipment: [RECORD, { ...RECORD, id: "eq_2", name: "Alpha" }], nextCursor: null } }; };
  const page = await fetchPage({ filters: [{ fieldId: "accountId", operator: "EQUALS", value: "acct-1" }, { fieldId: "status", operator: "EQUALS", value: "ACTIVE" }],
    sort: [{ fieldId: "name", direction: "ASC" }], pageSize: 1 }, {}, call);
  assert.deepEqual(seen[0], ["listEquipment", { limit: 200, accountId: "acct-1", status: "ACTIVE" }]);
  assert.deepEqual([page.rows.map((r) => r.name), page.hasMore], [["Alpha"], true]);
  await assert.rejects(fetchPage({ filters: [] }, {}, async () => ({ ok: false, code: "FORBIDDEN" })), (e) => e.code === "permission-denied");
});

test("the install transport: the unit handle round-trips; refusals map onto the closeout's vocabulary; NOT_ACTIVATED is a readiness state", async () => {
  assert.deepEqual(parseUnitHandle(unitHandle("PRT/1", "SN::2")), { partId: "PRT/1", serialNumber: "SN::2" });
  const list = await fetchInstallableEquipmentForWorkOrder({ workOrderId: "wo-1", serialNo: "SN-1" }, async (op, input) => {
    assert.deepEqual([op, input], ["listInstallableEquipmentForWorkOrder", { workOrderId: "wo-1", serialNumber: "SN-1" }]);
    return { ok: true, result: { units: [{ partId: "P", serialNumber: "SN-1", status: "AVAILABLE", locationType: "BIN", locationId: "bin_x", locationLabel: "Main / A1" }], truncated: false } };
  });
  assert.deepEqual([list.outcome.units[0].serialNo, list.outcome.units[0].locationLabel], ["SN-1", "Main / A1"]);
  const sent = [];
  const ok = await recordWorkOrderEquipmentInstall({ workOrderId: "wo-1", serializedAssetId: unitHandle("P", "SN-1"), idempotencyKey: "k" },
    async (op, input) => { sent.push([op, input]); return { ok: true, result: { outcome: "installed", equipment: { id: "eq_9" } } }; });
  assert.deepEqual(ok.outcome, { outcome: "installed", equipmentId: "eq_9", completionRequired: true, workOrderStatus: null });
  assert.deepEqual(sent[0][1], { workOrderId: "wo-1", partId: "P", serialNumber: "SN-1", idempotencyKey: "k", equipmentName: "P S/N SN-1" });
  for (const [reason, detail] of [["NOT_ASSIGNED", "NOT_ASSIGNED_TECHNICIAN"], ["TRUCK_SOURCE_NOT_ACTIVATED", "ASSET_NOT_INSTALLABLE"],
    ["ALREADY_INSTALLED_ELSEWHERE", "ASSET_INSTALLED_ELSEWHERE"], ["CAPABILITY_MISSING", "PERMISSION_DENIED"]]) {
    const r = await recordWorkOrderEquipmentInstall({ workOrderId: "wo-1", serializedAssetId: unitHandle("P", "S"), idempotencyKey: "k" },
      async () => ({ ok: false, code: "PRECONDITION_FAILED", reason, message: "no" }));
    assert.equal(r.error.details, detail, reason);
  }
  const off = await fetchInstallableEquipmentForWorkOrder({ workOrderId: "wo-1" }, async () => ({ ok: false, code: "NOT_ACTIVATED", message: "baseline" }));
  assert.equal(off.error.boundary, "SERIALIZED_INSTALL");
});

test("the scanner reads serialized units and location labels from EOS; a refusal is DENIED, never empty", async () => {
  const units = await fetchSerializedUnits({ partId: "P" }, async (op, input) => {
    assert.deepEqual([op, input], ["listAvailableEquipmentUnits", { limit: 200, partId: "P" }]);
    return { ok: true, result: { units: [{ partId: "P", serialNumber: "S", status: "AVAILABLE", locationId: "bin_x" }] } };
  });
  assert.deepEqual(units.result.availableEquipment[0], { serialNo: "S", partId: "P", currentLocationId: "bin_x", inventoryState: "AVAILABLE", currentEquipmentId: null });
  assert.deepEqual(await fetchSerializedUnits({}, async () => ({ ok: false, code: "FORBIDDEN" })), { errorStatus: "permission-denied" });
  const labels = await fetchLocationLabels(["bin_x", "gone"], async () => [
    { type: "WAREHOUSE", locationId: "wh", warehouseId: "wh", name: "Main" }, { type: "BIN", locationId: "bin_x", warehouseId: "wh", code: "A1" }]);
  assert.deepEqual(labels.result.locations, [{ locationId: "bin_x", type: "WAREHOUSE", label: "Main / A1" }, { locationId: "gone", type: "UNRESOLVED", label: null }]);
});
