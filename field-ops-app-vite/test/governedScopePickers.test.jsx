// GOVERNED SCOPE PICKERS (lane GA) -- no freehand ids.
//
//   Employee > Operational Scope   targets come ONLY from listOperationalScopeTargets (served shape:
//                                  functions/src/eosWorkforce/reads/operationalScopeReads.ts); there is no text input,
//                                  a type with no governed value is shown unavailable with the server's reason, and
//                                  without the server's answer nothing is offered.
//   Employee > Security Roles      a SALES_CHANNEL scope is offered with the tenant's governed channels exactly as
//                                  listSupportedAssignmentScopes serves them; a decided scope type with NO governed value
//                                  in this tenant is shown unavailable, never offered with an empty value.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";

import { OperationalScopeSection } from "../src/modules/administration/EmployeeWorkAuthorization.jsx";
import EmployeeSecurityRoles from "../src/modules/administration/EmployeeSecurityRoles.jsx";

afterEach(cleanup);

const TARGETS = {
  scopeTypes: [
    { scopeType: "WAREHOUSE", label: "Warehouse", available: true, reason: null, valueSource: "eos_ops.warehouses (ACTIVE, this tenant)",
      values: [{ value: "wh-phx", label: "Phoenix DC" }, { value: "wh-tuc", label: "Tucson" }] },
    { scopeType: "REORDER_QUEUE", label: "Reorder Queue", available: false, reason: "no ACTIVE governed value in this tenant (eos_policy.tenant_operating_company_keys (ACTIVE, this tenant))",
      valueSource: "eos_policy.tenant_operating_company_keys (ACTIVE, this tenant)", values: [] },
  ],
};

function makeWorkforce({ targets = { ok: true, result: TARGETS }, held = [] } = {}) {
  return {
    call: vi.fn(async (operation, input) => {
      switch (operation) {
        case "listEmployeeOperationalScopes":
          return { ok: true, result: { employeeId: input.employeeId, items: held } };
        case "listOperationalScopeTargets":
          return targets;
        case "assignEmployeeOperationalScope":
          return { ok: true, result: { outcome: "ASSIGNED", ...input } };
        default:
          return { ok: false, code: "UNKNOWN_OPERATION" };
      }
    }),
  };
}
const scopeForm = () => screen.getByRole("form", { name: "Assign Operational Scope" });

describe("Employee > Operational Scope: governed targets only", () => {
  it("offers ONLY the server's values -- no text input -- and marks a type with no governed value unavailable with the reason", async () => {
    const workforce = makeWorkforce();
    render(<OperationalScopeSection employeeId="emp-1" workforce={workforce} canWrite />);
    await waitFor(() => expect(document.querySelector('[data-operational-scope-picker="READY"]')).toBeTruthy());
    expect(within(scopeForm()).queryAllByRole("textbox").filter((el) => el.getAttribute("aria-label") !== "Reason")).toEqual([]);
    expect(screen.queryByLabelText("Scope target id")).toBeNull();
    const types = within(screen.getByRole("combobox", { name: "Scope type to assign" })).getAllByRole("option");
    expect(types.map((o) => [o.textContent, o.disabled])).toEqual([["Choose…", false], ["Warehouse", false], ["Reorder Queue — unavailable", true]]);
    expect(document.querySelector("[data-unavailable-scope-types]").textContent).toMatch(/Reorder Queue \(no ACTIVE governed value in this tenant/);
    fireEvent.change(screen.getByRole("combobox", { name: "Scope type to assign" }), { target: { value: "WAREHOUSE" } });
    const target = screen.getByRole("combobox", { name: "Scope target" });
    expect(within(target).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Phoenix DC", "Tucson"]);
    expect(workforce.call).toHaveBeenCalledWith("listOperationalScopeTargets", {});
  });

  it("submits exactly the chosen governed value; a value the server did not offer cannot be submitted", async () => {
    const workforce = makeWorkforce({ held: [{ operationalScopeId: "os-1", scopeType: "WAREHOUSE", scopeId: "wh-tuc", scopeTypeLabel: "Warehouse", scopeName: "Tucson" }] });
    render(<OperationalScopeSection employeeId="emp-1" workforce={workforce} canWrite />);
    await waitFor(() => expect(document.querySelector('[data-operational-scope-picker="READY"]')).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Scope type to assign" }), { target: { value: "WAREHOUSE" } });
    const target = screen.getByRole("combobox", { name: "Scope target" });
    // A target the Employee already holds is not offered again.
    expect(within(target).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose…", "Phoenix DC"]);
    fireEvent.change(within(scopeForm()).getByLabelText("Reason"), { target: { value: "covers Phoenix" } });
    const submit = within(scopeForm()).getByRole("button", { name: "Assign" });
    expect(submit.disabled).toBe(true);
    fireEvent.change(target, { target: { value: "wh-forged" } }); // not an offered option: the select cannot hold it
    expect(submit.disabled).toBe(true);
    fireEvent.change(target, { target: { value: "wh-phx" } });
    expect(submit.disabled).toBe(false);
    await act(async () => { fireEvent.click(submit); });
    expect(workforce.call).toHaveBeenCalledWith("assignEmployeeOperationalScope", { employeeId: "emp-1", scopeType: "WAREHOUSE", scopeId: "wh-phx", reason: "covers Phoenix" });
  });

  it("WITHOUT the server's target list nothing is offered -- never a local list or a typed id", async () => {
    const workforce = makeWorkforce({ targets: { ok: false, code: "UNKNOWN_OPERATION", message: "not served" } });
    render(<OperationalScopeSection employeeId="emp-1" workforce={workforce} canWrite />);
    await waitFor(() => expect(document.querySelector('[data-operational-scope-picker="UNAVAILABLE"]')).toBeTruthy());
    expect(screen.queryByRole("combobox", { name: "Scope type to assign" })).toBeNull();
    expect(screen.queryByLabelText("Scope target id")).toBeNull();
    expect(document.querySelector('[data-operational-scope-picker="UNAVAILABLE"]').textContent).toMatch(/UNKNOWN_OPERATION/);
  });

  it("the section holds no scope vocabulary and no free-text target of its own", () => {
    const src = readFileSync("src/modules/administration/EmployeeWorkAuthorization.jsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["OPERATIONAL_SCOPE_TYPES", "\"WAREHOUSE\"", "\"REORDER_QUEUE\"", "Scope target id", "<input"]) {
      expect(src.includes(word), word).toBe(false);
    }
  });
});

// ════════════════════ Security Roles: SALES_CHANNEL from the server ════════════════════

const ROLES = [{ id: "role-lead", key: "salesLead", name: "Sales Lead", protected: false }];
const scopes = (channelValues) => ({
  scopeTypes: [
    { scopeType: "global", label: "All (global)", supported: true, reason: null, contextKey: null, valueSource: null, values: [], capabilities: [] },
    { scopeType: "operatingCompany", label: "Company", supported: true, reason: null, contextKey: "operatingCompanyId", valueSource: "x",
      values: [], capabilities: [{ capabilityKey: "employee.record.read", consumers: [] }] },
    { scopeType: "salesChannel", label: "Sales Channel", supported: true, reason: null, contextKey: "salesChannel",
      valueSource: "eos_policy.tenant_sales_channels (ACTIVE, this tenant)", values: channelValues,
      capabilities: [{ capabilityKey: "opportunity.read", consumers: ["commercial.listOpportunities"] }] },
  ],
  roles: [{ roleKey: "salesLead", roleId: "role-lead", assignableScopes: [
    { scopeType: "operatingCompany", assignable: false, refusal: "SCOPE_NOT_EVALUABLE_FOR_ROLE", scopedCapabilities: [], inertCapabilities: ["opportunity.read"] },
    { scopeType: "salesChannel", assignable: true, refusal: null, scopedCapabilities: ["opportunity.read", "salesAgreement.read", "salesOrder.read"], inertCapabilities: [] },
  ] }],
});
const HELD = [
  { id: "asg-r", roleId: "role-lead", roleKey: "salesLead", scopeType: "salesChannel", scopeValue: "RETAIL", status: "active", grantedAt: "2026-09-26T10:00:00.000Z" },
];
function makeApi(channelValues) {
  return {
    listPrincipalRoleAssignments: vi.fn(async (principalId) => ({ ok: true, data: { principalId, accessVersion: 3, assignments: HELD } })),
    listRoles: vi.fn(async () => ({ ok: true, data: ROLES })),
    listSupportedAssignmentScopes: vi.fn(async () => ({ ok: true, data: scopes(channelValues) })),
    assignRole: vi.fn(async (input) => ({ ok: true, data: { id: "asg-new", ...input, status: "active" } })),
    revokeRole: vi.fn(),
  };
}

describe("Employee > Security Roles: Sales Channel scope values come from the server", () => {
  it("offers the tenant's governed channels; the same Role is assigned per channel (a second channel for a Retail holder)", async () => {
    const api = makeApi([{ value: "NATIONAL_ACCOUNTS", label: "National Accounts" }, { value: "RETAIL", label: "Retail" }]);
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    const held = await screen.findByRole("table", { name: "Security Roles held" });
    expect(within(held.querySelector('[data-assignment="asg-r"]')).getByText("Sales Channel")).toBeTruthy();
    expect(within(held.querySelector('[data-assignment="asg-r"]')).getByText("Retail")).toBeTruthy();
    // Held only SCOPED, so the Role is still offered (for another channel).
    fireEvent.change(screen.getByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-lead" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Assignment scope" })).toBeTruthy());
    expect(within(screen.getByRole("combobox", { name: "Assignment scope" })).getAllByRole("option").map((o) => [o.textContent, o.disabled])).toEqual([
      ["All (global)", false], ["Company — not available for this Role (SCOPE_NOT_EVALUABLE_FOR_ROLE)", true], ["Sales Channel", false]]);
    fireEvent.change(screen.getByRole("combobox", { name: "Assignment scope" }), { target: { value: "salesChannel" } });
    const value = screen.getByRole("combobox", { name: "Scope value" });
    expect(within(value).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a Sales Channel…", "National Accounts", "Retail"]);
    fireEvent.change(within(screen.getByRole("form", { name: "Assign a Security Role" })).getByLabelText("Reason"), { target: { value: "also runs National" } });
    fireEvent.change(value, { target: { value: "NATIONAL_ACCOUNTS" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign Security Role" })); });
    expect(api.assignRole).toHaveBeenCalledWith({ principalId: "pr-1", roleId: "role-lead", reason: "also runs National", scopeType: "salesChannel", scopeValue: "NATIONAL_ACCOUNTS" });
  });

  it("a decided scope type with NO governed value in this tenant is shown unavailable, never offered", async () => {
    render(<EmployeeSecurityRoles api={makeApi([])} principalId="pr-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-lead" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Assignment scope" })).toBeTruthy());
    const option = within(screen.getByRole("combobox", { name: "Assignment scope" })).getAllByRole("option").find((o) => o.value === "salesChannel");
    expect([option.textContent, option.disabled]).toEqual(["Sales Channel — unavailable: no governed value in this tenant", true]);
  });
});
