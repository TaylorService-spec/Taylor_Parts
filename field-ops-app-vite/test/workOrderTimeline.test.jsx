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
