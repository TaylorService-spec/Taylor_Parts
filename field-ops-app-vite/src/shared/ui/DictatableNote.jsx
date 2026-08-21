import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./primitives/index.js";

// TYPE **OR** DICTATE — a free-text field for gloved hands in a loud building.
//
// ============================ DICTATION IS AN INPUT METHOD, NOT AN ASSISTANT ============================
//
// This turns speech into TEXT IN A FIELD, and stops. It sends nothing anywhere, interprets no
// commands, extracts no intent, and makes no decision. What the operator says becomes what they can
// see and edit; what they save is what they reviewed.
//
// That boundary is deliberate and worth stating, because the obvious next step — "just let them say
// what they want and work out what they meant" — is a conversational assistant, which is a separate
// future add-on and NOT part of this UX. A test asserts this component reaches no transport and
// resolves no identity.
//
// ============================ TRANSCRIPTION IS ALWAYS EDITABLE ============================
//
// Speech recognition mishears. A warehouse defeats it further: forklifts, radios, roller doors. So
// the transcript lands in an ORDINARY TEXTAREA the operator can correct, and saving is a separate,
// deliberate act. There is no path where spoken words are stored without a human having seen them.
//
// ============================ IT DEGRADES TO TYPING ============================
//
// Where the browser has no speech recognition — or the microphone is refused, or it simply fails —
// the field still works and the screen says which. Typing is never removed and never hidden behind
// the microphone.

/** How the field is currently taking input. Module-private: nothing outside needs to name it. */
const DICTATION_STATE = Object.freeze({
  IDLE: "IDLE",
  LISTENING: "LISTENING",
  UNSUPPORTED: "UNSUPPORTED",
  DENIED: "DENIED",
  FAILED: "FAILED",
});

const STATE_TEXT = Object.freeze({
  [DICTATION_STATE.LISTENING]: "Listening — speak, then check what it heard.",
  [DICTATION_STATE.UNSUPPORTED]: "This device cannot take dictation. Type the note instead.",
  [DICTATION_STATE.DENIED]: "The microphone was not allowed. Type the note instead.",
  [DICTATION_STATE.FAILED]: "Dictation stopped unexpectedly. Type the note, or try again.",
});

function speechRecognizer() {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  // Interim results let the operator see it working. A field that sits blank while somebody talks
  // reads as broken, and they start again — over the top of a recogniser that was listening fine.
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  return recognition;
}

/**
 * @param value      the current note text (controlled).
 * @param onChange   called with the edited text.
 * @param label      accessible label.
 * @param deps       test seam: `recognizerFactory`.
 */
export default function DictatableNote({ value = "", onChange, label = "Note", placeholder = "Type or dictate a note", deps }) {
  const [state, setState] = useState(DICTATION_STATE.IDLE);
  const recognitionRef = useRef(null);
  // What was typed BEFORE dictation started, so interim results replace only the spoken part rather
  // than eating a note the operator had already written.
  const baseRef = useRef("");
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    try { recognitionRef.current?.stop?.(); } catch { /* already stopped */ }
  }, []);

  const stop = useCallback(() => {
    try { recognitionRef.current?.stop?.(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    if (alive.current) setState(DICTATION_STATE.IDLE);
  }, []);

  const start = useCallback(() => {
    const factory = deps?.recognizerFactory ?? speechRecognizer;
    let recognition;
    try {
      recognition = factory();
    } catch {
      recognition = null;
    }
    if (!recognition) {
      setState(DICTATION_STATE.UNSUPPORTED);
      return;
    }

    baseRef.current = value ?? "";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      if (!alive.current) return;
      let spoken = "";
      for (let i = 0; i < event.results.length; i += 1) spoken += event.results[i][0]?.transcript ?? "";
      const base = baseRef.current;
      onChange?.(base && spoken ? `${base.trimEnd()} ${spoken.trim()}` : (spoken.trim() || base));
    };
    recognition.onerror = (event) => {
      if (!alive.current) return;
      // A refused microphone and a failed recogniser send the operator to different places, so they
      // are never collapsed into one message.
      setState(event?.error === "not-allowed" || event?.error === "service-not-allowed"
        ? DICTATION_STATE.DENIED
        : DICTATION_STATE.FAILED);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      if (!alive.current) return;
      recognitionRef.current = null;
      setState((current) => (current === DICTATION_STATE.LISTENING ? DICTATION_STATE.IDLE : current));
    };

    try {
      recognition.start();
      setState(DICTATION_STATE.LISTENING);
    } catch {
      setState(DICTATION_STATE.FAILED);
      recognitionRef.current = null;
    }
  }, [deps, onChange, value]);

  const listening = state === DICTATION_STATE.LISTENING;

  return (
    <div className="fo-note">
      <label className="fo-note__label">
        {label}
        <textarea
          className="fo-note__field"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          rows={3}
          // Typing is ALWAYS available. Even mid-dictation, a correction should not require stopping.
        />
      </label>

      <div className="fo-note__controls">
        <Button
          type="button"
          variant={listening ? "primary" : "secondary"}
          onClick={listening ? stop : start}
        >
          {listening ? "Stop dictating" : "Dictate"}
        </Button>
        {/* The review instruction is part of the control, not a tooltip: what is saved is what the
            operator read, and saying so is how they know to read it. */}
        <span className="fo-note__hint fo-muted">
          {listening ? "Check the text before you save it." : "You can type or dictate — either way, check it before saving."}
        </span>
      </div>

      <p className="fo-note__state fo-muted" role="status" aria-live="polite">
        {STATE_TEXT[state] ?? ""}
      </p>
    </div>
  );
}
