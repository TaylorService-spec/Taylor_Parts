// H14 -- hooks/useWorkOrder.js and hooks/useLocation.js used to pass NO error
// callback to onSnapshot at all, so a DENIED or failed read never resolved --
// `loading` stayed true forever, with no error surfaced and nothing for a
// consumer to check. WorkOrderDetailPage.jsx's "Loading work order…" spun
// indefinitely with no recovery.
//
// Both hooks now mirror useAccount.js's single-document doc()/onSnapshot
// contract: { workOrder|location, loading, error, retry }. A failed read
// clears any stale data, sets a safe categorized `error`
// (domain/loadErrorMessage.js -- never a raw code/path/id), and stops
// loading; retry() forces a clean re-subscription.
//
// vitest + @testing-library/react (jsdom). Firebase is fully mocked; the
// mocked onSnapshot captures the success/error callbacks so the test can
// drive each path directly, exactly as test/inventoryRoleReadErrorContract.test.jsx
// already does for the collection-read hooks.
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

// No Firestore listener is exercised any more (useWorkOrder is on the governed route, useLocation on
// the CRM route); the Firebase modules are stubbed only so nothing initializes a real SDK on import.
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...pathParts) => ({ path: pathParts.join("/") }),
  onSnapshot: () => () => {},
}));

import { useWorkOrder } from "../src/hooks/useWorkOrder";
import { __setWorkOrderTransportForTests } from "../src/services/workOrderService";
const mockCrm = vi.fn();
vi.mock("../src/services/crmApiClient.js", async (orig) => ({ ...(await orig()), callCrmApi: (...args) => mockCrm(...args) }));
import { useLocation } from "../src/hooks/useLocation";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Work Order cutover: useWorkOrder reads the GOVERNED detail (readWorkOrder) through
// services/workOrderService.ts -- no Firestore document listener. The transport is injected at the
// service's test seam, so each outcome (denied / confirmed absence / NOT_ACTIVATED / retry) is driven
// directly. The H14 contract is unchanged: a failed read never hangs, never reads as "no such Work Order".
describe("useWorkOrder -- read-error contract (H14), served by the governed EOS route", () => {
  afterEach(() => __setWorkOrderTransportForTests(null));

  it("starts loading with no error", () => {
    __setWorkOrderTransportForTests(() => new Promise(() => {}));
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "FORBIDDEN", reason: "DENIED", status: 403, message: "raw" }));
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("You do not have permission to view these work orders.");
    expect(result.current.workOrder).toBe(null);
  });

  it("a confirmed absence (successful read, no such Work Order) is distinct from a failed read", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_FOUND", reason: "WORK_ORDER_NOT_FOUND", status: 404, message: "x" }));
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.workOrder).toBe(null);
  });

  it("NOT_ACTIVATED is its own state -- NOT_YET_ACTIVATED copy, never 'no such work order'", async () => {
    __setWorkOrderTransportForTests(async () => ({ ok: false, code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED", status: 503, message: "x" }));
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notActivated).toBe(true);
    expect(result.current.error).toMatch(/NOT_YET_ACTIVATED/);
  });

  it("retry() re-reads and clears the error", async () => {
    let answer = { ok: false, code: "UNREACHABLE", reason: null, status: null, message: "x" };
    const call = vi.fn(async () => answer);
    __setWorkOrderTransportForTests(call);
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.error).toContain("Can't reach the server"));
    answer = { ok: true, operation: "readWorkOrder", result: { workOrderId: "wo-1", workOrderNumber: "WO-1", status: "CREATED",
      createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" } };
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.workOrder?.id).toBe("wo-1"));
    expect(result.current.error).toBe(null);
    expect(call.mock.calls.every(([op]) => op === "readWorkOrder")).toBe(true);
  });
});

describe("useLocation -- read-error contract (H14), served by the CRM EOS API", () => {
  it("starts loading with no error", () => {
    mockCrm.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLocation("loc-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", async () => {
    mockCrm.mockResolvedValue({ ok: false, code: "CAPABILITY_REQUIRED", message: "this read requires customer.record.read" });
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("You do not have permission to view these locations.");
    expect(result.current.location).toBe(null);
  });

  it("a confirmed absence (successful read, no such site) is distinct from a failed read", async () => {
    mockCrm.mockResolvedValue({ ok: false, code: "ACCOUNT_LOCATION_NOT_FOUND", message: "no such site" });
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.location).toBe(null);
  });
});
