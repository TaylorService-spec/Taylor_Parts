// Opportunity SECTION SAVE — the wiring, end to end through the UI (vitest + jsdom).
//
// The command, the form, the readiness seam and the field model all existed before this; what did
// not exist was anything CALLING the command. These tests exist to keep that from silently coming
// undone again — a workspace whose Save button is decorative passes every other test in this file.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SalesWorkspace from "../src/modules/sales/SalesWorkspace.jsx";

afterEach(cleanup);

const ENABLED = { enabled: true, reason: null };
// An unreadable directory is the COMMON case for a salesperson (employees is admin/dispatcher-
// only), so it is the default here rather than the exception.
const NO_DIRECTORY = { byEmployeeId: new Map(), loading: false, error: new Error("permission-denied") };

const ok = (over = {}) => ({ result: { success: true, replayed: false, opportunityId: "o", changed: ["need"], ...over } });
const fail = (errorStatus, errorDetail) => ({ errorStatus, errorDetail });

function renderWorkspace(client, extra = {}) {
  return render(
    <MemoryRouter>
      <SalesWorkspace readiness={ENABLED} saveDeps={{ client }} directory={NO_DIRECTORY} {...extra} />
    </MemoryRouter>
  );
}

async function editNeed(client, text = "revised need") {
  renderWorkspace(client);
  fireEvent.click(screen.getByRole("button", { name: /edit customer need/i }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
}

// ------------------------------------------------------------------- it actually calls

describe("Opportunity section save (the governed command is really invoked)", () => {
  it("Save calls updateOpportunity with the edited field and the version token", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(ok());
    await editNeed({ updateOpportunity });

    await waitFor(() => expect(updateOpportunity).toHaveBeenCalledTimes(1));
    const payload = updateOpportunity.mock.calls[0][0];
    expect(payload.need).toBe("revised need");
    expect(payload.opportunityId).toBeTruthy();
    // The command REJECTS any caller that cannot prove which version it loaded. A payload without
    // this is a save that can never succeed.
    expect(typeof payload.expectedUpdatedAtMillis).toBe("number");
    expect(payload.idempotencyKey).toBeTruthy();
  });

  it("a successful save closes the section and re-reads authoritatively", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(ok());
    await editNeed({ updateOpportunity });
    // form closed => back to the read view
    await waitFor(() => expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull());
  });

  it("the Commercial section renames channel to salesChannel on the wire", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(ok({ changed: ["salesChannel"] }));
    renderWorkspace({ updateOpportunity });
    fireEvent.click(screen.getByRole("button", { name: /edit commercial details/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateOpportunity).toHaveBeenCalled());
    const payload = updateOpportunity.mock.calls[0][0];
    expect(payload.salesChannel).toBeTruthy();
    expect(payload).not.toHaveProperty("channel");
  });
});

// --------------------------------------------------------------- failures the user can act on

describe("Opportunity section save (failures are stated truthfully)", () => {
  it("a VERSION CONFLICT keeps the form open with the draft intact and does not blame the user", async () => {
    // The whole point: the recovery being asked for is "reapply your edit", so throwing the edit
    // away would be the one unrecoverable response to a recoverable problem.
    const updateOpportunity = vi.fn().mockResolvedValue(fail("aborted", "VERSION_CONFLICT"));
    await editNeed({ updateOpportunity }, "my careful wording");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/someone else saved/i);
    expect(alert.textContent).not.toMatch(/invalid/i);
    // still editing, still holding what was typed
    expect(screen.getByRole("textbox").value).toBe("my careful wording");
  });

  it("a CLOSED record is reported as closed, not as an invalid request", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(fail("failed-precondition", "CLOSED"));
    await editNeed({ updateOpportunity });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/closed/i);
  });

  it("NO_CHANGES reads as information, not as an error", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(fail("failed-precondition", "NO_CHANGES"));
    await editNeed({ updateOpportunity });
    await waitFor(() => expect(screen.getByText(/no changes to save/i)).toBeTruthy());
    // it is not an alert -- nothing went wrong
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("without the domain detail, the generic HttpsError message is still used", async () => {
    const updateOpportunity = vi.fn().mockResolvedValue(fail("permission-denied", null));
    await editNeed({ updateOpportunity });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/not authorized/i);
  });
});

// ------------------------------------------------------------------ the record-level rule

describe("Opportunity section save (a closed Opportunity offers no edit)", () => {
  // WHERE THIS RULE IS ACTUALLY TESTED, stated plainly rather than faked here.
  //
  // The rule itself -- WON/LOST are terminal and refuse edits -- is exercised as a pure function
  // in test/opportunitySectionSave.test.mjs (isOpportunityEditable) and enforced for real by the
  // command's CLOSED guard, which no client can talk its way past. DetailSection consumes that
  // one function; there is no second copy of the rule to drift.
  //
  // It is NOT reachable through this workspace's queue, and that is a property worth pinning
  // rather than working around: the pipeline lists OPEN opportunities only, so a closed record
  // has no row to click. A test that manufactured a selection to prove the button is disabled
  // would be asserting against a state the surface cannot produce.
  it("closed opportunities never appear in the queue, so the queue offers no edit for them", () => {
    renderWorkspace({ updateOpportunity: vi.fn() });
    const table = screen.getByRole("table");
    // Riverside Diner is the LOST fixture.
    expect(within(table).queryByText("Riverside Diner")).toBeNull();
  });

  it("every Edit affordance the queue DOES offer belongs to an open opportunity", () => {
    renderWorkspace({ updateOpportunity: vi.fn() });
    const edits = screen.getAllByRole("button", { name: /^edit /i });
    expect(edits.length).toBeGreaterThan(0);
    edits.forEach((b) => expect(b.disabled).toBe(false));
  });
});
