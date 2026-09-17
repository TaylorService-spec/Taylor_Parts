// FINDING #17 -- useWorkforceCapabilities: the Workforce offer from the PostgreSQL capability read, fail closed.
//
// Proved through an injected Workforce client (no network, no Firebase): granted only from a READY answer of exactly the
// governed shape; denied while loading, on refusal, outage, a throw, a malformed answer, and when signed out; re-read on
// reload and on a principal change; the closed id list mirrors the server's.
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MY_WORKFORCE_CAPABILITIES_OPERATION,
  WORKFORCE_CAPABILITY_IDS,
  WORKFORCE_CAPABILITY_STATE,
  useWorkforceCapabilities,
  workforceCapabilitiesFrom,
} from "../src/hooks/useWorkforceCapabilities.js";
import { WORKFORCE_CAPABILITY_REQUEST } from "../src/access/workforceCapabilityAccess.js";
import { WORKFORCE_OPTIONAL_INPUT_OPERATIONS, WORKFORCE_READ_OPERATIONS } from "../src/services/workforceApiClient.js";

afterEach(cleanup);

const ALL = ["employee.record.read", "admin.principalAccess.read", "admin.employeeProfile.write", "admin.employeeJobRole.write"];
const clientAnswering = (answer) => ({ call: vi.fn(async () => (typeof answer === "function" ? answer() : answer)) });

describe("the closed list and the operation", () => {
  it("mirrors the server's WORKFORCE_CAPABILITY_IDS exactly, and the operation is a served, input-less read", () => {
    // One list: the hook re-exports the pure access module's request set.
    expect(WORKFORCE_CAPABILITY_IDS).toBe(WORKFORCE_CAPABILITY_REQUEST);
    const server = readFileSync(path.resolve(process.cwd(), "../functions/src/eosWorkforce/reads/myWorkforceCapabilities.ts"), "utf8");
    const block = server.slice(server.indexOf("export const WORKFORCE_CAPABILITY_IDS"), server.indexOf("] as const);"));
    expect([...block.matchAll(/"([a-zA-Z.]+)"/g)].map((m) => m[1])).toEqual([...WORKFORCE_CAPABILITY_IDS]);
    expect([...WORKFORCE_CAPABILITY_IDS]).toEqual(ALL);
    expect(WORKFORCE_READ_OPERATIONS).toContain(MY_WORKFORCE_CAPABILITIES_OPERATION);
    expect(WORKFORCE_OPTIONAL_INPUT_OPERATIONS).toContain(MY_WORKFORCE_CAPABILITIES_OPERATION);
  });

  it("workforceCapabilitiesFrom accepts only { capabilities: [known ids] }", () => {
    expect([...workforceCapabilitiesFrom({ capabilities: ["employee.record.read"] })]).toEqual(["employee.record.read"]);
    expect([...workforceCapabilitiesFrom({ capabilities: [] })]).toEqual([]);
    for (const bad of [null, undefined, "x", [], {}, { capabilities: "admin.employeeProfile.write" }, { capabilities: [1] }, { capabilities: ["admin.userStatus.write"] }, { capabilities: ["employee.record.read", null] }]) {
      expect(workforceCapabilitiesFrom(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("useWorkforceCapabilities", () => {
  it("grants only what a READY answer lists; one call, no input", async () => {
    const client = clientAnswering({ ok: true, result: { capabilities: ["employee.record.read", "admin.employeeProfile.write"] } });
    const { result } = renderHook(() => useWorkforceCapabilities({ client, principalKey: "uid-a" }));
    expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.LOADING);
    for (const id of ALL) expect(result.current.has(id)).toBe(false);
    await waitFor(() => expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.READY));
    expect(result.current.has("admin.employeeProfile.write")).toBe(true);
    expect(result.current.has("employee.record.read")).toBe(true);
    expect(result.current.has("admin.employeeJobRole.write")).toBe(false);
    expect(result.current.has("admin.principalAccess.read")).toBe(false);
    expect(client.call.mock.calls).toEqual([[MY_WORKFORCE_CAPABILITIES_OPERATION, undefined]]);
  });

  it("denies on refusal, outage, a throw, a missing outcome and a malformed answer -- each a FAILED state with an error", async () => {
    for (const [label, answer, code] of [
      ["refusal", { ok: false, code: "FORBIDDEN", reason: "ACTOR_NOT_TENANT_MEMBER", status: 403 }, "FORBIDDEN"],
      ["outage", { ok: false, code: "UNREACHABLE" }, "UNREACHABLE"],
      ["not configured", { ok: false, code: "NOT_CONFIGURED" }, "NOT_CONFIGURED"],
      ["throw", () => { throw new Error("boom"); }, "INTERNAL"],
      ["undefined", undefined, "INTERNAL"],
      ["malformed", { ok: true, result: { capabilities: [...ALL, "admin.userStatus.write"] } }, "INTERNAL"],
      ["truthy-not-true ok", { ok: "yes", result: { capabilities: ALL } }, undefined],
    ]) {
      cleanup();
      const client = clientAnswering(answer);
      const { result } = renderHook(() => useWorkforceCapabilities({ client, principalKey: "uid-a" }));
      await waitFor(() => expect(result.current.status, label).toBe(WORKFORCE_CAPABILITY_STATE.FAILED));
      if (code) expect(result.current.error?.code, label).toBe(code);
      for (const id of ALL) expect(result.current.has(id), `${label} ${id}`).toBe(false);
    }
  });

  it("signed out (principalKey null) is denied without calling the service", async () => {
    const client = clientAnswering({ ok: true, result: { capabilities: ALL } });
    const { result } = renderHook(() => useWorkforceCapabilities({ client, principalKey: null }));
    await waitFor(() => expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.FAILED));
    expect(result.current.error.code).toBe("NOT_SIGNED_IN");
    for (const id of ALL) expect(result.current.has(id)).toBe(false);
    expect(client.call).not.toHaveBeenCalled();
  });

  it("reload re-reads; a principal change re-reads and drops the previous principal's grant while loading", async () => {
    let answer = { ok: true, result: { capabilities: ALL } };
    let release;
    const client = { call: vi.fn(async () => answer) };
    const { result, rerender } = renderHook(({ principalKey }) => useWorkforceCapabilities({ client, principalKey }), { initialProps: { principalKey: "uid-a" } });
    await waitFor(() => expect(result.current.has("admin.employeeProfile.write")).toBe(true));

    answer = { ok: false, code: "UNREACHABLE" };
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.FAILED));
    expect(result.current.has("admin.employeeProfile.write")).toBe(false);

    answer = new Promise((resolve) => { release = resolve; });
    client.call.mockImplementation(() => answer);
    rerender({ principalKey: "uid-b" });
    await waitFor(() => expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.LOADING));
    for (const id of ALL) expect(result.current.has(id)).toBe(false);
    await act(async () => release({ ok: true, result: { capabilities: ["employee.record.read"] } }));
    await waitFor(() => expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.READY));
    expect(result.current.has("employee.record.read")).toBe(true);
    expect(result.current.has("admin.employeeProfile.write")).toBe(false);
    expect(client.call).toHaveBeenCalledTimes(3);
  });

  it("a late answer for a previous principal never lands", async () => {
    const resolvers = [];
    const client = { call: vi.fn(() => new Promise((resolve) => resolvers.push(resolve))) };
    const { result, rerender } = renderHook(({ principalKey }) => useWorkforceCapabilities({ client, principalKey }), { initialProps: { principalKey: "uid-admin" } });
    await waitFor(() => expect(resolvers).toHaveLength(1));
    rerender({ principalKey: "uid-tech" });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => resolvers[1]({ ok: true, result: { capabilities: [] } }));
    await act(async () => resolvers[0]({ ok: true, result: { capabilities: ALL } }));
    expect(result.current.status).toBe(WORKFORCE_CAPABILITY_STATE.READY);
    for (const id of ALL) expect(result.current.has(id)).toBe(false);
  });

  it("static: no Firebase, no feed, no authority sent", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/hooks/useWorkforceCapabilities.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toMatch(/firebase|firestore|httpsCallable|useReportCapabilities|hasCapability|resolveEffectiveAccess/i);
    expect(src).toMatch(/client\.call\(MY_WORKFORCE_CAPABILITIES_OPERATION, undefined\)/);
  });
});
