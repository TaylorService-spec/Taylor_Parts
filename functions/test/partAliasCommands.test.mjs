// INV-1 Phase 1 PR 1.3 -- trusted alias repository/command/lookup tests.
// Conventions of partMasterCommands.test.mjs: Firestore emulator required,
// capabilities via the deps.roles seam + emulator roleAssignments. No
// production access. Prerequisite: npm run build; emulator running.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { createPart, updatePart, InvalidInputError, UnauthorizedActorError, NotFoundError, AlreadyExistsError, VersionConflictError, IdempotencyConflictError } =
  await import("../lib/partMaster/partMasterCommands.js");
const { createPartAlias, deactivatePartAlias, reactivatePartAlias, resolvePartAlias } =
  await import("../lib/partMaster/partAliasCommands.js");
const { aliasFromFirestore, aliasToFirestore, deriveAliasDocId, MalformedStoredRecordError } =
  await import("../lib/partMaster/partAliasRepository.js").then(async (m) => ({ ...m, MalformedStoredRecordError: (await import("../lib/partMaster/partMasterRepository.js")).MalformedStoredRecordError }));

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const TEST_ROLES = Object.freeze({
  noGrant: { id: "noGrant", name: "x", description: "x", permissions: [] },
  pmFull: { id: "pmFull", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] },
});
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
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const partInput = (partId) => ({ partId, internalPartNumber: partId, name: "P", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });
const granted = await seedActor("pmFull");
const ungranted = await seedActor("noGrant");
async function newPart() {
  const pid = uid("P");
  await createPart({ actorUid: granted, idempotencyKey: key("c"), part: partInput(pid) }, DEPS);
  return pid;
}

console.log("partAliasCommands.test.mjs");

// Deterministic alias IDs + fixed test values collide across repeated runs
// against one live emulator instance -- clear the collection first (test
// emulator only; the CI runner always starts a fresh emulator anyway).
for (const doc of (await db.collection("part_aliases").get()).docs) await doc.ref.delete();
for (const doc of (await db.collection("auditEvents").where("targetType", "==", "part_alias").get()).docs) await doc.ref.delete();

// A. Serialization / identity
await check("A: deterministic id, storage-safe encoding, type+scope in uniqueness", () => {
  const upc = deriveAliasDocId("UPC", "0 3600-029145 2");
  assert.equal(upc.docId, "UPC__036000291452");
  const slash = deriveAliasDocId("SUPPLIER_SKU", "A/B 1");
  assert.equal(slash.docId, "SUPPLIER_SKU__A%2FB 1"); // "/" percent-encoded for doc-id safety
  assert.notEqual(deriveAliasDocId("EAN", "0012345678905").docId, deriveAliasDocId("GTIN", "0012345678905").docId);
  const m1 = deriveAliasDocId("MANUFACTURER_PN", "MPN-9", "MFR-1");
  const m2 = deriveAliasDocId("MANUFACTURER_PN", "MPN-9", "MFR-2");
  assert.notEqual(m1.docId, m2.docId);
  assert.equal(deriveAliasDocId("UPC", "123"), null); // invalid -> null
});
await check("A: round trip + integrity + malformed rejection", async () => {
  const pid = await newPart();
  const r = await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "LEGACY", rawValue: " old-01 " }, DEPS);
  const snap = await db.collection("part_aliases").doc(r.aliasId).get();
  const stored = aliasFromFirestore(snap.id, snap.data());
  assert.equal(stored.partId, pid);
  assert.equal(stored.originalValue, " old-01 "); // original preserved verbatim
  assert.equal(stored.normalizedValue, "OLD-01");
  assert.throws(() => aliasFromFirestore("WRONG_ID", snap.data()), MalformedStoredRecordError);
  assert.throws(() => aliasFromFirestore(snap.id, { ...snap.data(), normalizedValue: "TAMPERED" }), MalformedStoredRecordError);
  assert.throws(() => aliasFromFirestore(snap.id, { ...snap.data(), aliasType: "NOPE" }), MalformedStoredRecordError);
  const doc = aliasToFirestore(stored);
  for (const k of ["supplierCost", "onHand", "tenantId", "companyId"]) assert.ok(!(k in doc), k);
});
await check("A: MPN scope required; forbidden scope rejected", async () => {
  const pid = await newPart();
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "MANUFACTURER_PN", rawValue: "MPN-1" }, DEPS), InvalidInputError);
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "LEGACY", rawValue: "x1", manufacturerId: "MFR-1" }, DEPS), InvalidInputError);
});

// B. Lookup
await check("B: resolve FOUND / NOT_FOUND / INACTIVE / MALFORMED; scoped MPN independent; no scan", async () => {
  const pid = await newPart();
  const r = await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "UPC", rawValue: "036000291452" }, DEPS);
  const found = await resolvePartAlias({ aliasType: "UPC", rawValue: "0 3600-029145 2" }, DEPS); // normalization at lookup
  assert.equal(found.result, "FOUND");
  assert.equal(found.partId, pid);
  assert.equal((await resolvePartAlias({ aliasType: "EAN", rawValue: "4006381333931" }, DEPS)).result, "NOT_FOUND");
  assert.equal((await resolvePartAlias({ aliasType: "UPC", rawValue: "not-digits" }, DEPS)).result, "MALFORMED");
  await deactivatePartAlias({ actorUid: granted, idempotencyKey: key("d"), aliasId: r.aliasId, expectedVersion: 1 }, DEPS);
  const inactive = await resolvePartAlias({ aliasType: "UPC", rawValue: "036000291452" }, DEPS);
  assert.equal(inactive.result, "INACTIVE");
  assert.equal(inactive.partId, pid);
});
await check("B: leading zeroes preserved end-to-end", async () => {
  const pid = await newPart();
  await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "EAN", rawValue: "0012345678905" }, DEPS);
  const r = await resolvePartAlias({ aliasType: "EAN", rawValue: "0012345678905" }, DEPS);
  assert.equal(r.result, "FOUND");
  assert.equal(r.aliasId, "EAN__0012345678905");
});

// C. Create + conflicts + idempotency
await check("C: unauthorized/ungranted rejected; nonexistent part rejected", async () => {
  const pid = await newPart();
  await assert.rejects(createPartAlias({ actorUid: ungranted, idempotencyKey: key("a"), partId: pid, aliasType: "LEGACY", rawValue: "z1" }, DEPS), UnauthorizedActorError);
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: "P-NONE-1", aliasType: "LEGACY", rawValue: "z2" }, DEPS), NotFoundError);
});
await check("C: exact replay idempotent; conflicting replay rejected; equivalent-active idempotent", async () => {
  const pid = await newPart();
  const k = key("a");
  const r1 = await createPartAlias({ actorUid: granted, idempotencyKey: k, partId: pid, aliasType: "LEGACY", rawValue: "dup-1" }, DEPS);
  const r2 = await createPartAlias({ actorUid: granted, idempotencyKey: k, partId: pid, aliasType: "LEGACY", rawValue: "dup-1" }, DEPS);
  assert.equal(r2.outcome, "replayed");
  assert.equal((await db.collection("auditEvents").where("targetId", "==", r1.aliasId).get()).size, 1);
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: k, partId: pid, aliasType: "LEGACY", rawValue: "dup-OTHER" }, DEPS), IdempotencyConflictError);
  const eq = await createPartAlias({ actorUid: granted, idempotencyKey: key("a2"), partId: pid, aliasType: "LEGACY", rawValue: "dup-1" }, DEPS);
  assert.equal(eq.outcome, "replayed"); // same part, active, equivalent
});
await check("C: alias owned by another part conflicts (active AND inactive); no reassignment", async () => {
  const p1 = await newPart();
  const p2 = await newPart();
  const r = await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: p1, aliasType: "LEGACY", rawValue: "own-1" }, DEPS);
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: p2, aliasType: "LEGACY", rawValue: "own-1" }, DEPS), AlreadyExistsError);
  await deactivatePartAlias({ actorUid: granted, idempotencyKey: key("d"), aliasId: r.aliasId, expectedVersion: 1 }, DEPS);
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: p2, aliasType: "LEGACY", rawValue: "own-1" }, DEPS), AlreadyExistsError);
});
await check("C: transaction failure leaves no partial state; audit atomic", async () => {
  const pid = await newPart();
  const d = deriveAliasDocId("LEGACY", "atomic-1");
  await assert.rejects(createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "LEGACY", rawValue: "atomic-1" }, { ...DEPS, __simulateFailureAfterStage: new Error("boom") }));
  assert.equal((await db.collection("part_aliases").doc(d.docId).get()).exists, false);
  assert.equal((await db.collection("auditEvents").where("targetId", "==", d.docId).get()).size, 0);
});

// D. Deactivate / reactivate
await check("D: status lifecycle, versioning, replay, audit; identity immutable", async () => {
  const pid = await newPart();
  const r = await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: pid, aliasType: "LEGACY", rawValue: "st-1" }, DEPS);
  await assert.rejects(deactivatePartAlias({ actorUid: granted, idempotencyKey: key("d"), aliasId: r.aliasId, expectedVersion: 9 }, DEPS), VersionConflictError);
  const k = key("d");
  const d1 = await deactivatePartAlias({ actorUid: granted, idempotencyKey: k, aliasId: r.aliasId, expectedVersion: 1 }, DEPS);
  assert.equal(d1.version, 2);
  const d2 = await deactivatePartAlias({ actorUid: granted, idempotencyKey: k, aliasId: r.aliasId, expectedVersion: 1 }, DEPS);
  assert.equal(d2.outcome, "replayed");
  assert.equal((await db.collection("part_aliases").doc(r.aliasId).get()).data().version, 2);
  const re = await reactivatePartAlias({ actorUid: granted, idempotencyKey: key("r"), aliasId: r.aliasId, expectedVersion: 2 }, DEPS);
  assert.equal(re.version, 3);
  assert.equal((await db.collection("part_aliases").doc(r.aliasId).get()).data().partId, pid); // ownership never moved
  const audits = await db.collection("auditEvents").where("targetId", "==", r.aliasId).get();
  assert.equal(audits.size, 3); // create + deactivate + reactivate
  for (const a of audits.docs) assert.ok(!a.data().summary.includes("st-1"), "raw value must not leak into audit");
});

// E. internalPartNumber backfill
await check("E: IPN change preserves old value as alias atomically; resolves to same part", async () => {
  const pid = await newPart();
  const r = await updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { internalPartNumber: "NEW-IPN-1" } }, DEPS);
  assert.equal(r.version, 2);
  const old = await resolvePartAlias({ aliasType: "INTERNAL_PN", rawValue: pid }, DEPS);
  assert.equal(old.result, "FOUND");
  assert.equal(old.partId, pid);
  const part = (await db.collection("parts").doc(pid).get()).data();
  assert.equal(part.internalPartNumber, "NEW-IPN-1");
  assert.equal(part.partId, pid); // canonical unchanged
  const audits = await db.collection("auditEvents").where("action", "==", "preserveInternalPartNumberAlias").where("targetId", "==", old.aliasId).get();
  assert.equal(audits.size, 1);
});
await check("E: conflict on old value owned by another part blocks entire update", async () => {
  const p1 = await newPart();
  const p2 = await newPart();
  // claim p2's IPN alias identity for p1:
  await createPartAlias({ actorUid: granted, idempotencyKey: key("a"), partId: p1, aliasType: "INTERNAL_PN", rawValue: p2 }, DEPS);
  await assert.rejects(updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: p2, expectedVersion: 1, changes: { internalPartNumber: "OTHER-9" } }, DEPS), AlreadyExistsError);
  const part = (await db.collection("parts").doc(p2).get()).data();
  assert.equal(part.internalPartNumber, p2); // whole update rejected
  assert.equal(part.version, 1);
});
await check("E: replay of IPN change produces no duplicate alias/audit; repeat change no dup", async () => {
  const pid = await newPart();
  const k = key("u");
  await updatePart({ actorUid: granted, idempotencyKey: k, partId: pid, expectedVersion: 1, changes: { internalPartNumber: "R1-IPN" } }, DEPS);
  const r2 = await updatePart({ actorUid: granted, idempotencyKey: k, partId: pid, expectedVersion: 1, changes: { internalPartNumber: "R1-IPN" } }, DEPS);
  assert.equal(r2.outcome, "replayed");
  const d = deriveAliasDocId("INTERNAL_PN", pid);
  assert.equal((await db.collection("auditEvents").where("targetId", "==", d.docId).get()).size, 1);
  // change back: old value R1-IPN backfills; pid alias already exists (same part) -> no duplicate, update succeeds
  const r3 = await updatePart({ actorUid: granted, idempotencyKey: key("u2"), partId: pid, expectedVersion: 2, changes: { internalPartNumber: pid } }, DEPS);
  assert.equal(r3.version, 3);
});
await check("E: ordinary field updates unaffected by backfill path", async () => {
  const pid = await newPart();
  const r = await updatePart({ actorUid: granted, idempotencyKey: key("u"), partId: pid, expectedVersion: 1, changes: { name: "Renamed" } }, DEPS);
  assert.equal(r.version, 2);
  assert.equal((await resolvePartAlias({ aliasType: "INTERNAL_PN", rawValue: pid }, DEPS)).result, "NOT_FOUND"); // no spurious alias
});

console.log(`\npartAliasCommands: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
