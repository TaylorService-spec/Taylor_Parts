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

// EMP-RT-08 listJobRoles, test-only: two distinct sales Job Roles and one INACTIVE role that must never be offered.
const JOB_ROLE_CATALOG = [
  { jobRoleId: "retail-sales", displayName: "Retail Sales", status: "ACTIVE" },
  { jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", status: "ACTIVE" },
  { jobRoleId: "legacy-estimator", displayName: "Legacy Estimator", status: "INACTIVE" },
];

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
  const workforce = {
    // readMyWorkforceCapabilities (finding #17): the caller's PostgreSQL Workforce capabilities. None unless a test
    // grants them with `grant(workforce, ids)` or answers the operation itself through `commands`.
    grants: [],
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
        case "listEmployeeJobRoleHistory":
          return { ok: true, result: { employeeId: input.employeeId, current: null, items: [], truncated: false } };
        case "listJobRoles":
          return { ok: true, result: { items: JOB_ROLE_CATALOG } };
        case "listManagedEmployees":
        case "listRecordsOwnedByEmployee":
        case "listAccountabilitiesForEmployee":
          return { ok: true, result: { items: [], truncated: false, nextCursor: null } };
        case "readMyWorkforceCapabilities":
          return { ok: true, result: { capabilities: [...workforce.grants] } };
        default:
          return { ok: false, code: "UNKNOWN_OPERATION" };
      }
    }),
  };
  return workforce;
}

/** Grant Workforce capabilities through the PostgreSQL capability read -- the ONLY source of the Workforce offer. */
const grant = (workforce, ids) => Object.assign(workforce, { grants: [...ids] });

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
    // Finding #17: the Workforce ids are NOT asked of this feed. Their offer comes from readMyWorkforceCapabilities.
    for (const id of ["admin.employeeProfile.write", "admin.employeeJobRole.write"]) {
      expect(ADMINISTRATION_USERS_SURFACE_CAPABILITIES, id).not.toContain(id);
      expect(REPORT_CAPABILITY_REQUEST, id).not.toContain(id);
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

// Granted through the Workforce capability read. The Firebase feed is given NO grant in these tests, so an editor that
// opens proves the offer follows PostgreSQL.
const EDIT_GRANTED = ["admin.employeeProfile.write"];
const COMMANDS = ["updateEmployeeProfile", "establishReportingRelationship", "endReportingRelationship", "saveEmployeeEdit"];
const commandCalls = (workforce) => workforce.call.mock.calls.filter(([operation]) => COMMANDS.includes(operation));
const readCount = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "readEmployee").length;
const UPDATED = (changedFields) => ({ ok: true, result: { outcome: "UPDATED", employeeId: "emp-1", changedFields, auditEventId: "ae-1" } });

async function openEditor(workforce, { client = okHistory(), search = "" } = {}) {
  renderDetail(client, "emp-1", search, () => false, grant(workforce, EDIT_GRANTED));
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
    renderDetail(okHistory(), "emp-1", "", undefined, grant(workforce, EDIT_GRANTED));
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
    expect(within(form).getAllByText(/served by the Workforce service through the governed lifecycle\s+commands, but they are not editable on this page yet/).length).toBeGreaterThan(0);
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

  it("the LEGACY trail is the LAST thing on the page, labelled as the pre-cutover legacy trail", async () => {
    renderDetail(okHistory(HISTORY));
    const heading = await screen.findByRole("heading", { name: "Legacy Change History" });
    expect(heading.closest("section").textContent).toMatch(/Pre-cutover legacy trail/);
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
    expect(await screen.findByText("Loading the legacy change history…")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Field" })).toBeNull();
    expect(screen.queryByText("No changes recorded")).toBeNull();
    await act(async () => { release(); });
  });

  it("an UNREADABLE history is stated as unreadable, never as an empty one", async () => {
    const client = okHistory();
    client.listRecordChangeHistory = vi.fn().mockResolvedValue({ ok: false, result: "UNAVAILABLE" });
    renderDetail(client);
    expect(await screen.findByText("Legacy change history unavailable")).toBeTruthy();
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

// ════════════════════ JOB ROLE (EMP-RT-08) ════════════════════
//
// A Job Role is the Employee's business function only. Its control is offered by admin.employeeJobRole.write -- never
// by admin.employeeProfile.write -- lives in the Job Role section, sends exactly { employeeId, jobRoleId, reason? } as
// ONE assignEmployeeJobRole, and is followed by a RE-READ of the history. Every refusal is the server's, stated exactly.

const JOB_ROLE_GRANTED = ["admin.employeeJobRole.write"];
const jobRoleSection = () => screen.getByRole("heading", { level: 2, name: "Job Role" }).closest("section");
const assignCalls = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "assignEmployeeJobRole");
const historyReads = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "listEmployeeJobRoleHistory").length;
const WRITE_OPERATIONS = ["assignEmployeeJobRole", "createJobRole", "updateJobRole", ...COMMANDS];

async function openJobRoleControl(workforce, grants = JOB_ROLE_GRANTED) {
  renderDetail(okHistory(), "emp-1", "", () => false, grant(workforce, grants));
  await screen.findByRole("heading", { level: 1, name: "John Smith" });
  fireEvent.click(await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" }));
  return within(jobRoleSection()).findByLabelText("Job Role");
}

describe("the Job Role control is offered only by admin.employeeJobRole.write", () => {
  it("without any capability the control is protected with its reason, and nothing is read or written", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "", undefined, workforce);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    const button = await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(within(jobRoleSection()).getByText(/did not grant Job Role assignment \(admin\.employeeJobRole\.write\)/)).toBeTruthy();
    fireEvent.click(button);
    expect(within(jobRoleSection()).queryByLabelText("Job Role")).toBeNull();
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listJobRoles" || WRITE_OPERATIONS.includes(operation))).toBe(false);
  });

  it("admin.employeeProfile.write ALONE does not offer it: an Employee administrator without the Job Role grant sees the tenant is NOT CONFIGURED", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "", undefined, grant(workforce, EDIT_GRANTED));
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect((await screen.findByRole("button", { name: "Edit Employee" })).hasAttribute("disabled")).toBe(false);
    const state = await waitFor(() => {
      const el = jobRoleSection().querySelector('[data-job-role-control="NOT_CONFIGURED"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(state.getAttribute("data-job-role-not-configured")).toBe("GRANT");
    expect(state.textContent).toMatch(/Job Role administration is not configured for this tenant\./);
    expect(state.textContent).toMatch(/not been granted admin\.employeeJobRole\.write/);
    expect(within(jobRoleSection()).queryByRole("button", { name: /Assign Job Role|Change Job Role/ })).toBeNull();
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listJobRoles" || WRITE_OPERATIONS.includes(operation))).toBe(false);
  });

  it("a granted caller on a tenant whose catalog has no ACTIVE Job Role sees NOT CONFIGURED -- never an empty dropdown", async () => {
    for (const items of [[], [{ jobRoleId: "legacy-estimator", displayName: "Legacy Estimator", status: "INACTIVE" }]]) {
      cleanup();
      const workforce = makeWorkforce({ listJobRoles: { ok: true, result: { items } } });
      renderDetail(okHistory(), "emp-1", "", undefined, grant(workforce, JOB_ROLE_GRANTED));
      await screen.findByRole("heading", { level: 1, name: "John Smith" });
      const state = await waitFor(() => {
        const el = jobRoleSection().querySelector('[data-job-role-control="NOT_CONFIGURED"]');
        expect(el).toBeTruthy();
        return el;
      });
      expect(state.getAttribute("data-job-role-not-configured")).toBe("CATALOG");
      expect(state.textContent).toMatch(/Job Role administration is not configured for this tenant\./);
      expect(within(jobRoleSection()).queryByRole("button", { name: /Assign Job Role|Change Job Role/ })).toBeNull();
      expect(within(jobRoleSection()).queryByRole("combobox")).toBeNull();
      expect(assignCalls(workforce)).toEqual([]);
    }
  });

  it("with admin.employeeJobRole.write it is a closed choice of ACTIVE catalog roles; inactive roles are not offered", async () => {
    const workforce = makeWorkforce();
    const select = await openJobRoleControl(workforce);
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a Job Role", "National Accounts Sales", "Retail Sales"]);
    expect(within(select).queryByRole("option", { name: "Legacy Estimator" })).toBeNull();
    expect(workforce.call).toHaveBeenCalledWith("listJobRoles", {});
    // Holding only the Job Role authority does not open the profile editor.
    expect(screen.getByRole("button", { name: "Edit Employee" }).hasAttribute("disabled")).toBe(true);
    // Save is not possible until a Job Role is chosen.
    expect(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }).hasAttribute("disabled")).toBe(true);
  });

  it("a catalog that cannot be read is stated, and nothing can be saved", async () => {
    const workforce = makeWorkforce({ listJobRoles: { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 } });
    renderDetail(okHistory(), "emp-1", "", undefined, grant(workforce, JOB_ROLE_GRANTED));
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    fireEvent.click(await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" }));
    expect(await within(jobRoleSection()).findByText("The Job Role catalog is not available to you.")).toBeTruthy();
    expect(within(jobRoleSection()).queryByLabelText("Job Role")).toBeNull();
    expect(assignCalls(workforce)).toEqual([]);
  });
});

describe("assigning a Job Role is ONE governed command, then a re-read", () => {
  it("sends exactly { employeeId, jobRoleId } and re-reads the history, rendering only what the read returns", async () => {
    let assigned = false;
    const current = { assignmentId: "ejr-1", jobRoleId: "retail-sales", displayName: "Retail Sales", jobRoleStatus: "ACTIVE", current: true, effectiveFrom: "2026-09-17T10:00:00.000Z", effectiveTo: null, reason: null };
    const workforce = makeWorkforce({
      assignEmployeeJobRole: () => {
        assigned = true;
        return { ok: true, result: { outcome: "ASSIGNED", employeeId: "emp-1", jobRoleId: "retail-sales", assignmentId: "ejr-1", endedAssignmentId: null } };
      },
      listEmployeeJobRoleHistory: (input) => ({
        ok: true,
        result: assigned ? { employeeId: input.employeeId, current, items: [current], truncated: false } : { employeeId: input.employeeId, current: null, items: [], truncated: false },
      }),
    });
    const select = await openJobRoleControl(workforce);
    const readsBefore = historyReads(workforce);
    fireEvent.change(select, { target: { value: "retail-sales" } });
    fireEvent.click(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }));
    expect(await within(jobRoleSection()).findByText(/Job Role assigned: Retail Sales\. Access, Security Roles and permissions are unchanged\./)).toBeTruthy();
    expect(assignCalls(workforce)).toEqual([["assignEmployeeJobRole", { employeeId: "emp-1", jobRoleId: "retail-sales" }]]);
    await waitFor(() => expect(jobRoleSection().querySelector('[data-employee-job-role="ASSIGNED"]')).toBeTruthy());
    expect(historyReads(workforce)).toBe(readsBefore + 1);
    expect(within(jobRoleSection()).getByRole("button", { name: "Change Job Role" })).toBeTruthy();
    // No other writer and no profile command ran.
    expect(workforce.call.mock.calls.filter(([operation]) => WRITE_OPERATIONS.includes(operation)).map(([operation]) => operation)).toEqual(["assignEmployeeJobRole"]);
  });

  it("a written reason is sent trimmed; no tenant, principal, capability or Security Role is ever sent", async () => {
    const workforce = makeWorkforce({ assignEmployeeJobRole: { ok: true, result: { outcome: "CHANGED", employeeId: "emp-1", jobRoleId: "national-accounts-sales", assignmentId: "ejr-2", endedAssignmentId: "ejr-1" } } });
    const select = await openJobRoleControl(workforce);
    fireEvent.change(select, { target: { value: "national-accounts-sales" } });
    fireEvent.change(within(jobRoleSection()).getByLabelText("Reason (optional)"), { target: { value: "  Moved to national accounts  " } });
    fireEvent.click(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }));
    expect(await within(jobRoleSection()).findByText(/Job Role changed to National Accounts Sales/)).toBeTruthy();
    const [[, input]] = assignCalls(workforce);
    expect(input).toEqual({ employeeId: "emp-1", jobRoleId: "national-accounts-sales", reason: "Moved to national accounts" });
    for (const key of ["tenantId", "principalId", "actorUid", "capability", "capabilities", "securityRole", "role", ...NEVER_SENT_EMPLOYEE_KEYS]) {
      expect(input, key).not.toHaveProperty(key);
    }
  });

  it("NO_CHANGE says nothing changed and does not re-read", async () => {
    const workforce = makeWorkforce({ assignEmployeeJobRole: { ok: true, result: { outcome: "NO_CHANGE", employeeId: "emp-1", jobRoleId: "retail-sales", assignmentId: "ejr-1", endedAssignmentId: null } } });
    const select = await openJobRoleControl(workforce);
    const readsBefore = historyReads(workforce);
    fireEvent.change(select, { target: { value: "retail-sales" } });
    fireEvent.click(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }));
    expect(await within(jobRoleSection()).findByText("Nothing changed: Retail Sales is already this Employee's current Job Role.")).toBeTruthy();
    expect(historyReads(workforce)).toBe(readsBefore);
  });

  for (const [label, refusal, words] of [
    ["403", { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 }, "You are not authorized to change this Employee's Job Role (admin.employeeJobRole.write). Nothing was saved."],
    ["412 inactive", { ok: false, code: "PRECONDITION_FAILED", reason: "JOB_ROLE_INACTIVE", status: 412 }, "That Job Role is inactive and cannot be assigned. Nothing was saved."],
    ["409 concurrent", { ok: false, code: "CONFLICT", reason: "JOB_ROLE_CONCURRENT_CHANGE", status: 409 }, "This Employee's Job Role was changed by someone else at the same time. Review the current Job Role and try again. Nothing was saved."],
    ["404 Job Role", { ok: false, code: "NOT_FOUND", reason: "JOB_ROLE_NOT_FOUND", status: 404 }, "That Job Role does not exist in this company's Job Role catalog. Nothing was saved."],
    ["404 Employee", { ok: false, code: "NOT_FOUND", reason: "EMPLOYEE_NOT_FOUND", status: 404 }, "This Employee record could not be found. Nothing was saved."],
  ]) {
    it(`a ${label} refusal is stated exactly; the form stays open and nothing is shown as saved`, async () => {
      const workforce = makeWorkforce({ assignEmployeeJobRole: refusal });
      const select = await openJobRoleControl(workforce);
      fireEvent.change(select, { target: { value: "retail-sales" } });
      fireEvent.click(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }));
      const alert = await within(jobRoleSection()).findByRole("alert");
      expect(alert.textContent).toBe(words);
      expect(within(jobRoleSection()).getByLabelText("Job Role").value).toBe("retail-sales");
      expect(jobRoleSection().querySelector('[data-employee-job-role="NONE"]')).toBeTruthy();
      expect(within(jobRoleSection()).queryByText(/Job Role assigned:|Job Role changed to/)).toBeNull();
      expect(assignCalls(workforce).length).toBe(1);
    });
  }
});

describe("Job Role is not part of Edit Employee or of Security Role actions", () => {
  it("the Edit Employee form carries no Job Role control and Save sends none", async () => {
    await openEditor(makeWorkforce(), { search: "?edit=1" });
    const form = document.querySelector('[data-employee-edit="OPEN"]');
    expect(form.querySelector("[data-job-role-control]")).toBeNull();
    expect(within(form).queryByLabelText("Job Role")).toBeNull();
  });

  it("static: the editor, the User Access actions and the profile domain never name the Job Role command", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
    for (const rel of ["src/modules/administration/EmployeeEditPanel.jsx", "src/modules/administration/UserAccessActions.jsx", "src/domain/employeeProfile.js"]) {
      expect(src(rel), rel).not.toMatch(/assignEmployeeJobRole|employeeJobRole\.write|EmployeeJobRoleControl/);
    }
    // The control never offers anything under admin.employeeProfile.write.
    expect(src("src/modules/administration/EmployeeJobRoleControl.jsx")).not.toMatch(/employeeProfile\.write"/);
    expect(src("src/modules/administration/EmployeeJobRoleControl.jsx")).not.toMatch(/from\s+["']firebase|httpsCallable|firestore/i);
  });
});

// ════════════════════ FINDING #17: THE WORKFORCE OFFER FOLLOWS POSTGRESQL, NOT THE FIREBASE FEED ════════════════════
//
// Edit Employee and the Job Role control are offered from readMyWorkforceCapabilities -- the caller's PostgreSQL
// capabilities, the same set the Workforce commands re-check. Each test below injects a Firebase feed that says the
// OPPOSITE, so a page still reading the feed for these controls fails. User Access actions still follow the feed.

const capabilityReads = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "readMyWorkforceCapabilities");
const ALL_WORKFORCE = ["employee.record.read", "admin.principalAccess.read", "admin.employeeProfile.write", "admin.employeeJobRole.write"];
const FEED_GRANTS_ALL = () => true;
const FEED_DENIES_ALL = () => false;

describe("finding #17: Workforce controls are offered from the PostgreSQL capability read", () => {
  it("the feed grants everything, PostgreSQL grants nothing: Edit Employee and Job Role are NOT offered", async () => {
    const workforce = makeWorkforce();
    renderDetail(okHistory(), "emp-1", "?edit=1", FEED_GRANTS_ALL, workforce);
    const edit = await screen.findByRole("button", { name: "Edit Employee" });
    expect(edit.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/Workforce service did not grant Employee profile editing/).length).toBeGreaterThan(0);
    expect(document.querySelector('[data-employee-edit="NOT_GRANTED"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    const control = await waitFor(() => {
      const el = jobRoleSection().querySelector('[data-job-role-control="NOT_GRANTED"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(within(control).getByRole("button", { name: "Assign Job Role" }).hasAttribute("disabled")).toBe(true);
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listJobRoles" || operation === "listEmployees")).toBe(false);
    // ...while the User Access actions, whose authority is still the feed, stay live from it.
    expect((await screen.findByRole("button", { name: /Disable Account/ })).hasAttribute("disabled")).toBe(false);
  });

  it("the feed denies everything, PostgreSQL grants the Workforce ids: both controls are offered; User Access stays protected", async () => {
    const workforce = grant(makeWorkforce(), ALL_WORKFORCE);
    renderDetail(okHistory(), "emp-1", "", FEED_DENIES_ALL, workforce);
    const edit = await screen.findByRole("button", { name: "Edit Employee" });
    expect(edit.hasAttribute("disabled")).toBe(false);
    const assign = await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" });
    expect(assign.hasAttribute("disabled")).toBe(false);
    fireEvent.click(assign);
    expect(await within(jobRoleSection()).findByLabelText("Job Role")).toBeTruthy();
    // admin.principalAccess.read held in PostgreSQL does NOT unlock the Firebase-authorized account actions.
    await waitFor(() => expect(document.querySelector("[data-user-account-status]")).toBeTruthy());
    const accountActions = screen.queryAllByRole("button", { name: /Disable Account|Enable Account|Add Role|Send password reset/ });
    for (const button of accountActions) expect(button.hasAttribute("disabled"), button.textContent).toBe(true);
  });

  it("employee.record.read alone (a General Manager) offers neither control, and is not called NOT CONFIGURED", async () => {
    const workforce = grant(makeWorkforce(), ["employee.record.read"]);
    renderDetail(okHistory(), "emp-1", "", FEED_GRANTS_ALL, workforce);
    expect((await screen.findByRole("button", { name: "Edit Employee" })).hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(jobRoleSection().querySelector('[data-job-role-control="NOT_GRANTED"]')).toBeTruthy());
    expect(jobRoleSection().querySelector('[data-job-role-control="NOT_CONFIGURED"]')).toBeNull();
  });

  it("the NOT CONFIGURED (grant) distinction comes from PostgreSQL too: profile write held there, Job Role write not -- whatever the feed says", async () => {
    const workforce = grant(makeWorkforce(), ["employee.record.read", "admin.employeeProfile.write"]);
    renderDetail(okHistory(), "emp-1", "", FEED_GRANTS_ALL, workforce);
    const state = await waitFor(() => {
      const el = jobRoleSection().querySelector('[data-job-role-control="NOT_CONFIGURED"]');
      expect(el).toBeTruthy();
      return el;
    });
    expect(state.getAttribute("data-job-role-not-configured")).toBe("GRANT");
  });

  it("reads the capabilities ONCE per page mount, with no input -- nothing identifying the caller is sent", async () => {
    const workforce = grant(makeWorkforce(), ALL_WORKFORCE);
    renderDetail(okHistory(), "emp-1", "", FEED_DENIES_ALL, workforce);
    await screen.findByRole("button", { name: "Edit Employee" });
    await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" });
    expect(capabilityReads(workforce)).toEqual([["readMyWorkforceCapabilities", undefined]]);
  });

  it("while the capability read is in flight nothing is offered and nothing is refused", async () => {
    let answer;
    const pending = new Promise((resolve) => { answer = resolve; });
    const workforce = makeWorkforce({ readMyWorkforceCapabilities: () => pending });
    renderDetail(okHistory(), "emp-1", "?edit=1", FEED_GRANTS_ALL, workforce);
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    await waitFor(() => expect(jobRoleSection().querySelector('[data-job-role-control="CHECKING"]')).toBeTruthy());
    expect(document.querySelector('[data-workforce-capabilities="loading"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Employee" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(document.querySelector("[data-employee-edit]")).toBeNull();
    expect(screen.queryByText(/did not grant/)).toBeNull();
    expect(within(jobRoleSection()).queryByRole("button", { name: /Assign Job Role|Change Job Role/ })).toBeNull();
    expect(workforce.call.mock.calls.some(([operation]) => operation === "listJobRoles" || operation === "listEmployees")).toBe(false);
    // The answer arrives: now, and only now, the editor opens.
    await act(async () => answer({ ok: true, result: { capabilities: ["admin.employeeProfile.write"] } }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  for (const [label, outcome, words] of [
    ["an outage", { ok: false, code: "UNREACHABLE", reason: null, status: null }, "Your Workforce permission check could not be loaded from the Workforce service. Nothing else was used in its place."],
    ["a refusal", { ok: false, code: "FORBIDDEN", reason: "ACTOR_NOT_TENANT_MEMBER", status: 403 }, "Your Workforce permission check is not available to you."],
    ["a malformed answer", { ok: true, result: { capabilities: ["admin.employeeProfile.write", "admin.everything"] } }, "Your Workforce permission check could not be loaded from the Workforce service. Nothing else was used in its place."],
    ["a missing list", { ok: true, result: {} }, "Your Workforce permission check could not be loaded from the Workforce service. Nothing else was used in its place."],
  ]) {
    it(`${label} is stated honestly: nothing offered, never "not granted" or "not configured", whatever the feed says`, async () => {
      const workforce = makeWorkforce({ readMyWorkforceCapabilities: outcome });
      renderDetail(okHistory(), "emp-1", "?edit=1", FEED_GRANTS_ALL, workforce);
      const edit = await screen.findByRole("button", { name: "Edit Employee" });
      expect(edit.hasAttribute("disabled")).toBe(true);
      expect(document.querySelector('[data-employee-edit="CAPABILITIES_UNAVAILABLE"]').textContent).toContain(words);
      expect(document.querySelector('[data-employee-edit="NOT_GRANTED"]')).toBeNull();
      const control = await waitFor(() => {
        const el = jobRoleSection().querySelector('[data-job-role-control="CAPABILITIES_UNAVAILABLE"]');
        expect(el).toBeTruthy();
        return el;
      });
      expect(control.textContent).toContain(words);
      expect(jobRoleSection().querySelector('[data-job-role-control="NOT_CONFIGURED"]')).toBeNull();
      expect(screen.queryByText(/did not grant|not configured/i)).toBeNull();
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(workforce.call.mock.calls.some(([operation]) => operation === "listJobRoles" || operation === "listEmployees")).toBe(false);
    });
  }

  it("Retry after a failed capability read re-reads it, and a granted answer then offers the controls", async () => {
    let calls = 0;
    const workforce = makeWorkforce({
      readMyWorkforceCapabilities: () => (++calls === 1 ? { ok: false, code: "UNREACHABLE" } : { ok: true, result: { capabilities: ALL_WORKFORCE } }),
    });
    renderDetail(okHistory(), "emp-1", "", FEED_DENIES_ALL, workforce);
    const control = await waitFor(() => {
      const el = jobRoleSection().querySelector('[data-job-role-control="CAPABILITIES_UNAVAILABLE"]');
      expect(el).toBeTruthy();
      return el;
    });
    fireEvent.click(within(control).getByRole("button", { name: "Retry" }));
    expect((await within(jobRoleSection()).findByRole("button", { name: "Assign Job Role" })).hasAttribute("disabled")).toBe(false);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Employee" }).hasAttribute("disabled")).toBe(false));
    expect(capabilityReads(workforce)).toHaveLength(2);
  });

  it("static: UserDetail no longer asks the feed about a Workforce id; only UserAccessActions receives hasCapability", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.resolve(process.cwd(), "src/modules/administration/UserDetail.jsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/hasCapability\(/);
    expect(src).not.toMatch(/holdsCapability/);
    expect([...src.matchAll(/hasCapability=\{hasCapability\}/g)]).toHaveLength(2);
    expect(src).toMatch(/<UserAccessActions [^>]*hasCapability=\{hasCapability\}/);
    expect(src).toMatch(/useWorkforceCapabilities\(\{ client: workforce, principalKey: user\?\.uid \?\? null \}\)/);
  });
});

// ════════════════════ GOVERNED CHANGE HISTORY (EMP-RT-H1) ════════════════════
//
// The governed trail is listEmployeeChangeHistory on the Workforce transport. It renders in the shared Change History
// grammar with human words, sits ABOVE the legacy (pre-cutover) trail, is re-read after a saved edit and after a Job
// Role assignment, and states refused / failed / empty as three different facts.

const governedSection = () => document.querySelector("#employee-change-history");
const governedState = () => document.querySelector("[data-governed-history]")?.getAttribute("data-governed-history");
const governedReads = (workforce) => workforce.call.mock.calls.filter(([operation]) => operation === "listEmployeeChangeHistory");
const GOVERNED_ITEMS = [
  {
    eventId: "audit_new", action: "employee.jobRole.assign", occurredAt: "2026-09-15T10:00:00.000Z",
    before: { jobRoleId: "retail-sales", jobRoleDisplayName: "Retail Sales" }, after: { jobRoleId: "national-accounts-sales", jobRoleDisplayName: "National Accounts Sales" },
    reason: null, changedBy: { displayName: "Avery Admin" },
  },
  {
    eventId: "audit_mid", action: "employee.reportingRelationship.establish", occurredAt: "2026-09-12T10:00:00.000Z",
    before: null, after: { managerEmployeeId: "emp-2", managerDisplayName: "Mike Jones" }, reason: "reorganised team", changedBy: null,
  },
  {
    eventId: "audit_old", action: "employee.profile.update", occurredAt: "2026-09-01T10:00:00.000Z",
    before: { jobTitle: "Service Technician" }, after: { jobTitle: "Senior Service Technician" }, reason: "promotion", changedBy: { displayName: "Avery Admin" },
  },
];
const governedPage = (items, nextCursor = null) => ({ ok: true, result: { employeeId: "emp-1", items, truncated: nextCursor !== null, nextCursor } });

describe("the governed Change History (EMP-RT-H1)", () => {
  it("renders human labels newest first, names the actor only when the server did, and is scoped to this Employee", async () => {
    const workforce = makeWorkforce({ listEmployeeChangeHistory: governedPage(GOVERNED_ITEMS) });
    renderDetail(okHistory(HISTORY), "emp-1", "", undefined, workforce);
    const table = await screen.findByTestId("governed-change-history-table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("data-history-row"))).toEqual(["audit_new:jobRole", "audit_mid:managerEmployeeId", "audit_old:jobTitle"]);
    expect(rows.map((r) => [...r.querySelectorAll("td")].slice(1).map((td) => td.textContent))).toEqual([
      ["Job Role", "Retail Sales", "National Accounts Sales", "Avery Admin", "—"],
      ["Manager", "—", "Mike Jones", "Not shown", "reorganised team"],
      ["Job Title", "Service Technician", "Senior Service Technician", "Avery Admin", "promotion"],
    ]);
    expect(table.textContent).not.toMatch(/retail-sales|national-accounts-sales|emp-2|employee\.jobRole|pr-/);
    expect(governedReads(workforce)).toEqual([["listEmployeeChangeHistory", { employeeId: "emp-1", limit: 50 }]]);
    expect(within(governedSection()).getByRole("heading", { name: "Change History" })).toBeTruthy();
    expect(governedSection().textContent).toMatch(/Governed Employee changes, from the Workforce service \(EMP-RT-H1\)/);
  });

  it("shows each governed change's own reason in a Reason column -- profile, reporting, lifecycle and Job Role", async () => {
    const at = (n) => `2026-09-1${n}T10:00:00.000Z`;
    const items = [
      { eventId: "a4", action: "employee.jobRole.assign", occurredAt: at(4), before: null, after: { jobRoleId: "x", jobRoleDisplayName: "Retail Sales" }, reason: "hired into retail", changedBy: null },
      { eventId: "a3", action: "employee.operatingCompany.change", occurredAt: at(3), before: { operatingCompanyId: "taylor" }, after: { operatingCompanyId: "taylor" }, reason: "company move", changedBy: null },
      { eventId: "a2", action: "employee.employmentStatus.change", occurredAt: at(2), before: { employmentStatus: "ACTIVE" }, after: { employmentStatus: "ON_LEAVE" }, reason: "medical leave", changedBy: null },
      { eventId: "a1", action: "employee.reportingRelationship.end", occurredAt: at(1), before: { managerEmployeeId: "emp-2", managerDisplayName: "Mike Jones" }, after: null, reason: "manager left", changedBy: null },
      { eventId: "a0", action: "employee.profile.update", occurredAt: at(0), before: { jobTitle: "A" }, after: { jobTitle: "B" }, reason: null, changedBy: null },
    ];
    const workforce = makeWorkforce({ listEmployeeChangeHistory: governedPage(items) });
    renderDetail(okHistory(HISTORY), "emp-1", "", undefined, workforce);
    const table = await screen.findByTestId("governed-change-history-table");
    expect(within(table).getByRole("columnheader", { name: "Reason" })).toBeTruthy();
    const reasons = within(table).getAllByRole("row").slice(1).map((r) => r.querySelector('td[data-label="Reason"]').textContent);
    expect(reasons).toEqual(["hired into retail", "company move", "medical leave", "manager left", "—"]);
    // The legacy trail records no reasons, so it has no Reason column.
    const legacy = await screen.findByTestId("change-history-table");
    expect(within(legacy).queryByRole("columnheader", { name: "Reason" })).toBeNull();
    expect(legacy.querySelector('td[data-label="Reason"]')).toBeNull();
  });

  it("states that manager and Job Role names are shown as they are named today -- on the governed trail only", async () => {
    const workforce = makeWorkforce({ listEmployeeChangeHistory: governedPage(GOVERNED_ITEMS) });
    renderDetail(okHistory(HISTORY), "emp-1", "", undefined, workforce);
    await screen.findByTestId("governed-change-history-table");
    expect(governedSection().querySelector("[data-history-caption]").textContent)
      .toBe("Manager and Job Role names are shown as they are named today, not as they were named at the time of the change.");
    expect(document.querySelector("#legacy-change-history [data-history-caption]")).toBeNull();
  });

  it("keeps the legacy trail visible, labelled as the pre-cutover legacy trail, BELOW the governed one -- never merged", async () => {
    const workforce = makeWorkforce({ listEmployeeChangeHistory: governedPage(GOVERNED_ITEMS) });
    renderDetail(okHistory(HISTORY), "emp-1", "", undefined, workforce);
    const legacyTable = await screen.findByTestId("change-history-table");
    const governedTable = await screen.findByTestId("governed-change-history-table");
    const legacy = document.querySelector("#legacy-change-history");
    expect(within(legacy).getByRole("heading", { name: "Legacy Change History" })).toBeTruthy();
    expect(legacy.textContent).toMatch(/Pre-cutover legacy trail/);
    expect(governedSection().compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(legacyTable).getAllByRole("row").slice(1).map((r) => r.getAttribute("data-history-row"))).toEqual(["h1", "h2"]);
    expect(governedTable.querySelector('[data-history-row="h1"]')).toBeNull();
    expect(legacyTable.querySelector('[data-history-row^="audit_"]')).toBeNull();
  });

  it("empty, refused and failed are three different statements; only a failure offers retry", async () => {
    const cases = [
      [governedPage([]), "READY", /No governed changes have been recorded for this Employee yet\./, false],
      [{ ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 }, "REFUSED", /Change history not available to you/, false],
      [{ ok: false, code: "INTERNAL", status: 500 }, "FAILED", /Change history could not be loaded/, true],
    ];
    for (const [answer, state, words, retry] of cases) {
      cleanup();
      const workforce = makeWorkforce({ listEmployeeChangeHistory: answer });
      renderDetail(okHistory(HISTORY), "emp-1", "", undefined, workforce);
      await waitFor(() => expect(governedState()).toBe(state));
      expect(governedSection().textContent).toMatch(words);
      expect(Boolean(within(governedSection()).queryByRole("button", { name: "Try again" })), state).toBe(retry);
      expect(screen.queryByTestId("governed-change-history-table")).toBeNull();
      // The legacy trail is unaffected by the governed read's outcome.
      expect(await screen.findByTestId("change-history-table")).toBeTruthy();
    }
  });

  it("a retry after a failure reads again", async () => {
    let calls = 0;
    const workforce = makeWorkforce({ listEmployeeChangeHistory: () => (++calls === 1 ? { ok: false, code: "UNREACHABLE" } : governedPage(GOVERNED_ITEMS)) });
    renderDetail(okHistory(), "emp-1", "", undefined, workforce);
    await waitFor(() => expect(governedState()).toBe("FAILED"));
    fireEvent.click(within(governedSection()).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("governed-change-history-table")).toBeTruthy();
    expect(governedReads(workforce).length).toBe(2);
  });

  it("Show more appends the next page with the server's cursor; no cursor, no button", async () => {
    const workforce = makeWorkforce({
      listEmployeeChangeHistory: (input) => (input.cursor === "c-2" ? governedPage(GOVERNED_ITEMS.slice(2)) : governedPage(GOVERNED_ITEMS.slice(0, 2), "c-2")),
    });
    renderDetail(okHistory(), "emp-1", "", undefined, workforce);
    await screen.findByTestId("governed-change-history-table");
    expect(within(screen.getByTestId("governed-change-history-table")).getAllByRole("row").length - 1).toBe(2);
    fireEvent.click(within(governedSection()).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(screen.getByTestId("governed-change-history-table")).getAllByRole("row").length - 1).toBe(3));
    expect(governedReads(workforce).at(-1)).toEqual(["listEmployeeChangeHistory", { employeeId: "emp-1", limit: 50, cursor: "c-2" }]);
    expect(within(governedSection()).queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("is re-read after a successful Edit Employee save", async () => {
    const workforce = makeWorkforce({ listEmployeeChangeHistory: governedPage([]), updateEmployeeProfile: UPDATED(["jobTitle"]) });
    await openEditor(workforce);
    await waitFor(() => expect(governedState()).toBe("READY"));
    const before = governedReads(workforce).length;
    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "Lead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/^Saved: Job Title\./);
    await waitFor(() => expect(governedReads(workforce).length).toBeGreaterThan(before));
    await waitFor(() => expect(governedState()).toBe("READY"));
  });

  it("is re-read after a Job Role assignment", async () => {
    const workforce = makeWorkforce({
      listEmployeeChangeHistory: governedPage([]),
      assignEmployeeJobRole: { ok: true, result: { outcome: "ASSIGNED", employeeId: "emp-1", jobRoleId: "retail-sales", assignmentId: "ejr-1", endedAssignmentId: null } },
    });
    const select = await openJobRoleControl(workforce);
    await waitFor(() => expect(governedState()).toBe("READY"));
    const before = governedReads(workforce).length;
    fireEvent.change(select, { target: { value: "retail-sales" } });
    fireEvent.click(within(jobRoleSection()).getByRole("button", { name: "Save Job Role" }));
    await within(jobRoleSection()).findByText(/Job Role assigned: Retail Sales\./);
    await waitFor(() => expect(governedReads(workforce).length).toBe(before + 1));
  });

  it("static: the governed history modules add no Firebase import and read only through the injected Workforce client", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const rel of ["src/modules/administration/EmployeeChangeHistorySection.jsx", "src/domain/employeeChangeHistory.js"]) {
      const src = readFileSync(path.resolve(process.cwd(), rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(src, rel).not.toMatch(/firebase|firestore|httpsCallable|administrationUsersClient|listRecordChangeHistory/i);
    }
    const section = readFileSync(path.resolve(process.cwd(), "src/modules/administration/EmployeeChangeHistorySection.jsx"), "utf8");
    expect(section).not.toMatch(/services\/|hooks\//);
  });
});
