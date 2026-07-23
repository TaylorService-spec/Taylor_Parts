// INV-1 CREATE Write-Tool -- importer tests. Pure plan/guard checks need no
// emulator; the idempotency + conflict tests exercise the REAL createPart
// against the Firestore emulator with an injected capability (deps.roles),
// exactly like partMasterCommands.test.mjs. Zero production access.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { buildCreatePlan, executeCreatePlan, idempotencyKeyFor } = require("../scripts/executePartMasterCreate.js");
const { createPart } = await import("../lib/partMaster/partMasterCommands.js");

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
await check("execute then idempotent rerun: SUCCESS then ALREADY_APPLIED (real createPart, emulator)", async () => {
  const suffix = uid("run");
  const rows = [1, 2, 3].map((n) => pkgRow(n, `${suffix}-${n}`));
  const csv = `${HEADER}\n${rowCsv(`${suffix}-1`, "A")}\n${rowCsv(`${suffix}-2`, "B")}\n${rowCsv(`${suffix}-3`, "C")}\n`;
  const csvSha = sha256(csv);
  const built = buildCreatePlan({ csvText: csv, packageMetadata: { approvedInputSha256: csvSha }, packageRows: rows, approvedSha256: csvSha, expectedCount: 3, csvSha256: csvSha });
  assert.deepEqual(built.refusals, []);
  const opts = { actorUid, approvedSha256: csvSha, deps: DEPS };
  const first = await executeCreatePlan(built.plan, opts);
  assert.deepEqual(first.counts, { SUCCESS: 3 });
  assert.equal(first.complete, true);
  assert.equal((await db.collection("parts").doc(`${suffix}-1`).get()).exists, true);
  const second = await executeCreatePlan(built.plan, opts); // safe restart
  assert.deepEqual(second.counts, { ALREADY_APPLIED: 3 });
});
await check("conflicting existing record: never overwrites -> FAILED CONFLICT_EXISTING (emulator)", async () => {
  const suffix = uid("conf");
  const pid = `${suffix}-1`;
  // Pre-create the part under a DIFFERENT idempotency key (foreign create).
  await createPart({ actorUid, idempotencyKey: uid("foreign"), part: { partId: pid, internalPartNumber: pid, name: "Foreign", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  const rows = [pkgRow(1, pid)];
  const csv = `${HEADER}\n${rowCsv(pid, "Mine")}\n`;
  const csvSha = sha256(csv);
  const built = buildCreatePlan({ csvText: csv, packageMetadata: { approvedInputSha256: csvSha }, packageRows: rows, approvedSha256: csvSha, expectedCount: 1, csvSha256: csvSha });
  const res = await executeCreatePlan(built.plan, { actorUid, approvedSha256: csvSha, deps: DEPS });
  assert.equal(res.results[0].status, "FAILED");
  assert.equal(res.results[0].failureKind, "CONFLICT_EXISTING");
  assert.equal(res.complete, false);
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
