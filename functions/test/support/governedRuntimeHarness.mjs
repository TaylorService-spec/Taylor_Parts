// Shared world for the governed runtime authority PostgreSQL proofs (Pass 11 Fix Wave 1): a disposable policy database
// rebuilt by the product's own authority pipeline, every persona of the manifest with its Principal / Employee / link /
// Security Roles, and an in-memory Firestore holding records PLUS legacy role records that would make every caller a
// compatibility admin -- which the governed environment must ignore.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
export const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { PostgresPolicyRepository } = require("../../lib/adminPolicy/postgresPolicyRepository.js");
const { seedTenantPolicy } = require("../../lib/adminPolicy/seed/policySeed.js");
const { executeAdminOperation } = require("../../lib/adminPolicy/adminPolicyApi.js");
const baseline = require("../../lib/adminPolicy/roleCapabilityAuthorityBaseline.js");
const { postgresGovernedAccessResolver } = require("../../lib/access/governedRuntimeAuthority.js");
const { __resetRuntimeCapabilityOverridesCacheForTest } = require("../../lib/access/environmentCapabilityOverrides.js");

const MANIFEST = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"));
const PERSONAS = MANIFEST.personas;
const TENANT = "t-governed-runtime";
const COMPANY = "sample-co-synthetic";
const empOf = (k) => `emp-${k}`;
const prnOf = (k) => `prn-${k}`;
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const migrate = (url, count) => execFileSync(process.execPath, [
  "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order",
  ...(count === undefined ? [] : [String(count)]),
], { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

// ─────────────── a minimal in-memory Firestore (records + the legacy role records the governed path must ignore) ───────────────
export function fakeFirestore(collections) {
  const snapOf = (name, id, data) => ({
    id, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }),
    get: (f) => (data === undefined ? undefined : data[f]), ref: { path: `${name}/${id}` },
  });
  const OPS = {
    "==": (a, b) => a === b, "!=": (a, b) => a !== b, in: (a, b) => b.includes(a),
    ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b,
    "array-contains": (a, b) => Array.isArray(a) && a.includes(b),
  };
  function query(name, state) {
    const rows = () => {
      let out = Object.entries(collections[name] ?? {}).map(([id, d]) => ({ id, d }));
      for (const [f, op, v] of state.where) out = out.filter((r) => OPS[op](r.d[f], v));
      for (const [f, dir] of [...state.order].reverse()) {
        out.sort((x, y) => {
          const a = f === "__name__" ? x.id : x.d[f]; const b = f === "__name__" ? y.id : y.d[f];
          return (a < b ? -1 : a > b ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      }
      if (state.after) { const i = out.findIndex((r) => r.id === state.after.id); out = out.slice(i + 1); }
      if (state.limit !== null) out = out.slice(0, state.limit);
      return out;
    };
    return {
      where: (f, op, v) => query(name, { ...state, where: [...state.where, [f, op, v]] }),
      orderBy: (f, dir = "asc") => query(name, { ...state, order: [...state.order, [f, dir]] }),
      startAfter: (snap) => query(name, { ...state, after: snap }),
      limit: (n) => query(name, { ...state, limit: n }),
      get: async () => ({ docs: rows().map((r) => snapOf(name, r.id, r.d)) }),
      doc: (id) => ({ get: async () => snapOf(name, id, collections[name]?.[id]) }),
    };
  }
  return { collection: (name) => query(name, { where: [], order: [], after: null, limit: null }) };
}

export const subjectOf = (k) => `uid-${k}`;

/** Build the world inside test `t` (teardown registered on it). */
export async function buildGovernedWorld(t) {
  const name = `govrt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  const savedProject = process.env.GCLOUD_PROJECT;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
    if (savedProject === undefined) delete process.env.GCLOUD_PROJECT; else process.env.GCLOUD_PROJECT = savedProject;
    __resetRuntimeCapabilityOverridesCacheForTest();
  });
  const url = dbUrlFor(name);

  // ── the authority baseline's own rebuild ──
  const files = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  migrate(url, files.filter((f) => f < baseline.SEED_BOUNDARY_MIGRATION).length);
  pool = new pg.Pool({ connectionString: url, max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await seedTenantPolicy(repo, TENANT, "governed-runtime-fixture");
  migrate(url);
  for (const { roleKey, capabilityKey } of [...baseline.GLOBAL_CATALOG_ACTIVATED_GRANTS, ...baseline.NONPROD_ACTIVATED_CAPABILITY_GRANTS]) {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc_x_' || substr(md5($1 || r.id || c.id), 1, 24), $1, r.id, c.id, 'fixture', 'fixture', 'fixture'
               FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id = $1 AND r.key = $2 AND c.key = $3
             ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING`, [TENANT, roleKey, capabilityKey]);
  }
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [TENANT, COMPANY]);

  // ── every persona: Principal, membership, Employee + link, its Security Roles ──
  const roleId = async (key) => {
    const existing = await repo.getRoleByKey(TENANT, key);
    if (existing) return existing.id;
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
             VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, TENANT, key]);
    return `role-${key}`;
  };
  const assign = async (principalId, roleKey) => {
    const rid = await roleId(roleKey);
    await repo.transact({ tenantId: TENANT, uid: "fixture" }, async (tx) => {
      const version = await tx.bumpAccessVersion(principalId);
      return tx.createAssignment({ principalId, roleId: rid, scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: version });
    });
  };
  for (const [key, persona] of Object.entries(PERSONAS)) {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'firebase','active')`, [prnOf(key), subjectOf(key)]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${key}`.slice(0, 60), TENANT, prnOf(key)]);
    if (persona.employee) {
      await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
               VALUES ($1,$2,'ACTIVE',$3,$4)`, [empOf(key), TENANT, COMPANY, `E-${key}`.slice(0, 32)]);
      await q(`INSERT INTO eos_policy.employee_principal_links
                 (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
               VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','persona manifest')`,
      [`lnk-${key}`.slice(0, 60), TENANT, prnOf(key), empOf(key), COMPANY]);
    }
    for (const roleKey of persona.securityRoles ?? []) await assign(prnOf(key), roleKey);
  }
  const admin = (operation, input) => executeAdminOperation({ repo }, { caller: { externalSubject: subjectOf("administrator") }, operation, input });

  // ── the Firestore stand-in: records, plus legacy role records that would make EVERY caller an admin ──
  const legacyAdminEverywhere = Object.fromEntries(Object.keys(PERSONAS).map((k) => [
    `ra-${k}`, { principalUid: subjectOf(k), roleId: "admin", status: "active", scope: { type: "global" } }]));
  const store = {
    users: Object.fromEntries(Object.keys(PERSONAS).map((k) => [subjectOf(k), { role: "admin" }])),
    roleAssignments: legacyAdminEverywhere,
    fieldops_technicians: {
      "tech-A": { name: "Tech A", employeeId: empOf("service-technician-a") },
      "tech-B": { name: "Tech B", employeeId: empOf("service-technician-b") },
      "tech-unlinked": { name: "Legacy profile with no Employee" },
    },
    fieldops_wos: {
      "wo-1": { number: "WO-1", status: "scheduled", assignedTechId: "tech-A" },
      "wo-2": { number: "WO-2", status: "scheduled", assignedTechId: "tech-B" },
      "wo-3": { number: "WO-3", status: "open", assignedTechId: null },
      "wo-4": { number: "WO-4", status: "scheduled", assignedTechId: "tech-unlinked" },
      "wo-5": { number: "WO-5", status: "dispatched", assignedTechId: "tech-A" },
    },
    accounts: { "acct-1": { name: "Harbor Grill" }, "acct-2": { name: "Summit" } },
    warehouses: { "SC-WH-MAIN": { name: "Main" } },
    transfer_orders: { "to-1": { fromWarehouseId: "SC-WH-MAIN", toWarehouseId: "SC-WH-SERVICE" } },
    reorder_purchase_orders: { "po-1": { status: "ORDERED" } },
    parts: { "p-1": { partNumber: "P-1" } },
    inventory_transactions: { "tx-1": { partId: "p-1", qty: 1 } },
  };
  const db = fakeFirestore(store);
  const governed = postgresGovernedAccessResolver(pool);
  return { pool, repo, db, store, governed, admin, subjectOf, prnOf, empOf, PERSONAS };
}
