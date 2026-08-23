// THE MIGRATION THAT WILL RUN AGAINST LIVE RECORDS.
//
// ============================ WHY THIS IS TESTED HARDER THAN THE FIXTURE ============================
//
// Everything else in this program builds data that can be rebuilt. This rewrites an identity field on
// 278 records that already exist in the sandbox and cannot be reset. There is no second attempt at a
// half-finished identity migration -- the fleet would be split across two schemes with no record of
// which record is on which.
//
// So the double below is seeded with the ACTUAL defect: legacy `cw-model-taylor-c713` document ids,
// the legacy record shape the registry refuses, and equipment pointing at them. The migration is then
// asked to do its job, and the assertions are about what SURVIVED, not about what the code intended.
//
// ============================ THE DOUBLE ============================
//
// A small in-memory Firestore. It implements exactly what the migration uses -- collection().get(),
// doc().get(), batch() with set/update/delete, and serverTimestamp -- and it distinguishes set-merge
// from update, because that distinction is the whole reason the migration cannot lose a field.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { runMigration, buildMapping } =
  await import(L("functions/scripts/certificationWorld/migrateEquipmentModelIdentity.mjs"));
const { modelFromFirestore } =
  await import(L("functions/lib/equipmentCompatibility/equipmentModelRepository.js"));
const { isCanonicalEquipmentModelId } =
  await import(L("functions/lib/equipmentCompatibility/domain/equipmentModel.js"));

const MARKER_FIELD = "certificationWorld";

/** Minimal Firestore-shaped store. Deep-clones on read so a caller cannot mutate stored state. */
function makeDb(seed) {
  const store = new Map();
  for (const [collection, docs] of Object.entries(seed)) {
    store.set(collection, new Map(Object.entries(docs).map(([id, data]) => [id, { ...data }])));
  }
  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => (data ? { ...data } : undefined) });
  const db = {
    __store: store,
    collection(name) {
      return {
        doc: (id) => ({
          __collection: name, __id: id,
          get: async () => snap(id, col(name).get(id)),
        }),
        get: async () => {
          const docs = [...col(name).entries()].map(([id, data]) => snap(id, data));
          return { docs, size: docs.length, empty: docs.length === 0 };
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data, options) { ops.push({ kind: "set", ref, data, merge: options?.merge === true }); },
        // update() must FAIL on a missing document, exactly as Firestore does -- otherwise a
        // migration bug that repointed a nonexistent record would look like a success here.
        update(ref, data) { ops.push({ kind: "update", ref, data }); },
        delete(ref) { ops.push({ kind: "delete", ref }); },
        commit: async () => {
          for (const op of ops) {
            const c = col(op.ref.__collection);
            const existing = c.get(op.ref.__id);
            if (op.kind === "delete") { c.delete(op.ref.__id); continue; }
            if (op.kind === "update") {
              if (existing === undefined) throw new Error(`update on missing document ${op.ref.__collection}/${op.ref.__id}`);
              c.set(op.ref.__id, { ...existing, ...op.data });
              continue;
            }
            c.set(op.ref.__id, op.merge && existing ? { ...existing, ...op.data } : { ...op.data });
          }
        },
      };
    },
  };
  return db;
}

// firebase-admin's FieldValue.serverTimestamp() is a sentinel the double stores verbatim; the
// migration never reads it back, and modelFromFirestore is only asked about documents whose
// timestamps the test supplies. Patch it for the duration of a run.
const { FieldValue, Timestamp } = await import("firebase-admin/firestore");
const REAL_SERVER_TIMESTAMP = FieldValue.serverTimestamp;
const STAMP = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
FieldValue.serverTimestamp = () => STAMP;
process.on("exit", () => { FieldValue.serverTimestamp = REAL_SERVER_TIMESTAMP; });

const { canonical, byLegacyId, world } = buildMapping();
const legacyIdFor = (canonicalId) => [...byLegacyId.entries()].find(([, v]) => v === canonicalId)?.[0];

/**
 * The sandbox as it actually stands: legacy model ids, the legacy record shape, and equipment
 * pointing at them. Reconstructed from the fixture rather than hand-typed, so it stays a model of
 * the real thing rather than a convenient one.
 */
function seedLegacyWorld({ equipmentCount = world.equipment.length } = {}) {
  const models = {};
  for (const [canonicalId, record] of canonical) {
    models[legacyIdFor(canonicalId)] = {
      modelNumber: record.data.modelNumber,
      manufacturer: record.data.manufacturerName,
      family: record.data.family,
      configuration: record.data.subtype,
      lineOfBusiness: record.data.lineOfBusiness,
      status: "ACTIVE",
      publicSource: record.data.sourceAuthority,
      createdAt: STAMP, updatedAt: STAMP,
    };
  }
  const equipment = {};
  for (const e of world.equipment.slice(0, equipmentCount)) {
    equipment[e.id] = {
      ...e.data,
      equipmentModelId: legacyIdFor(e.data.equipmentModelId),
      // THE MARKER, because the live records carry it and the migration is scoped by it. Seeding
      // without it would test a world that does not exist and would quietly exercise the
      // out-of-scope path for all 278 records.
      [MARKER_FIELD]: { version: "1.6.0", datasetId: "equipment" },
      createdAt: STAMP, updatedAt: STAMP,
    };
  }
  return { equipment_models: models, equipment };
}

/**
 * Equipment that predates the certification world AND the equipment-model link.
 *
 * The live sandbox holds eight of these -- five hand-made C713 rows, a walk-in cooler, two ice
 * machines -- with no marker and no model reference at all. They are not this migration's business,
 * and for months the migration would have refused to run at all because of them.
 */
const PRE_EXISTING = {
  "eq-cool-001": { name: "Walk-in Cooler", accountId: "acct-legacy", locationId: "loc-legacy" },
  "eq-ice-001": { name: "Ice Machine - Bar", accountId: "acct-legacy", locationId: "loc-legacy" },
};

const silent = () => {};

// ── THE DEFECT IS REAL ────────────────────────────────────────────────────────────────────────

test("the seeded state is genuinely broken -- the registry refuses every legacy model", () => {
  // If this passed, the whole migration would be solving nothing and every test below would be
  // theatre.
  const db = makeDb(seedLegacyWorld());
  const models = db.__store.get("equipment_models");
  assert.equal(models.size, 48);
  for (const [id, data] of models) {
    assert.equal(isCanonicalEquipmentModelId(id), false, `${id} should not be canonical yet`);
    assert.throws(() => modelFromFirestore(id, data), /malformed|failed|not a canonical|mismatched/i);
  }
});

// ── DRY RUN ───────────────────────────────────────────────────────────────────────────────────

test("a dry run writes NOTHING and reports the full plan", () => {
  const db = makeDb(seedLegacyWorld());
  const before = JSON.stringify([...db.__store.get("equipment").entries()]);
  return runMigration({ db, apply: false, log: silent }).then((report) => {
    assert.equal(report.outcome, "DRY_RUN");
    assert.equal(report.toCreate.length, 48);
    assert.equal(report.plan.length, world.equipment.length);
    assert.equal(report.toDelete.length, 48);
    assert.equal(report.created, 0);
    assert.equal(report.repointed, 0);
    assert.equal(report.deleted, 0);
    assert.equal(db.__store.get("equipment_models").size, 48, "no model was created");
    assert.equal(JSON.stringify([...db.__store.get("equipment").entries()]), before, "equipment was modified by a DRY RUN");
  });
});

// ── APPLY ─────────────────────────────────────────────────────────────────────────────────────

test("APPLY: every equipment record ends up on a canonical model that the registry accepts", async () => {
  const db = makeDb(seedLegacyWorld());
  const report = await runMigration({ db, apply: true, log: silent });

  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.created, 48);
  assert.equal(report.repointed, world.equipment.length);
  assert.equal(report.resolved, world.equipment.length);
  assert.equal(report.deleted, 48);
  assert.deepEqual(report.heldBack, []);

  const models = db.__store.get("equipment_models");
  assert.equal(models.size, 48, "48 canonical in, 48 legacy out");
  for (const [id, data] of models) {
    assert.equal(isCanonicalEquipmentModelId(id), true, `${id} is not canonical`);
    modelFromFirestore(id, data);   // throws if the registry would refuse it
  }

  const equipment = db.__store.get("equipment");
  for (const [id, data] of equipment) {
    assert.ok(models.has(data.equipmentModelId), `${id} points at a model that does not exist`);
  }
});

test("APPLY preserves everything that is not the model reference", async () => {
  // The claim the Owner asked for, checked field by field rather than asserted. Equipment identity,
  // serials, customer, location, service history and dates must come through untouched.
  const seed = seedLegacyWorld();
  const before = new Map(Object.entries(seed.equipment).map(([id, d]) => [id, { ...d }]));
  const db = makeDb(seed);
  await runMigration({ db, apply: true, log: silent });

  const after = db.__store.get("equipment");
  assert.equal(after.size, before.size, "the equipment count changed");
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "an equipment id changed");

  const MUTABLE = new Set(["equipmentModelId", "updatedAt", "updatedBy"]);
  for (const [id, was] of before) {
    const now = after.get(id);
    for (const key of Object.keys(was)) {
      if (MUTABLE.has(key)) continue;
      assert.deepEqual(now[key], was[key], `${id}.${key} was modified`);
    }
    assert.equal(now.serialNumber, was.serialNumber);
    assert.equal(now.accountId, was.accountId);
    assert.equal(now.locationId, was.locationId);
    assert.notEqual(now.equipmentModelId, was.equipmentModelId, `${id} was not actually migrated`);
  }
});

test("the line-of-business split survives the migration", async () => {
  // The reporting property the whole Taylor/Ventana separation is measured on. A migration that
  // repointed a Taylor unit at an Icetro model would keep every count and still be wrong.
  const db = makeDb(seedLegacyWorld());
  await runMigration({ db, apply: true, log: silent });
  const models = db.__store.get("equipment_models");
  const tally = { TAYLOR: 0, VENTANA: 0 };
  for (const [, data] of db.__store.get("equipment")) {
    const model = models.get(data.equipmentModelId);
    assert.equal(model.lineOfBusiness, data.lineOfBusiness,
      "an equipment record now points at a model from the other line of business");
    tally[data.lineOfBusiness] += 1;
  }
  const expected = { TAYLOR: 0, VENTANA: 0 };
  for (const e of world.equipment) expected[e.data.lineOfBusiness] += 1;
  assert.deepEqual(tally, expected);
});

// ── IDEMPOTENCY ───────────────────────────────────────────────────────────────────────────────

test("a SECOND run is a true no-op: 0 created, 0 repointed, 0 deleted", async () => {
  const db = makeDb(seedLegacyWorld());
  await runMigration({ db, apply: true, log: silent });
  const afterFirst = JSON.stringify([...db.__store.get("equipment").entries()]);

  const second = await runMigration({ db, apply: true, log: silent });
  assert.equal(second.outcome, "APPLIED");
  assert.equal(second.created, 0);
  assert.equal(second.repointed, 0);
  assert.equal(second.deleted, 0);
  assert.equal(second.resolved, world.equipment.length);
  assert.equal(JSON.stringify([...db.__store.get("equipment").entries()]), afterFirst,
    "the second run churned records -- updatedAt must not move for a no-op");
});

test("a dry run AFTER the migration reports nothing left to do", async () => {
  const db = makeDb(seedLegacyWorld());
  await runMigration({ db, apply: true, log: silent });
  const report = await runMigration({ db, apply: false, log: silent });
  assert.equal(report.outcome, "DRY_RUN");
  assert.equal(report.plan.length, 0);
  assert.equal(report.toCreate.length, 0);
  assert.equal(report.toDelete.length, 0);
  assert.equal(report.alreadyCanonical, world.equipment.length);
});

// ── THE REFUSALS ──────────────────────────────────────────────────────────────────────────────

test("APPLY 0: one unmappable equipment record blocks the ENTIRE run", async () => {
  // The property that matters most. A migration that skipped what it could not understand would
  // leave the fleet on two identity schemes -- and would report success.
  const seed = seedLegacyWorld();
  const victim = Object.keys(seed.equipment)[7];
  seed.equipment[victim] = { ...seed.equipment[victim], equipmentModelId: "cw-model-taylor-notamodel" };
  const db = makeDb(seed);

  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "BLOCKED");
  assert.equal(report.created, 0);
  assert.equal(report.repointed, 0);
  assert.equal(report.unresolved.length, 1);
  assert.equal(report.unresolved[0].id, victim);
  assert.equal(db.__store.get("equipment_models").size, 48, "a blocked run created models anyway");
  for (const [, data] of db.__store.get("equipment")) {
    assert.equal(isCanonicalEquipmentModelId(data.equipmentModelId), false, "a blocked run repointed something");
  }
});

test("APPLY 0: a CERTIFICATION record with NO model reference blocks the run", async () => {
  // Such a record is invisible to any where() query on the field, which is exactly how a record
  // escapes a migration and stays broken. The migration reads by document for this reason.
  const seed = seedLegacyWorld();
  const victim = Object.keys(seed.equipment)[3];
  delete seed.equipment[victim].equipmentModelId;
  const db = makeDb(seed);

  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "BLOCKED");
  assert.equal(report.unresolved[0].id, victim);
  assert.match(report.unresolved[0].why, /certification record with no equipmentModelId/);
});

// ── SCOPE ─────────────────────────────────────────────────────────────────────────────────────

test("pre-existing equipment with no marker and no model reference is OUT OF SCOPE, not a blocker", async () => {
  // The live case, and the distinction the migration turns on. These records have no back-reference
  // to fix, so they cannot be left half-migrated -- and giving them one would mint a model link
  // nobody established. Blocking on them would mean this migration could never run at all.
  const seed = seedLegacyWorld();
  Object.assign(seed.equipment, PRE_EXISTING);
  const db = makeDb(seed);

  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "APPLIED");
  assert.deepEqual(report.outOfScope.map((o) => o.id).sort(), Object.keys(PRE_EXISTING).sort());
  assert.equal(report.repointed, world.equipment.length, "the certification fleet still migrated in full");

  // Untouched, field for field.
  for (const [id, was] of Object.entries(PRE_EXISTING)) {
    const now = db.__store.get("equipment").get(id);
    assert.deepEqual(now, was, `${id} was modified by a migration that does not own it`);
  }
});

test("an UNMARKED record pointing at a certification model still BLOCKS", async () => {
  // Out-of-scope is decided by having no model reference at all, not by lacking the marker. A record
  // claiming this world's model identity without this world's marker is a genuine ambiguity, and
  // adopting it silently would be the migration deciding something nobody asked it to decide.
  const seed = seedLegacyWorld();
  seed.equipment["eq-impostor"] = {
    name: "Unmarked but pointing at a cert model",
    equipmentModelId: legacyIdFor([...canonical.keys()][0]),
  };
  const db = makeDb(seed);

  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "BLOCKED");
  assert.equal(report.unresolved.length, 1);
  assert.equal(report.unresolved[0].id, "eq-impostor");
  assert.match(report.unresolved[0].why, /not the certification marker/);
  assert.equal(report.repointed, 0);
});

test("APPLY 0: an unmapped legacy model document blocks the run", async () => {
  // A model document this world does not know about. Deleting it would destroy something the
  // migration cannot account for, so it refuses rather than deciding on its own.
  const seed = seedLegacyWorld();
  seed.equipment_models["cw-model-someoneelse-x1"] = { modelNumber: "X1", manufacturer: "Other" };
  const db = makeDb(seed);

  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "BLOCKED");
  assert.deepEqual(report.unmappedLegacy, ["cw-model-someoneelse-x1"]);
});

test("a legacy model that is NOT referenced by any equipment is still migrated and removed", async () => {
  // The fixture declares 48 models and the installed base does not use all of them. An unreferenced
  // model is still a registry record in the wrong shape.
  const seed = seedLegacyWorld({ equipmentCount: 10 });
  const db = makeDb(seed);
  const report = await runMigration({ db, apply: true, log: silent });
  assert.equal(report.outcome, "APPLIED");
  assert.equal(report.repointed, 10);
  assert.equal(report.deleted, 48, "unreferenced legacy models must not be left behind");
  assert.equal(db.__store.get("equipment_models").size, 48);
});

test("the mapping is injective -- no two legacy ids collapse onto one canonical model", () => {
  // A collision would silently merge two distinct models and no later check would notice, because
  // every equipment record would still resolve.
  const targets = [...byLegacyId.values()];
  assert.equal(new Set(targets).size, targets.length);
  assert.equal(byLegacyId.size, canonical.size);
});

test("the mapping is derived from the FIXTURE, not from whatever is live", () => {
  // Inferring the rule from live ids would be circular: the live ids are the defect. Every target is
  // canonical, and every source matches the legacy scheme exactly.
  for (const [legacyId, canonicalId] of byLegacyId) {
    assert.match(legacyId, /^cw-model-[a-z0-9-]+$/);
    assert.equal(isCanonicalEquipmentModelId(canonicalId), true);
  }
});
