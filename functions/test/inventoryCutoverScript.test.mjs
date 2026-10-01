// The Inventory baseline cutover operator tool (scripts/inventoryCutover.js): its fence and its snapshot decoding, OFFLINE
// (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01). The COPY / VERIFY / CERTIFY behaviour itself is proven
// against PostgreSQL by inventoryWarehouseJourneyPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const tool = require("../scripts/inventoryCutover.js");

test("the fence: a mode, a named tenant, a snapshot file and a manifest are required; copy / certify need an EOS principal", () => {
  const env = { EOS_ENVIRONMENT: "nonprod", X: "postgres://u@h/db" };
  const base = { environment: "platform-sandbox", databaseUrlEnv: "X", tenantKey: "taylor-nonprod", snapshot: "s.json", manifest: "m.json" };
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "repair" }, env), /--mode/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "census", tenantKey: undefined }, env), /tenantKey/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "census", snapshot: undefined }, env), /snapshot/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "census", manifest: undefined }, env), /manifest/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "copy" }, env), /principalId/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "certify" }, env), /principalId/);
  assert.throws(() => tool.assertInventoryCutoverInvocation({ ...base, mode: "census", environment: "platform-certification" }, env), /frozen|Certification|not/i);
});

test("the snapshot: Firestore Timestamp tags decode to epoch millis; every collection the cutover needs must be present", () => {
  assert.equal(tool.decodeTimestamps({ $timestamp: { seconds: 1700000000, nanoseconds: 5_000_000 } }), 1700000000005);
  assert.deepEqual(tool.decodeTimestamps({ a: [{ $timestamp: { seconds: 1, nanoseconds: 0 } }], b: "x" }), { a: [1000], b: "x" });
  const raw = { format: "EOS_INVENTORY_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox" },
    inventoryTransactions: [], serializedAssets: [], warehouses: [], cycleCounts: [], transferOrders: [] };
  assert.equal(tool.parseInventorySnapshot(raw, "f".repeat(64)).snapshot.sha256, "f".repeat(64));
  const { serializedAssets: _s, ...old } = raw;
  assert.throws(() => tool.parseInventorySnapshot(old, "f".repeat(64)), /serializedAssets/);
});

test("STRUCTURAL: the tool loads no Firebase module and names no Firestore write", () => {
  const src = readFileSync(new URL("../scripts/inventoryCutover.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /require\(["']firebase-admin|from ["']firebase-admin|firebase-functions/);
  assert.doesNotMatch(src, /\.(set|update|delete|add)\(\s*\{/);
  const mod = readFileSync(new URL("../src/eosOps/migration/inventoryBaselineCutover.ts", import.meta.url), "utf8");
  assert.doesNotMatch(mod, /firebase-admin|firebase-functions|getFirestore/);
});
