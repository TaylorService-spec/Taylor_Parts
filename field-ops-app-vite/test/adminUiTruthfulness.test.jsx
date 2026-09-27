// Pass 10 Administration UI truthfulness repair (D1-D4): the explanatory text on the deployed
// Administration screens must describe the deployed model, not the Firebase-era or pre-policy-store one.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, existsSync } from "node:fs";
import AdminAuditLogs from "../src/modules/administration/AdminAuditLogs.jsx";
import { principalLabel } from "../src/modules/administration/AdminPermissionPreview.jsx";

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

describe("no Administration authority behaviour changed", () => {
  it("the Administration client seams are untouched by this repair", () => {
    for (const f of ["src/services/adminPolicyApiClient.js", "src/services/adminControlPlaneClient.js"]) {
      expect(read(f)).not.toMatch(/Unnamed Principal|AdminAuditLogs/);
    }
  });
});
