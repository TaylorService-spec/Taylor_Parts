#!/usr/bin/env node
// THE GOLDEN MANIFEST — five scenarios, every figure read back from the world.
//
// ============================ WHAT A GOLDEN SCENARIO IS FOR ============================
//
// Each one is a question a person would actually ask, paired with the answer the system can defend.
// They exist so that a change which quietly breaks the MEANING of an answer -- not its formatting,
// its meaning -- has something to fail against.
//
// The five are chosen to be mutually indistinguishable to a naive reading and completely different
// to a correct one:
//
//   G01  everything is there                         the boring case, which must stay boring
//   G02  short, and nobody has ordered anything      the answer is "place an order"
//   G03  short, but supply is already coming         the answer is "wait", and then it arrives
//   G04  short in the room, owned by the company     the answer is "it is on a truck", not "order more"
//   G05  short, and the supply has NOT landed yet      the answer is "wait" -- G03 before its receipts
//
// G05 and G03 are the same situation at two different moments, which is the point: after recovery
// G03 reports inbound UNKNOWN, because its order is fully received and no longer qualifies as
// inbound at all. Whether a purchase order EXISTS is not the question; whether it is still coming
// is.
//
// G02 and G05 are both shortages, and they need opposite actions -- G02 has nothing on order at
// all, G05 has supply already committed. G03 and G04 both show a warehouse shortage with stock findable elsewhere, and
// only one of them is solved by waiting. A system that collapses inbound into on-hand, or warehouse
// into company-owned, answers all five the same way and is wrong four times.
//
// ============================ NOTHING HERE IS DECLARED ============================
//
// Every quantity is read through readPartBalance and readPurchaseOrderProgress at build time. The
// manifest records what the world says, so a manifest that disagrees with the world is a signal
// rather than a second opinion.
//
// EMULATOR ONLY.
import fs from "node:fs";
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

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const IN_TYPES = new Set(["RECEIVED", "TRANSFER_IN", "RETURNED"]);
const OUT_TYPES = new Set(["ISSUED", "TRANSFER_OUT", "SCRAPPED"]);

/**
 * The five scenarios, named by the WORK ORDER they are about and the question they answer.
 *
 * The work order is identified by number rather than document id: the id is minted by the writer
 * and changes on every rebuild, and a manifest keyed on it would be unreadable by a human and
 * useless after a reset.
 */
const SCENARIOS = [
  { id: "G01", woNumber: "WO-2026-000001", title: "Fully satisfiable",
    question: "Can the Parts Room fill this job today?",
    expectedAnswer: "Yes -- every planned line is available in the warehouse.",
    trap: "None. This is the control: if G01 ever fails, the failure is in the reading, not the world." },
  { id: "G02", woNumber: "WO-2026-000006", title: "Shortage with no purchase order",
    question: "Why can this job not be filled, and what fixes it?",
    expectedAnswer: "Short in the warehouse, nothing on a truck, and nothing on order. Somebody has to place an order.",
    trap: "Inbound here is UNKNOWN, not zero. Treating 'no qualifying order' as a measured zero states a fact nobody established." },
  { id: "G03", woNumber: "WO-2026-000007", title: "Inbound recovery",
    question: "This job is short -- do we order more, or is it already coming?",
    expectedAnswer: "Already coming. A SENT order covers it; a partial receipt narrows the gap and the completion closes it.",
    trap: "Ordering more here buys stock twice. The partial receipt leaves the order SENT, not PARTIALLY_RECEIVED -- progress is derived, not stored." },
  { id: "G04", woNumber: "WO-2026-000004", title: "False comfort",
    question: "The company owns plenty of this part. Why is the job blocked?",
    expectedAnswer: "The stock is on trucks. Company-owned is sufficient; warehouse-available is not.",
    trap: "A single 'inventory' number makes this look like an ordinary shortage and sends a buyer to order stock the company already owns." },
  { id: "G05", woNumber: "WO-2026-000005", title: "Live ON_ORDER pressure",
    question: "There is already an order out. Do we order more, or wait?",
    expectedAnswer: "Wait. A SENT order is outstanding and its quantity exceeds the shortage; the goods have not arrived yet.",
    trap: "The shape G03 was in BEFORE it recovered, and the distinction is TENSE, not arithmetic. G03 shows inbound UNKNOWN now -- its order is fully received and no longer qualifies -- while G05 still carries live inbound. A reader who checks only whether a purchase order EXISTS cannot tell an order that has landed from one that has not.",
    knownGap: "This world contains no case where inbound is real but INSUFFICIENT (shortage 7 against inbound 18). That case -- where the correct answer is order MORE despite an open order -- is not represented and is not claimed to be. Recorded rather than manufactured by editing a quantity until the story fit." },
];

async function mobileFor(db, partId) {
  const snap = await db.collection("inventory_transactions").where("partId", "==", partId).get();
  let total = 0;
  for (const doc of snap.docs) {
    const v = doc.data();
    if (v.location?.type !== "MOBILE") continue;
    total += IN_TYPES.has(v.type) ? Number(v.quantity) : OUT_TYPES.has(v.type) ? -Number(v.quantity) : 0;
  }
  return total;
}

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  const trackingMode = async (partId) => {
    const s = await db.collection("parts").doc(partId).get();
    return s.exists ? (s.data()?.partTrackingMode ?? null) : null;
  };

  // Which purchase order, if any, covers each part -- read, not declared.
  const poSnap = await db.collection("purchase_orders").get();
  const orders = [];
  for (const doc of poSnap.docs) {
    let progress = null;
    try { progress = await readPurchaseOrderProgress(db, doc.id, trackingMode); } catch { /* not canonical */ }
    orders.push({ id: doc.id, intent: doc.data().certIntent ?? null, buyer: doc.data().certBuyerEmployeeId ?? null, progress });
  }

  const manifest = { builtFor: "demo-certworld", scenarios: [] };
  for (const s of SCENARIOS) {
    const woSnap = await db.collection("fieldops_wos").where("woNumber", "==", s.woNumber).limit(1).get();
    if (woSnap.empty) { console.error(`MISSING ${s.id}: ${s.woNumber}`); process.exitCode = 1; continue; }
    const wo = woSnap.docs[0];
    const lines = [];
    for (const row of wo.data().inventorySnapshot ?? []) {
      const b = await readPartBalance(db, row.partId, false);
      const warehouse = b.available?.state === "KNOWN" ? b.available.value : 0;
      const warehouseState = b.available?.state ?? "UNKNOWN";
      const mobile = await mobileFor(db, row.partId);
      const planned = row.qtyPlanned ?? 0;
      const covering = orders.filter((o) => o.progress?.lines.some((l) => l.partId === row.partId));
      lines.push({
        partId: row.partId, planned, warehouse, warehouseState, mobile, company: warehouse + mobile,
        inbound: b.onOrder?.state === "KNOWN" ? b.onOrder.value : null,
        inboundState: b.onOrder?.state ?? "UNKNOWN",
        warehouseShortage: Math.max(0, planned - warehouse),
        companyShortage: Math.max(0, planned - (warehouse + mobile)),
        coveringOrders: covering.map((o) => ({ id: o.id, intent: o.intent, buyer: o.buyer,
          storedStatus: o.progress.storedStatus, derivedState: o.progress.derivedState })),
      });
    }
    manifest.scenarios.push({
      ...s, workOrderId: wo.id, lines,
      fulfillable: lines.every((l) => l.warehouseShortage === 0),
    });
  }

  // G03 carries its three moments. They are the run's own evidence, not recomputed here: a
  // recomputation would show today's world, and the whole value of BEFORE is that it no longer is.
  const g03 = manifest.scenarios.find((s) => s.id === "G03");
  if (g03) {
    for (const [key, file] of [["before", "g03-before.json"], ["partial", "g03-partial.json"], ["complete", "g03-complete.json"]]) {
      const p = path.join(OUT_DIR, file);
      g03[key] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
      if (!g03[key]) { console.error(`MISSING G03 ${key} snapshot (${file})`); process.exitCode = 1; }
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "golden-manifest.json"), JSON.stringify(manifest, null, 2));

  for (const s of manifest.scenarios) {
    console.log(`\n${s.id}  ${s.title}  (${s.woNumber})   fulfillable=${s.fulfillable}`);
    console.log(`   Q: ${s.question}`);
    console.log(`   A: ${s.expectedAnswer}`);
    for (const l of s.lines) {
      console.log(`   ${l.partId}  planned ${String(l.planned).padStart(3)}  warehouse ${String(l.warehouse).padStart(3)}`
        + `  mobile ${String(l.mobile).padStart(3)}  company ${String(l.company).padStart(3)}`
        + `  inbound ${l.inboundState === "KNOWN" ? String(l.inbound).padStart(3) : "UNK"}`
        + `  whShort ${String(l.warehouseShortage).padStart(3)}  coShort ${String(l.companyShortage).padStart(3)}`);
    }
  }
  if (g03?.before) {
    console.log(`\nG03 history: BEFORE warehouse ${g03.before.warehouse} short ${g03.before.warehouseShortage}`
      + ` -> PARTIAL warehouse ${g03.partial.warehouse} short ${g03.partial.warehouseShortage}`
      + ` -> COMPLETE warehouse ${g03.complete.warehouse} short ${g03.complete.warehouseShortage}`);
  }
  console.log(`\n${manifest.scenarios.length} scenarios written to golden-manifest.json`);
}
