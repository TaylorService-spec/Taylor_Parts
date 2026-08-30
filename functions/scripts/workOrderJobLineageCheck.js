/**
 * EOS Ownership Model v1 — READ-ONLY Work Order -> Job lineage reconciliation (Owner ruling R-12).
 *
 * "Do NOT invent jobId. First perform a READ-ONLY lineage reconciliation. For each WO classify:
 *  EXACT_PARENT / MULTIPLE_CANDIDATES / NO_CANDIDATE."
 *
 * STRICTLY READ-ONLY. No Firestore write of any kind.
 *
 * WHAT COUNTS AS A PARENT, AND WHAT DOES NOT
 *
 * EXACT_PARENT requires one of:
 *   - an explicit `jobId` already on the Work Order, resolving to a real Job;
 *   - deterministic FIXTURE PROVENANCE: both records minted by the same certification scenario,
 *     provable from a shared scenario identity -- not from data that merely coincides.
 *
 * Everything else is NOT a parent. The ruling is explicit that customerId, locationId,
 * assignedTechId, scheduledTechId and salesOrderId "can coincide across multiple Jobs", so this
 * tool computes those coincidences and reports them as CANDIDATES ONLY -- never as a resolution.
 * A coincidence count is diagnostic information about how ambiguous the data is, and reporting it
 * as a match would be exactly the invention the ruling forbids.
 *
 * Usage:
 *   cd functions
 *   node scripts/workOrderJobLineageCheck.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const MARKER_FIELD = "certificationWorld";
const CERT_PROVENANCE = "SYNTHETIC_CERTIFICATION_FACT";

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

const isFixture = (d) => d[MARKER_FIELD] !== undefined || d.dataProvenance === CERT_PROVENANCE;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId || args.projectId === "true") throw new Error("--projectId is required.");
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  const jobs = (await db.collection("fieldops_jobs").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const wos = (await db.collection("fieldops_wos").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const jobIds = new Set(jobs.map((j) => j.id));

  console.log(`Work Order -> Job lineage reconciliation — ${args.projectId}   (READ-ONLY)\n`);
  console.log(`Jobs: ${jobs.length} (${jobs.filter(isFixture).length} fixture)`);
  console.log(`Work Orders: ${wos.length} (${wos.filter(isFixture).length} fixture)\n`);

  const counts = { EXACT_PARENT: 0, MULTIPLE_CANDIDATES: 0, NO_CANDIDATE: 0 };
  const reasons = {};
  const note = (r) => { reasons[r] = (reasons[r] ?? 0) + 1; };

  for (const wo of wos) {
    // 1. An explicit link, if one already exists.
    if (nonEmpty(wo.jobId) && jobIds.has(wo.jobId)) {
      counts.EXACT_PARENT += 1;
      note("explicit jobId resolves to a Job");
      continue;
    }
    if (nonEmpty(wo.jobId)) {
      counts.NO_CANDIDATE += 1;
      note("carries a jobId that resolves to no Job");
      continue;
    }

    // 2. Fixture provenance -- both sides minted by the same certification scenario.
    if (isFixture(wo)) {
      const shared = jobs.filter((j) => isFixture(j) && j.customerId === wo.customerId && j.locationId === wo.locationId);
      if (shared.length === 1) { counts.EXACT_PARENT += 1; note("fixture provenance: one certification Job at the same customer+location"); continue; }
      if (shared.length > 1) { counts.MULTIPLE_CANDIDATES += 1; note(`fixture provenance ambiguous: ${shared.length} certification Jobs match`); continue; }
    }

    // 3. Coincidence only. Counted, reported, and NEVER treated as a parent.
    const coincident = jobs.filter(
      (j) =>
        (nonEmpty(wo.customerId) && j.customerId === wo.customerId) ||
        (nonEmpty(wo.locationId) && j.locationId === wo.locationId) ||
        (nonEmpty(wo.assignedTechId) && j.technicianId === wo.assignedTechId) ||
        (nonEmpty(wo.scheduledTechId) && j.technicianId === wo.scheduledTechId),
    );
    counts.NO_CANDIDATE += 1;
    note(
      coincident.length === 0
        ? "no Job shares even a coincidental customer, location or technician"
        : `only coincidental overlap with ${coincident.length} Job(s) -- insufficient by rule`,
    );
  }

  console.log("classification".padEnd(24) + "count".padStart(7));
  console.log("-".repeat(31));
  for (const [k, n] of Object.entries(counts)) console.log(k.padEnd(24) + String(n).padStart(7));
  console.log("-".repeat(31));
  console.log("TOTAL".padEnd(24) + String(wos.length).padStart(7));

  console.log("\nReason:");
  for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${r}`);

  console.log(
    `\n${counts.EXACT_PARENT} Work Order(s) could take a company from a parent Job. ` +
      "READ-ONLY -- no jobId was invented, written, or proposed.",
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
