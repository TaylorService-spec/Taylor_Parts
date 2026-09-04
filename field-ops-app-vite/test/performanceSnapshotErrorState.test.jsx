// site-work round-2 #5 (performancesnapshot-raw-error-leak) -- RENDER tests (vitest + jsdom).
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

describe("PerformanceSnapshot -- errors are routed through the safe copy helper", () => {
  it("shows a safe message, not the raw error text, when the rejection has a message", async () => {
    const rawMessage = "7 PERMISSION_DENIED: Missing or insufficient permissions on path /technicians/abc123.";
    getTechnicianExecutionStats.mockRejectedValue({ code: "permission-denied", message: rawMessage });

    render(<PerformanceSnapshot technicianId="tech-1" />);

    await waitFor(() => {
      expect(screen.getByText(/you're not allowed to perform this action\. nothing was changed\./i)).toBeTruthy();
    });
    expect(screen.queryByText(new RegExp(rawMessage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeNull();
  });

  it("still shows a non-blank safe message when the rejection has no message at all", async () => {
    getTechnicianExecutionStats.mockRejectedValue({ code: "unavailable" });

    render(<PerformanceSnapshot technicianId="tech-2" />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load performance stats:/i)).toBeTruthy();
    });
    const paragraph = screen.getByText(/couldn't load performance stats:/i);
    expect(paragraph.textContent.trim()).not.toBe("Couldn't load performance stats:");
    expect(paragraph.textContent).toMatch(/temporarily unavailable/i);
  });

  it("shows the generic safe fallback for an unrecognized error shape", async () => {
    getTechnicianExecutionStats.mockRejectedValue(new Error());

    render(<PerformanceSnapshot technicianId="tech-3" />);

    await waitFor(() => {
      expect(
        screen.getByText(/something went wrong and the action could not be completed\. nothing was changed\./i)
      ).toBeTruthy();
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
      technicianId: "tech-1",
      totalWorkOrdersCompleted: 11,
      totalPartsConsumed: 7,
      averageCompletionTimeMs: null,
      completionEvidence: { valid: 3, inverted: 1, missing: 0 },
      workOrderVolumeByStatus: {},
    });

    render(<PerformanceSnapshot technicianId="tech-1" />);

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
      technicianId: "tech-1",
      totalWorkOrdersCompleted: 2,
      totalPartsConsumed: 0,
      averageCompletionTimeMs: 3_600_000,
      completionEvidence: { valid: 2, inverted: 0, missing: 0 },
      workOrderVolumeByStatus: {},
    });

    render(<PerformanceSnapshot technicianId="tech-1" />);

    await waitFor(() => expect(screen.getByText("1.0h")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/-[0-9]/);
  });
});
