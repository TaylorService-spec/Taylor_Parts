// BIN-P4 -- relocation activation and the two functional Roles (Owner ruling B1, Decision #178).
//
// Every decision below goes through the REAL resolver with the REAL Role catalog and the REAL
// per-environment activation registry -- the same three inputs the deployed callables use. The last
// block drives the governed relocateStock command on the emulator with that resolver as its
// authority, so "holder of both can put away" is proved against the command, not asserted about it.
//
// Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/binP4RelocationRoles.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts-emulator" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { resolveCapabilityOverrides, ENVIRONMENT_ACTIVATION_REGISTRY } = await import("../lib/access/environmentCapabilityOverrides.js");
const { PERMISSION_CATALOG } = await import("../lib/access/permissionCatalog.js");
const { relocateStock } = await import("../lib/inventoryLocation/stockRelocationCommand.js");
const { BIN_SCHEMA_VERSION } = await import("../lib/inventoryLocation/binRegistry.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const SANDBOX = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "eos-platform-sandbox");
const PRODUCTION = resolveCapabilityOverrides(ENVIRONMENT_ACTIVATION_REGISTRY, "taylor-parts");
const RELOCATE = "inventory.stock.relocate";
const PLACE = "inventory.placement.record";
const TRANSFER = ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"];

const decide = (permissionId, roleIds, overrides = SANDBOX) => resolveEffectivePermission({
  permissionId,
  assignments: roleIds.map((roleId) => ({
    id: `a-${roleId}`, principalUid: "p1", roleId, scope: { type: "global" }, status: "active", accessVersionAtGrant: 1,
  })),
  roles: ROLES,
  currentAccessVersion: 1,
  target: { scope: { type: "global" }, condition: {} },
  activationOverrides: overrides,
}).decision;

// ---------------------------------------------------------------- activation
await check("relocate stays active:false in the catalog", () => {
  assert.equal(PERMISSION_CATALOG.find((p) => p.id === RELOCATE).active, false);
});
await check("relocate is ACTIVE in platform-sandbox", () => {
  assert.ok(SANDBOX.has(RELOCATE));
  assert.equal(decide(RELOCATE, ["inventoryStockRelocationOperator"]), "ALLOW");
});
await check("relocate is INACTIVE in production -- even for the Role that carries it, and for admin", () => {
  assert.equal(PRODUCTION.has(RELOCATE), false);
  assert.equal(decide(RELOCATE, ["inventoryStockRelocationOperator"], PRODUCTION), "DENY");
  assert.equal(decide(RELOCATE, ["admin"], PRODUCTION), "DENY");
});
await check("no production registry entry declares relocate", () => {
  for (const env of ENVIRONMENT_ACTIVATION_REGISTRY.environments.filter((e) => e.role === "production")) {
    assert.ok(!(env.capabilityActivationOverrides ?? []).includes(RELOCATE));
  }
});

// ---------------------------------------------------------------- Role content
await check("relocation Role carries exactly bin.read + alias.read + relocate", () => {
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.inventoryStockRelocationOperator.permissions].sort(),
    ["inventory.catalog.alias.read", "inventory.location.bin.read", RELOCATE].sort());
  assert.equal(GOVERNED_BUSINESS_ROLES.inventoryStockRelocationOperator.privileged, false);
});
await check("receiver Role carries exactly inventory.transfer.receive", () => {
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.inventoryTransferReceiver.permissions], ["inventory.transfer.receive"]);
  assert.equal(GOVERNED_BUSINESS_ROLES.inventoryTransferReceiver.privileged, false);
});
await check("Transfer Operator is unchanged and does NOT carry relocate", () => {
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.inventoryTransferOperator.permissions], TRANSFER);
  assert.equal(decide(RELOCATE, ["inventoryTransferOperator"]), "DENY");
});
await check("Put-away Role content is unchanged", () => {
  assert.deepEqual([...GOVERNED_BUSINESS_ROLES.inventoryPutAwayOperator.permissions], ["inventory.location.bin.read", PLACE]);
});

// ---------------------------------------------------------------- authority decisions (sandbox)
await check("a position / job title alone grants nothing", () => {
  for (const position of ["warehouseAssociate", "partsAssociate", "warehouseManager", "partsManager", "technician"]) {
    assert.equal(decide(RELOCATE, [position]), "DENY", `${position} must not relocate`);
    assert.equal(decide("inventory.transfer.receive", [position]), "DENY", `${position} must not receive`);
  }
});
await check("relocation Role grants relocate but no Transfer create/dispatch/cancel/receive and no placement", () => {
  const r = ["inventoryStockRelocationOperator"];
  assert.equal(decide(RELOCATE, r), "ALLOW");
  for (const cap of TRANSFER) assert.equal(decide(cap, r), "DENY", cap);
  assert.equal(decide(PLACE, r), "DENY");
  assert.equal(decide("inventory.location.bin.manage", r), "DENY");
  assert.equal(decide("inventory.stock.receive", r), "DENY");
  assert.equal(decide("inventory.cycleCount.create", r), "DENY");
});
await check("Put-away Role alone cannot relocate", () => {
  assert.equal(decide(RELOCATE, ["inventoryPutAwayOperator"]), "DENY");
  assert.equal(decide(PLACE, ["inventoryPutAwayOperator"]), "ALLOW");
});
await check("technician + receiver can receive but not create, dispatch or cancel", () => {
  const r = ["technician", "inventoryTransferReceiver"];
  assert.equal(decide("inventory.transfer.receive", r), "ALLOW");
  for (const cap of ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.cancel"]) {
    assert.equal(decide(cap, r), "DENY", cap);
  }
  assert.equal(decide(RELOCATE, r), "DENY");
});

// ---------------------------------------------------------------- the command, with the real resolver as its authority
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const ts = Timestamp.fromDate(new Date(1_700_000_000_000));

async function seedWarehouseWithStock(qty) {
  const wh = nextId("wh");
  await db.collection("warehouses").doc(wh).set({ id: wh, name: wh, location: "x", status: "ACTIVE", version: 1, updatedAt: ts, updatedBy: "seed", provenance: "NATIVE", createdAt: ts, createdBy: "seed" });
  const bin = `bin_${String(runId).slice(-10)}${String((seq += 1)).padStart(30, "0")}`;
  await db.collection("bins").doc(bin).set({ warehouseId: wh, area: "PARTS_ROOM", aisle: "A", bay: 1, position: seq, code: `A01-${String(seq).padStart(3, "0")}`, name: null, status: "ACTIVE", version: 1, schemaVersion: BIN_SCHEMA_VERSION, idempotencyKey: nextId("bk"), fingerprint: "0".repeat(16) });
  const partId = nextId("part");
  await db.collection("inventory_transactions").doc(nextId("rcv")).set({
    schemaVersion: 2, type: "RECEIVED", direction: "IN", partId, trackingMode: "NONE", location: { type: "WAREHOUSE", locationId: wh },
    quantity: qty, sourceObject: { type: "RECEIVING_ORDER", id: nextId("ro") }, idempotencyKey: nextId("k"),
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" }, occurredAt: ts.toMillis(), recordedAt: ts, fingerprint: "0".repeat(16),
  });
  return { wh, bin, partId };
}
const depsFor = (roleIds) => ({
  db, actor: { kind: "USER", id: nextId("op") },
  authorize: async (_txn, _db, _actor, capability) => decide(capability, roleIds) === "ALLOW",
  resolvePart: async (_t, _d, id) => ({ partId: id, trackingMode: "NONE", active: true }),
  stageAudit: () => {}, now: () => new Date(),
});
const putAway = ({ wh, bin, partId }) => ({
  partId, source: { type: "WAREHOUSE", locationId: wh }, destination: { type: "BIN", locationId: bin },
  quantity: 2, idempotencyKey: nextId("k"), recordPlacement: true,
});
async function refusal(promise) {
  try { await promise; return null; } catch (err) { return `${err.code}:${err.reason}`; }
}

await check("COMMAND: holder of put-away + relocation performs an authoritative put-away", async () => {
  const s = await seedWarehouseWithStock(5);
  const out = await relocateStock(putAway(s), depsFor(["warehouseAssociate", "inventoryPutAwayOperator", "inventoryStockRelocationOperator"]));
  assert.equal(out.outcome, "relocated");
  assert.equal(out.placementIds.length, 1);
});
await check("COMMAND: put-away Role alone is refused the movement", async () => {
  const s = await seedWarehouseWithStock(5);
  assert.equal(await refusal(relocateStock(putAway(s), depsFor(["inventoryPutAwayOperator"]))), "DENIED:relocate_not_authorized");
});
await check("COMMAND: relocation Role alone cannot record placement", async () => {
  const s = await seedWarehouseWithStock(5);
  assert.equal(await refusal(relocateStock(putAway(s), depsFor(["inventoryStockRelocationOperator"]))), "DENIED:placement_not_authorized");
  const out = await relocateStock({ ...putAway(s), recordPlacement: false }, depsFor(["inventoryStockRelocationOperator"]));
  assert.equal(out.outcome, "relocated", "the same Role may relocate without claiming a placement");
});
await check("COMMAND: an unauthorized technician is refused", async () => {
  const s = await seedWarehouseWithStock(5);
  assert.equal(await refusal(relocateStock({ ...putAway(s), recordPlacement: false }, depsFor(["technician", "inventoryTransferReceiver"]))), "DENIED:relocate_not_authorized");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
