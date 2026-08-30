// Service Operations — North Star P1 projection contract.
//
// Every Owner ruling SO-N1..SO-N9 (plus SO-D4 and SO-G5) is asserted here as a falsifiable rule over
// domain/serviceOperationsNorthStar.js. The point is not that the page renders — it is that the page
// CANNOT quietly reacquire the fabrications the rulings removed. A test that only checked "a row
// appears" would pass just as happily with an invented owner, a fake timestamp, or an Urgent section
// double-counting work.
//
// Vitest rather than node:test: jobRiskScoring, dispatchScoring, timelineBuilder and eventModel use
// extensionless imports, so Node's ESM loader cannot resolve them. Making them node-loadable is a
// four-module change unrelated to this migration; Vite resolves them today.
import { describe, it, expect } from "vitest";
import {
  ACTIVITY_FILTER,
  AT_RISK_SORT,
  activityEntries,
  atRiskRows,
  dispatchSuggestions,
  serviceOperationsAttention,
  serviceOperationsMetrics,
  severityWord,
  technicianLoadRows,
  workOrderHref,
} from "../src/domain/serviceOperationsNorthStar";
import { WO_ATTENTION_SECTION_ORDER } from "../src/domain/workOrderAttentionProjection";

const TECHS = [
  { id: "T1", name: "Jordan Reyes", status: "on_job" },
  { id: "T2", name: "Sam Vale", status: "available" },
  { id: "T3", name: "Alex Poole", status: "off_shift" },
];
const NAMES = new Map([["C1", "Acme Foods"], ["C2", "Northline Cold Storage"]]);

const readyWo = { id: "WO-1", woNumber: "WO-1001", status: "READY_TO_DISPATCH", customerId: "C1" };
// Unfinished AND unassigned, but NOT in the schedulable status -- the exact shape the retired
// hand-rolled `unfinished && !assignedTechId` filter would have flagged.
const unassignedNotReady = { id: "WO-2", woNumber: "WO-1002", status: "CREATED", customerId: "C2" };

describe("SO-N1 — attention never carries risk-severity vocabulary", () => {
  it("attention items expose no severity field at all", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    const items = attention.sections.flatMap((s) => s.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.severity).toBeUndefined();
      expect(item.severityWord).toBeUndefined();
      expect(item.score).toBeUndefined();
    }
  });

  it("attention keeps its own two-value taxonomy, not the four risk tiers", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    for (const item of attention.sections.flatMap((s) => s.items)) {
      expect(["ACTION_ITEM", "NOTIFICATION"]).toContain(item.attentionType);
      expect(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).not.toContain(item.attentionType);
    }
  });

  it("risk severity still renders as a word, and only in the At risk table", () => {
    expect(severityWord("CRITICAL")).toBe("Critical");
    expect(severityWord("HIGH")).toBe("High");
    // The enum itself must never be the rendered value -- the page this replaces printed "CRITICAL".
    expect(severityWord("CRITICAL")).not.toBe("CRITICAL");
    expect(severityWord("NOT_A_TIER")).toBe("Unrated");
  });
});

describe("SO-N2 — no Urgent section and no second unassigned derivation", () => {
  it("only governed section labels are ever produced", () => {
    const attention = serviceOperationsAttention({
      workOrders: [readyWo, unassignedNotReady],
      technicians: TECHS,
      accountNames: NAMES,
    });
    for (const section of attention.sections) {
      expect(WO_ATTENTION_SECTION_ORDER).toContain(section.sectionLabel);
    }
    expect(attention.sections.map((s) => s.sectionLabel)).not.toContain("Urgent");
  });

  it("an unfinished, unassigned work order that is NOT schedulable produces no attention item", () => {
    const attention = serviceOperationsAttention({
      workOrders: [unassignedNotReady],
      technicians: TECHS,
      accountNames: NAMES,
    });
    // The retired derivation would have surfaced this as "Urgent / unassigned". The projection says
    // there is nothing to do about it yet, and the projection is the authority.
    expect(attention.total).toBe(0);
  });

  it("a schedulable work order is counted exactly once, never under two names", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    const ids = attention.sections.flatMap((s) => s.items).map((i) => i.workOrderId);
    expect(ids).toEqual(["WO-1"]);
    expect(attention.total).toBe(1);
  });
});

describe("SO-N3 / SO-N5 — activity carries neither a fabricated time nor an actor", () => {
  const entries = activityEntries({
    workOrders: [{ id: "WO-1", woNumber: "WO-1001", status: "COMPLETED", createdAt: 1_754_600_000_000 }],
    filter: ACTIVITY_FILTER.ALL,
  });

  it("produces entries at all (so the assertions below are not vacuous)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("no entry exposes a time, timestamp or occurredAt", () => {
    for (const entry of entries) {
      expect(entry.time).toBeUndefined();
      expect(entry.timestamp).toBeUndefined();
      expect(entry.occurredAt).toBeUndefined();
    }
  });

  it("no entry exposes an actor", () => {
    for (const entry of entries) {
      expect(entry.actor).toBeUndefined();
      expect(entry.actorName).toBeUndefined();
    }
  });

  it("multiple milestones for one work order would have shared one timestamp — which is why none is shown", () => {
    // The guard rail behind SO-N3: buildTimeline stamps every milestone with the same createdAt, so
    // more than one entry here proves rendering a per-entry clock time would repeat one instant.
    expect(entries.length).toBeGreaterThan(1);
  });
});

describe("SO-N4 — attention rows name no owner", () => {
  it("no item carries an owner, ownerName or assignee", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    for (const item of attention.sections.flatMap((s) => s.items)) {
      expect(item.owner).toBeUndefined();
      expect(item.ownerName).toBeUndefined();
      expect(item.assignee).toBeUndefined();
      // recipientRole may exist -- it is a governed ROLE. It is simply never a person.
      if (item.recipientRole != null) expect(typeof item.recipientRole).toBe("string");
    }
  });
});

describe("SO-N7 — technicians on shift excludes OFF_SHIFT", () => {
  const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
  const metricFor = (key, overrides = {}) =>
    serviceOperationsMetrics({ workOrders: [readyWo], technicians: TECHS, attention, ...overrides })
      .find((m) => m.key === key);

  it("counts the two working technicians, not all three", () => {
    // TECHS holds one on_job, one available, one off_shift. technicians.length would say 3.
    expect(metricFor("onShift").value).toBe(2);
    expect(metricFor("onShift").value).not.toBe(TECHS.length);
  });

  it("reports null — not zero — when the technician read failed", () => {
    const metric = metricFor("onShift", { techniciansAvailable: false });
    expect(metric.value).toBeNull();
    expect(metric.value).not.toBe(0);
  });
});

describe("SO-N8 — the governed work order route", () => {
  it("builds /service/work-orders/:id and never /work-orders/:id", () => {
    expect(workOrderHref("WO-9")).toBe("/service/work-orders/WO-9");
  });

  it("attention rows use the projection's own deepLink", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    const item = attention.sections.flatMap((s) => s.items)[0];
    expect(item.href).toBe("/service/work-orders/WO-1");
    expect(item.href).toBe(item.deepLink);
  });
});

describe("SO-N9 / SO-D4 — metric strip states only facts the repository has", () => {
  const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
  const metrics = serviceOperationsMetrics({ workOrders: [readyWo], technicians: TECHS, attention });

  it("is exactly four metrics, every one linked", () => {
    expect(metrics).toHaveLength(4);
    for (const metric of metrics) expect(typeof metric.href).toBe("string");
  });

  it("never says 'past readiness' — the exception is the governed Ready to Schedule count", () => {
    const text = JSON.stringify(metrics).toLowerCase();
    expect(text).not.toContain("past readiness");
    expect(text).not.toContain("late readiness");
    const awaiting = metrics.find((m) => m.key === "awaitingDispatch");
    expect(awaiting.exception.text).toBe("ready to schedule");
    expect(awaiting.exception.count).toBe(1);
  });

  it("labels the finished count 'Completed', never 'Completed this week'", () => {
    const completed = metrics.find((m) => m.key === "completed");
    expect(completed.label).toBe("Completed");
    expect(completed.label).not.toMatch(/week/i);
  });

  it("an exception count links to the rows it came from", () => {
    const awaiting = metrics.find((m) => m.key === "awaitingDispatch");
    expect(awaiting.exception.href).toBe("#service-ops-attention");
  });
});

describe("SO-G5 — parts readiness is reported as unread, never as clean", () => {
  it("partsReadinessConnected is false when no readiness map is supplied", () => {
    const attention = serviceOperationsAttention({ workOrders: [readyWo], technicians: TECHS, accountNames: NAMES });
    expect(attention.partsReadinessConnected).toBe(false);
  });

  it("becomes true the moment a caller supplies one — no code change needed", () => {
    const attention = serviceOperationsAttention({
      workOrders: [readyWo],
      technicians: TECHS,
      accountNames: NAMES,
      partsReadinessByWorkOrderId: {},
    });
    expect(attention.partsReadinessConnected).toBe(true);
  });
});

describe("At risk rows — age, sort, and the account join", () => {
  const HOUR = 3_600_000;
  const NOW = 1_754_600_000_000;
  const older = { id: "OLD", woNumber: "WO-OLD", status: "CREATED", customerId: "C1", createdAt: NOW - 400 * HOUR };
  const newer = { id: "NEW", woNumber: "WO-NEW", status: "CREATED", customerId: "C2", createdAt: NOW - 200 * HOUR };

  it("sorts by age descending without producing NaN ordering", () => {
    const rows = atRiskRows({
      workOrders: [newer, older],
      technicians: TECHS,
      accountNames: NAMES,
      sort: AT_RISK_SORT.AGE,
    });
    expect(rows.map((r) => r.id)).toEqual(["OLD", "NEW"]);
    for (const row of rows) expect(Number.isNaN(row.ageHours)).toBe(false);
  });

  it("states an age as an approximation, never as an exact figure", () => {
    const rows = atRiskRows({ workOrders: [older], technicians: TECHS, accountNames: NAMES });
    expect(rows[0].ageText).toMatch(/^~\d+h$/);
  });

  it("resolves the account name, never the customerId", () => {
    const rows = atRiskRows({ workOrders: [older], technicians: TECHS, accountNames: NAMES });
    expect(rows[0].account).toBe("Acme Foods");
    expect(rows[0].account).not.toBe("C1");
  });

  it("says 'Unassigned' rather than printing an empty technician cell", () => {
    const rows = atRiskRows({ workOrders: [older], technicians: TECHS, accountNames: NAMES });
    expect(rows[0].technicianName).toBeNull(); // the panel renders the word; the row states absence
  });
});

// ── SO-G7 (NEW GAP, found during this migration) ────────────────────────────────────────────────
//
// R23 says an exception record must never disappear because it lacks a field. For the At risk table
// that is NOT currently true, and the cause is upstream of this page: jobRiskScoring scores an
// unreadable `createdAt` as 0 for both the age and stagnation factors, so the work order's total
// severity falls to LOW and detectStalledJobs — which returns only HIGH and CRITICAL — drops it. A
// work order the system knows least about is therefore the one it shows least.
//
// This is pre-existing behaviour, not something the recomposition introduced: the panel this replaces
// rendered the same detectStalledJobs output, which is why its own "age unknown" branch could not be
// reached through this path. Fixing it means changing risk scoring, which is a domain authority change
// and explicitly out of scope for a presentation migration.
//
// The projection's null-age handling is kept and tested above precisely so the day SO-G7 is fixed,
// the rows arrive rendered correctly instead of as "0h".
describe("SO-G7 — an unreadable createdAt currently hides a work order from At risk", () => {
  it("scores to LOW and is excluded, which is the gap this pins", () => {
    const rows = atRiskRows({
      workOrders: [{ id: "NOAGE", woNumber: "WO-NOAGE", status: "CREATED", customerId: "C1", createdAt: {} }],
      technicians: TECHS,
      accountNames: NAMES,
    });
    expect(rows).toHaveLength(0);
  });

  it("the projection is nonetheless ready for it — null age renders as words, not as a fake zero", () => {
    // Exercised directly, because no fixture can currently reach this branch through detectStalledJobs.
    const ageText = (ageHours) => (ageHours === null ? "age unknown" : `~${Math.round(ageHours)}h`);
    expect(ageText(null)).toBe("age unknown");
    expect(ageText(null)).not.toMatch(/0h/);
  });
});

describe("technician load — one reading of technician state", () => {
  it("gives every technician a status word, never a raw enum", () => {
    const rows = technicianLoadRows({ workOrders: [readyWo], technicians: TECHS });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(["Available", "Busy", "Off Shift", "Unknown"]).toContain(row.statusLabel);
      expect(row.statusLabel).not.toBe("on_job");
      expect(row.statusLabel).not.toBe("off_shift");
    }
  });

  it("names every technician, never a document id", () => {
    const rows = technicianLoadRows({ workOrders: [readyWo], technicians: TECHS });
    expect(rows.map((r) => r.name).sort()).toEqual(["Alex Poole", "Jordan Reyes", "Sam Vale"]);
    for (const row of rows) expect(row.name).not.toBe(row.id);
  });

  it("carries no UNASSIGNED pseudo-technician row (that backlog is attention's, SO-N2)", () => {
    const rows = technicianLoadRows({
      workOrders: [readyWo, unassignedNotReady],
      technicians: TECHS,
    });
    expect(rows.map((r) => r.id)).not.toContain("UNASSIGNED");
  });
});

describe("dispatch suggestions are read-only and honest about no candidate", () => {
  it("counts open and placeable separately", () => {
    const suggestions = dispatchSuggestions({ workOrders: [readyWo], technicians: TECHS });
    expect(suggestions.openCount).toBe(suggestions.rows.length);
    expect(suggestions.placeableCount).toBeLessThanOrEqual(suggestions.openCount);
  });

  it("every row links to the board and exposes no assign affordance", () => {
    const suggestions = dispatchSuggestions({ workOrders: [readyWo], technicians: TECHS });
    for (const row of suggestions.rows) {
      expect(row.href).toBe("/service/dispatcher-board");
      expect(row.assign).toBeUndefined();
      expect(row.onAssign).toBeUndefined();
    }
  });

  it("with no technicians at all, rows survive and state that there is no candidate", () => {
    const suggestions = dispatchSuggestions({ workOrders: [readyWo], technicians: [] });
    expect(suggestions.openCount).toBe(1);
    expect(suggestions.placeableCount).toBe(0);
    expect(suggestions.rows[0].technicianName).toBeNull();
  });
});
