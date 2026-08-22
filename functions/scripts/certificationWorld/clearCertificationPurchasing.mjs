#!/usr/bin/env node
// BOUNDED PURCHASING CLEANUP — five named documents, and nothing else.
//
// ============================ WHY NOT A COLLECTION WIPE ============================
//
// A wipe of purchase_orders would be simpler and would also be indistinguishable, in a log, from a
// wipe that took something it should not have. The whole point of this world is that its state can
// be believed, so the cleanup names every id it intends to remove BEFORE it removes it, and proves
// afterwards that the count of everything else is unchanged.
//
// ============================ WHY THIS EXISTS AT ALL ============================
//
// The five canonical orders were created attributed to salespeople with no purchasing authority.
// Nothing was written wrong in the governed record -- purchasing stores no buyer -- but the fixture
// intent was wrong, and correcting intent after receipts exist would be backdating attribution onto
// goods that already arrived. So the orders are rebuilt now, before any receipt, and never patched
// afterwards.
//
// It refuses to run once any receipt references one of the targets, because at that point removing
// the order would orphan real inventory history.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildPurchasingPlan, orderSignature } =
  await import(L("functions/scripts/certificationWorld/data/purchasingPlan.mjs"));

const PURCHASE_ORDERS = "purchase_orders";
const RECEIVING_ORDERS = "receiving_orders";
const APPLY = process.argv.includes("--apply");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  console.log(`emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`mode     : ${APPLY ? "APPLY (deletes)" : "DRY RUN"}\n`);

  // ── Identify targets by the SAME content signature the applier matches on. An id list typed by
  //    hand would drift; a signature is derived from the plan that created them.
  const plan = buildPurchasingPlan();
  const wanted = new Set(plan.map(orderSignature));

  const all = await db.collection(PURCHASE_ORDERS).get();
  const targets = [];
  const preserved = [];
  for (const doc of all.docs) {
    const d = doc.data();
    const lines = Array.isArray(d.items)
      ? [...d.items].map((i) => `${i.partId}:${i.quantity}`).sort().join(",") : "";
    const sig = `${d.supplierId}|${lines}`;
    (wanted.has(sig) ? targets : preserved).push({ id: doc.id, status: d.status, sig });
  }

  console.log(`purchase orders present : ${all.size}`);
  console.log(`targeted for removal    : ${targets.length}`);
  console.log(`preserved (unrelated)   : ${preserved.length}`);
  console.log("\ntargets:");
  for (const t of targets) console.log(`  ${t.id}  ${t.status.padEnd(9)} ${t.sig}`);
  if (preserved.length) {
    console.log("preserved:");
    for (const t of preserved) console.log(`  ${t.id}  ${t.status.padEnd(9)} ${t.sig}`);
  }

  // ── REFUSAL: never orphan a receipt.
  const receipts = await db.collection(RECEIVING_ORDERS).get();
  const referenced = receipts.docs
    .map((d) => d.data()?.source?.purchaseOrderId)
    .filter((id) => targets.some((t) => t.id === id));
  if (referenced.length) {
    console.error(`\nREFUSING: ${referenced.length} receipt(s) already reference a targeted order.`);
    console.error("Attribution is not backdated onto goods that have already arrived.");
    process.exitCode = 1;
  } else if (!APPLY) {
    console.log(`\nDRY RUN -- nothing deleted. Re-run with --apply to remove ${targets.length}.`);
  } else {
    for (const t of targets) await db.collection(PURCHASE_ORDERS).doc(t.id).delete();

    // ── Prove it. Targets gone, everything else exactly as it was.
    const after = await db.collection(PURCHASE_ORDERS).get();
    const stillThere = targets.filter((t) => after.docs.some((d) => d.id === t.id));
    const lostBystander = preserved.filter((t) => !after.docs.some((d) => d.id === t.id));
    console.log(`\ndeleted ${targets.length}; remaining ${after.size}`);
    console.log(`targets still present   : ${stillThere.length}`);
    console.log(`unrelated orders lost   : ${lostBystander.length}`);
    if (stillThere.length || lostBystander.length || after.size !== preserved.length) {
      console.error("FAILED: cleanup did not do exactly what it said.");
      process.exitCode = 1;
    }
  }
}
