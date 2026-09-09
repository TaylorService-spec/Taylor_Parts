// The policy database connection — one pool per process.
//
// ════════════════════ WHY THIS IS ITS OWN FILE ════════════════════
//
// It is the ONLY module in this subsystem permitted to read connection configuration or construct a
// database client, and the no-Firebase/no-self-connecting guard names it explicitly for that reason.
// Keeping it separate is what lets the guard stay absolute everywhere else: every other policy
// module receives a repository and cannot reach storage any other way.
//
// ════════════════════ ONE POOL, NOT ONE PER REQUEST ════════════════════
//
// A Pool holds real sockets and a real handshake. Constructing one per request exhausts the
// server's connection slots under exactly the load that makes it matter, and every request pays a
// cold start. Owner ruling D-1 says one bounded, reused pool per service process; this module owns
// it and hands the same instance back.
//
// ════════════════════ NO CREDENTIALS HERE ════════════════════
//
// `DATABASE_URL` is read from the environment, or a configuration object is injected directly. No
// host, user, password or database name is written in this repository, and none may be: a
// connection string in source is a credential in git history, which outlives every rotation.
//
// ════════════════════ STANDARD POSTGRESQL ════════════════════
//
// The production target is Render, and nothing here knows that. No Render API, no platform-specific
// option. TLS is requested when the URL asks for it, which is how every managed provider expresses
// it -- including Render.
import { Pool } from "pg";
import type { PoolConfig } from "pg";

export class PolicyDatabaseConfigError extends Error {}

/** Injected connection configuration. Everything is optional so a caller can supply only a URL. */
export interface PolicyDatabaseOptions {
  /** A full connection string. Takes precedence over the environment. */
  readonly connectionString?: string;
  /**
   * Upper bound on connections. Small on purpose: this pool serves policy resolution, not bulk
   * traffic, and an unbounded pool simply moves the exhaustion from this service to the database.
   */
  readonly max?: number;
  readonly idleTimeoutMillis?: number;
  readonly connectionTimeoutMillis?: number;
}

const DEFAULTS = Object.freeze({
  max: 10,
  idleTimeoutMillis: 30_000,
  // A connection that has not been established in ten seconds is not going to be. Failing here
  // surfaces a misconfigured database as an error rather than as a request that never returns.
  connectionTimeoutMillis: 10_000,
});

/**
 * Build the pg configuration from injected options, falling back to `DATABASE_URL`.
 *
 * Exported for its own test: the resolution order and the TLS decision are the two things most
 * likely to be wrong in a new environment, and both are worth asserting without opening a socket.
 */
export function resolvePolicyDatabaseConfig(options: PolicyDatabaseOptions = {}): PoolConfig {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new PolicyDatabaseConfigError(
      "no policy database connection: pass connectionString or set DATABASE_URL",
    );
  }

  // TLS WHEN THE URL ASKS FOR IT. Managed providers append `sslmode=require`; a local cluster does
  // not. Deciding from the URL rather than from a hard-coded environment name is what keeps this
  // adapter portable -- and `rejectUnauthorized: false` matches how managed Postgres presents its
  // certificate chain, which is the provider's posture rather than a choice made here.
  const wantsTls = /[?&]sslmode=(require|verify-ca|verify-full)/i.test(connectionString);

  return {
    connectionString,
    max: options.max ?? DEFAULTS.max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULTS.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULTS.connectionTimeoutMillis,
    ...(wantsTls ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

let pool: Pool | null = null;

/**
 * The process's single policy database pool.
 *
 * Repeated calls return the SAME pool. That is the point: a second pool would be a second set of
 * connections nobody is counting, and the symptom appears much later as an unexplained limit.
 */
export function getPolicyDatabasePool(options: PolicyDatabaseOptions = {}): Pool {
  if (pool) return pool;
  pool = new Pool(resolvePolicyDatabaseConfig(options));
  // An idle client can be dropped by the network or the server. Without a listener, pg raises this
  // on the process and takes it down -- so it is logged and swallowed, and the pool replaces the
  // client on the next acquisition.
  pool.on("error", (err) => {
    console.error("[policyDatabase] idle client error", err);
  });
  return pool;
}

/**
 * Close the pool. For test teardown and orderly shutdown only.
 *
 * A service process should hold its pool for its whole life; calling this in request handling would
 * reintroduce exactly the per-request connection cost the pool exists to remove.
 */
export async function closePolicyDatabasePool(): Promise<void> {
  const current = pool;
  pool = null;
  if (current) await current.end();
}
