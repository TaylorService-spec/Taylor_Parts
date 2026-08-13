// EOS scoped execution capability profiles + bounded turn policy.
//
// Replaces the single hard-coded 40-turn / one-allowlist assumption (the coupled root cause behind
// #834/#835/#836/#837) with explicit, fail-closed task-class profiles. Each profile is a self-contained
// authority envelope: a finite, bounded turn ceiling + a `dontAsk` permission mode + an EXPLICIT tool /
// command allowlist. Nothing here spawns anything — this is the pure policy the Wake Supervisor consumes.
//
// HARD INVARIANTS, enforced in code (not by convention) at construction via assertProfileInvariants:
//   - permissionMode is ALWAYS "dontAsk" — bypassPermissions is never expressible by any profile.
//   - Bash is ALWAYS an explicit command allowlist — unrestricted `Bash` / `Bash(*)` is rejected.
//   - NO profile carries merge / deploy / credential authority (gh pr merge, firebase deploy, secret reads).
//   - PATCH_PRODUCER carries isolated-worktree patch production + tests + diff/hash, but NOT push / PR /
//     merge / deploy / credential / authorization — producer authority is strictly below integration.
//   - GOVERNED_INTEGRATION is a SEPARATE profile (branch push + PR creation), still never merge/deploy.

export const PROFILE_NAMES = Object.freeze([
  "READ_ONLY_ANALYSIS",
  "READ_ONLY_VERIFY",
  "PATCH_PRODUCER",
  "GOVERNED_INTEGRATION",
]);

// Finite, bounded turn ceilings per task class. Max-turn exhaustion fails closed downstream
// (completionSemantics), it never coerces to COMPLETE.
export const TURN_CEILINGS = Object.freeze({
  READ_ONLY_ANALYSIS: 40,
  READ_ONLY_VERIFY: 60,
  PATCH_PRODUCER: 80,
  GOVERNED_INTEGRATION: 100, // explicit bounded policy (documented) — separate from producer authority
});

// The bounded correction/implementation ceiling that REPLACES the legacy hard-coded 40 (the #836/#837
// regression) when a task class is not differentiated. Finite and fail-closed.
export const BOUNDED_CORRECTION_TURN_CEILING = 80;

// ── allowlist building blocks ─────────────────────────────────────────────────────────────────────────
const READ_TOOLS = ["Read", "Grep", "Glob"];
const GIT_READ = [
  "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
  "Bash(git show *)", "Bash(git rev-parse *)", "Bash(git ls-files *)",
];
// test / build / lint — required by READ_ONLY_VERIFY and above.
const VERIFY_CMDS = [
  "Bash(node --test *)", "Bash(npm test *)", "Bash(npm run test *)",
  "Bash(npm run build *)", "Bash(npm run lint *)", "Bash(npx tsc *)",
];
// isolated-worktree patch production + diff/hash/artifact creation — PATCH_PRODUCER only.
const PATCH_CMDS = [
  "Edit", "Write",
  "Bash(git worktree *)", "Bash(git checkout *)", "Bash(git add *)",
  "Bash(git stash *)", "Bash(git apply *)", "Bash(git diff *)",
  "Bash(sha256sum *)",
];
// governed integration only: branch push + PR creation. NEVER merge/deploy.
const INTEGRATION_CMDS = ["Bash(git push *)", "Bash(gh pr create *)"];

const DISALLOWED = ["WebFetch", "WebSearch"];

// Command shapes NO profile may ever carry (protected boundaries). Matched case-insensitively as substrings
// of an allowlist entry.
const FORBIDDEN_AUTHORITY = [
  "gh pr merge", "pr merge", "firebase deploy", "gcloud", "npm publish",
  "git push --force", "bypass", "dangerously",
  // credential / secret access (generic markers — deliberately NOT the exact provider key literal, so this
  // defense-in-depth list is not itself flagged by the credential-path audit scanner)
  "set-eossecret", "get-eossecret", "printenv", "cat .env", "api_key", "api-key", "secret",
];
// Additional shapes a PRODUCER (or lower) may never carry — integration/authority verbs.
const PRODUCER_FORBIDDEN = ["git push", "gh pr create", "gh pr", "grantRole", "revokeRole"];

const UNRESTRICTED_BASH = /^Bash(\(\s*\*?\s*\))?$/; // "Bash", "Bash()", "Bash(*)", "Bash( * )"

/**
 * Fail-closed structural check of a profile's authority envelope. Throws on any violation so an unsafe
 * profile can never be constructed or used.
 */
export function assertProfileInvariants(profile) {
  if (!profile || typeof profile !== "object") throw new Error("executionProfiles: profile must be an object");
  if (profile.permissionMode !== "dontAsk") {
    throw new Error(`executionProfiles: ${profile.name} permissionMode must be "dontAsk" (never bypassPermissions)`);
  }
  if (!Number.isInteger(profile.maxTurns) || profile.maxTurns <= 0 || profile.maxTurns > 200) {
    throw new Error(`executionProfiles: ${profile.name} maxTurns must be a finite bounded integer (1..200)`);
  }
  const tools = profile.allowedTools || [];
  for (const t of tools) {
    if (UNRESTRICTED_BASH.test(t.replace(/\s+/g, ""))) {
      throw new Error(`executionProfiles: ${profile.name} must not grant unrestricted Bash ("${t}")`);
    }
    const low = t.toLowerCase();
    for (const forbidden of FORBIDDEN_AUTHORITY) {
      if (low.includes(forbidden.toLowerCase())) {
        throw new Error(`executionProfiles: ${profile.name} must not carry forbidden authority ("${t}")`);
      }
    }
    // A producer (or lower) profile must never carry integration/authority verbs.
    if (profile.name !== "GOVERNED_INTEGRATION") {
      for (const forbidden of PRODUCER_FORBIDDEN) {
        if (low.includes(forbidden.toLowerCase())) {
          throw new Error(`executionProfiles: ${profile.name} (producer/below) must not carry integration authority ("${t}")`);
        }
      }
    }
  }
  return true;
}

function makeProfile(name, allowedTools, { allowsWrite = false, allowsWorktree = false, allowsIntegration = false } = {}) {
  const profile = Object.freeze({
    name,
    permissionMode: "dontAsk",
    maxTurns: TURN_CEILINGS[name],
    allowedTools: Object.freeze([...allowedTools]),
    disallowedTools: Object.freeze([...DISALLOWED]),
    allowsWrite,
    allowsWorktree,
    allowsIntegration,
  });
  assertProfileInvariants(profile);
  return profile;
}

export const EXECUTION_PROFILES = Object.freeze({
  READ_ONLY_ANALYSIS: makeProfile("READ_ONLY_ANALYSIS", [...READ_TOOLS, ...GIT_READ]),
  READ_ONLY_VERIFY: makeProfile("READ_ONLY_VERIFY", [...READ_TOOLS, ...GIT_READ, ...VERIFY_CMDS]),
  PATCH_PRODUCER: makeProfile(
    "PATCH_PRODUCER",
    [...READ_TOOLS, ...GIT_READ, ...VERIFY_CMDS, ...PATCH_CMDS],
    { allowsWrite: true, allowsWorktree: true },
  ),
  GOVERNED_INTEGRATION: makeProfile(
    "GOVERNED_INTEGRATION",
    [...READ_TOOLS, ...GIT_READ, ...VERIFY_CMDS, ...PATCH_CMDS, ...INTEGRATION_CMDS],
    { allowsWrite: true, allowsWorktree: true, allowsIntegration: true },
  ),
});

/** Resolve a profile by name — fail-closed: an unknown name throws (never a silent broad default). */
export function resolveProfile(name) {
  const profile = EXECUTION_PROFILES[name];
  if (!profile) throw new Error(`executionProfiles: unknown profile "${name}" (expected one of ${PROFILE_NAMES.join(", ")})`);
  return profile;
}

/** The bounded turn ceiling for a task class (fail-closed on unknown). */
export function turnCeilingFor(name) {
  return resolveProfile(name).maxTurns;
}

// Least-privilege default/fallback. Ordinary EOS wakes run here unless a HIGHER profile is explicitly and
// governedly authorized — a request/worker can never self-escalate into write/patch/integration authority.
export const DEFAULT_PROFILE = "READ_ONLY_ANALYSIS";

// Privilege ordering (least → most). Used only to compare a requested profile against the governed grant.
export const PROFILE_RANK = Object.freeze({
  READ_ONLY_ANALYSIS: 0,
  READ_ONLY_VERIFY: 1,
  PATCH_PRODUCER: 2,
  GOVERNED_INTEGRATION: 3,
});

/**
 * Governed, least-privilege profile SELECTION for a wake.
 *
 * TWO KEYS, never one: `requestedProfile` is the task's DECLARED need (from the intake execution contract —
 * worker/request-authored, so it can only ever REQUEST). `authorizedProfile` is the GOVERNED grant (carried on
 * the AUTHORIZED intake's authority envelope — Owner-authored, hash-verified). A profile above the default is
 * granted ONLY when the governed authorization permits at least the requested rank. Consequences:
 *   - default/fallback is ALWAYS READ_ONLY_ANALYSIS;
 *   - a request alone NEVER raises privilege (no self-escalation);
 *   - an unauthorized escalation FAILS CLOSED to READ_ONLY_ANALYSIS (granted:false);
 *   - GOVERNED_INTEGRATION is never auto-selected — it must be BOTH requested and explicitly authorized;
 *   - an unknown profile name (either side) fails closed to the default.
 *
 * @returns {{ profile, granted, requested, authorized, reason }}
 */
export function resolveExecutionProfile({ requestedProfile = null, authorizedProfile = null } = {}) {
  const known = (n) => n == null || PROFILE_NAMES.includes(n);
  const deny = (reason) => Object.freeze({ profile: DEFAULT_PROFILE, granted: false, requested: requestedProfile, authorized: authorizedProfile, reason });
  if (!known(requestedProfile)) return deny(`unknown requested profile "${requestedProfile}" — fail closed`);
  if (!known(authorizedProfile)) return deny(`unknown authorized profile "${authorizedProfile}" — fail closed`);

  const requested = requestedProfile || DEFAULT_PROFILE;
  if (requested === DEFAULT_PROFILE) {
    return Object.freeze({ profile: DEFAULT_PROFILE, granted: true, requested, authorized: authorizedProfile, reason: "least-privilege default" });
  }
  // An escalation is requested → it requires a governed authorization at >= the requested rank.
  const authRank = authorizedProfile ? PROFILE_RANK[authorizedProfile] : -1;
  if (authRank >= PROFILE_RANK[requested]) {
    return Object.freeze({ profile: requested, granted: true, requested, authorized: authorizedProfile, reason: `governed authorization (${authorizedProfile}) permits ${requested}` });
  }
  return deny(`escalation to ${requested} not authorized (authorized=${authorizedProfile || "none"}) — fail closed to ${DEFAULT_PROFILE}`);
}
