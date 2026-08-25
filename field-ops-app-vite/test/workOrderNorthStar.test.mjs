// THE NORTH STAR CONTRACT, AS ASSERTIONS.
//
// The Design Grammar's rules are only worth having if they can fail. These test the derivations the
// Work Order page renders — one fact, one rendering (NS-P4) — offline and without a browser.
//
// Run: node --test test/workOrderNorthStar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync as fsReadFileSync } from "node:fs";
import {
  workOrderSpine,
  workOrderStatusWords,
  workOrderStatusTone,
  workOrderAttention,
  workOrderPartsPlan,
  workOrderLineage,
  workOrderHeader,
  WO_SPINE_STEPS,
  READINESS,
  SEVERITY,
  EDGE,
} from "../src/domain/workOrderNorthStar.js";

const ALL_STATUSES = [
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
];

const wo = (over = {}) => ({
  id: "wo-doc-id",
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "REPAIR",
  priority: "P2",
  customerId: "acct-1",
  locationId: "loc-1",
  scheduledTechId: "tech-1",
  scheduledStart: 1787000000000,
  salesOrderId: "so-doc-id",
  inventorySnapshot: [{ partId: "X49463-3", name: "Scraper Blade Kit", qtyPlanned: 2 }],
  ...over,
});

// ═════════════════════════════════════════ R04 — status in words, never an enum

test("EVERY governed status renders as words, never as the enum", () => {
  for (const s of ALL_STATUSES) {
    const words = workOrderStatusWords(s);
    assert.ok(words, `${s} must have a human rendering`);
    assert.notEqual(words, s, `${s} must not render as itself`);
    assert.doesNotMatch(words, /_/, `${s} rendered with an underscore: ${words}`);
    assert.doesNotMatch(words, /^[A-Z]{2,}$/, `${s} rendered as a shout: ${words}`);
  }
});

test("an UNRECOGNISED status returns null rather than a prettified guess", () => {
  // A status this map does not know is a real fact a human should see stated as unrecognised, not
  // smoothed into something readable and wrong.
  for (const bogus of ["PENDING_SOMETHING", "", null, undefined, 42]) {
    assert.equal(workOrderStatusWords(bogus), null);
  }
});

test("colour and word always agree, and colour is never the only signal", () => {
  assert.equal(workOrderStatusTone("CANCELLED"), "negative");
  assert.equal(workOrderStatusTone("CLOSED"), "positive");
  assert.equal(workOrderStatusTone("WORK_IN_PROGRESS"), "info");
  // Every status that has a tone also has a word — the pairing is what makes it survive grayscale.
  for (const s of ALL_STATUSES) assert.ok(workOrderStatusWords(s) && workOrderStatusTone(s));
});

// ═════════════════════════════════════════ NS-P1 — the lifecycle spine

test("ALL ELEVEN governed statuses map onto the six-step spine", () => {
  // The concept draws six chevrons; the engine has eleven states. A status with no step would draw
  // six hollow rings and look like a brand-new record.
  for (const s of ALL_STATUSES) {
    const { steps, unrecognised } = workOrderSpine(s);
    assert.equal(steps.length, WO_SPINE_STEPS.length);
    assert.equal(unrecognised, false, `${s} resolved no spine step`);
  }
});

test("the spine marks reached steps complete and the rest future", () => {
  const { steps, terminal } = workOrderSpine("DISPATCHED");
  assert.deepEqual(steps.map((s) => s.status), ["complete", "complete", "current", "future", "future", "future"]);
  assert.equal(terminal, null);
});

test("CREATED and READY_TO_DISPATCH share the first step", () => {
  for (const s of ["CREATED", "READY_TO_DISPATCH"]) {
    assert.equal(workOrderSpine(s).steps[0].status, "current");
  }
});

test("the three on-site statuses share one step", () => {
  for (const s of ["EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]) {
    const cur = workOrderSpine(s).steps.find((x) => x.status === "current");
    assert.equal(cur.key, "onSite", `${s} must sit on the On site step`);
  }
});

test("CANCELLED IS NOT A STEP — it is a terminal badge", () => {
  // A cancelled Work Order did not reach Closed through the spine. Drawing it as though it had would
  // be a lie about how the record ended.
  const { steps, terminal } = workOrderSpine("CANCELLED");
  assert.equal(terminal.label, "Cancelled");
  assert.equal(terminal.tone, "negative");
  assert.equal(steps.some((s) => s.status === "current"), false, "a cancelled record has no current step");
});

test("an unrecognised status is reported, not drawn as a new record", () => {
  const { unrecognised, steps } = workOrderSpine("SOMETHING_ELSE");
  assert.equal(unrecognised, true);
  assert.equal(steps.every((s) => s.status === "future"), true);
});

// ═════════════════════════════════════════ NS pattern 3 — attention

test("THE ATTENTION BLOCK RENDERS NOTHING WHEN CLEAN", () => {
  const clean = workOrderAttention(wo(), { nowMillis: 1786000000000 });
  assert.deepEqual(clean, [], `expected no attention items, got ${JSON.stringify(clean)}`);
});

test("an unscheduled or unassigned work order is BLOCKING", () => {
  const unscheduled = workOrderAttention(wo({ scheduledStart: null }), { nowMillis: 1786000000000 });
  assert.equal(unscheduled[0].severity, SEVERITY.BLOCKING);
  assert.match(unscheduled[0].fact, /not scheduled/i);

  const unassigned = workOrderAttention(wo({ scheduledTechId: null }), { nowMillis: 1786000000000 });
  assert.ok(unassigned.some((i) => /no technician assigned/i.test(i.fact)));
});

test("a passed window is stated in days, in plain language", () => {
  const items = workOrderAttention(wo(), { nowMillis: 1787000000000 + 3 * 86400000 });
  const hit = items.find((i) => i.key === "window-passed");
  assert.ok(hit);
  assert.match(hit.fact, /passed 3 days ago/);
  // The rule's internal name never reaches a human.
  assert.doesNotMatch(hit.fact, /SLA|BREACH|[A-Z]{3,}_/);
});

test("A CLOSED WORK ORDER IS NEVER OVERDUE", () => {
  // Attention on a finished job is noise that trains people to ignore the band.
  for (const status of ["COMPLETED", "CLOSED", "CANCELLED"]) {
    const items = workOrderAttention(wo({ status, scheduledStart: 1, scheduledTechId: null }), { nowMillis: 1787000000000 });
    assert.deepEqual(items, [], `${status} produced attention: ${JSON.stringify(items)}`);
  }
});

test("MULTIPLE BLOCKERS ACCUMULATE — all of them, not the first", () => {
  // Discovering blockers one round-trip at a time wastes the operator's day (Grammar R08).
  const items = workOrderAttention(wo({ scheduledStart: null, scheduledTechId: null, inventorySnapshot: [] }), { nowMillis: 1787000000000 });
  assert.ok(items.length >= 3, `expected every blocker at once, got ${items.length}`);
  const keys = items.map((i) => i.key);
  for (const k of ["unscheduled", "unassigned", "no-parts-plan"]) assert.ok(keys.includes(k), `${k} missing`);
});

test("attention on a missing record is empty, not a crash", () => {
  assert.deepEqual(workOrderAttention(null), []);
  assert.deepEqual(workOrderAttention(undefined, { nowMillis: 1 }), []);
});

// ═════════════════════════════════════════ readiness honesty

test("PARTS READINESS IS UNKNOWN, BECAUSE EOS CANNOT SEE A TRUCK", () => {
  // The concept shows "✓ On truck". That needs a live truck-stock read, which does not exist. A
  // fabricated tick would send a technician to a job without the part — exactly the failure the
  // readiness column exists to prevent.
  const plan = workOrderPartsPlan(wo());
  assert.equal(plan.length, 1);
  assert.equal(plan[0].readiness, READINESS.UNKNOWN);
  assert.equal(plan[0].name, "Scraper Blade Kit");
  assert.equal(plan[0].qtyPlanned, 2);
  // No readiness value in the plan may claim custody.
  assert.equal(plan.some((l) => /truck|staged|picked/i.test(String(l.readiness))), false);
});

test("an empty or malformed snapshot yields an empty plan, never a crash", () => {
  for (const snap of [undefined, null, [], "nope", {}]) {
    assert.deepEqual(workOrderPartsPlan(wo({ inventorySnapshot: snap })), []);
  }
});

// ═════════════════════════════════════════ R03 / R09 — lineage without ids

test("a RESOLVED lineage edge carries the governed reference", () => {
  const [edge] = workOrderLineage(wo(), { salesOrderReference: "SO-2026-000141" });
  assert.equal(edge.state, EDGE.RESOLVED);
  assert.equal(edge.reference, "SO-2026-000141");
});

test("AN UNRESOLVED EDGE NAMES THE ENTITY AND NEVER THE DOCUMENT ID", () => {
  // The brief: "If a relationship exists but its governed reference cannot currently be resolved:
  // name the entity, state reference unavailable. Never fall back to the document id."
  const [edge] = workOrderLineage(wo(), { salesOrderReference: null });
  assert.equal(edge.state, EDGE.UNRESOLVED);
  assert.equal(edge.label, "Sales order");
  assert.equal("reference" in edge, false, "an unresolved edge must carry no reference at all");
  // targetId exists for routing; it is not a label. Nothing in the rendered contract exposes it.
  assert.equal(edge.targetId, "so-doc-id");
});

test("a malformed reference is treated as UNRESOLVED, not printed", () => {
  for (const bad of ["so-doc-id", "SO-141", "", 42, {}]) {
    const [edge] = workOrderLineage(wo(), { salesOrderReference: bad });
    assert.equal(edge.state, EDGE.UNRESOLVED, `${JSON.stringify(bad)} must not pass as a reference`);
  }
});

test("no relationship is ABSENT, which is distinct from unresolved", () => {
  const [edge] = workOrderLineage(wo({ salesOrderId: null }));
  assert.equal(edge.state, EDGE.ABSENT);
});

// ═════════════════════════════════════════ the header derivation

test("THE HEADER'S REFERENCE IS THE GOVERNED NUMBER, or honestly null", () => {
  assert.equal(workOrderHeader(wo()).reference, "WO-2026-000873");
  // A record predating numbering has no reference. It must not borrow the document id (R02/R03).
  const legacy = workOrderHeader(wo({ woNumber: null }));
  assert.equal(legacy.reference, null);
  assert.equal(JSON.stringify(legacy).includes("wo-doc-id"), false, "the document id reached the header");
});

test("closed and cancelled are derived once, for every consumer", () => {
  assert.equal(workOrderHeader(wo({ status: "CLOSED" })).isClosed, true);
  assert.equal(workOrderHeader(wo({ status: "CANCELLED" })).isCancelled, true);
  assert.equal(workOrderHeader(wo({ status: "DISPATCHED" })).isClosed, false);
});

test("the header of a missing record is null, not a shape full of blanks", () => {
  assert.equal(workOrderHeader(null), null);
});

// ═════════════════════════════════════════ R03 — the whole derivation, swept

test("NO DERIVATION ANYWHERE EMITS A DOCUMENT-ID-SHAPED STRING AS CONTENT", () => {
  // The generic detector's own rule, applied to everything this page renders. `targetId` is routing
  // and is excluded by name; anything else carrying a 20-char key is a defect.
  const RAW = /\b[A-Za-z0-9]{20}\b/;
  const record = wo({ id: "cIk3hlPDTXH5IB3VHdLy", salesOrderId: "V4otE0s7EAp7ABCZEjam" });
  const rendered = {
    header: workOrderHeader(record),
    spine: workOrderSpine(record.status),
    attention: workOrderAttention(record, { nowMillis: 1787000000000 }),
    plan: workOrderPartsPlan(record),
    lineage: workOrderLineage(record, { salesOrderReference: null }).map(({ targetId: _routingKey, ...rest }) => rest),
  };
  assert.doesNotMatch(JSON.stringify(rendered), RAW, "a document id reached a rendered value");
});

// ═════════════════════════════════════════ the timeline reads the right field

// The runtime shape assertion lives in the VITEST suite: timelineBuilder imports extensionless
// module paths that Vite resolves and node:test cannot. The static guard below stays here.
test("the detail page reads timestamp, not at", () => {
  // A static guard, because the runtime symptom of getting this wrong is a plausible-looking word
  // rather than a crash.
  const readFileSync = fsReadFileSync;
  const src = readFileSync(new URL("../src/modules/workOrders/WorkOrderDetailPage.jsx", import.meta.url), "utf8");
  assert.match(src, /formatClockTime\(e\.timestamp\)/);
  assert.doesNotMatch(src, /formatClockTime\(e\.at\)/);
});
