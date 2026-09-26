import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../src/modules/administration/usePolicyStore.js", () => ({
  usePolicyStore: vi.fn(() => ({
    status: "ready",
    data: [
      {
        id: "audit-1",
        tenantId: "tenant-1",
        action: "rebindPrincipalIdentity",
        actorUid: "principal-admin",
        targetKind: "principal",
        targetId: "principal-dispatcher",
        before: {
          identityProvider: "firebase",
          externalSubject: "old-auth-subject-must-not-render",
        },
        after: {
          identityProvider: "firebase",
          externalSubject: "new-auth-subject-must-not-render",
        },
        occurredAt: "2026-09-24T21:19:06.000Z",
        reason: "Dispatcher sandbox login identity reconciliation",
      },
      {
        id: "audit-2",
        tenantId: "tenant-1",
        action: "assignRole",
        actorUid: "principal-admin",
        targetKind: "roleAssignment",
        targetId: "assignment-1",
        before: null,
        after: { roleId: "dispatcher" },
        occurredAt: "2026-09-24T20:00:00.000Z",
        reason: null,
      },
    ],
    error: null,
  })),
}));

import AdminAuditLogs, { auditChangeKind, DEFAULT_LIMIT } from "../src/modules/administration/AdminAuditLogs.jsx";

afterEach(cleanup);

describe("Administration Audit Logs", () => {
  it("renders persisted audit history from the governed read", () => {
    render(<AdminAuditLogs />);

    expect(screen.getByRole("heading", { name: "Audit Logs" })).toBeTruthy();
    expect(screen.getByRole("table", { name: "Administration audit history" })).toBeTruthy();
    expect(screen.getByText("rebindPrincipalIdentity")).toBeTruthy();
    expect(screen.getByText("principal-dispatcher")).toBeTruthy();
    expect(screen.getByText("Dispatcher sandbox login identity reconciliation")).toBeTruthy();
    expect(screen.getByText("Changed")).toBeTruthy();
    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.getByText("No reason recorded")).toBeTruthy();
    expect(DEFAULT_LIMIT).toBe(100);
  });

  it("does not dump before/after payloads or external authentication subjects into the index", () => {
    render(<AdminAuditLogs />);

    expect(screen.queryByText("old-auth-subject-must-not-render")).toBeNull();
    expect(screen.queryByText("new-auth-subject-must-not-render")).toBeNull();
    expect(document.body.textContent).not.toContain("old-auth-subject-must-not-render");
    expect(document.body.textContent).not.toContain("new-auth-subject-must-not-render");
  });

  it("classifies the audit event shape without interpreting payload contents", () => {
    expect(auditChangeKind({ before: null, after: {} })).toBe("Created");
    expect(auditChangeKind({ before: {}, after: null })).toBe("Removed");
    expect(auditChangeKind({ before: {}, after: {} })).toBe("Changed");
    expect(auditChangeKind({ before: null, after: null })).toBe("Recorded");
  });
});
