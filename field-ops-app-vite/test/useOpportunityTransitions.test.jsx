// Opportunity lifecycle TRANSITION action hook -- behavior tests (vitest + jsdom via renderHook), mirroring
// test/useSalesOrderActions.test.jsx's shape exactly (same server-side hazard: opportunityId is NOT part of
// the replay identity, so a retained key must never cross to a different Opportunity).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOpportunityTransitions } from "../src/hooks/useOpportunityTransitions.js";

function mockClient() {
  // BOTH commands. WON is routed to closeOpportunityAsWon rather than transitionOpportunity,
  // because the transition sets WON without creating a Sales Order -- the split-brain the
  // atomic command exists to prevent. A mock carrying only the transition would let that
  // routing regress silently, which is how it was missed in the first place.
  return { transitionOpportunity: vi.fn(), closeOpportunityAsWon: vi.fn() };
}

const ADVANCE = { kind: "ADVANCE", toStage: "QUALIFYING" };
// WON carries the Sales Order owner/channel the atomic command requires.
const WON = { kind: "OUTCOME", outcome: "WON", ownerEmployeeId: "emp-1", salesChannel: "RETAIL" };
const LOST = { kind: "OUTCOME", outcome: "LOST" };

describe("useOpportunityTransitions -- idempotency key strategy", () => {
  it("generates a key lazily on first use of a transition intent, not on hook mount/render", () => {
    const client = mockClient();
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    expect(result.current.peekIntentKey(ADVANCE)).toBeNull();
  });

  it("a retained key NEVER crosses to a different Opportunity", async () => {
    // Server's replay identity is mkAuditId("transitionOpportunity", actorUid, idempotencyKey) --
    // opportunityId is NOT part of it. A key kept after a failed attempt on OPP-1, reused on OPP-2, would
    // take the replay branch and return { success: true, replayed: true } WITHOUT applying the transition.
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ errorStatus: "internal" });
    const { result, rerender } = renderHook(({ id }) => useOpportunityTransitions(id, { client }), {
      initialProps: { id: "OPP-1" },
    });

    await act(async () => {
      await expect(result.current.runTransition(ADVANCE)).rejects.toThrow();
    });
    const keyForOpp1 = client.transitionOpportunity.mock.calls[0][0].idempotencyKey;
    expect(result.current.peekIntentKey(ADVANCE)).toBe(keyForOpp1);

    rerender({ id: "OPP-2" }); // same mounted detail pane, different selected Opportunity
    expect(result.current.peekIntentKey(ADVANCE)).toBeNull();

    await act(async () => {
      await expect(result.current.runTransition(ADVANCE)).rejects.toThrow();
    });
    const call2 = client.transitionOpportunity.mock.calls[1][0];
    expect(call2.opportunityId).toBe("OPP-2");
    expect(call2.idempotencyKey).not.toBe(keyForOpp1);
  });

  it("a retry of the SAME failed intent reuses the exact same idempotencyKey", async () => {
    const client = mockClient();
    client.transitionOpportunity
      .mockResolvedValueOnce({ errorStatus: "internal" })
      .mockResolvedValueOnce({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "QUALIFYING", outcome: null } });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));

    await act(async () => {
      await expect(result.current.runTransition(ADVANCE)).rejects.toThrow();
    });
    const keyAfterFailure = client.transitionOpportunity.mock.calls[0][0].idempotencyKey;
    expect(result.current.peekIntentKey(ADVANCE)).toBe(keyAfterFailure);

    let outcome;
    await act(async () => { outcome = await result.current.runTransition(ADVANCE); });
    const keyOnRetry = client.transitionOpportunity.mock.calls[1][0].idempotencyKey;
    expect(keyOnRetry).toBe(keyAfterFailure);
    expect(outcome.kind).toBe("applied");
    expect(result.current.peekIntentKey(ADVANCE)).toBeNull();
  });

  it("ADVANCE / WON / LOST carry independent idempotency keys", async () => {
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ errorStatus: "internal" });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));

    await act(async () => { await expect(result.current.runTransition(ADVANCE)).rejects.toThrow(); });
    await act(async () => { await expect(result.current.runTransition(LOST)).rejects.toThrow(); });
    const advanceKey = result.current.peekIntentKey(ADVANCE);
    const lostKey = result.current.peekIntentKey(LOST);
    expect(result.current.peekIntentKey(WON)).toBeNull();
    expect(advanceKey).not.toBeNull();
    expect(lostKey).not.toBeNull();
    expect(advanceKey).not.toBe(lostKey);
  });

  it("discardIntent clears the cached key for an abandoned intent", async () => {
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ errorStatus: "internal" });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await expect(result.current.runTransition(LOST)).rejects.toThrow(); });
    expect(result.current.peekIntentKey(LOST)).not.toBeNull();
    act(() => result.current.discardIntent(LOST));
    expect(result.current.peekIntentKey(LOST)).toBeNull();
  });

  it("a failed-precondition outcome (e.g. ALREADY_CLOSED/ILLEGAL_TRANSITION) maps to safe copy and throws", async () => {
    const client = mockClient();
    // WON goes to the ATOMIC command, so that is the one that must fail here.
    client.closeOpportunityAsWon.mockResolvedValue({ errorStatus: "failed-precondition" });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => {
      await expect(result.current.runTransition(WON)).rejects.toMatchObject({ outcome: { kind: "invalid" } });
    });
    expect(client.transitionOpportunity).not.toHaveBeenCalled();
  });

  it("sends the exact payload the server expects for ADVANCE and for OUTCOME", async () => {
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "QUALIFYING", outcome: null } });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await result.current.runTransition(ADVANCE); });
    const advanceSent = client.transitionOpportunity.mock.calls[0][0];
    expect(advanceSent).toMatchObject({ opportunityId: "OPP-1", toStage: "QUALIFYING" });
    expect(advanceSent.outcome).toBeUndefined();

    client.transitionOpportunity.mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "DECISION", outcome: "LOST" } });
    await act(async () => { await result.current.runTransition(LOST); });
    const lostSent = client.transitionOpportunity.mock.calls[1][0];
    expect(lostSent).toMatchObject({ opportunityId: "OPP-1", outcome: "LOST" });
    expect(lostSent.toStage).toBeUndefined();
  });
});

// ============ WON ROUTING — the defect this suite now pins ============
//
// Before this, runTransition sent EVERY intent to transitionOpportunity, WON included. That
// callable sets outcome WON and creates no Sales Order, so clicking "Mark Won" produced an
// Opportunity that was WON, terminal, and orderless — exactly the split-brain
// closeOpportunityAsWon was written to make unreachable. The atomic command was merged and
// simply never called.
//
// These assertions exist so that regression cannot return quietly: a mock without
// closeOpportunityAsWon now fails loudly rather than silently taking the old path.
describe("WON is routed to the atomic command, never to transitionOpportunity", () => {
  const wonResult = {
    result: { success: true, replayed: false, recovered: false, opportunityId: "OPP-1", salesOrderId: "so-9", salesOrderNumber: "SO-2026-000009" },
  };

  it("WON calls closeOpportunityAsWon and NOT transitionOpportunity", async () => {
    const client = mockClient();
    client.closeOpportunityAsWon.mockResolvedValue(wonResult);
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await result.current.runTransition(WON); });

    expect(client.closeOpportunityAsWon).toHaveBeenCalledTimes(1);
    expect(client.transitionOpportunity).not.toHaveBeenCalled();
  });

  it("the atomic call carries the Sales Order's owner and channel, which the server cannot infer", async () => {
    const client = mockClient();
    client.closeOpportunityAsWon.mockResolvedValue(wonResult);
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await result.current.runTransition(WON); });

    const payload = client.closeOpportunityAsWon.mock.calls[0][0];
    expect(payload.opportunityId).toBe("OPP-1");
    expect(payload.ownerEmployeeId).toBe("emp-1");
    expect(payload.salesChannel).toBe("RETAIL");
    expect(typeof payload.idempotencyKey).toBe("string");
    // Account and lines are server-derived from the Opportunity. Sending them would invite a
    // client to disagree with the record it is closing.
    expect(payload).not.toHaveProperty("accountId");
    expect(payload).not.toHaveProperty("lines");
  });

  it("the created Sales Order is carried back so the caller can link to it", async () => {
    const client = mockClient();
    client.closeOpportunityAsWon.mockResolvedValue(wonResult);
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    let outcome;
    await act(async () => { outcome = await result.current.runTransition(WON); });

    // A Won that does not show its order leaves the user hunting for what they just made.
    expect(outcome.salesOrderId).toBe("so-9");
    expect(outcome.salesOrderNumber).toBe("SO-2026-000009");
    expect(outcome.recovered).toBe(false);
  });

  it("a RECOVERED close (Won existed, order was missing) is reported as such", async () => {
    const client = mockClient();
    client.closeOpportunityAsWon.mockResolvedValue({
      result: { success: true, replayed: false, recovered: true, opportunityId: "OPP-1", salesOrderId: "so-3", salesOrderNumber: "SO-2026-000003" },
    });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    let outcome;
    await act(async () => { outcome = await result.current.runTransition(WON); });
    expect(outcome.recovered).toBe(true);
  });

  it("LOST still uses transitionOpportunity — it creates no order, so it must not go atomic", async () => {
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "DECISION", outcome: "LOST" } });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await result.current.runTransition(LOST); });

    expect(client.transitionOpportunity).toHaveBeenCalledTimes(1);
    expect(client.closeOpportunityAsWon).not.toHaveBeenCalled();
  });

  it("ADVANCE still uses transitionOpportunity", async () => {
    const client = mockClient();
    client.transitionOpportunity.mockResolvedValue({ result: { success: true, replayed: false, opportunityId: "OPP-1", stage: "QUALIFYING", outcome: null } });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => { await result.current.runTransition({ kind: "ADVANCE", toStage: "QUALIFYING" }); });

    expect(client.transitionOpportunity).toHaveBeenCalledTimes(1);
    expect(client.closeOpportunityAsWon).not.toHaveBeenCalled();
  });
});
