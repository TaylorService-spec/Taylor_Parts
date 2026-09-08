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
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";

let capturedNext;
let capturedError;
let unsubscribeCount;
vi.mock("../src/firebase/firebase", () => ({ db: {}, functions: {} }));

// useLocation is no longer a Firestore subscription -- it reads the governed `locationsByIds`
// source. Its half of this contract is unchanged and still worth guarding: DENIED, a failed read
// and a CONFIRMED ABSENCE must stay three distinguishable outcomes. Only the seam moved, so the
// mock moved with it. useWorkOrder is still onSnapshot (the work-order family is blocked pending
// the technician/self-scope seam) and keeps the callback-capturing mock below.
let governedResult = { ok: true, result: "OK", items: [], nextCursor: null, hasMore: false };
// useWorkOrder now reads by id through the SCOPED work-order seam -- the one read whose authority
// is not global. Its half of this contract is unchanged and still worth guarding: DENIED, a failed
// read and a CONFIRMED ABSENCE stay three distinguishable outcomes. Only the seam moved.
let scopedResult = { ok: true, result: "OK", workOrder: null, scope: "GLOBAL" };
vi.mock("../src/access/scopedWorkOrderClient.js", () => ({
  WORK_ORDER_READ_RESULT: { OK: "OK", DENIED: "DENIED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" },
  readScopedWorkOrderById: async () => scopedResult,
}));
vi.mock("../src/access/governedCollectionClient.js", () => ({
  READ_RESULT: { OK: "OK", DENIED: "DENIED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" },
  readGovernedList: async () => governedResult,
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db, ...pathParts) => ({ path: pathParts.join("/") }),
  onSnapshot: (_ref, next, error) => {
    capturedNext = next;
    capturedError = error;
    return () => {
      unsubscribeCount += 1;
    };
  },
}));

import { useWorkOrder } from "../src/hooks/useWorkOrder";
import { useLocation } from "../src/hooks/useLocation";

beforeEach(() => {
  capturedNext = undefined;
  capturedError = undefined;
  unsubscribeCount = 0;
  governedResult = { ok: true, result: "OK", items: [], nextCursor: null, hasMore: false };
  scopedResult = { ok: true, result: "OK", workOrder: null, scope: "GLOBAL" };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkOrder -- read-error contract (H14)", () => {
  it("starts loading with no error", () => {
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", async () => {
    // A SCOPE refusal reaches here as DENIED: a technician who is not assigned this work order gets
    // a permission message, NOT an absence. Collapsing the two would tell them the record does not
    // exist, which is both false and a different fact about the business.
    scopedResult = { ok: false, result: "DENIED", workOrder: null };
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("You do not have permission to view these work orders.");
    expect(result.current.workOrder).toBe(null);
  });

  it("a confirmed absence (successful read, no such record) is distinct from a failed read", async () => {
    scopedResult = { ok: true, result: "OK", workOrder: null, scope: "GLOBAL" };
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.workOrder).toBe(null);
  });

  it("retry() re-reads and clears the error", async () => {
    // The teardown assertion went with the subscription -- there is no listener to unsubscribe now.
    // What retry() must still do is the part that mattered: clear the stale error and read again.
    scopedResult = { ok: false, result: "UNAVAILABLE", workOrder: null };
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.error).toContain("Can't reach the server"));

    scopedResult = { ok: true, result: "OK", workOrder: { id: "wo-1", woNumber: "WO-1" }, scope: "GLOBAL" };
    // AWAITED. retry() kicks an async read; without awaiting the act, the assertion can observe
    // the state between the retry and its resolution -- which passed in isolation and failed in a
    // full run, the classic shape of a test that is timing-dependent rather than wrong.
    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.error).toBe(null));
    expect(result.current.workOrder.id).toBe("wo-1");
  });

  it("a found record carries the SERVER's document id", async () => {
    scopedResult = { ok: true, result: "OK", workOrder: { id: "wo-1", woNumber: "WO-1" }, scope: "ASSIGNED" };
    const { result } = renderHook(() => useWorkOrder("wo-1"));
    await waitFor(() => expect(result.current.workOrder).not.toBe(null));
    expect(result.current.workOrder.id).toBe("wo-1");
  });
});

describe("useLocation -- read-error contract (H14)", () => {
  it("starts loading with no error", () => {
    const { result } = renderHook(() => useLocation("loc-1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it("a denied read resolves loading to false and exposes a safe error -- never hangs forever", async () => {
    governedResult = { ok: false, result: "DENIED", items: [] };
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("You do not have permission to view these locations.");
    expect(result.current.location).toBe(null);
  });

  it("an unavailable read is an error too, and still resolves", async () => {
    governedResult = { ok: false, result: "UNAVAILABLE", items: [] };
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.location).toBe(null);
  });

  it("a confirmed absence (successful read, no such record) is distinct from a failed read", async () => {
    // THE DISTINCTION THIS FILE EXISTS FOR, and it survives the seam change: a successful read that
    // found nothing reports NO error, while a failed one reports one. Both leave `location` null,
    // so the error is the only thing telling a caller which happened.
    governedResult = { ok: true, result: "OK", items: [] };
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    expect(result.current.location).toBe(null);
  });

  it("a found record is returned with the SERVER's document id", async () => {
    // The stored-id conflict this hook used to resolve the wrong way round: it spread
    // `{ id: snap.id, ...snap.data() }`, letting a stored `id` displace the document id every
    // consumer keys and routes by.
    governedResult = { ok: true, result: "OK", items: [{ id: "loc-1", name: "Site A" }] };
    const { result } = renderHook(() => useLocation("loc-1"));
    await waitFor(() => expect(result.current.location).not.toBe(null));
    expect(result.current.location.id).toBe("loc-1");
    expect(result.current.error).toBe(null);
  });
});
