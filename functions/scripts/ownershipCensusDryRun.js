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
const { ALL_FAMILIES, CENSUS_FAMILIES, censusFamily, censusGate } = require("../lib/ownership/ownershipCensus.js");

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
      rows.push({ family: family.family, collection: family.collection, ownerClass: family.ownerClass, ownerType: family.ownerType ?? "", error: err.message });
    }
  }

  if (args.json === "true") {
    console.log(JSON.stringify({ projectId: args.projectId, limit: limit || null, families: rows }, null, 2));
    return;
  }

  const gate = censusGate(rows);
  const col = (s, w) => String(s).padStart(w);

  console.log(`Ownership census — ${args.projectId}${limit ? ` (limit ${limit}/family)` : ""}\n`);
  console.log(
    `Scope: OWNABLE families only (ruling D-8). ${CENSUS_FAMILIES.length} of ${ALL_FAMILIES.length} ` +
      "declared families are ownable; REFERENCE and EXCLUDED families are classified out of the " +
      "invariant, not counted as a backlog.\n",
  );
  const header =
    "collection".padEnd(30) +
    "class".padEnd(9) +
    "type".padEnd(9) +
    col("scan", 7) +
    col("RESOLVED", 9) +
    col("OWNERLESS", 10) +
    col("INVALID", 8) +
    col("UNKNOWN", 8) +
    col("AMBIG", 7) +
    "  flags";
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of rows) {
    if (r.error) {
      console.log(`${r.collection.padEnd(30)}${r.ownerClass.padEnd(9)}${r.ownerType.padEnd(9)}  UNREADABLE: ${r.error}`);
      continue;
    }
    console.log(
      r.collection.padEnd(30) +
        r.ownerClass.padEnd(9) +
        r.ownerType.padEnd(9) +
        col(r.scanned, 7) +
        col(r.counts.resolved, 9) +
        col(r.counts.ownerless, 10) +
        col(r.counts.invalid, 8) +
        col(r.counts.unknown, 8) +
        col(r.counts.ambiguous, 7) +
        (r.truncated ? "  TRUNCATED" : ""),
    );
  }

  console.log("-".repeat(header.length));
  const scanned = rows.reduce((n, r) => n + (r.error ? 0 : r.scanned), 0);
  console.log(
    "TOTAL".padEnd(48) +
      col(scanned, 7) +
      col(gate.totals.resolved, 9) +
      col(gate.totals.ownerless, 10) +
      col(gate.totals.invalid, 8) +
      col(gate.totals.unknown, 8) +
      col(gate.totals.ambiguous, 7),
  );

  if (gate.unreadable.length > 0) {
    console.log(`\nUNREADABLE families (${gate.unreadable.length}): ${gate.unreadable.join(", ")}`);
  }
  if (gate.truncated.length > 0) {
    console.log(`TRUNCATED families (${gate.truncated.length}): ${gate.truncated.join(", ")}`);
  }

  // Reason CLASSIFICATION, not a document dump -- the ruling asks for the reason, "not necessarily
  // every document ID if volume is large".
  console.log("\nReason classification (non-RESOLVED):");
  let anyReasons = false;
  for (const r of rows) {
    if (r.error) continue;
    const entries = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) continue;
    anyReasons = true;
    console.log(`  ${r.collection}`);
    for (const [reason, n] of entries) console.log(`    ${String(n).padStart(7)}  ${reason}`);
  }
  if (!anyReasons) console.log("  (none)");

  // The classification itself, so the report says what was EXCLUDED from the count and why -- a
  // gate that silently narrowed its own scope would be the same defect as one that silently
  // truncated its scan.
  const byClass = {};
  for (const f of ALL_FAMILIES) byClass[f.ownerClass] = (byClass[f.ownerClass] ?? 0) + 1;
  console.log("\nFamily classification (ruling D-8):");
  for (const [k, n] of Object.entries(byClass).sort()) console.log(`  ${k.padEnd(11)} ${n} families`);
  const neutral = ALL_FAMILIES.filter((f) => f.ownerClass === "REFERENCE").map((f) => f.collection);
  console.log(`  REFERENCE (company-neutral, not counted): ${neutral.join(", ")}`);

  console.log(
    gate.assessable
      ? "\nGATE: zero non-resolved records, every family read in full. Enforcement is assessable."
      : `\nGATE: ${gate.blocking} record(s) not resolved` +
          (gate.unreadable.length > 0 ? `, ${gate.unreadable.length} family/families unreadable` : "") +
          (gate.truncated.length > 0 ? `, ${gate.truncated.length} truncated` : "") +
          ". Enforcement stays off.",
  );
  console.log("This census is READ-ONLY and authorizes nothing. Backfill remains a separate Owner gate.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
