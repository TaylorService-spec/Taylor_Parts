/**
 * EOS Ownership Model v1 — READ-ONLY BACKFILL SIMULATION (Owner ruling, next inert pass item 8).
 *
 * "Re-run READ-ONLY ownership/backfill simulation using the now-authored sandbox facts. Produce
 * exact proposed write counts. DO NOT YET RUN ANY OWNERSHIP BACKFILL."
 *
 * So this is the backfill with the writes removed. It resolves exactly what an applier would
 * resolve, from exactly the sources an applier would use, and then prints the number instead of
 * committing it. There is no --apply flag, and adding one is a separate authorized change.
 *
 * STRICTLY READ-ONLY. No batch, no set, no update, no transaction. Verify with:
 *   grep -nE "\.(set|update|delete|add|batch|runTransaction)\(" scripts/ownershipBackfillSimulation.js
 *
 * WHAT IT SIMULATES, and the source each one uses:
 *
 *   contacts / locations   -> parent Account's accountOwner.assignedToEmployeeId (PERSON)
 *   stock_locations        -> its warehouse's authored company
 *   trucks                 -> its home warehouse's authored company
 *   cycle_counts           -> the counted location's authored company
 *   receiving_orders       -> the receiving location's authored company
 *   inventory_transactions -> its location's authored company (single) or a participating pair
 *   transfer_orders        -> origin + destination authored companies, as a PARTICIPATING PAIR
 *   equipment              -> the fixture fleet's authored operatingCompanyId (marker-scoped)
 *
 * The physical-root companies come from config/ownership/operating-company-roots.sandbox.json --
 * the Owner's authored assignments, never inferred from a name or an id.
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

const ROOT_CONFIG = path.resolve(__dirname, "../../config/ownership/operating-company-roots.sandbox.json");
const MARKER_FIELD = "certificationWorld";

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

/** id -> company, from the AUTHORED config. Every value is validated against the governed authority. */
function loadRootCompanies() {
  const cfg = JSON.parse(fs.readFileSync(ROOT_CONFIG, "utf8"));
  const map = new Map();
  for (const group of Object.values(cfg.roots)) {
    for (const row of group) {
      if (row.operatingCompanyId === null || row.operatingCompanyId === undefined) continue;
      const { state } = resolveOperatingCompany(row.operatingCompanyId);
      // A config naming an ungoverned company is a config error, not something to work around.
      if (state !== "RESOLVED") throw new Error(`root ${row.id} names an ungoverned company: ${row.operatingCompanyId}`);
      map.set(row.id, row.operatingCompanyId);
    }
  }
  return map;
}

const at = (doc, p) => p.split(".").reduce((cur, seg) => (cur && typeof cur === "object" ? cur[seg] : undefined), doc);
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

/** Tally helper. Every record lands in WOULD_WRITE, ALREADY_SET, or one of the blocked reasons. */
function newTally(collection, field) {
  return { collection, field, scanned: 0, wouldWrite: 0, alreadySet: 0, blocked: 0, reasons: {} };
}
function block(t, reason) {
  t.blocked += 1;
  t.reasons[reason] = (t.reasons[reason] ?? 0) + 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") throw new Error("--projectId is required.");
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  const rootCompany = loadRootCompanies();
  console.log(`Backfill SIMULATION — ${args.projectId}   (READ-ONLY, nothing is written)\n`);
  console.log(`Authored physical roots: ${rootCompany.size}`);

  const tallies = [];

  // ---------------------------------------------------------------- PERSON: contacts + locations
  const accountOwner = new Map();
  const accounts = await db.collection("accounts").get();
  for (const doc of accounts.docs) {
    const id = at(doc.data(), "accountOwner.assignedToEmployeeId");
    if (nonEmpty(id)) accountOwner.set(doc.id, id);
  }
  console.log(`Accounts with a resolvable owner: ${accountOwner.size} of ${accounts.size}\n`);

  for (const collection of ["contacts", "locations"]) {
    const t = newTally(collection, "owner (USER)");
    const snap = await db.collection(collection).get();
    for (const doc of snap.docs) {
      t.scanned += 1;
      const accountId = doc.data().accountId;
      if (!nonEmpty(accountId)) { block(t, "no accountId"); continue; }
      if (!accountOwner.has(accountId)) { block(t, "parent Account has no owner"); continue; }
      t.wouldWrite += 1;
    }
    tallies.push(t);
  }

  // ---------------------------------------------------------------- COMPANY: single-root derivations
  const singleRoot = [
    { collection: "stock_locations", paths: ["warehouseId"] },
    { collection: "trucks", paths: ["homeWarehouseId"] },
    { collection: "cycle_counts", paths: ["location.locationId"] },
    { collection: "receiving_orders", paths: ["receivingLocation.locationId"] },
  ];
  for (const rule of singleRoot) {
    const t = newTally(rule.collection, "operatingCompanyId");
    const snap = await db.collection(rule.collection).get();
    for (const doc of snap.docs) {
      t.scanned += 1;
      const data = doc.data();
      if (nonEmpty(data.operatingCompanyId)) { t.alreadySet += 1; continue; }
      const ref = rule.paths.map((p) => at(data, p)).find(nonEmpty);
      if (!ref) { block(t, "no location reference"); continue; }
      if (!rootCompany.has(ref)) { block(t, `root not authored: ${ref}`); continue; }
      t.wouldWrite += 1;
    }
    tallies.push(t);
  }

  // ---------------------------------------------------------------- inventory_transactions: split
  {
    const t = newTally("inventory_transactions", "operatingCompanyId / participating pair");
    let pair = 0;
    const snap = await db.collection("inventory_transactions").get();
    for (const doc of snap.docs) {
      t.scanned += 1;
      const data = doc.data();
      if (nonEmpty(data.operatingCompanyId)) { t.alreadySet += 1; continue; }
      const a = at(data, "location.locationId");
      const b = at(data, "counterpartyLocation.locationId");
      const refs = [a, b].filter(nonEmpty).filter((r) => rootCompany.has(r));
      if (refs.length === 0) { block(t, "no resolvable location reference"); continue; }
      const companies = [...new Set(refs.map((r) => rootCompany.get(r)))];
      if (companies.length > 1) { pair += 1; t.wouldWrite += 1; continue; }
      t.wouldWrite += 1;
    }
    t.reasons[`(of which ${pair} would carry a CROSS-COMPANY participating pair)`] = pair;
    tallies.push(t);
  }

  // ---------------------------------------------------------------- transfer_orders: pairs
  {
    const t = newTally("transfer_orders", "source+destinationOperatingCompanyId");
    let cross = 0;
    let same = 0;
    const snap = await db.collection("transfer_orders").get();
    for (const doc of snap.docs) {
      t.scanned += 1;
      const data = doc.data();
      if (nonEmpty(data.sourceOperatingCompanyId) && nonEmpty(data.destinationOperatingCompanyId)) {
        t.alreadySet += 1;
        continue;
      }
      const from = at(data, "origin.locationId") ?? data.fromWarehouseId;
      const to = at(data, "destination.locationId") ?? data.toWarehouseId;
      if (!nonEmpty(from) || !nonEmpty(to)) { block(t, "missing origin or destination"); continue; }
      if (!rootCompany.has(from) || !rootCompany.has(to)) { block(t, "origin or destination root not authored"); continue; }
      // BOTH participants required (ruling R-10). One of two is not a partial success.
      if (rootCompany.get(from) === rootCompany.get(to)) same += 1;
      else cross += 1;
      t.wouldWrite += 1;
    }
    t.reasons[`(same-company: ${same})`] = same;
    t.reasons[`(CROSS-company: ${cross})`] = cross;
    tallies.push(t);
  }

  // ---------------------------------------------------------------- equipment: fixture fleets
  {
    const { fleetOperatingCompany } = await import("./certificationWorld/data/equipmentAssets.mjs");
    const t = newTally("equipment", "operatingCompanyId (fixture fleet)");
    const snap = await db.collection("equipment").get();
    for (const doc of snap.docs) {
      t.scanned += 1;
      const data = doc.data();
      if (nonEmpty(data.operatingCompanyId)) { t.alreadySet += 1; continue; }
      // MARKER-SCOPED. A non-fixture record is never touched -- ruling R-2.
      if (data[MARKER_FIELD] === undefined && data.dataProvenance !== "SYNTHETIC_CERTIFICATION_FACT") {
        block(t, "non-fixture record -- left untouched by rule");
        continue;
      }
      const m = /^cw-eq-(\d+)-\d+$/.exec(doc.id);
      if (!m) { block(t, "fixture id does not carry a fleet index"); continue; }
      const company = fleetOperatingCompany(Number.parseInt(m[1], 10));
      if (company === null) { block(t, "fleet has no authored company"); continue; }
      t.wouldWrite += 1;
    }
    tallies.push(t);
  }

  // ---------------------------------------------------------------- report
  const header = "collection".padEnd(26) + "scanned".padStart(9) + "WOULD WRITE".padStart(13) + "already".padStart(9) + "blocked".padStart(9);
  console.log(header);
  console.log("-".repeat(header.length));
  let totalWrite = 0;
  let totalBlocked = 0;
  let totalScanned = 0;
  for (const t of tallies) {
    totalWrite += t.wouldWrite;
    totalBlocked += t.blocked;
    totalScanned += t.scanned;
    console.log(
      t.collection.padEnd(26) +
        String(t.scanned).padStart(9) +
        String(t.wouldWrite).padStart(13) +
        String(t.alreadySet).padStart(9) +
        String(t.blocked).padStart(9),
    );
  }
  console.log("-".repeat(header.length));
  console.log("TOTAL".padEnd(26) + String(totalScanned).padStart(9) + String(totalWrite).padStart(13) + "".padStart(9) + String(totalBlocked).padStart(9));

  console.log("\nDetail:");
  for (const t of tallies) {
    const entries = Object.entries(t.reasons).filter(([, n]) => n > 0);
    if (entries.length === 0) continue;
    console.log(`  ${t.collection}`);
    for (const [reason, n] of entries.sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${reason}`);
  }

  console.log(`\nPROPOSED SANDBOX WRITE COUNT: ${totalWrite} document(s). ${totalBlocked} blocked.`);
  console.log("NOTHING WAS WRITTEN. This tool has no apply mode.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
