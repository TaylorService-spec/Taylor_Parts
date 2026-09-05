// ADMINISTRATION > USERS -- the directory, the record page, the edit flow, and the shared history.
//
// Rendered through the real components with the Firestore reads mocked at the hook boundary and
// the governed writes mocked at the SEAM -- the same technique accountDetailFailClosed.test.jsx
// uses. No Firebase, no network, and no capability granted anywhere: the fail-closed states below
// are the states the running app is in today.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
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

const okHistory = (rows = []) => ({
  updateEmployeeProfile: vi.fn().mockResolvedValue({ ok: true, result: "APPLIED", changedFields: [] }),
  setUserStatus: vi.fn(),
  listRecordChangeHistory: vi.fn().mockResolvedValue({ ok: true, rows }),
});

const renderDetail = (client, employeeId = "emp-1", search = "") =>
  render(
    <MemoryRouter initialEntries={[`/administration/users/${employeeId}${search}`]}>
      <Routes>
        <Route path="/administration/users/:employeeId" element={<UserDetail client={client} />} />
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

  it("shows the six columns the directory is for -- with EOS Access as WORDS, never a uid", () => {
    render(<MemoryRouter><AdminUsers /></MemoryRouter>);
    for (const heading of ["Name", "Employment Status", "Operational Roles", "EOS Access", "Security Role"]) {
      expect(screen.getByRole("columnheader", { name: heading }), heading).toBeTruthy();
    }
    expect(screen.getByText("Account linked")).toBeTruthy();
    expect(screen.getByText("No account")).toBeTruthy();
    // The linked employee's raw uid must not appear anywhere on the page.
    expect(screen.queryByText("uid-john")).toBeNull();
  });

  it("EOS Access is NOT derived from employment status", () => {
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
  it("the account's enabled/disabled state is reported as unavailable, never guessed", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.getByText(/no governed read of another user's account status exists/i)).toBeTruthy();
  });

  it("Enable and Disable are contextual to THIS user and fail closed with a stated reason", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    const enable = screen.getByRole("button", { name: /Enable Account/ });
    const disable = screen.getByRole("button", { name: /Disable Account/ });
    // No capability is granted anywhere in this render, so both are protected, not live.
    expect(enable.hasAttribute("disabled")).toBe(true);
    expect(disable.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/No principal holds the governed access-record grant/i).length).toBeGreaterThan(0);
  });

  it("Security Role is shown as the MIRROR it is, with no control over it", async () => {
    renderDetail(okHistory());
    await screen.findByRole("heading", { level: 1, name: "John Smith" });
    expect(screen.getByText(/Mirrors the legacy identity role/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /security role/i })).toBeNull();
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

  it("Employment Status is a closed picklist and Security Role has no control at all", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const status = await screen.findByLabelText(/Employment Status/);
    expect(status.tagName).toBe("SELECT");
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Active", "On Leave", "Inactive", "Terminated", "Retired", "Contractor",
    ]);
    // Security Role appears as read-only context; there is no input, select or textbox for it.
    expect(screen.getByText(/Mirrors the legacy identity role/)).toBeTruthy();
    expect(screen.queryByLabelText(/Security Role/)).toBeNull();
  });

  it("Operational Roles is a multi-select over the canonical vocabulary", async () => {
    renderDetail(okHistory(), "emp-1", "?edit=1");
    const group = await screen.findByRole("group", { name: "Operational Roles" });
    const boxes = within(group).getAllByRole("checkbox");
    expect(boxes.length).toBe(8);
    expect(within(group).getByLabelText("Technician").checked).toBe(true);
    expect(within(group).getByLabelText("Parts Manager").checked).toBe(false);
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
    expect(within(bodyRows[1]).getByText("EOS Access Status")).toBeTruthy();
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
      "EOS Access Status",
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
