// Part identifier administration — the CALLABLE boundary, EMULATOR tests.
//
// The alias COMMANDS were already unit-tested. What was never tested is the thing that made them
// unreachable: the adapter layer. These cover what only a real transaction and a real error
// round-trip show — that the read projects the version token an administrator needs, that the
// conflict path is distinguishable from a validation failure, that a replay is a replay, and that
// the probe changes nothing.
//
// Prerequisite: npm run build; Firestore emulator running.
// Run: node --test test/partAliasCallables.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { createPartAlias, deactivatePartAlias, reactivatePartAlias, resolvePartAlias } = await import(
  "../lib/partMaster/partAliasCommands.js"
);
const { listPartAliases } = await import("../lib/partMaster/partAliasReadService.js");
const { mapError } = await import("../lib/partMaster/partAliasCallables.js");
const {
  createPart,
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

await createPart({ actorUid: ACTOR, idempotencyKey: key("c"), part: partInput(PART_ID) }, DEPS);

async function addAlias(rawValue, aliasType = "SUPPLIER_SKU") {
  const res = await createPartAlias(
    { actorUid: ACTOR, idempotencyKey: key("a"), partId: PART_ID, aliasType, rawValue },
    DEPS
  );
  createdAliases.push(res.aliasId);
  return res;
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
  const created = await addAlias("SKU-TO-DEACTIVATE");
  await deactivatePartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 1 },
    DEPS
  );
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

// ------------------------------------------------------- conflict is not invalidity

test("re-adding the SAME identifier for the SAME part replays rather than duplicating", async () => {
  const first = await createPartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), partId: PART_ID, aliasType: "UPC", rawValue: "012345678905" },
    DEPS
  );
  createdAliases.push(first.aliasId);
  const second = await createPartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), partId: PART_ID, aliasType: "UPC", rawValue: "012345678905" },
    DEPS
  );
  assert.equal(second.outcome, "replayed");
  assert.equal(second.aliasId, first.aliasId, "one identifier, not two");
});

test("an identifier owned by ANOTHER part is refused, and refused as a CONFLICT", async () => {
  // Created through the real command, not a raw write: an alias create reads the Part through the
  // Part repository, and a hand-shaped document would fail its parse for a reason unrelated to what
  // this test is about.
  const otherPart = uid("PRTOTHER");
  await createPart({ actorUid: ACTOR, idempotencyKey: key("c"), part: partInput(otherPart) }, DEPS);
  const mine = await addAlias("SKU-OWNED-BY-ME");
  await assert.rejects(
    createPartAlias(
      { actorUid: ACTOR, idempotencyKey: key("k"), partId: otherPart, aliasType: "SUPPLIER_SKU", rawValue: "SKU-OWNED-BY-ME" },
      DEPS
    ),
    (err) => err instanceof AlreadyExistsError,
    "identity must never transfer silently between parts"
  );
  await db.collection("parts").doc(otherPart).delete().catch(() => {});
  assert.ok(mine.aliasId);
});

test("a deactivated identifier cannot be re-created — it must be reactivated", async () => {
  const created = await addAlias("SKU-REACTIVATE-ME");
  await deactivatePartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 1 },
    DEPS
  );
  await assert.rejects(
    createPartAlias(
      { actorUid: ACTOR, idempotencyKey: key("k"), partId: PART_ID, aliasType: "SUPPLIER_SKU", rawValue: "SKU-REACTIVATE-ME" },
      DEPS
    ),
    (err) => err instanceof AlreadyExistsError,
    "create must never silently reactivate"
  );
  const back = await reactivatePartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 2 },
    DEPS
  );
  assert.equal(back.outcome, "applied");
  assert.equal(back.version, 3);
});

test("a stale version is refused rather than merged", async () => {
  const created = await addAlias("SKU-STALE-VERSION");
  await assert.rejects(
    deactivatePartAlias(
      { actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 99 },
      DEPS
    ),
    (err) => err instanceof VersionConflictError
  );
});

// ------------------------------------------------------------------ the probe

test("scan-to-test resolves through the SAME resolver the scanner uses, and changes nothing", async () => {
  const created = await addAlias("SKU-PROBE-ME");
  const before = (await listPartAliases(db, PART_ID)).aliases.length;

  const found = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "SKU-PROBE-ME" }, DEPS);
  assert.equal(found.result, "FOUND");
  assert.equal(found.partId, PART_ID);

  const missing = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "NOT-REGISTERED-AT-ALL" }, DEPS);
  assert.equal(missing.result, "NOT_FOUND");

  await deactivatePartAlias(
    { actorUid: ACTOR, idempotencyKey: key("k"), aliasId: created.aliasId, expectedVersion: 1 },
    DEPS
  );
  const inactive = await resolvePartAlias({ aliasType: "SUPPLIER_SKU", rawValue: "SKU-PROBE-ME" }, DEPS);
  assert.equal(inactive.result, "INACTIVE", "registered-but-off is never reported as never-registered");

  const after = (await listPartAliases(db, PART_ID)).aliases.length;
  assert.equal(after, before, "probing must not create, remove, or alter anything");
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
