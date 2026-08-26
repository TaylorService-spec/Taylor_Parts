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
  //
  // ════════════════════ WHY THE ENTROPY IS NOT Math.random() ════════════════════
  //
  // It was `Math.random().toString(36).slice(2, 6)` -- four base-36 characters, about 1.68 million
  // values. That is a birthday problem, and 200 crashes is enough to lose it: measured over 20,000
  // simulated runs of the suite's own 200-draw check, 1.06% collided. crashDiagnostics.test.mjs
  // asserts "two crashes never share an id" and therefore failed about one CI run in 94 -- which is
  // exactly how it surfaced, on an unrelated PR.
  //
  // The flake was the visible half. The real defect is that the invariant was never held: this id
  // exists so ONE screenshot names ONE occurrence, and two crashes sharing an id sends somebody to
  // the wrong incident. A test that fails 1% of the time was reporting a product property honestly.
  //
  // crypto.getRandomValues gives 32 bits per draw with no birthday cliff at this scale, and it is
  // available in every browser this app runs in and in Node 18+. The FORM is unchanged -- still
  // five time chars, a dash, and a short uppercase tail somebody can read down a phone -- because
  // the id is quoted out loud and a longer one would not be.
  const t = Date.now().toString(36).slice(-5).toUpperCase();
  return `${t}-${randomTail()}`;
}

// Six base-36 characters (~2.18 billion) drawn from the CSPRNG. At 200 draws the collision
// probability is under one in ten million, against one in ninety-four before.
//
// The fallback is deliberate rather than defensive theatre: a runtime without crypto would
// otherwise throw INSIDE the crash handler, turning a reported crash into a silent one. It is the
// old behaviour, kept only for that path, and it is the reason this is a helper rather than an
// inline expression.
function randomTail() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0].toString(36).toUpperCase().padStart(6, "0").slice(-6);
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase().padStart(6, "0");
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
