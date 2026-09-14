// VISUAL HARNESS — renders the Employee operating profile (Administration record + self view) to
// static files with the real stylesheet. Not an assertion suite.
//
// Same technique as the Parts / Opportunity harnesses: the real components, the directory read mocked
// at the hook boundary and the session at AuthContext, so the composition on screen is the one the
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

const EMPLOYEE = {
  id: "emp-1",
  displayName: "Dana Reyes-Montgomery",
  employmentStatus: "ON_LEAVE",
  operationalRoles: ["SALES_ASSOCIATE", "TECHNICIAN"],
  securityRole: "salesperson",
  userId: "uid-dana",
  jobTitle: "Senior Account Executive, Commercial Refrigeration",
  employeeNumber: "TAZ-0042",
  operatingCompanyId: "taylor",
  managerEmployeeId: "emp-2",
  workEmail: "dana.reyes-montgomery@example.test",
};
const MANAGER = { id: "emp-2", displayName: "Mike Jones", employmentStatus: "ACTIVE" };

vi.mock("../../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    byUserId: new Map([["uid-dana", EMPLOYEE]]),
    byEmployeeId: new Map([["emp-1", EMPLOYEE], ["emp-2", MANAGER]]),
    loading: false,
    error: null,
  }),
}));
vi.mock("../../src/auth/AuthContext", () => ({
  useAuth: () => ({
    user: { uid: "uid-dana" },
    role: "technician",
    employeeId: "emp-1",
    displayName: "Dana Reyes-Montgomery",
    employmentStatus: "ON_LEAVE",
    operationalRoles: ["TECHNICIAN"],
    loading: false,
  }),
}));

const { default: UserDetail } = await import("../../src/modules/administration/UserDetail.jsx");
const { default: MyEmployeeProfile } = await import("../../src/modules/employees/MyEmployeeProfile.jsx");

const client = {
  updateEmployeeProfile: async () => ({ ok: true }),
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
          <Route path="/administration/users/:employeeId" element={<UserDetail client={client} />} />
        </Routes>
      </MemoryRouter>,
    );
    await findByRole("heading", { level: 1 });
    await new Promise((r) => setTimeout(r, 20));
    write(container, "employee-record.rendered.html", "Employee record — rendered");
    cleanup();
  });

  it("writes the self view", async () => {
    const { container, findByRole } = render(
      <MemoryRouter initialEntries={["/my-profile"]}>
        <Routes>
          <Route path="/my-profile" element={<MyEmployeeProfile />} />
        </Routes>
      </MemoryRouter>,
    );
    await findByRole("heading", { level: 1 });
    write(container, "employee-self.rendered.html", "Employee self view — rendered");
    cleanup();
  });
});
