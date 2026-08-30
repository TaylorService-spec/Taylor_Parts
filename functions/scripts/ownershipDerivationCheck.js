/**
 * EOS Ownership Model v1 — READ-ONLY referential derivation check (Owner ruling, physical roots).
 *
 * "Once those roots are defined, run a READ-ONLY referential derivation check before any descendant
 * backfill. Do not assume the full 138 are derivable until that check passes."
 *
 * STRICTLY READ-ONLY. No batch, no write, no mutation. It answers one question per descendant
 * record: does it actually reference a physical root, and how many?
 *
 * It does NOT need the roots' company assignments to be decided. Referential resolvability is
 * answerable today and is the part in doubt; which company each root belongs to is the Owner's 14
 * decisions, and a record referencing two DISTINCT roots is reported as POTENTIALLY_CROSS_COMPANY
 * rather than resolved either way.
 *
 * The known-root set is read from the live collections (warehouses + mobile_locations), so a
 * reference to a warehouse that does not exist is caught as INVALID_REFERENCE rather than assumed
 * good.
 *
 * Usage:
 *   cd functions
 *   node scripts/ownershipDerivationCheck.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { DERIVATION_RULES, tallyDerivation } = require("../lib/ownership/ownershipDerivation.js");

// The collections that ARE physical places. `stock_locations` is deliberately absent: it turned out
// to be a per-warehouse-per-part BALANCE record, not a place, so it derives rather than roots.
const ROOT_COLLECTIONS = ["warehouses", "mobile_locations"];

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  const knownRoots = new Set();
  const rootDetail = [];
  for (const collection of ROOT_COLLECTIONS) {
    const snap = await db.collection(collection).get();
    snap.docs.forEach((d) => knownRoots.add(d.id));
    rootDetail.push(`${collection}: ${snap.size}`);
  }

  console.log(`Referential derivation check — ${args.projectId}\n`);
  console.log(`Known physical roots (${knownRoots.size}): ${rootDetail.join(", ")}`);
  console.log("Company assignments are NOT required for this check and are NOT read.\n");

  const header =
    "collection".padEnd(26) +
    "scan".padStart(6) +
    "DERIVABLE".padStart(11) +
    "MISSING".padStart(9) +
    "INVALID".padStart(9) +
    "X-COMPANY".padStart(11) +
    "CONFLICT".padStart(10);
  console.log(header);
  console.log("-".repeat(header.length));

  const totals = { DERIVABLE: 0, MISSING_REFERENCE: 0, INVALID_REFERENCE: 0, POTENTIALLY_CROSS_COMPANY: 0, CONFLICT: 0 };
  const tallies = [];
  let scannedTotal = 0;

  for (const rule of DERIVATION_RULES) {
    const snap = await db.collection(rule.collection).get();
    const documents = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const tally = tallyDerivation(rule, documents, knownRoots);
    tallies.push(tally);
    scannedTotal += tally.scanned;
    for (const k of Object.keys(totals)) totals[k] += tally.counts[k];
    console.log(
      rule.collection.padEnd(26) +
        String(tally.scanned).padStart(6) +
        String(tally.counts.DERIVABLE).padStart(11) +
        String(tally.counts.MISSING_REFERENCE).padStart(9) +
        String(tally.counts.INVALID_REFERENCE).padStart(9) +
        String(tally.counts.POTENTIALLY_CROSS_COMPANY).padStart(11) +
        String(tally.counts.CONFLICT).padStart(10),
    );
  }

  console.log("-".repeat(header.length));
  console.log(
    "TOTAL".padEnd(26) +
      String(scannedTotal).padStart(6) +
      String(totals.DERIVABLE).padStart(11) +
      String(totals.MISSING_REFERENCE).padStart(9) +
      String(totals.INVALID_REFERENCE).padStart(9) +
      String(totals.POTENTIALLY_CROSS_COMPANY).padStart(11) +
      String(totals.CONFLICT).padStart(10),
  );

  console.log("\nReason classification (non-DERIVABLE):");
  for (const t of tallies) {
    const entries = Object.entries(t.reasons).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) continue;
    console.log(`  ${t.collection}`);
    for (const [reason, n] of entries.slice(0, 6)) console.log(`    ${String(n).padStart(6)}  ${reason}`);
    if (entries.length > 6) console.log(`    ... and ${entries.length - 6} further distinct reason(s)`);
  }

  console.log(
    `\nOnly ${totals.DERIVABLE} record(s) can take a company from a physical root. ` +
      "This check is READ-ONLY and authorizes no backfill.",
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
