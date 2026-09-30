#!/usr/bin/env node
// Run ONE EOS inbound mail delivery cycle (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30).
//
//   DATABASE_URL=... EOS_ENVIRONMENT=nonprod node scripts/pollInboundMailboxes.mjs
//
// The same cycle the opt-in in-process schedule runs (EOS_INBOUND_POLLING=enabled): every connected, enabled mailbox
// of every tenant, once, under a cluster-wide advisory lock (a concurrent cycle makes this one a no-op). Suitable for a
// Render cron job. Refuses production. Prints counts only -- never a token, a provider body or a connection string.
import process from "node:process";
import pg from "pg";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { runInboundDeliveryCycle, currentInboundProviderRuntime } from "../lib/eosOps/inboundProviderRuntime.js";

const environment = (process.env.EOS_ENVIRONMENT ?? "local").trim().toLowerCase();
if (environment === "production" || environment === "prod") {
  console.error("REFUSED: provider polling is not authorized in production.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("REFUSED: DATABASE_URL is not set.");
  process.exit(2);
}
const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: process.env.DATABASE_URL, max: 4 }));
try {
  const runtime = currentInboundProviderRuntime();
  const { ran, results } = await runInboundDeliveryCycle(pool, runtime);
  if (!ran) {
    console.log("INBOUND_DELIVERY_CYCLE skipped: another cycle holds the lock");
  } else {
    const t = results.reduce((a, r) => ({ fetched: a.fetched + r.fetched, created: a.created + r.created, duplicates: a.duplicates + r.duplicates,
      quarantined: a.quarantined + r.quarantined, stored: a.stored + r.attachmentsStored, failures: a.failures + r.failures + (r.transportFailure ? 1 : 0) }),
    { fetched: 0, created: 0, duplicates: 0, quarantined: 0, stored: 0, failures: 0 });
    console.log(`INBOUND_DELIVERY_CYCLE mailboxes=${results.length} ${JSON.stringify(t)}`);
  }
} catch (err) {
  console.error(`FAILED: ${err instanceof Error ? err.name : "error"}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
