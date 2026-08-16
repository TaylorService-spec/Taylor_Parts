// Failure classification -- PURE CORE. Decide WHETHER to retry before deciding HOW.
//
// THE DEFECT THIS FIXES (observed 2026-08-13): `retryDecision()` in autonomyPolicy.mjs branches
// only on attempt count and network state. It has no notion of WHAT failed. So this:
//
//   ! [remote rejected] HEAD -> main (refusing to allow a GitHub App to create or update
//     workflow .github/workflows/... without `workflows` permission)
//
// was retried FIVE TIMES, identically, and hard-failed. A permission denial cannot succeed on
// attempt two. The retries wasted minutes and buried the real cause under a wall of warnings --
// which is why the root cause went undiagnosed for three days.
//
// Governance: `eos-operational-authorization.md` §6 -- "classify before retrying", and "a
// deterministic permission denial fails once."
//
// UNKNOWN DEFAULTS TO NON-RETRYABLE. This is deliberate and asymmetric:
//   - wrongly not retrying costs one surfaced blocker, which a human or a strategy change fixes
//   - wrongly retrying costs repeated capacity burn AND buries the root cause
// The second is the harm actually observed. When we cannot tell, fail once and surface it.
//
// PURE: no network, filesystem, or clock.

export const FAILURE_CLASS = {
  // Retrying can plausibly succeed with no other change.
  TRANSIENT_NETWORK: "TRANSIENT_NETWORK",
  TRANSIENT_PROVIDER: "TRANSIENT_PROVIDER",   // 429/5xx, provider hiccup
  TRANSIENT_CONTENTION: "TRANSIENT_CONTENTION", // lock/race/port in use
  TRANSIENT_INTERRUPT: "TRANSIENT_INTERRUPT",  // recoverable tool/agent interruption
  PUSH_RACE: "PUSH_RACE",                      // non-fast-forward: re-sync then retry IS the fix

  // Retrying cannot succeed until something else changes.
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PROHIBITED_WORKFLOW_WRITE: "PROHIBITED_WORKFLOW_WRITE",
  PROTECTED_BOUNDARY: "PROTECTED_BOUNDARY",
  MISSING_AUTHORITY: "MISSING_AUTHORITY",
  UNAVAILABLE_CREDENTIAL: "UNAVAILABLE_CREDENTIAL",
  INVALID_COMMAND: "INVALID_COMMAND",
  INVALID_SCHEMA: "INVALID_SCHEMA",
  DETERMINISTIC_TEST_FAILURE: "DETERMINISTIC_TEST_FAILURE",

  UNKNOWN: "UNKNOWN",
};

const RETRYABLE = new Set([
  FAILURE_CLASS.TRANSIENT_NETWORK,
  FAILURE_CLASS.TRANSIENT_PROVIDER,
  FAILURE_CLASS.TRANSIENT_CONTENTION,
  FAILURE_CLASS.TRANSIENT_INTERRUPT,
  FAILURE_CLASS.PUSH_RACE,
]);

// Ordered: the FIRST match wins, so the most specific and most consequential patterns lead.
// In particular the workflows-permission rejection must be tested before the generic push
// failure, or the exact defect this module exists for would classify as a retryable race.
const RULES = [
  // --- non-retryable, most specific first -------------------------------------------------
  {
    cls: FAILURE_CLASS.PROHIBITED_WORKFLOW_WRITE,
    re: /refusing to allow .* to (?:create or update )?workflow|without `?workflows`? permission/i,
    why: "the token cannot write .github/workflows — a permission change is required, and per §3.2 that is a governed protected path, not something a retry resolves",
  },
  {
    cls: FAILURE_CLASS.PERMISSION_DENIED,
    re: /permission denied|TOOL_PERMISSION_BLOCKED|not permitted|operation not permitted|EACCES|EPERM|\b403\b|denied by the .* classifier|refused by the harness/i,
    why: "an explicit denial is deterministic — attempt two is identical to attempt one",
  },
  {
    cls: FAILURE_CLASS.PROTECTED_BOUNDARY,
    re: /protected branch|required status checks|review required|cannot force[- ]push|protected boundary/i,
    why: "a protected-branch control is policy, not a transient condition",
  },
  {
    cls: FAILURE_CLASS.UNAVAILABLE_CREDENTIAL,
    re: /CREDENTIAL_ACCESS_FAILED|secret not set|refusing before provider invocation|no API key|credential (?:is )?(?:missing|unavailable)|could not resolve credential/i,
    why: "a missing credential is a configuration state; retrying cannot create one",
  },
  {
    cls: FAILURE_CLASS.MISSING_AUTHORITY,
    re: /MISSING_AUTHORITY|not authorized|unauthorized|requires owner authorization|OWNER_DECISION/i,
    why: "authority is granted, never retried into existence",
  },
  {
    cls: FAILURE_CLASS.INVALID_SCHEMA,
    re: /intake rejected|schema|validation failed|invalid payload|EXTRACTION_INVALID|requires a non-empty/i,
    why: "malformed input fails identically until the input changes",
  },
  {
    cls: FAILURE_CLASS.INVALID_COMMAND,
    re: /MODULE_NOT_FOUND|Cannot find module|command not found|unknown option|no such file or directory|is not a function/i,
    why: "a deterministic program error — the same call fails the same way",
  },
  {
    cls: FAILURE_CLASS.DETERMINISTIC_TEST_FAILURE,
    re: /^\s*not ok \d|# fail [1-9]|tests? failed|assertion failed|AssertionError/im,
    why: "a failing test with unchanged code fails again; the code must change first",
  },

  // --- retryable ---------------------------------------------------------------------------
  {
    cls: FAILURE_CLASS.PUSH_RACE,
    re: /non-fast-forward|fetch first|updates were rejected because the remote contains work|stale info/i,
    why: "a genuine race — re-syncing and retrying IS the remedy",
  },
  {
    cls: FAILURE_CLASS.TRANSIENT_NETWORK,
    re: /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network (?:is )?unreachable|connection reset|TLS handshake/i,
    why: "a transport failure may not recur",
  },
  {
    cls: FAILURE_CLASS.TRANSIENT_PROVIDER,
    re: /\b(?:429|500|502|503|504)\b|rate limit|too many requests|service unavailable|bad gateway|server error|temporarily unavailable/i,
    why: "provider-side and usually short-lived",
  },
  {
    cls: FAILURE_CLASS.TRANSIENT_CONTENTION,
    re: /EADDRINUSE|address already in use|resource temporarily unavailable|lock(?:ed| file)|index\.lock|database is locked|emulator .*(?:start|not ready)/i,
    why: "contention clears when the holder releases",
  },
  {
    cls: FAILURE_CLASS.TRANSIENT_INTERRUPT,
    re: /aborted|interrupted|ECONNABORTED|stream closed|premature close/i,
    why: "an interrupted call may complete on a second attempt",
  },
];

/**
 * @param {string|Error|{message?:string,code?:string,stderr?:string}} failure
 * @returns {{ failureClass, retryable, reason, matched }}
 */
export function classifyFailure(failure) {
  const text = [
    typeof failure === "string" ? failure : "",
    failure?.message ?? "",
    failure?.stderr ?? "",
    failure?.code ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!text.trim()) {
    return {
      failureClass: FAILURE_CLASS.UNKNOWN,
      retryable: false,
      reason: "no failure detail to classify — refusing to retry blind",
      matched: null,
    };
  }

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return {
        failureClass: rule.cls,
        retryable: RETRYABLE.has(rule.cls),
        reason: rule.why,
        matched: rule.cls,
      };
    }
  }

  return {
    failureClass: FAILURE_CLASS.UNKNOWN,
    retryable: false,
    reason:
      "unrecognised failure — defaulting to NON-retryable. Wrongly not retrying costs one surfaced blocker; wrongly retrying burns capacity and buries the cause, which is the harm actually observed.",
    matched: null,
  };
}

/**
 * Gate a retry on classification BEFORE attempt-count/backoff logic runs.
 * Callers should consult this first and only then call `retryDecision()`.
 */
export function shouldAttemptRetry(failure, { attempt = 0, maxAttempts = 3 } = {}) {
  const c = classifyFailure(failure);
  if (!c.retryable) {
    return { retry: false, ...c, decision: "FAIL_FAST", attempts: attempt + 1 };
  }
  if (attempt + 1 >= maxAttempts) {
    return { retry: false, ...c, decision: "GIVE_UP", reason: `${c.reason} — but ${maxAttempts} attempts exhausted`, attempts: attempt + 1 };
  }
  return { retry: true, ...c, decision: "RETRY", attempts: attempt + 1 };
}

/** Human-readable line for the operator, so a fail-fast is legible rather than mysterious. */
export function explainFailure(failure) {
  const c = classifyFailure(failure);
  const verb = c.retryable ? "retryable" : "NOT retryable without a state change";
  return `${c.failureClass} — ${verb}. ${c.reason}`;
}
