// X-TRANSFER-ORDERS-UNBOUNDED-READ remediation -- direct unit tests for
// operationsQueries.fetchTransferOrderDocsPage, the bounded sibling of the complete-population
// fetchTransferOrderDocs.
//
// ════════════════════ WHAT MOVED, AND WHAT THESE TESTS NOW GUARD ════════════════════
//
// These used to mock firebase/firestore and assert the CONSTRAINTS sent to it -- limit(cap + 1),
// orderBy(documentId()). The read has since moved behind the governed source registry, and the
// client no longer chooses any of that: it names a source id and a page size, and the server owns
// the collection, the ordering and the one-more-than-the-page truncation probe.
//
// So the assertions moved up a level, to the properties that still belong to this file:
//
//   * it asks for a REGISTERED SOURCE, never a collection, an ordering or a cursor
//   * the page size it asks for is the caller's cap
//   * `truncated` is the server's OBSERVED hasMore, not a length comparison
//   * the authoritative storage id stays OUT of `data`
//
// Left as firestore-constraint assertions they would have kept passing against a mock of a module
// this file no longer imports, which is the worse kind of green.
import { describe, it, expect, vi, beforeEach } from "vitest";

const governed = { readGovernedList: vi.fn(), readAllGoverned: vi.fn() };

vi.mock("../src/access/governedCollectionClient", () => ({
  READ_RESULT: { OK: "OK", DENIED: "DENIED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" },
  readGovernedList: (...args) => governed.readGovernedList(...args),
  governedCollectionClient: {
    readGovernedList: (...args) => governed.readGovernedList(...args),
    readAllGoverned: (...args) => governed.readAllGoverned(...args),
  },
}));

import { fetchTransferOrderDocsPage, LIST_READ_CAP } from "../src/services/operationsQueries.ts";

// The governed seam returns records with the STORAGE ID LAST, so `id` is always the document id.
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({ partId: "PART-1", status: "REQUESTED", id: `to-${i}` }));

const okPage = (items, hasMore = false) => ({ ok: true, result: "OK", items, hasMore, nextCursor: null });

beforeEach(() => vi.clearAllMocks());

describe("fetchTransferOrderDocsPage", () => {
  it("names a REGISTERED SOURCE and a page size -- never a collection, an ordering or a cursor", async () => {
    governed.readGovernedList.mockResolvedValueOnce(okPage(rows(3)));
    await fetchTransferOrderDocsPage({ cap: 5 });
    const [payload] = governed.readGovernedList.mock.calls.at(-1);
    expect(payload).toEqual({ sourceId: "metadataTransferOrders", pageSize: 5 });
    // The levers a client must never hold. Asserted by ABSENCE rather than by trusting the shape
    // above, because a future field added alongside would slip past an equality check that had
    // been loosened.
    for (const lever of ["collection", "orderBy", "sortKey", "where", "cursor", "filters"]) {
      expect(payload, `a client may not send ${lever}`).not.toHaveProperty(lever);
    }
  });

  it("reports truncated=false and returns every row when the collection is under the cap", async () => {
    governed.readGovernedList.mockResolvedValueOnce(okPage(rows(3), false));
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(3);
    expect(truncated).toBe(false);
  });

  it("reports truncated=false when the collection is exactly at the cap", async () => {
    // A FULL PAGE IS NOT A TRUNCATED ONE, and only the server can tell them apart -- it reads one
    // row beyond the page to find out. A client comparing length to cap would report truncation
    // here and be wrong.
    governed.readGovernedList.mockResolvedValueOnce(okPage(rows(5), false));
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(5);
    expect(truncated).toBe(false);
  });

  it("reports truncated=true when the server observed more rows beyond the page", async () => {
    governed.readGovernedList.mockResolvedValueOnce(okPage(rows(5), true));
    const { items, truncated } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(items.map((d) => d.docId)).toEqual(["to-0", "to-1", "to-2", "to-3", "to-4"]);
  });

  it("defaults to the shared LIST_READ_CAP when no cap is given", async () => {
    governed.readGovernedList.mockResolvedValueOnce(okPage(rows(LIST_READ_CAP), true));
    const { items, truncated } = await fetchTransferOrderDocsPage();
    expect(governed.readGovernedList.mock.calls.at(-1)[0].pageSize).toBe(LIST_READ_CAP);
    expect(items).toHaveLength(LIST_READ_CAP);
    expect(truncated).toBe(true);
  });

  it("keeps the authoritative storage id OUT of data -- never spread back over it", async () => {
    // THE CONTRACT IS UNCHANGED: docId is the authoritative storage id and `data` is the stored
    // document without it, so nothing downstream can merge a stored id over the real one.
    //
    // WHAT CHANGED, recorded rather than glossed: a stored `id` field can no longer REACH this
    // function to be compared. The governed seam builds every record as { ...data, id } with the
    // storage id last, so a conflicting stored id is already overwritten server-side -- enforcement
    // moved earlier rather than disappearing (functions/test/documentIdPrecedence.test.mjs is the
    // repository-wide proof). The transfer-order adapter's fail-closed conflict check therefore has
    // nothing left to catch here; it stays as the last line of defence for any other source.
    governed.readGovernedList.mockResolvedValueOnce(okPage([{ partId: "PART-1", id: "REAL" }]));
    const { items } = await fetchTransferOrderDocsPage({ cap: 5 });
    expect(items[0].docId).toBe("REAL");
    expect(items[0].data).toEqual({ partId: "PART-1" });
    expect(items[0].data).not.toHaveProperty("id");
  });

  it("a DENIED read throws rather than reporting an empty page", async () => {
    // An empty list would say "there are no transfer orders", which is a claim about the business
    // manufactured out of a permission decision.
    governed.readGovernedList.mockResolvedValueOnce({ ok: false, result: "DENIED", items: [], hasMore: false });
    await expect(fetchTransferOrderDocsPage({ cap: 5 })).rejects.toThrow(/do not have access/i);
  });
});
