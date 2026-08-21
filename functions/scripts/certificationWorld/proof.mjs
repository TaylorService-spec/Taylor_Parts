// REPEATABILITY PROOF. Run: node scripts/certificationWorld/proof.mjs --projectId <sandbox>
//
// Proves the four claims the policy actually rests on, by doing them rather than reasoning about them:
//
//   1. reset deletes certification records and LEAVES UNRELATED SANDBOX DATA ALONE
//      (a control record is planted first and must survive)
//   2. a second reset is a no-op (0 deletes), so reset is safe to run repeatedly
//   3. reset -> rebuild -> verify reports COMPLETE
//   4. doing that TWICE produces the identical logical world
//
// Claim 4 is the one that needs care. Two rebuilds differ in server timestamps and audit metadata by
// construction, so comparison excludes exactly the fields named in state.mjs VOLATILE_FIELDS -- named
// and explained, never "ignore whatever does not match", which is how a comparison quietly stops
// comparing.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { execFileSync } from "node:child_process";
import { MARKER_FIELD } from "./manifest.mjs";
import { stableShape, VOLATILE_FIELDS } from "./state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "certificationWorld.mjs");
const projectId = process.argv[process.argv.indexOf("--projectId") + 1];
if (!projectId) throw new Error("--projectId is required");

const CONTROL_COLLECTION = "accounts";
const CONTROL_ID = "cw-proof-control-do-not-delete";

function run(args) {
  try {
    return { ok: true, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? "  PASS  " : "  FAIL  ") + name + (detail ? "  -- " + detail : "")); };

console.log("\n=== certification world repeatability proof :: " + projectId + " ===\n");

// A record that is NOT ours: no marker, and a name the legacy pattern must not match.
await db.collection(CONTROL_COLLECTION).doc(CONTROL_ID).set({
  name: "Proof Control Account (unrelated to certification world)",
  status: "ACTIVE", certificationProofControl: true,
});

// --- 1st cycle -------------------------------------------------------------------------------
run(["reset", "--projectId", projectId, "--confirm-reset"]);
const r1 = run(["rebuild", "--projectId", projectId, "--confirm-reset"]);
check("cycle 1 rebuild reports COMPLETE", /certification world: COMPLETE/.test(r1.out), (r1.out.match(/installed records: \d+/) || [""])[0]);

async function snapshotWorld() {
  const rows = [];
  for (const c of ["accounts", "locations", "contacts", "equipment_models", "mobile_locations"]) {
    const snap = await db.collection(c).get();
    snap.forEach((d) => {
      const data = d.data();
      if (!data || !data[MARKER_FIELD]) return;
      rows.push(c + "/" + d.id + ":" + JSON.stringify(stableShape(data)));
    });
  }
  return rows.sort();
}
const world1 = await snapshotWorld();

// --- 2nd cycle -------------------------------------------------------------------------------
run(["reset", "--projectId", projectId, "--confirm-reset"]);
const r2 = run(["rebuild", "--projectId", projectId, "--confirm-reset"]);
check("cycle 2 rebuild reports COMPLETE", /certification world: COMPLETE/.test(r2.out), (r2.out.match(/installed records: \d+/) || [""])[0]);
const world2 = await snapshotWorld();

check("both rebuilds produced the same record count", world1.length === world2.length, world1.length + " vs " + world2.length);
let firstDiff = null;
for (let i = 0; i < Math.max(world1.length, world2.length); i += 1) {
  if (world1[i] !== world2[i]) { firstDiff = (world1[i] || "(absent)").slice(0, 90) + " != " + (world2[i] || "(absent)").slice(0, 90); break; }
}
check("both rebuilds are byte-identical after excluding named volatile fields", firstDiff === null, firstDiff || "excluded: " + VOLATILE_FIELDS.map((v) => v.field).join(", "));

// --- reset behaviour -------------------------------------------------------------------------
const reset1 = run(["reset", "--projectId", projectId, "--confirm-reset"]);
const deleted1 = Number((reset1.out.match(/reset deleted (\d+)/) || [0, 0])[1]);
check("reset deletes the certification world", deleted1 > 0, deleted1 + " records");

const reset2 = run(["reset", "--projectId", projectId, "--confirm-reset"]);
const deleted2 = Number((reset2.out.match(/reset deleted (\d+)/) || [0, 0])[1]);
check("second reset is a no-op", deleted2 === 0, deleted2 + " records deleted");

const afterReset = run(["verify", "--projectId", projectId]);
check("world is ABSENT after reset", /certification world: ABSENT/.test(afterReset.out));

const control = await db.collection(CONTROL_COLLECTION).doc(CONTROL_ID).get();
check("UNRELATED control record survived reset", control.exists, control.exists ? "still present" : "DESTROYED - reset is not bounded");

await db.collection(CONTROL_COLLECTION).doc(CONTROL_ID).delete();

const failed = results.filter((r) => !r.pass);
console.log("\n" + (results.length - failed.length) + "/" + results.length + " proof checks passed");
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
