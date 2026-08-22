#!/usr/bin/env node
// RESET THE G03 RECEIPT LIFECYCLE — the receipts it wrote, and nothing else.
//
// ============================ WHY THIS IS ALLOWED TO EXIST ============================
//
// The lifecycle is evidence, and evidence has to be reproducible. A run that cannot be repeated from
// a clean baseline can only ever be believed once.
//
// It is also how a bad run gets undone honestly. The first attempt at G03 acted on a snapshot that
// mis-derived `received` as 0 -- it filtered receipts on a status value it had guessed at -- and so
// it took a receipt out of order. The right response is to remove exactly what that run wrote and
// run it again, not to reinterpret the resulting state until it reads correctly.
//
// ============================ WHAT IT WILL NOT DO ============================
//
// It removes ONLY receipts whose source is the named purchase order, and ONLY the ledger rows those
// receipts caused -- identified by sourceObject.type === "RECEIVING_ORDER" pointing at one of them,
// never by part or by date. The 142 seeded movements carry no such reference and are unreachable
// from here.
//
// It does not touch the purchase order: the stored status never left SENT, and progress is DERIVED
// from receipts, so removing the receipts restores the order's outstanding quantity by itself.
// Editing the order would be inventing a state transition that never happened.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { captureG03, renderG03 } = await import(L("functions/scripts/certificationWorld/g03Snapshot.mjs"));

const RECEIVING_ORDERS = "receiving_orders";
const LEDGER = "inventory_transactions";
const APPLY = process.argv.includes("--apply");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  console.log(`emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`mode     : ${APPLY ? "APPLY (deletes)" : "DRY RUN"}\n`);

  const before = await captureG03(db, "BEFORE RESET");
  console.log(renderG03(before) + "\n");

  const poId = before.purchaseOrderId;
  const receiptSnap = await db.collection(RECEIVING_ORDERS).where("source.purchaseOrderId", "==", poId).get();
  const receiptIds = new Set(receiptSnap.docs.map((d) => d.id));

  // ── The ledger rows those receipts caused, found by REFERENCE.
  const ledgerSnap = await db.collection(LEDGER).get();
  const causedRows = ledgerSnap.docs.filter((d) => {
    const v = d.data();
    return v?.sourceObject?.type === "RECEIVING_ORDER" && receiptIds.has(v.sourceObject.id);
  });
  const untouched = ledgerSnap.size - causedRows.length;

  console.log(`receipts against ${poId} : ${receiptIds.size}`);
  for (const d of receiptSnap.docs) {
    const l = (d.data().lines ?? [])[0] ?? {};
    console.log(`  ${d.id}  ${d.data().receivingOrderNumber}  qty ${l.receivedQuantity}  key ${d.data().idempotencyKey}`);
  }
  console.log(`ledger rows caused by them : ${causedRows.length}`);
  for (const d of causedRows) console.log(`  ${d.id}  ${d.data().type} ${d.data().quantity} ${d.data().partId}`);
  console.log(`ledger rows left untouched : ${untouched}`);

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing deleted.`);
  } else {
    for (const d of receiptSnap.docs) await d.ref.delete();
    for (const d of causedRows) await d.ref.delete();

    const after = await captureG03(db, "AFTER RESET");
    console.log("\n" + renderG03(after));

    const ledgerAfter = await db.collection(LEDGER).count().get();
    const ok = after.received === 0 && after.receiptCount === 0 && after.warehouse === 0
      && after.onOrder === before.ordered && after.poStatus === "SENT"
      && ledgerAfter.data().count === untouched
      && after.planFingerprint === before.planFingerprint;
    console.log(`\nledger rows now : ${ledgerAfter.data().count} (expected ${untouched})`);
    console.log(ok ? "\nRESET CLEAN -- G03 is back to its pre-receipt baseline."
      : "\nFAILED: the reset did not restore the pre-receipt baseline.");
    if (!ok) process.exitCode = 1;
  }
}
