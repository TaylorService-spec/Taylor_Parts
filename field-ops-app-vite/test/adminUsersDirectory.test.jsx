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

// EMP-RT-08 listEmployeesWithoutJobRole: nobody is missing a Job Role unless a test says otherwise.
const NONE_WITHOUT_JOB_ROLE = ok({ count: 0, items: [], truncated: false, nextCursor: null });

/**
 * A mocked Workforce transport that pages: the first call returns a cursor, the second consumes it. `withoutJobRole`
 * answers the EMP-RT-08 remediation read (a value, or a function of the input).
 */
function makeWorkforce({ pages = [PAGE_ONE], cursors = [null], failWith = null, withoutJobRole = NONE_WITHOUT_JOB_ROLE } = {}) {
  let call = 0;
  return {
    call: vi.fn(async (operation, input) => {
      if (operation === "listEmployeesWithoutJobRole") return typeof withoutJobRole === "function" ? withoutJobRole(input) : withoutJobRole;
      // #210: the directory is the roster; the remediation tests below still see the same people.
      if (operation === "listWorkforceRoster") return rosterOf(pages[0] ?? []);
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

const directoryCalls = (workforce) => workforce.call.mock.calls.filter((c) => c[0] === "listEmployees");

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

// ════════════════════ THE READ (Administration control plane, #210: the directory IS the workforce roster) ════════════════════

const rosterOf = (items, over = {}) => ok({ items: items.map((i) => ({ jobRole: null, manager: null, workEligibility: [], operationalScopes: [], applicationUser: "LINKED", securityRoles: [], principalId: null, ...i })),
  total: items.length, truncated: false, securityRolesWithheld: null,
  facets: { jobRoles: [], securityRoles: [], operatingCompanies: [], statuses: [] }, ...over });
function makeRoster({ items = PAGE_ONE, failWith = null, over = {} } = {}) {
  return { call: vi.fn(async (operation) => {
    if (operation === "listEmployeesWithoutJobRole") return NONE_WITHOUT_JOB_ROLE;
    if (operation !== "listWorkforceRoster") return fail("UNKNOWN_OPERATION");
    return failWith ?? rosterOf(items, over);
  }) };
}
const rosterCalls = (workforce) => workforce.call.mock.calls.filter((c) => c[0] === "listWorkforceRoster");

describe("the directory is the governed PostgreSQL workforce roster", () => {
  it("invokes listWorkforceRoster (never listEmployees, never Firestore) and renders what it returns", async () => {
    const workforce = renderDirectory(makeRoster());
    await screen.findByText("John Smith");
    expect(rosterCalls(workforce).length).toBeGreaterThanOrEqual(1);
    expect(workforce.call.mock.calls.some((c) => c[0] === "listEmployees")).toBe(false);
    expect(screen.getByText("Pat Lee")).toBeTruthy();
  });
  it("states the exact count the server computed, and says when the list is cut", async () => {
    renderDirectory(makeRoster({ over: { total: 612, truncated: true } }));
    await screen.findByText(/612 employees \(first 2 shown\)/);
  });
  it("a loading roster is a loading state, never an empty one", () => {
    renderDirectory({ call: vi.fn(() => new Promise(() => {})) });
    expect(screen.queryByText(/0 employees/)).toBeNull();
  });
});

describe("navigation uses the PostgreSQL employeeId", () => {
  it("each name links to that Employee's record by the governed id", async () => {
    renderDirectory(makeRoster());
    const link = await screen.findByRole("link", { name: "John Smith" });
    expect(link.getAttribute("href")).toBe("/administration/users/pg-emp-1");
  });
});

describe("failures are stated, and nothing else is read", () => {
  it("an outage shows the retryable failure, no rows, and no second source", async () => {
    const workforce = renderDirectory(makeRoster({ failWith: fail("UNREACHABLE", null, null) }));
    await screen.findByRole("button", { name: /Try again|Retry/i });
    expect(screen.queryByText("John Smith")).toBeNull();
    expect(workforce.call.mock.calls.every((c) => ["listWorkforceRoster", "listEmployeesWithoutJobRole"].includes(c[0]))).toBe(true);
  });
  it("a refusal says not available to you -- never an empty directory", async () => {
    renderDirectory(makeRoster({ failWith: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    await screen.findByText(/Ask an administrator if you believe you need it/);
    expect(screen.queryByText(/0 employees/)).toBeNull();
  });
});

describe("Employee and Principal stay separate on this page", () => {
  it("the Users page is the Employee directory only; Security Roles are changed on the Employee record (Pass 10 F2/F3)", async () => {
    renderDirectory(makeRoster());
    await screen.findByText("John Smith");
    expect(screen.getByText(/Whether a person can sign in is User Access, not an\s+Employee fact/)).toBeTruthy();
    expect(screen.getByText(/open their Employee record and use\s+its Security Roles section/)).toBeTruthy();
    // No second, reason-less assignment surface: the legacy policy-store panel and its controls are gone.
    expect(screen.queryByText(/Stored role assignments/)).toBeNull();
    expect(screen.queryByText(/in the panel below/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Add role" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add a role" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Select a principal" })).toBeNull();
  });
});

// ════════════════════ EMPLOYEES WITHOUT A JOB ROLE (EMP-RT-08) ════════════════════

describe("the Job Role remediation count is its own governed read", () => {
  const MISSING = [
    item({ employeeId: "pg-emp-21", displayName: "Rae Quinn" }),
    item({ employeeId: "pg-emp-22", displayName: "Sol Vega", employmentStatus: "ON_LEAVE" }),
  ];

  it("states 'N Employees have no Job Role' and lists them, each linking to its record", async () => {
    const workforce = renderDirectory(makeWorkforce({ withoutJobRole: ok({ count: 2, items: MISSING, truncated: false, nextCursor: null }) }));
    expect(await screen.findByText("2 Employees have no Job Role")).toBeTruthy();
    // The read is sent with no tenant, principal or capability -- an empty input.
    expect(workforce.call.mock.calls.filter((c) => c[0] === "listEmployeesWithoutJobRole")).toEqual([["listEmployeesWithoutJobRole", {}]]);
    const list = screen.getByRole("list", { name: "Employees without a Job Role" });
    expect(within(list).getByRole("link", { name: "Rae Quinn" }).getAttribute("href")).toBe("/administration/users/pg-emp-21");
    expect(within(list).getByRole("link", { name: "Sol Vega" }).getAttribute("href")).toBe("/administration/users/pg-emp-22");
    // #210 (Owner): the workforce roster DOES show each person's Job Role -- from the governed read (listWorkforceRoster), never
    // inferred; the remediation count above remains its own read.
    expect(await screen.findByRole("columnheader", { name: "Job Role" })).toBeTruthy();
  });

  it("one Employee reads in the singular", async () => {
    renderDirectory(makeWorkforce({ withoutJobRole: ok({ count: 1, items: MISSING.slice(0, 1), truncated: false, nextCursor: null }) }));
    expect(await screen.findByText("1 Employee has no Job Role")).toBeTruthy();
  });

  it("the list pages by the read's own cursor", async () => {
    const workforce = renderDirectory(
      makeWorkforce({
        withoutJobRole: (input) =>
          input?.cursor === "jr-cursor"
            ? ok({ count: 2, items: MISSING.slice(1), truncated: false, nextCursor: null })
            : ok({ count: 2, items: MISSING.slice(0, 1), truncated: true, nextCursor: "jr-cursor" }),
      }),
    );
    await screen.findByText("2 Employees have no Job Role");
    fireEvent.click(screen.getByRole("button", { name: "Show more Employees without a Job Role" }));
    expect(await screen.findByRole("link", { name: "Sol Vega" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Rae Quinn" })).toBeTruthy();
    expect(workforce.call).toHaveBeenCalledWith("listEmployeesWithoutJobRole", { cursor: "jr-cursor" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Show more Employees without a Job Role" })).toBeNull());
  });

  it("a zero count renders nothing", async () => {
    renderDirectory();
    await screen.findByText("John Smith");
    await waitFor(() => expect(document.querySelector("[data-job-role-remediation]")).toBeNull());
    expect(screen.queryByText(/have no Job Role|has no Job Role/)).toBeNull();
  });

  it("a refusal is stated, never shown as nobody missing a Job Role", async () => {
    renderDirectory(makeWorkforce({ withoutJobRole: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    expect(await screen.findByText("The count of Employees without a Job Role is not available to you.")).toBeTruthy();
    expect(document.querySelector("[data-job-role-remediation]").getAttribute("data-job-role-remediation")).toBe("FAILED");
    // The directory itself is unaffected.
    expect(await screen.findByText("John Smith")).toBeTruthy();
  });

  it("an outage is stated with Retry, and Retry re-reads", async () => {
    let n = 0;
    const workforce = renderDirectory(
      makeWorkforce({ withoutJobRole: () => (n++ === 0 ? fail("UNREACHABLE") : ok({ count: 1, items: MISSING.slice(0, 1), truncated: false, nextCursor: null })) }),
    );
    expect(await screen.findByText(/The count of Employees without a Job Role could not be loaded from the Workforce service/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("1 Employee has no Job Role")).toBeTruthy();
    expect(workforce.call.mock.calls.filter((c) => c[0] === "listEmployeesWithoutJobRole").length).toBe(2);
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
    expect(seams).toEqual(["../../services/workforceApiClient.js"]);
    const roster = code(read("src/modules/administration/WorkforceRoster.jsx"));
    expect(roster).toMatch(/workforce\.call\("listWorkforceRoster"/);
    expect(roster).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']|useMetadataList|firestore|httpsCallable/i);
  });

  it("the Job Role remediation reads only the Workforce transport it is handed", () => {
    const src = code(read("src/modules/administration/JobRoleRemediation.jsx"));
    expect(src).toMatch(/workforce\.call\(operation/);
    expect(src).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']/);
    expect(src).not.toMatch(/useMetadataList|firestore|httpsCallable/i);
    expect(src).not.toMatch(/tenantId|principalId|capabilit/);
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
