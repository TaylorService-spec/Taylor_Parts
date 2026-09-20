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

import { useReorderRequestsByStatus, useMyAssignedReorderRequests } from "../src/hooks/useReorderRequests";
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

  // This hook reads the governed PostgreSQL authority now, so there is no onSnapshot error callback
  // to drive. The contract it exists for is unchanged: a failed read is REPORTED, never rendered as
  // an empty queue, because "no requests" and "could not read requests" are different facts.
  const withClient = (call) => renderHook(() =>
    useReorderRequestsByStatus("READY_FOR_PARTS_MANAGER", true, { client: { call } }));

  it("a failed read keeps the server's own refusal reason (not swallowed)", async () => {
    const { result } = withClient(async () => ({ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED" }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("CAPABILITY_REQUIRED");
    expect(result.current.data).toEqual([]);
  });

  it("a refusal with no specific reason falls back to its category", async () => {
    const { result } = withClient(async () => ({ ok: false, code: "UNREACHABLE", reason: null }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("UNREACHABLE");
  });

  it("a successful read reports no error and returns its rows", async () => {
    const { result } = withClient(async () => ({ ok: true, result: [{ id: "a" }] }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.data.map((r) => r.id)).toEqual(["a"]);
  });

  it("the status is what it asks for, and it asks the queue read", async () => {
    let seen;
    const { result } = withClient(async (operation, input) => {
      seen = { operation, input };
      return { ok: true, result: [] };
    });
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen).toEqual({ operation: "readReorderQueue", input: { statuses: ["READY_FOR_PARTS_MANAGER"] } });
  });
});

// "My assigned work" no longer reads Firestore at all, so there is no onSnapshot error callback to
// drive. Its refusal path is now the governed client's envelope, and the contract that matters is
// the same one: a failed read is REPORTED, never rendered as an empty queue.
describe("useMyAssignedReorderRequests -- read-error contract", () => {
  const withClient = (call) => renderHook(() =>
    useMyAssignedReorderRequests("ASSIGNED_TO_PARTS_ASSOCIATE", true, { client: { call } }));

  it("a refusal is surfaced by the server's OWN reason, not flattened to a generic failure", async () => {
    const { result } = withClient(async () => ({ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED" }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("CAPABILITY_REQUIRED");
    expect(result.current.data).toEqual([]);
  });

  it("a refusal with no specific reason falls back to the category", async () => {
    const { result } = withClient(async () => ({ ok: false, code: "UNREACHABLE", reason: null }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("UNREACHABLE");
  });

  it("a thrown transport error becomes 'unknown' rather than an empty queue that looks like no work", async () => {
    const { result } = withClient(async () => { throw new Error("boom"); });
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("unknown");
    expect(result.current.data).toEqual([]);
  });

  it("a successful read filters to the requested status and reports no error", async () => {
    const { result } = withClient(async () => ({ ok: true, result: [
      { reorderRequestId: "a", status: "ASSIGNED_TO_PARTS_ASSOCIATE" },
      { reorderRequestId: "b", status: "PURCHASING_IN_PROGRESS" },
    ] }));
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.data.map((r) => r.reorderRequestId)).toEqual(["a"]);
  });

  it("the hook states no identity: the server scopes the read to the caller's own Employee", async () => {
    let seen;
    const { result } = withClient(async (operation, input) => {
      seen = { operation, input };
      return { ok: true, result: [] };
    });
    await vi.waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen.operation).toBe("readMyAssignedReorders");
    // No uid, no employee id, no input at all -- a caller that could name someone else's work is a
    // caller that could read it.
    expect(seen.input).toBe(undefined);
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
