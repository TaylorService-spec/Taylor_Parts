// FIREBASE EXIT F4 (DECISIONS #247) -- the governed Employee / Principal name read is shared per SIGNED-IN PRINCIPAL, and bounded.
// Run: npx vitest run test/governedEmployeeDirectoryIsolation.test.jsx
//
// The hook shares one answer across the sections of a page (60 s). That answer must never cross from one signed-in person to the
// next on the same browser -- cached or in flight -- and a read that never answers must settle, not leave the page on "Loading".
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ uid: "u1" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => (h.uid === null ? undefined : { user: { uid: h.uid } }) }));
const callWorkspaceApi = vi.hoisted(() => vi.fn());
vi.mock("../src/services/workspaceApiClient.js", () => ({ callWorkspaceApi }));
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: { call: vi.fn() } }));

import { useGovernedEmployeeDirectory, resetGovernedEmployeeDirectory } from "../src/hooks/useGovernedEmployeeDirectory.js";

const names = (pairs) => ({ ok: true, result: { names: pairs.map(([key, displayName]) => ({ key, displayName })) } });

beforeEach(() => { h.uid = "u1"; resetGovernedEmployeeDirectory(); });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("useGovernedEmployeeDirectory -- one answer per signed-in principal", () => {
  it("a second principal on the same browser asks for itself and never receives the first one's names", async () => {
    callWorkspaceApi.mockResolvedValueOnce(names([["emp-1", "Alex (seen by u1)"]]));
    const { result, rerender } = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await waitFor(() => expect(result.current.byEmployeeId.get("emp-1")?.displayName).toBe("Alex (seen by u1)"));
    expect(callWorkspaceApi).toHaveBeenCalledTimes(1);

    let release;
    callWorkspaceApi.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    h.uid = "u2";
    rerender();
    // Not even while u2's own read is in flight does u2 see u1's names.
    expect(result.current.byEmployeeId.size).toBe(0);
    expect(result.current.loading).toBe(true);
    await act(async () => { release(names([])); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.byEmployeeId.size).toBe(0);
    expect(callWorkspaceApi).toHaveBeenCalledTimes(2);
  });

  it("the same principal still shares one read across the sections of a page", async () => {
    callWorkspaceApi.mockResolvedValue(names([["emp-1", "Alex"]]));
    const a = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    const b = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await waitFor(() => expect(a.result.current.byEmployeeId.size).toBe(1));
    await waitFor(() => expect(b.result.current.byEmployeeId.size).toBe(1));
    expect(callWorkspaceApi).toHaveBeenCalledTimes(1);
  });

  it("with no auth provider there is no principal: nothing is shared with a signed-in one", async () => {
    callWorkspaceApi.mockResolvedValueOnce(names([["emp-1", "Alex (anonymous read)"]]));
    h.uid = null;
    const first = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    callWorkspaceApi.mockResolvedValueOnce(names([]));
    h.uid = "u1";
    const second = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.byEmployeeId.size).toBe(0);
    expect(callWorkspaceApi).toHaveBeenCalledTimes(2);
  });
});

describe("useGovernedEmployeeDirectory -- bounded", () => {
  it("a read that never answers settles as an error instead of leaving the page on Loading", async () => {
    vi.useFakeTimers();
    callWorkspaceApi.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toMatchObject({ ok: false, code: "UNREACHABLE" });
    expect(result.current.byEmployeeId.size).toBe(0);
  });

  it("a timed-out read is not cached: the next mount asks again", async () => {
    vi.useFakeTimers();
    callWorkspaceApi.mockReturnValueOnce(new Promise(() => {}));
    const first = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });
    expect(first.result.current.error).toBeTruthy();
    first.unmount();
    callWorkspaceApi.mockResolvedValueOnce(names([["emp-1", "Alex"]]));
    const second = renderHook(() => useGovernedEmployeeDirectory({ employeeIds: ["emp-1"] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(second.result.current.byEmployeeId.get("emp-1")?.displayName).toBe("Alex");
    expect(callWorkspaceApi).toHaveBeenCalledTimes(2);
  });
});
