import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./primitives/index.js";
import {
  admitScan,
  feedbackText,
  feedbackTone,
  vibrationPattern,
  FEEDBACK,
  SCAN_SOURCE,
} from "../../domain/scanInputPolicy.js";

// THE SHARED SCANNER INPUT.
//
// One input for every scanning workflow. It handles the three ways a code arrives and the hazards
// each brings, so receiving, transfers, counting and lookup do not each solve them slightly
// differently.
//
//   HARDWARE WEDGE   A scanner acting as a keyboard: it types the code and presses Enter. That is
//                    an ordinary form submit — no special handling, which is exactly why it works
//                    with any wedge on the market. What it DOES need is the field to still be
//                    focused, which is what continuous focus below is for.
//
//                    Its repeat window is SHORT (250ms), because counting ten identical boxes means
//                    scanning the same value ten times deliberately. Suppressing that would silently
//                    under-count — the worst failure a cycle count can have.
//
//   CAMERA           BarcodeDetector where the browser has it. It decodes at frame rate, so the same
//                    label sitting in view emits continuously; the repeat window turns that into one
//                    scan. Where the API is missing the field still works and the screen says so
//                    rather than showing a dead button.
//
//   TYPING           A damaged label still has to be enterable. Never removed, never hidden behind
//                    the camera.
//
// ============================ CONTINUOUS FOCUS ============================
//
// After every scan the field takes focus again. A wedge types into whatever is focused, so a screen
// that lets focus drift after the first scan silently drops the second — the operator sees nothing
// happen and scans harder. Focus is only taken back when this input is meant to be live, so it never
// fights a dialog.
//
// ============================ FEEDBACK IS THREE-CHANNEL ============================
//
// Sound, vibration and text, because a warehouse defeats any one of them: gloves defeat vibration,
// noise defeats sound, and a phone in a holster defeats the screen. All three are advisory and every
// one degrades silently where the platform lacks it.
//
// The text channel is also the accessibility channel — an aria-live region announcing the same
// sentence, naming the value, so a screen-reader user gets exactly what a sighted operator gets.

/** Play a short tone. Advisory: any failure (no WebAudio, autoplay policy, no gesture) is ignored. */
function playTone(feedback) {
  const tone = feedbackTone(feedback);
  if (!tone) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = tone.frequency;
    // A hard start/stop clicks; a short ramp does not. In a quiet stockroom the click is what people
    // notice rather than the tone.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + tone.durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + tone.durationMs / 1000);
    osc.onended = () => { try { ctx.close(); } catch { /* already closed */ } };
  } catch {
    /* Feedback is advisory. A device that cannot beep must still be able to scan. */
  }
}

function buzz(feedback) {
  const pattern = vibrationPattern(feedback);
  if (!pattern) return;
  try { navigator.vibrate?.(pattern); } catch { /* advisory */ }
}

/**
 * @param onScan     called with the accepted raw value. May return a FEEDBACK kind (and optional
 *                   detail) so the workflow's own verdict — not merely "a code arrived" — is what
 *                   the operator hears: `{ feedback, detail }` or a bare FEEDBACK string.
 * @param label      the accessible label for the field.
 * @param placeholder
 * @param disabled   when the workflow cannot accept scans right now.
 * @param deps       test seams: `now` and `detectorFactory`.
 */
export default function ScanInput({ onScan, label = "Scan item", placeholder = "Scan or type a code", disabled = false, deps }) {
  // Stable across renders: an inline default would be a new function every render, invalidating
  // every callback below it — including the one the camera loop closes over.
  const injectedNow = deps?.now;
  const now = useCallback(() => (injectedNow ? injectedNow() : Date.now()), [injectedNow]);

  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [tone, setTone] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraNote, setCameraNote] = useState(null);

  const inputRef = useRef(null);
  const lastRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const announce = useCallback((feedback, value, detail) => {
    setTone(feedback);
    setAnnouncement(feedbackText(feedback, value, detail));
    playTone(feedback);
    buzz(feedback);
  }, []);

  const refocus = useCallback(() => {
    // A wedge types into whatever is focused. Losing focus after the first scan is how a screen
    // silently drops the second one.
    if (!disabled) inputRef.current?.focus?.();
  }, [disabled]);

  const submit = useCallback((raw, source = SCAN_SOURCE.KEYED) => {
    // The source decides the repeat window. A wedge stutters for milliseconds; a camera re-emits
    // every frame. Counting ten identical boxes with a wedge must NOT be suppressed.
    const verdict = admitScan({ last: lastRef.current, value: raw, now: now(), source });
    setQuery("");
    if (!verdict.accept) {
      // A suppressed repeat is NEUTRAL, never an error: a stuttering wedge is not the operator's
      // mistake, and buzzing at them teaches them to ignore the buzzer.
      if (verdict.reason === "REPEAT") announce(FEEDBACK.NEUTRAL, raw);
      refocus();
      return;
    }
    lastRef.current = { value: verdict.value, at: now() };
    const outcome = onScan?.(verdict.value);
    const feedback = typeof outcome === "string" ? outcome : outcome?.feedback;
    announce(feedback ?? FEEDBACK.ACCEPTED, verdict.value, outcome?.detail ?? null);
    refocus();
  }, [now, onScan, announce, refocus]);

  // ── camera ────────────────────────────────────────────────────────────────────────────────────

  const closeCamera = useCallback(() => {
    if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
    streamRef.current?.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    streamRef.current = null;
    setCameraOpen(false);
    refocus();
  }, [refocus]);

  useEffect(() => () => {
    // Never leave the camera on. A live stream behind a closed screen drains a handheld's battery
    // and lights the LED, which people reasonably read as being recorded.
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks?.().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
  }, []);

  const openCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraNote("Camera scanning is not available on this device. Type the code instead.");
      return;
    }
    try {
      // continuous focus + the rear camera: a fixed-focus front camera cannot read a small label.
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", focusMode: "continuous" },
      });
    } catch {
      setCameraNote("The camera could not be opened. Check permissions, or type the code instead.");
      return;
    }
    setCameraNote(null);
    setCameraOpen(true);

    const factory = deps?.detectorFactory ?? (async () => {
      if (!("BarcodeDetector" in window)) return null;
      const formats = (await window.BarcodeDetector.getSupportedFormats()).filter((f) => f !== "unknown");
      return formats.length ? new window.BarcodeDetector({ formats }) : null;
    });

    const detector = await factory();
    if (!alive.current) return;
    if (!detector) {
      setCameraNote("Live decoding is not supported by this browser. Type the code instead.");
      closeCamera();
      return;
    }

    const tick = async () => {
      if (!alive.current || !videoRef.current || !streamRef.current) return;
      try {
        if (videoRef.current.readyState >= 2) {
          const codes = await detector.detect(videoRef.current);
          const value = codes?.[0]?.rawValue;
          // The camera stays OPEN and keeps decoding. The repeat window makes the label sitting in
          // frame one scan, so an operator can work through a pallet without reopening the camera
          // for every box.
          if (value) submit(value, SCAN_SOURCE.CAMERA);
        }
      } catch {
        /* A frame that will not decode is normal. Keep going. */
      }
      if (alive.current && streamRef.current) frameRef.current = requestAnimationFrame(tick);
    };

    if (videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      try { await videoRef.current.play(); } catch { /* autoplay refusal still allows detection */ }
    }
    frameRef.current = requestAnimationFrame(tick);
  }, [deps, closeCamera, submit]);

  return (
    <div className="fo-scan-input">
      <form
        className="fo-scan__entry"
        onSubmit={(e) => { e.preventDefault(); submit(query); }}
      >
        <Button type="button" variant="secondary" className="fo-scan__camera" onClick={openCamera} disabled={disabled}>
          Scan a code
        </Button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          enterKeyHint="done"
          disabled={disabled}
          autoFocus
          // A wedge sends the code as keystrokes; these stop the browser or the OS from "helping".
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <Button type="submit" className="fo-scan__find" disabled={disabled}>Add</Button>
      </form>

      {/* The accessibility channel and the visible one are the SAME sentence, so a screen-reader
          user gets exactly what a sighted operator gets — including which value registered. */}
      <p
        className={`fo-scan-input__feedback${tone ? ` fo-scan-input__feedback--${tone.toLowerCase()}` : ""}`}
        role="status"
        aria-live="polite"
      >
        {announcement}
      </p>

      {cameraNote && <p className="fo-scan__state" role="status">{cameraNote}</p>}

      {cameraOpen && (
        <div className="fo-scan__camera-modal" role="dialog" aria-modal="true" aria-label="Camera scanner">
          <div>
            <video ref={videoRef} autoPlay playsInline muted />
            <p>Point the camera at the code. It keeps scanning until you close it.</p>
            <p aria-live="polite">{announcement}</p>
            <Button type="button" variant="secondary" onClick={closeCamera}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
