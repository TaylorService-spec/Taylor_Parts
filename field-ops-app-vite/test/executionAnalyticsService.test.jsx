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
      workOrderVolumeByStatus: { CLOSED: 2, DISPATCHED: 1 },
    });
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
