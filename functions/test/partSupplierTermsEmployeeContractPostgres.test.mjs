// SUP-1: the server half of the Part Detail "Suppliers & Terms" employee-workflow contract (the CAT-1 pattern).
//
// It drives the REAL Operations transport (handleOperationsRequest -> resolveOperationalContext -> partSupplierTerms.ts ->
// PostgreSQL) with requests built by the SCREEN's own builders (field-ops-app-vite/src/domain/partSupplierTerms.js), in
// the order an employee works -- add terms, edit them, lose a race, set a preferred supplier, deactivate -- and pins the
// exact HTTP answers in field-ops-app-vite/test/fixtures/partSupplierTermsContract.json.
//
// The browser half (field-ops-app-vite/test/partSupplierTermsWorkflow.test.jsx) renders the real section through the
// real partsOperationsReads -> reorderApiClient stack, fed THOSE bytes, and asserts it SENT exactly these requests.
// Together: the server provably answers the fixture, and the screen provably shows the employee the right thing for it.
//
// To refresh the fixture after a deliberate contract change: UPDATE_CATALOG_CONTRACT=1 with the database set.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INVENTORY_ROUTE, partSupplierTermsDatabase } from "./support/partSupplierTermsFixture.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE = resolve(REPO_ROOT, "field-ops-app-vite/test/fixtures/partSupplierTermsContract.json");

/** Principal ids are minted per run; the fixture names the ROLE they play instead. Timestamps likewise. */
function normalize(value, principals) {
  return JSON.parse(JSON.stringify(value, (_k, v) => {
    if (typeof v !== "string") return v;
    let out = v;
    for (const [id, name] of principals) out = out.split(id).join(`<principal:${name}>`);
    return out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<timestamp>");
  }));
}

test("the Suppliers & Terms employee workflows answer the contract the section reads", { skip: SKIP, concurrency: 1 }, async (t) => {
  const screen = await import(pathToFileURL(resolve(REPO_ROOT, "field-ops-app-vite/src/domain/partSupplierTerms.js")).href);
  const { makeActor, part, supplier, call } = await partSupplierTermsDatabase(t, { urlBase: URL_BASE, prefix: "sup1_contract", tenants: ["t1"] });

  // The holders the business has: the catalog manager (manage), the catalog administrator (manage + activate), and a
  // reader of the catalog who holds neither.
  const manager = await makeActor("t1", "fb-parts-manager", ["inventory.catalog.read", "inventory.catalog.manage"]);
  const administrator = await makeActor("t1", "fb-catalog-admin", ["inventory.catalog.read", "inventory.catalog.manage", "inventory.catalog.activate"]);
  const reader = await makeActor("t1", "fb-reader", ["inventory.catalog.read"]);
  const principals = [[manager.principalId, "manager"], [administrator.principalId, "administrator"], [reader.principalId, "reader"]];

  const PART = "PRT-SUP-1";
  await part("t1", PART, "EACH");
  await supplier("t1", "sup-arctic", "Arctic Parts Supply");
  await supplier("t1", "sup-cold", "ColdChain Components");
  await supplier("t1", "sup-gone", "Gone Vendor", "INACTIVE");

  // What the employee types, exactly as the section's form holds it (strings).
  const ARCTIC_FORM = { ...screen.EMPTY_TERMS_FORM, supplierId: "sup-arctic", supplierSku: "ARC-100", cost: "12.50", currency: "usd",
    leadTimeDays: "7", minOrderQty: "10", orderMultiple: "5", purchaseUnit: "BOX", conversionNumerator: "12", conversionDenominator: "1",
    contractStart: "2026-01-01", contractEnd: "2026-12-31", availability: "AVAILABLE" };
  const COLD_FORM = { ...screen.EMPTY_TERMS_FORM, supplierId: "sup-cold", supplierSku: "CC-9", cost: "3", currency: "USD", leadTimeDays: "2" };

  const s = {};
  const list = (who) => call(who, "listPartSupplierItems", { partId: PART });
  s.listEmpty = await list(manager);
  s.createApplied = await call(manager, "createPartSupplierItem", screen.buildCreateTermsInput(PART, ARCTIC_FORM));
  s.createReplayed = await call(manager, "createPartSupplierItem", screen.buildCreateTermsInput(PART, ARCTIC_FORM));
  s.createConflict = await call(manager, "createPartSupplierItem", screen.buildCreateTermsInput(PART, { ...ARCTIC_FORM, supplierSku: "ARC-OTHER" }));
  s.listAfterCreate = await list(manager);
  const arcticV1 = s.listAfterCreate.body.result.items[0];
  s.updateApplied = await call(manager, "updatePartSupplierItem", { itemId: arcticV1.itemId, expectedVersion: arcticV1.version,
    changes: screen.buildTermsChanges({ ...screen.termsFormFromItem(arcticV1), cost: "11.75", leadTimeDays: "10" }, arcticV1) });
  s.updateStale = await call(manager, "updatePartSupplierItem", { itemId: arcticV1.itemId, expectedVersion: arcticV1.version,
    changes: screen.buildTermsChanges({ ...screen.termsFormFromItem(arcticV1), supplierSku: "ARC-100B" }, arcticV1) });
  s.listAfterUpdate = await list(manager);
  s.createInvalid = await call(manager, "createPartSupplierItem", screen.buildCreateTermsInput(PART, { ...COLD_FORM, leadTimeDays: "4000" }));
  s.createCold = await call(manager, "createPartSupplierItem", screen.buildCreateTermsInput(PART, COLD_FORM));
  s.listBeforePreferred = await list(manager);
  const coldV1 = s.listBeforePreferred.body.result.items.find((i) => i.supplierId === "sup-cold");
  s.setPreferredApplied = await call(manager, "setPreferredPartSupplierItem", { partId: PART, itemId: coldV1.itemId, expectedVersion: coldV1.version });
  s.listAfterPreferred = await list(manager);
  const coldV2 = s.listAfterPreferred.body.result.items.find((i) => i.supplierId === "sup-cold");
  const statusInput = { itemId: coldV2.itemId, expectedVersion: coldV2.version, status: "INACTIVE" };
  s.statusDenied = await call(manager, "setPartSupplierItemStatus", statusInput);
  s.statusApplied = await call(administrator, "setPartSupplierItemStatus", statusInput);
  s.listMixed = await list(administrator);
  s.listDenied = await list(reader);
  s.createDenied = await call(reader, "createPartSupplierItem", screen.buildCreateTermsInput(PART, COLD_FORM));
  const scenarios = normalize(s, principals);

  await t.test("the server answers each employee action as the contract says", () => {
    const code = (x) => [x.status, x.body.code];
    assert.deepEqual(scenarios.listEmpty.body.result.supplierOptions.map((o) => o.name), ["Arctic Parts Supply", "ColdChain Components"]);
    assert.deepEqual(scenarios.createApplied.body.result.outcome, "created");
    assert.deepEqual(scenarios.createApplied.request.input.currency, "USD", "the builder sends the currency as the server requires it");
    assert.deepEqual(scenarios.createReplayed.body.result.outcome, "replayed");
    assert.deepEqual(code(scenarios.createConflict), [409, "CONFLICT"]);
    assert.deepEqual(scenarios.updateApplied.request.input.changes, { cost: "11.75", leadTimeDays: 10 }, "only what the employee changed");
    assert.deepEqual([scenarios.updateApplied.body.result.outcome, scenarios.updateApplied.body.result.item.version], ["updated", 2]);
    assert.deepEqual(code(scenarios.updateStale), [409, "CONFLICT"]);
    assert.deepEqual(code(scenarios.createInvalid), [400, "INVALID_INPUT"]);
    assert.deepEqual(scenarios.createCold.body.result.outcome, "created");
    assert.deepEqual(scenarios.setPreferredApplied.body.result.outcome, "preferred");
    assert.deepEqual(code(scenarios.statusDenied), [403, "FORBIDDEN"]);
    assert.deepEqual([scenarios.statusApplied.body.result.outcome, scenarios.statusApplied.body.result.item.preferred], ["deactivated", false]);
    assert.deepEqual(scenarios.listMixed.body.result.items.map((i) => [i.supplierName, i.status]),
      [["Arctic Parts Supply", "ACTIVE"], ["ColdChain Components", "INACTIVE"]], "INACTIVE terms are listed, not hidden");
    assert.deepEqual(code(scenarios.listDenied), [403, "FORBIDDEN"]);
    assert.deepEqual(code(scenarios.createDenied), [403, "FORBIDDEN"]);
  });

  await t.test("the section maps every answer to what the employee must be told", () => {
    const shown = (scenario, action) => (scenario.body.ok
      ? screen.outcomeFromResult(scenario.body.result)
      : screen.outcomeFromError({ code: scenario.body.code, message: scenario.body.message }, action)).kind;
    assert.equal(shown(scenarios.createApplied, "create"), "applied");
    assert.equal(shown(scenarios.createReplayed, "create"), "replayed");
    assert.equal(shown(scenarios.createConflict, "create"), "conflict");
    assert.equal(shown(scenarios.createInvalid, "create"), "invalid");
    assert.equal(shown(scenarios.createDenied, "create"), "denied");
    assert.equal(shown(scenarios.updateApplied, "update"), "applied");
    assert.equal(shown(scenarios.updateStale, "update"), "conflict");
    assert.equal(shown(scenarios.setPreferredApplied, "preferred"), "applied");
    assert.equal(shown(scenarios.statusDenied, "status"), "denied");
    assert.equal(shown(scenarios.statusApplied, "status"), "applied");
  });

  await t.test("the committed browser fixture is exactly what the server answers", () => {
    const actual = { route: INVENTORY_ROUTE, partId: PART, scenarios };
    if (process.env.UPDATE_CATALOG_CONTRACT === "1") writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
    const committed = JSON.parse(readFileSync(FIXTURE, "utf8"));
    assert.deepEqual(committed, actual,
      "field-ops-app-vite/test/fixtures/partSupplierTermsContract.json drifted from the server -- the browser test would be " +
      "proving a shape the server no longer sends. Re-run with UPDATE_CATALOG_CONTRACT=1 and review the diff.");
  });
});
