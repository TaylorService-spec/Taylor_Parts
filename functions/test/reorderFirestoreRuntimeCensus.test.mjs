// The runtime census's proof. The census must not be satisfiable by forgetting a file, so the
// executable consumer set is DERIVED from the repository and checked in both directions.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REORDER_FIRESTORE_RUNTIME_CENSUS, RUNTIME_CLASSIFICATIONS, REORDER_FIRESTORE_OBJECTS,
  BLOCKING_RUNTIME_CLASSIFICATIONS, reorderRuntimeActivationReadiness,
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

/**
 * The executable Firestore Reorder consumers, derived.
 *
 * A schema qualifier means PostgreSQL. Without that discriminator every governed command this
 * cutover added would count as a Firestore consumer and the gate could never open.
 */
const SELF = "functions/src/eosOps/migration/reorderFirestoreRuntimeCensus.ts";

function derive() {
  const files = [];
  for (const r of ["functions/src", "field-ops-app-vite/src"]) walk(join(REPO, r), files);
  files.push(join(REPO, "firestore.rules"));
  const TERM = /(eos_ops\.|\$\{SCHEMA\}\.)?\b(reorder_requests|reorder_purchase_orders|reorder_purchase_order_voids)\b/g;
  const found = new Map();
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    let n = 0, m;
    TERM.lastIndex = 0;
    while ((m = TERM.exec(src))) if (!m[1]) n += 1;
    const rel = relative(REPO, f).split("\\").join("/");
    // The census names every collection it classifies. Counting itself would make it its own
    // consumer, exactly as the assignedToUserId census excludes itself.
    if (n > 0 && rel !== SELF) found.set(rel, n);
  }
  return found;
}

const derived = derive();
const byPath = new Map(REORDER_FIRESTORE_RUNTIME_CENSUS.map((c) => [c.path, c]));

test("the census and the repository name exactly the same Firestore Reorder consumers", () => {
  assert.deepEqual([...byPath.keys()].sort(), [...derived.keys()].sort(),
    "a consumer appeared or disappeared: classify the new one, or remove the entry whose file no longer reaches the collection");
  assert.equal(byPath.size, REORDER_FIRESTORE_RUNTIME_CENSUS.length, "a path is listed twice");
});

test("every recorded occurrence count is the real one", () => {
  for (const [path, count] of derived) {
    assert.equal(byPath.get(path).occurrences, count, `${path} records the wrong occurrence count`);
  }
});

test("the schema qualifier really is what separates PostgreSQL from Firestore", () => {
  // The governed lifecycle commands and the repository name `reorder_requests` constantly -- as an
  // eos_ops TABLE. If the discriminator broke, they would appear here and the gate would be
  // unsatisfiable, so their ABSENCE is the assertion.
  for (const pg of [
    "functions/src/eosOps/reorderLifecycleCommands.ts",
    "functions/src/eosOps/purchasingRepository.ts",
    "functions/src/eosOps/reorderAssignmentAuthority.ts",
  ]) {
    assert.ok(!derived.has(pg), `${pg} is PostgreSQL and must not count as a Firestore consumer`);
  }
});

test("every entry is classified from the closed vocabulary and names its object", () => {
  for (const c of REORDER_FIRESTORE_RUNTIME_CENSUS) {
    assert.ok(RUNTIME_CLASSIFICATIONS.includes(c.classification), `${c.path}: ${c.classification}`);
    assert.ok(REORDER_FIRESTORE_OBJECTS.includes(c.object), `${c.path}: ${c.object}`);
    assert.ok(c.consumer.trim().length > 0, `${c.path} says nothing about what it does`);
    assert.ok(Number.isInteger(c.occurrences) && c.occurrences > 0);
  }
});

test("the client no longer reaches Firestore for a Reorder Request lifecycle action", () => {
  // These four files carried the whole live client surface. Their absence from the derived set is
  // the fact the cutover turns on -- a comment claiming conversion would not be.
  for (const converted of [
    "field-ops-app-vite/src/hooks/useReorderRequests.js",
    "field-ops-app-vite/src/domain/inventoryReorderRequests.js",
    "field-ops-app-vite/src/domain/reorderPurchaseOrders.js",
    "field-ops-app-vite/src/modules/inventory/PartDetail.jsx",
  ]) {
    assert.ok(!derived.has(converted), `${converted} still reaches a Firestore Reorder collection`);
  }
});

test("the Firebase callable Reorder authority has no callers left", () => {
  const callables = byPath.get("functions/src/reorderRequest/reorderCallables.ts");
  assert.equal(callables.classification, "DEAD",
    "the callable authority still has a caller, so it is live runtime write authority");
  // DEAD is a claim about reachability, and this is the check of that claim: nothing in the client
  // may still invoke the callable client's submit functions.
  const clientFiles = walk(join(REPO, "field-ops-app-vite/src"));
  const callers = clientFiles.filter((f) =>
    !f.endsWith("reorderCallableClient.js")
    && /submitCreateReorderRequest|submitRecordReorderPurchaseOrder/.test(strip(readFileSync(f, "utf8"))));
  assert.deepEqual(callers.map((f) => relative(REPO, f)), [],
    "a client module still calls the Firebase callable Reorder authority");
});

test("THE HARD GATE: activation requires ZERO runtime Firestore consumers of the Reorder Request", () => {
  const readiness = reorderRuntimeActivationReadiness();
  // This is the honest current state. It is NOT ready, and the two that hold it shut are named.
  assert.equal(readiness.ready, false);
  // ONE runtime consumer remains, and it is not a client file: it runs in FIREBASE FUNCTIONS, which
  // has no PostgreSQL access. Converting it would require the Functions -> PostgreSQL pool that was
  // explicitly refused, so it is a question about where that read should live, not an oversight.
  assert.deepEqual(readiness.blockedBy, [
    "functions/src/ai/workOrderReadinessContext.ts",
  ], "the runtime consumers still reaching Firestore for a Reorder Request");
  assert.equal(readiness.runtimeConsumerCount, 1);

  // The purchase-order surface is REPORTED and deliberately outside this gate -- a different object
  // with its own authority. Stated so the count is never zero merely by omission.
  assert.ok(readiness.purchaseOrderRuntimeConsumers.length > 0);

  // The gate is DERIVED from the census, not asserted: converting the blocking set opens it.
  const converted = REORDER_FIRESTORE_RUNTIME_CENSUS.filter((c) =>
    !(c.object === "REORDER_REQUEST" && BLOCKING_RUNTIME_CLASSIFICATIONS.includes(c.classification)));
  assert.equal(reorderRuntimeActivationReadiness(converted).ready, true);

  // And ONE reintroduced runtime consumer closes it again.
  assert.equal(reorderRuntimeActivationReadiness([...converted, {
    path: "x/live.js", object: "REORDER_REQUEST", classification: "RUNTIME_READ", consumer: "x", occurrences: 1,
  }]).ready, false, "a single runtime Firestore read must hold activation shut on its own");
});

test("neither migration evidence nor the Rules authority can ever hold the gate shut", () => {
  const onlyExcused = REORDER_FIRESTORE_RUNTIME_CENSUS.filter((c) =>
    c.classification === "MIGRATION_EVIDENCE" || c.classification === "RULES_AUTHORITY");
  assert.ok(onlyExcused.length > 0);
  assert.equal(reorderRuntimeActivationReadiness(onlyExcused).ready, true,
    "evidence reaches nothing and the Rules are retired at the deployment step");
});
