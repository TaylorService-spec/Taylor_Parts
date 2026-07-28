// D5 (Read service) — EMULATOR verification of readService.ts against a REAL Firestore.
//
// Proves the Owner-approved D5 read model (OD-1..OD-6): bounded forward/reverse reads with the exact
// executable query shape, the untrusted navigation cursor (posture B), the bounded evidence window +
// per-request read-work budget, the page/window-scoped fail-closed disposition, the authorization matrix
// via an INJECTED permission fixture (no activation, no grant), sanitized output, and read-only /
// no-audit behaviour. Emulator-only, project taylor-parts, loopback — no production access, no secrets.
//
// Authorized-path reads use an injected resolvePermission fixture (design §5.5 seam); the real callable's
// resolver is not exercised here (equipment.compatibility.view stays active:false).
"use strict";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const RS = await import("../lib/equipmentCompatibility/readService.js");
const CUR = await import("../lib/equipmentCompatibility/readCursor.js");
const D1 = await import("../lib/equipmentCompatibility/domain/equipmentModel.js");
const D2 = await import("../lib/equipmentCompatibility/domain/compatibility.js");
const M = await import("../lib/equipmentCompatibility/equipmentModelRepository.js");
const CR = await import("../lib/equipmentCompatibility/compatibilityRepository.js");
const {
  EQUIPMENT_MODELS_COLLECTION, EQUIPMENT_PART_COMPATIBILITY_COLLECTION,
  EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, EQUIPMENT_COMPATIBILITY_COLLECTIONS,
} = await import("../lib/equipmentCompatibility/repository.js");
const AUDIT_EVENTS = "auditEvents";

let passed = 0, failed = 0;
const ok = async (n, f) => {
  try { await f(); passed += 1; console.log(`PASS -- ${n}`); }
  catch (e) { failed += 1; console.log(`FAIL -- ${n}\n       ${e && e.stack ? e.stack.split("\n").slice(0, 5).join("\n       ") : e}`); }
};

// ---- injected permission fixtures (the #226 seam; NO activation, NO grant) ----
const GRANT = { db, resolvePermission: () => true, serialSchemes: {} };
const DENY = { db, resolvePermission: () => false, serialSchemes: {} };
const THROW = { db, resolvePermission: () => { throw new Error("resolver exploded"); }, serialSchemes: {} };

// ---- governed value builders (same shapes as the D4 suites) ----
const MODEL_ID = "TAYLOR--C713";
const PART_ID = "TST-1001";
const META = { createdAt: Timestamp.fromMillis(1750000000000), createdBy: "seed", updatedAt: Timestamp.fromMillis(1750000000000), updatedBy: "seed" };
const model = (o = {}) => D1.validateEquipmentModel({
  equipmentModelId: MODEL_ID, manufacturerId: "TAYLOR", manufacturerName: "Taylor", modelNumber: "C713",
  displayName: "Taylor C713", family: null, subtype: null, revision: null, status: "ACTIVE",
  sourceAuthority: "manufacturer", version: 1, ...o,
}).value;
const compatOf = (o = {}) => D2.validateCompatibility({
  equipmentModelId: MODEL_ID, partId: PART_ID, compatibilityType: "DIRECT_FIT", assembly: null,
  installationPosition: null, quantityRequired: 1,
  applicability: { kind: "ALL_SERIALS", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null },
  effectiveFrom: null, effectiveTo: null, sourceSummary: null, confidenceLevel: "HIGH",
  verificationStatus: "VERIFIED", notes: null, version: 1, ...o,
}, { serialSchemes: {} }).value;
const sourceOf = (compatibilityId, fp, o = {}) => D2.validateCompatibilitySource({
  compatibilityId, authorityType: "MANUFACTURER", sourceReference: "Service Manual 12", sourceVersion: null,
  observedClaim: "SUPPORTS", contentFingerprint: fp, capturedAt: "2026-07-27T07:06:24Z",
  capturedBy: "admin-secret-uid", notes: "internal note that must never leak", ...o,
}).value;

const seedModel = (o = {}) => db.collection(EQUIPMENT_MODELS_COLLECTION).doc(o.equipmentModelId ?? MODEL_ID).set(M.modelToFirestore({ model: model(o), ...META }));
const seedCompat = (c) => db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(c.compatibilityId).set(CR.compatibilityToFirestore({ compatibility: c, ...META }, { serialSchemes: {} }));
const seedSource = (s) => db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).doc(s.sourceId).set(CR.sourceToFirestore({ source: s, ...META }));
// A genuinely-distinct 64-hex contentFingerprint per seed (sourceId hashes it, so collisions would
// overwrite). A naive modular generator collides mod 16 — encode the seed directly instead.
const hex = (seed) => seed.toString(16).padStart(64, "0");

async function clearAll() {
  for (const coll of [...EQUIPMENT_COMPATIBILITY_COLLECTIONS, AUDIT_EVENTS]) {
    const snap = await db.collection(coll).get();
    // batched delete
    let batch = db.batch(); let n = 0;
    for (const d of snap.docs) { batch.delete(d.ref); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
    if (n % 400 !== 0) await batch.commit();
  }
}
async function seedManyBatched(docs) {
  let batch = db.batch(); let n = 0;
  for (const { coll, id, data } of docs) { batch.set(db.collection(coll).doc(id), data); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
  if (n % 400 !== 0) await batch.commit();
}
const compatDoc = (c) => ({ coll: EQUIPMENT_PART_COMPATIBILITY_COLLECTION, id: c.compatibilityId, data: CR.compatibilityToFirestore({ compatibility: c, ...META }, { serialSchemes: {} }) });
const sourceDoc = (s) => ({ coll: EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION, id: s.sourceId, data: CR.sourceToFirestore({ source: s, ...META }) });

// ===========================================================================
// A. AUTHORIZATION MATRIX (injected resolver fixture; no activation)
// ===========================================================================
await ok("authorization: granted reads, denied fixture => DENIED, throwing resolver => DENIED (fail closed)", async () => {
  await clearAll(); await seedModel(); await seedCompat(compatOf());
  const granted = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(granted.pageDisposition, "AVAILABLE");
  const denied = await RS.readCompatibilityForPart(DENY, { actorUid: "a", partId: PART_ID });
  assert.equal(denied.pageDisposition, "DENIED");
  assert.deepEqual(denied.items, []);
  const thrown = await RS.readCompatibilityForModel(THROW, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(thrown.pageDisposition, "DENIED", "a throwing resolver denies, never approves");
  const mDenied = await RS.readModelSummary(DENY, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(mDenied.disposition, "DENIED");
});

// ===========================================================================
// B. FORWARD / REVERSE happy path + parity + operational conjunction
// ===========================================================================
await ok("forward and reverse both return the relationship; operational requires VERIFIED+resolved+model+evidence-OK", async () => {
  await clearAll(); await seedModel();
  const c = compatOf(); await seedCompat(c);
  const fwd = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  const rev = await RS.readCompatibilityForModel(GRANT, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(fwd.items.length, 1); assert.equal(rev.items.length, 1);
  assert.equal(fwd.items[0].compatibilityId, c.compatibilityId, "forward/reverse parity: same relationship");
  assert.equal(rev.items[0].compatibilityId, c.compatibilityId);
  const it = fwd.items[0];
  assert.equal(it.operational, true, "VERIFIED + ALL_SERIALS + model present + zero-evidence(complete) => operational");
  assert.equal(it.evidence.status, "OK");
  assert.equal(it.model.displayName, "Taylor C713");
});
await ok("non-VERIFIED / UNRESOLVED / missing-model are SURFACED but operational:false", async () => {
  await clearAll(); await seedModel();
  await seedCompat(compatOf({ assembly: "A1", verificationStatus: "CONFLICT" }));
  await seedCompat(compatOf({ assembly: "A2", verificationStatus: "IN_REVIEW" }));
  await seedCompat(compatOf({ assembly: "A3", verificationStatus: "UNVERIFIED" }));
  await seedCompat(compatOf({ assembly: "A4", verificationStatus: "UNVERIFIED", applicability: { kind: "UNRESOLVED", serialScheme: null, serialRangeStart: null, serialRangeEnd: null, modelRevision: null } }));
  const r = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(r.items.length, 4, "all four surfaced");
  assert.equal(r.items.every((i) => i.operational === false), true, "none operational");
  assert.equal(r.pageDisposition, "AVAILABLE", "surfaced-but-non-operational is not itself a degrade");
});

// ===========================================================================
// C. EXACT QUERY SHAPE executes + documentId() ordering + pagination integrity
// ===========================================================================
await ok("executable query runs with documentId() order; pagination traverses complete, gap-free, non-overlapping", async () => {
  await clearAll(); await seedModel();
  const N = 12;
  const compats = Array.from({ length: N }, (_, i) => compatOf({ assembly: `ASSY-${String(i).padStart(2, "0")}` }));
  await seedManyBatched(compats.map(compatDoc));
  const expectedIds = compats.map((c) => c.compatibilityId).sort(); // documentId() ascending
  // Paginate with a small limit and collect.
  const seen = [];
  let cursor;
  let pages = 0;
  do {
    const page = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, cursor, limit: 5 });
    assert.ok(["AVAILABLE", "EMPTY"].includes(page.pageDisposition), `clean page: ${page.pageDisposition}`);
    for (const it of page.items) seen.push(it.compatibilityId);
    cursor = page.nextCursor ?? undefined;
    pages += 1;
    assert.ok(pages <= 10, "pagination terminates");
  } while (cursor);
  assert.deepEqual(seen, expectedIds, "every id seen exactly once, in documentId() order, gap-free");
  assert.equal(new Set(seen).size, N, "no overlap across pages");
});

// ===========================================================================
// D. CURSOR posture B — validation refuses malformed/cross-bound; reposition accepted; still authorized
// ===========================================================================
await ok("cursor posture B: cross-bound/malformed cursors refused; a valid afterId for the same (dir,key) repositions", async () => {
  await clearAll(); await seedModel();
  const compats = Array.from({ length: 6 }, (_, i) => compatOf({ assembly: `B-${i}` }));
  await seedManyBatched(compats.map(compatDoc));
  const first = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, limit: 3 });
  assert.ok(first.nextCursor, "a next cursor is issued");
  // A forward cursor submitted on a reverse read must be refused (dir mismatch).
  await assert.rejects(() => RS.readCompatibilityForModel(GRANT, { actorUid: "a", equipmentModelId: MODEL_ID, cursor: first.nextCursor }), /direction|key/i);
  // A forward cursor for THIS part submitted for a DIFFERENT part must be refused (key mismatch).
  await assert.rejects(() => RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: "OTHER-99", cursor: first.nextCursor }), /key|malformed/i);
  // A tampered/garbage cursor is refused.
  await assert.rejects(() => RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, cursor: "not-a-cursor!!" }), /cursor/i);
  // A valid, hand-built cursor for the correct (dir,key) with an arbitrary canonical afterId is ACCEPTED
  // as a reposition, and every returned record still belongs to the bound query (partId === PART_ID).
  const sortedIds = compats.map((c) => c.compatibilityId).sort();
  const repositioned = CUR.encodeCursor({ dir: "forward", key: PART_ID, afterId: sortedIds[1] });
  const page = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, cursor: repositioned, limit: 10 });
  assert.equal(page.items.every((i) => i.partId === PART_ID), true, "every repositioned item still belongs to the bound query");
  assert.equal(page.items.every((i) => i.compatibilityId > sortedIds[1]), true, "reposition skipped forward within the authorized set");
});

// ===========================================================================
// E. EVIDENCE bounds — per-relationship overflow + per-request budget
// ===========================================================================
await ok("evidence overflow (> MAX_EVIDENCE_PER_RELATIONSHIP) => INCOMPLETE + operational:false; counts are bounded-window", async () => {
  await clearAll(); await seedModel();
  const c = compatOf(); await seedCompat(c);
  const over = RS.MAX_EVIDENCE_PER_RELATIONSHIP + 3;
  await seedManyBatched(Array.from({ length: over }, (_, i) => sourceDoc(sourceOf(c.compatibilityId, hex(i + 1)))));
  const r = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  const it = r.items[0];
  assert.equal(it.evidence.status, "INCOMPLETE");
  assert.equal(it.evidence.windowComplete, false);
  assert.equal(it.evidence.windowSize, RS.MAX_EVIDENCE_PER_RELATIONSHIP, "window is capped");
  assert.equal(it.operational, false, "incomplete evidence forces non-operational");
  assert.equal(r.pageDisposition, "DEGRADED");
  assert.equal(r.windowCounts.evidenceIncomplete, 1);
});
await ok("per-request evidence read-work budget forces later relationships INCOMPLETE (budget, not overflow)", async () => {
  await clearAll(); await seedModel();
  // Each relationship holds exactly MAX_EVIDENCE_PER_RELATIONSHIP sources (no overflow), so any INCOMPLETE
  // is caused by the request budget. ceil(BUDGET / MAX) relationships spend the budget; the next is starved.
  const per = RS.MAX_EVIDENCE_PER_RELATIONSHIP;
  const rels = Math.floor(RS.MAX_EVIDENCE_READS_PER_REQUEST / per) + 2;
  const compats = Array.from({ length: rels }, (_, i) => compatOf({ assembly: `BUD-${String(i).padStart(2, "0")}` }));
  const docs = [];
  for (const c of compats) { docs.push(compatDoc(c)); for (let j = 0; j < per; j++) docs.push(sourceDoc(sourceOf(c.compatibilityId, hex(j + 1)))); }
  await seedManyBatched(docs);
  const r = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, limit: rels });
  const okCount = r.items.filter((i) => i.evidence.status === "OK").length;
  const incompleteCount = r.items.filter((i) => i.evidence.status === "INCOMPLETE").length;
  assert.ok(incompleteCount >= 1, "at least one relationship is starved by the budget");
  assert.ok(okCount >= 1 && okCount <= Math.ceil(RS.MAX_EVIDENCE_READS_PER_REQUEST / per), "only budget-many relationships read their evidence fully");
  assert.equal(r.items.filter((i) => i.evidence.status === "INCOMPLETE").every((i) => i.operational === false), true);
  assert.equal(r.pageDisposition, "DEGRADED");
});

// ===========================================================================
// F. RESPONSE-LEVEL FAIL-CLOSED matrix
// ===========================================================================
await ok("corrupt+valid => DEGRADED (malformed omitted+counted, valid returned); corrupt-only => DEGRADED (never EMPTY)", async () => {
  await clearAll(); await seedModel();
  const good = compatOf({ assembly: "GOOD" }); await seedCompat(good);
  const bad = compatOf({ assembly: "BAD" }); await seedCompat(bad);
  // Corrupt the stored 'bad' doc in place (still matches the where(partId==) query) so its D2 re-validation fails.
  await db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(bad.compatibilityId).update({ verificationStatus: "BOGUS" });
  const mixed = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(mixed.pageDisposition, "DEGRADED");
  assert.equal(mixed.windowCounts.malformedOmitted, 1);
  assert.equal(mixed.items.length, 1);
  assert.equal(mixed.items[0].compatibilityId, good.compatibilityId);
  // Corrupt-only.
  await db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(good.compatibilityId).update({ compatibilityType: "NOPE" });
  const onlyBad = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(onlyBad.pageDisposition, "DEGRADED", "only-malformed is DEGRADED, never EMPTY");
  assert.equal(onlyBad.items.length, 0);
  assert.equal(onlyBad.windowCounts.malformedOmitted, 2);
});
await ok("rejected-only => AVAILABLE with 0 operational + excludedRejected>0 (never EMPTY); genuine EMPTY is distinct", async () => {
  await clearAll(); await seedModel();
  await seedCompat(compatOf({ assembly: "R1", verificationStatus: "REJECTED" }));
  await seedCompat(compatOf({ assembly: "R2", verificationStatus: "REJECTED" }));
  const rej = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(rej.pageDisposition, "AVAILABLE", "the query returned docs; excluded != empty");
  assert.equal(rej.items.length, 0);
  assert.equal(rej.windowCounts.excludedRejected, 2, "rejected are counted, never shown as none");
  const empty = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: "NO-SUCH-PART" });
  assert.equal(empty.pageDisposition, "EMPTY");
});
await ok("missing/malformed model => item model:null + operational:false + DEGRADED; malformed evidence => evidence UNAVAILABLE + operational:false", async () => {
  await clearAll();
  // (no model seeded) — missing model authority.
  const c = compatOf(); await seedCompat(c);
  const noModel = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(noModel.items[0].model, null);
  assert.equal(noModel.items[0].operational, false);
  assert.equal(noModel.pageDisposition, "DEGRADED");
  // Now seed model, add ONE evidence doc and corrupt it.
  await seedModel();
  const s = sourceOf(c.compatibilityId, hex(7)); await seedSource(s);
  await db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).doc(s.sourceId).update({ observedClaim: "MAYBE" });
  const badEv = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  assert.equal(badEv.items[0].evidence.status, "UNAVAILABLE");
  assert.equal(badEv.items[0].operational, false);
  assert.equal(badEv.pageDisposition, "DEGRADED");
});

// ===========================================================================
// G. WHOLE-QUERY completeness never prematurely concluded (page-scoped)
// ===========================================================================
await ok("a clean first page (AVAILABLE, nextCursor!=null) then a degraded second page — no global-clean flag", async () => {
  await clearAll(); await seedModel();
  // 3 clean relationships with LOW ids + 1 malformed with a HIGH id, so the malformed lands on page 2.
  const clean = [0, 1, 2].map((i) => compatOf({ assembly: `AA-${i}` }));
  await seedManyBatched(clean.map(compatDoc));
  const badId = "cmp_" + "f".repeat(64); // canonical shape, high sort key, content will not match => malformed
  await db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).doc(badId).set({ ...CR.compatibilityToFirestore({ compatibility: compatOf({ assembly: "ZZ" }), ...META }, { serialSchemes: {} }), compatibilityId: badId, partId: PART_ID });
  const page1 = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, limit: 2 });
  assert.equal(page1.pageDisposition, "AVAILABLE", "first page is clean");
  assert.ok(page1.nextCursor, "more pages exist => whole-query cleanliness is UNKNOWN from page 1");
  // The response carries NO global 'clean/complete' flag — only page-scoped fields.
  assert.equal("pageDisposition" in page1 && !("clean" in page1) && !("complete" in page1), true);
  const page2 = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID, cursor: page1.nextCursor, limit: 10 });
  assert.equal(page2.pageDisposition, "DEGRADED", "the later page carries the malformed record");
  assert.equal(page2.windowCounts.malformedOmitted, 1);
});

// ===========================================================================
// H. SANITIZATION + read-only / no-audit
// ===========================================================================
await ok("responses expose no raw evidence/serial/notes/fingerprint/uniquenessKey; reads mutate nothing and write no audit", async () => {
  await clearAll(); await seedModel();
  const c = compatOf(); await seedCompat(c);
  const s = sourceOf(c.compatibilityId, hex(3)); await seedSource(s);
  const before = (await db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).get()).size + (await db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).get()).size;
  const r = await RS.readCompatibilityForPart(GRANT, { actorUid: "a", partId: PART_ID });
  const blob = JSON.stringify(r);
  for (const forbidden of ["Service Manual 12", "admin-secret-uid", "internal note that must never leak", s.contentFingerprint, c.uniquenessKey, "sourceReference", "contentFingerprint", "capturedBy", "uniquenessKey"]) {
    assert.equal(blob.includes(forbidden), false, `response must not leak ${forbidden}`);
  }
  // Evidence summary is present but sanitized (authority + counts only).
  assert.equal(r.items[0].evidence.strongestSupportingAuthority, "MANUFACTURER");
  assert.equal(r.items[0].evidence.boundedSupportsCount, 1);
  const after = (await db.collection(EQUIPMENT_PART_COMPATIBILITY_COLLECTION).get()).size + (await db.collection(EQUIPMENT_COMPATIBILITY_SOURCES_COLLECTION).get()).size;
  assert.equal(after, before, "reads mutate nothing");
  assert.equal((await db.collection(AUDIT_EVENTS).get()).size, 0, "reads emit no audit event");
});

// ===========================================================================
// I. model summary point read
// ===========================================================================
await ok("readModelSummary: AVAILABLE for a present model, EMPTY for a missing one, DEGRADED for a malformed one", async () => {
  await clearAll();
  const missing = await RS.readModelSummary(GRANT, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(missing.disposition, "EMPTY");
  await seedModel();
  const present = await RS.readModelSummary(GRANT, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(present.disposition, "AVAILABLE");
  assert.equal(present.model.displayName, "Taylor C713");
  await db.collection(EQUIPMENT_MODELS_COLLECTION).doc(MODEL_ID).update({ status: "NONSENSE" });
  const bad = await RS.readModelSummary(GRANT, { actorUid: "a", equipmentModelId: MODEL_ID });
  assert.equal(bad.disposition, "DEGRADED");
  assert.equal(bad.model, null);
});

console.log(`\n${passed} D5 read-service emulator checks passed${failed ? `, ${failed} FAILED` : ""}`);
if (failed) process.exit(1);
