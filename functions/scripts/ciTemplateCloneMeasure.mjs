// CI performance Phase 2 PROTOTYPE MEASUREMENT (lane CIP). Not a gate, not wired to any required check, changes no suite.
//
// Question: how much does a migrated TEMPLATE database save over migrating an empty database from scratch, per suite that
// needs a fresh database?
//
//   POLICY_TEST_DATABASE_URL=postgres://eos:eos@localhost:5432/eos_policy node scripts/ciTemplateCloneMeasure.mjs [rounds]
//
// It creates throwaway databases next to the one named by the URL, times `rounds` (default 5) of
//   (a) CREATE DATABASE <fresh> + node-pg-migrate up   (what every migrating suite does today), and
//   (b) CREATE DATABASE <clone> TEMPLATE <migrated>    (what Phase 2 would do),
// verifies a clone is byte-for-byte the same schema (table list + pgmigrations rows), prints JSON, and drops everything.
// Run it only against an ephemeral CI service container.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.POLICY_TEST_DATABASE_URL;
if (!base) { console.error("POLICY_TEST_DATABASE_URL is required"); process.exit(2); }
const rounds = Number(process.argv[2] ?? 5);
const urlFor = (db) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const tag = randomUUID().replace(/-/g, "").slice(0, 8);
const made = [];

const admin = new pg.Client({ connectionString: urlFor("postgres") });
await admin.connect();
const create = async (name, template) => {
  await admin.query(`CREATE DATABASE ${name}${template ? ` TEMPLATE ${template}` : ""}`);
  made.push(name);
};
const migrate = (db) => execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
  { cwd: FUNCTIONS_DIR, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, DATABASE_URL: urlFor(db) }, stdio: "pipe" });
const ms = async (fn) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t); };
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fingerprint = async (db) => {
  const c = new pg.Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    const t = await c.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2");
    const m = await c.query("SELECT name FROM pgmigrations ORDER BY id");
    return JSON.stringify({ tables: t.rows, migrations: m.rows });
  } finally { await c.end(); }
};

try {
  const fresh = [];
  for (let i = 0; i < rounds; i++) {
    const name = `cipm_fresh_${tag}_${i}`;
    fresh.push(await ms(async () => { await create(name); migrate(name); }));
  }
  const tpl = `cipm_tpl_${tag}`;
  const tplBuild = await ms(async () => { await create(tpl); migrate(tpl); });
  const clone = [];
  for (let i = 0; i < rounds; i++) clone.push(await ms(() => create(`cipm_clone_${tag}_${i}`, tpl)));
  const same = (await fingerprint(tpl)) === (await fingerprint(`cipm_clone_${tag}_0`));
  console.log(JSON.stringify({
    rounds, migrations: JSON.parse(await fingerprint(tpl)).migrations.length,
    freshMigrateMs: { median: median(fresh), all: fresh }, templateBuildMs: tplBuild,
    cloneMs: { median: median(clone), all: clone }, cloneIsIdenticalSchema: same,
  }, null, 2));
  if (!same) process.exitCode = 1;
} finally {
  for (const name of made.reverse()) await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => {});
  await admin.end();
}
