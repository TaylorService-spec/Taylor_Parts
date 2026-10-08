// ADMINISTRATION > WORKFLOWS -- component proofs (vitest + jsdom).
//
// Every screen takes the workflow seam as `api`; these stand in for the server with vi.fn, so what is
// proved is WHICH operation is sent with WHAT input, and that the server's answer -- a refusal
// included -- is what the screen shows, verbatim. No workflow definition exists in the client.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import AdminWorkflows from "../src/modules/administration/AdminWorkflows.jsx";
import EmployeeWorkflowResponsibilities from "../src/modules/administration/EmployeeWorkflowResponsibilities.jsx";
import { createWorkflowAdminClient } from "../src/services/workflowAdminClient.js";

afterEach(cleanup);

const ok = (data) => Promise.resolve({ ok: true, data });
const refused = (code, message) => Promise.resolve({ ok: false, code, message });

const LIST = [
  {
    workflow: { id: "wf-so", key: "salesOrder", name: "Sales — Order", description: "The committed order.", objectKey: "salesOrder", activeVersionId: null },
    versions: [{ id: "so-v1", version: 1, status: "DRAFT", publishedAt: null }],
  },
  {
    workflow: { id: "wf-wo", key: "workOrder", name: "Technician / Work Order", description: null, objectKey: "workOrder", activeVersionId: "wo-v2" },
    versions: [
      { id: "wo-v1", version: 1, status: "PUBLISHED", publishedAt: "t1" },
      { id: "wo-v2", version: 2, status: "PUBLISHED", publishedAt: "t2" },
    ],
  },
];

const SO_DRAFT = {
  workflow: LIST[0].workflow,
  version: { id: "so-v1", version: 1, status: "DRAFT", publishedAt: null },
  active: false,
  steps: [
    { key: "CONFIRMED", label: "Confirmed", initial: true, terminal: false },
    { key: "CLOSED", label: "Closed", initial: false, terminal: true },
  ],
  actions: [{
    key: "close", label: "Close", from: "CONFIRMED", to: "CLOSED", requiresOwnAssignment: false,
    capabilityKey: "salesOrder.write", guardKind: null, roleKeys: ["admin", "operationsManager"],
    bindings: [{ roleKey: "admin", bindingKind: "SECURITY_ROLE" }, { roleKey: "operationsManager", bindingKind: "SECURITY_ROLE" }],
  }],
};

const STALE_VALIDATION = {
  valid: false,
  errors: [{ code: "BINDING_WITHOUT_CAPABILITY", severity: "ERROR", roleKey: "operationsManager", actionKey: "close",
    message: 'Role "operationsManager" is bound to "close" but does not hold "salesOrder.write"; a binding never grants' }],
  warnings: [{ code: "CAPABILITY_HOLDER_NOT_BOUND", severity: "WARNING", message: "salesManager holds \"salesOrder.write\" but is not bound to \"close\"" }],
};

function fakeApi(overrides = {}) {
  return {
    listWorkflows: vi.fn(() => ok(LIST)),
    // The tenant's Security Roles for the binding TYPEAHEAD (UI corrections item E).
    listRoles: vi.fn(() => ok([
      { id: "r-admin", key: "admin", name: "Administrator" },
      { id: "r-om", key: "operationsManager", name: "Operations Manager" },
      { id: "r-sm", key: "salesManager", name: "Sales Manager" },
    ])),
    readWorkflowVersion: vi.fn((id) => (id === "so-v1" ? ok(SO_DRAFT) : ok({ ...SO_DRAFT, version: { id, version: 2, status: "PUBLISHED" }, active: id === "wo-v2" }))),
    validateWorkflowVersion: vi.fn(() => ok(STALE_VALIDATION)),
    validateUnsavedDefinition: vi.fn(() => ok({ valid: true, errors: [], warnings: [] })),
    listWorkflowInstances: vi.fn(() => ok([])),
    readWorkflowHistory: vi.fn(() => ok([{ id: "a1", action: "createWorkflowDraft", occurredAt: "t0", reason: "seed", actorUid: "p-admin", after: { version: 1 } }])),
    listPrincipalWorkflowResponsibilities: vi.fn(),
    createWorkflowDraft: vi.fn(),
    createWorkflowVersion: vi.fn(() => ok({ version: { id: "so-v2", version: 2, status: "DRAFT" } })),
    updateWorkflowDefinition: vi.fn(() => ok({ version: { id: "so-v2", version: 2, status: "DRAFT" }, missingRoleKeys: [], unknownCapabilityKeys: [] })),
    publishWorkflowVersion: vi.fn(() => refused("INVALID_INPUT",
      'WORKFLOW_VALIDATION_FAILED: workflow version cannot be published: BINDING_WITHOUT_CAPABILITY Role "operationsManager" is bound to "close" but does not hold "salesOrder.write"; a binding never grants')),
    activateWorkflowVersion: vi.fn(() => ok({})),
    retireWorkflowVersion: vi.fn(() => refused("CONFLICT", "WORKFLOW_VERSION_PINNED: 3 live instance(s) are pinned to workflow version 1; migrate them first")),
    ...overrides,
  };
}

async function openSalesOrder(api) {
  render(<AdminWorkflows api={api} />);
  const button = await screen.findByRole("button", { name: "Sales — Order" });
  fireEvent.click(button);
  await waitFor(() => expect(document.querySelector('[data-workflow-version="so-v1"]')).not.toBeNull());
}

describe("Administration > Workflows", () => {
  it("lists the SERVER's workflows by area, with the active version, and draws no client copy", async () => {
    const api = fakeApi();
    render(<AdminWorkflows api={api} />);
    await screen.findByRole("button", { name: "Sales — Order" });
    expect(api.listWorkflows).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-workflow-area="sales"]')).not.toBeNull();
    expect(document.querySelector('[data-workflow-area="workOrder"]')).not.toBeNull();
    const woRow = document.querySelector('[data-workflow="workOrder"]');
    expect(within(woRow).getByText("v2")).toBeTruthy();
    // Nothing the server did not return: the seeded Parts / Purchasing machine is absent here.
    expect(document.querySelector('[data-workflow="partsPurchasing"]')).toBeNull();
    expect(screen.queryByText(/Pending review/)).toBeNull();
  });

  it("shows a version's actions with capability and bindings, and the server's validation codes", async () => {
    const api = fakeApi();
    await openSalesOrder(api);
    expect(api.readWorkflowVersion).toHaveBeenCalledWith("so-v1");
    expect(api.validateWorkflowVersion).toHaveBeenCalledWith("so-v1");
    const row = document.querySelector('[data-workflow-action="close"]');
    expect(within(row).getByText("salesOrder.write")).toBeTruthy();
    expect(row.textContent).toContain("Admin, Operations Manager");
    const error = await waitFor(() => {
      const el = document.querySelector('[data-validation-code="BINDING_WITHOUT_CAPABILITY"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(error.getAttribute("data-validation-severity")).toBe("ERROR");
    expect(error.textContent).toContain("a binding never grants");
    expect(document.querySelector('[data-validation="INVALID"]')).not.toBeNull();
    expect(document.querySelector('[data-validation-code="CAPABILITY_HOLDER_NOT_BOUND"]').getAttribute("data-validation-severity")).toBe("WARNING");
  });

  it("PUBLISH sends the version and the reason, and shows the server's refusal VERBATIM", async () => {
    const api = fakeApi();
    await openSalesOrder(api);
    fireEvent.change(screen.getByLabelText("Reason for the workflow change"), { target: { value: "go live" } });
    fireEvent.click(document.querySelector('[data-lifecycle-action="publish"]'));
    const alert = await waitFor(() => {
      const el = document.querySelector('[data-lifecycle-outcome="refused"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(api.publishWorkflowVersion).toHaveBeenCalledWith({ versionId: "so-v1", reason: "go live" });
    expect(alert.textContent).toBe(
      'INVALID_INPUT: WORKFLOW_VALIDATION_FAILED: workflow version cannot be published: BINDING_WITHOUT_CAPABILITY Role "operationsManager" is bound to "close" but does not hold "salesOrder.write"; a binding never grants');
  });

  it("offers Retire and Make ACTIVE only for a non-active published version; the refusal is verbatim", async () => {
    const api = fakeApi();
    render(<AdminWorkflows api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Technician / Work Order" }));
    // The ACTIVE version (v2) is selected first: no retire, no activate.
    await waitFor(() => expect(document.querySelector('[data-workflow-version="wo-v2"]')).not.toBeNull());
    expect(document.querySelector('[data-lifecycle-action="retire"]')).toBeNull();
    expect(document.querySelector('[data-lifecycle-action="activate"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^v1 · Published · not active$/ }));
    await waitFor(() => expect(document.querySelector('[data-workflow-version="wo-v1"]')).not.toBeNull());
    expect(document.querySelector('[data-lifecycle-action="activate"]')).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Reason for the workflow change"), { target: { value: "clean up" } });
    fireEvent.click(document.querySelector('[data-lifecycle-action="retire"]'));
    const alert = await waitFor(() => {
      const el = document.querySelector('[data-lifecycle-outcome="refused"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(api.retireWorkflowVersion).toHaveBeenCalledWith({ versionId: "wo-v1", reason: "clean up" });
    expect(alert.textContent).toBe("CONFLICT: WORKFLOW_VERSION_PINNED: 3 live instance(s) are pinned to workflow version 1; migrate them first");
  });

  it("the DRAFT editor edits states, transitions, capability, guard and bindings, validates on the server and saves", async () => {
    const api = fakeApi();
    await openSalesOrder(api);
    // Bindings are chosen by TYPEAHEAD from the tenant's Security Roles, shown by name; each chip is removable.
    fireEvent.click(screen.getByRole("button", { name: "Remove Operations Manager" }));
    const roles = screen.getByLabelText("Action 1 Security Roles");
    fireEvent.focus(roles);
    fireEvent.change(roles, { target: { value: "sales" } });
    fireEvent.pointerDown(await screen.findByRole("option", { name: /Sales Manager/ }));
    expect(document.querySelector('[data-keylist="wf-action-0-roles"] [data-key="salesManager"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Action 1 guard"), { target: { value: "RECORD_ASSIGNMENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate (Server)" }));
    await waitFor(() => expect(api.validateUnsavedDefinition).toHaveBeenCalledTimes(1));
    const [{ objectKey, definition }] = api.validateUnsavedDefinition.mock.calls[0];
    expect(objectKey).toBe("salesOrder");
    expect(definition.actions[0]).toEqual({
      key: "close", label: "Close", from: "CONFIRMED", to: "CLOSED", capabilityKey: "salesOrder.write",
      guardKind: "RECORD_ASSIGNMENT", requiresOwnAssignment: true, roleKeys: ["admin", "salesManager"], functionalRoleKeys: [],
    });
    fireEvent.change(screen.getByLabelText("Reason for saving the draft"), { target: { value: "remove stale binding" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as New Draft" }));
    await waitFor(() => expect(api.updateWorkflowDefinition).toHaveBeenCalledTimes(1));
    expect(api.updateWorkflowDefinition.mock.calls[0][0]).toMatchObject({ versionId: "so-v1", reason: "remove stale binding" });
    expect(api.updateWorkflowDefinition.mock.calls[0][0].definition.steps).toEqual([
      { key: "CONFIRMED", label: "Confirmed", initial: true, terminal: false },
      { key: "CLOSED", label: "Closed", initial: false, terminal: true },
    ]);
  });
});

describe("Administration > Workflows: selection is a view, never a change (UI corrections item F)", () => {
  const MUTATIONS = ["createWorkflowDraft", "createWorkflowVersion", "updateWorkflowDefinition", "publishWorkflowVersion", "activateWorkflowVersion", "retireWorkflowVersion"];
  const noMutation = (api) => MUTATIONS.forEach((m) => expect(api[m], m).not.toHaveBeenCalled());

  it("click selects, click again DESELECTS to a neutral empty state, another click switches -- and nothing is written", async () => {
    const api = fakeApi();
    await openSalesOrder(api);
    const so = screen.getByRole("button", { name: "Sales — Order" });
    expect(so.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(so);
    await waitFor(() => expect(document.querySelector('[data-workflow-selection="NONE"]')).not.toBeNull());
    expect(document.querySelector('[data-workflow-version="so-v1"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Sales — Order" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Sales — Order" }));
    await waitFor(() => expect(document.querySelector('[data-workflow-version="so-v1"]')).not.toBeNull());
    noMutation(api);
  });

  it("unsaved draft changes ask before leaving: Keep Editing keeps everything, Discard Changes deselects -- still nothing written", async () => {
    const api = fakeApi();
    await openSalesOrder(api);
    fireEvent.change(screen.getByLabelText("Action 1 guard"), { target: { value: "RECORD_ASSIGNMENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Sales — Order" }));
    expect(await screen.findByText("Discard Unsaved Changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getByLabelText("Action 1 guard").value).toBe("RECORD_ASSIGNMENT");
    expect(document.querySelector('[data-workflow-version="so-v1"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sales — Order" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard Changes" }));
    await waitFor(() => expect(document.querySelector('[data-workflow-selection="NONE"]')).not.toBeNull());
    noMutation(api);
  });
});

describe("Employee > Workflow responsibilities", () => {
  it("renders the server's derived responsibilities and names bindings that confer nothing", async () => {
    const api = {
      listPrincipalWorkflowResponsibilities: vi.fn(() => ok({
        principalId: "p-1",
        securityRoleKeys: ["dispatcher", "operationsManager"],
        responsibilities: [{ workflowKey: "workOrder", workflowName: "Technician / Work Order", version: 2, actionKey: "Dispatch",
          actionLabel: "Dispatch", from: "SCHEDULED", to: "DISPATCHED", capabilityKey: "workOrder.lifecycle.dispatch", guardKind: null,
          viaRoles: ["dispatcher"], authority: "ALLOWED", reasonCode: "ALLOWED", source: "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY" }],
        boundWithoutAuthority: [{ workflowKey: "salesOrder", actionKey: "close", viaRoles: ["operationsManager"], reasonCode: "CAPABILITY_MISSING" }],
      })),
    };
    render(<EmployeeWorkflowResponsibilities api={api} principalId="p-1" />);
    await waitFor(() => expect(document.querySelector('[data-workflow-responsibilities="READY"]')).not.toBeNull());
    expect(api.listPrincipalWorkflowResponsibilities).toHaveBeenCalledWith("p-1");
    expect(document.querySelector('[data-responsibility="workOrder/Dispatch"]').textContent).toContain("Dispatcher");
    expect(document.querySelector('[data-inert-binding="salesOrder/close"]').textContent).toContain("CAPABILITY_MISSING");
  });

  it("shows a refusal verbatim and never computes an answer of its own", async () => {
    const api = { listPrincipalWorkflowResponsibilities: vi.fn(() => refused("FORBIDDEN", 'not authorized to read: "admin.principalAccess.read" is required')) };
    render(<EmployeeWorkflowResponsibilities api={api} principalId="p-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe('FORBIDDEN: not authorized to read: "admin.principalAccess.read" is required');
  });
});

describe("the workflow seam", () => {
  it("sends exactly the operation and input the server's workflow dispatcher reads", async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true, data: null }));
    const client = createWorkflowAdminClient(call);
    await client.publishWorkflowVersion({ versionId: "v", reason: "r" });
    await client.activateWorkflowVersion({ versionId: "v", reason: "r" });
    await client.retireWorkflowVersion({ versionId: "v", reason: "r" });
    await client.createWorkflowVersion({ workflowId: "w", copyFromVersionId: "v", reason: "r" });
    await client.validateUnsavedDefinition({ objectKey: "workOrder", definition: { steps: [], actions: [] } });
    await client.listPrincipalWorkflowResponsibilities("p");
    expect(call.mock.calls).toEqual([
      ["publishWorkflowVersion", { versionId: "v", reason: "r" }],
      ["activateWorkflowVersion", { versionId: "v", reason: "r" }],
      ["retireWorkflowVersion", { versionId: "v", reason: "r" }],
      ["createWorkflowVersion", { workflowId: "w", reason: "r", copyFromVersionId: "v" }],
      ["validateWorkflowVersion", { objectKey: "workOrder", definition: { steps: [], actions: [] } }],
      ["listPrincipalWorkflowResponsibilities", { principalId: "p" }],
    ]);
    const unreachable = createWorkflowAdminClient(() => Promise.reject(new Error("net")));
    expect(await unreachable.listWorkflows()).toEqual({ ok: false, code: "UNREACHABLE", message: "the Administration API could not be reached" });
  });
});
