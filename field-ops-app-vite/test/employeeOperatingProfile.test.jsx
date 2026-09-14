// EMPLOYEE OPERATING PROFILE (Employee design v4.1) -- the Administration Employee record, the self
// view, and the pure domain underneath both.
//
// Rendered through the real components. The Firestore directory read is mocked at the HOOK boundary
// and the session at AuthContext -- the same technique administrationUsersSurfaces.test.jsx uses --
// so nothing here reaches Firebase or the network. Fixtures live only in this file.
//
// What is proved, one describe each:
//   * Employee and User Access are separate sections, with linked and unlinked states
//   * Record Owner / Accountable Person / Assigned Person are three separate axes, never merged
//   * the six-value lifecycle renders as six distinct words and meanings
//   * Inactive / Terminated / Retired Employees stay resolvable and displayable
//   * Job Role is NOT GOVERNED -- never inferred from Security Role, eligibility or job title, and
//     Retail Sales and National Accounts Sales are never one generic Sales role
//   * the self view renders linked, unlinked and unresolved sessions without a new read
//   * static ratchet: no Firebase import, no collection() read, no demo data in the new files
//   * mobile/touch CSS contract, accessibility labels, and the route/rail wiring
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

let directory = { byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null };
let session = { user: { uid: "actor-1" }, role: "admin", loading: false };

vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => directory,
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => session,
}));

import UserDetail from "../src/modules/administration/UserDetail.jsx";
import MyEmployeeProfile from "../src/modules/employees/MyEmployeeProfile.jsx";
import {
  EMPLOYEE_LIFECYCLE,
  EMPLOYEE_LIFECYCLE_VALUES,
  EMPLOYEE_RUNTIME_DEPENDENCY,
  JOB_ROLE_STATE,
  LIFECYCLE_STANDING,
  RESPONSIBILITY_AXIS,
  RUNTIME_DEPENDENCIES,
  USER_ACCESS_LINK,
  describeJobRole,
  describeLifecycle,
  describeResponsibilities,
  describeSelf,
  describeUserAccessRelationship,
  explainWhyInFrontOfMe,
} from "../src/domain/employeeOperatingProfile.js";
import { EMPLOYMENT_STATUS_VALUES } from "../src/domain/employeeVocabulary.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ── fixtures (test-only) ──
const LINKED = {
  id: "emp-1",
  displayName: "Dana Reyes",
  employmentStatus: "ACTIVE",
  operationalRoles: ["SALES_ASSOCIATE"],
  securityRole: "salesperson",
  userId: "uid-dana",
  jobTitle: "Account Executive",
  operatingCompanyId: "taylor",
};
const UNLINKED = { id: "emp-2", displayName: "Lee Park", employmentStatus: "CONTRACTOR" };
const TERMINATED = { id: "emp-3", displayName: "Sam Ortiz", employmentStatus: "TERMINATED", managerEmployeeId: "emp-1", separationDate: "2026-03-31" };
const INACTIVE = { id: "emp-4", displayName: "Kim Wu", employmentStatus: "INACTIVE" };
const RETIRED = { id: "emp-5", displayName: "Pat Gray", employmentStatus: "RETIRED" };

function seed(records = [LINKED, UNLINKED, TERMINATED, INACTIVE, RETIRED]) {
  directory = {
    byUserId: new Map(records.filter((r) => r.userId).map((r) => [r.userId, r])),
    byEmployeeId: new Map(records.map((r) => [r.id, r])),
    loading: false,
    error: null,
  };
}

const client = () => ({
  updateEmployeeProfile: vi.fn(),
  setUserStatus: vi.fn(),
  assignApprovedRole: vi.fn(),
  revokeRole: vi.fn(),
  readPrincipalAccessState: vi.fn().mockResolvedValue({ ok: true, state: { authExists: true, accountStatus: "enabled", assignments: [] } }),
  listRecordChangeHistory: vi.fn().mockResolvedValue({ ok: true, rows: [] }),
});

const renderRecord = (employeeId = "emp-1") =>
  render(
    <MemoryRouter initialEntries={[`/administration/users/${employeeId}`]}>
      <Routes>
        <Route path="/administration/users/:employeeId" element={<UserDetail client={client()} />} />
      </Routes>
    </MemoryRouter>,
  );

const renderSelf = () =>
  render(
    <MemoryRouter initialEntries={["/my-profile"]}>
      <Routes>
        <Route path="/my-profile" element={<MyEmployeeProfile />} />
      </Routes>
    </MemoryRouter>,
  );

const section = (title) => screen.getByRole("heading", { level: 2, name: title }).closest("section");

let consoleError;
beforeEach(() => {
  seed();
  session = { user: { uid: "actor-1" }, role: "admin", loading: false };
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  cleanup();
  // No console crash: a React render error or a failed prop type lands here.
  const crashes = consoleError.mock.calls.filter((args) => !/not wrapped in act/.test(String(args[0])));
  consoleError.mockRestore();
  expect(crashes).toEqual([]);
});

// ════════════════════ EMPLOYEE != USER ACCESS ════════════════════

describe("Employee and User Access are separate", () => {
  it("renders the Employee business context and User Access as different sections", async () => {
    renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const business = section("Employment & business context");
    const access = section("User Access");
    expect(business).not.toBe(access);
    // The Employee section never carries access facts...
    expect(within(business).queryByText(/User Access/)).toBeNull();
    expect(within(business).queryByText(/Security Role|compatibility role/i)).toBeNull();
    // ...and the access section never carries Employee status.
    expect(access.querySelector("[data-employee-lifecycle]")).toBeNull();
    expect(within(access).getByText("User Access linked")).toBeTruthy();
  });

  it("linked state: User Access linked, the Principal stated as not yet readable -- never inferred", async () => {
    renderRecord("emp-1");
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    expect(document.querySelector("[data-user-access-link]").getAttribute("data-user-access-link")).toBe("LINKED");
    const principal = document.querySelector("[data-employee-principal]");
    expect(principal.getAttribute("data-employee-principal")).toBe("UNAVAILABLE");
    expect(principal.querySelector('[data-runtime-dependency="EMP-RT-02"]')).toBeTruthy();
    // The account pointer is never shown as if it were the Principal.
    expect(screen.queryByText("uid-dana")).toBeNull();
  });

  it("unlinked state: No User Access, stated as legitimate, and the Employee still fully exists", async () => {
    renderRecord("emp-2");
    await screen.findByRole("heading", { level: 1, name: "Lee Park" });
    expect(document.querySelector("[data-user-access-link]").getAttribute("data-user-access-link")).toBe("NOT_LINKED");
    expect(screen.getAllByText("No User Access").length).toBeGreaterThan(0);
    expect(screen.getByText(/legitimate state/)).toBeTruthy();
    expect(screen.getAllByText("Contractor").length).toBeGreaterThan(0);
  });

  it("Edit Employee edits the business record only -- no access control inside the form", async () => {
    render(
      <MemoryRouter initialEntries={["/administration/users/emp-1?edit=1"]}>
        <Routes>
          <Route path="/administration/users/:employeeId" element={<UserDetail client={client()} />} />
        </Routes>
      </MemoryRouter>,
    );
    const form = (await screen.findByRole("button", { name: "Save" })).closest("form");
    expect(within(form).queryByText(/User Access/)).toBeNull();
    expect(within(form).queryByRole("button", { name: /Enable Account|Disable Account|Add Role/ })).toBeNull();
    expect(within(form).queryByLabelText(/Security Role|Job Role/)).toBeNull();
  });

  it("domain: linkage is a pure function of the pointer and never names a Principal", () => {
    expect(describeUserAccessRelationship({ userId: "x" }).state).toBe(USER_ACCESS_LINK.LINKED);
    expect(describeUserAccessRelationship({ userId: "  " }).state).toBe(USER_ACCESS_LINK.NOT_LINKED);
    expect(describeUserAccessRelationship(null).state).toBe(USER_ACCESS_LINK.NOT_LINKED);
    const linked = describeUserAccessRelationship({ userId: "x" });
    expect(linked.principal.available).toBe(false);
    expect(JSON.stringify(linked)).not.toContain('"x"');
  });
});

// ════════════════════ OWNER != ACCOUNTABLE != ASSIGNED ════════════════════

describe("Record Owner, Accountable Person and Assigned Person stay separate", () => {
  it("renders three axes with three labels and three dependencies -- never one list of 'owner'", async () => {
    renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const axes = [...document.querySelectorAll("[data-responsibility-axis]")];
    expect(axes.map((a) => a.getAttribute("data-responsibility-axis"))).toEqual(["OWNER", "ACCOUNTABLE", "ASSIGNED"]);
    expect(axes.map((a) => a.querySelector(".ns-emp-axis__label").textContent)).toEqual([
      "Record Owner",
      "Accountable Person",
      "Assigned Person",
    ]);
    const deps = axes.map((a) => a.querySelector("[data-runtime-dependency]").getAttribute("data-runtime-dependency"));
    expect(new Set(deps).size).toBe(3);
    expect(deps).toEqual(["EMP-RT-03", "EMP-RT-04", "EMP-RT-05"]);
    // Unavailable is not empty: no axis prints a count.
    for (const a of axes) expect(a.textContent).not.toMatch(/\b0\b/);
    // Each axis explains only its own relationship.
    expect(axes[0].textContent).toMatch(/does not make you accountable/);
    expect(axes[1].textContent).toMatch(/separate from ownership/);
    expect(axes[2].textContent).toMatch(/does not make you the Record Owner or the Accountable Person/);
  });

  it("the self view asks the same three questions in the first person, with 'Why is this in front of me?'", () => {
    session = { user: { uid: "u" }, role: "technician", employeeId: "emp-1", displayName: "Dana Reyes", employmentStatus: "ACTIVE", operationalRoles: [], loading: false };
    renderSelf();
    for (const heading of ["Records I own", "Outcomes I'm accountable for", "My assigned work"]) {
      expect(screen.getByRole("heading", { level: 3, name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText("Why is this in front of me?").length).toBe(3);
  });

  it("domain: explainWhyInFrontOfMe returns only the TRUE relationships, in axis order, one each", () => {
    expect(explainWhyInFrontOfMe([])).toEqual([]);
    expect(explainWhyInFrontOfMe(undefined)).toEqual([]);
    expect(explainWhyInFrontOfMe(["ASSIGNED"]).map((r) => r.axis)).toEqual(["ASSIGNED"]);
    expect(explainWhyInFrontOfMe(["ASSIGNED", "OWNER", "OWNER", "BOGUS"]).map((r) => r.label)).toEqual([
      "Record Owner",
      "Assigned Person",
    ]);
    const reasons = explainWhyInFrontOfMe(Object.values(RESPONSIBILITY_AXIS)).map((r) => r.reason);
    expect(new Set(reasons).size).toBe(3);
  });

  it("domain: every axis is unavailable with its own EMPLOYEE_RUNTIME_DEPENDENCY and no count slot", () => {
    for (const perspective of ["admin", "self"]) {
      const axes = describeResponsibilities(perspective);
      expect(axes).toHaveLength(3);
      for (const a of axes) {
        expect(a.available).toBe(false);
        expect(a.dependency.kind).toBe(EMPLOYEE_RUNTIME_DEPENDENCY);
        expect(a).not.toHaveProperty("count");
      }
    }
  });
});

// ════════════════════ LIFECYCLE ════════════════════

describe("the Employee lifecycle is exactly six statuses, each its own words and meaning", () => {
  it("domain: the table mirrors the governed vocabulary exactly", () => {
    expect(EMPLOYEE_LIFECYCLE_VALUES).toEqual(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);
    expect(EMPLOYEE_LIFECYCLE_VALUES).toEqual([...EMPLOYMENT_STATUS_VALUES]);
    const meanings = EMPLOYEE_LIFECYCLE_VALUES.map((v) => describeLifecycle(v).meaning);
    expect(new Set(meanings).size).toBe(6);
    expect(describeLifecycle("INACTIVE").standing).not.toBe(describeLifecycle("TERMINATED").standing);
    expect(describeLifecycle("ON_LEAVE").standing).toBe(LIFECYCLE_STANDING.CURRENT);
    expect(describeLifecycle("CONTRACTOR").standing).toBe(LIFECYCLE_STANDING.CURRENT);
    expect(describeLifecycle("RETIRED").standing).toBe(LIFECYCLE_STANDING.FORMER);
  });

  it("domain: unrecognised is verbatim, absent is NOT_RECORDED -- neither becomes a neighbouring status", () => {
    expect(describeLifecycle("SUSPENDED")).toMatchObject({ words: "SUSPENDED", standing: LIFECYCLE_STANDING.UNRECOGNISED });
    expect(describeLifecycle(null).standing).toBe(LIFECYCLE_STANDING.NOT_RECORDED);
    expect(Object.isFrozen(EMPLOYEE_LIFECYCLE)).toBe(true);
  });

  for (const status of ["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]) {
    it(`renders ${status} with its word and meaning on the record`, async () => {
      seed([{ id: "emp-x", displayName: "Status Probe", employmentStatus: status }]);
      renderRecord("emp-x");
      await screen.findByRole("heading", { level: 1, name: "Status Probe" });
      const row = document.querySelector("[data-employee-lifecycle]");
      expect(row.getAttribute("data-employee-lifecycle")).toBe(status);
      const d = describeLifecycle(status);
      expect(within(row).getByText(d.words)).toBeTruthy();
      expect(within(row).getByText(d.meaning)).toBeTruthy();
    });
  }
});

describe("former and inactive Employees stay resolvable and displayable", () => {
  for (const [fixture, word] of [[TERMINATED, "Terminated"], [INACTIVE, "Inactive"], [RETIRED, "Retired"]]) {
    it(`${word}: the record opens, names the person and keeps its history and relationships`, async () => {
      renderRecord(fixture.id);
      expect(await screen.findByRole("heading", { level: 1, name: fixture.displayName })).toBeTruthy();
      expect(screen.queryByText("This user could not be found.")).toBeNull();
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
      expect(screen.getByRole("heading", { name: "Change History" })).toBeTruthy();
    });
  }

  it("a Terminated Employee's recorded manager still resolves as a link", async () => {
    renderRecord("emp-3");
    await screen.findByRole("heading", { level: 1, name: "Sam Ortiz" });
    expect(screen.getByRole("link", { name: "Dana Reyes" }).getAttribute("href")).toBe("/administration/users/emp-1");
  });
});

// ════════════════════ JOB ROLE ════════════════════

describe("Job Role is not governed and is never inferred", () => {
  it("a salesperson Security Role with a Sales Associate marker still shows Job Role: Not yet governed", async () => {
    renderRecord("emp-1");
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const jobRole = document.querySelector("[data-employee-job-role]");
    expect(jobRole.getAttribute("data-employee-job-role")).toBe(JOB_ROLE_STATE.NOT_GOVERNED);
    expect(within(jobRole).getByText("Not yet governed")).toBeTruthy();
    // Nothing about the person leaks into the Job Role cell.
    expect(jobRole.textContent).not.toMatch(/Salesperson|salesperson|Sales Associate|Account Executive/);
    // The eligibility marker is shown -- as eligibility, in its own row.
    const eligibility = document.querySelector("[data-employee-operational-eligibility]");
    expect(within(eligibility).getByText("Sales Associate")).toBeTruthy();
  });

  it("domain: describeJobRole takes no input, so no input can produce a Job Role", () => {
    expect(describeJobRole.length).toBe(0);
    expect(describeJobRole({ securityRole: "salesperson", operationalRoles: ["SALES_ASSOCIATE"] })).toEqual(describeJobRole());
    expect(describeJobRole().dependency).toBe(RUNTIME_DEPENDENCIES.JOB_ROLE_AUTHORITY);
  });

  it("Retail Sales and National Accounts Sales are named as TWO roles, never one generic Sales role", async () => {
    const text = describeJobRole().explanation;
    expect(text).toMatch(/Retail Sales and National Accounts Sales will be separate Job Roles/);
    renderRecord("emp-1");
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const jobRole = document.querySelector("[data-employee-job-role]");
    // No collapsed label anywhere in the Job Role cell.
    expect(jobRole.textContent).not.toMatch(/\bSales Job Role\b|Job Role: Sales\b/);
    expect(read("src/domain/employeeOperatingProfile.js")).not.toMatch(/["']SALES["']/);
  });

  it("the self view never presents the Security Role as a Job Role", () => {
    session = { user: { uid: "u" }, role: "salesperson", employeeId: "emp-1", displayName: "Dana Reyes", employmentStatus: "ACTIVE", operationalRoles: ["SALES_ASSOCIATE"], loading: false };
    renderSelf();
    expect(document.querySelector("[data-employee-job-role]").textContent).not.toMatch(/salesperson/i);
    expect(document.querySelector("[data-self-security-role]").textContent).toMatch(/It is not your Job Role/);
  });
});

// ════════════════════ MANAGER CONTEXT ════════════════════

describe("manager context is not invented", () => {
  it("the record states managed employees as unavailable rather than deriving a hierarchy from stored manager ids", async () => {
    renderRecord("emp-1"); // emp-3 records emp-1 as manager -- that must NOT become a team list
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    const managed = section("Managed employees");
    expect(within(managed).queryByText("Sam Ortiz")).toBeNull();
    expect(managed.querySelector('[data-runtime-dependency="EMP-RT-06"]')).toBeTruthy();
  });
});

// ════════════════════ SELF VIEW ════════════════════

describe("the self view", () => {
  it("linked: who EOS says I am, status with meaning, eligibility, access and responsibilities", () => {
    session = { user: { uid: "u" }, role: "technician", employeeId: "emp-9", displayName: "Chris Vale", employmentStatus: "ON_LEAVE", operationalRoles: ["TECHNICIAN"], loading: false };
    renderSelf();
    expect(screen.getByRole("heading", { level: 1, name: "Chris Vale" })).toBeTruthy();
    expect(document.querySelector("[data-self-identity]").getAttribute("data-self-identity")).toBe("LINKED");
    expect(screen.getByText(describeLifecycle("ON_LEAVE").meaning)).toBeTruthy();
    expect(screen.getByText("Technician", { selector: ".fo-chip" })).toBeTruthy();
    expect(document.querySelector('[data-self-operating-company="UNAVAILABLE"] [data-runtime-dependency="EMP-RT-07"]')).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "People I manage" })).toBeTruthy();
  });

  it("unlinked: says EOS knows you as User Access only, with no fabricated Employee facts", () => {
    session = { user: { uid: "u" }, role: "admin", employeeId: null, displayName: null, employmentStatus: null, operationalRoles: [], loading: false };
    renderSelf();
    expect(document.querySelector("[data-self-identity]").getAttribute("data-self-identity")).toBe("NOT_LINKED");
    expect(screen.getByText(/not linked to an Employee record\. EOS knows you as User Access only/)).toBeTruthy();
    expect(document.querySelector("[data-responsibility-axis]")).toBeNull();
    expect(document.querySelector('[data-responsibility-state="NOT_APPLICABLE"]')).toBeTruthy();
    expect(document.querySelector("[data-employee-lifecycle]")).toBeNull();
  });

  it("unresolved link: stated as unresolved, never as 'status not recorded'", () => {
    session = { user: { uid: "u" }, role: "technician", employeeId: "emp-gone", displayName: null, employmentStatus: null, operationalRoles: [], loading: false };
    renderSelf();
    expect(screen.getAllByText(/did not resolve/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Status not recorded")).toBeNull();
    expect(screen.queryByText("emp-gone")).toBeNull();
  });

  it("domain: describeSelf reads only the session it is handed", () => {
    expect(describeSelf({}).identity).toBe("NOT_LINKED");
    expect(describeSelf({ employeeId: "e", displayName: "A", employmentStatus: "RETIRED" })).toMatchObject({
      identity: "LINKED",
      recordResolved: true,
    });
  });
});

// ════════════════════ ACCESSIBILITY ════════════════════

describe("accessibility labels", () => {
  it("the rail, the axis list and every axis are labelled; every disclosure has a summary", async () => {
    renderRecord();
    await screen.findByRole("heading", { level: 1, name: "Dana Reyes" });
    expect(screen.getByRole("complementary", { name: "Responsibility and source" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Responsibility relationships" });
    for (const item of within(list).getAllByRole("listitem")) {
      const id = item.getAttribute("aria-labelledby");
      expect(document.getElementById(id)?.tagName).toBe("H3");
    }
    for (const details of document.querySelectorAll("details.ns-emp-disclosure")) {
      expect(details.querySelector("summary")?.textContent.trim().length).toBeGreaterThan(0);
    }
    // Status is never colour alone: the lifecycle pill carries its word.
    expect(document.querySelector("[data-employee-lifecycle] .fo-status-pill").textContent).toMatch(/Active/);
  });
});

// ════════════════════ STATIC RATCHETS ════════════════════

const NEW_OR_CHANGED = [
  "src/domain/employeeOperatingProfile.js",
  "src/modules/employees/EmployeeProfileSections.jsx",
  "src/modules/employees/MyEmployeeProfile.jsx",
  "src/modules/administration/UserDetail.jsx",
];

describe("no new Firebase data path and no demo data", () => {
  for (const rel of NEW_OR_CHANGED) {
    it(`${rel} imports no Firebase module and opens no Firestore read or callable`, () => {
      const src = code(read(rel));
      expect(src).not.toMatch(/from\s+["']firebase(\/[a-z-]+)?["']/);
      expect(src).not.toMatch(/\b(collection|onSnapshot|getDoc|getDocs|doc|query|httpsCallable)\s*\(/);
      expect(src).not.toMatch(/from\s+["'][./]*\/?(data|fixtures)\//);
      expect(src).not.toMatch(/\b(mock|demo|sample|placeholder|coming soon)\b/i);
    });
  }

  it("UserDetail reads exactly the data seams it read before -- nothing added", () => {
    const imports = code(read("src/modules/administration/UserDetail.jsx"))
      .split("\n")
      .filter((l) => /^import /.test(l) || /^\s+from /.test(l) || /} from /.test(l))
      .join("\n");
    const dataSeams = [...imports.matchAll(/from\s+["']([^"']*(hooks|access|services|firebase)[^"']*)["']/g)].map((m) => m[1]);
    expect(dataSeams.sort()).toEqual(["../../access/administrationUsersClient", "../../hooks/useEmployeeDirectory"]);
  });

  it("the self view's only data seam is the existing AuthContext session", () => {
    const src = code(read("src/modules/employees/MyEmployeeProfile.jsx"));
    const seams = [...src.matchAll(/from\s+["']([^"']*(hooks|access|services|firebase|auth)[^"']*)["']/g)].map((m) => m[1]);
    expect(seams).toEqual(["../../auth/AuthContext"]);
  });

  it("every runtime dependency names the governed read it needs", () => {
    for (const dep of Object.values(RUNTIME_DEPENDENCIES)) {
      expect(dep.kind).toBe(EMPLOYEE_RUNTIME_DEPENDENCY);
      expect(dep.id).toMatch(/^EMP-RT-\d\d$/);
      expect(dep.requiredApi).toMatch(/Governed/);
    }
    expect(new Set(Object.values(RUNTIME_DEPENDENCIES).map((d) => d.id)).size).toBe(Object.keys(RUNTIME_DEPENDENCIES).length);
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

  it("profile facts stack to one column at every width, so sentences never squeeze into the rail", () => {
    expect(rule(".ns-emp-facts")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule(".ns-emp-facts dd")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("responsibility labels wrap rather than clip", () => {
    for (const sel of [".ns-emp-axis__label", ".ns-emp-axis__heading"]) {
      const body = rule(sel);
      expect(body, sel).toMatch(/overflow-wrap:\s*anywhere/);
      expect(body, sel).not.toMatch(/white-space:\s*nowrap|text-overflow:\s*ellipsis/);
    }
  });

  it("disclosures and the rail profile link meet the 44px touch floor by default", () => {
    expect(rule(".ns-emp-disclosure > summary")).toMatch(/min-height:\s*44px/);
    expect(rule(".fo-rail-identity__profile")).toMatch(/min-height:\s*44px/);
  });

  it("no new palette: the profile rules use tokens, not literal colours", () => {
    const block = css.slice(css.indexOf(".ns-emp-facts"), css.indexOf(".fo-user-actions {"));
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

// ════════════════════ ROUTE / NAVIGATION WIRING ════════════════════

describe("routes", () => {
  it("App mounts /my-profile beside the unchanged Administration record route", () => {
    const app = read("src/App.jsx");
    expect(app).toMatch(/<Route path="\/my-profile" element=\{<MyEmployeeProfile \/>\} \/>/);
    expect(app).toMatch(/path="users\/:employeeId"/);
  });

  it("the rail identity block links to the self view and keeps its name, role and Sign out", () => {
    const rail = read("src/navigation/AppRail.jsx");
    expect(rail).toMatch(/<NavLink to="\/my-profile" className="fo-rail-identity__profile">/);
    expect(rail).toMatch(/Sign out/);
  });
});
