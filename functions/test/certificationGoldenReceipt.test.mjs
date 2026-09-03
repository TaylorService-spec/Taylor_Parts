// THE BOUNDED RECEIPT APPLIER — what it may do, and what it must refuse.
//
// The Certification program had every piece of a governed receipt and no way to perform one against
// a live project. executeG03Receipt.mjs holds the real machinery but is a scenario script: its
// "EMULATOR ONLY" is a comment enforcing nothing, it resolves no execution target, and it pins its
// clock — running it live would have stamped a receipt with a date the receipt did not happen on.
//
// The alternative was an ad-hoc Admin-SDK write, which is not a ceremony: it is a document that
// looks like one, with no capability check, no warehouse validation, and no audit event.
//
// So the applier adds a bounded entry point and NO receiving logic. These tests cover the part it
// actually owns — scope resolution and refusal — and deliberately do not re-test the receiving
// service, which has its own suites.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(process.cwd(), "..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

// IMPORTING THE APPLIER IS SAFE, and the two lines below are why.
//
// The module resolves an execution target at import time. With no --projectId it refuses, which
// is correct -- there is no default target -- and it records that refusal in process.exitCode.
// That exit code would fail this whole FILE even with every assertion passing, so it is cleared
// once, visibly, rather than by making the applier quieter about refusing.
//
// The refusal path performs no Firestore work, so the import reads and writes nothing; only the
// pure exports below are exercised.
process.argv = ["node", "applyGoldenReceipt.mjs"];   // no --projectId => refuses before any I/O
const applier = await import(L("functions/scripts/certificationWorld/applyGoldenReceipt.mjs"));
const { parseReceiptRequest, planReceipt, receiptIdempotencyKey } = applier;
process.exitCode = 0;   // clear the import-time refusal; see the note above
const { RECEIVABLE_CANONICAL_STATUSES } =
  await import(L("functions/lib/inventoryReceiving/receivingSourceResolver.js"));

const GOLDEN = "80Ouc3U9Auk2Aet5tgXQ";
const po = (over = {}) => ({
  id: GOLDEN, supplierId: "cw-sup-001", status: "SENT",
  items: [{ partId: "CW-P-0000", quantity: 20, unitPrice: 10 }],
  ...over,
});

// ============================================================================================
// ARGUMENTS ARE STATED, NEVER DEFAULTED.
// ============================================================================================
test("every target value must be stated -- nothing is inferred", () => {
  const base = ["--purchaseOrderId", GOLDEN, "--partId", "CW-P-0000", "--quantity", "10"];
  assert.deepEqual(parseReceiptRequest(base), { purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 10 });

  assert.throws(() => parseReceiptRequest(["--partId", "CW-P-0000", "--quantity", "10"]),
    /--purchaseOrderId is required/, "a tool that picks its own order can pick the wrong one");
  assert.throws(() => parseReceiptRequest(["--purchaseOrderId", GOLDEN, "--quantity", "10"]),
    /--partId is required/);
  for (const bad of ["0", "-5", "2.5", "abc", undefined]) {
    assert.throws(() => parseReceiptRequest(["--purchaseOrderId", GOLDEN, "--partId", "CW-P-0000",
      ...(bad === undefined ? [] : ["--quantity", bad])]), /--quantity must be a positive whole number/);
  }
});

// ============================================================================================
// SCOPE IS PROVEN, NOT DESCRIBED.
// ============================================================================================
test("the plan resolves the exact line and the outstanding quantity", () => {
  const plan = planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 10 }, po(), []);
  assert.equal(plan.lineId, "L1", "a procurementService item carries no lineId; the ordinal is the fallback");
  assert.equal(plan.orderedQuantity, 20);
  assert.equal(plan.outstandingBefore, 20);
  assert.equal(plan.outstandingAfter, 10);
  assert.equal(plan.partial, true);
  assert.equal(plan.destination.locationId, "wh-main");
});

test("a receipt may never exceed what is still outstanding", () => {
  assert.throws(
    () => planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 21 }, po(), []),
    /exceeds the 20 still outstanding/);
  // And outstanding is DERIVED from committed receipts, not from the ordered quantity.
  const afterTen = [{ receivingId: "r1", lines: [{ lineId: "L1", receivedQuantity: 10 }] }];
  const plan = planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 10 }, po(), afterTen);
  assert.equal(plan.outstandingBefore, 10, "the first receipt must reduce what the second may take");
  assert.equal(plan.outstandingAfter, 0);
  assert.equal(plan.partial, false, "the second 10 completes the line");
  assert.throws(
    () => planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 11 }, po(), afterTen),
    /exceeds the 10 still outstanding/);
});

test("an unresolvable line refuses rather than guessing", () => {
  assert.throws(() => planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-9999", quantity: 1 }, po(), []),
    /no line on .* carries part CW-P-9999/);
  const twoLines = po({ items: [
    { partId: "CW-P-0000", quantity: 20, unitPrice: 10 },
    { partId: "CW-P-0000", quantity: 5, unitPrice: 10 },
  ] });
  assert.throws(() => planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 1 }, twoLines, []),
    /2 lines .* ambiguous, refusing/, "two lines for one part is a question the tool must not answer itself");
});

test("a non-receivable status refuses", () => {
  for (const status of ["DRAFT", "RECEIVED", "CANCELLED"]) {
    assert.throws(() => planReceipt({ purchaseOrderId: GOLDEN, partId: "CW-P-0000", quantity: 1 },
      po({ status }), []), new RegExp(`is ${status}, which is not receivable`));
  }
});

// ============================================================================================
// THE TRAP. The applier must NOT refuse it, and that is deliberate.
// ============================================================================================
test("APPROVED is receivable, so the applier does not refuse the trap order on status", () => {
  // Refusing APPROVED would contradict the domain the trap exists to demonstrate: an order that IS
  // receivable and deliberately is NOT inbound. Refusing it by hardcoded id would put fixture
  // knowledge in a tool. The protection is that the scope block prints certIntent before any write.
  assert.ok(RECEIVABLE_CANONICAL_STATUSES.includes("APPROVED"));
  const trap = { id: "hdLJjlIEJhzjoii8o1Me", status: "APPROVED",
    items: [{ partId: "CW-P-0001", quantity: 15, unitPrice: 12.5 }], certIntent: "APPROVED_TRAP_NOT_INBOUND" };
  const plan = planReceipt({ purchaseOrderId: trap.id, partId: "CW-P-0001", quantity: 5 }, trap, []);
  assert.equal(plan.status, "APPROVED");
  assert.equal(plan.outstandingBefore, 15);
});

test("the applier reads ONLY the order it was told to read", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/applyGoldenReceipt.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The purchase-order read is by document id, never a collection scan -- so no other order can be
  // fetched, compared, or written by this tool.
  assert.match(code, /collection\(PURCHASE_ORDERS\)\.doc\(request\.purchaseOrderId\)/);
  assert.doesNotMatch(code, /collection\(PURCHASE_ORDERS\)\.get\(\)/,
    "a collection scan would put every order in reach");
  // The scope block must surface the intent, which is the mistyped-id protection.
  assert.match(src, /intent\s+\$\{poSnap\.data\(\)\?\.certIntent/);
});

// ============================================================================================
// GATES AND IDEMPOTENCY.
// ============================================================================================
test("a live write demands BOTH flags, like every other heavy writer", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.resolve(REPO, "functions/scripts/certificationWorld/applyGoldenReceipt.mjs"), "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(code, /assertBothLiveFlags/, "a receipt moves real stock");
  assert.match(code, /resolveExecutionTarget/, "production and unknown projects refuse through the shared gate");

  const { assertBothLiveFlags, ExecutionTargetRefused } =
    await import(L("functions/scripts/certificationWorld/executionTarget.mjs"));
  const target = { projectId: "eos-platform-certification", isLive: true, apply: true };
  assert.throws(() => assertBothLiveFlags({ target, argv: ["node", "x", "--apply"] }),
    (e) => e instanceof ExecutionTargetRefused);
  assert.doesNotThrow(() => assertBothLiveFlags({
    target, argv: ["node", "x", "--apply", "--apply-live-certification"] }));
});

test("the idempotency key is deterministic, and quantity is part of it", () => {
  const k = (quantity) => receiptIdempotencyKey({ purchaseOrderId: GOLDEN, lineId: "L1", quantity });
  assert.equal(k(10), `cw_recv_${GOLDEN}_L1_10`);
  assert.equal(k(10), k(10), "a rerun must be recognised as a replay, not committed twice");
  assert.notEqual(k(10), k(5),
    "two different partial receipts of one line are different events and must not collide");
});
