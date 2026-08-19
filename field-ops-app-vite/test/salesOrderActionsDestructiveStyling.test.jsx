// Sweep R1-9 -- pins the fix for SalesOrderActions.jsx's ConfirmDialog usages: only CANCEL is a
// genuinely destructive action. ADVANCE (a routine forward lifecycle step), ALLOCATE (a read/compute
// action the dialog's own consequence text says "does not change pricing or quote terms"), and SERVICE
// (creates a Work Order) must NOT render with ConfirmDialog's destructive-default AlertTriangle icon /
// "Destructive action" label / red confirm button -- that falsely signals irreversible harm for routine
// actions. Renders the REAL ConfirmDialog (not mocked) so the assertion exercises the actual prop wiring,
// not a stub.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/hooks/useSalesOrderActions.js", () => ({
  useSalesOrderActions: () => ({
    pending: { advance: false, cancel: false, allocate: false, service: false },
    runTransition: vi.fn(),
    runAllocate: vi.fn(),
    runCreateService: vi.fn(),
    discardTransitionIntent: vi.fn(),
  }),
}));

import SalesOrderActions from "../src/modules/sales/SalesOrderActions.jsx";

afterEach(cleanup);

const BASE_VIEW = {
  id: "so1",
  salesOrderNumber: "SO-2026-1",
  state: "CONFIRMED",
  lines: [],
  allLinesFulfilled: false,
  serviceWorkOrderIds: [],
};

describe("SalesOrderActions -- ConfirmDialog destructive styling matches actual consequence", () => {
  it("ADVANCE dialog is not styled as destructive", () => {
    render(<SalesOrderActions view={BASE_VIEW} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Move to In Fulfillment/ }));
    expect(screen.getByText("Advance Sales Order")).toBeTruthy();
    expect(screen.queryByText("Destructive action")).toBeNull();
  });

  it("ALLOCATE dialog is not styled as destructive", () => {
    render(<SalesOrderActions view={BASE_VIEW} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Allocate" }));
    expect(screen.getByText("Allocate Sales Order")).toBeTruthy();
    expect(screen.queryByText("Destructive action")).toBeNull();
  });

  it("SERVICE dialog is not styled as destructive", () => {
    render(<SalesOrderActions view={BASE_VIEW} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Service" }));
    expect(screen.getByRole("heading", { name: "Create Service" })).toBeTruthy();
    expect(screen.queryByText("Destructive action")).toBeNull();
  });

  it("CANCEL dialog IS still styled as destructive (regression pin -- this one genuinely is)", () => {
    render(<SalesOrderActions view={BASE_VIEW} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(screen.getByText("Cancel Sales Order")).toBeTruthy();
    expect(screen.getByText("Destructive action")).toBeTruthy();
  });
});
