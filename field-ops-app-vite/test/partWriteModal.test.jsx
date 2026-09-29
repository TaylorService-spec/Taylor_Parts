// Wave 6 -- master-data-in-Parts. Component tests for the shared PartWriteModal
// (src/shared/partMaster/PartWriteModal.jsx), the ONE write surface reused by both
// PartsList.jsx ("New Part") and PartDetail.jsx ("Edit Part Details"/"Change
// Status"). Proves: fail-closed by default (zero callable attempts, disabled
// controls); an explicit readinessOverride:true + a mocked client exercises the
// real create/update/status-change flow through usePartMasterWrite -- the SAME
// governed hook PartMasterList.jsx's own dedicated admin screen uses -- never a
// second write path.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const manufacturerCatalogState = { current: { loading: true, errorStatus: null, result: null } };
vi.mock("../src/hooks/useManufacturerCatalog", () => ({
  useManufacturerCatalog: () => manufacturerCatalogState.current,
}));

// DQ-034: the Catalog mutation hold is a CODE constant and is ON in every build. These flows exercise the UNHELD
// governed path, so the hold module is mocked with a mutable `held` (default false here); the held state has its own
// block below, and the committed constant itself is pinned by test/catalogMutationHold.test.jsx.
const hold = vi.hoisted(() => ({ held: false }));
vi.mock("../src/config/catalogMutationHold.js", async (orig) => ({ ...(await orig()), CATALOG_MUTATION_HOLD: hold }));

import PartWriteModal from "../src/shared/partMaster/PartWriteModal.jsx";

afterEach(() => {
  cleanup();
  hold.held = false;
  manufacturerCatalogState.current = { loading: true, errorStatus: null, result: null };
});

const PART = { partId: "PRT-1", internalPartNumber: "PRT-1", name: "Valve", version: 3, status: "ACTIVE", category: "Valves", stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED" };

// The client's resolved shape is the RAW callable response ({outcome, version}) --
// domain/partMasterWrite.js's outcomeFromResult() derives the {kind, message} the
// modal renders FROM this, it is not the outcome object itself.
function mockClient() {
  return {
    createPart: vi.fn().mockResolvedValue({ outcome: "applied", version: 1 }),
    updatePart: vi.fn().mockResolvedValue({ outcome: "applied", version: 4 }),
    changePartStatus: vi.fn().mockResolvedValue({ outcome: "applied", version: 4 }),
  };
}

describe("PartWriteModal -- fail-closed by default", () => {
  it("create mode: write-disabled notice shown, submit disabled, zero callable attempts", () => {
    const client = mockClient();
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={() => {}} writeDeps={{ client }} />);
    expect(screen.getByText(/editing isn't enabled in this environment yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create part/i }).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    expect(client.createPart).not.toHaveBeenCalled();
  });

  it("status mode: transition buttons disabled, zero callable attempts", () => {
    const client = mockClient();
    render(<PartWriteModal mode="status" part={PART} onClose={() => {}} onSaved={() => {}} writeDeps={{ client }} />);
    const transitionButton = screen.getByRole("button", { name: /→ INACTIVE/i });
    expect(transitionButton.disabled).toBe(true);
    fireEvent.click(transitionButton);
    expect(client.changePartStatus).not.toHaveBeenCalled();
  });
});

describe("PartWriteModal -- readinessOverride:true exercises the real governed flow", () => {
  it("create: submits via the SAME usePartMasterWrite hook, calls onSaved on applied", async () => {
    const client = mockClient();
    const onSaved = vi.fn();
    render(
      <PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={{ readinessOverride: true, client }} />
    );
    fireEvent.change(screen.getByLabelText(/^part id$/i), { target: { value: "PRT-9" } });
    fireEvent.change(screen.getByLabelText(/internal part number/i), { target: { value: "PRT-9" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Valve" } });
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await waitFor(() => expect(client.createPart).toHaveBeenCalledTimes(1));
    const call = client.createPart.mock.calls[0][0];
    expect(call.part.partId).toBe("PRT-9");
    expect(call.part.name).toBe("New Valve");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("edit: prefilled from `part`, submits updatePart with partId + version + a changes diff", async () => {
    const client = mockClient();
    const onSaved = vi.fn();
    render(
      <PartWriteModal mode="edit" part={PART} onClose={() => {}} onSaved={onSaved} writeDeps={{ readinessOverride: true, client }} />
    );
    expect(screen.getByLabelText(/^name$/i).value).toBe("Valve");
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Valve v2" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(client.updatePart).toHaveBeenCalledTimes(1));
    const call = client.updatePart.mock.calls[0][0];
    expect(call.partId).toBe("PRT-1");
    expect(call.expectedVersion).toBe(3);
    expect(call.changes.name).toBe("Valve v2");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("status: only the governed transitions from PART's status are offered; clicking one calls changePartStatus", async () => {
    const client = mockClient();
    const onSaved = vi.fn();
    render(
      <PartWriteModal mode="status" part={PART} onClose={() => {}} onSaved={onSaved} writeDeps={{ readinessOverride: true, client }} />
    );
    // ACTIVE -> [INACTIVE, DISCONTINUED, SUPERSEDED] per domain/partMasterWrite.js; DRAFT/ACTIVE itself never offered.
    expect(screen.queryByRole("button", { name: /→ ACTIVE/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /→ INACTIVE/i }));
    await waitFor(() => expect(client.changePartStatus).toHaveBeenCalledTimes(1));
    const call = client.changePartStatus.mock.calls[0][0];
    expect(call.partId).toBe("PRT-1");
    expect(call.expectedVersion).toBe(3);
    expect(call.newStatus).toBe("INACTIVE");
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("a denied/failed outcome does NOT call onSaved -- the modal stays open on the reported outcome", async () => {
    const deniedError = new Error("permission-denied");
    deniedError.code = "permission-denied";
    const client = { createPart: vi.fn().mockRejectedValue(deniedError) };
    const onSaved = vi.fn();
    render(
      <PartWriteModal mode="create" onClose={() => {}} onSaved={onSaved} writeDeps={{ readinessOverride: true, client }} />
    );
    fireEvent.change(screen.getByLabelText(/^part id$/i), { target: { value: "PRT-9" } });
    fireEvent.change(screen.getByLabelText(/internal part number/i), { target: { value: "PRT-9" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Valve" } });
    fireEvent.click(screen.getByRole("button", { name: /create part/i }));
    await screen.findByText(/not authorized to make this change/i);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("PartWriteModal -- Manufacturer field honors the trusted catalog read state", () => {
  it("catalog UNAVAILABLE: falls back to a free-text id, with honest copy -- never fabricates a picker", () => {
    manufacturerCatalogState.current = { loading: false, errorStatus: "unavailable", result: null };
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={() => {}} writeDeps={{ readinessOverride: true, client: {} }} />);
    expect(screen.getByLabelText(/manufacturer id/i)).toBeTruthy();
    expect(screen.getByText(/manufacturer catalog is currently unavailable/i)).toBeTruthy();
  });

  it("catalog DENIED: falls back to a free-text id, with distinct honest copy", () => {
    manufacturerCatalogState.current = { loading: false, errorStatus: "denied", result: null };
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={() => {}} writeDeps={{ readinessOverride: true, client: {} }} />);
    expect(screen.getByText(/do not have access to the manufacturer catalog/i)).toBeTruthy();
  });

  it("catalog READY: a real governed Manufacturer selector replaces the free-text field, ACTIVE-only options", () => {
    manufacturerCatalogState.current = {
      loading: false,
      errorStatus: null,
      result: {
        status: "ready",
        manufacturers: [
          { manufacturerId: "MFG-1", name: "Acme Valve Co", status: "ACTIVE" },
          { manufacturerId: "MFG-2", name: "Retired Co", status: "INACTIVE" },
        ],
        excludedCount: 0,
      },
    };
    render(<PartWriteModal mode="create" onClose={() => {}} onSaved={() => {}} writeDeps={{ readinessOverride: true, client: {} }} />);
    expect(screen.queryByLabelText(/manufacturer id/i)).toBeNull();
    const select = screen.getByLabelText(/^manufacturer$/i);
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Acme Valve Co" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Retired Co" })).toBeNull();
  });

  it("catalog READY, editing a part whose existing manufacturerId is no longer ACTIVE: value is preserved, not silently dropped", () => {
    manufacturerCatalogState.current = {
      loading: false,
      errorStatus: null,
      result: { status: "ready", manufacturers: [{ manufacturerId: "MFG-1", name: "Acme Valve Co", status: "ACTIVE" }], excludedCount: 0 },
    };
    render(
      <PartWriteModal mode="edit" part={{ ...PART, manufacturerId: "MFG-9-RETIRED" }} onClose={() => {}} onSaved={() => {}} writeDeps={{ readinessOverride: true, client: {} }} />
    );
    const select = screen.getByLabelText(/^manufacturer$/i);
    expect(select.value).toBe("MFG-9-RETIRED");
    expect(screen.getByRole("option", { name: /MFG-9-RETIRED \(not currently active\)/i })).toBeTruthy();
  });
});

describe("PartWriteModal -- DQ-034 hold: Catalog changes are paused during the migration", () => {
  it("even readinessOverride:true cannot lift the hold: paused notice, every control disabled, zero client calls", () => {
    hold.held = true;
    for (const mode of ["create", "edit", "status"]) {
      const client = mockClient();
      render(<PartWriteModal mode={mode} part={PART} onClose={() => {}} onSaved={() => {}} writeDeps={{ readinessOverride: true, client }} />);
      expect(screen.getByText(/catalog changes are paused during the migration/i)).toBeTruthy();
      // The hold replaces the readiness notice rather than stacking on it.
      expect(screen.queryByText(/editing isn't enabled in this environment yet/i)).toBeNull();
      const buttons = mode === "status"
        ? screen.getAllByRole("button", { name: /^→ /i })
        : [screen.getByRole("button", { name: mode === "create" ? /create part/i : /save changes/i })];
      for (const b of buttons) { expect(b.disabled).toBe(true); fireEvent.click(b); }
      expect(client.createPart).not.toHaveBeenCalled();
      expect(client.updatePart).not.toHaveBeenCalled();
      expect(client.changePartStatus).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("a server CATALOG_MUTATION_HELD refusal (stale bundle) is reported as the pause, and onSaved is not called", async () => {
    const client = mockClient();
    client.changePartStatus = vi.fn().mockRejectedValue(Object.assign(new Error("held"), { code: "PRECONDITION_FAILED", reason: "CATALOG_MUTATION_HELD" }));
    const onSaved = vi.fn();
    render(<PartWriteModal mode="status" part={PART} onClose={() => {}} onSaved={onSaved} writeDeps={{ readinessOverride: true, client }} />);
    fireEvent.click(screen.getByRole("button", { name: /→ INACTIVE/i }));
    await waitFor(() => expect(client.changePartStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/catalog changes are paused during the migration/i)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
