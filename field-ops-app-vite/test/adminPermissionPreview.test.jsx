import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../src/modules/administration/usePolicyStore.js", () => ({
  usePolicyStore: vi.fn((operation, input) => {
    if (operation === "listTenantPrincipals") {
      return {
        status: "ready",
        data: [
          {
            id: "principal-admin-12345678",
            displayName: "Avery Admin",
            externalSubject: "firebase-subject-must-not-render",
            identityProvider: "firebase",
            status: "active",
          },
          {
            id: "principal-no-name-87654321",
            displayName: null,
            externalSubject: "another-subject-must-not-render",
            identityProvider: "firebase",
            status: "active",
          },
        ],
        error: null,
      };
    }
    if (operation === "getPrincipalEffectiveAccess" && input?.principalId) {
      return {
        status: "ready",
        data: {
          principalId: input.principalId,
          roles: ["admin"],
          directGrants: [],
          effective: [
            {
              capabilityKey: "admin.principalAccess.read",
              objectKey: "principal",
              actionKey: "read",
              actionKind: "READ",
              displayLabel: "Read Principal access",
              source: "ROLE",
            },
          ],
          objects: { principal: ["read"] },
        },
        error: null,
      };
    }
    return { status: "unconfigured", data: null, error: null };
  }),
}));

import AdminPermissionPreview from "../src/modules/administration/AdminPermissionPreview.jsx";

afterEach(cleanup);

describe("Administration Permission Preview", () => {
  it("renders the deployed governed effective-access read instead of the stale unavailable placeholder", () => {
    render(<AdminPermissionPreview />);

    expect(screen.getByRole("heading", { name: "Permission Preview" })).toBeTruthy();
    expect(screen.queryByText(/trusted read path.*not yet deployed/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Avery Admin" }));

    expect(screen.getByText("admin.principalAccess.read")).toBeTruthy();
    expect(screen.getByText("Read Principal access")).toBeTruthy();
    expect(screen.getByText("ROLE")).toBeTruthy();
    expect(screen.getByText(/Security Roles: admin/i)).toBeTruthy();
  });

  it("never falls back to displaying the external authentication subject", () => {
    render(<AdminPermissionPreview />);

    expect(screen.getByRole("button", { name: "Principal principal" })).toBeTruthy();
    expect(screen.queryByText("firebase-subject-must-not-render")).toBeNull();
    expect(screen.queryByText("another-subject-must-not-render")).toBeNull();
  });
});
