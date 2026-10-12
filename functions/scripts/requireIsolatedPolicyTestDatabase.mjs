// ONE LANE, ONE TEST DATABASE. Runs before `npm run test:adminPolicyPostgres` (the `pretest:` hook) and refuses to start
// the gate against a database it cannot have to itself.
//
// Most PostgreSQL suites migrate and reset the database named by POLICY_TEST_DATABASE_URL in place. Two development
// lanes pointed at the same one destroy each other's runs: 2026-10-12 a full gate reported 125 failures, every one of
// them "Another migration is already running" or a relation vanishing mid-test, because another worktree was migrating
// the shared `postgres` database at the same time. Rerun alone on a dedicated database: 0 failures.
//
// Refused:
//   * the cluster's shared databases (`postgres`, `template0`, `template1`) -- every lane reaches for them by default;
//   * a database with another client session connected right now -- another lane is mid-run, or something else owns it.
//
// The fix is always the same: `createdb <lane>_gate` and point POLICY_TEST_DATABASE_URL at it. Nothing is created,
// dropped or changed here. With POLICY_TEST_DATABASE_URL unset the suites SKIP and this passes them through.
import pg from "pg";

export const SHARED_DATABASES = Object.freeze(["postgres", "template0", "template1"]);

/** The refusal for this target, or null. Pure. */
export function isolationRefusal(databaseName, otherSessions) {
  if (!databaseName || SHARED_DATABASES.includes(databaseName)) {
    return `POLICY_TEST_DATABASE_URL names the shared database "${databaseName || "(default)"}". ` +
      "Parallel lanes collide there. Create one for this lane, e.g. `createdb -h 127.0.0.1 -p 55432 -U eos <lane>_gate`, " +
      "and set POLICY_TEST_DATABASE_URL=postgres://eos@127.0.0.1:55432/<lane>_gate.";
  }
  if (otherSessions.length > 0) {
    const who = otherSessions.map((s) => `${s.application_name || "(unnamed)"} since ${new Date(s.backend_start).toISOString()}`).join("; ");
    return `database "${databaseName}" has ${otherSessions.length} other client session(s) connected (${who}). ` +
      "Another lane may be running against it. Use a database of your own, or wait for it to finish.";
  }
  return null;
}

export async function checkPolicyTestDatabase(url) {
  const client = new pg.Client({ connectionString: url, application_name: "eos-test-isolation-check" });
  await client.connect();
  try {
    const { rows: [{ db }] } = await client.query("SELECT current_database() AS db");
    const { rows } = await client.query(
      `SELECT application_name, backend_start FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'
        ORDER BY backend_start`);
    return isolationRefusal(db, rows);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.POLICY_TEST_DATABASE_URL;
  if (!url) {
    console.log("POLICY_TEST_DATABASE_URL is not set: the PostgreSQL suites will SKIP.");
  } else {
    const refusal = await checkPolicyTestDatabase(url);
    if (refusal) {
      console.error(`REFUSED: ${refusal}`);
      process.exit(1);
    }
    console.log("test database isolation: this run has the database to itself");
  }
}
