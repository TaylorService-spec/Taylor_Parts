// CustomerSchedulingLinkPanel: a sessions read is applied only to the load still current.
//
// Regression for the unhandled "window is not defined" rejections CI reported from workOrderDetailPageErrorState.test.jsx:
// the panel set state when a read resolved AFTER it had unmounted (in a test, after jsdom was torn down). The same defect
// let a late answer for a PREVIOUS Work Order overwrite the one being shown. Both are proven closed here with deferred
// reads -- nothing is mocked away, and no rejection is suppressed.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import CustomerSchedulingLinkPanel from "../src/modules/workOrders/CustomerSchedulingLinkPanel.jsx";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const session = (id, status) => ({ ok: true, result: { sessions: [{ sessionId: id, status, expiresAt: "2026-12-31T00:00:00Z" }] } });

afterEach(() => cleanup());

describe("CustomerSchedulingLinkPanel -- only the current load is applied", () => {
  it("a read that resolves after unmount updates nothing (no state update on a torn-down tree)", async () => {
    const pending = deferred();
    const calls = [];
    const call = (op, input) => { calls.push([op, input]); return pending.promise; };
    const view = render(<CustomerSchedulingLinkPanel workOrder={{ id: "wo-1", status: "READY_TO_DISPATCH" }} call={call} />);
    expect(calls).toEqual([["readSelfSchedulingSessions", { workOrderId: "wo-1" }]]);
    view.unmount();
    // Resolving now must not reach React. NOTE what this can and cannot prove: inside a live jsdom React silently drops an
    // update to an unmounted root, so this assertion also holds WITHOUT the guard. The defect is only observable when the
    // read resolves after the environment is torn down -- reproduced by workOrderDetailPageErrorState.test.jsx, which
    // exited 1 on 4/4 runs on main before this change and 0 on 4/4 after. This case pins the intended behaviour.
    await act(async () => { pending.resolve(session("s-1", "ACTIVE")); await pending.promise; });
    expect(document.body.textContent).toBe("");
  });

  it("a late answer for the PREVIOUS Work Order never overwrites the current one", async () => {
    // (A regex, not an exact string: the status renders with an " · issued ..." suffix; an exact match would pass vacuously.)
    const first = deferred();
    const second = deferred();
    const call = (_op, input) => (input.workOrderId === "wo-1" ? first.promise : second.promise);
    const { rerender } = render(<CustomerSchedulingLinkPanel workOrder={{ id: "wo-1", status: "READY_TO_DISPATCH" }} call={call} />);
    rerender(<CustomerSchedulingLinkPanel workOrder={{ id: "wo-2", status: "READY_TO_DISPATCH" }} call={call} />);
    // wo-2 answers first, then the stale wo-1 answer arrives.
    await act(async () => { second.resolve({ ok: true, result: { sessions: [] } }); await second.promise; });
    await act(async () => { first.resolve(session("s-old", "ACTIVE")); await first.promise; });
    expect(screen.queryByText(/Waiting for the customer/)).toBeNull();
  });

  it("the current load is still applied normally", async () => {
    const call = async () => session("s-1", "ACTIVE");
    render(<CustomerSchedulingLinkPanel workOrder={{ id: "wo-1", status: "READY_TO_DISPATCH" }} call={call} />);
    expect(await screen.findByText(/Waiting for the customer/)).toBeTruthy();
  });
});
