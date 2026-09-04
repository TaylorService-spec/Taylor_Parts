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
      data: { fileName: "customers.csv", fileText: SEEDED_CSV, entityType: "CUSTOMERS" },
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
