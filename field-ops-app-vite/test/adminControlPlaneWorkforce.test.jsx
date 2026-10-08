// Administration control plane (#210): every view draws the SERVER's state and re-reads after a governed change.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkforceRoster from "../src/modules/administration/WorkforceRoster.jsx";
import ObjectAuthorityMatrix, { objectAuthorityGrid, bulkPlan } from "../src/modules/administration/ObjectAuthorityMatrix.jsx";
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
    // READ-ONLY until the explicit governed editing interaction (UI corrections matrix redesign).
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    const box = await screen.findByLabelText("Technician — View Customers (customer.record.read)");
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await screen.findByText(/State the reason/);
    expect(api.grantObjectActionToRole).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason for Changes (Recorded in the Audit Trail)"), { target: { value: "technicians read customers" } });
    fireEvent.click(box);
    await waitFor(() => expect(api.grantObjectActionToRole).toHaveBeenCalledWith({ objectKey: "account", actionKey: "read", roleKey: "technician", reason: "technicians read customers" }));
    await waitFor(() => expect(screen.getByLabelText("Technician — View Customers (customer.record.read)").checked).toBe(true));
    expect(api.getObjectActionGrantMatrix.mock.calls.length).toBeGreaterThanOrEqual(2);
    // A platform-invariant cell is NOT a control at all, even in Edit mode: it is stated as Not Available.
    expect(screen.queryByRole("checkbox", { name: "Technician — Edit Governed Customer Fields (customer.governedField.write)" })).toBeNull();
    expect(screen.getByRole("img", { name: "Technician — Edit Governed Customer Fields (customer.governedField.write): Not Available" })).toBeTruthy();
  });
});

// ════════ THE REDESIGNED PERMISSIONS MATRIX (UI corrections package, 2026-10-08) ════════
const BIG = { objectKey: "workOrder", label: "Work Orders", actions: [
  { actionKey: "create", actionKind: "CREATE", displayLabel: "Create Work Order", capabilityKey: "workOrder.create", roles: [{ roleKey: "generalManager", held: true, source: "SYSTEM_DEFAULT" }], principals: [] },
  { actionKey: "read", actionKind: "READ", displayLabel: "View Work Orders", capabilityKey: "workOrder.record.read", roles: [{ roleKey: "generalManager", held: true, source: "SYSTEM_DEFAULT", condition: { kind: "isOwnAssignment" } }], principals: [] },
  { actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch Work Order", capabilityKey: "workOrder.lifecycle.dispatch", roles: [], principals: [{ principalId: "p" }] },
  { actionKey: "issueSchedulingLink", actionKind: "BUSINESS_ACTION", displayLabel: "Issue Customer Scheduling Link", capabilityKey: "workOrder.selfScheduling.issue", roles: [{ roleKey: "generalManager", held: false, source: "SYSTEM_INVARIANT" }], principals: [] },
] };
const BIG_ROLES = [{ key: "generalManager", name: "General Manager" }, { key: "fieldManager", name: "Service Manager", protected: false }];
const bigApi = (over = {}) => ({
  listObjectsWithActions: vi.fn(async () => ({ ok: true, data: [{ key: "workOrder", label: "Work Orders", actions: BIG.actions }] })),
  getObjectActionGrantMatrix: vi.fn(async () => ({ ok: true, data: BIG })),
  listRoles: vi.fn(async () => ({ ok: true, data: BIG_ROLES })),
  grantObjectActionToRole: vi.fn(), revokeObjectActionFromRole: vi.fn(),
  applyObjectWideRoleAuthority: vi.fn(async ({ mode }) => ({ ok: true, data: { actions: [
    { actionKey: "dispatch", outcome: mode === "GRANT" ? "GRANTED" : "NOT_HELD", refusal: null },
    { actionKey: "create", outcome: mode === "GRANT" ? "ALREADY_HELD" : "REVOKED", refusal: null },
    { actionKey: "issueSchedulingLink", outcome: "REFUSED", refusal: "SYSTEM_INVARIANT: never grantable" }] } })),
  ...over,
});
const MUTATIONS = ["grantObjectActionToRole", "revokeObjectActionFromRole", "applyObjectWideRoleAuthority"];

describe("Objects → Permissions matrix (redesign)", () => {
  it("opens READ-ONLY: human role names (no keys), three distinct states with labels, sticky role column and header, no controls", async () => {
    const api = bigApi();
    const { container } = render(<ObjectAuthorityMatrix api={api} initialObjectKey="workOrder" />);
    const table = await screen.findByRole("table", { name: "Work Orders authority by Security Role" });
    expect(container.querySelector('[data-objmatrix-mode="READ"]')).toBeTruthy();
    expect(within(table).getByRole("rowheader", { name: "General Manager" })).toBeTruthy();
    expect(table.textContent).not.toMatch(/generalManager|fieldManager/);
    expect(within(table).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(table).queryByRole("button", { name: /Actions for/ })).toBeNull();
    expect(screen.getByRole("img", { name: "General Manager — Create Work Order (workOrder.create): Granted" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "General Manager — View Work Orders (workOrder.record.read): Granted (Conditional)" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "General Manager — Dispatch Work Order (workOrder.lifecycle.dispatch): Not Granted" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "General Manager — Issue Customer Scheduling Link (workOrder.selfScheduling.issue): Not Available" })).toBeTruthy();
    // Short column labels keep the full name and capability reachable (title + screen-reader text + the column legend).
    const dispatchHead = container.querySelector('th[data-action="issueSchedulingLink"]');
    expect(dispatchHead.textContent).toMatch(/Issue Scheduling Link/);
    expect(dispatchHead.getAttribute("title")).toBe("Issue Customer Scheduling Link — Action (workOrder.selfScheduling.issue)");
    expect(within(container.querySelector(".fo-objmatrix__columns")).getByText("workOrder.selfScheduling.issue")).toBeTruthy();
    expect(table.querySelector("thead th.fo-objmatrix__rolehead")).toBeTruthy();
    expect(table.querySelector("tbody th.fo-objmatrix__role")).toBeTruthy();
    // Every row and every column align: one cell per action per Role.
    for (const row of table.querySelectorAll("tbody tr")) expect(row.querySelectorAll("td").length).toBe(BIG.actions.length);
    MUTATIONS.forEach((m) => expect(api[m]).not.toHaveBeenCalled());
  });

  it("Edit Permissions is explicit; each Role gets ONE compact Actions menu (keyboard operable) instead of Grant all / Revoke all buttons", async () => {
    render(<ObjectAuthorityMatrix api={bigApi()} initialObjectKey="workOrder" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    expect(screen.queryByRole("button", { name: /Grant all|Revoke all/i })).toBeNull();
    expect(screen.queryByText(/Whole object/i)).toBeNull();
    const menuButton = screen.getByRole("button", { name: "Actions for General Manager" });
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.keyDown(menuButton, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu", { name: "Actions for General Manager" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Grant All Listed Actions…", "Revoke All Listed Actions…"]);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "Done Editing" }));
    expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
  });

  it("a bulk grant CONFIRMS first, naming exactly the capabilities that will change; Cancel writes nothing", async () => {
    const api = bigApi();
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="workOrder" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for General Manager" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Grant All Listed Actions…" }));
    const dialog = await screen.findByRole("dialog");
    // Exactly the one grantable, not-held capability; held ones are "Unchanged", the invariant one "Not available".
    expect([...dialog.querySelectorAll("[data-plan-change]")].map((e) => e.getAttribute("data-plan-change"))).toEqual(["workOrder.lifecycle.dispatch"]);
    expect(dialog.textContent).toMatch(/Unchanged: Create Work Order, View Work Orders\./);
    expect(dialog.textContent).toMatch(/Not available \(platform invariant\): Issue Customer Scheduling Link\./);
    expect(dialog.textContent).toMatch(/It is not unrestricted authority: actions added to this Object later are not included/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    MUTATIONS.forEach((m) => expect(api[m]).not.toHaveBeenCalled());
  });

  it("confirming requires a reason, sends ONE governed applyObjectWideRoleAuthority with it, re-reads, and states each outcome", async () => {
    const api = bigApi();
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="workOrder" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for General Manager" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Revoke All Listed Actions…" }));
    const dialog = await screen.findByRole("dialog");
    expect([...dialog.querySelectorAll("[data-plan-change]")].map((e) => e.getAttribute("data-plan-change"))).toEqual(["workOrder.create", "workOrder.record.read"]);
    const confirm = within(dialog).getByRole("button", { name: "Revoke 2" });
    await act(async () => { fireEvent.click(confirm); });
    expect(api.applyObjectWideRoleAuthority).not.toHaveBeenCalled(); // no reason, no request
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "GM no longer edits work orders" } });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(() => expect(api.applyObjectWideRoleAuthority).toHaveBeenCalledWith({ objectKey: "workOrder", roleKey: "generalManager", mode: "REVOKE", reason: "GM no longer edits work orders" }));
    expect(await screen.findByText(/Revoked listed actions for General Manager:/)).toBeTruthy();
    expect(screen.getByText(/Issue Scheduling Link: SYSTEM_INVARIANT: never grantable/)).toBeTruthy();
    expect(api.getObjectActionGrantMatrix.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a server refusal of the whole bulk change is shown verbatim, and nothing is assumed to have changed", async () => {
    const api = bigApi({ applyObjectWideRoleAuthority: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "not authorized: \"admin.securityPolicy.write\" is required" })) });
    render(<ObjectAuthorityMatrix api={api} initialObjectKey="workOrder" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Permissions" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for General Manager" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Grant All Listed Actions…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "try it" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Grant 1" })); });
    expect(await screen.findByText(/admin\.securityPolicy\.write/)).toBeTruthy();
    // Still in Edit mode: the cell is the server's state after the re-read -- unchanged, unchecked.
    expect(screen.getByRole("checkbox", { name: "General Manager — Dispatch Work Order (workOrder.lifecycle.dispatch)" }).checked).toBe(false);
  });

  it("bulkPlan is a pure reading of the grants just read: change / unchanged / unavailable", () => {
    const grid = objectAuthorityGrid(BIG, BIG_ROLES);
    const grant = bulkPlan(grid, "generalManager", "GRANT");
    expect(grant.change.map((a) => a.capabilityKey)).toEqual(["workOrder.lifecycle.dispatch"]);
    expect(grant.unavailable.map((a) => a.capabilityKey)).toEqual(["workOrder.selfScheduling.issue"]);
    const revoke = bulkPlan(grid, "fieldManager", "REVOKE");
    expect(revoke.change).toEqual([]);
  });
});

describe("EmployeeExperiencePreview", () => {
  it("is visibly a read-only PREVIEW of the server's resolution, read ONCE per open (no render loop), with no workflow actions", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: { preview: true, readOnly: true, auditEventId: "audit_1", subject: { securityRoleKeys: ["technician"] }, capabilities: ["x"], scopedHeld: [],
      work: { me: { displayName: "Sofia Alvarez", jobRole: { label: "Service Technician" } }, persona: { key: "service-technician", label: "Technician", analysisArea: null }, operatingCompanyId: null,
        sections: [{ key: "assignedWork", title: "Work assigned to me", status: "READY", reason: null, count: 1, items: [{ id: "w1", kind: "workOrder", label: "WO-1", detail: "PM", status: "SCHEDULED", path: "/x", action: { assignee: "Sofia Alvarez" } }] }] } } }));
    render(<MemoryRouter><EmployeeExperiencePreview employeeId="e-tech" callApi={callApi} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "View as User (Preview)" }));
    await screen.findByText(/PREVIEW — read-only/);
    await screen.findByText("WO-1");
    await new Promise((r) => setTimeout(r, 50));
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(callApi).toHaveBeenCalledWith("previewMyWorkAs", expect.objectContaining({ employeeId: "e-tech" }));
    expect(screen.queryByText("Workflow Work")).toBeNull();
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
