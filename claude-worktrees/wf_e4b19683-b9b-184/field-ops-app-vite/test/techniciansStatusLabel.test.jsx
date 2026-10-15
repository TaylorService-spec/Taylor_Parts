// Technicians.jsx Status column rendered `label={tech.status}` verbatim -- the raw
// TECH_STATUS wire enum ("on_job", "off_shift") -- instead of the humanized label every
// sibling technician-status surface uses (TechnicianBoard.jsx, DispatchSchedulingWorkspace.jsx,
// TechnicianDashboard.jsx all route through dispatcherBoard/technicianStatusLabel.js to get
// "Available"/"Busy"/"Off Shift"/"Unknown"). An admin/dispatcher viewing the Technicians table
// saw the internal enum string literally instead of the humanized text.
//
// This test pins the fix: the Status column must show the humanized label, never the raw enum.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/domain/jobActions", () => ({ createTechnician: vi.fn() }));

import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import Technicians from "../src/modules/technicians/Technicians";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Technicians -- Status column shows the humanized label, not the raw enum", () => {
  it("renders 'Busy' for on_job, not the raw 'on_job' string", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "t1", name: "Jane", phone: "555-0100", status: "on_job" }],
      loading: false,
      error: null,
    });
    render(<Technicians />);
    expect(screen.getByText("Busy")).toBeTruthy();
    expect(screen.queryByText("on_job")).toBeNull();
  });

  it("renders 'Off Shift' for off_shift, not the raw 'off_shift' string", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "t2", name: "Sam", phone: "555-0101", status: "off_shift" }],
      loading: false,
      error: null,
    });
    render(<Technicians />);
    expect(screen.getByText("Off Shift")).toBeTruthy();
    expect(screen.queryByText("off_shift")).toBeNull();
  });

  it("renders 'Available' for available, not the raw 'available' string", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "t3", name: "Alex", phone: "555-0102", status: "available" }],
      loading: false,
      error: null,
    });
    render(<Technicians />);
    expect(screen.getByText("Available")).toBeTruthy();
  });
});
