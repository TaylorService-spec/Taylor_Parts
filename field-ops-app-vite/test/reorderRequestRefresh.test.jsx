// PL3 (purchasing-loop proof, 2026-10-19): Approve and Start Purchasing succeeded on the server, yet
// Part Detail said "Something went wrong... Nothing was changed." The action cards call refresh()
// after a successful command; the EOS read returned no refresh, so that call threw after the write
// and the catch reported a failure, and the page never re-read. These tests pin a real refresh.
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

vi.mock("../src/firebase/firebase.js", () => ({ db: {}, auth: {}, functions: {} }));

import { useReorderRequestForPart, useReorderRequestById } from "../src/hooks/useReorderRequests.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function clientReturning(...statuses) {
  const call = vi.fn();
  for (const status of statuses) {
    call.mockResolvedValueOnce({ ok: true, result: { id: "rr_1", partId: "PRT-1002", status } });
  }
  return { client: { call }, call };
}

describe("useReorderRequestForPart refresh", () => {
  it("re-reads by request id, quietly, and shows the new status", async () => {
    const { client, call } = clientReturning("PENDING_REVIEW", "APPROVED");
    const deps = { client };
    const { result } = renderHook(() => useReorderRequestForPart("PRT-1002", "rr_1", deps));
    await waitFor(() => expect(result.current.data?.status).toBe("PENDING_REVIEW"));
    expect(typeof result.current.refresh).toBe("function");

    act(() => { result.current.refresh(); });
    // Quiet: the current request stays on screen while the re-read is in flight.
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.data?.status).toBe("APPROVED"));
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenLastCalledWith("readReorderRequest", { reorderRequestId: "rr_1" });
  });

  it("re-reads by part when no request id is given", async () => {
    const { client, call } = clientReturning("READY_FOR_PARTS_MANAGER", "PURCHASING_IN_PROGRESS");
    const deps = { client };
    const { result } = renderHook(() => useReorderRequestForPart("PRT-1002", undefined, deps));
    await waitFor(() => expect(result.current.data?.status).toBe("READY_FOR_PARTS_MANAGER"));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.data?.status).toBe("PURCHASING_IN_PROGRESS"));
    expect(call).toHaveBeenLastCalledWith("readReorderQueue", { partId: "PRT-1002" });
  });

  it("still offers refresh when the read failed, so a retry is possible", async () => {
    const call = vi.fn().mockResolvedValue({ ok: false, code: "UNAVAILABLE" });
    const deps = { client: { call } };
    const { result } = renderHook(() => useReorderRequestForPart("PRT-1002", "rr_1", deps));
    await waitFor(() => expect(result.current.error).toBe("UNAVAILABLE"));
    expect(typeof result.current.refresh).toBe("function");
  });
});

describe("useReorderRequestById refresh", () => {
  it("re-reads the request", async () => {
    const { client } = clientReturning("APPROVED", "ORDERED");
    const deps = { client };
    const { result } = renderHook(() => useReorderRequestById("rr_1", deps));
    await waitFor(() => expect(result.current.data?.status).toBe("APPROVED"));
    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.data?.status).toBe("ORDERED"));
  });
});
