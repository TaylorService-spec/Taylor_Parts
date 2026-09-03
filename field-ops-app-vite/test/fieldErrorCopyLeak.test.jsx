// site-work #6 (field-ui-raw-error-leak) -- RENDER gate (vitest + jsdom) proving
// ExecutionCapture and PartsScanner never show a raw Firebase/Functions error
// string, and never render a blank error box when err.message is undefined.
// Both surfaces must route their catch-block copy through the established
// safe-copy helper (src/domain/workflowActionError.js), exactly like
// TechnicianWorkOrderActions.jsx already does.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

const RAW_MESSAGE = "FirebaseError: permission-denied at documents/fieldops_wos/abc123XYZ456uid789";
const RAW = /permission-denied|functions\/|firestore\/|FirebaseError|documents\/|[A-Za-z0-9]{20,}/;

const updateWorkOrderExecutionData = vi.fn();
// Decision #171: a positive qtyUsed now resolves a governed source first. The component asks the
// server which sources are permitted, so the read is mocked alongside the write -- an unambiguous
// pick, which is the case that needs no technician input.
vi.mock("../src/services/workOrderService", () => ({
  updateWorkOrderExecutionData: (...args) => updateWorkOrderExecutionData(...args),
  listWorkOrderConsumptionSources: vi.fn().mockResolvedValue({
    autoSource: { locationId: "wh-1", locationType: "WAREHOUSE", label: "Phoenix Warehouse", method: "PICK" },
    selectableSources: [],
    serializedSource: null,
    sourceRequired: false,
    autoSourceUnavailableReason: null,
    mobileAmbiguous: false,
  }),
}));

// PartsScanner deps: real domain resolution/derivation logic runs unmocked --
// only the auth identity and the live-data hook are stubbed, same seam as
// every other PartsScanner-adjacent test in this suite.
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "technician" }) }));
const assignedWorkOrder = {
  id: "wo1", woNumber: "WO-2026-000001", status: "WORK_IN_PROGRESS", assignedTechId: "tech1",
  inventorySnapshot: [{ sku: "PRT-1001", partId: "PRT-1001", name: "Filter", qtyPlanned: 5, qtyUsed: 0 }],
};
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({
  useAssignedWorkOrders: () => ({ data: [assignedWorkOrder], loading: false, error: null }),
}));

import ExecutionCapture from "../src/modules/technicianDashboard/ExecutionCapture.jsx";
import PartsScanner from "../src/modules/mobile/PartsScanner.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ExecutionCapture -- safe error copy (site-work #6)", () => {
  const workOrder = { id: "wo1", inventorySnapshot: [{ sku: "TST-9001", name: "RECORDED-A", qtyPlanned: 3, qtyUsed: 1 }], executionLog: [] };

  it("a raw error WITH a message never leaks it; safe copy shown instead", async () => {
    updateWorkOrderExecutionData.mockRejectedValueOnce(new Error(RAW_MESSAGE));
    render(<ExecutionCapture workOrder={workOrder} />);
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const text = screen.getByRole("alert").textContent;
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/nothing was changed/i);
  });

  it("an error with NO message never renders a blank error box", async () => {
    updateWorkOrderExecutionData.mockRejectedValueOnce({ code: "permission-denied" }); // no .message
    render(<ExecutionCapture workOrder={workOrder} />);
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const text = screen.getByRole("alert").textContent;
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/not allowed/i);
  });
});

describe("PartsScanner -- safe error copy (site-work #6)", () => {
  async function scanAndRecord() {
    render(<PartsScanner technicianId="tech1" />);
    const input = screen.getByLabelText("Part or work order code");
    fireEvent.change(input, { target: { value: "PRT-1001" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    const recordButton = await screen.findByRole("button", { name: "Record use on this job" });
    await act(async () => { fireEvent.click(recordButton); });
  }

  it("a raw error WITH a message never leaks it; safe copy shown instead", async () => {
    updateWorkOrderExecutionData.mockRejectedValueOnce(new Error(RAW_MESSAGE));
    await scanAndRecord();
    const status = await waitFor(() => {
      const el = document.querySelector(".fo-scan__notice--warn");
      expect(el).toBeTruthy();
      return el;
    });
    const text = status.textContent;
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/nothing was changed/i);
  });

  it("an error with NO message never renders a blank notice", async () => {
    updateWorkOrderExecutionData.mockRejectedValueOnce({ code: "permission-denied" }); // no .message
    await scanAndRecord();
    const status = await waitFor(() => {
      const el = document.querySelector(".fo-scan__notice--warn");
      expect(el).toBeTruthy();
      return el;
    });
    const text = status.textContent;
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/not allowed/i);
  });
});
