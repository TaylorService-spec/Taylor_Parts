// Findings register + reconcile — the closed loop that makes audits worth running.
//
// The problem this solves: cold-read audits re-surface the same items every run (already-fixed, known-accepted,
// or deliberately-deferred) because nothing tracks a finding's RESOLUTION STATE. This register is that memory,
// and reconcile() is the gate that keeps the next audit honest: raw audit findings are matched against the
// register by a stable FINGERPRINT, and anything already resolved is dropped — only genuinely NEW findings, or a
// REGRESSION of something previously fixed, ever surface.
//
// The guarantees the Owner asked for:
//   • "fixed is really fixed"          → a FIXED claim is worthless without proof: only FIXED WITH a passing
//                                         `regressionTest` is trusted (a reappearance is then a REGRESSION alarm).
//                                         FIXED WITHOUT a test is NOT trusted — it routes to governance review,
//                                         never silently suppressed. Don't say fixed if it isn't proven fixed.
//   • "a reason NOT to do something must be verified too — maybe it's time to do it, and that call is ChatGPT's"
//                                       → KNOWN_ACCEPTED and DEFERRED are NOT permanent suppression. Their
//                                         rationale expires; when an audit re-finds one, it routes to a
//                                         governance-review bucket for ChatGPT to re-evaluate ("is the tradeoff
//                                         still right / is the deferral reason still true / is it time now?").
//   • "next audit only NEW noise"       → truly-closed items (FIXED-with-test, FALSE_POSITIVE) are suppressed;
//                                         only genuinely NEW findings surface as new work.
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
 * @returns {{ surfaced, regressions, needsGovernanceReview, alreadyOpen, suppressed, unverifiedFixed }}
 *   - surfaced             : genuinely NEW findings (not in the register) — the only ones raised as new work
 *   - regressions          : a fingerprint marked FIXED-WITH-TEST reappeared — the guard failed; ALARM
 *   - needsGovernanceReview : matched a KNOWN_ACCEPTED / DEFERRED entry, OR a FIXED entry with NO regression test.
 *                            NOT suppressed and NOT re-raised as new — routed to ChatGPT to re-verify the
 *                            rationale and decide "still valid / time to act / actually fixed?" (each carries
 *                            reviewReason so the governor knows why).
 *   - alreadyOpen          : matched a CONFIRMED_OPEN entry — real, already tracked, not "new"
 *   - suppressed           : truly closed (FALSE_POSITIVE) — dropped
 *   - unverifiedFixed      : register entries marked FIXED but lacking a regressionTest — "fixed is not proven"
 */
export function reconcileFindings(findings = [], register = []) {
  const byFp = new Map();
  for (const e of Array.isArray(register) ? register : []) byFp.set(withFingerprint(e), e);

  const surfaced = [], regressions = [], needsGovernanceReview = [], alreadyOpen = [], suppressed = [];
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
          // "Fixed" was never proven (no test). It is NOT trusted — re-evaluate whether it is actually fixed.
          needsGovernanceReview.push({ ...base, disposition: "REVIEW", reviewReason: "claimed FIXED but no regression test — fix is unproven", becauseStatus: known.status });
        }
        break;
      case FINDING_STATUS.KNOWN_ACCEPTED:
        needsGovernanceReview.push({ ...base, disposition: "REVIEW", reviewReason: "accepted design tradeoff — re-verify it still holds / whether risk changed", becauseStatus: known.status });
        break;
      case FINDING_STATUS.DEFERRED:
        needsGovernanceReview.push({ ...base, disposition: "REVIEW", reviewReason: `deferred (${known.deferralRef ?? "no ref"}) — re-verify the reason is still true / whether it is time to do it now`, becauseStatus: known.status, deferralRef: known.deferralRef ?? null });
        break;
      case FINDING_STATUS.CONFIRMED_OPEN:
        alreadyOpen.push({ ...base, disposition: "ALREADY_OPEN" });
        break;
      default: // FALSE_POSITIVE (or unknown) — genuinely not a defect; drop.
        suppressed.push({ ...base, disposition: "SUPPRESSED", becauseStatus: known.status });
    }
  }

  const unverifiedFixed = (Array.isArray(register) ? register : [])
    .filter((e) => e.status === FINDING_STATUS.FIXED && !e.regressionTest)
    .map((e) => ({ fingerprint: withFingerprint(e), file: e.file, symbol: e.symbol ?? null }));

  return Object.freeze({
    surfaced: Object.freeze(surfaced),
    regressions: Object.freeze(regressions),
    needsGovernanceReview: Object.freeze(needsGovernanceReview),
    alreadyOpen: Object.freeze(alreadyOpen),
    suppressed: Object.freeze(suppressed),
    unverifiedFixed: Object.freeze(unverifiedFixed),
  });
}

/** Convenience: is a status one that suppresses re-surfacing? */
export const isResolved = (status) => RESOLVED.has(status);
