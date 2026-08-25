// WHAT THE NEXT CRASH WILL BE ABLE TO TELL US.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// A user reproduced the root error boundary in sandbox, twice, and the automated harness could not:
// 63 routes, 15 driver accounts, 12 real sandbox personas, an interaction suite, and a throttled
// race suite all came back clean. The boundary itself said only "Something went wrong", so the one
// occurrence that DID happen carried no route, no persona, no stack — nothing to act on.
//
// That is the actual problem to solve first. A crash nobody can reproduce and nobody can describe is
// not a bug report; it is a rumour. This turns the next occurrence into evidence.
//
// ════════════════════ WHAT IS AND IS NOT CAPTURED ════════════════════
//
// CAPTURED: where the user was, where they came from, which build, what threw, and the React
// component stack — the six things needed to reproduce.
//
// DELIBERATELY NOT CAPTURED: credentials, auth tokens, request or response bodies, form contents, or
// any customer free text. Not "filtered out" — never collected. A diagnostic that scrapes the page
// would leak exactly the commercial data the governed read boundaries exist to protect, and it would
// do it into a clipboard and a console.
//
// IDENTITY IS THE ROLE, NOT THE PERSON. A role reproduces a crash; a uid identifies a human and
// reproduces nothing extra.

/** A short, human-quotable id so one screenshot can be matched to one occurrence. */
function makeCrashId() {
  // Time-ordered prefix + entropy: sortable when several arrive, unique enough to name out loud.
  const t = Date.now().toString(36).slice(-5).toUpperCase();
  const r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${t}-${r}`;
}

/** The last few routes, newest last. Bounded so this can never grow into a session recorder. */
const MAX_TRAIL = 5;
const trail = [];

/** Non-sensitive identity, set by the app once auth resolves. Role only — never a uid or a token. */
let identity = { signedIn: false, role: null };

/**
 * Record a navigation. Called from inside the Router, which is the only place that knows.
 * Consecutive duplicates are collapsed so a re-render cannot flood the trail.
 */
export function recordNavigation(pathWithQuery) {
  if (typeof pathWithQuery !== "string" || !pathWithQuery) return;
  if (trail[trail.length - 1] === pathWithQuery) return;
  trail.push(pathWithQuery);
  while (trail.length > MAX_TRAIL) trail.shift();
}

export function recordIdentity({ signedIn = false, role = null } = {}) {
  identity = { signedIn: signedIn === true, role: typeof role === "string" ? role : null };
}

/** Test seam: the trail and identity are module state, so a suite must be able to start clean. */
export function resetCrashDiagnostics() {
  trail.length = 0;
  identity = { signedIn: false, role: null };
}

/**
 * The bounded payload for one crash.
 *
 * `phase` is what the boundary can honestly claim. React only routes RENDER-phase and lifecycle
 * errors here, so an async callback that throws never reaches this boundary at all — saying
 * "render" when we mean "we do not know" would send somebody looking in the wrong place.
 */
export function buildCrashDiagnostic(error, componentStack, { now = Date.now(), location = globalThis.location } = {}) {
  const previous = trail.length > 1 ? trail[trail.length - 2] : null;
  return {
    crashId: makeCrashId(),
    at: new Date(now).toISOString(),
    commit: typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown",
    environment: typeof __APP_ENVIRONMENT__ === "object" && __APP_ENVIRONMENT__
      ? { id: __APP_ENVIRONMENT__.id ?? null, role: __APP_ENVIRONMENT__.role ?? null }
      : { id: null, role: null },
    route: {
      // Read from the URL rather than the router, so this still works when the crash IS the router.
      pathname: location?.pathname ?? null,
      search: location?.search ?? null,
      hash: location?.hash ?? null,
      previous,
      trail: [...trail],
    },
    identity: { ...identity },
    error: {
      name: error?.name ?? "Error",
      message: String(error?.message ?? error ?? "").slice(0, 500),
      // Bounded: enough frames to locate the throw, not the whole bundle.
      stack: String(error?.stack ?? "").split("\n").slice(0, 20).join("\n"),
    },
    componentStack: String(componentStack ?? "").split("\n").slice(0, 20).join("\n").trim() || null,
    // React routes render and lifecycle errors here; anything else never arrives.
    phase: "render-or-lifecycle",
    viewport: typeof globalThis.innerWidth === "number"
      ? { width: globalThis.innerWidth, height: globalThis.innerHeight }
      : null,
  };
}

/**
 * Whether the crash screen may show internals.
 *
 * PRODUCTION SHOWS NOTHING EXTRA. A stack on a production screen is an invitation to paste
 * internals into a support channel, and this repository has no decision permitting that. The
 * diagnostic is still built and logged to the console either way — the console is already where
 * this boundary has always written, and console output is not a new disclosure surface.
 */
export function diagnosticsVisible(environment = typeof __APP_ENVIRONMENT__ === "object" ? __APP_ENVIRONMENT__ : null) {
  return environment?.role != null && environment.role !== "production";
}

/** One-line summary for the console, so a screenshot of the log is already useful. */
export function formatCrashSummary(d) {
  return `UI Crash ${d.crashId} · ${d.error.name}: ${d.error.message} · ${d.route.pathname}${d.route.search || ""} · ${d.commit} · role=${d.identity.role ?? "none"}`;
}
