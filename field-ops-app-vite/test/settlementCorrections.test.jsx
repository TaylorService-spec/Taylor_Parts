// SETTLEMENT CORRECTIONS (Owner direction 2026-10-14): the screen decides nothing. Reverse / Void are the existing governed
// operations; each is offered only where the server says `correct` is held for the settlement's company, states its financial
// consequence, requires a reason, and refreshes the workspace after any successful answer (a replay too). Refusals are shown
// in words AND verbatim; a re-sent correction is a replay that changes nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
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
/** A server stand-in: listSettlements answers `list(input)` (re-read each call); commands answer `commands[op]`. */
const server = ({ list = () => [settlement()], commands = {} } = {}) => vi.fn(async (op, input) => {
  if (op === "listSettlements") return { ok: true, result: { scope: input.operatingCompanyId, items: list(input) } };
  return commands[op] ? commands[op](input) : { ok: false, code: "UNEXPECTED", message: op };
});
const mount = (callApi, props = {}) => render(<SettlementCorrections callApi={callApi} company="taylor" access={ACCESS()} {...props} />);
const openCorrections = async (ref = "CHK-1") => fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^Correct ${ref} \\(`) }));
const startReverse = () => fireEvent.click(screen.getByRole("button", { name: /^Reverse 330\.00 applied to obl-9$/ }));
const confirmWith = (name, reason, buttonName) => {
  const confirm = screen.getByRole("group", { name });
  fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: reason } });
  fireEvent.click(within(confirm).getByRole("button", { name: buttonName }));
  return confirm;
};
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Settlement corrections", () => {
  it("REVERSE: states the consequence, requires a reason, sends the governed command once, then refreshes the workspace", async () => {
    const onCorrected = vi.fn();
    const api = server({ commands: { reverseSettlementApplication: () => ({ ok: true, result: { outcome: "reversed" } }) } });
    mount(api, { onCorrected });
    await openCorrections();
    startReverse();
    const confirm = screen.getByRole("group", { name: /Confirm: Reverse 330\.00 applied to obl-9/ });
    expect(confirm.textContent).toMatch(/outstanding balance goes back up by 330\.00/);
    expect(confirm.textContent).toMatch(/original application stays in the history/);
    expect(confirm.textContent).toMatch(/money itself is not refunded/);
    const go = within(confirm).getByRole("button", { name: "Reverse Application" });
    expect(go.disabled).toBe(true); // a reason is required
    expect(within(confirm).getByLabelText(/^Reason for/).maxLength).toBe(500); // the server's own limit
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: "  " } });
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByLabelText(/^Reason for/), { target: { value: " wrong receivable " } });
    fireEvent.click(go);
    await screen.findByText("Application reversed.");
    const sent = api.mock.calls.filter(([op]) => op === "reverseSettlementApplication");
    expect(sent).toHaveLength(1);
    expect(sent[0][1]).toEqual({ applicationId: "sap-1", reason: "wrong receivable", idempotencyKey: expect.stringMatching(/^corr-/) });
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });

  it("REVERSE without a workspace re-reads the list: the application shows reversed, with its reason, and the void opens up", async () => {
    let reversed = false;
    const api = server({
      list: () => [settlement(reversed ? { appliedMinor: "0", unappliedMinor: "33000",
        applications: [{ id: "sap-1", obligationId: "obl-9", amountMinor: "33000", status: "REVERSED", reversalReason: "wrong receivable" }] } : {})],
      commands: { reverseSettlementApplication: () => { reversed = true; return { ok: true, result: { outcome: "reversed" } }; } },
    });
    mount(api);
    await openCorrections();
    startReverse();
    confirmWith(/Confirm: Reverse/, "wrong receivable", "Reverse Application");
    await waitFor(() => expect(document.querySelector('[data-application="sap-1"]').textContent).toMatch(/reversed: wrong receivable/));
    expect(screen.queryByRole("button", { name: /^Reverse 330\.00/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Void Settlement" }).disabled).toBe(false);
  });

  it("DUPLICATE: a replay says nothing changed and STILL refreshes the workspace (someone else corrected it)", async () => {
    const onCorrected = vi.fn();
    mount(server({ commands: { reverseSettlementApplication: () => ({ ok: true, result: { outcome: "replayed" } }) } }), { onCorrected });
    await openCorrections();
    startReverse();
    confirmWith(/Confirm: Reverse/, "dup", "Reverse Application");
    await screen.findByText(/already reversed\. Nothing changed\./);
    expect(onCorrected).toHaveBeenCalledTimes(1);
  });

  it("RETRY: after a failed attempt the same confirmation retries with the SAME idempotency key", async () => {
    const keys = [];
    const api = server({ commands: { reverseSettlementApplication: (input) => {
      keys.push(input.idempotencyKey);
      return keys.length === 1 ? { ok: false, code: "UNREACHABLE", message: "Finance could not be reached" } : { ok: true, result: { outcome: "reversed" } };
    } } });
    mount(api);
    await openCorrections();
    startReverse();
    const confirm = confirmWith(/Confirm: Reverse/, "lost answer", "Reverse Application");
    await screen.findByText(/Finance could not be reached/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Reverse Application" }));
    await screen.findByText("Application reversed.");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("VOID: unavailable while an application is live (says why); offered once none is, with its consequence; a VOID row shows no balance", async () => {
    let voided = false;
    const api = server({ list: () => [settlement(), settlement({ id: "stl-2", sourceReference: "CHK-2", appliedMinor: "0", unappliedMinor: "500", amountMinor: "500",
      applications: [], ...(voided ? { status: "VOID", voidReason: "check returned" } : {}) })],
    commands: { voidSettlement: () => { voided = true; return { ok: true, result: { outcome: "voided" } }; } } });
    mount(api);
    await openCorrections("CHK-1");
    const live = screen.getByRole("region", { name: "Corrections for CHK-1" });
    expect(within(live).getByRole("button", { name: "Void Settlement" }).disabled).toBe(true);
    expect(live.textContent).toMatch(/Reverse its application first/);
    fireEvent.click(screen.getByRole("button", { name: /^Close corrections for CHK-1/ }));
    await openCorrections("CHK-2");
    fireEvent.click(within(screen.getByRole("region", { name: "Corrections for CHK-2" })).getByRole("button", { name: "Void Settlement" }));
    const confirm = screen.getByRole("group", { name: /Confirm: Void settlement CHK-2/ });
    expect(confirm.textContent).toMatch(/no longer counts as money received or paid/);
    expect(confirm.textContent).toMatch(/stays in the history/);
    confirmWith(/Confirm: Void settlement CHK-2/, "check returned", "Void Settlement");
    await screen.findByText("Settlement voided.");
    expect(api).toHaveBeenCalledWith("voidSettlement", { settlementId: "stl-2", reason: "check returned" });
    await waitFor(() => expect(document.querySelector('[data-settlement="stl-2"]').textContent).toMatch(/Void — check returned/));
    const cells = [...document.querySelectorAll('[data-settlement="stl-2"] td')].map((td) => td.textContent);
    expect(cells.slice(5, 7)).toEqual(["—", "—"]); // applied / unapplied are not shown for a VOID settlement
  });

  it("SERVER REFUSALS are shown in words and verbatim; the confirmation stays open; nothing refreshes", async () => {
    const cases = [
      ["voidSettlement", { reason: "SETTLEMENT_HAS_APPLICATIONS", code: "CONFLICT", message: "SETTLEMENT_HAS_APPLICATIONS: reverse its applications before voiding the settlement" }, settlement({ applications: [] })],
      ["reverseSettlementApplication", { reason: "CAPABILITY_REQUIRED", code: "FORBIDDEN", message: "this operation requires finance.settlement.correct" }, settlement()],
      // Another company's application answers exactly like a missing one (the server's company rule).
      ["reverseSettlementApplication", { reason: "APPLICATION_NOT_FOUND", code: "NOT_FOUND", message: "no settlement application with that id" }, settlement()],
      ["reverseSettlementApplication", { reason: "FINANCING_FUNDED", code: "CONFLICT", message: "the arrangement is FUNDED; reversing provider funding is a provider-side correction" },
        settlement({ kind: "PROVIDER_FUNDING" })],
    ];
    for (const [op, refusal, row] of cases) {
      cleanup();
      const onCorrected = vi.fn();
      mount(server({ list: () => [row], commands: { [op]: () => ({ ok: false, ...refusal }) } }), { onCorrected });
      await openCorrections();
      if (op === "voidSettlement") {
        fireEvent.click(screen.getByRole("button", { name: "Void Settlement" }));
        confirmWith(/Confirm: Void settlement/, "x", "Void Settlement");
      } else {
        startReverse();
        confirmWith(/Confirm: Reverse/, "x", "Reverse Application");
      }
      const shown = await screen.findByText(new RegExp(escape(CORRECTION_REFUSAL_WORDS[refusal.reason].slice(0, 30))));
      expect(shown.textContent).toContain(refusal.message);
      expect(screen.getByRole("group", { name: /Confirm:/ })).toBeTruthy();
      expect(onCorrected).not.toHaveBeenCalled();
    }
  });

  it("UNAUTHORIZED: without `correct` for the company nothing is offered; a VOID settlement is final", async () => {
    mount(server({ list: () => [settlement(), settlement({ id: "stl-v", sourceReference: "CHK-V", status: "VOID", voidReason: "check returned", applications: [] })] }),
      { access: ACCESS({ taylor: false }) });
    await screen.findByText("CHK-1");
    expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
    expect(screen.getAllByText("Not available to you").length).toBe(2);
    cleanup();
    mount(server({ list: () => [settlement({ id: "stl-v", sourceReference: "CHK-V", status: "VOID", voidReason: "check returned", applications: [] })] }));
    await screen.findByText("Void — final");
    expect(screen.queryByRole("button", { name: /Correct/ })).toBeNull();
  });

  it("CROSS-COMPANY: in the Consolidated view, correction is offered only for the companies the person may correct; names stay unique", async () => {
    mount(server({ list: () => [settlement(), settlement({ id: "stl-v2", operatingCompanyId: "ventana", sourceReference: "CHK-1" })] }),
      { company: "consolidated", access: ACCESS({ taylor: true, ventana: false }) });
    const buttons = await screen.findAllByRole("button", { name: /^Correct CHK-1 \(/ });
    expect(buttons).toHaveLength(1); // the same check number at Ventana is not offered
    expect(document.querySelector('[data-settlement="stl-v2"]').textContent).toMatch(/Not available to you/);
  });

  it("COMPANY SWITCH: a new company starts clean, and a slow answer for the old company is never drawn", async () => {
    let releaseTaylor;
    const api = vi.fn(async (op, input) => {
      if (input.operatingCompanyId === "taylor") await new Promise((r) => { releaseTaylor = r; });
      return { ok: true, result: { items: [settlement({ id: `stl-${input.operatingCompanyId}`, operatingCompanyId: input.operatingCompanyId, sourceReference: `REF-${input.operatingCompanyId}` })] } };
    });
    const { rerender } = render(<SettlementCorrections callApi={api} company="taylor" access={ACCESS()} />);
    rerender(<SettlementCorrections callApi={api} company="ventana" access={ACCESS()} />);
    await screen.findByText("REF-ventana");
    await act(async () => { releaseTaylor(); });
    expect(screen.queryByText("REF-taylor")).toBeNull();
    expect(screen.getByText("REF-ventana")).toBeTruthy();
  });

  it("a refused list read is shown, not drawn as an empty list", async () => {
    mount(vi.fn(async () => ({ ok: false, code: "FORBIDDEN", reason: "OUTSIDE_OPERATING_COMPANY_SCOPE", message: "finance.payment.read is not held for the requested operating company" })));
    await screen.findByText(/does not cover this operating company/);
    expect(screen.queryByText(/No settlements recorded/)).toBeNull();
  });
});

// THE WORKSPACE INTEGRATION: a correction reloads the workspace (balances, unapplied, reconciliation) and, through it, re-reads
// the settlement list exactly once; a reload that returns after a company switch never paints the old company.
import FinancialsWorkspace from "../src/modules/financials/FinancialsWorkspace.jsx";

describe("Settlement corrections inside the Finance workspace", () => {
  const ws = (company) => ({
    scope: { operatingCompanyId: company, projection: "OPERATING_COMPANY", companies: [company] },
    exceptionCounts: { overdueObligations: 0, partiallyPaidObligations: 0, unappliedSettlements: 0, accountingHandoffExceptions: 0, reconciliationMismatches: 0,
      unreconciledSettlements: 0, missingCostEvidence: 0, intercompanyReliefPending: 0 },
    receivables: { count: 0, outstandingByCurrency: {}, items: [] }, fundingReceivables: { count: 0, outstandingByCurrency: {}, items: [] },
    payables: { count: 0, outstandingByCurrency: {}, items: [] }, intercompanyReceivables: { count: 0, outstandingByCurrency: {}, items: [] },
    intercompanyPayables: { count: 0, outstandingByCurrency: {}, items: [] }, overdue: [], partiallyPaid: [], unappliedSettlements: [], accountingHandoffs: [],
    reconciliation: [], missingCostEvidence: [], intercompanyReliefPending: [], marker: `WS-${company}`,
  });
  const accessResult = { ok: true, result: { principalId: "p", consolidated: true, companies: ["taylor", "ventana"].map((c) => ({ operatingCompanyId: c, name: c,
    actions: { view: true, record: true, apply: true, correct: true, reconcile: true } })) } };

  it("a reversal reloads the workspace and re-reads the list once", async () => {
    const api = vi.fn(async (op, input) => {
      if (op === "readMyFinanceCompanyAccess") return accessResult;
      if (op === "readFinanceWorkspace") return { ok: true, result: ws(input.operatingCompanyId) };
      if (op === "listSettlements") return { ok: true, result: { items: [settlement()] } };
      if (op === "reverseSettlementApplication") return { ok: true, result: { outcome: "reversed" } };
      return { ok: false, code: "UNEXPECTED", message: op };
    });
    render(<FinancialsWorkspace callApi={api} />);
    await openCorrections();
    const count = (op) => api.mock.calls.filter(([o]) => o === op).length;
    const [wsBefore, listBefore] = [count("readFinanceWorkspace"), count("listSettlements")];
    startReverse();
    confirmWith(/Confirm: Reverse/, "wrong receivable", "Reverse Application");
    await waitFor(() => expect(count("readFinanceWorkspace")).toBe(wsBefore + 1));
    await waitFor(() => expect(count("listSettlements")).toBe(listBefore + 1));
  });

  it("a workspace reload that returns after a company switch is dropped", async () => {
    let releaseTaylor = null;
    let taylorReads = 0;
    const api = vi.fn(async (op, input) => {
      if (op === "readMyFinanceCompanyAccess") return accessResult;
      if (op === "readFinanceWorkspace") {
        if (input.operatingCompanyId === "taylor" && ++taylorReads === 2) {
          await new Promise((r) => { releaseTaylor = r; });
          // The late Taylor answer carries a row that must never be painted under Ventana.
          return { ok: true, result: { ...ws("taylor"), unappliedSettlements: [{ id: "stl-stale", operatingCompanyId: "taylor", kind: "CUSTOMER_PAYMENT", currency: "USD",
            amountMinor: "100", unappliedMinor: "100", businessDate: "2026-10-14", sourceReference: "STALE-TAYLOR" }] } };
        }
        return { ok: true, result: ws(input.operatingCompanyId) };
      }
      if (op === "listSettlements") return { ok: true, result: { items: [settlement({ operatingCompanyId: input.operatingCompanyId })] } };
      if (op === "reverseSettlementApplication") return { ok: true, result: { outcome: "reversed" } };
      return { ok: false, code: "UNEXPECTED", message: op };
    });
    render(<FinancialsWorkspace callApi={api} />);
    await openCorrections();
    startReverse();
    confirmWith(/Confirm: Reverse/, "x", "Reverse Application");
    await waitFor(() => expect(releaseTaylor).not.toBeNull()); // the post-correction Taylor reload is in flight
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "ventana" } });
    await waitFor(() => expect(api).toHaveBeenCalledWith("readFinanceWorkspace", { operatingCompanyId: "ventana" }));
    await act(async () => { releaseTaylor(); });
    await waitFor(() => expect(screen.getByLabelText("Company").value).toBe("ventana"));
    expect(screen.queryByText("Application reversed.")).toBeNull(); // not announced under Ventana
    expect(screen.queryByText("STALE-TAYLOR")).toBeNull(); // the late Taylor workspace was dropped
    expect(api.mock.calls.filter(([op, i]) => op === "listSettlements" && i.operatingCompanyId === "ventana").length).toBeGreaterThanOrEqual(1);
  });
});
