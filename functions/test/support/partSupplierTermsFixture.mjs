// SUP-1 test fixture: a disposable, fully migrated database with two tenants, the people each suite needs (holding ONLY
// registered capabilities, granted the way Administration grants them: Role -> capability, global assignment), Parts in
// eos_ops.parts and Suppliers in eos_ops.suppliers. Shared by partSupplierTermsPostgres.test.mjs and
// partSupplierTermsEmployeeContractPostgres.test.mjs. Callers go through the REAL /operations/inventory transport.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const http = require("../../lib/eosOps/eosOpsHttp.js");
const { PostgresPolicyRepository } = require("../../lib/adminPolicy/postgresPolicyRepository.js");

export const INVENTORY_ROUTE = "/operations/inventory";

/** `t` is the node:test context (its `after` drops the database). */
export async function partSupplierTermsDatabase(t, { urlBase, prefix, tenants = ["t1", "t2"] }) {
  const name = `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(urlBase); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: urlBase });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await pool.end();
    const c = new pg.Client({ connectionString: urlBase });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);
  for (const tenant of tenants) await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1,$1,$1)`, [tenant]);
  const TOKENS = new Map();
  const deps = {
    reader: repo, pool, allowedOrigins: [],
    verifyToken: async (token) => { const s = TOKENS.get(token); if (!s) throw new Error("bad"); return { externalSubject: s, identityProvider: "firebase" }; },
  };
  const fixture = (tenantId) => ({ tenantId, uid: "uid-fixture-admin" });

  /** A signed-in person: a principal, (optionally) a tenant membership, and a Role holding exactly `keys`. */
  const makeActor = async (tenantId, subject, keys, { member = true } = {}) => {
    const principalId = await repo.transact(fixture(tenantId), async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      if (member) await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (keys.length) {
      const role = await repo.transact(fixture(tenantId), (tx) => tx.createRole({ key: `role-${subject}`, name: subject, description: null, origin: "CUSTOM", protected: false }));
      for (const key of keys) {
        const r = await q(`INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
                           SELECT $1, $2, $3, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
          [`rc_${role.id}_${key}`, tenantId, role.id, key]);
        assert.equal(r.rowCount, 1, `${key} is a REGISTERED capability -- the fixture grants only what exists`);
      }
      await repo.transact(fixture(tenantId), async (tx) => {
        const v = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: v });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { subject, principalId, token: `tok-${subject}` };
  };

  const part = (tenantId, id, stockingUnit = "EACH") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
       expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1,$2,'fixture',$1,$1,'ACTIVE',$3,'STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [id, tenantId, stockingUnit]);
  const supplier = (tenantId, id, name, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.suppliers (tenant_id, supplier_id, name, normalized_key, status, version, created_by, updated_by)
     VALUES ($1,$2,$3,lower($3),$4,1,'fixture','fixture')`, [tenantId, id, name, status]);

  /** One request through the real transport; the answer as the browser receives it. */
  const call = async (actor, operation, input) => {
    const res = await http.handleOperationsRequest(deps, {
      method: "POST", url: INVENTORY_ROUTE, headers: actor ? { authorization: `Bearer ${actor.token}` } : {},
      body: JSON.stringify(input === undefined ? { operation } : { operation, input }),
    });
    return { request: input === undefined ? { operation } : { operation, input }, status: res.status, body: JSON.parse(res.body) };
  };
  return { pool, q, repo, makeActor, part, supplier, call };
}
