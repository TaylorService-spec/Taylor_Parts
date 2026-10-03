// CUSTOMER-FACING PRICING COMPOSITION (Controller, 2026-10-02; DECISIONS #203).
// The Agreement presents: Selling price, Customer discount, Net selling price, Trade-in credit, Cash / down payment,
// Remaining balance -- in words, no internal enums, no acquisition cost or margin. The salesperson enters the discount as a
// percent or a fixed amount; the governed input is sent only when it changed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import SalesAgreementPanel from "../src/modules/sales/SalesAgreementPanel.jsx";
import SalesAgreementDetail from "../src/modules/sales/SalesAgreementDetail.jsx";
import { useSalesAgreementById } from "../src/hooks/useSalesAgreementById.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";

vi.mock("../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ loading: false, error: null, byEmployeeId: new Map(), byUserId: new Map() }),
}));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({ names: new Map([["acct_1", "Harbor Grill"]]), status: "READY" }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const view = (over = {}) => salesAgreementView({
  loading: false, errorStatus: null,
  result: { status: "ready", salesAgreement: {
    id: "sag_1", salesAgreementNumber: "SA-2026-000077", state: "DRAFT", accountId: "acct_1", ownerEmployeeId: "emp_1", locationId: null, currency: "USD",
    customerPO: null, isLease: false, fulfillmentIntent: null, shippingInstructions: null, shipVia: null, specialInstructions: null,
    lines: [{ lineId: "l1", kind: "EQUIPMENT_MODEL", ref: "ICE-MACHINE-X", quantity: 1, unitPriceMinor: 4000000, extendedMinor: 4000000 }],
    subtotalMinor: 4000000, customerDiscount: { kind: "FIXED_AMOUNT", amountMinor: 200000 }, customerDiscountMinor: 200000, netSellingMinor: 3800000,
    shippingMinor: 0, installChargeMinor: 0, taxMinor: 0, taxEvidenceStatus: "DETERMINED", taxEvidenceAmountMinor: 0, totalMinor: 3800000,
    downPaymentMinor: 300000, tradeInMinor: 500000, balanceMinor: 3000000,
    tradeIns: [{ itemNumber: 1, description: "Used ice machine", serialNumber: "SN-OLD-1", modelNumber: "IM-500", proposedValueMinor: 550000,
      approvalStatus: "APPROVED", approvedCreditMinor: 500000 }],
    sourceOpportunityId: "opp_1", salesOrderId: null, acceptedAtMillis: null, acceptedByUid: null, ...over } },
});
const FORBIDDEN = [/FIXED_AMOUNT/, /\bPERCENT\b/, /acquisition/i, /margin/i, /\bcost\b/i];

beforeEach(() => { vi.clearAllMocks(); });

describe("customer-facing composition", () => {
  it("presents selling price, discount, net selling price, trade-in credit, cash / down payment and remaining balance", () => {
    useSalesAgreementById.mockReturnValue({ view: view(), absence: null, readMode: "BY_ID", STATE: {}, updateDraft: vi.fn(), accept: vi.fn(),
      pending: null, commandError: null, clearCommandError: vi.fn(), refresh: vi.fn() });
    const { container } = render(<MemoryRouter initialEntries={["/a/sag_1"]}><Routes><Route path="/a/:salesAgreementId" element={<SalesAgreementDetail hasCapability={() => true} />} /></Routes></MemoryRouter>);
    const text = container.querySelector(".ns-ladder").textContent;
    for (const [label, amount] of [["Selling price", "40,000.00"], ["Customer discount", "2,000.00"], ["Net selling price", "38,000.00"],
      ["Trade-in credit", "5,000.00"], ["Cash / down payment", "3,000.00"], ["Remaining balance", "30,000.00"]]) {
      expect(text).toContain(label);
      expect(text).toContain(amount);
    }
    expect(text.indexOf("Trade-in credit")).toBeLessThan(text.indexOf("Cash / down payment"));
    for (const re of FORBIDDEN) expect(container.textContent).not.toMatch(re);
  });

  it("the salesperson enters a percent discount (5.25% -> 525 basis points); unchanged sends nothing", async () => {
    const updateDraft = vi.fn().mockResolvedValue({ ok: true });
    const agreement = { view: view({ customerDiscount: null, customerDiscountMinor: 0, netSellingMinor: 4000000, totalMinor: 4000000, balanceMinor: 3200000 }),
      create: vi.fn(), updateDraft, accept: vi.fn(), pending: null, commandError: null };
    const { container } = render(<MemoryRouter><SalesAgreementPanel agreement={agreement} hasCapability={() => true} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Edit terms" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Customer discount" }), { target: { value: "PERCENT" } });
    fireEvent.change(screen.getByLabelText("Discount percent"), { target: { value: "5.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect(updateDraft.mock.calls[0][1].customerDiscount).toEqual({ kind: "PERCENT", percentBasisPoints: 525 });
    expect(container.textContent).not.toMatch(/\bPERCENT\b/);
  });

  it("a fixed amount; malformed input refused locally; an unchanged discount sends nothing", async () => {
    const updateDraft = vi.fn().mockResolvedValue({ ok: true });
    render(<MemoryRouter><SalesAgreementPanel agreement={{ view: view(), create: vi.fn(), updateDraft, accept: vi.fn(), pending: null, commandError: null }} hasCapability={() => true} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Edit terms" }));
    expect(screen.getByLabelText("Discount amount").value).toBe("2000.00");
    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
    await vi.waitFor(() => expect(updateDraft).toHaveBeenCalledTimes(1));
    expect("customerDiscount" in updateDraft.mock.calls[0][1]).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: "Edit terms" }));
    fireEvent.change(screen.getByLabelText("Discount amount"), { target: { value: "20.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));
    expect(screen.getByRole("alert").textContent).toMatch(/must look like 20.00/);
  });
});
