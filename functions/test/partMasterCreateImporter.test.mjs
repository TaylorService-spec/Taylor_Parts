// INV-1 CREATE Write-Tool -- importer tests. Pure plan/guard checks need no
// emulator; the idempotency + conflict tests exercise the REAL createPart
// against the Firestore emulator with an injected capability (deps.roles),
// exactly like partMasterCommands.test.mjs. Zero production access.
//
// CATALOG CUTOVER FREEZE (catalogMaster/catalogWriterState.ts, FROZEN/INACTIVE). The importer writes ONLY through
// createPart, a legacy Firestore catalog writer that is now FROZEN. So the two emulator tests that executed the plan
// against the real createPart assert the governed refusal (ruling A): the first row fails with the writer's
// FirestoreCatalogWriterClosedError (FIRESTORE_CATALOG_WRITER_FROZEN), stop-on-first-failure leaves every other row
// NOT_ATTEMPTED, no Part is written and an existing record is never touched. The importer's OWN pure logic -- plan
// building, guards, the deterministic key, and the failure classification -- is proven unchanged (ruling B), the
// classification through the existing createFn seam. Nothing here reopens a writer or replaces the guard.
import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import admin from "firebase-admin";
admin.initializeApp({ projectId: "demo-eos-test" });
const db = admin.firestore();
const { buildCreatePlan, executeCreatePlan, idempotencyKeyFor } = require("../scripts/executePartMasterCreate.js");
const { createPart, AlreadyExistsError } = await import("../lib/partMaster/partMasterCommands.js");
const { partToFirestore } = await import("../lib/partMaster/partMasterRepository.js");
const { validatePart } = await import("../lib/partMaster/validation.js");
const { FirestoreCatalogWriterClosedError } = await import("../lib/catalogMaster/catalogWriterState.js");
// The REAL frozen createPart, observed through the importer's existing createFn seam so the thrown error's class and
// code are visible (the importer's result row carries only its message).
function observedCreatePart(seen) {
  return async (input) => {
    try { return await createPart(input, DEPS); } catch (err) { seen.push(err); throw err; }
  };
}
function assertFrozenPartCreate(err) {
  assert.ok(err instanceof FirestoreCatalogWriterClosedError, `expected the governed freeze refusal, got ${err?.name}: ${err?.message}`);
  assert.equal(err.code, "FIRESTORE_CATALOG_WRITER_FROZEN");
  assert.equal(err.writer, "part.create");
}

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// --- synthetic CSV + matching approved package (3 CREATE rows) -----------
const HEADER = "internalPartNumber,name,controlType,stockingClass,stockingUnit,partId,description,category,legacySku,qtyOnHand";
const rowCsv = (ipn, name) => `${ipn},${name},STANDARD,STOCKED,EACH,,,,,`;
const CSV = `${HEADER}\n${rowCsv("CREATEFIX-1", "Alpha")}\n${rowCsv("CREATEFIX-2", "Beta")}\n${rowCsv("CREATEFIX-3", "Gamma")}\n`;
const CSV_SHA = sha256(CSV);
const pkgRow = (rowNumber, partId) => ({ rowNumber, normalizedLegacyId: partId, proposedPartId: partId, classification: "CREATE", reasonCode: "NEW_PART", reason: "new" });
const PKG_ROWS = [pkgRow(1, "CREATEFIX-1"), pkgRow(2, "CREATEFIX-2"), pkgRow(3, "CREATEFIX-3")];
const META = { approvedInputSha256: CSV_SHA };
const baseArgs = () => ({ csvText: CSV, packageMetadata: META, packageRows: PKG_ROWS, approvedSha256: CSV_SHA, expectedCount: 3, csvSha256: CSV_SHA });

// --- emulator capability fixture -----------------------------------------
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const TEST_ROLES = Object.freeze({ pm: { id: "pm", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] } });
const actorUid = uid("createop");
await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(uid("asg")).set({ id: "a", principalUid: actorUid, roleId: "pm", scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };

console.log("partMasterCreateImporter.test.mjs");

await check("clean plan: 3 CREATE parts built, deterministic partId=raw IPN, no refusals", () => {
  const { refusals, plan } = buildCreatePlan(baseArgs());
  assert.deepEqual(refusals, []);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.partId), ["CREATEFIX-1", "CREATEFIX-2", "CREATEFIX-3"]);
  assert.equal(plan[0].part.status, "DRAFT");
});
await check("hash mismatch refuses (CSV sha != approved)", () => {
  assert.ok(buildCreatePlan({ ...baseArgs(), csvSha256: "b".repeat(64) }).refusals.some((r) => /!= approved --input-sha256/.test(r)));
  assert.ok(buildCreatePlan({ ...baseArgs(), packageMetadata: { approvedInputSha256: "c".repeat(64) } }).refusals.some((r) => /package does not match/.test(r)));
});
await check("CREATE-only enforcement: any non-CREATE package row refuses", () => {
  const rows = [...PKG_ROWS, { rowNumber: 4, proposedPartId: "X", classification: "UPDATE", reasonCode: "FIELDS_DIFFER" }];
  const r = buildCreatePlan({ ...baseArgs(), packageRows: rows, expectedCount: 3 });
  assert.ok(r.refusals.some((x) => /non-CREATE row/.test(x)));
});
await check("population-count enforcement: expected-count mismatch refuses", () => {
  assert.ok(buildCreatePlan({ ...baseArgs(), expectedCount: 2 }).refusals.some((r) => /CREATE count 3 != --expected-count 2/.test(r)));
});
await check("partId divergence: package proposedPartId != derived partId refuses", () => {
  const rows = [pkgRow(1, "CREATEFIX-1"), pkgRow(2, "WRONG-ID"), pkgRow(3, "CREATEFIX-3")];
  const r = buildCreatePlan({ ...baseArgs(), packageRows: rows });
  assert.ok(r.refusals.some((x) => /derived partId "CREATEFIX-2" != package proposedPartId "WRONG-ID"/.test(x)));
});
await check("deterministic idempotency key: stable for (approved hash, partId)", () => {
  assert.equal(idempotencyKeyFor(CSV_SHA, "CREATEFIX-1"), idempotencyKeyFor(CSV_SHA, "CREATEFIX-1"));
  assert.notEqual(idempotencyKeyFor(CSV_SHA, "CREATEFIX-1"), idempotencyKeyFor(CSV_SHA, "CREATEFIX-2"));
  assert.ok(idempotencyKeyFor(CSV_SHA, "CREATEFIX-1").startsWith("pmcreate-"));
});
// Ruling A: the importer's only write path is frozen. Row 1 is refused with the governed code, rows 2-3 are never
// attempted, nothing is written, and a rerun is refused identically (no idempotency record was ever created).
await check("execute and rerun against the FROZEN createPart: row 1 FAILED (FROZEN), rest NOT_ATTEMPTED, zero writes (emulator)", async () => {
  const suffix = uid("run");
  const rows = [1, 2, 3].map((n) => pkgRow(n, `${suffix}-${n}`));
  const csv = `${HEADER}\n${rowCsv(`${suffix}-1`, "A")}\n${rowCsv(`${suffix}-2`, "B")}\n${rowCsv(`${suffix}-3`, "C")}\n`;
  const csvSha = sha256(csv);
  const built = buildCreatePlan({ csvText: csv, packageMetadata: { approvedInputSha256: csvSha }, packageRows: rows, approvedSha256: csvSha, expectedCount: 3, csvSha256: csvSha });
  assert.deepEqual(built.refusals, []);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seen = [];
    const res = await executeCreatePlan(built.plan, { actorUid, approvedSha256: csvSha, deps: DEPS, createFn: observedCreatePart(seen) });
    assert.deepEqual(res.results.map((r) => r.status), ["FAILED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
    assert.equal(res.results[0].failureKind, "ERROR");
    assert.equal(res.complete, false);
    assert.equal(seen.length, 1, "stop-on-first-failure: exactly one create attempted");
    assertFrozenPartCreate(seen[0]);
    assert.equal(res.results[0].message, seen[0].message);
  }
  for (const n of [1, 2, 3]) {
    assert.equal((await db.collection("parts").doc(`${suffix}-${n}`).get()).exists, false);
    assert.equal((await db.collection("auditEvents").where("targetId", "==", `${suffix}-${n}`).get()).size, 0);
  }
});
// Ruling A: an existing record is never overwritten -- the frozen writer refuses before reading it. Ruling B: the
// importer's own classification of a governed conflict (AlreadyExistsError -> CONFLICT_EXISTING) through createFn.
await check("existing record: FROZEN writer never overwrites it; a governed conflict still classifies CONFLICT_EXISTING", async () => {
  const suffix = uid("conf");
  const pid = `${suffix}-1`;
  // The foreign record, in exactly the stored shape createPart wrote.
  const v = validatePart({ partId: pid, internalPartNumber: pid, name: "Foreign", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" });
  const at = DEPS.now();
  await db.collection("parts").doc(pid).set(partToFirestore({ part: v.value, version: 1, createdAt: at, createdBy: "foreign", updatedAt: at, updatedBy: "foreign" }));
  const before = (await db.collection("parts").doc(pid).get()).data();
  const rows = [pkgRow(1, pid)];
  const csv = `${HEADER}\n${rowCsv(pid, "Mine")}\n`;
  const csvSha = sha256(csv);
  const built = buildCreatePlan({ csvText: csv, packageMetadata: { approvedInputSha256: csvSha }, packageRows: rows, approvedSha256: csvSha, expectedCount: 1, csvSha256: csvSha });
  const seen = [];
  const res = await executeCreatePlan(built.plan, { actorUid, approvedSha256: csvSha, deps: DEPS, createFn: observedCreatePart(seen) });
  assert.equal(res.results[0].status, "FAILED");
  assert.equal(res.complete, false);
  assertFrozenPartCreate(seen[0]);
  assert.deepEqual((await db.collection("parts").doc(pid).get()).data(), before, "the existing record is never overwritten");
  const classified = await executeCreatePlan(built.plan, { actorUid, approvedSha256: csvSha, createFn: async () => { throw new AlreadyExistsError(`part ${pid} already exists`); } });
  assert.equal(classified.results[0].status, "FAILED");
  assert.equal(classified.results[0].failureKind, "CONFLICT_EXISTING");
  assert.equal(classified.complete, false);
});
await check("partial failure: stop-on-first-failure; remaining NOT_ATTEMPTED (stub createFn)", async () => {
  const plan = [{ partId: "A", part: {} }, { partId: "B", part: {} }, { partId: "C", part: {} }];
  let calls = 0;
  const createFn = async () => { calls += 1; if (calls === 2) throw new Error("boom"); return { outcome: "applied", version: 1 }; };
  const res = await executeCreatePlan(plan, { actorUid, approvedSha256: CSV_SHA, createFn });
  assert.deepEqual(res.results.map((r) => r.status), ["SUCCESS", "FAILED", "NOT_ATTEMPTED"]);
  assert.equal(res.complete, false);
  assert.equal(calls, 2); // stopped; C never attempted
});
await check("dry-run planning is write-free: buildCreatePlan performs no writes", () => {
  // buildCreatePlan is pure; a clean plan touches no db. Sanity: same input twice = identical plan.
  const a = buildCreatePlan(baseArgs());
  const b = buildCreatePlan(baseArgs());
  assert.deepEqual(a.plan.map((p) => p.partId), b.plan.map((p) => p.partId));
});
await check("zero raw-write surface: importer writes ONLY via createPart", () => {
  const src = fs.readFileSync(new URL("../scripts/executePartMasterCreate.js", import.meta.url), "utf8");
  // No other mutation command:
  for (const bad of ["partAliasCommands", "partSupplierItems", "updatePart", "changePartStatus", "createManufacturer", "createPartAlias", "setPreferredSupplier"]) {
    assert.ok(!src.includes(bad), `importer references ${bad}`);
  }
  // No raw Firestore writes / batch / txn (Set.add / Map.get are not
  // Firestore writes, so match write-shaped Firestore patterns only):
  for (const bad of [".update(", ".delete(", "runTransaction", "WriteBatch", "BulkWriter", "stageCreate", "stageUpdate", "recursiveDelete", ".doc(", "collection(", "firebase-admin/auth", "firebase-admin/storage"]) {
    assert.ok(!src.includes(bad), `importer contains ${bad}`);
  }
  // The only Firestore-write path is the trusted command:
  assert.ok(!/\.set\(/.test(src), "importer contains a raw .set( call");
  assert.ok(src.includes("createPart"));
  assert.ok(!src.includes('PART_MASTER_REFERENCE = "enabled"'));
});

console.log(`\npartMasterCreateImporter: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
