import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
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
