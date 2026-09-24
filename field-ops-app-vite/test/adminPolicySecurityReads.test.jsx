// THE OBJECT-OWNED SECURITY READS, from the browser -- proved through an injected transport.
//
// The gap these close: `listObjectsWithActions`, `getObjectSecurityMatrix`, `getRoleSecurity` and
// `getPrincipalEffectiveAccess` were served by the EOS API and proven against PostgreSQL, and the
// browser could not name a single one of them. The Administration screens' only answer to "who may
// do this" was a client-side model.
//
// What is proved here is narrow on purpose, because the client's job is narrow:
//
//   the operation NAME the server dispatches on, and the input key it requires
//   the server's projection is returned UNTOUCHED -- this client reshapes nothing
//   a refusal reaches the caller AS A REFUSAL, never as an empty list
//   NOT CONFIGURED, NOT SIGNED IN and UNREACHABLE stay three different answers
//
// The authority itself is proved server-side against a real database in
// functions/test/objectSecurityAuthorityPostgres.test.mjs. Nothing here re-decides it.
import { describe, it, expect, vi } from "vitest";
import {
  ADMIN_READ_OPERATIONS,
  adminSecurityReads,
  callPolicyApi,
  getObjectSecurityMatrix,
  getPrincipalEffectiveAccess,
  getRoleSecurity,
  isAdminOperation,
  listObjectsWithActions,
} from "../src/services/adminPolicyApiClient.js";

const respond = (body, status = 200) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

const opts = (fetchImpl, extra = {}) => ({
  baseUrl: "https://eos.example.test",
  getIdToken: async () => "tok-123",
  fetchImpl,
  ...extra,
});

const sent = (fetchImpl) => JSON.parse(fetchImpl.mock.calls[0][1].body);

// The four server projections, copied from the dispatcher in
// functions/src/adminPolicy/adminPolicyApi.ts so a shape change there shows up as a diff here.
const OBJECTS_WITH_ACTIONS = [
  {
    key: "workOrder",
    label: "Work Order",
    supportsDelete: false,
    actions: [
      { actionKey: "create", actionKind: "CREATE", displayLabel: "Create Work Order", capabilityKey: "workOrder.create" },
      { actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch", capabilityKey: "workOrder.dispatch" },
    ],
  },
  // An Object nothing governs yet still comes back, with an empty action list. The client must not
  // filter it out: "nothing governs this" is the fact an administrator needs in order to fix it.
  { key: "warehouse", label: "Warehouse", supportsDelete: true, actions: [] },
];

const OBJECT_MATRIX = {
  objectKey: "workOrder",
  label: "Work Order",
  supportsDelete: false,
  actions: [
    {
      actionKey: "read", capabilityKey: "workOrder.read", actionKind: "READ", displayLabel: "View Work Order",
      roleKeys: ["dispatcher", "technician"], principalIds: ["prn-7"],
    },
    // Nobody holds this one. An empty row, never an absent one.
    {
      actionKey: "dispatch", capabilityKey: "workOrder.dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch",
      roleKeys: [], principalIds: [],
    },
  ],
};

const ROLE_SECURITY = {
  roleKey: "dispatcher",
  name: "Dispatcher",
  objects: { account: ["read"], workOrder: ["create", "read"] },
};

const PRINCIPAL_ACCESS = {
  principalId: "prn-7",
  roles: ["dispatcher"],
  directGrants: ["cap-31"],
  effective: [
    { capabilityKey: "workOrder.read", objectKey: "workOrder", actionKey: "read", actionKind: "READ", displayLabel: "View Work Order", source: "ROLE" },
    { capabilityKey: "account.edit", objectKey: "account", actionKey: "edit", actionKind: "EDIT", displayLabel: "Edit Account", source: "ROLE_AND_DIRECT" },
  ],
  objects: { account: ["edit"], workOrder: ["read"] },
};

describe("the four reads are names the server dispatches on", () => {
  it("each is in the client's closed operation list, so a typo fails here rather than as a 404", () => {
    for (const name of ["listObjectsWithActions", "getObjectSecurityMatrix", "getRoleSecurity", "getPrincipalEffectiveAccess"]) {
      expect(ADMIN_READ_OPERATIONS, name).toContain(name);
      expect(isAdminOperation(name), name).toBe(true);
    }
    // And a plausible near-miss is still refused before it reaches the network.
    for (const name of ["getObjectSecurity", "listObjectActions", "getPrincipalAccess", "getEffectiveAccess"]) {
      expect(isAdminOperation(name), name).toBe(false);
    }
  });

  it("sends the operation and the input key the server requires, on the one endpoint", async () => {
    // The input key is the whole point of a named wrapper: `objectKey`, `roleKey` and `principalId`
    // are what the server's dispatcher calls requireString on, and spelling one of them wrong is an
    // INVALID_INPUT that only shows up at run time.
    const cases = [
      ["listObjectsWithActions", {}, (o) => listObjectsWithActions(o)],
      ["getObjectSecurityMatrix", { objectKey: "workOrder" }, (o) => getObjectSecurityMatrix("workOrder", o)],
      ["getRoleSecurity", { roleKey: "dispatcher" }, (o) => getRoleSecurity("dispatcher", o)],
      ["getPrincipalEffectiveAccess", { principalId: "prn-7" }, (o) => getPrincipalEffectiveAccess("prn-7", o)],
    ];
    for (const [operation, input, call] of cases) {
      const f = respond({ ok: true, data: null, tenantId: "taylor-az" });
      const out = await call(opts(f));
      const [url, init] = f.mock.calls[0];
      expect(url, operation).toBe("https://eos.example.test/admin/policy");
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer tok-123");
      expect(init.headers["content-type"]).toBe("application/json");
      expect(sent(f), operation).toEqual({ operation, input });
      // The result names the operation it answered, so a caller cannot mistake one read for another.
      expect(out.operation, operation).toBe(operation);
    }
  });

  it("states the tenant as a HEADER the server checks, never as part of the operation's input", async () => {
    const f = respond({ ok: true, data: OBJECT_MATRIX, tenantId: "taylor-az" });
    await getObjectSecurityMatrix("workOrder", opts(f, { tenantId: "taylor-az" }));
    const [, init] = f.mock.calls[0];
    expect(init.headers["x-eos-tenant"]).toBe("taylor-az");
    expect(sent(f).input).toEqual({ objectKey: "workOrder" });
    expect(sent(f).input).not.toHaveProperty("tenantId");
  });

  it("does not decide that a missing key is invalid -- the SERVER answers that", async () => {
    // A client that refused first would be a second validation model, and the two would drift. The
    // request goes out with the key absent and the server's INVALID_INPUT comes back unaltered.
    const f = respond({ ok: false, code: "INVALID_INPUT", message: "objectKey is required" }, 400);
    const out = await getObjectSecurityMatrix(undefined, opts(f));
    expect(sent(f)).toEqual({ operation: "getObjectSecurityMatrix", input: {} });
    expect(out).toEqual({ ok: false, code: "INVALID_INPUT", message: "objectKey is required" });
  });
});

describe("the server's projection is returned untouched", () => {
  it("listObjectsWithActions keeps every Object, including one nothing governs yet", async () => {
    const f = respond({ ok: true, data: OBJECTS_WITH_ACTIONS, tenantId: "taylor-az" });
    const out = await listObjectsWithActions(opts(f));
    expect(out).toEqual({ ok: true, data: OBJECTS_WITH_ACTIONS, tenantId: "taylor-az", operation: "listObjectsWithActions" });
    expect(out.data).toHaveLength(2);
    expect(out.data[1].actions).toEqual([]);
  });

  it("getObjectSecurityMatrix keeps the action nobody holds, with both grantee kinds", async () => {
    const f = respond({ ok: true, data: OBJECT_MATRIX, tenantId: "taylor-az" });
    const out = await getObjectSecurityMatrix("workOrder", opts(f));
    expect(out.data).toEqual(OBJECT_MATRIX);
    // Roles AND Principals, both reported; an ungranted action is an empty row, not a dropped one.
    expect(out.data.actions.map((a) => a.actionKey)).toEqual(["read", "dispatch"]);
    expect(out.data.actions[0].principalIds).toEqual(["prn-7"]);
    expect(out.data.actions[1].roleKeys).toEqual([]);
  });

  it("getRoleSecurity keeps the Role -> Object -> actions grouping as the server built it", async () => {
    const f = respond({ ok: true, data: ROLE_SECURITY, tenantId: "taylor-az" });
    const out = await getRoleSecurity("dispatcher", opts(f));
    expect(out.data).toEqual(ROLE_SECURITY);
  });

  it("getPrincipalEffectiveAccess keeps provenance, and gains no Work Eligibility or Employee fact", async () => {
    const f = respond({ ok: true, data: PRINCIPAL_ACCESS, tenantId: "taylor-az" });
    const out = await getPrincipalEffectiveAccess("prn-7", opts(f));
    expect(out.data).toEqual(PRINCIPAL_ACCESS);
    // Revoking a Role and revoking a direct grant are different acts; the source says which.
    expect(out.data.effective.map((c) => c.source)).toEqual(["ROLE", "ROLE_AND_DIRECT"]);
    // The client adds nothing the server deliberately left out: a business fact must never read as
    // a security grant.
    expect(Object.keys(out.data).sort()).toEqual(["directGrants", "effective", "objects", "principalId", "roles"]);
    for (const absent of ["workEligibility", "operationalScope", "employeeId", "employmentStatus"]) {
      expect(out.data, absent).not.toHaveProperty(absent);
    }
  });
});

describe("a refusal is a refusal, never an empty security answer", () => {
  it("forwards every server failure code, and never substitutes an empty list", async () => {
    for (const [status, code, message] of [
      [401, "UNAUTHENTICATED", "EOS does not recognise this identity"],
      [403, "FORBIDDEN", "you do not hold admin.principalAccess.read"],
      [404, "NOT_FOUND", "object not found"],
      [400, "INVALID_INPUT", "objectKey is required"],
      [500, "INTERNAL", "the request could not be completed"],
    ]) {
      const f = respond({ ok: false, code, message }, status);
      const out = await getObjectSecurityMatrix("workOrder", opts(f));
      expect(out, code).toEqual({ ok: false, code, message });
      expect(out.data, code).toBeUndefined();
      expect(Array.isArray(out.data), code).toBe(false);
    }
  });

  it("a code the client does not know is INTERNAL, not a silent success", async () => {
    const f = respond({ ok: false, code: "TEAPOT", message: "no" }, 418);
    expect(await getRoleSecurity("dispatcher", opts(f))).toEqual({ ok: false, code: "INTERNAL", message: "no" });
  });

  it("a refusal is RETURNED from every one of the four -- none of them throws", async () => {
    const f = respond({ ok: false, code: "FORBIDDEN", message: "no" }, 403);
    const results = await Promise.all([
      listObjectsWithActions(opts(f)),
      getObjectSecurityMatrix("workOrder", opts(f)),
      getRoleSecurity("dispatcher", opts(f)),
      getPrincipalEffectiveAccess("prn-7", opts(f)),
    ]);
    for (const out of results) expect(out).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("not configured, not signed in and unreachable stay three different answers", () => {
  it("NOT CONFIGURED never reaches the network, and is not an empty result", async () => {
    // The state every environment is in today: VITE_EOS_API_BASE_URL is absent. A screen that
    // rendered an empty security grid here would be lying about the tenant rather than about the
    // connection -- and on a security screen that reads as "nobody holds anything".
    const f = respond({ ok: true, data: [], tenantId: "t" });
    for (const call of [
      () => listObjectsWithActions({ baseUrl: null, getIdToken: async () => "t", fetchImpl: f }),
      () => getObjectSecurityMatrix("workOrder", { baseUrl: null, getIdToken: async () => "t", fetchImpl: f }),
      () => getRoleSecurity("dispatcher", { baseUrl: null, getIdToken: async () => "t", fetchImpl: f }),
      () => getPrincipalEffectiveAccess("prn-7", { baseUrl: null, getIdToken: async () => "t", fetchImpl: f }),
    ]) {
      const out = await call();
      expect(out.ok).toBe(false);
      expect(out.code).toBe("NOT_CONFIGURED");
      expect(out.data).toBeUndefined();
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("NOT SIGNED IN is distinct from NOT CONFIGURED and from a refusal", async () => {
    const f = respond({ ok: true, data: [], tenantId: "t" });
    expect(await listObjectsWithActions({ baseUrl: "https://x.test", getIdToken: async () => null, fetchImpl: f }))
      .toMatchObject({ ok: false, code: "NOT_SIGNED_IN" });
    expect(await listObjectsWithActions({ baseUrl: "https://x.test", getIdToken: async () => { throw new Error("x"); }, fetchImpl: f }))
      .toMatchObject({ ok: false, code: "NOT_SIGNED_IN" });
    expect(f).not.toHaveBeenCalled();
  });

  it("a network failure is UNREACHABLE, never FORBIDDEN", async () => {
    // Reporting an outage as a refusal would tell an administrator they lack authority they have.
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await getPrincipalEffectiveAccess("prn-7", opts(down))).toMatchObject({ ok: false, code: "UNREACHABLE" });
    const cancelled = vi.fn(async () => { const e = new Error("abort"); e.name = "AbortError"; throw e; });
    expect(await getPrincipalEffectiveAccess("prn-7", opts(cancelled))).toMatchObject({ ok: false, code: "UNREACHABLE" });
    const garbage = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }));
    expect(await getPrincipalEffectiveAccess("prn-7", opts(garbage))).toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("a 200 whose body does not say ok:true is not a success", async () => {
    const f = respond({ data: OBJECT_MATRIX });
    expect(await getObjectSecurityMatrix("workOrder", opts(f))).toMatchObject({ ok: false });
  });
});

describe("the injectable seam", () => {
  it("adminSecurityReads exposes exactly the four reads, and is frozen", () => {
    expect(Object.keys(adminSecurityReads).sort()).toEqual([
      "getObjectSecurityMatrix", "getPrincipalEffectiveAccess", "getRoleSecurity", "listObjectsWithActions",
    ]);
    expect(Object.isFrozen(adminSecurityReads)).toBe(true);
    // It is the same function, not a re-implementation that could drift.
    expect(adminSecurityReads.getRoleSecurity).toBe(getRoleSecurity);
  });

  it("every wrapper is callPolicyApi with a name bound -- one envelope, no second client", async () => {
    const f = respond({ ok: true, data: ROLE_SECURITY, tenantId: "taylor-az" });
    const direct = await callPolicyApi("getRoleSecurity", { roleKey: "dispatcher" }, opts(f));
    const g = respond({ ok: true, data: ROLE_SECURITY, tenantId: "taylor-az" });
    const wrapped = await getRoleSecurity("dispatcher", opts(g));
    expect(wrapped).toEqual(direct);
    expect(sent(g)).toEqual(sent(f));
  });
});
