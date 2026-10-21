// SET OPERATING COMPANY (CLC; DECISIONS #CLC): the record page offers it ONLY when the server's own read says so, and decides nothing.
//
//   * no offer from the server -> nothing is rendered (the record has a company, or the caller may not assign, or reaches no company);
//   * the control says the change happens once BEFORE it asks; the reason is REQUIRED; the companies are exactly the ones the server listed;
//   * the attempt states the family, the record, the chosen company, the reason and a key; a failed attempt's retry reuses its key, a new attempt does not;
//   * a refusal is shown in plain words (the server's own words as the fallback) and the control stays open; success closes it and tells the page to re-read;
//   * the server's offer survives the adapters and the view models untouched (and is absent when not offered).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import SetOperatingCompany from "../src/modules/sales/SetOperatingCompany.jsx";
import { toOpportunityContextResult, toSalesAgreementReadResult } from "../src/services/commercialEosAdapters.js";
import { opportunityView } from "../src/domain/opportunityView.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";
import { assignRecordOperatingCompany } from "../src/services/opportunityCommandClient.js";
import { COMMERCIAL_MUTATION_OPERATIONS } from "../src/services/commercialApiClient.js";

afterEach(cleanup);

const offer = { companies: [{ operatingCompanyId: "taylor" }, { operatingCompanyId: "ventana" }] };
const open = () => fireEvent.click(screen.getByRole("button", { name: /Set operating company/ }));
const why = (text) => fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: text } });

describe("SetOperatingCompany", () => {
  it("renders nothing when the server made no offer", () => {
    for (const assignment of [undefined, null, {}, { companies: [] }]) {
      const { container } = render(<SetOperatingCompany family="OPPORTUNITY" recordId="opp-1" assignment={assignment} />);
      expect(container.textContent).toBe("");
      cleanup();
    }
  });

  it("says it is set once, before it asks; offers exactly the listed companies; the reason is required", () => {
    render(<SetOperatingCompany family="OPPORTUNITY" recordId="opp-1" assignment={offer} assign={vi.fn()} />);
    expect(screen.getByText(/visible only to its owner, its creator and the administrators/)).toBeTruthy();
    open();
    expect(screen.getByText(/You can set this once\. It cannot be changed or cleared afterwards\./)).toBeTruthy();
    expect([...screen.getByLabelText("Operating company").querySelectorAll("option")].map((o) => o.value)).toEqual(["taylor", "ventana"]);
    const save = screen.getByRole("button", { name: "Set operating company" });
    expect(save.disabled).toBe(true); // no reason yet
    why("   ");
    expect(save.disabled).toBe(true);
    why("Entered without a company by mistake.");
    expect(save.disabled).toBe(false);
  });

  it("an Agreement is worded as one", () => {
    render(<SetOperatingCompany family="SALES_AGREEMENT" recordId="sag-1" assignment={{ companies: [{ operatingCompanyId: "taylor" }] }} />);
    expect(screen.getByText(/this sales agreement is visible only to/)).toBeTruthy();
  });

  it("states the family, the record, the chosen company, the trimmed reason and a key; success closes the control and asks the page to re-read", async () => {
    const assign = vi.fn(async () => ({ result: { operatingCompanyId: "ventana" } }));
    const onApplied = vi.fn();
    render(<SetOperatingCompany family="SALES_AGREEMENT" recordId="sag-1" assignment={offer} assign={assign} onApplied={onApplied} />);
    open();
    fireEvent.change(screen.getByLabelText("Operating company"), { target: { value: "ventana" } });
    why("  Belongs to Ventana.  ");
    fireEvent.click(screen.getByRole("button", { name: "Set operating company" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toMatchObject({ family: "SALES_AGREEMENT", recordId: "sag-1", operatingCompanyId: "ventana", reason: "Belongs to Ventana." });
    expect(typeof assign.mock.calls[0][0].idempotencyKey).toBe("string");
    expect(screen.queryByLabelText(/Reason/)).toBeNull(); // closed
  });

  it("a refusal is shown in plain words, nothing closes, and a retry of the SAME attempt reuses its key while a changed one does not", async () => {
    const assign = vi.fn()
      .mockResolvedValueOnce({ errorStatus: "failed-precondition", errorDetail: "LINEAGE_DISAGREEMENT", message: "server words" })
      .mockResolvedValueOnce({ errorStatus: "invalid-argument", errorDetail: "SOMETHING_NEW", message: "The server's own words." })
      .mockResolvedValue({ result: {} });
    const onApplied = vi.fn();
    render(<SetOperatingCompany family="OPPORTUNITY" recordId="opp-1" assignment={offer} assign={assign} onApplied={onApplied} />);
    open();
    why("A reason.");
    const save = () => fireEvent.click(screen.getByRole("button", { name: "Set operating company" }));
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Set it on the Opportunity first/));
    expect(onApplied).not.toHaveBeenCalled();
    save(); // the same attempt again
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The server's own words."));
    expect(assign.mock.calls[1][0].idempotencyKey).toBe(assign.mock.calls[0][0].idempotencyKey);
    why("A different reason."); // a new intent
    save();
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[2][0].idempotencyKey).not.toBe(assign.mock.calls[0][0].idempotencyKey);
  });

  it("Cancel closes without calling the server", () => {
    const assign = vi.fn();
    render(<SetOperatingCompany family="OPPORTUNITY" recordId="opp-1" assignment={offer} assign={assign} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("the server's offer travels untouched", () => {
  const detail = { id: "opp-1", stage: "QUALIFYING", salesChannel: "RETAIL", owner: { employeeId: "e-1" }, editVersion: 3 };
  it("Opportunity: adapter and view carry operatingCompanyAssignment when present, and omit the key when absent", () => {
    const withOffer = opportunityView({ result: toOpportunityContextResult({ ...detail, operatingCompanyAssignment: offer }) });
    expect(withOffer.operatingCompanyAssignment).toEqual(offer);
    const without = opportunityView({ result: toOpportunityContextResult(detail) });
    expect("operatingCompanyAssignment" in without).toBe(false);
  });
  it("Sales Agreement: adapter and view carry operatingCompanyAssignment when present, and omit the key when absent", () => {
    const base = { id: "sag-1", state: "DRAFT", totals: {}, lines: [] };
    const withOffer = salesAgreementView({ result: toSalesAgreementReadResult({ ...base, operatingCompanyAssignment: offer }) });
    expect(withOffer.operatingCompanyAssignment).toEqual(offer);
    const without = salesAgreementView({ result: toSalesAgreementReadResult(base) });
    expect("operatingCompanyAssignment" in without).toBe(false);
  });
});

describe("the command client", () => {
  it("is a served mutation, sends exactly the five fields, and returns the server's code and words on a refusal", async () => {
    expect(COMMERCIAL_MUTATION_OPERATIONS).toContain("assignRecordOperatingCompany");
    const call = vi.fn(async () => ({ ok: false, code: "PRECONDITION_FAILED", reason: "OPERATING_COMPANY_ALREADY_SET", message: "already set" }));
    const answer = await assignRecordOperatingCompany({ family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", reason: "r", idempotencyKey: "k" }, { client: { call } });
    expect(call).toHaveBeenCalledWith("assignRecordOperatingCompany", { input: { family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", reason: "r", idempotencyKey: "k" } });
    expect(answer).toEqual({ errorStatus: "failed-precondition", errorDetail: "OPERATING_COMPANY_ALREADY_SET", message: "already set" });
    const ok = await assignRecordOperatingCompany({ family: "OPPORTUNITY", recordId: "opp-1", operatingCompanyId: "taylor", reason: "r", idempotencyKey: "k" },
      { client: { call: async () => ({ ok: true, result: { recordId: "opp-1" } }) } });
    expect(ok).toEqual({ result: { recordId: "opp-1" } });
  });
});
