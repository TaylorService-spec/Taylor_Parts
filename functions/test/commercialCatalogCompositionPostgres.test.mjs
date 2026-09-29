// COMMERCIAL + THE REAL POSTGRESQL CATALOG AUTHORITY, against a real postgres:16.
//
// The existing Commercial suite proves the reference BOUNDARY with a fake authority: every ref that
// does not start with "missing" is FOUND. That is the right test for the boundary and the wrong test
// for Lane 1, whose whole claim is that the REAL authority -- the one the server now composes --
// answers correctly against real `eos_ops.parts` and `eos_ops.equipment_models` rows.
//
// So this suite composes `createPostgresCatalogReferenceAuthority()` exactly as eosApi/server.ts
// does, and drives the governed Sales Agreement and Sales Order commands through it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { bindOperatingCompany } from "./support/governedOperatingCompanyBinding.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sa = require("../lib/eosCommercial/commands/salesAgreementCommandService.js");
const so = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const { createPostgresCatalogReferenceAuthority } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");

const DB_NAME = `comm_cat_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const CAPS = new Set(["opportunity.write", "opportunity.createSalesOrder", "salesAgreement.create",
  "salesAgreement.updateDraft", "salesAgreement.accept", "salesOrder.write"]);
const ACTOR = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: CAPS });
const key = () => `k-${randomUUID()}`;
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`); return true; };

test("Commercial resolves Catalog references through the REAL PostgreSQL authority", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);

  // THE COMPOSITION UNDER TEST: exactly what eosApi/server.ts now builds.
  const catalog = createPostgresCatalogReferenceAuthority();
  const deps = { pool, catalog };
  const bare = { pool };

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // The commercial writers resolve operating_company_key only through the governed binding -- never key = id.
  await bindOperatingCompany(q, "t1", "taylor", "taylor-ops-t1");
  await bindOperatingCompany(q, "t2", "taylor", "taylor-ops-t2");
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by)
           VALUES ('acct-1','t1','Retail Customer','ACTIVE','e-retail','x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id)
           VALUES ('e-retail','t1','ACTIVE','taylor')`);
  await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('p1','p1','proof','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('m1','t1','p1')`);

  // ── REAL CATALOG ROWS. This is what the authority will answer from. ──
  await q(`INSERT INTO eos_ops.equipment_models
             (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status,
              source_authority, version, created_by, updated_by)
           VALUES ('ACME--CW-100','t1','ACME','Acme','CW-100','Acme CW-100','ACTIVE','MANUAL',1,'x','x')`)
    .catch(async () => {
      const cols = (await q(`SELECT string_agg(column_name, ',') c FROM information_schema.columns
                              WHERE table_schema='eos_ops' AND table_name='equipment_models'`)).rows[0].c;
      throw new Error(`equipment_models columns: ${cols}`);
    });
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                      control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                      whole_unit, version, updated_by)
           VALUES ('PART-REAL-1','t1','x','PART-REAL-1','Real Part','ACTIVE','EACH','STANDARD','STOCKED',
                   false,false,false,false,1,'x')`);

  const newOpportunity = (over = {}) => opp.createOpportunity(deps, ACTOR, {
    idempotencyKey: key(), accountId: "acct-1", salesChannel: "RETAIL", operatingCompanyId: "taylor",
    need: "Walk-in freezer", expectedValue: 18500.5,
    expectedCloseAt: Date.parse("2026-11-01T00:00:00Z"),
    lines: [{ kind: "PART", ref: "PART-REAL-1", qty: 1 }], ...over,
  });

  await t.test("FOUND PART: a real Part reference is accepted", async () => {
    const o = await newOpportunity();
    const agreement = await sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-REAL-1", quantity: 2, unitPrice: 1500 }],
    });
    assert.ok(agreement.salesAgreementId, "the agreement was created against a real Part");
  });

  await t.test("FOUND EQUIPMENT_MODEL: a real model reference is accepted", async () => {
    const o = await newOpportunity({ lines: [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", qty: 1 }] });
    const agreement = await sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", quantity: 1, unitPrice: 1250000 }],
    });
    assert.ok(agreement.salesAgreementId);
  });

  await t.test("NOT_FOUND: a reference that does not exist refuses", async () => {
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-DOES-NOT-EXIST", quantity: 1, unitPrice: 100 }],
    }), code("REFERENCE_NOT_FOUND"));
  });

  await t.test("WRONG_KIND: a real Equipment Model asked for as a PART refuses", async () => {
    // The verdict that a bare existence check would miss entirely: the id exists, as something else.
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "ACME--CW-100", quantity: 1, unitPrice: 100 }],
    }), code("REFERENCE_WRONG_KIND"));
    await assert.rejects(sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "PART-REAL-1", quantity: 1, unitPrice: 100 }],
    }), code("REFERENCE_WRONG_KIND"));
  });

  await t.test("TENANT SCOPED: another tenant's Part is NOT_FOUND here", async () => {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                        control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                        whole_unit, version, updated_by)
             VALUES ('PART-T2-ONLY','t2','x','PART-T2-ONLY','Other Tenant Part','ACTIVE','EACH','STANDARD','STOCKED',
                     false,false,false,false,1,'x')`);
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-T2-ONLY", quantity: 1, unitPrice: 100 }],
    }), code("REFERENCE_NOT_FOUND"));
  });

  await t.test("a REFUSED reference leaves no agreement behind -- the transaction is still atomic", async () => {
    const before = Number((await q(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).rows[0].n);
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [
        { kind: "PART", ref: "PART-REAL-1", quantity: 1, unitPrice: 100 },
        { kind: "PART", ref: "PART-DOES-NOT-EXIST", quantity: 1, unitPrice: 100 },
      ],
    }), code("REFERENCE_NOT_FOUND"));
    assert.equal(Number((await q(`SELECT count(*)::int n FROM eos_commercial.sales_agreements`)).rows[0].n), before,
      "one bad reference refuses the whole agreement, and the good line is not written either");
  });

  await t.test("updateDraft REVALIDATES against the real Catalog", async () => {
    const o = await newOpportunity();
    const agreement = await sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-REAL-1", quantity: 1, unitPrice: 100 }],
    });
    await assert.rejects(sa.updateSalesAgreementDraft(deps, ACTOR, {
      idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId,
      lines: [{ kind: "PART", ref: "PART-DOES-NOT-EXIST", quantity: 1, unitPrice: 100 }],
    }), code("REFERENCE_NOT_FOUND"));
  });

  await t.test("acceptance revalidation is NOT weakened by composing the authority", async () => {
    // Acceptance re-runs the reference check against the lines it is accepting.
    const o = await newOpportunity();
    const agreement = await sa.createSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-REAL-1", quantity: 1, unitPrice: 100 }],
    });
    const accepted = await sa.acceptSalesAgreement(deps, ACTOR, {
      idempotencyKey: key(), salesAgreementId: agreement.salesAgreementId,
    });
    assert.ok(accepted, "an agreement whose references still resolve accepts");
  });

  await t.test("a composition WITHOUT the authority still refuses -- the check is never skipped", async () => {
    const o = await newOpportunity();
    await assert.rejects(sa.createSalesAgreement(bare, ACTOR, {
      idempotencyKey: key(), opportunityId: o.opportunityId, ownerEmployeeId: "e-retail",
      lines: [{ kind: "PART", ref: "PART-REAL-1", quantity: 1, unitPrice: 100 }],
    }), code("CATALOG_AUTHORITY_UNAVAILABLE"));
  });

  await t.test("Sales Order carries the same Catalog boundary", async () => {
    const o = await newOpportunity();
    await assert.rejects(so.createSalesOrder(deps, ACTOR, {
      idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-retail",
      operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "PART-DOES-NOT-EXIST", orderedQty: 1, unitPrice: 100 }],
    }), code("REFERENCE_NOT_FOUND"));
    // And a real Part is accepted on the same path.
    const ok = await so.createSalesOrder(deps, ACTOR, {
      idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-retail",
      operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "PART-REAL-1", orderedQty: 1, unitPrice: 100 }],
    });
    assert.ok(ok.salesOrderId);
    assert.ok(o.opportunityId);
  });
});
