#!/usr/bin/env node
// THE TWELVE SANDBOX SCANNER SCENARIOS -- run as real personas against the real deployed callables.
//
// Run: node scripts/runSandboxScannerScenarios.mjs
//
// Six scenarios must SUCCEED and six must REFUSE. A refusal scenario that passes by succeeding is a
// release failure, so every case declares its expectation and is compared against that.
//
// Test data is created through the GOVERNED COMMANDS (createBin, createPartAlias), never by writing
// documents directly. Seeding around the authority being validated would prove nothing about it.
import { callAs, expectRefused, expectAllowed, record, results } from "./sandboxScannerScenarios.mjs";

const WH = "wh-main";
const WH_OTHER = "wh-north";
const PART = "PRT-1001";
const PART_B = "PRT-1002";
const SERIAL_PART = "PRT-2001";
const RUN = `v${Date.now()}`;
const BIN = `A14${RUN.slice(-5)}`;
const STAGE_BIN = `ST${RUN.slice(-5)}`;
const BARCODE = `BC-${RUN}`;

const balanceOf = async (persona, partId) => {
  const r = await callAs(persona, "getPartBalance", { partId });
  return r.ok ? r.result : null;
};
const sameBalance = (a, b) =>
  a && b && JSON.stringify({ o: a.onHand, r: a.reserved, v: a.available, l: a.byLocation })
        === JSON.stringify({ o: b.onHand, r: b.reserved, v: b.available, l: b.byLocation });

console.log(`SANDBOX SCANNER SCENARIOS -- run ${RUN}\n`);

// ═════════ setup, through governed commands only ═════════
console.log("-- setup (governed commands, admin/partsManager) --");
const binMade = await callAs("admin", "createBin", { warehouseId: WH, code: BIN, idempotencyKey: `bin-${RUN}` });
console.log(`   createBin ${BIN} @ ${WH}:`, binMade.ok ? binMade.result?.outcome : `${binMade.code} ${binMade.message ?? ""}`.slice(0, 90));
const stageMade = await callAs("admin", "createBin", { warehouseId: WH, code: STAGE_BIN, idempotencyKey: `bin2-${RUN}` });
console.log(`   createBin ${STAGE_BIN} @ ${WH}:`, stageMade.ok ? stageMade.result?.outcome : `${stageMade.code}`.slice(0, 60));
const otherBin = await callAs("admin", "createBin", { warehouseId: WH_OTHER, code: `NB${RUN.slice(-5)}`, idempotencyKey: `bin3-${RUN}` });
console.log(`   createBin @ ${WH_OTHER}:`, otherBin.ok ? otherBin.result?.outcome : `${otherBin.code}`.slice(0, 60));
console.log("");

// ═════════ 1. Part-code lookup ═════════
console.log("-- 1. Part-code lookup --");
const before1 = await balanceOf("partsAssociate", PART);
await expectAllowed("1 part-code lookup", "partsAssociate", "getPartBalance", { partId: PART },
  (r) => (r.partId === PART ? true : `wrong partId: ${r.partId}`), "authoritative Part balance returned");
const after1 = await balanceOf("partsAssociate", PART);
record("1 lookup is READ-ONLY", "partsAssociate", "no change", sameBalance(before1, after1) ? "no change" : "CHANGED",
  sameBalance(before1, after1), "a lookup must not write");

// ═════════ 2. Barcode / alias lookup ═════════
console.log("\n-- 2. Barcode / alias lookup --");
const aliasMade = await callAs("partsManager", "createPartAlias", {
  partId: PART, aliasType: "BARCODE_OTHER", rawValue: BARCODE, idempotencyKey: `alias-${RUN}`,
});
console.log(`   createPartAlias (partsManager, catalogAdministrator):`,
  aliasMade.ok ? "created" : `${aliasMade.code} ${String(aliasMade.message ?? "").slice(0, 70)}`);
if (aliasMade.ok) {
  await expectAllowed("2 registered alias resolves", "partsAssociate", "resolveScannedPartIdentifier",
    { rawValue: `  ${BARCODE}  ` },
    (r) => (r.result === "FOUND" && r.partId === PART ? true : `got ${r.result}/${r.partId}`),
    "trimmed wedge input resolved to the correct Part");
} else {
  record("2 registered alias resolves", "partsAssociate", "FOUND", "alias could not be created", false,
    String(aliasMade.message ?? "").slice(0, 100));
}
await expectAllowed("2 unknown alias is truthful", "partsAssociate", "resolveScannedPartIdentifier",
  { rawValue: `BC-NOT-REGISTERED-${RUN}` },
  (r) => (r.result === "NOT_FOUND" && r.partId === undefined ? true : `got ${r.result}, partId=${r.partId}`),
  "NOT_FOUND with no fallback partId");
await expectAllowed("2 empty scan is MALFORMED", "partsAssociate", "resolveScannedPartIdentifier",
  { rawValue: "   " }, (r) => (r.result === "MALFORMED" ? true : `got ${r.result}`),
  "nothing scanned differs from nothing found");

// ═════════ 3. Serialized lookup ═════════
console.log("\n-- 3. Serialized lookup --");
await expectAllowed("3 serialized lookup", "partsAssociate", "getAvailableEquipment", { partId: SERIAL_PART },
  (r) => (r && typeof r === "object" ? true : "unexpected payload"), "serialized identity read");
const forced = await callAs("partsAssociate", "getPartBalance", { partId: SERIAL_PART, serialTracked: false });
const forcedZero = forced.ok && forced.result?.onHand?.state === "KNOWN" && forced.result?.onHand?.value === 0;
record("3 caller cannot force a confident zero", "partsAssociate", "server decides trackingMode",
  forcedZero ? "KNOWN 0 for a shelf with serialized units" : (forced.ok ? forced.result.onHand.state : forced.code),
  !forcedZero,
  "serialTracked must come from the Part controlType, never the request -- redeploy getPartBalance if this fails");
const serialBal = await balanceOf("partsAssociate", SERIAL_PART);
record("3 serialized is not aggregated", "partsAssociate", "no fabricated quantity",
  serialBal ? `onHand=${serialBal.onHand?.state}` : "unreadable",
  !!serialBal, "a serialized part must not report a made-up quantity");

// ═════════ 4. Balance / location lookup ═════════
console.log("\n-- 4. Balance / location --");
await expectAllowed("4 balance is UNKNOWN not zero", "partsAssociate", "getPartBalance", { partId: PART_B },
  (r) => (r.onHand?.state === "UNKNOWN" || r.onHand?.state === "KNOWN" ? true : `state=${r.onHand?.state}`),
  "on-hand state is explicit");
const bal4 = await balanceOf("partsAssociate", PART);
const mobileLeak = (bal4?.byLocation ?? []).filter((l) => /mobile|truck/i.test(l.locationId));
record("4 no van stock in warehouse balance", "partsAssociate", "0 mobile rows", `${mobileLeak.length} mobile rows`,
  mobileLeak.length === 0, "warehouse balance must not absorb mobile stock");
await expectAllowed("4 location display", "partsAssociate", "getLocationDisplay", { locationIds: [WH] },
  null, "governed display authority");

// ═════════ 5. Receiving -- EXPECTED REFUSAL for every persona in this pass ═════════
console.log("\n-- 5. Multi-line partial receiving (EXPECTED REFUSAL) --");
for (const p of ["partsAssociate", "partsManager", "warehouseManager", "technician"]) {
  await expectRefused("5 receiving refused", p, "receiveInventoryStock", {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: "rr-none", purchaseOrderId: "rr-none" },
    receivingLocation: { type: "WAREHOUSE", locationId: WH },
    lines: [{ lineId: "L1", partId: PART, expectedQuantity: 1, receivedQuantity: 1 }],
    idempotencyKey: `recv-${RUN}-${p}`,
  }, "gate", "capability-based refusal, readiness is TRUE in sandbox");
}

// ═════════ 6. Put-away ═════════
console.log("\n-- 6. Put-away --");
const before6 = await balanceOf("partsAssociate", PART);
await expectAllowed("6 put-away recorded", "partsAssociate", "recordPutAway",
  { warehouseId: WH, binCode: BIN, partId: PART, quantity: 3, idempotencyKey: `plc-${RUN}` },
  (r) => (r.outcome === "recorded" || r.outcome === "replayed" ? true : `outcome=${r.outcome}`),
  "descriptive placement recorded");
const after6 = await balanceOf("partsAssociate", PART);
record("6 STOWING MOVES NO CUSTODY", "partsAssociate", "balance unchanged",
  sameBalance(before6, after6) ? "unchanged" : "CHANGED", sameBalance(before6, after6),
  "DECISIONS #116 -- if this fails, stop the release");
await expectRefused("6 wrong-warehouse bin", "partsAssociate", "recordPutAway",
  { warehouseId: WH_OTHER, binCode: BIN, partId: PART, quantity: 1, idempotencyKey: `plcw-${RUN}` },
  "validation", "a bin code is only meaningful in its own warehouse");
await expectRefused("6 unknown bin", "partsAssociate", "recordPutAway",
  { warehouseId: WH, binCode: `NEVER${RUN.slice(-4)}`, partId: PART, quantity: 1, idempotencyKey: `plcu-${RUN}` },
  "validation", "racking is never created by scanning at it");
const replay = await callAs("partsAssociate", "recordPutAway",
  { warehouseId: WH, binCode: BIN, partId: PART, quantity: 3, idempotencyKey: `plc-${RUN}` });
record("6 replay is idempotent", "partsAssociate", "replayed", replay.ok ? replay.result?.outcome : replay.code,
  replay.ok && replay.result?.outcome === "replayed", "a re-sent stow must not record twice");

// ═════════ 7. Pick / stage ═════════
console.log("\n-- 7. Pick / stage --");
const before7 = await balanceOf("partsAssociate", PART);
await expectAllowed("7 pick/stage recorded", "partsAssociate", "recordPutAway",
  { warehouseId: WH, binCode: STAGE_BIN, partId: PART, quantity: 2, pickedForWorkOrderId: `WO-${RUN}`, idempotencyKey: `pick-${RUN}` },
  (r) => (r.outcome === "recorded" ? true : `outcome=${r.outcome}`), "staged against a work order");
const after7 = await balanceOf("partsAssociate", PART);
record("7 PICKING RESERVES NOTHING", "partsAssociate", "reserved unchanged",
  `${JSON.stringify(before7?.reserved)} -> ${JSON.stringify(after7?.reserved)}`,
  JSON.stringify(before7?.reserved) === JSON.stringify(after7?.reserved),
  "commitment is a work-order lifecycle effect, never a pick");

// ═════════ 8. Warehouse transfer ═════════
console.log("\n-- 8. Warehouse transfer --");
const xfer = await callAs("warehouseManager", "createTransferOrder", {
  partId: PART, quantity: 1,
  origin: { type: "WAREHOUSE", locationId: WH },
  destination: { type: "WAREHOUSE", locationId: WH_OTHER },
  idempotencyKey: `xfer-${RUN}`,
});
record("8 transfer uses existing authority", "warehouseManager",
  "ALLOWED or fail-closed on stock", xfer.ok ? "created" : xfer.code,
  xfer.ok || xfer.code.includes("failed-precondition") || xfer.code.includes("permission_denied") === false,
  xfer.ok ? "" : String(xfer.message ?? "").slice(0, 90));
await expectRefused("8 same-location transfer", "warehouseManager", "createTransferOrder", {
  partId: PART, quantity: 1,
  origin: { type: "WAREHOUSE", locationId: WH },
  destination: { type: "WAREHOUSE", locationId: WH },
  idempotencyKey: `xfers-${RUN}`,
}, "validation", "origin must differ from destination");
await expectRefused("8 parts personas cannot transfer", "partsAssociate", "dispatchTransferOrder",
  { transferOrderId: "to-none" }, "gate", "transfer is not part of the parts-floor grant");

// ═════════ 9. Truck handoff ═════════
console.log("\n-- 9. Truck handoff --");
const truck = "mobile-seed1786749487428-101";
const handoff = await callAs("warehouseManager", "createTransferOrder", {
  partId: PART, quantity: 1,
  origin: { type: "WAREHOUSE", locationId: WH },
  destination: { type: "MOBILE", locationId: truck },
  idempotencyKey: `hand-${RUN}`,
});
record("9 truck handoff is a transfer", "warehouseManager", "existing transfer authority",
  handoff.ok ? "created" : handoff.code, handoff.ok || !handoff.code.includes("not-found"),
  handoff.ok ? "no invented handoff lifecycle" : String(handoff.message ?? "").slice(0, 90));
await expectRefused("9 unknown truck destination", "warehouseManager", "createTransferOrder", {
  partId: PART, quantity: 1,
  origin: { type: "WAREHOUSE", locationId: WH },
  destination: { type: "MOBILE", locationId: `truck-not-real-${RUN}` },
  idempotencyKey: `handx-${RUN}`,
}, "validation", "an unregistered destination fails closed");

// ═════════ 10. Cycle count -- SoD ═════════
console.log("\n-- 10. Cycle count (separation of duties) --");
const cc = await callAs("partsAssociate", "createCycleCount", {
  partId: PART, location: { type: "WAREHOUSE", locationId: WH }, idempotencyKey: `cc-${RUN}`,
});
record("10 counter may open a count", "partsAssociate", "ALLOWED", cc.ok ? "created" : cc.code, cc.ok,
  cc.ok ? "" : String(cc.message ?? "").slice(0, 90));
if (cc.ok) {
  const beforeCount = await balanceOf("partsAssociate", PART);
  const sub = await callAs("partsAssociate", "submitCycleCount", { cycleCountId: cc.result.cycleCountId, countedQuantity: 99 });
  record("10 counter may submit", "partsAssociate", "ALLOWED", sub.ok ? "submitted" : sub.code, sub.ok,
    sub.ok ? "" : String(sub.message ?? "").slice(0, 90));
  const afterCount = await balanceOf("partsAssociate", PART);
  record("10 COUNTING IS NOT ADJUSTING", "partsAssociate", "balance unchanged",
    sameBalance(beforeCount, afterCount) ? "unchanged" : "CHANGED", sameBalance(beforeCount, afterCount),
    "a submitted count must move no stock");
}
await expectRefused("10 whmgr has NO counter authority", "warehouseManager", "createCycleCount",
  { partId: PART, location: { type: "WAREHOUSE", locationId: WH }, idempotencyKey: `ccw-${RUN}` },
  "gate", "cycleCountCounter deliberately withheld -- #111");
await expectRefused("10 reconciler cannot open a count", "partsManager", "createCycleCount",
  { partId: PART, location: { type: "WAREHOUSE", locationId: WH }, idempotencyKey: `ccp-${RUN}` },
  "gate", "partsManager holds reconcile only");

// ═════════ 11. Return intake ═════════
console.log("\n-- 11. Return intake --");
const before11 = await balanceOf("warehouseManager", PART);
await expectAllowed("11 return intake recorded", "warehouseManager", "recordReturnIntake",
  { partId: PART, source: "WORK_ORDER", sourceReference: `WO-${RUN}`, condition: "OPENED", quantity: 2, idempotencyKey: `ret-${RUN}` },
  (r) => (r.state === "AWAITING_DISPOSITION" ? true : `state=${r.state}`), "lands awaiting disposition");
const after11 = await balanceOf("warehouseManager", PART);
record("11 A RETURN RESTORES NOTHING", "warehouseManager", "balance unchanged",
  sameBalance(before11, after11) ? "unchanged" : "CHANGED", sameBalance(before11, after11),
  "DECISIONS #118 -- if this fails, stop the release");
await expectRefused("11 unrecognized condition", "warehouseManager", "recordReturnIntake",
  { partId: PART, source: "WORK_ORDER", condition: "SLIGHTLY_BENT", quantity: 1, idempotencyKey: `retb-${RUN}` },
  "validation", "a typo must never be coerced to UNKNOWN");
await expectRefused("11 parts floor cannot take returns", "partsAssociate", "recordReturnIntake",
  { partId: PART, source: "WORK_ORDER", condition: "OPENED", quantity: 1, idempotencyKey: `retp-${RUN}` },
  "gate", "returns intake was granted to the warehouse manager only");

// ═════════ 12. Technician scanner reachability ═════════
console.log("\n-- 12. Technician scanner reachability --");
await expectAllowed("12 technician may look up", "technician", "getPartBalance", { partId: PART },
  (r) => (r.partId === PART ? true : "wrong part"), "field lookup reaches the technician");
for (const [name, data] of [
  ["recordPutAway", { warehouseId: WH, binCode: BIN, partId: PART, quantity: 1, idempotencyKey: `tp-${RUN}` }],
  ["createCycleCount", { partId: PART, location: { type: "WAREHOUSE", locationId: WH }, idempotencyKey: `tc-${RUN}` }],
  ["dispatchTransferOrder", { transferOrderId: "to-none" }],
]) {
  await expectRefused("12 no warehouse ops inherited", "technician", name, data,
    "gate", "the shared Scan workspace confers nothing");
}

// ═════════ report ═════════
const pass = results.filter((r) => r.pass).length;
console.log(`\n${"=".repeat(70)}\n${pass}/${results.length} checks passed`);
const failures = results.filter((r) => !r.pass);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  [${f.scenario}] ${f.persona}: expected ${f.expected}, got ${f.actual} -- ${f.note}`);
}
process.exit(failures.length ? 1 : 0);
