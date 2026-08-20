// EOS-ISSUE-1062 -- sandbox Functions deployment verification, PURE CORE.
//
// Answers "for each named Gen-2 callable, does it exist, is it ACTIVE, and is
// it running nodejs22?" against a `gcloud functions list --v2 --format=json`
// payload. This module performs NO process/network access, so it is
// hermetically testable and safe to run anywhere -- the CLI wrapper
// (verifySandboxFunctions.mjs) owns the one `gcloud` invocation.
//
// VERIFICATION ONLY. Nothing here deploys, mutates cloud state, touches
// secrets, or changes permissions.

export const REQUIRED_STATE = 'ACTIVE';
export const REQUIRED_RUNTIME = 'nodejs22';

/**
 * Parse CLI arguments. Pure and side-effect free so argument handling is
 * testable without spawning a process.
 *
 * Accepted forms:
 *   --project <id> <fn1> <fn2> ...
 *   --project <id> --function <fn1> --function <fn2>
 * (the two forms may be mixed)
 */
export function parseArgs(argv) {
  const errors = [];
  let project = null;
  const functions = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') {
      project = argv[++i] ?? null;
    } else if (arg === '--function') {
      const name = argv[++i] ?? null;
      if (name) functions.push(name);
    } else if (arg.startsWith('--')) {
      errors.push(`Unrecognized flag: ${arg}`);
    } else {
      functions.push(arg);
    }
  }

  if (!project) errors.push('Missing required --project <id>.');
  if (functions.length === 0) errors.push('At least one expected callable name is required.');

  return { project, functions, errors };
}

/**
 * Parse and normalize a `gcloud functions list --v2 --format=json` payload
 * into a Map keyed by short function name (the last segment of `name`, or
 * the top-level `id` when present -- both forms are observed live).
 */
export function parseFunctionsListPayload(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: `Could not parse gcloud output as JSON: ${err.message}` };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON array from `gcloud functions list --v2`.' };
  }

  const byName = new Map();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const shortName = shortFunctionName(entry);
    if (!shortName) continue;
    byName.set(shortName, {
      state: entry.state ?? null,
      runtime: entry.runtime ?? entry.buildConfig?.runtime ?? null,
    });
  }
  return { ok: true, functions: byName };
}

function shortFunctionName(entry) {
  if (typeof entry.id === 'string' && entry.id.length > 0) return entry.id;
  if (typeof entry.name === 'string' && entry.name.length > 0) {
    const segments = entry.name.split('/');
    return segments[segments.length - 1];
  }
  return null;
}

/** Evaluate one expected callable name against the parsed functions map. */
export function evaluateFunction(name, functionsByName) {
  const deployed = functionsByName.get(name);
  if (!deployed) {
    return { name, verdict: 'FAIL', reason: 'not found among deployed Gen-2 functions' };
  }
  if (deployed.state !== REQUIRED_STATE) {
    return {
      name,
      verdict: 'FAIL',
      reason: `state is ${deployed.state ?? 'UNKNOWN'}, expected ${REQUIRED_STATE}`,
    };
  }
  if (deployed.runtime !== REQUIRED_RUNTIME) {
    return {
      name,
      verdict: 'FAIL',
      reason: `runtime is ${deployed.runtime ?? 'UNKNOWN'}, expected ${REQUIRED_RUNTIME}`,
    };
  }
  return { name, verdict: 'PASS', reason: `${REQUIRED_STATE} / ${REQUIRED_RUNTIME}` };
}

/** Evaluate every expected callable name, in the order supplied. */
export function evaluateAll(names, functionsByName) {
  return names.map((name) => evaluateFunction(name, functionsByName));
}

/** Human-readable PASS/FAIL report, one line per callable. */
export function formatResults(results) {
  return results
    .map((r) => `${r.verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${r.name}: ${r.reason}`)
    .join('\n');
}

/** 0 when every result is PASS, 1 otherwise -- fail-closed on any FAIL. */
export function overallExitCode(results) {
  return results.every((r) => r.verdict === 'PASS') ? 0 : 1;
}
