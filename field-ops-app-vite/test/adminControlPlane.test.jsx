// THE ADMINISTRATION CONTROL PLANE, CLIENT SIDE (lane CP-C) -- component and model proofs.
//
// Fixtures follow the server contract, docs/architecture/administration-control-plane-2026-09-26.md
// section 8: getObjectActionGrantMatrix, getSecurityRoleDetail, listRoleCapabilityDecisionHistory,
// the grant / revoke / condition mutations, and the specified explainEffectiveAccess.
//
// Every screen takes the control-plane seam as `api`; these tests stand in for the server with vi.fn,
// so what is proved is WHICH operation is sent with WHAT input, and that the server's answer -- including
// a refusal -- is what the screen shows.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";

import { ObjectActionMatrix } from "../src/modules/administration/ObjectActionSecurity.jsx";
import SecurityRoleDetail from "../src/modules/administration/SecurityRoleDetail.jsx";
import EmployeeEffectiveAccess from "../src/modules/administration/EmployeeEffectiveAccess.jsx";
import { principalAuditEvents } from "../src/modules/administration/EmployeeAccessAudit.jsx";
import {
  buildCondition,
  conditionKindsFor,
  describeCondition,
  effectiveAccessRows,
  matrixActionRows,
} from "../src/modules/administration/controlPlaneModel.js";
import { createAdminControlPlaneClient, refusalText } from "../src/services/adminControlPlaneClient.js";

afterEach(cleanup);

const RA_WO = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };

// getObjectActionGrantMatrix { objectKey: "workOrder" } -- the Object's REAL vocabulary.
const WORK_ORDER_MATRIX = {
  objectKey: "workOrder",
  label: "Work Order",
  actions: [
    {
      actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch Work Orders", capabilityKey: "workOrder.lifecycle.dispatch",
      roles: [
        { roleKey: "dispatcher", held: true, source: "SYSTEM_DEFAULT", condition: null },
        { roleKey: "fieldManager", held: true, source: "ADMIN_GRANTED", condition: null },
        { roleKey: "owner", held: false, source: "SYSTEM_INVARIANT", condition: null },
      ],
      principals: [{ principalId: "pr-7", source: "DIRECT_EXCEPTION", grantedBy: "admin-uid" }],
    },
    {
      actionKey: "read", actionKind: "READ", displayLabel: "Read Work Orders", capabilityKey: "workOrder.record.read",
      roles: [
        { roleKey: "technician", held: true, source: "SYSTEM_DEFAULT", condition: RA_WO },
        { roleKey: "officeManager", held: false, source: "ADMIN_REVOKED", condition: null },
      ],
      principals: [],
    },
    {
      actionKey: "recordConsumption", actionKind: "BUSINESS_ACTION", displayLabel: "Record Part Consumption", capabilityKey: "workOrder.lifecycle.recordConsumption",
      roles: [], principals: [],
    },
  ],
};

const ROLES = [
  { id: "r1", key: "dispatcher", name: "Dispatcher" },
  { id: "r2", key: "fieldManager", name: "Field Manager" },
  { id: "r3", key: "owner", name: "Owner" },
  { id: "r4", key: "technician", name: "Technician" },
  { id: "r5", key: "officeManager", name: "Office Manager" },
  { id: "r6", key: "salesManager", name: "Sales Manager" },
];

function makeApi(over = {}) {
  return {
    listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [{ key: "workOrder", label: "Work Order", actions: [] }] })),
    listRoles: vi.fn(async () => ({ ok: true, data: ROLES })),
    getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: WORK_ORDER_MATRIX })),
    getSecurityRoleDetail: vi.fn(async () => ({ ok: true, data: ROLE_DETAIL })),
    listRoleCapabilityDecisionHistory: vi.fn(async () => ({ ok: true, data: DECISIONS })),
    grantObjectActionToRole: vi.fn(async () => ({ ok: true, data: { id: "rc-1" } })),
    revokeObjectActionFromRole: vi.fn(async () => ({ ok: true, data: { id: "rc-1" } })),
    setGrantCondition: vi.fn(async () => ({ ok: true, data: { status: "ACTIVE" } })),
    retireGrantCondition: vi.fn(async () => ({ ok: true, data: { status: "RETIRED" } })),
    explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: EXPLAIN })),
    ...over,
  };
}

const typeReason = (form, text) => fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: text } });

async function renderMatrix(api = makeApi()) {
  render(<ObjectActionMatrix api={api} objectKey="workOrder" />);
  await screen.findByText("Dispatch Work Orders");
  return api;
}

// ════════════════════ C. OBJECT SECURITY ACTION VIEW ════════════════════

describe("Object Security Actions: the Object's real vocabulary, not a C/R/E/D grid", () => {
  it("renders each action by its governed label and capability key -- and no generic CRUD columns", async () => {
    const api = await renderMatrix();
    expect(api.getObjectActionGrantMatrix).toHaveBeenCalledWith("workOrder");
    for (const label of ["Dispatch Work Orders", "Read Work Orders", "Record Part Consumption"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("workOrder.lifecycle.recordConsumption")).toBeTruthy();
    // No Create / Edit / Delete column headers anywhere on the view.
    for (const verb of ["Create", "Edit", "Delete"]) expect(screen.queryByRole("columnheader", { name: verb })).toBeNull();
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("shows each Role cell's SOURCE and condition, and a direct Principal grant as DIRECT EXCEPTION", async () => {
    await renderMatrix();
    const dispatcher = document.querySelector('[data-role-cell="dispatcher"]');
    expect(dispatcher.textContent).toMatch(/System default/);
    expect(document.querySelector('[data-role-cell="fieldManager"]').textContent).toMatch(/Admin granted/);
    expect(document.querySelector('[data-role-cell="officeManager"]').textContent).toMatch(/Admin revoked/);
    expect(document.querySelector('[data-role-cell="technician"]').textContent).toMatch(/Condition: assigned Employee on the workOrder/);
    const direct = document.querySelector('[data-direct-exception="pr-7"]');
    expect(direct.textContent).toMatch(/DIRECT EXCEPTION/);
    expect(screen.getByText(/No Security Role or Principal holds/)).toBeTruthy();
  });

  it("a SYSTEM_INVARIANT cell is drawn as not grantable and offers no control", async () => {
    await renderMatrix();
    const owner = document.querySelector('[data-role-cell="owner"]');
    expect(owner.textContent).toMatch(/Not grantable — system invariant/);
    expect(within(owner).queryAllByRole("button")).toHaveLength(0);
  });

  it("Revoke requires a reason, then sends revokeObjectActionFromRole and re-reads", async () => {
    const api = await renderMatrix();
    fireEvent.click(screen.getByRole("button", { name: "Revoke dispatch from dispatcher" }));
    const form = screen.getByRole("form", { name: "Revoke dispatch for dispatcher" });
    const confirm = within(form).getByRole("button", { name: "Confirm revoke" });
    expect(confirm.disabled).toBe(true);
    typeReason(form, "Dispatch moves to Field Managers");
    await act(async () => { fireEvent.click(confirm); });
    expect(api.revokeObjectActionFromRole).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "Dispatch moves to Field Managers",
    });
    await waitFor(() => expect(api.getObjectActionGrantMatrix.mock.calls.length).toBeGreaterThan(1));
  });

  it("Grant to another Security Role sends grantObjectActionToRole with the reason", async () => {
    const api = await renderMatrix();
    const recordConsumption = screen.getByText("Record Part Consumption").closest("li");
    fireEvent.click(within(recordConsumption).getByRole("button", { name: "Grant to another Security Role" }));
    const form = screen.getByRole("form", { name: "Grant recordConsumption to a Security Role" });
    fireEvent.change(within(form).getByLabelText("Security Role"), { target: { value: "technician" } });
    typeReason(form, "Technicians record their own parts");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm grant" })); });
    expect(api.grantObjectActionToRole).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "recordConsumption", roleKey: "technician", reason: "Technicians record their own parts",
    });
  });

  it("a Grant WITH a condition is one call -- the grant is never written unconditioned first", async () => {
    const api = await renderMatrix();
    fireEvent.click(screen.getByRole("button", { name: "Grant read to officeManager" }));
    const form = screen.getByRole("form", { name: "Grant read for officeManager" });
    fireEvent.change(within(form).getByLabelText("Condition kind"), { target: { value: "RECORD_ASSIGNMENT" } });
    fireEvent.change(within(form).getByLabelText("Record kind"), { target: { value: "workOrder" } });
    typeReason(form, "Office managers read their assigned work orders");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm grant" })); });
    expect(api.grantObjectActionToRole).toHaveBeenCalledTimes(1);
    expect(api.grantObjectActionToRole.mock.calls[0][0]).toEqual({
      objectKey: "workOrder", actionKey: "read", roleKey: "officeManager",
      reason: "Office managers read their assigned work orders", condition: RA_WO,
    });
    expect(api.setGrantCondition).not.toHaveBeenCalled();
  });

  it("Set condition offers only the kinds the evaluator supports; SELF / TEAM / BUSINESS_UNIT / COMPANY are disabled", async () => {
    const api = await renderMatrix();
    fireEvent.click(screen.getByRole("button", { name: "Set condition on dispatch for dispatcher" }));
    const form = screen.getByRole("form", { name: "Set condition dispatch for dispatcher" });
    const kind = within(form).getByLabelText("Condition kind");
    const option = (value) => within(kind).getAllByRole("option").find((o) => o.value === value);
    for (const unsupported of ["SELF", "TEAM", "BUSINESS_UNIT", "COMPANY"]) expect(option(unsupported).disabled, unsupported).toBe(true);
    for (const supported of ["RECORD_ASSIGNMENT", "WORK_ELIGIBILITY", "OPERATIONAL_SCOPE"]) expect(option(supported).disabled, supported).toBe(false);

    fireEvent.change(kind, { target: { value: "WORK_ELIGIBILITY" } });
    fireEvent.change(within(form).getByLabelText("Qualification"), { target: { value: "SERVICE_TECHNICIAN" } });
    typeReason(form, "Only qualified technicians dispatch");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm set condition" })); });
    expect(api.setGrantCondition).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "Only qualified technicians dispatch",
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] },
    });
  });

  it("retiring a condition on a HELD grant shows the server's 409 refusal verbatim", async () => {
    const refusal = { ok: false, code: "CONFLICT", message: "CONDITION_RETIREMENT_WOULD_WIDEN: revoke the grant before retiring its condition" };
    const api = await renderMatrix(makeApi({ retireGrantCondition: vi.fn(async () => refusal) }));
    fireEvent.click(screen.getByRole("button", { name: "Retire condition on read for technician" }));
    const form = screen.getByRole("form", { name: "Retire condition read for technician" });
    typeReason(form, "Widen technician reads");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm retire condition" })); });
    expect(api.retireGrantCondition).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "Widen technician reads" });
    const shown = document.querySelector('[data-control-plane-refusal="CONFLICT"]');
    expect(shown.textContent).toBe("CONFLICT: CONDITION_RETIREMENT_WOULD_WIDEN: revoke the grant before retiring its condition");
    // Refused means NOT re-read as if it had happened.
    expect(api.getObjectActionGrantMatrix).toHaveBeenCalledTimes(1);
  });

  it("a refused matrix read is shown as the refusal, never as an empty Object", async () => {
    const api = makeApi({ getObjectActionGrantMatrix: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "admin.securityPolicy.read is required" })) });
    render(<ObjectActionMatrix api={api} objectKey="workOrder" />);
    expect((await screen.findByRole("alert")).textContent).toBe("FORBIDDEN: admin.securityPolicy.read is required");
    expect(screen.queryByText(/No capability governs/)).toBeNull();
  });
});

// ════════════════════ SECURITY ROLE DETAIL ════════════════════

const ROLE_DETAIL = {
  roleKey: "technician", name: "Technician", description: "Field technician", protected: false,
  holders: [{ principalId: "pr-1", displayName: "John Smith", assignmentId: "asg-1", scopeType: "global", scopeValue: null, grantedAt: "2026-09-01T00:00:00Z" }],
  actions: [
    { objectKey: "workOrder", actionKey: "read", actionKind: "READ", displayLabel: "Read Work Orders", capabilityKey: "workOrder.record.read",
      held: true, grantedBy: "migration", source: "SYSTEM_DEFAULT", forbiddenBy: null, decision: null,
      condition: { condition: RA_WO, status: "ACTIVE", updatedAt: "2026-09-26T00:00:00Z" } },
    { objectKey: "reorderRequest", actionKey: "createPurchaseOrder", actionKind: "BUSINESS_ACTION", displayLabel: "Create Purchase Orders", capabilityKey: "reorder.purchaseOrder.create",
      held: false, grantedBy: null, source: "SYSTEM_INVARIANT", forbiddenBy: "technician withheld conditioned cell", decision: null, condition: null },
  ],
};
const DECISIONS = [
  { id: "d1", roleKey: "technician", capabilityKey: "workOrder.record.read", decision: "ADMIN_GRANTED", requiresCondition: true,
    reason: "Technicians read assigned work", actorPrincipalId: "pr-admin", decidedAt: "2026-09-20T00:00:00Z", supersededAt: null },
];

describe("Security Role detail", () => {
  it("shows the Role, its holders, its actions by Object with source and condition, and its decision history", async () => {
    const api = makeApi();
    render(<SecurityRoleDetail api={api} roleKey="technician" />);
    await screen.findByRole("table", { name: "Holders" });
    expect(api.getSecurityRoleDetail).toHaveBeenCalledWith("technician");
    expect(api.listRoleCapabilityDecisionHistory).toHaveBeenCalledWith({ roleKey: "technician", limit: 200 });
    expect(screen.getByText("John Smith")).toBeTruthy();
    const history = await screen.findByRole("table", { name: "Decision history" });
    expect(history.textContent).toMatch(/ADMIN_GRANTED · requires condition/);
    expect(history.textContent).toMatch(/Technicians read assigned work/);

    fireEvent.click(screen.getByRole("button", { name: /workOrder/ }));
    const row = document.querySelector('[data-role-action="workOrder.record.read"]');
    expect(row.textContent).toMatch(/Read Work Orders/);
    expect(row.textContent).toMatch(/System default/);
    expect(row.textContent).toMatch(/Condition: assigned Employee on the workOrder/);

    fireEvent.click(screen.getByRole("button", { name: /reorderRequest/ }));
    const invariant = document.querySelector('[data-role-action="reorder.purchaseOrder.create"]');
    expect(invariant.textContent).toMatch(/Not grantable — system invariant/);
    expect(within(invariant).queryAllByRole("button")).toHaveLength(0);
  });

  it("revoking from the Role detail sends the governed mutation and re-reads detail AND history", async () => {
    const api = makeApi();
    render(<SecurityRoleDetail api={api} roleKey="technician" />);
    await screen.findByRole("table", { name: "Holders" });
    fireEvent.click(screen.getByRole("button", { name: /workOrder/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke read from technician" }));
    const form = screen.getByRole("form", { name: "Revoke read for technician" });
    typeReason(form, "Reads move to the dispatcher");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm revoke" })); });
    expect(api.revokeObjectActionFromRole).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "Reads move to the dispatcher" });
    await waitFor(() => expect(api.getSecurityRoleDetail.mock.calls.length).toBeGreaterThan(1));
    expect(api.listRoleCapabilityDecisionHistory.mock.calls.length).toBeGreaterThan(1);
  });
});

// ════════════════════ E. EFFECTIVE ACCESS ════════════════════

const EXPLAIN = {
  principalId: "pr-1",
  capabilities: [
    { capabilityKey: "workOrder.record.read", objectKey: "workOrder", actionKey: "read", displayLabel: "Read Work Orders",
      via: [{ grantor: { kind: "ROLE", roleKey: "technician" }, condition: RA_WO }], runtime: "CONDITIONAL", why: "RECORD_REQUIRED" },
    { capabilityKey: "workOrder.lifecycle.dispatch", objectKey: "workOrder", actionKey: "dispatch",
      via: [{ grantor: { kind: "ROLE", roleKey: "dispatcher" }, condition: null }], runtime: "ALLOWED" },
    { capabilityKey: "employee.link.assert", objectKey: "employee", actionKey: "linkPrincipal",
      via: [{ grantor: { kind: "PRINCIPAL", principalId: "pr-1" }, condition: null }], runtime: "NOT_ENFORCED_DIRECT" },
    { capabilityKey: "opportunity.write", objectKey: "opportunity", actionKey: "edit", via: [], runtime: "SOMETHING_NEW" },
  ],
};

describe("Effective Access: the server evaluator's answer, rendered", () => {
  it("renders verdict, source Role, condition and DIRECT EXCEPTION per Object x action", async () => {
    const api = makeApi();
    render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    expect(api.explainEffectiveAccess).toHaveBeenCalledWith("pr-1");
    const read = document.querySelector('[data-capability="workOrder.record.read"]');
    expect(read.textContent).toMatch(/Conditional/);
    expect(read.textContent).toMatch(/Security Role technician/);
    expect(read.textContent).toMatch(/assigned Employee on the workOrder/);
    expect(read.textContent).toMatch(/RECORD_REQUIRED/);
    expect(document.querySelector('[data-capability="workOrder.lifecycle.dispatch"]').textContent).toMatch(/Allowed/);
    const direct = document.querySelector('[data-capability="employee.link.assert"]');
    expect(direct.textContent).toMatch(/DIRECT EXCEPTION/);
    // An unknown verdict is shown RAW, never mapped to a friendlier one.
    expect(document.querySelector('[data-capability="opportunity.write"]').textContent).toMatch(/SOMETHING_NEW/);
  });

  it("renders an honest UNAVAILABLE state when the server does not serve explainEffectiveAccess", async () => {
    const api = makeApi({ explainEffectiveAccess: vi.fn(async () => ({ ok: false, code: "UNKNOWN_OPERATION", message: '"explainEffectiveAccess" is not an Administration operation' })) });
    render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-effective-access="UNAVAILABLE"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(panel.textContent).toMatch(/Effective Access is unavailable/);
    expect(document.querySelector("[data-capability]")).toBeNull();
  });

  it("the production seam reaches the local UNKNOWN_OPERATION today -- the name is not in the closed list yet", async () => {
    // No fetch happens: callPolicyApi refuses an unlisted name before the network. When the server
    // lane adds explainEffectiveAccess to both lists, this wrapper reaches the server unchanged.
    const call = vi.fn(async (operation) => ({ ok: false, code: "UNKNOWN_OPERATION", message: `"${operation}" is not an Administration operation` }));
    const client = createAdminControlPlaneClient(call);
    const result = await client.explainEffectiveAccess("pr-1");
    expect(call).toHaveBeenCalledWith("explainEffectiveAccess", { principalId: "pr-1" });
    expect(result.code).toBe("UNKNOWN_OPERATION");
  });

  it("a payload that is not the contract's shape fails closed", async () => {
    const api = makeApi({ explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: [{ id: "pr-1" }] })) });
    render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="UNREADABLE"]')).toBeTruthy());
  });
});

// ════════════════════ the pure model and the seam ════════════════════

describe("control-plane model and seam", () => {
  it("builds exactly the stored condition shapes the server's builder validates", () => {
    expect(buildCondition("RECORD_ASSIGNMENT", { recordKind: "workOrder" })).toEqual(RA_WO);
    expect(buildCondition("OPERATIONAL_SCOPE", { scopeType: "WAREHOUSE", scopeId: " wh-1 " })).toEqual({ paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: "wh-1" }]] });
    expect(buildCondition("OPERATIONAL_SCOPE", { scopeType: "REORDER_QUEUE" })).toEqual({ paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE" }]] });
    expect(buildCondition("RECORD_ASSIGNMENT", {})).toBeNull();
    expect(buildCondition("SELF", {})).toBeNull();
    expect(describeCondition({ paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "A" }, { kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE" }], [{ kind: "WORK_ELIGIBILITY", qualificationCode: "B" }]] }))
      .toBe("Work Eligibility A AND Operational Scope WAREHOUSE OR Work Eligibility B");
  });

  it("a server-reported kind list overrides the contract mirror", () => {
    const kinds = conditionKindsFor(["RECORD_ASSIGNMENT"]);
    expect(kinds.find((k) => k.kind === "RECORD_ASSIGNMENT").supported).toBe(true);
    expect(kinds.find((k) => k.kind === "WORK_ELIGIBILITY").supported).toBe(false);
  });

  it("unreadable payloads are null, never empty", () => {
    expect(matrixActionRows({ objectKey: "x" })).toBeNull();
    expect(effectiveAccessRows({})).toBeNull();
    expect(effectiveAccessRows({ capabilities: [] })).toEqual([]);
  });

  it("refusalText is the server's code and message, verbatim", () => {
    expect(refusalText({ ok: false, code: "CONFLICT", message: "CONDITION_RETIREMENT_WOULD_WIDEN" })).toBe("CONFLICT: CONDITION_RETIREMENT_WOULD_WIDEN");
    expect(refusalText({ ok: true })).toBeNull();
  });

  it("each mutation wrapper sends the contract's input, with the reason", async () => {
    const call = vi.fn(async () => ({ ok: true, data: null }));
    const client = createAdminControlPlaneClient(call);
    await client.grantObjectActionToRole({ objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" });
    await client.revokeObjectActionFromRole({ objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" });
    await client.setGrantCondition({ objectKey: "o", actionKey: "a", roleKey: "r", condition: RA_WO, reason: "why" });
    await client.retireGrantCondition({ objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" });
    await client.assignRole({ principalId: "p", roleId: "rid", reason: "why" });
    await client.revokeRole({ assignmentId: "asg", reason: "why" });
    expect(call.mock.calls).toEqual([
      ["grantObjectActionToRole", { objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" }],
      ["revokeObjectActionFromRole", { objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" }],
      ["setGrantCondition", { objectKey: "o", actionKey: "a", roleKey: "r", condition: RA_WO, reason: "why" }],
      ["retireGrantCondition", { objectKey: "o", actionKey: "a", roleKey: "r", reason: "why" }],
      ["assignRole", { principalId: "p", roleId: "rid", reason: "why" }],
      ["revokeRole", { assignmentId: "asg", reason: "why" }],
    ]);
  });

  it("the access audit lens selects this Principal's events only, newest first", () => {
    const events = [
      { id: "1", action: "assignRole", targetKind: "roleAssignment", targetId: "asg-1", after: { principalId: "pr-1" }, occurredAt: "2026-09-01" },
      { id: "2", action: "assignRole", targetKind: "roleAssignment", targetId: "asg-2", after: { principalId: "pr-2" }, occurredAt: "2026-09-02" },
      { id: "3", action: "revokeRole", targetKind: "roleAssignment", targetId: "asg-1", before: { principalId: "pr-1" }, occurredAt: "2026-09-03" },
    ];
    expect(principalAuditEvents(events, "pr-1").map((e) => e.id)).toEqual(["3", "1"]);
  });

  it("the control-plane client and model hold no Firebase path and no client permission decision", () => {
    const client = readFileSync("src/services/adminControlPlaneClient.js", "utf8");
    const model = readFileSync("src/modules/administration/controlPlaneModel.js", "utf8");
    for (const src of [client, model]) {
      expect(src).not.toMatch(/from\s+["'][^"']*firebase/);
      expect(src).not.toMatch(/assignApprovedRole\s*\(/);
    }
    expect(model).not.toMatch(/export function can[A-Z]/);
    expect(model).not.toMatch(/isAllowed/);
  });
});
