// Regression for: a cancelled, never-dispatched Work Order was told it "must be
// scheduled first" on the Dispatch board.
//
// Dispatch.jsx's body-text branch fires whenever getAllowedActions(...) excludes
// "Dispatch" AND job.assignedTechId is unset. That is true both for a normal
// CREATED/READY_TO_DISPATCH/SCHEDULED job awaiting scheduling, and for a CANCELLED
// job that was cancelled before ever being scheduled or assigned -- CANCELLED is a
// terminal status (WORK_ORDER_TRANSITIONS.CANCELLED === []), so it can never
// transition to Dispatch either. Before the fix both cases rendered the identical
// "Not ready to dispatch — this work order must be scheduled first." text, telling
// the dispatcher a dead job just needs scheduling when no action will ever move it
// forward again.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));

import { useWorkOrders } from "../src/hooks/useWorkOrders";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import Dispatch from "../src/modules/dispatch/Dispatch";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Dispatch -- cancelled, never-dispatched work order body text", () => {
  it("does not tell the dispatcher a cancelled job 'must be scheduled first'", () => {
    const cancelledJob = {
      id: "wo-cancelled",
      woNumber: "WO-900",
      status: "CANCELLED",
      description: "Cancelled before it was ever scheduled",
      // never assigned
    };
    useWorkOrders.mockReturnValue({ data: [cancelledJob], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    render(<Dispatch />);

    expect(screen.queryByText(/must be scheduled first/i)).toBeNull();
    expect(screen.getByText(/cancelled before it was dispatched/i)).not.toBeNull();
  });

  it("still shows the scheduling message for a live job that genuinely needs scheduling", () => {
    const createdJob = {
      id: "wo-created",
      woNumber: "WO-901",
      status: "CREATED",
      description: "Just created, not yet scheduled",
    };
    useWorkOrders.mockReturnValue({ data: [createdJob], loading: false, error: null });
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: null });

    render(<Dispatch />);

    expect(screen.getByText(/must be scheduled first/i)).not.toBeNull();
  });
});
