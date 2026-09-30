// EOS Data Import P1 -- the WHOLE slice, against a live Firestore emulator.
//
// Everything else about import is tested against fakes. This is the one that proves the
// pieces are actually wired to each other: a CSV goes in through the real callable, an
// admin approves the staged job, and a Part comes out in the `parts` collection that the
// normal Parts experience reads -- written by the governed command, not by import.
//
// It also proves the two refusals that matter most, against real stored state rather than
// a mock: an unapproved execute is refused, and a second execute of the same job is refused.
//
// Prerequisite: a Firestore emulator (FIRESTORE_EMULATOR_HOST overridable).
//
// PROJECT IDENTITY IS THE POINT OF THE SETUP. GCLOUD_PROJECT is set to the sandbox project
// BEFORE the modules load, because it drives both gates independently: the target guard
// refuses a non-sandbox project by name, and the capability resolver's activation overrides
// are keyed on the same identity. Running this against "taylor-parts" would refuse at the
// first line of every callable, which is the behaviour the guard's own suite asserts.
import "./support/firebaseEmulatorGuard.cjs"; // FIRST: Firebase test-safety guard (emulator mode) -- see test/support/firebaseTestGuard.cjs
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "demo-eos-sandbox" }); // its own demo namespace, as the sandbox id once gave it
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const {
  stageDataImportCallable: stageDataImport,
  executeDataImportCallable: executeDataImport,
  listDataImportJobsCallable: listDataImportJobs,
  listImportedServiceHistoryCallable: listImportedServiceHistory,
} = await import(
  "../lib/dataImport/dataImportCallables.js"
);
const { derivePartId } = await import("../lib/dataImport/contracts/partImportContract.js");
const { deriveImportedAccountId } = await import("../lib/dataImport/firestoreDataImportAdapters.js");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

const run = Date.now();

/** An admin principal. admin holds the whole catalog by derivation, so no bespoke grant. */
async function seedAdmin(uid) {
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  await db.collection("roleAssignments").doc(`ra-${uid}`).set({
    id: `ra-${uid}`,
    principalUid: uid,
    roleId: "admin",
    scope: { type: "global" },
    grantedBy: "test",
    grantedAt: Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
  });
  return { uid, token: {} };
}

/** A principal with no assignment at all -- the fail-closed control. */
async function seedStranger(uid) {
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  return { uid, token: {} };
}

// SEEDED SYNTHETIC. Three clean rows and one that must be refused, so a green run proves
// both halves: what gets written, and what deliberately does not.
const SEEDED_CSV = [
  "PART_NO,NAME,DESCRIPTION,UOM,CONTROL_TYPE,STOCK_CLASS",
  `DI-${run}-1,Compressor gasket,Seeded compressor gasket,EA,STANDARD,STOCKED`,
  `DI-${run}-2,Door switch,Seeded door switch,EA,STANDARD,STOCKED`,
  `DI-${run}-3,Water filter,Seeded water filter,EA,STANDARD,STOCKED`,
  `DI-${run}-1,Duplicate of row 2,Seeded duplicate,EA,STANDARD,STOCKED`,
].join("\n");

// A header a real export might well carry. CLASS is a synonym of CATEGORY, not of Stocking
// Class, so only three of the five required fields are recognised -- and detection must SAY so
// rather than guess: a confidently wrong entity misfiles an entire file silently.
const AMBIGUOUS_CSV = [
  "PART_NO,DESCRIPTION,UOM,CONTROL,CLASS",
  `DI-${run}-9,Seeded ambiguous row,EA,STANDARD,STOCKED`,
].join("\n");

const auth = await seedAdmin(`di-admin-${run}`);
const stranger = await seedStranger(`di-stranger-${run}`);

// --------------------------------------------------------------- staging

let jobId = null;

await check("staging a file previews it and writes NO Part", async () => {
  const res = await stageDataImport.run({
    data: { fileName: "seeded-parts.csv", fileText: SEEDED_CSV },
    auth,
  });

  assert.equal(res.staged, true, "the file mapped cleanly and should have staged");
  assert.equal(res.job.entityType, "PARTS");
  assert.equal(res.job.status, "STAGED");
  assert.equal(res.job.targetProjectId, "eos-platform-sandbox");
  // Four data rows; the fourth repeats the first's identity and is refused IN the preview.
  assert.deepEqual(res.job.summary, { total: 4, ready: 3, warnings: 0, errors: 1 });

  // The load-bearing assertion of the whole feature: preview writes nothing.
  const wouldBe = await db.collection("parts").doc(derivePartId(`DI-${run}-1`)).get();
  assert.equal(wouldBe.exists, false, "no Part may exist before approval");

  jobId = res.job.jobId;
});

await check("an ambiguous header is REFUSED rather than guessed, and the admin can then choose", async () => {
  await assert.rejects(
    stageDataImport.run({ data: { fileName: "ambiguous.csv", fileText: AMBIGUOUS_CSV }, auth }),
    (err) => err.code === "failed-precondition" && err.details?.code === "ENTITY_UNDETERMINED",
    "a near-miss header must not be assumed to be Parts",
  );

  // The admin naming the entity is the resolution. It gets no further than staging here --
  // CLASS still maps to Category, so Stocking Class has no column and the mapping is
  // incomplete. That is the honest answer: the file needs a column, not a better guess.
  const chosen = await stageDataImport.run({
    data: { fileName: "ambiguous.csv", fileText: AMBIGUOUS_CSV, entityType: "PARTS" },
    auth,
  });
  assert.equal(chosen.staged, false);
  assert.equal(chosen.validation.valid, false);
  assert.ok(chosen.validation.findings.some((f) => f.field === "stockingClass"));
});

await check("an entity that is not wired yet says so, instead of staging a job nothing can run", async () => {
  await assert.rejects(
    stageDataImport.run({
      data: { fileName: "nope.csv", fileText: SEEDED_CSV, entityType: "NOT_AN_ENTITY" },
      auth,
    }),
    (err) => err.code === "unimplemented" && err.details?.code === "ENTITY_NOT_WIRED",
  );
});
// --------------------------------------------------------------- approval

await check("an execute request without explicit approval is refused", async () => {
  await assert.rejects(
    executeDataImport.run({ data: { jobId }, auth }),
    (err) => err.code === "failed-precondition",
    "naming a job is not approving it",
  );
  const stillStaged = await db.collection("data_import_jobs").doc(jobId).get();
  assert.equal(stillStaged.data().status, "STAGED");
});

// CATALOG CUTOVER FREEZE (step 2): the legacy Firestore catalog writers are FROZEN, so a PARTS import is refused WHOLE at
// execution -- before the job is claimed and before any row is written -- exactly as the CRM freeze refuses a customer
// import below. Staging and preview stay available.
const isPartImportFrozen = (err) => err.code === "failed-precondition" && err.details?.code === "FIRESTORE_CATALOG_WRITER_FROZEN";
const createPartAuditsForRun = async () =>
  (await db.collection("auditEvents").where("action", "==", "createPart").get()).docs.filter((d) => String(d.data().targetId ?? "").includes(`DI-${run}-`)).length;

// Ruling A: executing a PARTS import is the job-level legacy catalog writer (part.import) -- refused FROZEN, zero writes.
await check("approving a PARTS import is refused FROZEN as a whole: no Part written, job not claimed", async () => {
  await assert.rejects(executeDataImport.run({ data: { jobId, approved: true }, auth }), isPartImportFrozen);

  for (const n of [1, 2, 3]) {
    const snap = await db.collection("parts").doc(derivePartId(`DI-${run}-${n}`)).get();
    assert.equal(snap.exists, false, `Part DI-${run}-${n} must NOT be written while the catalog is frozen`);
  }
  const job = (await db.collection("data_import_jobs").doc(jobId).get()).data();
  assert.equal(job.status, "STAGED", "a refused job is never claimed");
});

// Ruling A: no governed createPart ran, so no createPart audit exists for this file -- the refusal wrote no audit either.
await check("a frozen PARTS import wrote NO createPart audit event", async () => {
  assert.equal(await createPartAuditsForRun(), 0);
});

// --------------------------------------------------------------- replay

// Ruling A: a retry of the refused PARTS job is refused FROZEN again and still claims nothing. (The "a COMPLETED job cannot
// run twice" proof moves to the EQUIPMENT import below -- ruling B, same executeDataImport path.)
await check("the same PARTS job is refused FROZEN again on retry, and is still not claimed", async () => {
  await assert.rejects(executeDataImport.run({ data: { jobId, approved: true }, auth }), isPartImportFrozen);
  assert.equal((await db.collection("data_import_jobs").doc(jobId).get()).data().status, "STAGED");
  assert.equal(await createPartAuditsForRun(), 0);
});

// The Parts the file names cannot be created by the frozen import, so the pre-existing catalog every later check needs
// (duplicate detection, inventory opening balances) is a FIXTURE written directly to the emulator -- the same stored shape
// the governed createPart wrote (DRAFT, version 1).
for (const n of [1, 2, 3]) {
  const partId = derivePartId(`DI-${run}-${n}`);
  const ts = Timestamp.now();
  await db.collection("parts").doc(partId).set({
    partId, internalPartNumber: `DI-${run}-${n}`, name: `Seeded part ${n}`, status: "DRAFT", stockingUnit: "EACH",
    controlType: "STANDARD", stockingClass: "STOCKED", version: 1, createdAt: ts, createdBy: "seed", updatedAt: ts, updatedBy: "seed",
  });
}

// Ruling B: duplicate detection through the derived id is import domain logic -- proven against the fixture Parts.
await check("re-staging the SAME file now reports every row as already existing", async () => {
  const res = await stageDataImport.run({
    data: { fileName: "seeded-parts.csv", fileText: SEEDED_CSV },
    auth,
  });
  // This is the duplicate guard doing its job through the derived id: nothing was queried,
  // and the second import of a file is refused row by row rather than silently doubling
  // the catalog.
  assert.equal(res.job.summary.ready, 0);
  assert.equal(res.job.summary.errors, 4);
  await assert.rejects(
    executeDataImport.run({ data: { jobId: res.job.jobId, approved: true }, auth }),
    (err) => err.code === "failed-precondition" && err.details?.code === "JOB_EMPTY",
    "a job with nothing importable must refuse rather than succeed at nothing",
  );
});

// --------------------------------------------------------------- xlsx

// Ruling B (the XLSX reader + staging path is import domain logic, unchanged) + Ruling A (executing the staged PARTS job is
// the frozen legacy catalog writer: refused FROZEN, no Part written).
await check("an XLSX workbook takes the SAME staging path, and its PARTS execution is refused FROZEN", async () => {
  // Built here with zlib rather than by a library, for the same reason the reader has no
  // dependency: this is the format contract, and it should be exercised by bytes we control.
  const { deflateRawSync } = await import("node:zlib");

  const crc32 = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const zip = (files) => {
    const locals = []; const central = []; let offset = 0;
    for (const [name, str] of Object.entries(files)) {
      const content = Buffer.from(str, "utf8");
      const def = deflateRawSync(content);
      const nb = Buffer.from(name, "utf8");
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
      lh.writeUInt32LE(crc32(content), 14); lh.writeUInt32LE(def.length, 18);
      lh.writeUInt32LE(content.length, 22); lh.writeUInt16LE(nb.length, 26);
      locals.push(lh, nb, def);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
      cd.writeUInt32LE(crc32(content), 16); cd.writeUInt32LE(def.length, 20);
      cd.writeUInt32LE(content.length, 24); cd.writeUInt16LE(nb.length, 28);
      cd.writeUInt32LE(offset, 42);
      central.push(cd, nb);
      offset += 30 + nb.length + def.length;
    }
    const lp = Buffer.concat(locals); const cp = Buffer.concat(central);
    const eo = Buffer.alloc(22);
    eo.writeUInt32LE(0x06054b50, 0);
    eo.writeUInt16LE(Object.keys(files).length, 8); eo.writeUInt16LE(Object.keys(files).length, 10);
    eo.writeUInt32LE(cp.length, 12); eo.writeUInt32LE(lp.length, 16);
    return Buffer.concat([lp, cp, eo]);
  };

  const cell = (col, row, value) =>
    `<c r="${col}${row}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const rowXml = (r, values) =>
    `<row r="${r}">${values.map((v, i) => cell(String.fromCharCode(65 + i), r, v)).join("")}</row>`;

  const bytes = zip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types/>',
    "xl/workbook.xml": '<workbook><sheets><sheet name="Parts" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml":
      "<worksheet><sheetData>" +
      rowXml(1, ["PART_NO", "NAME", "UOM", "CONTROL_TYPE", "STOCK_CLASS"]) +
      rowXml(2, [`XL-${run}-1`, "Workbook gasket", "EA", "STANDARD", "STOCKED"]) +
      "</sheetData></worksheet>",
  });

  const staged = await stageDataImport.run({
    data: { fileName: "seeded-parts.xlsx", fileBase64: bytes.toString("base64") },
    auth,
  });
  assert.equal(staged.staged, true);
  assert.equal(staged.job.entityType, "PARTS");
  assert.deepEqual(staged.job.summary, { total: 1, ready: 1, warnings: 0, errors: 0 });

  // Indistinguishable from the CSV path, which is the claim: the format changes the first step and nothing else --
  // including the frozen refusal at execution.
  await assert.rejects(executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth }), isPartImportFrozen);
  const snap = await db.collection("parts").doc(derivePartId(`XL-${run}-1`)).get();
  assert.equal(snap.exists, false, "no Part is written while the catalog is frozen");
  assert.equal((await db.collection("data_import_jobs").doc(staged.job.jobId).get()).data().status, "STAGED");
});

await check("a file that is not a readable workbook is refused with its own reason", async () => {
  await assert.rejects(
    stageDataImport.run({
      data: { fileName: "broken.xlsx", fileBase64: Buffer.from("not a zip", "utf8").toString("base64") },
      auth,
    }),
    (err) => err.code === "invalid-argument" && err.details?.code === "UNREADABLE_WORKBOOK",
  );
});

// --------------------------------------------------------------- customers

await check("CRM CUTOVER FREEZE: a customer CSV still stages, but executing it is refused whole -- nothing written, job not claimed", async () => {
  // Since #1926 the legacy Firestore CRM writers are FROZEN for the CRM cutover (crm/crmWriterState.ts): the customer
  // import refuses the job as a whole, before it is claimed and before any row is written. Staging is a preview and
  // still works, so an administrator is told why, instead of a file silently producing nothing.
  const csv = [
    "CUSTOMER_NAME,BILLING_ADDRESS,STATUS,CUSTOMER_NUMBER",
    `Frozen Soda Works ${run},1 Main St,ACTIVE,C-${run}`,
    `Frozen Ice Co ${run},2 Main St,Prospect,C-${run}-2`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "customers.csv", fileText: csv }, auth });
  assert.equal(staged.staged, true);
  assert.equal(staged.job.entityType, "CUSTOMERS", "the header must detect as Customers, not Parts");
  assert.deepEqual(staged.job.summary, { total: 2, ready: 2, warnings: 0, errors: 0 });

  const auditsBefore = (await db.collection("auditEvents").where("action", "==", "createAccountFromImport").get()).size;
  await assert.rejects(
    executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth }),
    (err) => err.code === "failed-precondition" && err.details?.code === "FIRESTORE_CRM_WRITER_FROZEN",
  );
  for (const name of [`Frozen Soda Works ${run}`, `Frozen Ice Co ${run}`]) {
    assert.equal((await db.collection("accounts").doc(deriveImportedAccountId(name)).get()).exists, false, `${name} was written`);
  }
  assert.equal((await db.collection("auditEvents").where("action", "==", "createAccountFromImport").get()).size, auditsBefore);
  const jobs = (await listDataImportJobs.run({ data: {}, auth })).jobs;
  const job = jobs.find((j) => j.jobId === staged.job.jobId);
  assert.ok(job, "the staged job is no longer listed");
  assert.notEqual(job.status, "COMPLETED");
  assert.notEqual(job.status, "RUNNING", "a refused job was claimed");
});

// The entities below reference a customer. The customer import cannot create one while CRM is frozen, so the
// pre-existing Customer they need is a fixture written directly to the emulator -- the same shape the import wrote.
{
  const soda = `Seeded Soda Works ${run}`;
  await db.collection("accounts").doc(deriveImportedAccountId(soda)).set({
    name: soda, nameLower: soda.toLowerCase(), status: "ACTIVE",
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

await check("re-staging the same customers finds them by NAME, not only by derived id", async () => {
  // The customers already in EOS were created through the interface with auto-ids, so the
  // only field both sides share is the name. A derived-id-only check would compare imported
  // customers against imported customers and conclude a hand-created one does not exist.
  const handMade = `Hand Made Co ${run}`;
  await db.collection("accounts").add({ name: handMade, nameLower: handMade.toLowerCase() });

  const csv = [
    "CUSTOMER_NAME,BILLING_ADDRESS",
    `Seeded Soda Works ${run},1 Main St`,
    `${handMade},9 Main St`,
  ].join("\n");
  const res = await stageDataImport.run({ data: { fileName: "customers.csv", fileText: csv }, auth });
  assert.equal(res.job.summary.errors, 2, "both must be recognised as already existing");
  for (const row of res.job.rows) {
    assert.ok(row.findings.some((f) => f.code === "ALREADY_EXISTS"), `row ${row.sourceRowNumber}`);
  }
});

// --------------------------------------------------------------- equipment

await check("equipment imports only where its customer and location BOTH resolve", async () => {
  // The customers imported above exist. Give one of them a location, and leave a second
  // location under a DIFFERENT customer so the scoped key is actually exercised.
  const soda = `Seeded Soda Works ${run}`;
  const sodaId = deriveImportedAccountId(soda);
  await db.collection("locations").add({ accountId: sodaId, name: "Main Plant" });

  const other = await db.collection("accounts").add({ name: `Other Co ${run}`, nameLower: `other co ${run}` });
  await db.collection("locations").add({ accountId: other.id, name: "Shared Name" });

  const csv = [
    "SERIAL,CUSTOMER,SITE,NAME,MAKE,MODEL",
    `EQ-${run}-1,${soda},Main Plant,Ice Machine 1,Manitowoc,IY-0454A`,
    `EQ-${run}-2,${soda},Shared Name,Ice Machine 2,Manitowoc,IY-0454A`,
    `EQ-${run}-3,Nobody Ltd ${run},Main Plant,Ice Machine 3,Manitowoc,IY-0454A`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "equipment.csv", fileText: csv }, auth });
  assert.equal(staged.staged, true);
  assert.equal(staged.job.entityType, "EQUIPMENT");
  // Row 3 names a location that exists under ANOTHER customer; row 4 names a customer that
  // does not exist. Both are refused, and neither creates the thing it could not find.
  assert.deepEqual(staged.job.summary, { total: 3, ready: 1, warnings: 0, errors: 2 });
  assert.ok(staged.job.rows[1].findings.some((f) => f.code === "LOCATION_NOT_FOUND"));
  assert.ok(staged.job.rows[2].findings.some((f) => f.code === "CUSTOMER_NOT_FOUND"));

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "COMPLETED");
  assert.equal(done.job.result.created, 1);

  const snap = await db.collection("equipment").where("serialNumber", "==", `EQ-${run}-1`).get();
  assert.equal(snap.size, 1);
  const eq = snap.docs[0].data();
  assert.equal(eq.accountId, sodaId, "the customer NAME was resolved to an id");
  assert.equal(eq.status, "ACTIVE", "create is always ACTIVE");
  assert.equal(typeof eq.createdAt, "number", "equipment governs its stamps as NUMBER, not Timestamp");
  assert.equal(eq.serialNumberKey, `EQ-${run}-1`.toUpperCase());
  // The two name columns were the FILE's way of naming records; the document holds ids. A
  // stale copy of a customer name on every machine is how two sources of one fact appear.
  assert.equal(eq.customerName, undefined);
  assert.equal(eq.locationName, undefined);

  // Ruling B: "a COMPLETED job cannot be executed twice" is import-lifecycle domain logic -- proven on this (unfrozen)
  // EQUIPMENT job, through the same executeDataImport path the frozen PARTS job used to prove it on.
  await assert.rejects(
    executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth }),
    (err) => err.code === "failed-precondition" && err.details?.code === "JOB_NOT_STAGED",
    "a completed job must not run again",
  );
  assert.equal((await db.collection("equipment").where("serialNumber", "==", `EQ-${run}-1`).get()).size, 1, "and it wrote nothing more");
});

await check("a serial already registered is refused, whoever registered it", async () => {
  const soda = `Seeded Soda Works ${run}`;
  // Registered the way the ORDINARY Equipment screen would: an auto-id, no serialNumberKey.
  // A key-only uniqueness check would happily re-register this machine.
  await db.collection("equipment").add({
    accountId: deriveImportedAccountId(soda),
    serialNumber: `LEGACY-${run}`,
    name: "Added by hand",
    status: "ACTIVE",
  });

  const csv = [
    "SERIAL,CUSTOMER,SITE,NAME",
    `LEGACY-${run},${soda},Main Plant,Re-imported`,
  ].join("\n");
  const res = await stageDataImport.run({ data: { fileName: "equipment.csv", fileText: csv }, auth });
  assert.equal(res.job.summary.errors, 1);
  assert.ok(res.job.rows[0].findings.some((f) => f.code === "ALREADY_EXISTS"));
});

// --------------------------------------------------------------- inventory

// ACTIVATION (window step 18): with the PostgreSQL catalog ACTIVE the Firestore catalog is no longer current truth, so an
// INVENTORY import -- which resolves Part references against it -- is refused WHOLE at execution
// (assertFirestoreCatalogReadCurrent), before the job is claimed and before any movement is written. Staging stays available.
const isInventoryImportCatalogMoved = (e) =>
  e && e.code === "failed-precondition" && e.details && e.details.code === "CATALOG_AUTHORITY_MOVED";
// Ruling B (staging -- still valid) + Ruling A (execution against a moved catalog authority).
await check("an opening balance still STAGES with its findings; executing it is refused whole: CATALOG_AUTHORITY_MOVED", async () => {
  await db.collection("warehouses").add({ name: `Main Warehouse ${run}`, status: "ACTIVE" });
  await db.collection("warehouses").add({ name: `Retired Warehouse ${run}`, status: "INACTIVE" });

  const csv = [
    "PART_NO,WAREHOUSE,ON_HAND",
    `DI-${run}-1,Main Warehouse ${run},12`,
    `DI-${run}-2,Main Warehouse ${run},0`,
    `DI-${run}-3,Retired Warehouse ${run},5`,
    `NOPE-${run},Main Warehouse ${run},7`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "inventory.csv", fileText: csv }, auth });
  assert.equal(staged.job.entityType, "INVENTORY");
  // Row 2 imports. Row 3 is a zero balance -- a warning, not an error. Row 4 names an
  // INACTIVE warehouse and row 5 an unknown part; both are refused before approval.
  assert.deepEqual(staged.job.summary, { total: 4, ready: 1, warnings: 1, errors: 2 });
  assert.ok(staged.job.rows[2].findings.some((f) => f.code === "WAREHOUSE_NOT_FOUND"));
  assert.ok(staged.job.rows[3].findings.some((f) => f.code === "PART_NOT_FOUND"));

  await assert.rejects(executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth }), isInventoryImportCatalogMoved);
  assert.equal((await db.collection("data_import_jobs").doc(staged.job.jobId).get()).data().status, "STAGED", "a refused job is never claimed");
  for (const n of [1, 2, 3]) {
    const moves = await db.collection("inventory_transactions").where("partId", "==", derivePartId(`DI-${run}-${n}`)).get();
    assert.equal(moves.size, 0, `no opening-balance movement for DI-${run}-${n}`);
  }
  // The opening-balance LEDGER rule itself (ADJUSTED/ADJUSTMENT movement, zero writes nothing, second balance refused)
  // stays proven below the import boundary in openingInventoryBalance.test.mjs.
});

// Ruling A: a repeat opening balance cannot be reached through a refused import; the ledger's own refusal of a second
// balance (OPENING_BALANCE_ALREADY_SET) is proven in openingInventoryBalance.test.mjs.
await check("a repeat opening-balance import still stages, and is refused whole at execution: CATALOG_AUTHORITY_MOVED", async () => {
  const csv = [
    "PART_NO,WAREHOUSE,ON_HAND",
    `DI-${run}-1,Main Warehouse ${run},99`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "inventory.csv", fileText: csv }, auth });
  assert.equal(staged.job.summary.ready, 1, "the preview cannot know, and does not pretend to");

  await assert.rejects(executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth }), isInventoryImportCatalogMoved);
  assert.equal((await db.collection("data_import_jobs").doc(staged.job.jobId).get()).data().status, "STAGED");
  // AND THE LEDGER IS UNCHANGED: still no movement for this position.
  const moves = await db.collection("inventory_transactions").where("partId", "==", derivePartId(`DI-${run}-1`)).get();
  assert.equal(moves.size, 0);
});

// --------------------------------------------------------------- service history

await check("service history imports as its OWN record, never as a Work Order", async () => {
  const soda = `Seeded Soda Works ${run}`;
  const csv = [
    "CUSTOMER,SERVICE_DATE,WORK_PERFORMED,TICKET,TECH,SERIAL",
    `${soda},2019-06-14,Replaced evaporator fan motor,OLD-${run}-1,R. Alvarez,EQ-${run}-1`,
    `${soda},2027-01-01,Scheduled maintenance,OLD-${run}-2,R. Alvarez,`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "history.csv", fileText: csv }, auth });
  assert.equal(staged.job.entityType, "SERVICE_HISTORY");
  // The future-dated row is refused. Scheduling work is what Work Orders and dispatch are
  // for, with a lifecycle this record deliberately does not have.
  assert.deepEqual(staged.job.summary, { total: 2, ready: 1, warnings: 0, errors: 1 });
  assert.ok(staged.job.rows[1].findings.some((f) => f.code === "NOT_HISTORICAL"));

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "COMPLETED");
  assert.equal(done.job.result.created, 1);

  const snap = await db.collection("imported_service_history").get();
  const mine = snap.docs.map((d) => d.data()).filter((d) => d.externalReference === `OLD-${run}-1`);
  assert.equal(mine.length, 1);
  const record = mine[0];

  // PROVENANCE IS IN THE RECORD. Anyone reading this row in five years must be able to see
  // that it describes service performed in another system, not work EOS did.
  assert.equal(record.recordKind, "IMPORTED_SERVICE_HISTORY");
  assert.equal(record.sourceSystem, "DATA_IMPORT");
  assert.equal(record.importJobId, staged.job.jobId);

  // The customer is the ONE thing linked. The technician stays a name and the serial stays a
  // string: linking a 2019 job to a current employee would attribute somebody else's work to
  // a real person, and linking a serial would attach a replaced machine's history to its
  // replacement.
  assert.equal(record.accountId, deriveImportedAccountId(soda));
  assert.equal(record.technicianName, "R. Alvarez");
  assert.equal(record.technicianId, undefined);
  assert.equal(record.equipmentSerialNumber, `EQ-${run}-1`);
  assert.equal(record.equipmentId, undefined);

  // AND NOTHING WAS WRITTEN TO THE WORK ORDER COLLECTION. This is the load-bearing
  // assertion of the entity: a fabricated Work Order would be indistinguishable from a real
  // one in every metric that counts them.
  const wos = await db.collection("fieldops_wos").get();
  assert.equal(wos.size, 0, `import must not create Work Orders, saw ${wos.size}`);
});

await check("re-importing the same service records is refused by their source reference", async () => {
  const soda = `Seeded Soda Works ${run}`;
  const csv = [
    "CUSTOMER,SERVICE_DATE,WORK_PERFORMED,TICKET",
    `${soda},2019-06-14,Replaced evaporator fan motor,OLD-${run}-1`,
  ].join("\n");
  const res = await stageDataImport.run({ data: { fileName: "history.csv", fileText: csv }, auth });
  assert.equal(res.job.summary.errors, 1);
  assert.ok(res.job.rows[0].findings.some((f) => f.code === "ALREADY_EXISTS"));
});

// --------------------------------------------------------------- reading it back

await check("imported history is VISIBLE through the normal customer read, and is not a Work Order", async () => {
  const soda = `Seeded Soda Works ${run}`;
  const accountId = deriveImportedAccountId(soda);

  const res = await listImportedServiceHistory.run({ data: { accountId }, auth });
  assert.ok(res.rows.length >= 1, `expected imported history for the account, saw ${res.rows.length}`);

  const row = res.rows.find((r) => r.externalReference === `OLD-${run}-1`);
  assert.ok(row, "the imported record must be reachable by the customer read");

  // It says what it is, in the DATA -- a consumer never has to know.
  assert.equal(row.recordKind, "IMPORTED_SERVICE_HISTORY");
  assert.equal(row.sourceSystem, "DATA_IMPORT");

  // The fields the gate requires be preserved.
  assert.equal(row.serviceDate, "2019-06-14");
  assert.match(row.summary, /evaporator fan motor/);
  assert.equal(row.technicianName, "R. Alvarez");
  assert.equal(row.equipmentSerialNumber, `EQ-${run}-1`);

  // AND NOTHING WAS RESOLVED. The technician is text and the serial is text; neither was
  // joined to a current Employee or a current Equipment record, because the canonical model
  // does not prove either identity.
  assert.equal(row.technicianId, undefined);
  assert.equal(row.equipmentId, undefined);

  // No Work Order field is synthesised onto it, and no Work Order exists.
  for (const wo of ["status", "woNumber", "assignedTechId", "scheduledStart"]) {
    assert.equal(row[wo], undefined, `${wo} must not appear on a historical row`);
  }
  assert.equal((await db.collection("fieldops_wos").get()).size, 0);
});

await check("the read is scoped to ONE customer -- another account sees none of it", async () => {
  const other = await db.collection("accounts").add({ name: `Unrelated Co ${run}`, nameLower: `unrelated co ${run}` });
  const res = await listImportedServiceHistory.run({ data: { accountId: other.id }, auth });
  assert.equal(res.rows.length, 0, "one customer's history must never appear under another");
});

await check("an unauthorized read fails CLOSED, and an unauthenticated one never reaches authorization", async () => {
  const soda = `Seeded Soda Works ${run}`;
  const accountId = deriveImportedAccountId(soda);

  await assert.rejects(
    listImportedServiceHistory.run({ data: { accountId }, auth: stranger }),
    (err) => err.code === "permission-denied",
    "a principal with no role must not read a customer's history",
  );
  await assert.rejects(
    listImportedServiceHistory.run({ data: { accountId }, auth: null }),
    (err) => err.code === "unauthenticated",
  );
  // And a missing account is refused rather than answered with everything.
  await assert.rejects(
    listImportedServiceHistory.run({ data: {}, auth }),
    (err) => err.code === "invalid-argument",
  );
});

// --------------------------------------------------------------- cross-entity acceptance

await check("ACCEPTANCE: all five entities landed, and each is what it claims to be", async () => {
  // The whole point of running this last: the five entities were built one at a time, and
  // this asserts they coexist in one environment without having quietly become each other.
  const counts = {};
  for (const c of ["parts", "accounts", "equipment", "inventory_transactions", "imported_service_history"]) {
    counts[c] = (await db.collection(c).get()).size;
  }

  // Parts are the three FIXTURES seeded above: the PARTS import is refused while the catalog is frozen.
  assert.ok(counts.parts >= 3, `parts: ${counts.parts}`);
  assert.ok(counts.accounts >= 2, `accounts: ${counts.accounts}`);
  assert.ok(counts.equipment >= 1, `equipment: ${counts.equipment}`);
  // Ruling A (activation): the INVENTORY import is refused while the catalog authority has moved, so it wrote no movement.
  assert.equal(counts.inventory_transactions, 0, `movements: ${counts.inventory_transactions}`);
  assert.ok(counts.imported_service_history >= 1, `history: ${counts.imported_service_history}`);

  // NO WORK ORDERS, NO JOBS. Import creates neither, in any entity.
  assert.equal((await db.collection("fieldops_wos").get()).size, 0);
  assert.equal((await db.collection("fieldops_jobs").get()).size, 0);

  // Every entity's write went through a command that audited it. Distinct actions per entity,
  // which is what proves import did not grow a shortcut for any one of them.
  const actions = new Set((await db.collection("auditEvents").get()).docs.map((d) => String(d.data().action)));
  // createAccountFromImport is absent by design while the CRM cutover freeze holds (see the customer check above), and
  // this run's createPart audits are absent by design while the CATALOG freeze holds (see the PARTS checks above).
  for (const action of ["createEquipmentFromImport", "createServiceHistoryFromImport"]) {
    assert.ok(actions.has(action), `no audit event for ${action}`);
  }
  assert.equal(await createPartAuditsForRun(), 0, "no createPart audit for this run's frozen PARTS import");

  // And the history shows every run, with what each one wrote.
  const jobs = (await listDataImportJobs.run({ data: {}, auth })).jobs;
  const entities = new Set(jobs.map((j) => j.entityType));
  for (const e of ["PARTS", "CUSTOMERS", "EQUIPMENT", "INVENTORY", "SERVICE_HISTORY"]) {
    assert.ok(entities.has(e), `no import job recorded for ${e}`);
  }
});

// --------------------------------------------------------------- authorization

await check("a principal with no role is refused at every entry point", async () => {
  for (const [name, call] of [
    ["stage", () => stageDataImport.run({ data: { fileName: "x.csv", fileText: SEEDED_CSV }, auth: stranger })],
    ["execute", () => executeDataImport.run({ data: { jobId, approved: true }, auth: stranger })],
    ["list", () => listDataImportJobs.run({ data: {}, auth: stranger })],
  ]) {
    await assert.rejects(call, (err) => err.code === "permission-denied", `${name} must fail closed`);
  }
});

await check("an unauthenticated request never reaches authorization at all", async () => {
  await assert.rejects(
    stageDataImport.run({ data: { fileName: "x.csv", fileText: SEEDED_CSV }, auth: null }),
    (err) => err.code === "unauthenticated",
  );
});

// --------------------------------------------------------------- history

// Ruling A (the refused PARTS job is listed as still STAGED, having written nothing) + Ruling B (history still lists what an
// unfrozen run wrote -- the EQUIPMENT job).
await check("history lists the runs, with what each one wrote", async () => {
  const res = await listDataImportJobs.run({ data: {}, auth });
  const mine = res.jobs.filter((j) => j.fileName === "seeded-parts.csv" && j.jobId === jobId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "STAGED", "the frozen PARTS job was never claimed");
  assert.equal(mine[0].result ?? null, null, "and it wrote nothing");
  const equipment = res.jobs.find((j) => j.entityType === "EQUIPMENT" && j.status === "COMPLETED");
  assert.ok(equipment, "a completed EQUIPMENT run is listed");
  assert.equal(equipment.result.created, 1);
});

console.log(`\n${passed} passed, 0 failed`);
