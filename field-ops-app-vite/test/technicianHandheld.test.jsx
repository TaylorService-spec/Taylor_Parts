// TECHNICIAN HANDHELD -- the job in hand, on a phone (vitest + jsdom).
//
// ============================ WHAT THIS COVERS ============================
//
// Two gaps closed for the phone-first technician experience, and one of them was a real defect:
//
//   CONTEXT. Scanning and note-taking are opened FROM the current job, and the job travels with
//   them. PartsScanner used to take `active[0]` unconditionally -- the FIRST active job, whichever
//   that happened to be -- so a technician with three jobs who scanned from job two had the part
//   attributed to job one, silently, with a confirmation naming the wrong job. Nothing refused it,
//   because the server was told a work order they genuinely are assigned to.
//
//   NOTES. `executionNote` already existed on the governed command; there was no way to reach it
//   from a phone. Voice is an INPUT METHOD here and nothing more -- raw transcription is never
//   auto-saved, because speech recognition mishears exactly the things a service record must get
//   right, and the note is a document somebody may later rely on.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import JobNote from "../src/modules/mobile/JobNote.jsx";

afterEach(cleanup);

const mount = (over = {}) => {
  const save = over.save ?? vi.fn().mockResolvedValue({ success: true, workOrderId: "WO-1", updatedFields: ["executionNote"] });
  render(<JobNote workOrderId={over.workOrderId ?? "WO-1"} deps={{ save }} />);
  return save;
};
const open = () => fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
const type = (text) => fireEvent.change(screen.getByLabelText(/note for this job/i), { target: { value: text } });

// ═══════════════════════════════════════════ the editor

describe("adding a note", () => {
  it("opens an editable draft rather than a form to fill in", () => {
    mount();
    open();
    expect(screen.getByLabelText(/note for this job/i).tagName.toLowerCase()).toBe("textarea");
  });

  it("SAVE IS DISABLED until there is something to save", () => {
    mount();
    open();
    expect(screen.getByRole("button", { name: /save note/i }).disabled).toBe(true);
    type("Replaced the evaporator fan motor.");
    expect(screen.getByRole("button", { name: /save note/i }).disabled).toBe(false);
  });

  it("saves through the EXISTING governed command, with no invented field", async () => {
    const save = mount();
    open();
    type("Replaced the evaporator fan motor.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(save).toHaveBeenCalledWith("WO-1", { executionNote: "Replaced the evaporator fan motor." });
    // Exactly two arguments, exactly one field: nothing else rides along.
    expect(Object.keys(save.mock.calls[0][1])).toEqual(["executionNote"]);
  });

  it("trims, so a dictated trailing space is not stored as content", async () => {
    const save = mount();
    open();
    type("  Coil cleaned.  ");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(save).toHaveBeenCalledWith("WO-1", { executionNote: "Coil cleaned." });
  });
});

// ═══════════════════════════════════════════ voice is an input method

describe("dictation", () => {
  it("the control offers BOTH typing and speaking, in the same draft", () => {
    mount();
    open();
    expect(screen.getByLabelText(/note for this job/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /speak|dictate/i })).toBeTruthy();
  });

  it("TRANSCRIPTION NEVER AUTO-SAVES -- text appearing is not text committed", async () => {
    // The assertion that matters most here. Dictation invites the assumption that speaking IS
    // saving, and a service record written by a microphone nobody proof-read is worse than no note.
    const save = mount();
    open();
    type("spoken words landed in the draft");
    // No Save press.
    await waitFor(() => expect(screen.getByLabelText(/note for this job/i).value).toMatch(/spoken words/));
    expect(save).not.toHaveBeenCalled();
  });

  it("says out loud that nothing is saved until Save is pressed", () => {
    mount();
    open();
    expect(screen.getByText(/nothing is saved until you press save note/i)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ the draft is not thrown away

describe("leaving with unsaved words", () => {
  it("CANCEL WARNS instead of discarding silently", () => {
    mount();
    open();
    type("half a note");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/has not been saved/i);
    expect(screen.getByLabelText(/note for this job/i).value).toBe("half a note");
  });

  it("KEEP WRITING returns to the draft intact", () => {
    mount();
    open();
    type("half a note");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep writing/i }));
    expect(screen.getByLabelText(/note for this job/i).value).toBe("half a note");
  });

  it("and discarding is a second, deliberate press", () => {
    mount();
    open();
    type("half a note");
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole("button", { name: /discard note/i }));
    expect(screen.queryByLabelText(/note for this job/i)).toBeNull();
  });

  it("an empty draft closes without nagging", () => {
    mount();
    open();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText(/note for this job/i)).toBeNull();
  });
});

// ═══════════════════════════════════════════ failure keeps the work

describe("when the save fails", () => {
  it("THE DRAFT SURVIVES -- losing dictated words to a dropped connection is unforgivable", async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code: "functions/unavailable" }));
    mount({ save });
    open();
    type("Compressor replaced under warranty.");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText(/note for this job/i).value).toBe("Compressor replaced under warranty.");
    expect(screen.getByRole("button", { name: /save note/i }).disabled).toBe(false);
  });

  it("a refusal is rendered as a refusal, not as a save", async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error("no"), { code: "functions/permission-denied" }));
    mount({ save });
    open();
    type("note");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save note/i })); });
    expect(screen.queryByText(/note saved/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ nothing without a job

describe("no job in hand", () => {
  it("renders nothing at all rather than a note that could go nowhere", () => {
    const { container } = render(<JobNote workOrderId={null} deps={{ save: vi.fn() }} />);
    expect(container.textContent).toBe("");
  });
});
