#!/usr/bin/env node
// REPORTING TRUTH SUBSTRATE V1 — what this world actually contains, in scoped names.
//
// ============================ NOT A REPORT ============================
//
// This builds no UI and answers no question. It records, in one machine-readable place, the figures
// a future Reporting Foundation would have to get right -- so that when one is built, it can be
// marked against a fact instead of against a plausible-looking number.
//
// ============================ EVERY METRIC CARRIES ITS SCOPE ============================
//
// There is no field called `inventory`, `stock`, or `onHand` anywhere in this file, and that is
// deliberate. The single most expensive mistake this program has found is a number whose scope
// nobody stated:
//
//   warehouseAvailable   what the Parts Room can issue today
//   mobileInventory      what is out on the vans
//   companyOwned         warehouse + mobile
//   outstandingInbound   ordered, SENT, and not yet received
//
// G04 exists because those first three are not interchangeable: a company that owns 44 units and can
// issue 8 will happily buy more of what it already has if a report says "inventory: 44". Naming a
// metric `inventory` is how that happens, so no metric here is named that.
//
// UNKNOWN is preserved as UNKNOWN. A part with no qualifying purchase order has an unknown inbound
// quantity, not zero -- nobody measured it, and the two answers behave differently when somebody
// later finds an order.
//
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveReadOnlyTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { allLedgerRows, signedQuantity, warehouseByPart, mobileByPart } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
const { CERT_PARTS, reorderPointFor } =
  await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const WH_ID = "wh-main";
export const REPORTING_TRUTH_VERSION = "1.0.0";

// THE ONE GATE. Emulator and eos-platform-sandbox only; production refused two ways; a live
// write additionally requires --apply-live-sandbox. See executionTarget.mjs.
let __target;
try {
  __target = resolveReadOnlyTarget();
  setExecutionTarget(__target);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}
if (!__target) {
  // refused above
} else {
  console.log(describeTarget(__target));
  // Credentials follow the TARGET, not a hardcoded project. An emulator needs none; a live
  // project needs application-default credentials, and naming the project explicitly means the
  // app cannot silently initialize against whatever ADC happens to prefer.
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
  const db = getFirestore();
  const rows = await allLedgerRows(db);
  const wh = warehouseByPart(rows, new Set([WH_ID]));
  const mob = mobileByPart(rows);

  // ── INVENTORY ─────────────────────────────────────────────────────────────────────────────────
  const quantityParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode === "NONE");
  const perPart = [];
  const conditions = {};
  for (const p of quantityParts) {
    const b = await readPartBalance(db, p.partId, false);
    // OBSERVED vs NOT OBSERVED, kept distinct -- CERT-PURCH-UNKNOWN-07. `available` is UNKNOWN when
    // the part has no governed physical observation, and collapsing that to 0 below would report an
    // unmeasured part as an empty shelf. The numeric fallback is retained for the arithmetic that
    // follows, but the STATE decides the condition.
    const availableKnown = b.available?.state === "KNOWN";
    const warehouseAvailable = availableKnown ? b.available.value : 0;
    const mobileInventory = mob.get(p.partId) ?? 0;
    const inboundKnown = b.onOrder?.state === "KNOWN";
    const outstandingInbound = inboundKnown ? b.onOrder.value : null;   // null means UNKNOWN, never 0
    const companyOwned = warehouseAvailable + mobileInventory;
    const reorderPoint = reorderPointFor(p);
    const condition = !availableKnown && mobileInventory === 0 ? "UNOBSERVED"
      : companyOwned > reorderPoint && warehouseAvailable < reorderPoint ? "FALSE_COMFORT"
        : warehouseAvailable < reorderPoint && (outstandingInbound ?? 0) > 0 ? "ON_ORDER"
          : warehouseAvailable === 0 ? "CRITICAL"
            : warehouseAvailable < reorderPoint ? "REORDER"
              : warehouseAvailable <= reorderPoint + 2 ? "WATCH" : "HEALTHY";
    conditions[condition] = (conditions[condition] ?? 0) + 1;
    perPart.push({ partId: p.partId, warehouseAvailable, mobileInventory, companyOwned,
      outstandingInbound, outstandingInboundState: inboundKnown ? "KNOWN" : "UNKNOWN",
      warehouseAvailableState: availableKnown ? "KNOWN" : "UNKNOWN",
      reorderPoint, condition });
  }

  const isBaseline = (r) => r.type === "ADJUSTED" && String(r.sourceObject?.id ?? "").startsWith("cwob_");
  const isCycle = (r) => r.type === "ADJUSTED" && String(r.sourceObject?.id ?? "").startsWith("cyc_");
  const sum = (f) => rows.filter(f).reduce((s, r) => s + signedQuantity(r), 0);

  const transferOrders = (await db.collection("transfer_orders").get()).docs.map((d) => d.data());
  const cycleCounts = (await db.collection("cycle_counts").get()).docs.map((d) => d.data());
  const returns = (await db.collection("inventory_returns").get()).docs.map((d) => d.data());
  const receipts = (await db.collection("receiving_orders").get()).docs.map((d) => d.data());
  const purchaseOrders = (await db.collection("purchase_orders").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const wos = (await db.collection("fieldops_wos").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const equipment = (await db.collection("equipment").get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  // ── SERVICE ───────────────────────────────────────────────────────────────────────────────────
  const woFacts = [];
  for (const w of wos) {
    const lines = [];
    for (const line of w.inventorySnapshot ?? []) {
      const b = await readPartBalance(db, line.partId, false);
      const warehouseAvailable = b.available?.state === "KNOWN" ? b.available.value : 0;
      const planned = line.qtyPlanned ?? 0;
      const inboundKnown = b.onOrder?.state === "KNOWN";
      lines.push({ partId: line.partId, planned, warehouseAvailable,
        mobileInventory: mob.get(line.partId) ?? 0,
        outstandingInbound: inboundKnown ? b.onOrder.value : null,
        warehouseShortage: Math.max(0, planned - warehouseAvailable) });
    }
    woFacts.push({ woNumber: w.woNumber, equipmentId: w.equipmentId ?? null, customerId: w.customerId ?? null,
      scenarioTag: w.certScenarioTag ?? null, lines,
      partsConstrained: lines.some((l) => l.warehouseShortage > 0),
      fulfillableFromWarehouse: lines.length > 0 && lines.every((l) => l.warehouseShortage === 0) });
  }

  const byEquipment = new Map();
  for (const w of woFacts) {
    if (!w.equipmentId) continue;
    byEquipment.set(w.equipmentId, [...(byEquipment.get(w.equipmentId) ?? []), w.woNumber]);
  }
  const repeatService = [...byEquipment].filter(([, list]) => list.length > 1)
    .map(([equipmentId, workOrders]) => ({ equipmentId, visits: workOrders.length, workOrders }));

  const byCustomer = new Map();
  for (const w of woFacts) {
    if (!w.customerId) continue;
    byCustomer.set(w.customerId, [...(byCustomer.get(w.customerId) ?? []), w.woNumber]);
  }

  // ── PROCUREMENT ───────────────────────────────────────────────────────────────────────────────
  const receiptsByPo = new Map();
  for (const r of receipts) {
    const po = r.source?.purchaseOrderId;
    if (po) receiptsByPo.set(po, [...(receiptsByPo.get(po) ?? []), r]);
  }
  const procurement = purchaseOrders.map((po) => {
    const rs = receiptsByPo.get(po.id) ?? [];
    const ordered = (po.items ?? []).reduce((s, i) => s + Number(i.quantity ?? 0), 0);
    const received = rs.flatMap((r) => r.lines ?? []).reduce((s, l) => s + Number(l.receivedQuantity ?? 0), 0);
    return { purchaseOrderId: po.id, storedStatus: po.status, buyer: po.certBuyerEmployeeId ?? null,
      intent: po.certIntent ?? null, orderedQuantity: ordered, receivedQuantity: received,
      outstandingQuantity: Math.max(0, ordered - received), receiptCount: rs.length,
      derivedState: received === 0 ? "NOT_RECEIVED" : received >= ordered ? "RECEIVED" : "PARTIALLY_RECEIVED" };
  });

  // ── INSTALLED BASE ────────────────────────────────────────────────────────────────────────────
  const installed = { total: equipment.length, byLineOfBusiness: {}, byStatus: {}, byWarranty: {} };
  for (const e of equipment) {
    const lob = e.certLineOfBusiness ?? e.lineOfBusiness ?? "UNKNOWN";
    installed.byLineOfBusiness[lob] = (installed.byLineOfBusiness[lob] ?? 0) + 1;
    const st = e.status ?? "UNKNOWN";
    installed.byStatus[st] = (installed.byStatus[st] ?? 0) + 1;
    const w = e.warrantyStatus ?? e.certWarrantyStatus ?? "UNKNOWN";
    installed.byWarranty[w] = (installed.byWarranty[w] ?? 0) + 1;
  }

  const truth = {
    reportingTruthVersion: REPORTING_TRUTH_VERSION,
    builtFor: "demo-certworld",
    scopeContract: {
      warehouseAvailable: "what the Parts Room can issue today (ACTIVE warehouses only)",
      mobileInventory: "what is on the vans",
      companyOwned: "warehouseAvailable + mobileInventory",
      outstandingInbound: "ordered on a SENT purchase order and not yet received; null means UNKNOWN, never zero",
      forbiddenNames: ["inventory", "stock", "onHand", "available"],
    },
    inventory: {
      warehouseAvailableTotal: [...wh.values()].reduce((a, b) => a + b, 0),
      mobileInventoryTotal: [...mob.values()].reduce((a, b) => a + b, 0),
      companyOwnedTotal: [...wh.values()].reduce((a, b) => a + b, 0) + [...mob.values()].reduce((a, b) => a + b, 0),
      outstandingInboundTotal: perPart.reduce((s, p) => s + (p.outstandingInbound ?? 0), 0),
      partsWithUnknownInbound: perPart.filter((p) => p.outstandingInboundState === "UNKNOWN").length,
      conditionCounts: conditions,
      movementsByCause: {
        openingBalance: sum(isBaseline),
        receiving: sum((r) => r.sourceObject?.type === "RECEIVING_ORDER"),
        transfer: sum((r) => r.sourceObject?.type === "TRANSFER_ORDER"),
        cycleCorrection: sum(isCycle),
        returnRestock: 0,
      },
      returnRestockNote: "0 by CONTRACT, not by coincidence: return intake writes no ledger event and "
        + "no disposition command exists. See DECISIONS #118.",
      perPart,
    },
    service: {
      workOrders: woFacts.length,
      partsConstrained: woFacts.filter((w) => w.partsConstrained).length,
      fulfillableFromWarehouse: woFacts.filter((w) => w.fulfillableFromWarehouse).length,
      repeatServiceEquipment: repeatService,
      customersWithMultipleWorkOrders: [...byCustomer].filter(([, l]) => l.length > 1)
        .map(([customerId, workOrders]) => ({ customerId, workOrders })),
      workOrders_detail: woFacts,
    },
    procurement: {
      purchaseOrders: procurement.length,
      sentAndOutstanding: procurement.filter((p) => p.storedStatus === "SENT" && p.outstandingQuantity > 0).length,
      partiallyReceived: procurement.filter((p) => p.derivedState === "PARTIALLY_RECEIVED").length,
      fullyReceived: procurement.filter((p) => p.derivedState === "RECEIVED").length,
      outstandingInboundUnits: procurement.reduce((s, p) => s + (p.storedStatus === "SENT" ? p.outstandingQuantity : 0), 0),
      receipts: receipts.length,
      detail: procurement,
    },
    operations: {
      transfers: { total: transferOrders.length,
        byStatus: transferOrders.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {}),
        companyOwnedEffect: sum((r) => r.sourceObject?.type === "TRANSFER_ORDER") },
      cycleCounts: { total: cycleCounts.length,
        byStatus: cycleCounts.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {}),
        awaitingDecision: cycleCounts.filter((c) => c.status === "COUNTED").length,
        companyOwnedEffect: sum(isCycle) },
      returns: { total: returns.length,
        awaitingDisposition: returns.filter((r) => r.state === "AWAITING_DISPOSITION").length,
        unitsReturned: returns.reduce((s, r) => s + Number(r.quantity ?? 0), 0),
        unitsRestored: null,
        unitsRestoredState: "UNKNOWN -- no disposition authority exists to decide it" },
    },
    installedBase: installed,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "reporting-truth.json"), JSON.stringify(truth, null, 2));

  console.log(`reporting truth v${REPORTING_TRUTH_VERSION}\n`);
  console.log("-- inventory, by scope");
  console.log(`   warehouseAvailable  ${truth.inventory.warehouseAvailableTotal}`);
  console.log(`   mobileInventory     ${truth.inventory.mobileInventoryTotal}`);
  console.log(`   companyOwned        ${truth.inventory.companyOwnedTotal}`);
  console.log(`   outstandingInbound  ${truth.inventory.outstandingInboundTotal} (${truth.inventory.partsWithUnknownInbound} parts UNKNOWN)`);
  console.log(`   conditions          ${JSON.stringify(truth.inventory.conditionCounts)}`);
  console.log(`   movements by cause  ${JSON.stringify(truth.inventory.movementsByCause)}`);
  console.log("\n-- service");
  console.log(`   work orders ${truth.service.workOrders}, parts-constrained ${truth.service.partsConstrained}, fulfillable ${truth.service.fulfillableFromWarehouse}`);
  console.log(`   repeat-service equipment: ${truth.service.repeatServiceEquipment.map((r) => `${r.equipmentId} x${r.visits}`).join(", ") || "none"}`);
  console.log(`   customers with multiple work orders: ${truth.service.customersWithMultipleWorkOrders.length}`);
  console.log("\n-- procurement");
  console.log(`   orders ${truth.procurement.purchaseOrders}, SENT+outstanding ${truth.procurement.sentAndOutstanding}, fully received ${truth.procurement.fullyReceived}, receipts ${truth.procurement.receipts}`);
  console.log("\n-- operations");
  console.log(`   transfers ${JSON.stringify(truth.operations.transfers.byStatus)} company effect ${truth.operations.transfers.companyOwnedEffect}`);
  console.log(`   cycle counts ${JSON.stringify(truth.operations.cycleCounts.byStatus)} company effect ${truth.operations.cycleCounts.companyOwnedEffect}`);
  console.log(`   returns ${truth.operations.returns.total}, awaiting disposition ${truth.operations.returns.awaitingDisposition}, units returned ${truth.operations.returns.unitsReturned}, restored ${truth.operations.returns.unitsRestoredState}`);
  console.log("\n-- installed base");
  console.log(`   ${truth.installedBase.total} units  ${JSON.stringify(truth.installedBase.byLineOfBusiness)}`);
  console.log(`   status ${JSON.stringify(truth.installedBase.byStatus)}`);
}
