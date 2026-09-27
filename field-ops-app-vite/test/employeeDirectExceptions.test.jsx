// EMPLOYEE > DIRECT EXCEPTIONS (lane DX) -- the mutable section, proved against the served contract.
//
// Fixtures follow functions/src/eosOps/effectiveAccessExplanation.ts: each action's `directGrant` is
// { label, source, exceptionReason, expiresAt, grantedBy, grantedAt, condition, enforced: true }. The screen takes the
// control-plane seam as `api`; these tests stand in for the server with vi.fn, so what is proved is WHICH governed
// operation is sent with WHAT input, that every refusal is shown verbatim, and that a success re-reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import EmployeeDirectExceptions from "../src/modules/administration/EmployeeDirectExceptions.jsx";
import EmployeeEffectiveAccess from "../src/modules/administration/EmployeeEffectiveAccess.jsx";
import { directExceptionRows, explanationModel } from "../src/modules/administration/controlPlaneModel.js";
import { createAdminControlPlaneClient } from "../src/services/adminControlPlaneClient.js";

afterEach(cleanup);

const RA_WO = { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" };

const EXPLAIN = {
  tenantId: "t-1", principalId: "pr-9", securityRoleKeys: ["dxEmpty"], accessVersion: 2,
  assignments: { excluded: [], scoped: [] }, employeeId: "emp-9", workEligibility: [], operationalScopes: [],
  capabilities: ["workOrder.lifecycle.dispatch"], conditionallyHeld: ["workOrder.record.read"], surfaces: ["service.dispatch"],
  actions: [
    { objectKey: "workOrder", actionKey: "dispatch", actionKind: "BUSINESS_ACTION", capabilityKey: "workOrder.lifecycle.dispatch",
      result: "ALLOWED", reasonCode: "ALLOWED", sourceRoles: [], scopedSources: [],
      directGrant: { label: "DIRECT_EXCEPTION", source: "DIRECT_EXCEPTION", exceptionReason: "covering the dispatch desk [request r-1]",
        expiresAt: "2026-10-01T00:00:00.000Z", grantedBy: "prn-admin", grantedAt: "2026-09-26T10:00:00.000Z", condition: null, enforced: true },
      withheldFromFlatSetKernels: false, surfaces: ["service.dispatch"], workflowSource: null },
    { objectKey: "workOrder", actionKey: "read", actionKind: "READ", capabilityKey: "workOrder.record.read",
      result: "CONDITIONAL", reasonCode: "RECORD_ASSIGNMENT_REQUIRED", sourceRoles: [], scopedSources: [],
      directGrant: { label: "DIRECT_EXCEPTION", source: "DIRECT_EXCEPTION", exceptionReason: "own work orders only",
        expiresAt: null, grantedBy: "prn-admin", grantedAt: "2026-09-26T11:00:00.000Z", condition: RA_WO, enforced: true },
      withheldFromFlatSetKernels: true, surfaces: [], workflowSource: null },
    { objectKey: "opportunity", actionKey: "read", actionKind: "READ", capabilityKey: "opportunity.read",
      result: "DENIED", reasonCode: "CAPABILITY_MISSING", sourceRoles: [], scopedSources: [], directGrant: null,
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
  ],
};

const OBJECTS = [
  { key: "workOrder", label: "Work Order", actions: [
    { actionKey: "read", actionKind: "READ", displayLabel: "Read Work Orders", capabilityKey: "workOrder.record.read" },
    { actionKey: "cancel", actionKind: "BUSINESS_ACTION", displayLabel: "Cancel Work Orders", capabilityKey: "workOrder.lifecycle.cancel" },
  ] },
];

const VOCABULARY = { kinds: [
  { kind: "RECORD_ASSIGNMENT", label: "Record assignment", supported: true,
    parameters: [{ name: "relation", values: ["ASSIGNED_EMPLOYEE"] }], recordKinds: ["workOrder"], capabilities: ["workOrder.record.read"] },
] };

function makeApi(over = {}) {
  return {
    explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: EXPLAIN })),
    listObjectsWithActions: vi.fn(async () => ({ ok: true, data: OBJECTS })),
    listSupportedConditionKinds: vi.fn(async () => ({ ok: true, data: VOCABULARY })),
    grantObjectActionToPrincipal: vi.fn(async () => ({ ok: true, data: { id: "pc-1" } })),
    revokeObjectActionFromPrincipal: vi.fn(async () => ({ ok: true, data: { id: "pc-1" } })),
    setGrantCondition: vi.fn(async () => ({ ok: true, data: { id: "gc-1" } })),
    retireGrantCondition: vi.fn(async () => ({ ok: true, data: null })),
    ...over,
  };
}

const typeReason = (form, text) => fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: text } });
const ready = () => waitFor(() => expect(document.querySelector('[data-direct-exceptions="READY"]')).toBeTruthy());

describe("Direct Exceptions: the mutable Employee section", () => {
  it("lists each direct exception labelled DIRECT EXCEPTION with source, reason, actor, created, expiry, condition and the evaluator's result", async () => {
    const api = makeApi();
    render(<EmployeeDirectExceptions api={api} principalId="pr-9" />);
    await ready();
    expect(api.explainEffectiveAccess).toHaveBeenCalledWith("pr-9");
    const rows = document.querySelectorAll("[data-direct-exception]");
    expect([...rows].map((r) => r.getAttribute("data-direct-exception"))).toEqual(["workOrder.lifecycle.dispatch", "workOrder.record.read"]);
    const dispatch = document.querySelector('[data-direct-exception="workOrder.lifecycle.dispatch"]');
    expect(dispatch.getAttribute("data-enforced")).toBe("true");
    expect(dispatch.textContent).toMatch(/DIRECT EXCEPTION/);
    expect(dispatch.textContent).toMatch(/Enforced by every runtime gate/);
    expect(dispatch.textContent).toMatch(/covering the dispatch desk/);
    expect(dispatch.textContent).toMatch(/prn-admin/);
    expect(dispatch.textContent).toMatch(/2026-09-26T10:00:00.000Z/);
    expect(dispatch.textContent).toMatch(/2026-10-01T00:00:00.000Z/);
    expect(dispatch.textContent).toMatch(/none — unconditioned/);
    expect(dispatch.textContent).toMatch(/Allowed \(ALLOWED\)/);
    const read = document.querySelector('[data-direct-exception="workOrder.record.read"]');
    expect(read.textContent).toMatch(/assigned Employee on the workOrder/);
    expect(read.textContent).toMatch(/Conditional \(RECORD_ASSIGNMENT_REQUIRED\)/);
    expect(read.textContent).toMatch(/never/);
  });

  it("revokes with a stated reason, then RE-READS -- nothing optimistic", async () => {
    const api = makeApi();
    const onChanged = vi.fn();
    render(<EmployeeDirectExceptions api={api} principalId="pr-9" onChanged={onChanged} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Revoke direct exception workOrder.lifecycle.dispatch" }));
    const form = screen.getByRole("form", { name: "Revoke workOrder.lifecycle.dispatch" });
    expect(within(form).getByRole("button", { name: "Confirm revoke" }).disabled).toBe(true);
    typeReason(form, "cover ended");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm revoke" })); });
    expect(api.revokeObjectActionFromPrincipal).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "dispatch", principalId: "pr-9", reason: "cover ended" });
    await waitFor(() => expect(api.explainEffectiveAccess.mock.calls.length).toBeGreaterThan(1));
    expect(onChanged).toHaveBeenCalled();
  });

  it("attaches a supported condition from the SERVER's vocabulary, and retires one -- a server refusal is shown verbatim", async () => {
    const api = makeApi({
      retireGrantCondition: vi.fn(async () => ({ ok: false, code: "CONFLICT", message: "CONDITION_RETIREMENT_WOULD_WIDEN: pr-9 still holds the direct exception" })),
    });
    render(<EmployeeDirectExceptions api={api} principalId="pr-9" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Attach condition to direct exception workOrder.record.read" }));
    const form = screen.getByRole("form", { name: "Replace condition workOrder.record.read" });
    await waitFor(() => expect(within(form).getByLabelText("Condition kind").disabled).toBe(false));
    fireEvent.change(within(form).getByLabelText("Condition kind"), { target: { value: "RECORD_ASSIGNMENT" } });
    fireEvent.change(within(form).getByLabelText("Record kind"), { target: { value: "workOrder" } });
    typeReason(form, "own records only");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Confirm replace condition" })); });
    expect(api.setGrantCondition).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", principalId: "pr-9", reason: "own records only", condition: RA_WO });

    fireEvent.click(await screen.findByRole("button", { name: "Retire condition on direct exception workOrder.record.read" }));
    const retire = screen.getByRole("form", { name: "Retire condition workOrder.record.read" });
    typeReason(retire, "lift it");
    await act(async () => { fireEvent.click(within(retire).getByRole("button", { name: "Confirm retire condition" })); });
    expect(api.retireGrantCondition).toHaveBeenCalledWith({ objectKey: "workOrder", actionKey: "read", principalId: "pr-9", reason: "lift it" });
    const refusal = await screen.findByRole("alert");
    expect(refusal.getAttribute("data-control-plane-refusal")).toBe("CONFLICT");
    expect(refusal.textContent).toBe("CONFLICT: CONDITION_RETIREMENT_WOULD_WIDEN: pr-9 still holds the direct exception");
  });

  it("grants a new direct exception: Object action, optional condition, optional expiry, required reason", async () => {
    const api = makeApi();
    render(<EmployeeDirectExceptions api={api} principalId="pr-9" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Grant a direct exception" }));
    const form = await screen.findByRole("form", { name: "Grant a direct exception" });
    await waitFor(() => expect(within(form).getAllByRole("option").length).toBeGreaterThan(1));
    const submit = within(form).getByRole("button", { name: "Grant direct exception" });
    fireEvent.change(within(form).getByLabelText("Object"), { target: { value: "workOrder" } });
    fireEvent.change(within(form).getByLabelText("Action"), { target: { value: "cancel" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Expires"), { target: { value: "2026-12-31T17:00" } });
    typeReason(form, "holiday cover");
    expect(submit.disabled).toBe(false);
    await act(async () => { fireEvent.click(submit); });
    const [input] = api.grantObjectActionToPrincipal.mock.calls[0];
    expect(input).toMatchObject({ objectKey: "workOrder", actionKey: "cancel", principalId: "pr-9", reason: "holiday cover" });
    expect(Date.parse(input.expiresAt)).toBe(Date.parse("2026-12-31T17:00"));
    expect("condition" in input).toBe(false);
    expect("scopeType" in input).toBe(false);
    await waitFor(() => expect(api.explainEffectiveAccess.mock.calls.length).toBeGreaterThan(1));
  });

  it("a FORBIDDEN / SYSTEM_INVARIANT / scope refusal from the server is rendered as itself", async () => {
    const api = makeApi({
      grantObjectActionToPrincipal: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "SELF_ADMINISTRATION: a principal may not grant a capability to itself" })),
    });
    render(<EmployeeDirectExceptions api={api} principalId="pr-9" />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Grant a direct exception" }));
    const form = await screen.findByRole("form", { name: "Grant a direct exception" });
    await waitFor(() => expect(within(form).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(within(form).getByLabelText("Object"), { target: { value: "workOrder" } });
    fireEvent.change(within(form).getByLabelText("Action"), { target: { value: "cancel" } });
    typeReason(form, "why");
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Grant direct exception" })); });
    expect((await screen.findByRole("alert")).textContent).toBe("FORBIDDEN: SELF_ADMINISTRATION: a principal may not grant a capability to itself");
    expect(api.explainEffectiveAccess).toHaveBeenCalledTimes(1);
  });

  it("with no linked Principal there is nothing to administer; an unreadable payload fails closed", async () => {
    render(<EmployeeDirectExceptions api={makeApi()} principalId={null} />);
    expect(document.querySelector('[data-direct-exceptions="NO_PRINCIPAL"]')).toBeTruthy();
    cleanup();
    render(<EmployeeDirectExceptions api={makeApi({ explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: { nope: true } })) })} principalId="pr-9" />);
    await waitFor(() => expect(document.querySelector('[data-direct-exceptions="UNREADABLE"]')).toBeTruthy());
  });

  it("Effective Access shows an enforced direct exception as enforced, with its condition -- no 'not enforced' text", async () => {
    render(<EmployeeEffectiveAccess api={makeApi()} principalId="pr-9" />);
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    const read = document.querySelector('[data-capability="workOrder.record.read"] [data-direct-grant="DIRECT_EXCEPTION"]');
    expect(read.textContent).toMatch(/Enforced by every runtime gate/);
    expect(read.textContent).toMatch(/Condition: assigned Employee on the workOrder/);
    expect(read.textContent).not.toMatch(/Not enforced/);
  });
});

describe("the direct-exception seam and model", () => {
  it("sends exactly one grantee per condition command, and the direct grant/revoke inputs", async () => {
    const call = vi.fn(async () => ({ ok: true, data: null }));
    const client = createAdminControlPlaneClient(call);
    await client.setGrantCondition({ objectKey: "o", actionKey: "a", principalId: "p", condition: RA_WO, reason: "why" });
    await client.retireGrantCondition({ objectKey: "o", actionKey: "a", principalId: "p", reason: "why" });
    await client.setGrantCondition({ objectKey: "o", actionKey: "a", roleKey: "r", condition: RA_WO, reason: "why" });
    await client.grantObjectActionToPrincipal({ objectKey: "o", actionKey: "a", principalId: "p", reason: "why" });
    await client.grantObjectActionToPrincipal({ objectKey: "o", actionKey: "a", principalId: "p", reason: "why", expiresAt: "2027-01-01T00:00:00.000Z", condition: RA_WO });
    await client.revokeObjectActionFromPrincipal({ objectKey: "o", actionKey: "a", principalId: "p", reason: "why" });
    expect(call.mock.calls).toEqual([
      ["setGrantCondition", { objectKey: "o", actionKey: "a", principalId: "p", condition: RA_WO, reason: "why" }],
      ["retireGrantCondition", { objectKey: "o", actionKey: "a", principalId: "p", reason: "why" }],
      ["setGrantCondition", { objectKey: "o", actionKey: "a", roleKey: "r", condition: RA_WO, reason: "why" }],
      ["grantObjectActionToPrincipal", { objectKey: "o", actionKey: "a", principalId: "p", reason: "why" }],
      ["grantObjectActionToPrincipal", { objectKey: "o", actionKey: "a", principalId: "p", reason: "why", expiresAt: "2027-01-01T00:00:00.000Z", condition: RA_WO }],
      ["revokeObjectActionFromPrincipal", { objectKey: "o", actionKey: "a", principalId: "p", reason: "why" }],
    ]);
  });

  it("directExceptionRows keeps the server's fields and decides nothing", () => {
    const rows = directExceptionRows(explanationModel(EXPLAIN));
    expect(rows.map((r) => [r.capabilityKey, r.enforced, r.grantedBy, r.condition, r.result])).toEqual([
      ["workOrder.lifecycle.dispatch", true, "prn-admin", null, "ALLOWED"],
      ["workOrder.record.read", true, "prn-admin", "assigned Employee on the workOrder", "CONDITIONAL"],
    ]);
    expect(rows[1].conditionRaw).toEqual(RA_WO);
    expect(directExceptionRows(null)).toEqual([]);
  });
});
