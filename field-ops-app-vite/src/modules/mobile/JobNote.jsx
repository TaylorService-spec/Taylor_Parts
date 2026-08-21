import { useCallback, useEffect, useRef, useState } from "react";
import DictatableNote from "../../shared/ui/DictatableNote.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { updateWorkOrderExecutionData } from "../../services/workOrderService";
import { workflowActionErrorMessage } from "../../domain/workflowActionError";

// ADD A NOTE TO THE JOB IN HAND -- type it or say it, then read it before it is saved.
//
// ============================ NO NEW AUTHORITY ============================
//
// `executionNote` is an EXISTING field on the EXISTING governed command
// (updateWorkOrderExecutionData), which already verifies the Work Order is assigned to this
// technician. This component adds a way to reach it from a phone. It invents no field, no collection
// and no permission, and it cannot write anywhere the technician could not already write.
//
// ============================ VOICE IS AN INPUT METHOD, NOT AN AUTHORITY ============================
//
// Dictation puts words in a textarea and stops. It does not send, does not interpret, does not
// decide, and above all DOES NOT SAVE.
//
// RAW TRANSCRIPTION IS NEVER AUTO-SAVED. Speech recognition mishears -- part numbers, model codes and
// customer names most of all -- and a service record is a document somebody may later rely on. So the
// spoken text lands in the same editable draft typed text lands in, the technician reads it, and a
// separate deliberate press commits it. There is no path from microphone to server that does not pass
// through a human reading the words.
//
// This is deliberately NOT a conversational assistant. It cannot be asked to do anything, and adding
// that later is a separate product decision rather than an extension of this control.
//
// ============================ THE DRAFT SURVIVES ============================
//
// An unsaved draft is kept while the technician navigates within the job -- closing the note editor
// does not silently discard what they wrote. Discarding is an explicit choice, with the cost stated.

export const NOTE_STATE = Object.freeze({
  CLOSED: "CLOSED",
  EDITING: "EDITING",
  SAVING: "SAVING",
  SAVED: "SAVED",
});

export default function JobNote({ workOrderId, deps }) {
  const save = deps?.save ?? updateWorkOrderExecutionData;

  const [state, setState] = useState(NOTE_STATE.CLOSED);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const hasDraft = draft.trim() !== "";

  const close = useCallback(() => {
    // Leaving with words in the box is a decision, not a side effect of pressing the wrong thing.
    if (hasDraft) { setConfirmDiscard(true); return; }
    setState(NOTE_STATE.CLOSED);
    setError(null);
  }, [hasDraft]);

  const discard = useCallback(() => {
    setDraft("");
    setConfirmDiscard(false);
    setState(NOTE_STATE.CLOSED);
    setError(null);
  }, []);

  const commit = useCallback(async () => {
    const text = draft.trim();
    if (text === "" || state === NOTE_STATE.SAVING) return;
    setState(NOTE_STATE.SAVING);
    setError(null);
    try {
      await save(workOrderId, { executionNote: text });
      if (!alive.current) return;
      setDraft("");
      setState(NOTE_STATE.SAVED);
    } catch (err) {
      if (!alive.current) return;
      // The draft is KEPT on failure. Losing what somebody just dictated because the network dropped
      // is the one outcome guaranteed to stop them using the feature again.
      setError(workflowActionErrorMessage(err) ?? "That note could not be saved. It is still here — try again.");
      setState(NOTE_STATE.EDITING);
    }
  }, [draft, state, save, workOrderId]);

  if (!workOrderId) return null;

  if (state === NOTE_STATE.CLOSED) {
    return (
      <div className="fo-jobnote">
        <Button type="button" variant="secondary" className="fo-jobnote__open" onClick={() => setState(NOTE_STATE.EDITING)}>
          Add a note
        </Button>
        {/* Confirmation of the last save stays until the next action, rather than a toast that is
            gone before a gloved hand has put the phone down. */}
        {state === NOTE_STATE.SAVED && <p className="fo-scan__notice fo-scan__notice--ok" role="status">Note saved.</p>}
      </div>
    );
  }

  return (
    <div className="fo-jobnote fo-jobnote--open">
      <DictatableNote
        value={draft}
        onChange={setDraft}
        label="Note for this job"
        placeholder="Type it, or press Speak and read it back before saving"
        deps={deps?.dictation}
      />

      {error && <p className="fo-scan__notice fo-scan__notice--warn" role="alert">{error}</p>}

      {confirmDiscard ? (
        <p className="fo-scan__leave" role="alert">
          <span>This note has not been saved. Leaving discards it.</span>
          <button type="button" className="fo-link-btn fo-scan__leave-discard" onClick={discard}>Discard note</button>
          <button type="button" className="fo-link-btn" onClick={() => setConfirmDiscard(false)}>Keep writing</button>
        </p>
      ) : (
        <div className="fo-jobnote__actions">
          <Button type="button" variant="primary" onClick={commit} disabled={!hasDraft || state === NOTE_STATE.SAVING}>
            {state === NOTE_STATE.SAVING ? "Saving…" : "Save note"}
          </Button>
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
        </div>
      )}

      {/* Said plainly, because dictation invites the assumption that speaking IS saving. */}
      <p className="fo-scan__plan">Nothing is saved until you press Save note.</p>
    </div>
  );
}
