#!/usr/bin/env node
// INDEPENDENT TRANSFER INVARIANTS — read from stored state, trusting no label.
//
// ============================ WHAT IT REFUSES TO IMPORT ============================
//
// Nothing that decides whether a transfer was correct. It reads transfer_orders and the ledger and
// applies the accounting itself, because a suite that asked the transfer command whether the
// transfer command was right would be a very expensive way of learning nothing.
//
// In particular it does NOT read a transfer's own `quantity` field to decide how much moved. It
// reads the LEDGER ROWS the transfer caused, and checks that what the order says and what the ledger
// did are the same number. A transfer that recorded 3 and moved 5 would satisfy any check written
// against the order alone.
//
// ============================ THE ONE THING TRANSFERS MAY NOT DO ============================
//
// Create or destroy company stock. Every completed transfer must pair a TRANSFER_OUT at the origin
// with an equal TRANSFER_IN at the destination -- so the sum over both is exactly zero.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { allLedgerRows, signedQuantity } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  const orders = (await db.collection("transfer_orders").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const rows = await allLedgerRows(db);
  const transferRows = rows.filter((r) => r.sourceObject?.type === "TRANSFER_ORDER");

  console.log(`transfer orders: ${orders.length}, transfer-caused ledger rows: ${transferRows.length}\n`);

  const byStatus = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  console.log(`  states: ${JSON.stringify(byStatus)}\n`);

  const completed = orders.filter((o) => o.status === "COMPLETED");
  const rowsFor = (id) => transferRows.filter((r) => r.sourceObject.id === id);

  // ── The shapes the world must actually contain ────────────────────────────────────────────────
  const isWarehouse = (l) => l?.type === "WAREHOUSE";
  const isMobile = (l) => l?.type === "MOBILE";
  const dirOf = (o) => {
    const out = rowsFor(o.id).find((r) => r.type === "TRANSFER_OUT");
    const inn = rowsFor(o.id).find((r) => r.type === "TRANSFER_IN");
    return { out: out?.location, in: inn?.location };
  };

  check("at least one COMPLETED warehouse -> truck transfer exists",
    completed.some((o) => { const d = dirOf(o); return isWarehouse(d.out) && isMobile(d.in); }),
    `${completed.length} completed`);
  check("at least one COMPLETED truck -> warehouse transfer exists",
    completed.some((o) => { const d = dirOf(o); return isMobile(d.out) && isWarehouse(d.in); }));
  check("at least one COMPLETED truck -> truck transfer exists",
    completed.some((o) => { const d = dirOf(o); return isMobile(d.out) && isMobile(d.in); }),
    "MOBILE -> MOBILE is supported by the endpoint fence; only same_location is refused");
  check("at least one CANCELLED transfer exists", orders.some((o) => o.status === "CANCELLED"));

  // ── The accounting, computed here from ledger rows ────────────────────────────────────────────
  console.log("\n-- accounting, per completed transfer");
  const mismatched = [];
  const notNeutral = [];
  for (const o of completed) {
    const rs = rowsFor(o.id);
    const outs = rs.filter((r) => r.type === "TRANSFER_OUT");
    const ins = rs.filter((r) => r.type === "TRANSFER_IN");
    const outQty = outs.reduce((s, r) => s + Math.abs(Number(r.quantity)), 0);
    const inQty = ins.reduce((s, r) => s + Math.abs(Number(r.quantity)), 0);
    // What the ORDER claims, against what the LEDGER did.
    if (outQty !== Number(o.quantity) || inQty !== Number(o.quantity)) {
      mismatched.push(`${o.transferOrderNumber ?? o.id}: order says ${o.quantity}, ledger out ${outQty} / in ${inQty}`);
    }
    const net = rs.reduce((s, r) => s + signedQuantity(r), 0);
    if (net !== 0) notNeutral.push(`${o.transferOrderNumber ?? o.id}: net ${net}`);
  }
  check("every completed transfer moved exactly what its order says", mismatched.length === 0,
    mismatched.slice(0, 3).join(" | ") || `${completed.length} transfers`);
  check("EVERY COMPLETED TRANSFER IS COMPANY-NEUTRAL", notNeutral.length === 0,
    notNeutral.slice(0, 3).join(" | ") || "out and in cancel exactly, every time");

  // ── Locations differ, and the pair is genuinely two locations ────────────────────────────────
  const sameEndpoint = completed.filter((o) => {
    const d = dirOf(o);
    return d.out && d.in && d.out.type === d.in.type && d.out.locationId === d.in.locationId;
  });
  check("no transfer has the same origin and destination", sameEndpoint.length === 0,
    sameEndpoint.map((o) => o.id).join(", ") || "all endpoints distinct");

  // ── Non-completed transfers must not have moved anything they should not ─────────────────────
  console.log("\n-- states that have not completed");
  const requested = orders.filter((o) => o.status === "REQUESTED");
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const inTransit = orders.filter((o) => o.status === "IN_TRANSIT");
  check("a REQUESTED transfer has caused no ledger movement at all",
    requested.every((o) => rowsFor(o.id).length === 0), `${requested.length} requested`);
  check("a CANCELLED transfer has caused no ledger movement at all",
    cancelled.every((o) => rowsFor(o.id).length === 0),
    `${cancelled.length} cancelled -- cancellation is only legal before dispatch, so there is nothing to unwind`);
  check("an IN_TRANSIT transfer has an OUT and no IN",
    inTransit.every((o) => rowsFor(o.id).some((r) => r.type === "TRANSFER_OUT")
      && !rowsFor(o.id).some((r) => r.type === "TRANSFER_IN")),
    `${inTransit.length} in transit`);

  // ── Every transfer-caused row points at a real order ──────────────────────────────────────────
  const orderIds = new Set(orders.map((o) => o.id));
  const orphanRows = transferRows.filter((r) => !orderIds.has(r.sourceObject.id));
  check("every transfer-caused ledger row references a REAL transfer order", orphanRows.length === 0,
    orphanRows.slice(0, 3).map((r) => `${r.id} -> ${r.sourceObject.id}`).join(" | ")
    || "the defect that produced 55 dangling transfer references does not recur");

  // ── Actor attribution ─────────────────────────────────────────────────────────────────────────
  const employees = await db.collection("employees").get();
  const principals = new Set(employees.docs.map((d) => d.data().userId).filter(Boolean));
  const unattributed = transferRows.filter((r) => !r.actor?.id || !principals.has(r.actor.id));
  check("every transfer movement names a real principal", unattributed.length === 0,
    unattributed.slice(0, 3).map((r) => `${r.id} -> ${r.actor?.id}`).join(" | ") || `${transferRows.length} rows`);

  // ── MUTATION ──────────────────────────────────────────────────────────────────────────────────
  console.log("\n-- mutation proofs");
  const victim = completed[0];
  if (victim) {
    const rs = rowsFor(victim.id);
    // Drop the destination increment: the classic "stock vanished in transit" bug.
    const withoutIn = rs.filter((r) => r.type !== "TRANSFER_IN");
    const netWithoutIn = withoutIn.reduce((s, r) => s + signedQuantity(r), 0);
    check("MUTATION: removing the destination increment breaks company neutrality",
      netWithoutIn !== 0, `net becomes ${netWithoutIn} -- stock destroyed in transit`);

    // Inflate the destination: stock created out of nothing.
    const inflated = rs.map((r) => (r.type === "TRANSFER_IN" ? { ...r, quantity: Number(r.quantity) + 5 } : r));
    const netInflated = inflated.reduce((s, r) => s + signedQuantity(r), 0);
    check("MUTATION: inflating the destination breaks company neutrality",
      netInflated !== 0, `net becomes ${netInflated} -- stock created on arrival`);

    // And a quantity that disagrees with its order.
    const lying = { ...victim, quantity: Number(victim.quantity) + 1 };
    const outQty = rs.filter((r) => r.type === "TRANSFER_OUT").reduce((s, r) => s + Math.abs(Number(r.quantity)), 0);
    check("MUTATION: an order whose quantity disagrees with its ledger rows is caught",
      outQty !== Number(lying.quantity), `order would claim ${lying.quantity}, ledger moved ${outQty}`);
  } else {
    check("there is a completed transfer to mutate", false, "no completed transfers");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} transfer invariants passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
