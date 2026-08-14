// site-work r3 (item A) -- WorkOrderPreview render crash regression test (vitest + jsdom).
//
// The customer-identity lookup (useAccountNames + resolveCustomerIdentity) was
// misplaced inside the sibling ScoreBreakdown({recommendation}) function -- which
// references an undefined `workOrder` -- while WorkOrderPreview({workOrder,...})'s
// own render used an undefined `customerIdentity` (rendering
// <CustomerIdentity identity={customerIdentity} showReference/>). Both threw a
// ReferenceError on render. This pins the fix: WorkOrderPreview must render without
// throwing, and must resolve + display the customer's name (not a raw id).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../src/hooks/useAccountNames", () => ({ useAccountNames: vi.fn() }));

import { useAccountNames } from "../src/hooks/useAccountNames";
import WorkOrderPreview from "../src/modules/dispatcherBoard/WorkOrderPreview";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const workOrder = {
  id: "wo-1",
  woNumber: "WO-1001",
  status: "OPEN",
  priority: "P2",
  type: "REPAIR",
  customerId: "acct-harbor",
  assignedTechId: null,
};

const recommendations = [
  {
    techId: "tech-1",
    rank: 1,
    score: 88,
    breakdown: { workload: 80, experienceAffinity: 1, availability: 100, territoryMatch: 100 },
    reasons: ["Available now"],
  },
];

describe("WorkOrderPreview -- customerIdentity is defined in the render scope", () => {
  it("renders without throwing and shows the resolved customer name, not a raw id", () => {
    useAccountNames.mockReturnValue(new Map([["acct-harbor", "Harbor Grill Restaurant Group"]]));

    expect(() =>
      render(
        <WorkOrderPreview
          workOrder={workOrder}
          technicians={[{ id: "tech-1", name: "Alex Tech" }]}
          recommendations={recommendations}
          onDispatchToTechnician={() => {}}
          isDispatching={false}
        />
      )
    ).not.toThrow();

    expect(screen.getByText("Harbor Grill Restaurant Group")).toBeTruthy();
    expect(screen.queryByText("acct-harbor")).toBeNull();
  });
});
