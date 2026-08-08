/**
 * Sandbox scenario SBX-SCN-002 — COORDINATED MULTI-EQUIPMENT INSTALL.
 *
 * A customer buys five identical units. That produces ONE coordinated customer
 * visit and FIVE equipment-accountable Work Orders — the platform deliberately
 * created no Job / Visit / WorkOrderGroup authority, so coordination has to be
 * an OPERATING EXPERIENCE over the existing model, not a new domain object.
 *
 * This seeds the operating reality personas need in order to discover whether
 * the current application makes that mission understandable:
 *
 *   1 customer, 1 site, 1 install day
 *   5 serialized units, each with its own governed Work Order
 *   4 complete, 1 BLOCKED on a part
 *
 * PARTIAL COMPLETION IS THE POINT. Four done and one blocked must remain a
 * visible, incomplete obligation. If any surface flattens this to "complete",
 * that is the finding.
 *
 * WHAT THIS DOES NOT SEED, on purpose: no Sales Order, no allocation, no
 * billing-eligibility record. Those capabilities are repo-only today
 * (EXPORT != DEPLOY, capabilities active:false, no client consumer, nothing
 * deployed to this project), so seeding them would fabricate a user experience
 * that does not exist. The five Work Orders ARE exposed and readable, and they
 * are the layer a technician and dispatcher actually work.
 *
 * SAFETY — same triple guard as the other seed tooling: refuses taylor-parts by
 * name, refuses any production-role environment, refuses unknown projects,
 * requires --projectId. Deterministic ids, idempotent, fully synthetic.
 *
 * Usage:
 *   cd functions
 *   node scripts/seedSandboxCoordinatedInstall.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

const SCENARIO_ID = "SBX-SCN-002";
const SCENARIO_VERSION = "1.0.0";
const WOS = "fieldops_wos";
const YEAR = 2026;

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

function assertNonProductionTarget(projectId) {
  if (!projectId || projectId === "true") throw new Error("--projectId is required. There is no default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  return env;
}

// Five identical units at one site. Unit 3 is the blocked one.
const UNITS = [
  { n: 1, serial: "C713-SBX-0001", status: "COMPLETED" },
  { n: 2, serial: "C713-SBX-0002", status: "COMPLETED" },
  { n: 3, serial: "C713-SBX-0003", status: "WORK_IN_PROGRESS", blocked: true },
  { n: 4, serial: "C713-SBX-0004", status: "COMPLETED" },
  { n: 5, serial: "C713-SBX-0005", status: "COMPLETED" },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let env;
  try {
    env = assertNonProductionTarget(args.projectId);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Seeding ${SCENARIO_ID} v${SCENARIO_VERSION} into '${env.id}' (${args.projectId})`);

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const now = Timestamp.now();
  const by = "sandbox-coordinated-install-seed";
  const set = async (col, id, data) => db.collection(col).doc(id).set(data, { merge: true });

  // Equipment records, one per unit, all at the same customer site.
  for (const u of UNITS) {
    await set("equipment", `eq-c713-${u.n}`, {
      equipmentId: `eq-c713-${u.n}`,
      accountId: "acct-harbor",
      locationId: "loc-harbor-downtown",
      name: `Ice Machine C713 — Unit ${u.n}`,
      manufacturer: "Arctic",
      modelNumber: "C713",
      serialNumber: u.serial,
      status: "ACTIVE",
      scenarioId: SCENARIO_ID,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
  }

  // Five equipment-accountable Work Orders sharing ONE customer, ONE site and
  // ONE install day. Same shape createWorkOrder writes; execution timestamps
  // set only for states actually reached.
  for (const u of UNITS) {
    const complete = u.status === "COMPLETED";
    await set(WOS, `wo-c713-${u.n}`, {
      woNumber: `WO-${YEAR}-C713${String(u.n).padStart(2, "0")}`,
      status: u.status,
      priority: 2,
      type: "INSTALL",
      customerId: "acct-harbor",
      locationId: "loc-harbor-downtown",
      equipmentId: `eq-c713-${u.n}`,
      assignedTechId: "tech-sbx-01",
      complaint: `Install ice machine C713 — unit ${u.n} of 5 (serial ${u.serial}).`,
      ...(u.blocked
        ? {
            // The blocked unit: a planned part was never available, so this
            // obligation is still open while its four siblings are done.
            diagnosis: "Water inlet valve missing from the delivered kit; unit cannot be commissioned.",
            inventorySnapshot: [
              { partId: "PRT-1002", sku: "PRT-1002", name: "Water Inlet Valve", qtyPlanned: 1, qtyUsed: 0 },
            ],
          }
        : {
            resolution: `Unit ${u.n} installed, commissioned and demonstrated to the customer.`,
            inventorySnapshot: [
              { partId: "PRT-1002", sku: "PRT-1002", name: "Water Inlet Valve", qtyPlanned: 1, qtyUsed: 1 },
            ],
          }),
      scenarioId: SCENARIO_ID,
      // The product's real coordination link (C7 demand lineage): a set of Work
      // Orders sharing one salesOrderId IS the coordinated group. No invented key.
      salesOrderId: "so-harbor-c713",
      dispatchedAt: now, acceptedAt: now, enRouteAt: now, arrivedAt: now, workStartedAt: now,
      ...(complete ? { completedAt: now } : {}),
      createdAt: now, updatedAt: now,
    });
  }

  console.log(`Seeded: 5 equipment + 5 Work Orders (4 COMPLETED, 1 WORK_IN_PROGRESS/blocked)`);
  console.log("One customer (acct-harbor), one site (loc-harbor-downtown), one coordinated install.");
  console.log("NOT seeded, deliberately: Sales Order, allocation, billing eligibility --");
  console.log("those capabilities are repo-only (EXPORT != DEPLOY, no client consumer).");
}

main().catch((err) => {
  console.error("Seed failed:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
