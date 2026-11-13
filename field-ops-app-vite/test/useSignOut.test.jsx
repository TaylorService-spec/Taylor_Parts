// useSignOut: shows it is working while the shared logout waits for the server, and a second click signs out only once.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ logout: auth.logout }) }));
import { useSignOut } from "../src/auth/useSignOut.js";

afterEach(() => { cleanup(); auth.logout.mockReset(); });

describe("useSignOut", () => {
  it("is busy until logout settles and ignores a second click", async () => {
    let finish;
    auth.logout.mockImplementation(() => new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useSignOut());
    let first;
    act(() => { first = result.current.signOut(); });
    expect(result.current.signingOut).toBe(true);
    await act(async () => { await result.current.signOut(); });
    expect(auth.logout).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); await first; });
    expect(result.current.signingOut).toBe(false);
  });

  it("clears the busy state when logout rejects, without throwing", async () => {
    auth.logout.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSignOut());
    await act(async () => { await result.current.signOut(); });
    expect(result.current.signingOut).toBe(false);
  });
});
