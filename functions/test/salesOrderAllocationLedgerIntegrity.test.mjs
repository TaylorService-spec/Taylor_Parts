// SALES ORDER ALLOCATION -- the availability gate FAILS CLOSED on a malformed ledger row (Controller ruling DQ-019).
//
// allocateSalesOrder decides eligible on-hand from the inventory_transactions rows of a part. It used to hand every
// row to sumLedgerEligibleOnHand, which SKIPS a row it cannot read -- and a skipped DEBIT raises availability, so an
// order could be allocated stock that already left. The gate now reads the rows through the authoritative ledger read
// (inventoryLedger/authoritativeLedgerRows.ts, the one L3 module): any unclassifiable or unreadable operational row
// refuses the whole determination with an explicit integrity refusal. Never a skip, never a substituted zero.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Timestamp } from "firebase-admin/firestore";

const { authoritativeOperationalMovements, LedgerRowIntegrityError } = await import("../lib/inventoryLedger/authoritativeLedgerRows.js");
const { sumLedgerEligibleOnHand } = await import("../lib/fulfillment/fulfillmentAvailability.js");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const NOW = 1_700_000_000_000;
const PART = "PRT-ALLOC";
const WH = { type: "WAREHOUSE", locationId: "wh-main" };
const OTHER = { type: "WAREHOUSE", locationId: "wh-north" };
const DIRECTION = { RECEIVED: "IN", TRANSFER_OUT: "OUT", TRANSFER_IN: "IN", ADJUSTED: "SIGNED", SCRAPPED: "OUT" };
const SOURCE = { RECEIVED: "RECEIVING_ORDER", TRANSFER_OUT: "TRANSFER_ORDER", TRANSFER_IN: "TRANSFER_ORDER", ADJUSTED: "ADJUSTMENT", SCRAPPED: "SCRAP" };
let seq = 0;
/** A well-formed STORED operational row (the shape deserializeOperationalMovement accepts). */
const row = (type, quantity, location = WH) => {
  seq += 1;
  return {
    schemaVersion: 2, type, direction: DIRECTION[type], partId: PART, trackingMode: "NONE", location, quantity,
    sourceObject: { type: SOURCE[type], id: `src-${seq}` }, idempotencyKey: `idem-${seq}`,
    actor: { kind: "SYSTEM", id: "WORK_ORDER_TRANSITION" },
    occurredAt: NOW, recordedAt: Timestamp.fromMillis(NOW), fingerprint: "0".repeat(16),
    ...(type.startsWith("TRANSFER") ? { counterpartyLocation: location === WH ? OTHER : WH } : {}),
  };
};
const legacy = (type, quantity) => ({ type, quantity, partId: PART, workOrderId: "wo-1" });
const docs = (...rows) => rows.map((data, i) => ({ id: `txn-${i}`, data: () => data }));
const gate = (d) => sumLedgerEligibleOnHand(authoritativeOperationalMovements(d), new Set(["wh-main"]), new Map());

test("well-formed rows: the gate sums eligible on-hand exactly; legacy Work-Order rows are excluded by rule, not skipped", () => {
  assert.equal(gate(docs(row("RECEIVED", 10), row("TRANSFER_OUT", 3), legacy("RESERVED", 99))), 7);
  assert.equal(gate(docs(legacy("RESERVED", 5))), null, "no physical evidence is UNKNOWN, never zero");
});

test("a malformed DEBIT refuses the determination -- skipping it would have RAISED availability from 7 to 10", () => {
  const brokenDebit = { ...row("TRANSFER_OUT", 3), direction: "SIDEWAYS" };
  // The old lenient path: the broken debit is still counted or skipped by type alone -- the gate must not decide.
  assert.throws(() => gate(docs(row("RECEIVED", 10), brokenDebit)),
    (e) => e instanceof LedgerRowIntegrityError && e.docId === "txn-1" && e.reason === "UNREADABLE_OPERATIONAL");
});

test("an unclassifiable row refuses too; the refusal names the row id, never its contents", () => {
  assert.throws(() => gate(docs(row("RECEIVED", 10), { schemaVersion: 2, type: "NONSENSE", partId: PART })),
    (e) => e instanceof LedgerRowIntegrityError && e.reason === "UNCLASSIFIABLE" && !/NONSENSE/.test(e.message));
  assert.throws(() => gate(docs(row("RECEIVED", 10), "not an object")), (e) => e instanceof LedgerRowIntegrityError);
});

test("allocateSalesOrder reads on-hand through the authoritative read and maps the refusal to an explicit integrity error", () => {
  const src = readFileSync(join(SRC, "fulfillment", "allocateSalesOrder.ts"), "utf8");
  const readPartOnHand = src.slice(src.indexOf("async function readPartOnHand"), src.indexOf("async function readOpenWoReserved"));
  assert.match(readPartOnHand, /authoritativeOperationalMovements\(snap\.docs\)/, "the gate reads rows leniently again");
  assert.doesNotMatch(readPartOnHand, /snap\.docs\.map\(/, "raw rows reach the sum without the integrity read");
  assert.match(src, /err instanceof LedgerRowIntegrityError[\s\S]{0,200}"failed-precondition"[\s\S]{0,200}LEDGER_ROW_INTEGRITY/,
    "an unreadable row must surface as the explicit integrity refusal, not a generic internal error");
});
