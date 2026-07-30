// OD-3 -- RENDER gate for the shared InventoryHealthPanel's resolveName-based name resolution
// (vitest + jsdom). The panel is a pure renderer used by four parents in two variants
// (read-only, and action w/ RequestReorderControl). Proves: the Part cell resolves via the
// supplied resolveName; fail-closed / default renders the raw partId (never a static name);
// and the ACTION variant's reorder wiring is unchanged (RequestReorderControl still receives
// recommendation/submitting/alreadyRequested and its submit still calls onRequestReorder with
// (partId, recommendation, manualQty)).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../src/domain/inventoryAnalyticsEngine", () => ({
  URGENCY_ORDER: { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 },
  hasUsageHistory: () => true,
}));
// Capture RequestReorderControl props; expose a submit trigger so we can prove the action
// wiring is unchanged without depending on its internal eligibility UI.
const reorderProps = [];
vi.mock("../src/shared/inventory/RequestReorderControl", () => ({
  default: (props) => {
    reorderProps.push(props);
    return <button onClick={() => props.onSubmit(7)}>reorder:{props.recommendation.urgency}:{props.submitting ? "busy" : "idle"}:{props.alreadyRequested ? "req" : "new"}</button>;
  },
}));

import InventoryHealthPanel from "../src/modules/operations/panels/InventoryHealthPanel.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); reorderProps.length = 0; });

const entry = (partId) => ({
  partId, stock: { availableStock: 5 }, usage: { avgDailyUsage: 1.5 },
  recommendation: { urgency: "HIGH", daysRemaining: 3.3, recommendedOrderQty: 10 },
});
const canonical = (id) => (id === "TST-9001" ? "CANONICAL-NAME-A" : id);

describe("InventoryHealthPanel (OD-3) -- resolveName name resolution", () => {
  it("read-only variant: canonical name via resolveName; no action column", () => {
    render(<InventoryHealthPanel healthEntries={[entry("TST-9001")]} resolveName={canonical} />);
    expect(screen.getByText("CANONICAL-NAME-A")).toBeTruthy();
    expect(screen.queryByText("Action")).toBeNull(); // no action column without onRequestReorder
    expect(reorderProps.length).toBe(0);
  });

  it("fail-closed resolveName renders the raw partId (never a static name)", () => {
    render(<InventoryHealthPanel healthEntries={[entry("TST-9001")]} resolveName={(id) => id} />);
    expect(screen.getByText("TST-9001")).toBeTruthy();
    expect(screen.queryByText("CANONICAL-NAME-A")).toBeNull();
  });

  it("default (no resolveName prop) fails closed to the raw partId", () => {
    render(<InventoryHealthPanel healthEntries={[entry("TST-9001")]} />);
    expect(screen.getByText("TST-9001")).toBeTruthy();
  });

  it("action variant: name resolves AND the reorder wiring is unchanged (RequestReorderControl props + submit)", () => {
    const onRequestReorder = vi.fn();
    render(
      <InventoryHealthPanel
        healthEntries={[entry("TST-9001")]}
        resolveName={canonical}
        onRequestReorder={onRequestReorder}
        requestedPartIds={new Set(["TST-9001"])}
        submittingPartId="TST-9001"
      />
    );
    expect(screen.getByText("CANONICAL-NAME-A")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy(); // action column present
    // RequestReorderControl received the unchanged recommendation/submitting/alreadyRequested props
    expect(reorderProps).toHaveLength(1);
    expect(reorderProps[0].recommendation.urgency).toBe("HIGH");
    expect(reorderProps[0].submitting).toBe(true);
    expect(reorderProps[0].alreadyRequested).toBe(true);
    // submit still calls onRequestReorder(partId, recommendation, manualQty) -- unchanged behavior
    fireEvent.click(screen.getByText(/^reorder:/));
    expect(onRequestReorder).toHaveBeenCalledWith("TST-9001", reorderProps[0].recommendation, 7);
  });
});
