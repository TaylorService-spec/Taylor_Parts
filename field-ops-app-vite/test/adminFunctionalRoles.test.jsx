// FUNCTIONAL ROLES -- component proofs (vitest + jsdom), lane FR.
//
// A Functional Role is a business responsibility that GRANTS NOTHING. These prove WHICH governed Workforce
// operation each screen sends with WHAT input, that write controls are offered only from the Workforce capability
// read, that server refusals are shown verbatim, that the workflow editor sends FUNCTIONAL_ROLE bindings as
// functionalRoleKeys, and that Effective Access draws Functional Roles as Employee FACTS, never as a source.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: "admin" }) }));

import AdminFunctionalRoles from "../src/modules/administration/AdminFunctionalRoles.jsx";
import EmployeeFunctionalRoles, { instantFrom } from "../src/modules/administration/EmployeeFunctionalRoles.jsx";
import EmployeeEffectiveAccess from "../src/modules/administration/EmployeeEffectiveAccess.jsx";
import EmployeeWorkflowResponsibilities from "../src/modules/administration/EmployeeWorkflowResponsibilities.jsx";
import { definitionForServer, editableDefinition, buildWorkflowVersionView } from "../src/domain/adminWorkflowView.js";

afterEach(cleanup);

const WRITE = "admin.employeeFunctionalRole.write";
const CATALOG = [
  { functionalRoleId: "fr_aaaaaaaa-1", key: "warranty-desk", name: "Warranty desk", description: "Warranty claims", status: "ACTIVE", currentHolderCount: 1 },
  { functionalRoleId: "fr_bbbbbbbb-2", key: "vendor-returns", name: "Vendor returns", description: null, status: "INACTIVE", currentHolderCount: 0 },
];
const CURRENT = { assignmentId: "efr_1", functionalRoleId: "fr_aaaaaaaa-1", key: "warranty-desk", name: "Warranty desk", functionalRoleStatus: "ACTIVE",
  state: "CURRENT", effectiveFrom: "2026-09-26T00:00:00.000Z", effectiveTo: null, assignmentSource: "ADMINISTRATION", reason: "owns claims", endReason: null };

function fakeWorkforce({ capabilities = [WRITE], refuse = {} } = {}) {
  const call = vi.fn((operation, input) => {
    if (refuse[operation]) return Promise.resolve({ ok: false, ...refuse[operation] });
    switch (operation) {
      case "readMyWorkforceCapabilities": return Promise.resolve({ ok: true, result: { capabilities } });
      case "listFunctionalRoles": return Promise.resolve({ ok: true, result: { items: input?.status ? CATALOG.filter((r) => r.status === input.status) : CATALOG } });
      case "listFunctionalRoleHolders": return Promise.resolve({ ok: true, result: { functionalRoleId: input.functionalRoleId, holders: [{ ...CURRENT, employee: { employeeId: "e-1", displayName: "Jo Tech" } }], truncated: false } });
      case "listFunctionalRoleHistory": return Promise.resolve({ ok: true, result: { functionalRoleId: input.functionalRoleId, items: [{ action: "functionalRole.catalog.create", occurredAt: "t0", employeeId: null, before: null, after: {}, reason: "new duty" }] } });
      case "listEmployeeFunctionalRoles": return Promise.resolve({ ok: true, result: { employeeId: input.employeeId, current: [CURRENT], scheduled: [], items: [CURRENT], truncated: false } });
      default: return Promise.resolve({ ok: true, result: { outcome: "UPDATED" } });
    }
  });
  return { call };
}

describe("Administration > Users > Functional Roles", () => {
  it("lists the catalog with status and holders; opens holders and the audit history", async () => {
    const workforce = fakeWorkforce();
    render(<MemoryRouter><AdminFunctionalRoles workforce={workforce} /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-functional-role-rows='2']")).not.toBeNull());
    expect(document.querySelector("[data-functional-role-row='vendor-returns']").textContent).toContain("INACTIVE");
    fireEvent.click(screen.getByRole("button", { name: "Open warranty-desk" }));
    await waitFor(() => expect(document.querySelector("[data-functional-role-holders='1']")).not.toBeNull());
    expect(document.querySelector("[data-functional-role-events='1']").textContent).toContain("functionalRole.catalog.create");
    expect(workforce.call).toHaveBeenCalledWith("listFunctionalRoleHolders", { functionalRoleId: "fr_aaaaaaaa-1" });
  });

  it("creates with key, name, description and reason; deactivation sends the stated reason and shows the refusal VERBATIM", async () => {
    const workforce = fakeWorkforce({ refuse: { setFunctionalRoleStatus: { code: "CONFLICT", reason: "FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS", message: "1 current or scheduled assignment(s) must be ended before this Functional Role can be deactivated" } } });
    render(<MemoryRouter><AdminFunctionalRoles workforce={workforce} /></MemoryRouter>);
    await screen.findByLabelText("Functional Role key");
    fireEvent.change(screen.getByLabelText("Functional Role key"), { target: { value: "field-trainer" } });
    fireEvent.change(screen.getByLabelText("Functional Role name"), { target: { value: "Field trainer" } });
    fireEvent.change(screen.getByLabelText("Functional Role description"), { target: { value: "Trains new techs" } });
    fireEvent.submit(screen.getByRole("form", { name: "Create Functional Role" }));
    await waitFor(() => expect(workforce.call).toHaveBeenCalledWith("createFunctionalRole", { key: "field-trainer", name: "Field trainer", description: "Trains new techs" }));

    fireEvent.click(await screen.findByRole("button", { name: "Open warranty-desk" }));
    await screen.findByRole("button", { name: "Deactivate" });
    expect(screen.getByRole("button", { name: "Deactivate" }).disabled).toBe(true);
    const reasons = screen.getAllByLabelText("Reason");
    fireEvent.change(reasons[0], { target: { value: "duty retired" } });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const alert = await waitFor(() => { const el = document.querySelector("[data-functional-role-refusal='FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS']"); expect(el).not.toBeNull(); return el; });
    expect(workforce.call).toHaveBeenCalledWith("setFunctionalRoleStatus", { functionalRoleId: "fr_aaaaaaaa-1", status: "INACTIVE", reason: "duty retired" });
    expect(alert.textContent).toBe("CONFLICT (FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS): 1 current or scheduled assignment(s) must be ended before this Functional Role can be deactivated");
  });

  it("offers no write control to a caller the Workforce capability read does not name", async () => {
    render(<MemoryRouter><AdminFunctionalRoles workforce={fakeWorkforce({ capabilities: ["employee.record.read"] })} /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector("[data-functional-role-rows='2']")).not.toBeNull());
    expect(screen.queryByLabelText("Functional Role key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open warranty-desk" }));
    await waitFor(() => expect(document.querySelector("[data-functional-role-holders='1']")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
  });
});

describe("Employee > Functional Roles", () => {
  it("shows current assignments and assigns an ACTIVE Functional Role with a reason; a self-assignment refusal is verbatim", async () => {
    const workforce = fakeWorkforce({ refuse: { assignEmployeeFunctionalRole: { code: "FORBIDDEN", reason: "FUNCTIONAL_ROLE_SELF_ASSIGNMENT", message: "a Functional Role cannot be assigned to your own Employee record; another administrator must do it" } } });
    render(<EmployeeFunctionalRoles employeeId="e-1" workforce={workforce} canWrite />);
    await waitFor(() => expect(document.querySelector("[data-functional-roles='1']")).not.toBeNull());
    // Only ACTIVE catalog entries not already held are offered.
    expect(workforce.call).toHaveBeenCalledWith("listFunctionalRoles", { status: "ACTIVE" });
    const select = screen.getByLabelText("Functional Role to assign");
    expect([...select.options].map((o) => o.value)).toEqual([""]);
  });

  it("ends an assignment with a reason and an optional effective-to instant", async () => {
    const workforce = fakeWorkforce();
    render(<EmployeeFunctionalRoles employeeId="e-1" workforce={workforce} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: "End warranty-desk" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "moved teams" } });
    fireEvent.submit(screen.getByRole("form", { name: "End Functional Role" }));
    await waitFor(() => expect(workforce.call).toHaveBeenCalledWith("endEmployeeFunctionalRoleAssignment", { employeeId: "e-1", assignmentId: "efr_1", reason: "moved teams" }));
    expect(instantFrom("")).toBeUndefined();
    expect(instantFrom("2026-10-01T09:00")).toMatch(/^2026-10-01T/);
  });

  it("assign sends the chosen role, the reason and the effective-from; the server's refusal is shown verbatim", async () => {
    const workforce = fakeWorkforce({ refuse: { assignEmployeeFunctionalRole: { code: "FORBIDDEN", reason: "FUNCTIONAL_ROLE_SELF_ASSIGNMENT", message: "a Functional Role cannot be assigned to your own Employee record; another administrator must do it" } } });
    workforce.call.mockImplementation((operation, input) => {
      if (operation === "listEmployeeFunctionalRoles") return Promise.resolve({ ok: true, result: { employeeId: "e-1", current: [], scheduled: [], items: [], truncated: false } });
      if (operation === "listFunctionalRoles") return Promise.resolve({ ok: true, result: { items: CATALOG.filter((r) => r.status === input.status) } });
      return Promise.resolve({ ok: false, code: "FORBIDDEN", reason: "FUNCTIONAL_ROLE_SELF_ASSIGNMENT", message: "a Functional Role cannot be assigned to your own Employee record; another administrator must do it" });
    });
    render(<EmployeeFunctionalRoles employeeId="e-1" workforce={workforce} canWrite />);
    await waitFor(() => expect(screen.getByLabelText("Functional Role to assign").options.length).toBe(2));
    fireEvent.change(screen.getByLabelText("Functional Role to assign"), { target: { value: "fr_aaaaaaaa-1" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "owns claims" } });
    fireEvent.submit(screen.getByRole("form", { name: "Assign Functional Role" }));
    const alert = await waitFor(() => { const el = document.querySelector("[data-functional-role-refusal='FUNCTIONAL_ROLE_SELF_ASSIGNMENT']"); expect(el).not.toBeNull(); return el; });
    expect(workforce.call).toHaveBeenCalledWith("assignEmployeeFunctionalRole", { employeeId: "e-1", functionalRoleId: "fr_aaaaaaaa-1", reason: "owns claims" });
    expect(alert.textContent).toBe("FORBIDDEN (FUNCTIONAL_ROLE_SELF_ASSIGNMENT): a Functional Role cannot be assigned to your own Employee record; another administrator must do it");
  });

  it("without the write capability it only reads", async () => {
    render(<EmployeeFunctionalRoles employeeId="e-1" workforce={fakeWorkforce()} canWrite={false} />);
    await waitFor(() => expect(document.querySelector("[data-functional-roles='1']")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "End warranty-desk" })).toBeNull();
    expect(screen.queryByLabelText("Functional Role to assign")).toBeNull();
  });
});

describe("Workflows: FUNCTIONAL_ROLE bindings", () => {
  it("the editor round-trips functionalRoleKeys and the version view keeps the binding kind", () => {
    const view = buildWorkflowVersionView({
      steps: [{ key: "A", label: "A", initial: true }, { key: "Z", label: "Z", terminal: true }],
      actions: [{ key: "go", label: "Go", from: "A", to: "Z", capabilityKey: "workOrder.transition", roleKeys: ["dispatcher"], functionalRoleKeys: ["warranty-desk"],
        bindings: [{ roleKey: "dispatcher", functionalRoleKey: null, bindingKind: "SECURITY_ROLE" }, { roleKey: null, functionalRoleKey: "warranty-desk", bindingKind: "FUNCTIONAL_ROLE" }] }],
    });
    expect(view.actions[0].bindings.map((b) => b.bindingKind)).toEqual(["SECURITY_ROLE", "FUNCTIONAL_ROLE"]);
    const editable = editableDefinition(view);
    expect(editable.actions[0].functionalRoleKeys).toBe("warranty-desk");
    editable.actions[0].functionalRoleKeys = "warranty-desk, vendor-returns";
    expect(definitionForServer(editable).actions[0].functionalRoleKeys).toEqual(["warranty-desk", "vendor-returns"]);
    expect(definitionForServer(editable).actions[0].roleKeys).toEqual(["dispatcher"]);
  });

  it("responsibilities show the source and the required / held Functional Roles; a Functional-Role-only binding confers nothing", async () => {
    const api = { listPrincipalWorkflowResponsibilities: vi.fn(() => Promise.resolve({ ok: true, data: {
      principalId: "p-1", securityRoleKeys: ["dispatcher"],
      responsibilities: [{ workflowKey: "workOrder", workflowName: "WO", version: 1, actionKey: "go", actionLabel: "Go", from: "A", to: "Z",
        capabilityKey: "workOrder.transition", guardKind: null, viaRoles: ["dispatcher"], requiredFunctionalRoles: ["warranty-desk"],
        viaFunctionalRoles: ["warranty-desk"], authority: "ALLOWED", reasonCode: "ALLOWED", source: "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY" }],
      boundWithoutAuthority: [{ workflowKey: "salesOrder", actionKey: "close", viaRoles: [], viaFunctionalRoles: ["warranty-desk"],
        reasonCode: "SECURITY_ROLE_BINDING_REQUIRED", source: "FUNCTIONAL_ROLE_BINDING_ONLY" }],
    } })) };
    render(<EmployeeWorkflowResponsibilities api={api} principalId="p-1" />);
    await waitFor(() => expect(document.querySelector('[data-workflow-responsibilities="READY"]')).not.toBeNull());
    const row = document.querySelector('[data-responsibility="workOrder/go"]');
    expect(row.querySelector("[data-functional-role-requirement]").textContent).toBe("requires one of warranty-desk; holds warranty-desk");
    expect(row.querySelector("[data-responsibility-source]").getAttribute("data-responsibility-source")).toBe("WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY");
    const inert = document.querySelector('[data-inert-binding="salesOrder/close"]');
    expect(inert.textContent).toContain("SECURITY_ROLE_BINDING_REQUIRED");
    expect(inert.textContent).toContain("confers nothing");
  });
});

describe("Effective Access: Functional Roles are Employee FACTS, never a permission source", () => {
  it("draws employeeFacts.functionalRoles in their own labelled block and nowhere as a source", async () => {
    const api = { explainEffectiveAccess: vi.fn(() => Promise.resolve({ ok: true, data: {
      principalId: "p-1", securityRoleKeys: [], accessVersion: 1, assignments: { excluded: [] }, employeeId: "e-1",
      workEligibility: [], operationalScopes: [], capabilities: [], conditionallyHeld: [], surfaces: [], actions: [],
      employeeFacts: { functionalRoles: [{ functionalRoleId: "fr_aaaaaaaa-1", key: "warranty-desk", name: "Warranty desk" }], grantsCapabilities: false },
    } })) };
    render(<EmployeeEffectiveAccess api={api} principalId="p-1" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).not.toBeNull());
    const facts = document.querySelector("[data-employee-facts='1']");
    expect(facts.textContent).toContain("Employee facts — not a permission source");
    expect(facts.querySelector("[data-functional-role-fact='warranty-desk']")).not.toBeNull();
    expect(document.querySelector("[data-effective-access-context]").textContent).not.toContain("warranty-desk");
  });
});
