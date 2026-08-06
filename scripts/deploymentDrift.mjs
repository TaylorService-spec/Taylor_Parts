// C3/D2 — expected-vs-deployed comparison, PURE CORE.
//
// D1 answers: "what SHA does this deployed frontend identify itself as?"
// D2 answers: "what SHA SHOULD this environment be running, and does deployed
//              == expected?"
//
// Those are deliberately distinct. D1 is a build-time self-description; D2 is a
// judgement against an expectation held elsewhere. This module owns only the
// judgement — it performs NO network, filesystem, or process access, so it is
// hermetically testable and safe to run anywhere.
//
// Nothing here deploys, promotes, renames, or mutates anything. It reports.

/** How a fetched manifest body was classified. */
export const ManifestState = Object.freeze({
  VALID: 'VALID',
  ABSENT_NOT_FOUND: 'ABSENT_NOT_FOUND',
  ABSENT_SPA_FALLBACK: 'ABSENT_SPA_FALLBACK',
  MALFORMED: 'MALFORMED',
  UNREACHABLE: 'UNREACHABLE',
});

/** The drift verdict for one surface. */
export const DriftVerdict = Object.freeze({
  MATCH: 'MATCH',
  DRIFT: 'DRIFT',
  UNKNOWN_NO_MANIFEST: 'UNKNOWN_NO_MANIFEST',
  UNKNOWN_UNREACHABLE: 'UNKNOWN_UNREACHABLE',
});

const REQUIRED_KEYS = ['commit', 'base', 'buildTime', 'schema'];

/**
 * Classify a fetched body as a version manifest or as a specific kind of absence.
 *
 * WHY CONTENT, NEVER STATUS: the Firebase Hosting config rewrites `**` to
 * `/index.html`, so a missing `/version.json` returns **HTTP 200 with
 * text/html** — indistinguishable from success by status code. Verified live
 * against the real deployment. A status-only check would report a surface that
 * predates D1 as "has a manifest", which is precisely the false confidence D2
 * exists to remove. The SPA fallback is therefore its own state, not an error:
 * it means "this surface is serving a build older than D1", which is a real and
 * expected answer, not a failure.
 */
export function classifyManifest({ status, body, contentType }) {
  if (status === 0 || status === null || status === undefined) {
    return { state: ManifestState.UNREACHABLE, manifest: null };
  }
  if (status === 404) return { state: ManifestState.ABSENT_NOT_FOUND, manifest: null };

  const looksHtml =
    (typeof contentType === 'string' && contentType.toLowerCase().includes('text/html')) ||
    (typeof body === 'string' && /^\s*<!doctype html|^\s*<html/i.test(body));
  if (looksHtml) return { state: ManifestState.ABSENT_SPA_FALLBACK, manifest: null };

  if (status < 200 || status >= 300) {
    return { state: ManifestState.UNREACHABLE, manifest: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { state: ManifestState.MALFORMED, manifest: null };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: ManifestState.MALFORMED, manifest: null };
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in parsed)) return { state: ManifestState.MALFORMED, manifest: null };
  }
  if (typeof parsed.commit !== 'string' || parsed.commit.length === 0) {
    return { state: ManifestState.MALFORMED, manifest: null };
  }
  return { state: ManifestState.VALID, manifest: parsed };
}

/**
 * Normalize two commit identifiers for comparison.
 *
 * The manifest carries a SHORT sha (`git rev-parse --short HEAD`) while an
 * expectation is usually a full sha. Comparing them raw would report permanent
 * false DRIFT, so compare on the shorter common prefix — but only when one is a
 * genuine prefix of the other, so two different commits never compare equal.
 */
export function commitsMatch(deployed, expected) {
  if (typeof deployed !== 'string' || typeof expected !== 'string') return false;
  const a = deployed.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  if (a.length === 0 || b.length === 0) return false;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return long.startsWith(short);
}

/**
 * Compare one surface's fetched manifest against the expected revision.
 * `expectedSha` is supplied by the caller (normally the verified origin/main
 * head) — this module never resolves it itself, so the expectation source stays
 * explicit and auditable.
 */
export function compareSurface({ surface, expectedSha, fetched }) {
  const { state, manifest } = classifyManifest(fetched);
  const base = {
    surfaceId: surface?.id ?? null,
    url: surface?.url ?? null,
    governed: surface?.governed ?? null,
    manifestState: state,
    deployedCommit: manifest?.commit ?? null,
    deployedBase: manifest?.base ?? null,
    buildTime: manifest?.buildTime ?? null,
    expectedCommit: expectedSha ?? null,
  };

  if (state === ManifestState.UNREACHABLE) {
    return { ...base, verdict: DriftVerdict.UNKNOWN_UNREACHABLE };
  }
  if (state !== ManifestState.VALID) {
    // Absent or malformed: we cannot say the surface is wrong, only that it
    // cannot be asked. Reporting DRIFT here would be a fabricated conclusion.
    return { ...base, verdict: DriftVerdict.UNKNOWN_NO_MANIFEST };
  }
  return {
    ...base,
    verdict: commitsMatch(manifest.commit, expectedSha)
      ? DriftVerdict.MATCH
      : DriftVerdict.DRIFT,
  };
}

/**
 * Roll surface results up to an environment. An environment is only MATCH when
 * every observable surface matches — a single drifted surface makes the whole
 * environment drifted, because users may be served by any of them.
 */
export function summarizeEnvironment(environment, surfaceResults) {
  const observable = surfaceResults.filter(
    (r) => r.verdict === DriftVerdict.MATCH || r.verdict === DriftVerdict.DRIFT,
  );
  const unobservableCount = surfaceResults.length - observable.length;

  // A bare MATCH must mean "every surface was checked and agreed". When some
  // surfaces could not be read, saying MATCH would manufacture exactly the
  // false confidence D2 exists to remove — the live case being a governed
  // surface known to be days stale but unable to self-identify because it
  // predates D1. That is reported as MATCH_PARTIAL, never MATCH.
  let verdict;
  if (surfaceResults.length === 0) verdict = 'NOT_OBSERVABLE';
  else if (observable.length === 0) verdict = 'UNKNOWN';
  else if (observable.some((r) => r.verdict === DriftVerdict.DRIFT)) verdict = 'DRIFT';
  else verdict = unobservableCount > 0 ? 'MATCH_PARTIAL' : 'MATCH';

  // Surfaces disagreeing with EACH OTHER is a distinct, higher-severity signal
  // than either disagreeing with expectation: it means different users are
  // running different code right now. Observed live between Pages and Hosting.
  const deployedCommits = new Set(
    observable.map((r) => r.deployedCommit).filter(Boolean),
  );
  return {
    environmentId: environment?.id ?? null,
    role: environment?.role ?? null,
    deployment: environment?.deployment ?? null,
    status: environment?.status ?? null,
    verdict,
    unobservableCount,
    surfacesDisagree: deployedCommits.size > 1,
    surfaces: surfaceResults,
  };
}

/** Environments the registry declares but which cannot be observed yet. */
export function unobservableEnvironments(registry) {
  return (registry?.environments ?? [])
    .filter((e) => (e.surfaces ?? []).length === 0)
    .map((e) => ({ id: e.id, role: e.role, status: e.status, notes: e.notes ?? null }));
}
