// Administration control plane (#210): every view draws the SERVER's state and re-reads after a governed change.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkforceRoster from "../src/modules/administration/WorkforceRoster.jsx";
import ObjectAuthorityMatrix, { objectAuthorityGrid } from "../src/modules/administration/ObjectAuthorityMatrix.jsx";
import EmployeeExperiencePreview from "../src/modules/administration/EmployeeExperiencePreview.jsx";
import WorkflowWork from "../src/modules/workspace/WorkflowWork.jsx";

const ROSTER = { total: 2, truncated: false, securityRolesWithheld: null,
  facets: { jobRoles: [{ id: "service-technician", label: "Service Technician", count: 1 }, { id: "retail-sales", label: "Retail Sales", count: 1 }],
    securityRoles: [{ roleKey: "technician", name: "Technician", count: 1 }, { roleKey: "salesManager", name: "Sales Manager", count: 1 }], operatingCompanies: [{ id: "taylor", count: 2 }], statuses: [{ status: "ACTIVE", count: 2 }] },
  items: [
    { employeeId: "e-tech", displayName: "Sofia Alvarez", employeeNumber: "SMP-1", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", jobRole: { id: "service-technician", label: "Service Technician" },
      securityRoles: [{ roleKey: "technician", name: "Technician", scopeType: "global", scopeValue: null }], operationalScopes: [{ scopeType: "MOBILE", scopeId: "taylor-truck-04", label: "Service Truck 04" }],
      workEligibility: ["SERVICE_TECHNICIAN"], manager: { employeeId: "e-sm", displayName: "Alex Romero" }, applicationUser: "LINKED", principalId: "p-tech" },
    { employeeId: "e-lead", displayName: "Dana Whitfield", employeeNumber: "SMP-2", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", jobRole: { id: "retail-sales", label: "Retail Sales" },
      securityRoles: [{ roleKey: "salesManager", name: "Sales Manager", scopeType: "salesChannel", scopeValue: "RETAIL" }], operationalScopes: [], workEligibility: [], manager: null, applicationUser: "LINKED", principalId: "p-lead" },
  ] };

describe("WorkforceRoster", () => {
  it("shows Job Role, scoped Security Roles, truck and manager per employee, with counts from the read; filters go to the server", async () => {
    const call = vi.fn(async () => ({ ok: true, result: ROSTER }));
    const { container } = render(<MemoryRouter><WorkforceRoster workforce={{ call }} /></MemoryRouter>);
    await screen.findByText("Sofia Alvarez");
    expect(container.textContent).toMatch(/Service Technician 1 · Retail Sales 1/);
    expect(container.textContent).toMatch(/Sales Manager @ Retail/);
    expect(container.textContent).toMatch(/Truck: Service Truck 04/);
    expect(container.textContent).toMatch(/Alex Romero/);
    fireEvent.change(screen.getByLabelText("Job Role"), { target: { value: "service-technician" } });
    await waitFor(() => expect(call).toHaveBeenLastCalledWith("listWorkforceRoster", { jobRoleId: "service-technician" }));
  });
  it("says the Security Role column is withheld rather than showing it empty", async () => {
    const call = vi.fn(async () => ({ ok: true, result: { ...ROSTER, securityRolesWithheld: "Security Roles are shown only to holders of admin.principalAccess.read",
      facets: { ...ROSTER.facets, securityRoles: null }, items: ROSTER.items.map((i) => ({ ...i, securityRoles: null })) } }));
    const { container } = render(<MemoryRouter><WorkforceRoster workforce={{ call }} /></MemoryRouter>);
    await screen.findByText("Sofia Alvarez");
    expect(container.textContent).toMatch(/shown only to holders of admin.principalAccess.read/);
    expect(screen.queryByLabelText("Security Role")).toBeNull();
  });
});

const MATRIX = { objectKey: "account", label: "Accounts", actions: [
  { actionKey: "read", actionKind: "READ", displayLabel: "View Customers", capabilityKey: "customer.record.read", roles: [{ roleKey: "salesperson", held: true, source: "SYSTEM_DEFAULT" }], principals: [] },
  { actionKey: "editGovernedField", actionKind: "BUSINESS_ACTION", displayLabel: "Edit Governed Customer Fields", capabilityKey: "customer.governedField.write", roles: [{ roleKey: "technician", held: false, source: "SYSTEM_INVARIANT" }], principals: [] }] };
const ROLES = [{ key: "salesperson", name: "Salesperson" }, { key: "technician", name: "Technician" }];

describe("ObjectAuthorityMatrix", () => {
  it("draws the server's grants: CRUD and domain/field actions as columns, invariants locked", () => {
    const g = objectAuthorityGrid(MATRIX, ROLES);
    expect(g.actions.map((a) => a.kindWords)).toEqual(["Read", "Action"]);
    expect(g.rows.find((r) => r.key === "salesperson").cells.map((c) => c.held)).toEqual([true, false]);
    expect(g.rows.find((r) => r.key === "technician").cells[1].locked).toBe(true);
  });
  it("a checkbox click sends the governed grant with the stated reason and RE-READS; no reason, no request", async () => {
    let held = false;
    const api = {
      listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [{ key: "account", label: "Accounts", actions: MATRIX.actions }] })),
      getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: { ...MATRIX, actions: MATRIX.actions.map((a) => (a.actionKey === "read" ? { ...a, roles: [{ roleKey: "technician", held, source: held ? "ADMIN_GRANTED" : null }] } : a)) } })),
      listRoles: vi.fn(async () => ({ ok: true, data: ROLES })),
      grantObjectActionToRole: vi.fn(async () => { held = true; return { ok: true, data: {} }; }),
      revokeObjectActionFromRole: vi.fn(async () => ({ ok: true, data: null })),
    };
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="account" />);
    const box = await screen.findByLabelText("Technician — View Customers (customer.record.read)");
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await screen.findByText(/State the reason/);
    expect(api.grantObjectActionToRole).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason for changes (recorded in the audit trail)"), { target: { value: "technicians read customers" } });
    fireEvent.click(box);
    await waitFor(() => expect(api.grantObjectActionToRole).toHaveBeenCalledWith({ objectKey: "account", actionKey: "read", roleKey: "technician", reason: "technicians read customers" }));
    await waitFor(() => expect(screen.getByLabelText("Technician — View Customers (customer.record.read)").checked).toBe(true));
    expect(api.getObjectActionGrantMatrix.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Technician — Edit Governed Customer Fields (customer.governedField.write)").disabled).toBe(true);
  });
});

describe("EmployeeExperiencePreview", () => {
  it("is visibly a read-only PREVIEW of the server's resolution, read ONCE per open (no render loop), with no workflow actions", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: { preview: true, readOnly: true, auditEventId: "audit_1", subject: { securityRoleKeys: ["technician"] }, capabilities: ["x"], scopedHeld: [],
      work: { me: { displayName: "Sofia Alvarez", jobRole: { label: "Service Technician" } }, persona: { key: "service-technician", label: "Technician", analysisArea: null }, operatingCompanyId: null,
        sections: [{ key: "assignedWork", title: "Work assigned to me", status: "READY", reason: null, count: 1, items: [{ id: "w1", kind: "workOrder", label: "WO-1", detail: "PM", status: "SCHEDULED", path: "/x", action: { assignee: "Sofia Alvarez" } }] }] } } }));
    render(<MemoryRouter><EmployeeExperiencePreview employeeId="e-tech" callApi={callApi} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "View as user (preview)" }));
    await screen.findByText(/PREVIEW — read-only/);
    await screen.findByText("WO-1");
    await new Promise((r) => setTimeout(r, 50));
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledWith("previewMyWorkAs", expect.objectContaining({ employeeId: "e-tech" }));
    expect(screen.queryByText("Workflow work")).toBeNull();
  });
});

describe("WorkflowWork", () => {
  it("offers only the engine-allowed action; shows the refusal for the rest; advancing re-reads", async () => {
    let step = "DRAFT";
    const callApi = vi.fn(async (op) => (op === "listWorkflowWork"
      ? { ok: true, result: { total: 1, truncated: false, items: step === "DRAFT" ? [{ workflowKey: "salesAgreement", workflowName: "Sales — Agreement", objectKey: "salesAgreement", recordId: "sa-1", currentStepKey: "DRAFT", currentStepLabel: "Draft",
        actions: [{ actionKey: "accept", label: "Record customer acceptance", allowed: true, refusal: null }, { actionKey: "decline", label: "Record customer decline", allowed: false, refusal: "notBoundToRole" }] }] : [] } }
      : (step = "ACCEPTED", { ok: true, result: { currentStepKey: "ACCEPTED" } })));
    render(<WorkflowWork callApi={callApi} />);
    fireEvent.click(await screen.findByRole("button", { name: "Record customer acceptance" }));
    expect(screen.queryByRole("button", { name: "Record customer decline" })).toBeNull();
    await waitFor(() => expect(callApi).toHaveBeenCalledWith("transitionWorkflowInstance", expect.objectContaining({ objectKey: "salesAgreement", recordId: "sa-1", actionKey: "accept" })));
    await waitFor(() => expect(callApi.mock.calls.filter((c) => c[0] === "listWorkflowWork").length).toBe(2));
  });
});

import { composeTruckFleet } from "../src/domain/truckRegistry.js";
describe("Truck technician relationship (#210)", () => {
  it("names the governed MOBILE-scope technicians instead of 'Unassigned'; no driver is inferred", () => {
    const fleet = composeTruckFleet({
      mobileLocations: [{ docId: "taylor-truck-04", data: { type: "MOBILE", locationId: "taylor-truck-04", displayLabel: "Service Truck 04", active: true } }],
      trucks: [{ docId: "svc-04", data: { truckId: "svc-04", locationId: "taylor-truck-04", vehicleNumber: "T-104", displayLabel: "Service Truck 04", status: "ACTIVE", homeWarehouseId: "taylor-service", assignedDriverEmployeeId: null, scopedTechnicianNames: ["Sofia Alvarez"] } }],
      resolveDriverName: () => null,
    });
    const trucks = fleet.trucks ?? fleet.summaries ?? fleet;
    expect(trucks[0].technician).toBe("Sofia Alvarez");
  });
});
