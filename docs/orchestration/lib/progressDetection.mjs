// No-progress / stagnation detection -- PURE CORE. EOS operational authorization §5.1–§5.2.
//
// WHY: `hardStopReason()` already enforces the OUTER bounds -- 90-minute window, 20 dispatches,
// failure containment. Those catch a run that has gone too long or failed too often. **Nothing
// catches a run that is busy and getting nowhere.** An agent can search, re-read the same files,
// retry, poll logs and restate the same conclusion indefinitely, consuming capacity the whole
// time, and every existing ceiling reads it as healthy.
//
// The Owner's framing: **use capacity while progress is being made; stop spending it when
// progress has ceased.** That requires knowing what progress IS, which is what this encodes.
//
// This is the PRIMARY control. The hard ceilings sit underneath it as a fail-safe for when this
// module itself is wrong -- see §5.3.
//
// PURE: no clock, filesystem, or network. The caller supplies observations and `now`.

/** Real movement. Any of these resets the stagnation clock. */
export const PROGRESS = new Set([
  "VERIFIED_FINDING",        // a new finding, verified
  "DISPOSITION_CHANGED",     // a finding changed state
  "TEST_STATE_CHANGED",      // pass->fail or fail->pass
  "CODE_CHANGED",            // meaningful source change
  "COMMIT_CREATED",
  "PR_CREATED",
  "PR_UPDATED",
  "BLOCKER_IDENTIFIED",      // with NEW evidence -- see isProgress()
  "CHILD_COMPLETED",
  "ARTIFACT_PRODUCED",
  "VERIFICATION_ADVANCED",   // a previously failing verification moved forward
  "DEPENDENCY_RESOLVED",
]);

/** Activity that feels like work and is not. Explicitly does NOT reset the clock. */
export const NON_PROGRESS = new Set([
  "SEARCH",
  "TOOL_CALL",
  "RETRY",
  "LOG_POLL",
  "FILE_REREAD",
  "CONCLUSION_RESTATED",
]);

export const DEFAULT_STAGNATION_POLICY = Object.freeze({
  // No progress signal for this long => stagnant, regardless of how busy it looks.
  minutesWithoutProgress: 20,
  // The same action fingerprint this many times => going in circles.
  maxRepeatedAction: 4,
  // The same failure this many times => the strategy cannot work, whatever the retry policy says.
  maxRepeatedFailure: 3,
  // Below this many observations we do not judge -- too little evidence to call it.
  minObservations: 5,
});

/**
 * A BLOCKER_IDENTIFIED only counts as progress when it carries NEW evidence. Re-announcing a
 * known blocker is `CONCLUSION_RESTATED` wearing a better hat, and it is exactly how a stuck
 * agent looks productive.
 */
export function isProgress(event = {}) {
  if (!PROGRESS.has(event.kind)) return false;
  if (event.kind === "BLOCKER_IDENTIFIED") return Boolean(event.newEvidence);
  return true;
}

const minutesBetween = (a, b) => Math.max(0, (b - a) / 60000);

/**
 * @param {object}   args
 * @param {Array}    args.events   [{ kind, at (ms), fingerprint?, newEvidence? }] for this segment
 * @param {number}   args.now      ms
 * @param {string}  [args.repoStateHash]         current working-tree/commit fingerprint
 * @param {string}  [args.lastRepoStateHash]     the same at the previous assessment
 * @param {string}  [args.verificationStateHash] current verification fingerprint
 * @param {string}  [args.lastVerificationStateHash]
 * @param {object}  [policy]
 */
export function assessStagnation(
  { events = [], now = 0, repoStateHash, lastRepoStateHash, verificationStateHash, lastVerificationStateHash } = {},
  policy = DEFAULT_STAGNATION_POLICY,
) {
  const sorted = [...events].filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
  const progressEvents = sorted.filter(isProgress);
  const lastProgressAt = progressEvents.length ? progressEvents[progressEvents.length - 1].at : null;
  const startedAt = sorted.length ? sorted[0].at : now;
  const minutesSinceProgress = minutesBetween(lastProgressAt ?? startedAt, now);

  // Repeated equivalent actions: same fingerprint, non-progress.
  const actionCounts = new Map();
  for (const e of sorted) {
    if (isProgress(e) || !e.fingerprint) continue;
    actionCounts.set(e.fingerprint, (actionCounts.get(e.fingerprint) || 0) + 1);
  }
  const repeatedAction = [...actionCounts.entries()].find(([, n]) => n >= policy.maxRepeatedAction) || null;

  // Repeated identical failures.
  const failureCounts = new Map();
  for (const e of sorted) {
    if (e.kind !== "FAILURE" || !e.fingerprint) continue;
    failureCounts.set(e.fingerprint, (failureCounts.get(e.fingerprint) || 0) + 1);
  }
  const repeatedFailure = [...failureCounts.entries()].find(([, n]) => n >= policy.maxRepeatedFailure) || null;

  const repoUnchanged = Boolean(repoStateHash && lastRepoStateHash && repoStateHash === lastRepoStateHash);
  const verificationUnchanged = Boolean(
    verificationStateHash && lastVerificationStateHash && verificationStateHash === lastVerificationStateHash,
  );

  const reasons = [];
  if (minutesSinceProgress >= policy.minutesWithoutProgress) {
    reasons.push(`no progress signal for ${Math.round(minutesSinceProgress)}m (threshold ${policy.minutesWithoutProgress}m)`);
  }
  if (repeatedAction) reasons.push(`same action repeated ${repeatedAction[1]}x: ${repeatedAction[0]}`);
  if (repeatedFailure) reasons.push(`identical failure ${repeatedFailure[1]}x: ${repeatedFailure[0]}`);
  if (repoUnchanged) reasons.push("repository state unchanged since last assessment");
  if (verificationUnchanged) reasons.push("verification state unchanged since last assessment");

  // Too little evidence to judge. Do NOT call a short quiet stretch stagnation -- a long single
  // operation (a test run, a large read) legitimately produces few events.
  if (sorted.length < policy.minObservations) {
    return { stagnant: false, reasons: [], detail: "insufficient observations to judge", minutesSinceProgress, signals: 0 };
  }

  // §5.2 requires a COMBINATION, not one simplistic timer. A single weak signal is not enough --
  // except a repeated identical failure, which is conclusive on its own: the same thing failing
  // the same way cannot become progress by being tried again.
  const conclusive = Boolean(repeatedFailure);
  const stagnant = conclusive || reasons.length >= 2;

  return {
    stagnant,
    reasons,
    signals: reasons.length,
    minutesSinceProgress,
    detail: stagnant
      ? "stagnation threshold reached — checkpoint, classify, and only resume with a materially different strategy"
      : "progressing, or too few signals to call it",
    classification: stagnant ? classifyStagnation({ repeatedFailure, repeatedAction, repoUnchanged, minutesSinceProgress, policy }) : null,
  };
}

/**
 * WHY progress stopped, which decides whether resuming is worth capacity. §5.2 step 3–5.
 * `canRetryWithDifferentStrategy` is deliberately conservative: only where a different approach
 * plausibly changes the outcome. Retrying the same strategy is what this module exists to stop.
 */
export function classifyStagnation({ repeatedFailure, repeatedAction, repoUnchanged, minutesSinceProgress, policy = DEFAULT_STAGNATION_POLICY }) {
  if (repeatedFailure) {
    return {
      cause: "REPEATED_IDENTICAL_FAILURE",
      canRetryWithDifferentStrategy: true,
      guidance: "the same failure recurred — the approach cannot work; change strategy or surface the blocker, do not retry",
    };
  }
  if (repeatedAction) {
    return {
      cause: "LOOPING",
      canRetryWithDifferentStrategy: true,
      guidance: "the same action repeated without effect — the agent is circling; a different approach may proceed",
    };
  }
  if (repoUnchanged && minutesSinceProgress >= policy.minutesWithoutProgress) {
    return {
      cause: "BUSY_BUT_INERT",
      canRetryWithDifferentStrategy: false,
      guidance: "activity without any state change — treat as blocked and return the real blocker rather than resuming",
    };
  }
  return {
    cause: "NO_PROGRESS",
    canRetryWithDifferentStrategy: false,
    guidance: "no progress signal in the window — checkpoint and surface what is actually blocking",
  };
}

/**
 * The §5.2 action sequence, as data. A ceiling stops a SEGMENT, never the mission (§5.3) --
 * so this always checkpoints first and only then decides whether another segment is justified.
 */
export function stagnationAction(assessment) {
  if (!assessment?.stagnant) return { action: "CONTINUE" };
  const c = assessment.classification;
  return {
    action: "STOP_SEGMENT",
    steps: ["STOP_AGENT", "CHECKPOINT", "CLASSIFY", "DECIDE_STRATEGY"],
    resume: c?.canRetryWithDifferentStrategy ? "ONLY_IF_STRATEGY_CHANGES" : "RETURN_BLOCKER",
    cause: c?.cause ?? "NO_PROGRESS",
    guidance: c?.guidance,
    reasons: assessment.reasons,
  };
}
