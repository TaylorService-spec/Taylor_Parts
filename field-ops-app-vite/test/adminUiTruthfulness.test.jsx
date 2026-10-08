// Pass 10 Administration UI truthfulness repair (D1-D4): the explanatory text on the deployed
// Administration screens must describe the deployed model, not the Firebase-era or pre-policy-store one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, existsSync } from "node:fs";
import AdminAuditLogs from "../src/modules/administration/AdminAuditLogs.jsx";
import { principalLabel } from "../src/modules/administration/principalDisplay.js";
import { principalLabel as sharedPrincipalLabel, UNNAMED_PRINCIPAL } from "../src/modules/administration/principalDisplay.js";
import SecurityRoleDetail from "../src/modules/administration/SecurityRoleDetail.jsx";

afterEach(cleanup);
const read = (p) => readFileSync(p, "utf8");

describe("D1 Roles & Permissions: no stale policy-store / role-in-code claim", () => {
  const src = read("src/modules/administration/AdminRolesPermissions.jsx");
  it("no longer says the policy store is not stood up or that role definitions live in code", () => {
    expect(src).not.toMatch(/not yet stood up/i);
    expect(src).not.toMatch(/role definitions live\s+in code/i);
    expect(src).not.toMatch(/policy-store operation/i);
  });
  it("routes configuration to Object Security and assignment to the Employee record", () => {
    expect(src).toMatch(/use Objects \(Object Security\)/);
    expect(src).toMatch(/Employee record under Users/);
    expect(src).toMatch(/does not show changes made in Object Security/);
  });
});

describe("D2 Audit Logs: the governed audit is not described as undeployed", () => {
  it("the Firebase-era placeholder component is gone and App routes Audit Logs to AdminAuditLogs", () => {
    expect(existsSync("src/modules/administration/AdministrationUnavailable.jsx")).toBe(false);
    const app = read("src/App.jsx");
    expect(app).toMatch(/item\.key === "auditLogs"\) \{\s*return <AdminAuditLogs \/>;/);
  });
  it("names where the deployed audit is shown, with no Firebase-era or 'not yet deployed' wording", () => {
    render(<MemoryRouter><AdminAuditLogs /></MemoryRouter>);
    const text = document.body.textContent;
    expect(screen.getByRole("heading", { name: "Audit Logs" })).toBeTruthy();
    expect(text).toMatch(/Access Audit History/);
    expect(text).toMatch(/Decision history/);
    expect(text).toMatch(/does not yet show a consolidated, tenant-wide list/);
    expect(text).not.toMatch(/firebase|firestore|trusted read path|not yet deployed|Issue #/i);
    expect(screen.getByRole("link", { name: "Users" }).getAttribute("href")).toBe("/administration/users");
    expect(screen.getByRole("link", { name: "Roles & Permissions" }).getAttribute("href")).toBe("/administration/roles-permissions");
  });
});

describe("D3 Administration Overview: correct routing of assignment and configuration", () => {
  const src = read("src/modules/administration/AdministrationOverview.jsx");
  it("Roles & Permissions is not described as where Roles are assigned", () => {
    expect(src).not.toMatch(/assign an already-approved Role/i);
  });
  it("names Objects for configuration and the Employee record for Security Role assignment", () => {
    expect(src).toMatch(/Configure what a Role may do in Objects/);
    expect(src).toMatch(/assign Security Roles to people on their Employee record under Users/);
  });
  it("Audit Logs is not described as a consolidated history it does not show", () => {
    expect(src).not.toMatch(/immutable history of every access grant/i);
    expect(src).toMatch(/Access Audit History/);
  });
});

describe("D4 Permission Preview: human-facing Principal label never exposes the internal id", () => {
  it("falls back to 'Unnamed Principal' for a missing, blank or non-string display name", () => {
    for (const p of [{ id: "0e0a0a89-cb34-4581-927f-8dbc79369e38" }, { id: "x", displayName: "   " }, { id: "y", displayName: null }, null, undefined]) {
      expect(principalLabel(p)).toBe("Unnamed Principal");
    }
  });
  it("never renders the id or the login subject", () => {
    const p = { id: "0e0a0a89-cb34-4581-927f-8dbc79369e38", externalSubject: "lT75guU9mEY46QFQcegWRZRhYBi2", displayName: null };
    expect(principalLabel(p)).not.toMatch(/0e0a0a89|lT75guU9/);
  });
  it("a named Principal still shows its trimmed name", () => {
    expect(principalLabel({ id: "z", displayName: "  Avery Admin " })).toBe("Avery Admin");
  });
});

describe("D5 Security Role holders: human-facing label never exposes the internal id", () => {
  const detail = {
    roleKey: "dispatcher", name: "Dispatcher", description: null, protected: false,
    holders: [
      { principalId: "11111111-2222-4333-8444-555555555555", displayName: null, assignmentId: "a-1", scopeType: "global", scopeValue: null, grantedAt: "2026-09-14T00:00:00Z", externalSubject: "login-subject-must-not-render" },
      { principalId: "99999999-8888-4777-8666-555555555555", displayName: "Emerson Fixture", assignmentId: "a-2", scopeType: "global", scopeValue: null, grantedAt: "2026-09-16T00:00:00Z" },
    ],
    actions: [],
  };
  const api = {
    getSecurityRoleDetail: vi.fn(async () => ({ ok: true, data: detail })),
    listRoleCapabilityDecisionHistory: vi.fn(async () => ({ ok: true, data: [] })),
    listSupportedConditionKinds: vi.fn(async () => ({ ok: true, data: { kinds: [] } })),
  };
  it("an unnamed holder reads 'Unnamed Principal'; a named holder keeps its name; the id is only a labelled diagnostic", async () => {
    render(<SecurityRoleDetail api={api} roleKey="dispatcher" />);
    const table = await screen.findByRole("table", { name: "Holders" });
    const [unnamed, named] = [...table.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td"));
    // The human-facing label: the cell's own text, before the diagnostic span.
    expect(unnamed.firstChild.textContent.trim()).toBe("Unnamed Principal");
    expect(named.firstChild.textContent.trim()).toBe("Emerson Fixture");
    expect(unnamed.firstChild.textContent).not.toMatch(/11111111/);
    // The internal id appears only inside the explicitly labelled diagnostic, and the login subject never.
    expect(unnamed.querySelector("span").textContent).toMatch(/^ID 11111111-2222-4333-8444-555555555555$/);
    expect(table.textContent).not.toMatch(/login-subject-must-not-render/);
  });
  it("Permission Preview and Security Role detail share ONE label convention", () => {
    expect(principalLabel).toBe(sharedPrincipalLabel);
    expect(UNNAMED_PRINCIPAL).toBe("Unnamed Principal");
    expect(read("src/modules/administration/SecurityRoleDetail.jsx")).not.toMatch(/displayName \?\? h\.principalId/);
  });
});

describe("D6 Administration Overview: the Users card uses the deployed Employee model", () => {
  const src = read("src/modules/administration/AdministrationOverview.jsx");
  it("no longer says 'operational roles'", () => {
    expect(src).not.toMatch(/operational roles?/i);
  });
  it("names Job Roles, Work Eligibility, Operational Scope and Security Roles", () => {
    expect(src).toMatch(/Job Roles, Work Eligibility, Operational Scope, Security Roles/);
  });
});

describe("F1 no Administration surface falls back to the login subject as a Principal label", () => {
  it("no administration module labels a Principal with its externalSubject", async () => {
    const { readdirSync } = await import("node:fs");
    for (const f of readdirSync("src/modules/administration").filter((n) => /\.(jsx?|mjs)$/.test(n))) {
      const code = read(`src/modules/administration/${f}`);
      expect(code, f).not.toMatch(/displayName\s*(\|\||\?\?)\s*[\w.?]*externalSubject/);
    }
  });
});

describe("F2 the Users page is not a second interactive Security Role assignment surface", () => {
  it("the legacy policy-store panel is removed and not imported", () => {
    expect(existsSync("src/modules/administration/PolicyStorePanels.jsx")).toBe(false);
    const users = read("src/modules/administration/AdminUsers.jsx");
    expect(users).not.toMatch(/PolicyStorePanels|UsersPolicyPanel/);
    expect(users).not.toMatch(/Add role|Stored role assignments/);
  });
  it("the canonical assignment surface -- Employee record > Security Roles -- is still there, with its required reason", () => {
    expect(read("src/modules/administration/UserDetail.jsx")).toMatch(/title="Security Roles"[\s\S]*<EmployeeSecurityRoles/);
    const roles = read("src/modules/administration/EmployeeSecurityRoles.jsx");
    expect(roles).toMatch(/Assign Security Role/);
    // The canonical surface requires a stated reason before it sends (ReasonField + statedReason gate).
    expect(roles).toMatch(/<ReasonField/);
    expect(roles).toMatch(/if \(!roleId \|\| !reasonText/);
  });
});

describe("F3 Users guidance points to the Employee record's Security Roles", () => {
  const users = read("src/modules/administration/AdminUsers.jsx");
  it("no longer says the Roles are in the panel below", () => {
    expect(users).not.toMatch(/in the panel below/);
  });
  it("names the Employee record and its Security Roles section", () => {
    expect(users).toMatch(/open their Employee record and use\s+its Security Roles section/);
  });
});

describe("Object Security, protected Owner and R1 are unchanged by F1-F3", () => {
  it("Object Security keeps its grant/revoke/condition controls", () => {
    const obj = read("src/modules/administration/ObjectActionSecurity.jsx");
    expect(obj).toMatch(/Grant to another Security Role/);
  });
  it("the Administration client still sends assignRole / revokeRole with the reason, unchanged", () => {
    const client = read("src/services/adminControlPlaneClient.js");
    expect(client).toMatch(/assignRole: \(\{ principalId, roleId, reason, scopeType, scopeValue \}\) => send\("assignRole", \{\s*principalId, roleId, reason,/);
    expect(client).toMatch(/revokeRole: \(\{ assignmentId, reason \}\) => send\("revokeRole", \{ assignmentId, reason \}\)/);
  });
});

describe("no Administration authority behaviour changed", () => {
  it("the Administration client seams are untouched by this repair", () => {
    for (const f of ["src/services/adminPolicyApiClient.js", "src/services/adminControlPlaneClient.js"]) {
      expect(read(f)).not.toMatch(/Unnamed Principal|AdminAuditLogs/);
    }
  });
});
