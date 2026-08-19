import { CheckCircle2, AlertTriangle, XCircle, Info, HelpCircle, MinusCircle, CircleDot, Circle } from "lucide-react";

// EOS shared SEMANTIC TONE — the one visual-language layer beneath every status treatment.
//
// The status standard has three separated layers: DOMAIN STATE VOCABULARY (the words, per domain: a WO is
// "SCHEDULED", a part is "SHORT") -> SEMANTIC TONE (this file: the shared meaning) -> VISUAL TREATMENT (the
// pill/text CSS). A domain maps its own states to a tone; every surface then renders that tone identically.
// This is what converges the ~9 ad-hoc pill families without flattening domain meaning into one colour.
//
// Reuses the readiness tone vocabulary already merged (domain/readinessLanguage.js): positive / attention /
// unknown / muted / neutral, plus info / critical for non-readiness signalling.
export const TONES = ["positive", "attention", "unknown", "muted", "neutral", "info", "critical"];

export function isTone(tone) {
  return TONES.includes(tone);
}

// The CSS class for a tone. Falls back to `neutral` for an unknown tone (never throws in render).
export function toneClass(tone, prefix = "fo-tone") {
  return `${prefix}--${isTone(tone) ? tone : "neutral"}`;
}

// One glyph per tone — colour must never be the only channel carrying a tone's meaning (it has to
// survive colour-blindness and greyscale printouts/screens). Kept identical to
// primitives/StatusIndicator.jsx's own TONE_ICONS map so "critical" is the same silhouette whether
// it renders as a standalone indicator line or an inline StatusPill.
export const TONE_ICONS = {
  positive: CheckCircle2,
  attention: AlertTriangle,
  critical: XCircle,
  info: Info,
  unknown: HelpCircle,
  neutral: HelpCircle,
  muted: MinusCircle,
};

// The icon for a tone, falling back to the same `neutral` default `toneClass` falls back to.
export function toneIcon(tone) {
  return TONE_ICONS[isTone(tone) ? tone : "neutral"];
}

// SignalBadge's SEVERITY vocabulary (low/medium/high/critical — see domain/controlTower's
// severity type) is its own domain scale, not a tone, and none of its four values or meanings
// change here. This mapping only lets a severity borrow the SAME glyph a tone of equivalent
// meaning would use, so "critical" reads identically whether it arrived as a tone or a severity —
// reconciling StatusPill and SignalBadge onto one icon vocabulary instead of two.
export const SEVERITY_TONE = { low: "muted", medium: "attention", high: "attention", critical: "critical" };

export function severityIcon(severity) {
  const key = severity.toLowerCase();
  return TONE_ICONS[SEVERITY_TONE[key] ?? "neutral"];
}

// The "done / current / not yet" progression vocabulary shared by LifecycleChevrons (the full
// detail control) and StageProgressTrack (the compact list-row control) — one glyph set, not two,
// so a filled ring always means "current" and a hollow ring always means "not reached yet" no
// matter which of the two controls is on screen.
export const STEP_ICONS = {
  complete: CheckCircle2,
  current: CircleDot,
  future: Circle,
};

export function stepIcon(status) {
  return STEP_ICONS[status] ?? STEP_ICONS.future;
}
