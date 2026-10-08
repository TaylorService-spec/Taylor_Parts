// EMPLOYEE > SECURITY ROLES -- assignment SCOPE (lane SC), and Effective Access rendering scope.
//
// Fixtures follow the SERVED shapes: listSupportedAssignmentScopes (functions/src/adminPolicy/policyCommands.ts)
// and explainEffectiveAccess with scopedSources / assignments.scoped (functions/src/eosOps/effectiveAccessExplanation.ts).
// What is proved: the picker offers ONLY what the server says the runtime decides, sends { scopeType, scopeValue }
// only for a scoped choice, shows what a scoped assignment grants and leaves ungranted, renders the held scope, and
// degrades to global-only (never a local list) when the server does not serve the vocabulary.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";

import EmployeeSecurityRoles from "../src/modules/administration/EmployeeSecurityRoles.jsx";
import EmployeeEffectiveAccess from "../src/modules/administration/EmployeeEffectiveAccess.jsx";
import { explanationModel } from "../src/modules/administration/controlPlaneModel.js";
import { createAdminControlPlaneClient } from "../src/services/adminControlPlaneClient.js";

afterEach(cleanup);

const ROLES = [
  { id: "role-gm", key: "generalManager", name: "General Manager", protected: false },
  { id: "role-sales", key: "salesManager", name: "Sales Manager", protected: false },
  { id: "role-admin", key: "admin", name: "Administrator", protected: true },
];

const SCOPES = {
  scopeTypes: [
    { scopeType: "global", label: "All (global)", supported: true, reason: null, contextKey: null, valueSource: null, values: [], capabilities: [] },
    { scopeType: "operatingCompany", label: "Company", supported: true, reason: null, contextKey: "operatingCompanyId",
      valueSource: "eos_policy.tenant_operating_companies (ACTIVE, this tenant)",
      values: [{ value: "taylor", label: "Taylor" }, { value: "ventana", label: "Ventana" }],
      capabilities: [{ capabilityKey: "employee.record.read", consumers: ["workforce.readEmployee"] }] },
    { scopeType: "businessUnit", label: "Business Unit", supported: false, reason: "no PostgreSQL gate supplies a record's business unit",
      contextKey: "businessUnit", valueSource: "FIN-002", values: [], capabilities: [] },
    { scopeType: "location", label: "Warehouse", supported: false, reason: "no PostgreSQL gate supplies a record's warehouse",
      contextKey: "warehouseId", valueSource: "eos_ops.warehouses", values: [], capabilities: [] },
  ],
  roles: [
    { roleKey: "generalManager", roleId: "role-gm", assignableScopes: [{ scopeType: "operatingCompany", assignable: true, refusal: null,
      scopedCapabilities: ["employee.record.read"], inertCapabilities: ["salesAgreement.accept", "workOrder.create"] }] },
    { roleKey: "salesManager", roleId: "role-sales", assignableScopes: [{ scopeType: "operatingCompany", assignable: false,
      refusal: "SCOPE_NOT_EVALUABLE_FOR_ROLE", scopedCapabilities: [], inertCapabilities: ["opportunity.read"] }] },
    { roleKey: "admin", roleId: "role-admin", assignableScopes: [{ scopeType: "operatingCompany", assignable: false,
      refusal: "SCOPE_AMBIGUOUS_ADMINISTRATION", scopedCapabilities: [], inertCapabilities: [] }] },
  ],
};

const HELD = [
  { id: "asg-1", roleId: "role-gm", roleKey: "generalManager", scopeType: "operatingCompany", scopeValue: "taylor", status: "active", grantedAt: "2026-09-26T10:00:00.000Z" },
  { id: "asg-2", roleId: "role-sales", roleKey: "salesManager", scopeType: "global", scopeValue: null, status: "active", grantedAt: "2026-09-01T10:00:00.000Z" },
  { id: "asg-0", roleId: "role-admin", roleKey: "admin", scopeType: "global", scopeValue: null, status: "disabled", grantedAt: "2026-08-01T10:00:00.000Z" },
];

function makeApi(over = {}) {
  return {
    listPrincipalRoleAssignments: vi.fn(async (principalId) => ({ ok: true, data: { principalId, accessVersion: 5, assignments: HELD } })),
    listRoles: vi.fn(async () => ({ ok: true, data: ROLES })),
    listSupportedAssignmentScopes: vi.fn(async () => ({ ok: true, data: SCOPES })),
    assignRole: vi.fn(async (input) => ({ ok: true, data: { id: "asg-new", ...input, status: "active" } })),
    revokeRole: vi.fn(async (input) => ({ ok: true, data: { id: input.assignmentId, status: "disabled" } })),
    ...over,
  };
}

const assignForm = () => screen.getByRole("form", { name: "Assign a Security Role" });

describe("Employee > Security Roles: assignment scope from the server", () => {
  it("lists each held Security Role with status, scope type, scope value and effective date", async () => {
    render(<EmployeeSecurityRoles api={makeApi()} principalId="pr-1" employeeName="Jane" />);
    const table = await screen.findByRole("table", { name: "Security Roles held" });
    const scoped = table.querySelector('[data-assignment="asg-1"]');
    expect(scoped.getAttribute("data-assignment-scope")).toBe("operatingCompany");
    expect(within(scoped).getByText("General Manager")).toBeTruthy();
    expect(within(scoped).getByText("Role assignment active")).toBeTruthy();
    expect(within(scoped).getByText("Company")).toBeTruthy();
    expect(within(scoped).getByText("Taylor")).toBeTruthy();
    expect(within(scoped).getByText("2026-09-26")).toBeTruthy();
    const global = table.querySelector('[data-assignment="asg-2"]');
    expect(within(global).getByText("All (Global)")).toBeTruthy();
    expect(table.querySelector('[data-assignment="asg-0"]')).toBeNull();
  });

  it("offers only the scopes the server says this Role may take; a refused scope is shown disabled with its code", async () => {
    const api = makeApi();
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    const roleSelect = await screen.findByRole("combobox", { name: "Security Role to assign" });
    // Sales Manager is held globally -> not offered again; GM (held scoped) and Administrator are.
    expect(within(roleSelect).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a Security Role…", "General Manager", "Administrator"]);
    fireEvent.change(roleSelect, { target: { value: "role-admin" } });
    await waitFor(() => expect(document.querySelector('[data-assignment-scope-picker="READY"]')).toBeTruthy());
    const scopeOptions = within(screen.getByRole("combobox", { name: "Assignment scope" })).getAllByRole("option");
    expect(scopeOptions.map((o) => [o.textContent, o.disabled])).toEqual([
      ["All (Global)", false], ["Company — not available for this Role (SCOPE_AMBIGUOUS_ADMINISTRATION)", true]]);
    // The unconsumed scope types are listed with the SERVER's reason, never offered.
    expect(document.querySelector("[data-unsupported-scopes]").textContent).toMatch(/Business Unit \(no PostgreSQL gate supplies a record's business unit\)/);
    expect(document.querySelector("[data-unsupported-scopes]").textContent).toMatch(/Warehouse/);
    expect(screen.queryByRole("option", { name: /Business Unit|Sales channel/i })).toBeNull();
  });

  it("a Company-scoped assignment sends scopeType + scopeValue with the reason, and shows what it grants and leaves ungranted", async () => {
    const api = makeApi();
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-gm" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Assignment scope" })).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Assignment scope" }), { target: { value: "operatingCompany" } });
    const valueSelect = screen.getByRole("combobox", { name: "Scope value" });
    expect(within(valueSelect).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a Company…", "Taylor", "Ventana"]);
    expect(document.querySelector("[data-scoped-confers]").textContent)
      .toBe("At this scope the Role grants only: employee.record.read. Its other capabilities (salesAgreement.accept, workOrder.create) are not granted by a scoped assignment.");
    fireEvent.change(within(assignForm()).getByLabelText("Reason"), { target: { value: "GM for Taylor" } });
    const submit = screen.getByRole("button", { name: "Assign Security Role" });
    expect(submit.disabled).toBe(true); // no value chosen yet
    fireEvent.change(valueSelect, { target: { value: "taylor" } });
    expect(submit.disabled).toBe(false);
    await act(async () => { fireEvent.click(submit); });
    expect(api.assignRole).toHaveBeenCalledWith({ principalId: "pr-1", roleId: "role-gm", reason: "GM for Taylor", scopeType: "operatingCompany", scopeValue: "taylor" });
    await waitFor(() => expect(api.listPrincipalRoleAssignments).toHaveBeenCalledTimes(2));
  });

  it("a global assignment sends exactly { principalId, roleId, reason } -- no scope fields", async () => {
    const api = makeApi();
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-gm" } });
    fireEvent.change(within(assignForm()).getByLabelText("Reason"), { target: { value: "GM everywhere" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign Security Role" })); });
    expect(api.assignRole).toHaveBeenCalledWith({ principalId: "pr-1", roleId: "role-gm", reason: "GM everywhere" });
  });

  it("the server's scope refusal is shown verbatim", async () => {
    const api = makeApi({ assignRole: vi.fn(async () => ({ ok: false, code: "INVALID_INPUT",
      message: "SCOPE_VALUE_INVALID: 'northco' is not a governed Company of this tenant" })) });
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-gm" } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Assignment scope" })).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Assignment scope" }), { target: { value: "operatingCompany" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Scope value" }), { target: { value: "ventana" } });
    fireEvent.change(within(assignForm()).getByLabelText("Reason"), { target: { value: "x" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Assign Security Role" })); });
    await waitFor(() => expect(document.querySelector('[data-control-plane-refusal="INVALID_INPUT"]')).toBeTruthy());
    expect(document.querySelector('[data-control-plane-refusal="INVALID_INPUT"]').textContent)
      .toBe("INVALID_INPUT: SCOPE_VALUE_INVALID: 'northco' is not a governed Company of this tenant");
  });

  it("WITHOUT the server's scope vocabulary only a global assignment is offered -- never a local scope list", async () => {
    const api = makeApi({ listSupportedAssignmentScopes: vi.fn(async () => ({ ok: false, code: "UNKNOWN_OPERATION", message: "not served" })) });
    render(<EmployeeSecurityRoles api={api} principalId="pr-1" />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Security Role to assign" }), { target: { value: "role-gm" } });
    await waitFor(() => expect(document.querySelector('[data-assignment-scope-picker="UNAVAILABLE"]')).toBeTruthy());
    expect(screen.queryByRole("combobox", { name: "Assignment scope" })).toBeNull();
    expect(document.querySelector('[data-assignment-scope-picker="UNAVAILABLE"]').textContent).toMatch(/Scope: All \(Global\)/);
  });

  it("the production seam sends scope only for a scoped choice, and reads the vocabulary on the one endpoint", async () => {
    const call = vi.fn(async () => ({ ok: true, data: {} }));
    const client = createAdminControlPlaneClient(call);
    await client.assignRole({ principalId: "p", roleId: "r", reason: "why" });
    await client.assignRole({ principalId: "p", roleId: "r", reason: "why", scopeType: "global", scopeValue: "x" });
    await client.assignRole({ principalId: "p", roleId: "r", reason: "why", scopeType: "operatingCompany", scopeValue: "taylor" });
    await client.listSupportedAssignmentScopes();
    expect(call.mock.calls).toEqual([
      ["assignRole", { principalId: "p", roleId: "r", reason: "why" }],
      ["assignRole", { principalId: "p", roleId: "r", reason: "why" }],
      ["assignRole", { principalId: "p", roleId: "r", reason: "why", scopeType: "operatingCompany", scopeValue: "taylor" }],
      ["listSupportedAssignmentScopes", {}],
    ]);
  });

  it("the component holds no scope vocabulary of its own", () => {
    const src = readFileSync("src/modules/administration/EmployeeSecurityRoles.jsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["operatingCompany", "businessUnit", "\"location\"", "taylor", "salesChannel", "SCOPE_EVALUABLE"]) {
      expect(src.includes(word), word).toBe(false);
    }
  });
});

// explainEffectiveAccess with a scoped assignment (the served shape, from assignmentScopeRuntimePostgres).
const EXPLAIN = {
  tenantId: "t-1", principalId: "pr-1", securityRoleKeys: ["dispatcher"], accessVersion: 6,
  assignments: {
    excluded: [{ assignmentId: "asg-d", roleKey: "warehouseManager", reason: "SCOPE_UNSUPPORTED", scopeType: "domain", scopeValue: "inventory" }],
    scoped: [{ assignmentId: "asg-1", roleKey: "generalManager", scopeType: "operatingCompany", scopeValue: "taylor",
      capabilities: ["employee.record.read"], inertCapabilities: ["salesAgreement.accept"] }],
  },
  employeeId: "emp-1", workEligibility: [], operationalScopes: [], capabilities: ["workOrder.record.read"], conditionallyHeld: [],
  scopedHeld: [{ capabilityKey: "employee.record.read", scopeType: "operatingCompany", scopeValue: "taylor", sourceRole: "generalManager", conditioned: false }],
  surfaces: [],
  actions: [
    { objectKey: "employee", actionKey: "read", actionKind: "READ", capabilityKey: "employee.record.read", result: "SCOPED",
      reasonCode: "SCOPE_CONTEXT_REQUIRED", sourceRoles: [],
      scopedSources: [{ roleKey: "generalManager", scopeType: "operatingCompany", scopeValue: "taylor", condition: null, result: "ALLOWED", reasonCode: "ALLOWED" }],
      directGrant: null, withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
    { objectKey: "workOrder", actionKey: "read", actionKind: "READ", capabilityKey: "workOrder.record.read", result: "ALLOWED",
      reasonCode: "ALLOWED", sourceRoles: [{ roleKey: "dispatcher", condition: null }], scopedSources: [],
      directGrant: null, withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
  ],
};

describe("Effective Access renders assignment scope as the server states it", () => {
  it("per action: Granted by <Role>, Capability, Scope, and the evaluator's result inside the scope", async () => {
    const api = { explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: EXPLAIN })) };
    render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    const row = document.querySelector('[data-capability="employee.record.read"]');
    expect(row.getAttribute("data-result")).toBe("SCOPED");
    expect(row.textContent).toMatch(/Scoped/);
    expect(row.textContent).toMatch(/SCOPE_CONTEXT_REQUIRED/);
    const source = row.querySelector('[data-scoped-source="operatingCompany = taylor"]');
    // Role keys are shown by display name (UI corrections item A); the scope stays the server's own words.
    expect(source.textContent).toBe("General Manager · Scope: operatingCompany = taylor · Inside the scope: Allowed (ALLOWED)");
    const global = document.querySelector('[data-capability="workOrder.record.read"]');
    expect(global.textContent).toMatch(/Dispatcher · Scope: All \(Global\)/);
    const scopedTable = screen.getByRole("table", { name: "Scoped assignments" });
    expect(within(scopedTable).getByText("operatingCompany = taylor")).toBeTruthy();
    expect(within(scopedTable).getByText("employee.record.read")).toBeTruthy();
    expect(within(scopedTable).getByText("salesAgreement.accept")).toBeTruthy();
    const excluded = screen.getByRole("table", { name: "Excluded assignments" });
    expect(excluded.textContent).toMatch(/SCOPE_UNSUPPORTED/);
    expect(excluded.textContent).toMatch(/grants nothing/);
  });

  it("the model carries the scope fields verbatim and tolerates a payload without them", () => {
    const m = explanationModel(EXPLAIN);
    expect(m.scopedAssignments).toEqual([{ assignmentId: "asg-1", roleKey: "generalManager", scope: "operatingCompany = taylor",
      capabilities: ["employee.record.read"], inertCapabilities: ["salesAgreement.accept"] }]);
    expect(m.actions[0].scopedSources[0]).toMatchObject({ roleKey: "generalManager", scope: "operatingCompany = taylor", result: "ALLOWED", resultWords: "Allowed" });
    const older = explanationModel({ ...EXPLAIN, assignments: { excluded: [] }, actions: EXPLAIN.actions.map(({ scopedSources: _dropped, ...a }) => a) });
    expect(older.scopedAssignments).toEqual([]);
    expect(older.actions.every((a) => a.scopedSources.length === 0)).toBe(true);
  });
});
