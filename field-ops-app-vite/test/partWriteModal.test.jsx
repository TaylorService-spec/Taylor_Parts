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
import PartWriteModal from "../src/shared/partMaster/PartWriteModal.jsx";

afterEach(() => cleanup());

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
