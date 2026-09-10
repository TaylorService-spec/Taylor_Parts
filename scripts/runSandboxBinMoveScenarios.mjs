#!/usr/bin/env node
// BIN RELEASE QUICK GATE -- BIN-P6 relocation + BIN-P4 Roles, run as REAL personas against the REAL
// deployed callables in eos-platform-sandbox. Reuses the scanner scenario harness (sign-in, callAs,
// expectAllowed/expectRefused) -- no second harness.
//
// Run AFTER the sandbox release is live and the persona grants below are applied:
//   node scripts/runSandboxBinMoveScenarios.mjs
//
// PRECONDITION GRANTS (governed grantRole path, operator-applied -- this script grants nothing):
//   partsAssociate  + inventoryStockRelocationOperator   (already holds inventoryPutAwayOperator -> both)
//   technician      + inventoryTransferReceiver
//   partsManager    unchanged: put-away WITHOUT relocation -- the "put-away alone is refused" persona
//   warehouseManager unchanged: inventoryTransferOperator -- the custody-boundary persona
//
// What is proved at the API here, and what is proved elsewhere:
//   API (this script)       gate items 1-3, 6-8, 10-17 of the Owner's Quick Gate
//   client + handheld       items 4, 5, 9 (session batching, repeated-scan aggregation, retry of only
//                           technical failures) live in the Move stock screen and are exercised by
//                           field-ops-app-vite/test/moveStockScan.test.jsx and the handheld pass
//   Receiving regression    item 18: re-run scripts/runSandboxScannerScenarios.mjs scenario 5
//
// Creates its own bins through the governed createBin command. Moves only small quantities, and puts
// every relocated unit back where it came from at the end. Sandbox only; the harness refuses production.
import { callAs, expectRefused, expectAllowed, record, results } from "./sandboxScannerScenarios.mjs";

const WH = "wh-main";
const WH_OTHER = "wh-north";
const PART = "PRT-1001";
const PART_B = "PRT-1002";
const SERIAL_PART = "PRT-2001";
const TRUCK = "mobile-seed1786749487428-101";
const RUN = `m${Date.now()}`;
const ref = (type, locationId) => ({ type, locationId });
const key = (tag) => `${tag}-${RUN}`;

const onHand = async (partId) => {
  const r = await callAs("admin", "getPartBalance", { partId });
  return r.ok ? r.result?.onHand : null;
};

console.log(`BIN RELEASE QUICK GATE -- run ${RUN}\n`);

// ═════════ setup: bins through the governed command ═════════
async function makeBin(warehouseId, position) {
  const r = await callAs("admin", "createBin", { warehouseId, area: "QG", aisle: "Z", bay: 1, position, idempotencyKey: key(`qgbin-${warehouseId}-${position}`) });
  console.log(`   createBin ${warehouseId} QG-Z01-${position}:`, r.ok ? r.result.outcome : `${r.code} ${String(r.message ?? "").slice(0, 80)}`);
  return r.ok ? r.result.binId : null;
}
const A = await makeBin(WH, Number(RUN.slice(-4)) % 900 + 1);
const B = await makeBin(WH, Number(RUN.slice(-4)) % 900 + 2);
const N = await makeBin(WH_OTHER, Number(RUN.slice(-4)) % 900 + 1);
if (!A || !B || !N) {
  record("setup", "admin", "three bins", "bin creation failed", false, "cannot proceed");
  process.exit(1);
}
const aggBefore = await onHand(PART);
const aggBeforeB = await onHand(PART_B);

// ═════════ 1-3. the three relocation shapes ═════════
console.log("\n-- 1-3. Warehouse -> Bin -> Bin -> Warehouse --");
await expectAllowed("1 Warehouse -> Bin", "partsAssociate", "relocateStock",
  { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", A), quantity: 2, idempotencyKey: key("r1") },
  (r) => (r.outcome === "relocated" ? true : `got ${r.outcome}`));
await expectAllowed("2 Bin -> Bin", "partsAssociate", "relocateStock",
  { partId: PART, source: ref("BIN", A), destination: ref("BIN", B), quantity: 1, idempotencyKey: key("r2") },
  (r) => (r.outcome === "relocated" ? true : `got ${r.outcome}`));
await expectAllowed("3 Bin -> Warehouse", "partsAssociate", "relocateStock",
  { partId: PART, source: ref("BIN", B), destination: ref("WAREHOUSE", WH), quantity: 1, idempotencyKey: key("r3") },
  (r) => (r.outcome === "relocated" ? true : `got ${r.outcome}`));
const aggMid = await onHand(PART);
record("1-3 Warehouse aggregate unchanged by relocation", "admin", aggBefore, aggMid, aggBefore !== null && aggBefore === aggMid, "conservation");

// ═════════ 4. several parts, concurrently (the batch shape the screen sends) ═════════
console.log("\n-- 4. several NONE parts at once --");
const [l1, l2] = await Promise.all([
  callAs("partsAssociate", "relocateStock", { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", A), quantity: 1, idempotencyKey: key("b1") }),
  callAs("partsAssociate", "relocateStock", { partId: PART_B, source: ref("WAREHOUSE", WH), destination: ref("BIN", A), quantity: 1, idempotencyKey: key("b2") }),
]);
record("4 two parts, two lines, both governed", "partsAssociate", "relocated x2",
  `${l1.ok ? l1.result.outcome : l1.code} / ${l2.ok ? l2.result.outcome : l2.code}`, l1.ok && l2.ok);

// ═════════ 6-7. serialized ═════════
console.log("\n-- 6-7. serialized --");
const eq = await callAs("admin", "getAvailableEquipment", { partId: SERIAL_PART });
const unit = eq.ok ? (eq.result.availableEquipment ?? []).find((u) => u.currentLocationId === WH) : null;
if (!unit) {
  record("6 serialized relocation", "partsAssociate", "a unit at wh-main", "no available unit at wh-main", false, "seed a serialized unit to exercise 6-7");
} else {
  await expectAllowed("6 serialized relocation", "partsAssociate", "relocateStock",
    { partId: SERIAL_PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", A), serialNumbers: [unit.serialNo], idempotencyKey: key("s1") },
    (r) => (r.outcome === "relocated" ? true : `got ${r.outcome}`));
  await expectRefused("7 the same serial cannot move from where it no longer is", "partsAssociate", "relocateStock",
    { partId: SERIAL_PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", B), serialNumbers: [unit.serialNo], idempotencyKey: key("s2") },
    "validation", "SERIAL_NOT_AT_SOURCE");
  await expectRefused("7 a serial listed twice is refused", "partsAssociate", "relocateStock",
    { partId: SERIAL_PART, source: ref("BIN", A), destination: ref("BIN", B), serialNumbers: [unit.serialNo, unit.serialNo], idempotencyKey: key("s3") },
    "validation", "duplicate serial in one request");
  await callAs("partsAssociate", "relocateStock", { partId: SERIAL_PART, source: ref("BIN", A), destination: ref("WAREHOUSE", WH), serialNumbers: [unit.serialNo], idempotencyKey: key("s-back") });
}

// ═════════ 8. a failing line does not stop its siblings ═════════
console.log("\n-- 8. partial line failure --");
const [ok8, bad8] = await Promise.all([
  callAs("partsAssociate", "relocateStock", { partId: PART, source: ref("BIN", A), destination: ref("BIN", B), quantity: 1, idempotencyKey: key("p1") }),
  callAs("partsAssociate", "relocateStock", { partId: PART, source: ref("BIN", B), destination: ref("BIN", A), quantity: 999999, idempotencyKey: key("p2") }),
]);
record("8 one line moves, the insufficient one is refused alone", "partsAssociate", "relocated + refused",
  `${ok8.ok ? ok8.result.outcome : ok8.code} + ${bad8.ok ? "ALLOWED" : bad8.code}`, ok8.ok && !bad8.ok && !String(bad8.code).includes("permission"));

// ═════════ 10. replay moves nothing twice ═════════
console.log("\n-- 10. already-applied line --");
const again = await callAs("partsAssociate", "relocateStock", { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", A), quantity: 2, idempotencyKey: key("r1") });
record("10 the same key replays and writes nothing", "partsAssociate", "replayed", again.ok ? again.result.outcome : again.code, again.ok && again.result.outcome === "replayed");

// ═════════ 11-13. custody boundaries ═════════
console.log("\n-- 11-13. relocation vs Transfer --");
await expectRefused("11 a same-warehouse 'transfer' is refused (use relocation)", "warehouseManager", "createTransferOrder",
  { partId: PART, quantity: 1, origin: ref("WAREHOUSE", WH), destination: ref("BIN", A), idempotencyKey: key("t11") },
  "validation", "SAME_CUSTODY_PARENT");
await expectRefused("12 relocation refuses a cross-warehouse move", "partsAssociate", "relocateStock",
  { partId: PART, source: ref("BIN", A), destination: ref("BIN", N), quantity: 1, idempotencyKey: key("x12") },
  "validation", "CROSS_WAREHOUSE");
const t12 = await callAs("warehouseManager", "createTransferOrder",
  { partId: PART, quantity: 1, origin: ref("BIN", A), destination: ref("WAREHOUSE", WH_OTHER), idempotencyKey: key("t12") });
record("12 Bin -> other warehouse is a Transfer", "warehouseManager", "created", t12.ok ? "created" : t12.code, t12.ok, t12.ok ? "" : String(t12.message ?? "").slice(0, 90));
if (t12.ok) await callAs("warehouseManager", "cancelTransferOrder", { transferOrderId: t12.result.transferOrderId });
const t13 = await callAs("warehouseManager", "createTransferOrder",
  { partId: PART, quantity: 1, origin: ref("WAREHOUSE", WH), destination: ref("MOBILE", TRUCK), idempotencyKey: key("t13") });
record("13 truck route is a Transfer", "warehouseManager", "created", t13.ok ? "created" : t13.code, t13.ok, t13.ok ? "" : String(t13.message ?? "").slice(0, 90));

// ═════════ 14-17. authority ═════════
console.log("\n-- 14-17. Roles --");
await expectAllowed("14 put-away needs BOTH Roles -- holder of both succeeds", "partsAssociate", "relocateStock",
  { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", B), quantity: 1, recordPlacement: true, idempotencyKey: key("pa14") },
  (r) => (r.outcome === "relocated" && (r.placementIds ?? []).length === 1 ? true : `got ${r.outcome}, placements ${r.placementIds?.length}`));
await expectRefused("15 put-away Role alone cannot relocate", "partsManager", "relocateStock",
  { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", B), quantity: 1, recordPlacement: true, idempotencyKey: key("pa15") },
  "gate", "placement authority is not movement authority");
await expectRefused("16 technician without the Role cannot relocate", "technician", "relocateStock",
  { partId: PART, source: ref("WAREHOUSE", WH), destination: ref("BIN", B), quantity: 1, idempotencyKey: key("t16") },
  "gate", "job title grants nothing");
for (const [name, data] of [
  ["createTransferOrder", { partId: PART, quantity: 1, origin: ref("WAREHOUSE", WH), destination: ref("MOBILE", TRUCK), idempotencyKey: key("t17c") }],
  ["dispatchTransferOrder", { transferOrderId: t13.ok ? t13.result.transferOrderId : "to-none" }],
  ["cancelTransferOrder", { transferOrderId: t13.ok ? t13.result.transferOrderId : "to-none" }],
]) {
  await expectRefused(`17 receiver cannot ${name.replace("TransferOrder", "")}`, "technician", name, data, "gate", "receive-only Role");
}
if (t13.ok) {
  const d = await callAs("warehouseManager", "dispatchTransferOrder", { transferOrderId: t13.result.transferOrderId });
  record("17 (setup) dispatch to the truck", "warehouseManager", "dispatched", d.ok ? "dispatched" : d.code, d.ok);
  if (d.ok) {
    await expectAllowed("17 technician holding the receiver Role receives the truck handoff", "technician", "receiveTransferOrder",
      { transferOrderId: t13.result.transferOrderId });
  }
}

// ═════════ put everything back ═════════
console.log("\n-- cleanup: return relocated stock to the floor --");
for (const [partId, bin] of [[PART, A], [PART, B], [PART_B, A]]) {
  for (let i = 0; i < 6; i += 1) {
    const r = await callAs("partsAssociate", "relocateStock", { partId, source: ref("BIN", bin), destination: ref("WAREHOUSE", WH), quantity: 1, idempotencyKey: key(`back-${partId}-${bin}-${i}`) });
    if (!r.ok) break;
  }
}
const aggAfter = await onHand(PART);
const aggAfterB = await onHand(PART_B);
const truckOut = t13.ok ? 1 : 0;
record("aggregate conserved end to end (net of the one truck handoff)", "admin",
  `${aggBefore} / ${aggBeforeB}`, `${aggAfter} (+${truckOut} on truck) / ${aggAfterB}`,
  aggBefore === aggAfter + truckOut && aggBeforeB === aggAfterB);

const pass = results.filter((r) => r.pass).length;
console.log(`\n${"=".repeat(70)}\n${pass}/${results.length} checks passed`);
for (const f of results.filter((r) => !r.pass)) console.log(`  FAIL [${f.scenario}] ${f.persona}: expected ${f.expected}, got ${f.actual} -- ${f.note}`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
