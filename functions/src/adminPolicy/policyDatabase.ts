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
  /**
   * Upper bound on a single statement, enforced by the SERVER (`statement_timeout`) rather than
   * only by the client. A client-side timeout abandons the caller and leaves the query running,
   * still holding its locks; the server-side one actually cancels it. Both are set, because the
   * client-side one is what turns a wedged connection into a rejected promise.
   */
  readonly statementTimeoutMillis?: number;
}

const DEFAULTS = Object.freeze({
  max: 10,
  idleTimeoutMillis: 30_000,
  // A connection that has not been established in ten seconds is not going to be. Failing here
  // surfaces a misconfigured database as an error rather than as a request that never returns.
  connectionTimeoutMillis: 10_000,
  // Policy reads and Admin mutations are small and indexed. Anything running for thirty seconds is
  // a defect, and letting it run is how one bad query becomes an exhausted pool.
  statementTimeoutMillis: 30_000,
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

  const statementTimeout = options.statementTimeoutMillis ?? DEFAULTS.statementTimeoutMillis;

  return {
    connectionString,
    max: options.max ?? DEFAULTS.max,
    idleTimeoutMillis: options.idleTimeoutMillis ?? DEFAULTS.idleTimeoutMillis,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? DEFAULTS.connectionTimeoutMillis,
    statement_timeout: statementTimeout,
    query_timeout: statementTimeout,
    ...(wantsTls ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

/**
 * A connection string with its credentials removed, for error messages and logs.
 *
 * A `DATABASE_URL` carries a password. The moment one appears in a log line it is in a log
 * aggregator, a crash report and somebody's terminal scrollback, and it outlives every rotation --
 * the same reason no connection string is written in this repository. Errors below carry this, not
 * the original.
 */
export function redactConnectionString(value: string | undefined): string {
  if (!value) return "(none)";
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    if (url.username) url.username = "***";
    return url.toString();
  } catch {
    // Not URL-shaped -- a key/value DSN, or something malformed. Say nothing rather than guess
    // which half was the secret.
    return "(unparseable connection string)";
  }
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

/** The database is not answering, or is answering without the schema this service needs. */
export class PolicyDatabaseUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export interface PolicyDatabaseHealth {
  readonly reachable: boolean;
  readonly migrated: boolean;
  /** Names of the migrations the database has recorded, newest last. Empty when none have run. */
  readonly appliedMigrations: readonly string[];
  readonly latencyMs: number;
  /** Present only when `reachable` is false. Never contains a credential. */
  readonly error?: string;
}

/**
 * Is the policy database reachable, and does it carry the schema?
 *
 * REACHABLE AND MIGRATED ARE DIFFERENT ANSWERS, and conflating them is how a service starts,
 * reports healthy, and then fails every request with "relation does not exist". A database that
 * answers `SELECT 1` but has no `pgmigrations` table is a database somebody forgot to migrate,
 * and this says so rather than leaving it to the first user to discover.
 */
export async function checkPolicyDatabaseHealth(pool: Pool): Promise<PolicyDatabaseHealth> {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    let applied: string[] = [];
    try {
      const res = await pool.query<{ name: string }>(
        "SELECT name FROM public.pgmigrations ORDER BY run_on, id",
      );
      applied = res.rows.map((r) => String(r.name));
    } catch {
      // No migrations table: reachable, not migrated. Not an error -- it is the answer.
      applied = [];
    }
    return {
      reachable: true,
      migrated: applied.length > 0,
      appliedMigrations: Object.freeze(applied),
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      reachable: false,
      migrated: false,
      appliedMigrations: Object.freeze([]),
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Wait for the database to answer, then require it to be migrated.
 *
 * Called at STARTUP, not per request. A managed database can take a few seconds to accept
 * connections after the service container starts, and crashing on the first attempt turns an
 * ordinary cold start into a restart loop. Bounded, so a genuinely absent database still fails --
 * a service that waits for ever looks identical to one that is working.
 */
export async function requirePolicyDatabaseReady(
  pool: Pool,
  options: { readonly attempts?: number; readonly delayMs?: number } = {},
): Promise<PolicyDatabaseHealth> {
  const attempts = Math.max(1, options.attempts ?? 10);
  const delayMs = Math.max(0, options.delayMs ?? 1_000);

  let last: PolicyDatabaseHealth | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await checkPolicyDatabaseHealth(pool);
    if (last.reachable) break;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!last || !last.reachable) {
    throw new PolicyDatabaseUnavailableError(
      `policy database did not answer after ${attempts} attempt(s): ${last?.error ?? "unknown"}`,
    );
  }
  if (!last.migrated) {
    throw new PolicyDatabaseUnavailableError(
      "policy database is reachable but has no applied migrations -- run `npm run migrate:up`",
    );
  }
  return last;
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
