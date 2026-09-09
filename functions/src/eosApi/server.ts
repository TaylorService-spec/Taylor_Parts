// The EOS trusted API service — the process that Render runs.
//
// ════════════════════ WHY THIS IS NOT IN src/adminPolicy ════════════════════
//
// Because this file is where Firebase lives. The policy subsystem's Firebase regression guard is a
// STATIC check over `src/adminPolicy`, and it should stay absolute rather than acquire an
// exception: the moment "no Firebase here" needs an allowlist entry, it stops being a rule and
// becomes a habit.
//
// So identity verification is injected into the transport, and the only concrete verifier is
// below. Replacing the identity provider is a change to this file and nothing else.
//
// ════════════════════ WHAT FIREBASE IS ALLOWED TO SAY ════════════════════
//
// One thing: this bearer token belongs to subject X. It is not asked for a role, a tenant, a
// custom claim or a document, and no answer it gave would be read as authority — every
// authorization question is answered from PostgreSQL by the Administration API.
//
// ════════════════════ NOT DEPLOYED ════════════════════
//
// This process is written, typechecked and proved locally. Nothing deploys it: there is no Render
// service, and creating one needs Owner action. The required environment is listed in
// docs/architecture/eos-policy-nonprod-activation.md.
import { createServer } from "node:http";
import { PostgresPolicyRepository } from "../adminPolicy/postgresPolicyRepository";
import {
  checkPolicyDatabaseHealth,
  closePolicyDatabasePool,
  getPolicyDatabasePool,
  requirePolicyDatabaseReady,
} from "../adminPolicy/policyDatabase";
import { createAdminPolicyHttpHandler } from "../adminPolicy/adminPolicyHttp";
import type { TokenVerifier, VerifiedIdentity } from "../adminPolicy/adminPolicyHttp";

/**
 * The environment this service reads. Every one is injected; none is committed.
 *
 *   DATABASE_URL              the policy database. Required.
 *   EOS_ENVIRONMENT           a label -- "local", "nonprod". REFUSED if it says production.
 *   EOS_API_PORT              listen port. Render supplies PORT; both are read.
 *   EOS_ALLOWED_ORIGINS       comma-separated browser origins. No wildcard.
 *   EOS_IDENTITY_PROVIDER     defaults to "firebase".
 *   FIREBASE_AUTH_EMULATOR_HOST  present only for local development; see below.
 */
export interface ServiceConfig {
  readonly port: number;
  readonly environment: string;
  readonly allowedOrigins: readonly string[];
  readonly identityProvider: string;
}

export class ServiceConfigError extends Error {}

/**
 * Read the service configuration.
 *
 * REFUSES TO START AGAINST PRODUCTION. This tranche is explicitly non-production, and the cheapest
 * enforcement is the service declining to run when its own environment label says otherwise --
 * a check that lives in the process rather than in a deployment convention somebody can forget.
 */
export function readServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const environment = (env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
  if (environment === "production" || environment === "prod") {
    throw new ServiceConfigError(
      "EOS_ENVIRONMENT names production; this service is non-production only in this tranche",
    );
  }

  const rawPort = env.EOS_API_PORT ?? env.PORT ?? "8787";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new ServiceConfigError(`EOS_API_PORT/PORT "${rawPort}" is not a port`);
  }

  const allowedOrigins = (env.EOS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  // A wildcard would let any page a signed-in administrator visits read this tenant's policy.
  if (allowedOrigins.includes("*")) {
    throw new ServiceConfigError("EOS_ALLOWED_ORIGINS may not contain '*'");
  }

  return {
    port,
    environment,
    allowedOrigins: Object.freeze(allowedOrigins),
    identityProvider: (env.EOS_IDENTITY_PROVIDER ?? "firebase").trim(),
  };
}

/**
 * Verify a Firebase ID token and return only its subject.
 *
 * `firebase-admin` is imported lazily so that merely importing this module -- which the config test
 * does -- neither initializes an app nor requires credentials to be present.
 */
export function createFirebaseTokenVerifier(identityProvider: string): TokenVerifier {
  return async function verify(bearerToken: string): Promise<VerifiedIdentity> {
    // A DYNAMIC IMPORT OF A CJS MODULE lands its exports under `.default`, and firebase-admin is
    // CJS. Reaching for `admin.initializeApp` directly gets undefined -- which surfaced here as
    // every token failing to verify with a message that said nothing about the real cause. Both
    // shapes are handled so this does not depend on how the bundler happens to interop.
    const imported = (await import("firebase-admin")) as unknown as Record<string, unknown>;
    const admin = ((imported.default ?? imported) as typeof import("firebase-admin"));
    const app = admin.apps?.length ? admin.app() : admin.initializeApp();
    const decoded = await app.auth().verifyIdToken(bearerToken);
    if (!decoded?.uid) throw new Error("token carries no subject");
    // ONLY the uid is taken. Custom claims are deliberately not read: a claim that granted
    // authority would put the authorization model back inside the identity provider.
    return { externalSubject: decoded.uid, identityProvider };
  };
}

export interface StartedService {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Start the service.
 *
 * The database is checked BEFORE the socket opens. A service that accepts traffic and then fails
 * every request with "relation does not exist" is indistinguishable, to whatever is routing to it,
 * from one that is working.
 */
export async function startEosApi(
  options: {
    readonly config?: ServiceConfig;
    readonly verifyToken?: TokenVerifier;
  } = {},
): Promise<StartedService> {
  const config = options.config ?? readServiceConfig();
  const pool = getPolicyDatabasePool();
  await requirePolicyDatabaseReady(pool);

  const repo = new PostgresPolicyRepository(pool);
  const handler = createAdminPolicyHttpHandler({
    repo,
    verifyToken: options.verifyToken ?? createFirebaseTokenVerifier(config.identityProvider),
    allowedOrigins: config.allowedOrigins,
    health: async () => {
      const health = await checkPolicyDatabaseHealth(pool);
      return {
        environment: config.environment,
        reachable: health.reachable,
        migrated: health.migrated,
        latencyMs: health.latencyMs,
        migrations: health.appliedMigrations.length,
      };
    },
  });

  const server = createServer((req, res) => {
    void handler(req as never, res as never);
  });

  await new Promise<void>((resolve) => server.listen(config.port, resolve));

  return {
    port: config.port,
    async close() {
      // ORDERLY: stop accepting, then let in-flight requests finish, then release the pool. Ending
      // the pool first would fail the requests that are still running.
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await closePolicyDatabasePool();
    },
  };
}
