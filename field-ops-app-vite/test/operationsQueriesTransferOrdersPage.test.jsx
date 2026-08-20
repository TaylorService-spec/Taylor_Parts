// X-TRANSFER-ORDERS-UNBOUNDED-READ remediation -- direct unit tests for
// operationsQueries.fetchTransferOrderDocsPage, the bounded sibling of the unbounded
// fetchTransferOrderDocs (which is deliberately left unchanged; see that function's comment).
// Mirrors the query-descriptor testing style of test/metadataFirestoreListSource.test.mjs:
// firebase/firestore is mocked with plain descriptor objects so the constraints actually sent
// to Firestore (limit(cap+1), orderBy(documentId())) are assertable, not just the JS return
// value.
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db, name) => ({ kind: "collection", name }),
  query: (base, ...constraints) => ({ base, constraints }),
  orderBy: (field) => ({ kind: "orderBy", field }),
  limit: (n) => ({ kind: "limit", n }),
  documentId: () => "__name__",
  where: (...args) => ({ kind: "where", args }),
  getDocs: vi.fn(),
  Timestamp: {},
}));

import { getDocs } from "firebase/firestore";
import { fetchTransferOrderDocsPage, LIST_READ_CAP } from "../src/services/operationsQueries.ts";

function fakeSnap(n) {
  return {
    docs: Array.from({ length: n }, (_, i) => ({
      id: `to-${i}`,
      data: () => ({ partId: "PART-1", status: "REQUESTED" }),
    })),
  };
}

describe("fetchTransferOrderDocsPage", () => {
  it("queries with limit(cap+1) ordered by documentId() -- the cap+1 probe row convention", async () => {
    getDocs.mockResolvedValueOnce(fakeSnap(3));
    await fetchTransferOrderDocsPage({ cap: 5 });
    const [queryArg] = getDocs.mock.calls.at(-1);
    const limitConstraint = queryArg.constraints.find((c) => c.kind === "limit");
    const orderByConstraint = queryArg.constraints.find((c) => c.kind === "orderBy");
    expect(limitConstraint).toEqual({ kind: "limit", n: 6 });
    expect(orderByConstraint).toEqual({ kind: "orderBy", field: "__name__" });
  });

  it("reports truncated=false and returns every row when the collection is under the cap", async () => {
    getDocs.mockResolvedValueOnce(fakeSnap(3));
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it("reports truncated=false when the collection is exactly at the cap", async () => {
    getDocs.mockResolvedValueOnce(fakeSnap(5));
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  it("reports truncated=true and slices back to the cap when the collection exceeds it", async () => {
    getDocs.mockResolvedValueOnce(fakeSnap(6)); // cap(5) + 1 probe row
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(items.map((d) => d.docId)).toEqual(["to-0", "to-1", "to-2", "to-3", "to-4"]);
  });

  it("defaults to the shared LIST_READ_CAP when no cap is given", async () => {
    getDocs.mockResolvedValueOnce(fakeSnap(LIST_READ_CAP + 1));
    const { items, truncated } = await fetchTransferOrderDocsPage();
    expect(items).toHaveLength(LIST_READ_CAP);
    expect(truncated).toBe(true);
  });

  it("keeps the authoritative docId separate from stored data -- never spread/merged", async () => {
    getDocs.mockResolvedValueOnce({
      docs: [{ id: "REAL", data: () => ({ id: "EVIL", partId: "PART-1" }) }],
    });
    const { items } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items[0].docId).toBe("REAL");
    expect(items[0].data.id).toBe("EVIL"); // conflicting stored id preserved, not resolved here
  });
});
