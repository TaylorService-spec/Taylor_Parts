#!/usr/bin/env node
// G06 — TRANSFER RECOVERY. A blocked job, stock in the wrong place, and the governed act that fixes it.
//
// ============================ WHY THIS IS NOT G04 ============================
//
//   G04  the trap. The company owns 44 and the Parts Room can issue 10. A single "inventory" number
//        says there is plenty, and a buyer acting on it orders stock the business already has.
//
//   G06  the fix. Same shape, different job, and the question is no longer "why is this blocked"
//        but "what makes it unblocked" -- an authorized transfer, moving owned stock to the location
//        that can actually pick it.
//
// They deliberately use different parts. Recovering G04 itself would have proved G06 by destroying
// the only FALSE_COMFORT scenario in the world.
//
// ============================ WHAT MUST NOT MOVE ============================
//
// Company ownership. Not one unit is created here; the business owns exactly as much afterwards as
// before. What changes is where it is, and therefore what can be done with it. If the company total
// moves, the transfer did something other than transfer.
//
// EMULATOR ONLY.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { readPartBalance } = await import(L("functions/lib/inventory/partBalanceReadService.js"));
const { transferAs, onHandAt, readTransfer } =
  await import(L("functions/scripts/certificationWorld/executeTransfer.mjs"));
const { allLedgerRows, mobileByTruck } =
  await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const WH = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });
const G06_WO = "WO-2026-000008";
const OP_CREATE = "cw-emp-029";   // warehouse manager, holds all four transfer capabilities
const OP_RECEIVE = "cw-emp-043";  // a second operator completes it -- one person need not do it all

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };

async function snapshot(db, label, partId, sourceTruckId) {
  const woSnap = await db.collection("fieldops_wos").where("woNumber", "==", G06_WO).limit(1).get();
  const wo = woSnap.docs[0];
  const line = (wo.data().inventorySnapshot ?? []).find((r) => r.partId === partId);
  const b = await readPartBalance(db, partId, false);
  const warehouse = b.available?.state === "KNOWN" ? b.available.value : 0;
  const rows = await allLedgerRows(db);
  const m = mobileByTruck(rows, partId);
  const planned = line?.qtyPlanned ?? 0;
  return {
    label, woNumber: G06_WO, workOrderId: wo.id, partId, planned,
    warehouse, mobile: m.total, company: warehouse + m.total,
    sourceTruck: sourceTruckId, sourceTruckHolding: sourceTruckId ? await onHandAt(db, partId, { type: "MOBILE", locationId: sourceTruckId }) : null,
    byTruck: m.byTruck,
    warehouseShortage: Math.max(0, planned - warehouse),
    companyShortage: Math.max(0, planned - (warehouse + m.total)),
    fulfillable: planned - warehouse <= 0,
  };
}

const render = (s) => [
  `== G06 ${s.label}`,
  `  work order          ${s.woNumber}`,
  `  part                ${s.partId}`,
  `  planned             ${s.planned}`,
  `  warehouse           ${s.warehouse}`,
  `  mobile (all trucks) ${s.mobile}   ${s.byTruck.map(([t, q]) => `${t}:${q}`).join(", ")}`,
  `  company             ${s.company}`,
  `  warehouse shortage  ${s.warehouseShortage}`,
  `  company shortage    ${s.companyShortage}`,
  `  fulfillable         ${s.fulfillable}`,
].join("\n");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("FAILED: emulator only.");
  process.exitCode = 1;
} else {
  if (!getApps().length) initializeApp({ projectId: "demo-certworld" });
  const db = getFirestore();

  const woSnap = await db.collection("fieldops_wos").where("woNumber", "==", G06_WO).limit(1).get();
  if (woSnap.empty) { console.error(`${G06_WO} not found`); process.exitCode = 1; }
  else {
    const PART = (woSnap.docs[0].data().inventorySnapshot ?? [])[0]?.partId;

    // The donor truck is FOUND, not named: whichever one holds enough to close the gap.
    const before0 = await snapshot(db, "BEFORE", PART, null);
    const donor = before0.byTruck.find(([, q]) => q >= before0.warehouseShortage);
    check("a single truck holds enough to close the shortage", Boolean(donor),
      donor ? `${donor[0]} holds ${donor[1]} against a shortage of ${before0.warehouseShortage}`
        : `no truck holds ${before0.warehouseShortage}; trucks: ${before0.byTruck.map(([t, q]) => `${t}:${q}`).join(", ")}`);

    if (!donor) { process.exitCode = 1; }
    else {
      const [truckId] = donor;
      const before = await snapshot(db, "BEFORE", PART, truckId);
      console.log("\n" + render(before) + "\n");

      // ── The blocker, stated before it is fixed.
      check("G06 starts BLOCKED at the warehouse", before.fulfillable === false && before.warehouseShortage > 0,
        `short ${before.warehouseShortage}`);
      check("G06 is NOT short at company scope -- the stock exists, elsewhere",
        before.companyShortage === 0, `company ${before.company} against planned ${before.planned}`);

      // ── The quantity: exactly the shortage. Not more, because a transfer is a response to a need.
      const QTY = before.warehouseShortage;
      console.log(`-- transferring exactly the shortage: ${QTY} from ${truckId} to ${WH.locationId}\n`);

      const created = await transferAs(db, OP_CREATE, "create", {
        partId: PART, quantity: QTY,
        origin: { type: "MOBILE", locationId: truckId }, destination: { ...WH },
        idempotencyKey: "cw-g06-transfer-recovery",
      });
      check("G06 transfer created", created.ok, created.ok ? created.outcome.transferOrderNumber : `${created.code}: ${created.message}`);

      if (!created.ok) { process.exitCode = 1; }
      else {
        const id = created.outcome.transferOrderId;
        const dispatched = await transferAs(db, OP_CREATE, "dispatch", { transferOrderId: id });
        check("G06 transfer dispatched", dispatched.ok, dispatched.ok ? "IN_TRANSIT" : `${dispatched.code}`);

        const midway = await snapshot(db, "IN_TRANSIT", PART, truckId);
        check("G06 is STILL blocked while the stock is in transit",
          midway.fulfillable === false, `warehouse ${midway.warehouse}, short ${midway.warehouseShortage}`);

        const received = await transferAs(db, OP_RECEIVE, "receive", { transferOrderId: id });
        check("G06 transfer received by a second operator", received.ok,
          received.ok ? `${OP_RECEIVE} completed it` : `${received.code}`);

        const after = await snapshot(db, "AFTER", PART, truckId);
        console.log("\n" + render(after));

        const doc = await readTransfer(db, id);
        check("the transfer is COMPLETED", doc?.status === "COMPLETED", doc?.status);
        check("the donor truck gave up exactly the transferred quantity",
          after.sourceTruckHolding === before.sourceTruckHolding - QTY,
          `${before.sourceTruckHolding} -> ${after.sourceTruckHolding}`);
        check("warehouse availability rose by exactly the transferred quantity",
          after.warehouse === before.warehouse + QTY, `${before.warehouse} -> ${after.warehouse}`);
        check("COMPANY OWNERSHIP DID NOT CHANGE", after.company === before.company,
          `${before.company} -> ${after.company} -- nothing was created, only relocated`);
        check("the plan was not rewritten to make this work", after.planned === before.planned,
          `planned ${after.planned} throughout`);

        // ── The point of the scenario.
        check("G06 ends FULFILLABLE", after.fulfillable === true, `shortage ${after.warehouseShortage}`);
        check("the warehouse shortage is closed exactly, not over-corrected",
          after.warehouseShortage === 0 && after.warehouse === before.planned,
          `warehouse ${after.warehouse} against planned ${after.planned}`);

        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.writeFileSync(path.join(OUT_DIR, "g06-transfer-recovery.json"), JSON.stringify({
          before, inTransit: midway, after,
          transfer: { id, number: created.outcome.transferOrderNumber, quantity: QTY,
            origin: { type: "MOBILE", locationId: truckId }, destination: WH,
            actors: { create: OP_CREATE, dispatch: OP_CREATE, receive: OP_RECEIVE }, status: doc?.status },
        }, null, 2));
      }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} G06 checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
