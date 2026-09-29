// OPERATOR SCRIPTS MAY NOT WRITE THE FROZEN FIRESTORE CATALOG / REORDER SOURCE COLLECTIONS.
//
// The runtime writers refuse through the committed freeze constants (catalogWriterState.ts,
// reorderSourceFreeze.ts), but a seed, fixture or backfill script writing straight through the Admin SDK
// goes round all of them -- Firestore Rules do not constrain the Admin SDK. Each script below now asks
// scripts/sourceCollectionFreeze.js first. Proven here WITHOUT a live target: against injected stores, the
// scripts' exported planning/gate functions, and their source. No test here connects to any project.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const freeze = require("../scripts/sourceCollectionFreeze.js");
const { CATALOG_WRITER_AUTHORITY } = require("../lib/catalogMaster/catalogWriterState.js");
const { REORDER_SOURCE_FROZEN } = require("../lib/reorderRequest/reorderSourceFreeze.js");

const CATALOG = ["parts", "equipment_models", "part_aliases", "manufacturers", "suppliers", "part_supplier_items",
  "equipment_model_aliases", "equipment_part_compatibility", "equipment_compatibility_sources", "supplier_catalog"];
const REORDER = ["reorder_requests", "reorder_purchase_orders", "reorder_purchase_order_voids"];

test("the gate names exactly the Owner's Catalog and Reorder collections and reads only the committed constants", () => {
  assert.deepEqual([...freeze.CATALOG_SOURCE_COLLECTIONS].sort(), [...CATALOG].sort());
  assert.deepEqual([...freeze.REORDER_SOURCE_COLLECTIONS].sort(), [...REORDER].sort());
  // The committed state this activation runs under.
  assert.equal(CATALOG_WRITER_AUTHORITY.firestore, "FROZEN");
  assert.equal(REORDER_SOURCE_FROZEN, true);
  for (const c of [...CATALOG, ...REORDER]) {
    assert.ok(freeze.frozenSourceReason(c), `${c} must be refused`);
    assert.throws(() => freeze.assertSourceCollectionWritable(c, "t"), (e) => e.code === "FROZEN_SOURCE_COLLECTION" && e.collection === c);
  }
  for (const c of ["warehouses", "accounts", "locations", "contacts", "equipment", "fieldops_wos", "purchase_orders",
    "inventory_transactions", "transfer_orders", "sales_orders", "receiving_orders", "employees"]) {
    assert.equal(freeze.frozenSourceReason(c), null, `${c} is not a frozen source collection`);
  }
  // NO override: the gate takes the collection (and a label) and nothing that could reopen it.
  assert.equal(freeze.frozenSourceReason.length, 1);
  assert.equal(freeze.assertSourceCollectionWritable.length, 2);
});

test("seedOperationsDemoData: suppliers and supplier_catalog are skipped; the rest of the pack is written", async () => {
  const cli = require("../scripts/seedOperationsDemoData.js");
  const written = [];
  const db = {
    collection: (name) => ({ doc: (id) => ({ id, __collection: name }) }),
    batch: () => ({ set: (ref) => written.push(ref.__collection), commit: async () => {} }),
  };
  await cli.seed({ db, Timestamp: { now: () => 0, fromMillis: () => 0 } });
  for (const c of ["suppliers", "supplier_catalog"]) assert.ok(!written.includes(c), `${c} was written`);
  for (const c of ["warehouses", "inventory_transactions", "transfer_orders", "purchase_orders"]) {
    assert.ok(written.includes(c), `${c} should still be seeded`);
  }
});

test("seedSandboxPerformanceStory: the Reorder source is skipped and counted as skipped, never as written", async () => {
  const { applyScenario, buildScenarioSpec } = await import("../scripts/seedSandboxPerformanceStory.mjs");
  const spec = buildScenarioSpec({ nowMillis: Date.UTC(2026, 8, 28) });
  assert.ok(spec.reorderRequests.length > 0 && spec.purchaseOrders.length > 0, "the story still declares its reorder chain");
  const touched = [];
  const db = { collection: (name) => { touched.push(name); return { doc: () => ({ set: async () => {} }) }; } };
  const counts = await applyScenario(db, spec, { dryRun: true });
  assert.equal(counts.reorder_requests, undefined);
  assert.equal(counts.reorder_purchase_orders, undefined);
  assert.equal(counts["skipped:reorder_requests"], spec.reorderRequests.length);
  assert.equal(counts["skipped:reorder_purchase_orders"], spec.purchaseOrders.length);
  assert.ok(counts.fieldops_wos > 0, "work orders are still seeded");
  assert.ok(!touched.includes("reorder_requests") && !touched.includes("reorder_purchase_orders"));
});

test("certificationWorld: a live reset or rebuild is refused while the world includes frozen collections", async () => {
  const cw = await import("../scripts/certificationWorld.mjs");
  const frozen = cw.frozenWorldCollections().map((f) => f.collection).sort();
  assert.ok(frozen.includes("parts") && frozen.includes("equipment_models"), `frozen: ${frozen.join(", ")}`);
  const src = readFileSync(new URL("../scripts/certificationWorld.mjs", import.meta.url), "utf8");
  // Refused BEFORE connecting, and again at each write site whoever calls it.
  const mainAt = src.indexOf("async function main()");
  assert.ok(src.indexOf("frozenWorldCollections()", mainAt) < src.indexOf("initializeApp(", mainAt));
  assert.match(src, /if \(!opts\.dryRun\) assertWorldWritable\(\);/);
  assert.match(src, /assertWorldWritable\(\); \/\/ before any write/);
});

test("migrateEquipmentModelIdentity: an APPLY is refused before connecting; a dry run is not", async () => {
  const m = await import("../scripts/certificationWorld/migrateEquipmentModelIdentity.mjs");
  assert.throws(() => m.assertModelMigrationApplyWritable(), (e) => e.code === "FROZEN_SOURCE_COLLECTION" && e.collection === "equipment_models");
  const src = readFileSync(new URL("../scripts/certificationWorld/migrateEquipmentModelIdentity.mjs", import.meta.url), "utf8");
  const mainAt = src.indexOf("async function main(t)");
  assert.ok(src.indexOf("if (t.apply) assertModelMigrationApplyWritable();", mainAt) < src.indexOf("initializeApp(", mainAt));
});

test("backfillOperationalNumbering: reorder_requests is refused at --write and at the write itself; other families are not", async () => {
  const b = await import("../scripts/backfillOperationalNumbering.mjs");
  assert.ok(b.frozenFamilyReason("reorderRequest"));
  for (const f of ["salesOrder", "transferOrder", "receivingOrder"]) assert.equal(b.frozenFamilyReason(f), null, f);
  const src = readFileSync(new URL("../scripts/backfillOperationalNumbering.mjs", import.meta.url), "utf8");
  const assignAt = src.indexOf("async function assignOne(");
  assert.ok(src.indexOf("assertSourceCollectionWritable(family.collection", assignAt) < src.indexOf("runTransaction", assignAt));
});

test("seedSandboxBaseline: the one write path refuses a frozen collection, and the Catalog loops are skipped", () => {
  // main() runs on require (no import guard), so this script is proven from its source.
  const src = readFileSync(new URL("../scripts/seedSandboxBaseline.js", import.meta.url), "utf8");
  const upsertAt = src.indexOf("async function upsert(");
  assert.ok(upsertAt > 0);
  assert.ok(src.indexOf('assertSourceCollectionWritable(collection, "seedSandboxBaseline.js")', upsertAt)
    < src.indexOf(".set(data", upsertAt), "the freeze assertion must precede the write");
  assert.match(src, /frozenSourceCollections\(\["suppliers", "parts", "part_supplier_items"\]\)/);
  assert.match(src, /for \(const s of catalogWritable \? SUPPLIERS : \[\]\)/);
  assert.match(src, /for \(const p of catalogWritable \? PARTS : \[\]\)/);
});
