// Sweep r1 #33 -- SavedReports.jsx rename: submitting an empty rename used to silently close the
// form with no feedback (commitRename always called setRenamingId(null), then skipped mutate()
// because the trimmed name was falsy). The user had no way to tell their edit was a no-op.
//
// Fix: an empty (or whitespace-only) name is a no-op that keeps the rename form OPEN instead of
// closing it, and the Save button is disabled while the trimmed value is empty so the control never
// looks actionable when it cannot do anything.
//
// Pattern mirrors test/reportBuilderArrayFilterAndSavedWiring.test.jsx (same component, same
// injected-service harness).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import SavedReports from "../src/modules/reporting/SavedReports.jsx";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const record = {
  id: "r1", name: "Weekly parts usage", ownerUid: "u1",
  updatedAtMillis: Date.now(),
  definition: { objectId: "customer", fields: ["customer.name"], filters: [], groupBy: [], sort: [], aggregates: [], presentation: {} },
};

function renderSaved(service) {
  return render(
    <MemoryRouter initialEntries={["/reporting/saved"]}>
      <SavedReports hasCapability={() => true} service={service} />
    </MemoryRouter>,
  );
}

describe("SavedReports -- rename with an empty name", () => {
  it("clearing the field disables Save, and submitting keeps the form open without calling rename()", async () => {
    const rename = vi.fn();
    const service = { list: vi.fn().mockResolvedValue([record]), rename };
    renderSaved(service);

    fireEvent.click(await screen.findByRole("button", { name: /rename weekly parts usage/i }));
    const input = screen.getByLabelText("Rename");
    const saveButton = screen.getByRole("button", { name: "Save" });

    // Clearing the field must disable Save -- the control should never look actionable when it
    // cannot do anything.
    fireEvent.change(input, { target: { value: "   " } });
    expect(saveButton.disabled).toBe(true);

    // Submitting anyway (e.g. via Enter, which bypasses the disabled button) must be a no-op: the
    // rename form stays open and the backend is never called.
    fireEvent.submit(input.closest("form"));

    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Rename")).toBeTruthy(); // form still open, not silently dismissed
  });

  it("a non-empty name still commits normally", async () => {
    const rename = vi.fn().mockResolvedValue({});
    const service = { list: vi.fn().mockResolvedValue([record]), rename };
    renderSaved(service);

    fireEvent.click(await screen.findByRole("button", { name: /rename weekly parts usage/i }));
    const input = screen.getByLabelText("Rename");
    fireEvent.change(input, { target: { value: "New name" } });

    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false);
    fireEvent.submit(input.closest("form"));

    expect(rename).toHaveBeenCalledWith("r1", "New name");
    await screen.findByText(/report renamed/i);
  });
});
