// SCANNER — THE END-TO-END CONTRACT. One part, one journey, every handoff exercised for real.
// Requires the Firestore emulator (127.0.0.1:8080). Run: npm run test:scannerEndToEndContract
//
// ============================ WHAT THIS PROVES THAT UNIT TESTS CANNOT ============================
//
// Every scanner stage already has its own suite, and every one of them passes. That is exactly the
// condition under which a chain still breaks: each stage is correct about its OWN vocabulary, and
// wrong about the next stage's. The failures this file exists to catch are the seams —
//
//   * IDENTIFY returns a partId that LOOKUP keys on differently (trimmed, cased, prefixed);
//   * RECEIVE writes a ledger shape LOOKUP does not sum;
//   * PUT AWAY writes something that makes received stock VANISH from on-hand (DECISIONS #116);
//   * PICK/STAGE quietly commits stock that nothing later releases;
//   * TRANSFER moves a quantity out of one authority and into none;
//   * the technician ends up holding stock no read in the system can find.
//
// So the chain here runs the REAL commands against the REAL emulator, in order, on ONE part, and
// after every stage it re-asks the SAME question the operator's screen asks — `readPartBalance` —
// rather than inspecting the documents each command happened to write. A stage that writes the right
// document and the wrong shape passes its own test and fails this one.
//
// ============================ ONE DELIBERATE ASYMMETRY ============================
//
// CYCLE COUNT and RETURN INTAKE are run SEPARATELY, not spliced into the chain, because neither is a
// step in the custody journey. A cycle count is an OBSERVATION of a shelf; a return intake is an
// arrival AWAITING DISPOSITION that DECISIONS #118 forbids from restoring sellable stock. Putting
// either inline would imply a sequence the business does not have.
//
// ============================ AND ONE FINDING THIS FILE PINS ============================
//
// Stage 7 records a real gap rather than papering over it: once stock is transferred to a truck, the
// part balance read reports it as GONE, because on-hand counts movements only at `type ===
// "WAREHOUSE"`. Van stock is answerable ONLY through the mobile-location presence probe, which is a
// different authority with a different audience. See §7.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

// ---- the real modules under contract ------------------------------------------------------------
const { createPart, changePartStatus } = await import("../lib/partMaster/partMasterCommands.js");
const { createPartAlias } = await import("../lib/partMaster/partAliasCommands.js");
const { resolveScannedPartIdentifier } = await import("../lib/partMaster/partAliasScanResolver.js");
const { readPartBalance } = await import("../lib/inventory/partBalanceReadService.js");
const { receiveInventoryStock, UnauthorizedReceivingError } = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { createBin, BINS_COLLECTION } = await import("../lib/inventoryLocation/binCommands.js");
const { deriveBinDocId } = await import("../lib/inventoryLocation/binRegistry.js");
const { recordPutAway, PlacementUnauthorizedError, PlacementBinError, BIN_PLACEMENTS_COLLECTION } = await import("../lib/inventoryLocation/putAwayCommand.js");
const {
  createTransferOrder, dispatchTransferOrder, receiveTransferOrder,
  InsufficientStockError, UnauthorizedTransferError,
} = await import("../lib/inventoryTransfer/transferOrderCommand.js");
const { makeResolveTransferLocationActive } = await import("../lib/inventoryTransfer/transferLocationResolver.js");
const { createCycleCount, submitCycleCount } = await import("../lib/cycleCount/cycleCountCommand.js");
const { recordReturnIntake, RETURNS_COLLECTION, ReturnInvalidError } = await import("../lib/inventoryReturns/returnIntakeCommand.js");
const { probeNoneStockPresentAtLocation } = await import("../lib/inventoryLedger/mobileLocationPresenceProbe.js");

// ---- runner --------------------------------------------------------------------------------------
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

const runId = Date.now();
let seq = 0;
const uid = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

// ---- seeding -------------------------------------------------------------------------------------
async function seedWarehouse(id) {
  await db.collection("warehouses").doc(id).set({
    id, name: id, location: "somewhere", status: "ACTIVE", version: 1, provenance: "NATIVE",
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
  });
}
async function seedMobileLocation(id) {
  await db.collection("mobile_locations").doc(id).set({
    locationId: id, type: "MOBILE", displayLabel: id, active: true, version: 1,
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
  });
}
async function seedPurchaseOrder(partId, orderedQuantity) {
  const rrid = uid("rr");
  await db.collection("reorder_purchase_orders").doc(rrid).set({
    reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: uid("PO"),
    orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "seed", createdAt: 1,
  });
  await db.collection("reorder_requests").doc(rrid).set({
    partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "seed", orderedAt: 1,
  });
  return rrid;
}

/**
 * A catalog actor who genuinely holds `inventory.catalog.manage`, resolved through the real access
 * path rather than a stubbed `authorize`. The IDENTIFY stage is the one place the chain must not
 * inject its own answer: alias administration and alias lookup were separated deliberately, and a
 * faked grant would erase the distinction this whole stage exists to preserve.
 */
const CATALOG_ROLES = Object.freeze({
  scannerCatalog: { id: "scannerCatalog", name: "x", description: "x", permissions: ["inventory.catalog.manage", "inventory.catalog.activate"] },
});
const catalogActor = uid("catalog-actor");
await db.collection("users").doc(catalogActor).set({ accessVersion: 1 });
await db.collection("roleAssignments").doc(uid("asg")).set({
  id: "a", principalUid: catalogActor, roleId: "scannerCatalog", scope: { type: "global" },
  grantedBy: "seed", grantedAt: Timestamp.now(), status: "active", accessVersionAtGrant: 1,
});
const CATALOG_DEPS = { roles: CATALOG_ROLES, now: () => NOW };

/**
 * Command deps for the custody stages.
 *
 * `grants` is a real Set the test can shrink: every negative case below removes exactly ONE
 * capability and asserts the stage refuses. That is what makes "each stage is separately authorized"
 * a proven property rather than a claim about a catalog file.
 */
function makeDeps(actorId, grants, over = {}) {
  const audits = [];
  const deps = {
    db,
    actor: { kind: "USER", id: actorId },
    authorize: async (_txn, _actor, capability) => grants.has(capability),
    resolvePart: async (_txn, partId) => ({ partId, trackingMode: "NONE", active: true }),
    resolveLocationActive: makeResolveTransferLocationActive(db),
    stageAudit: (_txn, audit) => { audits.push(audit); },
    now: () => NOW,
    ...over,
  };
  return { deps, audits };
}

const ALL_SCANNER_GRANTS = () => new Set([
  "inventory.stock.receive",
  "inventory.location.bin.manage", "inventory.location.bin.read", "inventory.placement.record",
  "inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive",
  "inventory.cycleCount.create", "inventory.cycleCount.submit",
  "inventory.returns.intake",
]);

/** The operator's question, asked the operator's way, after every stage. */
const balance = (partId) => readPartBalance(db, partId, false);
const at = (bal, locationId) => bal.byLocation.find((l) => l.locationId === locationId)?.quantity ?? 0;

console.log("scannerEndToEndContract.test.mjs — one part, the whole chain");

// =================================================================================================
// THE CHAIN
// =================================================================================================
await check("THE CHAIN: identify → lookup → receive → put away → pick/stage → transfer → truck", async () => {
  const partId = uid("PRT");
  const barcode = `BC-${partId}`;
  const warehouseId = uid("wh");
  const truckLocationId = uid("truck-loc");
  const actor = uid("scanner-actor");
  const grants = ALL_SCANNER_GRANTS();
  const { deps } = makeDeps(actor, grants);

  await seedWarehouse(warehouseId);
  await seedMobileLocation(truckLocationId);

  // ─────────────────────────────────────────── 1. IDENTIFY
  // A real Part, a real alias, resolved by the real scan resolver. The contract under test is that
  // the partId coming OUT of a scan is byte-identical to the one every later stage keys on — not
  // merely "a part was found".
  await createPart({
    actorUid: catalogActor, idempotencyKey: uid("k"),
    part: { partId, internalPartNumber: partId, name: "Chain Part", status: "DRAFT", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" },
  }, CATALOG_DEPS);
  await changePartStatus({ actorUid: catalogActor, idempotencyKey: uid("k"), partId, expectedVersion: 1, newStatus: "ACTIVE" }, CATALOG_DEPS);
  await createPartAlias({ actorUid: catalogActor, idempotencyKey: uid("k"), partId, aliasType: "BARCODE_OTHER", rawValue: barcode }, CATALOG_DEPS);

  // Scanned with the whitespace a wedge scanner really appends.
  const identified = await resolveScannedPartIdentifier({ rawValue: `  ${barcode}\r\n` }, { db });
  assert.equal(identified.result, "FOUND", "a registered barcode must resolve");
  assert.equal(identified.partId, partId, "THE SEAM: identify must hand later stages the exact partId");

  // ─────────────────────────────────────────── 2. LOOKUP, before anything exists
  // A part nobody has ever received is UNKNOWN, not zero. This is the distinction the whole read
  // service exists for, and the chain asserts it at the one moment it is genuinely true.
  const before = await balance(identified.partId);
  assert.equal(before.onHand.state, "UNKNOWN", "no receipt anywhere is UNKNOWN, never a confident 0");
  assert.deepEqual(before.byLocation, [], "and no location may be invented for it");

  // ─────────────────────────────────────────── 3. RECEIVE
  const rrid = await seedPurchaseOrder(partId, 10);
  const received = await receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 10, receivedQuantity: 10 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps);
  assert.equal(received.outcome, "applied");

  // THE SEAM: the ledger receiving WROTE is the ledger lookup SUMS. Asserted through the read
  // service, not by fetching the movement document receiving returned.
  const afterReceive = await balance(partId);
  assert.equal(afterReceive.onHand.state, "KNOWN");
  assert.equal(afterReceive.onHand.value, 10, "a receipt must become on-hand at the read the operator uses");
  assert.equal(at(afterReceive, warehouseId), 10, "and it must land at the warehouse it was received into");
  assert.equal(afterReceive.available.value, 10, "nothing is reserved by receiving");

  // ─────────────────────────────────────────── 4. PUT AWAY — the load-bearing invariant
  const binCode = "A-14";
  await createBin({ warehouseId, code: binCode, idempotencyKey: uid("idem") }, deps);
  const placed = await recordPutAway({ warehouseId, binCode, partId, quantity: 10, idempotencyKey: uid("idem") }, deps);
  assert.equal(placed.outcome, "recorded");

  // DECISIONS #116. If put-away moved custody to the bin, this is where 10 becomes 0 and every
  // downstream authority — transfer sufficiency, cycle-count expected quantity, sellable on-hand —
  // silently starts lying. This single assertion is the reason the chain test exists.
  const afterPutAway = await balance(partId);
  assert.equal(afterPutAway.onHand.value, 10, "STOWING IS NOT A CUSTODY MOVE — on-hand must not change");
  assert.equal(at(afterPutAway, warehouseId), 10, "and the warehouse still holds it");

  // The placement is nonetheless real and findable — a bin that records nothing would satisfy the
  // invariant by doing nothing at all.
  const placements = await db.collection(BIN_PLACEMENTS_COLLECTION).where("partId", "==", partId).get();
  assert.equal(placements.size, 1, "put-away must actually record where it went");

  // ─────────────────────────────────────────── 5. PICK / STAGE
  // Picking for a work order is a placement with a work-order reference: stock moves to the staging
  // area, and NOTHING is committed. Reservation is a work-order lifecycle effect (DISPATCHED →
  // reserveParts), never an operator-invokable scanner command.
  // A staging area is a bin like any other: it must be registered before stock can be staged into
  // it. There is no implicit "staging" location, which is what keeps "where is it" answerable.
  await createBin({ warehouseId, code: "STAGE-1", idempotencyKey: uid("idem") }, deps);
  const staged = await recordPutAway({
    warehouseId, binCode: "STAGE-1", partId, quantity: 4,
    pickedForWorkOrderId: uid("WO"), idempotencyKey: uid("idem"),
  }, deps);
  assert.equal(staged.outcome, "recorded");

  const afterPick = await balance(partId);
  assert.equal(afterPick.onHand.value, 10, "picking moves nothing out of custody");
  assert.equal(afterPick.reserved.value, 0, "AND PICKING RESERVES NOTHING — the WO lifecycle owns commitment");
  assert.equal(afterPick.available.value, 10, "so availability is untouched by a pick");

  // ─────────────────────────────────────────── 6/7. TRANSFER → TRUCK HANDOFF
  const origin = { type: "WAREHOUSE", locationId: warehouseId };
  const destination = { type: "MOBILE", locationId: truckLocationId };
  const order = await createTransferOrder({ partId, quantity: 6, origin, destination, idempotencyKey: uid("idem") }, deps);
  assert.equal(order.outcome, "applied");

  // In transit, the stock has LEFT the warehouse and has not ARRIVED. The read must show that
  // honestly rather than holding the old figure until receipt.
  await dispatchTransferOrder({ transferOrderId: order.transferOrderId }, deps);
  const inTransit = await balance(partId);
  assert.equal(inTransit.onHand.value, 4, "dispatch removes stock from the warehouse immediately");

  await receiveTransferOrder({ transferOrderId: order.transferOrderId }, deps);
  const afterHandoff = await balance(partId);
  assert.equal(afterHandoff.onHand.value, 4, "the truck's six are not warehouse stock");
  assert.equal(at(afterHandoff, warehouseId), 4);

  // ─────────────────────────────────────────── 7. TECHNICIAN REACHABILITY
  // THE FINDING, pinned rather than smoothed over: `readPartBalance` cannot see van stock at all,
  // because on-hand counts movements only at `type === "WAREHOUSE"`. That is correct — a truck is
  // not sellable warehouse stock — but it means the part-balance screen is NOT an answer to "does my
  // technician have one". The mobile-location presence probe is, and it is a different authority.
  assert.equal(
    afterHandoff.byLocation.some((l) => l.locationId === truckLocationId), false,
    "van stock is deliberately absent from the warehouse balance — if this ever changes it is a custody decision, not a bug fix",
  );
  const presence = await db.runTransaction((txn) => probeNoneStockPresentAtLocation(txn, db, truckLocationId));
  assert.equal(presence, "PRESENT", "THE CHAIN ENDS REACHABLE: the truck's stock is conclusively findable by the probe");
});

// =================================================================================================
// CYCLE COUNT — an OBSERVATION, run separately because it is not a step in the journey
// =================================================================================================
await check("CYCLE COUNT: expected quantity comes from the same ledger the chain built, and counting changes nothing", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh");
  const actor = uid("counter");
  const grants = ALL_SCANNER_GRANTS();
  const { deps } = makeDeps(actor, grants);
  await seedWarehouse(warehouseId);

  const rrid = await seedPurchaseOrder(partId, 7);
  await receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 7, receivedQuantity: 7 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps);

  const location = { type: "WAREHOUSE", locationId: warehouseId };
  const created = await createCycleCount({ partId, location, idempotencyKey: uid("idem") }, deps);
  // THE SEAM: the count's expectation is derived from the receipt the chain wrote. A cycle count
  // that expected 0 against a shelf of 7 would report a fabricated variance on every count.
  const stored = (await db.collection("cycle_counts").doc(created.cycleCountId).get()).data();
  assert.equal(stored.expectedQuantity, 7, "expected quantity must come from the real ledger");

  // DECISIONS #111: the count is BLIND — recorded, and no adjustment made by counting alone.
  await submitCycleCount({ cycleCountId: created.cycleCountId, countedQuantity: 5 }, deps);
  const afterCount = await balance(partId);
  assert.equal(afterCount.onHand.value, 7, "SUBMITTING A COUNT MOVES NO STOCK — reconciliation is a separate, reviewed act");
});

// =================================================================================================
// RETURN INTAKE — an ARRIVAL, run separately because DECISIONS #118 forbids it restoring stock
// =================================================================================================
await check("RETURN INTAKE: something comes back, and nothing becomes sellable", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh");
  const actor = uid("returns-desk");
  const grants = ALL_SCANNER_GRANTS();
  const { deps } = makeDeps(actor, grants);
  await seedWarehouse(warehouseId);

  const rrid = await seedPurchaseOrder(partId, 3);
  await receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 3, receivedQuantity: 3 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps);

  const intake = await recordReturnIntake({
    partId, source: "WORK_ORDER", sourceReference: uid("WO"), condition: "OPENED", quantity: 2,
    idempotencyKey: uid("idem"),
  }, deps);
  assert.equal(intake.outcome, "recorded");

  const stored = (await db.collection(RETURNS_COLLECTION).doc(intake.returnId).get()).data();
  assert.equal(stored.state, "AWAITING_DISPOSITION", "a return waits for a decision it does not make itself");

  // DECISIONS #118. Two returned units must NOT appear as five on the shelf.
  const afterReturn = await balance(partId);
  assert.equal(afterReturn.onHand.value, 3, "A RETURN NEVER AUTO-RESTORES SELLABLE STOCK");
});

// =================================================================================================
// NEGATIVE CASES — ten failures the chain must produce, each for its own reason
// =================================================================================================

await check("NEGATIVE 1 — an unregistered barcode is NOT_FOUND, and never falls back to a part match", async () => {
  const r = await resolveScannedPartIdentifier({ rawValue: `BC-nothing-${runId}` }, { db });
  assert.equal(r.result, "NOT_FOUND");
  assert.equal(r.partId, undefined, "a miss must not smuggle a partId out");
});

await check("NEGATIVE 2 — an empty scan is MALFORMED, distinct from a miss", async () => {
  const r = await resolveScannedPartIdentifier({ rawValue: "   " }, { db });
  assert.equal(r.result, "MALFORMED", "nothing scanned is a different fact from nothing found");
});

await check("NEGATIVE 3 — receiving without inventory.stock.receive is refused", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); await seedWarehouse(warehouseId);
  const rrid = await seedPurchaseOrder(partId, 4);
  const grants = ALL_SCANNER_GRANTS(); grants.delete("inventory.stock.receive");
  await assert.rejects(receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 4, receivedQuantity: 4 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(uid("a"), grants, { resolveLocationActive: async () => true }).deps), UnauthorizedReceivingError);
  const bal = await balance(partId);
  assert.equal(bal.onHand.state, "UNKNOWN", "a refused receipt must leave NO trace in the ledger");
});

await check("NEGATIVE 4 — put-away without inventory.placement.record is refused, and receiving's grant does not substitute", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); await seedWarehouse(warehouseId);
  const grants = ALL_SCANNER_GRANTS(); grants.delete("inventory.placement.record");
  const { deps } = makeDeps(uid("a"), grants);
  await createBin({ warehouseId, code: "B-01", idempotencyKey: uid("idem") }, deps);
  // Still holds inventory.stock.receive. Stowing all day must never confer the authority to accept
  // stock, and accepting stock must never confer the authority to stow it.
  await assert.rejects(
    recordPutAway({ warehouseId, binCode: "B-01", partId, quantity: 1, idempotencyKey: uid("idem") }, deps),
    PlacementUnauthorizedError,
  );
});

await check("NEGATIVE 5 — put-away into a bin that does not exist is refused, not auto-created", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); await seedWarehouse(warehouseId);
  const { deps } = makeDeps(uid("a"), ALL_SCANNER_GRANTS());
  await assert.rejects(
    recordPutAway({ warehouseId, binCode: "NEVER-LABELLED", partId, quantity: 1, idempotencyKey: uid("idem") }, deps),
    (e) => e instanceof PlacementBinError && e.message === "NOT_FOUND",
    "an unknown bin is a refusal that SAYS it was not found — creating racking by scanning it would make the registry meaningless",
  );
});

await check("NEGATIVE 6 — a bin code from ANOTHER warehouse is refused, and a corrupted bin record fails closed", async () => {
  const partId = uid("PRT");
  const whA = uid("wh"); const whB = uid("wh");
  await seedWarehouse(whA); await seedWarehouse(whB);
  const { deps } = makeDeps(uid("a"), ALL_SCANNER_GRANTS());
  await createBin({ warehouseId: whA, code: "C-09", idempotencyKey: uid("idem") }, deps);

  // A bin id is DERIVED per warehouse (bin_<warehouse>__<code>), so the same code at another site
  // is not a different answer to the same question — it is a different bin entirely, and the
  // lookup never even reaches WH-A's record. NOT_FOUND is the correct, and the safe, answer.
  await assert.rejects(
    recordPutAway({ warehouseId: whB, binCode: "C-09", partId, quantity: 1, idempotencyKey: uid("idem") }, deps),
    (e) => e instanceof PlacementBinError && e.message === "NOT_FOUND",
    "a bin code is only meaningful inside its own warehouse",
  );

  // WRONG_WAREHOUSE is therefore reachable ONLY from a record whose stored warehouseId disagrees
  // with its own derived id — corruption, a bad migration, a hand-edited document. The command must
  // refuse it rather than trust either half, so this seeds exactly that and proves it fails closed.
  const corruptedId = deriveBinDocId(whB, "E-07");
  await db.collection(BINS_COLLECTION).doc(corruptedId).set({
    warehouseId: whA, code: "E-07", status: "ACTIVE",
    createdAt: Timestamp.fromDate(NOW), createdBy: "seed", updatedAt: Timestamp.fromDate(NOW), updatedBy: "seed",
  });
  await assert.rejects(
    recordPutAway({ warehouseId: whB, binCode: "E-07", partId, quantity: 1, idempotencyKey: uid("idem") }, deps),
    (e) => e instanceof PlacementBinError && e.message === "WRONG_WAREHOUSE",
    "a bin record that contradicts its own id must be refused, never half-trusted",
  );
});

await check("NEGATIVE 7 — transferring more than is on hand is refused, and the ledger is unchanged", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); const truckLocationId = uid("truck-loc");
  await seedWarehouse(warehouseId); await seedMobileLocation(truckLocationId);
  const actor = uid("a"); const grants = ALL_SCANNER_GRANTS();
  const rrid = await seedPurchaseOrder(partId, 2);
  await receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 2, receivedQuantity: 2 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps);

  const { deps } = makeDeps(actor, grants);
  await assert.rejects(createTransferOrder({
    partId, quantity: 99,
    origin: { type: "WAREHOUSE", locationId: warehouseId },
    destination: { type: "MOBILE", locationId: truckLocationId },
    idempotencyKey: uid("idem"),
  }, deps), InsufficientStockError);
  assert.equal((await balance(partId)).onHand.value, 2, "a refused transfer moves nothing");
});

await check("NEGATIVE 8 — dispatch without inventory.transfer.dispatch is refused after a legitimate create", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); const truckLocationId = uid("truck-loc");
  await seedWarehouse(warehouseId); await seedMobileLocation(truckLocationId);
  const actor = uid("a"); const grants = ALL_SCANNER_GRANTS();
  const rrid = await seedPurchaseOrder(partId, 5);
  await receiveInventoryStock({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 5, receivedQuantity: 5 }],
    idempotencyKey: uid("idem"),
  }, makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps);

  const { deps } = makeDeps(actor, grants);
  const order = await createTransferOrder({
    partId, quantity: 3,
    origin: { type: "WAREHOUSE", locationId: warehouseId },
    destination: { type: "MOBILE", locationId: truckLocationId },
    idempotencyKey: uid("idem"),
  }, deps);

  // Requesting a move and executing it are separate authorities on purpose.
  grants.delete("inventory.transfer.dispatch");
  await assert.rejects(dispatchTransferOrder({ transferOrderId: order.transferOrderId }, deps), UnauthorizedTransferError);
  assert.equal((await balance(partId)).onHand.value, 5, "an unauthorized dispatch moves nothing");
});

await check("NEGATIVE 9 — a return with an unrecognized condition is REFUSED, never coerced to UNKNOWN", async () => {
  const { deps } = makeDeps(uid("a"), ALL_SCANNER_GRANTS());
  // UNKNOWN means "nobody could tell". A typo means the caller is broken, and quietly turning one
  // into the other would record a deliberate observation that was never made.
  await assert.rejects(recordReturnIntake({
    partId: uid("PRT"), source: "WORK_ORDER", condition: "SLIGHTLY_BENT", quantity: 1, idempotencyKey: uid("idem"),
  }, deps), ReturnInvalidError);
});

await check("NEGATIVE 10 — replaying any stage is idempotent, not doubled", async () => {
  const partId = uid("PRT");
  const warehouseId = uid("wh"); await seedWarehouse(warehouseId);
  const actor = uid("a"); const grants = ALL_SCANNER_GRANTS();
  const rrid = await seedPurchaseOrder(partId, 6);
  const request = {
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: rrid, purchaseOrderId: rrid },
    receivingLocation: { type: "WAREHOUSE", locationId: warehouseId },
    lines: [{ lineId: "L1", partId, expectedQuantity: 6, receivedQuantity: 6 }],
    idempotencyKey: uid("idem"),
  };
  const rd = makeDeps(actor, grants, { resolveLocationActive: async () => true }).deps;
  await receiveInventoryStock(request, rd);
  // The failure this guards: a dropped connection, an operator pressing the button twice, a queued
  // offline submission flushing after it already succeeded. Twelve on the shelf instead of six.
  await receiveInventoryStock(request, rd);
  assert.equal((await balance(partId)).onHand.value, 6, "REPLAY MUST NOT DOUBLE STOCK");

  const { deps } = makeDeps(actor, grants);
  await createBin({ warehouseId, code: "D-02", idempotencyKey: uid("idem") }, deps);
  const placementKey = uid("idem");
  await recordPutAway({ warehouseId, binCode: "D-02", partId, quantity: 6, idempotencyKey: placementKey }, deps);
  await recordPutAway({ warehouseId, binCode: "D-02", partId, quantity: 6, idempotencyKey: placementKey }, deps);
  const placements = await db.collection(BIN_PLACEMENTS_COLLECTION).where("partId", "==", partId).get();
  assert.equal(placements.size, 1, "a replayed put-away records one placement, not two");
});

// =================================================================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
