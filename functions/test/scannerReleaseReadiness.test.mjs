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

// ═══════════════════════════════════════════ the four scanner Roles (sandbox promotion)
//
// THE CORRECTION THIS SECTION RECORDS. The test below was written as "the release-blocking fact",
// and the fact was true -- but the fix it implied was wrong. warehouseManager, warehouseAssociate,
// partsManager and partsAssociate carry no permissions BY DESIGN: they are org-chart POSITIONS, and
// each one says so in its own description. Operational authority has always lived in separate
// FUNCTIONAL Roles (inventoryTransferOperator, inventoryCycleCountCounter), and a principal holds
// both a position and one or more functions.
//
// So the scanner became reachable by adding four functional Roles, NOT by putting capabilities onto
// the positions -- which would have made every future warehouse hire an inventory writer by virtue
// of their job title. These tests pin what each new Role carries, and just as importantly what it
// does not.

const SCANNER_ROLE_CONTRACT = Object.freeze({
  INVENTORY_PUT_AWAY_OPERATOR_ROLE: ["inventory.location.bin.read", "inventory.placement.record"],
  INVENTORY_BIN_ADMINISTRATOR_ROLE: ["inventory.location.bin.manage", "inventory.location.bin.read"],
  INVENTORY_RETURNS_INTAKE_CLERK_ROLE: ["inventory.returns.intake"],
  INVENTORY_LOOKUP_READER_ROLE: [
    "inventory.balance.read", "inventory.catalog.alias.read",
    "inventory.serializedAsset.read", "inventory.location.display.read",
  ],
});

test("each scanner Role carries EXACTLY its stated capabilities and nothing else", () => {
  for (const [key, expected] of Object.entries(SCANNER_ROLE_CONTRACT)) {
    const role = governedRoles[key];
    assert.ok(role, `${key} must exist`);
    assert.deepEqual([...role.permissions].sort(), [...expected].sort(), `${role.id} drifted`);
    assert.equal(role.privileged, false, `${role.id} administers no security policy`);
  }
});

test("STOWING AND RETIRING RACKING STAY SEPARATE", () => {
  // putAwayCommand.ts states the rule: "a warehouse operator stows all day and should never be able
  // to retire a rack." Two Roles is how that sentence is enforced rather than merely written down.
  const operator = governedRoles.INVENTORY_PUT_AWAY_OPERATOR_ROLE;
  const admin = governedRoles.INVENTORY_BIN_ADMINISTRATOR_ROLE;
  assert.equal(holds(operator, "inventory.location.bin.manage"), false, "a stower must not retire racking");
  assert.equal(holds(admin, "inventory.placement.record"), false, "a bin administrator must not stow stock");
});

test("NO scanner Role carries inventory.stock.receive — the deferral is still in force", () => {
  // Accepting stock into the company's custody is a different authority from recording where it went,
  // and widening who may do it stays the separately deferred Owner decision it already was.
  for (const key of Object.keys(SCANNER_ROLE_CONTRACT)) {
    assert.equal(holds(governedRoles[key], "inventory.stock.receive"), false, `${key} must not confer receiving`);
  }
});

test("the LOOKUP Role is read-only — every id it carries is a read", () => {
  // The one scanner Role safe to grant broadly. If a write ever appears here, that stops being true.
  for (const id of governedRoles.INVENTORY_LOOKUP_READER_ROLE.permissions) {
    assert.match(id, /\.read$/, `${id} is not a read and must not be in the lookup bundle`);
  }
  // Resolving an alias is not administering one. Reusing catalog.manage here was the exact mistake
  // the alias-lookup capability was created to avoid.
  assert.equal(holds(governedRoles.INVENTORY_LOOKUP_READER_ROLE, "inventory.catalog.manage"), false);
});

test("returns intake confers NO disposition authority, because disposition does not exist", () => {
  // Decision #118. The Role carries intake and nothing adjacent; when disposition exists it gets its
  // own Role. A capability id containing "disposition" appearing here would mean #118 was crossed.
  const clerk = governedRoles.INVENTORY_RETURNS_INTAKE_CLERK_ROLE;
  assert.deepEqual(clerk.permissions, ["inventory.returns.intake"]);
  assert.equal(clerk.permissions.some((id) => /disposition/i.test(id)), false);
});

test("THE POSITIONS STILL CARRY NOTHING — and that is the design, not an oversight", () => {
  // Each of these four says "Carries no permissions of its own" in its own description. A position
  // describes where somebody sits in the org chart; it must never be what makes them an inventory
  // writer. If a scanner capability ever appears on one of them, somebody has taken the shortcut
  // this project deliberately did not take -- and this test is where that gets caught.
  //
  // The scanner is reached instead by holding one of the four functional Roles above, granted per
  // principal through an audited roleAssignment. That grant is a rollout action, not a repo change,
  // and it stays that way.
  //
  // The recorded deferral is unaffected: compatibilityRoles.ts notes PARTS_ASSOCIATE is DEFERRED for
  // `inventory.stock.receive` "until a separately ratified scoped model or an explicit Owner
  // acceptance of global Receiving authority", and no Role added here confers receiving.
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
