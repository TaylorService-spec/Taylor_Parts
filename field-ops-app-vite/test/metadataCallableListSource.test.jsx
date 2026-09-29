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
// PASS 11 RETAIL SALES: the Opportunity / Sales Order list names are served by the governed PostgreSQL Commercial
// transport, not a Firebase callable. The EOS client is the seam these tests stub.
const commercialCallMock = vi.fn();
vi.mock("../src/services/commercialApiClient.js", () => ({ commercialApiClient: { call: (...args) => commercialCallMock(...args) } }));

const { fetchPage, isKnownReadCallable, readCallableSourceInfo } = await import("../src/metadata/callableListSource.js");

beforeEach(() => {
  httpsCallableMock.mockReset();
  commercialCallMock.mockReset();
});

/** One EOS list page answer for the next call(s). */
const eosPage = (items, { truncated = false, nextCursor = null } = {}) => ({ ok: true, result: { items, truncated, nextCursor } });
const eosFailure = (code) => ({ ok: false, code, message: code, reason: null, status: null });

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

describe("callableListSource.fetchPage -- the Commercial lists go to the EOS API, never a Firebase callable", () => {
  it("calls the EOS list with the parent scope and the pageSize as its cap; no Firebase callable is invoked", async () => {
    commercialCallMock.mockResolvedValue(eosPage([{ id: "opp-1", opportunityNumber: "OPP-1", accountId: "acct-1" }]));
    await fetchPage(descriptor());
    expect(commercialCallMock).toHaveBeenCalledWith("listOpportunities", { input: { limit: 25, accountId: "acct-1" } });
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("projects EOS rows into the rows fetchPage returns, matching fetchPage's shape", async () => {
    commercialCallMock.mockResolvedValue(eosPage([{ id: "opp-1", opportunityNumber: "OPP-1", accountId: "acct-1", editVersion: 2 }]));
    const page = await fetchPage(descriptor());
    expect(page.rows).toEqual([expect.objectContaining({ id: "opp-1", opportunityNumber: "OPP-1", editVersion: 2 })]);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null, nextCursorDoc: null });
  });

  it("a Sales Order list reads listSalesOrders and projects Sales Orders", async () => {
    commercialCallMock.mockResolvedValue(eosPage([{ id: "so-1", salesOrderNumber: "SO-1" }]));
    const page = await fetchPage(descriptor({ entityId: "salesOrder", readCallable: "listSalesOrdersForAccount", collection: "sales_orders" }));
    expect(commercialCallMock.mock.calls[0][0]).toBe("listSalesOrders");
    expect(page.rows).toEqual([expect.objectContaining({ id: "so-1", salesOrderNumber: "SO-1", downstreamTracked: false })]);
  });

  it("a truncated EOS list reports hasMore through the SAME interpretPage rule as Firestore", async () => {
    commercialCallMock.mockResolvedValue(eosPage([{ id: "opp-1" }, { id: "opp-2" }], { truncated: true, nextCursor: "c2" }));
    const page = await fetchPage(descriptor({ pageSize: 2, limit: 3 }));
    expect(page.rows.map((r) => r.id)).toEqual(["opp-1", "opp-2"]);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toMatchObject({ id: "opp-2" });
  });

  it("an untruncated result never reports hasMore, even at exactly pageSize", async () => {
    commercialCallMock.mockResolvedValue(eosPage([{ id: "opp-1" }, { id: "opp-2" }]));
    const page = await fetchPage(descriptor({ pageSize: 2, limit: 3 }));
    expect(page.hasMore).toBe(false);
  });

  it("a FORBIDDEN EOS answer surfaces as permission-denied, not empty", async () => {
    commercialCallMock.mockResolvedValue(eosFailure("FORBIDDEN"));
    await expect(fetchPage(descriptor())).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("any other EOS failure is NOT permission-denied", async () => {
    commercialCallMock.mockResolvedValue(eosFailure("INTERNAL"));
    await expect(fetchPage(descriptor())).rejects.toMatchObject({ code: "internal" });
  });

  it("a readCallable this module has no response mapping for throws rather than guessing a shape", async () => {
    await expect(fetchPage(descriptor({ readCallable: "someUnregisteredCallable" }))).rejects.toThrow(/no known response mapping/);
    expect(httpsCallableMock).not.toHaveBeenCalled();
    expect(commercialCallMock).not.toHaveBeenCalled();
  });

  it("no readCallable on the descriptor throws rather than attempting a read", async () => {
    await expect(fetchPage(descriptor({ readCallable: null }))).rejects.toThrow(/no known response mapping/);
    expect(commercialCallMock).not.toHaveBeenCalled();
  });

  it("a SCOPED list with no parent-scope filter throws rather than reading unscoped", async () => {
    await expect(fetchPage(descriptor({ filters: [] }))).rejects.toThrow(/requires a parent-scope filter/);
    expect(commercialCallMock).not.toHaveBeenCalled();
  });

  describe("the unscoped path (INDEX list, e.g. listOpportunityContext)", () => {
    it("reads the whole authorized scope with no accountId when the descriptor has no filters", async () => {
      commercialCallMock.mockResolvedValue(eosPage([{ id: "opp-1" }]));
      const page = await fetchPage(descriptor({ readCallable: "listOpportunityContext", filters: [] }));
      expect(commercialCallMock).toHaveBeenCalledWith("listOpportunities", { input: { limit: 25 } });
      expect(page.rows.map((r) => r.id)).toEqual(["opp-1"]);
    });

    it("a denied unscoped read is distinct from unavailable and from empty", async () => {
      commercialCallMock.mockResolvedValue(eosFailure("FORBIDDEN"));
      await expect(fetchPage(descriptor({ readCallable: "listOpportunityContext", filters: [] }))).rejects.toMatchObject({ code: "permission-denied" });
    });
  });
});

// X-ENTITY-SINGLE-READCALLABLE: the lookup helpers listViewDefinition.js's
// validateListViewDefinition uses to check a list view's declared readCallable AT
// DEFINITION TIME rather than letting it reach fetchPage unchecked.
describe("isKnownReadCallable / readCallableSourceInfo", () => {
  it("recognizes every real callable this module registers", () => {
    expect(isKnownReadCallable("listOpportunitiesForAccount")).toBe(true);
    expect(isKnownReadCallable("listSalesOrdersForAccount")).toBe(true);
    expect(isKnownReadCallable("listOpportunityContext")).toBe(true);
  });

  it("rejects a name this module has never registered, including inherited-object noise", () => {
    expect(isKnownReadCallable("someTypoedCallableName")).toBe(false);
    // CALLABLE_SOURCES is a plain object; `toString`/`hasOwnProperty` etc. must not read as
    // "known" just because they exist on Object.prototype.
    expect(isKnownReadCallable("toString")).toBe(false);
    expect(isKnownReadCallable(null)).toBe(false);
    expect(isKnownReadCallable(undefined)).toBe(false);
  });

  it("reports the scope flag a validator needs to catch a RELATED/INDEX mismatch", () => {
    expect(readCallableSourceInfo("listOpportunitiesForAccount")).toEqual({ listKey: "opportunities", scoped: true });
    expect(readCallableSourceInfo("listSalesOrdersForAccount")).toEqual({ listKey: "salesOrders", scoped: true });
    expect(readCallableSourceInfo("listOpportunityContext")).toEqual({ listKey: "opportunities", scoped: false });
    expect(readCallableSourceInfo("someTypoedCallableName")).toBeNull();
  });
});

// The other half of "scope must match": an unscoped callable must not be handed a scope it
// cannot use. Silently forwarding it would read the caller's WHOLE authorized scope instead
// of the parent-scoped rows a RELATED section promises -- worse than failing outright.
it("an UNSCOPED callable handed a parent-scope filter throws rather than silently reading the wrong rows", async () => {
  await expect(
    fetchPage(
      descriptor({
        readCallable: "listOpportunityContext",
        filters: [{ fieldId: "accountId", operator: "EQUALS", value: "acct-1" }],
      })
    )
  ).rejects.toThrow(/is unscoped and cannot accept a parent-scope filter/);
  expect(httpsCallableMock).not.toHaveBeenCalled();
  expect(commercialCallMock).not.toHaveBeenCalled();
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
