#!/usr/bin/env node
// G03 SNAPSHOT — the same reader at BEFORE, PARTIAL and COMPLETE.
//
// ============================ ONE READER, THREE MOMENTS ============================
//
// If BEFORE were captured by one routine and AFTER by another, a difference between them could be
// a difference in the world or a difference in the two readers, and the evidence could not tell
// which. So there is one reader, called three times, and every figure in it comes from an
// authoritative source: readPartBalance for availability and inbound, the ledger for mobile, the
// stored Work Order for demand, the stored purchase order and its receipts for progress.
//
// Nothing here is computed from the fixture's intended quantities. The fixture said what to build;
// it does not get to say what happened.
//
// ============================ THE PLAN FINGERPRINT ============================
//
// Receiving changes AVAILABILITY, not DEMAND. The Work Order plans twelve units before any goods
// arrive and still plans twelve after. The fingerprint is carried through all three snapshots so
// that claim is checked rather than asserted -- and so that a lifecycle which quietly rewrote the
// plan to make its own numbers work could not pass.
//
// EMULATOR ONLY.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { readPurchaseOrderProgress } =
  await import(L("functions/lib/inventoryReceiving/purchaseOrderProgressRead.js"));

export const G03_WO_NUMBER = "WO-2026-000007";
export const G03_PART_ID = "CW-P-0000";

// Ledger arithmetic comes from the shared module -- see ledgerMath.mjs on why five private
// copies of "add up the ledger" all broke at once.
const { ledgerRowsForPart, mobileByTruck } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

async function mobileFor(db, partId) {
  return mobileByTruck(await ledgerRowsForPart(db, partId), partId).total;
}

export async function captureG03(db, label) {
  // ── The Work Order, as stored.
  const woSnap = await db.collection("fieldops_wos").where("woNumber", "==", G03_WO_NUMBER).limit(1).get();
  if (woSnap.empty) throw new Error(`${G03_WO_NUMBER} not found`);
  const wo = woSnap.docs[0];
  const plan = wo.data().inventorySnapshot ?? [];
  const line = plan.find((r) => r.partId === G03_PART_ID);
  if (!line) throw new Error(`${G03_WO_NUMBER} does not plan ${G03_PART_ID}`);

  // ── The purchase order, as stored, plus its committed receipts.
  const poSnap = await db.collection("purchase_orders").where("certIntent", "==", "GOLDEN_INBOUND_RECOVERY").limit(1).get();
  if (poSnap.empty) throw new Error("no GOLDEN_INBOUND_RECOVERY purchase order");
  const po = poSnap.docs[0];
  // PO PROGRESS COMES FROM THE PRODUCT, NOT FROM ARITHMETIC HERE.
  //
  // The first version of this reader summed receipt lines itself, filtering on a `status` value it
  // guessed at. The guess was wrong -- a committed receipt is stored PUTAWAY_COMPLETE, not
  // COMMITTED -- so every receipt was filtered out and `received` stayed 0 while the ledger and the
  // inbound projection moved correctly. The snapshot then reported remaining 20 when 12 remained,
  // and the lifecycle acted on it.
  //
  // readPurchaseOrderProgress is the function the product uses to answer this question. Anything
  // else is a second implementation that gets to be wrong on its own.
  const progress = await readPurchaseOrderProgress(db, po.id, async (partId) => {
    const snap = await db.collection("parts").doc(partId).get();
    return snap.exists ? (snap.data()?.partTrackingMode ?? null) : null;
  });
  const progressLine = progress.lines.find((l) => l.partId === G03_PART_ID);
  const receiptSnap = await db.collection("receiving_orders").where("source.purchaseOrderId", "==", po.id).get();
  const receipts = receiptSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // ── Availability, from the authoritative projection.
  const bal = await readPartBalance(db, G03_PART_ID, false);
  const warehouse = bal.available?.state === "KNOWN" ? bal.available.value : 0;
  const warehouseState = bal.available?.state ?? "UNKNOWN";
  const onOrder = bal.onOrder?.state === "KNOWN" ? bal.onOrder.value : null;
  const mobile = await mobileFor(db, G03_PART_ID);

  // ── Demand, across EVERY line -- fulfillability is a property of the whole Work Order, not of
  //    the one part the scenario happens to be about.
  const allLines = [];
  for (const row of plan) {
    const b = await readPartBalance(db, row.partId, false);
    const wh = b.available?.state === "KNOWN" ? b.available.value : 0;
    const mob = await mobileFor(db, row.partId);
    allLines.push({ partId: row.partId, planned: row.qtyPlanned ?? 0, warehouse: wh, mobile: mob,
      warehouseShortage: Math.max(0, (row.qtyPlanned ?? 0) - wh) });
  }

  const planned = line.qtyPlanned ?? 0;
  const ordered = progressLine?.orderedQuantity ?? 0;
  const fingerprint = crypto.createHash("sha256")
    .update(JSON.stringify(plan.map((r) => [r.partId, r.sku, r.qtyPlanned, r.qtyUsed ?? null]).sort()))
    .digest("hex").slice(0, 16);

  return {
    label,
    workOrderId: wo.id, woNumber: G03_WO_NUMBER,
    purchaseOrderId: po.id,
    buyer: po.data().certBuyerEmployeeId ?? null,
    poStatus: progress.storedStatus,
    ordered,
    received: progressLine?.receivedQuantity ?? 0,
    remaining: progressLine?.remainingQuantity ?? 0,
    derivedState: progress.derivedState,
    receivable: progress.receivable,
    receiptCount: receipts.length,
    receiptIds: receipts.map((r) => r.id).sort(),
    onOrder, onOrderState: bal.onOrder?.state ?? "UNKNOWN",
    warehouse, warehouseState, mobile, company: warehouse + mobile,
    planned,
    warehouseShortage: Math.max(0, planned - warehouse),
    companyShortage: Math.max(0, planned - (warehouse + mobile)),
    fulfillable: allLines.every((l) => l.warehouseShortage === 0),
    lines: allLines,
    planFingerprint: fingerprint,
  };
}

export function renderG03(s) {
  const f = (v) => (v === null || v === undefined ? "UNKNOWN" : String(v));
  return [
    `== G03 ${s.label}`,
    `  work order          ${s.woNumber} (${s.workOrderId})`,
    `  purchase order      ${s.purchaseOrderId}`,
    `  buyer               ${f(s.buyer)}`,
    `  PO status           ${s.poStatus}  (derived ${s.derivedState}, receivable ${s.receivable})`,
    `  ordered             ${f(s.ordered)}`,
    `  received            ${f(s.received)}`,
    `  remaining           ${f(s.remaining)}`,
    `  receipts            ${s.receiptCount} ${s.receiptIds.join(", ")}`,
    `  onOrder             ${s.onOrderState === "KNOWN" ? s.onOrder : "UNKNOWN"}`,
    `  warehouse           ${f(s.warehouse)} (${s.warehouseState})`,
    `  mobile              ${f(s.mobile)}`,
    `  company             ${f(s.company)}`,
    `  planned             ${f(s.planned)}`,
    `  warehouse shortage  ${f(s.warehouseShortage)}`,
    `  company shortage    ${f(s.companyShortage)}`,
    `  fulfillable         ${s.fulfillable}`,
    `  plan fingerprint    ${s.planFingerprint}`,
    `  all plan lines:`,
    ...s.lines.map((l) => `    ${l.partId}  planned ${String(l.planned).padStart(3)}  warehouse ${String(l.warehouse).padStart(3)}`
      + `  mobile ${String(l.mobile).padStart(3)}  shortage ${String(l.warehouseShortage).padStart(3)}`),
  ].join("\n");
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error("FAILED: emulator only."); process.exitCode = 1; }
  else {
    if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
    const s = await captureG03(getFirestore(), process.argv[2] ?? "SNAPSHOT");
    console.log(renderG03(s));
    console.log(`JSON ${JSON.stringify(s)}`);
  }
}
