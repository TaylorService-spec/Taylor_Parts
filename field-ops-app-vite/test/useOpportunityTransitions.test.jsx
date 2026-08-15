// Opportunity lifecycle TRANSITION action hook -- behavior tests (vitest + jsdom via renderHook), mirroring
// test/useSalesOrderActions.test.jsx's shape exactly (same server-side hazard: opportunityId is NOT part of
// the replay identity, so a retained key must never cross to a different Opportunity).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOpportunityTransitions } from "../src/hooks/useOpportunityTransitions.js";

function mockClient() {
  return { transitionOpportunity: vi.fn() };
}

const ADVANCE = { kind: "ADVANCE", toStage: "QUALIFYING" };
const WON = { kind: "OUTCOME", outcome: "WON" };
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
    client.transitionOpportunity.mockResolvedValue({ errorStatus: "failed-precondition" });
    const { result } = renderHook(() => useOpportunityTransitions("OPP-1", { client }));
    await act(async () => {
      await expect(result.current.runTransition(WON)).rejects.toMatchObject({ outcome: { kind: "invalid" } });
    });
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
