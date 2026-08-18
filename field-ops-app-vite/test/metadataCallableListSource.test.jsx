// Callable translation of a query descriptor — the CALLABLE-readVia counterpart of
// metadataFirestoreListSource.test.jsx.
//
// What is tested here: the callable is invoked with the parent scope buildQueryDescriptor
// already decided (never a second query shape invented in this file), the response
// envelope is unwrapped into the same shape fetchPage (Firestore) returns, a permission
// rejection surfaces as a normalized "permission-denied" code rather than the
// "functions/permission-denied" the SDK actually throws, and the callable's own
// limit+1-truncation convention is interpreted through the SAME `interpretPage` rule the
// Firestore source uses.

import { describe, it, expect, vi, beforeEach } from "vitest";

const httpsCallableMock = vi.fn();
vi.mock("firebase/functions", () => ({
  httpsCallable: (...args) => httpsCallableMock(...args),
}));
vi.mock("../src/firebase/firebase.js", () => ({ functions: { __fakeFunctions: true } }));

const { fetchPage } = await import("../src/metadata/callableListSource.js");

beforeEach(() => {
  httpsCallableMock.mockReset();
});

const descriptor = (over = {}) => ({
  entityId: "opportunity",
  readVia: "CALLABLE",
  readCallable: "listOpportunitiesForAccount",
  collection: "opportunities",
  filters: [{ fieldId: "accountId", operator: "EQUALS", value: "acct-1" }],
  sort: [{ fieldId: "__name__", direction: "ASC" }],
  limit: 26,
  pageSize: 25,
  ...over,
});

/** Registers what `httpsCallable(functions, name)` returns for the next call. */
function stubCallable(impl) {
  const callable = vi.fn(impl);
  httpsCallableMock.mockReturnValue(callable);
  return callable;
}

describe("callableListSource.fetchPage", () => {
  it("invokes the descriptor's own readCallable with the parent scope value and the pageSize as limit", async () => {
    const callable = stubCallable(async () => ({
      data: { status: "ready", opportunities: [{ id: "opp-1" }], skipped: 0, truncated: false },
    }));
    await fetchPage(descriptor());
    expect(httpsCallableMock).toHaveBeenCalledWith({ __fakeFunctions: true }, "listOpportunitiesForAccount");
    expect(callable).toHaveBeenCalledWith({ accountId: "acct-1", limit: 25 });
  });

  it("unwraps the callable's own response-list key into rows, matching fetchPage's shape", async () => {
    stubCallable(async () => ({
      data: { status: "ready", opportunities: [{ id: "opp-1", name: "Big Deal" }], skipped: 0, truncated: false },
    }));
    const page = await fetchPage(descriptor());
    expect(page).toEqual({
      rows: [{ id: "opp-1", name: "Big Deal" }],
      hasMore: false,
      nextCursor: null,
      nextCursorDoc: null,
    });
  });

  it("unwraps a different entity's own response-list key (salesOrders, not opportunities)", async () => {
    stubCallable(async () => ({
      data: { status: "ready", salesOrders: [{ id: "so-1" }], skipped: 0, truncated: false },
    }));
    const page = await fetchPage(
      descriptor({ entityId: "salesOrder", readCallable: "listSalesOrdersForAccount", collection: "sales_orders" })
    );
    expect(page.rows).toEqual([{ id: "so-1" }]);
  });

  it("interprets a truncated callable result as hasMore, through the SAME interpretPage rule as Firestore", async () => {
    stubCallable(async () => ({
      data: {
        status: "ready",
        opportunities: [{ id: "opp-1" }, { id: "opp-2" }],
        skipped: 0,
        truncated: true,
      },
    }));
    const page = await fetchPage(descriptor({ pageSize: 2, limit: 3 }));
    // The two real rows are returned in full — the truncation sentinel is sliced off by
    // interpretPage, never leaking into a rendered row.
    expect(page.rows).toEqual([{ id: "opp-1" }, { id: "opp-2" }]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual({ id: "opp-2" });
  });

  it("an untruncated result never reports hasMore, even at exactly pageSize", async () => {
    stubCallable(async () => ({
      data: { status: "ready", opportunities: [{ id: "opp-1" }, { id: "opp-2" }], skipped: 0, truncated: false },
    }));
    const page = await fetchPage(descriptor({ pageSize: 2, limit: 3 }));
    expect(page.hasMore).toBe(false);
  });

  it("a permission-denied callable rejection surfaces normalized as DENIED, not empty", async () => {
    const err = new Error("nope");
    err.code = "functions/permission-denied";
    stubCallable(async () => {
      throw err;
    });
    await expect(fetchPage(descriptor())).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("a non-permission callable failure normalizes to a code that is NOT permission-denied", async () => {
    const err = new Error("boom");
    err.code = "functions/internal";
    stubCallable(async () => {
      throw err;
    });
    await expect(fetchPage(descriptor())).rejects.toMatchObject({ code: "internal" });
  });

  it("a readCallable this module has no response mapping for throws rather than guessing a shape", async () => {
    await expect(fetchPage(descriptor({ readCallable: "someUnregisteredCallable" }))).rejects.toThrow(
      /no known response mapping/
    );
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("no readCallable on the descriptor throws rather than attempting a read", async () => {
    await expect(fetchPage(descriptor({ readCallable: null }))).rejects.toThrow(/no known response mapping/);
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("a descriptor with no parent-scope filter throws rather than calling the callable unscoped", async () => {
    await expect(fetchPage(descriptor({ filters: [] }))).rejects.toThrow(/no parent-scope filter/);
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });
});

// A truncated RELATED page must DISCLOSE its truncation. The default binding computed
// hasMore correctly and then dropped it, so a capped section presented its cap as the
// whole set -- the exact failure the presentation model exists to prevent, arriving
// through the one path that had already worked out the right answer.
it("a truncated related page reports hasMore rather than discarding it", async () => {
  const { interpretPage } = await import("../src/metadata/listRuntime.js");
  const page = interpretPage({ pageSize: 2, limit: 3 }, [{ id: "a" }, { id: "b" }, { id: "probe" }]);
  expect(page.hasMore).toBe(true);
  expect(page.rows).toHaveLength(2);
});
