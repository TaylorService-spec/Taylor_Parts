// EMPLOYEE OPERATING PROFILE (Employee design v4.1) on the governed Workforce transport -- the Administration
// Employee record, the self view, and the pure domain underneath both.
//
// The Workforce transport is a mocked client injected through the pages' `workforce` prop; the Administration
// API (credential lookup) through `policyCall`; the session at AuthContext. No Firestore hook is mocked anywhere
// in this file, because neither page has one -- and the static ratchet at the bottom proves it. Fixtures live
// only in this file.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let session = { user: { uid: "uid-dana" }, role: "admin", loading: false };
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => session }));

import UserDetail from "../src/modules/administration/UserDetail.jsx";
import MyEmployeeProfile from "../src/modules/employees/MyEmployeeProfile.jsx";
import {
  ACCOUNTABLE_RECORD_FAMILIES,
  EMPLOYEE_LIFECYCLE_VALUES,
  EMPLOYEE_RUNTIME_DEPENDENCY,
  LIFECYCLE_STANDING,
  MY_PROFILE_STATE,
  OWNED_RECORD_FAMILIES,
  RESPONSIBILITY_AXIS,
  RUNTIME_DEPENDENCIES,
  USER_ACCESS_LINK,
  describeLifecycle,
  describeMyProfileFailure,
  describeResponsibilities,
  describeUserAccessRelationship,
  describeWorkforceFailure,
  explainWhyInFrontOfMe,
} from "../src/domain/employeeOperatingProfile.js";
import { EMPLOYMENT_STATUS_VALUES } from "../src/domain/employeeVocabulary.js";
import {
  JOB_ROLE_STATE,
  assignableJobRoles,
  describeEmployeeJobRole,
  describeJobRoleRemediation,
  jobRoleAssignInput,
} from "../src/domain/employeeJobRole.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ── fixtures (test-only), in the EMP-RT-01 projection shape ──
const rec = (over) => ({
  employmentStatus: "ACTIVE",
  operatingCompanyId: "taylor",
  employeeNumber: null,
  jobTitle: null,
  name: { displayName: over.displayName ?? null, firstName: null, middleName: null, lastName: null, preferredName: null },
  contact: { workEmail: null, workPhone: null, mobilePhone: null },
  address: { street: null, unit: null, city: null, state: null, postalCode: null },
  hireDate: null,
  separationDate: null,
  currentManager: null,
  userAccess: "UNLINKED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const DANA = rec({
  employeeId: "emp-1",
  displayName: "Dana Reyes",
  jobTitle: "Account Executive",
  userAccess: "LINKED",
  currentManager: { managerEmployeeId: "emp-9", displayName: "Morgan Hale", effectiveFrom: "2026-02-01T00:00:00.000Z" },
});
const LEE = rec({ employeeId: "emp-2", displayName: "Lee Park", employmentStatus: "CONTRACTOR" });
const SAM = rec({ employeeId: "emp-3", displayName: "Sam Ortiz", employmentStatus: "TERMINATED", separationDate: "2026-03-31" });
const KIM = rec({ employeeId: "emp-4", displayName: "Kim Wu", employmentStatus: "INACTIVE" });
const PAT = rec({ employeeId: "emp-5", displayName: "Pat Gray", employmentStatus: "RETIRED" });

const LINK = { linkId: "l-1", principalId: "pr-1", principalDisplayName: "Dana Reyes", principalStatus: "active", membershipStatus: "active", linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null };

const ok = (result) => ({ ok: true, result });
const fail = (code, reason = null, status = null) => ({ ok: false, code, reason, status, message: "refused" });

/** A mocked Workforce transport. `overrides[operation]` replaces an answer (a value or a function of input). */
function makeWorkforce(overrides = {}, records = [DANA, LEE, SAM, KIM, PAT]) {
  const byId = Object.fromEntries(records.map((r) => [r.employeeId, r]));
  return {
    call: vi.fn(async (operation, input) => {
      if (operation in overrides) {
        const o = overrides[operation];
        return typeof o === "function" ? o(input) : o;
      }
      switch (operation) {
        case "readEmployee":
          return byId[input.employeeId] ? ok(byId[input.employeeId]) : fail("NOT_FOUND", "EMPLOYEE_NOT_FOUND", 404);
        case "readEmployeePrincipalLink":
          return ok({ employeeId: input.employeeId, userAccess: byId[input.employeeId]?.userAccess, link: byId[input.employeeId]?.userAccess === "LINKED" ? LINK : null });
        case "readMyEmployeeProfile":
          return ok({ employee: DANA, principalLink: { linkId: "l-1", principalId: "pr-1", linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null } });
        case "listEmployeeJobRoleHistory":
          return ok({ employeeId: input.employeeId, current: null, items: [], truncated: false });
        case "listManagedEmployees":
        case "listRecordsOwnedByEmployee":
        case "listAccountabilitiesForEmployee":
          return ok({ items: [], truncated: false, nextCursor: null });
        default:
          return fail("UNKNOWN_OPERATION");
      }
    }),
  };
}

const policyCall = vi.fn(async () => ({ ok: true, data: [{ id: "pr-1", displayName: "Dana Reyes", externalSubject: "uid-dana", identityProvider: "firebase", status: "active" }] }));

const legacyClient = () => ({
  setUserStatus: vi.fn(),
  assignApprovedRole: vi.fn(),
  revokeRole: vi.fn(),
  readPrincipalAccessState: vi.fn().mockResolvedValue({ ok: true, state: { authExists: true, accountStatus: "enabled", assignments: [] } }),
  listRecordChangeHistory: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
});

const renderRecord = (employeeId = "emp-1", workforce = makeWorkforce(), client = legacyClient(), hasCapability = undefined) =>
  render(
    <MemoryRouter initialEntries={[`/administration/users/${employeeId}`]}>
      <Routes>
        <Route path="/administration/users/:employeeId" element={<UserDetail client={client} workforce={workforce} policyCall={policyCall} hasCapability={hasCapability} />} />
      </Routes>
    </MemoryRouter>,
  );

const renderSelf = (workforce = makeWorkforce()) =>
  render(
    <MemoryRouter initialEntries={["/my-profile"]}>
      <Routes>
        <Route path="/my-profile" element={<MyEmployeeProfile workforce={workforce} />} />
      </Routes>
    </MemoryRouter>,
  );

const section = (title) => screen.getByRole("heading", { level: 2, name: title }).closest("section");

let consoleError;
beforeEach(() => {
  session = { user: { uid: "uid-dana" }, role: "admin", loading: false };
  policyCall.mockClear();
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup();
  const crashes = consoleError.mock.calls.filter((args) => !/not wrapped in act/.test(String(args[0])));
  consoleError.mockRestore();
  expect(crashes).toEqual([]);
});

// ════════════════════ THE RECORD READS THE WORKFORCE TRANSPORT ════════════════════

describe("the Administration Employee record reads the governed Workforce transport", () => {
  it("reads EMP-RT-01 readEmployee for the routed Employee and renders its projection", async () => {
    const workforce = makeWorkforce();
    renderRecord("emp-1", workforce);
    expect(await screen.findByRole("heading", { level: 1, name: "Dana Reyes" })).toBeTruthy();
    expect(workforce.call).toHaveBeenCalledWith("readEmployee", { employeeId: "emp-1" });
    expect(screen.getAllByText("Account Executive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Taylor Freezer of Arizona").length).toBeGreaterThan(0);
  });

  it("a transport failure renders a truthful unavailable state with Retry -- no fallback, no empty record", async () => {
    const workforce = makeWorkforce({ readEmployee: fail("UNREACHABLE") });
    renderRecord("emp-1", workforce);
    const failure = await screen.findByText(/could not be loaded from the Workforce service\. Nothing else was used in its place\./);
    expect(failure.closest("[data-workforce-failure]").getAttribute("data-workforce-failure")).toBe("UNAVAILABLE");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(workforce.call.mock.calls.map((c) => c[0])).toEqual(["readEmployee"]);
  });

  it("a refused read (403) says not available to you -- not an outage, not a not-found", async () => {
    renderRecord("emp-1", makeWorkforce({ readEmployee: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    expect(await screen.findByText("This Employee record is not available to you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("not configured is its own state", async () => {
    renderRecord("emp-1", makeWorkforce({ readEmployee: fail("NOT_CONFIGURED") }));
    expect(await screen.findByText(/Workforce service is not configured/)).toBeTruthy();
  });
});

// ════════════════════ EMPLOYEE != USER ACCESS ════════════════════

describe("Employee and User Access are separate", () => {
  it("the business context and User Access are different sections", async () => {
    renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const business = section("Employment & business context");
    const access = section("User Access");
    expect(within(business).queryByText(/User Access/)).toBeNull();
    expect(within(business).queryByText(/Security Role/)).toBeNull();
    expect(access.querySelector("[data-employee-lifecycle]")).toBeNull();
    expect(within(access).getByText("User Access linked")).toBeTruthy();
  });

  it("linked: EMP-RT-02 details the governed Principal link, and the credential comes from the Principal", async () => {
    const workforce = makeWorkforce();
    const client = legacyClient();
    renderRecord("emp-1", workforce, client, () => true);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(document.querySelector('[data-employee-principal="LINKED"]')).toBeTruthy());
    expect(workforce.call).toHaveBeenCalledWith("readEmployeePrincipalLink", { employeeId: "emp-1" });
    await waitFor(() => expect(client.readPrincipalAccessState).toHaveBeenCalledWith({ principalUid: "uid-dana" }));
    expect(policyCall).toHaveBeenCalledWith("listTenantPrincipals", {});
  });

  it("unlinked: No User Access, no EMP-RT-02 read, no account actions -- and the Employee fully exists", async () => {
    const workforce = makeWorkforce();
    const client = legacyClient();
    renderRecord("emp-2", workforce, client);
    await screen.findByRole("heading", { level: 1, name: "Lee Park" });
    expect(document.querySelector("[data-user-access-link]").getAttribute("data-user-access-link")).toBe(USER_ACCESS_LINK.NOT_LINKED);
    expect(workforce.call.mock.calls.some((c) => c[0] === "readEmployeePrincipalLink")).toBe(false);
    expect(document.querySelector('[data-account-actions="UNAVAILABLE"]').textContent).toMatch(/no account to manage/);
    expect(client.readPrincipalAccessState).not.toHaveBeenCalled();
    expect(screen.getAllByText("Contractor").length).toBeGreaterThan(0);
  });

  it("a 403 on the Principal link renders 'not available to you' and offers no account actions", async () => {
    const client = legacyClient();
    renderRecord("emp-1", makeWorkforce({ readEmployeePrincipalLink: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }), client);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(document.querySelector('[data-employee-principal="NOT_AVAILABLE_TO_YOU"]')).toBeTruthy());
    expect(screen.getAllByText(/The Principal link is not available to you\./).length).toBeGreaterThan(0);
    expect(policyCall).not.toHaveBeenCalled();
    expect(client.readPrincipalAccessState).not.toHaveBeenCalled();
  });

  it("domain: EMP-RT-01 userAccess maps to three distinct states and carries no id", () => {
    expect(describeUserAccessRelationship("LINKED").state).toBe(USER_ACCESS_LINK.LINKED);
    expect(describeUserAccessRelationship("UNLINKED").state).toBe(USER_ACCESS_LINK.NOT_LINKED);
    expect(describeUserAccessRelationship(undefined).state).toBe(USER_ACCESS_LINK.UNKNOWN);
  });
});

// ════════════════════ OWNER != ACCOUNTABLE != ASSIGNED ════════════════════

describe("Record Owner, Accountable Person and Assigned Person stay separate", () => {
  it("owned = EMP-RT-03 per family, accountable = EMP-RT-04 per Commercial family, assigned = EMP-RT-05 unavailable", async () => {
    const workforce = makeWorkforce({
      listRecordsOwnedByEmployee: (i) => ok({ items: i.family === "ACCOUNT" ? [{ family: "ACCOUNT", recordId: "acc-x", recordNumber: "C-1001", name: "Canyon Foods", state: "ACTIVE", accountId: "acc-x", operatingCompanyId: null, updatedAt: "x" }] : [], truncated: false }),
      listAccountabilitiesForEmployee: (i) => (i.family === "SALES_ORDER" ? fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) : ok({ items: i.family === "OPPORTUNITY" ? [{ family: "OPPORTUNITY", recordId: "op-x", recordNumber: "OPP-0042", name: null, state: "QUALIFY", accountId: "a", operatingCompanyId: "taylor", updatedAt: "x", currentAccountability: null }] : [], truncated: true })),
    });
    renderRecord("emp-1", workforce);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const axes = () => [...document.querySelectorAll("[data-responsibility-axis]")];
    await waitFor(() => expect(axes()[1].querySelector('[data-record-family="OPPORTUNITY"][data-family-state="RECORDS"]')).toBeTruthy());
    expect(axes().map((a) => a.getAttribute("data-responsibility-axis"))).toEqual(["OWNER", "ACCOUNTABLE", "ASSIGNED"]);
    expect(axes().map((a) => a.querySelector(".ns-emp-axis__label").textContent)).toEqual(["Record Owner", "Accountable Person", "Assigned Person"]);

    const [owner, accountable, assigned] = axes();
    await waitFor(() => expect(owner.querySelector('[data-record-family="ACCOUNT"][data-family-state="RECORDS"]')).toBeTruthy());
    expect(owner.querySelector("[data-responsibility-read]").getAttribute("data-responsibility-read")).toBe("EMP-RT-03");
    expect(within(owner).getByText("C-1001")).toBeTruthy();
    expect(within(owner).queryByText("OPP-0042")).toBeNull();
    expect(accountable.querySelector("[data-responsibility-read]").getAttribute("data-responsibility-read")).toBe("EMP-RT-04");
    expect(within(accountable).getByText("OPP-0042")).toBeTruthy();
    expect(within(accountable).queryByText("C-1001")).toBeNull();
    // One family refused never hides another family.
    expect(accountable.querySelector('[data-record-family="SALES_ORDER"]').getAttribute("data-family-state")).toBe("NOT_AVAILABLE_TO_YOU");
    expect(within(accountable).getAllByText("More records exist than are shown here.").length).toBeGreaterThan(0);
    // Assigned work is never read, never invented.
    expect(assigned.querySelector('[data-runtime-dependency="EMP-RT-05"]')).toBeTruthy();
    expect(assigned.querySelector("[data-responsibility-read]")).toBeNull();

    const calls = workforce.call.mock.calls;
    expect(calls.filter((c) => c[0] === "listRecordsOwnedByEmployee").map((c) => c[1].family).sort()).toEqual([...OWNED_RECORD_FAMILIES].sort());
    expect(calls.filter((c) => c[0] === "listAccountabilitiesForEmployee").map((c) => c[1].family).sort()).toEqual([...ACCOUNTABLE_RECORD_FAMILIES].sort());
    expect(calls.some((c) => /Assigned/i.test(c[0]))).toBe(false);
    // Never the record id (DECISIONS #106).
    expect(screen.queryByText("acc-x")).toBeNull();
  });

  it("the self view asks the same three questions in the first person, with 'Why is this in front of me?'", async () => {
    renderSelf();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    for (const heading of ["Records I own", "Outcomes I'm accountable for", "My assigned work"]) {
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText("Why is this in front of me?").length).toBe(3);
  });

  it("domain: axes, reads and dependency are fixed and distinct", () => {
    const axes = describeResponsibilities("admin");
    expect(axes.map((a) => [a.axis, a.read?.id ?? a.dependency.id])).toEqual([
      ["OWNER", "EMP-RT-03"],
      ["ACCOUNTABLE", "EMP-RT-04"],
      ["ASSIGNED", "EMP-RT-05"],
    ]);
    expect(axes[2].available).toBe(false);
    expect(RUNTIME_DEPENDENCIES.ASSIGNED_WORK_READ.serverReason).toBe("ASSIGNMENT_AUTHORITY_NOT_IN_POSTGRES");
    expect(explainWhyInFrontOfMe(["ASSIGNED", "OWNER", "BOGUS"]).map((r) => r.label)).toEqual(["Record Owner", "Assigned Person"]);
    expect(new Set(explainWhyInFrontOfMe(Object.values(RESPONSIBILITY_AXIS)).map((r) => r.reason)).size).toBe(3);
  });
});

// ════════════════════ LIFECYCLE ════════════════════

describe("the Employee lifecycle is exactly six statuses, each displayable and resolvable", () => {
  it("domain: the table mirrors the governed vocabulary", () => {
    expect(EMPLOYEE_LIFECYCLE_VALUES).toEqual(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);
    expect(EMPLOYEE_LIFECYCLE_VALUES).toEqual([...EMPLOYMENT_STATUS_VALUES]);
    expect(new Set(EMPLOYEE_LIFECYCLE_VALUES.map((v) => describeLifecycle(v).meaning)).size).toBe(6);
    expect(describeLifecycle("INACTIVE").standing).not.toBe(describeLifecycle("TERMINATED").standing);
    expect(describeLifecycle("SUSPENDED")).toMatchObject({ words: "SUSPENDED", standing: LIFECYCLE_STANDING.UNRECOGNISED });
  });

  for (const status of ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
    it(`renders ${status} from the governed read with its word and meaning`, async () => {
      renderRecord("emp-x", makeWorkforce({}, [rec({ employeeId: "emp-x", displayName: "Status Probe", employmentStatus: status })]));
      await screen.findByRole("heading", { level: 1, name: "Status Probe" });
      const row = document.querySelector("[data-employee-lifecycle]");
      expect(row.getAttribute("data-employee-lifecycle")).toBe(status);
      expect(within(row).getByText(describeLifecycle(status).words)).toBeTruthy();
      expect(within(row).getByText(describeLifecycle(status).meaning)).toBeTruthy();
    });
  }

  for (const [id, name, word] of [["emp-3", "Sam Ortiz", "Terminated"], ["emp-4", "Kim Wu", "Inactive"], ["emp-5", "Pat Gray", "Retired"]]) {
    it(`${word}: the record opens, names the person and keeps its sections and history`, async () => {
      renderRecord(id);
      expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
      expect(screen.getByRole("heading", { name: "Change History" })).toBeTruthy();
    });
  }
});

// ════════════════════ JOB ROLE ════════════════════

// EMP-RT-08 listEmployeeJobRoleHistory projections, test-only.
const jrItem = (over) => ({ assignmentId: "a-1", jobRoleId: "retail-sales", displayName: "Retail Sales", jobRoleStatus: "ACTIVE", current: false, effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null, reason: null, ...over });
const NATIONAL_CURRENT = jrItem({ assignmentId: "a-2", jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", current: true, effectiveFrom: "2026-06-01T00:00:00.000Z", reason: "Moved to national accounts" });
const RETAIL_ENDED = jrItem({ effectiveFrom: "2026-01-15T00:00:00.000Z", effectiveTo: "2026-06-01T00:00:00.000Z" });
const HISTORY = ok({ employeeId: "emp-1", current: NATIONAL_CURRENT, items: [NATIONAL_CURRENT, RETAIL_ENDED], truncated: false });

describe("Job Role is the governed EMP-RT-08 read, business function only, never inferred", () => {
  it("renders the current Job Role and its history, newest first, with dates and reason", async () => {
    const workforce = makeWorkforce({ listEmployeeJobRoleHistory: HISTORY });
    renderRecord("emp-1", workforce);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const jobRole = section("Job Role");
    await waitFor(() => expect(jobRole.querySelector('[data-employee-job-role="ASSIGNED"]')).toBeTruthy());
    expect(workforce.call).toHaveBeenCalledWith("listEmployeeJobRoleHistory", { employeeId: "emp-1" });
    const current = jobRole.querySelector("[data-employee-job-role]");
    expect(current.textContent).toMatch(/National Accounts Sales/);
    expect(current.textContent).toMatch(/since 2026-06-01/);
    const rows = within(within(jobRole).getByRole("list", { name: "Job Role history, newest first" })).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-job-role-assignment"))).toEqual(["CURRENT", "ENDED"]);
    expect(rows[0].textContent).toMatch(/National Accounts Sales.*From 2026-06-01 · current.*Reason: Moved to national accounts/);
    expect(rows[1].textContent).toMatch(/Retail Sales.*2026-01-15 to 2026-06-01/);
    // The caption: business function, and no access change.
    expect(within(jobRole).getByText(/describes the Employee's business function\. It does not change access/)).toBeTruthy();
  });

  it("no Job Role is stated honestly -- a sales title and a salesperson Security Role infer nothing", async () => {
    session = { user: { uid: "uid-dana" }, role: "salesperson", loading: false };
    renderRecord("emp-1");
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const jobRole = section("Job Role");
    await waitFor(() => expect(jobRole.querySelector(`[data-employee-job-role="${JOB_ROLE_STATE.NONE}"]`)).toBeTruthy());
    expect(within(jobRole).getByText("No Job Role assigned")).toBeTruthy();
    expect(within(jobRole).getByText("No Job Role has been recorded for this Employee.")).toBeTruthy();
    expect(jobRole.textContent).not.toMatch(/Account Executive|salesperson|Salesperson/);
    // EMP-RT-08 is served: no runtime-dependency placeholder remains.
    expect(jobRole.querySelector("[data-runtime-dependency]")).toBeNull();
  });

  it("an inactive current Job Role is labelled inactive", async () => {
    const inactive = jrItem({ current: true, jobRoleStatus: "INACTIVE", displayName: "Retail Sales" });
    renderRecord("emp-1", makeWorkforce({ listEmployeeJobRoleHistory: ok({ employeeId: "emp-1", current: inactive, items: [inactive], truncated: false }) }));
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const jobRole = section("Job Role");
    await waitFor(() => expect(within(jobRole).getByText("Inactive Job Role")).toBeTruthy());
    expect(within(jobRole).getByText(/inactive in the catalog/)).toBeTruthy();
    expect(within(jobRole).getByText(/Retail Sales \(inactive\)/)).toBeTruthy();
  });

  it("refused, failed and loading are distinct states -- never 'No Job Role assigned'", async () => {
    renderRecord("emp-1", makeWorkforce({ listEmployeeJobRoleHistory: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(within(section("Job Role")).getByText("This Employee's Job Role is not available to you.")).toBeTruthy());
    expect(within(section("Job Role")).queryByText("No Job Role assigned")).toBeNull();
    expect(within(section("Job Role")).queryByRole("button", { name: "Retry" })).toBeNull();
    cleanup();

    let n = 0;
    const workforce = makeWorkforce({ listEmployeeJobRoleHistory: () => (n++ === 0 ? fail("UNREACHABLE") : HISTORY) });
    renderRecord("emp-1", workforce);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(section("Job Role").querySelector('[data-employee-job-role="UNAVAILABLE"]')).toBeTruthy());
    expect(within(section("Job Role")).getByText(/could not be loaded from the Workforce service/)).toBeTruthy();
    const retries = within(section("Job Role")).getAllByRole("button", { name: "Retry" });
    retries[0].click();
    await waitFor(() => expect(section("Job Role").querySelector('[data-employee-job-role="ASSIGNED"]')).toBeTruthy());
    cleanup();

    renderRecord("emp-1", makeWorkforce({ listEmployeeJobRoleHistory: () => new Promise(() => {}) }));
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    expect(within(section("Job Role")).getByText("Reading the Job Role…")).toBeTruthy();
  });

  it("Job Role is its own section: nothing about it appears inside User Access or the employment facts", async () => {
    renderRecord("emp-1", makeWorkforce({ listEmployeeJobRoleHistory: HISTORY }), legacyClient(), () => true);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(section("Job Role").querySelector('[data-employee-job-role="ASSIGNED"]')).toBeTruthy());
    for (const other of ["User Access", "Employment & business context", "Responsibility"]) {
      const s = section(other);
      expect(s.querySelector("[data-job-role-section], [data-job-role-control], [data-employee-job-role]"), other).toBeNull();
      expect(s.textContent, other).not.toMatch(/National Accounts Sales|Assign Job Role|Change Job Role/);
    }
    expect(within(section("Job Role")).queryByText(/Security Role:|Add Role|Remove Role/)).toBeNull();
  });

  it("the self view shows no Job Role section and makes no Job Role read (no governed self read exists)", async () => {
    const workforce = makeWorkforce({ listEmployeeJobRoleHistory: HISTORY });
    renderSelf(workforce);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    expect(screen.queryByRole("heading", { level: 2, name: "Job Role" })).toBeNull();
    expect(document.querySelector("[data-job-role-section], [data-employee-job-role]")).toBeNull();
    expect(workforce.call.mock.calls.some(([operation]) => /JobRole/.test(operation))).toBe(false);
  });

  it("domain: words come only from the read; inactive roles are never assignable; the command input is closed", () => {
    expect(describeEmployeeJobRole({ current: null, items: [], truncated: false })).toMatchObject({ state: "NONE", words: "No Job Role assigned" });
    expect(describeEmployeeJobRole(HISTORY.result)).toMatchObject({ state: "ASSIGNED", words: "National Accounts Sales" });
    expect(
      assignableJobRoles({
        items: [
          { jobRoleId: "retail-sales", displayName: "Retail Sales", status: "ACTIVE" },
          { jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", status: "ACTIVE" },
          { jobRoleId: "old-role", displayName: "Old Role", status: "INACTIVE" },
        ],
      }).map((o) => o.value),
    ).toEqual(["national-accounts-sales", "retail-sales"]);
    expect(jobRoleAssignInput({ employeeId: "e", jobRoleId: "r", reason: "  " })).toEqual({ employeeId: "e", jobRoleId: "r" });
    expect(jobRoleAssignInput({ employeeId: "e", jobRoleId: "r", reason: " why " })).toEqual({ employeeId: "e", jobRoleId: "r", reason: "why" });
    expect(describeJobRoleRemediation({ count: 0 })).toBeNull();
    expect(describeJobRoleRemediation({ count: 3 }).words).toBe("3 Employees have no Job Role");
    expect(read("src/domain/employeeJobRole.js")).not.toMatch(/["']SALES["']/);
  });
});

// ════════════════════ MANAGER / REPORTING ════════════════════

describe("manager and managed employees come from the governed reporting relationship", () => {
  it("the manager is the currentManager of the Employee read, linked, with its effective date", async () => {
    renderRecord("emp-1");
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const link = screen.getByRole("link", { name: "Morgan Hale" });
    expect(link.getAttribute("href")).toBe("/administration/users/emp-9");
    expect(screen.getByText(/reporting since 2026-02-01/)).toBeTruthy();
  });

  it("managed employees are EMP-RT-06, and a refusal is not available to you", async () => {
    const workforce = makeWorkforce({
      listManagedEmployees: ok({ managerEmployeeId: "emp-1", items: [{ employeeId: "emp-2", displayName: "Lee Park", employmentStatus: "CONTRACTOR", employeeNumber: null, operatingCompanyId: "taylor", jobTitle: null, reportingSince: "2026-01-01" }], truncated: false }),
    });
    renderRecord("emp-1", workforce);
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const managed = section("Managed employees");
    await waitFor(() => expect(within(managed).getByRole("link", { name: "Lee Park" })).toBeTruthy());
    expect(workforce.call).toHaveBeenCalledWith("listManagedEmployees", { managerEmployeeId: "emp-1" });

    cleanup();
    renderSelf(makeWorkforce({ listManagedEmployees: fail("FORBIDDEN", "CAPABILITY_REQUIRED", 403) }));
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    await waitFor(() => expect(screen.getByText("Managed employees is not available to you.")).toBeTruthy());
  });
});

// ════════════════════ SELF VIEW ════════════════════

describe("the self view uses readMyEmployeeProfile only", () => {
  it("reads EMP-RT-07 with no input and renders the governed Employee", async () => {
    const workforce = makeWorkforce();
    renderSelf(workforce);
    expect(await screen.findByRole("heading", { level: 1, name: "Dana Reyes" })).toBeTruthy();
    expect(workforce.call.mock.calls[0]).toEqual(["readMyEmployeeProfile", undefined]);
    expect(workforce.call.mock.calls.some((c) => c[0] === "readEmployee")).toBe(false);
    expect(screen.getByText("Morgan Hale")).toBeTruthy(); // plain words, not an Administration link
    expect(screen.queryByRole("link", { name: "Morgan Hale" })).toBeNull();
    expect(document.querySelector("[data-self-security-role]").textContent).toMatch(/It is not your Job Role/);
  });

  for (const [error, state] of [
    [fail("NOT_FOUND", "EMPLOYEE_PRINCIPAL_LINK_NOT_FOUND", 404), MY_PROFILE_STATE.NOT_LINKED],
    [fail("CONFLICT", "EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS", 409), MY_PROFILE_STATE.LINK_AMBIGUOUS],
    [fail("PRECONDITION_FAILED", "EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED", 412), MY_PROFILE_STATE.LINK_UNRESOLVED],
    [fail("FORBIDDEN", null, 403), MY_PROFILE_STATE.NOT_A_MEMBER],
    [fail("UNREACHABLE"), MY_PROFILE_STATE.UNAVAILABLE],
    [fail("NOT_CONFIGURED"), MY_PROFILE_STATE.NOT_CONFIGURED],
  ]) {
    it(`${state}: its own words, no Employee facts, no responsibility reads, no fallback`, async () => {
      const workforce = makeWorkforce({ readMyEmployeeProfile: error });
      renderSelf(workforce);
      await waitFor(() => expect(document.querySelector("[data-self-identity]")?.getAttribute("data-self-identity")).toBe(state));
      expect(screen.getByText(describeMyProfileFailure(error).words)).toBeTruthy();
      expect(document.querySelector("[data-employee-lifecycle]")).toBeNull();
      expect(document.querySelector('[data-responsibility-state="NOT_APPLICABLE"]')).toBeTruthy();
      expect(workforce.call.mock.calls.map((c) => c[0])).toEqual(["readMyEmployeeProfile"]);
      expect(Boolean(screen.queryByRole("button", { name: "Retry" }))).toBe(state === MY_PROFILE_STATE.UNAVAILABLE);
    });
  }
});

// ════════════════════ FAILURE WORDS ════════════════════

describe("domain: failures in words", () => {
  it("403 is not available to you, 404 not found, outages unavailable and retryable", () => {
    expect(describeWorkforceFailure({ code: "FORBIDDEN" }, "X")).toMatchObject({ kind: "NOT_AVAILABLE_TO_YOU", retryable: false });
    expect(describeWorkforceFailure({ code: "NOT_FOUND" }, "X")).toMatchObject({ kind: "NOT_FOUND", retryable: false });
    expect(describeWorkforceFailure({ code: "INTERNAL" }, "X")).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(describeWorkforceFailure({ code: "UNREACHABLE" }, "X")).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
  });

  it("every remaining runtime dependency names the governed API it needs", () => {
    for (const dep of Object.values(RUNTIME_DEPENDENCIES)) {
      expect(dep.kind).toBe(EMPLOYEE_RUNTIME_DEPENDENCY);
      expect(dep.requiredApi).toMatch(/Governed/);
    }
    expect(Object.values(RUNTIME_DEPENDENCIES).map((d) => d.id).sort()).toEqual(["EMP-RT-05", "EMP-RT-H1", "EMP-RT-W2"]);
    // EMP-RT-08 (Job Role) is served now; nothing may still claim it is missing.
    expect(Object.values(RUNTIME_DEPENDENCIES).some((d) => d.id === "EMP-RT-08" || /Job Role/.test(`${d.fact} ${d.today} ${d.serverReason}`))).toBe(false);
    // EMP-RT-W1 (the profile writer) is served now; nothing may still claim it is missing.
    expect(Object.values(RUNTIME_DEPENDENCIES).some((d) => d.id === "EMP-RT-W1" || /profile writer is served|PROFILE_WRITER/.test(`${d.today} ${d.serverReason}`))).toBe(false);
  });
});

// ════════════════════ ACCESSIBILITY ════════════════════

describe("accessibility labels", () => {
  it("the rail, the axis list and every axis are labelled; every disclosure has a summary", async () => {
    renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    expect(screen.getByRole("complementary", { name: "Responsibility and source" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Responsibility relationships" });
    for (const item of [...list.children]) {
      expect(document.getElementById(item.getAttribute("aria-labelledby"))?.tagName).toBe("H3");
    }
    for (const details of document.querySelectorAll("details.ns-emp-disclosure")) {
      expect(details.querySelector("summary")?.textContent.trim().length).toBeGreaterThan(0);
    }
    expect(document.querySelector("[data-employee-lifecycle] .fo-status-pill").textContent).toMatch(/Active/);
  });
});

// ════════════════════ STATIC RATCHETS ════════════════════

const EMPLOYEE_PAGE_MODULES = [
  "src/domain/employeeOperatingProfile.js",
  "src/modules/employees/EmployeeProfileSections.jsx",
  "src/modules/employees/MyEmployeeProfile.jsx",
  "src/modules/administration/UserDetail.jsx",
  "src/modules/administration/EmployeeEditPanel.jsx",
  "src/domain/employeeJobRole.js",
  "src/modules/administration/EmployeeJobRoleControl.jsx",
  "src/modules/administration/JobRoleRemediation.jsx",
  "src/hooks/useWorkforceRead.js",
  "src/hooks/useWorkforceEmployeeDirectory.js",
  "src/hooks/usePrincipalCredential.js",
  "src/services/workforceApiClient.js",
];

describe("Employee business data no longer depends on Firestore", () => {
  for (const rel of EMPLOYEE_PAGE_MODULES) {
    it(`${rel}: no Firebase import, no Firestore read, no employee directory hook, no demo data`, () => {
      const src = code(read(rel));
      expect(src).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']/);
      expect(src).not.toMatch(/from\s+["'][^"']*firebase\/firebase(\.js)?["']/);
      expect(src).not.toMatch(/\b(collection|onSnapshot|getDoc|getDocs|doc|query|httpsCallable)\s*\(/);
      expect(src).not.toMatch(/useEmployeeDirectory|useAssignableEmployees|domain\/employees(\.js)?["']|employeeSession/);
      expect(src).not.toMatch(/from\s+["'][./]*\/?(data|fixtures)\//);
      expect(src).not.toMatch(/\b(mock|demo|sample|coming soon)\b/i);
    });
  }

  it("the record page's data seams are exactly: Workforce, the Principal credential lookup, and the legacy User Access callables", () => {
    const src = code(read("src/modules/administration/UserDetail.jsx"));
    const seams = [...src.matchAll(/from\s+["']([^"']*(hooks|access|services)\/[^"']*)["']/g)].map((m) => m[1]).sort();
    expect(seams).toEqual([
      "../../access/administrationUsersClient",
      "../../hooks/usePrincipalCredential.js",
      "../../hooks/useWorkforceRead.js",
      "../../services/adminPolicyApiClient.js",
      "../../services/workforceApiClient.js",
    ]);
    // The legacy callables it may still use are User Access / history only -- never the profile writer.
    expect(src).not.toMatch(/updateEmployeeProfile\s*\(/);
    expect(src).not.toMatch(/UserEditPanel/);
    expect(src).not.toMatch(/managerEmployeeId\s*\?/);
  });

  it("the editor's only seams are the governed Workforce directory hook and the pure domain -- no legacy callable", () => {
    const src = code(read("src/modules/administration/EmployeeEditPanel.jsx"));
    const seams = [...src.matchAll(/from\s+["']([^"']*(hooks|access|services|auth)\/[^"']*)["']/g)].map((m) => m[1]).sort();
    expect(seams).toEqual(["../../hooks/useWorkforceEmployeeDirectory.js"]);
    expect(src).not.toMatch(/administrationUsersClient|client\.updateEmployeeProfile|idempotencyKey/);
    expect(src).not.toMatch(/employmentStatus"|operatingCompanyId"|operationalRoles/);
    // The retired Firestore-shaped editor is gone, and the seam no longer exports the retired writer.
    expect(existsSync(path.resolve(process.cwd(), "src/modules/administration/UserEditPanel.jsx"))).toBe(false);
    expect(code(read("src/access/administrationUsersClient.js"))).not.toMatch(/updateEmployeeProfile/);
  });

  it("the self view's seams are the Workforce transport and the session (for sign-in and Security Role only)", () => {
    const src = code(read("src/modules/employees/MyEmployeeProfile.jsx"));
    const seams = [...src.matchAll(/from\s+["']([^"']*(hooks|access|services|auth)\/[^"']*)["']/g)].map((m) => m[1]).sort();
    expect(seams).toEqual(["../../auth/AuthContext", "../../hooks/useWorkforceRead.js", "../../services/workforceApiClient.js"]);
    expect(src).toMatch(/const \{ user, role \} = useAuth\(\)/);
    expect(src).not.toMatch(/employeeId\b[^:]*=\s*[^;]*useAuth|session\.employeeId|displayName\s*\}\s*=\s*useAuth/);
  });
});

// ════════════════════ RESPONSIVE / TOUCH CSS CONTRACT ════════════════════

describe("mobile layout contract (index.css)", () => {
  const css = read("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
    return m ? m[2] : "";
  };

  it("facts stack to one column; labels, family names and record titles wrap rather than clip", () => {
    expect(rule(".ns-emp-facts")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    for (const sel of [".ns-emp-axis__label", ".ns-emp-axis__heading", ".ns-emp-family__label", ".ns-emp-record__title"]) {
      expect(rule(sel), sel).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule(sel), sel).not.toMatch(/white-space:\s*nowrap|text-overflow:\s*ellipsis/);
    }
  });

  it("disclosures, person links and the rail profile link meet the 44px touch floor by default", () => {
    expect(rule(".ns-emp-disclosure > summary")).toMatch(/min-height:\s*44px/);
    expect(rule(".ns-emp-link")).toMatch(/min-height:\s*44px/);
    expect(rule(".fo-rail-identity__profile")).toMatch(/min-height:\s*44px/);
  });

  it("no new palette: the profile rules use tokens, not literal colours", () => {
    const block = css.slice(css.indexOf(".ns-emp-facts"), css.indexOf(".fo-user-actions {"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("routes", () => {
  it("App mounts /my-profile beside the unchanged Administration record route; the rail links to it", () => {
    const app = read("src/App.jsx");
    expect(app).toMatch(/<Route path="\/my-profile" element=\{<MyEmployeeProfile \/>\} \/>/);
    expect(app).toMatch(/path="users\/:employeeId"/);
    expect(read("src/navigation/AppRail.jsx")).toMatch(/<NavLink to="\/my-profile" className="fo-rail-identity__profile">/);
  });
});
