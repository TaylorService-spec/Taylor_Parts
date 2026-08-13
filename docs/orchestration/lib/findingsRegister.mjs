// Findings register + reconcile — the closed loop that makes audits worth running.
//
// The problem this solves: cold-read audits re-surface the same items every run (already-fixed, known-accepted,
// or deliberately-deferred) because nothing tracks a finding's RESOLUTION STATE. This register is that memory,
// and reconcile() is the gate that keeps the next audit honest: raw audit findings are matched against the
// register by a stable FINGERPRINT, and anything already resolved is dropped — only genuinely NEW findings, or a
// REGRESSION of something previously fixed, ever surface.
//
// The model (EOS as company controller): agents FIND → the verifier decides truth + actionability IMMEDIATELY at
// first disposition (including re-validating any deferral rationale THEN) → EOS fixes everything it is already
// authorized to fix → the Owner sees only genuine decisions. This register is the durable MEMORY of those
// dispositions; reconcile is the next-audit dedup gate. The register does NOT postpone a decision until a future
// audit re-finds the item — the decision was already made at disposition. Re-visiting a deferral is a deliberate,
// condition-triggered RE-DISPOSITION (e.g. "when Blaze is live"), not something every audit re-opens.
//
// Guarantees:
//   • "fixed is really fixed"    → FIXED is trusted ONLY with a passing `regressionTest` (a reappearance is then
//                                   a REGRESSION alarm). FIXED WITHOUT a test is not a fix — a reappearance
//                                   escalates as `unprovenFixed`, and `unverifiedFixed` lists such entries.
//   • "reasons are verified at disposition, not deferred to the next audit" → KNOWN_ACCEPTED / DEFERRED were
//                                   already dispositioned (rationale validated at that time), so on a re-find they
//                                   are SUPPRESSED as memory — not re-raised, not re-reviewed per audit. Their
//                                   re-evaluation is condition-triggered (`revalidateWhen`), handled at disposition.
//   • "next audit only NEW work" → only genuinely NEW findings `surface`; regressions/unproven-fixed escalate.
//
// Pure and deterministic (no I/O, no clock). The register is a plain data array the caller loads/persists.

import { createHash } from "node:crypto";

export const FINDING_STATUS = Object.freeze({
  CONFIRMED_OPEN: "CONFIRMED_OPEN",   // verified real, not yet fixed — legitimately tracked, not "new" again
  FIXED: "FIXED",                     // remediated; MUST carry a regressionTest to be trustworthy
  KNOWN_ACCEPTED: "KNOWN_ACCEPTED",   // real edge but a conscious/documented design tradeoff — do not re-raise
  DEFERRED: "DEFERRED",               // deliberately postponed (carries deferralRef, e.g. an issue #)
  FALSE_POSITIVE: "FALSE_POSITIVE",   // not actually a defect (e.g. flagged a documented behavior)
});
const RESOLVED = new Set([FINDING_STATUS.FIXED, FINDING_STATUS.KNOWN_ACCEPTED, FINDING_STATUS.DEFERRED, FINDING_STATUS.FALSE_POSITIVE]);

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\\/g, "/").replace(/\s+/g, " ");

/**
 * Stable fingerprint for a finding — keyed on LOCATION (file + symbol), NOT line numbers or prose, so the same
 * issue produces the same id across audits even as line numbers drift and wording changes. Category is folded in
 * only when there's no symbol (so two different concerns in the same bare file don't collapse).
 */
export function fingerprintFinding({ file, symbol, category } = {}) {
  const key = symbol ? `${norm(file)}::${norm(symbol)}` : `${norm(file)}::${norm(category)}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function withFingerprint(f) {
  return f.fingerprint || fingerprintFinding(f);
}

/**
 * Reconcile a fresh audit's findings against the register. Deterministic, no mutation of inputs.
 * @param {Array}  findings  raw audit findings: [{ file, symbol?, category?, severity?, title? }]
 * @param {Array}  register  known entries: [{ fingerprint?, file, symbol?, category?, status, regressionTest?, deferralRef? }]
 * @returns {{ surfaced, regressions, unprovenFixed, alreadyOpen, suppressed, unverifiedFixed }}
 *   - surfaced        : genuinely NEW findings (not in the register) — the ONLY items that need a fresh
 *                       disposition (verifier decides now-change vs defer, from the very beginning)
 *   - regressions     : a fingerprint marked FIXED-WITH-TEST reappeared — the guard failed; ALARM
 *   - unprovenFixed   : a fingerprint marked FIXED but with NO regressionTest reappeared — the "fix" was never
 *                       proven, so a reappearance is escalated (it may still be real), never suppressed
 *   - alreadyOpen     : matched a CONFIRMED_OPEN entry — real, already tracked, not "new"
 *   - suppressed      : matched an already-DISPOSITIONED entry (FALSE_POSITIVE / KNOWN_ACCEPTED / DEFERRED) —
 *                       memory of a decision already made; dropped from the audit's actionable output. NOT
 *                       re-reviewed per audit (re-visiting a deferral is a condition-triggered re-disposition).
 *   - unverifiedFixed : register-integrity list — entries marked FIXED but lacking a regressionTest
 */
export function reconcileFindings(findings = [], register = []) {
  const byFp = new Map();
  for (const e of Array.isArray(register) ? register : []) byFp.set(withFingerprint(e), e);

  const surfaced = [], regressions = [], unprovenFixed = [], alreadyOpen = [], suppressed = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    const fp = withFingerprint(f);
    const known = byFp.get(fp);
    if (!known) { surfaced.push({ ...f, fingerprint: fp, disposition: "NEW" }); continue; }
    const base = { ...f, fingerprint: fp };
    switch (known.status) {
      case FINDING_STATUS.FIXED:
        if (known.regressionTest) {
          // Proven-fixed and it reappeared → the guarding test should have caught it. Alarm, not silent re-raise.
          regressions.push({ ...base, disposition: "REGRESSION", regressionTest: known.regressionTest });
        } else {
          // "Fixed" was never proven (no test) — a reappearance means it may never have been fixed. Escalate.
          unprovenFixed.push({ ...base, disposition: "UNPROVEN_FIXED", reason: "marked FIXED but no regression test — fix was never proven" });
        }
        break;
      case FINDING_STATUS.CONFIRMED_OPEN:
        alreadyOpen.push({ ...base, disposition: "ALREADY_OPEN" });
        break;
      case FINDING_STATUS.KNOWN_ACCEPTED:
      case FINDING_STATUS.DEFERRED:
      default: // + FALSE_POSITIVE — already dispositioned at find-time; memory, not re-actioned per audit.
        suppressed.push({ ...base, disposition: "SUPPRESSED", becauseStatus: known.status, deferralRef: known.deferralRef ?? null, revalidateWhen: known.revalidateWhen ?? null });
    }
  }

  const unverifiedFixed = (Array.isArray(register) ? register : [])
    .filter((e) => e.status === FINDING_STATUS.FIXED && !e.regressionTest)
    .map((e) => ({ fingerprint: withFingerprint(e), file: e.file, symbol: e.symbol ?? null }));

  return Object.freeze({
    surfaced: Object.freeze(surfaced),
    regressions: Object.freeze(regressions),
    unprovenFixed: Object.freeze(unprovenFixed),
    alreadyOpen: Object.freeze(alreadyOpen),
    suppressed: Object.freeze(suppressed),
    unverifiedFixed: Object.freeze(unverifiedFixed),
  });
}

/** Convenience: is a status one that suppresses re-surfacing? */
export const isResolved = (status) => RESOLVED.has(status);
