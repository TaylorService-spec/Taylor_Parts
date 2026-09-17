// VISUAL HARNESS — renders the Employee operating profile (Administration record + self view) to
// static files with the real stylesheet. Not an assertion suite.
//
// Same technique as the Parts / Opportunity harnesses: the real components, the Workforce transport injected
// as a stub client and the session at AuthContext, so the composition on screen is the one the
// pages produce. The output is what a browser measures at 1440 and 375 (horizontal overflow, clipped
// responsibility labels, touch-floor sizes) without a dev server or credentials.
//
// Skipped unless VISUAL=1, so it never runs in CI or in the normal suite.
//   VISUAL=1 VISUAL_OUT=<dir> npx vitest run test/__visual__/renderEmployeeProfile.test.jsx

import { describe, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import fs from "node:fs";
import path from "node:path";

const nameOf = (displayName) => ({ displayName, firstName: "Dana", middleName: null, lastName: "Reyes-Montgomery", preferredName: null });
// EMP-RT-01 / EMP-RT-07 projection, test-only.
const EMPLOYEE = {
  employeeId: "emp-1",
  employmentStatus: "ON_LEAVE",
  operatingCompanyId: "taylor",
  employeeNumber: "TAZ-0042",
  displayName: "Dana Reyes-Montgomery",
  name: nameOf("Dana Reyes-Montgomery"),
  jobTitle: "Senior Account Executive, Commercial Refrigeration",
  contact: { workEmail: "dana.reyes-montgomery@example.test", workPhone: null, mobilePhone: null },
  address: { street: null, unit: null, city: null, state: null, postalCode: null },
  hireDate: "2019-04-01",
  separationDate: null,
  currentManager: { managerEmployeeId: "emp-2", displayName: "Mike Jones", effectiveFrom: "2026-01-05T00:00:00.000Z" },
  userAccess: "LINKED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const LONG = "Canyon Foods Regional Distribution — Southwest Commissary and Frozen Dessert Programme";

vi.mock("../../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "uid-dana" }, role: "technician", loading: false }),
}));

const { default: UserDetail } = await import("../../src/modules/administration/UserDetail.jsx");
const { default: MyEmployeeProfile } = await import("../../src/modules/employees/MyEmployeeProfile.jsx");

const workforce = {
  call: async (operation, input) => {
    switch (operation) {
      case "readEmployee":
        return { ok: true, result: EMPLOYEE };
      case "readMyEmployeeProfile":
        return { ok: true, result: { employee: EMPLOYEE, principalLink: { linkId: "l", principalId: "pr-1", linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null } } };
      case "readEmployeePrincipalLink":
        return { ok: true, result: { employeeId: "emp-1", userAccess: "LINKED", link: { linkId: "l", principalId: "pr-1", principalDisplayName: "Dana Reyes-Montgomery", principalStatus: "active", membershipStatus: "active", linkSource: "GOVERNED_ASSERTION", linkedAt: "2026-09-01T00:00:00.000Z", assertedBy: null } } };
      case "listEmployeeJobRoleHistory": {
        // EMP-RT-08: a current National Accounts Sales role with a long reason, and the ended Retail Sales role before it.
        const current = { assignmentId: "a-2", jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", jobRoleStatus: "ACTIVE", current: true, effectiveFrom: "2026-06-01T00:00:00.000Z", effectiveTo: null, reason: LONG };
        const ended = { assignmentId: "a-1", jobRoleId: "retail-sales", displayName: "Retail Sales", jobRoleStatus: "INACTIVE", current: false, effectiveFrom: "2025-01-15T00:00:00.000Z", effectiveTo: "2026-06-01T00:00:00.000Z", reason: null };
        return { ok: true, result: { employeeId: "emp-1", current, items: [current, ended], truncated: false } };
      }
      case "listJobRoles":
        return { ok: true, result: { items: [{ jobRoleId: "retail-sales", displayName: "Retail Sales", status: "ACTIVE" }, { jobRoleId: "national-accounts-sales", displayName: "National Accounts Sales", status: "ACTIVE" }] } };
      case "listManagedEmployees":
        return { ok: true, result: { items: [{ employeeId: "emp-7", displayName: "Alexandra Konstantinopoulou-Whitfield", employmentStatus: "ACTIVE", employeeNumber: null, operatingCompanyId: "taylor", jobTitle: null, reportingSince: "2026-01-01" }], truncated: false } };
      case "listRecordsOwnedByEmployee":
        return input.family === "ACCOUNT"
          ? { ok: true, result: { items: [{ family: "ACCOUNT", recordId: "a1", recordNumber: null, name: LONG, state: "ACTIVE", accountId: "a1", operatingCompanyId: null, updatedAt: "x" }], truncated: true } }
          : input.family === "SALES_ORDER" ? { ok: false, code: "FORBIDDEN", reason: "CAPABILITY_REQUIRED", status: 403 }
          : { ok: true, result: { items: [], truncated: false } };
      case "listAccountabilitiesForEmployee":
        return input.family === "OPPORTUNITY"
          ? { ok: true, result: { items: [{ family: "OPPORTUNITY", recordId: "o1", recordNumber: "OPP-2026-000412", name: null, state: "QUALIFY", accountId: "a1", operatingCompanyId: "taylor", updatedAt: "x", currentAccountability: null }], truncated: false } }
          : { ok: true, result: { items: [], truncated: false } };
      default:
        return { ok: false, code: "UNKNOWN_OPERATION" };
    }
  },
};
const policyCall = async () => ({ ok: true, data: [{ id: "pr-1", externalSubject: "uid-dana", identityProvider: "firebase", displayName: "Dana", status: "active" }] });

const client = {
  setUserStatus: async () => ({ ok: true }),
  assignApprovedRole: async () => ({ ok: true }),
  revokeRole: async () => ({ ok: true }),
  readPrincipalAccessState: async () => ({ ok: true, state: { authExists: true, accountStatus: "enabled", assignments: [] } }),
  listRecordChangeHistory: async () => ({ ok: true, rows: [] }),
};

function write(container, name, title) {
  const css = fs.readFileSync(path.resolve("src/index.css"), "utf-8");
  const out = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${css}</style>
<body class="fo-app">${container.innerHTML}</body>`;
  fs.writeFileSync(path.join(process.env.VISUAL_OUT || ".", name), out);
}

describe.skipIf(!process.env.VISUAL)("visual harness — Employee operating profile", () => {
  it("writes the Administration Employee record", async () => {
    const { container, findByRole } = render(
      <MemoryRouter initialEntries={["/administration/users/emp-1"]}>
        <Routes>
          <Route path="/administration/users/:employeeId" element={<UserDetail client={client} workforce={workforce} policyCall={policyCall} hasCapability={() => true} />} />
        </Routes>
      </MemoryRouter>,
    );
    await findByRole("heading", { level: 1 });
    await new Promise((r) => setTimeout(r, 60));
    write(container, "employee-record.rendered.html", "Employee record — rendered");
    cleanup();
  });

  it("writes the self view", async () => {
    const { container, findByRole } = render(
      <MemoryRouter initialEntries={["/my-profile"]}>
        <Routes>
          <Route path="/my-profile" element={<MyEmployeeProfile workforce={workforce} />} />
        </Routes>
      </MemoryRouter>,
    );
    await findByRole("heading", { level: 1 });
    await new Promise((r) => setTimeout(r, 60));
    write(container, "employee-self.rendered.html", "Employee self view — rendered");
    cleanup();
  });
});
