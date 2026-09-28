/**
 * RETIRE THE SBX-SCN-001 REORDER-DOMAIN FIXTURES — sandbox only, DRY RUN by default.
 *
 * The synthetic Reorder records (`ro-sbx-*`) are repository-authored scenario fixtures, not legacy
 * business records. They must not be ingested by the governed migration -- which correctly refuses
 * them -- and they must not sit in the frozen source pretending to be business data. This tool
 * retires exactly them, and refuses to do anything else.
 *
 * ════════════════════ IT REFUSES BY DEFAULT, IN EVERY DIRECTION ════════════════════
 *
 *   - DRY RUN unless --apply is passed. Reading is the default; deleting is the exception.
 *   - --environment sandbox and --projectId eos-platform-sandbox, both explicit. Nothing inferred
 *     from .firebaserc, from ADC, or from an environment variable.
 *   - taylor-parts is named and refused by name, so the refusal is a tested fact rather than a
 *     consequence of an allow-list someone might widen.
 *   - ONE diverged or unmarked occupant of a declared id stops the WHOLE run. A per-document
 *     decision would delete the seven it was sure about and leave a person reasoning about the
 *     eighth in a half-changed sandbox.
 *   - It reads the WHOLE population of the three Reorder collections, never a pre-filtered set --
 *     the filter is what would hide the unexpected occupant it exists to notice.
 *
 * ════════════════════ WHAT IT WILL NOT TOUCH ════════════════════
 *
 * Only `reorder_requests`, `reorder_purchase_orders` and `reorder_purchase_order_voids`, and within
 * those only the ids this repository DECLARES. The scenario also owns Work Orders, customers,
 * equipment, warehouses and inventory records; those share the scenario and are NOT this tool's
 * business. Sharing a scenario is not a reason to delete something.
 *
 * Usage:
 *   cd functions
 *   node scripts/retireReorderScenarioFixtures.js --environment sandbox --projectId eos-platform-sandbox
 *   node scripts/retireReorderScenarioFixtures.js --environment sandbox --projectId eos-platform-sandbox --apply
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { assertSandboxTarget } = require("./sandboxTargetGuard.js");
const {
  SCENARIO_ID, SANDBOX_PROJECT_ID, PRODUCTION_PROJECT_ID,
  REORDER_FIXTURE_COLLECTIONS, buildRetirementManifest,
} = require("../lib/sandboxFixtures/reorderScenarioFixtures.js");

const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

function parseArgs(argv) {
  const out = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--environment") out.environment = argv[++i];
    else if (a === "--projectId" || a === "--project") out.projectId = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else throw new Error(`unrecognised argument ${a}; this tool accepts --environment, --projectId, --apply, --out`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.projectId) throw new Error("--projectId is required; nothing is inferred");

  // PRODUCTION, BY NAME. The registry guard below would refuse it too, but naming it here means the
  // refusal survives any future change to what the registry declares.
  if (args.projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(`${PRODUCTION_PROJECT_ID} is PRODUCTION. This tool deletes records and never runs there.`);
  }
  if (args.projectId !== SANDBOX_PROJECT_ID) {
    throw new Error(`only ${SANDBOX_PROJECT_ID} may be retired; refusing '${args.projectId}'`);
  }
  assertSandboxTarget({ environment: args.environment, projectId: args.projectId });

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();

  // THE WHOLE POPULATION of each Reorder collection, unfiltered.
  const documents = [];
  for (const collection of REORDER_FIXTURE_COLLECTIONS) {
    const snap = await db.collection(collection).get();
    for (const d of snap.docs) documents.push({ collection, id: d.id, data: d.data() ?? {} });
  }

  const manifest = buildRetirementManifest({ projectId: args.projectId, documents, sha256Hex });

  // THE DURABLE PRE-DELETE MANIFEST. Written BEFORE any delete, in both modes, so the record of what
  // was there exists whether or not the run proceeds -- and so a dry run leaves the same evidence an
  // apply does. It carries no credential and no actor identity: a fixture's uid fields are resolved
  // from whichever personas the environment holds and are not part of what makes it a fixture.
  const outPath = path.resolve(args.out ?? path.join(__dirname, "..", "..", "sb-evidence",
    `reorder-fixture-retirement-${SCENARIO_ID}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({
    scenarioId: manifest.scenarioId,
    projectId: manifest.projectId,
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "APPLY" : "DRY_RUN",
    declaredCount: manifest.declaredCount,
    counts: manifest.counts,
    candidates: manifest.candidates.map((c) => ({
      collection: c.collection, id: c.id, scenarioId: c.scenarioId,
      classification: c.classification, fingerprint: c.fingerprint,
      expectedFingerprint: c.expectedFingerprint, relatedRefs: c.relatedRefs,
      divergences: c.divergences,
    })),
    absent: manifest.absent,
    refusals: manifest.refusals,
    retirableCount: manifest.retirable.length,
    safeToApply: manifest.safeToApply,
  }, null, 2)}\n`);

  console.log(`Scenario ${SCENARIO_ID}, project ${args.projectId}`);
  console.log(`Declared Reorder-domain fixtures: ${manifest.declaredCount}`);
  console.log(`Counts: ${JSON.stringify(manifest.counts)}`);
  for (const c of manifest.candidates) {
    console.log(`  ${c.collection}/${c.id}  ${c.classification}  fp=${c.fingerprint}${c.divergences.length ? `  (${c.divergences.join("; ")})` : ""}`);
  }
  for (const a of manifest.absent) console.log(`  ${a.collection}/${a.id}  ABSENT (already gone, or never seeded here)`);
  console.log(`Manifest written: ${outPath}`);

  if (manifest.refusals.length > 0) {
    console.error("\nREFUSED:");
    for (const r of manifest.refusals) console.error(`  - ${r}`);
    process.exitCode = 1;
    return;
  }
  if (!args.apply) {
    console.log(`\nDRY RUN. ${manifest.retirable.length} document(s) would be deleted. Re-run with --apply to delete them.`);
    return;
  }
  if (!manifest.safeToApply) {
    console.error("\nREFUSED: nothing is confirmed retirable.");
    process.exitCode = 1;
    return;
  }

  let deleted = 0;
  for (const c of manifest.retirable) {
    await db.collection(c.collection).doc(c.id).delete();
    deleted += 1;
    console.log(`  deleted ${c.collection}/${c.id}`);
  }
  console.log(`\nAPPLIED. ${deleted} synthetic Reorder-domain fixture document(s) retired.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
