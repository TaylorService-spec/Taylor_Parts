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
  ACTIVATION_BLOCKING, RETIREMENT_BLOCKING, reorderRuntimeActivationReadiness,
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
 * A callable that is a Reorder WRITER FOR ONE SOURCE TYPE ONLY.
 *
 * `receiveInventoryStock` moves the Firestore Reorder Request to RECEIVED for a REORDER_PURCHASE_ORDER
 * source (in the Functions deployed in nonprod, which pre-date the freeze) and writes no Reorder object
 * for the canonical PURCHASE_ORDER source. So a client transport of it is a Reorder consumer exactly when
 * it can put a REORDER_PURCHASE_ORDER source on the wire: it names that source, or it calls the legacy
 * single-line builder (domain/receivingTransport.js buildReceiveRequest), which only ever produces it.
 */
const SOURCE_CONDITIONAL_CALLABLES = [
  { callable: "receiveInventoryStock", reorderSource: /\bREORDER_PURCHASE_ORDER\b|\bbuildReceiveRequest\s*\(/ },
];

const importsAny = (src, targets) => [...targets].some((target) => {
  const base = target.split("/").pop().replace(/\.(js|jsx|ts|tsx)$/, "");
  return new RegExp(`from\\s+["'][^"']*\\b${base}(\\.js|\\.jsx|\\.ts|\\.tsx)?["']`).test(src);
});

/**
 * Every client TRANSPORT of a source-conditional callable, and whether it can send a Reorder source.
 *
 * A transport is a module that invokes a Firebase callable AND names the callable -- directly, or through
 * a module it imports that names it (the CALLABLE_NAMES table in domain/receivingTransport.js is exactly
 * that indirection, and a name match on the transport alone never saw it).
 */
function deriveReceivingTransports(texts) {
  const out = [];
  for (const { callable, reorderSource } of SOURCE_CONDITIONAL_CALLABLES) {
    const namers = new Set([...texts].filter(([, src]) => src.includes(`"${callable}"`)).map(([p]) => p));
    for (const [path, src] of texts) {
      if (!/httpsCallable|firebase\/functions/.test(src)) continue;
      if (!src.includes(`"${callable}"`) && !importsAny(src, namers)) continue;
      out.push({ path, callable, reorderSourceReachable: reorderSource.test(src) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

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

/**
 * THE CONSTANT INDIRECTION -- the second hole this census had.
 *
 * The client names its Reorder collections through constants in domain/constants.js
 * (PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders", ...). A module that imports one and USES it
 * reads that collection as surely as one that spells the name, and the literal-only derivation counted
 * none of them -- it saw the declaration in constants.js, called it DEAD, and missed every hook that read
 * reorder_purchase_orders and reorder_purchase_order_voids through it.
 */
const CONSTANTS_PATH = "field-ops-app-vite/src/domain/constants.js";

/** constant name -> Reorder object, read from the declaration itself so a renamed constant is followed. */
function collectionConstants(constantsSrc = strip(readFileSync(join(REPO, CONSTANTS_PATH), "utf8"))) {
  const out = {};
  for (const m of constantsSrc.matchAll(/export\s+const\s+(\w+)\s*=\s*"(\w+)"/g)) {
    if (COLLECTION_OBJECT[m[2]]) out[m[1]] = COLLECTION_OBJECT[m[2]];
  }
  return out;
}

/**
 * object -> occurrences of the Reorder collection constants a module imports FROM domain/constants.js and
 * uses outside its import statements. Named imports (aliased or not) and namespace imports are followed;
 * a module-local constant that happens to share a name (operationsQueries' dormant `purchase_orders`) is
 * not, because it is not imported from the constants module.
 */
function constantUses(path, src, constants) {
  const counts = new Map();
  const isConstantsModule = (spec) => {
    if (!spec.startsWith(".")) return false;
    const target = relative(REPO, resolve(REPO, dirname(path), spec)).split("\\").join("/").replace(/\.js$/, "");
    return target === CONSTANTS_PATH.replace(/\.js$/, "");
  };
  const body = src.replace(/import\s[^;]*?from\s*["'][^"']*["'];?/g, "");
  const add = (object, n) => { if (n > 0) counts.set(object, (counts.get(object) ?? 0) + n); };
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (!isConstantsModule(m[2])) continue;
    for (const spec of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const [name, alias] = spec.split(/\s+as\s+/).map((x) => x.trim());
      if (!constants[name]) continue;
      add(constants[name], (body.match(new RegExp(`\\b${alias ?? name}\\b`, "g")) ?? []).length);
    }
  }
  for (const m of src.matchAll(/import\s*\*\s*as\s+(\w+)\s+from\s*["']([^"']+)["']/g)) {
    if (!isConstantsModule(m[2])) continue;
    for (const [name, object] of Object.entries(constants)) {
      add(object, (body.match(new RegExp(`\\b${m[1]}\\.${name}\\b`, "g")) ?? []).length);
    }
  }
  return counts;
}

function derive() {
  const files = [];
  for (const r of ["functions/src", "field-ops-app-vite/src"]) walk(join(REPO, r), files);
  files.push(join(REPO, "firestore.rules"));
  const constants = collectionConstants();
  const found = new Map();
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    const path = rel(f);
    if (path === SELF) continue;
    const viaConstants = path.startsWith("field-ops-app-vite/src/") && path !== CONSTANTS_PATH
      ? constantUses(path, src, constants) : new Map();
    for (const [collection, object] of Object.entries(COLLECTION_OBJECT)) {
      const re = new RegExp(`(eos_ops\\.|\\$\\{SCHEMA\\}\\.)?\\b${collection}\\b`, "g");
      let n = 0, m;
      while ((m = re.exec(src))) if (!m[1]) n += 1;
      n += viaConstants.get(object) ?? 0;
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
const clientTexts = () => new Map(
  walk(join(REPO, "field-ops-app-vite/src")).map((f) => [rel(f), strip(readFileSync(f, "utf8"))]));

function deriveCallableConsumers(injected) {
  const texts = injected ?? clientTexts();

  // Seed: modules that invoke a Reorder callable by name through the Firebase functions SDK...
  const reaching = new Set();
  for (const [path, src] of texts) {
    if (/httpsCallable|firebase\/functions/.test(src) && REORDER_CALLABLES.some((c) => src.includes(c))) {
      reaching.add(path);
    }
  }
  // ...and transports of a source-conditional callable that can send it a Reorder source.
  for (const t of deriveReceivingTransports(texts)) if (t.reorderSourceReachable) reaching.add(t.path);
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
  // receiveInventoryStockCommand.ts names the purchase order AND writes the Reorder Request. Under a
  // one-row-per-file census the write vanished, and the activation gate read ZERO runtime consumers
  // while a live Firestore Reorder writer sat in the receiving path.
  const receiving = [...byPath.keys()].filter((k) => k.startsWith("functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|"));
  assert.deepEqual(receiving.sort(), [
    "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|PURCHASE_ORDER",
    "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|REORDER_REQUEST",
  ]);
  const reorderSide = byPath.get("functions/src/inventoryReceiving/receiveInventoryStockCommand.ts|REORDER_REQUEST");
  // NOT a read and NOT dead: a WRITER. Since the Reorder activation no repository client reaches its
  // Reorder branch (proved below, by derivation), so it is DEPLOYED legacy authority -- and it still holds
  // the Firebase RETIREMENT shut, because the copy deployed in nonprod pre-dates the freeze and is
  // externally invokable. "FROZEN" would describe code that is not what runs.
  assert.equal(reorderSide.classification, "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS");
  assert.ok(RETIREMENT_BLOCKING.includes(reorderSide.classification),
    "a deployed Reorder writer must keep blocking the Firebase retirement");
  assert.match(reorderSide.consumer, /DEPLOYED in nonprod pre-dates the freeze/);
  // And the claim is checked against the source, not taken on trust.
  const src = strip(readFileSync(join(REPO, "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts"), "utf8"));
  assert.match(src, /status:\s*RECEIVED/, "the legacy transition write is no longer present -- reclassify it");
  // It is still exported, therefore deployed.
  const index = strip(readFileSync(join(REPO, "functions/src/index.ts"), "utf8"));
  assert.match(index, /receiveInventoryStock/, "receiveInventoryStock is no longer exported -- reclassify it as retired");
});

test("NO client transport can send a REORDER_PURCHASE_ORDER source to receiveInventoryStock", () => {
  // THE FACT THE RECLASSIFICATION ABOVE RESTS ON, derived rather than asserted. The one transport that
  // still names the callable (through domain/receivingTransport.js's CALLABLE_NAMES) is the canonical
  // multi-line PURCHASE_ORDER journey, which has its own authority.
  const transports = deriveReceivingTransports(clientTexts());
  assert.deepEqual(transports, [{
    path: "field-ops-app-vite/src/services/receivingCallableClient.js",
    callable: "receiveInventoryStock",
    reorderSourceReachable: false,
  }], "a new receiving transport appeared, or the existing one can send a Reorder source again");
  // The Reorder receipt goes to the governed PostgreSQL command instead.
  const eos = strip(readFileSync(join(REPO, "field-ops-app-vite/src/services/reorderReceivingClient.js"), "utf8"));
  assert.match(eos, /"receiveReorderStock"/);
  assert.doesNotMatch(eos, /httpsCallable|firebase\/functions/);
});

test("the receiving indirection is really followed -- a reinstated legacy submit is caught two hops out", () => {
  // Without this the test above could pass vacuously. A transport that imports the CALLABLE_NAMES table
  // (and never spells the callable) and calls the legacy builder IS a Reorder consumer, and so is the
  // screen that imports it. The same transport restricted to the canonical builder is not.
  const table = ["src/domain/transport.js", 'export const CALLABLE_NAMES = { receive: "receiveInventoryStock" };\nexport const buildReceiveRequest = (r) => r;'];
  const legacy = new Map([
    table,
    ["src/services/client.js", 'import { httpsCallable } from "firebase/functions";\nimport { CALLABLE_NAMES, buildReceiveRequest } from "../domain/transport.js";\nexport const submit = (r) => httpsCallable(f, CALLABLE_NAMES.receive)(buildReceiveRequest(r));'],
    ["src/screens/Receive.jsx", 'import { submit } from "../services/client.js";\nexport const R = () => submit({});'],
  ]);
  assert.deepEqual([...deriveCallableConsumers(legacy)].sort(), ["src/screens/Receive.jsx", "src/services/client.js"]);
  const canonicalOnly = new Map([
    table,
    ["src/services/client.js", 'import { httpsCallable } from "firebase/functions";\nimport { CALLABLE_NAMES, buildCanonicalReceiveRequest } from "../domain/transport.js";\nexport const submit = (r) => httpsCallable(f, CALLABLE_NAMES.receive)(buildCanonicalReceiveRequest(r));'],
  ]);
  assert.deepEqual([...deriveCallableConsumers(canonicalOnly)], []);
  assert.deepEqual(deriveReceivingTransports(canonicalOnly).map((t) => t.reorderSourceReachable), [false]);
});

test("the constant indirection is really followed -- the hole that hid four client reads", () => {
  const constants = collectionConstants();
  assert.deepEqual(constants, {
    REORDER_REQUESTS_COLLECTION: "REORDER_REQUEST",
    PURCHASE_ORDERS_COLLECTION: "PURCHASE_ORDER",
    REORDER_PURCHASE_ORDER_VOIDS_COLLECTION: "PURCHASE_ORDER_VOID",
  });
  // The pre-activation hook shape, reproduced: it spells no collection, only the imported constant.
  const hook = strip(`import { doc, onSnapshot } from "firebase/firestore";
import { REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, PURCHASE_ORDERS_COLLECTION as POS } from "../domain/constants";
export const a = (id) => onSnapshot(doc(db, REORDER_PURCHASE_ORDER_VOIDS_COLLECTION, id));
export const b = (id) => onSnapshot(doc(db, POS, id));`);
  const uses = constantUses("field-ops-app-vite/src/hooks/useX.js", hook, constants);
  assert.equal(uses.get("PURCHASE_ORDER_VOID"), 1);
  assert.equal(uses.get("PURCHASE_ORDER"), 1);
  // An import that is never USED reaches nothing, and a same-named LOCAL constant is not the import.
  const unused = strip(`import { PURCHASE_ORDERS_COLLECTION } from "./constants";\nexport const x = 1;`);
  assert.equal(constantUses("field-ops-app-vite/src/domain/x.js", unused, constants).size, 0);
  const local = strip(`const PURCHASE_ORDERS_COLLECTION = "purchase_orders";\nexport const f = () => PURCHASE_ORDERS_COLLECTION;`);
  assert.equal(constantUses("field-ops-app-vite/src/services/x.ts", local, constants).size, 0);
  // Namespace imports too.
  const ns = strip(`import * as C from "../domain/constants.js";\nexport const r = () => C.REORDER_REQUESTS_COLLECTION;`);
  assert.equal(constantUses("field-ops-app-vite/src/hooks/y.js", ns, constants).get("REORDER_REQUEST"), 1);
});

test("the metadata bindings are DEAD for a checked reason: no screen runs their lists", () => {
  // They declare `collection:` through the constants, and the metadata list runtime CAN read Firestore
  // (metadata/firestoreListSource.js). DEAD is therefore only true while nothing runs these lists.
  const lists = /\b(purchaseOrderIndexList|reorderRequestIndexList|purchaseOrderVoidIndexList)\b/;
  const offenders = [...clientTexts()]
    .filter(([path, src]) => !path.startsWith("field-ops-app-vite/src/metadata/definitions/") && lists.test(src))
    .map(([path]) => path);
  assert.deepEqual(offenders, [], "a surface now runs a Reorder metadata list -- it reads Firestore; reclassify it");
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
    // The purchase-order and void reads, moved to readReorderPurchaseOrders at the Reorder activation.
    "field-ops-app-vite/src/hooks/usePurchaseOrdersByIds.js",
    "field-ops-app-vite/src/hooks/useReorderPurchaseOrders.js",
    "field-ops-app-vite/src/hooks/useReorderPurchaseOrderVoids.js",
    "field-ops-app-vite/src/services/operationsQueries.ts",
    "field-ops-app-vite/src/modules/receiving/ReceiveAgainstPurchaseOrder.jsx",
  ]) {
    assert.ok(![...derived.keys()].some((k) => k.startsWith(`${converted}|`)),
      `${converted} still reaches a Firestore Reorder collection`);
  }
});

test("an exported Firebase callable is DEPLOYED legacy authority, never DEAD", () => {
  const callables = byPath.get("functions/src/reorderRequest/reorderCallables.ts|REORDER_REQUEST");
  assert.equal(callables.classification, "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS",
    "a callable with no repository callers is still deployed and externally invokable; DEAD would be a lie");
  // REPOSITORY RETIREMENT (2026-10-01): the export is gone from the Functions entry point, so no future deploy carries
  // these callables -- but the copies DEPLOYED in nonprod remain invokable until a Firebase deploy carries the removal,
  // which is why the classification stays DEPLOYED (never DEAD, never RETIRED) until that deploy.
  const index = strip(readFileSync(join(REPO, "functions/src/index.ts"), "utf8"));
  for (const name of REORDER_CALLABLES) {
    assert.ok(!new RegExp(`\\b${name}\\b`).test(index), `${name} is exported again -- the repository retirement regressed`);
  }
  assert.match(callables.consumer, /DEPLOYED in nonprod still carry them/);
});

test("THE HARD GATE: activation requires ZERO Reorder runtime consumers of any kind, on every Reorder object", () => {
  const readiness = reorderRuntimeActivationReadiness();
  // ZERO (Owner ruling). Not because anything was excused: the client Reorder, purchase-order and void
  // reads moved to PostgreSQL, the Reorder receipt moved to PostgreSQL, and the derivations above --
  // literal names, imported constants, callable wrappers and source-conditional transports -- find
  // nothing left that reaches Firestore for a Reorder object at runtime.
  assert.deepEqual(readiness.blockedBy, []);
  assert.equal(readiness.runtimeConsumerCount, 0);
  assert.deepEqual(readiness.purchaseOrderRuntimeConsumers, []);
  assert.equal(readiness.ready, true);

  // ACTIVATION IS NOT RETIREMENT. The deployed Firebase writers additionally block the retirement, which
  // is a later step, and the two must not be read as one.
  assert.equal(readiness.firebaseRetired, false);
  for (const deployed of [
    "functions/src/reorderRequest/reorderCallables.ts",
    "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts",
    "functions/src/inventoryReceiving/receivingSourceResolver.ts",
  ]) assert.ok(readiness.firebaseRetirementBlockedBy.includes(deployed), deployed);

  // The gate is DERIVED, not asserted: ONE reintroduced consumer of any blocking kind, on ANY Reorder
  // object -- the purchase order and the void included -- closes it again.
  for (const object of REORDER_LEGACY_OBJECTS) {
    for (const classification of ACTIVATION_BLOCKING) {
      const closed = reorderRuntimeActivationReadiness([...REORDER_LEGACY_RUNTIME_CENSUS, {
        path: "x/live.js", object, classification, consumer: "x", occurrences: 1,
      }]);
      assert.equal(closed.ready, false, `a single ${classification} on ${object} must hold activation shut on its own`);
      assert.deepEqual(closed.blockedBy, ["x/live.js"]);
    }
  }
  // And the census entries that carry the defect this suite was built for are what they say they are:
  // were the receiving write still reachable from a client, it would be FIRESTORE_RUNTIME_WRITE and block.
  const reachable = REORDER_LEGACY_RUNTIME_CENSUS.map((c) =>
    c.path === "functions/src/inventoryReceiving/receiveInventoryStockCommand.ts" && c.object === "REORDER_REQUEST"
      ? { ...c, classification: "FIRESTORE_RUNTIME_WRITE" } : c);
  assert.deepEqual(reorderRuntimeActivationReadiness(reachable).blockedBy,
    ["functions/src/inventoryReceiving/receiveInventoryStockCommand.ts"]);
});

test("neither migration evidence nor the Rules authority can ever hold the gate shut", () => {
  const excused = REORDER_LEGACY_RUNTIME_CENSUS.filter((c) =>
    c.classification === "MIGRATION_EVIDENCE" || c.classification === "RULES_AUTHORITY");
  assert.ok(excused.length > 0);
  assert.equal(reorderRuntimeActivationReadiness(excused).ready, true,
    "evidence reaches nothing and the Rules are retired at the deployment step");
});
