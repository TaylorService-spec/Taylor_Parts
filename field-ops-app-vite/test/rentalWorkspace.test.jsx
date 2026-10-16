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
// P0 rental security (D6): the create form's companies are the caller's EOS Core company authority, never a fixed list.
const TAYLOR_ONLY = { ok: true, result: { companies: [{ operatingCompanyId: "taylor", operatingCompanyKey: "taylor" }], gap: null } };
const ws = (res = TAYLOR_ONLY) => vi.fn(async () => res);

describe("RentalWorkspace", () => {
  it("answers where each unit is and who holds it; due back and billing exceptions first", async () => {
    const { container } = render(<RentalWorkspace callApi={api()} callWorkspace={ws()} />);
    await screen.findByText("Harbor Grill (customer)");
    expect(container.textContent).toMatch(/Taylor \(owner\)/);
    expect(container.textContent).toMatch(/Due in 5 day\(s\)/);
    expect(container.textContent).toMatch(/charged only through 2026-09-20/);
    expect(container.textContent).not.toMatch(/\bON_RENT\b/);
  });

  it("records a charge only with stated tax evidence, in integer minor units", async () => {
    const callApi = api();
    render(<RentalWorkspace callApi={callApi} callWorkspace={ws()} />);
    fireEvent.click((await screen.findAllByRole("button", { name: "RA-2026-000001" }))[0]);
    await screen.findByText(/ownership never transfers/);
    fireEvent.change(screen.getByLabelText("Period Start"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("Period End (Exclusive)"), { target: { value: "2026-09-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Charge" }));
    await screen.findByText(/tax is never assumed/);
    fireEvent.change(screen.getByLabelText("Tax"), { target: { value: "56.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Charge" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("recordRentalCharge", expect.objectContaining({ agreementId: "rag-1", kind: "PERIOD",
      periodStart: "2026-09-01", periodEnd: "2026-09-08", taxEvidence: { status: "DETERMINED", amountMinor: 5600 } })));
  });

  it("offers only the caller's authorized companies for a new agreement (D6)", async () => {
    const callApi = api();
    const callWorkspace = ws();
    render(<RentalWorkspace callApi={callApi} callWorkspace={callWorkspace} />);
    await waitFor(() => expect(callWorkspace).toHaveBeenCalledWith("readMyCompanyAuthority", {}));
    const select = await screen.findByLabelText("Operating Company");
    await waitFor(() => expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual(["taylor"]));
    expect(select.textContent).not.toMatch(/Ventana/);
  });

  it("without company authority there is no company to pick and no create (fails closed)", async () => {
    render(<RentalWorkspace callApi={api()} callWorkspace={ws({ ok: true, result: { companies: [], gap: "EMPLOYEE_LINK_REQUIRED" } })} />);
    await screen.findByText(/no operating-company authority/);
    expect(screen.getByRole("button", { name: "Create Rental Agreement" }).disabled).toBe(true);
  });

  it("shows receivables only with Finance access; withheld fields render as Finance only (D8)", async () => {
    const charged = { ...AGREEMENT, charges: [{ id: "rch-1", kind: "PERIOD", termsVersion: 1, periodStart: "2026-09-01", periodEnd: "2026-09-08", periodCount: 1,
      unitAmountMinor: "70000", amountMinor: "70000", currency: "USD", taxEvidence: { status: "DETERMINED", amountMinor: "5600" }, billingPackage: null }] };
    const open = async (agreement) => {
      const { container, unmount } = render(<RentalWorkspace callApi={api({ readRentalAgreement: { ok: true, result: agreement } })} callWorkspace={ws()} />);
      fireEvent.click((await screen.findAllByRole("button", { name: "RA-2026-000001" }))[0]);
      await screen.findByText(/ownership never transfers/);
      const text = container.textContent;
      unmount();
      return text;
    };
    const withheld = await open({ ...charged, financeWithheld: true });
    expect(withheld).toMatch(/Finance only/);
    expect(withheld).not.toMatch(/outstanding/);
    const visible = await open({ ...charged, financeWithheld: false, charges: [{ ...charged.charges[0], receivable: { obligationId: "ob-1", status: "OPEN", outstandingMinor: "75600" } }] });
    expect(visible).toMatch(/outstanding/);
    expect(visible).not.toMatch(/Finance only/);
  });

  it("renders the server's refusal", async () => {
    render(<RentalWorkspace callApi={vi.fn(async () => ({ ok: false, code: "FORBIDDEN" }))} callWorkspace={ws()} />);
    await screen.findByText(/Rental Agreement read access/);
  });
});
