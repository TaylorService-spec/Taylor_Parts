// O-3 — environment resolution, PURE CORE.
//
// The one authoritative way to answer "which environment is this build for, and
// what is its identity?". Consumed by the Vite build (client Firebase identity +
// readiness), by D2's drift checker, and available to operator tooling — so there
// is a single mechanism rather than one per program.
//
// PURE: no network, filesystem, or process access. The caller supplies the
// registry and the requested id.
//
// FAILS CLOSED. An unknown environment id, or a known-but-unprovisioned one, is
// an error — never a silent fallback to production. Falling back would let a typo
// point a sandbox build at the customer's live data, which is the exact failure
// this module exists to make impossible.

export class EnvironmentResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EnvironmentResolutionError';
    this.code = code;
  }
}

export const REQUIRED_FIREBASE_KEYS = Object.freeze([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'functionsRegion',
]);

export const READINESS_KEYS = Object.freeze([
  'RECEIVING_TRANSPORT_READY',
  'TRUCK_MANAGEMENT_WRITE_READY',
  'TRUSTED_COMPLETION_ENABLED',
]);

/** Every environment id the registry knows. This is the allow-list. */
export function knownEnvironmentIds(registry) {
  return (registry?.environments ?? []).map((e) => e.id);
}

/** Every real Firebase project id the registry knows — the project allow-list. */
export function knownProjectIds(registry) {
  return (registry?.environments ?? [])
    .map((e) => e.firebase?.projectId)
    .filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Is this project id one the platform knows about?
 *
 * Production guards use this INSTEAD OF widening to a wildcard: an unknown
 * project must still fail closed. Membership is not permission — a caller that
 * additionally requires production still checks the role.
 */
export function isKnownProjectId(registry, projectId) {
  return knownProjectIds(registry).includes(projectId);
}

/**
 * Resolve the environment record for `id`.
 *
 * `requireFirebaseIdentity` (default true) rejects environments declared but not
 * yet provisioned, so a build cannot silently produce an app with no backend.
 */
export function resolveEnvironment(registry, id, { requireFirebaseIdentity = true } = {}) {
  if (!registry || !Array.isArray(registry.environments)) {
    throw new EnvironmentResolutionError('INVALID_REGISTRY', 'Environment registry is missing or malformed.');
  }
  const requested = id ?? registry.defaultEnvironmentId;
  if (!requested) {
    throw new EnvironmentResolutionError(
      'NO_ENVIRONMENT',
      'No environment id supplied and the registry declares no defaultEnvironmentId.',
    );
  }

  const env = registry.environments.find((e) => e.id === requested);
  if (!env) {
    throw new EnvironmentResolutionError(
      'UNKNOWN_ENVIRONMENT',
      `Unknown environment '${requested}'. Known: ${knownEnvironmentIds(registry).join(', ')}. ` +
        'Refusing to fall back to a default — a typo must not silently target another environment.',
    );
  }

  if (requireFirebaseIdentity) {
    if (!env.firebase) {
      throw new EnvironmentResolutionError(
        'ENVIRONMENT_NOT_PROVISIONED',
        `Environment '${requested}' is declared but has no Firebase identity (status: ${env.status}). ` +
          'It has not been provisioned; building against it would produce an app with no backend.',
      );
    }
    for (const key of REQUIRED_FIREBASE_KEYS) {
      const value = env.firebase[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new EnvironmentResolutionError(
          'INCOMPLETE_FIREBASE_IDENTITY',
          `Environment '${requested}' is missing Firebase '${key}'.`,
        );
      }
    }
  }

  const readiness = env.readiness ?? {};
  for (const key of READINESS_KEYS) {
    if (typeof readiness[key] !== 'boolean') {
      throw new EnvironmentResolutionError(
        'INCOMPLETE_READINESS',
        `Environment '${requested}' is missing boolean readiness flag '${key}'. ` +
          'Readiness must be explicit per environment — an absent flag must never default to enabled.',
      );
    }
  }

  return {
    id: env.id,
    role: env.role,
    deployment: env.deployment,
    status: env.status,
    firebase: env.firebase ? { ...env.firebase } : null,
    readiness: { ...readiness },
  };
}

/**
 * Is this resolved environment a production one?
 * Deliberately keyed on ROLE, never on a project name or deployment — that is
 * what keeps "production" from silently meaning "Taylor Parts".
 */
export function isProductionEnvironment(resolved) {
  return resolved?.role === 'production';
}
