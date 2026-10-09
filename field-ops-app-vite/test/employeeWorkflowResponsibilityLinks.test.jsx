// EMPLOYEE > WORKFLOW RESPONSIBILITIES -- provenance and "where to change it" (lane WR, vitest + jsdom).
//
// The server names, per responsibility, the governed rows that produced it (adminLocations). This proves the panel
// renders each one as navigation to the Administration screen that governs it -- Security Role assignment, Functional
// Role assignment, workflow binding, Role capability grant -- shows a scoped Security Role with its scope and the grant
// condition, and that the Workflows screen honours the ?workflow=&version= deep link. No link targets a per-Employee
// workflow grant (there is none).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import EmployeeWorkflowResponsibilities from "../src/modules/administration/EmployeeWorkflowResponsibilities.jsx";
import AdminWorkflows from "../src/modules/administration/AdminWorkflows.jsx";
import { adminLocationLinks, readAdminQueryParam } from "../src/domain/workflowResponsibilityLinks.js";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

const ok = (data) => Promise.resolve({ ok: true, data });
const ASSIGNED = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };

const ROW = {
  workflowId: "wf-1", workflowKey: "woProof", workflowName: "WO proof", objectKey: "workOrder", versionId: "v-2", version: 2,
  actionKey: "complete", actionLabel: "Complete", from: "WORKING", to: "DONE", capabilityKey: "workOrder.lifecycle.complete",
  guardKind: "RECORD_ASSIGNMENT", viaRoles: ["technician"], requiredFunctionalRoles: ["verifier"], viaFunctionalRoles: ["verifier"],
  authority: "CONDITIONAL", reasonCode: "RECORD_ASSIGNMENT_REQUIRED", source: "WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY",
  securityRoleSources: [{ roleKey: "technician", roleId: "r-t", bindingId: "b-1", assignmentId: "a-1", scopeType: "global", scopeValue: null }],
  functionalRoleSources: [{ functionalRoleKey: "verifier", functionalRoleId: "fr-1", bindingId: "b-2", held: true, assignmentId: "fra-1" }],
  capabilityGrants: [{ roleKey: "technician", scopeType: "global", scopeValue: null, condition: ASSIGNED }],
  grantConditions: [ASSIGNED],
  adminLocations: [
    { kind: "SECURITY_ROLE_ASSIGNMENT", id: "a-1", roleKey: "technician", scopeType: "global", scopeValue: null, principalId: "p-1" },
    { kind: "FUNCTIONAL_ROLE_ASSIGNMENT", id: "fra-1", functionalRoleKey: "verifier", functionalRoleId: "fr-1", employeeId: "e-1", held: true },
    { kind: "WORKFLOW_BINDING", id: "b-1", workflowId: "wf-1", workflowKey: "woProof", versionId: "v-2", version: 2, actionKey: "complete", bindingKind: "SECURITY_ROLE", boundKey: "technician" },
    { kind: "ROLE_CAPABILITY_GRANT", id: "technician:workOrder.lifecycle.complete", roleKey: "technician", capabilityKey: "workOrder.lifecycle.complete", objectKey: "workOrder", conditioned: true },
  ],
};
const SCOPED_ROW = {
  ...ROW, workflowKey: "empReview", actionKey: "review", actionLabel: "Review", from: "OPEN", to: "REVIEWED", capabilityKey: "employee.record.read",
  guardKind: null, viaRoles: ["companyReader"], requiredFunctionalRoles: [], viaFunctionalRoles: [], authority: "SCOPED",
  reasonCode: "SCOPE_CONTEXT_REQUIRED", source: "WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY", grantConditions: [], functionalRoleSources: [],
  securityRoleSources: [{ roleKey: "companyReader", roleId: "r-c", bindingId: "b-9", assignmentId: "a-9", scopeType: "operatingCompany", scopeValue: "taylor" }],
  adminLocations: [{ kind: "SECURITY_ROLE_ASSIGNMENT", id: "a-9", roleKey: "companyReader", scopeType: "operatingCompany", scopeValue: "taylor", principalId: "p-1" }],
};

describe("workflow responsibility links (pure)", () => {
  it("maps every admin location kind to its governing Administration screen, and nothing else", () => {
    const [sra, fra, wb, rcg] = ROW.adminLocations;
    expect(adminLocationLinks(sra, { employeeId: "e-1" }).map((l) => l.href)).toEqual([
      "/administration/users/e-1#security-roles", "/administration/roles-permissions?role=technician"]);
    expect(adminLocationLinks(fra, { employeeId: "e-1" }).map((l) => l.href)).toEqual([
      "/administration/users/e-1#functional-roles", "/administration/users/functional-roles?functionalRole=verifier"]);
    expect(adminLocationLinks(wb).map((l) => l.href)).toEqual(["/administration/workflows?workflow=woProof&version=v-2"]);
    expect(adminLocationLinks(rcg).map((l) => l.href)).toEqual([
      "/administration/objects?object=workOrder", "/administration/roles-permissions?role=technician"]);
    expect(adminLocationLinks({ kind: "PER_EMPLOYEE_WORKFLOW_GRANT", id: "x" })).toEqual([]);
    expect(adminLocationLinks(null)).toEqual([]);
    // Without an Employee id the Employee-page anchors are omitted, never guessed.
    expect(adminLocationLinks(sra).map((l) => l.href)).toEqual(["/administration/roles-permissions?role=technician"]);
    expect(adminLocationLinks(SCOPED_ROW.adminLocations[0], { employeeId: "e-1" })[0].label).toContain("companyReader @ operatingCompany:taylor");
  });

  it("reads a deep-link parameter from the URL and never throws", () => {
    window.history.replaceState(null, "", "/administration/workflows?workflow=woProof&version=v-2");
    expect(readAdminQueryParam("workflow")).toBe("woProof");
    expect(readAdminQueryParam("missing")).toBeNull();
  });
});

describe("Employee > Workflow responsibilities: provenance and where to change it", () => {
  it("renders source Security Role (+scope), Functional Role, condition/guard and a link per admin location", async () => {
    const api = { listPrincipalWorkflowResponsibilities: vi.fn(() => ok({
      principalId: "p-1", securityRoleKeys: ["technician"], responsibilities: [ROW, SCOPED_ROW], boundWithoutAuthority: [],
    })) };
    render(<MemoryRouter><EmployeeWorkflowResponsibilities api={api} principalId="p-1" employeeId="e-1" /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('[data-workflow-responsibilities="READY"]')).not.toBeNull());
    const row = document.querySelector('[data-responsibility="woProof/complete"]');
    expect(row.querySelector("[data-responsibility-condition]").textContent).toBe("guard Record Assignment; grant condition Record Assignment");
    expect([...row.querySelectorAll("[data-admin-location]")].map((el) => el.getAttribute("data-admin-location"))).toEqual([
      "SECURITY_ROLE_ASSIGNMENT", "FUNCTIONAL_ROLE_ASSIGNMENT", "WORKFLOW_BINDING", "ROLE_CAPABILITY_GRANT"]);
    const hrefs = [...row.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/administration/workflows?workflow=woProof&version=v-2");
    expect(hrefs).toContain("/administration/objects?object=workOrder");
    expect(hrefs).toContain("/administration/users/functional-roles?functionalRole=verifier");
    expect(hrefs.some((h) => /workflowGrant|per-employee/i.test(h))).toBe(false);
    const scoped = document.querySelector('[data-responsibility="empReview/review"]');
    expect(scoped.getAttribute("data-responsibility-authority")).toBe("SCOPED");
    expect(scoped.querySelector("[data-via-roles]").textContent).toBe("Company Reader @ Operating Company: Taylor");
  });

  it("works outside a router (plain anchors) and still lists where to fix an inert binding", async () => {
    const api = { listPrincipalWorkflowResponsibilities: vi.fn(() => ok({
      principalId: "p-1", securityRoleKeys: [], responsibilities: [],
      boundWithoutAuthority: [{ ...ROW, authority: "DENIED", reasonCode: "CAPABILITY_MISSING" }],
    })) };
    render(<EmployeeWorkflowResponsibilities api={api} principalId="p-1" employeeId="e-1" />);
    await waitFor(() => expect(document.querySelector('[data-workflow-responsibilities="READY"]')).not.toBeNull());
    const inert = document.querySelector('[data-inert-binding="woProof/complete"]');
    expect(inert.querySelectorAll("[data-admin-location]").length).toBe(4);
    expect(inert.querySelector('a[href="/administration/roles-permissions?role=technician"]')).not.toBeNull();
  });
});

describe("Administration > Workflows deep link", () => {
  it("?workflow=<key>&version=<id> pre-selects that workflow and version", async () => {
    window.history.replaceState(null, "", "/administration/workflows?workflow=workOrder&version=wo-v1");
    const list = [{ workflow: { id: "wf-wo", key: "workOrder", name: "Work Order", description: null, objectKey: "workOrder", activeVersionId: "wo-v2" },
      versions: [{ id: "wo-v1", version: 1, status: "PUBLISHED" }, { id: "wo-v2", version: 2, status: "PUBLISHED" }] }];
    const view = { workflow: list[0].workflow, version: { id: "wo-v1", version: 1, status: "PUBLISHED" }, active: false, steps: [], actions: [] };
    const api = {
      listWorkflows: vi.fn(() => ok(list)), readWorkflowVersion: vi.fn(() => ok(view)),
      validateWorkflowVersion: vi.fn(() => ok({ valid: true, errors: [], warnings: [] })), listWorkflowInstances: vi.fn(() => ok([])),
      readWorkflowHistory: vi.fn(() => ok([])),
    };
    render(<AdminWorkflows api={api} />);
    await screen.findByRole("option", { name: "Work Order · Active" });
    await waitFor(() => expect(api.readWorkflowVersion).toHaveBeenCalledWith("wo-v1"));
    expect(document.querySelector('[data-selected-workflow="workOrder"]')).not.toBeNull();
  });
});
