// EI Phase-2 Receiving -- Gate E2-V: OFFLINE proof of the lossless warehouse backup codec + restore drift
// gate. Pure `node` against the compiled codec. Prereq: npm run build.
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  encodeValue, decodeValue, encodeSnapshot, decodeSnapshot, validateSnapshotShape, snapshotHash, planRestore,
  WarehouseBackupError,
} from "../lib/warehouseGovernance/warehouseBackupCodec.js";

let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed += 1; console.log(`PASS: ${name}`); } catch (e) { failed += 1; console.error(`FAIL: ${name}`); console.error(e); } }
const COMMIT = "a".repeat(40);
const PINS = { projectId: "taylor-parts", governedCommit: COMMIT };
const TS = Timestamp.fromMillis(1_700_000_123_456);
function gov(id, over = {}) { return { id, name: "N", location: "L", status: "ACTIVE", version: 1, updatedAt: TS, updatedBy: "u", provenance: "MIGRATED", createdAt: TS, createdBy: "u", governanceInitializedAt: TS, governanceInitializedBy: "t", ...over }; }
const live = (id, data) => ({ warehouseId: id, data });

check("value round-trip preserves Timestamp exactly (seconds + nanoseconds)", () => {
  const enc = encodeValue(TS);
  assert.deepEqual(enc, { __fsType: "timestamp", seconds: TS.seconds, nanoseconds: TS.nanoseconds });
  const dec = decodeValue(enc);
  assert.ok(dec instanceof Timestamp);
  assert.equal(dec.seconds, TS.seconds); assert.equal(dec.nanoseconds, TS.nanoseconds);
  assert.equal(dec.toMillis(), TS.toMillis());
});

check("value round-trip: primitives, nested arrays + maps", () => {
  const v = { a: 1, b: "s", c: true, d: null, e: [1, "x", { f: TS }], g: { h: { i: false } } };
  const dec = decodeValue(encodeValue(v));
  assert.ok(dec.e[2].f instanceof Timestamp);
  assert.equal(dec.e[2].f.toMillis(), TS.toMillis());
  assert.deepEqual({ ...dec, e: dec.e.slice(0, 2) }, { a: 1, b: "s", c: true, d: null, e: [1, "x"], g: { h: { i: false } } });
});

check("encode FAILS CLOSED on non-round-trippable values", () => {
  assert.throws(() => encodeValue(undefined), (e) => e instanceof WarehouseBackupError && e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue(NaN), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue(Infinity), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue(10n), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue(Buffer.from("x")), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue(() => 1), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeValue({ __fsTypeX: 1 }), (e) => e instanceof WarehouseBackupError); // reserved-key guard
});

check("snapshot: encode -> validate -> decode round-trips a governed set; hash is deterministic", () => {
  const set = [live("w1", gov("w1")), live("w2", gov("w2", { status: "INACTIVE" }))];
  const snap = encodeSnapshot(set, PINS);
  assert.equal(snap.capturedCount, 2);
  assert.deepEqual([...snap.docIds], ["w1", "w2"]);
  assert.equal(snapshotHash(snap), snapshotHash(encodeSnapshot([...set].reverse(), PINS))); // order-independent
  const decoded = decodeSnapshot(snap);
  const w1 = decoded.find((d) => d.warehouseId === "w1");
  assert.ok(w1.data.updatedAt instanceof Timestamp);
  assert.equal(w1.data.status, "ACTIVE");
});

check("encodeSnapshot rejects blank/duplicate ids + non-map data", () => {
  assert.throws(() => encodeSnapshot([live("", gov("x"))], PINS), (e) => e.code === "INVALID_INPUT");
  assert.throws(() => encodeSnapshot([live("w", gov("w")), live("w", gov("w"))], PINS), (e) => e.code === "INVALID_INPUT");
  assert.throws(() => encodeSnapshot([live("w", 5)], PINS), (e) => e.code === "UNSUPPORTED_VALUE");
  assert.throws(() => encodeSnapshot([live("w", gov("w"))], { projectId: "other", governedCommit: COMMIT }), (e) => e.code === "INVALID_INPUT");
});

check("validateSnapshotShape fails closed on corruption", () => {
  const good = encodeSnapshot([live("w1", gov("w1"))], PINS);
  assert.throws(() => validateSnapshotShape({ ...good, kind: "x" }), (e) => e.code === "CORRUPT_SNAPSHOT");
  assert.throws(() => validateSnapshotShape({ ...good, capturedCount: 99 }), (e) => e.code === "CORRUPT_SNAPSHOT");
  assert.throws(() => validateSnapshotShape({ ...good, docs: {} }), (e) => e.code === "CORRUPT_SNAPSHOT"); // keys != docIds
});

check("planRestore: bounded set ok; content change is the revert target (non-blocking)", () => {
  const snap = encodeSnapshot([live("w1", gov("w1")), live("w2", gov("w2"))], PINS);
  // live has the SAME ids but migrated content (status flipped) -> ok, changedCount counts the revert.
  const migrated = [live("w1", gov("w1", { status: "INACTIVE", version: 2 })), live("w2", gov("w2"))];
  const plan = planRestore(snap, migrated, PINS);
  assert.equal(plan.ok, true); assert.equal(plan.restoreCount, 2); assert.equal(plan.changedCount, 1);
});

check("planRestore FAILS CLOSED on identity-set drift (added/deleted) + pin mismatch", () => {
  const snap = encodeSnapshot([live("w1", gov("w1")), live("w2", gov("w2"))], PINS);
  const added = planRestore(snap, [live("w1", gov("w1")), live("w2", gov("w2")), live("w3", gov("w3"))], PINS);
  assert.equal(added.ok, false); assert.equal(added.reason, "live_set_drift"); assert.deepEqual([...added.added], ["w3"]);
  const deleted = planRestore(snap, [live("w1", gov("w1"))], PINS);
  assert.equal(deleted.ok, false); assert.deepEqual([...deleted.deleted], ["w2"]);
  const wrongCommit = planRestore(snap, [live("w1", gov("w1")), live("w2", gov("w2"))], { projectId: "taylor-parts", governedCommit: "b".repeat(40) });
  assert.equal(wrongCommit.ok, false); assert.equal(wrongCommit.reason, "commit_mismatch");
});

check("planRestore ok + changedCount 0 when live == snapshot (post-restore parity shape)", () => {
  const set = [live("w1", gov("w1")), live("w2", gov("w2"))];
  const snap = encodeSnapshot(set, PINS);
  const plan = planRestore(snap, set, PINS);
  assert.equal(plan.ok, true); assert.equal(plan.changedCount, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
