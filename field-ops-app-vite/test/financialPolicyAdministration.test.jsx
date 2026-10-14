// FINANCIAL POLICY ADMINISTRATION (DECISIONS #232 Phase 2) -- the page decides nothing.
//
// The server stands in as vi.fn over the /operations/finance contract (readMyFinancialPolicyAuthority, readFinancialPolicy,
// listFinancialPolicyVersions and the five commands). What is proved: the companies are the authority read's; every
// action's availability and reason are the server's `yourActions`; each command is sent with the right input; a refusal
// is shown in words AND verbatim; Finance Configuration still renders; Financials shows the server's state; and a
// prohibited direct grant is never drawn as effective authority in the grant matrix.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AdminFinancialPolicy from "../src/modules/administration/AdminFinancialPolicy.jsx";
import FinancialsGovernance from "../src/modules/financials/FinancialsGovernance.jsx";
import { ObjectActionMatrix } from "../src/modules/administration/ObjectActionSecurity.jsx";
import { matrixActionRows } from "../src/modules/administration/controlPlaneModel.js";
import { FINANCE_COMMAND_OPERATIONS, FINANCE_READ_OPERATIONS } from "../src/services/financeApiClient.js";
import { draftProblems, describeFailure } from "../src/domain/financialPolicyAdministration.js";

afterEach(cleanup);

const ME = "prn-preparer";
const OWNER = "prn-owner";
const yes = { allowed: true, reason: null };
const no = (reason) => ({ allowed: false, reason });
const SUPPORTED = {
  inventoryCostMethods: ["WEIGHTED_AVERAGE", "FIFO"], serializedCostMethods: ["SPECIFIC_IDENTIFICATION", "WEIGHTED_AVERAGE", "FIFO"],
  cogsRecognitionPoints: [
    { id: "SALES_ORDER_FULFILLMENT", label: "Sales order fulfillment", available: true, blockedReason: null },
    { id: "INVOICE_ISSUE", label: "Invoice issue", available: true, blockedReason: null },
    { id: "WORK_ORDER_CONSUMPTION", label: "Work order part consumption", available: false, blockedReason: "physical consumption is not active" },
  ],
  freightTreatments: ["EXCLUDED"], landedCostTreatments: ["EXCLUDED"],
};
const WA = { inventoryCostMethod: "WEIGHTED_AVERAGE", serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION", cogsRecognitionPointId: "SALES_ORDER_FULFILLMENT",
  freightTreatment: "EXCLUDED", landedCostTreatment: "EXCLUDED" };
const version = (over = {}) => ({
  id: "fpv-1", operatingCompanyId: "taylor", versionNumber: 1, status: "DRAFT", locked: false, policy: WA,
  preparedBy: ME, preparedAt: "2026-10-13T15:00:00.000Z", contentAuthors: [ME], lastEditedBy: ME, lastEditedAt: "2026-10-13T15:00:00.000Z",
  submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null, decisionReason: null,
  activatedBy: null, activatedAt: null, effectiveDate: null, supersededByVersionId: null, supersededAt: null,
  yourActions: { edit: yes, submit: yes, approve: no("CAPABILITY_REQUIRED"), reject: no("CAPABILITY_REQUIRED"), activate: no("CAPABILITY_REQUIRED") },
  ...over,
});
const readOf = (over = {}) => ({
  operatingCompanyId: "taylor", asOf: "2026-10-13", state: "NOT_CONFIGURED", inForce: null, scheduled: null, inFlight: null, supported: SUPPORTED,
  yourAuthority: { principalId: ME, actions: { read: yes, prepare: yes, approve: no("CAPABILITY_REQUIRED"), activate: no("CAPABILITY_REQUIRED") }, createDraft: yes },
  actorNames: { [OWNER]: "Olive Owner" },
  ...over,
});
const PREPARER_AUTHORITY = {
  principalId: ME,
  companies: [{ operatingCompanyId: "taylor", name: "Taylor Freezer of Arizona",
    actions: { read: yes, prepare: yes, approve: no("CAPABILITY_REQUIRED"), activate: no("CAPABILITY_REQUIRED") } }],
};
const OWNER_AUTHORITY = {
  principalId: OWNER,
  companies: ["taylor", "ventana"].map((id) => ({ operatingCompanyId: id, name: id === "taylor" ? "Taylor Freezer of Arizona" : "Ventana",
    actions: { read: yes, prepare: no("CAPABILITY_REQUIRED"), approve: yes, activate: yes } })),
};

/** A server stand-in: reads answer from `reads`, commands from `commands` (default ok). */
function serverWith({ authority = PREPARER_AUTHORITY, reads = {}, lists = {}, commands = {} } = {}) {
  return vi.fn(async (op, input) => {
    if (op === "readMyFinancialPolicyAuthority") return authority.ok === false ? authority : { ok: true, result: authority };
    if (op === "readFinancialPolicy") return { ok: true, result: reads[input.operatingCompanyId] ?? readOf({ operatingCompanyId: input.operatingCompanyId }) };
    if (op === "listFinancialPolicyVersions") return { ok: true, result: lists[input.operatingCompanyId] ?? { operatingCompanyId: input.operatingCompanyId, items: [], auditTrail: [], actorNames: {} } };
    return commands[op] ?? { ok: true, result: { version: version(), replayed: false } };
  });
}
const policyApi = () => vi.fn(async (op) => (op === "listAccountingDestinations" || op === "listCounterpartyPaymentTerms"
  ? { ok: true, data: { items: [] } } : { ok: true, data: {} }));
const mount = (financeApi, callApi = policyApi()) => render(<AdminFinancialPolicy financeApi={financeApi} callApi={callApi} />);
const action = (name) => document.querySelector(`[data-action="${name}"]`);
const button = (name) => action(name).querySelector("button");

describe("Administration > Financial Policy -- the companies and the actions are the server's", () => {
  it("lists only the companies the authority read returns, with each action's availability and reason", async () => {
    const api = serverWith();
    mount(api);
    const select = await screen.findByLabelText("Operating Company", { selector: "#fp-company" });
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([["taylor", "Taylor Freezer of Arizona"]]);
    // The policy workspace names no other company (Finance Configuration's own static company picker is a separate section).
    expect(document.querySelector("[data-financial-policy-workspace]").textContent).not.toMatch(/Ventana/);
    await waitFor(() => expect(api).toHaveBeenCalledWith("readFinancialPolicy", { operatingCompanyId: "taylor" }));
    const approveItem = document.querySelector('[data-company-action="approve"]');
    expect(approveItem.dataset.allowed).toBe("false");
    expect(approveItem.textContent).toMatch(/Your Security Roles do not include this Financial Policy action/);
    expect(document.querySelector('[data-company-action="prepare"]').dataset.allowed).toBe("true");
    await screen.findByText(/Not configured: no policy is in effect/);
  });

  it("the Owner selects among the companies the server names; preparing is visibly unavailable with the reason", async () => {
    const api = serverWith({ authority: OWNER_AUTHORITY, reads: {
      taylor: readOf({ yourAuthority: { principalId: OWNER, actions: OWNER_AUTHORITY.companies[0].actions, createDraft: no("CAPABILITY_REQUIRED") } }),
      ventana: readOf({ operatingCompanyId: "ventana", yourAuthority: { principalId: OWNER, actions: OWNER_AUTHORITY.companies[1].actions, createDraft: no("CAPABILITY_REQUIRED") } }),
    } });
    mount(api);
    const select = await screen.findByLabelText("Operating Company", { selector: "#fp-company" });
    expect([...select.options].map((o) => o.value)).toEqual(["taylor", "ventana"]);
    await waitFor(() => expect(action("save")).toBeTruthy());
    expect(button("save").disabled).toBe(true);
    expect(action("save").textContent).toMatch(/Not available: Your Security Roles do not include/);
    fireEvent.change(select, { target: { value: "ventana" } });
    await waitFor(() => expect(api).toHaveBeenCalledWith("readFinancialPolicy", { operatingCompanyId: "ventana" }));
    expect(api).toHaveBeenCalledWith("listFinancialPolicyVersions", { operatingCompanyId: "ventana" });
  });

  it("a refused authority read is shown as the server's refusal, not as an empty page", async () => {
    mount(serverWith({ authority: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", message: "this operation requires finance.policy.read" } }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Your Security Roles do not include/);
    expect(alert.textContent).toMatch(/CAPABILITY_REQUIRED/);
    expect(alert.textContent).toMatch(/this operation requires finance\.policy\.read/);
  });
});

describe("Administration > Financial Policy -- a late answer never lands under another company", () => {
  it("switching company mid-load drops Taylor's late response; the selector is disabled while a command runs", async () => {
    let releaseTaylor;
    const taylorGate = new Promise((r) => { releaseTaylor = r; });
    const taylorActive = version({ id: "fpv-taylor", status: "ACTIVE", locked: true, effectiveDate: "2026-01-01",
      policy: { ...WA, inventoryCostMethod: "FIFO" }, yourActions: version().yourActions });
    const ventanaRead = readOf({ operatingCompanyId: "ventana", yourAuthority: { principalId: OWNER, actions: OWNER_AUTHORITY.companies[1].actions, createDraft: no("CAPABILITY_REQUIRED") } });
    let releaseCommand;
    const api = vi.fn(async (op, input) => {
      if (op === "readMyFinancialPolicyAuthority") return { ok: true, result: OWNER_AUTHORITY };
      if (op === "readFinancialPolicy" && input.operatingCompanyId === "taylor") {
        await taylorGate;
        return { ok: true, result: readOf({ state: "CONFIGURED", inForce: taylorActive }) };
      }
      if (op === "readFinancialPolicy") return { ok: true, result: ventanaRead };
      if (op === "listFinancialPolicyVersions") {
        if (input.operatingCompanyId === "taylor") await taylorGate;
        return { ok: true, result: { operatingCompanyId: input.operatingCompanyId, auditTrail: [], actorNames: {},
          items: input.operatingCompanyId === "taylor" ? [taylorActive] : [] } };
      }
      return new Promise((r) => { releaseCommand = () => r({ ok: true, result: { version: version(), replayed: false } }); });
    });
    mount(api);
    const select = await screen.findByLabelText("Operating Company", { selector: "#fp-company" });
    await waitFor(() => expect(api).toHaveBeenCalledWith("readFinancialPolicy", { operatingCompanyId: "taylor" }));
    fireEvent.change(select, { target: { value: "ventana" } });
    await screen.findByText(/Not configured: no policy is in effect/);
    releaseTaylor(); // Taylor's answer arrives late, after the switch
    await new Promise((r) => setTimeout(r, 20));
    const ws = document.querySelector("[data-financial-policy-workspace]");
    expect(ws.querySelector('[data-version="fpv-taylor"]')).toBeNull();
    expect(ws.querySelector('[data-version-row]')).toBeNull();
    expect(screen.getByRole("region", { name: "Policy summary" }).textContent).toMatch(/Not configured/);

    // A command in flight: the selector cannot move until it answers.
    const approved = version({ status: "APPROVED", yourActions: { ...version().yourActions, activate: yes } });
    api.mockClear();
    cleanup();
    const api2 = vi.fn(async (op, input) => {
      if (op === "readMyFinancialPolicyAuthority") return { ok: true, result: OWNER_AUTHORITY };
      if (op === "readFinancialPolicy") return { ok: true, result: readOf({ operatingCompanyId: input.operatingCompanyId, inFlight: approved }) };
      if (op === "listFinancialPolicyVersions") return { ok: true, result: { operatingCompanyId: input.operatingCompanyId, items: [], auditTrail: [], actorNames: {} } };
      return new Promise((r) => { releaseCommand = () => r({ ok: true, result: { version: approved, replayed: false } }); });
    });
    mount(api2);
    await waitFor(() => expect(action("activate")).toBeTruthy());
    fireEvent.click(button("activate"));
    await waitFor(() => expect(document.querySelector("#fp-company").disabled).toBe(true));
    releaseCommand();
    await waitFor(() => expect(document.querySelector("#fp-company").disabled).toBe(false));
  });
});

describe("Administration > Financial Policy -- each command carries the right input", () => {
  it("creates a draft from the editor's choices (no method is defaulted), with the stated note", async () => {
    const api = serverWith();
    mount(api);
    await waitFor(() => expect(action("save")).toBeTruthy());
    expect(button("save").disabled).toBe(true); // nothing chosen yet: no default method
    const editor = screen.getByRole("region", { name: "Draft" });
    const pick = (label, value) => fireEvent.change(within(editor).getByLabelText(label), { target: { value } });
    pick("Interchangeable Inventory Costing", "FIFO");
    pick("Serialized Inventory Costing", "SPECIFIC_IDENTIFICATION");
    pick("COGS Recognition Event", "INVOICE_ISSUE");
    pick("Inbound Freight", "EXCLUDED");
    pick("Other Landed Costs", "EXCLUDED");
    // The unavailable recognition point is SHOWN, disabled, with its reason.
    const unavailable = within(editor).getByRole("option", { name: /Work order part consumption \(unavailable: physical consumption is not active\)/ });
    expect(unavailable.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText(/^Note/), { target: { value: "deployment choice" } });
    fireEvent.click(button("save"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("saveFinancialPolicyDraft", {
      operatingCompanyId: "taylor", reason: "deployment choice",
      policy: { inventoryCostMethod: "FIFO", serializedInventoryCostMethod: "SPECIFIC_IDENTIFICATION", cogsRecognitionPointId: "INVOICE_ISSUE",
        freightTreatment: "EXCLUDED", landedCostTreatment: "EXCLUDED" },
    }));
    await screen.findByText("Draft saved.");
  });

  it("edits and submits the current draft by its version id", async () => {
    const api = serverWith({ reads: { taylor: readOf({ inFlight: version(), yourAuthority: { ...readOf().yourAuthority, createDraft: no("FINANCIAL_POLICY_IN_FLIGHT_EXISTS") } }) } });
    mount(api);
    await waitFor(() => expect(action("submit")).toBeTruthy());
    expect(button("save").disabled).toBe(true); // no change yet
    fireEvent.click(button("submit"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("submitFinancialPolicy", { operatingCompanyId: "taylor", versionId: "fpv-1" }));
    const editor = screen.getByRole("region", { name: "Draft" });
    fireEvent.change(within(editor).getByLabelText("Interchangeable Inventory Costing"), { target: { value: "FIFO" } });
    expect(button("submit").disabled).toBe(true); // unsaved changes must be saved first
    fireEvent.click(button("save"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("saveFinancialPolicyDraft", expect.objectContaining({ operatingCompanyId: "taylor", versionId: "fpv-1",
      policy: expect.objectContaining({ inventoryCostMethod: "FIFO" }) })));
  });

  it("approves and rejects (reason required) a submitted version when the server allows it", async () => {
    const submitted = version({ status: "SUBMITTED", submittedBy: ME, submittedAt: "2026-10-13T16:00:00.000Z",
      yourActions: { edit: no("FINANCIAL_POLICY_NOT_EDITABLE"), submit: no("FINANCIAL_POLICY_NOT_EDITABLE"), approve: yes, reject: yes, activate: no("FINANCIAL_POLICY_NOT_APPROVED") } });
    const api = serverWith({ authority: OWNER_AUTHORITY, reads: { taylor: readOf({ inFlight: submitted }) } });
    mount(api);
    await waitFor(() => expect(action("approve")).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Draft" })).toBeNull(); // content is frozen: no editor
    const panel = screen.getByRole("region", { name: "Approval decision" });
    fireEvent.change(within(panel).getByLabelText("Approval Note (Optional)"), { target: { value: "reviewed" } });
    fireEvent.click(button("approve"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("approveFinancialPolicy", { operatingCompanyId: "taylor", versionId: "fpv-1", reason: "reviewed" }));
    expect(button("reject").disabled).toBe(true); // a rejection states its reason
    fireEvent.change(within(panel).getByLabelText("Rejection Reason (Required to Reject)"), { target: { value: "use FIFO" } });
    fireEvent.click(button("reject"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("rejectFinancialPolicy", { operatingCompanyId: "taylor", versionId: "fpv-1", reason: "use FIFO" }));
  });

  it("the preparer sees approve / reject blocked by separation of duties, in words", async () => {
    const submitted = version({ status: "SUBMITTED", submittedBy: ME,
      yourActions: { edit: no("FINANCIAL_POLICY_NOT_EDITABLE"), submit: no("FINANCIAL_POLICY_NOT_EDITABLE"), approve: no("SEPARATION_OF_DUTIES"),
        reject: no("SEPARATION_OF_DUTIES"), activate: no("FINANCIAL_POLICY_NOT_APPROVED") } });
    mount(serverWith({ reads: { taylor: readOf({ inFlight: submitted }) } }));
    await waitFor(() => expect(action("approve")).toBeTruthy());
    for (const name of ["approve", "reject"]) {
      expect(button(name).disabled).toBe(true);
      expect(action(name).querySelector("[data-unavailable-reason]").dataset.unavailableReason).toBe("SEPARATION_OF_DUTIES");
      expect(action(name).textContent).toMatch(/You prepared, edited or submitted this version/);
    }
  });

  it("activates an approved version on the stated effective date (defaulting to the business date)", async () => {
    const approved = version({ status: "APPROVED", submittedBy: ME, approvedBy: OWNER, approvedAt: "2026-10-13T17:00:00.000Z",
      yourActions: { edit: no("FINANCIAL_POLICY_NOT_EDITABLE"), submit: no("FINANCIAL_POLICY_NOT_EDITABLE"), approve: no("FINANCIAL_POLICY_NOT_SUBMITTED"),
        reject: no("FINANCIAL_POLICY_NOT_SUBMITTED"), activate: yes } });
    const api = serverWith({ authority: OWNER_AUTHORITY, reads: { taylor: readOf({ inFlight: approved }) } });
    mount(api);
    await waitFor(() => expect(action("activate")).toBeTruthy());
    const panel = screen.getByRole("region", { name: "Activation" });
    expect(within(panel).getByLabelText("Effective Date").value).toBe("2026-10-13");
    fireEvent.change(within(panel).getByLabelText("Effective Date"), { target: { value: "2026-11-01" } });
    fireEvent.click(button("activate"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("activateFinancialPolicy", { operatingCompanyId: "taylor", versionId: "fpv-1", effectiveDate: "2026-11-01" }));
  });

  it("a refused command is shown in words and verbatim, and nothing is claimed saved", async () => {
    const approved = version({ status: "APPROVED", yourActions: { ...version().yourActions, activate: yes } });
    const api = serverWith({ authority: OWNER_AUTHORITY, reads: { taylor: readOf({ inFlight: approved }) }, commands: {
      activateFinancialPolicy: { ok: false, code: "FORBIDDEN", reason: "SEPARATION_OF_DUTIES", status: 403,
        message: "a financial policy version is approved, rejected or activated by someone other than the principal who prepared, edited or submitted it" },
    } });
    mount(api);
    await waitFor(() => expect(action("activate")).toBeTruthy());
    fireEvent.click(button("activate"));
    const alert = await screen.findByRole("alert");
    expect(alert.dataset.refusal).toBe("SEPARATION_OF_DUTIES");
    expect(alert.textContent).toMatch(/someone else must approve, reject or activate it/);
    expect(alert.textContent).toMatch(/by someone other than the principal who prepared/);
    expect(screen.queryByText(/Activated\./)).toBeNull();
  });

  it("maps the other governed refusals to words", () => {
    for (const [code, words] of [["OUTSIDE_OPERATING_COMPANY_SCOPE", /does not cover this operating company/], ["FINANCIAL_POLICY_REPLAY_CONFLICT", /recorded one stands/],
      ["CAPABILITY_REQUIRED", /Security Roles/], ["RESERVED_CAPABILITY", /Only the Owner Role/], ["METHOD_UNSUPPORTED", /not supported/],
      ["EFFECTIVE_DATE_PAST", /business date/], ["RECOGNITION_UNAVAILABLE", /not available yet/]]) {
      const d = describeFailure({ ok: false, code: "FORBIDDEN", reason: code, message: "server text" });
      expect(d.code).toBe(code);
      expect(d.words).toMatch(words);
      expect(d.message).toBe("server text");
    }
    expect(draftProblems({ ...WA, cogsRecognitionPointId: "WORK_ORDER_CONSUMPTION" }, SUPPORTED)).toEqual({ cogsRecognitionPointId: "physical consumption is not active" });
    expect(Object.keys(draftProblems({}, SUPPORTED))).toHaveLength(5);
  });
});

describe("Administration > Financial Policy -- history, audit and the Finance Configuration section", () => {
  it("renders the version history and audit trail with names, decisions, reasons and effective dates", async () => {
    const active = version({ status: "ACTIVE", locked: true, submittedBy: ME, approvedBy: OWNER, approvedAt: "2026-10-13T17:00:00.000Z",
      decisionReason: "reviewed with accounting", activatedBy: OWNER, activatedAt: "2026-10-13T18:00:00.000Z", effectiveDate: "2026-10-13",
      yourActions: { edit: no("FINANCIAL_POLICY_LOCKED"), submit: no("FINANCIAL_POLICY_LOCKED"), approve: no("CAPABILITY_REQUIRED"), reject: no("CAPABILITY_REQUIRED"), activate: no("CAPABILITY_REQUIRED") } });
    const api = serverWith({
      reads: { taylor: readOf({ state: "CONFIGURED", inForce: active }) },
      lists: { taylor: { operatingCompanyId: "taylor", items: [active], actorNames: { [OWNER]: "Olive Owner" }, auditTrail: [
        { id: "a2", action: "finance.policy.activate", versionId: "fpv-1", versionNumber: 1, actorPrincipalId: OWNER, occurredAt: "2026-10-13T18:00:00.000Z", reason: "go-live" },
        { id: "a1", action: "finance.policy.draft.create", versionId: "fpv-1", versionNumber: 1, actorPrincipalId: ME, occurredAt: "2026-10-13T15:00:00.000Z", reason: null },
      ] } },
    });
    mount(api);
    const history = await screen.findByRole("table", { name: "Financial policy versions" });
    expect(history.textContent).toMatch(/Approved by Olive Owner/);
    expect(history.textContent).toMatch(/reviewed with accounting/);
    expect(history.textContent).toMatch(/2026-10-13/);
    const audit = screen.getByRole("table", { name: "Financial policy audit trail" });
    expect([...audit.querySelectorAll("[data-audit-action]")].map((r) => r.dataset.auditAction)).toEqual(["finance.policy.activate", "finance.policy.draft.create"]);
    expect(audit.textContent).toMatch(/Activated/);
    expect(audit.textContent).toMatch(/go-live/);
    expect(audit.textContent).toMatch(/You/); // the caller's own action
    // The in-force version is locked: the summary says so, and no control reverses it.
    expect(screen.getByRole("region", { name: "Policy summary" }).textContent).toMatch(/is locked and is never edited/);
    expect(document.body.textContent).not.toMatch(/unlock|reopen/i);
  });

  it("still renders the Finance Configuration section (finance.configuration.manage, /admin/policy)", async () => {
    const callApi = policyApi();
    mount(serverWith(), callApi);
    await screen.findByText("Finance Configuration");
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("listAccountingDestinations", {}));
  });

  it("the client API mirror carries every Financial Policy operation", () => {
    expect(FINANCE_READ_OPERATIONS).toEqual(expect.arrayContaining(["readMyFinancialPolicyAuthority", "readFinancialPolicy", "listFinancialPolicyVersions"]));
    expect(FINANCE_COMMAND_OPERATIONS).toEqual(expect.arrayContaining(["saveFinancialPolicyDraft", "submitFinancialPolicy", "approveFinancialPolicy",
      "rejectFinancialPolicy", "activateFinancialPolicy"]));
  });
});

describe("Financials > Settings & Governance -- the accounting policy rows are the server's answer", () => {
  const mountGov = (financeApi) => render(<MemoryRouter><FinancialsGovernance financeApi={financeApi} /></MemoryRouter>);
  const section = () => screen.getByRole("region", { name: "Accounting policy" });

  it("shows the policy in force per company the viewer reads, and Not configured only when the server says so", async () => {
    const active = version({ status: "ACTIVE", effectiveDate: "2026-10-01", policy: { ...WA, inventoryCostMethod: "FIFO" } });
    mountGov(serverWith({ authority: OWNER_AUTHORITY, reads: {
      taylor: readOf({ state: "CONFIGURED", inForce: active }),
      ventana: readOf({ operatingCompanyId: "ventana", state: "NOT_CONFIGURED" }),
    } }));
    await waitFor(() => expect(section().textContent).toMatch(/Taylor Freezer of Arizona/));
    const text = section().textContent;
    expect(text).toMatch(/FIFO · serialized: Specific identification · COGS at Sales order fulfillment · version 1, effective 2026-10-01/);
    expect(text).toMatch(/Ventana.*Not Configured/);
    expect(section().querySelectorAll("select, input")).toHaveLength(0);
    // The only buttons are the read-only annotation tips: nothing edits, saves or decides.
    expect([...section().querySelectorAll("button")].some((b) => /save|edit|approve|activate|submit/i.test(b.textContent))).toBe(false);
    expect(screen.getByText("View Financial Policy →").getAttribute("href")).toBe("/administration/financial-policy");
  });

  it("an authority read listing ZERO companies says so explicitly -- not an empty section", async () => {
    mountGov(serverWith({ authority: { principalId: ME, companies: [] } }));
    await waitFor(() => expect(section().textContent).toMatch(/No operating company is covered by your Financial Policy access/));
    expect(section().textContent).not.toMatch(/Not Configured/);
  });

  it("a viewer without finance.policy.read is told so -- never shown a fabricated Not configured", async () => {
    mountGov(serverWith({ authority: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", message: "requires finance.policy.read" } }));
    await waitFor(() => expect(section().textContent).toMatch(/Visible to holders of Financial Policy access/));
    expect(section().textContent).not.toMatch(/Not Configured/);
  });
});

describe("Grant matrix -- a prohibited direct grant is never drawn as effective authority", () => {
  const MATRIX = {
    objectKey: "financialPolicy", label: "Financial Policy",
    actions: [{
      actionKey: "read", actionKind: "READ", displayLabel: "Read Financial Policy", capabilityKey: "finance.policy.read",
      roles: [{ roleKey: "owner", held: true, source: "ADMIN_GRANTED", condition: null }],
      principals: [
        { principalId: "pr-raw", source: "DIRECT_EXCEPTION", grantedBy: "rogue", enforced: false, notEffectiveReason: "ROLE_ASSIGNMENT_ONLY",
          forbiddenBy: "Owner, #232 Option C (2026-10-13): Financial Policy read is held only through a Role assignment" },
      ],
    }, {
      actionKey: "approve", actionKind: "ADMIN_ACTION", displayLabel: "Approve Financial Policy", capabilityKey: "finance.policy.approve",
      roles: [], principals: [{ principalId: "pr-ok", source: "DIRECT_EXCEPTION", grantedBy: "admin", enforced: true, notEffectiveReason: null, forbiddenBy: null }],
    }],
  };
  const api = () => ({
    listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [] })),
    listRoles: vi.fn(async () => ({ ok: true, data: [{ id: "r1", key: "owner", name: "Owner" }] })),
    getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: MATRIX })),
    listSupportedConditionKinds: vi.fn(async () => ({ ok: true, data: { kinds: [] } })),
  });

  it("the model does not count it as a holder", () => {
    const [read, approve] = matrixActionRows(MATRIX);
    expect([read.principalIds, read.ineffectivePrincipalIds, read.granted]).toEqual([[], ["pr-raw"], true]);
    expect([approve.principalIds, approve.granted]).toEqual([["pr-ok"], true]);
    expect(matrixActionRows({ actions: [{ ...MATRIX.actions[0], roles: [] }] })[0].granted).toBe(false);
  });

  it("the Object view labels it Not effective -- role assignment only", async () => {
    render(<ObjectActionMatrix api={api()} objectKey="financialPolicy" technical />);
    await screen.findByText("Read Financial Policy");
    const raw = document.querySelector('[data-direct-exception="pr-raw"]');
    expect(raw.dataset.enforced).toBe("false");
    expect(raw.textContent).toMatch(/Not effective — role assignment only/);
    expect(raw.textContent).toMatch(/confers nothing/);
    expect(raw.textContent).not.toMatch(/DIRECT EXCEPTION/);
    expect(document.querySelector('[data-direct-exception="pr-ok"]').textContent).toMatch(/DIRECT EXCEPTION/);
  });
});
