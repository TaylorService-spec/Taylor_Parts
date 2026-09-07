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
// THE TWO REORDER HOOKS READ THROUGH THE GOVERNED SEAM NOW, not Firestore. The contract under
// test is unchanged -- a failed read must surface a code, never an empty list -- so the test
// drives the same contract through the seam that now produces it. useInventoryActionsForPart is
// still a Firestore read and still uses the onSnapshot capture below.
let governedOutcome;
vi.mock("../src/access/governedCollectionClient", () => ({
  governedCollectionClient: {
    readGovernedList: () => Promise.resolve(governedOutcome),
  },
}));
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

/** Render a hook whose read resolves through the seam, and let that promise settle. */
async function renderGoverned(fn) {
  let rendered;
  await act(async () => {
    rendered = renderHook(fn);
  });
  return rendered;
}

beforeEach(() => {
  capturedNext = undefined;
  capturedError = undefined;
  governedOutcome = { ok: true, result: "OK", items: [], nextCursor: null, hasMore: false };
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

  it("a refused read sets error to a code, never an empty list", async () => {
    // The CONTRACT is unchanged -- a failed read must stay distinguishable from a genuinely empty
    // queue. Only the producer moved: the seam reports DENIED, and the hook maps it to the same
    // "permission-denied" string consumers already switch on.
    governedOutcome = { ok: false, result: "DENIED", items: [] };
    const { result } = await renderGoverned(() => useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER"));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it("a successful read reports error: null", async () => {
    governedOutcome = { ok: true, result: "OK", items: [{ id: "r1" }] };
    const { result } = await renderGoverned(() => useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER"));
    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual([{ id: "r1" }]);
  });
});

describe("useReorderRequestsAssignedTo -- read-error contract", () => {
  it("a non-denial failure falls back to 'unknown'", async () => {
    // UNAVAILABLE and every other non-denial map to "unknown", preserving the previous
    // code-less-error fallback exactly.
    governedOutcome = { ok: false, result: "UNAVAILABLE", items: [] };
    const { result } = await renderGoverned(() => useReorderRequestsAssignedTo("u1", "ASSIGNED_TO_PARTS_ASSOCIATE"));
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
