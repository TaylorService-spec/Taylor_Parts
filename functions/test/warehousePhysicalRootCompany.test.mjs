// Workstream 2A.1A — the Warehouse physical-root company compatibility amendment (Owner ruling R-18).
//
// ONE CANONICAL OPINION. Every consumer reads the same validator, so this file's job is to prove that
// a company-bearing warehouse is governed for ALL of them, and that no consumer grew its own view of
// whether the field is permitted:
//
//     Receiving · Transfers · the status writer · the governance verifier · Reorder eligibility
//
// Before this amendment every one of those rejected a company-bearing warehouse, which is why the
// blocker was never Reorder's.
//
// STORAGE VALIDITY IS NOT WRITE AUTHORITY. Widening the shape makes the fact storable and nothing
// more; no writer here may author it, and the last section asserts that rather than trusting it.
//
// OFFLINE. Pure functions and a fake Firestore; no emulator.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Timestamp } from "firebase-admin/firestore";

import {
  validateGovernedWarehouse,
  GOVERNED_WAREHOUSE_REASONS,
} from "../lib/warehouseGovernance/governedWarehouseValidation.js";
import {
  classifyWarehouse,
  buildMigratedRecord,
  warehouseGovernanceFingerprint,
} from "../lib/warehouseGovernance/warehouseGovernanceMigration.js";
import { verifyWarehouseGovernance } from "../lib/warehouseGovernance/warehouseGovernanceVerifier.js";
import { listEligibleReceivingLocationOptions } from "../lib/warehouseGovernance/receivingLocationOptionsService.js";
import { makeResolveWarehouseLocationActive } from "../lib/inventoryReceiving/receivingLocationResolver.js";
import { makeResolveTransferLocationActive } from "../lib/inventoryTransfer/transferLocationResolver.js";
import { projectReorderWarehouseOptions } from "../lib/reorderRequest/reorderCallables.js";
import { resolveReorderWarehouseScope } from "../lib/reorderRequest/reorderWarehouseEligibility.js";

const TS = Timestamp.fromMillis(1_756_000_000_000);

/** A §3A-complete MIGRATED record. `over` deviates from a genuinely valid baseline, so a failure is
 *  always attributable to the deviation and never to a fixture that was never valid. */
const warehouse = (id, over = {}) => ({
  id,
  name: `Warehouse ${id}`,
  location: "Phoenix, AZ",
  status: "ACTIVE",
  version: 1,
  updatedAt: TS,
  updatedBy: "seed",
  provenance: "MIGRATED",
  governanceInitializedAt: TS,
  governanceInitializedBy: "seed",
  ...over,
});

const LEGACY = warehouse("wh-legacy");                                  // predates Ownership v1
const OWNED = warehouse("wh-owned", { operatingCompanyId: "taylor" });  // a governed physical root

/** A Firestore double with just enough surface for the two transactional resolvers. */
const fakeDb = (docs) => ({
  collection: (name) => ({
    doc: (id) => ({ __key: `${name}/${id}` }),
  }),
});
const fakeTxn = (docs) => ({
  get: async (ref) => {
    const data = docs[ref.__key];
    return { exists: data !== undefined, id: ref.__key.split("/")[1], data: () => data };
  },
});

// =========================== the canonical shape ===========================

test("a company-bearing warehouse is GOVERNED, and the company survives into the reconstruction", () => {
  const result = validateGovernedWarehouse(OWNED, "wh-owned");
  assert.equal(result.valid, true);
  // Carried through, not merely tolerated: a consumer reading `value` must see the ownership fact,
  // or the amendment would have made the field storable and invisible.
  assert.equal(result.value.operatingCompanyId, "taylor");
});

test("a warehouse WITHOUT a company is still a valid legacy governed warehouse", () => {
  // R-18 is explicit that this must not become required. Warehouses legitimately predate Ownership
  // v1, no governed writer exists to populate them, and no migration is authorized -- requiring it
  // would strand every historical record.
  const result = validateGovernedWarehouse(LEGACY, "wh-legacy");
  assert.equal(result.valid, true);
  assert.ok(!("operatingCompanyId" in result.value), "absent stays absent -- never defaulted");
});

test("a malformed company fails closed, and says WHICH thing was wrong", () => {
  // The field is permitted; the VALUE is not. A distinct reason from unknown_field, because
  // "you may not store that" and "that is not a company" are different corrections.
  for (const bad of ["acme", "TAYLOR", "Taylor Service", "", "   ", null, 7, {}, ["taylor"]]) {
    const r = validateGovernedWarehouse(warehouse("wh-x", { operatingCompanyId: bad }), "wh-x");
    assert.equal(r.valid, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(r.reason, GOVERNED_WAREHOUSE_REASONS.OPERATING_COMPANY_INVALID, JSON.stringify(bad));
  }
});

test("the allow-list did not become an open door", () => {
  // The amendment permits ONE new field. Everything else is still refused, including the legacy
  // `active` flag, which has its own earlier and more specific reason.
  assert.equal(validateGovernedWarehouse(warehouse("wh-x", { region: "south" }), "wh-x").reason, GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD);
  assert.equal(validateGovernedWarehouse(warehouse("wh-x", { companyId: "taylor" }), "wh-x").reason, GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD);
  assert.equal(validateGovernedWarehouse(warehouse("wh-x", { operatingCompany: "taylor" }), "wh-x").reason, GOVERNED_WAREHOUSE_REASONS.UNKNOWN_FIELD);
  assert.equal(validateGovernedWarehouse(warehouse("wh-x", { active: true }), "wh-x").reason, GOVERNED_WAREHOUSE_REASONS.ACTIVE_FORBIDDEN);
});

// =========================== all six consumers ===========================

test("CONSUMER 1 -- Receiving accepts a company-bearing warehouse as a destination", async () => {
  const docs = { "warehouses/wh-owned": OWNED, "warehouses/wh-legacy": LEGACY };
  const resolve = makeResolveWarehouseLocationActive(fakeDb(docs));
  const txn = fakeTxn(docs);
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-owned" }), true);
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-legacy" }), true, "and the legacy one is unaffected");
});

test("CONSUMER 2 -- Transfers accept it as an endpoint", async () => {
  const docs = { "warehouses/wh-owned": OWNED, "warehouses/wh-legacy": LEGACY };
  const resolve = makeResolveTransferLocationActive(fakeDb(docs));
  const txn = fakeTxn(docs);
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-owned" }), true);
  assert.equal(await resolve(txn, { type: "WAREHOUSE", locationId: "wh-legacy" }), true);
});

test("CONSUMER 3 -- the Receiving location picker offers it", async () => {
  // The envelope takes NO fields -- the actor is trusted context, never request data.
  const options = await listEligibleReceivingLocationOptions({}, {
    actor: { kind: "USER", id: "u1" },
    authorize: async () => true,
    runRead: async (fn) => fn({}),
    readCandidateWarehouses: async () => [
      { warehouseId: "wh-owned", data: OWNED },
      { warehouseId: "wh-legacy", data: LEGACY },
    ],
  });
  assert.deepEqual(options.map((o) => o.value).sort(), ["wh-legacy", "wh-owned"]);
});

test("CONSUMER 4 -- the governance verifier reports it GOVERNED, and the run PASSES", () => {
  const v = verifyWarehouseGovernance([
    { warehouseId: "wh-owned", data: OWNED },
    { warehouseId: "wh-legacy", data: LEGACY },
  ]);
  assert.equal(v.pass, true);
  assert.equal(v.counts.governed, 2);
  assert.equal(v.counts.legacy, 0);
});

test("CONSUMER 5 -- Reorder eligibility offers it (and still excludes a company-less one)", () => {
  const scope = resolveReorderWarehouseScope({
    uid: "u1", userSecurityRole: "admin", userEmployeeId: null,
    employeeExists: false, employeeUserId: undefined,
    employeeEmploymentStatus: undefined, employeeOperationalRoles: undefined,
    employeeAssignedWarehouseIds: undefined,
  });
  const options = projectReorderWarehouseOptions(scope, [
    { id: "wh-owned", data: OWNED },
    { id: "wh-legacy", data: LEGACY },
  ]);
  // The reorder picker requires a company because the request DERIVES its company from the
  // warehouse -- so a legacy root is correctly withheld there while remaining perfectly valid
  // everywhere else. That asymmetry is the command's requirement, not a second shape opinion.
  assert.deepEqual(options.map((o) => o.warehouseId), ["wh-owned"]);
});

test("CONSUMER 6 -- migration classification calls it GOVERNED, not legacy", () => {
  // THE ERASE PATH, closed at its source. Before the amendment this returned DERIVE purely because
  // the field existed, which is what made the record a migration target.
  assert.equal(classifyWarehouse("wh-owned", OWNED).category, "GOVERNED");
  assert.equal(classifyWarehouse("wh-legacy", LEGACY).category, "GOVERNED");
});

// =========================== migration never erases ===========================

test("the migration builder PRESERVES an existing company", () => {
  // Where migration legitimately processes a record -- a genuinely legacy document that happens to
  // carry the ownership fact -- the builder replaces the whole document, so preservation has to be
  // explicit. It may normalize what it owns; it may not drop what it does not.
  const legacyWithCompany = { name: "Legacy", location: "Phoenix, AZ", active: true, operatingCompanyId: "ventana" };
  const built = buildMigratedRecord("wh-x", legacyWithCompany, "ACTIVE", { actorId: "operator", nowMillis: 1_756_000_000_000 });
  assert.equal(built.operatingCompanyId, "ventana");
  assert.equal(validateGovernedWarehouse(built, "wh-x").valid, true, "and the result is itself governed");
});

test("the migration builder invents no company where there was none", () => {
  const built = buildMigratedRecord("wh-x", { name: "Legacy", location: "Phoenix, AZ", active: true }, "ACTIVE", { actorId: "operator", nowMillis: 1 });
  assert.ok(!("operatingCompanyId" in built));
});

test("a governed company-bearing record is a byte-stable no-op, so nothing plans to rewrite it", () => {
  // The fingerprint is what STALE_PRESTATE compares. A GOVERNED record is never restaged, which is
  // the second half of why the erase path is closed: it is not merely preserved on rewrite, it is
  // not rewritten at all.
  assert.equal(classifyWarehouse("wh-owned", OWNED).category, "GOVERNED");
  assert.equal(
    warehouseGovernanceFingerprint(OWNED),
    warehouseGovernanceFingerprint({ ...OWNED }),
    "the fingerprint is stable across an identical read",
  );
});

// =========================== storage validity is not write authority ===========================

const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");

test("Rules still deny every client write to warehouses -- this amendment granted nothing", () => {
  // The measurement's safety clearance, made permanent. Widening a stored shape cannot hand a
  // client writer anything while this holds, and if it ever stops holding, the clearance that
  // justified the widening has expired.
  const block = /match \/warehouses\/\{warehouseId\} \{([\s\S]*?)\n    \}/.exec(rules);
  assert.ok(block, "the warehouses match block must exist");
  const body = block[1].replace(/\/\/[^\n]*/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(body, [
    "allow read: if isAdminOrDispatcher() || isAssignedToWarehouse(warehouseId);",
    "allow create, update, delete: if false;",
  ]);
});

test("no server writer can author or change the company", () => {
  // The two trusted writers accept an EXACT key set from their untrusted request. Neither list may
  // grow to include the company as a side effect of this amendment: assigning a physical root's
  // company is 2A.1B, a separate authority decision.
  const writer = readFileSync(new URL("../src/warehouseGovernance/warehouseStatusWriter.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.match(writer, /CREATE_ALLOWED_KEYS[^=]*=\s*new Set\(\["warehouseId", "name", "location"\]\)/);
  assert.match(writer, /SET_STATUS_ALLOWED_KEYS[^=]*=\s*new Set\(\["warehouseId", "expectedVersion", "targetStatus"\]\)/);
  assert.doesNotMatch(writer, /operatingCompanyId/, "the status writer must not know how to set a company");
});

test("a status transition preserves the company, and touches nothing else", () => {
  // setWarehouseStatus updates four named fields. The company is preserved because it is not among
  // them -- true today by construction, and asserted here so it stays true deliberately rather than
  // by luck if that update ever widens.
  const writer = readFileSync(new URL("../src/warehouseGovernance/warehouseStatusWriter.ts", import.meta.url), "utf8");
  const update = /txn\.update\(ref, \{([^}]*)\}\)/.exec(writer);
  assert.ok(update, "the status transition must perform a narrow field update");
  const fields = update[1].split(",").map((f) => f.split(":")[0].trim()).filter(Boolean);
  assert.deepEqual(fields.sort(), ["status", "updatedAt", "updatedBy", "version"]);

  // And the record it rebuilds for its self-check spreads the CURRENT parsed record, so a stored
  // company travels through the transition rather than being dropped by reconstruction.
  const transitioned = { ...validateGovernedWarehouse(OWNED, "wh-owned").value, status: "INACTIVE", version: 2, updatedAt: TS, updatedBy: "op" };
  const check = validateGovernedWarehouse(transitioned, "wh-owned");
  assert.equal(check.valid, true);
  assert.equal(check.value.operatingCompanyId, "taylor");
});

test("mobile_locations, the OTHER physical root, was not touched by any of this", () => {
  // Recorded so a future reader does not assume both roots were blocked and both were amended. The
  // mobile-location reader checks required fields rather than enforcing a closed allow-list, so it
  // never rejected the company in the first place and needed no change.
  const repo = readFileSync(new URL("../src/truckRegistry/truckRegistryRepository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repo, /operatingCompanyId/, "no company handling was added to the truck registry");
});
