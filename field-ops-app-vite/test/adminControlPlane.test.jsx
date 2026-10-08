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
  conditionVocabularyFrom,
  describeCondition,
  explanationModel,
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

// listSupportedConditionKinds -- the SERVER's condition vocabulary (the only source the picker uses).
const CONDITION_VOCABULARY = {
  kinds: [
    { kind: "RECORD_ASSIGNMENT", label: "Record assignment", supported: true,
      parameters: [{ name: "relation", values: ["ASSIGNED_EMPLOYEE"] }], recordKinds: ["workOrder", "reorderRequest"],
      capabilities: ["workOrder.record.read"] },
    { kind: "WORK_ELIGIBILITY", label: "Work Eligibility", supported: true,
      parameters: [{ name: "qualificationCode", label: "Qualification", values: ["SERVICE_TECHNICIAN", "WAREHOUSE_OPERATIONS", "PARTS_OPERATIONS"] }] },
    { kind: "OPERATIONAL_SCOPE", label: "Operational Scope", supported: true,
      parameters: [{ name: "scopeType", label: "Scope type", values: ["WAREHOUSE", "REORDER_QUEUE"] }, { name: "scopeId", label: "Scope id", required: false }] },
    { kind: "TEAM", label: "Team", supported: false, reason: "no reportsTo edge is bindable" },
  ],
};

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
    listSupportedConditionKinds: vi.fn(async () => ({ ok: true, data: CONDITION_VOCABULARY })),
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
    const confirm = within(form).getByRole("button", { name: "Confirm Revoke" });
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
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm Grant" })); });
    expect(api.grantObjectActionToRole).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "recordConsumption", roleKey: "technician", reason: "Technicians record their own parts",
    });
  });

  it("a Grant WITH a condition is one call -- the grant is never written unconditioned first", async () => {
    const api = await renderMatrix();
    fireEvent.click(screen.getByRole("button", { name: "Grant read to officeManager" }));
    const form = screen.getByRole("form", { name: "Grant read for officeManager" });
    await waitFor(() => expect(within(form).getByLabelText("Condition kind").disabled).toBe(false));
    fireEvent.change(within(form).getByLabelText("Condition kind"), { target: { value: "RECORD_ASSIGNMENT" } });
    // Record kinds come from the SERVER's vocabulary; the single-value relation is filled automatically.
    fireEvent.change(within(form).getByLabelText("Record kind"), { target: { value: "workOrder" } });
    typeReason(form, "Office managers read their assigned work orders");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm Grant" })); });
    expect(api.grantObjectActionToRole).toHaveBeenCalledTimes(1);
    expect(api.grantObjectActionToRole.mock.calls[0][0]).toEqual({
      objectKey: "workOrder", actionKey: "read", roleKey: "officeManager",
      reason: "Office managers read their assigned work orders", condition: RA_WO,
    });
    expect(api.setGrantCondition).not.toHaveBeenCalled();
  });

  it("the condition picker offers the SERVER's kinds: unsupported and inapplicable kinds are disabled", async () => {
    const api = await renderMatrix();
    expect(api.listSupportedConditionKinds).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set condition on dispatch for dispatcher" }));
    const form = screen.getByRole("form", { name: "Set condition dispatch for dispatcher" });
    await waitFor(() => expect(within(form).getByLabelText("Condition kind").disabled).toBe(false));
    const kind = within(form).getByLabelText("Condition kind");
    const option = (value) => within(kind).getAllByRole("option").find((o) => o.value === value);
    expect(option("TEAM").disabled).toBe(true);
    expect(option("TEAM").textContent).toMatch(/no reportsTo edge is bindable/);
    // RECORD_ASSIGNMENT is scoped by the server to workOrder.record.read -- not applicable to dispatch.
    expect(option("RECORD_ASSIGNMENT").disabled).toBe(true);
    expect(option("WORK_ELIGIBILITY").disabled).toBe(false);
    expect(option("SELF")).toBeUndefined();

    fireEvent.change(kind, { target: { value: "WORK_ELIGIBILITY" } });
    fireEvent.change(within(form).getByLabelText("Qualification"), { target: { value: "SERVICE_TECHNICIAN" } });
    typeReason(form, "Only qualified technicians dispatch");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm Set Condition" })); });
    expect(api.setGrantCondition).toHaveBeenCalledWith({
      objectKey: "workOrder", actionKey: "dispatch", roleKey: "dispatcher", reason: "Only qualified technicians dispatch",
      condition: { paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "SERVICE_TECHNICIAN" }]] },
    });
  });

  it("WITHOUT the server's vocabulary the picker is DISABLED with an honest message -- no local copy", async () => {
    const api = await renderMatrix(makeApi({
      listSupportedConditionKinds: vi.fn(async () => ({ ok: false, code: "UNKNOWN_OPERATION", message: '"listSupportedConditionKinds" is not an Administration operation' })),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Set condition on dispatch for dispatcher" }));
    const form = screen.getByRole("form", { name: "Set condition dispatch for dispatcher" });
    const kind = await within(form).findByLabelText("Condition kind");
    await waitFor(() => expect(form.querySelector('[data-condition-vocabulary="unavailable"]')).toBeTruthy());
    expect(kind.disabled).toBe(true);
    expect(within(kind).getAllByRole("option")).toHaveLength(1);
    expect(form.textContent).toMatch(/does not serve its condition vocabulary \(listSupportedConditionKinds\)/);
    typeReason(form, "anything");
    expect(within(form).getByRole("button", { name: "Confirm Set Condition" }).disabled).toBe(true);
    // An unconditioned grant is still possible.
    fireEvent.click(screen.getByRole("button", { name: "Grant read to officeManager" }));
    const grant = screen.getByRole("form", { name: "Grant read for officeManager" });
    typeReason(grant, "plain grant");
    await act(async () => { fireEvent.click(within(grant).getByRole("button", { name: "Confirm Grant" })); });
    expect(api.grantObjectActionToRole).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", roleKey: "officeManager", reason: "plain grant" });
  });

  it("retiring a condition on a HELD grant shows the server's 409 refusal verbatim", async () => {
    const refusal = { ok: false, code: "CONFLICT", message: "CONDITION_RETIREMENT_WOULD_WIDEN: revoke the grant before retiring its condition" };
    const api = await renderMatrix(makeApi({ retireGrantCondition: vi.fn(async () => refusal) }));
    fireEvent.click(screen.getByRole("button", { name: "Retire condition on read for technician" }));
    const form = screen.getByRole("form", { name: "Retire condition read for technician" });
    typeReason(form, "Widen technician reads");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm Retire Condition" })); });
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
  // Phase 3 (approved IA): the detail opens on Objects & Permissions; Employees and History are tabs.
  it("shows the Role, its holders, its actions by Object with source and condition, and its decision history", async () => {
    const api = makeApi();
    render(<SecurityRoleDetail api={api} roleKey="technician" />);
    expect((await screen.findByRole("tab", { name: "Objects & Permissions" })).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Employees/ }));
    await screen.findByRole("table", { name: "Holders" });
    expect(api.getSecurityRoleDetail).toHaveBeenCalledWith("technician");
    expect(api.listRoleCapabilityDecisionHistory).toHaveBeenCalledWith({ roleKey: "technician", limit: 200 });
    expect(screen.getByText("John Smith")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const history = await screen.findByRole("table", { name: "Decision history" });
    expect(history.textContent).toMatch(/ADMIN_GRANTED · requires condition/);
    expect(history.textContent).toMatch(/Technicians read assigned work/);

    fireEvent.click(screen.getByRole("tab", { name: "Objects & Permissions" }));
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
    await screen.findByRole("table", { name: "Objects and actions" });
    fireEvent.click(screen.getByRole("button", { name: /workOrder/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke read from technician" }));
    const form = screen.getByRole("form", { name: "Revoke read for technician" });
    typeReason(form, "Reads move to the dispatcher");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm Revoke" })); });
    expect(api.revokeObjectActionFromRole).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", roleKey: "technician", reason: "Reads move to the dispatcher" });
    await waitFor(() => expect(api.getSecurityRoleDetail.mock.calls.length).toBeGreaterThan(1));
    expect(api.listRoleCapabilityDecisionHistory.mock.calls.length).toBeGreaterThan(1);
  });
});

// ════════════════════ E. EFFECTIVE ACCESS ════════════════════

// explainEffectiveAccess -- the SERVED shape (eosOps/effectiveAccessExplanation.ts), built from the
// server's own acceptance fixture (functions/test/effectiveAccessExplanationPostgres.test.mjs, "CONDITIONAL,
// DIRECT_EXCEPTION and excluded assignments"): a conditioned technician read, a direct exception with a
// reason that the Role-only runtime does not enforce, an expired exception not shown, and a stale and a
// scoped assignment excluded.
const EXPLAIN = {
  tenantId: "t-1",
  principalId: "pr-1",
  securityRoleKeys: ["technician"],
  accessVersion: 4,
  assignments: {
    excluded: [
      { assignmentId: "asg-stale", roleKey: "dispatcher", reason: "STALE" },
      { assignmentId: "asg-scoped", roleKey: "warehouseManager", reason: "SCOPED", scopeType: "WAREHOUSE", scopeValue: "SC-WH-MAIN" },
    ],
  },
  employeeId: "emp-1",
  workEligibility: ["SERVICE_TECHNICIAN"],
  operationalScopes: [{ scopeType: "WAREHOUSE", scopeId: "SC-WH-MAIN" }],
  capabilities: ["workOrder.record.read", "workOrder.lifecycle.complete"],
  surfaces: ["operations.workOrders"],
  actions: [
    { objectKey: "workOrder", actionKey: "read", actionKind: "READ", capabilityKey: "workOrder.record.read",
      result: "CONDITIONAL", reasonCode: "RECORD_ASSIGNMENT_REQUIRED",
      sourceRoles: [{ roleKey: "technician", condition: RA_WO }], directGrant: null,
      withheldFromFlatSetKernels: true, surfaces: ["operations.workOrders"], workflowSource: null },
    { objectKey: "workOrder", actionKey: "dispatch", actionKind: "BUSINESS_ACTION", capabilityKey: "workOrder.lifecycle.dispatch",
      result: "DENIED", reasonCode: "CAPABILITY_MISSING", sourceRoles: [],
      directGrant: { label: "DIRECT_EXCEPTION", exceptionReason: "covering the parts desk this week", expiresAt: null, notEnforcedOnRoleOnlyRuntimePaths: true },
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
    { objectKey: "workOrder", actionKey: "complete", actionKind: "BUSINESS_ACTION", capabilityKey: "workOrder.lifecycle.complete",
      result: "ALLOWED", reasonCode: "ALLOWED", sourceRoles: [{ roleKey: "technician", condition: null }], directGrant: null,
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: [{ workflowKey: "workOrderLifecycle", version: 2, actionKey: "complete", roleKey: "technician" }] },
    { objectKey: "opportunity", actionKey: "edit", actionKind: "EDIT", capabilityKey: "opportunity.write",
      result: "DENIED", reasonCode: "CAPABILITY_MISSING", sourceRoles: [], directGrant: null,
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
    { objectKey: "invoice", actionKey: "issue", actionKind: "BUSINESS_ACTION", capabilityKey: "invoice.issue",
      result: "SOMETHING_NEW", reasonCode: "X", sourceRoles: [], directGrant: null,
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
  ],
};

describe("Effective Access: the server evaluator's answer, rendered", () => {
  it("renders result, reason code, source Role with condition, and flat-set withholding per Object x action", async () => {
    const api = makeApi();
    render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    expect(api.explainEffectiveAccess).toHaveBeenCalledWith("pr-1");
    const read = document.querySelector('[data-capability="workOrder.record.read"]');
    expect(read.getAttribute("data-result")).toBe("CONDITIONAL");
    expect(read.textContent).toMatch(/Conditional/);
    expect(read.textContent).toMatch(/RECORD_ASSIGNMENT_REQUIRED/);
    // Role keys are shown by display name (UI corrections item A): "technician" -> "Technician".
    expect(read.textContent).toMatch(/Technician · Condition: assigned Employee on the workOrder/);
    expect(read.textContent).toMatch(/Withheld from flat-set kernels/);
    const complete = document.querySelector('[data-capability="workOrder.lifecycle.complete"]');
    expect(complete.textContent).toMatch(/Allowed/);
    expect(complete.textContent).toMatch(/Workflow Work Order Lifecycle v2 · Complete via Technician/);
    // An action this person does not reach (Denied, no source) is shown only on request -- the server still answered for it.
    expect(document.querySelector('[data-capability="opportunity.write"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /All Catalog Actions \(5\)/ }));
    expect(document.querySelector('[data-capability="opportunity.write"]').textContent).toMatch(/Denied.*CAPABILITY_MISSING/);
    // An unknown result is shown RAW.
    expect(document.querySelector('[data-capability="invoice.issue"]').textContent).toMatch(/SOMETHING_NEW/);
  });

  it("labels a direct grant DIRECT EXCEPTION with its reason, expiry and non-enforcement -- beside the DENIED result", async () => {
    render(<EmployeeEffectiveAccess api={makeApi()} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    const dispatch = document.querySelector('[data-capability="workOrder.lifecycle.dispatch"]');
    expect(dispatch.getAttribute("data-result")).toBe("DENIED");
    const direct = dispatch.querySelector('[data-direct-grant="DIRECT_EXCEPTION"]');
    expect(direct.textContent).toMatch(/Direct Exception/);
    expect(direct.textContent).toMatch(/Reason: covering the parts desk this week/);
    expect(direct.textContent).toMatch(/Expires: never/);
    expect(direct.textContent).toMatch(/Not enforced on Role-only runtime paths/);
  });

  it("lists excluded assignments with their reason, and the principal's context", async () => {
    render(<EmployeeEffectiveAccess api={makeApi()} principalId="pr-1" />);
    const table = await screen.findByRole("table", { name: "Excluded assignments" });
    const stale = table.querySelector('[data-excluded-assignment="dispatcher"]');
    expect(stale.textContent).toMatch(/STALE/);
    const scoped = table.querySelector('[data-excluded-assignment="warehouseManager"]');
    expect(scoped.textContent).toMatch(/SCOPED/);
    expect(scoped.textContent).toMatch(/WAREHOUSE · SC-WH-MAIN/);
    // The principal's context is stated ONCE, in the resolved chain (deduplicated, UI corrections item D), in words.
    const chain = document.querySelector("[data-access-chain]");
    expect(chain.textContent).toMatch(/Technician/);
    expect(chain.textContent).toMatch(/Service Technician/);
    expect(chain.textContent).toMatch(/Warehouse SC-WH-MAIN/);
    expect(document.querySelector("[data-effective-access-context]").textContent).toMatch(/Access version 4 · 2 capabilities/);
    // Surfaces stay on the action rows that earn them.
    expect(document.querySelector('[data-capability="workOrder.record.read"]').textContent).toMatch(/operations\.workOrders/);
  });

  it("shows the SERVER's capability provenance -- Role, Direct, Role and Direct -- and record restrictions, computing none", async () => {
    const withProvenance = {
      ...EXPLAIN,
      actions: EXPLAIN.actions.map((a) => ({
        ...a,
        provenance: { "workOrder.record.read": "ROLE", "workOrder.lifecycle.dispatch": "DIRECT", "workOrder.lifecycle.complete": "ROLE_AND_DIRECT" }[a.capabilityKey] ?? "NONE",
      })),
    };
    render(<EmployeeEffectiveAccess api={makeApi({ explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: withProvenance })) })} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    expect(document.querySelector('[data-capability="workOrder.record.read"] [data-provenance]').getAttribute("data-provenance")).toBe("ROLE");
    expect(document.querySelector('[data-capability="workOrder.lifecycle.dispatch"] [data-provenance]').textContent).toMatch(/Direct Exception/);
    // ROLE_AND_DIRECT is reported once, never twice -- exactly the server's word for it.
    expect(document.querySelector('[data-capability="workOrder.lifecycle.complete"] [data-provenance]').textContent).toBe("Security Role and Direct Exception");
    expect(document.querySelector('[data-provenance-count="ROLE"]').textContent).toBe("1");
    expect(document.querySelector('[data-provenance-count="DIRECT"]').textContent).toBe("1");
    expect(document.querySelector('[data-provenance-count="ROLE_AND_DIRECT"]').textContent).toBe("1");
    // A record restriction (CONDITIONAL) is listed with its reason in words.
    const restrictions = screen.getByRole("table", { name: "Record restrictions" });
    expect(restrictions.querySelector('[data-restricted-capability="workOrder.record.read"]').textContent).toMatch(/Only records this person is assigned to or owns/);
  });

  it("a server that does not report provenance is said so -- nothing is inferred on the client", async () => {
    render(<EmployeeEffectiveAccess api={makeApi()} principalId="pr-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    expect(screen.getByText(/This server does not report provenance/)).toBeTruthy();
    expect(document.querySelector('[data-provenance-count="ROLE"]').textContent).toBe("0");
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

  it("the production seam sends explainEffectiveAccess { principalId } on the one endpoint", async () => {
    const call = vi.fn(async () => ({ ok: true, data: EXPLAIN }));
    const client = createAdminControlPlaneClient(call);
    const result = await client.explainEffectiveAccess("pr-1");
    expect(call).toHaveBeenCalledWith("explainEffectiveAccess", { principalId: "pr-1" });
    expect(result.data).toBe(EXPLAIN);
  });

  it("a payload that is not the contract's shape fails closed -- including the retired pre-contract shape", async () => {
    for (const data of [[{ id: "pr-1" }], { capabilities: [{ capabilityKey: "x", runtime: "ALLOWED", via: [] }] }]) {
      cleanup();
      const api = makeApi({ explainEffectiveAccess: vi.fn(async () => ({ ok: true, data })) });
      render(<EmployeeEffectiveAccess api={api} principalId="pr-1" />);
      await waitFor(() => expect(document.querySelector('[data-effective-access="UNREADABLE"]')).toBeTruthy());
    }
  });
});

// ════════════════════ the pure model and the seam ════════════════════

describe("control-plane model and seam", () => {
  it("builds the stored condition shape from the SERVER's kind specification", () => {
    const vocab = conditionVocabularyFrom(CONDITION_VOCABULARY);
    const spec = (k) => vocab.find((x) => x.kind === k);
    expect(buildCondition(spec("RECORD_ASSIGNMENT"), { recordKind: "workOrder" })).toEqual(RA_WO);
    expect(buildCondition(spec("OPERATIONAL_SCOPE"), { scopeType: "WAREHOUSE", scopeId: " wh-1 " })).toEqual({ paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: "wh-1" }]] });
    expect(buildCondition(spec("OPERATIONAL_SCOPE"), { scopeType: "REORDER_QUEUE" })).toEqual({ paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE" }]] });
    expect(buildCondition(spec("RECORD_ASSIGNMENT"), {})).toBeNull();
    expect(buildCondition(spec("TEAM"), {})).toBeNull();
    expect(buildCondition(null, {})).toBeNull();
    expect(describeCondition({ paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "A" }, { kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE" }], [{ kind: "WORK_ELIGIBILITY", qualificationCode: "B" }]] }))
      .toBe("Work Eligibility A AND Operational Scope WAREHOUSE OR Work Eligibility B");
  });

  it("the vocabulary is read from the server, and an unreadable one is null -- never a local default", () => {
    expect(conditionVocabularyFrom({ kinds: [{ kind: "X", supported: true }] })).toEqual([
      { kind: "X", label: "X", supported: true, why: undefined, parameters: [], capabilities: null },
    ]);
    expect(conditionVocabularyFrom(null)).toBeNull();
    expect(conditionVocabularyFrom({ kinds: [{ nope: 1 }] })).toBeNull();
    const model = readFileSync("src/modules/administration/controlPlaneModel.js", "utf8");
    for (const retired of ["CONDITION_KINDS", "RECORD_KINDS", "WORK_ELIGIBILITY_CODES", "OPERATIONAL_SCOPE_TYPES", "conditionKindsFor"]) {
      expect(model.includes(`export const ${retired}`) || model.includes(`export function ${retired}`), retired).toBe(false);
    }
  });

  it("unreadable payloads are null, never empty", () => {
    expect(matrixActionRows({ objectKey: "x" })).toBeNull();
    expect(explanationModel({})).toBeNull();
    expect(explanationModel({ actions: [] }).actions).toEqual([]);
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
