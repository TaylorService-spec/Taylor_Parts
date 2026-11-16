// PARTS-403d: a Reorder read is LOADING on the very first render in which it is enabled (vitest + jsdom).
// Run: npx vitest run test/reorderReadFirstEnabledRender.test.jsx
//
// The gate for a read flips from "not askable" to "askable" when the session answer arrives. useGovernedReorderRead used to hold the disabled
// state ({ data: [], loading: false, error: null }) for one render after that flip -- an EMPTY, FINISHED answer for a read that had not started -- and a
// page rendered "no reorder request" (and offered Request Reorder) for that frame. The hook now reports loading on the first enabled render.
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useMyAssignedReorderRequests, useReorderRequestForPart, useReorderRequestsByStatuses } from "../src/hooks/useReorderRequests.js";

const clientAnswering = (result) => ({ call: async () => ({ ok: true, result }) });
const failingClient = { call: async () => ({ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_MISSING" }) };

describe("a governed Reorder read, on the first render in which it is enabled", () => {
  it("is loading (not an empty answer), then answers", async () => {
    const renders = [];
    const { rerender } = renderHook(({ enabled }) => {
      const r = useReorderRequestsByStatuses(["ORDERED"], enabled, { client: clientAnswering([{ id: "RR-1" }]) });
      renders.push({ enabled, loading: r.loading, rows: r.data.length, error: r.error });
      return r;
    }, { initialProps: { enabled: false } });

    await waitFor(() => expect(renders.at(-1)).toMatchObject({ enabled: false, loading: false, rows: 0 }));
    const flipAt = renders.length;
    rerender({ enabled: true });
    expect(renders[flipAt]).toMatchObject({ enabled: true, loading: true, rows: 0, error: null });
    await waitFor(() => expect(renders.at(-1)).toMatchObject({ enabled: true, loading: false, rows: 1 }));
  });

  it("a disabled read is settled and empty (nothing was asked, nothing is claimed), and stays so", async () => {
    const { result } = renderHook(() => useReorderRequestsByStatuses(["ORDERED"], false, { client: failingClient }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toMatchObject({ loading: false, error: null });
    expect(result.current.data).toEqual([]);
  });

  it("a read whose input changes is loading on the first render of the new input", async () => {
    const renders = [];
    const { rerender } = renderHook(({ partId }) => {
      const r = useReorderRequestForPart(partId, undefined, { client: clientAnswering([{ id: "RR-1", partId }]) }, true);
      renders.push({ partId, loading: r.loading });
      return r;
    }, { initialProps: { partId: "P-1" } });
    await waitFor(() => expect(renders.at(-1)).toMatchObject({ partId: "P-1", loading: false }));
    const flipAt = renders.length;
    rerender({ partId: "P-2" });
    expect(renders[flipAt]).toMatchObject({ partId: "P-2", loading: true });
    await waitFor(() => expect(renders.at(-1)).toMatchObject({ partId: "P-2", loading: false }));
  });

  it("a refused read keeps the server's reason and is not loading", async () => {
    const { result } = renderHook(() => useReorderRequestsByStatuses(["ORDERED"], true, { client: failingClient }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("CAPABILITY_MISSING");
  });

  it("own-assigned reads are unchanged: disabled is settled", async () => {
    const { result } = renderHook(() => useMyAssignedReorderRequests(undefined, false, { client: failingClient }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(result.current).toMatchObject({ loading: false, error: null });
  });
});
