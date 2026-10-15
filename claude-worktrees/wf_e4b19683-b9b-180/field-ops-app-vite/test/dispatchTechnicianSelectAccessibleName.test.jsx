// Accessibility regression: the technician <select> on the Dispatch board relied solely
// on its disabled placeholder option's text ("Select technician…") to convey purpose,
// which is not a reliable accessible name for a listbox/combobox in most screen readers.
// A screen-reader user tabbing through the Dispatch card heard an unlabeled combobox.
// This test pins that the select now exposes an accessible name (aria-label), matching
// the equivalent technician <select> in DispatchSchedulingWorkspace.jsx (wrapped in
// <label>Technician ...).
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

describe("Dispatch -- technician select has an accessible name", () => {
  it("exposes a combobox reachable by its accessible name, not just placeholder text", () => {
    useWorkOrders.mockReturnValue({
      data: [
        {
          id: "wo-1",
          woNumber: "WO-1",
          description: "Ice machine PM",
          status: "SCHEDULED",
          assignedTechId: null,
          scheduledTechId: null,
        },
      ],
      loading: false,
      error: null,
    });
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "tech-1", name: "Alex Rivera", status: "available" }],
      loading: false,
      error: null,
    });

    render(<Dispatch />);

    expect(screen.getByRole("combobox", { name: "Select technician" })).toBeTruthy();
  });
});
