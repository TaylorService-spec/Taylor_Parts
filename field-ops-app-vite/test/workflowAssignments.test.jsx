import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminWorkflows from "../src/modules/administration/AdminWorkflows.jsx";
import { workflowBuilderHref } from "../src/domain/workflowPageLinks.js";

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });
const ok = (data) => Promise.resolve({ ok: true, data });
const OPERATIONS = ["createWorkflowDraft", "createWorkflowVersion", "updateWorkflowDefinition", "setWorkflowRoleBinding", "publishWorkflowVersion",
  "activateWorkflowVersion", "retireWorkflowVersion", "startWorkflowInstance", "adoptRecordsIntoWorkflowVersion", "migrateWorkflowInstances"];
const decisions = (allowed) => ({ operations: Object.fromEntries(OPERATIONS.map((op) => [op, {
  allowed: allowed.includes(op), requiredCapability: op === "updateWorkflowDefinition" ? "workflowDefinition.edit" : "workflowDefinition.version",
  requiredLabel: op === "updateWorkflowDefinition" ? "Edit Workflow Definitions" : "Version Workflows" }])) });
function fixture({ status = "PUBLISHED", capability = "workOrder.accept", valid = true, allowed = OPERATIONS,
  eligible = [{ key: "dispatcher", name: "Dispatcher" }, { key: "tech", name: "Technician" }] } = {}) {
  const workflow = { id: "wf-wo", key: "workOrder", name: "Technician / Work Order", objectKey: "workOrder", activeVersionId: status === "PUBLISHED" ? "v1" : null };
  const version = { id: "v1", version: 1, status };
  const steps = [{ key: "READY", label: "Ready", initial: true }, { key: "ACCEPTED", label: "Accepted", terminal: true }];
  const actions = [{ key: "accept", label: "Accept", from: "READY", to: "ACCEPTED", capabilityKey: capability,
    guardKind: "RECORD_ASSIGNMENT", roleKeys: ["tech", "dispatcher"], functionalRoleKeys: ["fieldService"] }];
  return {
    listWorkflows: vi.fn(() => ok([{ workflow, versions: [version] }])),
    readWorkflowVersion: vi.fn(() => ok({ workflow, version, steps, active: status === "PUBLISHED",
      actions: actions.map((a) => ({ ...a, eligibleRoles: capability ? eligible : null })),
      roleNames: { tech: "Technician", dispatcher: "Dispatcher", ...Object.fromEntries(eligible.map((r) => [r.key, r.name])) } })),
    readMyWorkflowAdministration: vi.fn(() => ok(decisions(allowed))),
    listRoles: vi.fn(() => ok([{ id: "rt", key: "tech", name: "Technician" }, { id: "rd", key: "dispatcher", name: "Dispatcher" }])),
    getSecurityRoleDetail: vi.fn(() => ok({ holders: [] })), // no longer used by Assignments (W01 holder lookup)
    listWorkflowActionRoleHolders: vi.fn(() => ok({ roleKey: "tech", roleName: "Technician", actionKey: "accept", roleEligible: true, roleBound: true,
      totalHolders: 2, holdersForAction: 1, employeeVisibility: "EMPLOYEE_READ", truncated: false,
      holders: [{ displayName: "Pat Tech", employeeId: "e1", scope: { type: "global", value: null }, appliesToAction: true, notApplicableReason: null },
        { displayName: "Lee Scoped", employeeId: "e2", scope: { type: "operatingCompany", value: "taylor" }, appliesToAction: false, notApplicableReason: "SCOPE_DOES_NOT_DECIDE" }] })),
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
    expect(api.listWorkflowActionRoleHolders).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View Technician employees" }));
    await waitFor(() => expect(api.listWorkflowActionRoleHolders).toHaveBeenCalledWith({ versionId: "v1", actionKey: "accept", roleKey: "tech" }));
    expect(await screen.findByRole("link", { name: "Pat Tech" })).toBeTruthy();
    expect(api.getSecurityRoleDetail).not.toHaveBeenCalled();
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

// W01 D2/D3 (2026-10-09): assignments are offered from the workflow read itself, and only on the caller's own decision.
describe("Workflow Assignments -- eligible Roles and the caller's own decision (W01 D2/D3)", () => {
  it("D3: offers only the Roles that hold the action's permission, without asking for the Security Policy", async () => {
    const api = fixture({ eligible: [{ key: "tech", name: "Technician" }, { key: "dispatcher", name: "Dispatcher" }, { key: "lead", name: "Field Lead" }] });
    api.listRoles = vi.fn(() => ok([]));
    await open(api);
    const input = screen.getByRole("combobox", { name: "Accept Security Roles" });
    fireEvent.change(input, { target: { value: "l" } });
    expect(await screen.findByRole("option", { name: /Field Lead/ })).toBeTruthy();
    expect(api.listRoles).not.toHaveBeenCalled();
  });
  it("D3: a bound Role that does not hold the permission is shown and explained, never removed silently", async () => {
    const api = fixture({ eligible: [{ key: "tech", name: "Technician" }] });
    await open(api);
    const note = document.querySelector('[data-binding-conflict="accept"]');
    expect(note.textContent).toMatch(/Dispatcher does not hold this action's permission \(workOrder\.accept\)/);
    expect(note.textContent).toMatch(/nothing is removed automatically/);
    expect(screen.getByRole("button", { name: "Remove Dispatcher" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Reason for assignment changes"), { target: { value: "noop" } });
    expect(screen.getByRole("button", { name: "Save Assignment Draft" }).disabled).toBe(true);
  });
  it("D2: without the server's permission for the save it would make, assignments are read-only and say why", async () => {
    const api = fixture({ allowed: ["updateWorkflowDefinition"] }); // PUBLISHED needs createWorkflowVersion
    await open(api);
    expect(screen.queryByRole("button", { name: "Save Assignment Draft" })).toBeNull();
    expect(document.querySelector('[data-permission-note="assignments"]').textContent).toMatch(/Requires the “Version Workflows” permission\. Assignments are shown read-only/);
    expect(screen.getByRole("button", { name: "Remove Dispatcher" }).disabled).toBe(true);
  });
  it("D2: fails closed when the decision cannot be read", async () => {
    const api = fixture();
    api.readMyWorkflowAdministration = vi.fn(() => Promise.resolve({ ok: false, code: "UNREACHABLE", message: "down" }));
    await open(api);
    await waitFor(() => expect(document.querySelector('[data-permission-note="assignments"]')?.textContent).toMatch(/could not be confirmed/));
    expect(screen.queryByRole("button", { name: "Save Assignment Draft" })).toBeNull();
    expect(api.createWorkflowVersion).not.toHaveBeenCalled();
  });
});

// W01 holder lookup (2026-10-09): the panel shows what the server answers -- counts of viewable holders only (#221), scope -- and nothing else.
describe("Workflow Assignments -- role holders for one action (W01 holder lookup)", () => {
  it("shows the viewable holders and how many the action applies to, and the scope an action does not apply at", async () => {
    const api = fixture(); await open(api);
    fireEvent.click(await screen.findByRole("button", { name: "View Technician employees" }));
    await screen.findByRole("link", { name: "Pat Tech" });
    expect(document.querySelector("[data-holder-counts]").textContent).toBe("2 people you can view hold this role; this action applies to 1.");
    const scoped = screen.getByRole("link", { name: "Lee Scoped" }).closest("li");
    expect(scoped.textContent).toMatch(/Operating Company: taylor/);
    expect(scoped.querySelector('[data-not-applicable="SCOPE_DOES_NOT_DECIDE"]').textContent).toMatch(/doesn't apply at this assignment scope/);
  });
  it("a refused lookup is shown as a refusal, never as an empty list", async () => {
    const api = fixture();
    api.listWorkflowActionRoleHolders = vi.fn(() => Promise.resolve({ ok: false, code: "FORBIDDEN",
      message: "EMPLOYEE_VISIBILITY_UNAVAILABLE: Employee visibility could not be established; no holder is shown" }));
    await open(api);
    fireEvent.click(await screen.findByRole("button", { name: "View Technician employees" }));
    expect(await screen.findByText(/Employee visibility could not be established/)).toBeTruthy();
    expect(screen.queryByText(/No employee you can view holds this role/)).toBeNull();
  });
  it("#221: a caller who cannot view employees is told so -- no names and no headcount", async () => {
    const api = fixture();
    api.listWorkflowActionRoleHolders = vi.fn(() => ok({ roleKey: "tech", roleName: "Technician", actionKey: "accept", roleEligible: true, roleBound: true,
      totalHolders: 0, holdersForAction: 0, employeeVisibility: "NONE", truncated: false, holders: [] }));
    await open(api);
    fireEvent.click(await screen.findByRole("button", { name: "View Technician employees" }));
    await waitFor(() => expect(document.querySelector("[data-holder-counts]")?.textContent).toBe("You can't view employees, so the holders of this role aren't shown."));
    expect(document.querySelector("[data-role-holders]").textContent).not.toMatch(/\d+ (people|person)/);
  });
  it("a read-only caller is not offered the holder lookup, and is told why", async () => {
    const api = fixture({ allowed: [] }); await open(api);
    expect(screen.queryByRole("button", { name: "View Technician employees" })).toBeNull();
    expect(document.querySelector('[data-permission-note="holders"]').textContent).toMatch(/requires permission to change assignments/);
    expect(api.listWorkflowActionRoleHolders).not.toHaveBeenCalled();
  });
});
