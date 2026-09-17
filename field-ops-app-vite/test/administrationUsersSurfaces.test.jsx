// ADMINISTRATION > USERS -- the record page, the governed Employee editor, and the shared history.
//
// The RECORD page reads Employee business data only from the governed Workforce transport, injected here as a mocked client (no Firestore mock exists
// in this file, because the record page has no Firestore read to mock). The legacy account callables are
// mocked at their SEAM. No Firebase, no network, and no capability granted unless a test grants it.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockNavigate = vi.fn();

vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "actor-1" }, role: "admin", loading: false }),
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useNavigate: () => mockNavigate };
});

// The DIRECTORY has its own suite (adminUsersDirectory.test.jsx) since it moved to the governed
// Workforce read; this file is the record page, the governed editor and the shared history.
import UserDetail from "../src/modules/administration/UserDetail.jsx";
import { NEVER_SENT_EMPLOYEE_KEYS } from "../src/domain/employeeProfile.js";
import { REPORT_CAPABILITY_REQUEST } from "../src/access/reportCapabilityAccess.js";
import { ADMINISTRATION_USERS_SURFACE_CAPABILITIES } from "../src/access/governedSurfaceCapabilities.js";

// ── The governed Workforce projections (EMP-RT-01) the RECORD page reads. Test fixtures only.
const nameOf = (displayName) => ({ displayName, firstName: null, middleName: null, lastName: null, preferredName: null });
const EMPTY_CONTACT = { workEmail: null, workPhone: null, mobilePhone: null };
const EMPTY_ADDRESS = { street: null, unit: null, city: null, state: null, postalCode: null };
const record = (over) => ({
  employmentStatus: "ACTIVE",
  operatingCompanyId: "taylor",
  employeeNumber: null,
  jobTitle: null,
  contact: EMPTY_CONTACT,
  address: EMPTY_ADDRESS,
  hireDate: null,
  separationDate: null,
  currentManager: null,
  userAccess: "UNLINKED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
  name: nameOf(over.displayName ?? null),
});
const JOHN_REC = record({
  employeeId: "emp-1",
  displayName: "John Smith",
  jobTitle: "Senior Service Technician",
  employeeNumber: "TAZ-0042",
  currentManager: { managerEmployeeId: "emp-2", displayName: "Mike Jones", effectiveFrom: "2026-01-05T00:00:00.000Z" },
  userAccess: "LINKED",
});
const MIKE_REC = record({ employeeId: "emp-2", displayName: "Mike Jones" });
const PAT_REC = record({ employeeId: "emp-3", displayName: "Pat Lee", employmentStatus: "CONTRACTOR" });

let records = {};
function seedRecords(list = [JOHN_REC, MIKE_REC]) {
  records = Object.fromEntries(list.map((r) => [r.employeeId, r]));
}

/**
 * A mocked Workforce transport: the closed operations, answered from `records`. `commands` answers the three
 * governed commands (each a value or a function of the input); an unanswered command is UNKNOWN_OPERATION, so a
 * test that forgot to expect a write fails loudly instead of passing on a silent success.
 */
function makeWorkforce(commands = {}) {
  return {
    call: vi.fn(async (operation, input) => {
      const rec = input?.employeeId ? records[input.employeeId] : null;
      if (Object.prototype.hasOwnProperty.call(commands, operation)) {
        const answer = commands[operation];
        return typeof answer === "function" ? answer(input) : answer;
      }
      switch (operation) {
        case "listEmployees":
          return {
            ok: true,
            result: {
              items: Object.values(records).map((r) => ({ employeeId: r.employeeId, displayName: r.displayName, employeeNumber: r.employeeNumber, employmentStatus: r.employmentStatus, operatingCompanyId: r.operatingCompanyId, jobTitle: r.jobTitle })),
              nextCursor: null,
            },
          };
        case "readEmployee":
          return rec ? { ok: true, result: rec } : { ok: false, code: "NOT_FOUND", reason: "EMPLOYEE_NOT_FOUND", status: 404 };
        case "readEmployeePrincipalLink":
          return {
            ok: true,
            result: {
              employeeId: input.employeeId,
              userAccess: rec?.userAccess ?? "UNLINKED",
              link: rec?.userAccess === "LINKED"
                ? { linkId: "l-1", principalId: `pr-${input.employeeId}`, principalDisplayName: rec.displayName, principalStatus: "active", membershipStatus: "active", linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null }
                : null,
            },
          };
        case "listManagedEmployees":
        case "listRecordsOwnedByEmployee":
        case "listAccountabilitiesForEmployee":
          return { ok: true, result: { items: [], truncated: false, nextCursor: null } };
        default:
          return { ok: false, code: "UNKNOWN_OPERATION" };
      }
    }),
  };
}

/** The Administration API's listTenantPrincipals: the Principal -> credential mapping. */
const policyCall = vi.fn(async () => ({
  ok: true,
  data: [{ id: "pr-emp-1", displayName: "John Smith", externalSubject: "uid-john", identityProvider: "firebase", status: "active" }],
}));

// The trusted principal-access read defaults to an ENABLED account holding no governed Role: the
// commonest real state, and the one that makes "which button is offered" meaningful. Tests that
// care about the other states pass their own `access`.
const ENABLED_NO_ROLES = { authExists: true, accountStatus: "enabled", assignments: [] };

const okHistory = (rows = [], access = ENABLED_NO_ROLES) => ({
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
const renderDetail = (client, employeeId = "emp-1", search = "", hasCapability = undefined, workforce = makeWorkforce()) =>
  render(
    <MemoryRouter initialEntries={[`/administration/users/${employeeId}${search}`]}>
      <Routes>
        <Route
          path="/administration/users/:employeeId"
          element={<UserDetail client={client} workforce={workforce} policyCall={policyCall} hasCapability={hasCapability} />}
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mockNavigate.mockClear();
  seedRecords();
});
afterEach(cleanup);

// ════════════════════ THE RECORD PAGE ════════════════════

describe("User Detail is read-only by default", () => {
  it("answers who this person is, what they do, and whether they are active", async () => {
    renderDetail(okHistory());
    expect(await screen.findByRole("heading", { level: 1, name: "John Smith" })).toBeTruthy();
    expect(screen.getAllByText(/Senior Service Technician/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TAZ-0042/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });

  it("renders identity, employment, Job Role & eligibility and User Access as separate sections", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    // Employee design v4.1: "Operational assignment" became "Job Role & operational eligibility" (the
    // word assignment belongs to the Assigned Person axis), and "EOS access & security" became
    // "User Access" -- the access concept, kept apart from the Employee business record.
    for (const title of [
      "Identity & contact",
      "Employment & business context",
      "Job Role",
      "User Access",
      "Responsibility",
    ]) {
      expect(screen.getByRole("heading", { name: title }), title).toBeTruthy();
    }
    // The operating company appears in the header facts AND in the business context section.
    expect(screen.getAllByText("Taylor Freezer of Arizona").length).toBeGreaterThan(0);
  });

  it("opens with NO form controls -- editing is a choice, never a side effect of arriving", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.queryByRole("textbox")).toBeNull();
    // Shown, and protected for a caller the trusted feed has not granted admin.employeeProfile.write.
    expect(screen.getByRole("button", { name: "Edit Employee" }).hasAttribute("disabled")).toBe(true);
  });

  it("the manager is a LINK to that person's own record, not display text", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    const link = screen.getByRole("link", { name: "Mike Jones" });
    expect(link.getAttribute("href")).toBe("/administration/users/emp-2");
  });

  it("no current reporting relationship reads as such, never as a raw id or a blank", async () => {
    seedRecords([{ ...JOHN_REC, currentManager: null }]);
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.queryByText("emp-2")).toBeNull();
    expect(screen.getByText("No current reporting relationship recorded.")).toBeTruthy();
  });

  it("missing optional fields render honestly rather than as blanks", async () => {
    seedRecords([record({ employeeId: "emp-1", displayName: "New Person" })]);
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "New Person" });
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  it("an Employee the governed read does not find is a NOT-FOUND, not an empty record", async () => {
    renderDetail(okHistory(), "emp-nobody");
    expect(await screen.findByText("This Employee record could not be found.")).toBeTruthy();
  });
});

// ════════════════════ ACCESS & SECURITY ════════════════════

describe("EOS access and security stay independent, and fail closed", () => {
  it("the account's enabled/disabled state comes from the trusted read, never an inference", async () => {
    const client = okHistory();
    renderDetail(client, "emp-1", "", () => true);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    // The uid is reached along Employee -> governed link (EMP-RT-02) -> Principal -> credential, never read
    // from an Employee document.
    await waitFor(() => expect(client.readPrincipalAccessState).toHaveBeenCalledWith({ principalUid: "uid-john" }));
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
    await waitFor(() => expect(document.querySelector("[data-user-account-status]")?.textContent).toMatch(/do not have access/i));
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

  it("Security Role is stated as access -- never a Job Role -- with no control over it", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.getByText(/Security Roles are access\. They are not Job Roles/)).toBeTruthy();
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
    // The access state resolves asynchronously (Employee -> Principal link -> Administration access API -> held Roles).
    // Wait for the HELD assignment itself to render -- its Remove control -- so the options below are inspected only
    // after the held-Role lookup has actually answered, not while the picker still reflects an unloaded state.
    await screen.findByRole("button", { name: "Remove" });
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

  it("offers no privileged Role -- Owner and Administrator need the two-person route", async () => {
    renderDetail(okHistory());
    const select = await screen.findByRole("combobox", { name: /Role to assign/i });
    const labels = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(labels).not.toContain("Owner");
    expect(labels).not.toContain("Administrator");
    // The Roles this business actually asked about are offerable.
    expect(labels).toContain("Salesperson");
    expect(labels).toContain("Sales Manager");
  });

  it("with the grant, it confirms first and names the person AND the Role in words", async () => {
    renderDetail(okHistory(), "emp-1", "", (id) => id === "admin.roleAssignment.write");
    const select = await screen.findByRole("combobox", { name: /Role to assign/i });
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "salesperson" } });
    fireEvent.click(screen.getByRole("button", { name: /Add Role/ }));

    const dialog = screen.getByRole("dialog", { name: /add a role/i });
    expect(within(dialog).getByText(/John Smith/)).toBeTruthy();
    // The WORDS, not the id -- "salesperson" in a confirmation is the machine's name for it.
    expect(within(dialog).getByText("Salesperson")).toBeTruthy();
  });

  it("an Employee with no governed Principal link gets an explanation, not a dead control", async () => {
    // A Role is held by an account. Offering the control against a person with no linked Principal
    // would fail server-side for a reason the screen already knows (EMP-RT-01 userAccess UNLINKED).
    seedRecords([JOHN_REC, MIKE_REC, PAT_REC]);
    const client = okHistory();
    renderDetail(client, "emp-3");
    await screen.findByRole("heading", { level: 1, name: "Pat Lee" });
    expect(screen.queryByRole("button", { name: /Add Role/ })).toBeNull();
    const note = document.querySelector('[data-account-actions="UNAVAILABLE"]');
    expect(note?.textContent).toMatch(/no account to manage/i);
    expect(client.readPrincipalAccessState).not.toHaveBeenCalled();
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
    expect(client).not.toHaveProperty("updateEmployeeProfile");
  });
});

// ════════════════════ EDIT EMPLOYEE ════════════════════
//
// The record page offers the governed editor to a caller the trusted feed says holds admin.employeeProfile.write,
// and keeps the protected button for everyone else. The editor works on the PostgreSQL record, writes only through
// the three governed Workforce commands, and the page RE-READS the record after any write. The server remains the
// authority: every refusal below is a command answer the page must render, not something the capability test hides.

const EDIT_GRANTED = (id) => id === "admin.employeeProfile.write";
const COMMANDS = ["updateEmployeeProfile", "establishReportingRelationship", "endReportingRelationship", "saveEmployeeEdit"];
const commandCalls = (workforce) => workforce.call.mock.calls.filter(([operation]) => COMMANDS.includes(operation));
const readCount = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "readEmployee").length;
const UPDATED = (changedFields) => ({ ok: true, result: { outcome: "UPDATED", employeeId: "emp-1", changedFields, auditEventId: "ae-1" } });

async function openEditor(workforce, { client = okHistory(), search = "" } = {}) {
  renderDetail(client, "emp-1", search, EDIT_GRANTED, workforce);
  if (!search) fireEvent.click(await screen.findByRole("button", { name: "Edit Employee" }));
  await screen.findByRole("button", { name: "Save" });
  // The Manager control is usable only once the governed directory has been read.
  await waitFor(() => expect(screen.getByLabelText("Manager").disabled).toBe(false));
}

describe("Edit Employee is offered by capability, and the server stays the authority", () => {
  it("without admin.employeeProfile.write the button is protected, with the stated reason, and opens nothing", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "", (id) => id === "admin.userStatus.write", workforce);
    const edit = await screen.findByRole("button", { name: "Edit Employee" });
    expect(edit.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/did not grant Employee profile editing/i).length).toBeGreaterThan(0);
    fireEvent.click(edit);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(commandCalls(workforce)).toEqual([]);
  });

  it("?edit=1 without the capability states that editing is not available to this caller -- no form, no directory read", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "?edit=1", undefined, workforce);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(document.querySelector('[data-employee-edit="NOT_GRANTED"]').textContent).toMatch(/not available to you/);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listEmployees")).toBe(false);
  });

  it("with the capability the button is live and opens the editor seeded from the PostgreSQL record", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "", EDIT_GRANTED, workforce);
    const edit = await screen.findByRole("button", { name: "Edit Employee" });
    expect(edit.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(edit);
    expect((await screen.findByLabelText("Job Title")).value).toBe("Senior Service Technician");
    expect(screen.getByLabelText("Employee ID").value).toBe("TAZ-0042");
    expect(screen.getByLabelText("Display Name").value).toBe("John Smith");
    await waitFor(() => expect(screen.getByLabelText("Manager").value).toBe("emp-2"));
  });

  it("?edit=1 with the capability opens the editor directly", async () => {
    await openEditor(makeWorkforce(), { search: "?edit=1" });
    expect(document.querySelector('[data-employee-edit="OPEN"]')).toBeTruthy();
  });

  it("Employment Status, Operating Company and Operational Roles are read-only, with their authority named; no Security or Job Role control", async () => {
    await openEditor(makeWorkforce());
    const form = document.querySelector('[data-employee-edit="OPEN"]');
    for (const label of [/Employment Status/, /Operating Company/, /Operational Roles/, /Security Role/, /Job Role/]) {
      expect(within(form).queryByLabelText(label), String(label)).toBeNull();
    }
    const locked = form.querySelector('[data-employee-edit-locked="LIFECYCLE"]');
    expect(locked.textContent).toMatch(/Active/);
    expect(locked.textContent).toMatch(/Taylor Freezer of Arizona/);
    expect(within(form).getAllByText(/governed by the Employee lifecycle authority, which is not yet available/).length).toBeGreaterThan(0);
    expect(form.querySelector('[data-runtime-dependency="EMP-RT-W2"]')).toBeTruthy();
    expect(within(form).queryByRole("checkbox")).toBeNull();
  });

  it("Manager is a closed choice of real Employees from the governed directory, excluding this Employee", async () => {
    seedRecords([JOHN_REC, MIKE_REC, PAT_REC]);
    const workforce = makeWorkforce();
    await openEditor(workforce);
    const manager = screen.getByLabelText("Manager");
    expect(manager.tagName).toBe("SELECT");
    expect(within(manager).getAllByRole("option").map((o) => o.textContent)).toEqual(["No manager recorded", "Mike Jones", "Pat Lee"]);
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listEmployees")).toBe(true);
  });
});

describe("Save sends only what changed, as ONE governed command per Save", () => {
  it("a profile edit sends ONLY the changed key to updateEmployeeProfile, and no manager command", async () => {
    const workforce = makeWorkforce({ updateEmployeeProfile: UPDATED(["jobTitle"]) });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Service Manager" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(workforce).length).toBe(1));
    const [[operation, input]] = commandCalls(workforce);
    expect(operation).toBe("updateEmployeeProfile");
    expect(input).toEqual({ employeeId: "emp-1", changes: { jobTitle: "Service Manager" } });
  });

  it("no lifecycle, eligibility, access or authority key is ever sent by any command", async () => {
    const workforce = makeWorkforce({
      saveEmployeeEdit: { ok: true, result: { employeeId: "emp-1", profile: { outcome: "UPDATED", changedFields: ["jobTitle", "hireDate"] }, manager: { outcome: "CHANGED" } } },
    });
    seedRecords([JOHN_REC, MIKE_REC, PAT_REC]);
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Lead" } });
    fireEvent.change(screen.getByLabelText("Hire Date"), { target: { value: "2021-01-04" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "emp-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(workforce).length).toBe(1));
    for (const [, input] of commandCalls(workforce)) {
      const keys = [...Object.keys(input), ...Object.keys(input.changes ?? {}), ...Object.keys(input.manager ?? {})];
      for (const forbidden of NEVER_SENT_EMPLOYEE_KEYS) expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it("a profile AND manager change in one Save is ONE saveEmployeeEdit call -- never two sequenced commands", async () => {
    seedRecords([JOHN_REC, MIKE_REC, PAT_REC]);
    const workforce = makeWorkforce({
      saveEmployeeEdit: { ok: true, result: { employeeId: "emp-1", profile: { outcome: "UPDATED", changedFields: ["jobTitle"] }, manager: { outcome: "CHANGED" } } },
    });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Lead" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "emp-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(workforce).length).toBe(1));
    expect(commandCalls(workforce)).toEqual([
      ["saveEmployeeEdit", { employeeId: "emp-1", changes: { jobTitle: "Lead" }, manager: { action: "ESTABLISH", managerEmployeeId: "emp-3" } }],
    ]);
  });

  it("a manager-only change calls only establishReportingRelationship", async () => {
    seedRecords([JOHN_REC, MIKE_REC, PAT_REC]);
    const workforce = makeWorkforce({ establishReportingRelationship: { ok: true, result: { outcome: "CHANGED" } } });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "emp-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(workforce).length).toBe(1));
    expect(commandCalls(workforce)[0]).toEqual(["establishReportingRelationship", { employeeId: "emp-1", managerEmployeeId: "emp-3" }]);
  });

  it("clearing the manager calls endReportingRelationship", async () => {
    const workforce = makeWorkforce({ endReportingRelationship: { ok: true, result: { outcome: "ENDED" } } });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(commandCalls(workforce).length).toBe(1));
    expect(commandCalls(workforce)[0]).toEqual(["endReportingRelationship", { employeeId: "emp-1" }]);
  });

  it("an unchanged form sends nothing and says so", async () => {
    const workforce = makeWorkforce();
    await openEditor(workforce);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing was changed.")).toBeTruthy();
    expect(commandCalls(workforce)).toEqual([]);
  });

  it("Cancel discards the changes, sends nothing, and closes the form", async () => {
    const workforce = makeWorkforce();
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(commandCalls(workforce)).toEqual([]);
  });

  it("client validation blocks a malformed Employee ID or a cleared display name before any round trip", async () => {
    const workforce = makeWorkforce();
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Employee ID"), { target: { value: "has space" } });
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/no spaces/i)).toBeTruthy();
    expect(screen.getByText("Enter a display name.")).toBeTruthy();
    expect(commandCalls(workforce)).toEqual([]);
  });
});

describe("Save outcomes are the server's answers, stated exactly", () => {
  it("403 from the command renders not-authorized, nothing saved, no re-read, no success", async () => {
    const workforce = makeWorkforce({ saveEmployeeEdit: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 } });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Lead" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("You are not authorized to edit this Employee. Nothing was saved.")).toBeTruthy();
    expect(commandCalls(workforce).map(([operation]) => operation)).toEqual(["saveEmployeeEdit"]);
    // The form stays open with what the person typed; nothing claims success and the record is not re-read.
    expect(screen.getByLabelText("Job Title").value).toBe("Lead");
    expect(document.querySelector("[data-employee-edit-result]")).toBeNull();
    expect(screen.queryByText(/^Saved/)).toBeNull();
    expect(readCount(workforce)).toBe(1);
  });

  it("409 EMPLOYEE_NUMBER_TAKEN comes back as an actionable message, not an outage", async () => {
    const workforce = makeWorkforce({ updateEmployeeProfile: { ok: false, code: "CONFLICT", reason: "EMPLOYEE_NUMBER_TAKEN", status: 409 } });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Employee ID"), { target: { value: "TAZ-0099" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/That Employee ID is already held by another Employee\. Choose a different one\. Nothing was saved\./)).toBeTruthy();
    expect(document.getElementById("employee-edit-error").textContent).not.toMatch(/could not|not configured|not confirmed/i);
  });

  it("a combined Save refused at the manager step: nothing saved, no partial notice, the form stays open, no re-read", async () => {
    const workforce = makeWorkforce({ saveEmployeeEdit: { ok: false, code: "NOT_FOUND", reason: "REPORTING_RELATIONSHIP_NOT_FOUND", status: 404 } });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Lead" } });
    fireEvent.change(screen.getByLabelText("Manager"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing was saved: this Employee no longer has a current manager to remove.")).toBeTruthy();
    expect(commandCalls(workforce).map(([operation]) => operation)).toEqual(["saveEmployeeEdit"]);
    expect(document.querySelector("[data-employee-edit-result]")).toBeNull();
    expect(screen.getByLabelText("Job Title").value).toBe("Lead");
    expect(readCount(workforce)).toBe(1);
  });

  it("success re-reads the record and renders ONLY what the read returns -- never what was typed", async () => {
    // The command answers UPDATED, but the authority (the re-read) holds a different value -- e.g. another
    // administrator's concurrent write. The page must show the authority, not the form.
    const workforce = makeWorkforce({
      updateEmployeeProfile: (input) => {
        records["emp-1"] = { ...records["emp-1"], jobTitle: "Stored By Server" };
        return UPDATED(Object.keys(input.changes));
      },
    });
    await openEditor(workforce);
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Typed Title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(readCount(workforce)).toBe(2));
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(document.querySelector('[data-employee-edit-result="SAVED"]').textContent).toMatch(/^Saved: Job Title\./);
    expect(readCount(workforce)).toBe(2);
    expect(screen.getAllByText(/Stored By Server/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Typed Title/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
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
