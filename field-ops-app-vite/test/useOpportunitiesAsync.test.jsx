import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOpportunities } from "../src/hooks/useOpportunities.js";

describe("useOpportunities — async source support", () => {
  it("stays synchronous for a plain (non-Promise) source, matching the synthetic fixture contract", () => {
    const source = () => ({ status: "ready", opportunities: [{ id: "A" }], accountNameById: {}, error: null });
    const { result } = renderHook(() => useOpportunities(source));
    // No await needed -- must be correct on the very first render.
    expect(result.current.loading).toBe(false);
    expect(result.current.opportunities).toEqual([{ id: "A" }]);
  });

  it("shows an honest loading state, then resolves real data, for an async (governed) source", async () => {
    let resolveFn;
    const pending = new Promise((resolve) => { resolveFn = resolve; });
    const source = () => pending;
    const { result } = renderHook(() => useOpportunities(source));

    expect(result.current.loading).toBe(true);
    expect(result.current.opportunities).toEqual([]);

    resolveFn({ status: "ready", opportunities: [{ id: "GOV-1" }], accountNameById: {}, error: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.opportunities).toEqual([{ id: "GOV-1" }]);
    expect(result.current.status).toBe("ready");
  });

  it("an async source that rejects resolves to an honest unavailable state, never a stuck loading spinner", async () => {
    const source = () => Promise.reject(new Error("network down"));
    const { result } = renderHook(() => useOpportunities(source));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe("unavailable");
    expect(result.current.opportunities).toEqual([]);
  });
});

describe("useOpportunities — refetch (Wave 7: authoritative refresh after a governed write)", () => {
  it("refetch() re-invokes the source and replaces the snapshot with the NEW authoritative result (sync source)", () => {
    let call = 0;
    const source = () => {
      call += 1;
      return call === 1
        ? { status: "ready", opportunities: [{ id: "A" }], accountNameById: {}, error: null }
        : { status: "ready", opportunities: [{ id: "A" }, { id: "NEW-1" }], accountNameById: {}, error: null };
    };
    const { result } = renderHook(() => useOpportunities(source));
    expect(result.current.opportunities).toEqual([{ id: "A" }]);

    act(() => result.current.refetch());
    expect(call).toBe(2);
    expect(result.current.opportunities).toEqual([{ id: "A" }, { id: "NEW-1" }]);
  });

  it("refetch() against an async source shows an honest loading state, then the freshly-resolved data", async () => {
    let resolveFns = [];
    const source = () => new Promise((resolve) => resolveFns.push(resolve));
    const { result } = renderHook(() => useOpportunities(source));

    resolveFns[0]({ status: "ready", opportunities: [{ id: "A" }], accountNameById: {}, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.opportunities).toEqual([{ id: "A" }]);

    act(() => { result.current.refetch(); });
    expect(result.current.loading).toBe(true);

    resolveFns[1]({ status: "ready", opportunities: [{ id: "A" }, { id: "NEW-1" }], accountNameById: {}, error: null });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.opportunities).toEqual([{ id: "A" }, { id: "NEW-1" }]);
  });

  it("refetch() never fabricates a row -- a source that legitimately returns the SAME data shows the same data, not an invented addition", () => {
    const source = () => ({ status: "ready", opportunities: [{ id: "A" }], accountNameById: {}, error: null });
    const { result } = renderHook(() => useOpportunities(source));
    act(() => result.current.refetch());
    expect(result.current.opportunities).toEqual([{ id: "A" }]);
  });
});
