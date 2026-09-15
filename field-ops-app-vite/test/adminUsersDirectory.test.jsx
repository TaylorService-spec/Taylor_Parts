// ADMINISTRATION → USERS, THE DIRECTORY -- on the governed PostgreSQL Employee authority.
//
// The directory used to read the Firestore `employee.index` metadata list while the record page read PostgreSQL.
// Two id spaces behind one link is how a row click became a live 404. It now reads EMP-RT-01 `listEmployees`
// through the Workforce transport, which is injected here as a mocked client -- there is no Firestore hook to
// mock, and the static ratchet at the bottom proves there is none left to add.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useNavigate: () => mockNavigate };
});
// The Principal panel is the User Access authority beside this directory; it has its own suite and its own
// service. Stubbed to a marker so this file proves the SEPARATION rather than re-testing the panel.
vi.mock("../src/modules/administration/PolicyStorePanels.jsx", () => ({
  UsersPolicyPanel: () => <div data-testid="users-policy-panel">Principal Roles</div>,
}));

import AdminUsers from "../src/modules/administration/AdminUsers.jsx";
import { employeeDirectoryPresentation } from "../src/domain/employeeOperatingProfile.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ── fixtures: the EMP-RT-01 listEmployees projection, test-only ──
const item = (over) => ({
  employeeId: over.employeeId,
  displayName: over.displayName ?? null,
  employeeNumber: null,
  employmentStatus: "ACTIVE",
  operatingCompanyId: "taylor",
  jobTitle: null,
  ...over,
});
const PAGE_ONE = [
  item({ employeeId: "pg-emp-1", displayName: "John Smith", employeeNumber: "TAZ-0042", jobTitle: "Senior Service Technician" }),
  item({ employeeId: "pg-emp-3", displayName: "Pat Lee", employmentStatus: "CONTRACTOR" }),
];
const PAGE_TWO = [item({ employeeId: "pg-emp-7", displayName: "Kim Wu", employmentStatus: "TERMINATED" })];

const ok = (result) => ({ ok: true, result });
const fail = (code, reason = null, status = null) => ({ ok: false, code, reason, status, message: "refused" });

/** A mocked Workforce transport that pages: the first call returns a cursor, the second consumes it. */
function makeWorkforce({ pages = [PAGE_ONE], cursors = [null], failWith = null } = {}) {
  let call = 0;
  return {
    call: vi.fn(async (operation, input) => {
      if (operation !== "listEmployees") return fail("UNKNOWN_OPERATION");
      if (failWith && call === 0) {
        call += 1;
        return failWith;
      }
      const index = input?.cursor ? cursors.findIndex((c) => c === input.cursor) + 1 : 0;
      call += 1;
      return ok({ items: pages[index] ?? [], truncated: Boolean(cursors[index]), nextCursor: cursors[index] ?? null });
    }),
  };
}

const renderDirectory = (workforce = makeWorkforce()) => {
  render(
    <MemoryRouter>
      <AdminUsers workforce={workforce} />
    </MemoryRouter>,
  );
  return workforce;
};

beforeEach(() => mockNavigate.mockClear());
afterEach(cleanup);

// ════════════════════ THE READ ════════════════════

describe("the directory is the governed PostgreSQL Employee read", () => {
  it("invokes listEmployees and renders the projection it returns", async () => {
    const workforce = renderDirectory();
    expect(await screen.findByText("John Smith")).toBeTruthy();
    expect(workforce.call).toHaveBeenCalledTimes(1);
    expect(workforce.call.mock.calls[0][0]).toBe("listEmployees");
    expect(screen.getByRole("heading", { name: "Users" })).toBeTruthy();
    expect(screen.getByText("Pat Lee")).toBeTruthy();
    expect(screen.getByText("TAZ-0042")).toBeTruthy();
    expect(screen.getByText("Senior Service Technician")).toBeTruthy();
    expect(screen.getAllByText("Taylor Freezer of Arizona").length).toBe(2);
    expect(screen.getByText("Contractor")).toBeTruthy();
  });

  it("shows only the columns the governed projection carries -- and invents none", async () => {
    renderDirectory();
    await screen.findByText("John Smith");
    for (const heading of ["Name", "Employee ID", "Employment Status", "Job Title", "Operating Company"]) {
      expect(screen.getByRole("columnheader", { name: heading }), heading).toBeTruthy();
    }
    // listEmployees returns no account status, no Security Role, no Job Role and no uid, so no column claims one.
    for (const absent of ["EOS Account", "EOS Access", "Security Role", "Legacy role", "Job Role", "Account Status", "Operational Roles"]) {
      expect(screen.queryByRole("columnheader", { name: absent }), absent).toBeNull();
    }
    expect(screen.queryByText(/uid-/)).toBeNull();
  });

  it("an Employee with no number or title says so rather than showing a blank or an id", async () => {
    renderDirectory();
    await screen.findByText("Pat Lee");
    const row = screen.getByText("Pat Lee").closest("tr");
    expect(within(row).getAllByText("Not recorded").length).toBe(2);
    expect(row.textContent).not.toMatch(/pg-emp-3/);
  });

  it("a loading directory is a loading state, never an empty one", () => {
    renderDirectory({ call: vi.fn(() => new Promise(() => {})) });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
  });
});

// ════════════════════ NAVIGATION BY THE PostgreSQL ID ════════════════════

describe("navigation uses the PostgreSQL employeeId", () => {
  it("a row click opens that Employee's record, and nothing on the row becomes editable", async () => {
    renderDirectory();
    fireEvent.click(await screen.findByText("John Smith"));
    expect(mockNavigate).toHaveBeenCalledWith("/administration/users/pg-emp-1");
    expect(screen.queryAllByRole("textbox").length).toBe(0);
    expect(screen.queryAllByRole("combobox").length).toBe(0);
  });

  it("Edit is a separate action, to the same record, by the same id", async () => {
    renderDirectory();
    await screen.findByText("John Smith");
    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits.length).toBe(2);
    fireEvent.click(edits[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/administration/users/pg-emp-1?edit=1");
  });
});

// ════════════════════ PAGINATION ════════════════════

describe("pagination follows the read's own cursor", () => {
  it("Load More requests the next page and appends it, then the count appears once exhausted", async () => {
    const workforce = renderDirectory(makeWorkforce({ pages: [PAGE_ONE, PAGE_TWO], cursors: ["cursor-1", null] }));
    await screen.findByText("John Smith");
    // A partial page never states a headcount.
    expect(screen.queryByText("2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Kim Wu")).toBeTruthy();
    expect(workforce.call.mock.calls[1]).toEqual(["listEmployees", { cursor: "cursor-1" }]);
    // Appended, not replaced.
    expect(screen.getByText("John Smith")).toBeTruthy();
    expect(screen.getByText("Terminated")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("no Load More when the read returned no cursor", async () => {
    renderDirectory();
    await screen.findByText("John Smith");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

// ════════════════════ FAILURE, AND NO FALLBACK ════════════════════

describe("failures are stated, and nothing else is read", () => {
  it("an outage shows the retryable failure, no rows, and no second source", async () => {
    const workforce = makeWorkforce({ failWith: fail("UNREACHABLE") });
    renderDirectory(workforce);
    expect(await screen.findByText(/could not be loaded from the Workforce service/)).toBeTruthy();
    expect(screen.queryByText("John Smith")).toBeNull();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
    // Only the one operation was ever called.
    expect(workforce.call.mock.calls.every((c) => c[0] === "listEmployees")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("John Smith")).toBeTruthy();
    expect(workforce.call.mock.calls.length).toBe(2);
  });

  it("a refusal says not available to you -- never an empty directory", async () => {
    renderDirectory(makeWorkforce({ failWith: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    expect(await screen.findByText("Not available to you")).toBeTruthy();
    expect(screen.getByText("The Employee directory is not available to you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
  });

  it("a company the governed authority cannot resolve reads as unavailable, never as a raw id", () => {
    const presentation = employeeDirectoryPresentation({ status: "ready", items: [item({ employeeId: "e", displayName: "X", operatingCompanyId: "no-such-company" })] });
    expect(presentation.rows[0].cells.at(-1).value).toBe("Unavailable");
    expect(JSON.stringify(presentation.rows[0].cells)).not.toContain("no-such-company");
    // And the row key is the PostgreSQL Employee id the record route reads by.
    expect(presentation.rows[0].key).toBe("e");
  });
});

// ════════════════════ EMPLOYEE != USER ACCESS ════════════════════

describe("Employee and Principal stay separate on this page", () => {
  it("the Principal panel is its own presentation beside the Employee directory", async () => {
    renderDirectory();
    await screen.findByText("John Smith");
    const panel = screen.getByTestId("users-policy-panel");
    expect(panel.closest("table")).toBeNull();
    expect(screen.getByText(/Whether a person can sign in is User Access, not an\s+Employee fact/)).toBeTruthy();
  });
});

// ════════════════════ STATIC RATCHET ════════════════════

describe("no Firestore Employee-directory read remains", () => {
  it("AdminUsers reads the Workforce transport and nothing else", () => {
    const src = code(read("src/modules/administration/AdminUsers.jsx"));
    expect(src).not.toMatch(/useMetadataList|employeeIndexList|employeeEntity|metadata\/definitions\/employee/);
    expect(src).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']/);
    expect(src).not.toMatch(/\b(collection|onSnapshot|getDocs|getDoc|query|httpsCallable)\s*\(/);
    expect(src).not.toMatch(/useEmployeeDirectory|domain\/employees/);
    const seams = [...src.matchAll(/from\s+["']([^"']*(hooks|services|access)\/[^"']*)["']/g)].map((m) => m[1]).sort();
    expect(seams).toEqual(["../../hooks/useWorkforceEmployeeDirectory.js", "../../services/workforceApiClient.js"]);
  });

  it("the directory hook holds the governed read only -- one operation, no fallback", () => {
    const src = code(read("src/hooks/useWorkforceEmployeeDirectory.js"));
    expect(src).toMatch(/client\.call\("listEmployees"/);
    expect(src).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']/);
    expect(src).not.toMatch(/useMetadataList|firestore/i);
  });

  it("the metadata definition is left in place for the surfaces and suites that still reference it", () => {
    expect(read("src/metadata/definitions/employee.js")).toMatch(/id: "employee\.index"/);
  });
});
