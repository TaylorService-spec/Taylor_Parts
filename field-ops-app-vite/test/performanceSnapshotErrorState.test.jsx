// site-work round-2 #5 (performancesnapshot-raw-error-leak) -- RENDER tests (vitest + jsdom).
//
// UPDATED 2026-09-30 (Work Order cutover completion pass): the error copy is now the ONE Work Order outcome
// classifier's LOAD copy (domain/workOrderOutcome.js via loadErrorMessage) -- a read failure is said as a read
// failure, and UNAUTHORIZED / NOT_YET_ACTIVATED / UNAVAILABLE are said differently. The snapshot is the caller's
// OWN (no technician id is passed).
//
// PerformanceSnapshot.jsx's catch handler used to do setError(err.message) and render it
// verbatim ("Couldn't load performance stats: {error}"), leaking raw Firestore/Functions
// error text straight to the technician, and rendering a blank/empty message whenever
// err.message was undefined (e.g. a bare { code: "permission-denied" } object with no
// message property). The fix routes the caught error through the app's established safe-copy
// helper (workflowActionErrorMessage, src/domain/workflowActionError.js -- the same helper
// ExecutionCapture.jsx and PartsScanner.jsx already use) so only one of its safe, human
// categories is ever shown, never the raw error text and never blank.
//
// getTechnicianExecutionStats is mocked (no Firebase, no network) so the rejection path can
// be driven directly.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("../src/analytics/executionAnalyticsService", () => ({
  getTechnicianExecutionStats: vi.fn(),
}));

import { getTechnicianExecutionStats } from "../src/analytics/executionAnalyticsService";
import PerformanceSnapshot from "../src/modules/technicianDashboard/PerformanceSnapshot";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PerformanceSnapshot -- errors are routed through the ONE outcome classifier", () => {
  it("UNAUTHORIZED: a permission message, not the raw error text", async () => {
    const rawMessage = "7 PERMISSION_DENIED: Missing or insufficient permissions on path /technicians/abc123.";
    getTechnicianExecutionStats.mockRejectedValue({ code: "FORBIDDEN", reason: "CAPABILITY_MISSING", message: rawMessage });

    render(<PerformanceSnapshot />);

    await waitFor(() => {
      expect(screen.getByText(/you do not have permission to view these performance stats/i)).toBeTruthy();
    });
    expect(screen.queryByText(new RegExp(rawMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeNull();
    expect(document.querySelector('[data-work-order-outcome="UNAUTHORIZED"]')).toBeTruthy();
    // The caller's OWN figures: no technician id is sent.
    expect(getTechnicianExecutionStats).toHaveBeenCalledWith(null);
  });

  it("UNAVAILABLE: a non-blank reach-the-server message when the rejection has no message at all", async () => {
    getTechnicianExecutionStats.mockRejectedValue({ code: "UNAVAILABLE" });

    render(<PerformanceSnapshot />);

    await waitFor(() => {
      expect(document.querySelector('[data-work-order-outcome="UNAVAILABLE"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-work-order-outcome="UNAVAILABLE"]').textContent).toMatch(/reach the server/i);
  });

  it("NOT_YET_ACTIVATED: a readiness status, not an error", async () => {
    getTechnicianExecutionStats.mockRejectedValue({ code: "NOT_ACTIVATED", reason: "NOT_ACTIVATED" });
    render(<PerformanceSnapshot />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/NOT_YET_ACTIVATED/));
  });

  it("a login with no Employee link is told exactly that", async () => {
    getTechnicianExecutionStats.mockRejectedValue({ code: "FORBIDDEN", reason: "EMPLOYEE_LINK_REQUIRED" });
    render(<PerformanceSnapshot />);
    await waitFor(() => expect(screen.getByText(/not linked to an Employee record/i)).toBeTruthy());
  });

  it("shows the generic safe fallback for an unrecognized error shape", async () => {
    getTechnicianExecutionStats.mockRejectedValue(new Error());

    render(<PerformanceSnapshot />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load performance stats\. please try again\./i)).toBeTruthy();
    });
  });
});

describe("PerformanceSnapshot -- Avg Job Duration is never a negative fact", () => {
  // THE LIVE DEFECT, at the surface it reached: the technician screen rendered "-1686m" under
  // "Avg. Job Duration". The projection no longer produces a negative, and this is the render-side
  // proof that nothing downstream can reintroduce one -- a component reading a raw stored figure,
  // a future formatter, or a change of mind about clamping.
  it("renders N/A, never a negative span, when the projection withholds the figure", async () => {
    getTechnicianExecutionStats.mockResolvedValue({
      employeeId: "emp-1",
      totalWorkOrdersCompleted: 11,
      totalPartsConsumed: 7,
      averageCompletionTimeMs: null,
      completionEvidence: { valid: 3, inverted: 1, missing: 0 },
      workOrderVolumeByStatus: {},
    });

    render(<PerformanceSnapshot />);

    await waitFor(() => expect(screen.getByText("N/A")).toBeTruthy());
    // The counts that ARE trustworthy still show -- withholding the duration must not blank the card.
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/-[0-9]+ *(m|h)/);
  });

  it("no rendered figure carries a minus sign, whatever the projection returns", async () => {
    // Defence in depth: even if a negative ever reached this component again, it must not read as a
    // duration. Asserting on the RENDERED text rather than on the input is what makes that provable.
    getTechnicianExecutionStats.mockResolvedValue({
      employeeId: "emp-1",
      totalWorkOrdersCompleted: 2,
      totalPartsConsumed: 0,
      averageCompletionTimeMs: 3_600_000,
      completionEvidence: { valid: 2, inverted: 0, missing: 0 },
      workOrderVolumeByStatus: {},
    });

    render(<PerformanceSnapshot />);

    await waitFor(() => expect(screen.getByText("1.0h")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/-[0-9]/);
  });
});
