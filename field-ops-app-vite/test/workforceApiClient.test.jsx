// THE WORKFORCE CLIENT -- the browser's route to the governed PostgreSQL Employee reads.
//
// Proved through injected fetch and token (no network, no Firebase call): the closed operation list mirrors the
// server's, the envelope is { operation, input }, the bearer and tenant header are sent, the auth scheme is the
// existing Administration API client's, and every refusal/outage maps to a distinct value -- never a throw.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  WORKFORCE_COMMAND_OPERATIONS,
  WORKFORCE_OPTIONAL_INPUT_OPERATIONS,
  WORKFORCE_READ_OPERATIONS,
  WORKFORCE_ROUTE,
  callWorkforceApi,
  isWorkforceOperation,
  workforceFailureCategory,
} from "../src/services/workforceApiClient.js";

const read = (rel) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

const respond = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
const opts = (fetchImpl, extra = {}) => ({ baseUrl: "https://eos.example.test/", getIdToken: async () => "tok-123", fetchImpl, ...extra });

describe("the closed operation list", () => {
  it("mirrors the server's WORKFORCE read runners exactly, and serves no EMP-RT-05 name", () => {
    const server = read("../functions/src/eosWorkforce/workforceHttp.ts");
    const block = server.slice(server.indexOf("const READ_RUNNERS"), server.indexOf("} as const);", server.indexOf("const READ_RUNNERS")));
    const names = [...block.matchAll(/^\s+([a-zA-Z]+):\s*read\(/gm)].map((m) => m[1]).sort();
    expect([...WORKFORCE_READ_OPERATIONS].sort()).toEqual(names);
    expect(server).toMatch(/WORKFORCE_ROUTE = "\/workforce\/employees"/);
    expect(WORKFORCE_ROUTE).toBe("/workforce/employees");
    expect([...WORKFORCE_OPTIONAL_INPUT_OPERATIONS].sort()).toEqual(["listEmployees", "readMyEmployeeProfile", "readMyWorkforceCapabilities"]);
    // Finding #17: the self capability read is served and is the only capability-shaped read.
    expect(WORKFORCE_READ_OPERATIONS.filter((n) => /capabilit/i.test(n))).toEqual(["readMyWorkforceCapabilities"]);
    expect(WORKFORCE_READ_OPERATIONS.some((n) => /assigned/i.test(n))).toBe(false);
    // EMP-RT-08 (Owner ruling): the Job Role reads are served -- business function only, under employee.record.read.
    expect(WORKFORCE_READ_OPERATIONS.filter((n) => /jobRole/i.test(n)).sort()).toEqual(["listEmployeeJobRoleHistory", "listEmployeesWithoutJobRole", "listJobRoles"]);
    // EMP-RT-H1: the governed Employee change history is served, and it is the only history read.
    expect(WORKFORCE_READ_OPERATIONS.filter((n) => /history/i.test(n)).sort()).toEqual([
      "listEmployeeChangeHistory", "listEmployeeJobRoleHistory", "listEmployeeOperationalScopeHistory", "listEmployeeWorkEligibilityHistory"]);
    // Step C: qualification and warehouse scope are served as SEPARATE reads -- neither is folded into the other.
    expect(WORKFORCE_READ_OPERATIONS.filter((n) => /eligibility/i.test(n)).sort()).toEqual(["listEmployeeWorkEligibility", "listEmployeeWorkEligibilityHistory"]);
    expect(WORKFORCE_READ_OPERATIONS.filter((n) => /scope/i.test(n)).sort()).toEqual(["listEmployeeOperationalScopeHistory", "listEmployeeOperationalScopes"]);
  });

  it("mirrors the server's WORKFORCE command runners exactly: the governed Employee commands, nothing else", () => {
    const server = read("../functions/src/eosWorkforce/workforceHttp.ts");
    const start = server.indexOf("const COMMAND_RUNNERS");
    const block = server.slice(start, server.indexOf("} as const);", start));
    const names = [...block.matchAll(/^\s+([a-zA-Z]+):\s*command\(/gm)].map((m) => m[1]);
    expect(names).toEqual(["updateEmployeeProfile", "establishReportingRelationship", "endReportingRelationship", "saveEmployeeEdit",
      "changeEmploymentStatus", "changeOperatingCompany", "createJobRole", "updateJobRole", "assignEmployeeJobRole",
      "assignEmployeeWorkEligibility", "endEmployeeWorkEligibility", "assignEmployeeOperationalScope", "endEmployeeOperationalScope"]);
    expect([...WORKFORCE_COMMAND_OPERATIONS]).toEqual(names);
    for (const name of [...WORKFORCE_READ_OPERATIONS, ...WORKFORCE_COMMAND_OPERATIONS]) expect(isWorkforceOperation(name), name).toBe(true);
    // No Security Role, generic patch or unserved writer is a name the browser can send.
    for (const name of ["setEmploymentStatus", "updateEmployee", "patchEmployee", "assignSecurityRole", "listEmployeeJobRoles", "updateEmployeeLifecycle", "", null, undefined, 42]) {
      expect(isWorkforceOperation(name), String(name)).toBe(false);
    }
  });

  it("a command travels in the same envelope as a read -- { operation, input }, bearer, no authority in the body", async () => {
    const fetchImpl = respond(200, { ok: true, operation: "updateEmployeeProfile", result: { outcome: "UPDATED", employeeId: "emp-1", changedFields: ["jobTitle"], auditEventId: "ae-1" } });
    const out = await callWorkforceApi("updateEmployeeProfile", { employeeId: "emp-1", changes: { jobTitle: "Lead" } }, opts(fetchImpl));
    expect(out).toMatchObject({ ok: true, operation: "updateEmployeeProfile", result: { outcome: "UPDATED" } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://eos.example.test/workforce/employees");
    expect(JSON.parse(init.body)).toEqual({ operation: "updateEmployeeProfile", input: { employeeId: "emp-1", changes: { jobTitle: "Lead" } } });
  });

  it("an unknown name never leaves the browser", async () => {
    const fetchImpl = respond(200, {});
    expect(await callWorkforceApi("listAssignedWorkForEmployee", {}, opts(fetchImpl))).toMatchObject({ ok: false, code: "UNKNOWN_OPERATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the request envelope", () => {
  it("POSTs { operation, input } to the Workforce route with the bearer and the stated tenant", async () => {
    const fetchImpl = respond(200, { ok: true, operation: "readEmployee", result: { employeeId: "emp-1" } });
    const out = await callWorkforceApi("readEmployee", { employeeId: "emp-1" }, opts(fetchImpl, { tenantId: "taylor-az" }));
    expect(out).toEqual({ ok: true, operation: "readEmployee", result: { employeeId: "emp-1" } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://eos.example.test/workforce/employees");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer tok-123");
    expect(init.headers["x-eos-tenant"]).toBe("taylor-az");
    expect(JSON.parse(init.body)).toEqual({ operation: "readEmployee", input: { employeeId: "emp-1" } });
  });

  it("an input-less read sends no input key, and no tenant header unless one is stated", async () => {
    const fetchImpl = respond(200, { ok: true, operation: "readMyEmployeeProfile", result: {} });
    await callWorkforceApi("readMyEmployeeProfile", undefined, opts(fetchImpl));
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ operation: "readMyEmployeeProfile" });
    expect(init.headers).not.toHaveProperty("x-eos-tenant");
  });

  it("reuses the existing Administration API client's base URL and ID-token helper -- no second auth scheme", () => {
    const src = read("src/services/workforceApiClient.js");
    expect(src).toMatch(/import \{ currentIdToken, policyApiBaseUrl \} from "\.\/adminPolicyApiClient\.js";/);
    expect(src).not.toMatch(/from\s+["']firebase/);
    expect(src).not.toMatch(/getIdTokenResult|claims/);
  });
});

describe("failures are values, each distinct", () => {
  it("not configured and not signed in never reach the network", async () => {
    const fetchImpl = respond(200, {});
    expect(await callWorkforceApi("listEmployees", undefined, { baseUrl: null, getIdToken: async () => "t", fetchImpl })).toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await callWorkforceApi("listEmployees", undefined, { baseUrl: "https://x.test", getIdToken: async () => null, fetchImpl })).toMatchObject({ code: "NOT_SIGNED_IN" });
    expect(await callWorkforceApi("listEmployees", undefined, { baseUrl: "https://x.test", getIdToken: async () => { throw new Error("x"); }, fetchImpl })).toMatchObject({ code: "NOT_SIGNED_IN" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP status + server code to a category and keeps the server's own reason", async () => {
    for (const [status, serverCode, category] of [
      [400, "INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT"],
      [401, "UNAUTHENTICATED", "UNAUTHENTICATED"],
      [403, "CAPABILITY_REQUIRED", "FORBIDDEN"],
      [404, "EMPLOYEE_NOT_FOUND", "NOT_FOUND"],
      [404, "UNKNOWN_OPERATION", "UNKNOWN_OPERATION"],
      [409, "EMPLOYEE_PRINCIPAL_LINK_AMBIGUOUS", "CONFLICT"],
      [412, "EMPLOYEE_PRINCIPAL_LINK_UNRESOLVED", "PRECONDITION_FAILED"],
      [413, "PAYLOAD_TOO_LARGE", "INVALID_INPUT"],
      [500, "INTERNAL", "INTERNAL"],
    ]) {
      const out = await callWorkforceApi("readEmployee", { employeeId: "e" }, opts(respond(status, { ok: false, code: serverCode, message: "m" })));
      expect(out, `${status} ${serverCode}`).toMatchObject({ ok: false, code: category, reason: serverCode, status, message: "m" });
      expect(workforceFailureCategory(status, serverCode)).toBe(category);
    }
  });

  it("a network failure is UNREACHABLE, never a refusal; an unparseable body is INTERNAL; nothing throws", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await callWorkforceApi("readEmployee", { employeeId: "e" }, opts(down))).toMatchObject({ ok: false, code: "UNREACHABLE" });
    const garbage = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }));
    expect(await callWorkforceApi("readEmployee", { employeeId: "e" }, opts(garbage))).toMatchObject({ ok: false, code: "INTERNAL", status: 502 });
    // A 200 whose body does not say ok:true is not a success.
    expect(await callWorkforceApi("readEmployee", { employeeId: "e" }, opts(respond(200, { result: {} })))).toMatchObject({ ok: false });
  });
});
