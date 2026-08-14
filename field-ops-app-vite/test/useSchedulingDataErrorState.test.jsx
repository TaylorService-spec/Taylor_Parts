// site-work r3 item B -- useSchedulingData false-empty-on-failed-WO-read.
// useSchedulingData previously destructured only { data, loading } from useWorkOrders() and sourced
// `error` solely from the technicians read (error: techError ?? null). useWorkOrders/subscribeToWorkOrders
// was fixed (PR #875) to set a real error on a denied/failed fieldops_wos onSnapshot callback ("Fail
// VISIBLY" -- see src/hooks/useWorkOrders.js), but useSchedulingData never surfaced it: a failed
// fieldops_wos read yielded loading=false/error=null/workOrders=[], and SchedulingWorkspace rendered a
// normal empty week instead of its wired FailureState.
//
// vitest + @testing-library/react (jsdom). useWorkOrders and useFirestoreCollection are mocked directly
// (no Firebase, no network) so both read paths can be driven independently.
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import { useSchedulingData } from "../src/hooks/useSchedulingData";

const PERMISSION_ERROR = { code: "permission-denied" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSchedulingData -- a failed work-orders read is not swallowed into a false empty", () => {
  it("surfaces the useWorkOrders error even though the technicians read succeeded", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    const { result } = renderHook(() => useSchedulingData());

    expect(result.current.error).toBe(PERMISSION_ERROR);
    expect(result.current.loading).toBe(false);
    // workOrders staying [] is fine -- the point is `error` must be non-null so the workspace
    // renders FailureState instead of treating this as a genuinely empty schedule.
    expect(result.current.workOrders).toEqual([]);
  });

  it("still surfaces the technicians error when only that read fails", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: PERMISSION_ERROR });

    const { result } = renderHook(() => useSchedulingData());

    expect(result.current.error).toBe(PERMISSION_ERROR);
  });

  it("stays honestly null/empty when both reads succeed with no data", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    const { result } = renderHook(() => useSchedulingData());

    expect(result.current.error).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.workOrders).toEqual([]);
    expect(result.current.technicians).toEqual([]);
  });

  it("loading is true while either read is still loading", () => {
    useWorkOrders.mockReturnValue({ data: [], loading: true, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    const { result } = renderHook(() => useSchedulingData());

    expect(result.current.loading).toBe(true);
  });
});
