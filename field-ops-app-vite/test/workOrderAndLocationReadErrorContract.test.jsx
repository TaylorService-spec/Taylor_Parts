// H14 -- hooks/useWorkOrder.js and hooks/useLocation.js used to pass NO error
// callback to onSnapshot at all, so a DENIED or failed read never resolved --
// `loading` stayed true forever, with no error surfaced and nothing for a
// consumer to check. WorkOrderDetailPage.jsx's "Loading work order…" spun
// indefinitely with no recovery.
//
// Both hooks now mirror useAccount.js's single-document doc()/onSnapshot
// contract: { workOrder|location, loading, error, retry }. A failed read
// clears any stale data, sets a safe categorized `error`
// (domain/loadErrorMessage.js -- never a raw code/path/id), and stops
// loading; retry() forces a clean re-subscription.
//
// vitest + @testing-library/react (jsdom). Firebase is fully mocked; the
// mocked onSnapshot captures the success/error callbacks so the test can
// drive each path directly, exactly as test/inventoryRoleReadErrorContract.test.jsx
// already does for the collection-read hooks.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

let capturedNext;
let capturedError;
let unsubscribeCount;
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...pathParts) => ({ path: pathParts.join("/") }),
  onSnapshot: (_ref, next, error) => {
    capturedNext = next;
    capturedError = error;
    return () => {
      unsubscribeCount += 1;
    };
  },
}));

import { useWorkOrder } from "../src/hooks/useWorkOrder";
import { useLocation } from "../src/hooks/useLocation";

beforeEach(() => {
  capturedNext = undefined;
  capturedError = undefined;
  unsubscribeCount = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkOrder -- read-error contract (H14)", () => {
  it("starts loading with no error", () => {
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", () => {
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    expect(capturedError).toBeTypeOf("function");
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("You do not have permission to view these work orders.");
    expect(result.current.workOrder).toBe(null);
  });

  it("a confirmed absence (successful read, no such doc) is distinct from a failed read", () => {
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    act(() => capturedNext({ id: "wo-1", exists: () => false }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.workOrder).toBe(null);
  });

  it("retry() re-subscribes (tears down the stale listener and clears the error)", () => {
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    act(() => capturedError({ code: "unavailable" }));
    expect(result.current.error).toContain("Can't reach the server");
    const unsubBefore = unsubscribeCount;
    act(() => result.current.retry());
    expect(unsubscribeCount).toBe(unsubBefore + 1);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });
});

describe("useLocation -- read-error contract (H14)", () => {
  it("starts loading with no error", () => {
    const { result } = renderHook(() => useLocation("loc-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", () => {
    const { result } = renderHook(() => useLocation("loc-1"));
    expect(capturedError).toBeTypeOf("function");
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("You do not have permission to view these locations.");
    expect(result.current.location).toBe(null);
  });

  it("a confirmed absence (successful read, no such doc) is distinct from a failed read", () => {
    const { result } = renderHook(() => useLocation("loc-1"));
    act(() => capturedNext({ id: "loc-1", exists: () => false }));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.location).toBe(null);
  });
});
