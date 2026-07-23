// INV-1 Phase 1 PR 1.8 -- CSV dry-run analysis tests (emulator for
// Part/alias fixtures; the analysis core itself takes injected lookups).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import fs from "node:fs";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { createPart, changePartStatus, updatePart, createPartAlias } = await import("../lib/partMaster/partMasterCommands.js")
  .then(async (m) => ({ ...m, createPartAlias: (await import("../lib/partMaster/partAliasCommands.js")).createPartAlias }));
const { analyzeCsv, parseCsv, UnusableCsvError } = await import("../lib/partMaster/csvMigrationAnalysis.js");
const { buildFirestorePartRepository } = await import("../lib/partMaster/partMasterRepository.js");
const { buildFirestorePartAliasRepository } = await import("../lib/partMaster/partAliasRepository.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const now = Date.now();
let seq = 0;
const uid = (p) => `${p}-${now}-${(seq += 1)}`;
const key = (p) => `${p}-key-${now}-${(seq += 1)}`;
const TEST_ROLES = Object.freeze({ pmFull: { id: "pmFull", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] } });
const actorUid = uid("actor");
await db.collection("users").doc(actorUid).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(uid("asg")).set({ id: "a", principalUid: actorUid, roleId: "pmFull", scope: { type: "global" }, grantedBy: "t", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 1 });
const DEPS = { roles: TEST_ROLES, now: () => new Date(1750000000000) };
const partRepo = buildFirestorePartRepository(db);
const aliasRepo = buildFirestorePartAliasRepository(db);
const LOOKUPS = { getPart: (id) => partRepo.getById(null, id).catch(() => null), getAlias: (id) => aliasRepo.getByAliasId(null, id).catch(() => null) };
const HEADER = "internalPartNumber,name,controlType,stockingClass,stockingUnit,partId,description,category,legacySku,qtyOnHand";
const row = (ipn, name, extra = ",,,,,") => `${ipn},${name},STANDARD,STOCKED,EACH${extra}`;

console.log("csvMigrationAnalysis.test.mjs");

await check("parser: quoted fields, embedded commas/quotes, CRLF", () => {
  const rows = parseCsv('a,"b,1","c""q"\r\nd,e,f\n');
  assert.deepEqual(rows, [["a", "b,1", 'c"q'], ["d", "e", "f"]]);
});
await check("unusable file: missing header/required column -> UnusableCsvError (non-zero-exit path)", async () => {
  await assert.rejects(analyzeCsv("", LOOKUPS), UnusableCsvError);
  await assert.rejects(analyzeCsv("name,foo\nx,y\n", LOOKUPS), UnusableCsvError);
});
await check("CREATE / UPDATE / NO_CHANGE classification + dry-run zero writes", async () => {
  const pid = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "Same Name", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  const pid2 = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid2, internalPartNumber: pid2, name: "Old Name", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid2, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  const csv = `${HEADER}\n${row("NEW-" + pid, "Brand New")}\n${row(pid, "Same Name")}\n${row(pid + "X", "ignored")}\n${row(pid2, "Renamed")}\n`;
  const r = await analyzeCsv(csv, LOOKUPS);
  assert.equal(r.rows[0].classification, "CREATE");
  assert.equal(r.rows[0].proposedPartId, "NEW-" + pid); // grandfathering: IPN becomes id
  assert.equal(r.rows[1].classification, "NO_CHANGE");
  assert.equal(r.rows[3].classification, "UPDATE"); // distinct part, name differs
  const partsBefore = (await db.collection("parts").doc("NEW-" + pid).get()).exists;
  assert.equal(partsBefore, false); // dry-run: nothing written
});
await check("in-file duplicates: partId and normalized IPN -> CONFLICT (first wins)", async () => {
  const csv = `${HEADER}\n${row("DUP-A", "One")}\n${row("dup-a", "Two")}\n${row("X-1", "A", ",PX-1,,,,")}\n${row("X-2", "B", ",PX-1,,,,")}\n`;
  const r = await analyzeCsv(csv, LOOKUPS);
  assert.equal(r.rows[1].reasonCode, "DUPLICATE_IPN_IN_FILE"); // case-normalized dup
  assert.equal(r.rows[3].reasonCode, "DUPLICATE_PART_ID_IN_FILE");
  assert.equal(r.duplicateCount, 2);
});
await check("alias owned by another part + inactive target + immutable-id mutation -> CONFLICT", async () => {
  const p1 = uid("P"); const p2 = uid("P");
  for (const pid of [p1, p2]) {
    await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "N", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
    await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  }
  await createPartAlias({ actorUid, idempotencyKey: key("a"), partId: p1, aliasType: "LEGACY", rawValue: "OLD-" + p1 }, DEPS);
  // legacySku owned by p1 but row targets p2:
  const csv1 = `${HEADER}\n${row(p2, "N", `,,,,OLD-${p1},`)}\n`;
  assert.equal((await analyzeCsv(csv1, LOOKUPS)).rows[0].reasonCode, "ALIAS_OWNED_BY_OTHER_PART");
  // inactive target:
  await changePartStatus({ actorUid, idempotencyKey: key("s2"), partId: p2, expectedVersion: 2, newStatus: "DISCONTINUED" }, DEPS);
  assert.equal((await analyzeCsv(`${HEADER}\n${row(p2, "N")}\n`, LOOKUPS)).rows[0].reasonCode, "TARGET_PART_INACTIVE");
  // immutable-id mutation: row partId != resolved canonical:
  const csv3 = `${HEADER}\n${row(p1, "N", `,DIFFERENT-ID,,,,`)}\n`;
  assert.equal((await analyzeCsv(csv3, LOOKUPS)).rows[0].reasonCode, "IMMUTABLE_ID_MUTATION");
});
await check("renumbered part: IPN alias resolves to canonical (UPDATE path)", async () => {
  const pid = uid("P");
  await createPart({ actorUid, idempotencyKey: key("c"), part: { partId: pid, internalPartNumber: pid, name: "N", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" } }, DEPS);
  await changePartStatus({ actorUid, idempotencyKey: key("s"), partId: pid, expectedVersion: 1, newStatus: "ACTIVE" }, DEPS);
  await updatePart({ actorUid, idempotencyKey: key("u"), partId: pid, expectedVersion: 2, changes: { internalPartNumber: "NEW-" + pid } }, DEPS);
  const r = await analyzeCsv(`${HEADER}\n${row(pid, "Different Name")}\n`, LOOKUPS); // old IPN via backfill alias
  assert.equal(r.rows[0].proposedPartId, pid);
  assert.equal(r.rows[0].classification, "UPDATE");
});
await check("malformed rows: identifiers, units, domain failures -> INVALID (run continues)", async () => {
  const csv = `${HEADER}\n${row("bad id!!", "X")}\n` + `GOOD-1,Y,STANDARD,STOCKED,PALLET,,,,,\n` + `GOOD-2,,STANDARD,STOCKED,EACH,,,,,\n` + `${row("GOOD-3", "Z", ",,,,also bad!!,")}\n` + `${row("FINE-1", "OK")}\n`;
  const r = await analyzeCsv(csv, LOOKUPS);
  assert.equal(r.rows[0].reasonCode, "MALFORMED_IDENTIFIER");
  assert.equal(r.rows[1].reasonCode, "UNKNOWN_UNIT");
  assert.equal(r.rows[2].reasonCode, "MISSING_REQUIRED_FIELD");
  assert.equal(r.rows[3].reasonCode, "MALFORMED_IDENTIFIER"); // legacySku malformed
  assert.equal(r.rows[4].classification, "CREATE"); // run never aborted
  assert.equal(r.counts.INVALID, 4);
});
await check("deterministic: same input + state -> identical output; informational qty ignored", async () => {
  const csv = `${HEADER}\n${row("DET-1", "D", ",,,,,42")}\n`;
  const a = await analyzeCsv(csv, LOOKUPS);
  const b = await analyzeCsv(csv, LOOKUPS);
  assert.deepEqual(a, b);
  assert.deepEqual(a.rows[0].informationalQuantities, { qtyOnHand: "42" });
  assert.deepEqual(a.ignoredInformationalColumns, ["qtyOnHand"]);
});
await check("zero write paths: analysis module imports no write API", () => {
  const src = fs.readFileSync(new URL("../src/partMaster/csvMigrationAnalysis.ts", import.meta.url), "utf8");
  // Firestore-write-shaped patterns only (Map.set/Set.add are not writes):
  for (const bad of ["txn.set(", "txn.create(", ".doc(", "runTransaction", "stageCreate", "stageUpdate", "WriteBatch", "BulkWriter", "FieldValue"]) {
    assert.ok(!src.includes(bad), `analysis module contains ${bad}`);
  }
  const cli = fs.readFileSync(new URL("../scripts/analyzePartMasterCsv.js", import.meta.url), "utf8");
  for (const bad of ["txn.set(", "txn.create(", ".update(", ".delete(", "runTransaction", "stageCreate", "WriteBatch"]) {
    assert.ok(!cli.includes(bad), `CLI contains ${bad}`);
  }
  assert.ok(cli.includes("DRY_RUN_ONLY"));
});

console.log(`\ncsvMigrationAnalysis: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
