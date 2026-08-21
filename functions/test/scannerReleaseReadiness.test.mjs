// SCANNER RELEASE READINESS — the matrix, as an executable assertion.
// Run: node --test test/scannerReleaseReadiness.test.mjs
//
// ============================ WHY THIS IS A TEST AND NOT A TABLE ============================
//
// A release-readiness matrix in a document is stale the day after it is written, and the failure
// mode is specific and bad: it says a thing is granted when it is not, someone plans a rollout on
// it, and the gap is discovered in the sandbox by an operator who cannot do their job.
//
// So the matrix lives here. Every row asserts what the repository ACTUALLY says right now. When a
// grant or an activation genuinely changes, this file changes with it in the same commit — and
// until then it is impossible for the documented state and the real state to drift apart.
//
// docs/product/scanner-release-readiness.md is the human-readable rendering of exactly these facts.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PERMISSION_CATALOG } from "../lib/access/permissionCatalog.js";
import { ADMIN_ROLE, DISPATCHER_ROLE, TECHNICIAN_ROLE } from "../lib/access/compatibilityRoles.js";
import * as governedRoles from "../lib/access/governedBusinessRoles.js";

const capability = (id) => PERMISSION_CATALOG.find((p) => p.id === id);
const isInert = (id) => capability(id)?.active === false;
const holds = (role, id) => (role?.permissions ?? []).includes(id);

/** Every capability the scanner program depends on. */
const SCANNER_CAPABILITIES = Object.freeze({
  receiving: ["inventory.stock.receive"],
  aliasLookup: ["inventory.catalog.alias.read"],
  serializedLookup: ["inventory.serializedAsset.read"],
  balanceLookup: ["inventory.balance.read", "inventory.location.display.read"],
  bins: ["inventory.location.bin.manage", "inventory.location.bin.read"],
  placement: ["inventory.placement.record"],
  transfers: ["inventory.transfer.dispatch", "inventory.transfer.receive"],
  cycleCount: ["inventory.cycleCount.create", "inventory.cycleCount.submit"],
  returns: ["inventory.returns.intake"],
});

const ALL_SCANNER_CAPABILITIES = Object.freeze(Object.values(SCANNER_CAPABILITIES).flat());

/** The personas the scanner was built for, as governed business roles. */
const WAREHOUSE_PERSONAS = Object.freeze([
  "WAREHOUSE_MANAGER_ROLE", "WAREHOUSE_ASSOCIATE_ROLE", "PARTS_MANAGER_ROLE", "PARTS_ASSOCIATE_ROLE",
]);

// ═══════════════════════════════════════════ activation

test("every scanner capability exists in the catalog", () => {
  for (const id of ALL_SCANNER_CAPABILITIES) {
    assert.ok(capability(id), `${id} is referenced by the scanner but not registered`);
  }
});

test("exactly ONE scanner capability is active: inventory.stock.receive", () => {
  // Pinned deliberately. If a second becomes active, that is a rollout event and this test is where
  // it gets noticed — not in a sandbox by someone who assumed it already was.
  const active = ALL_SCANNER_CAPABILITIES.filter((id) => !isInert(id));
  assert.deepEqual(active, ["inventory.stock.receive"]);
});

test("the other twelve are INERT — registered, and denying for everyone", () => {
  const inert = ALL_SCANNER_CAPABILITIES.filter(isInert);
  assert.equal(inert.length, 12);
  for (const id of inert) {
    assert.equal(capability(id).active, false, `${id} must be inert`);
  }
});

// ═══════════════════════════════════════════ grants — the release-blocking finding

test("ADMIN holds every scanner capability", () => {
  for (const id of ALL_SCANNER_CAPABILITIES) {
    assert.ok(holds(ADMIN_ROLE, id), `admin should hold ${id}`);
  }
});

test("DISPATCHER holds receiving only", () => {
  const held = ALL_SCANNER_CAPABILITIES.filter((id) => holds(DISPATCHER_ROLE, id));
  assert.deepEqual(held, ["inventory.stock.receive"]);
});

test("TECHNICIAN holds NO scanner capability — their scanner needs none", () => {
  // The work-order scanner is gated on the technician's own server-side rule, not a capability.
  const held = ALL_SCANNER_CAPABILITIES.filter((id) => holds(TECHNICIAN_ROLE, id));
  assert.deepEqual(held, []);
});

test("NO WAREHOUSE OR PARTS PERSONA HOLDS ANY SCANNER CAPABILITY", () => {
  // THE RELEASE-BLOCKING FACT, pinned so it cannot be mistaken for an oversight or quietly assumed
  // fixed. Activation alone would change nothing for the people the scanner was built for: a Parts
  // Associate still could not receive, count, stow, pick or transfer.
  //
  // Granting these is a ROLLOUT ACTION and an Owner decision, not a repository fix. There is already
  // a recorded deferral on the nearest one -- compatibilityRoles.ts notes PARTS_ASSOCIATE is
  // DEFERRED for `inventory.stock.receive` "until a separately ratified scoped model or an explicit
  // Owner acceptance of global Receiving authority".
  //
  // When grants are made, this test is where the change is declared.
  for (const key of WAREHOUSE_PERSONAS) {
    const role = governedRoles[key];
    assert.ok(role, `${key} should exist in the governed role model`);
    const held = ALL_SCANNER_CAPABILITIES.filter((id) => holds(role, id));
    assert.deepEqual(held, [], `${role.id} unexpectedly holds ${held.join(", ")} — if deliberate, this test must be updated in the same commit`);
  }
});

test("OWNER inherits the admin grants by composition, and no persona inherits by accident", () => {
  const owner = governedRoles.OWNER_ROLE;
  assert.ok(owner, "the owner role should exist");
  for (const id of ALL_SCANNER_CAPABILITIES) {
    assert.ok(holds(owner, id), `owner should inherit ${id}`);
  }
});

// ═══════════════════════════════════════════ readiness gates

test("the three readiness gates are FALSE everywhere except receiving in the sandbox", () => {
  const registry = JSON.parse(readFileSync(new URL("../../config/environments.json", import.meta.url), "utf8"));
  const environments = registry.environments;
  assert.ok(Array.isArray(environments) && environments.length > 0, "the environment registry should be a non-empty list");

  const ready = [];
  for (const env of environments) {
    const r = env.readiness ?? {};
    for (const key of ["RECEIVING_TRANSPORT_READY", "PART_IDENTIFIER_TRANSPORT_READY", "INVENTORY_BALANCE_READ_READY"]) {
      if (r[key] === true) ready.push(`${env.id}.${key}`);
    }
  }
  // Exactly one flip exists anywhere, and it is the sandbox's receiving transport.
  assert.deepEqual(ready, ["platform-sandbox.RECEIVING_TRANSPORT_READY"]);
});

test("every readiness key the scanner reads is REQUIRED of every environment", () => {
  // An environment that omits one resolves undefined -> falsy, which happens to fail closed. That is
  // an accident, not a design, so the registry requires them explicitly.
  const src = readFileSync(new URL("../../scripts/resolveEnvironment.mjs", import.meta.url), "utf8");
  for (const key of ["RECEIVING_TRANSPORT_READY", "PART_IDENTIFIER_TRANSPORT_READY", "INVENTORY_BALANCE_READ_READY"]) {
    assert.match(src, new RegExp(`['"]${key}['"]`), `${key} must be a REQUIRED readiness key`);
  }
});

// ═══════════════════════════════════════════ callable dependencies

test("every scanner callable is EXPORTED — export is not deployment, but a missing one is a gap", () => {
  const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  const required = [
    "receiveInventoryStock", "getPurchaseOrderReceivingProgress", "listReceivablePurchaseOrders",
    "resolveScannedPartIdentifier", "getPartBalance", "getAvailableEquipment", "getLocationDisplay",
    "createBin", "resolveBin", "listBins", "recordPutAway", "recordReturnIntake",
    "dispatchTransferOrder", "receiveTransferOrder", "createCycleCount", "submitCycleCount",
  ];
  for (const name of required) {
    assert.match(index, new RegExp(`\\b${name}\\b`), `${name} must be exported from functions/src/index.ts`);
  }
});

// ═══════════════════════════════════════════ Rules and migration dependencies

test("the scanner's THREE new collections need no firestore.rules block — absent is deny-all", () => {
  // Stated as a test because "we did not touch Rules" is exactly the claim a reader should be able
  // to verify rather than take on trust.
  const rules = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8");
  for (const collection of ["bins", "bin_placements", "inventory_returns"]) {
    assert.doesNotMatch(
      rules,
      new RegExp(`match /${collection}/`),
      `${collection} must have NO match block: absent means deny-all, and the commands run on the Admin SDK`,
    );
  }
});

test("no scanner workflow depends on a migration or a backfill", () => {
  // Every command derives its own document ids and reads live authorities. Nothing needs seeded
  // state to be correct -- only to be demonstrable, which is a sandbox fixture concern, not a
  // release dependency.
  const commands = [
    "../src/inventoryLocation/binCommands.ts",
    "../src/inventoryLocation/putAwayCommand.ts",
    "../src/inventoryReturns/returnIntakeCommand.ts",
  ];
  for (const file of commands) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const forbidden of [/backfill/i, /migrat/i, /seed\(/i]) {
      assert.doesNotMatch(src, forbidden, `${file} must not depend on ${forbidden}`);
    }
  }
});
