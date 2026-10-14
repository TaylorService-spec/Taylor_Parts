// SETTLEMENT CORRECTIONS (Owner direction 2026-10-14): the screen decides nothing. Reverse / Void are the existing governed
// operations; each is offered only where the server says `correct` is held for the settlement's company, states its financial
// consequence, requires a reason, and refreshes the list and the workspace after success. Refusals are shown in words AND
// verbatim; a re-sent correction is a replay that changes nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SettlementCorrections, { CORRECTION_REFUSAL_WORDS } from "../src/modules/financials/SettlementCorrections.jsx";

afterEach(cleanup);

const ACCESS = (correct = { taylor: true, ventana: true }) => ({
  companies: Object.entries(correct).map(([c, ok]) => ({ operatingCompanyId: c, actions: { view: true, record: ok, apply: ok, correct: ok, reconcile: ok } })),
});
const settlement = (over = {}) => ({
  id: "stl-1", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", currency: "USD", amountMinor: "33000", appliedMinor: "33000", unappliedMinor: "0",
  businessDate: "2026-10-14", sourceReference: "CHK-1", status: "RECORDED", voidReason: null, reconciliationStatus: "UNRECONCILED",
  applications: [{ id: "sap-1", obligationId: "obl-9", amountMinor: "33000", status: "APPLIED", reversalReason: null }],
  ...over,
});
/** A server stand-in: listSettlements answers `list()` (re-read each call); commands answer `commands[op]`. */
const server = ({ list = () => [settlement()], commands = {} } = {}) => vi.fn(async (op, input) => {
  if (op === "listSettlements") return { ok: true, result: { scope: input.operatingCompanyId, items: list() } };
  return commands[op] ? commands[op](input) : { ok: false, code: "UNEXPECTED", message: op };
});
const mount = (callApi, props = {}) => render(<SettlementCorrections callApi={callApi} company="taylor" access={ACCESS()} {...props} />);

describe("Settlement corrections", () => {
  it("REVERSE: states the consequence, requires a reason, sends the governed command once, then refreshes the list and the workspace", async () => {
    let reversed = false;
    const onCorrected = vi.fn();
    const api = server({
      list: () => [settlement(reversed ? { appliedMinor: "0", unappliedMinor: "33000",
        applications: [{ id: "sap-1", obligationId: "obl-9", amountMinor: "33000", status: "REVERSED", reversalReason: "wrong receivable" }] } : {})],
      commands: { reverseSettlementApplication: () => { reversed = true; return { ok: true, result: { outcome: "reversed" } }; } },
    });
    mount(api, { onCorrected });
    fireEvent.click(await screen.findByRole("button", { name: "Correct CHK-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Reverse 330\.00/ }));
    const confirm = screen.getByRole("group", { name: /Confirm: Reverse 330\.00 applied to obl-9/ });
    expect(confirm.textContent).toMatch(/outstanding balance goes back up by 330\.00/);
    expect(confirm.textContent).toMatch(/original application stays in the history/);
    const go = within(confirm).getByRole("button", { name: "Reverse Application" });
    expect(go.disabled).toBe(true); // a reason is required
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: "  " } });
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: " wrong receivable " } });
    fireEvent.click(go);
    await screen.findByText("Application reversed.");
    const sent = api.mock.calls.filter(([op]) => op === "reverseSettlementApplication");
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual({ applicationId: "sap-1", reason: "wrong receivable", idempotencyKey: expect.stringMatching(/^corr-/) });
    expect(onCorrected).toHaveBeenCalledTimes(1);
    // The list was re-read: the application now shows as reversed, with its reason, and the void is now available.
    await waitFor(() => expect(document.querySelector('[data-application="sap-1"]').textContent).toMatch(/reversed: wrong receivable/));
    expect(screen.queryByRole("button", { name: /Reverse 330\.00/ })).toBeNull(); // nothing left to reverse
    expect(screen.getByRole("button", { name: "Void Settlement" }).disabled).toBe(false); // and the void is now possible
    expect(api.mock.calls.filter(([op]) => op === "listSettlements").length).toBeGreaterThanOrEqual(2);
  });

  it("DUPLICATE: a re-sent reverse keeps its idempotency key; a replay says nothing changed and does not refresh the workspace", async () => {
    const onCorrected = vi.fn();
    const keys = [];
    const api = server({ commands: { reverseSettlementApplication: (input) => { keys.push(input.idempotencyKey); return { ok: true, result: { outcome: "replayed" } }; } } });
    mount(api, { onCorrected });
    fireEvent.click(await screen.findByRole("button", { name: "Correct CHK-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Reverse 330\.00/ }));
    const confirm = screen.getByRole("group", { name: /Confirm: Reverse/ });
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: "dup" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Reverse Application" }));
    await screen.findByText(/already reversed\. Nothing changed\./);
    expect(onCorrected).not.toHaveBeenCalled();
    expect(new Set(keys).size).toBe(1);
  });

  it("VOID: unavailable while an application is live (says why); offered once none is, with its consequence", async () => {
    const api = server({ list: () => [settlement(), settlement({ id: "stl-2", sourceReference: "CHK-2", appliedMinor: "0", unappliedMinor: "500", amountMinor: "500", applications: [] })],
      commands: { voidSettlement: () => ({ ok: true, result: { outcome: "voided" } }) } });
    mount(api);
    fireEvent.click(await screen.findByRole("button", { name: "Correct CHK-1" }));
    const live = screen.getByRole("region", { name: "Corrections for CHK-1" });
    expect(within(live).getByRole("button", { name: "Void Settlement" }).disabled).toBe(true);
    expect(live.textContent).toMatch(/Reverse its application first/);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct CHK-2" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Corrections for CHK-2" })).getByRole("button", { name: "Void Settlement" }));
    const confirm = screen.getByRole("group", { name: /Confirm: Void settlement CHK-2/ });
    expect(confirm.textContent).toMatch(/no longer counts as money received or paid/);
    expect(confirm.textContent).toMatch(/stays in the history/);
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: "check returned" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Void Settlement" }));
    await screen.findByText("Settlement voided.");
    expect(api).toHaveBeenCalledWith("voidSettlement", { settlementId: "stl-2", reason: "check returned" });
  });

  it("SERVER FAILURE: the refusal is shown in words and verbatim; the confirmation stays open; nothing refreshes", async () => {
    const onCorrected = vi.fn();
    const api = server({ list: () => [settlement({ applications: [] })], commands: { voidSettlement: () => ({ ok: false, code: "CONFLICT", reason: "SETTLEMENT_HAS_APPLICATIONS",
      message: "SETTLEMENT_HAS_APPLICATIONS: reverse its applications before voiding the settlement" }) } });
    mount(api, { onCorrected });
    fireEvent.click(await screen.findByRole("button", { name: "Correct CHK-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Void Settlement" }));
    const confirm = screen.getByRole("group", { name: /Confirm: Void settlement/ });
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: "x" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "Void Settlement" }));
    await screen.findByText(new RegExp(CORRECTION_REFUSAL_WORDS.SETTLEMENT_HAS_APPLICATIONS.slice(0, 40)));
    expect(screen.getByText(/reverse its applications before voiding the settlement/)).toBeTruthy();
    expect(screen.getByRole("group", { name: /Confirm: Void settlement/ })).toBeTruthy();
    expect(onCorrected).not.toHaveBeenCalled();
  });

  it("UNAUTHORIZED: without `correct` for the company nothing is offered; a VOID settlement is final", async () => {
    const api = server({ list: () => [settlement(), settlement({ id: "stl-v", sourceReference: "CHK-V", status: "VOID", voidReason: "check returned", applications: [] })] });
    mount(api, { access: ACCESS({ taylor: false }) });
    await screen.findByText("CHK-1");
    expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
    expect(screen.getAllByText("Not available to you").length).toBe(2);
    cleanup();
    mount(server({ list: () => [settlement({ id: "stl-v", sourceReference: "CHK-V", status: "VOID", voidReason: "check returned", applications: [] })] }));
    await screen.findByText("Void — final");
    expect(screen.getByRole("table").textContent).toMatch(/Void — check returned/);
    expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
  });

  it("CROSS-COMPANY: in the Consolidated view, correction is offered only for the companies the person may correct", async () => {
    const api = server({ list: () => [settlement(), settlement({ id: "stl-v2", operatingCompanyId: "ventana", sourceReference: "CHK-VEN" })] });
    mount(api, { company: "consolidated", access: ACCESS({ taylor: true, ventana: false }) });
    await screen.findByRole("button", { name: "Correct CHK-1" });
    expect(screen.queryByRole("button", { name: "Correct CHK-VEN" })).toBeNull();
    const ventanaRow = document.querySelector('[data-settlement="stl-v2"]');
    expect(ventanaRow.textContent).toMatch(/Not available to you/);
  });

  it("a refused list read is shown, not drawn as an empty list", async () => {
    mount(vi.fn(async () => ({ ok: false, code: "FORBIDDEN", reason: "OUTSIDE_OPERATING_COMPANY_SCOPE", message: "finance.payment.read is not held for the requested operating company" })));
    await screen.findByText(/does not cover this operating company/);
    expect(screen.queryByText(/No settlements recorded/)).toBeNull();
  });
});
