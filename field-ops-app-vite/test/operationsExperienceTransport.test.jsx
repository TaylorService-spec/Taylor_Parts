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
import { isPolicyApiConfigured, policyApiBaseUrl } from "../src/services/adminPolicyApiClient.js";
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

// ════════════════════ WAVE 7 / LANE AD — CONFIGURED IS NOT ENABLED ════════════════════
//
// Everything above proves the transport and the hook behave. This last group proves the thing a
// deployment actually turns on, and it is the pair that has to hold TOGETHER:
//
//   configured + readiness false  ->  not one request leaves the browser
//   configured + readiness true   ->  NOT_CONFIGURED is no longer reachable
//
// It matters because the two were being conflated. `VITE_EOS_API_BASE_URL` is set in the Vercel
// non-production project and inlined into that bundle, and a reader who takes that to mean the EOS
// navigation seam is live has it backwards; a reader who takes the seam being off to mean the API is
// unconfigured has it backwards the other way, and blocks work that is not blocked.
//
// The suites above inject a client. These deliberately do NOT stub `policyApiBaseUrl` -- they set the
// real environment variable the shipped bundle reads, so "configured" means configured.
describe("the EOS API address and the navigation seam are two different switches", () => {
  // The address config/environments.json records for platform-sandbox, and the one render.yaml's
  // eos-api-nonprod service serves. Duplicated here on purpose: if the registry moves and this does
  // not, the first assertion fails and says so.
  const NONPROD_BASE = "https://eos-api-nonprod.onrender.com";

  it("is pointed at the address the ONE registry declares for the non-production environment", () => {
    const registry = JSON.parse(readFileSync("../config/environments.json", "utf8"));
    const sandbox = registry.environments.find((e) => e.id === "platform-sandbox");
    expect(sandbox.eosApi.baseUrl).toBe(NONPROD_BASE);

    // WAVE 11 / LANE AS. This used to assert the seam was false in EVERY environment, which was a
    // statement about a pre-activation world rather than about the pair. The Owner has since enabled
    // it in non-production, so what is asserted now is the relationship the group is named for --
    // the address and the seam remain two switches, and the second one may be thrown ONLY where the
    // first already is.
    const enabled = registry.environments
      .filter((e) => e.readiness.EOS_NAVIGATION_AUTHORITY_READY === true);
    expect(enabled.map((e) => e.id)).toEqual(["platform-sandbox"]);
    for (const env of enabled) {
      // An enabled seam with no address is the NOT_CONFIGURED -> UNAVAILABLE outage this whole group
      // exists to describe, applied to every persona at once.
      expect(env.eosApi).not.toBeNull();
      expect(env.role).not.toBe("production");
    }
    // Production declares no address AND does not enable the seam -- two independent fences.
    for (const env of registry.environments.filter((e) => e.role === "production")) {
      expect(env.readiness.EOS_NAVIGATION_AUTHORITY_READY).toBe(false);
      expect(env.eosApi).toBeNull();
    }
  });

  it("NOT CONFIGURED is what an environment without the variable really gets", () => {
    // The control. Without it, the two tests below could both pass against a client that ignored
    // configuration entirely.
    vi.stubEnv("VITE_EOS_API_BASE_URL", "");
    try {
      expect(policyApiBaseUrl()).toBeNull();
      expect(isPolicyApiConfigured()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("CONFIGURED + readiness false: NOT ONE experience request is made", async () => {
    vi.stubEnv("VITE_EOS_API_BASE_URL", NONPROD_BASE);
    const fetchSpy = vi.fn(async () => {
      throw new Error("the network must not be reached while the seam is off");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      // The API really is configured -- this is not a test that passes because nothing was set up.
      expect(policyApiBaseUrl()).toBe(NONPROD_BASE);
      expect(isPolicyApiConfigured()).toBe(true);
      // Readiness is what is false, and it is a compile-time constant.
      expect(EOS_NAVIGATION_AUTHORITY_READY).toBe(false);

      const client = {
        call: vi.fn(async () => ({ ok: true, operation: "resolveMyExperienceContext", result: WELL_FORMED })),
      };
      // `enabled` is NOT passed: the hook takes the environment's readiness flag, exactly as the
      // shipped app does.
      const { result, rerender } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1" }));
      rerender();
      await Promise.resolve();

      expect(client.call).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      // null authority is how every caller knows the legacy navigation path is still in charge.
      // Navigation is unchanged by configuring the API, which is the whole claim.
      expect(result.current.authority).toBeNull();
      expect(result.current.context).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("CONFIGURED + readiness true (in this test only): NOT_CONFIGURED can no longer happen", async () => {
    // The isolated counterfactual. Nothing here flips a deployed environment: the seam is enabled
    // for ONE hook instance through the `enabled` argument, which is the injection point the design
    // provides precisely so that no production-importable override has to exist.
    vi.stubEnv("VITE_EOS_API_BASE_URL", NONPROD_BASE);
    try {
      let seenUrl = null;
      // The REAL transport, reading the REAL environment variable -- baseUrl is not passed.
      const result = await callOperationsApi("resolveMyExperienceContext", {
        getIdToken: async () => "token-abc",
        fetchImpl: async (url) => {
          seenUrl = url;
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, operation: "resolveMyExperienceContext", result: WELL_FORMED }),
          };
        },
      });
      // The precise failure the blocker predicted, and it is gone: with the base URL present the
      // client resolves an address instead of reporting NOT_CONFIGURED -> UNAVAILABLE -> a retry
      // refusal for every persona.
      expect(result.ok).toBe(true);
      expect(result.code).toBeUndefined();
      expect(seenUrl).toBe(`${NONPROD_BASE}/operations/experience`);

      // And through the hook: a seam that is ON reaches READY rather than UNAVAILABLE.
      const client = {
        call: vi.fn(async () => ({ ok: true, operation: "resolveMyExperienceContext", result: WELL_FORMED })),
      };
      const { result: hook } = renderHook(() => useExperienceContext({ client, principalKey: "uid-1", enabled: true }));
      await waitFor(() => expect(hook.current.state).toBe(EXPERIENCE_STATE.READY));
      expect(hook.current.reason).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
