// The optional-read hooks honour `readable` (access map): false asks nothing and states the absence, null asks nothing and is loading (vitest + jsdom).
// Run: npx vitest run test/gatedReadHooks.test.jsx
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../src/services/workOrderService", () => ({ listWorkOrders: vi.fn(async () => ({ items: [], truncated: false })), getWorkOrder: vi.fn(async () => null) }));

import { listWorkOrders } from "../src/services/workOrderService";
import { useInventoryLedger } from "../src/hooks/useInventoryLedger.js";
import { BALANCE_STATUS, usePartBalance } from "../src/hooks/usePartBalance.js";
import { usePartIdentifiers } from "../src/hooks/usePartIdentifiers.js";
import { PART_WORK_ORDER_DEMAND_STATE, usePartWorkOrderDemand } from "../src/hooks/usePartWorkOrderDemand.js";

describe("useInventoryLedger({ readable })", () => {
  const deps = () => ({ fetchInventoryPosition: vi.fn(async () => ({ totals: [] })), fetchInventoryMovements: vi.fn(async () => ({ items: [] })) });

  it("false: nothing is asked; a settled, stated failure the screens already render", () => {
    const d = deps();
    const { result } = renderHook(() => useInventoryLedger({ readable: false, deps: d }));
    expect(d.fetchInventoryPosition).not.toHaveBeenCalled();
    expect(d.fetchInventoryMovements).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: false, transactions: [], healthEntries: [] });
    expect(result.current.error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("null: nothing is asked; loading", () => {
    const d = deps();
    const { result } = renderHook(() => useInventoryLedger({ readable: null, deps: d }));
    expect(d.fetchInventoryPosition).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ loading: true, error: null });
  });

  it("true (and the default): asks both reads and answers", async () => {
    const d = deps();
    const { result } = renderHook(() => useInventoryLedger({ deps: d }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(d.fetchInventoryPosition).toHaveBeenCalledTimes(1);
    expect(d.fetchInventoryMovements).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});

describe("usePartBalance(partId, { readable })", () => {
  it("false: DENIED, nothing asked; null: LOADING, nothing asked; true: asked", async () => {
    const fetchBalance = vi.fn(async () => ({ onHand: { state: "KNOWN", value: 1 } }));
    expect(renderHook(() => usePartBalance("P-1", { ready: true, fetchBalance, readable: false })).result.current).toEqual({ status: BALANCE_STATUS.DENIED, balance: null });
    expect(renderHook(() => usePartBalance("P-1", { ready: true, fetchBalance, readable: null })).result.current).toEqual({ status: BALANCE_STATUS.LOADING, balance: null });
    expect(fetchBalance).not.toHaveBeenCalled();
    const asked = renderHook(() => usePartBalance("P-1", { ready: true, fetchBalance, readable: true }));
    await waitFor(() => expect(asked.result.current.status).toBe(BALANCE_STATUS.READY));
    expect(fetchBalance).toHaveBeenCalledTimes(1);
  });

  it("OFF (the environment has not switched the read on) is still OFF whatever the session says", () => {
    const fetchBalance = vi.fn();
    expect(renderHook(() => usePartBalance("P-1", { ready: false, fetchBalance, readable: false })).result.current.status).toBe(BALANCE_STATUS.OFF);
    expect(fetchBalance).not.toHaveBeenCalled();
  });
});

describe("usePartIdentifiers(partId, deps, readable)", () => {
  const client = () => ({ listPartAliases: vi.fn(async () => ({ result: { aliases: [{ aliasId: "A" }], truncated: false } })) });

  it("false: denied with the stated absence, the list is never requested", () => {
    const c = client();
    const { result } = renderHook(() => usePartIdentifiers("P-1", { client: c }, false));
    expect(c.listPartAliases).not.toHaveBeenCalled();
    expect(result.current.status).toBe("denied");
    expect(result.current.aliases).toEqual([]);
  });

  it("null: loading, never requested; true: requested", async () => {
    const waiting = client();
    expect(renderHook(() => usePartIdentifiers("P-1", { client: waiting }, null)).result.current.status).toBe("loading");
    expect(waiting.listPartAliases).not.toHaveBeenCalled();
    const asked = client();
    const { result } = renderHook(() => usePartIdentifiers("P-1", { client: asked }, true));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(asked.listPartAliases).toHaveBeenCalledTimes(1);
  });

  it("null -> true asks exactly when the session answers", async () => {
    const c = client();
    const { result, rerender } = renderHook(({ readable }) => usePartIdentifiers("P-1", { client: c }, readable), { initialProps: { readable: null } });
    expect(c.listPartAliases).not.toHaveBeenCalled();
    rerender({ readable: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(c.listPartAliases).toHaveBeenCalledTimes(1);
  });
});

describe("usePartWorkOrderDemand(partId, { readable })", () => {
  it("false: DENIED and nothing asked; null: LOADING and nothing asked; true: asked", async () => {
    listWorkOrders.mockClear();
    expect(renderHook(() => usePartWorkOrderDemand("P-1", { readable: false })).result.current.status).toBe(PART_WORK_ORDER_DEMAND_STATE.DENIED);
    expect(renderHook(() => usePartWorkOrderDemand("P-1", { readable: null })).result.current.status).toBe(PART_WORK_ORDER_DEMAND_STATE.LOADING);
    expect(listWorkOrders).not.toHaveBeenCalled();
    const asked = renderHook(() => usePartWorkOrderDemand("P-1", { readable: true }));
    await waitFor(() => expect(asked.result.current.status).toBe(PART_WORK_ORDER_DEMAND_STATE.READY));
    expect(listWorkOrders).toHaveBeenCalledTimes(1);
  });
});
