// THE VERIFIER-PATH METRIC (Firebase exit B2). Which verifier admitted each bearer, counted by TYPE and nothing else.
//
// The operator's evidence that a cutover worked is a number: after the Firebase fallback is switched off, `firebase`
// stops rising and every request is `eos_human` or `eos_persona`; with it on, the same counter shows who still arrives
// through Firebase. It is read from /health (served without authentication, like the rest of that probe) so no
// credential is needed to take the measurement.
//
// WHAT IT NEVER HOLDS: a subject, a principal, a tenant, a token, a client address or a time per request. Seven integers
// and one start time. Process-local by design (a Render restart resets it; `since` says when) -- an operator comparing
// two readings diffs them, they do not need persistence for that.
//
//   verified.eos_human     an EOS login-session token (human `user.<hex>` subject, or an enrolled persona's password session)
//   verified.eos_persona   a persona-issuer token (no `sid`: the machine path for the 16 synthetic personas)
//   verified.firebase      a Firebase ID token verified by the Firebase fallback
//   refused.eos_invalid    an EOS-shaped bearer that failed EOS verification or its session gate
//   refused.firebase_invalid    a non-EOS bearer the Firebase verifier rejected
//   refused.firebase_disabled   a non-EOS bearer refused because the Firebase fallback is switched off
export const VERIFIED_PATHS = Object.freeze(["eos_human", "eos_persona", "firebase"] as const);
export const REFUSED_PATHS = Object.freeze(["eos_invalid", "firebase_invalid", "firebase_disabled"] as const);
export type VerifiedPath = (typeof VERIFIED_PATHS)[number];
export type RefusedPath = (typeof REFUSED_PATHS)[number];

export interface VerifierMetricsSnapshot {
  readonly since: string;
  readonly verified: Readonly<Record<VerifiedPath, number>>;
  readonly refused: Readonly<Record<RefusedPath, number>>;
}

export interface VerifierMetrics {
  verified(path: VerifiedPath): void;
  refused(path: RefusedPath): void;
  snapshot(): VerifierMetricsSnapshot;
}

export function createVerifierMetrics(now: () => Date = () => new Date()): VerifierMetrics {
  const since = now().toISOString();
  const verified: Record<VerifiedPath, number> = { eos_human: 0, eos_persona: 0, firebase: 0 };
  const refused: Record<RefusedPath, number> = { eos_invalid: 0, firebase_invalid: 0, firebase_disabled: 0 };
  return {
    verified: (path) => { verified[path] += 1; },
    refused: (path) => { refused[path] += 1; },
    snapshot: () => Object.freeze({ since, verified: Object.freeze({ ...verified }), refused: Object.freeze({ ...refused }) }),
  };
}
