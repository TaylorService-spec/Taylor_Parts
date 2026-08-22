// APPROVAL REQUESTS -- the operator surface for privileged Role approval.
//
// What these prove is narrow and deliberate: the UI shows the right thing, calls the right command,
// and NEVER sends an approver. Authorization itself is proven server-side in
// functions/test/trustedWriterCommands.test.mjs -- a component test asserting "the button is
// hidden" would be testing a convenience and could be mistaken for testing a control.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ApprovalRequests from "../src/modules/administration/ApprovalRequests.jsx";
import { privilegedApprovalClient, decisionIdempotencyKey } from "../src/services/privilegedApprovalClient.js";

vi.mock("../src/services/privilegedApprovalClient.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    privilegedApprovalClient: { listAll: vi.fn(), listPending: vi.fn(), decide: vi.fn() },
  };
});

const PENDING = {
  requestId: "req-owner-cw-emp-000",
  principalUid: "gOTW7OJxUID",
  roleId: "owner",
  scope: { type: "global" },
  status: "PENDING_APPROVAL",
  requestedBy: "admin-uid",
  requestedAtMs: 1_787_000_000_000,
  decidedBy: null,
  decidedAtMs: null,
  displayName: "Marisol Okonkwo",
  requiredApprovals: 1,
};

beforeEach(() => vi.clearAllMocks());

describe("Approval Requests", () => {
  it("shows a pending privileged request with the facts an approver needs", async () => {
    privilegedApprovalClient.listAll.mockResolvedValue([PENDING]);
    render(<ApprovalRequests />);

    expect(await screen.findByText("Marisol Okonkwo")).toBeTruthy();
    // The approver must be able to see WHO, WHAT and HOW BROAD without leaving the row.
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Global")).toBeTruthy();
    expect(screen.getByText("gOTW7OJxUID")).toBeTruthy();
    expect(screen.getByText("admin-uid")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("requires an explicit confirmation naming the person and Role before approving", async () => {
    privilegedApprovalClient.listAll.mockResolvedValue([PENDING]);
    render(<ApprovalRequests />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    // "Are you sure?" gets answered yes without being read. Naming the person and the Role is what
    // makes the confirmation a decision rather than a speed bump.
    expect(await screen.findByText("Approve Owner access for Marisol Okonkwo?")).toBeTruthy();
    // Nothing is sent until the confirmation is accepted.
    expect(privilegedApprovalClient.decide).not.toHaveBeenCalled();
  });

  it("approves through decidePrivilegedRoleRequest and NEVER sends an approver", async () => {
    privilegedApprovalClient.listAll
      .mockResolvedValueOnce([PENDING])
      .mockResolvedValue([{ ...PENDING, status: "APPROVED", decidedBy: "admin-uid", decidedAtMs: 1_787_000_100_000 }]);
    privilegedApprovalClient.decide.mockResolvedValue({ status: "applied" });
    render(<ApprovalRequests />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(privilegedApprovalClient.decide).toHaveBeenCalledTimes(1));
    const payload = privilegedApprovalClient.decide.mock.calls[0][0];
    expect(payload.requestId).toBe(PENDING.requestId);
    expect(payload.decision).toBe("APPROVE");
    // THE CONTROL. An approver field here would be inert server-side and misleading here.
    expect("approverUid" in payload).toBe(false);
    expect("actorUid" in payload).toBe(false);
  });

  it("after approval the request leaves Pending and shows who decided it and when", async () => {
    privilegedApprovalClient.listAll
      .mockResolvedValueOnce([PENDING])
      .mockResolvedValue([{ ...PENDING, status: "APPROVED", decidedBy: "admin-uid", decidedAtMs: 1_787_000_100_000 }]);
    privilegedApprovalClient.decide.mockResolvedValue({ status: "applied" });
    render(<ApprovalRequests />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("Approved")).toBeTruthy();
    expect(screen.getByText("No privileged Role requests are waiting for a decision.")).toBeTruthy();
    expect(screen.getByText("admin-uid")).toBeTruthy();
  });

  it("rejects without granting, and the rejected request shows REJECTED", async () => {
    privilegedApprovalClient.listAll
      .mockResolvedValueOnce([PENDING])
      .mockResolvedValue([{ ...PENDING, status: "REJECTED", decidedBy: "admin-uid", decidedAtMs: 1_787_000_100_000 }]);
    privilegedApprovalClient.decide.mockResolvedValue({ status: "applied" });
    render(<ApprovalRequests />);

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(privilegedApprovalClient.decide).toHaveBeenCalledTimes(1));
    expect(privilegedApprovalClient.decide.mock.calls[0][0].decision).toBe("REJECT");
    expect(await screen.findByText("Rejected")).toBeTruthy();
  });

  it("a double-click cannot produce two different decisions", () => {
    // The idempotency key is deterministic per (request, decision), so a second click is the SAME
    // request and resolves to the recorded outcome. A timestamp or random suffix here would make
    // every click a new request and defeat the backend's duplicate protection entirely.
    const first = decisionIdempotencyKey(PENDING.requestId, "APPROVE");
    const second = decisionIdempotencyKey(PENDING.requestId, "APPROVE");
    expect(first).toBe(second);
    expect(decisionIdempotencyKey(PENDING.requestId, "REJECT")).not.toBe(first);
  });

  it("an unauthorized operator sees a refusal, NOT an empty queue", async () => {
    // Denied and empty look identical and mean opposite things. An administrator told "nothing
    // pending" when the read was refused concludes there is nothing to approve.
    privilegedApprovalClient.listAll.mockRejectedValue(new Error("permission-denied"));
    render(<ApprovalRequests />);

    expect(await screen.findByText("Not available")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByText("No privileged Role requests are waiting for a decision.")).toBeNull();
  });
});
