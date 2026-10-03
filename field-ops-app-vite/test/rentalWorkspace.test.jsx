// Rental (#207): the Rental workspace decides nothing -- the server's fleet, agreements and refusals; ownership is shown as the
// owner's, custody as the customer's, and a charge's tax is never assumed.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RentalWorkspace from "../src/modules/rental/RentalWorkspace.jsx";

const unit = (over) => ({ id: "rfu-1", partId: "P", serialNumber: "RU-1", displayName: "Rental RU-1", ownerOperatingCompanyKey: "taylor", availability: "AVAILABLE",
  currentAssignmentId: null, agreement: null, location: { type: "WAREHOUSE", id: "taylor-main", label: "Taylor Main" }, custodian: { kind: "OWNER", operatingCompanyKey: "taylor" }, ...over });
const WS = {
  counts: { AVAILABLE: 1, RESERVED: 0, ON_RENT: 1, SERVICE_HOLD: 0, RETURN_PENDING: 0, INSPECTION: 0, UNAVAILABLE: 0, fleet: 2, goingOut: 0, dueBack: 1, billingExceptions: 1 },
  utilization: { unitsOut: 1, fleet: 2 },
  available: [unit()], reserved: [], goingOut: [], serviceHold: [], returnPending: [], inspection: [], unavailable: [],
  onRent: [unit({ id: "rfu-2", serialNumber: "RU-2", displayName: "Rental RU-2", availability: "ON_RENT", agreement: { id: "rag-1", number: "RA-2026-000001" },
    location: { type: "EQUIPMENT", id: "eq-1", label: "Downtown" }, custodian: { kind: "CUSTOMER", accountId: "acct-r", name: "Harbor Grill", siteId: "loc-r1", siteName: "Downtown" } })],
  dueBack: [{ agreementId: "rag-1", number: "RA-2026-000001", expectedEndDate: "2026-10-08", businessDate: "2026-10-03", daysUntilDue: 5, overdue: false, unitsOut: 1 }],
  billingExceptions: [{ kind: "DEPLOYED_WITHOUT_CURRENT_CHARGE", agreementId: "rag-1", number: "RA-2026-000001", chargedThrough: "2026-09-20", businessDate: "2026-10-03" }],
};
const AGREEMENT = { id: "rag-1", number: "RA-2026-000001", status: "ACTIVE", operatingCompanyKey: "taylor", customer: { accountId: "acct-r", name: "Harbor Grill" },
  site: { id: "loc-r1", name: "Downtown" }, startDate: "2026-09-01", currency: "USD", disposition: "RENTAL", ownershipTransfers: false,
  currentTerms: { version: 1 }, termsHistory: [{ version: 1, changeKind: "ORIGINAL", rateMinor: "70000", billingFrequency: "WEEK", expectedEndDate: "2026-10-08", deliveryChargeMinor: null, reason: "original agreed terms" }],
  assignments: [], charges: [], workOrders: [] };
const api = (over = {}) => vi.fn(async (op) => over[op] ?? (op === "readRentalWorkspace" ? { ok: true, result: WS }
  : op === "listRentalAgreements" ? { ok: true, result: { items: [] } } : op === "readRentalAgreement" ? { ok: true, result: AGREEMENT } : { ok: true, result: {} }));

describe("RentalWorkspace", () => {
  it("answers where each unit is and who holds it; due back and billing exceptions first", async () => {
    const { container } = render(<RentalWorkspace callApi={api()} />);
    await screen.findByText("Harbor Grill (customer)");
    expect(container.textContent).toMatch(/taylor \(owner\)/);
    expect(container.textContent).toMatch(/Due in 5 day\(s\)/);
    expect(container.textContent).toMatch(/charged only through 2026-09-20/);
    expect(container.textContent).not.toMatch(/\bON_RENT\b/);
  });

  it("records a charge only with stated tax evidence, in integer minor units", async () => {
    const callApi = api();
    render(<RentalWorkspace callApi={callApi} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "RA-2026-000001" }))[0]);
    await screen.findByText(/ownership never transfers/);
    fireEvent.change(screen.getByLabelText("Period start"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Period end (exclusive)"), { target: { value: "2026-09-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Record charge" }));
    await screen.findByText(/tax is never assumed/);
    fireEvent.change(screen.getByLabelText("Tax"), { target: { value: "56.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record charge" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("recordRentalCharge", expect.objectContaining({ agreementId: "rag-1", kind: "PERIOD",
      periodStart: "2026-09-01", periodEnd: "2026-09-08", taxEvidence: { status: "DETERMINED", amountMinor: 5600 } })));
  });

  it("renders the server's refusal", async () => {
    render(<RentalWorkspace callApi={vi.fn(async () => ({ ok: false, code: "FORBIDDEN" }))} />);
    await screen.findByText(/rental.agreement.read/);
  });
});
