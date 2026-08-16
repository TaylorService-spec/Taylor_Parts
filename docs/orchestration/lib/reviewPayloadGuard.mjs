// Review payload guard -- PURE CORE. Protects reviewer AVAILABILITY, not just spend.
//
// WHY THIS EXISTS: the reciprocal-review path calls a metered API behind a hard provider cap.
// The first live run sent the LEGACY FULL-CONTEXT payload instead of the fact feed (fixed in
// #788). It was ~7.5k tokens that time. Nothing structurally prevented it from being 100x that
// -- and nothing does today, because "send the fact feed" is a policy, and policies do not stop
// code.
//
// THE REAL RISK IS NOT THE MONEY (Owner, 2026-08-16). The provider cap bounds the loss. What a
// runaway send actually costs is the REVIEWER ITSELF: burn the cap and there is no review path
// at all until it resets. One malformed payload takes the whole capability offline.
//
// So this is the OpenAI-side analogue of the Owner capacity reserve in
// `eos-operational-authorization.md` §4.1 -- reserve headroom so the thing stays USABLE, rather
// than spending to the last cent and discovering the loss when you need it.
//
// This is the mechanism. It runs BEFORE provider invocation and REFUSES an oversized payload.
//
// TWO DELIBERATE CHOICES:
//
//  1. REFUSE, NEVER TRUNCATE. Truncating to fit produces a review of a partial artifact that
//     looks completely valid -- a silently degraded verdict, which is worse than no verdict.
//     Every failure mode found in this project has been a thing that looked fine and was not.
//
//  2. ESTIMATE CONSERVATIVELY (round UP). A guard that under-estimates lets the expensive case
//     through, which is the only case it exists to catch. When uncertain, refuse.
//
// PURE: no network, filesystem, or clock.

/** ~4 chars/token is the usual English approximation; 3.5 deliberately over-estimates. */
const CHARS_PER_TOKEN = 3.5;

/** Fact feed runs ~7.5k. 25k leaves generous headroom while refusing a full-context send. */
export const DEFAULT_CEILING_TOKENS = 25_000;

/** A fact-feed payload has no business being large; a lower ceiling catches mode confusion. */
export const FACT_FEED_CEILING_TOKENS = 12_000;

export const PAYLOAD_MODE = {
  FACT_FEED: "FACT_FEED",       // the intended path (#788) -- compact, structured
  FULL_CONTEXT: "FULL_CONTEXT", // the legacy path -- a DEFECT on the live path, never a fallback
  UNKNOWN: "UNKNOWN",
};

export const estimateTokens = (text = "") => Math.ceil(String(text).length / CHARS_PER_TOKEN);

/**
 * @param {object} args
 * @param {string} args.payload        exact bytes that would be sent
 * @param {string} [args.mode]         PAYLOAD_MODE
 * @param {number} [args.ceilingTokens]
 * @param {boolean} [args.hasApiKey]   whether a key is present at all
 * @returns {{ allowed, reason, estimatedTokens, ceilingTokens, mode }}
 */
export function checkReviewPayload({
  payload = "",
  mode = PAYLOAD_MODE.UNKNOWN,
  ceilingTokens,
  hasApiKey = true,
} = {}) {
  const estimatedTokens = estimateTokens(payload);
  const ceiling =
    Number.isFinite(ceilingTokens) && ceilingTokens > 0
      ? ceilingTokens
      : mode === PAYLOAD_MODE.FACT_FEED
        ? FACT_FEED_CEILING_TOKENS
        : DEFAULT_CEILING_TOKENS;

  const deny = (reason) => ({ allowed: false, reason, estimatedTokens, ceilingTokens: ceiling, mode });

  // Refuse before invocation when unconfigured. A misconfiguration must never become a paid call.
  if (!hasApiKey) return deny("no API key present — refusing before provider invocation");

  if (!payload || !String(payload).trim()) return deny("empty payload — nothing to review");

  // FULL_CONTEXT on the live path is the defect #788 fixed. It is not a degraded mode to fall
  // back to; reaching here at all means the caller selected the wrong path.
  if (mode === PAYLOAD_MODE.FULL_CONTEXT) {
    return deny("FULL_CONTEXT payload on a metered path — this is the #788 defect, not a fallback; send the fact feed");
  }

  if (estimatedTokens > ceiling) {
    return deny(
      `payload ~${estimatedTokens.toLocaleString()} tokens exceeds the ${ceiling.toLocaleString()} ceiling — refusing rather than truncating (a truncated review looks valid and is not)`,
    );
  }

  return { allowed: true, reason: "within ceiling", estimatedTokens, ceilingTokens: ceiling, mode };
}

/** Keep this fraction of the provider cap unspent so the reviewer stays available. */
export const PROVIDER_RESERVE_FRACTION = 0.25;

/**
 * Provider capacity check -- the availability half of this guard.
 *
 * A cap is not a budget to spend to the last cent; it is the point at which the CAPABILITY
 * DISAPPEARS. Reserving headroom means an unplanned-but-important review can still run.
 * Mirrors the Owner capacity reserve (`eos-operational-authorization.md` §4.1).
 *
 * Fails toward preserving availability: unknown spend is treated as fully spent, because
 * guessing low is exactly the error that takes the reviewer offline.
 *
 * @param {object} args
 * @param {number} args.capUsd            provider hard cap
 * @param {number} args.spentUsd          spend so far in the cap window
 * @param {number} [args.estimatedCostUsd] cost of the pending call
 * @param {number} [args.reserveFraction]
 */
export function checkProviderCapacity({
  capUsd,
  spentUsd,
  estimatedCostUsd = 0,
  reserveFraction = PROVIDER_RESERVE_FRACTION,
} = {}) {
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    return { allowed: false, reason: "provider cap unknown — refusing rather than risking the reviewer", remainingUsd: 0 };
  }
  // Unknown spend is treated as fully consumed. Fail toward availability.
  const spent = Number.isFinite(spentUsd) ? spentUsd : capUsd;
  const reserveUsd = capUsd * reserveFraction;
  const spendableUsd = capUsd - reserveUsd;
  const remainingUsd = Math.max(0, spendableUsd - spent);

  if (spent >= spendableUsd) {
    return {
      allowed: false,
      reason: `reserve floor reached — $${spent.toFixed(2)} of $${spendableUsd.toFixed(2)} spendable used; holding $${reserveUsd.toFixed(2)} so the reviewer stays available`,
      remainingUsd: 0,
    };
  }
  if (estimatedCostUsd > remainingUsd) {
    return {
      allowed: false,
      reason: `this call (~$${estimatedCostUsd.toFixed(2)}) would breach the reserve; $${remainingUsd.toFixed(2)} remains spendable`,
      remainingUsd,
    };
  }
  return { allowed: true, reason: "within spendable capacity", remainingUsd };
}

/** Throwing wrapper for call sites that should hard-stop. */
export function assertReviewPayload(args) {
  const r = checkReviewPayload(args);
  if (!r.allowed) throw new Error(`REVIEW_PAYLOAD_REFUSED: ${r.reason}`);
  return r;
}

/**
 * Per-firing cost record. An unmeasured cost cannot be tuned, so every invocation -- including
 * a refusal, which costs nothing and is worth knowing about -- produces one of these.
 */
export function payloadCostRecord({ headSha, mode, estimatedTokens, allowed, reason, model = null }) {
  return {
    schema: "eos.review.cost/1",
    headSha: headSha ?? null,
    mode,
    estimatedTokens,
    invoked: allowed === true,
    outcome: allowed ? "SENT" : "REFUSED",
    reason,
    model,
  };
}

/**
 * One review per head SHA. A re-push that changes nothing material must not re-review --
 * over-routing is what produced 463 relayed review verdicts in 32 days.
 *
 * @param {string} headSha
 * @param {Array<{headSha:string, material?:boolean}>} priorReviews
 */
export function shouldReview(headSha, priorReviews = []) {
  if (!headSha) return { review: false, reason: "no head SHA — cannot dedupe, refusing" };
  const already = priorReviews.some((p) => p?.headSha === headSha);
  if (already) return { review: false, reason: `already reviewed at ${headSha} — dedupe` };
  return { review: true, reason: "new head SHA" };
}
