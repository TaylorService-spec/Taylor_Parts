/**
 * EOS Ownership Model v1 — the DRY-RUN OWNERSHIP CENSUS (Owner authorization, next-pass items 11
 * and 12: "Run dry-run ownership census" / "Report unresolved/ambiguous records by family").
 *
 * STRICTLY READ-ONLY. It opens no batch, stages no write, and mutates nothing. Its entire output
 * is counts and a bounded sample of offending document ids, per family:
 *
 *     resolved    exactly one governed owner was derived
 *     unresolved  an ownership-bearing field is present but does not resolve
 *     ambiguous   two ownership-bearing fields resolve to DIFFERENT owners
 *     ownerless   no ownership-bearing field is present at all
 *
 * It is the input to the enforcement gate, not a step toward it: "Do not enable enforcement until
 * zero unresolved existing records remain." A census that wrote anything would be deciding the
 * thing it exists to measure.
 *
 * IT USES THE SAME DERIVATIONS THE RUNTIME USES. Every classification comes from
 * lib/ownership/typedOwner.js, over the families declared in lib/ownership/ownershipMatrix.js --
 * so a census total can never disagree with what the application would derive for the same
 * document, and a family cannot be silently omitted from the count.
 *
 * NO SILENT CAPS. `--limit` bounds the documents read per family for a fast look, and when it
 * truncates a family the report says so explicitly rather than presenting a partial count as
 * complete. The default is no limit.
 *
 * SAFETY: read-only, so production is not refused outright the way a seeding script refuses it --
 * but the target is still required, named, and echoed, and reading production data is its own
 * Owner-authorized action. There is no default project.
 *
 * Usage:
 *   cd functions
 *   node scripts/ownershipCensusDryRun.js --projectId eos-platform-sandbox
 *   node scripts/ownershipCensusDryRun.js --projectId eos-platform-sandbox --limit 500 --json
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// The classification and gate logic live in lib/ownership/ownershipCensus.js, under typecheck and
// under test (test/ownershipCensus.test.mjs). This file is only I/O and formatting -- the numbers
// that decide whether enforcement may be enabled are not computed in an untested script.
const { CENSUS_FAMILIES, censusFamily, censusGate } = require("../lib/ownership/ownershipCensus.js");

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

/** Read one family's documents. The ONLY Firestore access in this tool, and it is a read. */
async function readFamily(db, family, limit) {
  let query = db.collection(family.collection);
  if (limit > 0) query = query.limit(limit);
  const snap = await query.get();
  const documents = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  // A family whose page came back exactly full may have more behind it. Reported, never assumed
  // complete.
  return censusFamily(family, documents, limit > 0 && snap.size === limit);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  const limit = args.limit && args.limit !== "true" ? Number.parseInt(args.limit, 10) : 0;
  if (Number.isNaN(limit) || limit < 0) throw new Error("--limit must be a non-negative integer");

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  const rows = [];
  for (const family of CENSUS_FAMILIES) {
    try {
      rows.push(await readFamily(db, family, limit));
    } catch (err) {
      // A collection that does not exist yet reads as empty, not as an error -- but a permission
      // or index failure is real and must NOT be counted as "zero unresolved". It is recorded as a
      // failed family so the gate cannot be passed on a family nobody could actually read.
      rows.push({ family: family.family, collection: family.collection, ownerType: family.ownerType, error: err.message });
    }
  }

  if (args.json === "true") {
    console.log(JSON.stringify({ projectId: args.projectId, limit: limit || null, families: rows }, null, 2));
    return;
  }

  const totals = { resolved: 0, unresolved: 0, ambiguous: 0, ownerless: 0 };
  console.log(`Ownership census — ${args.projectId}${limit ? ` (limit ${limit}/family)` : ""}\n`);
  console.log("family".padEnd(24) + "type".padEnd(9) + "resolved".padStart(9) + "unresolv".padStart(9) + "ambig".padStart(8) + "ownerless".padStart(11));
  console.log("-".repeat(70));
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.family.padEnd(24)}${r.ownerType.padEnd(9)}  READ FAILED: ${r.error}`);
      continue;
    }
    for (const k of Object.keys(totals)) totals[k] += r.counts[k];
    console.log(
      r.family.padEnd(24) +
        r.ownerType.padEnd(9) +
        String(r.counts.resolved).padStart(9) +
        String(r.counts.unresolved).padStart(9) +
        String(r.counts.ambiguous).padStart(8) +
        String(r.counts.ownerless).padStart(11) +
        (r.truncated ? "   [TRUNCATED by --limit]" : ""),
    );
  }
  console.log("-".repeat(70));
  console.log(
    "TOTAL".padEnd(33) +
      String(totals.resolved).padStart(9) +
      String(totals.unresolved).padStart(9) +
      String(totals.ambiguous).padStart(8) +
      String(totals.ownerless).padStart(11),
  );

  const gate = censusGate(rows);
  if (gate.unreadable.length > 0) {
    console.log(`\n${gate.unreadable.length} family/families could not be read: ${gate.unreadable.join(", ")}.`);
  }

  console.log("\nOffending samples (up to 10 per bucket):");
  for (const r of rows) {
    if (r.error) continue;
    for (const bucket of ["ambiguous", "unresolved", "ownerless"]) {
      if (r.samples[bucket].length > 0) {
        console.log(`  ${r.family} / ${bucket}: ${r.samples[bucket].join(", ")}`);
      }
    }
  }

  console.log(
    gate.assessable
      ? "\nGATE: zero unresolved records and every family was read. Enforcement is assessable."
      : `\nGATE: ${gate.blocking} record(s) not resolved` +
          (gate.unreadable.length > 0 ? ` and ${gate.unreadable.length} family/families unreadable` : "") +
          ". Enforcement stays off.",
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
