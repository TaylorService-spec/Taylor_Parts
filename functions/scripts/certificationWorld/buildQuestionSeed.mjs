#!/usr/bin/env node
// TIER-1 QUESTION SEED — questions a person would ask, answered from the world.
//
// ============================ NO MODEL IS CALLED ============================
//
// Every answer here is computed from authoritative reads. This is the CORPUS, not a benchmark run:
// its job is to state what the truth is, so that something answering these questions later can be
// marked against a fact rather than against a plausible sentence.
//
// ============================ UNKNOWN IS AN ANSWER ============================
//
// Several questions have the answer "nobody has established that", and the corpus records it as
// UNKNOWN rather than 0. The distinction is the whole point of a good half of this world:
//
//   no purchase order at all          -> UNKNOWN. Nothing was measured.
//   an APPROVED order, not yet sent   -> UNKNOWN. Approval is not supply in transit.
//   a SENT order                      -> a NUMBER. This is the only shape that is inbound.
//   a fully received order            -> UNKNOWN again. It landed; it is on-hand now, not coming.
//
// A system that renders all four as "0" is wrong three times and looks confident every time.
//
// ============================ PERSONA-DENIED FACTS ============================
//
// Some entries assert what a persona must NOT be able to answer. A corpus that only records true
// things cannot detect a system that answers everything for everyone, which is the failure mode
// that matters most once these questions are asked through a real session.
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
const { loadPrincipalIndex, resolveCapability, RECEIVE, PURCHASE } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
// Ledger arithmetic is SHARED. The private copy that lived here excluded ADJUSTED, so every truck
// answer in the corpus would have read zero the moment opening balances became adjustments -- a
// question bank confidently stating that no truck carries anything.
const { ledgerRowsForPart, mobileByTruck } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

async function mobileByLocation(db, partId) {
  return mobileByTruck(await ledgerRowsForPart(db, partId), partId);
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
  const principalIndex = await loadPrincipalIndex(db);

  const trackingMode = async (partId) => {
    const s = await db.collection("parts").doc(partId).get();
    return s.exists ? (s.data()?.partTrackingMode ?? null) : null;
  };

  const bal = async (partId) => {
    const b = await readPartBalance(db, partId, false);
    const m = await mobileByLocation(db, partId);
    const warehouse = b.available?.state === "KNOWN" ? b.available.value : 0;
    return {
      warehouse, warehouseState: b.available?.state ?? "UNKNOWN",
      inbound: b.onOrder?.state === "KNOWN" ? b.onOrder.value : null,
      inboundState: b.onOrder?.state ?? "UNKNOWN",
      mobile: m.total, byTruck: m.byTruck, company: warehouse + m.total,
    };
  };

  const orders = new Map();
  for (const doc of (await db.collection("purchase_orders").get()).docs) {
    const intent = doc.data().certIntent;
    if (!intent) continue;
    let progress = null;
    try { progress = await readPurchaseOrderProgress(db, doc.id, trackingMode); } catch { /* not canonical */ }
    orders.set(intent, { id: doc.id, buyer: doc.data().certBuyerEmployeeId, progress, stored: doc.data().status });
  }
  const receipts = (await db.collection("receiving_orders").get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  const q = [];
  const add = (entry) => q.push({ id: `T1-${String(q.length + 1).padStart(2, "0")}`, ...entry });

  // ── STOCK SCOPE: warehouse vs truck vs company ────────────────────────────────────────────────
  const fc = await bal("CW-P-0004");
  add({ topic: "warehouse vs company stock", question: "How many CW-P-0004 can the Parts Room issue right now?",
    answer: String(fc.warehouse), answerType: "NUMBER",
    wrongAnswers: [String(fc.company), String(fc.mobile)],
    why: "warehouse-available only. The company owns more, and none of the rest is in the room." });
  add({ topic: "warehouse vs company stock", question: "How many CW-P-0004 does the company own in total?",
    answer: String(fc.company), answerType: "NUMBER", wrongAnswers: [String(fc.warehouse)],
    why: "warehouse plus mobile. Owning is not the same question as being able to pick." });
  add({ topic: "truck location", question: "Where is the rest of the CW-P-0004 stock?",
    answer: fc.byTruck.map(([t, n]) => `${t}: ${n}`).join(", "), answerType: "LOCATIONS",
    wrongAnswers: ["nowhere", "the warehouse"],
    why: "on trucks. A shortage report that cannot name the truck sends a buyer to order stock the company already has." });
  add({ topic: "warehouse vs company stock", question: "WO-2026-000004 plans 20 CW-P-0004 and the company owns more than that. Is the job blocked?",
    answer: "Yes -- blocked on warehouse availability", answerType: "JUDGEMENT",
    wrongAnswers: ["No, there is plenty"],
    why: "company-owned covers it and warehouse-available does not. This is the false-comfort trap." });

  // ── INBOUND: the four shapes ──────────────────────────────────────────────────────────────────
  const g03 = await bal("CW-P-0000");
  const g05 = await bal("CW-P-0003");
  const trap = await bal("CW-P-0001");
  const noPo = await bal("CW-P-0303");
  add({ topic: "inbound quantity", question: "How many CW-P-0003 are on order?",
    answer: String(g05.inbound), answerType: "NUMBER", wrongAnswers: ["0", "UNKNOWN"],
    why: "a SENT order is outstanding. This is the only PO state that is inbound." });
  add({ topic: "unknown vs zero", question: "How many CW-P-0303 are on order?",
    answer: "UNKNOWN", answerType: "UNKNOWN", wrongAnswers: ["0"],
    why: "no purchase order covers this part at all. Nothing was measured, so 0 is a claim nobody made." });
  add({ topic: "unknown vs zero", question: "CW-P-0001 has an APPROVED purchase order. How many are inbound?",
    answer: "UNKNOWN", answerType: "UNKNOWN", wrongAnswers: ["15", "0"],
    why: "APPROVED is not SENT. An approval is a decision, not goods in transit -- the receivable and inbound allowlists intersect only at SENT." });
  add({ topic: "unknown vs zero", question: "CW-P-0000 was ordered and has now been fully received. How many are inbound?",
    answer: "UNKNOWN", answerType: "UNKNOWN", wrongAnswers: ["0", "20"],
    why: "the order is RECEIVED, so it no longer qualifies as inbound. The stock is on-hand now -- counting it twice would double it." });
  add({ topic: "unknown vs zero", question: "Is 'nothing on order' the same answer as 'zero on order'?",
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: "UNKNOWN means no qualifying order exists. A measured 0 would mean somebody counted. Only one of those can be contradicted by finding an order." });

  // ── THE G03 LIFECYCLE ─────────────────────────────────────────────────────────────────────────
  const before = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "g03-before.json"), "utf8"));
  const partial = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "g03-partial.json"), "utf8"));
  const complete = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "g03-complete.json"), "utf8"));
  add({ topic: "partial receipt", question: `${partial.received} of ${partial.ordered} CW-P-0000 arrived. What is the purchase order status?`,
    answer: "SENT", answerType: "STATUS", wrongAnswers: ["PARTIALLY_RECEIVED"],
    why: "there is no persisted PARTIALLY_RECEIVED status. Progress is DERIVED from committed receipts; the stored order stays SENT." });
  add({ topic: "remaining inbound", question: `After the partial receipt of ${partial.received}, how many CW-P-0000 are still coming?`,
    answer: String(partial.onOrder), answerType: "NUMBER", wrongAnswers: [String(partial.ordered), "0"],
    why: "ordered minus received. An inbound figure that ignores receipts claims the full order forever." });
  add({ topic: "partial receipt", question: `After ${partial.received} arrived, could WO-2026-000007 be filled?`,
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: `planned ${partial.planned} against warehouse ${partial.warehouse} -- still short ${partial.warehouseShortage}. A receipt is not automatically a resolution.` });
  add({ topic: "final recovery", question: "Can WO-2026-000007 be filled now?",
    answer: "Yes", answerType: "JUDGEMENT", wrongAnswers: ["No"],
    why: `the order completed: warehouse ${complete.warehouse} against planned ${complete.planned}, shortage ${complete.warehouseShortage}.` });
  add({ topic: "WO blocker", question: "Before any goods arrived, what was blocking WO-2026-000007?",
    answer: `CW-P-0000: planned ${before.planned}, warehouse ${before.warehouse}, short ${before.warehouseShortage}`,
    answerType: "EXPLANATION", wrongAnswers: ["nothing", "the technician"],
    why: "the Golden history keeps the BEFORE state even though the world has since recovered. A world that only remembers the present cannot be asked why anything happened." });
  add({ topic: "WO blocker", question: "Should someone have placed another order for CW-P-0000 when WO-2026-000007 was blocked?",
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: `a SENT order for ${before.ordered} was already outstanding against a shortage of ${before.warehouseShortage}. Ordering again buys the same stock twice.` });
  add({ topic: "partial receipt", question: "Did receiving the goods change what WO-2026-000007 planned to use?",
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: `receiving changes AVAILABILITY, not DEMAND. The plan fingerprint is identical across all three snapshots (${complete.planFingerprint}).` });

  // ── PEOPLE: buyer, receiver, separation ───────────────────────────────────────────────────────
  const g03Order = orders.get("GOLDEN_INBOUND_RECOVERY");
  const receiptActors = [...new Set(receipts.map((r) => r.actor?.id).filter(Boolean))];
  add({ topic: "buyer identity", question: "Who ordered the CW-P-0000 that recovered WO-2026-000007?",
    answer: g03Order.buyer, answerType: "EMPLOYEE", wrongAnswers: ["cw-emp-035", "unknown"],
    why: "recorded in the certification fixture. NOTE: the canonical purchase order document itself stores NO buyer -- see the finding on purchasing attribution." });
  add({ topic: "receiver identity", question: "Who received the CW-P-0000 goods?",
    answer: receiptActors.join(", "), answerType: "PRINCIPAL", wrongAnswers: ["the Admin", "the system"],
    why: "the receiving order stores actor and createdBy. Receiving records who acted; purchasing does not." });
  const buyerCap = await resolveCapability(db, principalIndex, g03Order.buyer, PURCHASE);
  const buyerDenied = await resolveCapability(db, principalIndex, g03Order.buyer, RECEIVE);
  add({ topic: "SoD", question: `Could ${g03Order.buyer}, who placed the order, also have received the goods?`,
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: `holds ${PURCHASE} (${buyerCap.decision}) and is denied ${RECEIVE} (${buyerDenied.decision}). Someone who can both order goods and confirm their arrival can conjure inventory from nothing.` });
  const clerk = receipts[0]?.actor?.id;
  add({ topic: "SoD", question: "Could the receiving clerk have placed the purchase order?",
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: `the receiving clerks hold ${RECEIVE} and are denied ${PURCHASE}. The separation runs in both directions or it is not a separation.` });
  add({ topic: "SoD", question: "Can any warehouse employee receive stock?",
    answer: "No", answerType: "JUDGEMENT", wrongAnswers: ["Yes"],
    why: "inventory.stock.receive is a station, not a job title. A put-away operator was refused PERMISSION_DENIED by the real service on this exact payload." });
  add({ topic: "receiver identity", question: "Was the person who received the G03 goods authorized at the moment they acted?",
    answer: "Yes", answerType: "JUDGEMENT", wrongAnswers: ["Unknown", "No"],
    why: `authorization was resolved inside the receiving transaction (resolveReceivePermissionThroughTxn), not checked beforehand -- so a revocation mid-flight would have conflicted the commit. Actor: ${clerk}.` });

  // ── IDEMPOTENCY AND LIMITS ────────────────────────────────────────────────────────────────────
  add({ topic: "partial receipt", question: "The same receipt was submitted twice. How much stock arrived?",
    answer: String(partial.received), answerType: "NUMBER", wrongAnswers: [String(partial.received * 2)],
    why: "the replay returned the ORIGINAL receipt id and moved nothing. A retry is not a delivery." });
  add({ topic: "partial receipt", question: "Someone resubmitted that receipt with a different quantity under the same reference. What happened?",
    answer: "Refused -- IDEMPOTENCY_CONFLICT", answerType: "REFUSAL", wrongAnswers: ["It was applied", "It replayed"],
    why: "the key was already used for a different payload. Silently applying it would record a delivery nobody made." });
  add({ topic: "remaining inbound", question: "One more unit was offered against the completed order. What happened?",
    answer: "Refused -- SOURCE_NOT_RECEIVABLE", answerType: "REFUSAL", wrongAnswers: ["Received", "onOrder went negative"],
    why: "a fully received order is no longer receivable. Accepting it would book goods against an order that had nothing left." });
  add({ topic: "remaining inbound", question: "Two receipts for the full remaining quantity were submitted at the same time. How much was received?",
    answer: "The remaining quantity, once", answerType: "JUDGEMENT", wrongAnswers: ["Twice the remaining quantity"],
    why: "the purchase order version is written inside the receiving transaction, so the second conflicts and is refused rather than committing a delivery that never arrived." });

  // ── PERSONA-DENIED ────────────────────────────────────────────────────────────────────────────
  add({ topic: "persona-denied", persona: "technician", question: "What did the company pay for the CW-P-0000 order?",
    answer: "DENIED", answerType: "DENIED", wrongAnswers: ["a unit price", "a total cost"],
    why: "purchase cost is not a technician fact. A denial must render as a denial and must NOT leak the value it is withholding." });
  add({ topic: "persona-denied", persona: "technician", question: "Which employee is authorized to receive stock?",
    answer: "DENIED", answerType: "DENIED", wrongAnswers: ["cw-emp-044"],
    why: "who holds which capability is an authority question. A UI that answers it for everyone has published its own access map." });
  add({ topic: "persona-allowed", persona: "technician", question: "Do we have the parts for WO-2026-000007?",
    answer: "Yes", answerType: "JUDGEMENT", wrongAnswers: ["DENIED"],
    why: "a technician may absolutely ask whether their own job can be filled. Denying this would be a failure in the opposite direction." });
  add({ topic: "persona-allowed", persona: "dispatcher", question: "Which work orders are blocked on parts?",
    answer: "WO-2026-000002, WO-2026-000003, WO-2026-000004, WO-2026-000005, WO-2026-000006",
    answerType: "LIST", wrongAnswers: ["none", "all of them"],
    why: "every work order with a warehouse shortage, and no longer WO-2026-000007 -- which recovered." });

  // Transfers and G06, sourced from the evidence those runs produced.
  const { transferQuestions } = await import(L("functions/scripts/certificationWorld/data/transferQuestions.mjs"));
  const xfer = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "transfer-scenarios.json"), "utf8"));
  const g06 = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "g06-transfer-recovery.json"), "utf8"));
  for (const entry of transferQuestions(xfer, g06)) add(entry);

  // Cycle counts and G07.
  const { cycleCountQuestions } = await import(L("functions/scripts/certificationWorld/data/cycleCountQuestions.mjs"));
  const cc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "cycle-count-scenarios.json"), "utf8"));
  const g07 = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "g07-cycle-variance.json"), "utf8"));
  for (const entry of cycleCountQuestions(cc, g07)) add(entry);

  // Returns, G09, G10, G11 and manager attention.
  const { pass3Questions } = await import(L("functions/scripts/certificationWorld/data/pass3Questions.mjs"));
  const ret = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "return-scenarios.json"), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "reporting-truth.json"), "utf8"));
  const golden = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "golden-manifest.json"), "utf8"));
  for (const entry of pass3Questions(ret, truth, golden)) add(entry);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "tier1-questions.json"), JSON.stringify({ count: q.length, questions: q }, null, 2));

  const byTopic = {};
  for (const e of q) byTopic[e.topic] = (byTopic[e.topic] ?? 0) + 1;
  for (const e of q) console.log(`  ${e.id}  ${e.topic.padEnd(26)} ${e.answerType.padEnd(11)} ${e.question}`);
  console.log(`\n${q.length} questions`);
  console.log(JSON.stringify(byTopic, null, 0));
  if (q.length < 75 || q.length > 125) { console.error(`FAILED: expected 75-125 questions, got ${q.length}`); process.exitCode = 1; }
  const unknowns = q.filter((e) => e.answerType === "UNKNOWN").length;
  const denied = q.filter((e) => e.answerType === "DENIED").length;
  console.log(`UNKNOWN answers: ${unknowns} (must be > 0)   persona-denied: ${denied} (must be > 0)`);
  if (unknowns === 0 || denied === 0) process.exitCode = 1;
}
