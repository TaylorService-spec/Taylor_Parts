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

const stamp = (ms) => ({ toMillis: () => ms });
const docs = (items) => ({ docs: items.map(({ id, ...data }) => ({ id, data: () => data })) });

beforeEach(() => vi.clearAllMocks());

describe("execution analytics service", () => {
  it("normalizes only positive recorded usage without mutating the snapshot", () => {
    const snapshot = [{ sku: "P-1", qtyUsed: 2 }, { sku: "P-2", qtyUsed: 0 }, { sku: "P-3" }];
    expect(normalizeQtyUsed(snapshot)).toEqual([{ partId: "P-1", quantity: 2 }]);
    expect(snapshot).toEqual([{ sku: "P-1", qtyUsed: 2 }, { sku: "P-2", qtyUsed: 0 }, { sku: "P-3" }]);
  });

  it("returns null for a missing work order and a sorted, derived execution summary otherwise", async () => {
    firestore.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getWorkOrderExecutionSummary("missing")).resolves.toBeNull();

    firestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        inventorySnapshot: [{ sku: "P-1", qtyUsed: 3 }],
        executionLog: [{ note: "later", at: stamp(20) }, { note: "first", at: stamp(10) }],
        lastUpdated: stamp(30),
      }),
    });
    await expect(getWorkOrderExecutionSummary("wo-1")).resolves.toMatchObject({
      workOrderId: "wo-1",
      totalPartsUsed: 3,
      partsUsed: [{ partId: "P-1", quantity: 3 }],
      executionNotes: ["first", "later"],
      lastUpdated: 30,
    });
  });

  it("aggregates technician completion, usage, statuses, and durations from its scoped query", async () => {
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "a", status: "CLOSED", inventorySnapshot: [{ sku: "P-1", qtyUsed: 2 }], completedAt: stamp(50), workStartedAt: stamp(10) },
      { id: "b", status: "DISPATCHED", inventorySnapshot: [{ sku: "P-2", qtyUsed: 4 }] },
      { id: "c", status: "CLOSED", inventorySnapshot: [{ sku: "P-1", qtyUsed: 1 }], completedAt: stamp(100), workStartedAt: stamp(40) },
    ]));

    await expect(getTechnicianExecutionStats("tech-1")).resolves.toEqual({
      technicianId: "tech-1",
      totalWorkOrdersCompleted: 2,
      totalPartsConsumed: 7,
      averageCompletionTimeMs: 50,
      completionEvidence: { valid: 2, inverted: 0 },
      workOrderVolumeByStatus: { CLOSED: 2, DISPATCHED: 1 },
    });
  });


  // ── AVG JOB DURATION: the live defect, and the three kinds of evidence ────────────────────────
  //
  // THE LIVE DEFECT. The technician screen reported "Avg Job Duration -1686m" -- a negative span
  // presented as a performance fact about a person. The subtraction was always the right way round
  // (completedAt - workStartedAt); what was missing is that the pair can CONTRADICT the lifecycle,
  // and the projection pushed whatever difference it got, sign included, straight into the mean.

  it("a valid span is measured normally, and a zero-length span is a real measurement", () => {
    // Zero is not missing evidence: start and completion were both recorded, at the same instant.
    return (async () => {
      firestore.getDocs.mockResolvedValueOnce(docs([
        { id: "a", status: "CLOSED", completedAt: stamp(1000), workStartedAt: stamp(400) },
        { id: "b", status: "CLOSED", completedAt: stamp(700), workStartedAt: stamp(700) },
      ]));
      const stats = await getTechnicianExecutionStats("tech-1");
      expect(stats.averageCompletionTimeMs).toBe(300); // (600 + 0) / 2
      expect(stats.completionEvidence).toEqual({ valid: 2, inverted: 0 });
    })();
  });

  it("REPRODUCES THE LIVE DEFECT: an inverted pair never becomes a negative average", async () => {
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "a", status: "CLOSED", completedAt: stamp(1000), workStartedAt: stamp(400) },
      // completedAt BEFORE workStartedAt -- the shape that produced -1686m live.
      { id: "b", status: "CLOSED", completedAt: stamp(500), workStartedAt: stamp(100_000_000) },
    ]));
    const stats = await getTechnicianExecutionStats("tech-1");
    expect(stats.averageCompletionTimeMs).toBeNull();
    expect(stats.completionEvidence).toEqual({ valid: 1, inverted: 1 });
  });

  it("an inverted pair is neither absolute-valued nor clamped to zero", async () => {
    // The two shortcuts that would make the screen look fine and the number meaningless. abs() would
    // report a huge plausible duration; clamping would report a suspiciously fast job. Both invent a
    // fact from evidence the platform cannot explain.
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "b", status: "CLOSED", completedAt: stamp(500), workStartedAt: stamp(900) },
    ]));
    const stats = await getTechnicianExecutionStats("tech-1");
    expect(stats.averageCompletionTimeMs).toBeNull();
    expect(stats.averageCompletionTimeMs).not.toBe(400); // abs()
    expect(stats.averageCompletionTimeMs).not.toBe(0);   // clamp / swap
  });

  it("missing timestamps are never fabricated, and never counted as inverted", async () => {
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "a", status: "CLOSED", completedAt: stamp(1000) },              // no start
      { id: "b", status: "DISPATCHED", workStartedAt: stamp(10) },          // no completion
      { id: "c", status: "CREATED" },                                       // neither
    ]));
    const stats = await getTechnicianExecutionStats("tech-1");
    expect(stats.averageCompletionTimeMs).toBeNull();
    expect(stats.completionEvidence).toEqual({ valid: 0, inverted: 0 });
    // The completion COUNT is a different fact and is unaffected -- one Work Order has a completedAt.
    expect(stats.totalWorkOrdersCompleted).toBe(1);
  });

  it("a mixed population withdraws the figure rather than averaging the trustworthy part", async () => {
    // Three good records and one contradictory one. Averaging the three would report a number over a
    // population this projection KNOWS is partly untrustworthy, under a name that claims all of it.
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "a", status: "CLOSED", completedAt: stamp(1000), workStartedAt: stamp(400) },
      { id: "b", status: "CLOSED", completedAt: stamp(2000), workStartedAt: stamp(1000) },
      { id: "c", status: "CLOSED", completedAt: stamp(3000), workStartedAt: stamp(2000) },
      { id: "d", status: "CLOSED", completedAt: stamp(10), workStartedAt: stamp(9000) },
      { id: "e", status: "CREATED" },
    ]));
    const stats = await getTechnicianExecutionStats("tech-1");
    expect(stats.averageCompletionTimeMs).toBeNull();
    expect(stats.completionEvidence).toEqual({ valid: 3, inverted: 1 });
  });

  it("a malformed timestamp is missing evidence, not a duration", async () => {
    firestore.getDocs.mockResolvedValueOnce(docs([
      { id: "a", status: "CLOSED", completedAt: stamp(Number.NaN), workStartedAt: stamp(10) },
      { id: "b", status: "CLOSED", completedAt: { notATimestamp: true }, workStartedAt: stamp(10) },
    ]));
    const stats = await getTechnicianExecutionStats("tech-1");
    expect(stats.averageCompletionTimeMs).toBeNull();
    expect(stats.completionEvidence).toEqual({ valid: 0, inverted: 0 });
  });

  it("builds system-wide part consumption and technician volume rankings", async () => {
    const snapshot = docs([
      { id: "a", assignedTechId: "tech-1", inventorySnapshot: [{ sku: "P-1", qtyUsed: 2 }, { sku: "P-2", qtyUsed: 1 }], completedAt: stamp(1) },
      { id: "b", assignedTechId: "tech-1", inventorySnapshot: [{ sku: "P-1", qtyUsed: 3 }] },
      { id: "c", assignedTechId: "tech-2", inventorySnapshot: [{ sku: "P-2", qtyUsed: 1 }], completedAt: stamp(2) },
      { id: "d", inventorySnapshot: [{ sku: "P-1", qtyUsed: 9 }] },
    ]);
    firestore.getDocs.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(snapshot);

    await expect(getInventoryConsumptionSnapshot()).resolves.toEqual({
      mostConsumedPartId: "P-1",
      parts: [
        { partId: "P-1", totalQuantityUsed: 14, frequency: 3 },
        { partId: "P-2", totalQuantityUsed: 2, frequency: 2 },
      ],
    });
    await expect(getTechnicianVolumeBreakdown()).resolves.toEqual([
      { technicianId: "tech-1", activeCount: 1, completedCount: 1 },
      { technicianId: "tech-2", activeCount: 0, completedCount: 1 },
    ]);
  });
});
