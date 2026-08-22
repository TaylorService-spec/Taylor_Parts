#!/usr/bin/env node
// APPLY THE PURCHASING PLAN — through procurementService, never around it.
//
// createPurchaseOrder assigns the id and validates the line items; updatePurchaseOrderStatus owns
// the transition table (DRAFT -> APPROVED -> SENT -> RECEIVED, forward only). Writing a
// purchase_orders document directly would skip both and produce an order the product could not have
// placed.
//
// ============================ IDEMPOTENT BY CONTENT, NOT BY KEY ============================
//
// The ledger makes idempotency structural: the key IS the document id, and a replay is recognised
// by the service. Purchasing has no such key -- createPurchaseOrder generates a fresh id every call.
// So a second run would create a SECOND identical order and silently double every inbound quantity,
// changing ON_ORDER figures without changing a fixture.
//
// The applier therefore matches on CONTENT before creating. That is weaker than a key -- two
// legitimately identical orders are indistinguishable from a replay -- and it is the right trade for
// a fixture, where a duplicate is always a mistake. Recorded rather than glossed: this asymmetry
// with the ledger is a real difference between the two domains.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { buildPurchasingPlan, orderSignature, CERT_BUYERS, CERT_RECEIVERS } =
  await import(L("functions/scripts/certificationWorld/data/purchasingPlan.mjs"));
const procurement = await import(L("functions/lib/procurementService.js"));
const { loadPrincipalIndex, proveSeparation } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const PURCHASE_ORDERS = "purchase_orders";
const APPLY = process.argv.includes("--apply");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  console.log(`emulator : ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log(`mode     : ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`);

  const plan = buildPurchasingPlan();
  console.log(`planned orders: ${plan.length}`);

  // ── AUTHORITY PREFLIGHT. Resolved, never assumed.
  //
  //    The previous version of this block compared two arrays of employee ids and declared
  //    separation of duties proven when they did not intersect. They did not intersect. They were
  //    also both wrong: the buyers were salespeople and the receivers were put-away operators, and
  //    not one of the four held the capability the list named them for. A check that consults only
  //    names cannot notice that.
  const principalIndex = await loadPrincipalIndex(db);
  const sod = await proveSeparation(db, principalIndex, CERT_BUYERS, CERT_RECEIVERS);
  for (const f of sod.findings) {
    console.log(`  ${f.side.padEnd(8)} ${f.employeeId}  ${f.holdsId} = ${f.holds.decision}`
      + `, ${f.deniedId} = ${f.denied.decision}  via ${f.holds.roles.join('/') || '-'}`);
  }
  if (!sod.ok) {
    console.error("\nFAILED preflight -- refusing to write purchase orders:");
    for (const v of sod.violations) console.error(`  ${v}`);
    process.exitCode = 1;
  } else {
    console.log(`\nSoD: ${CERT_BUYERS.length} buyer(s) hold purchasing and are refused receiving; `
      + `${CERT_RECEIVERS.length} receiver(s) hold receiving and are refused purchasing.`);

      const unresolved = [...new Set(plan.map((o) => o.buyerEmployeeId))].filter((e) => !principalIndex.has(e));
      if (unresolved.length) {
        console.error(`FAILED: no principal for buyer(s): ${unresolved.join(", ")}`);
        process.exitCode = 1;
      } else {

      // ── Existing orders, by content signature.
      const existing = await db.collection(PURCHASE_ORDERS).get();
      const seen = new Map();
      for (const doc of existing.docs) {
        const d = doc.data();
        const lines = Array.isArray(d.items)
          ? [...d.items].map((i) => `${i.partId}:${i.quantity}`).sort().join(",")
          : "";
        seen.set(`${d.supplierId}|${lines}`, { id: doc.id, status: d.status });
      }

      const outcomes = [];
      for (const order of plan) {
        const sig = orderSignature(order);
        const hit = seen.get(sig);
        const target = order.stopAtStatus ?? "SENT";
        if (hit) {
          outcomes.push({ order, id: hit.id, status: hit.status, outcome: "ALREADY_PRESENT" });
          continue;
        }
        if (!APPLY) {
          outcomes.push({ order, id: "(none)", status: target, outcome: "WOULD_CREATE" });
          continue;
        }
        // DRAFT -> APPROVED -> SENT, each through the governed transition. Jumping straight to SENT
        // is not possible and must not be simulated: the table is forward-only for a reason.
        const created = await procurement.createPurchaseOrder({ supplierId: order.supplierId, items: order.items });
        await procurement.updatePurchaseOrderStatus(created.id, "APPROVED");
        if (target === "SENT") await procurement.updatePurchaseOrderStatus(created.id, "SENT");
        // Fixture attribution, written next to the governed record because the record has no room
        // for it. cert-prefixed so no reader mistakes it for a product field.
        await db.collection(PURCHASE_ORDERS).doc(created.id).set({
          certBuyerEmployeeId: order.buyerEmployeeId,
          certBuyerPrincipalUid: principalIndex.get(order.buyerEmployeeId),
          certIntent: order.intent,
        }, { merge: true });
        outcomes.push({ order, id: created.id, status: target, outcome: "CREATED" });
      }

      console.log("\noutcomes:");
      // The outcome carries its own order. An earlier version looked the order back up by
      // `intent`, which is not unique -- two ON_ORDER_RECOVERY orders for two different parts both
      // rendered as the first one. The plan was right and the REPORT was wrong, which is the
      // worse failure: it is the report that gets believed.
      for (const o of outcomes) {
        const items = o.order.items.map((i) => `${i.partId} x${i.quantity}`).join(", ");
        console.log(`  ${o.outcome.padEnd(15)} ${o.status.padEnd(9)} ${o.order.intent.padEnd(26)} ${items}`);
      }

      const created = outcomes.filter((o) => o.outcome === "CREATED").length;
      const already = outcomes.filter((o) => o.outcome === "ALREADY_PRESENT").length;
      console.log(`\ncreated ${created}, already present ${already}`);
      if (!APPLY) console.log("DRY RUN -- nothing written.");
    }
  }
}
