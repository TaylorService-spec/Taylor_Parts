// A MIGRATION THAT REWRITES WHAT SOMEBODY TYPED IS WORSE THAN THE DEFECT IT FIXES.
//
// The six affected Work Orders carry a machine-generated sentence with a Firestore document id in
// it. `complaint` is also a field a human types into. These tests exist to keep those two apart:
// eligibility is PROVEN (exact template + resolvable order + governed number + corroborating link),
// never inferred from "contains something id-shaped".
//
// Run: node --test test/workOrderComplaintReferenceMigration.test.mjs   (after `npm run build`)
import test from "node:test";
import assert from "node:assert/strict";
import {
  planWorkOrderComplaintCorrection,
  planFingerprint,
  correctedComplaint,
  LEGACY_COMPLAINT_PATTERN,
  MAX_MIGRATED_WORK_ORDERS,
} from "../lib/serviceMigrations/workOrderComplaintReferenceMigration.js";

const SO_ID = "cIk3hlPDTXH5IB3VHdLy";
const SO_NUM = "SO-2026-000004";
const legacy = (id = SO_ID) => `Sales Order fulfillment ${id}: deliver/install ordered items`;

const wo = (over = {}) => ({
  workOrderId: "wo-1", woNumber: "WO-2026-000003",
  complaint: legacy(), salesOrderId: SO_ID, ...over,
});
const resolves = (map) => (id) => map[id] ?? { exists: false, salesOrderNumber: null };
const GOOD = resolves({ [SO_ID]: { exists: true, salesOrderNumber: SO_NUM } });

// ═════════════════════════════════════════ the happy path, exactly

test("THE EXACT LEGACY SENTENCE IS ELIGIBLE, and only the identifier changes", () => {
  const plan = planWorkOrderComplaintCorrection([wo()], GOOD);
  assert.equal(plan.changes.length, 1);
  const c = plan.changes[0];
  assert.equal(c.before, "Sales Order fulfillment cIk3hlPDTXH5IB3VHdLy: deliver/install ordered items");
  assert.equal(c.after, "Sales Order fulfillment SO-2026-000004: deliver/install ordered items");
  // Every other word, and the punctuation, survive untouched.
  assert.equal(c.before.replace(SO_ID, "«»"), c.after.replace(SO_NUM, "«»"));
  assert.equal(c.salesOrderNumber, SO_NUM);
  assert.equal(c.woNumber, "WO-2026-000003");
});

test("the corrected text is the SAME sentence today's writer emits", () => {
  // A third variant would mean the migration invented a format, and the next detector sweep would
  // be comparing against something no code produces.
  assert.equal(correctedComplaint(SO_NUM), `Sales Order fulfillment ${SO_NUM}: deliver/install ordered items`);
});

// ═════════════════════════════════════════ WHAT MUST NEVER BE REWRITTEN

test("USER-AUTHORED TEXT CONTAINING AN ID IS NOT ELIGIBLE", () => {
  // The whole reason this is not a regex-and-replace. Somebody's words about a machine are not a
  // template, and a migration that "helpfully" edited them would destroy a service record.
  const authored = [
    `customer says unit ${SO_ID} is leaking again`,
    `Sales Order fulfillment ${SO_ID}: deliver/install ordered items -- CUSTOMER CALLED, RESCHEDULE`,
    `see ${SO_ID}`,
    `URGENT. Sales Order fulfillment ${SO_ID}: deliver/install ordered items`,
  ];
  for (const complaint of authored) {
    const plan = planWorkOrderComplaintCorrection([wo({ complaint })], GOOD);
    assert.equal(plan.changes.length, 0, `must not rewrite: ${complaint}`);
    assert.equal(plan.skipped[0].reason, "NOT_LEGACY_TEMPLATE");
  }
});

test("the template is ANCHORED at both ends", () => {
  assert.ok(LEGACY_COMPLAINT_PATTERN.test(legacy()));
  assert.ok(!LEGACY_COMPLAINT_PATTERN.test(` ${legacy()}`));
  assert.ok(!LEGACY_COMPLAINT_PATTERN.test(`${legacy()} `));
  assert.ok(!LEGACY_COMPLAINT_PATTERN.test(`x${legacy()}`));
});

test("an ordinary work order is not reported as a skip at all", () => {
  // Reporting every non-candidate would bury the six that matter under a hundred that never were.
  const plan = planWorkOrderComplaintCorrection([wo({ complaint: "Ice machine not making ice" })], GOOD);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.skipped.length, 0);
});

// ═════════════════════════════════════════ the four proofs, each failing closed

test("an UNRESOLVED Sales Order is skipped, never guessed at", () => {
  const plan = planWorkOrderComplaintCorrection([wo()], resolves({}));
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.skipped[0].reason, "SALES_ORDER_NOT_FOUND");
});

test("a Sales Order with NO GOVERNED NUMBER is skipped", () => {
  // There is no reference to substitute. Falling back to a reference-free sentence would change
  // what the record SAYS, which is not this migration's business.
  for (const salesOrderNumber of [null, "", "12345", "SO-2026-1", "so-2026-000004"]) {
    const plan = planWorkOrderComplaintCorrection([wo()], resolves({ [SO_ID]: { exists: true, salesOrderNumber } }));
    assert.equal(plan.changes.length, 0, `must skip number: ${JSON.stringify(salesOrderNumber)}`);
    assert.equal(plan.skipped[0].reason, "NO_GOVERNED_NUMBER");
  }
});

test("A DISAGREEING LINK IS SKIPPED — the corroboration is the point", () => {
  // Without this, the id in the text is just a string that looks like an id. The Work Order's own
  // salesOrderId was written separately by the same legacy path, so agreement is real evidence.
  for (const salesOrderId of [null, "someOtherOrderId000", "OAWJJ7fE3fKrrbub01aD"]) {
    const plan = planWorkOrderComplaintCorrection([wo({ salesOrderId })], GOOD);
    assert.equal(plan.changes.length, 0, `must skip link: ${salesOrderId}`);
    assert.equal(plan.skipped[0].reason, "LINK_DISAGREES");
  }
});

test("a non-string complaint cannot crash the planner", () => {
  for (const complaint of [null, undefined, 42, {}, []]) {
    const plan = planWorkOrderComplaintCorrection([wo({ complaint })], GOOD);
    assert.equal(plan.changes.length, 0);
  }
});

// ═════════════════════════════════════════ IDEMPOTENCY

test("A SECOND RUN CHANGES NOTHING", () => {
  const first = planWorkOrderComplaintCorrection([wo()], GOOD);
  assert.equal(first.changes.length, 1);
  // Feed the planner the post-migration state.
  const after = planWorkOrderComplaintCorrection([wo({ complaint: first.changes[0].after })], GOOD);
  assert.equal(after.changes.length, 0, "already-corrected records must produce no write");
  // The corrected sentence no longer matches the legacy template, so it is not even a candidate.
  assert.equal(after.skipped.length, 0);
});

test("the corrected sentence does not match the legacy template", () => {
  assert.ok(!LEGACY_COMPLAINT_PATTERN.test(correctedComplaint(SO_NUM)));
});

// ═════════════════════════════════════════ THE PLAN FINGERPRINT

test("the fingerprint is STABLE across ordering and CHANGES with content", () => {
  // Its job is to detect drift between the plan a person reviewed and the plan being executed.
  const a = { workOrderId: "a", woNumber: "WO-1", embeddedSalesOrderId: SO_ID, salesOrderNumber: SO_NUM, before: legacy(), after: correctedComplaint(SO_NUM) };
  const b = { workOrderId: "b", woNumber: "WO-2", embeddedSalesOrderId: SO_ID, salesOrderNumber: SO_NUM, before: legacy(), after: correctedComplaint(SO_NUM) };
  assert.equal(planFingerprint([a, b]), planFingerprint([b, a]), "order must not change the fingerprint");
  assert.notEqual(planFingerprint([a]), planFingerprint([a, b]), "a different change set is a different plan");
  const mutated = { ...a, after: "Sales Order fulfillment SO-2026-999999: deliver/install ordered items" };
  assert.notEqual(planFingerprint([a]), planFingerprint([mutated]), "a changed target is a different plan");
  assert.equal(planFingerprint([]).startsWith("0-"), true, "an empty plan is recognisable as empty");
});

// ═════════════════════════════════════════ BOUNDS AND THE REAL SET

test("THE AFFECTED SET IS THE SIX KNOWN RECORDS, and the bound is far below a runaway", () => {
  // The real sandbox shape: six legacy records among ordinary work orders.
  const records = [
    ...["cIk3hlPDTXH5IB3VHdLy", "V4otE0s7EAp7ABCZEjam", "qrlfHGG8x8nGMTmot9pZ",
        "INqO9CaHMdQMp2g030yf", "NNC1iU4DPoxJ26c35E2T", "OAWJJ7fE3fKrrbub01aD"]
      .map((id, i) => wo({ workOrderId: `wo-${i}`, woNumber: `WO-2026-00000${i + 1}`, complaint: legacy(id), salesOrderId: id })),
    wo({ workOrderId: "ordinary-1", complaint: "Compressor is loud", salesOrderId: null }),
    wo({ workOrderId: "ordinary-2", complaint: "Annual maintenance", salesOrderId: null }),
  ];
  const map = Object.fromEntries(
    ["cIk3hlPDTXH5IB3VHdLy", "V4otE0s7EAp7ABCZEjam", "qrlfHGG8x8nGMTmot9pZ",
     "INqO9CaHMdQMp2g030yf", "NNC1iU4DPoxJ26c35E2T", "OAWJJ7fE3fKrrbub01aD"]
      .map((id, i) => [id, { exists: true, salesOrderNumber: `SO-2026-00000${i + 2}` }]),
  );
  const plan = planWorkOrderComplaintCorrection(records, resolves(map));
  assert.equal(plan.scanned, 8);
  assert.equal(plan.changes.length, 6, "exactly the six, and nothing ordinary");
  assert.equal(plan.skipped.length, 0);
  assert.ok(plan.changes.length <= MAX_MIGRATED_WORK_ORDERS);
  for (const c of plan.changes) assert.match(c.after, /^Sales Order fulfillment SO-\d{4}-\d{6}: deliver\/install ordered items$/);
});

// ═════════════════════════════════════════ THE DETECTOR, BEFORE AND AFTER

test("THE GENERIC RAW_ID DETECTOR FIRES BEFORE AND IS SILENT AFTER", async () => {
  // No route-specific exemption anywhere: the SAME detector the certification sweep runs must stop
  // firing because the DATA changed, not because it was told to look away.
  const { PROBE } = await import("../../field-ops-app-vite/.claude/skills/run-field-ops-app-vite/probe.mjs");
  const run = (text) => {
    const el = { innerText: text, querySelectorAll: () => [], offsetParent: {} };
    const savedDoc = globalThis.document, savedStyle = globalThis.getComputedStyle;
    globalThis.document = { documentElement: { clientWidth: 1440, scrollWidth: 1440, clientHeight: 900 }, querySelector: () => el, body: el };
    globalThis.getComputedStyle = () => ({ overflowX: "visible", position: "static" });
    try { return PROBE(false); } finally { globalThis.document = savedDoc; globalThis.getComputedStyle = savedStyle; }
  };
  const before = run(`Job Assignments\nWO-2026-000003\t${legacy()}`);
  const hit = before.find((f) => f.kind === "RAW_ID");
  assert.ok(hit, "the detector must fire on the legacy text, or this migration proves nothing");
  assert.equal(hit.detail, SO_ID);

  const after = run(`Job Assignments\nWO-2026-000003\t${correctedComplaint(SO_NUM)}`);
  assert.equal(after.find((f) => f.kind === "RAW_ID"), undefined, "the corrected text must be clean");
});
