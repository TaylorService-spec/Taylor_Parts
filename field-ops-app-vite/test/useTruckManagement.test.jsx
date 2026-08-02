// EI Truck Registry -- behavior tests for useTruckManagement (vitest + jsdom via renderHook).
// Proves the two gates (role + write-readiness) short-circuit BEFORE any callable, success
// maps to OK + reconcile, errors are sanitized, a missing/throwing client fails closed, and
// a completion that lands after an access-boundary change is discarded (stale).
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { useTruckManagement } from "../src/hooks/useTruckManagement.js";
import { TRUCK_COMMAND_OUTCOME } from "../src/domain/truckManagement.js";

const nextTick = () => new Promise((r) => setTimeout(r, 0));

// A component that exposes the hook result to the test via a callback, and (crucially) records
// only NON-stale outcomes as "visible management state" -- exactly how the modal/drawer gate on
// result.stale. Lets the regression assert a stale completion never becomes visible.
function Harness({ accessVersion, client, onReconcile, onReady, applied }) {
  const mgmt = useTruckManagement({ accessVersion, canManage: true, writeReadyOverride: true, client, keyFactory: () => "key-1", onReconcile });
  onReady(mgmt);
  applied.access = accessVersion;
  return null;
}

function spyClient() {
  return {
    createTruck: vi.fn(async () => ({ truckId: "T", version: 1 })),
    assignDriver: vi.fn(async () => ({ truckId: "T", version: 2 })),
    reassignDriver: vi.fn(async () => ({ truckId: "T", version: 2 })),
    unassignDriver: vi.fn(async () => ({ truckId: "T", version: 2 })),
    changeStatus: vi.fn(async () => ({ truckId: "T", version: 2 })),
    changeHomeWarehouse: vi.fn(async () => ({ truckId: "T", version: 2 })),
    deactivateTruck: vi.fn(async () => ({ truckId: "T", version: 2 })),
    reactivateTruck: vi.fn(async () => ({ truckId: "T", version: 2 })),
  };
}
const KEY = () => "key-1";

describe("useTruckManagement gating", () => {
  it("readiness override false: every command is blocked and invokes NO callable", async () => {
    const client = spyClient();
    const onReconcile = vi.fn();
    const { result } = renderHook(() =>
      useTruckManagement({ accessVersion: "v1", canManage: true, writeReadyOverride: false, client, keyFactory: KEY, onReconcile })
    );
    expect(result.current.writeReady).toBe(false);
    expect(result.current.enabled).toBe(false);

    const c = result.current.commands;
    let outcomes;
    await act(async () => {
      outcomes = await Promise.all([
        c.createTruck({ truckId: "T", locationId: "L", homeWarehouseId: "W", status: "ACTIVE", displayLabel: "d", vehicleNumber: "v" }),
        c.assignDriver({ truckId: "T", employeeId: "E", expectedVersion: 1 }),
        c.changeStatus({ truckId: "T", status: "IDLE", expectedVersion: 1 }),
        c.deactivateTruck({ truckId: "T", expectedVersion: 1 }),
      ]);
    });
    for (const key of Object.keys(client)) expect(client[key]).not.toHaveBeenCalled();
    expect(onReconcile).not.toHaveBeenCalled();
    expect(outcomes.every((o) => o.blocked)).toBe(true);
  });

  it("canManage=false: DENIED with no callable, even when write-ready", async () => {
    const client = spyClient();
    const { result } = renderHook(() =>
      useTruckManagement({ accessVersion: "v1", canManage: false, writeReadyOverride: true, client, keyFactory: KEY })
    );
    let out;
    await act(async () => {
      out = await result.current.commands.assignDriver({ truckId: "T", employeeId: "E", expectedVersion: 1 });
    });
    expect(out.kind).toBe(TRUCK_COMMAND_OUTCOME.DENIED);
    expect(client.assignDriver).not.toHaveBeenCalled();
  });
});

describe("useTruckManagement enabled behavior", () => {
  it("success: invokes the callable with a stamped idempotency key and reconciles", async () => {
    const client = spyClient();
    const onReconcile = vi.fn();
    const { result } = renderHook(() =>
      useTruckManagement({ accessVersion: "v1", canManage: true, writeReadyOverride: true, client, keyFactory: KEY, onReconcile })
    );
    let out;
    await act(async () => {
      out = await result.current.commands.assignDriver({ truckId: "T", employeeId: "E", expectedVersion: 3 });
    });
    expect(out.kind).toBe(TRUCK_COMMAND_OUTCOME.OK);
    expect(client.assignDriver).toHaveBeenCalledWith({ idempotencyKey: "key-1", truckId: "T", employeeId: "E", expectedVersion: 3 });
    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it("error: an aborted callable maps to the reload-required conflict outcome", async () => {
    const client = spyClient();
    client.changeStatus = vi.fn(async () => {
      const e = new Error("stale version 7 vs 8 internal");
      e.code = "functions/aborted";
      throw e;
    });
    const onReconcile = vi.fn();
    const { result } = renderHook(() =>
      useTruckManagement({ accessVersion: "v1", canManage: true, writeReadyOverride: true, client, keyFactory: KEY, onReconcile })
    );
    let out;
    await act(async () => {
      out = await result.current.commands.changeStatus({ truckId: "T", status: "IDLE", expectedVersion: 7 });
    });
    expect(out.kind).toBe(TRUCK_COMMAND_OUTCOME.CONFLICT);
    expect(out.message).not.toContain("internal");
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it("a missing/throwing client method fails closed (sanitized, no reconcile)", async () => {
    const client = { ...spyClient(), unassignDriver: undefined };
    const onReconcile = vi.fn();
    const { result } = renderHook(() =>
      useTruckManagement({ accessVersion: "v1", canManage: true, writeReadyOverride: true, client, keyFactory: KEY, onReconcile })
    );
    let out;
    await act(async () => {
      out = await result.current.commands.unassignDriver({ truckId: "T", expectedVersion: 1 });
    });
    expect([TRUCK_COMMAND_OUTCOME.FAILURE, TRUCK_COMMAND_OUTCOME.UNAVAILABLE]).toContain(out.kind);
    expect(onReconcile).not.toHaveBeenCalled();
  });

  // Regression for the Codex P2: with the boundary synchronized only in a useEffect, an in-flight
  // v1 command could resolve in the window AFTER the v2 render commits but BEFORE its passive
  // effect runs, and be wrongly accepted (reconciling under the new boundary). We reproduce that
  // exact window with a real (non-act) concurrent root: after committing the v2 render, a single
  // macrotask flushes the render (and the render-time boundary write) but NOT the passive effect.
  // On the buggy version this asserts stale=undefined / reconcile called; on the fix, stale=true /
  // no reconcile / no visible state applied.
  it("stale (pre-effect window): a v1 completion after the v2 render commit but before its effect is discarded", async () => {
    const prevActEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false; // real async scheduling (render task before effect task)
    try {
      let resolveCall;
      const deferred = new Promise((res) => { resolveCall = res; });
      const client = { ...spyClient(), assignDriver: vi.fn(() => deferred) };
      const onReconcile = vi.fn();
      let commands;
      const applied = { access: undefined, visible: null };
      const onReady = (m) => { commands = m.commands; };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);

      root.render(<Harness accessVersion="v1" client={client} onReconcile={onReconcile} onReady={onReady} applied={applied} />);
      await nextTick();
      await nextTick();

      // Start the command under v1.
      const pending = commands.assignDriver({ truckId: "T", employeeId: "E", expectedVersion: 1 });

      // Commit the v2 render; one macrotask flushes render (+ the render-time boundary capture)
      // but not the passive effect -- the exact production window.
      root.render(<Harness accessVersion="v2" client={client} onReconcile={onReconcile} onReady={onReady} applied={applied} />);
      await nextTick();

      resolveCall({ truckId: "T", version: 2 });
      const out = await pending;
      // A well-behaved consumer applies only non-stale outcomes to visible state.
      if (!out.stale) applied.visible = out;

      expect(out.stale).toBe(true);
      expect(onReconcile).not.toHaveBeenCalled();
      expect(applied.visible).toBeNull(); // prior-scope completion never alters visible management state

      root.unmount();
      container.remove();
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    }
  });

  it("stale: a completion after an accessVersion change is discarded (no reconcile)", async () => {
    let resolveCall;
    const deferred = new Promise((res) => { resolveCall = res; });
    const client = { ...spyClient(), assignDriver: vi.fn(() => deferred) };
    const onReconcile = vi.fn();
    const { result, rerender } = renderHook(
      ({ av }) => useTruckManagement({ accessVersion: av, canManage: true, writeReadyOverride: true, client, keyFactory: KEY, onReconcile }),
      { initialProps: { av: "v1" } }
    );
    let pending;
    act(() => {
      pending = result.current.commands.assignDriver({ truckId: "T", employeeId: "E", expectedVersion: 1 });
    });
    // Access boundary shifts before the callable resolves.
    rerender({ av: "v2" });
    let out;
    await act(async () => {
      resolveCall({ truckId: "T", version: 2 });
      out = await pending;
    });
    expect(out.stale).toBe(true);
    expect(onReconcile).not.toHaveBeenCalled();
  });
});
