// TYPE OR DICTATE — the shared free-text field (vitest + jsdom).
//
// The property that matters most here is a NEGATIVE: dictation is an input method, not an assistant.
// It turns speech into text in a field and stops — no transport, no intent, no decision. The obvious
// next step ("work out what they meant") is a conversational assistant, which is a separate future
// add-on and explicitly not this.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import DictatableNote from "../src/shared/ui/DictatableNote.jsx";

afterEach(cleanup);

/** A fake recogniser whose events the test drives explicitly. */
function fakeRecognizer() {
  const r = {
    started: false, stopped: false,
    start() { r.started = true; },
    stop() { r.stopped = true; r.onend?.(); },
    onresult: null, onerror: null, onend: null,
    say(...phrases) {
      // Same reason: the recogniser calls back outside any DOM event.
      act(() => r.onresult?.({ results: phrases.map((p) => [{ transcript: p }]) }));
    },
  };
  return r;
}

const field = () => screen.getByLabelText(/note/i);

function mount(over = {}) {
  const onChange = vi.fn();
  const recognizer = over.recognizer ?? fakeRecognizer();
  const { rerender } = render(
    <DictatableNote value={over.value ?? ""} onChange={onChange} deps={{ recognizerFactory: () => recognizer }} />,
  );
  return { onChange, recognizer, rerender };
}

// ────────────────────────────────────────────── it is an input method, nothing more

describe("Dictatable note (an input method, not an assistant)", () => {
  it("reaches NO transport and resolves NO identity", () => {
    const src = readFileSync(resolve(process.cwd(), "src/shared/ui/DictatableNote.jsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const forbidden of [/firebase/i, /httpsCallable/, /callable/i, /fetch\(/, /resolveScannedIdentity/, /Command/]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("interprets nothing — speech becomes text, and that is all", () => {
    const src = readFileSync(resolve(process.cwd(), "src/shared/ui/DictatableNote.jsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const forbidden of [/intent/i, /parseCommand/i, /assistant/i, /\bnlp\b/i]) {
      expect(code).not.toMatch(forbidden);
    }
  });
});

// ────────────────────────────────────────────── dictation

describe("Dictatable note (dictating)", () => {
  it("what is spoken lands in the field, trimmed", () => {
    const { onChange, recognizer } = mount();
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(recognizer.started).toBe(true);
    recognizer.say("  box was crushed  ");
    expect(onChange).toHaveBeenCalledWith("box was crushed");
  });

  it("dictation APPENDS to what was already typed — it does not eat the note", () => {
    const { onChange, recognizer } = mount({ value: "Short by two." });
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    recognizer.say("the rest are on order");
    expect(onChange).toHaveBeenCalledWith("Short by two. the rest are on order");
  });

  it("says it is listening, and tells the operator to check the text", () => {
    const { recognizer } = mount();
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(screen.getByRole("status").textContent).toMatch(/listening/i);
    expect(screen.getByText(/check the text before you save/i)).toBeTruthy();
    expect(recognizer.started).toBe(true);
  });

  it("can be stopped", () => {
    const { recognizer } = mount();
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop dictating/i }));
    expect(recognizer.stopped).toBe(true);
    expect(screen.getByRole("button", { name: /^dictate$/i })).toBeTruthy();
  });

  it("stops on unmount — a live microphone behind a closed screen is not acceptable", () => {
    const recognizer = fakeRecognizer();
    const { unmount } = render(
      <DictatableNote value="" onChange={vi.fn()} deps={{ recognizerFactory: () => recognizer }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    unmount();
    expect(recognizer.stopped).toBe(true);
  });
});

// ────────────────────────────────────────────── the transcript is always editable

describe("Dictatable note (nothing is saved unread)", () => {
  it("the transcript lands in an ORDINARY editable field", () => {
    mount({ value: "box was crushd" });
    expect(field().tagName).toBe("TEXTAREA");
    expect(field().readOnly).toBe(false);
    expect(field().disabled).toBe(false);
  });

  it("a mis-heard word can be corrected by typing", () => {
    const { onChange } = mount({ value: "box was crushd" });
    fireEvent.change(field(), { target: { value: "box was crushed" } });
    expect(onChange).toHaveBeenCalledWith("box was crushed");
  });

  it("typing works DURING dictation — a correction should not require stopping", () => {
    const { onChange } = mount();
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    fireEvent.change(field(), { target: { value: "typed while listening" } });
    expect(onChange).toHaveBeenCalledWith("typed while listening");
  });

  it("there is NO save here — saving is the workflow's own deliberate act", () => {
    mount();
    for (const forbidden of [/^save$/i, /submit/i, /confirm/i]) {
      expect(screen.queryByRole("button", { name: forbidden })).toBeNull();
    }
  });
});

// ────────────────────────────────────────────── it degrades to typing

describe("Dictatable note (typing is never removed)", () => {
  it("an unsupported device says so, and the field still works", () => {
    const onChange = vi.fn();
    render(<DictatableNote value="" onChange={onChange} deps={{ recognizerFactory: () => null }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(screen.getByRole("status").textContent).toMatch(/cannot take dictation/i);
    fireEvent.change(field(), { target: { value: "typed instead" } });
    expect(onChange).toHaveBeenCalledWith("typed instead");
  });

  it("a REFUSED microphone is distinct from a failure — they send the operator different places", () => {
    const denied = fakeRecognizer();
    const { rerender } = render(
      <DictatableNote value="" onChange={vi.fn()} deps={{ recognizerFactory: () => denied }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    // onerror fires outside React's event system, so the state update needs an explicit flush.
    act(() => denied.onerror({ error: "not-allowed" }));
    const deniedText = screen.getByRole("status").textContent;
    expect(deniedText).toMatch(/microphone was not allowed/i);

    cleanup();
    const broken = fakeRecognizer();
    render(<DictatableNote value="" onChange={vi.fn()} deps={{ recognizerFactory: () => broken }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    // "audio-capture", not "network". WO-03 §37 gave `network` a meaning of its own -- the recogniser
    // could not reach its speech service -- so it is no longer an example of a GENERIC failure. This
    // assertion is about denied-vs-failed being different places, and that is unchanged; only the
    // stand-in for "something else broke" moved. The network case is proven in offlineSyncUi.test.jsx.
    act(() => broken.onerror({ error: "audio-capture" }));
    const failedText = screen.getByRole("status").textContent;
    expect(failedText).toMatch(/stopped unexpectedly/i);
    expect(failedText).not.toBe(deniedText);
    expect(rerender).toBeTruthy();
  });

  it("a recogniser that throws on start does not break the field", () => {
    const throwing = { ...fakeRecognizer(), start() { throw new Error("nope"); } };
    const onChange = vi.fn();
    render(<DictatableNote value="" onChange={onChange} deps={{ recognizerFactory: () => throwing }} />);
    fireEvent.click(screen.getByRole("button", { name: /dictate/i }));
    expect(screen.getByRole("status").textContent).toMatch(/stopped unexpectedly/i);
    fireEvent.change(field(), { target: { value: "still works" } });
    expect(onChange).toHaveBeenCalledWith("still works");
  });

  it("the state line is announced to a screen reader", () => {
    mount();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
