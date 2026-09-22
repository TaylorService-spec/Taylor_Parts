// THE SHARED OPERATING COMPANY <-> eos_ops KEY BINDING, both directions, against a real postgres:16.
//
// The binding exists because the two vocabularies are NOT the same, and every test below uses a company
// whose key differs from its id. In nonprod `taylor` happens to bind to key `taylor`, which is precisely
// why an equality shortcut would go unnoticed there: it would pass. Here it cannot.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const binding = require("../lib/eosOps/operatingCompanyBinding.js");
const reconcile = require("../lib/eosWorkforce/migration/tenantOperatingCompanyKeys.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const TENANT = "t-bind";
const OTHER_TENANT = "t-other";

test("operating company <-> eos_ops key binding", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `bind_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (text, values = []) => pool.query(text, values);
  for (const id of [TENANT, OTHER_TENANT]) await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [id]);

  const authorize = (companyId, status = "ACTIVE", tenant = TENANT) => q(
    `INSERT INTO eos_policy.tenant_operating_companies
       (tenant_id, operating_company_id, status, source, established_by, updated_by)
     VALUES ($1,$2,$3,'test','fixture','fixture')
     ON CONFLICT (tenant_id, operating_company_id) DO UPDATE SET status = EXCLUDED.status`,
    [tenant, companyId, status]);

  // COMPANY ID AND KEY DIFFER IN EVERY FIXTURE, deliberately.
  await authorize("taylor");
  await authorize("ventana");
  await authorize("dormant", "INACTIVE");

  await t.test("the migration created the binding table with both uniqueness directions", async () => {
    const { rows } = await q(
      `SELECT indexdef FROM pg_indexes WHERE schemaname='eos_policy' AND tablename='tenant_operating_company_keys'`);
    const defs = rows.map((r) => String(r.indexdef)).join("\n");
    assert.match(defs, /\(tenant_id, operating_company_id\)/, "one key per company");
    assert.match(defs, /tenant_id, operating_company_key/, "one company per key");
  });

  // ════════ reconciliation ════════

  const KEY_EVIDENCE = [
    { operatingCompanyId: "taylor", operatingCompanyKey: "sample-co-test", provenance: "MIGRATED", reason: "test evidence" },
  ];

  await t.test("DRY RUN writes nothing", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, bindings: KEY_EVIDENCE, source: "test", actor: "fixture",
    });
    assert.deepEqual(report.additions, ["taylor"]);
    assert.equal(report.applied, false);
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_policy.tenant_operating_company_keys`);
    assert.equal(rows[0].n, 0);
  });

  await t.test("apply binds the company to a key that is NOT its id", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, bindings: KEY_EVIDENCE, source: "test", actor: "fixture", apply: true,
    });
    assert.equal(report.applied, true);
    const { rows } = await q(
      `SELECT operating_company_key, status, provenance FROM eos_policy.tenant_operating_company_keys
        WHERE tenant_id=$1 AND operating_company_id='taylor'`, [TENANT]);
    assert.equal(rows[0].operating_company_key, "sample-co-test");
    assert.notEqual(rows[0].operating_company_key, "taylor", "the key is not the company id");
    assert.equal(rows[0].provenance, "MIGRATED");
  });

  await t.test("an exact replay is idempotent and adds nothing", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, bindings: KEY_EVIDENCE, source: "test", actor: "fixture", apply: true,
    });
    assert.deepEqual(report.additions, []);
    assert.deepEqual(report.alreadyBound, ["taylor"]);
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_policy.tenant_operating_company_keys WHERE tenant_id=$1`, [TENANT]);
    assert.equal(rows[0].n, 1);
  });

  await t.test("a CONFLICTING key is reported and never rewritten", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, apply: true, source: "test", actor: "fixture",
      bindings: [{ operatingCompanyId: "taylor", operatingCompanyKey: "different-key", provenance: "MIGRATED", reason: "r" }],
    });
    assert.equal(report.applied, false);
    assert.equal(report.conflictingKey.length, 1);
    const { rows } = await q(`SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id=$1 AND operating_company_id='taylor'`, [TENANT]);
    assert.equal(rows[0].operating_company_key, "sample-co-test", "re-keying would orphan every row under the old key");
  });

  await t.test("a key already taken by ANOTHER company is refused", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, apply: true, source: "test", actor: "fixture",
      bindings: [{ operatingCompanyId: "ventana", operatingCompanyKey: "sample-co-test", provenance: "NATIVE", reason: "r" }],
    });
    assert.equal(report.applied, false);
    assert.equal(report.keyTakenByAnotherCompany.length, 1);
  });

  await t.test("a company the tenant is NOT authorized for cannot be keyed", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, apply: true, source: "test", actor: "fixture",
      bindings: [{ operatingCompanyId: "acme", operatingCompanyKey: "acme-key", provenance: "NATIVE", reason: "r" }],
    });
    assert.equal(report.applied, false);
    assert.deepEqual(report.companyNotAuthorized, ["acme"]);
    // A binding cannot introduce a company.
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_policy.tenant_operating_company_keys WHERE operating_company_id='acme'`);
    assert.equal(rows[0].n, 0);
  });

  await t.test("an INACTIVE company is not silently reactivated by keying it", async () => {
    const report = await reconcile.reconcileTenantOperatingCompanyKeys(pool, {
      tenantId: TENANT, apply: true, source: "test", actor: "fixture",
      bindings: [{ operatingCompanyId: "dormant", operatingCompanyKey: "dormant-key", provenance: "NATIVE", reason: "r" }],
    });
    assert.deepEqual(report.companyNotAuthorized, ["dormant"], "an INACTIVE company is not an authorized one");
  });

  // ════════ the shared resolvers, both directions ════════

  await t.test("company -> key resolves THROUGH THE BINDING, with id and key different", async () => {
    const key = await binding.resolveOperatingCompanyKeyForCompany(pool, TENANT, "taylor");
    assert.equal(key, "sample-co-test");
    assert.notEqual(key, "taylor", "the answer came from the row, not from the argument");
  });

  await t.test("key -> company resolves symmetrically", async () => {
    const companyId = await binding.resolveActiveOperatingCompanyId(pool, TENANT, "sample-co-test");
    assert.equal(companyId, "taylor");
  });

  await t.test("an AUTHORIZED but UNKEYED company fails closed -- no equality fallback", async () => {
    // This is Ventana's exact state in nonprod: the tenant may operate as it, and nothing is keyed.
    await assert.rejects(() => binding.resolveOperatingCompanyKeyForCompany(pool, TENANT, "ventana"), (e) => {
      assert.equal(e.code, "OPERATING_COMPANY_KEY_NOT_BOUND");
      assert.match(e.message, /nothing is inferred from the company id/);
      return true;
    });
  });

  await t.test("a DEACTIVATED company stops resolving, even with a live key row", async () => {
    await authorize("taylor", "INACTIVE");
    await assert.rejects(() => binding.resolveOperatingCompanyKeyForCompany(pool, TENANT, "taylor"),
      (e) => { assert.equal(e.code, "OPERATING_COMPANY_KEY_NOT_BOUND"); return true; });
    await authorize("taylor", "ACTIVE");
  });

  await t.test("another tenant's binding is never borrowed", async () => {
    await assert.rejects(() => binding.resolveOperatingCompanyKeyForCompany(pool, OTHER_TENANT, "taylor"),
      (e) => { assert.equal(e.code, "OPERATING_COMPANY_KEY_NOT_BOUND"); return true; });
  });

  await t.test("no code path infers the key from the company id", () => {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/operatingCompanyBinding.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

    // THE PROBE MUST NAME A FALLBACK, NOT ANY MENTION. A loose `|| operatingCompanyId` search matched the
    // input-validation disjunct `operatingCompanyId.trim() === ""` -- loud about safe code, and it would
    // have been relaxed. These patterns describe RETURNING the argument as if it were the key.
    const FALLBACKS = [
      /return\s+operatingCompanyId\s*;/,
      /\?\?\s*operatingCompanyId\s*[;,)]/,
      /\|\|\s*operatingCompanyId\s*[;,)]/,
      /operating_company_key\s*\)\s*\?\?\s*operatingCompanyId/,
    ];
    for (const pattern of FALLBACKS) {
      assert.equal(pattern.test(src), false,
        `a fallback to the company id would invent a partition for every unkeyed company (${pattern})`);
    }
    // NON-VACUITY: the probe must reject a real fallback if one were written.
    assert.equal(FALLBACKS.some((p) => p.test("  return String(rows[0]?.operating_company_key) ?? operatingCompanyId;")), true,
      "the fallback probe must detect an actual equality fallback");
    // And the resolver's answer comes from the ROW.
    assert.match(src, /return String\(rows\[0\]\.operating_company_key\)/);
    const copySrc = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/workOrderMigrationCopy.ts"), "utf8");
    assert.match(copySrc, /resolveOperatingCompanyKeyForCompany/, "COPY must use the SHARED resolver");
  });

  await t.test("the key CLI refuses a key supplied on the command line", () => {
    const cli = require("../scripts/tenantOperatingCompanyKeyReconcileCli.js");
    for (const forbidden of ["key", "operatingCompanyKey", "companyKey"]) {
      assert.throws(() => cli.assertReconcileInvocation(
        { environment: "platform-sandbox", databaseUrlEnv: "DATABASE_URL", tenantKey: "t", performedBy: "op", [forbidden]: "x" },
        { EOS_ENVIRONMENT: "nonprod", DATABASE_URL: "postgres://x" }),
        /governed evidence, not an operator choice|is not accepted/);
    }
  });

  await t.test("the governed key evidence names taylor -> taylor and keys no fixture partition", () => {
    const cli = require("../scripts/tenantOperatingCompanyKeyReconcileCli.js");
    const { bindings } = cli.loadKeyEvidence("platform-sandbox");
    assert.deepEqual(bindings.map((b) => `${b.operatingCompanyId}->${b.operatingCompanyKey}`), ["taylor->taylor"]);
    assert.equal(bindings[0].provenance, "MIGRATED");
    // Sample Company stays outside the governed business partition.
    assert.equal(bindings.some((b) => b.operatingCompanyKey === "sample-co-synthetic"), false);
    // Ventana is authorized but deliberately unkeyed.
    assert.equal(bindings.some((b) => b.operatingCompanyId === "ventana"), false);
  });
});
