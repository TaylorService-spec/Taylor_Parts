// LANE 2 -- INVENTORY / EQUIPMENT OPERATIONS AT THE CATALOG ACTIVATION BOUNDARY.
//
// What this suite is FOR. Lane 2's finding was not a migration; it was a measurement. Four deployed
// operations reach the Firestore Catalog and none of them was in the activation ledger, because the
// ledger recorded the Part REPOSITORY and treated its callers as covered by it. A repository is not an
// operation: it has no capability, no users and no disposition, and "the adapter is listed" says nothing
// about what the Cycle Count screen does at activation. So the derivation here is per-OPERATION, from the
// Functions entry point, and it fails if the ledger and the repository disagree in either direction.
//
// Nothing in this suite asserts that a domain has moved. Two of them provably have not.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "functions/src");
const L = await import("../lib/catalogMaster/catalogActivationLedger.js");
const W = await import("../lib/catalogMaster/catalogWriterState.js");

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
const rel = (f) => relative(REPO, f).split("\\").join("/");
const read = (p) => strip(readFileSync(join(REPO, p), "utf8"));
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
function importGraph() {
  const g = new Map();
  for (const f of files) {
    const out = new Set();
    for (const m of strip(readFileSync(f, "utf8")).matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const r = resolveSpec(f, m[1]);
      if (r) out.add(rel(r));
    }
    g.set(rel(f), [...out]);
  }
  return g;
}
function deployedReachable(graph) {
  const seen = new Set(), stack = ["functions/src/index.ts"];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const d of graph.get(n) ?? []) stack.push(d);
  }
  return seen;
}

// ════════════════════ THE MEASUREMENT THAT WAS MISSING ════════════════════

test("every DEPLOYED module that resolves a Part through the repository factory is a ledger entry", () => {
  // `buildFirestorePartRepository` is the ONE named seam through which a server Part read happens
  // without naming the collection -- which is exactly why the name-based runtime census cannot see
  // these callers, and why they went unlisted. This is not an arbitrary transitive closure: it is one
  // factory, whose only purpose is Firestore Catalog access.
  const reachable = deployedReachable(importGraph());
  const callers = files
    .map(rel)
    .filter((p) => reachable.has(p))
    .filter((p) => /\bbuildFirestorePartRepository\s*\(/.test(read(p)));

  assert.ok(callers.length >= 4, `expected the factory to have deployed callers; found ${callers.length}`);

  const ledgered = new Set(L.CATALOG_ACTIVATION_DEPENDENCIES.map((d) => d.consumer));
  // The repository itself is the seam, not a caller of it.
  const unlisted = callers.filter((p) => p !== "functions/src/partMaster/partMasterRepository.ts" && !ledgered.has(p));
  assert.deepEqual(unlisted, [],
    `these deployed operations resolve a Part and are absent from the activation ledger: ${unlisted.join(", ")}`);
});

test("the four operations Lane 2 found are listed, reachable, and each names its own domain", () => {
  const byConsumer = new Map(L.CATALOG_ACTIVATION_DEPENDENCIES.map((d) => [d.consumer, d]));
  for (const p of [
    "functions/src/cycleCount/cycleCountCallableWiring.ts",
    "functions/src/inventoryTransfer/transferCallableWiring.ts",
    "functions/src/inventory/partBalanceReadService.ts",
    "functions/src/inventory/partBalanceBatchReadService.ts",
  ]) {
    const d = byConsumer.get(p);
    assert.ok(d, `${p} must be in the ledger`);
    assert.equal(d.deployedReachable, true, `${p} is reached from index.ts`);
    assert.ok(L.ACTIVATION_DISPOSITIONS.includes(d.disposition), `${p}: disposition from the closed list`);
  }
  // The two Inventory Operations domains BLOCK; the two projections do not. That difference is the
  // whole point of the ruling and must not quietly collapse into one answer.
  assert.equal(byConsumer.get("functions/src/cycleCount/cycleCountCallableWiring.ts").activationBlocking, true);
  assert.equal(byConsumer.get("functions/src/inventoryTransfer/transferCallableWiring.ts").activationBlocking, true);
  assert.equal(byConsumer.get("functions/src/inventory/partBalanceReadService.ts").activationBlocking, false);
  assert.equal(byConsumer.get("functions/src/inventory/partBalanceBatchReadService.ts").activationBlocking, false);
});

test("the named domain reconciliation blockers appear in the gate, not just in prose", () => {
  const g = L.readCatalogActivationGate({ clientFirestoreConsumers: 0 });
  assert.equal(g.mayActivate, false);
  for (const domain of ["cycleCount (Inventory Operations)", "inventoryTransfer (Inventory Operations)"]) {
    assert.ok(g.blockedOnDomains.includes(domain), `${domain} must be named by the gate`);
  }
  const reasons = L.CATALOG_ACTIVATION_DEPENDENCIES.map((d) => d.reason).join("\n");
  assert.match(reasons, /CYCLE_COUNT_DOMAIN_RECONCILIATION_REQUIRED/);
  assert.match(reasons, /TRANSFER_DOMAIN_RECONCILIATION_REQUIRED/);
});

// ════════════════════ WHY THOSE TWO CANNOT BE WIRED TODAY ════════════════════

test("the PostgreSQL Cycle Count and Transfer authorities exist and NOTHING composes them", () => {
  // The exact trap the ruling names: "PostgreSQL repository exists" is not "business process can cut
  // over". If either of these ever gains an importer, this test fails and the ledger entry must be
  // re-reasoned rather than left stale.
  // MATCH THE FULL PATH, NOT THE BASENAME. cycleCount/cycleCountCommand.ts imports its own
  // ./cycleCountRepository.js -- the FIRESTORE one. A basename match called that a composition of the
  // PostgreSQL authority, which is the same "two things share a name" confusion that made `parts` match
  // English prose in the runtime census.
  for (const target of ["eosOps/cycleCountRepository", "eosOps/purchasingRepository"]) {
    const importers = files.map(rel).filter((p) => !p.endsWith(`${target}.ts`))
      .filter((p) => new RegExp(`from\\s+["'][^"']*${target}\\.js["']`).test(read(p)));
    assert.deepEqual(importers, [], `${target} is composed by ${importers.join(", ")}; re-reason its ledger entry`);
  }
});

test("the Operations transport carries no Cycle Count or Transfer operation", () => {
  const src = read("functions/src/eosOps/eosOpsHttp.ts");
  const ops = [...src.matchAll(/OPERATIONS_(?:READ|MUTATION)_OPERATIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
  assert.ok(ops.length > 0, "the transport must declare a closed operation list");
  for (const op of ops) {
    assert.equal(/cycleCount|transfer/i.test(op), false, `${op} would make this a cutover the domain has not had`);
  }
});

test("neither wiring module was quietly repointed at PostgreSQL or at Render", () => {
  for (const p of [
    "functions/src/cycleCount/cycleCountCallableWiring.ts",
    "functions/src/inventoryTransfer/transferCallableWiring.ts",
  ]) {
    const src = read(p);
    assert.equal(/\/operations\//.test(src), false, `${p} calls a Render route: that is the forbidden bridge`);
    assert.equal(/from ["']pg["']|new Pool\(/.test(src), false, `${p} opens a PostgreSQL pool from Firebase`);
    assert.equal(/eos_ops\./.test(src), false, `${p} queries PostgreSQL directly`);
  }
});

// ════════════════════ THE READ GUARD ════════════════════

test("a catalog READ stays legal while FROZEN and refuses once PostgreSQL is ACTIVE", () => {
  const reader = "inventory.partBalance.controlType";
  // The rollback window. Refusing here would take the platform down for a migration that has not
  // happened and might be reversed.
  W.assertFirestoreCatalogReadCurrent(reader, { firestore: "OPEN", postgres: "INACTIVE" });
  W.assertFirestoreCatalogReadCurrent(reader, { firestore: "FROZEN", postgres: "INACTIVE" });
  // And the moment the truth moves.
  for (const authority of [{ firestore: "FROZEN", postgres: "ACTIVE" }, { firestore: "RETIRED", postgres: "ACTIVE" }]) {
    assert.throws(() => W.assertFirestoreCatalogReadCurrent(reader, authority), (e) => {
      assert.equal(e.code, "CATALOG_AUTHORITY_MOVED");
      return true;
    }, `${authority.firestore}/${authority.postgres} must refuse`);
  }
});

test("the read guard refuses an unregistered reader rather than passing it", () => {
  assert.throws(() => W.assertFirestoreCatalogReadCurrent("not.a.reader", { firestore: "OPEN", postgres: "INACTIVE" }),
    /unknown Firestore catalog reader/);
});

test("a WRITE guard and a READ guard key on different states, deliberately", () => {
  // If these ever collapse into one predicate, one of the two is wrong: the writer must stop at FREEZE,
  // the reader must not.
  assert.throws(() => W.assertFirestoreCatalogWriterOpen("part.import", { firestore: "FROZEN", postgres: "INACTIVE" }));
  W.assertFirestoreCatalogReadCurrent("dataImport.inventory.partReference", { firestore: "FROZEN", postgres: "INACTIVE" });
});

// ════════════════════ DATA IMPORT (OWNER RULING B) ════════════════════

test("executeDataImport refuses a PARTS job BEFORE it is claimed and before any row is written", () => {
  const src = read("functions/src/dataImport/dataImportCallables.ts");
  const guard = src.indexOf('assertFirestoreCatalogWriterOpen("part.import")');
  const claim = src.indexOf("beginExecution(staged");
  const writer = src.indexOf("executeImportJob(claimed");
  assert.ok(guard > 0, "the PARTS job guard must exist");
  assert.ok(claim > 0 && writer > 0, "precondition: the claim and the row writer are both present");
  assert.ok(guard < claim, "the refusal must precede the claim, or a frozen catalog burns the job id");
  assert.ok(guard < writer, "and must precede any row write");
});

test("the INVENTORY job is guarded on the READ side, and PARTS on the WRITE side", () => {
  const src = read("functions/src/dataImport/dataImportCallables.ts");
  assert.match(src, /entityType === "PARTS"\) assertFirestoreCatalogWriterOpen\("part\.import"\)/);
  assert.match(src, /entityType === "INVENTORY"\) assertFirestoreCatalogReadCurrent\("dataImport\.inventory\.partReference"\)/);
});

test("no UNRELATED import entity type is disabled", () => {
  const src = read("functions/src/dataImport/dataImportCallables.ts");
  for (const entity of ["EQUIPMENT", "SERVICE_HISTORY"]) {
    assert.equal(new RegExp(`entityType === "${entity}"\\) assertFirestoreCatalog`).test(src), false,
      `${entity} reaches no catalog object and must keep its present behaviour`);
  }
  // CUSTOMERS keeps its own CRM guard and gains no catalog one.
  assert.match(src, /entityType === "CUSTOMERS"\) assertFirestoreCrmWriterOpen\("account\.import"\)/);
});

test("staging and preview are untouched: only EXECUTION is refused", () => {
  const src = read("functions/src/dataImport/dataImportCallables.ts");
  const exec = src.indexOf("executeDataImportCallable");
  assert.ok(exec > 0);
  // Every catalog guard call sits inside the execute callable, after its declaration.
  for (const m of src.matchAll(/assertFirestoreCatalog\w+\(/g)) {
    assert.ok(m.index > exec, "a catalog guard outside executeDataImport would block staging too");
  }
});

test("Data Import is nonproduction-only in the BACKEND, which is what makes ruling B's premise true", () => {
  const src = read("functions/src/dataImport/importTargetGuard.ts");
  assert.match(src, /PRODUCTION_PROJECT_ID = "taylor-parts"/);
  assert.match(src, /TARGET_PRODUCTION_ROLE/);
  assert.match(src, /TARGET_MISSING/, "absence must be a refusal, never a default target");
});

test("Data Import no longer blocks ACTIVATION, and still blocks RETIREMENT", () => {
  const entries = L.CATALOG_ACTIVATION_DEPENDENCIES.filter((d) => d.owningDomain === "dataImport");
  assert.equal(entries.length, 2);
  for (const d of entries) {
    assert.equal(d.activationBlocking, false, `${d.consumer}: reclassified by Owner ruling B`);
    assert.equal(d.retirementBlocking, true, `${d.consumer}: the callable is still deployed`);
    assert.equal(d.disposition, "EXPLICITLY_UNAVAILABLE");
    assert.match(d.reason, /NONPROD_ADMIN_TOOLING_RETIREMENT_BLOCKER|nonproduction-only/);
  }
  const g = L.readCatalogActivationGate({ clientFirestoreConsumers: 0 });
  assert.equal(g.blockedOnDomains.includes("dataImport"), false, "dataImport must no longer gate activation");
  assert.ok(g.retirementBlockers.some((c) => c.startsWith("functions/src/dataImport/")));
});

// ════════════════════ PART BALANCE (PROJECTION) ════════════════════

test("both Part Balance reads refuse before resolving a Part, and say UNAVAILABLE rather than zero", () => {
  for (const p of [
    "functions/src/inventory/partBalanceReadService.ts",
    "functions/src/inventory/partBalanceBatchReadService.ts",
  ]) {
    const src = read(p);
    const guard = src.indexOf('assertFirestoreCatalogReadCurrent("inventory.partBalance.controlType")');
    const resolve_ = src.indexOf("buildFirestorePartRepository(db)");
    assert.ok(guard > 0, `${p}: the guard must be present`);
    assert.ok(guard < resolve_, `${p}: refuse before reading a frozen Part, not after`);
    // An UNAVAILABLE that arrives as "internal" is indistinguishable from a crash.
    assert.match(src, /FirestoreCatalogNotCurrentError/);
    assert.match(src, /failed-precondition/);
    assert.match(src, /unavailable/i);
  }
});

test("no mutation depends on the Part Balance projection", () => {
  // The ruling permits a projection to become unavailable only if nothing that CHANGES business truth
  // needs it. Derived, not asserted.
  const importers = files.map(rel).filter((p) => /partBalance(Batch)?ReadService\.js/.test(read(p)));
  for (const p of importers) {
    const src = read(p);
    assert.equal(/\.set\(|\.update\(|\.create\(|INSERT INTO|UPDATE /.test(src), false,
      `${p} consumes the balance projection AND writes; the projection cannot simply become unavailable`);
  }
});

// ════════════════════ CANONICAL RECEIVING ════════════════════

test("canonical PURCHASE_ORDER receiving already refuses, at the boundary, before any read", () => {
  const src = read("functions/src/inventoryReceiving/receivingCallables.ts");
  assert.match(src, /source\.type !== "REORDER_PURCHASE_ORDER"/);
  const refusal = src.indexOf('source.type !== "REORDER_PURCHASE_ORDER"');
  const firstRead = src.search(/db\.collection\(|getFirestore\(\)/);
  if (firstRead >= 0) assert.ok(refusal < firstRead, "the refusal must precede any Firestore read");
});

test("the canonical refusal does NOT touch Reorder receiving", () => {
  // A blanket receiving shutdown would take an ACTIVE business process down with a dormant one. The
  // guard is keyed on the source type alone.
  const src = read("functions/src/inventoryReceiving/receivingCallables.ts");
  assert.match(src, /REORDER_PURCHASE_ORDER/);
  assert.equal(/throw invalidArg\("receiving is unavailable/i.test(src), false, "no blanket receiving refusal");
  const disposition = L.NON_CATALOG_BOUNDARY_DISPOSITIONS.find((x) => /canonical PURCHASE_ORDER/.test(x.operation));
  assert.ok(disposition, "the Owner-ruled disposition must be recorded");
  assert.equal(disposition.disposition, "DORMANT_RETIRE_OR_REFUSE");
  assert.equal(disposition.alreadyEnforced, true);
  assert.match(disposition.doesNotAffect, /#1961|REORDER_PURCHASE_ORDER/);
});

test("canonical receiving consumes NO catalog object, which is why it is not a ledger entry", () => {
  for (const p of [
    "functions/src/inventoryReceiving/receivingCallables.ts",
    "functions/src/inventoryReceiving/receivingSourceResolver.ts",
    "functions/src/inventoryReceiving/purchaseOrderProgressRead.ts",
  ]) {
    const src = read(p);
    for (const c of ['"parts"', '"part_aliases"', '"equipment_models"']) {
      assert.equal(src.includes(c), false, `${p} reads ${c}; it would then belong in the activation ledger`);
    }
  }
  // The THREE CANONICAL modules are absent -- not the whole directory. receivingCallableWiring.ts IS a
  // ledger entry, because REORDER receiving resolves a Part and is an active granted business process.
  // Asserting on the directory would have conflated the dormant branch with the live one, which is the
  // exact error this disposition exists to avoid.
  const ledgered = L.CATALOG_ACTIVATION_DEPENDENCIES.map((d) => d.consumer);
  for (const p of [
    "functions/src/inventoryReceiving/receivingCallables.ts",
    "functions/src/inventoryReceiving/receivingSourceResolver.ts",
    "functions/src/inventoryReceiving/purchaseOrderProgressRead.ts",
  ]) {
    assert.equal(ledgered.includes(p), false, `${p} consumes no catalog object`);
  }
  assert.ok(ledgered.includes("functions/src/inventoryReceiving/receivingCallableWiring.ts"),
    "but REORDER receiving's Part resolution IS a catalog consumer and must be listed");
});

// ════════════════════ THE STRICTER LEDGER RULE ════════════════════

test("every ledger entry carries a disposition from the closed list, and none reads frozen Firestore", () => {
  assert.equal(L.ACTIVATION_DISPOSITIONS.includes(L.FORBIDDEN_DISPOSITION), false,
    "the forbidden disposition must not be expressible");
  for (const d of L.CATALOG_ACTIVATION_DEPENDENCIES) {
    assert.ok(L.ACTIVATION_DISPOSITIONS.includes(d.disposition), `${d.consumer}: ${d.disposition} is not a permitted disposition`);
    assert.notEqual(d.disposition, L.FORBIDDEN_DISPOSITION);
  }
  assert.equal(L.PROJECTION_RULE_AFTER_ACTIVATION.staleReadCompatibilityPeriod, false);
});

test("the rule covers READS as well as writes", () => {
  // Stated, and enforced: there is a reader registry with a guard behind it, not just a writer one.
  assert.ok(Object.keys(W.FIRESTORE_CATALOG_READERS).length >= 2);
  assert.equal(typeof W.assertFirestoreCatalogReadCurrent, "function");
  const readDispositions = L.CATALOG_ACTIVATION_DEPENDENCIES
    .filter((d) => /READS|reads|read/.test(d.catalogFact) || d.disposition === "EXPLICITLY_UNAVAILABLE");
  assert.ok(readDispositions.length > 0, "read-side consumers must be dispositioned too");
});
