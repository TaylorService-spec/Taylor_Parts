import { describe, it, expect } from "vitest";
import { buildTimeline } from "../src/domain/timelineBuilder";
import { EVENT_TYPE } from "../src/domain/eventTypes";

// A governed Work Order's createdAt is a Firestore Timestamp, not epoch millis. Before the
// coercion, jobEvents() passed the Timestamp straight through (rendered "Invalid Date") and
// workOrderEvents() dropped it via `typeof === "number"` (WO-level rows silently vanished).
const ms = Date.parse("2026-08-07T14:15:00Z");
const firestoreTimestamp = { toMillis: () => ms };

describe("Operational timeline coerces governed Work Order timestamps", () => {
  it("coerces a Firestore-Timestamp createdAt to numeric millis on every event", () => {
    const events = buildTimeline([{ id: "wo1", workOrderId: "wo1", status: "COMPLETED", createdAt: firestoreTimestamp }]);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(typeof e.timestamp).toBe("number");
    for (const e of events) expect(e.timestamp).toBe(ms);
  });

  it("work-order-level events return (no longer dropped by the numeric filter)", () => {
    const events = buildTimeline([{ id: "wo1", workOrderId: "wo1", status: "COMPLETED", createdAt: firestoreTimestamp }]);
    expect(events.some((e) => typeof e.type === "string" && e.type.startsWith("WORK_ORDER_"))).toBe(true);
    expect(events.some((e) => e.type === EVENT_TYPE.JOB_CREATED)).toBe(true);
  });

  it("legacy epoch-ms createdAt still passes through unchanged", () => {
    const events = buildTimeline([{ id: "wo2", workOrderId: "wo2", status: "CREATED", createdAt: ms }]);
    expect(events.every((e) => e.timestamp === ms)).toBe(true);
  });
});

// Regression: ControlTower.jsx feeds buildTimeline() an array of governed
// Work Order docs (see ControlTower.jsx's <ActivityTimelinePanel jobs={workOrders} .../>
// and jobsForWorkOrder()) -- real fieldops_wos docs, which unlike legacy Job
// records carry no `workOrderId` FK and use the 11-value uppercase governed
// status vocabulary, never the legacy lowercase JOB_STATUS one.
describe("Operational timeline over governed Work Order docs (no workOrderId, no legacy status)", () => {
  it("does not collapse every Work Order into one 'unassigned' bucket", () => {
    const events = buildTimeline([
      { id: "wo-a", status: "COMPLETED", createdAt: ms },
      { id: "wo-b", status: "CLOSED", createdAt: ms },
    ]);
    const woLevelIds = events
      .filter((e) => e.entity.type === "WORK_ORDER")
      .map((e) => e.entity.id);
    expect(woLevelIds).not.toContain("unassigned");
    expect(new Set(woLevelIds)).toEqual(new Set(["wo-a", "wo-b"]));
  });

  it("never fabricates a WORK_ORDER_BLOCKED event for a COMPLETED/CLOSED governed Work Order", () => {
    const events = buildTimeline([
      { id: "wo-a", status: "COMPLETED", createdAt: ms },
      { id: "wo-b", status: "CLOSED", createdAt: ms },
    ]);
    expect(events.some((e) => e.type === EVENT_TYPE.WORK_ORDER_BLOCKED)).toBe(false);
    expect(events.filter((e) => e.entity.id === "wo-a")).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: EVENT_TYPE.WORK_ORDER_COMPLETED })])
    );
    expect(events.filter((e) => e.entity.id === "wo-b")).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: EVENT_TYPE.WORK_ORDER_COMPLETED })])
    );
  });

  it("reports WORK_ORDER_READY, not BLOCKED, for a DISPATCHED governed Work Order", () => {
    const events = buildTimeline([{ id: "wo-c", status: "DISPATCHED", createdAt: ms }]);
    expect(events.some((e) => e.entity.id === "wo-c" && e.type === EVENT_TYPE.WORK_ORDER_READY)).toBe(true);
    expect(events.some((e) => e.entity.id === "wo-c" && e.type === EVENT_TYPE.WORK_ORDER_BLOCKED)).toBe(false);
  });
});
