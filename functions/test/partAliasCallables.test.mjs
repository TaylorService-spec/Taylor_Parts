// Part identifier administration — the CALLABLE boundary, EMULATOR tests.
//
// The alias COMMANDS were already unit-tested. What was never tested is the thing that made them
// unreachable: the adapter layer. These cover what only a real transaction and a real error
// round-trip show — that the read projects the version token an administrator needs, that the
// conflict path is distinguishable from a validation failure, that a replay is a replay, and that
// the probe changes nothing.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). createPart, createPartAlias,
// deactivatePartAlias and reactivatePartAlias are legacy Firestore catalog writers and are FROZEN: each refuses first
// with FirestoreCatalogWriterClosedError (FIRESTORE_CATALOG_WRITER_FROZEN). So:
//   B. the READ and RESOLUTION proofs (the list projection, its ordering and scoping, the scan-to-test probe) run
//      unchanged over alias and Part documents seeded DIRECTLY in exactly the stored shape the frozen writers wrote
//      -- the real aliasToFirestore / partToFirestore serializers and the real deriveAliasDocId key authority;
//   A. the superseded WRITER contract (replay, cross-part conflict, re-create-vs-reactivate, stale version) now
//      asserts the governed refusal AND that nothing was written: the alias document is absent or byte-for-byte
//      unchanged, and no audit / idempotency record exists for it.
// Nothing here reopens a writer or replaces the guard.
// Prerequisite: npm run build; Firestore emulator running.
// Run: node --test test/partAliasCallables.test.mjs

import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();

const { createPartAlias, deactivatePartAlias, reactivatePartAlias, resolvePartAlias } = await import(
  "../lib/partMaster/partAliasCommands.js"
);
const { aliasToFirestore, deriveAliasDocId } = await import("../lib/partMaster/partAliasRepository.js");
const { partToFirestore } = await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");
const { listPartAliases } = await import("../lib/partMaster/partAliasReadService.js");
const { mapError } = await import("../lib/partMaster/partAliasCallables.js");
const {
  InvalidInputError,
  AlreadyExistsError,
  VersionConflictError,
  NotFoundError,
  UnauthorizedActorError,
} = await import("../lib/partMaster/partMasterCommands.js");

// Capabilities come through the deps.roles seam plus real emulator roleAssignments -- the harness
// partAliasCommands.test.mjs established. That means the capability gate is genuinely exercised
// rather than stubbed away, and an ungranted actor is a real denial.
const TEST_ROLES = Object.freeze({
  noGrant: { id: "noGrant", name: "x", description: "x", permissions: [] },
  pmFull: { id: "pmFull", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] },
});

const RUN = Date.now();
let seq = 0;
const uid = (p) => `${p}-${RUN}-${(seq += 1)}`;
const key = (p) => `${p}-key-${RUN}-${(seq += 1)}`;

async function seedActor(roleId) {
  const actorUid = uid("actor");
  await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({
    id, principalUid: actorUid, roleId, scope: { type: "global" },
    grantedBy: "test-fixture", grantedAt: admin.firestore.Timestamp.now(),
    status: "active", accessVersionAtGrant: 1,
  });
  return actorUid;
}

const DEPS = { roles: TEST_ROLES, now: () => new Date(1_750_000_000_000) };
const ACTOR = await seedActor("pmFull");
const UNGRANTED = await seedActor("noGrant");

// Every value is RUN-suffixed. Alias document ids are deterministic on (type, value), so fixed test
// values collide across repeated runs against one long-lived emulator -- and a collision here would
// look like a conflict-detection bug rather than the fixture problem it is.
const PART_ID = uid("PRTALIAS");
const createdAliases = [];

const partInput = (partId) => ({
  partId, internalPartNumber: partId, name: "alias test part",
  status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
});

after(async () => {
  for (const id of createdAliases) await db.collection("part_aliases").doc(id).delete().catch(() => {});
  for (const actor of [ACTOR, UNGRANTED]) {
    const audits = await db.collection("auditEvents").where("actorUid", "==", actor).get();
    await Promise.all(audits.docs.map((d) => d.ref.delete()));
    await db.collection("users").doc(actor).delete().catch(() => {});
    const assigns = await db.collection("roleAssignments").where("principalUid", "==", actor).get();
    await Promise.all(assigns.docs.map((d) => d.ref.delete()));
  }
});

// ---- stored-shape fixtures (ruling B): exactly what the frozen writers staged, through their own serializers ----
const AT = DEPS.now();
async function seedPart(partId) {
  const v = validatePart(partInput(partId));
  assert.equal(v.valid, true);
  await db.collection("parts").doc(partId).set(partToFirestore({ part: v.value, version: 1, createdAt: AT, createdBy: ACTOR, updatedAt: AT, updatedBy: ACTOR }));
}
await seedPart(PART_ID);

// createPartAlias wrote an ACTIVE v1 alias keyed by deriveAliasDocId; deactivatePartAlias then wrote INACTIVE at v+1
// with deactivatedAt/deactivatedBy. `status: "INACTIVE"` seeds that post-deactivation shape (version 2).
async function addAlias(rawValue, aliasType = "SUPPLIER_SKU", { status = "ACTIVE", partId = PART_ID } = {}) {
  const derived = deriveAliasDocId(aliasType, rawValue);
  assert.ok(derived, `fixture value must be a valid ${aliasType}`);
  const inactive = status === "INACTIVE";
  await db.collection("part_aliases").doc(derived.docId).set(aliasToFirestore({
    aliasId: derived.docId, partId, aliasType, originalValue: rawValue, normalizedValue: derived.normalizedValue,
    status, source: "manual", ...(inactive ? { deactivatedAt: AT, deactivatedBy: ACTOR } : {}),
    version: inactive ? 2 : 1, createdAt: AT, createdBy: ACTOR, updatedAt: AT, updatedBy: ACTOR,
  }));
  createdAliases.push(derived.docId);
  return { aliasId: derived.docId, version: inactive ? 2 : 1 };
}

// ---- freeze helpers (ruling A) ----
const frozen = (writer) => (err) => {
  assert.ok(err instanceof FirestoreCatalogWriterClosedError, `expected the governed freeze refusal, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.equal(err.writer, writer);
  return true;
};
const aliasDoc = async (aliasId) => (await db.collection("part_aliases").doc(aliasId).get());
const auditsFor = async (targetId) => (await db.collection("auditEvents").where("targetId", "==", targetId).get()).size;
async function assertAliasUnchanged(aliasId, before) {
  assert.deepEqual((await aliasDoc(aliasId)).data(), before, "the alias record must be byte-for-byte unchanged");
  assert.equal(await auditsFor(aliasId), 0, "no audit / idempotency record for the alias");
}

// ------------------------------------------------------------------ the read

test("the list projects the VERSION TOKEN deactivate requires", async () => {
  // Without it the client cannot call deactivate or reactivate at all -- the same omission that
  // made the governed Opportunity edit unreachable from every read surface in the product.
  await addAlias("SKU-VERSION-1");
  const { aliases } = await listPartAliases(db, PART_ID);
  const row = aliases.find((a) => a.value === "SKU-VERSION-1");
  assert.ok(row, "the alias just created must be in the list");
  assert.equal(typeof row.version, "number");
  assert.equal(row.version, 1);
});

test("the list returns what a person typed, not the normalized form", async () => {
  // Normalization is an internal matching detail. Publishing it would show the algorithm's output
  // as if it were the user's data.
  await addAlias("sku lower CASE");
  const { aliases } = await listPartAliases(db, PART_ID);
  const row = aliases.find((a) => a.value === "sku lower CASE");
  assert.ok(row, "the ORIGINAL value must be projected verbatim");
  assert.equal(row.normalizedValue, undefined, "the normalized form must not leak to the client");
});

test("the list includes INACTIVE identifiers", async () => {
  // Load-bearing: re-adding a deactivated identifier is refused as a conflict, and an
  // administrator who cannot see the inactive record cannot understand the refusal.
  // Ruling B: the stored shape deactivatePartAlias left behind (INACTIVE, version 2), read through the real list.
  const created = await addAlias("SKU-TO-DEACTIVATE", "SUPPLIER_SKU", { status: "INACTIVE" });
  const { aliases } = await listPartAliases(db, PART_ID);
  const row = aliases.find((a) => a.aliasId === created.aliasId);
  assert.ok(row, "a deactivated identifier must still be listed");
  assert.equal(row.status, "INACTIVE");
  assert.equal(row.version, 2, "and its NEW version must be projected, or reactivation cannot be called");
});

test("ACTIVE identifiers sort before INACTIVE ones", async () => {
  const { aliases } = await listPartAliases(db, PART_ID);
  const firstInactive = aliases.findIndex((a) => a.status === "INACTIVE");
  const lastActive = aliases.map((a) => a.status).lastIndexOf("ACTIVE");
  if (firstInactive !== -1 && lastActive !== -1) assert.ok(lastActive < firstInactive);
});

test("the list is scoped to ONE part", async () => {
  const { aliases, partId } = await listPartAliases(db, PART_ID);
  assert.equal(partId, PART_ID);
  for (const a of aliases) assert.ok(a.aliasId, "every row must carry its own identity");
});

// ------------------------------------------------------- the alias WRITERS are frozen (ruling A)

test("re-adding the SAME identifier: FROZEN on every attempt, no alias and no idempotency record", async () => {
  const derived = deriveAliasDocId("UPC", "012345678905");
  const k = key("k");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      createPartAlias({ actorUid: ACTOR, idempotencyKey: k, partId: PART_ID, aliasType: "UPC", rawValue: "012345678905" }, DEPS),
      frozen("partAlias.create")
    );
  }
  assert.equal((await aliasDoc(derived.docId)).exists, false, "no alias may be created");
  assert.equal(await auditsFor(derived.docId), 0, "no audit / idempotency record");
});

test("an identifier owned by ANOTHER part: FROZEN, and ownership never transfers", async () => {
  const otherPart = uid("PRTOTHER");
  await seedPart(otherPart);
  const mine = await addAlias("SKU-OWNED-BY-ME");
  const before = (await aliasDoc(mine.aliasId)).data();
  await assert.rejects(
    createPartAlias(
      { actorUid: ACTOR, idempotencyKey: key("k"), partId: otherPart, aliasType: "SUPPLIER_SKU", rawValue: "SKU-OWNED-BY-ME" },
      DEPS
    ),
    frozen("partAlias.create")
  );
  await assertAliasUnchanged(mine.aliasId, before);
  // Ruling B: the identity still resolves to its owner through the real resolver.
  const found = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "SKU-OWNED-BY-ME" }, DEPS);
  assert.equal(found.result, "FOUND");
  assert.equal(found.partId, PART_ID, "identity must never transfer silently between parts");
  await db.collection("parts").doc(otherPart).delete().catch(() => {});
});

test("a deactivated identifier: re-create and reactivate are both FROZEN; the record stays INACTIVE", async () => {
  const created = await addAlias("SKU-REACTIVATE-ME", "SUPPLIER_SKU", { status: "INACTIVE" });
  const before = (await aliasDoc(created.aliasId)).data();
  await assert.rejects(
    createPartAlias(
      { actorUid: ACTOR, idempotencyKey: key("k"), partId: PART_ID, aliasType: "SUPPLIER_SKU", rawValue: "SKU-REACTIVATE-ME" },
      DEPS
    ),
    frozen("partAlias.create")
  );
  await assert.rejects(
    reactivatePartAlias({ actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 2 }, DEPS),
    frozen("partAlias.reactivate")
  );
  await assertAliasUnchanged(created.aliasId, before);
  assert.equal(before.status, "INACTIVE");
});

test("deactivate (current or stale version): FROZEN, the record is unchanged", async () => {
  const created = await addAlias("SKU-STALE-VERSION");
  const before = (await aliasDoc(created.aliasId)).data();
  for (const expectedVersion of [99, 1]) {
    await assert.rejects(
      deactivatePartAlias({ actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion }, DEPS),
      frozen("partAlias.deactivate")
    );
  }
  await assertAliasUnchanged(created.aliasId, before);
});

// ------------------------------------------------------------------ the probe

test("scan-to-test resolves through the SAME resolver the scanner uses, and changes nothing", async () => {
  // Ruling B: the probe is a READ through the scanner's resolver, exercised over stored-shape fixtures.
  await addAlias("SKU-PROBE-ME");
  await addAlias("SKU-PROBE-OFF", "SUPPLIER_SKU", { status: "INACTIVE" });
  const before = (await listPartAliases(db, PART_ID)).aliases;

  const found = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "SKU-PROBE-ME" }, DEPS);
  assert.equal(found.result, "FOUND");
  assert.equal(found.partId, PART_ID);

  const missing = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "NOT-REGISTERED-AT-ALL" }, DEPS);
  assert.equal(missing.result, "NOT_FOUND");

  const inactive = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "SKU-PROBE-OFF" }, DEPS);
  assert.equal(inactive.result, "INACTIVE", "registered-but-off is never reported as never-registered");
  assert.equal(inactive.partId, PART_ID);

  const after = (await listPartAliases(db, PART_ID)).aliases;
  assert.deepEqual(after, before, "probing must not create, remove, or alter anything");
});

test("a malformed probe value reports MALFORMED, not NOT_FOUND", async () => {
  const bad = await resolvePartAlias({ aliasType: "UPC", rawValue: "not-digits" }, DEPS);
  assert.equal(bad.result, "MALFORMED");
});

// -------------------------------------------------- the adapter's error taxonomy

test("each service error maps to its own HttpsError code AND carries a domain detail", () => {
  // There are more distinct outcomes than HttpsError codes, and three of them need different words
  // in the UI. Without the detail all three arrive as one generic message.
  const cases = [
    [new InvalidInputError("x"), "invalid-argument", "INVALID"],
    [new UnauthorizedActorError("x"), "permission-denied", "DENIED"],
    [new NotFoundError("x"), "not-found", "NOT_FOUND"],
    [new AlreadyExistsError("x"), "already-exists", "ALIAS_CONFLICT"],
    [new VersionConflictError("x"), "aborted", "VERSION_CONFLICT"],
  ];
  for (const [err, code, detail] of cases) {
    const mapped = mapError(err);
    assert.equal(mapped.code, code, `${err.constructor.name} -> ${code}`);
    assert.equal(mapped.details, detail);
  }
});

test("error messages never carry the internal message through", () => {
  // partMasterCallables.ts's taxonomy: generic per TYPE, so no id, version, or existence fact
  // leaks past the boundary.
  const mapped = mapError(new NotFoundError("alias UPC%2F0123 not found for part PRT-SECRET"));
  assert.doesNotMatch(mapped.message, /PRT-SECRET/);
  assert.doesNotMatch(mapped.message, /UPC/);
});

test("an unrecognized error is internal, never accidentally permissive", () => {
  const mapped = mapError(new Error("something else entirely"));
  assert.equal(mapped.code, "internal");
  assert.doesNotMatch(mapped.message, /something else/);
});
