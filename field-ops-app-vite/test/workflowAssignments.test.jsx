import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminWorkflows from "../src/modules/administration/AdminWorkflows.jsx";
import { workflowBuilderHref } from "../src/domain/workflowPageLinks.js";

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });
const ok = (data) => Promise.resolve({ ok: true, data });
function fixture({ status = "PUBLISHED", capability = "workOrder.accept", valid = true } = {}) {
  const workflow = { id: "wf-wo", key: "workOrder", name: "Technician / Work Order", objectKey: "workOrder", activeVersionId: status === "PUBLISHED" ? "v1" : null };
  const version = { id: "v1", version: 1, status };
  const steps = [{ key: "READY", label: "Ready", initial: true }, { key: "ACCEPTED", label: "Accepted", terminal: true }];
  const actions = [{ key: "accept", label: "Accept", from: "READY", to: "ACCEPTED", capabilityKey: capability,
    guardKind: "RECORD_ASSIGNMENT", roleKeys: ["tech", "dispatcher"], functionalRoleKeys: ["fieldService"] }];
  return {
    listWorkflows: vi.fn(() => ok([{ workflow, versions: [version] }])),
    readWorkflowVersion: vi.fn(() => ok({ workflow, version, steps, actions, active: status === "PUBLISHED" })),
    listRoles: vi.fn(() => ok([{ id: "rt", key: "tech", name: "Technician" }, { id: "rd", key: "dispatcher", name: "Dispatcher" }])),
    getSecurityRoleDetail: vi.fn(() => ok({ holders: [{ assignmentId: "a1", employeeId: "e1", displayName: "Pat Tech", scopeType: "global" }] })),
    validateUnsavedDefinition: vi.fn(() => ok({ valid, errors: valid ? [] : [{ code: "BINDING_WITHOUT_CAPABILITY" }] })),
    updateWorkflowDefinition: vi.fn(() => ok({ version: { id: "v2", version: 2, status: "DRAFT" } })),
    createWorkflowVersion: vi.fn(() => ok({ version: { id: "v2", version: 2, status: "DRAFT" } })),
    publishWorkflowVersion: vi.fn(), activateWorkflowVersion: vi.fn(), retireWorkflowVersion: vi.fn(),
    validateWorkflowVersion: vi.fn(() => ok({ valid: true, errors: [], warnings: [] })),
    listWorkflowInstances: vi.fn(() => ok([])), readWorkflowHistory: vi.fn(() => ok([])),
  };
}
async function open(api) {
  render(<AdminWorkflows api={api} />);
  await screen.findByRole("option", { name: /Technician \/ Work Order/ });
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "wf-wo" } });
  await screen.findByRole("button", { name: "Remove Dispatcher" });
  await screen.findByRole("button", { name: "Remove Technician" });
}
describe("Workflow Assignments and Builder separation", () => {
  it("keeps definition diagnostics, lifecycle and state editing off the main page; reveals role holders on demand", async () => {
    const api = fixture(); await open(api);
    expect(screen.getByRole("heading", { name: "Workflow Assignments" })).toBeTruthy();
    expect(screen.queryByLabelText("Reason for the workflow change")).toBeNull();
    expect(screen.queryByRole("table", { name: "Editable states" })).toBeNull();
    expect(api.validateWorkflowVersion).not.toHaveBeenCalled();
    expect(api.getSecurityRoleDetail).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View Technician employees" }));
    await waitFor(() => expect(api.getSecurityRoleDetail).toHaveBeenCalledWith("tech"));
    expect(await screen.findByRole("link", { name: "Pat Tech" })).toBeTruthy();
  });
  it("preserves states, capabilities, guards and Functional Roles; saves published assignment changes as an inactive draft", async () => {
    const api = fixture(); await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "Technicians accept work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    await screen.findByText(/Assignment draft saved/);
    expect(api.createWorkflowVersion).toHaveBeenCalledTimes(1);
    expect(api.createWorkflowVersion.mock.calls[0][0]).toMatchObject({ workflowId: "wf-wo", reason: "Technicians accept work", definition: {
      actions: [{ key: "accept", from: "READY", to: "ACCEPTED", capabilityKey: "workOrder.accept", guardKind: "RECORD_ASSIGNMENT", requiresOwnAssignment: true, roleKeys: ["tech"], functionalRoleKeys: ["fieldService"] }],
    } });
    expect(api.updateWorkflowDefinition).not.toHaveBeenCalled();
    expect(api.publishWorkflowVersion).not.toHaveBeenCalled();
    expect(api.activateWorkflowVersion).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Review and activate in Workflow Builder" }).getAttribute("href")).toBe(workflowBuilderHref({ key: "workOrder" }, "v2"));
  });
  it("does not save invalid assignments or ask administrators to repair missing permission mappings on the main page", async () => {
    const api = fixture({ valid: false }); await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(api.createWorkflowVersion).not.toHaveBeenCalled();
    cleanup();
    const incomplete = fixture({ status: "DRAFT", capability: null }); await open(incomplete);
    expect(screen.queryByRole("button", { name: "Save Assignment Draft" })).toBeNull();
    expect(screen.getByText(/not ready for assignment changes/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Dispatcher" }).disabled).toBe(true);
  });
  it("opens Builder as a separate page with the workflow and version deep link", async () => {
    window.history.replaceState({}, "", workflowBuilderHref({ key: "workOrder" }, "v1"));
    render(<AdminWorkflows api={fixture()} />);
    expect(screen.getByRole("heading", { name: "Workflow Builder" })).toBeTruthy();
    await screen.findByRole("table", { name: "States" });
    expect(screen.queryByLabelText("Reason for assignment changes")).toBeNull();
  });
  it("saves draft assignments through the existing edit command and preserves a server refusal", async () => {
    const api = fixture({ status: "DRAFT" });
    api.updateWorkflowDefinition.mockImplementation(() => Promise.resolve({ ok: false, code: "FORBIDDEN", message: "workflow editing is not allowed" }));
    await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    expect(screen.getByRole("button", { name: "Save Assignment Draft" }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "Role correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("FORBIDDEN");
    expect(api.updateWorkflowDefinition).toHaveBeenCalledTimes(1);
    expect(api.createWorkflowVersion).not.toHaveBeenCalled();
    expect(api.updateWorkflowDefinition.mock.calls[0][0].definition.steps).toEqual([
      { key: "READY", label: "Ready", initial: true, terminal: false },
      { key: "ACCEPTED", label: "Accepted", initial: false, terminal: true },
    ]);
  });
  it("protects unsaved assignments when opening Builder; Keep Editing preserves the changes", async () => {
    const api = fixture(); await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    fireEvent.click(screen.getAllByRole("link", { name: "Open Workflow Builder" })[0]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Dispatcher" })).toBeNull();
    expect(api.createWorkflowVersion).not.toHaveBeenCalled();
  });
  it("retains the saved confirmation when reloading a workflow with no active version", async () => {
    const api = fixture({ status: "DRAFT" });
    const initial = await api.listWorkflows();
    api.listWorkflows.mockResolvedValueOnce(initial).mockResolvedValue({ ok: true, data: [{
      ...initial.data[0], versions: [...initial.data[0].versions, { id: "v2", version: 2, status: "DRAFT" }],
    }] });
    await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "Role correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    await screen.findByText(/Assignment draft saved/);
    await waitFor(() => expect(api.listWorkflows).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("link", { name: "Review and activate in Workflow Builder" }).getAttribute("href")).toContain("version=v2");
    expect(api.readWorkflowVersion).toHaveBeenCalledTimes(1);
  });
  it("guards global navigation and browser reload while assignments are unsaved", async () => {
    const api = fixture();
    const rail = document.createElement("a"); rail.href = "/administration/roles"; rail.textContent = "Global roles"; document.body.append(rail);
    try {
      await open(api);
      fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
      fireEvent.click(rail);
      expect(await screen.findByRole("dialog")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
      expect(screen.queryByRole("button", { name: "Remove Dispatcher" })).toBeNull();
    } finally { rail.remove(); }
  });
  it("preserves a legacy own-assignment guard even if the read has no guardKind", async () => {
    const api = fixture();
    const read = await api.readWorkflowVersion();
    delete read.data.actions[0].guardKind;
    read.data.actions[0].requiresOwnAssignment = true;
    api.readWorkflowVersion.mockResolvedValue(read);
    await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Dispatcher" }));
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "Preserve assignment requirement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    await screen.findByText(/Assignment draft saved/);
    expect(api.createWorkflowVersion.mock.calls[0][0].definition.actions[0]).toMatchObject({
      guardKind: "RECORD_ASSIGNMENT", requiresOwnAssignment: true,
    });
  });
});

// W01 rendered acceptance (2026-10-09): defects found in the browser at 2cdf8ab3, pinned here.
describe("W01 acceptance corrections", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("F1: page links carry the app base path (a bare /administration link leaves an app served under a base)", async () => {
    vi.stubEnv("BASE_URL", "/Taylor_Parts/field-ops/");
    const { workflowBuilderHref: builder, workflowAssignmentsHref, appHref } = await import("../src/domain/workflowPageLinks.js");
    expect(builder({ key: "workOrder" }, "v2")).toBe("/Taylor_Parts/field-ops/administration/workflows?view=builder&workflow=workOrder&version=v2");
    expect(workflowAssignmentsHref({ key: "workOrder" })).toBe("/Taylor_Parts/field-ops/administration/workflows?workflow=workOrder");
    expect(appHref("/administration/users/e1")).toBe("/Taylor_Parts/field-ops/administration/users/e1");
    const api = fixture(); await open(api);
    expect(screen.getAllByRole("link", { name: "Open Workflow Builder" })[0].getAttribute("href")).toMatch(/^\/Taylor_Parts\/field-ops\/administration\/workflows\?view=builder/);
  });
  it("F2: choosing a workflow is kept in the address without adding a history entry", async () => {
    const before = window.history.length;
    const api = fixture(); await open(api);
    expect(new URLSearchParams(window.location.search).get("workflow")).toBe("workOrder");
    expect(window.history.length).toBe(before);
  });
  it("F4: a refused validation says why, in the server's words", async () => {
    const api = fixture();
    api.validateUnsavedDefinition = vi.fn(() => ok({ valid: false, errors: [{ code: "BINDING_WITHOUT_CAPABILITY",
      message: 'Role "dispatcher" is bound to "accept" but does not hold "workOrder.accept"; a binding never grants' }] }));
    await open(api);
    fireEvent.click(screen.getByRole("button", { name: "Remove Technician" }));
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "Dispatch accepts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Assignment Draft" }));
    expect(await screen.findByText(/cannot be saved: Role "dispatcher" is bound to "accept" but does not hold/)).toBeTruthy();
    expect(api.createWorkflowVersion).not.toHaveBeenCalled();
    expect(api.updateWorkflowDefinition).not.toHaveBeenCalled();
  });
});
