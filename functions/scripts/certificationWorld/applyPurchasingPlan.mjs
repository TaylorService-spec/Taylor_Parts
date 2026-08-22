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

  // ── SoD PREFLIGHT. Asserted, not assumed: an employee who can both order goods and confirm their
  //    arrival can conjure inventory from nothing.
  const overlap = CERT_BUYERS.filter((b) => CERT_RECEIVERS.includes(b));
  if (overlap.length) {
    console.error(`FAILED: buyer and receiver overlap on ${overlap.join(", ")} -- separation of duties broken.`);
    process.exitCode = 1;
  } else {
    console.log(`SoD: buyers ${CERT_BUYERS.join("/")} are disjoint from receivers ${CERT_RECEIVERS.join("/")}`);

    // ── Buyers must be real, linked employees. A purchase is an accountable act.
    const employees = await db.collection("employees").get();
    const uidBy = new Map(employees.docs.map((d) => [d.id, d.data().userId]).filter(([, u]) => u));
    const unresolved = [...new Set(plan.map((o) => o.buyerEmployeeId))].filter((e) => !uidBy.has(e));
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
