#!/usr/bin/env node
// EMULATOR BOOTSTRAP — stand the world up in an isolated Firestore emulator.
//
// Seeds the expected world records and gives each certification employee a deterministic principal,
// so the inventory applier can resolve accountable actors the same way it would against a real
// project. Emulator-only by construction: it refuses to run unless FIRESTORE_EMULATOR_HOST is set,
// so it cannot be pointed at anything real by accident.
//
// The UIDs here are EMULATOR FICTIONS, derived from the employee id. In a real environment the UID
// comes from Auth and is resolved at apply time -- which is exactly why the plan never carries one.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { expectedRecords } = await import(L("functions/scripts/certificationWorld.mjs"));

const WAREHOUSE_RECORD_AUTHOR = "certification-world-builder";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: FIRESTORE_EMULATOR_HOST is not set. This tool only ever targets an emulator.");
  process.exitCode = 1;
} else {
  const projectId = process.argv.includes("--projectId")
    ? process.argv[process.argv.indexOf("--projectId") + 1]
    : "demo-certworld";
  if (!getApps().length) initializeApp({ projectId });
  const db = getFirestore();

  const { world, records } = expectedRecords();
  console.log(`emulator   : ${process.env.FIRESTORE_EMULATOR_HOST} (${projectId})`);
  console.log(`world      : ${world.version}, ${records.length} records`);

  let written = 0;
  for (let i = 0; i < records.length; i += 400) {
    const batch = db.batch();
    for (const r of records.slice(i, i + 400)) {
      const extra = r.collection === "employees"
        // The principal link the applier resolves. Deterministic from the employee id so a rerun
        // produces the same actor mapping.
        ? { userId: `emu-uid-${r.id}` }
        : {};
      batch.set(db.collection(r.collection).doc(r.id), {
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), ...r.data, ...extra,
      }, { merge: true });
    }
    await batch.commit();
    written += Math.min(400, records.length - i);
  }

  // The warehouse the plan stocks must exist, be ACTIVE, and be a GOVERNED warehouse.
  //
  // Availability counts only eligible warehouses, so an inactive one would make every balance read
  // zero for reasons unrelated to the movements. That much the fixture always knew.
  //
  // What it did not know is that ACTIVE is not sufficient. Receiving resolves its destination
  // through validateGovernedWarehouse, which requires the COMPLETE governed envelope -- location,
  // version, updatedAt, updatedBy, provenance, coherent created/governance pairs, no stray fields,
  // and no lingering `active` flag -- and only then checks the status. The fixture wrote four
  // fields, every balance read worked perfectly for 142 movements, and the first real receipt was
  // refused with DESTINATION_INVALID.
  //
  // The ledger never consults this contract; it takes a location reference at its word. Receiving
  // is the first domain that asks whether the destination is a governed place to put goods.
  await db.collection("warehouses").doc("wh-main").set({
    id: "wh-main",
    name: "Main Distribution Center",
    location: "Phoenix, AZ",
    status: "ACTIVE",
    version: 1,
    provenance: "NATIVE",
    createdAt: FieldValue.serverTimestamp(),
    createdBy: WAREHOUSE_RECORD_AUTHOR,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: WAREHOUSE_RECORD_AUTHOR,
  }, { merge: true });

  const employees = await db.collection("employees").count().get();
  const parts = await db.collection("parts").count().get();
  console.log(`seeded     : ${written} records`);
  console.log(`employees  : ${employees.data().count} (all with a principal)`);
  console.log(`parts      : ${parts.data().count}`);
}
