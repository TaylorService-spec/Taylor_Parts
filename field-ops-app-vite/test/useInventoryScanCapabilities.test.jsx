// P1-2 WAREHOUSE SCAN -- useInventoryScanCapabilities: the Scan workspace's offer comes from the caller's EOS capability
// set (resolveMyCapabilities, POST /operations/inventory), the authority the scan commands authorize from -- never the
// shell's Firebase feed. Fail closed in every state that is not a well-formed answer for the current principal.
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { INVENTORY_SCAN_CAPABILITY_STATE, useInventoryScanCapabilities } from "../src/access/useInventoryScanCapabilities.js";
import {
  INVENTORY_SCAN_CAPABILITY_REQUEST, MOVE_STOCK_SEND_TO_TRUCK_CAPABILITY, MY_INVENTORY_SCAN_CAPABILITIES_OPERATION,
  inventoryScanCapabilitiesFrom,
} from "../src/access/inventoryScanCapabilityAccess.js";
import { SCAN_WORKFLOW_CAPABILITY_IDS } from "../src/access/scanWorkflows.js";
import { OPERATIONS_READ_OPERATIONS, OPERATIONS_ROUTE_BY_OPERATION } from "../src/services/operationsApiClient.js";

afterEach(cleanup);

const SRC = (rel) => readFileSync(path.resolve(process.cwd(), "src", rel), "utf8");
const clientAnswering = (answer) => ({ call: vi.fn(async () => (typeof answer === "function" ? answer() : answer)) });
const WAREHOUSE_ASSOCIATE = ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.cycleCount.create",
  "inventory.cycleCount.submit", "inventory.placement.record", "inventory.stock.relocate", "warehouse.record.read",
  "inventory.transaction.read"];
const ready = (capabilities) => ({ ok: true, operation: "resolveMyCapabilities", result: { tenantId: "t", uid: "p", heldRoleKeys: [], capabilities } });

describe("the operation and the projection", () => {
  it("asks the served Operations read resolveMyCapabilities (POST /operations/inventory)", () => {
    expect(MY_INVENTORY_SCAN_CAPABILITIES_OPERATION).toBe("resolveMyCapabilities");
    expect(OPERATIONS_READ_OPERATIONS).toContain(MY_INVENTORY_SCAN_CAPABILITIES_OPERATION);
    expect(OPERATIONS_ROUTE_BY_OPERATION.resolveMyCapabilities).toBe("/operations/inventory");
  });

  it("keeps exactly the scan keys: the workflow gates plus Move stock's send-to-truck key", () => {
    expect([...INVENTORY_SCAN_CAPABILITY_REQUEST]).toEqual([...SCAN_WORKFLOW_CAPABILITY_IDS, MOVE_STOCK_SEND_TO_TRUCK_CAPABILITY]);
    // every literal MoveStockScan consults is kept, so its in-screen choices are not silently darkened
    const moveStock = SRC("modules/scan/MoveStockScan.jsx");
    for (const [, id] of moveStock.matchAll(/holds\("([^"]+)"\)/g)) expect(INVENTORY_SCAN_CAPABILITY_REQUEST).toContain(id);
  });

  it("inventoryScanCapabilitiesFrom keeps only scan keys and refuses every malformed shape", () => {
    expect([...inventoryScanCapabilitiesFrom({ capabilities: ["inventory.placement.record", "admin.userStatus.write"] })])
      .toEqual(["inventory.placement.record"]);
    expect([...inventoryScanCapabilitiesFrom({ capabilities: [] })]).toEqual([]);
    for (const bad of [null, undefined, [], "x", 7, {}, { capabilities: "inventory.placement.record" }, { capabilities: null },
      { capabilities: [1] }, { capabilities: ["inventory.placement.record", null] }, { capabilities: [""] }]) {
      expect(inventoryScanCapabilitiesFrom(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("useInventoryScanCapabilities -- fail closed", () => {
  it("offers exactly what a READY answer holds, asked once; nothing while loading; non-scan keys never", async () => {
    const client = clientAnswering(ready([...WAREHOUSE_ASSOCIATE, "admin.userStatus.write"]));
    const { result } = renderHook(() => useInventoryScanCapabilities({ uid: "u1" }, { client }));
    expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.LOADING);
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false); // loading: nothing offered
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.READY));
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalledWith(MY_INVENTORY_SCAN_CAPABILITIES_OPERATION);
    for (const id of WAREHOUSE_ASSOCIATE) expect(result.current.hasCapability(id)).toBe(true);
    expect(result.current.hasCapability("admin.userStatus.write")).toBe(false);
    expect(result.current.hasCapability("inventory.stock.receive")).toBe(false);
  });

  it("a REFUSED read offers nothing and keeps the refusal", async () => {
    const refusal = { ok: false, code: "FORBIDDEN", reason: "NO_PRINCIPAL", status: 403, message: "no" };
    const client = clientAnswering(refusal);
    const { result } = renderHook(() => useInventoryScanCapabilities({ uid: "u1" }, { client }));
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.FAILED));
    expect(result.current.error).toEqual(refusal);
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false);
  });

  it("a THROWN / network failure offers nothing", async () => {
    const client = { call: vi.fn(async () => { throw new Error("offline"); }) };
    const { result } = renderHook(() => useInventoryScanCapabilities({ uid: "u1" }, { client }));
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.FAILED));
    expect(result.current.hasCapability("inventory.transfer.dispatch")).toBe(false);
  });

  it.each([
    ["no outcome", undefined],
    ["ok without result", { ok: true }],
    ["non-array capabilities", { ok: true, result: { capabilities: "inventory.placement.record" } }],
    ["non-string entry", { ok: true, result: { capabilities: ["inventory.placement.record", 3] } }],
    ["array result", { ok: true, result: ["inventory.placement.record"] }],
  ])("a MALFORMED answer (%s) offers nothing", async (_label, answer) => {
    const client = clientAnswering(answer);
    const { result } = renderHook(() => useInventoryScanCapabilities({ uid: "u1" }, { client }));
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.FAILED));
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false);
  });

  it.each([["null user", null], ["no uid", {}], ["empty uid", { uid: "" }]])("SIGNED OUT (%s): never asks, offers nothing", async (_l, user) => {
    const client = clientAnswering(ready(WAREHOUSE_ASSOCIATE));
    const { result } = renderHook(() => useInventoryScanCapabilities(user, { client }));
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.FAILED));
    expect(result.current.error.code).toBe("NOT_SIGNED_IN");
    expect(client.call).not.toHaveBeenCalled();
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false);
  });

  it("a PRINCIPAL SWITCH never renders the previous principal's grant, and re-asks", async () => {
    let answer = ready(WAREHOUSE_ASSOCIATE);
    let release;
    const client = { call: vi.fn(() => (answer === "pending" ? new Promise((r) => { release = r; }) : Promise.resolve(answer))) };
    const { result, rerender } = renderHook(({ user }) => useInventoryScanCapabilities(user, { client }), { initialProps: { user: { uid: "a" } } });
    await waitFor(() => expect(result.current.hasCapability("inventory.placement.record")).toBe(true));
    answer = "pending";
    rerender({ user: { uid: "b" } });
    expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.LOADING);
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false);
    await waitFor(() => expect(client.call).toHaveBeenCalledTimes(2));
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false); // still asking for "b"
    await act(async () => release(ready([])));
    await waitFor(() => expect(result.current.status).toBe(INVENTORY_SCAN_CAPABILITY_STATE.READY));
    expect(result.current.hasCapability("inventory.placement.record")).toBe(false);
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("is EOS-only: the hook and its projection never touch Firebase or the legacy effective-access feed", () => {
    for (const rel of ["access/useInventoryScanCapabilities.js", "access/inventoryScanCapabilityAccess.js"]) {
      const code = SRC(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, rel).not.toMatch(/firebase|resolveEffectiveAccess|useReportCapabilities|httpsCallable/i);
    }
  });
});

describe("STATIC GUARD -- no Scan mount reads the shell feed", () => {
  const app = SRC("App.jsx");
  const fn = (name) => {
    const start = app.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    const next = app.indexOf("\nfunction ", start + 1);
    // executable lines only: a neighbouring JSDoc that NAMES the shell feed is not a read of it
    return app.slice(start, next === -1 ? undefined : next).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  };

  it("every Scan mount surface takes its gate from useInventoryScanCapabilities, never operationalContext", () => {
    expect(app).toMatch(/import \{ useInventoryScanCapabilities \} from "\.\/access\/useInventoryScanCapabilities\.js";/);
    expect(fn("useScanCapabilityGate")).toMatch(/useInventoryScanCapabilities\(user\)/);
    for (const surface of ["ScanWorkspaceSurface", "WarehouseWorkspaceSurface", "TechnicianWorkspaceSurface"]) {
      const body = fn(surface);
      expect(body, surface).toMatch(/useScanCapabilityGate\(\)/);
      expect(body, surface).not.toMatch(/operationalContext/);
    }
  });

  it("ScanWorkspace / WarehouseShell / TechnicianShell are mounted only inside those surfaces, and never with the shell feed", () => {
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    for (const mount of ["<ScanWorkspace", "<WarehouseShell", "<TechnicianShell"]) {
      const sites = code.filter((l) => l.includes(mount));
      expect(sites.length, mount).toBeGreaterThan(0);
      for (const l of sites) expect(l, mount).not.toMatch(/operationalContext/);
    }
    let outside = code.join("\n");
    for (const surface of ["ScanWorkspaceSurface", "WarehouseWorkspaceSurface", "TechnicianWorkspaceSurface"]) {
      const body = fn(surface);
      expect(outside.includes(body), surface).toBe(true);
      outside = outside.replace(body, "");
    }
    for (const mount of ["<ScanWorkspace ", "<WarehouseShell ", "<TechnicianShell "]) expect(outside.includes(mount), mount).toBe(false);
    // the three routes render the surfaces, without threading operationalContext into them
    expect(app).toMatch(/item\.key === "scan"\) \{\s*return <ScanWorkspaceSurface role=\{role\} \/>;/);
    expect(app).toMatch(/return <WarehouseWorkspaceSurface role=\{role\} \/>;/);
    expect(app).toMatch(/return <TechnicianWorkspaceSurface role=\{role\} \/>;/);
  });
});
