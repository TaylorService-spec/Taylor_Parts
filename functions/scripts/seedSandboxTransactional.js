/**
 * Sandbox TRANSACTIONAL operating pack — scenario SBX-SCN-001 v1.
 *
 * Layers a coherent operating process graph on top of the baseline reference
 * pack: one canonical end-to-end story plus deliberate lifecycle variation, so
 * the sandbox exercises real process behaviour rather than a single happy path.
 *
 * THE CANONICAL SCENARIO (SBX-SCN-001):
 *   Harbor Grill Downtown's bar ice machine (eq-ice-001) fails
 *     -> job created and assigned to the sandbox technician
 *     -> technician needs PRT-1001 Evaporator Fan Motor
 *     -> PRT-1001 is SHORT at wh-main
 *     -> reorder request raised and advanced to ORDERED
 *     -> purchase order placed with Arctic Parts Supply
 *     -> PO awaits receiving into the governed location
 *   The chain deliberately STOPS at receiving-ready: the actual receipt is a
 *   governed trusted-callable write, exercised by a persona, NOT seeded here.
 *   Seeding a receipt would fake the very step the scenario exists to prove.
 *
 * HONEST BOUNDARIES (recorded, not faked):
 *   - No sales entry point: Sales & CRM is Level 1, so the story starts at the
 *     service request, not at a customer order.
 *   - No financial consequence: Financial Operations is Level 1, so nothing
 *     downstream of completion is modelled.
 *
 * SAFETY — privileged seed tooling, separate from simulated-user execution:
 *   refuses production by registry role, refuses taylor-parts explicitly,
 *   refuses unknown projects, requires --projectId, deterministic + idempotent.
 *
 * Usage:
 *   cd functions
 *   node scripts/seedSandboxTransactional.js --projectId eos-platform-sandbox
 */
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const fs = require("node:fs");
const path = require("node:path");

const SCENARIO_ID = "SBX-SCN-001";
const SCENARIO_VERSION = "1.0.0";

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
  if (!projectId || projectId === "true") throw new Error("--projectId is required. No default target.");
  if (projectId === "taylor-parts") throw new Error("REFUSING: taylor-parts is the customer production project.");
  const registry = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../config/environments.json"), "utf8"));
  const env = registry.environments.find((e) => e.firebase && e.firebase.projectId === projectId);
  if (!env) throw new Error(`REFUSING: '${projectId}' is not a known provisioned environment. Unknown projects fail closed.`);
  if (env.role === "production") throw new Error(`REFUSING: environment '${env.id}' has role 'production'.`);
  return env;
}

// Canonical reorder-request shape (firestore.rules hasCanonicalReorderRequestKeys).
// Every key is supplied explicitly — absent optional keys are set null rather than
// omitted, so the record shape is identical across lifecycle states.
function reorderRequest(o) {
  return {
    partId: o.partId,
    recommendationStatus: o.recommendationStatus || "RECOMMENDED",
    urgency: o.urgency === undefined ? "HIGH" : o.urgency,
    quantitySource: o.quantitySource || "RECOMMENDED",
    recommendedQty: o.recommendedQty,
    requestedQty: o.requestedQty,
    status: o.status,
    currentOwner: o.currentOwner || null,
    requestedBy: o.requestedBy,
    createdAt: o.createdAt,
    reviewedBy: o.reviewedBy || null,
    reviewedAt: o.reviewedAt || null,
    reviewDecision: o.reviewDecision || null,
    reviewNotes: o.reviewNotes || null,
    assignedToUserId: o.assignedToUserId || null,
    assignedBy: o.assignedBy || null,
    assignedAt: o.assignedAt || null,
    purchasingStartedAt: o.purchasingStartedAt || null,
    purchasingStartedBy: o.purchasingStartedBy || null,
    purchasingNotes: o.purchasingNotes || null,
    vendorContacted: o.vendorContacted === undefined ? null : o.vendorContacted,
    expectedAvailabilityDate: o.expectedAvailabilityDate || null,
    lastPurchasingUpdateAt: o.lastPurchasingUpdateAt || null,
    lastPurchasingUpdateBy: o.lastPurchasingUpdateBy || null,
    purchaseOrderId: o.purchaseOrderId || null,
    orderedBy: o.orderedBy || null,
    orderedAt: o.orderedAt || null,
    receivedBy: o.receivedBy || null,
    receivedAt: o.receivedAt || null,
    cancelledBy: o.cancelledBy || null,
    cancelledAt: o.cancelledAt || null,
    cancellationReason: o.cancellationReason || null,
    voidedBy: o.voidedBy || null,
    voidedAt: o.voidedAt || null,
    voidReason: o.voidReason || null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let env;
  try { env = assertNonProductionTarget(args.projectId); }
  catch (err) { console.error(err.message); process.exitCode = 1; return; }

  console.log(`Seeding ${SCENARIO_ID} v${SCENARIO_VERSION} into '${env.id}' (${args.projectId})`);
  initializeApp({ credential: applicationDefault(), projectId: args.projectId });
  const db = getFirestore();
  const now = Timestamp.now();
  const by = "sandbox-transactional-seed";
  const counts = {};
  const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const set = async (c, id, d) => { await db.collection(c).doc(id).set(d, { merge: true }); bump(c); };

  // Resolve seeded persona uids so records reference real identities, not
  // invented ones — an orphaned actor reference would be exactly the fake
  // foreign key this pack is supposed to avoid.
  const users = await db.collection("users").get();
  const byEmployee = {};
  for (const u of users.docs) {
    const d = u.data();
    if (d.employeeId) byEmployee[d.employeeId] = u.id;
  }
  const uidTech = byEmployee["sbx-tech"] || null;
  const uidDispatcher = byEmployee["sbx-dispatcher"] || null;
  const uidPartsMgr = byEmployee["sbx-partsmgr"] || null;
  const uidPartsAssoc = byEmployee["sbx-partsassoc"] || null;

  // --- Technician record (dispatch target) ------------------------------
  await set("fieldops_technicians", "tech-sbx-01", {
    name: "Sandbox Technician", status: "available", skills: ["refrigeration", "ice-machines"],
    userId: uidTech, createdAt: now, updatedAt: now, updatedBy: by,
  });

  // --- Jobs across lifecycle states -------------------------------------
  // The canonical failure that drives the whole scenario.
  await set("fieldops_jobs", "job-sbx-001", {
    title: "Ice machine not producing — bar unit",
    description: "Harbor Grill Downtown reports the bar ice machine has stopped producing ice.",
    status: "assigned", technicianId: "tech-sbx-01",
    accountId: "acct-harbor", locationId: "loc-harbor-downtown", equipmentId: "eq-ice-001",
    requiredPartId: "PRT-1001", scenarioId: SCENARIO_ID,
    createdAt: now, updatedAt: now, createdBy: uidDispatcher || by,
  });
  await set("fieldops_jobs", "job-sbx-002", {
    title: "Quarterly water filter replacement",
    description: "Preventive maintenance — replace water filter cartridge.",
    status: "open", technicianId: null,
    accountId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
    requiredPartId: "PRT-1005", scenarioId: SCENARIO_ID,
    createdAt: now, updatedAt: now, createdBy: uidDispatcher || by,
  });
  await set("fieldops_jobs", "job-sbx-003", {
    title: "Walk-in cooler temperature drift",
    description: "Cooler running warm; condenser coil inspected and cleaned.",
    status: "complete", technicianId: "tech-sbx-01",
    accountId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
    requiredPartId: null, scenarioId: SCENARIO_ID,
    createdAt: now, updatedAt: now, createdBy: uidDispatcher || by,
  });
  await set("fieldops_jobs", "job-sbx-004", {
    title: "Airport unit intermittent fault",
    description: "Second ice machine reporting intermittent shutdown; diagnosis in progress.",
    status: "in_progress", technicianId: "tech-sbx-01",
    accountId: "acct-harbor", locationId: "loc-harbor-airport", equipmentId: "eq-ice-002",
    requiredPartId: "PRT-1004", scenarioId: SCENARIO_ID,
    createdAt: now, updatedAt: now, createdBy: uidDispatcher || by,
  });

  // --- Inventory position: in-stock, low-stock, SHORTAGE ----------------
  // Ledger-derived truth (ADR-003) is append-only RESERVED/RELEASED/CONSUMED.
  // These are the opening positions the scenario reasons about.
  const stock = [
    { part: "PRT-1005", wh: "wh-main", qty: 40, note: "healthy stock" },
    { part: "PRT-1003", wh: "wh-main", qty: 6, note: "low stock" },
    { part: "PRT-1004", wh: "wh-main", qty: 12, note: "healthy stock" },
    { part: "PRT-1006", wh: "wh-north", qty: 3, note: "low stock, other warehouse" },
    { part: "PRT-1001", wh: "wh-main", qty: 0, note: "SHORTAGE — drives the scenario" },
  ];
  for (const s of stock) {
    await set("stock_locations", `${s.wh}__${s.part}`, {
      warehouseId: s.wh, partId: s.part, quantityOnHand: s.qty,
      scenarioId: SCENARIO_ID, note: s.note, updatedAt: now, updatedBy: by,
    });
  }

  // --- Reorder requests across lifecycle states -------------------------
  // ORDERED — the canonical scenario's receiving candidate.
  await set("reorder_requests", "ro-sbx-001", reorderRequest({
    partId: "PRT-1001", recommendedQty: 4, requestedQty: 4, status: "ORDERED",
    currentOwner: uidPartsAssoc, requestedBy: uidTech || by, createdAt: now,
    reviewedBy: uidPartsMgr, reviewedAt: now, reviewDecision: "APPROVED",
    reviewNotes: "Shortage confirmed at wh-main; unit down at Harbor Grill Downtown.",
    assignedToUserId: uidPartsAssoc, assignedBy: uidPartsMgr, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: uidPartsAssoc,
    purchasingNotes: "Arctic Parts Supply confirmed availability.", vendorContacted: true,
    purchaseOrderId: "po-sbx-001", orderedBy: uidPartsAssoc, orderedAt: now,
    lastPurchasingUpdateAt: now, lastPurchasingUpdateBy: uidPartsAssoc,
  }));
  // PENDING_REVIEW — an unreviewed queue item.
  await set("reorder_requests", "ro-sbx-002", reorderRequest({
    partId: "PRT-1003", recommendedQty: 10, requestedQty: 10, status: "PENDING_REVIEW",
    urgency: "MEDIUM", requestedBy: uidTech || by, createdAt: now,
  }));
  // PURCHASING_IN_PROGRESS — mid-flight.
  await set("reorder_requests", "ro-sbx-003", reorderRequest({
    partId: "PRT-1006", recommendedQty: 8, requestedQty: 8, status: "PURCHASING_IN_PROGRESS",
    urgency: "LOW", currentOwner: uidPartsAssoc, requestedBy: uidTech || by, createdAt: now,
    reviewedBy: uidPartsMgr, reviewedAt: now, reviewDecision: "APPROVED",
    assignedToUserId: uidPartsAssoc, assignedBy: uidPartsMgr, assignedAt: now,
    purchasingStartedAt: now, purchasingStartedBy: uidPartsAssoc,
    purchasingNotes: "Awaiting vendor quote.", vendorContacted: true,
    lastPurchasingUpdateAt: now, lastPurchasingUpdateBy: uidPartsAssoc,
  }));
  // REJECTED — the alternate terminal branch.
  await set("reorder_requests", "ro-sbx-004", reorderRequest({
    partId: "PRT-1002", recommendedQty: 2, requestedQty: 2, status: "REJECTED",
    urgency: "LOW", requestedBy: uidTech || by, createdAt: now,
    reviewedBy: uidPartsMgr, reviewedAt: now, reviewDecision: "REJECTED",
    reviewNotes: "Sufficient stock already on hand at wh-main.",
  }));

  // --- Purchase orders (the GOVERNED reorder PO model, Decision B) -------
  await set("reorder_purchase_orders", "po-sbx-001", {
    purchaseOrderId: "po-sbx-001", reorderRequestId: "ro-sbx-001",
    partId: "PRT-1001", supplierId: "sup-arcticparts", orderedQuantity: 4,
    status: "ORDERED", scenarioId: SCENARIO_ID,
    recordedBy: uidPartsAssoc, recordedAt: now, createdAt: now, updatedAt: now,
  });
  await set("reorder_purchase_orders", "po-sbx-002", {
    purchaseOrderId: "po-sbx-002", reorderRequestId: "ro-sbx-005",
    partId: "PRT-1002", supplierId: "sup-coldchain", orderedQuantity: 5,
    status: "VOIDED", voidReason: "Duplicate order raised in error.", scenarioId: SCENARIO_ID,
    recordedBy: uidPartsAssoc, recordedAt: now, voidedBy: uidPartsMgr, voidedAt: now,
    createdAt: now, updatedAt: now,
  });

  console.log("Seeded:", JSON.stringify(counts));
  console.log(`Scenario ${SCENARIO_ID} v${SCENARIO_VERSION} ready.`);
  console.log("Receiving-ready candidate: reorder ro-sbx-001 + PO po-sbx-001 (both ORDERED).");
  console.log("The receipt itself is NOT seeded — it is the governed write the scenario exists to exercise.");
}

main().catch((err) => { console.error("Seed failed:", err && err.message ? err.message : err); process.exitCode = 1; });
