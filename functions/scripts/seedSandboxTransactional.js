/**
 * Sandbox TRANSACTIONAL operating pack — scenario SBX-SCN-001 v2.
 *
 * F0: rebuilt on the GOVERNED Work Order Engine (fieldops_wos). v1 seeded the
 * legacy fieldops_jobs model, which had no acceptance, travel or arrival
 * states -- so it could not exercise the field chain it existed to prove.
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

const WOS = "fieldops_wos";
const YEAR = 2026; // deterministic: seeds must not vary by wall clock
const SCENARIO_ID = "SBX-SCN-001";
const SCENARIO_VERSION = "2.0.0";

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

  // --- Technician identity mapping --------------------------------------
  // transitionWorkOrder resolves the caller's technicianId from
  // users/{uid}.technicianId (functions/src/callerContext.ts). The persona pack
  // only established the REVERSE link (fieldops_technicians.userId), so every
  // technician transition failed `requiresOwnAssignment` with PERMISSION_DENIED.
  // This completes the identity mapping -- it grants no capability and widens no
  // permission; without it the technician persona can perform nothing at all.
  if (uidTech) {
    await db.collection("users").doc(uidTech).set({ technicianId: "tech-sbx-01" }, { merge: true });
  }

  // --- Technician record (dispatch target) ------------------------------
  await set("fieldops_technicians", "tech-sbx-01", {
    name: "Sandbox Technician", status: "available", skills: ["refrigeration", "ice-machines"],
    userId: uidTech, createdAt: now, updatedAt: now, updatedBy: by,
  });

  // --- Work Orders across the GOVERNED lifecycle ------------------------
  // F0: seeded into fieldops_wos with the shape createWorkOrder() writes, and
  // advanced to the lifecycle states the scenario needs. The legacy
  // fieldops_jobs seeding this replaced could not express acceptance, travel
  // or arrival at all -- the 4-state model had no such states -- so the
  // scenario could never prove the field chain it exists to prove.
  //
  // Execution timestamps are set ONLY for states actually reached, so the
  // documents stay internally consistent with what transitionWorkOrder would
  // have written. Nothing here fakes a step the scenario means to exercise
  // live: WO-001 stops at ARRIVED so a persona performs diagnosis and the
  // parts chain, exactly as the receipt is deliberately left unseeded.
  const woBase = (n, over) => ({
    woNumber: `WO-${YEAR}-SBX${String(n).padStart(3, "0")}`,
    priority: 2,
    type: "SERVICE",
    scenarioId: SCENARIO_ID,
    createdAt: now, updatedAt: now,
    ...over,
  });

  // The canonical failure that drives the whole scenario. Left at ARRIVED:
  // the technician is on site and has NOT yet started work, so a persona
  // exercises WorkStart -> diagnosis -> shortage -> parts chain live.
  await set(WOS, "wo-sbx-001", woBase(1, {
    status: "ARRIVED",
    complaint: "Harbor Grill Downtown reports the bar ice machine has stopped producing ice.",
    customerId: "acct-harbor", locationId: "loc-harbor-downtown", equipmentId: "eq-ice-001",
    assignedTechId: "tech-sbx-01", requiredPartId: "PRT-1001",
    severity: "HIGH",
    // F1 -- planned parts drive the SHARED WO Parts Readiness projection.
    // Without an inventorySnapshot every job reads NO_PLAN and readiness is
    // never actually exercised. Dimensions (warehouse/truck/procurement) are
    // deliberately NOT seeded: a technician cannot read those sources, so the
    // projection reports UNKNOWN and explains the degradation -- which is the
    // honest behaviour this scenario exists to prove.
    inventorySnapshot: [
      { partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 1, qtyUsed: 0 },
      { partId: "PRT-1005", sku: "PRT-1005", qtyPlanned: 2, qtyUsed: 0 },
    ],
    dispatchedAt: now, acceptedAt: now, enRouteAt: now, arrivedAt: now,
  }));

  // Awaiting dispatch -- proves the dispatcher path (Dispatch transition).
  // SCHEDULED, not READY_TO_DISPATCH: the governed table is
  // READY_TO_DISPATCH -> SCHEDULED -> DISPATCHED, so a dispatcher can only
  // dispatch from SCHEDULED. Seeding the wrong state made the dispatch path
  // untestable.
  await set(WOS, "wo-sbx-002", woBase(2, {
    status: "SCHEDULED",
    scheduledTechId: "tech-sbx-01",
    complaint: "Preventive maintenance - replace water filter cartridge.",
    customerId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
    requiredPartId: "PRT-1005",
  }));

  // Finished work -- proves completed work renders and is excluded from the
  // technician's active queue.
  await set(WOS, "wo-sbx-003", woBase(3, {
    status: "COMPLETED",
    complaint: "Cooler running warm; condenser coil inspected and cleaned.",
    resolution: "Condenser coil cleaned; temperature returned to setpoint.",
    customerId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
    assignedTechId: "tech-sbx-01",
    dispatchedAt: now, acceptedAt: now, enRouteAt: now, arrivedAt: now,
    workStartedAt: now, completedAt: now,
  }));

  // Work in progress -- proves the Complete step is the only one offered.
  await set(WOS, "wo-sbx-004", woBase(4, {
    status: "WORK_IN_PROGRESS",
    complaint: "Second ice machine reporting intermittent shutdown; diagnosis in progress.",
    customerId: "acct-harbor", locationId: "loc-harbor-airport", equipmentId: "eq-ice-002",
    assignedTechId: "tech-sbx-01", requiredPartId: "PRT-1004",
    inventorySnapshot: [{ partId: "PRT-1004", sku: "PRT-1004", qtyPlanned: 1, qtyUsed: 1 }],
    dispatchedAt: now, acceptedAt: now, enRouteAt: now, arrivedAt: now, workStartedAt: now,
  }));

  // Freshly dispatched, NOT yet accepted -- proves Accept, the step the legacy
  // model could not represent at all.
  await set(WOS, "wo-sbx-005", woBase(5, {
    status: "DISPATCHED",
    complaint: "Airport prep unit reported noisy during service.",
    customerId: "acct-harbor", locationId: "loc-harbor-airport", equipmentId: "eq-ice-002",
    assignedTechId: "tech-sbx-01",
    dispatchedAt: now,
  }));

  // Not yet scheduled -- proves the dispatch board honestly refuses to offer
  // assignment where the engine would reject it.
  await set(WOS, "wo-sbx-007", woBase(7, {
    status: "READY_TO_DISPATCH",
    complaint: "Summit backroom freezer intermittent alarm.",
    customerId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
  }));

  // NEGATIVE CASE: assigned to a DIFFERENT technician. The sandbox technician
  // must be offered nothing on this Work Order, and a transition attempt must
  // be denied server-side. Seeded so the deny path is provable, not assumed.
  await set(WOS, "wo-sbx-006", woBase(6, {
    status: "DISPATCHED",
    complaint: "Summit walk-in door seal replacement.",
    customerId: "acct-summit", locationId: "loc-summit-flag", equipmentId: "eq-cool-001",
    assignedTechId: "tech-sbx-other",
    dispatchedAt: now,
  }));

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
