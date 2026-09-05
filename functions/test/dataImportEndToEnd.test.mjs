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
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "eos-platform-sandbox" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const { stageDataImportCallable: stageDataImport, executeDataImportCallable: executeDataImport, listDataImportJobsCallable: listDataImportJobs } = await import(
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

await check("approving writes the governed Parts, and the errored row is NOT written", async () => {
  const res = await executeDataImport.run({ data: { jobId, approved: true }, auth });

  assert.equal(res.job.status, "COMPLETED");
  assert.equal(res.job.approvedBy, auth.uid);
  assert.equal(res.job.result.created, 3);
  assert.equal(res.job.result.failed, 0);

  for (const n of [1, 2, 3]) {
    const snap = await db.collection("parts").doc(derivePartId(`DI-${run}-${n}`)).get();
    assert.equal(snap.exists, true, `Part DI-${run}-${n} must exist after approval`);
    // Written by partMaster's createPart, in ITS stored shape -- which is what makes the
    // record visible to the normal Parts experience rather than to import alone.
    assert.equal(snap.data().internalPartNumber, `DI-${run}-${n}`);
    assert.equal(snap.data().status, "DRAFT");
    assert.equal(snap.data().version, 1);
  }
});

await check("the governed command wrote its own audit event -- import did not bypass it", async () => {
  const events = await db.collection("auditEvents").where("action", "==", "createPart").get();
  const mine = events.docs.filter((d) => String(d.data().targetId ?? "").includes(`DI-${run}-`));
  assert.ok(mine.length >= 3, `expected an audit event per created Part, saw ${mine.length}`);
});

// --------------------------------------------------------------- replay

await check("the same job cannot be executed twice", async () => {
  await assert.rejects(
    executeDataImport.run({ data: { jobId, approved: true }, auth }),
    (err) => err.code === "failed-precondition",
    "a completed job must not run again",
  );
});

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
    (err) => err.code === "failed-precondition",
    "a job with nothing importable must refuse rather than succeed at nothing",
  );
});

// --------------------------------------------------------------- xlsx

await check("an XLSX workbook takes the SAME path and produces the same governed Part", async () => {
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

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "COMPLETED");

  // Indistinguishable from the CSV path once written, which is the claim: the format
  // changes the first step and nothing else.
  const snap = await db.collection("parts").doc(derivePartId(`XL-${run}-1`)).get();
  assert.equal(snap.exists, true);
  assert.equal(snap.data().internalPartNumber, `XL-${run}-1`);
  assert.equal(snap.data().status, "DRAFT");
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

await check("a customer CSV becomes a governed Customer, searchable by the derived key", async () => {
  const csv = [
    "CUSTOMER_NAME,BILLING_ADDRESS,STATUS,CUSTOMER_NUMBER",
    `Seeded Soda Works ${run},1 Main St,ACTIVE,C-${run}`,
    `Seeded Ice Co ${run},2 Main St,Prospect,C-${run}-2`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "customers.csv", fileText: csv }, auth });
  assert.equal(staged.staged, true);
  assert.equal(staged.job.entityType, "CUSTOMERS", "the header must detect as Customers, not Parts");
  assert.deepEqual(staged.job.summary, { total: 2, ready: 2, warnings: 0, errors: 0 });

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "COMPLETED");
  assert.equal(done.job.result.created, 2);

  const id = deriveImportedAccountId(`Seeded Soda Works ${run}`);
  const snap = await db.collection("accounts").doc(id).get();
  assert.equal(snap.exists, true);
  const data = snap.data();
  assert.equal(data.name, `Seeded Soda Works ${run}`);
  assert.equal(data.status, "ACTIVE");

  // THE DERIVED SEARCH KEY. Without it the customer is permanently unfindable by the
  // customer search box, and the symptom never points at the import that caused it.
  assert.equal(data.nameLower, `Seeded Soda Works ${run}`.toLowerCase());

  // THE GOVERNED CREATE BASELINE the accounts Rules enforce for every other writer. The
  // Admin SDK bypasses Rules, so this is the only thing standing behind that guarantee here.
  assert.equal(data.paymentTerms, undefined);
  assert.equal(data.taxStatus, undefined);

  // Timestamp-typed, not epoch millis: a number sorts BELOW every Timestamp under
  // `updatedAt DESC`, so an imported customer would land at the bottom of the list it was
  // imported into and be unreachable from it.
  assert.equal(typeof data.updatedAt?.toDate, "function");
});

await check("the customer command wrote its own audit event", async () => {
  const events = await db.collection("auditEvents").where("action", "==", "createAccountFromImport").get();
  assert.ok(events.docs.length >= 2, `expected an audit event per created Customer, saw ${events.docs.length}`);
});

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

await check("an opening balance becomes a LEDGER MOVEMENT, not a stored quantity", async () => {
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

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "COMPLETED");
  // One movement written, one deliberate no-op: a zero balance moves nothing, and a movement
  // that moves nothing is not written at all.
  assert.equal(done.job.result.created, 1);
  assert.equal(done.job.result.replayed, 1);

  const moves = await db.collection("inventory_transactions").where("partId", "==", derivePartId(`DI-${run}-1`)).get();
  assert.equal(moves.size, 1);
  const move = moves.docs[0].data();
  // The EXISTING primitives, not a new movement type: ADJUSTED / SIGNED / ADJUSTMENT. An
  // opening balance invents no vocabulary and writes to no second balance table.
  assert.equal(move.type, "ADJUSTED");
  assert.equal(move.quantity, 12);
  assert.equal(move.sourceObject.type, "ADJUSTMENT");
  assert.match(String(move.sourceObject.id), /IMPORT_OPENING_BALANCE/);

  // The zero-balance row wrote NOTHING. Not a movement of zero -- nothing.
  const none = await db.collection("inventory_transactions").where("partId", "==", derivePartId(`DI-${run}-2`)).get();
  assert.equal(none.size, 0);
});

await check("a SECOND opening balance at the same position is refused at execution, and says why", async () => {
  // This is the deliberate gap, proven rather than described: the preview cannot know, so it
  // shows READY, and the ledger refuses inside its own transaction. The operator learns the
  // reason from the result rather than from a preview that guessed.
  const csv = [
    "PART_NO,WAREHOUSE,ON_HAND",
    `DI-${run}-1,Main Warehouse ${run},99`,
  ].join("\n");

  const staged = await stageDataImport.run({ data: { fileName: "inventory.csv", fileText: csv }, auth });
  assert.equal(staged.job.summary.ready, 1, "the preview cannot know, and does not pretend to");

  const done = await executeDataImport.run({ data: { jobId: staged.job.jobId, approved: true }, auth });
  assert.equal(done.job.status, "FAILED");
  assert.equal(done.job.result.rows[0].failureCode, "OPENING_BALANCE_ALREADY_SET");
  assert.match(done.job.result.rows[0].failureMessage, /opening-balance rules|already/i);

  // AND THE BALANCE IS UNCHANGED. A refused opening balance must leave the ledger exactly
  // as it was -- one movement of 12, not a second one and not an overwritten first.
  const moves = await db.collection("inventory_transactions").where("partId", "==", derivePartId(`DI-${run}-1`)).get();
  assert.equal(moves.size, 1);
  assert.equal(moves.docs[0].data().quantity, 12);
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

// --------------------------------------------------------------- cross-entity acceptance

await check("ACCEPTANCE: all five entities landed, and each is what it claims to be", async () => {
  // The whole point of running this last: the five entities were built one at a time, and
  // this asserts they coexist in one environment without having quietly become each other.
  const counts = {};
  for (const c of ["parts", "accounts", "equipment", "inventory_transactions", "imported_service_history"]) {
    counts[c] = (await db.collection(c).get()).size;
  }

  assert.ok(counts.parts >= 4, `parts: ${counts.parts}`);
  assert.ok(counts.accounts >= 2, `accounts: ${counts.accounts}`);
  assert.ok(counts.equipment >= 1, `equipment: ${counts.equipment}`);
  assert.ok(counts.inventory_transactions >= 1, `movements: ${counts.inventory_transactions}`);
  assert.ok(counts.imported_service_history >= 1, `history: ${counts.imported_service_history}`);

  // NO WORK ORDERS, NO JOBS. Import creates neither, in any entity.
  assert.equal((await db.collection("fieldops_wos").get()).size, 0);
  assert.equal((await db.collection("fieldops_jobs").get()).size, 0);

  // Every entity's write went through a command that audited it. Four distinct actions,
  // which is what proves import did not grow a shortcut for any one of them.
  const actions = new Set((await db.collection("auditEvents").get()).docs.map((d) => String(d.data().action)));
  for (const action of ["createPart", "createAccountFromImport", "createEquipmentFromImport", "createServiceHistoryFromImport"]) {
    assert.ok(actions.has(action), `no audit event for ${action}`);
  }

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

await check("history lists the runs, newest first, with what each one wrote", async () => {
  const res = await listDataImportJobs.run({ data: {}, auth });
  const mine = res.jobs.filter((j) => j.fileName === "seeded-parts.csv" && j.jobId === jobId);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "COMPLETED");
  assert.equal(mine[0].result.created, 3);
});

console.log(`\n${passed} passed, 0 failed`);
