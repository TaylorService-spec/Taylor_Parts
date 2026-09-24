// THE OBJECT SECURITY READ HOOKS -- proved through a stubbed policy client.
//
// What matters: each hook names the right server operation and sends the right input key, a hook
// with no key asks NOTHING rather than sending an empty input, and a refusal reaches the screen as
// a refusal instead of an empty security grid.
//
// These hooks are READS wired to no screen in this tranche. Nothing here asserts that a panel
// renders them, because none does -- and none should until the screen that owns the question exists.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const callPolicyApi = vi.fn();

vi.mock("../src/services/adminPolicyApiClient.js", () => ({
  callPolicyApi: (...args) => callPolicyApi(...args),
  isPolicyApiConfigured: () => true,
  describePolicyFailure: (r) => (r?.ok ? null : r?.message ?? null),
}));

const {
  useObjectSecurityMatrix,
  useObjectsWithActions,
  usePrincipalEffectiveAccess,
  useRoleSecurity,
} = await import("../src/modules/administration/useObjectSecurity.js");

/** Render one hook and expose its latest value. */
function mount(useHook, ...args) {
  const seen = { current: null };
  function Probe() {
    seen.current = useHook(...args);
    return null;
  }
  const view = render(<Probe />);
  return { seen, view };
}

const ok = (data) => ({ ok: true, data, tenantId: "taylor-az" });

beforeEach(() => callPolicyApi.mockReset());
afterEach(() => vi.clearAllMocks());

describe("each hook names one server operation and one input key", () => {
  it("useObjectsWithActions asks for the inventory, with no input", async () => {
    callPolicyApi.mockResolvedValue(ok([{ key: "workOrder", label: "Work Order", supportsDelete: false, actions: [] }]));
    const { seen } = mount(useObjectsWithActions);
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(callPolicyApi).toHaveBeenCalledWith("listObjectsWithActions", {}, expect.anything());
    expect(seen.current.data).toHaveLength(1);
  });

  it("useObjectSecurityMatrix sends objectKey", async () => {
    callPolicyApi.mockResolvedValue(ok({ objectKey: "workOrder", label: "Work Order", supportsDelete: false, actions: [] }));
    const { seen } = mount(useObjectSecurityMatrix, "workOrder");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(callPolicyApi).toHaveBeenCalledWith("getObjectSecurityMatrix", { objectKey: "workOrder" }, expect.anything());
  });

  it("useRoleSecurity sends roleKey", async () => {
    callPolicyApi.mockResolvedValue(ok({ roleKey: "dispatcher", name: "Dispatcher", objects: {} }));
    const { seen } = mount(useRoleSecurity, "dispatcher");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(callPolicyApi).toHaveBeenCalledWith("getRoleSecurity", { roleKey: "dispatcher" }, expect.anything());
  });

  it("usePrincipalEffectiveAccess sends principalId, and keeps the server's provenance", async () => {
    callPolicyApi.mockResolvedValue(ok({
      principalId: "prn-7", roles: ["dispatcher"], directGrants: ["cap-31"],
      effective: [{ capabilityKey: "account.edit", objectKey: "account", actionKey: "edit", actionKind: "EDIT", displayLabel: "Edit Account", source: "ROLE_AND_DIRECT" }],
      objects: { account: ["edit"] },
    }));
    const { seen } = mount(usePrincipalEffectiveAccess, "prn-7");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(callPolicyApi).toHaveBeenCalledWith("getPrincipalEffectiveAccess", { principalId: "prn-7" }, expect.anything());
    expect(seen.current.data.effective[0].source).toBe("ROLE_AND_DIRECT");
    // A Principal's access, and nothing about the Employee behind it.
    expect(seen.current.data).not.toHaveProperty("workEligibility");
    expect(seen.current.data).not.toHaveProperty("employeeId");
  });
});

describe("no key means no request", () => {
  it("a hook with no selection asks nothing rather than sending an empty input", async () => {
    for (const [useHook, key] of [
      [useObjectSecurityMatrix, null],
      [useRoleSecurity, ""],
      [usePrincipalEffectiveAccess, undefined],
    ]) {
      callPolicyApi.mockReset();
      const { seen } = mount(useHook, key);
      await waitFor(() => expect(seen.current.status).toBe("unconfigured"));
      expect(callPolicyApi).not.toHaveBeenCalled();
    }
  });
});

describe("a refused read is never an empty security grid", () => {
  it("FORBIDDEN and NOT_FOUND reach the screen as failures with the server's message", async () => {
    for (const code of ["FORBIDDEN", "NOT_FOUND", "INVALID_INPUT", "UNREACHABLE"]) {
      callPolicyApi.mockReset();
      callPolicyApi.mockResolvedValue({ ok: false, code, message: `server said ${code}` });
      const { seen } = mount(useObjectSecurityMatrix, "workOrder");
      await waitFor(() => expect(seen.current.status).toBe("failed"));
      expect(seen.current.error.code, code).toBe(code);
      expect(seen.current.error.description, code).toBe(`server said ${code}`);
      // The one that would be dangerous: data must not be an empty collection a grid would render
      // as "nobody holds anything".
      expect(seen.current.data, code).toBeNull();
    }
  });

  it("NOT_CONFIGURED is its own state, not a failure and not an empty result", async () => {
    callPolicyApi.mockResolvedValue({ ok: false, code: "NOT_CONFIGURED", message: "no EOS API" });
    const { seen } = mount(useRoleSecurity, "dispatcher");
    await waitFor(() => expect(seen.current.status).toBe("unconfigured"));
    expect(seen.current.data).toBeNull();
  });
});

describe("the hooks are reads", () => {
  it("nothing here mutates, and no Administration screen calls them yet", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/modules/administration/useObjectSecurity.js", "utf8");
    // A read hook that exposed mutate would put a grant one click away from a display surface.
    for (const banned of ["grantObjectAction", "revokeObjectAction", "setObjectPermission", "assignRole"]) {
      expect(src.includes(banned), banned).toBe(false);
    }
    // Wired to nothing: this tranche is the route, not the screen.
    for (const screen of ["AdminObjects.jsx", "AdminRolesPermissions.jsx", "AdminPolicySurfaces.jsx", "UserDetail.jsx"]) {
      const code = readFileSync(`src/modules/administration/${screen}`, "utf8");
      expect(code.includes("useObjectSecurity"), screen).toBe(false);
    }
  });
});
