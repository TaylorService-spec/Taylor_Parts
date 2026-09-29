// PLATFORM QA HARNESS (lane L5) -- the five EOS HTTP transports over ONE disposable PostgreSQL.
//
// Not a test file. The platformQa*Postgres suites import it. Everything it writes lands in a database it creates and
// drops; no fixture, no nonprod row, no Firebase project is touched. Identity is an injected verifier that maps an
// opaque token to an external subject -- exactly the one fact the deployed Firebase verifier contributes.
//
// Every decision under measurement is taken by product code: the transports' own pure request handlers
// (handleAdminRequest / handleOperationsRequest / handleCommercialRequest / handleCrmRequest / handleWorkforceRequest),
// composed the way src/eosApi/server.ts composes them (same repository, same pool, same verifier).
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const require = createRequire(import.meta.url);
export const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const adminHttp = require("../lib/adminPolicy/adminPolicyHttp.js");
const adminApi = require("../lib/adminPolicy/adminPolicyApi.js");
const opsHttp = require("../lib/eosOps/eosOpsHttp.js");
const commercialHttp = require("../lib/eosCommercial/commercialHttp.js");
const crmHttp = require("../lib/eosCrm/crmHttp.js");
const workforceHttp = require("../lib/eosWorkforce/workforceHttp.js");
const catalogHttp = require("../lib/catalogMaster/catalogHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const { explainEffectiveAccess } = require("../lib/eosOps/effectiveAccessExplanation.js");

export const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
export const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to measure against";

const dbUrlFor = (name) => {
  const u = new URL(URL_BASE);
  u.pathname = `/${name}`;
  return u.toString();
};
async function withClient(url, fn) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** A disposable, fully migrated database and a pool over it. Dropped in `t.after`. */
export async function freshMigratedDatabase(t, prefix) {
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const url = dbUrlFor(name);
  let pool;
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: url, max: 8 });
  return { url, pool };
}

/**
 * The five transports, composed as server.ts composes them. `crmActive` supplies the CRM writer authority through the
 * transport's declared TEST SEAM (`writerAuthority`) -- the committed authority is INACTIVE, which refuses every CRM
 * operation 503 before any authorization question is asked, so an inactive composition measures nothing else.
 */
export function composeTransports(pool, verifyToken, { crmActive = true, allowedOrigins = [] } = {}) {
  const repo = new PostgresPolicyRepository(pool);
  const admin = {
    repo, verifyToken, allowedOrigins,
    explainEffectiveAccess: (tenantId, principalId) => explainEffectiveAccess(repo, pool, { tenantId, principalId }),
  };
  const shared = { reader: repo, pool, verifyToken, allowedOrigins };
  const crm = crmActive ? { ...shared, writerAuthority: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) } : shared;
  // The Reorder operations (PR #2000) are committed INACTIVE and refuse 412 PRECONDITION_FAILED before principal resolution; measured
  // ACTIVE through the Operations transport's declared test seam, so authority -- not the activation gate -- answers.
  const ops = crmActive ? { ...shared, reorderPostgresActive: true } : shared;
  // The Catalog transport (PR #2000) is committed INACTIVE too; measured ACTIVE through its declared test seam.
  const catalog = crmActive ? { ...shared, writerAuthority: Object.freeze({ firestore: "FROZEN", postgres: "ACTIVE" }) } : shared;
  return {
    repo,
    transports: {
      administration: {
        operations: [...adminApi.ADMIN_READ_OPERATIONS, ...adminApi.ADMIN_MUTATION_OPERATIONS],
        mutations: new Set(adminApi.ADMIN_MUTATION_OPERATIONS),
        route: () => "/admin/policy",
        handle: (req) => adminHttp.handleAdminRequest(admin, req),
        node: adminHttp.createAdminPolicyHttpHandler(admin),
      },
      operations: {
        operations: [...opsHttp.OPERATIONS_READ_OPERATIONS, ...(opsHttp.OPERATIONS_MUTATION_OPERATIONS ?? [])],
        mutations: new Set(opsHttp.OPERATIONS_MUTATION_OPERATIONS ?? []),
        route: (op) => opsHttp.OPERATIONS_ROUTE_BY_OPERATION[op] ?? "/operations/inventory",
        handle: (req) => opsHttp.handleOperationsRequest(ops, req),
        node: opsHttp.createOperationsHttpHandler(ops),
      },
      commercial: {
        operations: [...commercialHttp.COMMERCIAL_READ_OPERATIONS, ...commercialHttp.COMMERCIAL_MUTATION_OPERATIONS],
        mutations: new Set(commercialHttp.COMMERCIAL_MUTATION_OPERATIONS),
        route: () => commercialHttp.COMMERCIAL_ROUTE,
        handle: (req) => commercialHttp.handleCommercialRequest(shared, req),
        node: commercialHttp.createCommercialHttpHandler(shared),
      },
      crm: {
        operations: [...crmHttp.CRM_OPERATIONS],
        mutations: new Set(crmHttp.CRM_OPERATIONS.filter((op) => !/^(get|list)/.test(op))),
        route: () => crmHttp.CRM_ROUTE,
        handle: (req) => crmHttp.handleCrmRequest(crm, req),
        node: crmHttp.createCrmHttpHandler(crm),
      },
      catalog: {
        operations: [...catalogHttp.CATALOG_READ_OPERATIONS, ...catalogHttp.CATALOG_MUTATION_OPERATIONS],
        mutations: new Set(catalogHttp.CATALOG_MUTATION_OPERATIONS),
        route: () => catalogHttp.CATALOG_ROUTE,
        handle: (req) => catalogHttp.handleCatalogRequest(catalog, req),
        node: catalogHttp.createCatalogHttpHandler(catalog),
      },
      workforce: {
        operations: [...workforceHttp.WORKFORCE_READ_OPERATIONS, ...workforceHttp.WORKFORCE_COMMAND_OPERATIONS],
        mutations: new Set(workforceHttp.WORKFORCE_COMMAND_OPERATIONS),
        route: () => workforceHttp.WORKFORCE_ROUTE,
        handle: (req) => workforceHttp.handleWorkforceRequest(shared, req),
        node: workforceHttp.createWorkforceHttpHandler(shared),
      },
    },
  };
}

/** One HTTP call through a transport's pure handler, parsed. */
export async function call(transport, operation, { token, input, tenant, method = "POST", rawBody, route } = {}) {
  const headers = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (tenant !== undefined) headers["x-eos-tenant"] = tenant;
  const body = rawBody !== undefined ? rawBody : JSON.stringify(input === undefined ? { operation } : { operation, input });
  const res = await transport.handle({ method, url: route ?? transport.route(operation), headers, body });
  let parsed;
  try {
    parsed = JSON.parse(res.body || "{}");
  } catch {
    parsed = { unparsable: res.body };
  }
  return { status: res.status, code: parsed.code ?? (parsed.ok ? "OK" : undefined), body: parsed };
}

/**
 * The SAME call through the transport's node:http adapter (create*HttpHandler) -- what a browser actually receives,
 * including the adapter's own last-resort catch and its CORS headers. `origin` is sent as the Origin header.
 */
export async function callNode(transport, operation, { token, input, origin } = {}) {
  const { EventEmitter } = await import("node:events");
  const req = new EventEmitter();
  req.method = "POST";
  req.url = transport.route(operation);
  req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(origin ? { origin } : {}) };
  const out = { status: 0, headers: {}, body: "" };
  const res = { writeHead(status, headers) { out.status = status; out.headers = headers ?? {}; }, end(body) { out.body = String(body ?? ""); } };
  const done = transport.node(req, res);
  req.emit("data", Buffer.from(JSON.stringify({ operation, input: input ?? {} })));
  req.emit("end");
  await done;
  let parsed = {};
  try { parsed = JSON.parse(out.body || "{}"); } catch { parsed = { unparsable: out.body }; }
  return { status: out.status, code: parsed.code, cors: out.headers["access-control-allow-origin"] ?? null, body: parsed };
}

/** Token -> external subject. The ONLY fact identity contributes. */
export function tokenRegistry() {
  const tokens = new Map();
  return {
    register(token, subject) { tokens.set(token, subject); },
    verifyToken: async (token) => {
      const subject = tokens.get(token);
      if (!subject) throw new Error("invalid token");
      return { externalSubject: subject, identityProvider: "firebase" };
    },
  };
}

/**
 * A Principal with an ACTIVE membership in `tenantId`, holding a CUSTOM Role granted exactly `keys` ("ALL" = every
 * registered capability). Written through the product repository (principal, membership, role, assignment) and one
 * INSERT per grant, as the commercial transport suite does. Disposable database only.
 */
export async function makeActor(ctx, tenantId, subject, keys, { roleKey } = {}) {
  const { repo, pool, tokens } = ctx;
  const actorFor = { tenantId, uid: "uid-l5-fixture-admin" };
  const principalId = await repo.transact(actorFor, async (tx) => {
    const principal = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(principal.id);
    return principal.id;
  });
  const list = keys === "ALL"
    ? (await pool.query(`SELECT key FROM eos_policy.capabilities ORDER BY key`)).rows.map((r) => r.key)
    : keys;
  if (list.length > 0) {
    const role = await repo.transact(actorFor, (tx) => tx.createRole({
      key: roleKey ?? `l5-role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false,
    }));
    for (const key of list) {
      await pool.query(
        `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT $1, $2, $3, c.id, 'l5-fixture', 'l5-fixture', 'l5-fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
        [`rc_l5_${role.id}_${key}`, tenantId, role.id, key]);
    }
    await repo.transact(actorFor, async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({
        principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "l5-fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
      });
    });
  }
  const token = `tok-${subject}`;
  tokens.register(token, subject);
  return { principalId, token, subject, tenantId };
}

/** Row counts of every append-only audit / receipt relation, so a refusal can be proven to have written nothing. */
export async function auditFootprint(pool) {
  const { rows } = await pool.query(
    `SELECT table_schema || '.' || table_name AS rel FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND (table_name ~ '(audit|receipt|history|decision)' )
        AND table_schema IN ('eos_policy','eos_ops','eos_commercial','eos_crm','eos_workforce')
      ORDER BY 1`);
  const out = {};
  for (const { rel } of rows) out[rel] = (await pool.query(`SELECT count(*)::int n FROM ${rel}`)).rows[0].n;
  return out;
}

/**
 * The NONPROD AUTHORITY POPULATION, rebuilt by the product's own phases exactly as
 * personaBusinessAccessRegression.test.mjs does (and there PROVED equal to the measured nonprod authority): migrate to
 * the seed boundary, create the tenant, seedTenantPolicy, migrate the rest, then the canonical-catalog and nonprod
 * activation grant declarations. Disposable database.
 */
export async function rebuiltAuthorityDatabase(t, prefix, tenantId, tenantKey) {
  const { readdirSync } = await import("node:fs");
  const { seedTenantPolicy } = require("../lib/adminPolicy/seed/policySeed.js");
  const baseline = require("../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  const url = dbUrlFor(name);
  let pool;
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const migrate = (count) => execFileSync(process.execPath,
    ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
      ...(count === undefined ? [] : [String(count)])],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const repo = new PostgresPolicyRepository(pool);
  await pool.query("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $2)", [tenantId, tenantKey]);
  await seedTenantPolicy(repo, tenantId, "l5-platform-qa");
  migrate();
  for (const [pairs, grantedBy] of [
    [baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, "canonical-catalog:l5"],
    [baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS, "nonprod-activation:l5"],
  ]) {
    for (const { roleKey, capabilityKey } of pairs) {
      await pool.query(
        `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
         SELECT 'rc_l5_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, $4, $4, $4
           FROM eos_policy.roles r, eos_policy.capabilities c
          WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
         ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`,
        [tenantId, roleKey, capabilityKey, grantedBy]);
    }
  }
  return { url, pool, repo };
}

/** Assign existing (seeded) Roles, by KEY, to a Principal through the product repository. Returns the missing keys. */
export async function assignRoleKeys(ctx, tenantId, principalId, roleKeys) {
  const { repo, pool } = ctx;
  const missing = [];
  for (const roleKey of roleKeys) {
    const role = (await pool.query(`SELECT id FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [tenantId, roleKey])).rows[0];
    if (!role) { missing.push(roleKey); continue; }
    await repo.transact({ tenantId, uid: "uid-l5-fixture-admin" }, async (tx) => {
      const accessVersion = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({
        principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "l5-fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
      });
    });
  }
  return missing;
}
