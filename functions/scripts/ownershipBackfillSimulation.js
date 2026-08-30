/**
 * EOS Ownership Model v1 — READ-ONLY BACKFILL SIMULATION.
 *
 * The backfill with the writes removed. It resolves exactly what the applier resolves, from exactly
 * the same module, and prints the number instead of committing it.
 *
 * ============================ ONE RULE SET, NOT TWO ============================
 *
 * Both this tool and scripts/ownershipSandboxBackfill.js evaluate candidates through
 * lib/ownership/ownershipBackfillRules.js. That is deliberate and it is load-bearing: the Owner
 * authorized a write count on the strength of this simulation, and if the two computed candidates
 * from separate copies of the rules they would merely agree today.
 *
 * This file previously DID carry its own copy, and it drifted within hours -- after the sandbox
 * backfill it still reported 519 pending writes for records that had already been written, because
 * its inline contacts/locations rule never learned to check whether `owner` was already set. The
 * applier was right and the simulation was stale. Rewriting it against the shared module is what
 * makes "what was approved" and "what gets written" the same computation rather than two that
 * happen to match.
 *
 * STRICTLY READ-ONLY. No Firestore write, and no --apply mode. Adding one is a separate authorized
 * change, and functions/test/ownershipProductionGuard.test.mjs asserts it has not happened quietly.
 *
 * Usage:
 *   cd functions
 *   node scripts/ownershipBackfillSimulation.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

const { resolveOperatingCompany } = require("../lib/ownership/operatingCompanyAuthority.js");
const {
  BACKFILL_RULES,
  AUTHORIZED_WRITE_CAPS,
  AUTHORIZED_TOTAL,
} = require("../lib/ownership/ownershipBackfillRules.js");

const ROOT_CONFIG = path.resolve(__dirname, "../../config/ownership/operating-company-roots.sandbox.json");

// Families the backfill does NOT touch, reported so the full picture is visible rather than only
// the part that moves. Every one of these is deliberately excluded by a ruling.
const OUT_OF_SCOPE = [
  ["fieldops_wos", "no governed Job parent (R-12)"],
  ["opportunities", "non-fixture commercial, no company provenance (R-14)"],
  ["sales_agreements", "non-fixture commercial (R-14)"],
  ["sales_orders", "non-fixture commercial (R-14)"],
  ["invoices", "non-fixture commercial (R-14)"],
  ["reorder_requests", "no governed warehouseId (R-13)"],
  ["reorder_purchase_orders", "blocked upstream by the reorder request (R-13)"],
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

function loadRootCompanies() {
  const cfg = JSON.parse(fs.readFileSync(ROOT_CONFIG, "utf8"));
  const map = new Map();
  for (const group of Object.values(cfg.roots)) {
    for (const row of group) {
      if (!row.operatingCompanyId) continue;
      if (resolveOperatingCompany(row.operatingCompanyId).state !== "RESOLVED") {
        throw new Error(`root ${row.id} names an ungoverned company: ${row.operatingCompanyId}`);
      }
      map.set(row.id, row.operatingCompanyId);
    }
  }
  return map;
}

async function buildContext(db) {
  const accountOwnerByAccountId = new Map();
  for (const doc of (await db.collection("accounts").get()).docs) {
    const id = doc.data()?.accountOwner?.assignedToEmployeeId;
    if (typeof id === "string" && id.trim().length > 0) accountOwnerByAccountId.set(doc.id, id.trim());
  }
  const { fleetOperatingCompany } = await import("./certificationWorld/data/equipmentAssets.mjs");
  const { serviceJobOperatingCompany } = await import("./certificationWorld/data/serviceJobCompany.mjs");
  return {
    accountOwnerByAccountId,
    rootCompanyById: loadRootCompanies(),
    equipmentFleetCompany: (id) => {
      const m = /^cw-eq-(\d+)-\d+$/.exec(id);
      return m ? fleetOperatingCompany(Number.parseInt(m[1], 10)) : null;
    },
    serviceJobCompany: (id) => serviceJobOperatingCompany(id),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") throw new Error("--projectId is required.");
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const ctx = await buildContext(db);

  console.log(`Backfill SIMULATION — ${args.projectId}   (READ-ONLY, nothing is written)\n`);
  console.log(`Authored physical roots: ${ctx.rootCompanyById.size} | accounts with an owner: ${ctx.accountOwnerByAccountId.size}\n`);

  const rows = [];
  for (const rule of BACKFILL_RULES) {
    const snap = await db.collection(rule.collection).get();
    const row = { collection: rule.collection, scanned: snap.size, wouldWrite: 0, alreadySet: 0, protectedBy: {}, notes: {} };
    for (const doc of snap.docs) {
      const outcome = rule.evaluate({ id: doc.id, data: doc.data() }, ctx);
      if (outcome.kind === "ALREADY_SET") { row.alreadySet += 1; continue; }
      if (outcome.kind === "PROTECTED") { row.protectedBy[outcome.reason] = (row.protectedBy[outcome.reason] ?? 0) + 1; continue; }
      row.wouldWrite += 1;
      if (outcome.note) row.notes[outcome.note] = (row.notes[outcome.note] ?? 0) + 1;
    }
    rows.push(row);
  }

  const header = "collection".padEnd(26) + "scanned".padStart(8) + "WOULD WRITE".padStart(13) + "already".padStart(9) + "protected".padStart(11) + "cap".padStart(6);
  console.log(header);
  console.log("-".repeat(header.length));
  let write = 0;
  let already = 0;
  let prot = 0;
  let scanned = 0;
  for (const r of rows) {
    const p = Object.values(r.protectedBy).reduce((a, b) => a + b, 0);
    write += r.wouldWrite; already += r.alreadySet; prot += p; scanned += r.scanned;
    console.log(
      r.collection.padEnd(26) + String(r.scanned).padStart(8) + String(r.wouldWrite).padStart(13) +
      String(r.alreadySet).padStart(9) + String(p).padStart(11) + String(AUTHORIZED_WRITE_CAPS[r.collection] ?? 0).padStart(6),
    );
  }
  console.log("-".repeat(header.length));
  console.log("IN SCOPE".padEnd(26) + String(scanned).padStart(8) + String(write).padStart(13) + String(already).padStart(9) + String(prot).padStart(11) + String(AUTHORIZED_TOTAL).padStart(6));

  let outScanned = 0;
  console.log("\nOut of scope by ruling (never written):");
  for (const [collection, why] of OUT_OF_SCOPE) {
    const n = (await db.collection(collection).get()).size;
    outScanned += n;
    console.log(`  ${String(n).padStart(5)}  ${collection.padEnd(26)} ${why}`);
  }
  console.log(`  ${String(outScanned).padStart(5)}  total out of scope`);

  console.log("\nProtected within scope, by reason:");
  let any = false;
  for (const r of rows) {
    for (const [reason, n] of Object.entries(r.protectedBy).sort((a, b) => b[1] - a[1])) {
      any = true;
      console.log(`  ${String(n).padStart(5)}  ${r.collection}: ${reason}`);
    }
  }
  if (!any) console.log("  (none)");

  const noted = rows.filter((r) => Object.keys(r.notes).length > 0);
  if (noted.length > 0) {
    console.log("\nShape detail:");
    for (const r of noted) for (const [note, n] of Object.entries(r.notes)) console.log(`  ${String(n).padStart(5)}  ${r.collection}: ${note}`);
  }

  console.log(`\nPROPOSED SANDBOX WRITE COUNT: ${write} document(s). ${already} already set, ${prot + outScanned} protected/out of scope.`);
  console.log("NOTHING WAS WRITTEN. This tool has no apply mode.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
