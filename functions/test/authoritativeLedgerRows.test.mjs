// DQ-019: authoritative inventory results FAIL CLOSED on a malformed ledger row, and the pre-activation
// census measures exactly what that read would refuse. Pure + one CLI run over a temp snapshot file.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

const { authoritativeOperationalMovements, censusLedgerRows, LedgerRowIntegrityError } =
  await import("../lib/inventoryLedger/authoritativeLedgerRows.js");
const { serializeOperationalMovement, fingerprintMovement } = await import("../lib/inventoryLedger/operationalMovementRepository.js");

let seq = 0;
function goodRow(partId = "P-1", type = "RECEIVED", quantity = 3) {
  seq += 1;
  const value = {
    type, direction: type === "RECEIVED" ? "IN" : "OUT", partId, trackingMode: "NONE",
    location: { type: "WAREHOUSE", locationId: "wh-1" }, quantity,
    sourceObject: { type: type === "RECEIVED" ? "RECEIVING_ORDER" : "TRANSFER_ORDER", id: `s-${seq}` },
    idempotencyKey: `k-${seq}`, actor: { kind: "USER", id: "u1" }, occurredAt: 1_700_000_000_000,
    ...(type === "TRANSFER_OUT" ? { counterpartyLocation: { type: "WAREHOUSE", locationId: "wh-2" } } : {}),
  };
  return serializeOperationalMovement(value, new Date(1_700_000_000_000), fingerprintMovement(value));
}
const doc = (id, data) => ({ id, data: () => data });
const legacyRow = { type: "RESERVED", partId: "P-1", quantity: 9 };

test("well-formed operational rows are returned; LEGACY rows are excluded by classification", () => {
  const out = authoritativeOperationalMovements([doc("a", goodRow()), doc("b", legacyRow), doc("c", goodRow("P-1", "TRANSFER_OUT", 1))]);
  assert.equal(out.length, 2);
});

test("an unclassifiable row and an unreadable operational row each REFUSE the whole result, naming only the id", () => {
  assert.throws(() => authoritativeOperationalMovements([doc("a", goodRow()), doc("bad-1", { schemaVersion: 2, type: "NONSENSE", partId: "P-1" })]),
    (e) => e instanceof LedgerRowIntegrityError && e.docId === "bad-1" && e.reason === "UNCLASSIFIABLE");
  const unreadable = { ...goodRow(), quantity: -1 }; // a malformed DEBIT-shaped row: skipping it would inflate stock
  assert.throws(() => authoritativeOperationalMovements([doc("bad-2", unreadable)]),
    (e) => e instanceof LedgerRowIntegrityError && e.reason === "UNREADABLE_OPERATIONAL" && !e.message.includes("-1"));
  assert.throws(() => authoritativeOperationalMovements([doc("bad-3", null)]), LedgerRowIntegrityError);
});

test("census: counts, reasons, ids, blocked parts, verdict -- and it never throws", () => {
  const c = censusLedgerRows([
    doc("ok", goodRow("P-1")), doc("leg", legacyRow),
    doc("m1", { schemaVersion: 2, type: "NONSENSE", partId: "P-2" }),
    doc("m2", { ...goodRow("P-3"), quantity: -5 }),
    doc("m3", "not an object"),
  ]);
  assert.equal(c.total, 5); assert.equal(c.operational, 1); assert.equal(c.legacy, 1); assert.equal(c.malformed, 3);
  assert.deepEqual(c.malformedByReason, { UNCLASSIFIABLE: 2, UNREADABLE_OPERATIONAL: 1 });
  assert.deepEqual(c.malformedRowIds, ["m1", "m2", "m3"]);
  assert.deepEqual(c.blockedPartIds, ["P-2", "P-3"]);
  assert.equal(c.malformedWithoutPartId, 1);
  assert.equal(c.verdict, "MALFORMED_ROWS_PRESENT");
  assert.equal(censusLedgerRows([doc("ok", goodRow())]).verdict, "READY");
  assert.equal(censusLedgerRows([]).verdict, "READY");
});

test("CLI: decodes $timestamp snapshot tags, verifies the checksum, exits 0 READY / 3 MALFORMED / 2 refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "l3-ledger-census-"));
  const encode = (row) => ({ ...row, recordedAt: { $timestamp: { seconds: row.recordedAt.seconds, nanoseconds: row.recordedAt.nanoseconds } } });
  const run = (file) => spawnSync(process.execPath, ["scripts/inventoryLedgerCensus.js", "--snapshot", file], { encoding: "utf8" });

  const ready = join(dir, "ready.json");
  writeFileSync(ready, JSON.stringify({ rows: [{ id: "a", data: encode(goodRow()) }, { id: "l", data: legacyRow }] }));
  let r = run(ready);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).operational, 1);

  const bad = join(dir, "bad.json");
  const body = JSON.stringify({ collections: { inventory_transactions: [{ id: "a", data: encode(goodRow()) }, { id: "x", data: goodRow() /* live Timestamp object, not a tag -> unreadable */ }] } });
  writeFileSync(bad, body);
  writeFileSync(`${bad}.sha256`, createHash("sha256").update(body).digest("hex"));
  r = run(bad);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).malformedRowIds, ["x"]);

  writeFileSync(`${bad}.sha256`, "0".repeat(64));
  assert.equal(run(bad).status, 2);
  assert.equal(run(join(dir, "missing.json")).status, 2);
  assert.ok(Timestamp);
});
