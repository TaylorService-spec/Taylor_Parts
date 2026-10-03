// Owner ruling #204 (2026-10-03): a salesperson proposes a trade-in; only an approver (salesAgreement.tradeIn.approve) approves
// -- assigning the value -- or declines with a reason. A proposal reduces nothing; the page decides nothing.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TradeInSection, { toTradeInInput } from "../src/modules/sales/TradeInSection.jsx";

const PROPOSED = { itemNumber: 1, description: "Used ice machine", manufacturer: "Acme", modelNumber: "IM-500", serialNumber: null,
  proposedValueMinor: 550000, notes: "compressor noisy", evidenceReference: "photos-77", approvalStatus: "PROPOSED", approvedCreditMinor: null, decisionReason: null };
const FORBIDDEN = [/PROPOSED\b/, /APPROVED\b/, /DECLINED\b/, /acquisition/i, /margin/i, /\bcost\b/i, /book value/i];

describe("TradeInSection", () => {
  it("a proposal shows its proposed value and no credit, in words; identity unknown is said", () => {
    const { container } = render(<TradeInSection tradeIns={[PROPOSED]} />);
    expect(screen.getByText("Proposed — awaiting approval")).toBeTruthy();
    expect(screen.getByText("None until approved")).toBeTruthy();
    expect(container.textContent).toMatch(/serial not known/);
    expect(container.textContent).toMatch(/does not reduce the balance until it is approved/);
    for (const re of FORBIDDEN) expect(container.textContent).not.toMatch(re);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("a salesperson proposes: the whole list is sent as proposals, never a credit", async () => {
    const onPropose = vi.fn().mockResolvedValue({ ok: true });
    render(<TradeInSection tradeIns={[PROPOSED]} editable onPropose={onPropose} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose a trade-in" }));
    fireEvent.change(screen.getByLabelText("Equipment description"), { target: { value: "Reach-in cooler" } });
    fireEvent.change(screen.getByLabelText("Proposed value"), { target: { value: "800.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose trade-in" }));
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onPropose.mock.calls[0][0]).toEqual([
      { description: "Used ice machine", proposedValueMinor: 550000, manufacturer: "Acme", modelNumber: "IM-500", notes: "compressor noisy", evidenceReference: "photos-77" },
      { description: "Reach-in cooler", proposedValueMinor: 80000 },
    ]);
    expect(JSON.stringify(onPropose.mock.calls[0][0])).not.toMatch(/credit|approv/i);
  });

  it("an approver assigns the value; a decline needs a reason", async () => {
    const onApprove = vi.fn().mockResolvedValue({ ok: true });
    const onDecline = vi.fn().mockResolvedValue({ ok: true });
    render(<TradeInSection tradeIns={[PROPOSED]} mayApprove onApprove={onApprove} onDecline={onDecline} />);
    expect(screen.getByLabelText("Approved value for item 1").value).toBe("5500.00");
    fireEvent.click(screen.getByRole("button", { name: "Decline trade-in 1" }));
    expect(screen.getByRole("alert").textContent).toMatch(/states its reason/);
    expect(onDecline).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Approved value for item 1"), { target: { value: "5000.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve trade-in 1" }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith({ itemNumber: 1, approvedCreditMinor: 500000 }));
  });

  it("an approved item shows its credit; the input mapper never carries a decision", () => {
    const { container } = render(<TradeInSection tradeIns={[{ ...PROPOSED, approvalStatus: "APPROVED", approvedCreditMinor: 500000 }]} />);
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(container.querySelector("tbody tr td:last-child").textContent).toMatch(/^5000\.00$/);
    expect(toTradeInInput({ ...PROPOSED, approvalStatus: "APPROVED", approvedCreditMinor: 500000 })).not.toHaveProperty("approvedCreditMinor");
  });
});
