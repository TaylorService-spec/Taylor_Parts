// THE BROWSER'S ROUTE TO THE EOS PRINCIPAL EXPERIENCE CONTEXT -- its proofs.
//
// This runs under vitest/jsdom rather than plain node for one reason: services/operationsApiClient.js
// reaches services/adminPolicyApiClient.js for the signed-in user's ID token, and that module imports
// firebase/firebase.js, which initializes Firebase at import time. vitest supplies the ambient
// __APP_* defines the plain-node runner cannot.
//
// What matters here is not that the client can make a request. It is that the client cannot become a
// second authorization model, and cannot quietly survive a failure:
//
//   it states an operation NAME and nothing else -- no tenant, no principal, no role, no capability
//   an unknown name never leaves the browser
//   NOT CONFIGURED is a state, not an error, and not an empty grant
//   a refusal, a network failure and a malformed body are three different answers
//   there is no Firestore in this path, at all, in any branch
//
// The hook's lifecycle is proved here too, because "one read per principal, cleared before the next"
// is the property that stops one person's surfaces being shown to the next person on a shared phone.
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

import {
  OPERATIONS_READ_OPERATIONS,
  OPERATIONS_ROUTE_BY_OPERATION,
  callOperationsApi,
  isOperationsOperation,
  operationsFailureCategory,
} from "../src/services/operationsApiClient.js";
import {
  EXPERIENCE_STATE,
  EXPERIENCE_UNAVAILABLE_REASON,
} from "../src/access/experienceContext.js";
import { useExperienceContext } from "../src/hooks/useExperienceContext.js";
import { EOS_NAVIGATION_AUTHORITY_READY } from "../src/config/navigationAuthorityReadiness.js";

const WELL_FORMED = Object.freeze({
  tenantId: "taylor-nonprod",
  principalId: "prn-0001",
  securityRoleKeys: ["partsAssociate"],
  employeeId: "synthetic-np-emp-parts-associate",
  workEligibility: ["PARTS_OPERATIONS"],
  operationalScopes: [{ scopeType: "REORDER_QUEUE", scopeId: "sample-co-synthetic" }],
  surfaces: ["inventory.catalog", "receiving.checkIn"],
});

describe("the Operations transport", () => {
  it("mirrors the server's route map and never sends an unknown operation", async () => {
    expect(OPERATIONS_ROUTE_BY_OPERATION).toEqual({
      resolveMyCapabilities: "/operations/inventory",
      resolveMyExperienceContext: "/operations/experience",
    });
    expect(OPERATIONS_READ_OPERATIONS).toEqual(["resolveMyCapabilities", "resolveMyExperienceContext"]);
    expect(isOperationsOperation("resolveMyExperienceContext")).toBe(true);
    expect(isOperationsOperation("runSQL")).toBe(false);

    const neverCalled = vi.fn();
    const refused = await callOperationsApi("runSQL", {
      baseUrl: "https://example.test",
      getIdToken: async () => "t",
      fetchImpl: neverCalled,
    });
    expect(refused).toMatchObject({ ok: false, code: "UNKNOWN_OPERATION" });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("POSTs the experience route with a bearer token and states no authority of its own", async () => {
    let seen = null;
    const result = await callOperationsApi("resolveMyExperienceContext", {
      baseUrl: "https://eos.example.test/",
      getIdToken: async () => "token-abc",
      tenantId: "taylor-nonprod",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return { ok: true, status: 200, json: async () => ({ ok: true, operation: "resolveMyExperienceContext", result: WELL_FORMED }) };
      },
    });
    expect(seen.url).toBe("https://eos.example.test/operations/experience");
    expect(seen.init.method).toBe("POST");
    expect(seen.init.headers.authorization).toBe("Bearer token-abc");
    expect(seen.init.headers["x-eos-tenant"]).toBe("taylor-nonprod");
    // The body names the operation and NOTHING else. A tenant, principal, role or capability sent
    // from here would be a client asserting its own authority; the server resolves all four.
    expect(JSON.parse(seen.init.body)).toEqual({ operation: "resolveMyExperienceContext" });
    expect(result.ok).toBe(true);
    expect(result.result.surfaces).toEqual(WELL_FORMED.surfaces);
  });

  it("returns a distinct, non-throwing failure for every way it can fail", async () => {
    const base = { baseUrl: "https://x.test", getIdToken: async () => "t" };
    expect((await callOperationsApi("resolveMyExperienceContext", { ...base, baseUrl: "  " })).code).toBe("NOT_CONFIGURED");
    expect((await callOperationsApi("resolveMyExperienceContext", { ...base, getIdToken: async () => null })).code).toBe("NOT_SIGNED_IN");

    const forbidden = await callOperationsApi("resolveMyExperienceContext", {
      ...base,
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, code: "FORBIDDEN", message: "NO_TENANT_MEMBERSHIP" }) }),
    });
    // The server's own refusal text survives: `message` carries PrincipalContextError's refusal
    // (NO_TENANT_MEMBERSHIP here), so a screen can say WHY rather than only "denied".
    expect(forbidden).toMatchObject({ ok: false, code: "FORBIDDEN", reason: "FORBIDDEN", status: 403 });
    expect(forbidden.message).toBe("NO_TENANT_MEMBERSHIP");

    const unreachable = await callOperationsApi("resolveMyExperienceContext", {
      ...base,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    expect(unreachable).toMatchObject({ ok: false, code: "UNREACHABLE" });

    expect(operationsFailureCategory(401, null)).toBe("UNAUTHENTICATED");
    expect(operationsFailureCategory(500, null)).toBe("INTERNAL");
  });

  it("contains no Firestore path in any branch", () => {
    const source = readFileSync("src/services/operationsApiClient.js", "utf8");
    for (const forbidden of ["firebase/firestore", "getDoc(", "onSnapshot", "users/", "operationalRoles", "ROLE_NAV_ACCESS"]) {
      expect(source.includes(forbidden), `must not reference ${forbidden}`).toBe(false);
    }
  });
});

describe("useExperienceContext", () => {
  const okClient = (result = WELL_FORMED) => ({ call: vi.fn(async () => ({ ok: true, operation: "resolveMyExperienceContext", result })) });

  it("makes NO request when the environment has not switched the source on", async () => {
    // The shipped state, in every environment today. A compile-time constant, never a runtime probe.
    expect(EOS_NAVIGATION_AUTHORITY_READY).toBe(false);
    const client = okClient();
    const { result } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1" }));
    expect(client.call).not.toHaveBeenCalled();
    // null authority is how every caller knows the legacy path is still in charge.
    expect(result.current.authority).toBeNull();
  });

  it("resolves once per principal and grants exactly what the server listed", async () => {
    const client = okClient();
    const { result } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1", enabled: true }));
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.READY));
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalledWith("resolveMyExperienceContext");
    expect(result.current.authority.grants("inventory.catalog")).toBe(true);
    expect(result.current.authority.grants("service.dispatch")).toBe(false);
  });

  it("a principal who holds nothing is REFUSED, not unavailable -- an empty answer is an answer", async () => {
    const client = okClient({ ...WELL_FORMED, surfaces: [], employeeId: null, workEligibility: [], operationalScopes: [] });
    const { result } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1", enabled: true }));
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.REFUSED));
    expect(result.current.authority.grants("inventory.catalog")).toBe(false);
  });

  it("a failed read is UNAVAILABLE and grants nothing -- it never degrades to the legacy role", async () => {
    const client = { call: vi.fn(async () => ({ ok: false, code: "UNREACHABLE", message: "down" })) };
    const { result } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1", enabled: true }));
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.UNAVAILABLE));
    expect(result.current.reason).toBe("UNREACHABLE");
    expect(result.current.authority.grants("inventory.catalog")).toBe(false);
    expect(result.current.context).toBeNull();
  });

  it("a body this bundle cannot read is UNAVAILABLE, never REFUSED", async () => {
    // Reporting a broken deploy as "you hold nothing" would blame the person for it.
    const client = okClient({ surfaces: ["crm.accounts"] });
    const { result } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1", enabled: true }));
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.UNAVAILABLE));
    expect(result.current.reason).toBe("MALFORMED_RESULT");
  });

  it("clears the previous principal's surfaces before the next read starts", async () => {
    const client = okClient();
    const { result, rerender } = renderHook(({ key }) => useExperienceContext({ client, principalKey: key, enabled: true }), {
      initialProps: { key: "uid-1" },
    });
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.READY));
    rerender({ key: "uid-2" });
    // Pairing a new subject with the previous subject's grants, even for one render, is the
    // shared-device failure AuthContext already guards against -- and these are navigation grants.
    expect(result.current.context).toBeNull();
    await waitFor(() => expect(result.current.state).toBe(EXPERIENCE_STATE.READY));
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("the refusal sentence blames neither the person's roles nor their sign-in", () => {
    expect(EXPERIENCE_UNAVAILABLE_REASON.length).toBeGreaterThan(60);
    expect(EXPERIENCE_UNAVAILABLE_REASON).toMatch(/not a sign-in problem/);
    expect(EXPERIENCE_UNAVAILABLE_REASON).toMatch(/not a permission decision/);
  });
});
