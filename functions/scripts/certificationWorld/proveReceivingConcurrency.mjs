#!/usr/bin/env node
// TWO RECEIPTS, AT THE SAME TIME, FOR MORE STOCK THAN WAS ORDERED.
//
// ============================ WHY SEQUENTIAL PROVES NOTHING ============================
//
// Receiving the full remaining quantity twice in a row is obviously refused the second time: the
// first receipt has already committed and the second one reads a satisfied line. That test passes
// on a system with no concurrency control at all.
//
// The interesting case is two receipts that both READ a remaining quantity of R and both believe
// they may take it. If nothing serializes them, both commit, and the order ends up over-received by
// exactly one full delivery -- goods that were never ordered, now on the books.
//
// So both requests are started before either is awaited. They carry DIFFERENT idempotency keys,
// because idempotency is not what is being tested here: two distinct receipts, honestly distinct,
// racing for the same remaining quantity.
//
// The canonical path serializes them by writing the purchase order's version inside the receiving
// transaction, so the loser conflicts and either retries against the new state or is refused.
// Whichever happens, the invariant is the same and it is the only thing asserted: TOTAL RECEIVED
// NEVER EXCEEDS ORDERED.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { receiveAs, pickReceiver, buildReceiptRequest } =
  await import(L("functions/scripts/certificationWorld/executeG03Receipt.mjs"));
const { readPurchaseOrderProgress } =
  await import(L("functions/lib/inventoryReceiving/purchaseOrderProgressRead.js"));

/** A DIFFERENT order from G03 -- the lifecycle evidence must not be disturbed by this race. */
const INTENT = "ROUTINE_REPLENISHMENT";

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

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

  const poSnap = await db.collection("purchase_orders").where("certIntent", "==", INTENT).limit(1).get();
  if (poSnap.empty) { console.error(`no ${INTENT} purchase order`); process.exitCode = 1; }
  else {
    const poId = poSnap.docs[0].id;
    const before = await readPurchaseOrderProgress(db, poId, trackingMode);
    const line = before.lines[0];
    console.log(`purchase order : ${poId} (${INTENT})`);
    console.log(`line           : ${line.lineId} ${line.partId}`);
    console.log(`ordered        : ${line.orderedQuantity}`);
    console.log(`received       : ${line.receivedQuantity}`);
    console.log(`remaining      : ${line.remainingQuantity}`);
    console.log(`stored status  : ${before.storedStatus}, derived ${before.derivedState}, receivable ${before.receivable}\n`);

    const receiver = await pickReceiver(db);
    console.log(`both receipts submitted by ${receiver.employeeId}, each for the FULL remaining ${line.remainingQuantity}`);
    console.log(`if both commit, the order is over-received by ${line.remainingQuantity}\n`);

    const mk = (key) => buildReceiptRequest({
      purchaseOrderId: poId, lineId: line.lineId, partId: line.partId,
      quantity: line.remainingQuantity, idempotencyKey: key,
    });

    // BOTH STARTED BEFORE EITHER IS AWAITED. Awaiting the first would make this a sequential test
    // wearing the word "concurrent".
    const raceA = receiveAs(db, receiver.employeeId, mk("cw-race-A"));
    const raceB = receiveAs(db, receiver.employeeId, mk("cw-race-B"));
    const [a, b] = await Promise.all([raceA, raceB]);

    for (const [label, r] of [["A", a], ["B", b]]) {
      console.log(`  ${label}: ${r.ok ? "ACCEPTED " + r.outcome.receivingId : "REFUSED " + r.code + " -- " + r.message}`);
    }

    const after = await readPurchaseOrderProgress(db, poId, trackingMode);
    const afterLine = after.lines[0];
    const receipts = await db.collection("receiving_orders").where("source.purchaseOrderId", "==", poId).get();
    console.log(`\nordered   ${afterLine.orderedQuantity}`);
    console.log(`received  ${afterLine.receivedQuantity}`);
    console.log(`remaining ${afterLine.remainingQuantity}`);
    console.log(`receipts  ${receipts.size}`);
    console.log(`status    ${after.storedStatus}, derived ${after.derivedState}`);

    const accepted = [a, b].filter((r) => r.ok).length;
    check("at least one receipt committed", accepted >= 1, `${accepted} accepted`);
    check("TOTAL RECEIVED NEVER EXCEEDS ORDERED",
      afterLine.receivedQuantity <= afterLine.orderedQuantity,
      `${afterLine.receivedQuantity} <= ${afterLine.orderedQuantity}`);
    check("the order was not over-received by a whole delivery",
      afterLine.receivedQuantity === line.receivedQuantity + line.remainingQuantity,
      `expected ${line.receivedQuantity + line.remainingQuantity}, got ${afterLine.receivedQuantity}`);
    check("remaining is never negative", afterLine.remainingQuantity >= 0, `${afterLine.remainingQuantity}`);
    check("exactly one receipt per accepted request", receipts.size === accepted, `${receipts.size} receipt(s), ${accepted} accepted`);

    // The loser must have been TOLD, not silently dropped.
    const loser = [a, b].find((r) => !r.ok);
    if (loser) {
      check("the losing request was refused with a governed code", typeof loser.code === "string" && loser.code !== "?",
        `${loser.code}: ${loser.message}`);
    } else {
      check("both committed -- then their quantities must still sum within the order",
        afterLine.receivedQuantity <= afterLine.orderedQuantity, "serialized by retry rather than refusal");
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} concurrency checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
