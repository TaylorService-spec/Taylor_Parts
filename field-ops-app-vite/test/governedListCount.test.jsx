// The list header count, on the governed path — and the one thing it must never do.
//
// A count is orientation: "31 Customers". Its failure mode matters more than its success one,
// because a count that renders 0 when the read failed states, in the calmest possible way, that the
// business has no customers. NULL means "no count available" and renders nothing at all; that
// distinction is the whole reason this suite exists.
//
// The governed path was added because migrating 15 entities to CALLABLE silently removed the count
// from Customers, Equipment and Parts — useListViewChrome gated its aggregate on CLIENT_DIRECT.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const callableCalls = [];
let callableImpl = async () => ({ data: { count: 31, atLeast: false } });

vi.mock("../src/firebase/firebase", () => ({ db: {}, auth: { currentUser: { uid: "u1" } }, functions: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: (_f, name) => async (payload) => {
    callableCalls.push([name, payload]);
    return callableImpl(payload);
  },
}));

// The CLIENT_DIRECT aggregate must never run on this path. If it does, these throw rather than
// quietly returning a number from the wrong source.
vi.mock("firebase/firestore", () => ({
  collection: () => {
    throw new Error("a governed source must not touch Firestore directly");
  },
  query: () => {
    throw new Error("a governed source must not touch Firestore directly");
  },
  where: () => {
    throw new Error("a governed source must not touch Firestore directly");
  },
  limit: () => {
    throw new Error("a governed source must not touch Firestore directly");
  },
  getCountFromServer: () => {
    throw new Error("a governed source must not touch Firestore directly");
  },
}));

const { useListViewChrome } = await import("../src/hooks/useListViewChrome.js");
const { accountEntity, accountIndexList } = await import("../src/metadata/definitions/account.js");

const CRITERIA = { filters: [], sort: [] };
const apply = () => {};

beforeEach(() => {
  callableCalls.length = 0;
  callableImpl = async () => ({ data: { count: 31, atLeast: false } });
});

describe("the governed list count", () => {
  it("counts through the trusted callable, naming a source id and nothing else", async () => {
    const { result } = renderHook(() => useListViewChrome(accountIndexList, accountEntity, CRITERIA, apply));
    await waitFor(() => expect(result.current.total).toBe(31));

    expect(callableCalls.length).toBe(1);
    const [name, payload] = callableCalls[0];
    expect(name).toBe("countGovernedList");
    expect(payload.sourceId).toBe("metadataAccounts");
    // No collection, no field, no operator, no orderBy, no cursor, no page size. The server owns
    // every one of them.
    expect(Object.keys(payload).sort()).toEqual(["filters", "sourceId"]);
  });

  it("sends registered filter NAMES with values, never a field or an operator", async () => {
    const criteria = { filters: [{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }], sort: [] };
    const { result } = renderHook(() => useListViewChrome(accountIndexList, accountEntity, criteria, apply));
    await waitFor(() => expect(result.current.total).toBe(31));

    const [, payload] = callableCalls[0];
    expect(payload.filters).toEqual({ status: "ACTIVE" });
    // "==" is the registry's answer to the name "status". It must not appear on the wire.
    expect(JSON.stringify(payload)).not.toContain("==");
    expect(JSON.stringify(payload)).not.toContain("EQUALS");
  });

  it("A FAILED READ IS NULL, NEVER ZERO", async () => {
    // The property this suite is really for. A denied, offline or erroring count renders no count.
    // Zero would be a claim about the business made on the strength of a failure.
    callableImpl = async () => {
      const err = new Error("denied");
      err.code = "functions/permission-denied";
      throw err;
    };
    const { result } = renderHook(() => useListViewChrome(accountIndexList, accountEntity, CRITERIA, apply));
    await waitFor(() => expect(callableCalls.length).toBe(1));
    await waitFor(() => expect(result.current.total).toBeNull());
    expect(result.current.total).not.toBe(0);
  });

  it("a malformed response is also null, not zero and not NaN", async () => {
    // A response missing `count` — a version skew, a partial deploy — must not be read as "none".
    callableImpl = async () => ({ data: { atLeast: false } });
    const { result } = renderHook(() => useListViewChrome(accountIndexList, accountEntity, CRITERIA, apply));
    await waitFor(() => expect(callableCalls.length).toBe(1));
    await waitFor(() => expect(result.current.total).toBeNull());
  });

  it("a genuine zero is still rendered as zero", async () => {
    // The mirror of the rule above: an honest empty result must stay distinguishable from a failure
    // in BOTH directions, or the fix for one becomes a defect in the other.
    callableImpl = async () => ({ data: { count: 0, atLeast: false } });
    const { result } = renderHook(() => useListViewChrome(accountIndexList, accountEntity, CRITERIA, apply));
    await waitFor(() => expect(result.current.total).toBe(0));
  });
});
