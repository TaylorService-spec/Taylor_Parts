// Multi-line receiving against the CANONICAL purchase order — Firestore-emulator tests.
//
// Phase C's required matrix. Covers the canonical authority end to end (single and multi line, full
// and partial, completion by a later receipt), the legacy boundary (unchanged, and partial rejected),
// the target-scoped receipt identity, and the concurrency proof that a query alone cannot give.
//
// Every identity is run-scoped. Receipt ids are deterministic, so fixed test values collide across
// repeated runs against one long-lived emulator — which is a FIXTURE hazard, not a product failure.
// The production identity rules are covered by their own assertions below rather than by relying on
// a clean database.
//
// Prerequisite: npm run build; emulator running.
// Run: node --test test/receiveCanonicalMultiLine.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const cmd = await import("../lib/inventoryReceiving/receiveInventoryStockCommand.js");
const { receiveInventoryStock, SourceNotFoundError, SourceNotReceivableError, PartInvalidError } = cmd;
const { IdempotencyConflictError } = await import("../lib/inventoryReceiving/receivingTypes.js");
const { canonicalReceivingOrderDocId, receivingOrderDocId } = await import("../lib/inventoryReceiving/receivingRepository.js");
const { normalizePoVersion } = await import("../lib/inventoryReceiving/receivingSourceResolver.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
const runId = Date.now();
let seq = 0;
const nextId = (p) => `${p}-${runId}-${(seq += 1)}`;
const NOW = new Date(1_700_000_000_000);

// ---------------------------------------------------------------- fixtures

async function seedCanonical({ items, status = "SENT", version, grant = true } = {}) {
  const poId = nextId("po");
  const actorId = nextId("actor");
  const lines = (items ?? [{ qty: 5 }]).map((it, i) => ({
    lineId: it.lineId ?? `L${i + 1}`,
    partId: it.partId ?? nextId("part"),
    quantity: it.qty,
  }));
  await db.collection("purchase_orders").doc(poId).set({
    supplierId: nextId("sup"),
    status,
    items: lines.map((l) => ({ lineId: l.lineId, partId: l.partId, quantity: l.quantity, unitPrice: 1 })),
    totalCost: lines.reduce((s, l) => s + l.quantity, 0),
    ...(version === undefined ? {} : { version }),
  });
  if (grant) await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { poId, actorId, lines };
}

async function seedLegacy({ orderedQuantity = 4 } = {}) {
  const rrid = nextId("rr");
  const partId = nextId("part");
  const actorId = nextId("actor");
  await db.collection("reorder_purchase_orders").doc(rrid).set({
    reorderRequestId: rrid, partId, supplierName: "ACME", externalPoNumber: "PO-1",
    orderedQuantity, orderedDate: 1, expectedArrivalDate: null, status: "ORDERED", createdBy: "x", createdAt: 1,
  });
  await db.collection("reorder_requests").doc(rrid).set({
    partId, status: "ORDERED", purchaseOrderId: rrid, receivedBy: null, receivedAt: null, orderedBy: "x", orderedAt: 1,
  });
  await db.collection("receiving_grants").doc(actorId).set({ granted: true });
  return { rrid, partId, actorId, orderedQuantity };
}

const canonicalReq = (sc, lines, over = {}) => ({
  source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines,
  idempotencyKey: nextId("idem"),
  ...over,
});

const legacyReq = (sc, over = {}) => ({
  source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: sc.rrid, purchaseOrderId: sc.rrid },
  receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
  lines: [{ lineId: "CLIENT-LABEL", partId: sc.partId, expectedQuantity: sc.orderedQuantity, receivedQuantity: sc.orderedQuantity }],
  idempotencyKey: nextId("idem"),
  ...over,
});

const SERIAL_PARTS = new Set();
function makeDeps(sc, over = {}) {
  const audits = [];
  return {
    audits,
    deps: {
      db,
      actor: { kind: "USER", id: sc.actorId },
      authorize: async (txn, actorId) => {
        const s = await txn.get(db.collection("receiving_grants").doc(actorId));
        return s.exists && s.data().granted === true;
      },
      resolvePart: async (_txn, partId) => ({
        partId,
        trackingMode: SERIAL_PARTS.has(partId) ? "SERIAL" : "NONE",
        active: true,
      }),
      resolveLocationActive: async () => true,
      stageAudit: (txn, audit) => {
        audits.push(audit);
        txn.create(db.collection("receiving_audit_canon").doc(audit.receivingId), { ...audit, at: FieldValue.serverTimestamp() });
      },
      now: () => NOW,
      ...over,
    },
  };
}

const poDoc = async (poId) => (await db.collection("purchase_orders").doc(poId).get()).data();
const lineOf = (out, lineId) => out.lines.find((l) => l.lineId === lineId);

// ═══════════════════════════════════ LEGACY BOUNDARY ═══════════════════════════════════

await check("1. legacy one-line FULL receipt still succeeds, and its PO is never written", async () => {
  const sc = await seedLegacy();
  const before = (await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data();
  const out = await receiveInventoryStock(legacyReq(sc), makeDeps(sc).deps);
  assert.equal(out.outcome, "applied");
  assert.equal(out.sourceType, "REORDER_PURCHASE_ORDER");
  assert.equal(out.derivedState, "RECEIVED");
  const after = (await db.collection("reorder_purchase_orders").doc(sc.rrid).get()).data();
  assert.deepEqual(after, before, "the legacy purchase order document is immutable and must be byte-identical");
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "RECEIVED");
});

await check("2. legacy replay is unchanged, and keeps its KEY-SCOPED receipt id", async () => {
  const sc = await seedLegacy();
  const req = legacyReq(sc);
  const a = await receiveInventoryStock(req, makeDeps(sc).deps);
  const b = await receiveInventoryStock(req, makeDeps(sc).deps);
  assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId);
  assert.equal(a.receivingId, receivingOrderDocId(req.idempotencyKey), "legacy identity must stay derived from the key alone");
  assert.ok(a.receivingId.startsWith("rcv_"));
});

await check("3. legacy PARTIAL receipt is REJECTED (the legacy document cannot carry cumulative state)", async () => {
  const sc = await seedLegacy({ orderedQuantity: 4 });
  const req = legacyReq(sc, { lines: [{ lineId: "CLIENT-LABEL", partId: sc.partId, expectedQuantity: 4, receivedQuantity: 2 }] });
  await assert.rejects(receiveInventoryStock(req, makeDeps(sc).deps), (e) => e instanceof SourceNotReceivableError);
});

await check("4. legacy line label is the CALLER'S, not the normalized L1", async () => {
  // Deployed clients generate their own label. Requiring "L1" would reject every one of them.
  const sc = await seedLegacy();
  const out = await receiveInventoryStock(legacyReq(sc), makeDeps(sc).deps);
  const stored = (await db.collection("receiving_orders").doc(out.receivingId).get()).data();
  assert.equal(stored.lines[0].lineId, "CLIENT-LABEL");
  // ...and the derived result reports the PO's own line, correctly attributed.
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].receivedNow, sc.orderedQuantity);
  assert.equal(out.lines[0].remainingQuantity, 0);
});

// ═══════════════════════════════════ CANONICAL RECEIPTS ═══════════════════════════════════

await check("5. canonical single-line FULL receipt", async () => {
  const sc = await seedCanonical({ items: [{ qty: 3 }] });
  const out = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 3 }]), makeDeps(sc).deps);
  assert.equal(out.outcome, "applied");
  assert.equal(out.derivedState, "RECEIVED");
  assert.equal(out.storedStatus, "RECEIVED");
  assert.equal(lineOf(out, "L1").remainingQuantity, 0);
});

await check("6. canonical single-line PARTIAL receipt leaves the line open and the PO SENT", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const out = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 2 }]), makeDeps(sc).deps);
  assert.equal(out.derivedState, "PARTIALLY_RECEIVED");
  assert.equal(out.storedStatus, "SENT", "a partial receipt must NOT move the stored lifecycle");
  assert.equal(lineOf(out, "L1").receivedNow, 2);
  assert.equal(lineOf(out, "L1").remainingQuantity, 3);
  assert.equal((await poDoc(sc.poId)).status, "SENT");
});

await check("7. a LATER receipt completes the line, and only then does stored status become RECEIVED", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }]), makeDeps(sc).deps);
  assert.equal((await poDoc(sc.poId)).status, "SENT");
  const out = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 3 }]), makeDeps(sc).deps);
  assert.equal(lineOf(out, "L1").previouslyReceived, 2);
  assert.equal(lineOf(out, "L1").receivedNow, 3);
  assert.equal(lineOf(out, "L1").remainingQuantity, 0);
  assert.equal(out.derivedState, "RECEIVED");
  assert.equal((await poDoc(sc.poId)).status, "RECEIVED");
});

await check("8. canonical MULTI-LINE full receipt", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 3 }] });
  const out = await receiveInventoryStock(canonicalReq(sc, [
    { lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 2 },
    { lineId: "L2", partId: sc.lines[1].partId, receivedQuantity: 3 },
  ]), makeDeps(sc).deps);
  assert.equal(out.derivedState, "RECEIVED");
  assert.equal((await poDoc(sc.poId)).status, "RECEIVED");
  assert.equal(out.ledgerEventIds.length, 2, "one RECEIVED ledger event per line");
});

await check("9. canonical MULTI-LINE partial receipt", async () => {
  const sc = await seedCanonical({ items: [{ qty: 4 }, { qty: 4 }] });
  const out = await receiveInventoryStock(canonicalReq(sc, [
    { lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 },
    { lineId: "L2", partId: sc.lines[1].partId, receivedQuantity: 4 },
  ]), makeDeps(sc).deps);
  assert.equal(out.derivedState, "PARTIALLY_RECEIVED");
  assert.equal(lineOf(out, "L1").state, "PARTIALLY_RECEIVED");
  assert.equal(lineOf(out, "L2").state, "RECEIVED");
  assert.equal((await poDoc(sc.poId)).status, "SENT");
});

await check("10. lines complete INDEPENDENTLY across separate receipts", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 2 }] });
  const [a, b] = sc.lines;
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: a.partId, receivedQuantity: 2 }]), makeDeps(sc).deps);
  assert.equal((await poDoc(sc.poId)).status, "SENT", "one complete line is not a complete order");
  const out = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L2", partId: b.partId, receivedQuantity: 2 }]), makeDeps(sc).deps);
  assert.equal(out.derivedState, "RECEIVED");
  assert.equal((await poDoc(sc.poId)).status, "RECEIVED");
});

await check("11. derived NOT_RECEIVED is reported for untouched lines", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 2 }] });
  const out = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }]), makeDeps(sc).deps);
  assert.equal(lineOf(out, "L2").state, "NOT_RECEIVED");
  assert.equal(lineOf(out, "L2").receivedNow, 0);
  assert.equal(lineOf(out, "L2").remainingQuantity, 2);
});

// ═══════════════════════════════════ QUANTITY POLICY ═══════════════════════════════════

await check("12. OVER-RECEIPT is rejected, measured against REMAINING not ordered", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 3 }]), makeDeps(sc).deps);
  // 3 < 5 ordered, but only 2 remain -- measuring against ordered would let this through.
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 3 }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /over_receipt/.test(e.message),
  );
});

await check("13. a receipt against an ALREADY SATISFIED line is rejected", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }] });
  const part = sc.lines[0].partId;
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }]), makeDeps(sc).deps);
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError,
  );
});

await check("14. zero, negative and fractional quantities are rejected", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  for (const q of [0, -1, 1.5, "2", null]) {
    await assert.rejects(
      receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: q }]), makeDeps(sc).deps),
      (e) => e instanceof SourceNotReceivableError, `quantity ${q} must be rejected`,
    );
  }
});

await check("15. an UNKNOWN PO line is rejected", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }] });
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "GHOST", partId: sc.lines[0].partId, receivedQuantity: 1 }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /line_unknown/.test(e.message),
  );
});

await check("16. a DUPLICATE submitted line is rejected", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [
      { lineId: "L1", partId: part, receivedQuantity: 1 },
      { lineId: "L1", partId: part, receivedQuantity: 1 },
    ]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /line_duplicate/.test(e.message),
  );
});

await check("17. a line naming the WRONG part is rejected", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 2 }] });
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[1].partId, receivedQuantity: 1 }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /part_mismatch/.test(e.message),
  );
});

// ═══════════════════════════════════ SERIALIZED IDENTITY ═══════════════════════════════════

await check("18. SERIAL count must equal the received quantity", async () => {
  const sc = await seedCanonical({ items: [{ qty: 3 }] });
  const part = sc.lines[0].partId;
  SERIAL_PARTS.add(part);
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 3, serialNumbers: ["A", "B"] }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /serial_count_mismatch/.test(e.message),
  );
});

await check("19. DUPLICATE serials are rejected — within a line and ACROSS lines", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 2 }] });
  const [a, b] = sc.lines;
  SERIAL_PARTS.add(a.partId); SERIAL_PARTS.add(b.partId);
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: a.partId, receivedQuantity: 2, serialNumbers: ["S1", "S1"] }]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /serial_numbers_duplicated/.test(e.message),
  );
  // One physical unit cannot be received twice under two different line ids either.
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [
      { lineId: "L1", partId: a.partId, receivedQuantity: 1, serialNumbers: ["SX"] },
      { lineId: "L2", partId: b.partId, receivedQuantity: 1, serialNumbers: ["SX"] },
    ]), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /across_lines/.test(e.message),
  );
});

await check("20. a SERIAL multi-line receipt registers one Serialized Asset per unit", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 1 }] });
  const [a, b] = sc.lines;
  SERIAL_PARTS.add(a.partId); SERIAL_PARTS.add(b.partId);
  const out = await receiveInventoryStock(canonicalReq(sc, [
    { lineId: "L1", partId: a.partId, receivedQuantity: 2, serialNumbers: [nextId("s"), nextId("s")] },
    { lineId: "L2", partId: b.partId, receivedQuantity: 1, serialNumbers: [nextId("s")] },
  ]), makeDeps(sc).deps);
  assert.equal(out.serializedAssetIds.length, 3);
  assert.equal(out.ledgerEventIds.length, 3, "SERIAL stages one ledger event PER UNIT");
});

// ═══════════════════════════════════ ATOMICITY ═══════════════════════════════════

await check("21+22. ONE invalid line rejects the whole batch, with ZERO effects of any kind", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }, { qty: 2 }] });
  const [a, b] = sc.lines;
  const before = {
    receipts: (await db.collection("receiving_orders").where("source.purchaseOrderId", "==", sc.poId).get()).size,
    ledger: (await db.collection("inventory_transactions").where("sourceObject.id", "==", sc.poId).get()).size,
    po: await poDoc(sc.poId),
  };
  await assert.rejects(receiveInventoryStock(canonicalReq(sc, [
    { lineId: "L1", partId: a.partId, receivedQuantity: 2 },   // valid
    { lineId: "L2", partId: b.partId, receivedQuantity: 99 },  // over-receipt
  ]), makeDeps(sc).deps));
  assert.equal((await db.collection("receiving_orders").where("source.purchaseOrderId", "==", sc.poId).get()).size, before.receipts, "no receipt");
  assert.equal((await db.collection("inventory_transactions").where("sourceObject.id", "==", sc.poId).get()).size, before.ledger, "no ledger event");
  assert.deepEqual(await poDoc(sc.poId), before.po, "the PO is untouched -- not even its version");
  assert.equal((await db.collection("receiving_audit_canon").where("purchaseOrderId", "==", sc.poId).get()).size, 0, "no audit event");
});

// ═══════════════════════════════════ IDEMPOTENCY IDENTITY ═══════════════════════════════════

await check("23. same actor + same PO + same key + same payload REPLAYS", async () => {
  const sc = await seedCanonical({ items: [{ qty: 2 }] });
  const req = canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }]);
  const a = await receiveInventoryStock(req, makeDeps(sc).deps);
  const b = await receiveInventoryStock(req, makeDeps(sc).deps);
  assert.equal(b.outcome, "replayed");
  assert.equal(a.receivingId, b.receivingId);
  // A replay reports the SAME progress as the original -- it must not double-count its own receipt.
  assert.equal(lineOf(b, "L1").receivedNow, 1);
  assert.equal(lineOf(b, "L1").previouslyReceived, 0);
  assert.equal(lineOf(b, "L1").remainingQuantity, 1);
});

await check("24. same key + DIFFERENT payload fails closed", async () => {
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  const key = nextId("idem");
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }], { idempotencyKey: key }), makeDeps(sc).deps);
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }], { idempotencyKey: key }), makeDeps(sc).deps),
    (e) => e instanceof IdempotencyConflictError,
  );
});

await check("25. the SAME raw key against a DIFFERENT PO does NOT collide — the defect target-scoping fixes", async () => {
  // Under key-only identity the second receipt would find the first PO's receipt and REPLAY it:
  // reporting success for stock that never moved on an order never touched.
  const key = nextId("shared");
  const one = await seedCanonical({ items: [{ qty: 2 }] });
  const two = await seedCanonical({ items: [{ qty: 2 }] });
  const a = await receiveInventoryStock(canonicalReq(one, [{ lineId: "L1", partId: one.lines[0].partId, receivedQuantity: 2 }], { idempotencyKey: key }), makeDeps(one).deps);
  const b = await receiveInventoryStock(canonicalReq(two, [{ lineId: "L1", partId: two.lines[0].partId, receivedQuantity: 2 }], { idempotencyKey: key }), makeDeps(two).deps);
  assert.equal(a.outcome, "applied");
  assert.equal(b.outcome, "applied", "the second PO must genuinely apply, not replay the first");
  assert.notEqual(a.receivingId, b.receivingId);
  assert.equal((await poDoc(two.poId)).status, "RECEIVED", "and the second order really was received");
});

await check("26. DIFFERENT actors, same PO and key, are different intents (repository-established actor scoping)", async () => {
  const key = nextId("shared");
  const sc = await seedCanonical({ items: [{ qty: 4 }] });
  const part = sc.lines[0].partId;
  const other = nextId("actor");
  await db.collection("receiving_grants").doc(other).set({ granted: true });
  const a = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }], { idempotencyKey: key }), makeDeps(sc).deps);
  const b = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 2 }], { idempotencyKey: key }), makeDeps({ actorId: other }).deps);
  assert.notEqual(a.receivingId, b.receivingId, "actor scoping matches partMasterCommands' auditDocId precedent");
  assert.equal(b.outcome, "applied");
});

await check("27. canonical and legacy receipt namespaces CANNOT collide", async () => {
  const sc = await seedCanonical({ items: [{ qty: 1 }] });
  const key = nextId("idem");
  const canonicalId = canonicalReceivingOrderDocId({
    operation: "receiveInventoryStock", sourceType: "PURCHASE_ORDER",
    purchaseOrderId: sc.poId, actorId: sc.actorId, idempotencyKey: key,
  });
  const legacyId = receivingOrderDocId(key);
  assert.notEqual(canonicalId, legacyId);
  assert.ok(canonicalId.startsWith("rcvc_") && legacyId.startsWith("rcv_"));
  // Prefix disjointness is structural, not incidental: no inputs can make one equal the other.
  assert.equal(canonicalId.startsWith("rcv_"), false);
});

// ═══════════════════════════════════ CONCURRENCY ═══════════════════════════════════

await check("28. TWO CONCURRENT RECEIPTS CANNOT COLLECTIVELY EXCEED REMAINING", async () => {
  // The proof Phase C rests on. A transaction QUERY takes no predicate lock, so neither receipt sees
  // the other's uncommitted receipt and both would compute remaining=5. What saves it is that every
  // canonical receipt READS AND WRITES the PO document: the loser aborts, retries, re-reads, and
  // re-derives against committed state -- where it is now an over-receipt.
  const sc = await seedCanonical({ items: [{ qty: 5 }] });
  const part = sc.lines[0].partId;
  const results = await Promise.allSettled([
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 5 }]), makeDeps(sc).deps),
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 5 }]), makeDeps(sc).deps),
  ]);
  const applied = results.filter((r) => r.status === "fulfilled");
  assert.equal(applied.length, 1, "exactly one receipt may succeed");
  assert.equal(results.filter((r) => r.status === "rejected").length, 1, "the loser must be refused, not merged");

  // The decisive assertion: total received can never exceed what was ordered.
  const receipts = await db.collection("receiving_orders").where("source.purchaseOrderId", "==", sc.poId).get();
  const total = receipts.docs.reduce((sum, d) => sum + (d.data().lines ?? []).reduce((s, l) => s + (l.receivedQuantity ?? 0), 0), 0);
  assert.equal(total, 5, `committed receipts total ${total}, ordered 5`);
});

await check("29. the losing transaction RE-DERIVES against committed state rather than reusing its stale read", async () => {
  const sc = await seedCanonical({ items: [{ qty: 6 }] });
  const part = sc.lines[0].partId;
  const results = await Promise.allSettled([
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 4 }]), makeDeps(sc).deps),
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 4 }]), makeDeps(sc).deps),
  ]);
  // 4 + 4 > 6, so one must lose. Whichever retried saw remaining 2 and refused 4.
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const receipts = await db.collection("receiving_orders").where("source.purchaseOrderId", "==", sc.poId).get();
  const total = receipts.docs.reduce((sum, d) => sum + (d.data().lines ?? []).reduce((s, l) => s + (l.receivedQuantity ?? 0), 0), 0);
  assert.ok(total <= 6, `committed total ${total} must not exceed 6`);
});

await check("30. the PO version increments on EVERY canonical receipt, including a partial one", async () => {
  // It is the serialization point, so it must move even when nothing else about the PO does.
  const sc = await seedCanonical({ items: [{ qty: 6 }] });
  const part = sc.lines[0].partId;
  assert.equal(normalizePoVersion((await poDoc(sc.poId)).version), 0, "a document without a version normalizes to 0");
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }]), makeDeps(sc).deps);
  assert.equal((await poDoc(sc.poId)).version, 1);
  await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }]), makeDeps(sc).deps);
  assert.equal((await poDoc(sc.poId)).version, 2, "a partial receipt still increments -- otherwise concurrent partials would not conflict");
  assert.equal((await poDoc(sc.poId)).status, "SENT", "and the version carries no business meaning");
});

await check("31. expectedVersion mismatch is refused", async () => {
  const sc = await seedCanonical({ items: [{ qty: 4 }] });
  const part = sc.lines[0].partId;
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }], { expectedVersion: 7 }), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError && /version_conflict/.test(e.message),
  );
  // the matching version is accepted
  const ok = await receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: part, receivedQuantity: 1 }], { expectedVersion: 0 }), makeDeps(sc).deps);
  assert.equal(ok.outcome, "applied");
});

// ═══════════════════════════════════ AUTHORITY DISCRIMINATION ═══════════════════════════════════

await check("32. a canonical source carrying a reorderRequestId is REJECTED, not silently trimmed", async () => {
  const sc = await seedCanonical({ items: [{ qty: 1 }] });
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }], {
      source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.poId, reorderRequestId: "rr-x" },
    }), makeDeps(sc).deps),
    (e) => e instanceof SourceNotReceivableError,
  );
});

await check("33. an unknown source type fails closed, and NO fallback lookup occurs", async () => {
  const sc = await seedCanonical({ items: [{ qty: 1 }] });
  for (const type of ["NOPE", "", undefined]) {
    await assert.rejects(
      receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }], {
        source: { type, purchaseOrderId: sc.poId },
      }), makeDeps(sc).deps),
      (e) => e instanceof SourceNotReceivableError,
    );
  }
});

await check("34. a canonical id is NOT looked up in the legacy collection when absent", async () => {
  const sc = await seedLegacy();
  // Address the LEGACY document id through the CANONICAL authority: it must be not-found, never
  // resolved by falling back to the collection where it does exist.
  await assert.rejects(
    receiveInventoryStock({
      source: { type: "PURCHASE_ORDER", purchaseOrderId: sc.rrid },
      receivingLocation: { type: "WAREHOUSE", locationId: "WH-1" },
      lines: [{ lineId: "L1", partId: sc.partId, receivedQuantity: 1 }],
      idempotencyKey: nextId("idem"),
    }, makeDeps(sc).deps),
    (e) => e instanceof SourceNotFoundError,
  );
  assert.equal((await db.collection("reorder_requests").doc(sc.rrid).get()).data().status, "ORDERED", "the legacy order is untouched");
});

await check("35. a PO not in a receivable lifecycle state is refused", async () => {
  for (const status of ["DRAFT", "CANCELLED", "RECEIVED"]) {
    const sc = await seedCanonical({ items: [{ qty: 1 }], status });
    await assert.rejects(
      receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }]), makeDeps(sc).deps),
      (e) => e instanceof SourceNotReceivableError, `status ${status} must not be receivable`,
    );
  }
});

await check("36. normalization NEVER mutates the source document", async () => {
  const sc = await seedCanonical({ items: [{ qty: 3 }] });
  const before = await poDoc(sc.poId);
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "GHOST", partId: sc.lines[0].partId, receivedQuantity: 1 }]), makeDeps(sc).deps),
  );
  assert.deepEqual(await poDoc(sc.poId), before, "a rejected read-and-normalize leaves the document exactly as it was");
});

await check("37. legacy and canonical purchase orders coexist, each receivable through its own authority", async () => {
  const legacy = await seedLegacy();
  const canonical = await seedCanonical({ items: [{ qty: 2 }] });
  const l = await receiveInventoryStock(legacyReq(legacy), makeDeps(legacy).deps);
  const c = await receiveInventoryStock(canonicalReq(canonical, [{ lineId: "L1", partId: canonical.lines[0].partId, receivedQuantity: 2 }]), makeDeps(canonical).deps);
  assert.equal(l.sourceType, "REORDER_PURCHASE_ORDER");
  assert.equal(c.sourceType, "PURCHASE_ORDER");
  assert.ok(l.receivingId.startsWith("rcv_") && c.receivingId.startsWith("rcvc_"));
  assert.equal((await db.collection("reorder_requests").doc(legacy.rrid).get()).data().status, "RECEIVED");
  assert.equal((await poDoc(canonical.poId)).status, "RECEIVED");
});

await check("38. an inactive Part fails the batch closed", async () => {
  const sc = await seedCanonical({ items: [{ qty: 1 }] });
  const deps = makeDeps(sc, { resolvePart: async (_t, partId) => ({ partId, trackingMode: "NONE", active: false }) }).deps;
  await assert.rejects(
    receiveInventoryStock(canonicalReq(sc, [{ lineId: "L1", partId: sc.lines[0].partId, receivedQuantity: 1 }]), deps),
    (e) => e instanceof PartInvalidError,
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
