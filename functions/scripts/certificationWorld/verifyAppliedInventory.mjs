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
const { signedQuantity } = await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
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
  //
  // TWO VIEWS, KEPT APART. This verifier answers two different questions that used to be one:
  //
  //   BASELINE  did the opening-balance plan land exactly as designed?
  //   ACTUAL    what does the world hold right now, after everything that has happened to it?
  //
  // They were identical until transfers existed. Once stock legitimately moved, asserting the
  // designed fleet loads against current state reported five failures in a world where every
  // number was correct -- the fixture's design being compared to the world's history.
  //
  // Fleet design and plan fidelity are BASELINE questions. Inventory conditions are an ACTUAL
  // question. Reconciliation is the bridge: baseline + operations must equal actual, exactly.
  const snap = await db.collection(LEDGER_COLLECTION).get();
  const warehouse = new Map(), mobile = new Map(), perTruck = new Map(), company = new Map(), perTruckPart = new Map();
  const bWarehouse = new Map(), bMobile = new Map(), bPerTruck = new Map(), bPerTruckPart = new Map();
  const opWarehouse = new Map(), opMobile = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  let malformed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const v = d.value ?? d;
    const type = v.type, qty = Number(v.quantity), loc = v.location;
    if (!type || !Number.isFinite(qty) || !loc?.type) { malformed += 1; continue; }
    // Shared with every other certification tool. A private copy here is what made this verifier
    // report 34 CRITICAL parts for a world holding 571 units: ADJUSTED was in no IN set.
    const signed = signedQuantity(v);
    // A baseline row is an opening balance: ADJUSTED, sourced from the opening-balance record that
    // authorized it. Everything else happened TO the world afterwards.
    const isBaseline = v.type === "ADJUSTED" && v.sourceObject?.type === "ADJUSTMENT"
      && String(v.sourceObject?.id ?? "").startsWith("cwob_");

    add(company, v.partId, signed);
    if (loc.type === "WAREHOUSE") {
      add(warehouse, v.partId, signed);
      add(isBaseline ? bWarehouse : opWarehouse, v.partId, signed);
    } else if (loc.type === "MOBILE") {
      add(mobile, v.partId, signed);
      add(perTruck, loc.locationId, signed);
      add(perTruckPart, `${loc.locationId}::${v.partId}`, signed);
      add(isBaseline ? bMobile : opMobile, v.partId, signed);
      if (isBaseline) {
        add(bPerTruck, loc.locationId, signed);
        add(bPerTruckPart, `${loc.locationId}::${v.partId}`, signed);
      }
    }
  }

  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

  console.log(`ledger documents read: ${snap.size} (malformed ${malformed})\n`);
  console.log("-- BASELINE totals: did the opening-balance plan land as designed?");
  const bWhTotal = sum(bWarehouse), bTrTotal = sum(bMobile);
  check("baseline warehouse total", bWhTotal === 571, `${bWhTotal} (expected 571)`);
  check("baseline truck total", bTrTotal === 164, `${bTrTotal} (expected 164)`);
  check("baseline company total", bWhTotal + bTrTotal === 735, `${bWhTotal + bTrTotal} (expected 735)`);

  console.log("\n-- BASELINE per truck: the fleet as it was designed");
  const EXPECTED_TRUCKS = { "cert-trk-01": 41, "cert-trk-02": 47, "cert-trk-03": 50, "cert-trk-04": 4, "cert-trk-05": 22 };
  for (const [truckId, expected] of Object.entries(EXPECTED_TRUCKS)) {
    const actual = bPerTruck.get(truckId) ?? 0;
    check(`baseline ${truckId}`, actual === expected, `${actual} (expected ${expected})`);
  }

  console.log("\n-- RECONCILIATION: baseline + operations = actual");
  // The bridge between the two views, and the only assertion that stays true no matter what the
  // world does next. Operations are whatever is not an opening balance -- transfers today, receipts
  // and reconciled counts tomorrow -- and they are deliberately not enumerated by type, so a new
  // movement type must appear in this equation rather than be silently excluded from it.
  const whTotal = sum(warehouse), trTotal = sum(mobile), coTotal = sum(company);
  const opWh = sum(opWarehouse), opTr = sum(opMobile);
  check("warehouse: baseline + operations = actual", bWhTotal + opWh === whTotal,
    `${bWhTotal} + ${opWh} = ${bWhTotal + opWh}, actual ${whTotal}`);
  check("trucks: baseline + operations = actual", bTrTotal + opTr === trTotal,
    `${bTrTotal} + ${opTr} = ${bTrTotal + opTr}, actual ${trTotal}`);
  check("company reconciles to warehouse + mobile", whTotal + trTotal === coTotal,
    `${whTotal} + ${trTotal} = ${whTotal + trTotal}`);
  // OPERATIONS DECOMPOSED BY CAUSE. An earlier version asserted that all operations were
  // company-neutral, which was true only while transfers were the only thing that had ever
  // happened. Receipts add stock; that is what receipts are for. So the neutrality claim belongs to
  // TRANSFERS specifically, and everything else must be accounted for rather than assumed absent.
  const opRows = snap.docs.map((d) => d.data().value ?? d.data())
    .filter((v) => !(v.type === "ADJUSTED" && String(v.sourceObject?.id ?? "").startsWith("cwob_")));
  const transferNet = opRows.filter((v) => v.sourceObject?.type === "TRANSFER_ORDER")
    .reduce((s, v) => s + signedQuantity(v), 0);
  const receiptNet = opRows.filter((v) => v.sourceObject?.type === "RECEIVING_ORDER")
    .reduce((s, v) => s + signedQuantity(v), 0);
  // Cycle-count reconciliations are a THIRD cause, and a different KIND of cause:
  //
  //   TRANSFER            net 0   -- stock relocated; the company owns exactly as much
  //   RECEIPT             net +   -- goods arrived from a supplier
  //   CYCLE RECONCILE     net +/- -- the books were corrected toward what is physically there
  //
  // The third one is why a company total legitimately changes without anything arriving or
  // leaving. An earlier version of this block asserted receipts were the only thing that could add
  // stock, which was true right up until the first variance was settled.
  const cycleNet = opRows.filter((v) => v.sourceObject?.type === "ADJUSTMENT"
    && String(v.sourceObject?.id ?? "").startsWith("cyc_")).reduce((s, v) => s + signedQuantity(v), 0);
  const KNOWN_CAUSES = new Set(["TRANSFER_ORDER", "RECEIVING_ORDER"]);
  const otherNet = opRows.filter((v) => !KNOWN_CAUSES.has(v.sourceObject?.type)
    && !String(v.sourceObject?.id ?? "").startsWith("cyc_")).reduce((s, v) => s + signedQuantity(v), 0);

  check("TRANSFERS are company-neutral", transferNet === 0,
    `net ${transferNet} across every transfer movement -- they relocate, never create`);
  check("every unit of change is attributable to a named cause",
    receiptNet + transferNet + cycleNet === opWh + opTr,
    `receipts ${receiptNet} + transfers ${transferNet} + cycle corrections ${cycleNet} = ${receiptNet + transferNet + cycleNet}, operations ${opWh + opTr}`);
  check("CYCLE RECONCILIATION changed the company total -- a correction, not a relocation",
    cycleNet !== 0, `${cycleNet} units. A transfer may never do this; a reconciliation must be able to.`);
  check("no operation is unaccounted for", otherNet === 0,
    `${otherNet} units moved by something that is not a transfer, a receipt, or a settled count`);

  console.log("\n-- negative balances");
  const negatives = [];
  for (const [k, v] of warehouse) if (v < 0) negatives.push(`warehouse ${k}=${v}`);
  for (const [k, v] of mobile) if (v < 0) negatives.push(`mobile ${k}=${v}`);
  check("no negative balance anywhere", negatives.length === 0, negatives.join(", ") || "none");

  // ── Per-part reconciliation.
  //
  // THE GENERAL EQUATION, not a snapshot of one era's movement mix. The previous version asserted
  //
  //     warehouse == RECEIVED - TRANSFER_OUT     and     truck == TRANSFER_OUT
  //
  // which was true only while the world was built out of exactly those two movement types. The
  // moment opening balances became ADJUSTED it reported all 34 parts as broken, in a world whose
  // every balance was correct. A test that encodes today's data shape fails on tomorrow's.
  //
  // What is asserted instead holds for ANY mix of movements:
  //   1. the tool's signed sum at the warehouse equals the PRODUCT's readPartBalance
  //   2. company equals warehouse plus mobile
  // The first is the one that matters -- two independent implementations of 'what is on hand',
  // written from different sides, agreeing on every part.
  console.log("\n-- part-level reconciliation");
  const quantityParts = CERT_PARTS.filter((p) => p.ledgerTrackingMode !== "SERIAL");
  const mismatched = [];
  for (const p of quantityParts) {
    const wh = warehouse.get(p.partId) ?? 0;
    const tr = mobile.get(p.partId) ?? 0;
    const co = company.get(p.partId) ?? 0;
    const b = await readPartBalance(db, p.partId, false);
    const product = b.available?.state === "KNOWN" ? b.available.value : 0;
    if (product !== wh) mismatched.push(`${p.partId}: readPartBalance ${product} != ledger sum ${wh}`);
    else if (co !== wh + tr) mismatched.push(`${p.partId}: company ${co} != warehouse ${wh} + mobile ${tr}`);
  }
  check(`all ${quantityParts.length} quantity parts reconcile against readPartBalance`,
    mismatched.length === 0, mismatched.slice(0, 3).join(" | ") || "exact");

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
  for (const key of bPerTruckPart.keys()) {
    const [truckId] = key.split("::");
    skuBy.set(truckId, (skuBy.get(truckId) || 0) + 1);
  }
  // Fleet DESIGN is a baseline question -- transfers legitimately broaden the leanest truck.
  const loads = [...bPerTruck.entries()].map(([truckId, units]) => ({ truckId, units, skus: skuBy.get(truckId) || 0 }));
  for (const l of loads.sort((a, b) => b.units - a.units)) console.log(`   ${l.truckId}: ${l.units} units / ${l.skus} SKUs`);
  const leanest = loads.reduce((a, b) => (b.units < a.units ? b : a));
  const broadest = loads.reduce((a, b) => (b.skus > a.skus ? b : a));
  check("one truck is materially constrained", leanest.units * 3 < broadest.units, `${leanest.truckId} ${leanest.units} vs ${broadest.units}`);
  check("one truck is materially broad", broadest.skus >= 10 && leanest.skus <= 5, `${broadest.skus} SKUs vs ${leanest.skus}`);

  // Family skew, computed from what each truck actually carries.
  const familyOf = new Map(CERT_PARTS.map((p) => [p.partId, p.family]));
  const skewOf = (truckId) => {
    const fams = {};
    for (const [key, qty] of bPerTruckPart) {
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
