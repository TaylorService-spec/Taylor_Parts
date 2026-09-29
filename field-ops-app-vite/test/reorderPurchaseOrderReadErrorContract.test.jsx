// H14 (reorder pair) -- hooks/useReorderPurchaseOrders.js's
// usePurchaseOrderForReorderRequest() and hooks/useReorderPurchaseOrderVoids.js's
// useReorderPurchaseOrderVoid() used to write the SAME state
// ({ data: null, loading: false }) whether the read was DENIED or the
// record genuinely did not exist -- a Parts Associate whose read was
// denied saw the identical "Purchase Order details unavailable" copy as a
// genuine not-yet-recorded PO.
//
// `error` is `"not_found"` only when the read succeeds and the record does not exist, or the read's
// own failure (`"permission-denied"` for a governed refusal, `"unavailable"` for a failed read)
// otherwise. A caller can tell "you cannot see it" apart from "there is nothing to see".
//
// THE AUTHORITY MOVED (Reorder activation): both hooks now read the governed PostgreSQL Reorder
// authority through `readReorderPurchaseOrders`, never Firestore. The contract above is unchanged,
// and this suite additionally proves no Firestore module is reached.
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

let answer;
const calls = [];
vi.mock("../src/services/reorderApiClient.js", () => ({
  reorderApiClient: {
    call: async (operation, input) => {
      calls.push({ operation, input });
      return answer;
    },
  },
}));
vi.mock("firebase/firestore", () => { throw new Error("the Reorder purchase-order hooks must not load Firestore"); });
vi.mock("../src/firebase/firebase", () => { throw new Error("the Reorder purchase-order hooks must not load Firebase"); });

import { usePurchaseOrderForReorderRequest } from "../src/hooks/useReorderPurchaseOrders";
import { useReorderPurchaseOrderVoid } from "../src/hooks/useReorderPurchaseOrderVoids";
import { usePurchaseOrdersByIds } from "../src/hooks/usePurchaseOrdersByIds";

const PO = {
  id: "req-1", reorderRequestId: "req-1", purchaseOrderId: "req-1", partId: "P-1", status: "ORDERED",
  supplierName: "Acme", externalPoNumber: "PO-1", orderedQuantity: 3, orderedDate: "2026-03-01",
  expectedArrivalDate: null, void: null,
};

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("usePurchaseOrderForReorderRequest -- denied vs absent (H14)", () => {
  it("asks the governed read for exactly the one Reorder Request", async () => {
    answer = { ok: true, result: { purchaseOrders: [PO] } };
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls).toEqual([{ operation: "readReorderPurchaseOrders", input: { reorderRequestIds: ["req-1"] } }]);
  });

  it("a refused read sets 'permission-denied', NOT 'not_found'", async () => {
    answer = { ok: false, code: "FORBIDDEN", reason: "FORBIDDEN", status: 403, message: "no" };
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
  });

  it("a genuinely absent purchase order sets error 'not_found' -- distinct from a denied read", async () => {
    answer = { ok: true, result: { purchaseOrders: [] } };
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });

  it("a successful read with data clears error", async () => {
    answer = { ok: true, result: { purchaseOrders: [PO] } };
    const { result } = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.data).toMatchObject({ id: "req-1", supplierName: "Acme", status: "ORDERED" });
  });

  it("a failed or malformed read is 'unavailable', still distinct from 'not_found'", async () => {
    answer = { ok: false, code: "UNREACHABLE", reason: null, status: null, message: "down" };
    const failed = renderHook(() => usePurchaseOrderForReorderRequest("req-1"));
    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    expect(failed.result.current.error).toBe("unavailable");
    answer = { ok: true, result: { nope: true } };
    const malformed = renderHook(() => usePurchaseOrderForReorderRequest("req-2"));
    await waitFor(() => expect(malformed.result.current.loading).toBe(false));
    expect(malformed.result.current.error).toBe("unavailable");
  });
});

describe("useReorderPurchaseOrderVoid -- denied vs absent (H14)", () => {
  it("a refused read sets 'permission-denied', NOT 'not_found'", async () => {
    answer = { ok: false, code: "FORBIDDEN", reason: "FORBIDDEN", status: 403, message: "no" };
    const { result } = renderHook(() => useReorderPurchaseOrderVoid("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("permission-denied");
  });

  it("a purchase order with no void record sets error 'not_found' -- distinct from a denied read", async () => {
    answer = { ok: true, result: { purchaseOrders: [PO] } };
    const { result } = renderHook(() => useReorderPurchaseOrderVoid("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe("not_found");
  });

  it("the void record comes back with the fields the Voided card renders", async () => {
    const voidRecord = { reorderPurchaseOrderId: "req-1", reason: "discontinued", voidedBy: "p-1", createdAt: "2026-03-02T00:00:00.000Z" };
    answer = { ok: true, result: { purchaseOrders: [{ ...PO, void: voidRecord }] } };
    const { result } = renderHook(() => useReorderPurchaseOrderVoid("req-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.data).toEqual({ id: "req-1", ...voidRecord });
  });
});

describe("usePurchaseOrdersByIds -- the list read, from the governed authority", () => {
  it("keys the answer by reorderRequestId and reads large id sets in bounded chunks", async () => {
    answer = { ok: true, result: { purchaseOrders: [PO] } };
    const ids = Array.from({ length: 150 }, (_, k) => `req-${String(k).padStart(3, "0")}`);
    const { result } = renderHook(() => usePurchaseOrdersByIds(ids));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls.map((c) => c.input.reorderRequestIds.length)).toEqual([100, 50]);
    expect(calls.every((c) => c.operation === "readReorderPurchaseOrders")).toBe(true);
    expect(result.current.error).toBe(null);
    expect(result.current.purchaseOrdersById["req-1"]).toMatchObject({ supplierName: "Acme" });
  });

  it("preserves a refusal so the view model fails the surface closed instead of rendering ORPHAN rows", async () => {
    answer = { ok: false, code: "FORBIDDEN", reason: "FORBIDDEN", status: 403, message: "no" };
    const { result } = renderHook(() => usePurchaseOrdersByIds(["req-1"]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("permission-denied");
    expect(result.current.purchaseOrdersById).toEqual({});
  });
});
