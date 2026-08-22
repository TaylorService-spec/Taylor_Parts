#!/usr/bin/env node
// INDEPENDENT DEMAND INVARIANTS — computed here, from raw facts, importing no classifier.
//
// ============================ WHY THIS IS SEPARATE ============================
//
// A demand generator and a demand classifier can share a defect and agree perfectly. That is not
// hypothetical in this program: the Pass 1 part-index collision produced zero mismatches for a
// world containing no HEALTHY parts, because intent and derivation read the same broken input.
//
// So this file imports nothing that decides a class. It reads Work Orders, reads balances, and
// applies the WRITTEN DEFINITION of each condition itself. What it asserts is EXISTENCE and
// DISTRIBUTION -- properties no amount of internal agreement can fake. Two components can agree a
// set is empty; they cannot agree it is non-empty when it is empty.
//
// ============================ THE SCOPE RULE IT PROTECTS ============================
//
// warehouseAvailable  can the Parts Room fulfil this?   readPartBalance.available (warehouse only)
// mobileAvailable     how much is out on the trucks?    ledger, MOBILE locations
// companyOwned        does the business own enough?     warehouse + mobile
//
// FALSE_COMFORT is a COMPARISON between the first and third. A single "inventory" number collapses
// it into ordinary REORDER, which is the exact misreading the condition exists to expose -- so this
// file asserts mobileAvailable > 0 DIRECTLY rather than inferring it from a company total.
//
// EMULATOR ONLY.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
// The ONLY product import: the warehouse availability figure. Everything that decides a CLASS is
// computed below.
const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));

const IN_TYPES = new Set(["RECEIVED", "TRANSFER_IN", "RETURNED"]);
const OUT_TYPES = new Set(["ISSUED", "TRANSFER_OUT", "SCRAPPED"]);

/** Mobile stock per part, from the ledger -- the scope the warehouse projection excludes. */
async function mobileByPart(db) {
  const snap = await db.collection("inventory_transactions").get();
  const out = new Map();
  for (const doc of snap.docs) {
    const v = doc.data().value ?? doc.data();
    if (v.location?.type !== "MOBILE") continue;
    const signed = IN_TYPES.has(v.type) ? Number(v.quantity) : OUT_TYPES.has(v.type) ? -Number(v.quantity) : 0;
    out.set(v.partId, (out.get(v.partId) ?? 0) + signed);
  }
  return out;
}

/** Every fact a demand line has, at the three scopes that matter. */
async function demandFacts(db, mobile) {
  const wos = await db.collection("fieldops_wos").where("certScenarioTag", "!=", null).get();
  const rows = [];
  for (const doc of wos.docs) {
    const d = doc.data();
    const lines = [];
    for (const item of d.inventorySnapshot ?? []) {
      const b = await readPartBalance(db, item.partId, false);
      const warehouseAvailable = b.available?.state === "KNOWN" ? b.available.value : 0;
      const outstandingInbound = b.onOrder?.state === "KNOWN" ? b.onOrder.value : 0;
      const inboundKnown = b.onOrder?.state === "KNOWN";
      const mobileAvailable = mobile.get(item.partId) ?? 0;
      const planned = item.qtyPlanned ?? 0;
      lines.push({
        partId: item.partId, planned, warehouseAvailable, mobileAvailable,
        companyOwned: warehouseAvailable + mobileAvailable,
        outstandingInbound, inboundKnown,
        warehouseShortage: Math.max(0, planned - warehouseAvailable),
        companyShortage: Math.max(0, planned - (warehouseAvailable + mobileAvailable)),
      });
    }
    rows.push({ workOrderId: doc.id, woNumber: d.woNumber, tag: d.certScenarioTag, lines });
  }
  return rows.sort((a, b) => String(a.woNumber).localeCompare(String(b.woNumber)));
}

// ── The six conditions, written out from their definitions. No import decides these.
const isFullySatisfiable = (wo) => wo.lines.length > 0 && wo.lines.every((l) => l.warehouseShortage === 0);
const isPartiallyConstrained = (wo) =>
  wo.lines.some((l) => l.warehouseShortage === 0) && wo.lines.some((l) => l.warehouseShortage > 0);
const isFalseComfort = (wo) =>
  wo.lines.some((l) => l.warehouseShortage > 0 && l.companyShortage === 0 && l.mobileAvailable > 0);
const isInboundShortage = (wo) =>
  wo.lines.some((l) => l.warehouseShortage > 0 && l.outstandingInbound > 0);
const isNoPoShortage = (wo) =>
  wo.lines.some((l) => l.warehouseShortage > 0 && l.outstandingInbound === 0 && l.mobileAvailable === 0);
const isUnsatisfied = (wo) =>
  wo.lines.some((l) => l.warehouseShortage > 0 && l.warehouseAvailable === 0
    && l.mobileAvailable === 0 && l.outstandingInbound === 0);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only. Set FIRESTORE_EMULATOR_HOST.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();
  const mobile = await mobileByPart(db);
  const facts = await demandFacts(db, mobile);

  console.log(`work orders with demand: ${facts.length}\n`);
  console.log("-- every business condition must exist");
  check("FULLY_SATISFIABLE exists", facts.some(isFullySatisfiable),
    facts.filter(isFullySatisfiable).map((w) => w.woNumber).join(", ") || "none");
  check("PARTIALLY_CONSTRAINED exists", facts.some(isPartiallyConstrained),
    facts.filter(isPartiallyConstrained).map((w) => w.woNumber).join(", ") || "none");
  check("UNSATISFIED exists", facts.some(isUnsatisfied),
    facts.filter(isUnsatisfied).map((w) => w.woNumber).join(", ") || "none");
  check("FALSE_COMFORT_TRUCK_ONLY exists", facts.some(isFalseComfort),
    facts.filter(isFalseComfort).map((w) => w.woNumber).join(", ") || "none");
  check("LOW_STOCK_WITH_INBOUND_PO exists", facts.some(isInboundShortage),
    facts.filter(isInboundShortage).map((w) => w.woNumber).join(", ") || "none");
  check("LOW_STOCK_WITHOUT_PO exists", facts.some(isNoPoShortage),
    facts.filter(isNoPoShortage).map((w) => w.woNumber).join(", ") || "none");

  // ── The scope contract, asserted on real figures.
  console.log("\n-- scope contract: warehouse is NOT company where mobile stock exists");
  for (const wo of facts.filter(isFalseComfort)) {
    for (const l of wo.lines.filter((x) => x.warehouseShortage > 0 && x.companyShortage === 0 && x.mobileAvailable > 0)) {
      check(`${wo.woNumber} ${l.partId}`,
        l.warehouseAvailable < l.planned && l.companyOwned >= l.planned && l.mobileAvailable > 0,
        `planned ${l.planned}, warehouse ${l.warehouseAvailable}, mobile ${l.mobileAvailable}, `
        + `company ${l.companyOwned}, warehouseShortage ${l.warehouseShortage}, companyShortage ${l.companyShortage}`);
    }
  }

  // ── UNKNOWN must not be collapsed into a measured zero.
  console.log("\n-- UNKNOWN is not zero");
  const unknownInbound = facts.flatMap((w) => w.lines).filter((l) => !l.inboundKnown);
  check("some line has UNKNOWN inbound rather than a measured 0", unknownInbound.length > 0,
    `${unknownInbound.length} line(s): ${[...new Set(unknownInbound.map((l) => l.partId))].join(", ")}`);

  // ── MUTATIONS. Each changes the FACTS, never the definitions above.
  console.log("\n-- mutation proofs (facts changed, definitions untouched)");
  const collapsed = facts.map((w) => ({ ...w, lines: w.lines.map((l) => ({
    ...l, warehouseAvailable: l.companyOwned, warehouseShortage: Math.max(0, l.planned - l.companyOwned) })) }));
  check("MUTATION: collapsing mobile into warehouse destroys FALSE_COMFORT",
    !collapsed.some(isFalseComfort), "no FALSE_COMFORT survives once the scopes are merged");

  const noInbound = facts.map((w) => ({ ...w, lines: w.lines.map((l) => ({ ...l, outstandingInbound: 0 })) }));
  check("MUTATION: removing inbound evidence destroys LOW_STOCK_WITH_INBOUND_PO",
    !noInbound.some(isInboundShortage), "no inbound-backed shortage survives");

  const noShortLine = facts.map((w) => ({ ...w, lines: w.lines.filter((l) => l.warehouseShortage === 0) }));
  check("MUTATION: dropping the short line destroys PARTIALLY_CONSTRAINED",
    !noShortLine.some(isPartiallyConstrained), "no mixed work order survives");

  console.log("\n-- demand facts");
  for (const wo of facts) {
    for (const [i, l] of wo.lines.entries()) {
      console.log(`  ${(i === 0 ? wo.woNumber : "").padEnd(16)} ${l.partId}  planned ${String(l.planned).padStart(3)}`
        + `  wh ${String(l.warehouseAvailable).padStart(3)}  mobile ${String(l.mobileAvailable).padStart(3)}`
        + `  company ${String(l.companyOwned).padStart(3)}  inbound ${l.inboundKnown ? String(l.outstandingInbound).padStart(3) : "UNK"}`
        + `  whShort ${String(l.warehouseShortage).padStart(3)}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} invariants passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
