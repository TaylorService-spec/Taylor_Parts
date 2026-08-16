// E2E verification contract -- PURE CORE.
//
// WHY THIS EXISTS: the repository already contains a 7,319-line Playwright driver that
// signs in as real seeded personas and drives the real UI. And yet the Wave 7 truth
// matrix records ZERO items as E2E VERIFIED. The gap was never automation -- it was that
// nothing defined what "verified" MEANS, so no run could ever produce a durable claim.
//
// Three rules this encodes, each paid for in practice:
//
//  1. A POSITIVE PATH ALONE IS NOT VERIFICATION. "It worked when I was admin" proves the
//     happy path and nothing about the authorization boundary. Wave 7 shipped three items
//     user-visible whose capability was granted to nobody -- they LOOKED broken to a
//     tester and were actually behaving correctly. Only exercising the negative path
//     distinguishes "denies correctly" from "broken".
//
//  2. EVIDENCE IS BOUND TO AN ENVIRONMENT AND A COMMIT. On 2026-08-16 the sandbox served
//     a commit 17 behind main while reporting a fresh build time. Evidence gathered
//     against one commit says nothing about another, so it EXPIRES when the environment
//     moves rather than silently carrying forward.
//
//  3. AN UNPROVEN CHECK IS NOT A PASSING CHECK. Missing, empty, or evidence-free
//     observations yield NOT_VERIFIED -- never VERIFIED-by-omission. The audit that
//     reported COMPLETE with zero findings while holding 21 real defects is the cost of
//     the opposite default.
//
// PURE: no filesystem, network, browser, or clock. The caller supplies observations and
// the environment fact; this module only decides what they add up to.

export const CHECK = {
  POSITIVE: "POSITIVE",         // a principal WITH the capability completes the action
  NEGATIVE: "NEGATIVE",         // a principal WITHOUT it is denied
  HONEST_ERROR: "HONEST_ERROR", // a failure surfaces as a real message, not a false empty state
};

export const VERDICT = {
  VERIFIED: "VERIFIED",
  NOT_VERIFIED: "NOT_VERIFIED", // insufficient evidence -- NOT a failure claim
  FAILED: "FAILED",             // something was exercised and behaved wrongly
  STALE: "STALE",               // was verified, but against a commit the environment no longer serves
};

const REQUIRED_CHECKS = [CHECK.POSITIVE, CHECK.NEGATIVE];

/**
 * @param {object} s
 * @param {string} s.itemId      truth-matrix item this proves (e.g. "sales-order-actions")
 * @param {string} s.capability  governed capability under test (e.g. "salesOrder.transition")
 * @param {string} s.positivePersona  persona expected to SUCCEED
 * @param {string} s.negativePersona  persona expected to be DENIED
 */
export function buildScenario({ itemId, capability, positivePersona, negativePersona } = {}) {
  const errors = [];
  if (!itemId) errors.push("itemId is required");
  if (!capability) errors.push("capability is required");
  if (!positivePersona) errors.push("positivePersona is required");
  // A scenario with no negative persona can never reach VERIFIED, so refuse it at
  // construction rather than letting it look like a real scenario that keeps failing.
  if (!negativePersona) errors.push("negativePersona is required -- a positive path alone cannot verify");
  if (positivePersona && positivePersona === negativePersona) {
    errors.push("positivePersona and negativePersona must differ");
  }
  if (errors.length) throw new Error(`invalid scenario: ${errors.join("; ")}`);
  return { itemId, capability, positivePersona, negativePersona };
}

/**
 * One observed check. `evidence` must be a concrete, re-readable artifact reference --
 * a screenshot path, a captured message, a response body. A verdict with no evidence is
 * an assertion, and assertions are what this contract exists to stop counting.
 */
export function observation({ check, passed, evidence, detail = "" } = {}) {
  if (!CHECK[check]) throw new Error(`unknown check kind: ${check}`);
  if (typeof passed !== "boolean") throw new Error("observation.passed must be a boolean");
  return { check, passed, evidence: evidence ?? null, detail };
}

const hasEvidence = (o) => typeof o.evidence === "string" && o.evidence.trim().length > 0;

/**
 * Decide what a set of observations proves.
 *
 * @param {object} scenario   from buildScenario
 * @param {Array}  observations
 * @param {object} env        { environmentId, commit } -- the environment AS OBSERVED,
 *                            read from the environment itself (e.g. /version.json),
 *                            never from a deploy command exit status.
 * @param {string} [servingCommit] the commit the environment serves NOW. When supplied
 *                            and different from env.commit, prior evidence is STALE.
 */
export function evaluate(scenario, observations = [], env = {}, servingCommit = null) {
  const reasons = [];
  if (!env.environmentId) reasons.push("environmentId not recorded");
  if (!env.commit) reasons.push("observed commit not recorded");

  const byCheck = new Map();
  for (const o of observations) {
    // Last observation of a kind wins: a re-run supersedes an earlier attempt.
    byCheck.set(o.check, o);
  }

  const missing = REQUIRED_CHECKS.filter((c) => !byCheck.has(c));
  for (const m of missing) {
    reasons.push(
      m === CHECK.NEGATIVE
        ? "negative path not exercised -- denial for a principal without the capability is unproven"
        : "positive path not exercised",
    );
  }

  const unevidenced = [...byCheck.values()].filter((o) => !hasEvidence(o));
  for (const o of unevidenced) reasons.push(`${o.check} check carries no evidence`);

  const failures = [...byCheck.values()].filter((o) => !o.passed);

  // A real failure outranks incompleteness: something was exercised and misbehaved.
  if (failures.length) {
    return {
      verdict: VERDICT.FAILED,
      itemId: scenario.itemId,
      capability: scenario.capability,
      environmentId: env.environmentId ?? null,
      commit: env.commit ?? null,
      failedChecks: failures.map((f) => f.check),
      reasons: failures.map((f) => `${f.check} failed: ${f.detail || "no detail given"}`),
      checks: [...byCheck.values()],
    };
  }

  if (reasons.length) {
    return {
      verdict: VERDICT.NOT_VERIFIED,
      itemId: scenario.itemId,
      capability: scenario.capability,
      environmentId: env.environmentId ?? null,
      commit: env.commit ?? null,
      reasons,
      checks: [...byCheck.values()],
    };
  }

  // Everything required passed with evidence. Now: is that evidence still current?
  if (servingCommit && servingCommit !== env.commit) {
    return {
      verdict: VERDICT.STALE,
      itemId: scenario.itemId,
      capability: scenario.capability,
      environmentId: env.environmentId,
      commit: env.commit,
      servingCommit,
      reasons: [
        `evidence was gathered against ${env.commit} but ${env.environmentId} now serves ${servingCommit} -- re-verify`,
      ],
      checks: [...byCheck.values()],
    };
  }

  return {
    verdict: VERDICT.VERIFIED,
    itemId: scenario.itemId,
    capability: scenario.capability,
    environmentId: env.environmentId,
    commit: env.commit,
    reasons: [],
    checks: [...byCheck.values()],
  };
}

/** Only a VERIFIED result may advance a truth-matrix item to E2E VERIFIED. */
export const supportsTruthMatrixClaim = (r) => r?.verdict === VERDICT.VERIFIED;
