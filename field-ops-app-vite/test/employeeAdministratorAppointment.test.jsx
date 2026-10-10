// EMPLOYEE > ROLES & ACCESS > ADMINISTRATOR CHECKBOX (DECISIONS #223, PR-6).
//
// What is proved: the box reflects an ACTIVE GLOBAL assignment of the Role keyed `admin` AND protected (never a display
// name); appointing needs a reason and sends assignRole with NO scope; removing sends revokeRole for that exact
// assignment; a server refusal is shown in words AND verbatim, and the box is re-read after every attempt (never
// optimistic); the box is disabled with a visible reason for yourself, with no linked Principal, and without the page's
// admin.roleAssignment.write signal; the generic picker no longer offers the Administrator; the Owner never appears.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

let session = { user: { uid: "uid-viewer" }, role: "admin", loading: false };
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => session }));

import EmployeeSecurityRoles from "../src/modules/administration/EmployeeSecurityRoles.jsx";
import UserDetail from "../src/modules/administration/UserDetail.jsx";
import { administratorRefusalSentence } from "../src/modules/administration/administratorAppointmentModel.js";

afterEach(cleanup);
beforeEach(() => { session = { user: { uid: "uid-viewer" }, role: "admin", loading: false }; });

const ROLES = [
  { id: "role-gm", key: "generalManager", name: "General Manager", protected: false },
  { id: "role-admin", key: "admin", name: "System Administrator", protected: true },
  // A NON-protected Role named "Administrator" must never be mistaken for the designated one.
  { id: "role-fake", key: "adminLookalike", name: "Administrator", protected: false },
  { id: "role-owner", key: "owner", name: "Owner", protected: true },
];

const GM = { id: "asg-gm", roleId: "role-gm", roleKey: "generalManager", scopeType: "global", scopeValue: null, status: "active", grantedAt: "2026-09-01T00:00:00.000Z" };
const ADMIN_GLOBAL = { id: "asg-admin", roleId: "role-admin", roleKey: "admin", scopeType: "global", scopeValue: null, status: "active", grantedAt: "2026-09-02T00:00:00.000Z" };

function makeApi({ held = [GM], ...over } = {}) {
  let rows = held;
  const api = {
    listPrincipalRoleAssignments: vi.fn(async (principalId) => ({ ok: true, data: { principalId, accessVersion: 1, assignments: rows } })),
    listRoles: vi.fn(async () => ({ ok: true, data: ROLES })),
    listSupportedAssignmentScopes: vi.fn(async () => ({ ok: false, code: "UNKNOWN_OPERATION", message: "not served" })),
    assignRole: vi.fn(async (input) => { rows = [...rows, { ...ADMIN_GLOBAL, roleId: input.roleId }]; return { ok: true, data: { id: "asg-admin" } }; }),
    revokeRole: vi.fn(async ({ assignmentId }) => { rows = rows.filter((a) => a.id !== assignmentId); return { ok: true, data: { id: assignmentId } }; }),
    ...over,
  };
  return api;
}

const grantsRoleWrite = (id) => id === "admin.roleAssignment.write";
const box = () => screen.getByRole("checkbox", { name: "Administrator" });
const renderControl = (api, props = {}) =>
  render(<EmployeeSecurityRoles api={api} principalId="pr-1" employeeName="Jane" viewerIsSelf={false} hasCapability={grantsRoleWrite} {...props} />);
const settled = () => waitFor(() => expect(screen.getByRole("table", { name: "Security Roles held" })).toBeTruthy());
const confirmWithReason = async (reason, label) => {
  const dialog = await screen.findByRole("dialog");
  if (reason !== null) fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: reason } });
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: label })); });
};

describe("Administrator checkbox: state from the server", () => {
  it("is unchecked when the Principal holds no active global Administrator assignment, checked when it does", async () => {
    renderControl(makeApi());
    await settled();
    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);
    expect(screen.getByText(/Full system administration\. Not a job assignment, and it grants no Work Eligibility\./)).toBeTruthy();
    cleanup();
    renderControl(makeApi({ held: [GM, ADMIN_GLOBAL] }));
    await settled();
    expect(box().checked).toBe(true);
  });

  it("ignores a scoped or disabled Administrator assignment and a non-protected Role named Administrator", async () => {
    renderControl(makeApi({ held: [
      { ...ADMIN_GLOBAL, id: "asg-scoped", scopeType: "operatingCompany", scopeValue: "taylor" },
      { ...ADMIN_GLOBAL, id: "asg-old", status: "disabled" },
      { ...GM, id: "asg-fake", roleId: "role-fake", roleKey: "adminLookalike" },
    ] }));
    await waitFor(() => expect(screen.getByRole("table", { name: "Security Roles held" })).toBeTruthy());
    expect(box().checked).toBe(false);
  });
});

describe("Administrator checkbox: appoint and remove through the governed commands", () => {
  it("appointing requires a reason and sends assignRole with NO scope, then re-reads", async () => {
    const api = makeApi();
    renderControl(api);
    await settled();
    fireEvent.click(box());
    // No reason -> nothing is sent.
    await confirmWithReason(null, "Appoint Administrator");
    expect(api.assignRole).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a reason to continue.")).toBeTruthy();
    await confirmWithReason("Covering IT administration", "Appoint Administrator");
    expect(api.assignRole).toHaveBeenCalledTimes(1);
    expect(api.assignRole.mock.calls[0][0]).toEqual({ principalId: "pr-1", roleId: "role-admin", reason: "Covering IT administration" });
    await waitFor(() => expect(api.listPrincipalRoleAssignments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box().checked).toBe(true));
  });

  it("removing sends revokeRole for the exact active global assignment, then re-reads", async () => {
    const api = makeApi({ held: [GM, { ...ADMIN_GLOBAL, id: "asg-scoped", scopeType: "operatingCompany", scopeValue: "taylor" }, ADMIN_GLOBAL] });
    renderControl(api);
    await settled();
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    await confirmWithReason("Left the IT team", "Remove Administrator");
    expect(api.revokeRole).toHaveBeenCalledWith({ assignmentId: "asg-admin", reason: "Left the IT team" });
    await waitFor(() => expect(api.listPrincipalRoleAssignments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(box().checked).toBe(false));
  });

  it("a server refusal is shown in words AND verbatim, and the box is re-read (not flipped)", async () => {
    const api = makeApi({
      held: [GM, ADMIN_GLOBAL],
      revokeRole: vi.fn(async () => ({ ok: false, code: "INVALID_INPUT",
        message: "this is the last active administering assignment -- revoking it would leave the tenant unadministrable" })),
    });
    renderControl(api);
    await settled();
    fireEvent.click(box());
    await confirmWithReason("Test", "Remove Administrator");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/This is the last Administrator\./);
    expect(alert.querySelector('[data-control-plane-refusal="INVALID_INPUT"]').textContent)
      .toBe("INVALID_INPUT: this is the last active administering assignment -- revoking it would leave the tenant unadministrable");
    await waitFor(() => expect(api.listPrincipalRoleAssignments).toHaveBeenCalledTimes(2));
    expect(box().checked).toBe(true);
  });

  it("maps the expected refusal codes to a short human sentence", () => {
    const words = (code, message) => administratorRefusalSentence({ ok: false, code, message });
    expect(words("FORBIDDEN", "SELF_ADMINISTRATION: a principal may not assign the Administrator Role to itself")).toMatch(/themself/);
    expect(words("FORBIDDEN", "PROTECTED_ROLE_CONFLICT: the protected Owner and ...")).toMatch(/Owner cannot also be appointed/);
    expect(words("CONFLICT", "WOULD_REMOVE_LAST_ADMINISTRATION_PATH: ...")).toMatch(/last Administrator/);
    expect(words("FORBIDDEN", "PRIVILEGE_ESCALATION: assigning admin concerns ...")).toMatch(/not permitted/);
    expect(words("FORBIDDEN", "not authorized")).toMatch(/not permitted/);
    expect(administratorRefusalSentence({ ok: true })).toBeNull();
  });
});

describe("Administrator checkbox: disabled with a visible reason", () => {
  it("viewing yourself", async () => {
    renderControl(makeApi(), { viewerIsSelf: true });
    await settled();
    expect(box().disabled).toBe(true);
    expect(document.querySelector("[data-administrator-appointment-disabled]").textContent).toMatch(/your own account/);
  });

  it("no linked Principal", async () => {
    render(<EmployeeSecurityRoles api={makeApi()} principalId={null} viewerIsSelf={false} hasCapability={grantsRoleWrite} />);
    expect(box().disabled).toBe(true);
    expect(document.querySelector("[data-administrator-appointment-disabled]").textContent).toMatch(/No governed Principal is linked/);
  });

  it("the viewer lacks admin.roleAssignment.write", async () => {
    renderControl(makeApi(), { hasCapability: (id) => id !== "admin.roleAssignment.write" });
    await settled();
    expect(box().disabled).toBe(true);
    expect(document.querySelector("[data-administrator-appointment-disabled]").textContent).toMatch(/admin\.roleAssignment\.write/);
  });
});

describe("the generic picker and the Owner", () => {
  it("the generic Security Role picker never offers the designated Administrator", async () => {
    renderControl(makeApi());
    const select = await screen.findByRole("combobox", { name: "Security Role to assign" });
    const values = within(select).getAllByRole("option").map((o) => o.value);
    expect(values).not.toContain("role-admin");
    // The non-protected look-alike is an ordinary Role and stays in the picker.
    expect(values).toContain("role-fake");
  });

  it("the Owner Role is never shown or touched by the Administrator control", async () => {
    const api = makeApi({ held: [GM, { ...ADMIN_GLOBAL, id: "asg-owner", roleId: "role-owner", roleKey: "owner" }] });
    renderControl(api);
    await settled();
    const control = document.querySelector("[data-administrator-appointment]");
    expect(control.textContent).not.toMatch(/Owner/);
    expect(box().checked).toBe(false);
    fireEvent.click(box());
    await confirmWithReason("Appoint", "Appoint Administrator");
    expect(api.assignRole.mock.calls[0][0].roleId).toBe("role-admin");
    expect(api.revokeRole).not.toHaveBeenCalled();
  });
});

describe("Employee record wiring: self is the signed-in credential", () => {
  const LINK = { linkId: "l-1", principalId: "pr-1", principalDisplayName: "Jane Doe", principalStatus: "active", membershipStatus: "active",
    linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null };
  const JANE = { employeeId: "emp-1", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", employeeNumber: null, jobTitle: null,
    name: { displayName: "Jane Doe", firstName: null, middleName: null, lastName: null, preferredName: null },
    contact: { workEmail: null, workPhone: null, mobilePhone: null }, address: { street: null, unit: null, city: null, state: null, postalCode: null },
    hireDate: null, separationDate: null, currentManager: null, userAccess: "LINKED", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const workforce = {
    call: vi.fn(async (operation) => {
      switch (operation) {
        case "readEmployee": return { ok: true, result: JANE };
        case "readEmployeePrincipalLink": return { ok: true, result: { employeeId: "emp-1", userAccess: "LINKED", link: LINK } };
        case "listEmployeeJobRoleHistory": return { ok: true, result: { employeeId: "emp-1", current: null, items: [], truncated: false } };
        case "readMyWorkforceCapabilities": return { ok: true, result: { capabilities: [] } };
        default: return { ok: true, result: { items: [], truncated: false, nextCursor: null } };
      }
    }),
  };
  const policyCall = vi.fn(async (operation) => {
    switch (operation) {
      case "listTenantPrincipals": return { ok: true, data: [{ id: "pr-1", externalSubject: "uid-jane", identityProvider: "firebase", status: "active" }] };
      case "listPrincipalRoleAssignments": return { ok: true, data: { principalId: "pr-1", accessVersion: 1, assignments: [GM] } };
      case "listRoles": return { ok: true, data: ROLES };
      default: return { ok: false, code: "UNKNOWN_OPERATION", message: "not served" };
    }
  });
  const client = {
    readPrincipalAccessState: vi.fn().mockResolvedValue({ ok: true, state: { authExists: true, accountStatus: "enabled", assignments: [] } }),
    listRecordChangeHistory: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
  };
  const renderRecord = (hasCapability) => render(
    <MemoryRouter initialEntries={["/administration/users/emp-1?tab=access"]}>
      <Routes>
        <Route path="/administration/users/:employeeId" element={<UserDetail client={client} workforce={workforce} policyCall={policyCall} hasCapability={hasCapability} />} />
      </Routes>
    </MemoryRouter>,
  );
  const roleWrite = (id) => id === "admin.roleAssignment.write";

  it("another person's record with admin.roleAssignment.write: the box is offered", async () => {
    renderRecord(roleWrite);
    fireEvent.click(await screen.findByRole("tab", { name: "Roles & Access" }));
    await waitFor(() => expect(box().disabled).toBe(false));
  });

  it("your own record: the box is disabled with the reason", async () => {
    session = { user: { uid: "uid-jane" }, role: "admin", loading: false };
    renderRecord(roleWrite);
    fireEvent.click(await screen.findByRole("tab", { name: "Roles & Access" }));
    await waitFor(() => expect(document.querySelector("[data-administrator-appointment-disabled]")?.textContent).toMatch(/your own account/));
    expect(box().disabled).toBe(true);
  });
});
