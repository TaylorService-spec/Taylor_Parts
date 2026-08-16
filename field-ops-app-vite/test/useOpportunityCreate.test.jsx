// Opportunity CREATE action hook -- behavior tests (vitest + jsdom via renderHook), mirroring
// test/useSalesOrderActions.test.jsx's shape. A MOCKED client is injected via deps.client, so `firebase`
// never loads. The load-bearing assertion is idempotency-key stability across a retry of the SAME failed
// create intent.
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOpportunityCreate } from "../src/hooks/useOpportunityCreate.js";

function mockClient() {
  return { createOpportunity: vi.fn() };
}

const INPUT = { accountId: "A1", ownerEmployeeId: "E1", salesChannel: "RETAIL", expectedValue: null, expectedCloseAt: null };

describe("useOpportunityCreate -- idempotency key strategy", () => {
  it("generates no key until the first submit", () => {
    const client = mockClient();
    const { result } = renderHook(() => useOpportunityCreate({ client }));
    expect(result.current.peekIntentKey()).toBeNull();
  });

  it("a retry of the SAME failed intent reuses the exact same idempotencyKey", async () => {
    const client = mockClient();
    client.createOpportunity
      .mockResolvedValueOnce({ errorStatus: "internal" }) // first attempt fails (transient)
      .mockResolvedValueOnce({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "IDENTIFIED" } });
    const { result } = renderHook(() => useOpportunityCreate({ client }));

    await act(async () => {
      await expect(result.current.runCreate(INPUT)).rejects.toThrow();
    });
    const keyAfterFailure = client.createOpportunity.mock.calls[0][0].idempotencyKey;
    expect(typeof keyAfterFailure).toBe("string");
    expect(keyAfterFailure.length).toBeGreaterThan(0);
    expect(result.current.peekIntentKey()).toBe(keyAfterFailure);

    let outcome;
    await act(async () => {
      outcome = await result.current.runCreate(INPUT); // the retry
    });
    const keyOnRetry = client.createOpportunity.mock.calls[1][0].idempotencyKey;
    expect(keyOnRetry).toBe(keyAfterFailure); // SAME key -- not regenerated
    expect(outcome.kind).toBe("applied");
    expect(outcome.opportunityId).toBe("OPP-1");
    // A finished (succeeded) intent clears its cached key -- the NEXT submit starts a genuinely new intent.
    expect(result.current.peekIntentKey()).toBeNull();
  });

  it("two independent submit attempts (no failure in between) each get a fresh key", async () => {
    const client = mockClient();
    client.createOpportunity
      .mockResolvedValueOnce({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "IDENTIFIED" } })
      .mockResolvedValueOnce({ result: { success: true, replayed: false, opportunityId: "OPP-2", stage: "IDENTIFIED" } });
    const { result } = renderHook(() => useOpportunityCreate({ client }));

    await act(async () => { await result.current.runCreate(INPUT); });
    const firstKey = client.createOpportunity.mock.calls[0][0].idempotencyKey;
    await act(async () => { await result.current.runCreate(INPUT); });
    const secondKey = client.createOpportunity.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("discarding an abandoned intent (form closed without submitting) clears the cached key", async () => {
    const client = mockClient();
    client.createOpportunity.mockResolvedValue({ errorStatus: "internal" });
    const { result } = renderHook(() => useOpportunityCreate({ client }));

    await act(async () => {
      await expect(result.current.runCreate(INPUT)).rejects.toThrow();
    });
    expect(result.current.peekIntentKey()).not.toBeNull();
    act(() => result.current.discardIntent());
    expect(result.current.peekIntentKey()).toBeNull();
  });

  it("a replayed create result maps to 'replayed', never a fabricated second success", async () => {
    const client = mockClient();
    client.createOpportunity.mockResolvedValue({ result: { success: true, replayed: true, opportunityId: "OPP-1", stage: "IDENTIFIED" } });
    const { result } = renderHook(() => useOpportunityCreate({ client }));
    let outcome;
    await act(async () => { outcome = await result.current.runCreate(INPUT); });
    expect(outcome.kind).toBe("replayed");
  });

  it("a denied outcome maps to safe copy and throws (never a fabricated success)", async () => {
    const client = mockClient();
    client.createOpportunity.mockResolvedValue({ errorStatus: "permission-denied" });
    const { result } = renderHook(() => useOpportunityCreate({ client }));
    await act(async () => {
      await expect(result.current.runCreate(INPUT)).rejects.toMatchObject({ outcome: { kind: "denied" } });
    });
  });

  it("the exact payload sent to the callable is the input plus idempotencyKey, nothing invented", async () => {
    const client = mockClient();
    client.createOpportunity.mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "IDENTIFIED" } });
    const { result } = renderHook(() => useOpportunityCreate({ client }));
    await act(async () => { await result.current.runCreate(INPUT); });
    const sent = client.createOpportunity.mock.calls[0][0];
    expect(sent.accountId).toBe("A1");
    expect(sent.ownerEmployeeId).toBe("E1");
    expect(sent.salesChannel).toBe("RETAIL");
    expect(typeof sent.idempotencyKey).toBe("string");
  });
});
