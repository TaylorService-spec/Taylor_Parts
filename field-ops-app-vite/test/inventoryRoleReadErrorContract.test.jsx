// W2 (Issue #100) -- revised read-error contract for the three inventory-role
// hooks. Before W2 these hooks swallowed onSnapshot errors (their error callback
// was `() => setState({ data: [], loading: false })`), so a failed read was
// indistinguishable from a genuinely-empty result. They now mirror
// useReorderRequestsByStatuses: on error they set `error` to the Firestore error
// code (or "unknown"); on success/empty they set `error: null`. These tests pin
// that contract so a future refactor can't silently reintroduce the swallow.
//
// vitest + @testing-library/react (jsdom). Firebase is fully mocked; the mocked
// onSnapshot captures the error callback so the test can drive the error path.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

let capturedNext;
let capturedError;
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: (_q, next, error) => {
    capturedNext = next;
    capturedError = error;
    return () => {}; // unsubscribe
  },
}));

import { useReorderRequestsByStatus, useReorderRequestsAssignedTo } from "../src/hooks/useReorderRequests";
import { useInventoryActionsForPart } from "../src/hooks/useInventoryActions";

beforeEach(() => {
  capturedNext = undefined;
  capturedError = undefined;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useReorderRequestsByStatus -- read-error contract", () => {
  it("initial state exposes error: null", () => {
    const { result } = renderHook(() => useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER"));
    expect(result.current.error).toBe(null);
  });

  it("a failed read sets error to the Firestore error code (not swallowed)", () => {
    const { result } = renderHook(() => useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER"));
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("a successful read clears error back to null", () => {
    const { result } = renderHook(() => useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER"));
    act(() => capturedError({ code: "unavailable" }));
    expect(result.current.error).toBe("unavailable");
    act(() => capturedNext({ docs: [] }));
    expect(result.current.error).toBe(null);
  });
});

describe("useReorderRequestsAssignedTo -- read-error contract", () => {
  it("a failed read sets error; a code-less error falls back to 'unknown'", () => {
    const { result } = renderHook(() => useReorderRequestsAssignedTo("u1", "ASSIGNED_TO_PARTS_ASSOCIATE"));
    expect(result.current.error).toBe(null);
    act(() => capturedError({}));
    expect(result.current.error).toBe("unknown");
    expect(result.current.data).toEqual([]);
  });
});

describe("useInventoryActionsForPart -- read-error contract", () => {
  it("a failed read sets error to the Firestore error code (not swallowed)", () => {
    const { result } = renderHook(() => useInventoryActionsForPart("PART-1"));
    expect(result.current.error).toBe(null);
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.data).toEqual([]);
  });

  it("a successful read clears error and still sorts by createdAt desc", () => {
    const { result } = renderHook(() => useInventoryActionsForPart("PART-1"));
    act(() => capturedError({ code: "unavailable" }));
    expect(result.current.error).toBe("unavailable");
    act(() =>
      capturedNext({
        docs: [
          { id: "a", data: () => ({ createdAt: 1 }) },
          { id: "b", data: () => ({ createdAt: 2 }) },
        ],
      })
    );
    expect(result.current.error).toBe(null);
    expect(result.current.data.map((d) => d.id)).toEqual(["b", "a"]);
  });
});
