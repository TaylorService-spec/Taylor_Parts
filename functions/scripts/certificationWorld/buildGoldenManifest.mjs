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
const { readPurchaseOrderProgress } =
  await import(L("functions/lib/inventoryReceiving/purchaseOrderProgressRead.js"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const { ledgerRowsForPart, mobileByTruck } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

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
  { id: "G06", woNumber: "WO-2026-000008", title: "Transfer recovery",
    question: "The company owns enough and the Parts Room cannot fill the job. What fixes it?",
    expectedAnswer: "An authorized transfer moves owned stock to the location that can pick it. Company total unchanged.",
    trap: "G04 is the same STATE; this is the ACTION that resolves it. Ordering more here buys stock twice.",
    evidenceFile: "g06-transfer-recovery.json" },
  { id: "G07", woNumber: null, title: "Cycle variance",
    question: "The books say one thing and the shelf says another. Who decides?",
    expectedAnswer: "A counter reports and nothing moves; a different authority settles it and only then does stock change.",
    trap: "A system where counting adjusts stock lets one person find a shortfall and bury it in the same motion.",
    evidenceFile: "g07-cycle-variance.json" },
  { id: "G08", woNumber: null, title: "Return lifecycle",
    question: "This part came back. Can we use it?",
    expectedAnswer: "It is RETURNED and it is NOT in usable inventory. Nothing restores it until a disposition exists, and that decision is not built.",
    trap: "'Returned' and 'back in stock' are different facts. Conflating them credits inventory for goods nobody has inspected.",
    evidenceFile: "return-scenarios.json" },
  { id: "G09", woNumber: "WO-2026-000009", title: "Inbound insufficient",
    question: "There is already an order out. Is it enough?",
    expectedAnswer: "No. Warehouse plus every inbound unit still falls short, so more must be ordered despite an open order.",
    trap: "The opposite answer to G05, from the same shape. 'Something is on order' is not 'enough is on order', and only comparing inbound against the shortage tells them apart." },
  { id: "G10", woNumber: "WO-2026-000012", title: "Repeat equipment failure",
    question: "Is this machine a recurring problem?",
    expectedAnswer: "Yes -- THREE of its four work orders share the same symptom (not holding temperature). The fourth is an unrelated intermittent shutdown.",
    trap: "Counting work orders gives FOUR and overstates the pattern. No record carries a repeat-failure flag, so the answer has to come from reading what the visits were FOR -- the difference between a busy machine and a recurring fault. WO-2026-000002 landing on this unit was not planned; it makes the scenario harder and therefore better, and it is recorded rather than tidied away.",
    relatedWorkOrders: ["WO-2026-000010", "WO-2026-000011", "WO-2026-000012"],
    sameUnitDifferentSymptom: ["WO-2026-000002"], totalVisits: 4, repeatSymptomVisits: 3 },
  { id: "G11", woNumber: "WO-2026-000013", title: "Dense customer",
    question: "What is going on at this account?",
    expectedAnswer: "Several machines in service at once, across multiple sites -- busy, not broken.",
    trap: "Renders identically to G10 unless the unit is distinguished. Same customer with three units is not one unit with three visits.",
    relatedWorkOrders: ["WO-2026-000013", "WO-2026-000014", "WO-2026-000015"] },
];

async function mobileFor(db, partId) {
  return mobileByTruck(await ledgerRowsForPart(db, partId), partId).total;
}

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
    // G07 and G08 are not about a work order at all -- one is a stock correction, the other a
    // return awaiting a decision. Their truth lives in the evidence file the run produced.
    if (!s.woNumber) {
      const p = path.join(OUT_DIR, s.evidenceFile);
      manifest.scenarios.push({ ...s, evidence: fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null });
      if (!fs.existsSync(p)) { console.error(`MISSING ${s.id} evidence: ${s.evidenceFile}`); process.exitCode = 1; }
      continue;
    }
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
    const scope = s.woNumber ? `(${s.woNumber})   fulfillable=${s.fulfillable}`
      : `(no work order -- truth in ${s.evidenceFile})`;
    console.log(`\n${s.id}  ${s.title}  ${scope}`);
    console.log(`   Q: ${s.question}`);
    console.log(`   A: ${s.expectedAnswer}`);
    for (const l of s.lines ?? []) {
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
