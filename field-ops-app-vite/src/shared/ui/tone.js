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
