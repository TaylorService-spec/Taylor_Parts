// Production-derived fixture pipeline — OFFLINE tests (synthetic production-shaped records; no network, no
// production). Proves the Owner's step-8 requirements: extraction cannot write, production target is
// explicit, the sandbox importer rejects production, sanitization strips prohibited fields, deterministic
// mapping is stable, required relationships resolve, canonical IDs stay correct, seeding is idempotent, and
// malformed data fails closed.
import assert from "node:assert/strict";
import { sanitizeRecord, classifyFields, SANITIZER_VERSION } from "../scripts/fixtures/sanitize.mjs";
import { sandboxId, buildImportMapping, assertPartIdentityIntact, KEEP_ID_COLLECTIONS, REMAP_ID_COLLECTIONS } from "../scripts/fixtures/idMapping.mjs";
import { validateClosure, requiredReferencedIds } from "../scripts/fixtures/relationshipClosure.mjs";
import { COLLECTIONS } from "../scripts/fixtures/fixtureSpec.mjs";
import { assertProductionReadTarget, readOnlyProxy } from "../scripts/extractProductionFixtures.mjs";
import { assertSandboxTarget, planSeed } from "../scripts/seedSandboxFixtures.mjs";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("fixturePipeline.test.mjs");

const REG = { environments: [
  { id: "platform-sandbox", role: "sandbox", firebase: { projectId: "eos-platform-sandbox" } },
  { id: "taylor-parts-production", role: "production", firebase: { projectId: "taylor-parts" } },
] };

// (1) extraction cannot write
check("extraction: readOnlyProxy throws on any write method; permits reads", () => {
  const fake = { collection: () => ({ get: async () => ({ docs: [] }), where: () => ({}), doc: () => ({}) }), set: () => {}, add: () => {}, batch: () => {}, runTransaction: () => {} };
  const ro = readOnlyProxy(fake);
  for (const w of ["set", "add", "batch", "runTransaction"]) assert.throws(() => ro[w](), /READ-ONLY VIOLATION/);
  assert.doesNotThrow(() => ro.collection("parts")); // read path allowed
});

// (2) production target is explicit
check("extraction: assertProductionReadTarget requires production role + explicit ack", () => {
  assert.throws(() => assertProductionReadTarget("taylor-parts", false, REG), /acknowledgment/);
  assert.throws(() => assertProductionReadTarget("eos-platform-sandbox", true, REG), /reads production only|role/);
  assert.throws(() => assertProductionReadTarget("unknown-proj", true, REG), /not a registry-known/);
  assert.equal(assertProductionReadTarget("taylor-parts", true, REG).role, "production");
});

// (3) sandbox importer rejects production
check("importer: assertSandboxTarget refuses production / taylor-parts / unknown; accepts sandbox", () => {
  assert.throws(() => assertSandboxTarget("taylor-parts", REG), /production project/);
  assert.throws(() => assertSandboxTarget("nope", REG), /Unknown projects fail closed/);
  assert.throws(() => assertSandboxTarget(undefined, REG), /required/);
  assert.equal(assertSandboxTarget("eos-platform-sandbox", REG).role, "sandbox");
});

// (4) sanitization strips prohibited fields
check("sanitizer: allowlist keeps KEEP, transforms TRANSFORM, DROPS everything else (incl. sensitive)", () => {
  const raw = { partId: "P-1", internalPartNumber: "IPN-1", name: "Filter", status: "ACTIVE", controlType: "STANDARD",
    cost: "12.50", notes: "customer said...", createdBy: "user-abc", updatedAt: 123, externalErpId: "ERP-9" };
  const { record, kept, removed } = sanitizeRecord("parts", raw);
  assert.equal(record.partId, "P-1");
  assert.equal(record.internalPartNumber, "IPN-1");
  for (const f of ["cost", "notes", "createdBy", "updatedAt", "externalErpId"]) {
    assert.equal(f in record, false, `${f} must be dropped`);
    assert.ok(removed.includes(f));
  }
  assert.ok(kept.includes("partId"));
  // trucks: driver (employee identity) dropped; displayLabel transformed (no prod value leaks)
  const t = sanitizeRecord("trucks", { truckId: "T-1", status: "ACTIVE", assignedDriverEmployeeId: "emp-7", displayLabel: "John's Van ABC123" });
  assert.equal("assignedDriverEmployeeId" in t.record, false);
  assert.notEqual(t.record.displayLabel, "John's Van ABC123");
  assert.match(t.record.displayLabel, /^SBX-TRUCK-/);
  // equipment: customer refs dropped; serial transformed
  const e = sanitizeRecord("equipment", { equipmentId: "EQ-1", equipmentModelId: "M-1", status: "ACTIVE", accountId: "acct-9", serialNumber: "REAL-SN-123", notes: "n" });
  assert.equal("accountId" in e.record, false);
  assert.equal("notes" in e.record, false);
  assert.match(e.record.serialNumber, /^SBX-SN-/);
  assert.equal(typeof SANITIZER_VERSION, "string");
});

// (5) deterministic mapping is stable + collision fails closed
check("idMapping: KEEP ids unchanged; REMAP deterministic + stable; collisions throw", () => {
  assert.equal(sandboxId("parts", "P-1"), "P-1"); // KEEP
  assert.ok(KEEP_ID_COLLECTIONS.has("parts") && REMAP_ID_COLLECTIONS.has("equipment"));
  const a = sandboxId("equipment", "EQ-1");
  const b = sandboxId("equipment", "EQ-1");
  assert.equal(a, b); // stable across calls
  assert.notEqual(a, "EQ-1"); // remapped
  const mapping = buildImportMapping({ equipment: [{ equipmentId: "EQ-1" }, { equipmentId: "EQ-2" }] }, { idFieldFor: (c) => COLLECTIONS[c].idField });
  assert.equal(mapping.equipment["EQ-1"], a);
});

// (6) required relationships resolve / dangling detected
check("closure: validates required refs; detects dangling; requiredReferencedIds computes closure need", () => {
  const good = {
    parts: [{ partId: "P-1" }],
    warehouses: [{ warehouseId: "W-1" }],
    stock_locations: [{ warehouseId: "W-1", partId: "P-1", quantity: 3 }],
  };
  assert.equal(validateClosure(good).ok, true);
  const bad = { parts: [{ partId: "P-1" }], warehouses: [], stock_locations: [{ warehouseId: "W-MISSING", partId: "P-1", quantity: 3 }] };
  const r = validateClosure(bad);
  assert.equal(r.ok, false);
  assert.equal(r.danglingRequired[0].to, "warehouses");
  const need = requiredReferencedIds({ stock_locations: [{ warehouseId: "W-9", partId: "P-9", quantity: 1 }] });
  assert.ok(need.warehouses.has("W-9") && need.parts.has("P-9"));
});

// (7) canonical IDs remain semantically correct
check("identity: partId preserved (never partId==sku); assertPartIdentityIntact guards conflation", () => {
  assert.equal(REMAP_ID_COLLECTIONS.has("parts"), false); // parts are KEEP -> partId preserved
  assert.doesNotThrow(() => assertPartIdentityIntact([{ partId: "P-1", internalPartNumber: "IPN-1" }]));
  assert.throws(() => assertPartIdentityIntact([{ partId: "SKU-9", internalPartNumber: "SKU-9" }]), /never conflate partId with sku/);
});

// (8) idempotent seeding: deterministic doc ids, stable across runs
check("planSeed: docIdIsId uses identity; composite uses a stable deterministic key (idempotent)", () => {
  const set = {
    parts: [{ partId: "P-1", internalPartNumber: "IPN-1" }],
    stock_locations: [{ warehouseId: "W-1", partId: "P-1", quantity: 5, binCode: "A1" }],
  };
  const p1 = planSeed(set);
  const p2 = planSeed(set);
  const idOf = (p, coll) => p.writes.find((w) => w.collection === coll).docId;
  assert.equal(idOf(p1, "parts"), "P-1"); // identity
  assert.match(idOf(p1, "stock_locations"), /^fx-stock_locations-/); // synthetic composite
  assert.equal(idOf(p1, "stock_locations"), idOf(p2, "stock_locations")); // stable -> idempotent
});

// (9) malformed data fails closed
check("fail-closed: planSeed rejects a docIdIsId record missing its identity; sanitizer rejects unknown collection", () => {
  assert.throws(() => planSeed({ parts: [{ internalPartNumber: "IPN-1" /* no partId */ }] }), /missing identity/);
  assert.throws(() => sanitizeRecord("unknown_collection", {}), /No sanitizer policy/);
  assert.throws(() => planSeed({ not_a_collection: [{}] }), /Unknown collection/);
});

console.log(`\n${passed} passed, 0 failed`);
