// DECISIONS #203 (Controller 2026-10-02): the Administration finance configuration section. It decides nothing: every read and
// change goes to /admin/policy with a stated reason, and a refusal is rendered as the server's answer.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FinanceConfiguration from "../src/modules/administration/FinanceConfiguration.jsx";

const DESTINATIONS = [
  { id: "dst-new", operatingCompanyId: "taylor", displayName: "Taylor ledger", providerKey: null, externalCompanyRef: null, status: "ACTIVE" },
  { id: "dst-old", operatingCompanyId: "taylor", displayName: "Old ledger", providerKey: null, externalCompanyRef: null, status: "INACTIVE" },
];
const TERMS = [{ operatingCompanyId: "taylor", status: "ACTIVE", paymentTerms: "Net 90", paymentTermsNetDays: 90,
  counterparty: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "ventana" } }];
const ZONES = [{ operatingCompanyId: "taylor", status: "ACTIVE", businessTimeZone: "America/Phoenix" }];
const api = () => vi.fn(async (op) => {
  if (op === "listAccountingDestinations") return { ok: true, data: { items: DESTINATIONS } };
  if (op === "listCounterpartyPaymentTerms") return { ok: true, data: { items: TERMS } };
  if (op === "listOperatingCompanyBusinessTimeZones") return { ok: true, data: { items: ZONES } };
  return { ok: true, data: {} };
});

describe("FinanceConfiguration (Administration)", () => {
  it("shows destinations with history, payment terms and time zones, and activates with a reason", async () => {
    const callApi = api();
    render(<FinanceConfiguration callApi={callApi} />);
    await screen.findByText("Taylor ledger");
    expect(screen.getByText("Old ledger")).toBeTruthy();
    expect(screen.getByText("Net 90 days")).toBeTruthy();
    expect(screen.getByText("America/Phoenix")).toBeTruthy();
    const activate = screen.getByRole("button", { name: "Activate Old ledger" });
    expect(activate.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "ledger move" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate Old ledger" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("setAccountingDestinationStatus", { destinationId: "dst-old", status: "ACTIVE", reason: "ledger move" }));
  });

  it("sends payment terms as a governed counterparty and whole net days", async () => {
    const callApi = api();
    render(<FinanceConfiguration callApi={callApi} />);
    await screen.findByText("Taylor ledger");
    fireEvent.change(screen.getByLabelText("Operating company id (who is owed)"), { target: { value: "taylor" } });
    fireEvent.change(screen.getByLabelText("Counterparty company id"), { target: { value: "ventana" } });
    fireEvent.change(screen.getByLabelText("Net days"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Reason for the change"), { target: { value: "intercompany terms" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payment terms" }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("setCounterpartyPaymentTerms", { operatingCompanyId: "taylor",
      counterparty: { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: "ventana" }, paymentTermsNetDays: 90, reason: "intercompany terms" }));
  });

  it("renders the server's refusal instead of the configuration", async () => {
    const callApi = vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "nope" }));
    render(<FinanceConfiguration callApi={callApi} />);
    await screen.findByText(/finance.configuration.manage/);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
