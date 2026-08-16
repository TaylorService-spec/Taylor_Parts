import test from "node:test";
import assert from "node:assert/strict";
import {
  WO_ATTENTION_TYPE,
  WO_ATTENTION_SECTION_ORDER,
  workOrderReadyUnscheduledItem,
  workOrderPastDueItem,
  workOrderOverlapItems,
  workOrderPartsBlockerItem,
  workOrderAttentionItems,
  groupWorkOrderAttentionItemsBySection,
} from "../src/domain/workOrderAttentionProjection.js";

const DAY = 24 * 60 * 60 * 1000;
// A fixed Wednesday 12:00 local time -- avoids DST-edge flakiness in the day-bucketing tests.
const NOW = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
const TODAY_START = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();

// ---- Signal 1: READY but unscheduled ---------------------------------------------------------------

test("READY_TO_DISPATCH -> ACTION_ITEM, 'Ready to Schedule' section", () => {
  const item = workOrderReadyUnscheduledItem({ id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" });
  assert.equal(item.attentionType, WO_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(item.requiresAction, true);
  assert.equal(item.sectionLabel, "Ready to Schedule");
  assert.equal(item.recipientRole, "DISPATCHER");
  assert.equal(item.deepLink, "/service/work-orders/WO-1");
  assert.equal(item.woNumber, "WO-1001");
});

test("READY_TO_DISPATCH: any other status yields null -- never guessed", () => {
  for (const status of ["CREATED", "SCHEDULED", "DISPATCHED", "COMPLETED", "CLOSED", "CANCELLED", undefined, "BOGUS"]) {
    assert.equal(workOrderReadyUnscheduledItem({ id: "WO-1", status }), null, `status ${status} should yield null`);
  }
});

test("malformed WO (missing/invalid id) yields null, never throws", () => {
  assert.equal(workOrderReadyUnscheduledItem(null), null);
  assert.equal(workOrderReadyUnscheduledItem(undefined), null);
  assert.equal(workOrderReadyUnscheduledItem({ status: "READY_TO_DISPATCH" }), null);
  assert.equal(workOrderReadyUnscheduledItem({ id: "", status: "READY_TO_DISPATCH" }), null);
  assert.equal(workOrderReadyUnscheduledItem({ id: 123, status: "READY_TO_DISPATCH" }), null);
});

// ---- Signal 2: past-due scheduled ------------------------------------------------------------------

test("SCHEDULED with scheduledStart before today -> ACTION_ITEM 'Past Due'", () => {
  const item = workOrderPastDueItem(
    { id: "WO-2", status: "SCHEDULED", scheduledStart: TODAY_START - DAY },
    { nowMs: NOW }
  );
  assert.equal(item.attentionType, WO_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(item.sectionLabel, "Past Due");
  assert.equal(item.reason, "PAST_DUE");
  assert.equal(item.deepLink, "/service/work-orders/WO-2");
});

test("SCHEDULED for today or in the future -> null (not past-due)", () => {
  assert.equal(
    workOrderPastDueItem({ id: "WO-2", status: "SCHEDULED", scheduledStart: TODAY_START }, { nowMs: NOW }),
    null
  );
  assert.equal(
    workOrderPastDueItem({ id: "WO-2", status: "SCHEDULED", scheduledStart: TODAY_START + DAY }, { nowMs: NOW }),
    null
  );
});

test("past-due never fires for a status other than SCHEDULED (e.g. already DISPATCHED / COMPLETED)", () => {
  for (const status of ["CREATED", "READY_TO_DISPATCH", "DISPATCHED", "ACCEPTED", "COMPLETED", "CLOSED", "CANCELLED"]) {
    assert.equal(
      workOrderPastDueItem({ id: "WO-2", status, scheduledStart: TODAY_START - DAY }, { nowMs: NOW }),
      null,
      `status ${status} should never be past-due`
    );
  }
});

test("no due date ever invented: SCHEDULED with missing/malformed scheduledStart yields null, not a fabricated date", () => {
  assert.equal(workOrderPastDueItem({ id: "WO-2", status: "SCHEDULED" }, { nowMs: NOW }), null);
  assert.equal(workOrderPastDueItem({ id: "WO-2", status: "SCHEDULED", scheduledStart: "not-a-date" }, { nowMs: NOW }), null);
  assert.equal(workOrderPastDueItem({ id: "WO-2", status: "SCHEDULED", scheduledStart: null }, { nowMs: NOW }), null);
});

// ---- Signal 3: scheduling conflict (overlap) ---------------------------------------------------------

test("two overlapping scheduled jobs for the same technician on the same day both flag as ACTION_ITEM", () => {
  const a = { id: "WO-3", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
  const items = workOrderOverlapItems([a, b], { nowMs: NOW });
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.objectId).sort(), ["WO-3", "WO-4"]);
  for (const item of items) {
    assert.equal(item.attentionType, WO_ATTENTION_TYPE.ACTION_ITEM);
    assert.equal(item.sectionLabel, "Scheduling Conflict");
    assert.equal(item.techId, "T1");
  }
});

test("non-overlapping jobs for the same technician/day produce no conflict items", () => {
  const a = { id: "WO-3", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 10 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  assert.equal(workOrderOverlapItems([a, b], { nowMs: NOW }).length, 0);
});

test("overlapping times for DIFFERENT technicians never conflict with each other", () => {
  const a = { id: "WO-3", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", assignedTechId: "T2", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  assert.equal(workOrderOverlapItems([a, b], { nowMs: NOW }).length, 0);
});

test("overlap detection is GLOBAL, not week-bound: a conflict weeks away from `now` still fires", () => {
  const farStart = TODAY_START + 40 * DAY + 9 * 3600_000;
  const a = { id: "WO-3", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: farStart, scheduledEnd: farStart + 2 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: farStart + 3600_000, scheduledEnd: farStart + 3 * 3600_000 };
  assert.equal(workOrderOverlapItems([a, b], { nowMs: NOW }).length, 2);
});

test("terminal (CANCELLED/CLOSED) work orders are excluded from overlap detection", () => {
  const a = { id: "WO-3", status: "CANCELLED", assignedTechId: "T1", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", assignedTechId: "T1", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
  assert.equal(workOrderOverlapItems([a, b], { nowMs: NOW }).length, 0);
});

test("a job with no technician assigned is never treated as conflicting (overlap is per-technician)", () => {
  const a = { id: "WO-3", status: "SCHEDULED", scheduledStart: TODAY_START + 9 * 3600_000, scheduledEnd: TODAY_START + 11 * 3600_000 };
  const b = { id: "WO-4", status: "SCHEDULED", scheduledStart: TODAY_START + 10 * 3600_000, scheduledEnd: TODAY_START + 12 * 3600_000 };
  assert.equal(workOrderOverlapItems([a, b], { nowMs: NOW }).length, 0);
});

test("workOrderOverlapItems never throws on malformed/non-array input", () => {
  assert.equal(workOrderOverlapItems(null).length, 0);
  assert.equal(workOrderOverlapItems(undefined).length, 0);
  assert.doesNotThrow(() => workOrderOverlapItems([null, { id: "WO-1" }, "not-an-object"]));
});

// ---- Signal 4: parts blocker (composed from workOrderPartsReadiness output) ------------------------

test("jobReadiness ATTENTION, all rows PROCUREMENT_PENDING -> NOTIFICATION (in motion, not stalled)", () => {
  const readiness = { jobReadiness: "ATTENTION", rows: [{ readiness: "ATTENTION", reason: "PROCUREMENT_PENDING" }] };
  const item = workOrderPartsBlockerItem({ id: "WO-5" }, readiness);
  assert.equal(item.attentionType, WO_ATTENTION_TYPE.NOTIFICATION);
  assert.equal(item.requiresAction, false);
  assert.equal(item.sectionLabel, "Parts Blocked");
  assert.equal(item.reason, "PROCUREMENT_PENDING");
});

test("jobReadiness ATTENTION with a genuinely SHORT row (nothing happening) -> ACTION_ITEM", () => {
  const readiness = { jobReadiness: "ATTENTION", rows: [{ readiness: "ATTENTION", reason: "SHORT" }] };
  const item = workOrderPartsBlockerItem({ id: "WO-5" }, readiness);
  assert.equal(item.attentionType, WO_ATTENTION_TYPE.ACTION_ITEM);
  assert.equal(item.requiresAction, true);
  assert.equal(item.reason, "SHORT");
});

test("a MIX of SHORT and PROCUREMENT_PENDING rows is honestly an ACTION_ITEM (not everything is in motion)", () => {
  const readiness = {
    jobReadiness: "ATTENTION",
    rows: [{ readiness: "ATTENTION", reason: "PROCUREMENT_PENDING" }, { readiness: "ATTENTION", reason: "SHORT" }],
  };
  const item = workOrderPartsBlockerItem({ id: "WO-5" }, readiness);
  assert.equal(item.attentionType, WO_ATTENTION_TYPE.ACTION_ITEM);
});

test("NO_PLAN is NOT 'blocked' -- a job with nothing planned yields null, never an attention item", () => {
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, { jobReadiness: "NO_PLAN", rows: [] }), null);
});

test("READY and UNKNOWN readiness never surface a parts-blocker item (UNKNOWN is not a confirmed problem)", () => {
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, { jobReadiness: "READY", rows: [] }), null);
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, { jobReadiness: "UNKNOWN", rows: [] }), null);
});

test("parts blocker: missing/malformed readiness input yields null, never throws", () => {
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, null), null);
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, undefined), null);
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, "not-an-object"), null);
  // Rollup says ATTENTION but no row actually confirms it -- honest null, never a guess.
  assert.equal(workOrderPartsBlockerItem({ id: "WO-5" }, { jobReadiness: "ATTENTION", rows: [] }), null);
  assert.equal(workOrderPartsBlockerItem(null, { jobReadiness: "ATTENTION", rows: [{ readiness: "ATTENTION", reason: "SHORT" }] }), null);
});

// ---- Batch + grouping --------------------------------------------------------------------------------

test("workOrderAttentionItems composes all four signals into one flat list, dropping nulls", () => {
  const workOrders = [
    { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" },
    { id: "WO-2", woNumber: "WO-1002", status: "SCHEDULED", scheduledStart: TODAY_START - DAY },
    { id: "WO-3", woNumber: "WO-1003", status: "COMPLETED" }, // nothing to surface
    { id: "WO-4", woNumber: "WO-1004", status: "DISPATCHED" }, // nothing to surface
  ];
  const partsReadinessByWorkOrderId = {
    "WO-4": { jobReadiness: "ATTENTION", rows: [{ readiness: "ATTENTION", reason: "SHORT" }] },
  };
  const items = workOrderAttentionItems({ workOrders, partsReadinessByWorkOrderId, nowMs: NOW });
  const byObjectId = new Set(items.map((i) => i.objectId));
  assert.ok(byObjectId.has("WO-1")); // ready-unscheduled
  assert.ok(byObjectId.has("WO-2")); // past-due
  assert.ok(byObjectId.has("WO-4")); // parts blocker (composed even though DISPATCHED has no scheduling signal)
  assert.equal(items.filter((i) => i.objectId === "WO-3").length, 0); // COMPLETED WO produced nothing
});

test("workOrderAttentionItems: malformed/non-array workOrders yields an empty list, never throws", () => {
  assert.equal(workOrderAttentionItems({ workOrders: null }).length, 0);
  assert.equal(workOrderAttentionItems({}).length, 0);
  assert.equal(workOrderAttentionItems().length, 0);
});

test("groupWorkOrderAttentionItemsBySection: fixed order, empty sections omitted", () => {
  const items = workOrderAttentionItems({
    workOrders: [
      { id: "WO-2", woNumber: "WO-1002", status: "SCHEDULED", scheduledStart: TODAY_START - DAY },
      { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH" },
    ],
    nowMs: NOW,
  });
  const grouped = groupWorkOrderAttentionItemsBySection(items);
  assert.deepEqual(
    grouped.map((g) => g.sectionLabel),
    ["Ready to Schedule", "Past Due"] // fixed WO_ATTENTION_SECTION_ORDER order, not insertion order
  );
  assert.equal(grouped.find((g) => g.sectionLabel === "Scheduling Conflict"), undefined);
  assert.equal(grouped.find((g) => g.sectionLabel === "Parts Blocked"), undefined);
});

test("groupWorkOrderAttentionItemsBySection: empty input -> empty list (empty state), never throws", () => {
  assert.deepEqual(groupWorkOrderAttentionItemsBySection([]), []);
  assert.deepEqual(groupWorkOrderAttentionItemsBySection(null), []);
  assert.deepEqual(groupWorkOrderAttentionItemsBySection([{ foo: "bar" }, null]), []);
});

test("WO_ATTENTION_SECTION_ORDER is the exact, stable four-section order", () => {
  assert.deepEqual(WO_ATTENTION_SECTION_ORDER, ["Ready to Schedule", "Past Due", "Scheduling Conflict", "Parts Blocked"]);
});

test("every produced item's deepLink targets the canonical WO detail route, never a fabricated route", () => {
  const items = workOrderAttentionItems({
    workOrders: [{ id: "WO-9", woNumber: "WO-9001", status: "READY_TO_DISPATCH" }],
    nowMs: NOW,
  });
  assert.equal(items[0].deepLink, "/service/work-orders/WO-9");
});
