// CRM Activity create-action hook. Behavior tests (vitest + jsdom via renderHook), mirroring
// test/useSalesOrderActions.test.jsx's own shape exactly. A MOCKED client is injected via deps.client, so
// `firebase` never loads. The load-bearing assertion is idempotency-key stability: a retry of the SAME
// failed intent must reuse the EXACT same key, never mint a new one.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCrmActivityActions } from "../src/hooks/useCrmActivityActions.js";

function mockClient() {
  return { createCrmActivity: vi.fn() };
}

describe("useCrmActivityActions -- idempotency key strategy", () => {
  it("generates a key lazily on first submit, not on hook mount/render", () => {
    const client = mockClient();
    const { result } = renderHook(() => useCrmActivityActions("ACCT-1", { client }));
    expect(result.current.peekCreateIntentKey()).toBeNull();
  });

  it("a retry of the SAME failed intent reuses the exact same idempotencyKey", async () => {
    const client = mockClient();
    client.createCrmActivity
      .mockResolvedValueOnce({ errorStatus: "internal" }) // first attempt fails (transient)
      .mockResolvedValueOnce({ result: { success: true, replayed: false, activityId: "ACT-1" } }); // retry succeeds
    const { result } = renderHook(() => useCrmActivityActions("ACCT-1", { client }));

    await act(async () => {
      await expect(result.current.runCreate({ type: "GENERAL", body: "hello" })).rejects.toThrow();
    });
    const keyAfterFailure = client.createCrmActivity.mock.calls[0][0].idempotencyKey;
    expect(typeof keyAfterFailure).toBe("string");
    expect(keyAfterFailure.length).toBeGreaterThan(0);
    expect(result.current.peekCreateIntentKey()).toBe(keyAfterFailure);

    let outcome;
    await act(async () => {
      outcome = await result.current.runCreate({ type: "GENERAL", body: "hello" }); // the retry
    });
    const keyOnRetry = client.createCrmActivity.mock.calls[1][0].idempotencyKey;
    expect(keyOnRetry).toBe(keyAfterFailure); // SAME key -- not regenerated
    expect(outcome.activityId).toBe("ACT-1");
    // A finished (succeeded) intent clears its cached key -- the NEXT submit starts a genuinely new one.
    expect(result.current.peekCreateIntentKey()).toBeNull();
  });

  it("a retained key NEVER crosses to a different account", async () => {
    const client = mockClient();
    client.createCrmActivity.mockResolvedValue({ errorStatus: "internal" });
    const { result, rerender } = renderHook(({ id }) => useCrmActivityActions(id, { client }), {
      initialProps: { id: "ACCT-1" },
    });

    await act(async () => {
      await expect(result.current.runCreate({ type: "GENERAL", body: "x" })).rejects.toThrow();
    });
    const keyForAcct1 = client.createCrmActivity.mock.calls[0][0].idempotencyKey;
    expect(result.current.peekCreateIntentKey()).toBe(keyForAcct1);

    // Same mounted component, different account.
    rerender({ id: "ACCT-2" });
    expect(result.current.peekCreateIntentKey()).toBeNull();

    await act(async () => {
      await expect(result.current.runCreate({ type: "GENERAL", body: "y" })).rejects.toThrow();
    });
    const keyForAcct2 = client.createCrmActivity.mock.calls[1][0].idempotencyKey;
    expect(client.createCrmActivity.mock.calls[1][0].accountId).toBe("ACCT-2");
    expect(keyForAcct2).not.toBe(keyForAcct1);
  });

  it("discarding an abandoned intent (form closed without submitting) clears the cached key", async () => {
    const client = mockClient();
    client.createCrmActivity.mockResolvedValue({ errorStatus: "internal" });
    const { result } = renderHook(() => useCrmActivityActions("ACCT-1", { client }));

    await act(async () => {
      await expect(result.current.runCreate({ type: "GENERAL", body: "x" })).rejects.toThrow();
    });
    expect(result.current.peekCreateIntentKey()).not.toBeNull();
    act(() => result.current.discardCreateIntent());
    expect(result.current.peekCreateIntentKey()).toBeNull();
  });

  it("the add-note happy path calls the client once with accountId/type/body/idempotencyKey and returns the result", async () => {
    const client = mockClient();
    client.createCrmActivity.mockResolvedValue({ result: { success: true, replayed: false, activityId: "ACT-42" } });
    const { result } = renderHook(() => useCrmActivityActions("ACCT-9", { client }));

    let outcome;
    await act(async () => {
      outcome = await result.current.runCreate({ type: "SALES_NOTE", body: "Discussed pricing." });
    });
    expect(client.createCrmActivity).toHaveBeenCalledTimes(1);
    const call = client.createCrmActivity.mock.calls[0][0];
    expect(call.accountId).toBe("ACCT-9");
    expect(call.type).toBe("SALES_NOTE");
    expect(call.body).toBe("Discussed pricing.");
    expect(typeof call.idempotencyKey).toBe("string");
    expect(outcome.activityId).toBe("ACT-42");
  });
});
