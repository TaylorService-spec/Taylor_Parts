// F7c review: the in-flight sharing in hooks/useAccountAr.js is keyed by principal AND account.
// Principal A starts a read, the tab switches to principal B before it settles: B must get its OWN read and its OWN answer,
// never A's. Same principal + same account still shares one request (#1095).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const auth = vi.hoisted(() => ({ uid: "uid-A" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: auth.uid } }) }));
const fetchAccountInvoiceAr = vi.hoisted(() => vi.fn());
vi.mock("../src/services/financeReadCallableClient.js", () => ({ fetchAccountInvoiceAr }));

import { useAccountAr, makeSharedFetch, __resetAccountArInFlightForTest } from "../src/hooks/useAccountAr.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  auth.uid = "uid-A";
  fetchAccountInvoiceAr.mockReset();
  __resetAccountArInFlightForTest();
});

describe("useAccountAr -- principal isolation of the shared in-flight read", () => {
  it("B never receives A's in-flight answer", async () => {
    const a = deferred();
    const b = deferred();
    fetchAccountInvoiceAr.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    const { result, rerender } = renderHook(() => useAccountAr("acct-1"));
    expect(fetchAccountInvoiceAr).toHaveBeenCalledTimes(1);

    auth.uid = "uid-B"; // the principal switches on the same tab before A's read settles
    rerender();
    expect(fetchAccountInvoiceAr, "B is NOT handed A's promise").toHaveBeenCalledTimes(2);

    await act(async () => { a.resolve({ result: { status: "ready", marker: "A" } }); });
    expect(result.current.loading, "A's late answer is not shown to B").toBe(true);
    expect(result.current.result).toBeNull();

    await act(async () => { b.resolve({ result: { status: "ready", marker: "B" } }); });
    await waitFor(() => expect(result.current.result?.marker).toBe("B"));
  });

  it("the same principal and account still share ONE request", async () => {
    const d = deferred();
    fetchAccountInvoiceAr.mockReturnValue(d.promise);
    renderHook(() => useAccountAr("acct-1"));
    renderHook(() => useAccountAr("acct-1"));
    expect(fetchAccountInvoiceAr).toHaveBeenCalledTimes(1);
    await act(async () => { d.resolve({ result: { status: "ready" } }); });
  });

  it("the factory keys by principal: same uid shares, another uid does not, a settled read is not cached", async () => {
    let calls = 0;
    const map = new Map();
    const shared = makeSharedFetch(async (id) => { calls += 1; return { id }; }, map);
    const [x, y] = [shared("A", "acct"), shared("A", "acct")];
    expect(x).toBe(y);
    shared("B", "acct");
    expect(calls).toBe(2);
    await Promise.all([x, y]);
    await Promise.resolve();
    expect(map.size).toBeLessThanOrEqual(1);
  });
});
