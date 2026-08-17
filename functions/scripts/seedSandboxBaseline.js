/**
 * Sandbox baseline reference pack — deterministic, idempotent, sandbox-guarded.
 *
 * Turns the authenticated-but-empty sandbox into a coherent synthetic operating
 * company: the reference objects the first end-to-end business chain needs, in a
 * believable relationship graph rather than orphaned rows.
 *
 * SAFETY — this is PRIVILEGED SEED TOOLING, deliberately separate from
 * simulated-user execution (persona agents never get Admin SDK):
 *   - refuses to run against any project whose registry role is `production`;
 *   - refuses `taylor-parts` explicitly, belt and braces;
 *   - --projectId is required, no default;
 *   - deterministic ids, so re-running converges instead of duplicating;
 *   - contains no real customer or employee information.
 *
 * Every record is fully synthetic. Emails use the reserved `.invalid` TLD
 * (RFC 2606) so they can never reach or collide with a real person.
 *
 * Usage:
 *   cd functions
 *   node scripts/seedSandboxBaseline.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

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

/**
 * Refuse any production target. The registry is the authority (ADR-011), so this
 * cannot drift from the environment model — and an unknown project fails closed
 * rather than being treated as safe.
 */
function assertNonProductionTarget(projectId) {
  if (!projectId || projectId === "true") {
    throw new Error("--projectId is required. There is no default target.");
  }
  if (projectId === "taylor-parts") {
    throw new Error("REFUSING: taylor-parts is the customer production project.");
  }
  const registryPath = path.resolve(__dirname, "../../config/environments.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) {
    throw new Error(
      `REFUSING: '${projectId}' is not a known provisioned environment in config/environments.json. ` +
        "Unknown projects fail closed.",
    );
  }
  if (env.role === "production") {
    throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  }
  return env;
}

// ---------------------------------------------------------------- the graph
//
// One coherent operating company. Ids are deterministic and human-readable so a
// reviewer can follow the relationships, and re-seeding converges.

const WAREHOUSES = [
  { id: "wh-main", name: "Main Distribution Center", location: "Phoenix, AZ", status: "ACTIVE" },
  { id: "wh-north", name: "North Service Depot", location: "Flagstaff, AZ", status: "ACTIVE" },
  { id: "wh-retired", name: "Legacy Overflow Store", location: "Tucson, AZ", status: "INACTIVE" },
];

const SUPPLIERS = [
  { id: "sup-arcticparts", name: "Arctic Parts Supply", status: "ACTIVE", contactEmail: "orders@arcticparts.invalid" },
  { id: "sup-coldchain", name: "ColdChain Components", status: "ACTIVE", contactEmail: "sales@coldchain.invalid" },
];

// Realistic refrigeration/ice-machine service parts — the business Taylor Parts
// actually operates in — rather than generic filler.
//
// CONFORMANCE (2026-08-17). These fixtures previously carried only a legacy
// `partTrackingMode: "QUANTITY"` and no governed Part Master fields, so
// partFromFirestore() threw MalformedStoredRecordError for every one of them. Any
// governed command that resolves a Part — transfer, cycle count, receiving —
// therefore failed with an opaque INTERNAL error. The authoritative fixture now
// carries the governed schema: `controlType`, `stockingClass` and `stockingUnit`
// (validated unit CODE — "EACH", not the display abbreviation "EA").
//
// controlType is STANDARD for every quantity-tracked part. That is what these
// fixtures have always MEANT; serialized/lot semantics are NOT invented here just
// to make a test pass. PRT-2001 below is the one deliberate exception, added as a
// purpose-built SERIALIZED fixture so the serial path has conformant data to
// exercise — its serialized asset state is created by the governed Receiving
// command, never seeded directly.
const PARTS = [
  { id: "PRT-1001", name: "Evaporator Fan Motor", category: "Refrigeration", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-arcticparts" },
  { id: "PRT-1002", name: "Water Inlet Valve", category: "Water System", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-arcticparts" },
  { id: "PRT-1003", name: "Condenser Coil Assembly", category: "Refrigeration", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-coldchain" },
  { id: "PRT-1004", name: "Ice Thickness Probe", category: "Controls", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-coldchain" },
  { id: "PRT-1005", name: "Water Filter Cartridge", category: "Water System", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-arcticparts" },
  { id: "PRT-1006", name: "Compressor Start Relay", category: "Electrical", unit: "EA", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", supplierId: "sup-coldchain" },
  // Purpose-built SERIALIZED fixture. A compressor unit is genuinely serial-tracked in this
  // business, so this is a real modelling choice rather than a test-shaped one.
  { id: "PRT-2001", name: "Ice Machine Compressor Unit", category: "Refrigeration", unit: "EA", stockingUnit: "EACH", controlType: "SERIALIZED", stockingClass: "STOCKED", supplierId: "sup-coldchain" },
];

const ACCOUNTS = [
  { id: "acct-harbor", name: "Harbor Grill Restaurant Group", lineOfBusiness: "TAYLOR", status: "ACTIVE" },
  { id: "acct-summit", name: "Summit Convenience Stores", lineOfBusiness: "TAYLOR", status: "ACTIVE" },
];

const LOCATIONS = [
  { id: "loc-harbor-downtown", accountId: "acct-harbor", name: "Harbor Grill — Downtown", city: "Phoenix", state: "AZ" },
  { id: "loc-harbor-airport", accountId: "acct-harbor", name: "Harbor Grill — Airport", city: "Phoenix", state: "AZ" },
  { id: "loc-summit-flag", accountId: "acct-summit", name: "Summit #14 — Flagstaff", city: "Flagstaff", state: "AZ" },
];

const CONTACTS = [
  { id: "con-harbor-gm", accountId: "acct-harbor", name: "Dana Reyes", title: "General Manager", email: "dana.reyes@harborgrill.invalid" },
  { id: "con-summit-ops", accountId: "acct-summit", name: "Alex Chen", title: "Operations Lead", email: "alex.chen@summitstores.invalid" },
];

const EQUIPMENT = [
  { id: "eq-ice-001", accountId: "acct-harbor", locationId: "loc-harbor-downtown", name: "Ice Machine — Bar", manufacturer: "Arctic", modelNumber: "AM-450", serialNumber: "SBX-AM450-0001", status: "ACTIVE" },
  { id: "eq-ice-002", accountId: "acct-harbor", locationId: "loc-harbor-airport", name: "Ice Machine — Prep", manufacturer: "Arctic", modelNumber: "AM-450", serialNumber: "SBX-AM450-0002", status: "ACTIVE" },
  { id: "eq-cool-001", accountId: "acct-summit", locationId: "loc-summit-flag", name: "Walk-in Cooler", manufacturer: "ColdChain", modelNumber: "WC-200", serialNumber: "SBX-WC200-0001", status: "ACTIVE" },
];

async function upsert(db, collection, id, data) {
  await db.collection(collection).doc(id).set(data, { merge: true });
}

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
  console.log(`Seeding baseline into '${env.id}' (${args.projectId}, role=${env.role})`);

  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const now = Timestamp.now();
  const by = "sandbox-baseline-seed";
  const counts = {};
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  for (const w of WAREHOUSES) {
    // Governed warehouse shape: status is the Receiving location-eligibility
    // authority (I-LA C2), so it is set explicitly, never left to inference.
    await upsert(db, "warehouses", w.id, {
      id: w.id, name: w.name, location: w.location, status: w.status,
      version: 1, provenance: "SEEDED", createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
      governanceInitializedAt: now, governanceInitializedBy: by,
    });
    bump("warehouses");
  }

  for (const s of SUPPLIERS) {
    await upsert(db, "suppliers", s.id, {
      supplierId: s.id, name: s.name, status: s.status, contactEmail: s.contactEmail,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("suppliers");
  }

  for (const p of PARTS) {
    await upsert(db, "parts", p.id, {
      partId: p.id, sku: p.id, name: p.name, category: p.category,
      // Governed Part Master fields — what partFromFirestore()/validatePart() actually read.
      internalPartNumber: p.id, stockingUnit: p.stockingUnit,
      controlType: p.controlType, stockingClass: p.stockingClass,
      status: "ACTIVE",
      // Optimistic-concurrency version. readMeta() REQUIRES an integer >= INITIAL_VERSION, so a
      // fixture without it is rejected as malformed metadata even when every domain field is
      // correct -- the second half of the same conformance gap, and just as invisible.
      version: 1,
      // Legacy compatibility fields, retained deliberately: older read paths still project
      // unitOfMeasure/partTrackingMode, and removing them here would be an unrelated migration.
      // The GOVERNED fields above are authoritative; these are kept in step with them.
      unitOfMeasure: p.unit,
      partTrackingMode: p.controlType === "SERIALIZED" ? "SERIAL" : "QUANTITY",
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("parts");
    // Supplier relationship carries procurement terms — deliberately NOT on the
    // Part core (ADR-008: cost/terms live on part_supplier_items).
    const psiId = `${p.id}__${p.supplierId}`;
    await upsert(db, "part_supplier_items", psiId, {
      partId: p.id, supplierId: p.supplierId, status: "ACTIVE", preferred: true,
      supplierPartNumber: `${p.supplierId.toUpperCase()}-${p.id}`,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("part_supplier_items");
  }

  for (const a of ACCOUNTS) {
    await upsert(db, "accounts", a.id, {
      accountId: a.id, name: a.name, lineOfBusiness: a.lineOfBusiness, status: a.status,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("accounts");
  }
  for (const l of LOCATIONS) {
    await upsert(db, "locations", l.id, {
      locationId: l.id, accountId: l.accountId, name: l.name, city: l.city, state: l.state,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("locations");
  }
  for (const c of CONTACTS) {
    await upsert(db, "contacts", c.id, {
      contactId: c.id, accountId: c.accountId, name: c.name, title: c.title, email: c.email,
      createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("contacts");
  }
  for (const e of EQUIPMENT) {
    await upsert(db, "equipment", e.id, {
      equipmentId: e.id, accountId: e.accountId, locationId: e.locationId, name: e.name,
      manufacturer: e.manufacturer, modelNumber: e.modelNumber, serialNumber: e.serialNumber,
      status: e.status, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
    });
    bump("equipment");
  }

  console.log("Seeded:", JSON.stringify(counts));
  console.log("Baseline reference pack complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
