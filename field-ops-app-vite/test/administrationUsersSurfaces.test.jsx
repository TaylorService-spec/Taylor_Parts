// ADMINISTRATION > USERS -- the directory, the record page, the edit flow, and the shared history.
//
// Rendered through the real components with the Firestore reads mocked at the hook boundary and
// the governed writes mocked at the SEAM -- the same technique accountDetailFailClosed.test.jsx
// uses. No Firebase, no network, and no capability granted anywhere: the fail-closed states below
// are the states the running app is in today.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockNavigate = vi.fn();
let directory = { byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null };

vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => directory,
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "actor-1" }, role: "admin", loading: false }),
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useNavigate: () => mockNavigate };
});

// The list runtime reads Firestore; the directory page is exercised through a controlled
// presentation instead, so this file tests the SCREEN rather than the metadata runtime (which has
// its own suites).
let listState = { presentation: null, loadMore: vi.fn(), retry: vi.fn() };
vi.mock("../src/hooks/useMetadataList", () => ({
  useMetadataList: () => listState,
}));

import AdminUsers from "../src/modules/administration/AdminUsers.jsx";
import UserDetail from "../src/modules/administration/UserDetail.jsx";
import { employeeEntity, employeeIndexList } from "../src/metadata/definitions/employee.js";
import { OPERATIONAL_ROLE_OPTIONS } from "../src/domain/employeeProfile.js";
import { REPORT_CAPABILITY_REQUEST } from "../src/access/reportCapabilityAccess.js";
import { ADMINISTRATION_USERS_SURFACE_CAPABILITIES } from "../src/access/governedSurfaceCapabilities.js";
import { buildListPresentation } from "../src/metadata/listPresentation.js";

const JOHN = {
  id: "emp-1",
  employeeId: "emp-1",
  displayName: "John Smith",
  employmentStatus: "ACTIVE",
  operationalRoles: ["TECHNICIAN"],
  securityRole: "technician",
  userId: "uid-john",
  jobTitle: "Senior Service Technician",
  employeeNumber: "TAZ-0042",
  operatingCompanyId: "taylor",
  managerEmployeeId: "emp-2",
};
const MIKE = { id: "emp-2", employeeId: "emp-2", displayName: "Mike Jones", employmentStatus: "ACTIVE" };
const UNLINKED = { id: "emp-3", employeeId: "emp-3", displayName: "Pat Lee", employmentStatus: "CONTRACTOR" };

function seedDirectory(records = [JOHN, MIKE]) {
  directory = {
    byUserId: new Map(records.filter((r) => r.userId).map((r) => [r.userId, r])),
    byEmployeeId: new Map(records.map((r) => [r.id, r])),
    loading: false,
    error: null,
  };
}

// The trusted principal-access read defaults to an ENABLED account holding no governed Role: the
// commonest real state, and the one that makes "which button is offered" meaningful. Tests that
// care about the other states pass their own `access`.
const ENABLED_NO_ROLES = { authExists: true, accountStatus: "enabled", assignments: [] };

const okHistory = (rows = [], access = ENABLED_NO_ROLES) => ({
  updateEmployeeProfile: vi.fn().mockResolvedValue({ ok: true, result: "APPLIED", changedFields: [] }),
  setUserStatus: vi.fn(),
  assignApprovedRole: vi.fn().mockResolvedValue({ ok: true, result: "APPLIED", assignmentId: "a-1" }),
  revokeRole: vi.fn().mockResolvedValue({ ok: true, result: "APPLIED" }),
  readPrincipalAccessState: vi.fn().mockResolvedValue({ ok: true, state: access }),
  listRecordChangeHistory: vi.fn().mockResolvedValue({ ok: true, rows }),
});

/** A denied read -- the state every principal without admin.principalAccess.read is in. */
const deniedAccessRead = (rows = []) => ({
  ...okHistory(rows),
  readPrincipalAccessState: vi.fn().mockResolvedValue({ ok: false, state: null, result: "DENIED" }),
});

// `hasCapability` defaults to UNDEFINED, which is what the running app passes when the trusted feed
// has not returned a positive decision -- so every test that omits it is exercising the real
// fail-closed path rather than a test-only one.
const renderDetail = (client, employeeId = "emp-1", search = "", hasCapability = undefined) =>
  render(
    <MemoryRouter initialEntries={[`/administration/users/${employeeId}${search}`]}>
      <Routes>
        <Route
          path="/administration/users/:employeeId"
          element={<UserDetail client={client} hasCapability={hasCapability} />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mockNavigate.mockClear();
  seedDirectory();
  listState = {
    presentation: buildListPresentation({
      def: employeeIndexList,
      entity: employeeEntity,
      page: { rows: [JOHN, UNLINKED], hasMore: false },
    }),
    loadMore: vi.fn(),
    retry: vi.fn(),
  };
});
afterEach(cleanup);

// ════════════════════ THE DIRECTORY ════════════════════

describe("Administration > Users is the one people directory", () => {
  it("renders the authoritative employee directory under the name Users", () => {
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.getByText("John Smith")).toBeTruthy();
    expect(screen.getByText("Pat Lee")).toBeTruthy();
  });

  it("shows the six columns the directory is for -- with EOS Account as WORDS, never a uid", () => {
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    // "EOS Account", not "EOS Access" (Owner ruling, PR #1806): the value is linkage, and a heading
    // reading Access over it claims something no read on this page can support.
    // "Legacy role", not "Security Role": a directory column headed Security Role reads as current
    // governed access to everyone scanning the list, and it is the legacy mirror.
    for (const heading of ["Name", "Employment Status", "Operational Roles", "EOS Account", "Legacy role"]) {
      expect(screen.getByRole("columnheader", { name: heading }), heading).toBeTruthy();
    }
    expect(screen.queryByRole("columnheader", { name: "EOS Access" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Security Role" })).toBeNull();
    expect(screen.getByText("Account linked")).toBeTruthy();
    expect(screen.getByText("No account")).toBeTruthy();
    // The linked employee's raw uid must not appear anywhere on the page.
    expect(screen.queryByText("uid-john")).toBeNull();
  });

  it("EOS Account is NOT derived from employment status", () => {
    // Pat Lee is a CONTRACTOR with no account; John is ACTIVE with one. A status-derived column
    // would call the contractor disabled, which is the conflation this product forbids.
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    expect(screen.getByText("Contractor")).toBeTruthy();
    expect(screen.getByText("Account linked")).toBeTruthy();
  });

  it("a row click opens the record READ-ONLY, and nothing on the row becomes editable", () => {
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    fireEvent.click(screen.getByText("John Smith"));
    expect(mockNavigate).toHaveBeenCalledWith("/administration/users/emp-1");
    // No edit affordance was created by the click: the row has no inputs at all.
    expect(screen.queryAllByRole("textbox").length).toBe(0);
    expect(screen.queryAllByRole("combobox").length).toBe(0);
  });

  it("Edit is a DELIBERATE, separate action beside the name", () => {
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits.length).toBe(2); // one per row
    fireEvent.click(edits[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/administration/users/emp-1?edit=1");
  });

  it("the count is withheld while pages remain", () => {
    listState = {
      ...listState,
      presentation: buildListPresentation({
        def: employeeIndexList,
        entity: employeeEntity,
        page: { rows: [JOHN], hasMore: true },
      }),
    };
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    expect(screen.queryByText("1")).toBeNull();
  });
});

// ════════════════════ THE RECORD PAGE ════════════════════

describe("User Detail is read-only by default", () => {
  it("answers who this person is, what they do, and whether they are active", async () => {
    renderDetail(okHistory());
    expect(await screen.findByRole("heading", { level: 1, name: "John Smith" })).toBeTruthy();
    expect(screen.getAllByText(/Senior Service Technician/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TAZ-0042/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("renders identity, employment, operational assignment and access as separate sections", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    for (const title of ["Identity & contact", "Employment", "Operational assignment", "EOS access & security"]) {
      expect(screen.getByRole("heading", { name: title }), title).toBeTruthy();
    }
    expect(screen.getByText("Taylor Freezer of Arizona")).toBeTruthy();
  });

  it("opens with NO form controls -- editing is a choice, never a side effect of arriving", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit User" })).toBeTruthy();
  });

  it("the manager is a LINK to that person's own record, not display text", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    const link = screen.getByRole("link", { name: "Mike Jones" });
    expect(link.getAttribute("href")).toBe("/administration/users/emp-2");
  });

  it("a recorded manager who cannot be resolved reads as unavailable, never as a raw id", async () => {
    seedDirectory([{ ...JOHN, managerEmployeeId: "emp-ghost" }]);
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.queryByText("emp-ghost")).toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
  });

  it("missing optional fields render honestly rather than as blanks", async () => {
    seedDirectory([{ id: "emp-1", employeeId: "emp-1", displayName: "New Person", employmentStatus: "ACTIVE" }]);
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "New Person" });
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  it("a user who is not in the directory is a NOT-FOUND, not an empty record", async () => {
    renderDetail(okHistory(), "emp-nobody");
    expect(await screen.findByText("This user could not be found.")).toBeTruthy();
  });
});

// ════════════════════ ACCESS & SECURITY ════════════════════

describe("EOS access and security stay independent, and fail closed", () => {
  it("the account's enabled/disabled state comes from the trusted read, never an inference", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "", () => true);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(client.readPrincipalAccessState).toHaveBeenCalledWith({ principalUid: "uid-john" });
    // The value shown is the one the read returned. Nothing here derives it from employment status
    // (John is ACTIVE) or from the fact that he has a linked account.
    const row = document.querySelector("[data-user-account-status]");
    expect(row.getAttribute("data-user-account-status")).toBe("enabled");
    expect(row.textContent).toMatch(/Enabled/);
  });

  it("offers ONLY the action that moves the account from where it actually is", async () => {
    // An enabled account offers Disable and nothing else. The old surface offered both, because it
    // could not see the current state and made the administrator choose correctly on its behalf.
    renderDetail(okHistory(), "emp-1", "", () => true);
    await screen.findByRole("button", { name: /Disable Account/ });
    expect(screen.queryByRole("button", { name: /Enable Account/ })).toBeNull();
  });

  it("and the mirror image for a disabled account", async () => {
    renderDetail(
      okHistory([], { authExists: true, accountStatus: "disabled", assignments: [] }),
      "emp-1",
      "",
      () => true,
    );
    await screen.findByRole("button", { name: /Enable Account/ });
    expect(screen.queryByRole("button", { name: /Disable Account/ })).toBeNull();
  });

  it("a read the caller may not perform says so, and offers no status action at all", async () => {
    // DENIED and UNAVAILABLE are different facts, and neither may be rendered as a status. An
    // action offered beside an unknown state is the guess this whole section exists to stop.
    renderDetail(deniedAccessRead(), "emp-1", "", (id) => id !== "admin.principalAccess.read");
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    const row = document.querySelector("[data-user-account-status]");
    expect(row.textContent).toMatch(/do not have access to read/i);
    expect(screen.queryByRole("button", { name: /Disable Account/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enable Account/ })).toBeNull();
  });

  it("the status action fails closed with a stated reason when the write grant is absent", async () => {
    // Read granted, write withheld: the state is visible and the action is protected. A coherent
    // and useful state, not a half-broken one.
    renderDetail(okHistory(), "emp-1", "", (id) => id === "admin.principalAccess.read");
    const disable = await screen.findByRole("button", { name: /Disable Account/ });
    expect(disable.hasAttribute("disabled")).toBe(true);
    // The reason says what THIS SESSION can know, and no more. It used to claim no principal held
    // the grant "in any environment yet", which stopped being true the day sandbox's admin persona
    // was bootstrapped -- a control that explains itself with a claim about every environment is a
    // control that will eventually lie.
    expect(screen.getAllByText(/trusted access feed did not grant this action/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/in any environment/i)).toBeNull();
  });

  it("they go LIVE when the trusted feed grants the capability", async () => {
    // The other half, and the one that was unreachable: with a positive decision the controls are
    // real. Without this, "fails closed" is indistinguishable from "never works".
    renderDetail(okHistory(), "emp-1", "", () => true);
    const disable = await screen.findByRole("button", { name: /Disable Account/ });
    expect(disable.hasAttribute("disabled")).toBe(false);

    fireEvent.click(disable);
    const dialog = screen.getByRole("dialog", { name: /account status/i });
    // Consequential, so it confirms first -- and names the person and the state it sets.
    expect(within(dialog).getByText(/John Smith/)).toBeTruthy();
    expect(within(dialog).getAllByText(/disabled/).length).toBeGreaterThan(0);
  });

  it("Security Role is shown as the MIRROR it is, with no control over it", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.getByText(/Mirrors the legacy identity role/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /security role/i })).toBeNull();
  });

  // ── ASSIGN A ROLE ──
  // The control an administrator uses to give somebody access, on the page where the person IS the
  // target. Everything below is about what it says when it cannot act -- which is its state for
  // every principal who does not hold admin.roleAssignment.write.

  it("Add Role is SHOWN and protected without the grant, never hidden", async () => {
    // Hiding it would make "how do I give someone Sales access" unanswerable: the administrator
    // would see no control and conclude the product cannot do it. Password reset hides because its
    // availability is itself sensitive; who may hold a Role is not.
    renderDetail(okHistory(), "emp-1", "", (id) => id === "admin.principalAccess.read");
    const add = await screen.findByRole("button", { name: /Add Role/ });
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("combobox", { name: /Role to assign/i }).disabled).toBe(true);
  });

  it("is called Add Role, because assignApprovedRole ADDS -- it never replaces", async () => {
    // Measured from the command: assignApprovedRole is a txn.create on roleAssignments and never
    // reads or revokes an existing one. A person holds zero or more Roles and their authority is
    // the union. "Change Role" would name a replacement no command performs.
    renderDetail(okHistory(), "emp-1", "", () => true);
    await screen.findByRole("button", { name: /Add Role/ });
    expect(screen.queryByRole("button", { name: /Change Role/i })).toBeNull();
    expect(screen.getByText(/never replaces one/i)).toBeTruthy();
  });

  it("lists the governed Roles the trusted read returns, each with its own Remove", async () => {
    renderDetail(
      okHistory([], {
        authExists: true,
        accountStatus: "enabled",
        assignments: [
          { assignmentId: "asg-1", roleId: "dispatcher", scope: { type: "global" } },
          { assignmentId: "asg-2", roleId: "salesperson", scope: { type: "global" } },
        ],
      }),
      "emp-1",
      "",
      () => true,
    );
    // Awaited first: the list renders from an async trusted read, so querying the DOM directly
    // before it settles would assert on the loading state.
    expect((await screen.findAllByRole("button", { name: "Remove" })).length).toBe(2);
    const held = document.querySelector("[data-user-governed-roles]");
    expect(held.getAttribute("data-user-governed-roles")).toBe("2");
    expect(held.textContent).toMatch(/Dispatcher/);
    expect(held.textContent).toMatch(/Salesperson/);
  });

  it("does not offer a Role the person already holds at the same scope", async () => {
    // assignApprovedRole does not dedupe: a second call would create a second active assignment
    // conferring nothing extra and needing its own removal.
    renderDetail(
      okHistory([], {
        authExists: true,
        accountStatus: "enabled",
        assignments: [{ assignmentId: "asg-1", roleId: "salesperson", scope: { type: "global" } }],
      }),
      "emp-1",
      "",
      () => true,
    );
    const select = await screen.findByRole("combobox", { name: /Role to assign/i });
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).not.toContain("Salesperson");
    expect(labels).toContain("Sales Manager");
  });

  it("Remove confirms first, calls revokeRole with the ASSIGNMENT id, then re-reads", async () => {
    const client = okHistory([], {
      authExists: true,
      accountStatus: "enabled",
      assignments: [{ assignmentId: "asg-7", roleId: "dispatcher", scope: { type: "global" } }],
    });
    renderDetail(client, "emp-1", "", () => true);
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog", { name: /remove a role/i });
    expect(within(dialog).getByText(/John Smith/)).toBeTruthy();
    // The canonical label, which for a compatibility Role says so: "Dispatcher (compatibility)",
    // never the raw roleId.
    expect(within(dialog).getByText("Dispatcher (compatibility)")).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    });
    expect(client.revokeRole).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: "asg-7" }),
    );
    // Re-read rather than an optimistic local edit: the screen shows what came back.
    expect(client.readPrincipalAccessState.mock.calls.length).toBeGreaterThan(1);
  });

  it("offers no privileged Role -- Owner and Administrator need the two-person route", () => {
    renderDetail(okHistory());
    const select = screen.getByRole("combobox", { name: /Role to assign/i });
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).not.toContain("Owner");
    expect(labels).not.toContain("Administrator");
    // The Roles this business actually asked about are offerable.
    expect(labels).toContain("Salesperson");
    expect(labels).toContain("Sales Manager");
  });

  it("with the grant, it confirms first and names the person AND the Role in words", () => {
    renderDetail(okHistory(), "emp-1", "", (id) => id === "admin.roleAssignment.write");
    const select = screen.getByRole("combobox", { name: /Role to assign/i });
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "salesperson" } });
    fireEvent.click(screen.getByRole("button", { name: /Add Role/ }));

    const dialog = screen.getByRole("dialog", { name: /add a role/i });
    expect(within(dialog).getByText(/John Smith/)).toBeTruthy();
    // The WORDS, not the id -- "salesperson" in a confirmation is the machine's name for it.
    expect(within(dialog).getByText("Salesperson")).toBeTruthy();
  });

  it("an employee with no EOS account gets an explanation, not a dead control", () => {
    // A Role is held by an account. Offering the control against a person with no account would
    // fail server-side for a reason the screen already knows.
    seedDirectory([JOHN, MIKE, UNLINKED]);
    renderDetail(okHistory(), "emp-3");
    expect(screen.queryByRole("button", { name: /Add Role/ })).toBeNull();
    // Targeted by the hook rather than by copy: the status buttons state the same fact for their
    // own reason, so matching on the words alone would pass on the wrong element.
    const note = document.querySelector('[data-user-role-assign="no-account"]');
    expect(note?.textContent).toMatch(/A Role is held by an account/i);
  });

  it("the feed is ASKED about the Administration capabilities -- an unasked id is not a decision", () => {
    // buildHasCapability requires `decisions[id] === true`, so an id the feed was never asked for
    // reads as denied. That is fail-closed and correct, and it is also why Enable/Disable stayed
    // permanently protected for a principal who genuinely held the grant. The fix is to ask.
    for (const id of [
      "admin.employeeProfile.write",
      "admin.userStatus.write",
      "audit.event.read",
      "admin.credentialReset.initiate",
      // Without this the Add Role control is protected for an admin who genuinely holds the
      // grant -- the exact defect the four ids above were added to fix, repeated once more.
      "admin.roleAssignment.write",
      // And the READ. Unasked, the record page would report "you do not have access to read this"
      // to an administrator who holds admin.principalAccess.read -- account status blank and no
      // governed Roles listed. This is the same defect for the third time in this workstream, which
      // is why every id the surface consults is enumerated here rather than spot-checked.
      "admin.principalAccess.read",
    ]) {
      expect(REPORT_CAPABILITY_REQUEST, id).toContain(id);
    }
  });

  it("every capability id the Users surface consults is one the shell REQUESTS", () => {
    // The generalization of the test above: rather than trusting that someone remembers to add a
    // new id here, this asserts the declared surface set is wholly contained in the shell's
    // request. A capability added to ADMINISTRATION_USERS_SURFACE_CAPABILITIES but not reaching
    // REPORT_CAPABILITY_REQUEST is exactly the unasked-id defect, and it fails here immediately.
    for (const id of ADMINISTRATION_USERS_SURFACE_CAPABILITIES) {
      expect(REPORT_CAPABILITY_REQUEST, id).toContain(id);
    }
  });

  it("password reset is HIDDEN without the capability, and makes no call of any kind", async () => {
    const client = okHistory();
    renderDetail(client);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.queryByRole("button", { name: /Send password reset/ })).toBeNull();
    // The only callable this page may touch without a capability is the history read.
    expect(client.setUserStatus).not.toHaveBeenCalled();
    expect(client.updateEmployeeProfile).not.toHaveBeenCalled();
  });
});

// ════════════════════ EDIT USER ════════════════════

describe("Edit User is deliberate, governed, and cannot change access", () => {
  it("opens from the Edit User button, with Save and Cancel", async () => {
    renderDetail(okHistory());
    fireEvent.click(await screen.findByRole("button", { name: "Edit User" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByLabelText(/Job Title/)).toBeTruthy();
  });

  it("opens directly from the directory's Edit action (?edit=1) -- the same form", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("Employment Status is a closed picklist and Security Role is absent entirely", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const status = await screen.findByLabelText(/Employment Status/);
    expect(status.tagName).toBe("SELECT");
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Active", "On Leave", "Inactive", "Terminated", "Retired", "Contractor",
    ]);
    // Security Role is not on the edit form at all -- not as a control, and not as read-only
    // context. The detail view states it (with its mirror caption); a form carries only what can
    // be edited, and the assertion is deliberately the ABSENCE of both.
    expect(screen.queryByLabelText(/Security Role/)).toBeNull();
    expect(screen.queryByText(/Mirrors the legacy identity role/)).toBeNull();
  });

  it("Operational Roles is a multi-select over the canonical vocabulary", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes.length).toBe(8);
    expect(within(group).getByLabelText("Technician").checked).toBe(true);
    expect(within(group).getByLabelText("Parts Manager").checked).toBe(false);
  });

  // ── THE ROLES ARE ONE GRID, NOT EIGHT PLACED CONTROLS ──
  //
  // jsdom has no layout engine, so the column count and the pixel alignment are proven by
  // measurement instead (scripts/adminUserEditRolesProbe.mjs: 7 distinct checkbox x positions
  // before, 2 or 1 after, one row pitch, one label offset). What IS worth pinning here is the
  // structure that lets the CSS do it -- uniform sibling items under one containment context,
  // with nothing positioned per role -- and that fixing the layout changed no role and no order.
  it("every operational role is present, in the canonical order, none hidden", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    expect(within(group).getAllByRole("checkbox").map((b) => b.closest("label").textContent)).toEqual(
      OPERATIONAL_ROLE_OPTIONS.map((o) => o.label),
    );
  });

  it("the roles are uniform siblings inside the containment context the grid measures", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    // One container, one item class, no per-role wrapper and no inline positioning: the columns
    // come from the grid or they do not come at all.
    const items = [...group.children].filter((el) => el.tagName === "LABEL");
    expect(items.length).toBe(OPERATIONAL_ROLE_OPTIONS.length);
    expect(items.every((el) => el.className === "fo-checkbox")).toBe(true);
    expect(items.every((el) => el.getAttribute("style") === null)).toBe(true);
    expect(group.parentElement.classList.contains("fo-role-grid")).toBe(true);
  });

  it("the explanatory line is outside the grid, so it is not a ninth role", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    const note = screen.getByText(/Operational roles are eligibility for work/);
    expect(group.contains(note)).toBe(false);
  });

  it("Save sends ONLY the changed field, through the trusted command", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    const title = await screen.findByLabelText(/Job Title/);
    fireEvent.change(title, { target: { value: "Service Manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(client.updateEmployeeProfile).toHaveBeenCalledTimes(1);
    const payload = client.updateEmployeeProfile.mock.calls[0][0];
    expect(payload.employeeId).toBe("emp-1");
    expect(payload.changes).toEqual({ jobTitle: "Service Manager" });
    expect(payload.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,200}$/);
  });

  it("changing an operational role sends operationalRoles and NOTHING about security", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    fireEvent.click(within(group).getByLabelText("Parts Manager"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const { changes } = client.updateEmployeeProfile.mock.calls[0][0];
    expect(Object.keys(changes)).toEqual(["operationalRoles"]);
    expect(changes).not.toHaveProperty("securityRole");
  });

  it("changing employment status sends employmentStatus and NOTHING about account status", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    const status = await screen.findByLabelText(/Employment Status/);
    fireEvent.change(status, { target: { value: "TERMINATED" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const { changes } = client.updateEmployeeProfile.mock.calls[0][0];
    expect(Object.keys(changes)).toEqual(["employmentStatus"]);
    expect(client.setUserStatus).not.toHaveBeenCalled();
  });

  it("Cancel discards the changes and sends nothing", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    fireEvent.change(await screen.findByLabelText(/Job Title/), { target: { value: "Nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(client.updateEmployeeProfile).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Edit User" })).toBeTruthy();
    // The record still reads as it did.
    expect(screen.getAllByText(/Senior Service Technician/).length).toBeGreaterThan(0);
  });

  it("a save with nothing changed does not call the command", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(client.updateEmployeeProfile).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing was changed.")).toBeTruthy();
  });

  it("an unauthorized save fails closed and says nothing was saved", async () => {
    const client = okHistory();
    client.updateEmployeeProfile = vi.fn().mockResolvedValue({ ok: false, result: "DENIED" });
    renderDetail(client, "emp-1", "?edit=1");
    fireEvent.change(await screen.findByLabelText(/Job Title/), { target: { value: "Service Manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/not authorized to edit this user\. Nothing was saved/i)).toBeTruthy();
  });

  it("client validation blocks an obviously bad value before any round trip", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    fireEvent.change(await screen.findByLabelText(/Display Name/), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a display name.")).toBeTruthy();
    expect(client.updateEmployeeProfile).not.toHaveBeenCalled();
  });

  it("a malformed Employee ID is refused before a round trip", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "?edit=1");
    fireEvent.change(await screen.findByLabelText(/Employee ID/), { target: { value: "has space" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/no spaces/i)).toBeTruthy();
    expect(client.updateEmployeeProfile).not.toHaveBeenCalled();
  });

  it("a DUPLICATE Employee ID comes back as an actionable message, not as an outage", async () => {
    // Uniqueness is enforced transactionally by the command, which this client cannot check without
    // reading every employee. What it must do is render the refusal as something to fix.
    const client = okHistory();
    client.updateEmployeeProfile = vi.fn().mockResolvedValue({
      ok: false,
      result: "INVALID",
      message: "That Employee ID is already assigned to another employee. Choose a different one.",
    });
    renderDetail(client, "emp-1", "?edit=1");
    // A DIFFERENT number from the one this record already holds -- an unchanged value is a no-op
    // and would never reach the command.
    fireEvent.change(await screen.findByLabelText(/Employee ID/), { target: { value: "TAZ-0099" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/already assigned to another employee/i)).toBeTruthy();
  });
});

// ════════════════════ CHANGE HISTORY ════════════════════

const HISTORY = [
  {
    id: "h1",
    occurredAt: Date.parse("2026-09-04T12:00:00"),
    eventType: "updateEmployeeProfile",
    outcome: "applied",
    fieldKey: "jobTitle",
    previousValue: "Service Technician",
    newValue: "Senior Service Technician",
    changedById: "u1",
    changedByLabel: "Admin User",
    summary: "x",
  },
  {
    id: "h2",
    occurredAt: Date.parse("2026-07-12T12:00:00"),
    eventType: "setUserStatus",
    outcome: "applied",
    fieldKey: null,
    previousValue: null,
    newValue: null,
    changedById: "u2",
    changedByLabel: "Dana Ops",
    summary: "x",
  },
];

describe("Change History sits at the bottom of the record and shows AUDITED events", () => {
  it("renders the audited rows newest first, with field, values and actor", async () => {
    renderDetail(okHistory(HISTORY));
    const table = await screen.findByTestId("change-history-table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows[0].getAttribute("data-history-row")).toBe("h1");
    expect(within(bodyRows[0]).getByText("Job Title")).toBeTruthy();
    expect(within(bodyRows[0]).getByText("Service Technician")).toBeTruthy();
    expect(within(bodyRows[0]).getByText("Senior Service Technician")).toBeTruthy();
    expect(within(bodyRows[0]).getByText("Admin User")).toBeTruthy();
    // An event that changed no single field is still here, under its own words.
    expect(within(bodyRows[1]).getByText("Account Status")).toBeTruthy();
  });

  it("it is the LAST thing on the page", async () => {
    renderDetail(okHistory(HISTORY));
    const heading = await screen.findByRole("heading", { name: "Change History" });
    const headings = screen.getAllByRole("heading");
    expect(headings.at(-1)).toBe(heading);
  });

  it("the Field filter's options come from the rows, and filtering works", async () => {
    renderDetail(okHistory(HISTORY));
    const filter = await screen.findByRole("combobox", { name: "Field" });
    expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All changes",
      "Account Status",
      "Job Title",
    ]);

    fireEvent.change(filter, { target: { value: "jobTitle" } });
    const table = screen.getByTestId("change-history-table");
    expect(within(table).getAllByRole("row").slice(1).length).toBe(1);
    expect(within(table).getByText("Job Title")).toBeTruthy();
  });

  it("every column is a sortable, accessible header that toggles ASC then DESC", async () => {
    renderDetail(okHistory(HISTORY));
    const table = await screen.findByTestId("change-history-table");
    const dateHeader = within(table).getByRole("columnheader", { name: /Date \/ Time/ });
    expect(dateHeader.getAttribute("aria-sort")).toBe("descending");

    const actorButton = within(table).getByRole("button", { name: /Changed By/ });
    fireEvent.click(actorButton);
    const actorHeader = within(table).getByRole("columnheader", { name: /Changed By/ });
    expect(actorHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(dateHeader.getAttribute("aria-sort")).toBe("none");
    // "Admin User" < "Dana Ops"
    expect(within(table).getAllByRole("row").slice(1)[0].getAttribute("data-history-row")).toBe("h1");

    fireEvent.click(actorButton);
    expect(actorHeader.getAttribute("aria-sort")).toBe("descending");
    expect(within(table).getAllByRole("row").slice(1)[0].getAttribute("data-history-row")).toBe("h2");
  });

  it("filtering and sorting compose", async () => {
    renderDetail(okHistory(HISTORY));
    const table = await screen.findByTestId("change-history-table");
    fireEvent.click(within(table).getByRole("button", { name: /Date \/ Time/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Changed by" }), { target: { value: "u2" } });
    const rows = within(screen.getByTestId("change-history-table")).getAllByRole("row").slice(1);
    expect(rows.length).toBe(1);
    expect(rows[0].getAttribute("data-history-row")).toBe("h2");
  });

  // ── AN EMPTY HISTORY OFFERS NOTHING TO FILTER ──
  //
  // The filter options are derived from the rows, so a record with no history rendered four
  // controls that could not change anything: "All changes" and "Anyone" over empty selects, and a
  // date range over no dates. The three cases below are the whole distinction -- no history, some
  // history, and history that the reader's own filters excluded -- and they must not collapse into
  // each other, because "nothing happened" and "nothing matched" are different facts.

  it("a record with NO history shows the empty state alone -- no filters over nothing", async () => {
    renderDetail(okHistory([]));
    expect(await screen.findByText("No changes recorded")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Field" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Changed by" })).toBeNull();
    expect(document.querySelector('[data-history-filter="from"]')).toBeNull();
    expect(document.querySelector('[data-history-filter="to"]')).toBeNull();
  });

  it("a record WITH history shows the filters, and their options are the history's own", async () => {
    renderDetail(okHistory(HISTORY));
    const filter = await screen.findByRole("combobox", { name: "Field" });
    expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All changes",
      "Account Status",
      "Job Title",
    ]);
    expect(screen.getByRole("combobox", { name: "Changed by" })).toBeTruthy();
    expect(document.querySelector('[data-history-filter="from"]')).toBeTruthy();
  });

  it("filters that match nothing KEEP the controls and say so -- the rows are still there", async () => {
    renderDetail(okHistory(HISTORY));
    await screen.findByTestId("change-history-table");
    // A date range after every recorded event: rows exist, none of them match.
    fireEvent.change(document.querySelector('[data-history-filter="from"]'), {
      target: { value: "2099-01-01" },
    });
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(screen.getByText("No recorded changes match these filters.")).toBeTruthy();
    expect(screen.queryByText("No changes recorded")).toBeNull();
    // The way back out of an over-narrow filter is the filter itself, so it stays.
    expect(screen.getByRole("combobox", { name: "Field" })).toBeTruthy();
  });

  it("a history still LOADING shows neither filters nor an empty state", async () => {
    const client = okHistory();
    let release;
    client.listRecordChangeHistory = vi.fn(
      () => new Promise((resolve) => { release = () => resolve({ ok: true, rows: [] }); }),
    );
    renderDetail(client);
    expect(await screen.findByText("Loading change history…")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Field" })).toBeNull();
    expect(screen.queryByText("No changes recorded")).toBeNull();
    await act(async () => { release(); });
  });

  it("an UNREADABLE history is stated as unreadable, never as an empty one", async () => {
    const client = okHistory();
    client.listRecordChangeHistory = vi.fn().mockResolvedValue({ ok: false, result: "UNAVAILABLE" });
    renderDetail(client);
    expect(await screen.findByText("Change history unavailable")).toBeTruthy();
    expect(screen.queryByText(/No changes recorded/)).toBeNull();
  });

  it("no credential material ever reaches the table", async () => {
    const client = okHistory([
      { ...HISTORY[0], previousValue: null, newValue: null, eventType: "initiateAdminPasswordReset", fieldKey: null },
    ]);
    renderDetail(client);
    const table = await screen.findByTestId("change-history-table");
    expect(within(table).getByText("Password reset requested")).toBeTruthy();
    expect(table.textContent).not.toMatch(/oobCode|token|password=|https?:\/\//i);
  });

  it("the history read is scoped to THIS record", async () => {
    const client = okHistory(HISTORY);
    renderDetail(client);
    await screen.findByTestId("change-history-table");
    expect(client.listRecordChangeHistory).toHaveBeenCalledWith({
      targetType: "employee",
      targetId: "emp-1",
    });
  });
});
