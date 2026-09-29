// THE CATALOG ACTIVATION LEDGER, and the reachability derivation behind it.
//
// The ledger's whole value is that it does not lie in either direction: it must not hide an active
// consumer to reach a false zero, and it must not count a legacy file that nothing reaches. Both
// halves are derived from the repository here rather than trusted.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "functions/src");
const L = await import("../lib/catalogMaster/catalogActivationLedger.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const rel = (f) => relative(REPO, f).split("\\").join("/");
const files = [];
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) && files.push(p); } })(SRC);

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const c of [base + ".ts", base + ".tsx", join(base, "index.ts")]) {
    try { if (statSync(c).isFile()) return c; } catch { /* not this one */ }
  }
  return null;
}

/** path -> its direct imports, as repo-relative paths. */
function importGraph(extraEdges = new Map()) {
  const g = new Map();
  for (const f of files) {
    const src = strip(readFileSync(f, "utf8"));
    const out = new Set();
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const r = resolveSpec(f, m[1]);
      if (r) out.add(rel(r));
    }
    g.set(rel(f), [...out]);
  }
  for (const [from, to] of extraEdges) g.set(from, [...(g.get(from) ?? []), ...to]);
  return g;
}

/** FIXED POINT from the Functions entry point. This is what "deployed" means. */
function deployedReachable(graph, removeEdge = null) {
  const entry = "functions/src/index.ts";
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    for (const d of graph.get(f) ?? []) {
      if (removeEdge && removeEdge.from === f && removeEdge.to === d) continue;
      if (!seen.has(d)) { seen.add(d); stack.push(d); }
    }
  }
  return seen;
}

test("the ledger's deployedReachable agrees with the import graph, for every entry", () => {
  const reachable = deployedReachable(importGraph());
  for (const dep of L.CATALOG_ACTIVATION_DEPENDENCIES) {
    assert.equal(reachable.has(dep.consumer), dep.deployedReachable,
      `${dep.consumer}: ledger says deployedReachable=${dep.deployedReachable}`);
  }
});

test("SOURCE EXISTS is not RUNTIME REACHABLE -- the ledger records both, and they differ", () => {
  // If every entry were reachable the distinction would be untested. Two entries are deliberately
  // unreachable: an unexported command and a module nothing imports from the entry point.
  const unreachable = L.CATALOG_ACTIVATION_DEPENDENCIES.filter((d) => !d.deployedReachable);
  assert.ok(unreachable.length >= 2, "the ledger must contain entries that exist but are not reachable");
  for (const d of unreachable) {
    assert.equal(d.activationBlocking, false, `${d.consumer}: an unreachable file cannot block activation`);
    assert.equal(d.classification, "INTERNAL_UNDEPLOYED");
    // And the file really is there -- it is unreachable, not absent.
    assert.ok(files.some((f) => rel(f) === d.consumer), `${d.consumer} should exist on disk`);
  }
});

test("NON-VACUITY: removing a known reachable edge makes the derivation report unreachable", () => {
  // The test that proves the fixed point is doing work. `partMasterRepository` is reachable through
  // many edges, so one is not enough -- every edge into it is cut, and it must then drop out.
  const target = "functions/src/partMaster/partMasterRepository.ts";
  const graph = importGraph();
  assert.ok(deployedReachable(graph).has(target), "precondition: the adapter is reachable today");

  const cut = new Map();
  for (const [from, tos] of graph) cut.set(from, tos.filter((t) => t !== target));
  const entry = "functions/src/index.ts";
  const seen = new Set([entry]); const stack = [entry];
  while (stack.length) { const f = stack.pop(); for (const d of cut.get(f) ?? []) if (!seen.has(d)) { seen.add(d); stack.push(d); } }
  assert.equal(seen.has(target), false,
    "with every import edge into the adapter removed, the derivation must stop reporting it reachable");
});

test("NON-VACUITY: the derivation finds a consumer that is reachable only through a chain", () => {
  // Reachability must follow the graph, not just index.ts's own imports. The adapter is NOT imported
  // by index.ts directly; it is reached through the callables that are.
  const graph = importGraph();
  const direct = new Set(graph.get("functions/src/index.ts") ?? []);
  const target = "functions/src/partMaster/partMasterRepository.ts";
  assert.equal(direct.has(target), false, "the adapter is not a direct import of the entry point");
  assert.ok(deployedReachable(graph).has(target), "but it IS reachable, through a chain");
});

test("the gate requires ZERO client consumers AND ZERO active deployed server consumers", () => {
  // Client zero alone is not enough.
  const clientZeroOnly = L.readCatalogActivationGate({ clientFirestoreConsumers: 0 });
  assert.equal(clientZeroOnly.mayActivate, false);
  assert.ok(clientZeroOnly.activeDeployedServerConsumers.length > 0);

  // Server zero alone is not enough either.
  const serverZeroOnly = L.readCatalogActivationGate({ clientFirestoreConsumers: 3, dependencies: [] });
  assert.equal(serverZeroOnly.mayActivate, false);

  // Both zero opens the gate.
  assert.equal(L.readCatalogActivationGate({ clientFirestoreConsumers: 0, dependencies: [] }).mayActivate, true);
});

test("migration evidence and unreachable files do NOT count as active consumers", () => {
  const g = L.readCatalogActivationGate({
    clientFirestoreConsumers: 0,
    dependencies: [
      { consumer: "a", owningDomain: "x", currentRuntime: "FIREBASE_FUNCTIONS", catalogFact: "f",
        classification: "MIGRATION_EVIDENCE", deployedReachable: true, replacementAuthority: null,
        activationBlocking: false, retirementBlocking: false, reason: "evidence" },
      { consumer: "b", owningDomain: "x", currentRuntime: "FIREBASE_FUNCTIONS", catalogFact: "f",
        classification: "INTERNAL_UNDEPLOYED", deployedReachable: false, replacementAuthority: null,
        activationBlocking: false, retirementBlocking: false, reason: "unreachable" },
    ],
  });
  assert.equal(g.mayActivate, true);
  assert.deepEqual(g.activeDeployedServerConsumers, []);
});

test("deployed legacy authority blocks RETIREMENT but not ACTIVATION", () => {
  const g = L.readCatalogActivationGate({
    clientFirestoreConsumers: 0,
    dependencies: [
      { consumer: "callables", owningDomain: "partMaster", currentRuntime: "FIREBASE_FUNCTIONS", catalogFact: "writes",
        classification: "DEPLOYED_LEGACY_AUTHORITY_NO_REPO_CALLERS", deployedReachable: true,
        replacementAuthority: "/operations/catalog", activationBlocking: false, retirementBlocking: true,
        reason: "still exported and externally invokable" },
    ],
  });
  assert.equal(g.mayActivate, true, "no repository caller reaches it, so activation is not blocked");
  assert.deepEqual(g.retirementBlockers, ["callables"], "but it is still deployed, so retirement is");
});

test("the ledger NAMES the domains activation waits on, rather than reporting a bare failure", () => {
  const g = L.readCatalogActivationGate({ clientFirestoreConsumers: 0 });
  assert.equal(g.mayActivate, false);
  for (const expected of ["salesAgreement (Commercial)", "workOrderInstall (Work Order / Equipment)"]) {
    assert.ok(g.blockedOnDomains.includes(expected), `${expected} must be named`);
  }
  // Each named dependency says what it consumes and what would replace it.
  for (const d of L.CATALOG_ACTIVATION_DEPENDENCIES) {
    assert.ok(d.catalogFact.length > 10, `${d.consumer}: name the fact it consumes`);
    assert.ok(d.reason.length > 40, `${d.consumer}: say why`);
    assert.ok(L.CONSUMER_CLASSIFICATIONS.includes(d.classification));
    assert.ok(L.LEDGER_RUNTIMES.includes(d.currentRuntime));
  }
});

test("NO Firebase -> Render bridge and NO Firebase -> PostgreSQL pool exists", () => {
  // The two forbidden shapes, derived from the source. A Firebase Function may reach neither the
  // Catalog HTTP API nor a pg Pool: either one makes a business transaction half-Firestore and
  // half-PostgreSQL, with nothing spanning the two.
  const CATALOG_RUNTIME = new Set([
    "functions/src/catalogMaster/catalogHttp.ts",
    "functions/src/catalogMaster/postgresPartMasterWriter.ts",
    "functions/src/catalogMaster/postgresPartAliasWriter.ts",
    "functions/src/catalogMaster/postgresCatalogReads.ts",
    "functions/src/catalogMaster/catalogMasterKernel.ts",
    "functions/src/catalogMaster/catalogCutover.ts",
  ]);
  const reachable = deployedReachable(importGraph());
  for (const m of CATALOG_RUNTIME) {
    assert.equal(reachable.has(m), false,
      `${m} is reachable from the Firebase Functions entry point: that is a Firebase -> PostgreSQL bridge`);
  }
  // And no deployed Firebase module fetches the Catalog route.
  for (const f of files) {
    const p = rel(f);
    if (!reachable.has(p)) continue;
    const src = strip(readFileSync(f, "utf8"));
    assert.equal(/\/operations\/catalog/.test(src), false, `${p} calls the Render Catalog API from Firebase`);
  }
});
