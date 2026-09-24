// CATALOG FREEZE PARITY -- the BEHAVIOURAL half of the freeze proof. No database, no Firebase runtime,
// no network: every command below is called with a POISONED deps object whose first property read
// throws, so a command that reaches its deps at all is visible as such.
//
// What this proves, for every family in LEGACY_CATALOG_MASTER_COMMANDS (Part, Manufacturer, Supplier,
// Part Alias, Part-Supplier Item, Equipment Model, Equipment Model Alias, Part<->Equipment
// Compatibility, Compatibility Source):
//
//   FROZEN   the command refuses with FirestoreCatalogWriterClosedError carrying ITS OWN writer id and
//            FIRESTORE_CATALOG_WRITER_FROZEN, WITHOUT touching deps -- so no Firestore handle, no id
//            parse, no capability resolution, no transaction and no audit event happens first.
//   RETIRED  the same refusal with FIRESTORE_CATALOG_WRITER_RETIRED (freeze is not removal).
//   OPEN     the command is UNCHANGED: the guard is a no-op and the command proceeds to its normal first
//            act (resolving deps), which the poison then reports. It never refuses on freeze grounds.
//
// and, at the API boundary, that every deployed callable that fronts one of these commands maps the
// governed refusal to `failed-precondition` -- never `internal`. An expected freeze refusal is a
// governed outcome, not a server fault.
//
// The committed CATALOG_WRITER_AUTHORITY is NOT changed to run this. The state is injected by replacing
// the guard export on the shared module with one that calls the real assertion against a chosen
// authority; the real function, and the committed constant, are restored after each case.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { LEGACY_CATALOG_MASTER_COMMANDS, LEGACY_CATALOG_CALLABLE_ERROR_MAPPERS } from "./support/legacyCatalogMasterCommands.mjs";

const require = createRequire(import.meta.url);
const writerState = require("../lib/catalogMaster/catalogWriterState.js");
const { FirestoreCatalogWriterClosedError } = writerState;

const REAL_GUARD = writerState.assertFirestoreCatalogWriterOpen;
const st = (firestore, postgres) => ({ firestore, postgres });

/** Any property read throws. A command that gets as far as its deps is caught red-handed. */
const POISON = new Proxy({}, { get(_t, prop) { throw new Error(`DEPS_TOUCHED:${String(prop)}`); } });

function withAuthority(authority, fn) {
  writerState.assertFirestoreCatalogWriterOpen = (writer) => REAL_GUARD(writer, authority);
  try { return fn(); } finally { writerState.assertFirestoreCatalogWriterOpen = REAL_GUARD; }
}

// ── the invocation table: one call per registered writer id ──────────────────────────────────────
const pm = require("../lib/partMaster/partMasterCommands.js");
const sm = require("../lib/supplierMaster/supplierMasterCommands.js");
const pa = require("../lib/partMaster/partAliasCommands.js");
const psi = require("../lib/partMaster/partSupplierItems.js");
const eq = require("../lib/equipmentCompatibility/commands.js");

// Enough of an EquipmentCommandDeps for the pre-acceptance denial path. A throwing resolver is a DENIAL
// by governed contract there, so it cannot serve as a tripwire; `openMarker` below carries that job.
const equipmentDeps = () => ({
  db: { runTransaction: async (fn) => fn({ create() {} }) },
  resolvePermission: () => false,
  newAuditRef: () => ({ id: "audit" }),
  now: () => ({ toMillis: () => 0 }),
});
const equipmentInput = (action) => ({ actorUid: "actor", action, idempotencyKey: "abcdefgh12345678", payload: {} });

const INVOCATIONS = Object.freeze([
  { writerId: "part.create", call: () => pm.createPart({ actorUid: "a", idempotencyKey: "abcdefgh", part: {} }, POISON) },
  { writerId: "part.update", call: () => pm.updatePart({ actorUid: "a", idempotencyKey: "abcdefgh", partId: "P1", expectedVersion: 1, changes: { name: "x" } }, POISON) },
  { writerId: "part.changeStatus", call: () => pm.changePartStatus({ actorUid: "a", idempotencyKey: "abcdefgh", partId: "P1", expectedVersion: 1, newStatus: "ACTIVE" }, POISON) },

  { writerId: "manufacturer.create", call: () => pm.createManufacturer({ actorUid: "a", idempotencyKey: "abcdefgh", manufacturerId: "M1", name: "M" }, POISON) },
  { writerId: "manufacturer.update", call: () => pm.updateManufacturer({ actorUid: "a", idempotencyKey: "abcdefgh", manufacturerId: "M1", expectedVersion: 1, name: "M" }, POISON) },
  { writerId: "manufacturer.changeStatus", call: () => pm.changeManufacturerStatus({ actorUid: "a", idempotencyKey: "abcdefgh", manufacturerId: "M1", expectedVersion: 1, newStatus: "ACTIVE" }, POISON) },

  { writerId: "supplier.create", call: () => sm.createSupplier({ actorUid: "a", idempotencyKey: "abcdefgh", supplierId: "S1", name: "S" }, POISON) },
  { writerId: "supplier.update", call: () => sm.updateSupplier({ actorUid: "a", idempotencyKey: "abcdefgh", supplierId: "S1", expectedVersion: 1, changes: { name: "S" } }, POISON) },
  { writerId: "supplier.activate", call: () => sm.activateSupplier({ actorUid: "a", idempotencyKey: "abcdefgh", supplierId: "S1", expectedVersion: 1 }, POISON) },
  { writerId: "supplier.deactivate", call: () => sm.deactivateSupplier({ actorUid: "a", idempotencyKey: "abcdefgh", supplierId: "S1", expectedVersion: 1 }, POISON) },

  { writerId: "partAlias.create", call: () => pa.createPartAlias({ actorUid: "a", idempotencyKey: "abcdefgh", partId: "P1", aliasType: "UPC", rawValue: "012345678905" }, POISON) },
  { writerId: "partAlias.deactivate", call: () => pa.deactivatePartAlias({ actorUid: "a", idempotencyKey: "abcdefgh", aliasId: "A1", expectedVersion: 1 }, POISON) },
  { writerId: "partAlias.reactivate", call: () => pa.reactivatePartAlias({ actorUid: "a", idempotencyKey: "abcdefgh", aliasId: "A1", expectedVersion: 1 }, POISON) },

  { writerId: "partSupplierItem.create", call: () => psi.createPartSupplierItem({ actorUid: "a", idempotencyKey: "abcdefgh", partId: "P1", supplierId: "S1", supplierSku: "X", cost: 1, currency: "USD", leadTimeDays: 1 }, POISON) },
  { writerId: "partSupplierItem.update", call: () => psi.updatePartSupplierItem({ actorUid: "a", idempotencyKey: "abcdefgh", itemId: "P1__S1", expectedVersion: 1, changes: { cost: 2 } }, POISON) },
  { writerId: "partSupplierItem.changeStatus", call: () => psi.changePartSupplierItemStatus({ actorUid: "a", idempotencyKey: "abcdefgh", itemId: "P1__S1", expectedVersion: 1, newStatus: "INACTIVE" }, POISON) },
  { writerId: "partSupplierItem.setPreferred", call: () => psi.setPreferredSupplier({ actorUid: "a", idempotencyKey: "abcdefgh", partId: "P1", supplierId: "S1", expectedVersion: 1 }, POISON) },

  // The Equipment Model family is gated inside its own accept step, so the tripwire that proves it got
  // past the gate while OPEN is the NEXT thing that step does: read the payload's governed identity.
  { writerId: "equipmentModel.import", openMarker: /payload is missing its equipmentModelId identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("importEquipmentModel"), equipmentDeps()) },
  { writerId: "equipmentModelAlias.import", openMarker: /payload is missing its aliasKey identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("importEquipmentModelAlias"), equipmentDeps()) },

  // Part <-> Equipment compatibility: same command, same accept step, same tripwire. The relationship's
  // identity field is compatibilityId for all three relationship actions; evidence is filed under its
  // own sourceId. A freeze that stopped the Model import but let `verifyCompatibility` or a conflicting
  // `importCompatibilitySource` through would let a frozen relationship change, which is what the
  // Owner ruling forbids.
  { writerId: "equipmentPartCompatibility.import", openMarker: /payload is missing its compatibilityId identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("importCompatibility"), equipmentDeps()) },
  { writerId: "equipmentPartCompatibility.verify", openMarker: /payload is missing its compatibilityId identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("verifyCompatibility"), equipmentDeps()) },
  { writerId: "equipmentPartCompatibility.correct", openMarker: /payload is missing its compatibilityId identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("correctCompatibility"), equipmentDeps()) },
  { writerId: "equipmentCompatibilitySource.import", openMarker: /payload is missing its sourceId identity/, call: () => eq.runEquipmentCompatibilityCommand(equipmentInput("importCompatibilitySource"), equipmentDeps()) },
]);

// ── the census closes: every registered writer is exercised here, and only registered ones ──────────

test("the freeze parity suite exercises EXACTLY the registered catalog writer set", () => {
  const exercised = INVOCATIONS.map((i) => i.writerId);
  assert.deepEqual(exercised.slice().sort(), Object.keys(writerState.FIRESTORE_CATALOG_WRITERS).sort());
  assert.deepEqual(exercised.slice().sort(), LEGACY_CATALOG_MASTER_COMMANDS.flatMap((c) => c.writerIds).sort());
  assert.equal(exercised.length, 23);
});

// ── FROZEN / RETIRED: every family refuses, with its own id, before it does anything ────────────────

for (const [state, code] of [[st("FROZEN", "INACTIVE"), "FIRESTORE_CATALOG_WRITER_FROZEN"], [st("FROZEN", "ACTIVE"), "FIRESTORE_CATALOG_WRITER_FROZEN"], [st("RETIRED", "ACTIVE"), "FIRESTORE_CATALOG_WRITER_RETIRED"]]) {
  test(`under ${state.firestore}/${state.postgres} every catalog master command refuses with ${code} and touches nothing first`, async () => {
    for (const { writerId, call } of INVOCATIONS) {
      const err = await withAuthority(state, () => call().then(() => null, (e) => e));
      assert.ok(err instanceof FirestoreCatalogWriterClosedError, `${writerId} must refuse on freeze grounds, got: ${err && err.message}`);
      assert.equal(err.code, code, writerId);
      assert.equal(err.writer, writerId, `${writerId} must refuse under its OWN writer id`);
      assert.doesNotMatch(String(err.message), /DEPS_TOUCHED|identity/, `${writerId} got past the guard before refusing`);
    }
  });
}

// ── OPEN: nothing changes ───────────────────────────────────────────────────────────────────────────

test("under the committed OPEN/INACTIVE state every catalog master command is UNCHANGED -- the guard is a no-op and the command proceeds", async () => {
  assert.deepEqual({ ...writerState.CATALOG_WRITER_AUTHORITY }, st("OPEN", "INACTIVE"));
  for (const { writerId, call, openMarker } of INVOCATIONS) {
    const err = await withAuthority(st("OPEN", "INACTIVE"), () => call().then(() => null, (e) => e));
    assert.ok(!(err instanceof FirestoreCatalogWriterClosedError), `${writerId} must NOT refuse on freeze grounds while OPEN`);
    // It got past the guard and went on to its normal first act. The tripwire firing is the proof.
    assert.match(String(err && err.message), openMarker ?? /DEPS_TOUCHED/, `${writerId} stopped for some other reason: ${err && err.message}`);
  }
});

test("the guard used by the commands is the real, committed one once the injection is undone", () => {
  assert.equal(writerState.assertFirestoreCatalogWriterOpen, REAL_GUARD);
  for (const id of Object.keys(writerState.FIRESTORE_CATALOG_WRITERS)) {
    assert.doesNotThrow(() => writerState.assertFirestoreCatalogWriterOpen(id));
  }
});

// ── F4: the API boundary. A governed refusal is never an internal server error ──────────────────────

test("every deployed catalog callable maps a freeze refusal to failed-precondition, never internal", () => {
  assert.equal(LEGACY_CATALOG_CALLABLE_ERROR_MAPPERS.length, 5);
  for (const { family, lib, writerId } of LEGACY_CATALOG_CALLABLE_ERROR_MAPPERS) {
    const { mapError } = require(lib);
    for (const state of ["FROZEN", "RETIRED"]) {
      const mapped = mapError(new FirestoreCatalogWriterClosedError(writerId, state));
      assert.equal(mapped.code, "failed-precondition", `${family} ${state} must be failed-precondition, got ${mapped.code}`);
      assert.notEqual(mapped.code, "internal");
      assert.doesNotMatch(mapped.message, new RegExp(writerId), `${family} must not leak the internal writer id`);
    }
  }
});

test("a freeze refusal reaching a callable is distinguishable from the generic internal fallback", () => {
  for (const { lib } of LEGACY_CATALOG_CALLABLE_ERROR_MAPPERS) {
    const { mapError } = require(lib);
    assert.equal(mapError(new Error("something else")).code, "internal", "the catch-all is still internal");
  }
});
