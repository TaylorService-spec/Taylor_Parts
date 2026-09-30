import { beforeEach, describe, expect, it, vi } from "vitest";

const firestore = {
  getDoc: vi.fn(),
  getDocs: vi.fn(),
};

vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (...args) => ({ kind: "collection", args }),
  doc: (...args) => ({ kind: "doc", args }),
  getDoc: (...args) => firestore.getDoc(...args),
  getDocs: (...args) => firestore.getDocs(...args),
  query: (...args) => ({ kind: "query", args }),
  where: (...args) => ({ kind: "where", args }),
}));

import {
  getInventoryConsumptionSnapshot,
  getTechnicianExecutionStats,
  getTechnicianVolumeBreakdown,
  getWorkOrderExecutionSummary,
  normalizeQtyUsed,
} from "../src/analytics/executionAnalyticsService";
import { __setWorkOrderTransportForTests } from "../src/services/workOrderService";


beforeEach(() => vi.clearAllMocks());

describe("execution analytics service", () => {
  it("normalizes only positive recorded usage without mutating the snapshot", () => {
    const snapshot = [{ sku: "P-1", qtyUsed: 2 }, { sku: "P-2", qtyUsed: 0 }, { sku: "P-3" }];
    expect(normalizeQtyUsed(snapshot)).toEqual([{ partId: "P-1", quantity: 2 }]);
    expect(snapshot).toEqual([{ sku: "P-1", qtyUsed: 2 }, { sku: "P-2", qtyUsed: 0 }, { sku: "P-3" }]);
  });

  it("returns null for a missing work order and a sorted, derived execution summary otherwise", async () => {
    // Work Order cutover: the summary reads the GOVERNED detail (readWorkOrder), not a Firestore doc.
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_FOUND", reason: "WORK_ORDER_NOT_FOUND", status: 404, message: "x" }));
    await expect(getWorkOrderExecutionSummary("missing")).resolves.toBeNull();

    __setWorkOrderTransportForTests(async (op) => ({
      ok: true, operation: op,
      result: {
        workOrderId: "wo-1", status: "WORK_IN_PROGRESS", createdAt: "1970-01-01T00:00:00.001Z", updatedAt: new Date(30).toISOString(),
        execution: {
          parts: [{ partId: "P-1", qtyPlanned: 3, qtyUsed: 3 }],
          notes: [
            { note: "later", recordedByPrincipalId: "p", recordedAt: new Date(20).toISOString() },
            { note: "first", recordedByPrincipalId: "p", recordedAt: new Date(10).toISOString() },
          ],
        },
      },
    }));
    await expect(getWorkOrderExecutionSummary("wo-1")).resolves.toMatchObject({
      workOrderId: "wo-1",
      totalPartsUsed: 3,
      partsUsed: [{ partId: "P-1", quantity: 3 }],
      executionNotes: ["first", "later"],
      lastUpdated: 30,
    });
    expect(firestore.getDoc).not.toHaveBeenCalled();
    __setWorkOrderTransportForTests(null);
  });

  // ── THE AGGREGATES ARE GOVERNED (Work Order cutover completion pass, 2026-09-30) ──────────────────────
  //
  // getTechnicianExecutionStats / getInventoryConsumptionSnapshot / getTechnicianVolumeBreakdown are computed by
  // the SERVER (functions/src/eosOps/workOrderAnalytics.ts) over the active Work Order set; their definitions --
  // completedAt-ever-set, the inverted-pair withdrawal, missing evidence, actuals > 0, the ordering -- are proven
  // against real PostgreSQL in functions/test/workOrderAnalyticsPostgres.test.mjs. What the CLIENT must prove is
  // that it asks the governed route the right question, passes the answer through without re-deriving it, never
  // shows a negative duration, never touches Firestore, and throws a classifiable failure.

  const calls = [];
  const transport = (results) => async (operation, input) => {
    calls.push({ operation, input });
    const r = results[operation];
    return r && r.ok === false ? r : { ok: true, operation, result: r };
  };
  const STATS = {
    employeeId: "emp-a", displayName: "Ana", totalWorkOrdersCompleted: 4, totalPartsConsumed: 10,
    averageCompletionTimeMs: 4_200_000, completionEvidence: { valid: 3, inverted: 0, missing: 1 },
    workOrderVolumeByStatus: { CLOSED: 1, COMPLETED: 3 },
  };

  it("own stats: readTechnicianExecutionStats with NO technician id -- the server resolves the Employee", async () => {
    calls.length = 0;
    __setWorkOrderTransportForTests(transport({ readTechnicianExecutionStats: STATS }));
    await expect(getTechnicianExecutionStats()).resolves.toEqual(STATS);
    expect(calls).toEqual([{ operation: "readTechnicianExecutionStats", input: {} }]);
    await getTechnicianExecutionStats("emp-b");
    expect(calls[1]).toEqual({ operation: "readTechnicianExecutionStats", input: { employeeId: "emp-b" } });
    expect(firestore.getDocs).not.toHaveBeenCalled();
    __setWorkOrderTransportForTests(null);
  });

  it("the server's withheld average stays withheld, and a negative figure is never passed through as a duration", async () => {
    __setWorkOrderTransportForTests(transport({ readTechnicianExecutionStats: { ...STATS, averageCompletionTimeMs: null,
      completionEvidence: { valid: 1, inverted: 1, missing: 0 } } }));
    const withheld = await getTechnicianExecutionStats();
    expect(withheld.averageCompletionTimeMs).toBeNull();
    expect(withheld.completionEvidence).toEqual({ valid: 1, inverted: 1, missing: 0 });
    __setWorkOrderTransportForTests(transport({ readTechnicianExecutionStats: { ...STATS, averageCompletionTimeMs: -1686 * 60_000 } }));
    expect((await getTechnicianExecutionStats()).averageCompletionTimeMs).toBeNull();
    __setWorkOrderTransportForTests(null);
  });

  it("consumption and volume are the governed office aggregates, passed through in the server's order", async () => {
    calls.length = 0;
    __setWorkOrderTransportForTests(transport({
      readWorkOrderConsumptionSnapshot: {
        parts: [{ partId: "P-1", totalQuantityUsed: 14, frequency: 3 }, { partId: "P-2", totalQuantityUsed: 2, frequency: 2 }],
        mostConsumedPartId: "P-1", basis: "RECORDED_EXECUTION_ACTUALS",
      },
      readTechnicianVolumeBreakdown: { items: [
        { employeeId: "emp-a", displayName: "Ana", activeCount: 1, completedCount: 1 },
        { employeeId: "emp-b", displayName: null, activeCount: 0, completedCount: 1 },
      ] },
    }));
    await expect(getInventoryConsumptionSnapshot()).resolves.toEqual({
      mostConsumedPartId: "P-1",
      parts: [
        { partId: "P-1", totalQuantityUsed: 14, frequency: 3 },
        { partId: "P-2", totalQuantityUsed: 2, frequency: 2 },
      ],
    });
    await expect(getTechnicianVolumeBreakdown()).resolves.toEqual([
      { employeeId: "emp-a", displayName: "Ana", activeCount: 1, completedCount: 1 },
      { employeeId: "emp-b", displayName: null, activeCount: 0, completedCount: 1 },
    ]);
    expect(calls.map((c) => c.operation)).toEqual(["readWorkOrderConsumptionSnapshot", "readTechnicianVolumeBreakdown"]);
    expect(firestore.getDocs).not.toHaveBeenCalled();
    __setWorkOrderTransportForTests(null);
  });

  it("a refusal THROWS the governed failure (code + reason) -- no fallback, nothing fabricated", async () => {
    __setWorkOrderTransportForTests(transport({
      readWorkOrderConsumptionSnapshot: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_MISSING", status: 403, message: "no" },
      readTechnicianExecutionStats: { ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "off" },
    }));
    await expect(getInventoryConsumptionSnapshot()).rejects.toMatchObject({ code: "FORBIDDEN", reason: "CAPABILITY_MISSING" });
    await expect(getTechnicianExecutionStats()).rejects.toMatchObject({ code: "NOT_ACTIVATED" });
    expect(firestore.getDocs).not.toHaveBeenCalled();
    __setWorkOrderTransportForTests(null);
  });
});
