// SHARED SCANNER INPUT — the pure input policy. No emulator, no React, no timers.
// Run: node --test test/scanInputPolicy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  admitScan, isRepeatScan, repeatWindowFor, feedbackText, feedbackTone, vibrationPattern,
  FEEDBACK, SCAN_SOURCE, REPEAT_WINDOW_MS,
} from "../src/domain/scanInputPolicy.js";

const at = (value, ms) => ({ value, at: ms });

// ─────────────────────────────────────────── the load-bearing distinction

test("counting identical boxes with a wedge is NOT suppressed", () => {
  // The worst failure a cycle count can have is silently under-counting. Ten identical boxes means
  // scanning the same value ten times, deliberately.
  const window = REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED];
  const r = admitScan({ last: at("PRT-1001", 0), value: "PRT-1001", now: window + 1, source: SCAN_SOURCE.KEYED });
  assert.equal(r.accept, true);
});

test("a wedge STUTTER is suppressed — the same code milliseconds apart is one scan", () => {
  const r = admitScan({ last: at("PRT-1001", 1000), value: "PRT-1001", now: 1012, source: SCAN_SOURCE.KEYED });
  assert.equal(r.accept, false);
  assert.equal(r.reason, "REPEAT");
});

test("the KEYED window is short enough for real counting and long enough for a stutter", () => {
  const keyed = REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED];
  assert.ok(keyed >= 100, "a double-fire arrives within ~50ms; the window must clear it");
  assert.ok(keyed <= 400, "any longer starts suppressing a person scanning a second identical box");
});

test("the CAMERA window is far longer, because a decoder re-emits every frame", () => {
  const camera = REPEAT_WINDOW_MS[SCAN_SOURCE.CAMERA];
  assert.ok(camera >= 1000, "a label sitting in view emits ~60 times a second");
  assert.ok(camera > REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED]);
});

test("a camera holding one label in frame is ONE scan, not sixty", () => {
  let last = null;
  let accepted = 0;
  // 60fps for one second on the same label.
  for (let frame = 0; frame < 60; frame += 1) {
    const now = frame * 16;
    const r = admitScan({ last, value: "0037000112345", now, source: SCAN_SOURCE.CAMERA });
    if (r.accept) { accepted += 1; last = at(r.value, now); }
  }
  assert.equal(accepted, 1);
});

test("an UNKNOWN source defaults to the SHORTER window", () => {
  // A duplicate the operator can see and undo beats a silently swallowed real count.
  assert.equal(repeatWindowFor("SOMETHING_ELSE"), REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED]);
  assert.equal(repeatWindowFor(undefined), REPEAT_WINDOW_MS[SCAN_SOURCE.KEYED]);
});

// ─────────────────────────────────────────── repeat detection

test("a DIFFERENT value is never a repeat, however fast it arrives", () => {
  const r = admitScan({ last: at("PRT-1001", 1000), value: "PRT-2002", now: 1001 });
  assert.equal(r.accept, true);
});

test("repeat detection ignores case and surrounding space", () => {
  assert.equal(isRepeatScan(at("SN-1", 0), " sn-1 ", 10), true);
});

test("the accepted value is TRIMMED but otherwise untouched", () => {
  // Normalization belongs to the identity resolver. Anything more here would be a second normalizer.
  const r = admitScan({ last: null, value: "  PRT-1001  ", now: 0 });
  assert.equal(r.value, "PRT-1001");
});

test("no previous scan means nothing is a repeat", () => {
  assert.equal(isRepeatScan(null, "X", 0), false);
  assert.equal(isRepeatScan({ value: "X" }, "X", 0), false, "a malformed last must not suppress");
  assert.equal(isRepeatScan({ at: 0 }, "X", 0), false);
});

test("a BACKWARDS clock never suppresses", () => {
  // An extra scan the operator can undo beats a silently swallowed one.
  assert.equal(isRepeatScan(at("X", 5000), "X", 1000), false);
});

test("an empty scan is refused quietly — it is not an error", () => {
  for (const value of ["", "   ", null, undefined, 42]) {
    const r = admitScan({ last: null, value, now: 0 });
    assert.equal(r.accept, false);
    assert.equal(r.reason, "EMPTY");
    assert.equal(r.feedback, FEEDBACK.NEUTRAL, "an empty field is not something to buzz about");
  }
});

// ─────────────────────────────────────────── feedback

test("ACCEPTED and REJECTED are distinguishable by PITCH, not volume", () => {
  // The distinction has to survive being heard across a room over a forklift.
  const ok = feedbackTone(FEEDBACK.ACCEPTED);
  const bad = feedbackTone(FEEDBACK.REJECTED);
  assert.notEqual(ok.frequency, bad.frequency);
  assert.ok(ok.frequency > bad.frequency, "rising for accepted, falling for rejected");
});

test("REJECTED buzzes a RHYTHM, because a gloved hand cannot tell one buzz from another", () => {
  assert.equal(vibrationPattern(FEEDBACK.ACCEPTED).length, 1);
  assert.ok(vibrationPattern(FEEDBACK.REJECTED).length > 1);
});

test("a suppressed repeat makes NO sound and NO buzz", () => {
  assert.equal(feedbackTone(FEEDBACK.NEUTRAL), null);
  assert.equal(vibrationPattern(FEEDBACK.NEUTRAL), null);
});

test("every announcement NAMES the value — 'scanned' alone is useless at a wall of similar boxes", () => {
  for (const feedback of Object.values(FEEDBACK)) {
    assert.match(feedbackText(feedback, "PRT-1001"), /PRT-1001/);
  }
});

test("a rejection carries the workflow's own reason when there is one", () => {
  const withDetail = feedbackText(FEEDBACK.REJECTED, "PRT-9999", "That is a different part.");
  assert.match(withDetail, /different part/i);
  const without = feedbackText(FEEDBACK.REJECTED, "PRT-9999");
  assert.match(without, /not accepted/i);
});

test("the three feedback kinds never share a sentence", () => {
  const texts = Object.values(FEEDBACK).map((f) => feedbackText(f, "X"));
  assert.equal(new Set(texts).size, texts.length);
});

test("a missing value still produces a sentence rather than a blank announcement", () => {
  assert.match(feedbackText(FEEDBACK.ACCEPTED, ""), /that code/i);
});

// ─────────────────────────────────────────── boundaries

test("the module resolves NO identity and reaches NO transport", () => {
  const src = readFileSync(new URL("../src/domain/scanInputPolicy.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/resolveScannedIdentity/, /firebase/i, /firestore/i, /callable/i, /Command/, /document\./, /window\./]) {
    assert.doesNotMatch(code, forbidden, `input policy must not reference ${forbidden}`);
  }
});

test("results are frozen", () => {
  const r = admitScan({ last: null, value: "X", now: 0 });
  assert.throws(() => { r.accept = false; }, TypeError);
});
