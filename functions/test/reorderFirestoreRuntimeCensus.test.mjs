// The runtime census's proof.
//
// The census must not be satisfiable by forgetting a file, and -- the defect that made its first
// version wrong -- it must not be satisfiable by a consumer reaching a Firebase callable THROUGH A
// WRAPPER. So the derivation follows IMPORTS, not just names.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REORDER_LEGACY_RUNTIME_CENSUS, RUNTIME_CLASSIFICATIONS, REORDER_LEGACY_OBJECTS,
  ACTIVATION_BLOCKING, reorderRuntimeActivationReadiness,
} from "../lib/eosOps/migration/reorderFirestoreRuntimeCensus.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const walk = (d, o = []) => {
  try {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      statSync(p).isDirectory() ? walk(p, o) : /\.(ts|tsx|js|jsx|mjs|rules)$/.test(e) && o.push(p);
    }
  } catch { /* a missing root is not a consumer */ }
  return o;
};
const rel = (f) => relative(REPO, f).split("\\").join("/");
const SELF = "functions/src/eosOps/migration/reorderFirestoreRuntimeCensus.ts";

/** The Reorder Firebase callables. Reaching ANY of these from the client is a legacy consumer. */
const REORDER_CALLABLES = ["createReorderRequest", "recordReorderPurchaseOrder", "listReorderWarehouseOptions"];

/**
 * (path, OBJECT) -> occurrences. NOT (path) -> occurrences.
 *
 * THE KEY IS THE WHOLE POINT. The previous version keyed by path alone, so a file touching two
 * collections got ONE row -- and `receiveInventoryStockCommand.ts`, which reads a purchase order
 * AND writes the Reorder Request, was recorded as a purchase-order read while its live Firestore
 * Reorder WRITE went unrecorded. Emitting a pair per object makes that impossible to express.
 */
const COLLECTION_OBJECT = Object.freeze({
  reorder_requests: "REORDER_REQUEST",
  reorder_purchase_orders: "PURCHASE_ORDER",
  reorder_purchase_order_voids: "PURCHASE_ORDER_VOID",
});

function derive() {
  const files = [];
  for (const r of ["functions/src", "field-ops-app-vite/src"]) walk(join(REPO, r), files);
  files.push(join(REPO, "firestore.rules"));
  const found = new Map();
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    const path = rel(f);
    if (path === SELF) continue;
    for (const [collection, object] of Object.entries(COLLECTION_OBJECT)) {
      const re = new RegExp(`(eos_ops\\.|\\$\\{SCHEMA\\}\\.)?\\b${collection}\\b`, "g");
      let n = 0, m;
      while ((m = re.exec(src))) if (!m[1]) n += 1;
      if (n > 0) found.set(`${path}|${object}`, n);
    }
  }
  return found;
}

/**
 * Every CLIENT module that reaches a Reorder Firebase callable, however many wrappers deep.
 *
 * THE INDIRECTION THE FIRST CENSUS MISSED. A module that calls `fetchReorderWarehouseOptions` is a
 * consumer of `listReorderWarehouseOptions` even though it never names it, so the search starts at
 * the modules that name a callable and walks IMPORTERS outward to a fixed point.
 */
function deriveCallableConsumers(injected) {
  const texts = injected ?? new Map(
    walk(join(REPO, "field-ops-app-vite/src")).map((f) => [rel(f), strip(readFileSync(f, "utf8"))]));

  // Seed: modules that invoke a Reorder callable by name through the Firebase functions SDK.
  const reaching = new Set();
  for (const [path, src] of texts) {
    if (/httpsCallable|firebase\/functions/.test(src) && REORDER_CALLABLES.some((c) => src.includes(c))) {
      reaching.add(path);
    }
  }
  // Closure: anyone importing a module that reaches, reaches.
  for (let changed = true; changed;) {
    changed = false;
    for (const [path, src] of texts) {
      if (reaching.has(path)) continue;
      for (const target of reaching) {
        // Match the import by basename, which is how these modules reference each other.
        const base = target.split("/").pop().replace(/\.(js|jsx|ts|tsx)$/, "");
        if (new RegExp(`from\\s+["'][^"']*\\b${base}(\\.js|\\.jsx|\\.ts|\\.tsx)?["']`).test(src)) {
          reaching.add(path);
          changed = true;
          break;
        }
      }
    }
  }
  return reaching;
}

const derived = derive();
const byPath = new Map(REORDER_LEGACY_RUNTIME_CENSUS.map((c) => [`${c.path}|${c.object}`, c]));

test("the census and the repository name exactly the same (file, OBJECT) pairs", () => {
  assert.deepEqual([...byPath.keys()].sort(), [...derived.keys()].sort(),
    "a consumer appeared or disappeared: classify the new one, or remove the entry whose file no longer reaches that collection");
  assert.equal(byPath.size, REORDER_LEGACY_RUNTIME_CENSUS.length, "a (path, object) pair is listed twice");
});

test("a file touching two objects has two entries -- the defect this key exists to prevent", () => {
  // receiveInventoryStockCommand.ts READS a purchase order and WRITES the Reorder Request. Under a
  // one-row-per-file census the read was recorded and the write vanished, and the activation gate
  // read ZERO runtime consumers while a live Firestore Reorder writer sat in the receiving path.
  const receiving = [...byPath.keys()].filter((k) => k.startsWith("functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|"));
  assert.deepEqual(receiving.sort(), [
    "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|PURCHASE_ORDER",
    "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|REORDER_REQUEST",
  ]);
  const reorderSide = byPath.get("functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|REORDER_REQUEST");
  assert.equal(reorderSide.classification, "FIRESTORE_RUNTIME_WRITE",
    "the legacy ORDERED -> RECEIVED transition is a WRITE, and classifying it as a read hid it");
  // And the claim is checked against the source, not taken on trust.
  const src = strip(readFileSync(join(REPO, "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts"), "utf8"));
  assert.match(src, /status:\s*RECEIVED/, "the legacy transition write is no longer present -- reclassify it");
});

test("every recorded occurrence count is the real one", () => {
  for (const [key, count] of derived) {
    assert.equal(byPath.get(key).occurrences, count, `${key} records the wrong occurrence count`);
  }
});

test("NO CLIENT MODULE reaches a Reorder Firebase callable, directly or through any wrapper", () => {
  // THE CORRECTION. The first census asked only whether a file named `submitCreateReorderRequest`,
  // and missed `fetchReorderWarehouseOptions` -> `listReorderWarehouseOptions`, which a hook and a
  // dashboard were both using. This walks importers to a fixed point instead.
  const consumers = [...deriveCallableConsumers()].sort();
  assert.deepEqual(consumers, [],
    `these client modules still reach a Reorder Firebase callable: ${consumers.join(", ")}`);
});

test("the indirection walk actually works -- this is what makes the emptiness above mean something", () => {
  // WITHOUT THIS, THE TEST ABOVE IS VACUOUS. The callable transport has been deleted, so the seed
  // set is empty and the closure would report "no consumers" even if the walk were broken. This
  // runs the same function over a synthetic two-hop tree: a transport that names the callable, a
  // wrapper that imports it and names nothing, and a screen that imports the wrapper.
  const synthetic = new Map([
    ["src/services/legacyTransport.js",
      'import { httpsCallable } from "firebase/functions";\nexport const go = () => httpsCallable(fns, "listReorderWarehouseOptions");'],
    ["src/hooks/useThing.js", 'import { go } from "../services/legacyTransport.js";\nexport const useThing = () => go();'],
    ["src/screens/Screen.jsx", 'import { useThing } from "../hooks/useThing.js";\nexport const S = () => useThing();'],
    ["src/unrelated/Other.jsx", 'export const O = () => null;'],
  ]);
  const found = [...deriveCallableConsumers(synthetic)].sort();
  assert.deepEqual(found, [
    "src/hooks/useThing.js",
    "src/screens/Screen.jsx",
    "src/services/legacyTransport.js",
  ], "the walk must reach a consumer two wrappers away, and must not sweep in unrelated modules");
});

test("the retired callable transport is gone, not merely unused", () => {
  // An unused wrapper round a Firebase callable is a second authority one import away.
  assert.ok(!existsSync(join(REPO, "field-ops-app-vite/src/services/reorderCallableClient.js")),
    "the Firebase callable transport must not exist");
});

test("the schema qualifier really is what separates PostgreSQL from Firestore", () => {
  for (const pg of [
    "functions/src/eosOps/reorderLifecycleCommands.ts",
    "functions/src/eosOps/purchasingRepository.ts",
    "functions/src/eosOps/reorderAssignmentAuthority.ts",
  ]) {
    assert.ok(![...derived.keys()].some((k) => k.startsWith(`${pg}|`)),
      `${pg} is PostgreSQL and must not count as a Firestore consumer`);
  }
});

test("every entry is classified from the closed vocabulary and names its object", () => {
  for (const c of REORDER_LEGACY_RUNTIME_CENSUS) {
    assert.ok(RUNTIME_CLASSIFICATIONS.includes(c.classification), `${c.path}: ${c.classification}`);
    assert.ok(REORDER_LEGACY_OBJECTS.includes(c.object), `${c.path}: ${c.object}`);
    assert.ok(c.consumer.trim().length > 0, `${c.path} says nothing about what it does`);
    assert.ok(Number.isInteger(c.occurrences) && c.occurrences > 0);
  }
});

test("the client no longer reaches Firestore for any Reorder Request lifecycle action", () => {
  for (const converted of [
    "field-ops-app-vite/src/hooks/useReorderRequests.js",
    "field-ops-app-vite/src/domain/inventoryReorderRequests.js",
    "field-ops-app-vite/src/domain/reorderPurchaseOrders.js",
    "field-ops-app-vite/src/modules/inventory/PartDetail.jsx",
    "field-ops-app-vite/src/hooks/useReorderWarehouseOptions.js",
  ]) {
    assert.ok(![...derived.keys()].some((k) => k.startsWith(`${converted}|`)),
      `${converted} still reaches a Firestore Reorder collection`);
  }
});

test("an exported Firebase callable is DEPLOYED legacy authority, never DEAD", () => {
  const callables = byPath.get("functions/src/reorderRequest/reorderCallables.ts|REORDER_REQUEST");
  assert.equal(callables.classification, "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    "a callable with no repository callers is still deployed and externally invokable; DEAD would be a lie");
  // The claim is checked: it must actually still be exported from the Functions entry point.
  const index = strip(readFileSync(join(REPO, "functions/src/index.ts"), "utf8"));
  for (const name of REORDER_CALLABLES) {
    assert.ok(index.includes(name), `${name} is no longer exported -- reclassify it as retired`);
  }
});

test("THE HARD GATE: activation requires ZERO Reorder runtime consumers of any kind", () => {
  const readiness = reorderRuntimeActivationReadiness();
  // NOT READY, and the honest reason: the receiving path still writes the Firestore Reorder Request
  // on an ORDERED -> RECEIVED receipt. The previous census reported ZERO here, which was the whole
  // defect -- a gate that measures the wrong key reads green over a live writer.
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockedBy,
    ["functions/src/inventoryReceiving/receiveInventoryStockCommand.ts"]);
  assert.equal(readiness.runtimeConsumerCount, 1);

  // ACTIVATION IS NOT RETIREMENT. The deployed callables additionally block the Firebase
  // retirement, which is a later step, and the two must not be read as one.
  assert.equal(readiness.firebaseRetired, false);
  assert.ok(readiness.firebaseRetirementBlockedBy.includes("functions/src/reorderRequest/reorderCallables.ts"));

  // The purchase-order surface is REPORTED and deliberately outside this gate.
  assert.ok(readiness.purchaseOrderRuntimeConsumers.length > 0,
    "the purchase-order object's consumers must be reported, never zero by omission");

  // The gate is DERIVED, not asserted: with the blocking entries removed it opens, and ONE
  // reintroduced consumer of any blocking kind closes it again.
  const cleared = REORDER_LEGACY_RUNTIME_CENSUS.filter((c) =>
    !(c.object === "REORDER_REQUEST" && ACTIVATION_BLOCKING.includes(c.classification)));
  assert.equal(reorderRuntimeActivationReadiness(cleared).ready, true);
  for (const classification of ACTIVATION_BLOCKING) {
    assert.equal(reorderRuntimeActivationReadiness([...cleared, {
      path: "x/live.js", object: "REORDER_REQUEST", classification, consumer: "x", occurrences: 1,
    }]).ready, false, `a single ${classification} must hold activation shut on its own`);
  }
});

test("neither migration evidence nor the Rules authority can ever hold the gate shut", () => {
  const excused = REORDER_LEGACY_RUNTIME_CENSUS.filter((c) =>
    c.classification === "MIGRATION_EVIDENCE" || c.classification === "RULES_AUTHORITY");
  assert.ok(excused.length > 0);
  assert.equal(reorderRuntimeActivationReadiness(excused).ready, true,
    "evidence reaches nothing and the Rules are retired at the deployment step");
});
