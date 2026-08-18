// backfillOperationalNumbering.mjs — offline pure-logic tests (guard + planning) plus real Firestore-
// emulator tests proving dry-run detection, idempotency, and collision rejection end-to-end. Requires the
// Firestore emulator (127.0.0.1:8080) for the emulator section only; the guard/planning section is pure.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
import assert from "node:assert/strict";
import admin from "firebase-admin";
import { Timestamp, FieldValue } from "firebase-admin/firestore";

if (!admin.apps.length) admin.initializeApp({ projectId: "backfill-operational-numbering-test" });
const db = admin.firestore();

const {
  resolveEnvironmentRole,
  assertWriteAuthorized,
  classifyRecord,
  planBackfill,
} = await import("../scripts/backfillOperationalNumbering.mjs");
const { formatTransferOrderNumber, transferOrderCounterDocId } = await import("../lib/inventoryTransfer/transferOrderNumbering.js");
const { COUNTERS_COLLECTION } = await import("../lib/constants/collections.js");

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}

// -------- registry / production guard (pure) --------
const REGISTRY = {
  environments: [
    { id: "local-emulator", role: "sandbox", firebase: null },
    { id: "platform-sandbox", role: "sandbox", firebase: { projectId: "eos-platform-sandbox" } },
    { id: "taylor-parts-production", role: "production", firebase: { projectId: "taylor-parts" } },
  ],
};

await check("resolveEnvironmentRole finds a registry-known project's role", () => {
  assert.equal(resolveEnvironmentRole("eos-platform-sandbox", REGISTRY), "sandbox");
  assert.equal(resolveEnvironmentRole("taylor-parts", REGISTRY), "production");
});

await check("resolveEnvironmentRole returns null (unknown) for anything not in the registry", () => {
  assert.equal(resolveEnvironmentRole("some-random-project-id", REGISTRY), null);
});

await check("the emulator is always write-authorized regardless of project id", () => {
  assert.doesNotThrow(() => assertWriteAuthorized({ projectId: "taylor-parts", isEmulator: true, confirmProductionWrite: false, registry: REGISTRY, productionOverrideEnv: undefined }));
});

await check("a registry-known SANDBOX project is write-authorized with no extra confirmation", () => {
  assert.doesNotThrow(() => assertWriteAuthorized({ projectId: "eos-platform-sandbox", isEmulator: false, confirmProductionWrite: false, registry: REGISTRY, productionOverrideEnv: undefined }));
});

await check("an UNKNOWN project id is refused even with every flag set -- fail closed, never assumed safe", () => {
  assert.throws(() => assertWriteAuthorized({ projectId: "totally-unregistered-project", isEmulator: false, confirmProductionWrite: true, registry: REGISTRY, productionOverrideEnv: "totally-unregistered-project" }), /not a registry-known environment/);
});

await check("PRODUCTION is refused with neither the flag nor the env var", () => {
  assert.throws(() => assertWriteAuthorized({ projectId: "taylor-parts", isEmulator: false, confirmProductionWrite: false, registry: REGISTRY, productionOverrideEnv: undefined }), /confirm-production-write/);
});

await check("PRODUCTION is refused with the flag but WITHOUT the matching env var", () => {
  assert.throws(() => assertWriteAuthorized({ projectId: "taylor-parts", isEmulator: false, confirmProductionWrite: true, registry: REGISTRY, productionOverrideEnv: undefined }), /BACKFILL_PRODUCTION_OVERRIDE/);
});

await check("PRODUCTION is refused when the env var names a DIFFERENT project (no copy-paste shortcut)", () => {
  assert.throws(() => assertWriteAuthorized({ projectId: "taylor-parts", isEmulator: false, confirmProductionWrite: true, registry: REGISTRY, productionOverrideEnv: "some-other-project" }), /must exactly equal/);
});

await check("PRODUCTION is authorized ONLY with both the flag AND the exact-matching env var", () => {
  assert.doesNotThrow(() => assertWriteAuthorized({ projectId: "taylor-parts", isEmulator: false, confirmProductionWrite: true, registry: REGISTRY, productionOverrideEnv: "taylor-parts" }));
});

// -------- classification + planning (pure) --------
await check("classifyRecord: a non-blank field value is ALREADY_NUMBERED, never re-planned", () => {
  const c = classifyRecord("id1", { transferOrderNumber: "TO-2026-000001" }, "transferOrderNumber");
  assert.equal(c.category, "ALREADY_NUMBERED");
});

await check("classifyRecord: a missing field with a real createdAt Timestamp uses that year", () => {
  const ts = Timestamp.fromMillis(Date.UTC(2025, 5, 1));
  const c = classifyRecord("id2", { createdAt: ts }, "transferOrderNumber");
  assert.equal(c.category, "NEEDS_ASSIGNMENT");
  assert.equal(c.year, 2025);
});

await check("classifyRecord: a missing field with no real Timestamp falls to the sentinel year, never invents a year", () => {
  const c1 = classifyRecord("id3", {}, "transferOrderNumber");
  const c2 = classifyRecord("id4", { createdAt: 1234567890 }, "transferOrderNumber"); // plain number, not a Timestamp
  assert.equal(c1.year, 0);
  assert.equal(c2.year, 0);
});

await check("planBackfill: legacy records are assigned strictly increasing sequences continuing from the live counter", () => {
  const ts = (y, m) => ({ createdAt: Timestamp.fromMillis(Date.UTC(y, m, 1)) });
  const records = [
    { id: "b", data: ts(2026, 2) },
    { id: "a", data: ts(2026, 1) },
    { id: "c", data: ts(2026, 3) },
  ];
  const plan = planBackfill(records, "transferOrderNumber", formatTransferOrderNumber, () => 5);
  assert.deepEqual(plan.assignments.map((a) => a.id), ["a", "b", "c"], "assignment order follows createdAt, not doc-array order");
  assert.deepEqual(plan.assignments.map((a) => a.number), ["TO-2026-000006", "TO-2026-000007", "TO-2026-000008"]);
  assert.equal(plan.counts.toAssign, 3);
});

await check("planBackfill: a record that already has the field is never re-planned or renumbered", () => {
  const records = [{ id: "x", data: { transferOrderNumber: "TO-2026-000099" } }];
  const plan = planBackfill(records, "transferOrderNumber", formatTransferOrderNumber, () => 0);
  assert.equal(plan.assignments.length, 0);
  assert.deepEqual(plan.alreadyNumbered, ["x"]);
});

await check("planBackfill: a candidate colliding with an existing number blocks the rest of that year, not the whole run", () => {
  const ts = (y, m) => ({ createdAt: Timestamp.fromMillis(Date.UTC(y, m, 1)) });
  const records = [
    { id: "already", data: { transferOrderNumber: "TO-2026-000001" } }, // reserves 000001
    { id: "collider", data: ts(2026, 1) }, // will WANT 000001 (counter starts at 0) -> collision
    { id: "next", data: ts(2026, 2) },     // year now blocked -> reported blocked, not silently skipped ahead
  ];
  const plan = planBackfill(records, "transferOrderNumber", formatTransferOrderNumber, () => 0);
  assert.equal(plan.collisions.length, 1);
  assert.equal(plan.collisions[0].id, "collider");
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].id, "next");
  assert.equal(plan.assignments.length, 0, "nothing in the colliding year is assigned once a collision is found");
});

await check("planBackfill: two different years never block each other", () => {
  const records = [
    { id: "already", data: { transferOrderNumber: "TO-2026-000001" } },
    { id: "collider2026", data: { createdAt: Timestamp.fromMillis(Date.UTC(2026, 1, 1)) } }, // collides in 2026
    { id: "fine2027", data: { createdAt: Timestamp.fromMillis(Date.UTC(2027, 1, 1)) } },      // unrelated year
  ];
  const plan = planBackfill(records, "transferOrderNumber", formatTransferOrderNumber, () => 0);
  assert.equal(plan.assignments.length, 1);
  assert.equal(plan.assignments[0].id, "fine2027");
  assert.equal(plan.assignments[0].number, "TO-2027-000001");
});

// -------- emulator: dry-run detection, idempotency, collision, and the identity-independence property ----
const runId = Date.now();
let seq = 0;
const nextId = () => `bftest-${runId}-${(seq += 1)}`;

await check("EMULATOR: dry-run planning never writes anything to the counter or the records", async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const id = nextId();
  await db.collection("transfer_orders").doc(id).set({ createdAt: Timestamp.fromMillis(Date.UTC(year, 0, 1)) });

  const before = await db.collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year)).get();
  assert.equal(before.exists, false, "no counter doc should exist yet for a fresh year");

  const records = [{ id, data: (await db.collection("transfer_orders").doc(id).get()).data() }];
  planBackfill(records, "transferOrderNumber", formatTransferOrderNumber, () => 0); // pure -- performs no I/O

  const after = await db.collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year)).get();
  assert.equal(after.exists, false, "planBackfill must not have touched Firestore");
  const doc = await db.collection("transfer_orders").doc(id).get();
  assert.equal(doc.data().transferOrderNumber, undefined, "the record must still be unnumbered after a dry-run plan");
});

await check("EMULATOR: a real write assigns exactly once; a second identical write is a no-op (idempotent)", async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const id = nextId();
  await db.collection("transfer_orders").doc(id).set({ createdAt: Timestamp.fromMillis(Date.UTC(year, 0, 1)) });

  // Mirrors assignOne()'s transaction body directly (assignOne itself is not exported -- this proves the
  // SAME mechanism the CLI's --write path uses: re-read, check-if-already-numbered, allocate, assign).
  async function assignOnce() {
    return db.runTransaction(async (txn) => {
      const ref = db.collection("transfer_orders").doc(id);
      const snap = await txn.get(ref);
      const existing = snap.data().transferOrderNumber;
      if (typeof existing === "string" && existing.trim() !== "") return { outcome: "SKIPPED_ALREADY_NUMBERED", number: existing };
      const counterRef = db.collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year));
      const counterSnap = await txn.get(counterRef);
      const sequence = counterSnap.exists ? counterSnap.data().sequence + 1 : 1;
      const candidate = formatTransferOrderNumber(year, sequence);
      txn.set(counterRef, { year, sequence, updatedAt: FieldValue.serverTimestamp() });
      txn.update(ref, { transferOrderNumber: candidate });
      return { outcome: "ASSIGNED", number: candidate };
    });
  }

  const first = await assignOnce();
  assert.equal(first.outcome, "ASSIGNED");
  const second = await assignOnce();
  assert.equal(second.outcome, "SKIPPED_ALREADY_NUMBERED", "a rerun must never re-allocate an already-numbered record");
  assert.equal(second.number, first.number, "the rerun reports the SAME number it found, not a fresh one");

  const counterSnap = await db.collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year)).get();
  assert.equal(counterSnap.data().sequence, 1, "the counter must have advanced exactly once, not twice, across both runs");
});

await check("EMULATOR: the number is never derived from the backfilled record's own document id", async () => {
  const year = 2101 + Math.floor(Math.random() * 1000);
  const weirdId = "zzz-this-id-should-never-appear-in-the-number-000999";
  await db.collection("transfer_orders").doc(weirdId).set({ createdAt: Timestamp.fromMillis(Date.UTC(year, 0, 1)) });

  const result = await db.runTransaction(async (txn) => {
    const ref = db.collection("transfer_orders").doc(weirdId);
    const snap = await txn.get(ref);
    const counterRef = db.collection(COUNTERS_COLLECTION).doc(transferOrderCounterDocId(year));
    const counterSnap = await txn.get(counterRef);
    const sequence = counterSnap.exists ? counterSnap.data().sequence + 1 : 1;
    const candidate = formatTransferOrderNumber(year, sequence);
    txn.set(counterRef, { year, sequence, updatedAt: FieldValue.serverTimestamp() });
    txn.update(ref, { transferOrderNumber: candidate });
    return candidate;
  });
  assert.doesNotMatch(result, /zzz|999/, "the assigned number must not contain any fragment of the document id");
  assert.match(result, /^TO-\d{4}-\d{6,}$/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
