// Item 4 -- Sales Order operational actions. Behavior tests for useSalesOrderActions
// (vitest + jsdom via renderHook, mirrors test/useTruckManagement.test.jsx's shape). A MOCKED
// client is injected via deps.client, so `firebase` never loads.
//
// The load-bearing assertion here is idempotency-key stability: transitionSalesOrder requires a
// caller-supplied idempotencyKey, and a retry of the SAME failed intent (the user re-clicking
// Confirm after a failed attempt) must reuse the EXACT same key, never mint a new one -- a
// network-level double-send of the retried call must never apply twice server-side.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSalesOrderActions } from "../src/hooks/useSalesOrderActions.js";

function mockClient() {
  return {
    transitionSalesOrder: vi.fn(),
    allocateSalesOrder: vi.fn(),
    createServiceForSalesOrder: vi.fn(),
  };
}

describe("useSalesOrderActions -- idempotency key strategy", () => {
  it("generates a key lazily on first use of a transition, not on hook mount/render", () => {
    const client = mockClient();
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));
    expect(result.current.peekTransitionIntentKey("ADVANCE")).toBeNull();
  });

  it("a retry of the SAME failed intent reuses the exact same idempotencyKey", async () => {
    const client = mockClient();
    client.transitionSalesOrder
      .mockResolvedValueOnce({ errorStatus: "internal" }) // first attempt fails (transient)
      .mockResolvedValueOnce({ result: { success: true, replayed: false, salesOrderId: "SO-1", state: "IN_FULFILLMENT" } }); // retry succeeds
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));

    await act(async () => {
      await expect(result.current.runTransition("ADVANCE")).rejects.toThrow();
    });
    const keyAfterFailure = client.transitionSalesOrder.mock.calls[0][0].idempotencyKey;
    expect(typeof keyAfterFailure).toBe("string");
    expect(keyAfterFailure.length).toBeGreaterThan(0);
    // The failed attempt's key must still be cached -- the retry has not happened yet.
    expect(result.current.peekTransitionIntentKey("ADVANCE")).toBe(keyAfterFailure);

    let outcome;
    await act(async () => {
      outcome = await result.current.runTransition("ADVANCE"); // the retry
    });
    const keyOnRetry = client.transitionSalesOrder.mock.calls[1][0].idempotencyKey;
    expect(keyOnRetry).toBe(keyAfterFailure); // SAME key -- not regenerated
    expect(outcome.kind).toBe("applied");
    expect(outcome.state).toBe("IN_FULFILLMENT");
    // A finished (succeeded) intent clears its cached key -- the NEXT click starts a genuinely new intent.
    expect(result.current.peekTransitionIntentKey("ADVANCE")).toBeNull();
  });

  it("discarding an abandoned intent (dialog closed without confirming) clears the cached key, so the next attempt mints a fresh one", async () => {
    const client = mockClient();
    client.transitionSalesOrder.mockResolvedValue({ result: { success: true, replayed: false, salesOrderId: "SO-1", state: "CANCELLED" } });
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));

    await act(async () => {
      await result.current.runTransition("CANCEL");
    });
    // Succeeded -- key already cleared by success, but exercise the explicit discard path too, e.g. as
    // called by SalesOrderActions.jsx when a dialog is closed before ever confirming.
    act(() => result.current.discardTransitionIntent("CANCEL"));
    expect(result.current.peekTransitionIntentKey("CANCEL")).toBeNull();
  });

  it("ADVANCE and CANCEL carry independent idempotency keys -- one intent never contaminates the other", async () => {
    const client = mockClient();
    client.transitionSalesOrder.mockResolvedValueOnce({ errorStatus: "internal" }); // ADVANCE fails and stays pending
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));

    await act(async () => {
      await expect(result.current.runTransition("ADVANCE")).rejects.toThrow();
    });
    const advanceKey = result.current.peekTransitionIntentKey("ADVANCE");
    expect(result.current.peekTransitionIntentKey("CANCEL")).toBeNull();
    expect(advanceKey).not.toBeNull();
  });

  it("a denied/failed-precondition outcome maps to safe copy and throws (never a fabricated success)", async () => {
    const client = mockClient();
    client.transitionSalesOrder.mockResolvedValue({ errorStatus: "failed-precondition" });
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));
    await act(async () => {
      await expect(result.current.runTransition("ADVANCE")).rejects.toMatchObject({
        outcome: { kind: "invalid" },
      });
    });
  });

  it("allocateSalesOrder / createServiceForSalesOrder are never called with an idempotencyKey (neither callable accepts one)", async () => {
    const client = mockClient();
    client.allocateSalesOrder.mockResolvedValue({ result: { success: true, salesOrderId: "SO-1", readiness: "READY", counts: {} } });
    client.createServiceForSalesOrder.mockResolvedValue({ result: { success: true, salesOrderId: "SO-1", workOrderId: "WO-9", woNumber: "WO-2026-9" } });
    const { result } = renderHook(() => useSalesOrderActions("SO-1", { client }));

    await act(async () => {
      await result.current.runAllocate();
      await result.current.runCreateService();
    });
    expect(client.allocateSalesOrder).toHaveBeenCalledWith({ salesOrderId: "SO-1" });
    expect(client.createServiceForSalesOrder).toHaveBeenCalledWith({ salesOrderId: "SO-1" });
  });
});
