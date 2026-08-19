// H14 (reorder pair) -- hooks/useReorderPurchaseOrders.js's
// usePurchaseOrderForReorderRequest() and hooks/useReorderPurchaseOrderVoids.js's
// useReorderPurchaseOrderVoid() used to write the SAME state
// ({ data: null, loading: false }) whether the read was DENIED or the
// document genuinely did not exist -- a Parts Associate whose read was
// denied saw the identical "Purchase Order details unavailable" copy as a
// genuine not-yet-recorded PO.
//
// Both hooks now mirror hooks/useReorderRequests.js's useReorderRequestById():
// `error` is `"not_found"` only when the read succeeds and the document does
// not exist, or the real Firestore SDK error code (e.g. "permission-denied")
// when the read itself fails. A caller can now tell "you cannot see it" apart
// from "there is nothing to see".
//
// vitest + @testing-library/react (jsdom). Firebase is fully mocked; the
// mocked onSnapshot captures the success/error callbacks so the test can
// drive each path directly.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

let capturedNext;
let capturedError;
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...pathParts) => ({ path: pathParts.join("/") }),
  onSnapshot: (_ref, next, error) => {
    capturedNext = next;
    capturedError = error;
    return () => {};
  },
}));

import { usePurchaseOrderForReorderRequest } from "../src/hooks/useReorderPurchaseOrders";
import { useReorderPurchaseOrderVoid } from "../src/hooks/useReorderPurchaseOrderVoids";

beforeEach(() => {
  capturedNext = undefined;
  capturedError = undefined;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePurchaseOrderForReorderRequest -- denied vs absent (H14)", () => {
  it("a denied read sets a real Firestore error code, NOT 'not_found'", () => {
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.error).not.toBe("not_found");
  });

  it("a genuinely absent document sets error 'not_found' -- distinct from a denied read", () => {
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    act(() => capturedNext({ id: "req-1", exists: () => false }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });

  it("a successful read with data clears error", () => {
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    act(() =>
      capturedNext({ id: "req-1", exists: () => true, data: () => ({ supplierName: "Acme" }) })
    );
    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual({ id: "req-1", supplierName: "Acme" });
  });

  it("a code-less error falls back to 'unknown', still distinct from 'not_found'", () => {
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    act(() => capturedError({}));
    expect(result.current.error).toBe("unknown");
  });
});

describe("useReorderPurchaseOrderVoid -- denied vs absent (H14)", () => {
  it("a denied read sets a real Firestore error code, NOT 'not_found'", () => {
    const { result } = renderHook(() => useReorderPurchaseOrderVoid("req-1"));
    act(() => capturedError({ code: "permission-denied" }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.error).not.toBe("not_found");
  });

  it("a genuinely absent void record sets error 'not_found' -- distinct from a denied read", () => {
    const { result } = renderHook(() => useReorderPurchaseOrderVoid("req-1"));
    act(() => capturedNext({ id: "req-1", exists: () => false }));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });
});
