#!/usr/bin/env node
// VERIFY APPLIED INVENTORY — read the LEDGER, not the plan.
//
// The pure plan is an intention. This reads what the authoritative ledger actually holds after the
// movements were applied, recomputes every balance from those records, and re-derives each part's
// condition from the result.
//
// Reusing the plan's own arithmetic as evidence would prove only that the plan agrees with itself --
// the exact failure mode that let a world with no HEALTHY parts report zero mismatches.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { CERT_PARTS, reorderPointFor } = await import(L("functions/scripts/certificationWorld/data/partsCatalog.mjs"));
const { TRUCK_PROFILES } = await import(L("functions/scripts/certificationWorld/data/inventoryPlan.mjs"));

const LEDGER_COLLECTION = "inventory_transactions";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  // ── Read the ledger and recompute balances from stored records.
  const snap = await db.collection(LEDGER_COLLECTION).get();
  const warehouse = new Map(), mobile = new Map(), perTruck = new Map(), company = new Map(), perTruckPart = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const IN_TYPES = new Set(["RECEIVED", "TRANSFER_IN", "RETURNED"]);
  const OUT_TYPES = new Set(["ISSUED", "TRANSFER_OUT", "SCRAPPED"]);

  let malformed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const v = d.value ?? d;
    const type = v.type, qty = Number(v.quantity), loc = v.location;
    if (!type || !Number.isFinite(qty) || !loc?.type) { malformed += 1; continue; }
    const signed = IN_TYPES.has(type) ? qty : OUT_TYPES.has(type) ? -qty : 0;
    add(company, v.partId, signed);
    if (loc.type === "WAREHOUSE") add(warehouse, v.partId, signed);
    else if (loc.type === "MOBILE") {
      add(mobile, v.partId, signed);
      add(perTruck, loc.locationId, signed);
      add(perTruckPart, `${loc.locationId}::${v.partId}`, signed);
    }
  }

  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

  console.log(`ledger documents read: ${snap.size} (malformed ${malformed})\n`);
  console.log("-- totals, recomputed from stored ledger records");
  const whTotal = sum(warehouse), trTotal = sum(mobile), coTotal = sum(company);
  check("warehouse total", whTotal === 571, `${whTotal} (expected 571)`);
  check("truck total", trTotal === 164, `${trTotal} (expected 164)`);
  check("company total", coTotal === 735, `${coTotal} (expected 735)`);
  check("company reconciles to warehouse + mobile", whTotal + trTotal === coTotal, `${whTotal} + ${trTotal} = ${whTotal + trTotal}`);

  console.log("\n-- per truck");
  const EXPECTED_TRUCKS = { "cert-trk-01": 41, "cert-trk-02": 47, "cert-trk-03": 50, "cert-trk-04": 4, "cert-trk-05": 22 };
  for (const [truckId, expected] of Object.entries(EXPECTED_TRUCKS)) {
    const actual = perTruck.get(truckId) ?? 0;
    check(`${truckId}`, actual === expected, `${actual} (expected ${expected})`);
  }

  console.log("\n-- negative balances");
  const negatives = [];
  for (const [k, v] of warehouse) if (v < 0) negatives.push(`warehouse ${k}=${v}`);
  for (const [k, v] of mobile) if (v < 0) negatives.push(`mobile ${k}=${v}`);
  check("no negative balance anywhere", negatives.length === 0, negatives.join(", ") || "none");

  // ── Per-part reconciliation, from the ledger alone.
  console.log("\n-- part-level reconciliation");
  const quantityParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode !== "SERIAL");
  const mismatched = [];
  for (const p of quantityParts) {
    const received = snap.docs.filter((d) => { const v = d.data().value ?? d.data(); return v.partId === p.partId && v.type === "RECEIVED"; })
      .reduce((a, d) => { const v = d.data().value ?? d.data(); return a + Number(v.quantity); }, 0);
    const out = snap.docs.filter((d) => { const v = d.data().value ?? d.data(); return v.partId === p.partId && v.type === "TRANSFER_OUT"; })
      .reduce((a, d) => { const v = d.data().value ?? d.data(); return a + Number(v.quantity); }, 0);
    const wh = warehouse.get(p.partId) ?? 0;
    const tr = mobile.get(p.partId) ?? 0;
    if (received - out !== wh || out !== tr) {
      mismatched.push(`${p.partId}: received ${received} - out ${out} != warehouse ${wh}, or out != truck ${tr}`);
    }
  }
  check(`all ${quantityParts.length} quantity parts reconcile`, mismatched.length === 0, mismatched.slice(0, 3).join(" | ") || "exact");

  // ── SERIAL boundary.
  const serialParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode === "SERIAL");
  const serialWithQty = serialParts.filter((p) => (company.get(p.partId) ?? 0) !== 0);
  check(`${serialParts.length} SERIAL parts carry no quantity balance`, serialWithQty.length === 0,
    serialWithQty.map((p) => p.partId).join(", ") || "none");

  // ── Conditions, re-derived from ACTUAL state.
  //
  // INBOUND IS READ, NOT ASSUMED. An earlier version of this block passed no inbound signal at
  // all, correctly: no purchasing data existed, so nothing in the world could make a shortage
  // ON_ORDER, and supplying the fixture's intent would have handed the classifier the answer it
  // was meant to compute.
  //
  // Purchasing exists now, so the dimension is supplied -- from readPartBalance.onOrder, the
  // authoritative projection, which counts only orders in a receivable state and nets committed
  // receipts out of them. An APPROVED order is not inbound; a fully received one is no longer
  // inbound. The fixture's own quantities are never consulted.
  //
  // ON_ORDER is a SEPARATE class from REORDER on purpose: both are shortages, but one has supply
  // already coming and the other needs somebody to place an order. Collapsing them tells a buyer
  // to order goods that are already on a truck to the dock.
  console.log("\n-- conditions re-derived from ACTUAL ledger and purchasing state");
  const inbound = new Map();
  for (const p of quantityParts) {
    const b = await readPartBalance(db, p.partId, false);
    inbound.set(p.partId, b.onOrder?.state === "KNOWN" ? b.onOrder.value : 0);
  }
  const condition = (p) => {
    const rp = reorderPointFor(p);
    const wh = warehouse.get(p.partId) ?? 0;
    const total = company.get(p.partId) ?? 0;
    const onOrder = inbound.get(p.partId) ?? 0;
    if (total > rp && wh < rp) return "FALSE_COMFORT";  // owned, just not where it can be picked
    if (wh < rp && onOrder > 0) return "ON_ORDER";      // short, but supply is already committed
    if (wh === 0) return "CRITICAL";
    if (wh < rp) return "REORDER";
    if (wh <= rp + 2) return "WATCH";
    return "HEALTHY";
  };
  const tally = {};
  for (const p of quantityParts) { const c = condition(p); tally[c] = (tally[c] || 0) + 1; }
  console.log(`   ${JSON.stringify(tally)}`);

  for (const c of ["HEALTHY", "WATCH", "REORDER", "ON_ORDER", "CRITICAL", "FALSE_COMFORT"]) {
    check(`${c} exists in actual state`, (tally[c] ?? 0) > 0, `${tally[c] ?? 0}`);
  }

  // ── FALSE_COMFORT, with the actual numbers.
  console.log("\n-- FALSE_COMFORT proof (actual figures)");
  for (const p of quantityParts.filter((x) => condition(x) === "FALSE_COMFORT")) {
    const rp = reorderPointFor(p), wh = warehouse.get(p.partId) ?? 0, tr = mobile.get(p.partId) ?? 0, co = company.get(p.partId) ?? 0;
    const ok = co > rp && wh < rp && tr > 0 && wh >= 0;
    check(`${p.partId} ${p.name}`, ok, `company ${co} > reorder ${rp}, warehouse ${wh} < ${rp}, on trucks ${tr}`);
  }

  console.log("\n-- HEALTHY samples (actual figures)");
  for (const p of quantityParts.filter((x) => condition(x) === "HEALTHY").slice(0, 5)) {
    const rp = reorderPointFor(p), wh = warehouse.get(p.partId) ?? 0, co = company.get(p.partId) ?? 0;
    check(`${p.partId} ${p.name}`, wh > rp + 2, `warehouse ${wh} vs reorder ${rp}, company ${co}`);
  }

  console.log("\n-- CRITICAL proof (actual figures)");
  for (const p of quantityParts.filter((x) => condition(x) === "CRITICAL")) {
    const rp = reorderPointFor(p), co = company.get(p.partId) ?? 0;
    check(`${p.partId} ${p.name}`, (warehouse.get(p.partId) ?? 0) === 0 && co <= rp,
      `warehouse 0, company ${co}, reorder ${rp} -- nothing anywhere to draw on`);
  }

  // ── Truck diversity, derived from raw allocations rather than the profile labels.
  console.log("\n-- truck diversity, derived from allocations");
  const skuBy = new Map();
  for (const key of perTruckPart.keys()) {
    const [truckId] = key.split("::");
    skuBy.set(truckId, (skuBy.get(truckId) || 0) + 1);
  }
  const loads = [...perTruck.entries()].map(([truckId, units]) => ({ truckId, units, skus: skuBy.get(truckId) || 0 }));
  for (const l of loads.sort((a, b) => b.units - a.units)) console.log(`   ${l.truckId}: ${l.units} units / ${l.skus} SKUs`);
  const leanest = loads.reduce((a, b) => (b.units < a.units ? b : a));
  const broadest = loads.reduce((a, b) => (b.skus > a.skus ? b : a));
  check("one truck is materially constrained", leanest.units * 3 < broadest.units, `${leanest.truckId} ${leanest.units} vs ${broadest.units}`);
  check("one truck is materially broad", broadest.skus >= 10 && leanest.skus <= 5, `${broadest.skus} SKUs vs ${leanest.skus}`);

  // Family skew, computed from what each truck actually carries.
  const familyOf = new Map(CERT_PARTS.map((p) => [p.partId, p.family]));
  const skewOf = (truckId) => {
    const fams = {};
    for (const [key, qty] of perTruckPart) {
      const [t, partId] = key.split("::");
      if (t !== truckId || qty <= 0) continue;
      const f = familyOf.get(partId);
      fams[f] = (fams[f] || 0) + qty;
    }
    return fams;
  };
  const taylorHeavy = skewOf("cert-trk-02"), ventanaHeavy = skewOf("cert-trk-03");
  check("Taylor-heavy truck actually skews to DRIVE (Taylor-only family)", (taylorHeavy.DRIVE ?? 0) > 0, JSON.stringify(taylorHeavy));
  check("Ventana-heavy truck actually skews to ICE (Icetro-only family)", (ventanaHeavy.ICE ?? 0) > 0, JSON.stringify(ventanaHeavy));
  check("Taylor-heavy carries no ICE, Ventana-heavy carries no DRIVE",
    (taylorHeavy.ICE ?? 0) === 0 && (ventanaHeavy.DRIVE ?? 0) === 0,
    `taylor.ICE=${taylorHeavy.ICE ?? 0}, ventana.DRIVE=${ventanaHeavy.DRIVE ?? 0}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }

  if (OUT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OUT, JSON.stringify({
      ledgerDocuments: snap.size,
      totals: { warehouse: whTotal, trucks: trTotal, company: coTotal },
      perTruck: Object.fromEntries(perTruck),
      conditions: tally,
      checks: results,
      trucks: loads,
    }, null, 2));
    console.log(`\nartifact written: ${OUT}`);
  }
}
