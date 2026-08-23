#!/usr/bin/env node
// T01–T06 — the transfer scenarios, executed once against the real command family.
//
// Every figure is read back through the ledger after the fact. Nothing is asserted from the request
// that was sent, because the request is what the fixture BELIEVES and the ledger is what happened.
//
// EMULATOR OR eos-platform-sandbox, through the shared execution gate. Production is refused.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initializeApp, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

const { resolveExecutionTarget, describeTarget, ExecutionTargetRefused } =
  await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
const { setExecutionTarget } =
  await import(L("functions/scripts/certificationWorld/actorAuthority.mjs"));

const { transferAs, transferSnapshot, readTransfer, onHandAt } =
  await import(L("functions/scripts/certificationWorld/executeTransfer.mjs"));

const OUT_DIR = path.resolve(REPO, "field-ops-app-vite/.certification");
const WH = Object.freeze({ type: "WAREHOUSE", locationId: "wh-main" });
const TRUCK_A = Object.freeze({ type: "MOBILE", locationId: "cert-trk-04" });   // leanest truck

/** Transfer operators, both proven to hold all four capabilities. */
const OP_A = "cw-emp-029";
const OP_B = "cw-emp-043";
/** A real employee doing a nearby job with no transfer authority. */
const NO_AUTHORITY = "cw-emp-025";   // put-away operator / cycle-count counter

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`); };
const evidence = {};
const save = () => { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, "transfer-scenarios.json"), JSON.stringify(evidence, null, 2)); };

// THE ONE GATE. Emulator and eos-platform-sandbox only; production refused two ways; a live
// write additionally requires --apply-live-sandbox. See executionTarget.mjs.
let __target;
try {
  __target = resolveExecutionTarget();
  setExecutionTarget(__target);
} catch (err) {
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}
if (!__target) {
  // refused above
} else {
  console.log(describeTarget(__target));
  // Credentials follow the TARGET, not a hardcoded project. An emulator needs none; a live
  // project needs application-default credentials, and naming the project explicitly means the
  // app cannot silently initialize against whatever ADC happens to prefer.
  if (!getApps().length) {
    initializeApp(__target.isEmulator
      ? { projectId: __target.projectId }
      : { credential: applicationDefault(), projectId: __target.projectId });
  }
  const db = getFirestore();

  // A part with real warehouse depth, so a small transfer cannot disturb the Golden baseline.
  const T01_PART = "CW-P-0102";
  // A part genuinely carried on a truck -- FOUND, not chosen.
  //
  // The first version named a part and a truck it believed went together. cert-trk-05 does not
  // carry CW-P-0004, so both reverse-direction scenarios failed on the fixture's own assumption
  // rather than on anything the domain did. The world knows which truck holds what; ask it.
  const { allLedgerRows } = await import(L("functions/scripts/certificationWorld/ledgerMath.mjs"));
  const stockByTruckPart = new Map();
  for (const r of await allLedgerRows(db)) {
    if (r.location?.type !== "MOBILE") continue;
    const key = `${r.location.locationId}::${r.partId}`;
    const q = r.type === "ADJUSTED" ? Number(r.quantity)
      : r.type === "TRANSFER_IN" || r.type === "RECEIVED" || r.type === "RETURNED" ? Number(r.quantity)
        : r.type === "TRANSFER_OUT" || r.type === "SCRAPPED" ? -Number(r.quantity) : 0;
    stockByTruckPart.set(key, (stockByTruckPart.get(key) ?? 0) + q);
  }
  // GOLDEN PARTS ARE OFF LIMITS.
  //
  // The first selection took the deepest truck holding in the world, which was CW-P-0004 -- G04's
  // part. Moving 2 units to the warehouse pushed it back over its reorder point and the FALSE_COMFORT
  // condition disappeared from the catalog entirely. The transfer was correct, the accounting was
  // correct, and it quietly dismantled a Golden scenario as a side effect.
  //
  // A demonstration scenario must not be built out of the evidence another scenario depends on.
  const goldenParts = new Set();
  for (const d of (await db.collection("fieldops_wos").get()).docs) {
    for (const line of d.data().inventorySnapshot ?? []) goldenParts.add(line.partId);
  }

  // Deepest holding among parts no Golden scenario depends on.

  const [bestKey, bestQty] = [...stockByTruckPart]
    .filter(([k, q]) => q >= 3 && !goldenParts.has(k.split("::")[1]))
    .sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (!bestKey) { console.error("no truck carries 3+ of any part -- the reverse scenarios cannot run"); process.exitCode = 1; }
  const [SOURCE_TRUCK_ID, T02_PART] = (bestKey ?? "::").split("::");
  const SOURCE_TRUCK = Object.freeze({ type: "MOBILE", locationId: SOURCE_TRUCK_ID });
  console.log(`reverse-direction source, read from the ledger: ${SOURCE_TRUCK_ID} holds ${bestQty} x ${T02_PART}`);
  check("T01's part is not one a Golden scenario depends on", !goldenParts.has(T01_PART),
    `${T01_PART} -- asserted rather than assumed, because the assumption is what went wrong`);
  check("the reverse-direction part is not Golden either", Boolean(T02_PART) && !goldenParts.has(T02_PART), T02_PART);

  // ══ T01 — PARTS ROOM -> TRUCK ══════════════════════════════════════════════════════════════
  console.log("\n== T01  Parts Room -> Truck");
  const t01Before = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
  const QTY = 3;
  console.log(`   before: warehouse ${t01Before.origin}, truck ${t01Before.destination}, company(by location) ${t01Before.companyByLocation}`);

  const t01Create = await transferAs(db, OP_A, "create", {
    partId: T01_PART, quantity: QTY, origin: { ...WH }, destination: { ...TRUCK_A },
    idempotencyKey: "cw-t01-partsroom-to-truck",
  });
  check("T01 create is ACCEPTED", t01Create.ok, t01Create.ok ? t01Create.outcome.transferOrderNumber : `${t01Create.code}: ${t01Create.message}`);

  if (!t01Create.ok) { process.exitCode = 1; }
  else {
    const t01Id = t01Create.outcome.transferOrderId;
    const afterCreate = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    check("T01 creation alone moves NO stock", afterCreate.origin === t01Before.origin && afterCreate.destination === t01Before.destination,
      `warehouse ${afterCreate.origin}, truck ${afterCreate.destination} -- a request is not a movement`);
    check("T01 is REQUESTED after create", (await readTransfer(db, t01Id))?.status === "REQUESTED",
      (await readTransfer(db, t01Id))?.status);

    // ── T04, in the middle of T01: the intermediate state ────────────────────────────────────
    console.log("\n== T04  staged / in transit");
    const t01Dispatch = await transferAs(db, OP_A, "dispatch", { transferOrderId: t01Id });
    check("T04 dispatch is ACCEPTED", t01Dispatch.ok, t01Dispatch.ok ? "IN_TRANSIT" : `${t01Dispatch.code}: ${t01Dispatch.message}`);
    const inTransit = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    const stored = await readTransfer(db, t01Id);
    check("T04 the stored state is IN_TRANSIT", stored?.status === "IN_TRANSIT", stored?.status);
    check("T04 stock has LEFT the origin", inTransit.origin === t01Before.origin - QTY,
      `${t01Before.origin} -> ${inTransit.origin}`);
    check("T04 stock has NOT yet arrived", inTransit.destination === t01Before.destination,
      `truck still ${inTransit.destination}`);
    // THE HONEST CONSEQUENCE. In transit is a real place that a location sum does not model, so the
    // location total is temporarily LOWER. Stating it as a finding beats discovering it as a bug.
    check("T04 the location sum is temporarily LOWER by exactly the in-transit quantity",
      inTransit.companyByLocation === t01Before.companyByLocation - QTY,
      `${t01Before.companyByLocation} -> ${inTransit.companyByLocation}: in transit is neither origin nor destination`);
    evidence.T04 = { transferOrderId: t01Id, status: stored?.status, before: t01Before, inTransit };

    // ── T05, completing T01 ──────────────────────────────────────────────────────────────────
    console.log("\n== T05  completed transfer");
    const t01Receive = await transferAs(db, OP_B, "receive", { transferOrderId: t01Id });
    check("T05 receive is ACCEPTED, by a DIFFERENT operator", t01Receive.ok,
      t01Receive.ok ? `${OP_B} completed it` : `${t01Receive.code}: ${t01Receive.message}`);
    const t01After = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    const finalDoc = await readTransfer(db, t01Id);
    check("T05 the transfer is COMPLETED", finalDoc?.status === "COMPLETED", finalDoc?.status);
    check("T01 source decreased by exactly the quantity", t01After.origin === t01Before.origin - QTY,
      `${t01Before.origin} -> ${t01After.origin}`);
    check("T01 destination increased by exactly the quantity", t01After.destination === t01Before.destination + QTY,
      `${t01Before.destination} -> ${t01After.destination}`);
    check("T01 company total is UNCHANGED across the completed lifecycle",
      t01After.companyByLocation === t01Before.companyByLocation,
      `${t01Before.companyByLocation} -> ${t01After.companyByLocation}`);
    // ── The scope lesson, restated on real figures.
    check("T01 warehouse availability FELL while company ownership did not",
      t01After.warehouseAvailable < t01Before.warehouseAvailable
      && t01After.companyByLocation === t01Before.companyByLocation,
      `warehouse ${t01Before.warehouseAvailable} -> ${t01After.warehouseAvailable}, company ${t01After.companyByLocation} unchanged`);
    evidence.T01 = { transferOrderId: t01Id, number: t01Create.outcome.transferOrderNumber, part: T01_PART,
      origin: WH, destination: TRUCK_A, quantity: QTY, before: t01Before, after: t01After,
      actors: { create: OP_A, dispatch: OP_A, receive: OP_B }, status: finalDoc?.status };
    evidence.T05 = evidence.T01;

    // ── T13/T14 idempotency + conflict, on this completed transfer ───────────────────────────
    console.log("\n== idempotency and conflict");
    const replay = await transferAs(db, OP_B, "receive", { transferOrderId: t01Id });
    const afterReplay = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    check("replaying receive does not move stock again",
      afterReplay.origin === t01After.origin && afterReplay.destination === t01After.destination,
      replay.ok ? `outcome ${replay.outcome.outcome}` : `${replay.code}`);

    const conflict = await transferAs(db, OP_A, "create", {
      partId: T01_PART, quantity: QTY + 5, origin: { ...WH }, destination: { ...TRUCK_A },
      idempotencyKey: "cw-t01-partsroom-to-truck",
    });
    const afterConflict = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    check("the same idempotency key with a CHANGED quantity is REFUSED", !conflict.ok,
      conflict.ok ? "ACCEPTED -- the key is not protecting the payload" : `${conflict.code}: ${conflict.message}`);
    check("the refused conflict moved nothing",
      afterConflict.origin === t01After.origin && afterConflict.destination === t01After.destination, "unchanged");
    evidence.idempotency = { replay: replay.ok ? replay.outcome : replay, conflict: { code: conflict.code, message: conflict.message } };

    // ── Invalid transitions ──────────────────────────────────────────────────────────────────
    console.log("\n== invalid state transitions");
    const dispatchDone = await transferAs(db, OP_A, "dispatch", { transferOrderId: t01Id });
    check("dispatching a COMPLETED transfer is REFUSED", !dispatchDone.ok,
      dispatchDone.ok ? "ACCEPTED" : `${dispatchDone.code}: ${dispatchDone.message}`);
    const cancelDone = await transferAs(db, OP_A, "cancel", { transferOrderId: t01Id });
    check("cancelling a COMPLETED transfer is REFUSED", !cancelDone.ok,
      cancelDone.ok ? "ACCEPTED" : `${cancelDone.code}: ${cancelDone.message}`);
    evidence.invalidTransitions = { dispatchCompleted: dispatchDone.code, cancelCompleted: cancelDone.code };
  }

  // ══ T02 — TRUCK -> PARTS ROOM ══════════════════════════════════════════════════════════════
  console.log("\n== T02  Truck -> Parts Room");
  const truckHolding = await onHandAt(db, T02_PART, SOURCE_TRUCK);
  const t02Before = await transferSnapshot(db, T02_PART, SOURCE_TRUCK, WH);
  const T02_QTY = Math.min(2, truckHolding);
  console.log(`   ${T02_PART} on ${SOURCE_TRUCK.locationId}: ${truckHolding}; returning ${T02_QTY}`);
  if (T02_QTY <= 0) {
    check("T02 the chosen truck actually carries the part", false, `${SOURCE_TRUCK.locationId} holds ${truckHolding}`);
  } else {
    const c = await transferAs(db, OP_B, "create", {
      partId: T02_PART, quantity: T02_QTY, origin: { ...SOURCE_TRUCK }, destination: { ...WH },
      idempotencyKey: "cw-t02-truck-to-partsroom",
    });
    check("T02 create is ACCEPTED", c.ok, c.ok ? c.outcome.transferOrderNumber : `${c.code}: ${c.message}`);
    if (c.ok) {
      const id = c.outcome.transferOrderId;
      const d = await transferAs(db, OP_B, "dispatch", { transferOrderId: id });
      const r = await transferAs(db, OP_A, "receive", { transferOrderId: id });
      check("T02 dispatch + receive accepted", d.ok && r.ok, `${d.ok ? "dispatched" : d.code} / ${r.ok ? "received" : r.code}`);
      const t02After = await transferSnapshot(db, T02_PART, SOURCE_TRUCK, WH);
      check("T02 truck decreased by exactly the quantity", t02After.origin === t02Before.origin - T02_QTY,
        `${t02Before.origin} -> ${t02After.origin}`);
      check("T02 warehouse increased by exactly the quantity", t02After.destination === t02Before.destination + T02_QTY,
        `${t02Before.destination} -> ${t02After.destination}`);
      check("T02 company total unchanged", t02After.companyByLocation === t02Before.companyByLocation,
        `${t02Before.companyByLocation} -> ${t02After.companyByLocation}`);
      check("T02 warehouse availability ROSE without the company owning any more",
        t02After.warehouseAvailable > t02Before.warehouseAvailable
        && t02After.companyByLocation === t02Before.companyByLocation,
        `warehouse ${t02Before.warehouseAvailable} -> ${t02After.warehouseAvailable}`);
      evidence.T02 = { transferOrderId: id, number: c.outcome.transferOrderNumber, part: T02_PART,
        origin: SOURCE_TRUCK, destination: WH, quantity: T02_QTY, before: t02Before, after: t02After,
        actors: { create: OP_B, dispatch: OP_B, receive: OP_A } };
    }
  }

  // ══ T03 — INSUFFICIENT SOURCE ══════════════════════════════════════════════════════════════
  console.log("\n== T03  insufficient source");
  const t03Before = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
  const tooMuch = t03Before.origin + 1000;
  const t03 = await transferAs(db, OP_A, "create", {
    partId: T01_PART, quantity: tooMuch, origin: { ...WH }, destination: { ...TRUCK_A },
    idempotencyKey: "cw-t03-insufficient",
  });
  const t03After = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
  check("T03 an over-sized transfer is REFUSED", !t03.ok,
    t03.ok ? "ACCEPTED" : `${t03.code}: ${t03.message} (asked ${tooMuch}, held ${t03Before.origin})`);
  check("T03 the refusal mutated nothing",
    t03After.origin === t03Before.origin && t03After.destination === t03Before.destination
    && t03After.companyByLocation === t03Before.companyByLocation, "unchanged");
  evidence.T03 = { requested: tooMuch, available: t03Before.origin, code: t03.code, message: t03.message };

  // ══ T06 — TRUCK -> TRUCK ═══════════════════════════════════════════════════════════════════
  //
  // SUPPORTED, and established by reading the contract rather than by hoping. The endpoint fence is
  // WAREHOUSE|MOBILE for both ends and the only endpoint refusal is same_location, so MOBILE ->
  // MOBILE is a legal pair. It is executed here rather than assumed.
  console.log("\n== T06  Truck -> Truck");
  const t06Holding = await onHandAt(db, T02_PART, SOURCE_TRUCK);
  const T06_QTY = Math.min(1, t06Holding);
  const t06Before = await transferSnapshot(db, T02_PART, SOURCE_TRUCK, TRUCK_A);
  if (T06_QTY <= 0) {
    check("T06 source truck carries the part", false, `${SOURCE_TRUCK.locationId} holds ${t06Holding}`);
  } else {
    const c = await transferAs(db, OP_A, "create", {
      partId: T02_PART, quantity: T06_QTY, origin: { ...SOURCE_TRUCK }, destination: { ...TRUCK_A },
      idempotencyKey: "cw-t06-truck-to-truck",
    });
    check("T06 Truck -> Truck is SUPPORTED by the domain", c.ok,
      c.ok ? c.outcome.transferOrderNumber : `${c.code}: ${c.message}`);
    if (c.ok) {
      const id = c.outcome.transferOrderId;
      await transferAs(db, OP_A, "dispatch", { transferOrderId: id });
      const r = await transferAs(db, OP_B, "receive", { transferOrderId: id });
      const t06After = await transferSnapshot(db, T02_PART, SOURCE_TRUCK, TRUCK_A);
      check("T06 completes without passing through a warehouse", r.ok, r.ok ? "COMPLETED" : `${r.code}`);
      check("T06 source truck decreased", t06After.origin === t06Before.origin - T06_QTY,
        `${t06Before.origin} -> ${t06After.origin}`);
      check("T06 destination truck increased", t06After.destination === t06Before.destination + T06_QTY,
        `${t06Before.destination} -> ${t06After.destination}`);
      check("T06 company total unchanged", t06After.companyByLocation === t06Before.companyByLocation,
        `${t06Before.companyByLocation} -> ${t06After.companyByLocation}`);
      check("T06 warehouse availability was NOT touched",
        t06After.warehouseAvailable === t06Before.warehouseAvailable,
        `${t06After.warehouseAvailable} -- no hidden warehouse hop`);
      evidence.T06 = { supported: true, transferOrderId: id, number: c.outcome.transferOrderNumber,
        part: T02_PART, origin: SOURCE_TRUCK, destination: TRUCK_A, quantity: T06_QTY,
        before: t06Before, after: t06After };
    }
  }

  // ══ CANCEL ═════════════════════════════════════════════════════════════════════════════════
  console.log("\n== cancel, and what it may not undo");
  const cx = await transferAs(db, OP_A, "create", {
    partId: T01_PART, quantity: 1, origin: { ...WH }, destination: { ...TRUCK_A },
    idempotencyKey: "cw-tcancel-before-dispatch",
  });
  if (cx.ok) {
    const id = cx.outcome.transferOrderId;
    const beforeCancel = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    const cancelled = await transferAs(db, OP_B, "cancel", { transferOrderId: id });
    const doc = await readTransfer(db, id);
    const afterCancel = await transferSnapshot(db, T01_PART, WH, TRUCK_A);
    check("a REQUESTED transfer can be cancelled", cancelled.ok, cancelled.ok ? doc?.status : `${cancelled.code}`);
    check("cancellation is the canonical CANCELLED state", doc?.status === "CANCELLED", doc?.status);
    check("cancelling moved no stock", afterCancel.origin === beforeCancel.origin && afterCancel.destination === beforeCancel.destination,
      "nothing had moved yet -- cancel is only legal before dispatch");
    const reanimate = await transferAs(db, OP_A, "dispatch", { transferOrderId: id });
    check("a CANCELLED transfer cannot be dispatched", !reanimate.ok,
      reanimate.ok ? "ACCEPTED" : `${reanimate.code}: ${reanimate.message}`);
    const receiveCancelled = await transferAs(db, OP_A, "receive", { transferOrderId: id });
    check("a CANCELLED transfer cannot be received", !receiveCancelled.ok,
      receiveCancelled.ok ? "ACCEPTED" : `${receiveCancelled.code}: ${receiveCancelled.message}`);
    evidence.cancel = { transferOrderId: id, status: doc?.status, dispatchAfterCancel: reanimate.code, receiveAfterCancel: receiveCancelled.code };
  }

  // ══ AUTHORIZATION NEGATIVE ═════════════════════════════════════════════════════════════════
  console.log("\n== authorization");
  const denied = await transferAs(db, NO_AUTHORITY, "create", {
    partId: T01_PART, quantity: 1, origin: { ...WH }, destination: { ...TRUCK_A },
    idempotencyKey: "cw-tdenied-no-authority",
  });
  check(`${NO_AUTHORITY} (put-away / counter) is REFUSED a transfer`, !denied.ok && denied.code === "PERMISSION_DENIED",
    denied.ok ? "ACCEPTED" : `${denied.code}: ${denied.message}`);
  const orders = await db.collection("transfer_orders").where("idempotencyKey", "==", "cw-tdenied-no-authority").get();
  check("the refused attempt wrote no transfer order", orders.empty, `${orders.size} order(s)`);
  evidence.authorization = { deniedEmployee: NO_AUTHORITY, code: denied.code };

  save();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} transfer checks passed`);
  if (failed.length) { console.log("FAILED:\n  " + failed.map((f) => f.name).join("\n  ")); process.exitCode = 1; }
}
