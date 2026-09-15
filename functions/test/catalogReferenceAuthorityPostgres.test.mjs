// LANE D against a real postgres:16 -- the PostgreSQL catalog reference authority behind the Commercial
// `CommercialCatalogAuthority` port.
//
// Its OWN database, migrated by the normal runner, dropped in one t.after hook. Catalog identities are inserted
// directly: no catalog writer exists (migration 026's header). The integration proof hands the authority to the
// real C2 command services as `deps.catalog`, unmodified.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createPostgresCatalogReferenceAuthority, CatalogReferenceAuthorityError } = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
const opp = require("../lib/eosCommercial/commands/opportunityCommandService.js");
const so = require("../lib/eosCommercial/commands/salesOrderCommandService.js");

const MIGRATION = "1759795200000_catalog-part-identity-reference-authority";
const DB_NAME = `catalog_ref_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const dbUrl = () => {
  const u = new URL(URL_BASE);
  u.pathname = `/${DB_NAME}`;
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

const P = (ref) => ({ kind: "PART", ref });
const M = (ref) => ({ kind: "EQUIPMENT_MODEL", ref });
const WRITE_CAPS = new Set(["opportunity.write", "salesOrder.write"]);
const ACTOR_T1 = Object.freeze({ tenantId: "t1", principalId: "p1", capabilities: WRITE_CAPS });
const ACTOR_T2 = Object.freeze({ tenantId: "t2", principalId: "p-t2", capabilities: WRITE_CAPS });
const key = () => `k-${randomUUID()}`;
const code = (c) => (e) => { assert.equal(e.code, c, `expected ${c}, got ${e.code}: ${e.message}`); return true; };

test("PostgreSQL catalog reference authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 12 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  const authority = createPostgresCatalogReferenceAuthority();

  // ── the world ──
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  // Migration 027 (catalog cutover) gives every Part identity its Part Master descriptive record, NOT NULL. These proofs
  // are about identity, so each row carries one fixed, valid descriptive record and nothing below depends on it.
  const PART_ROW = `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type,
      stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
    VALUES ($1, $2, $3, 'PROOF-IPN', 'proof part', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'proof')`;
  const part = (tenant, id) => q(PART_ROW, [id, tenant, "proof"]);
  const model = (tenant, id, status = "ACTIVE") => {
    const [manufacturer, number] = id.split("--");
    return q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
      VALUES ($1,$2,$3,$3,$4,$4,$5,'proof',1,'proof','proof')`, [id, tenant, manufacturer, number, status]);
  };
  await part("t1", "TST-1001");
  await part("t1", "TST-1002");
  await part("t2", "TST-9001");
  await model("t1", "ACME--CW-100");
  await model("t1", "ACME--CW-DRAFT", "DRAFT");
  await model("t1", "ACME--CW-OLD", "INACTIVE");
  await model("t1", "ACME--CW-GONE", "RETIRED");
  await model("t2", "ACME--T2-ONLY");

  await t.test("migration 026 is applied, by name", async () => {
    const { rows } = await q(`SELECT 1 FROM pgmigrations WHERE name = $1`, [MIGRATION]);
    assert.equal(rows.length, 1);
  });

  await t.test("a PART that exists in the tenant is FOUND", async () => {
    assert.deepEqual(await authority.verifyReferences(pool, "t1", [P("TST-1001")]), ["FOUND"]);
  });

  await t.test("an EQUIPMENT_MODEL that exists in the tenant is FOUND", async () => {
    assert.deepEqual(await authority.verifyReferences(pool, "t1", [M("ACME--CW-100")]), ["FOUND"]);
  });

  await t.test("an unknown reference is NOT_FOUND for either kind", async () => {
    assert.deepEqual(await authority.verifyReferences(pool, "t1", [P("TST-0000"), M("ACME--NOPE")]), ["NOT_FOUND", "NOT_FOUND"]);
  });

  await t.test("a real identity of the other kind is WRONG_KIND, both directions", async () => {
    assert.deepEqual(await authority.verifyReferences(pool, "t1", [M("TST-1001"), P("ACME--CW-100")]), ["WRONG_KIND", "WRONG_KIND"]);
  });

  await t.test("tenant isolation: another tenant's PART and EQUIPMENT_MODEL are NOT_FOUND, never FOUND or WRONG_KIND", async () => {
    assert.deepEqual(
      await authority.verifyReferences(pool, "t1", [P("TST-9001"), M("ACME--T2-ONLY"), M("TST-9001"), P("ACME--T2-ONLY")]),
      ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"],
    );
    assert.deepEqual(
      await authority.verifyReferences(pool, "t2", [P("TST-1001"), M("ACME--CW-100"), M("TST-1001"), P("ACME--CW-100")]),
      ["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"],
    );
    assert.deepEqual(await authority.verifyReferences(pool, "t2", [P("TST-9001"), M("ACME--T2-ONLY")]), ["FOUND", "FOUND"]);
    assert.deepEqual(await authority.verifyReferences(pool, "no-such-tenant", [P("TST-1001")]), ["NOT_FOUND"]);
  });

  await t.test("lifecycle status does not change the verdict: DRAFT, INACTIVE and RETIRED models are FOUND (existence and kind only)", async () => {
    assert.deepEqual(
      await authority.verifyReferences(pool, "t1", [M("ACME--CW-DRAFT"), M("ACME--CW-OLD"), M("ACME--CW-GONE"), P("ACME--CW-GONE")]),
      ["FOUND", "FOUND", "FOUND", "WRONG_KIND"],
    );
  });

  await t.test("exact key only: no trim, case-fold, prefix or wildcard match", async () => {
    assert.deepEqual(
      await authority.verifyReferences(pool, "t1", [P("tst-1001"), P(" TST-1001"), P("TST-1001 "), P("TST-100"), P("TST-100_"), P("%"), M("acme--cw-100"), M("ACME--CW")]),
      Array(8).fill("NOT_FOUND"),
    );
  });

  await t.test("exact port cardinality and order: one verdict per reference, duplicates included", async () => {
    const refs = [M("TST-1002"), P("TST-1001"), P("nope"), M("ACME--CW-100"), P("TST-1001"), P("ACME--CW-100"), M("ACME--CW-100")];
    const verdicts = await authority.verifyReferences(pool, "t1", refs);
    assert.deepEqual(verdicts, ["WRONG_KIND", "FOUND", "NOT_FOUND", "FOUND", "FOUND", "WRONG_KIND", "FOUND"]);
    const many = Array.from({ length: 250 }, (_, i) => (i % 3 === 0 ? P("TST-1001") : i % 3 === 1 ? M("ACME--CW-100") : P(`x-${i}`)));
    const answer = await authority.verifyReferences(pool, "t1", many);
    assert.equal(answer.length, 250);
    answer.forEach((v, i) => assert.equal(v, i % 3 === 2 ? "NOT_FOUND" : "FOUND", `position ${i}`));
  });

  await t.test("one fixed parameterized read per call, against the two identity tables only; empty input issues none", async () => {
    const statements = [];
    const spy = { query: (text, values) => { statements.push({ text: String(text), values }); return pool.query(text, values); } };
    assert.deepEqual(await authority.verifyReferences(spy, "t1", []), []);
    assert.equal(statements.length, 0);
    await authority.verifyReferences(spy, "t1", [P("TST-1001'; DROP TABLE eos_ops.parts; --"), M("ACME--CW-100")]);
    assert.equal(statements.length, 1);
    const [{ text, values }] = statements;
    assert.match(text, /^\s*SELECT\b/);
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|MERGE|LIKE|ILIKE|lower|upper|btrim|trim)\b/i);
    const tables = [...text.matchAll(/\bFROM\s+([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]).sort();
    assert.deepEqual(tables, ["eos_ops.equipment_models", "eos_ops.parts"]);
    assert.doesNotMatch(text, /TST-1001|ACME|t1/, "values travel as parameters, never as SQL text");
    assert.deepEqual(values, ["t1", ["TST-1001'; DROP TABLE eos_ops.parts; --", "ACME--CW-100"]]);
    assert.equal((await q(`SELECT count(*)::int AS n FROM eos_ops.parts`)).rows[0].n, 3);
  });

  await t.test("malformed input is refused before any read; a mismatched answer is refused, never read as FOUND", async () => {
    const statements = [];
    const spy = { query: (text, values) => { statements.push(text); return pool.query(text, values); } };
    const refused = (c) => (e) => e instanceof CatalogReferenceAuthorityError && e.code === c;
    await assert.rejects(authority.verifyReferences(spy, "", [P("TST-1001")]), refused("INVALID_TENANT"));
    await assert.rejects(authority.verifyReferences(spy, undefined, [P("TST-1001")]), refused("INVALID_TENANT"));
    await assert.rejects(authority.verifyReferences(spy, "t1", [{ kind: "SERVICE", ref: "svc" }]), refused("INVALID_REFERENCE"));
    await assert.rejects(authority.verifyReferences(spy, "t1", [{ kind: "PART", ref: 42 }]), refused("INVALID_REFERENCE"));
    await assert.rejects(authority.verifyReferences(spy, "t1", [P("")]), refused("INVALID_REFERENCE"));
    await assert.rejects(authority.verifyReferences(spy, "t1", "TST-1001"), refused("INVALID_REFERENCE"));
    assert.equal(statements.length, 0);
    const short = { query: async () => ({ rows: [] }) };
    await assert.rejects(authority.verifyReferences(short, "t1", [P("TST-1001")]), refused("AUTHORITY_ANSWER_MISMATCH"));
    const shuffled = { query: async () => ({ rows: [{ ordinal: 2, is_part: true, is_equipment_model: false }, { ordinal: 1, is_part: true, is_equipment_model: false }] }) };
    await assert.rejects(authority.verifyReferences(shuffled, "t1", [P("a"), P("b")]), refused("AUTHORITY_ANSWER_MISMATCH"));
  });

  await t.test("no generic surface: the authority is one frozen object with exactly one method", () => {
    assert.deepEqual(Object.keys(authority), ["verifyReferences"]);
    assert.ok(Object.isFrozen(authority));
    const mod = require("../lib/catalogAuthority/postgresCatalogReferenceAuthority.js");
    assert.deepEqual(Object.keys(mod).sort(), ["CatalogReferenceAuthorityError", "createPostgresCatalogReferenceAuthority"]);
  });

  await t.test("verdicts belong to the caller's transaction snapshot", async () => {
    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      await tx.query(PART_ROW, ["TST-TX", "t1", "proof"]);
      assert.deepEqual(await authority.verifyReferences(tx, "t1", [P("TST-TX")]), ["FOUND"]);
      assert.deepEqual(await authority.verifyReferences(pool, "t1", [P("TST-TX")]), ["NOT_FOUND"], "an uncommitted identity is not visible outside its transaction");
      await tx.query("ROLLBACK");
    } finally {
      tx.release();
    }
    assert.deepEqual(await authority.verifyReferences(pool, "t1", [P("TST-TX")]), ["NOT_FOUND"]);
  });

  await t.test("duplicate identity is prohibited within a tenant and kind; the same id may exist in another tenant", async () => {
    await assert.rejects(part("t1", "TST-1001"), (e) => e.code === "23505" && e.constraint === "parts_pkey");
    await assert.rejects(model("t1", "ACME--CW-100"), (e) => e.code === "23505" && e.constraint === "equipment_models_pkey");
    await part("t2", "TST-1001");
    assert.deepEqual(await authority.verifyReferences(pool, "t2", [P("TST-1001")]), ["FOUND"]);
    await q(`DELETE FROM eos_ops.parts WHERE tenant_id = 't2' AND id = 'TST-1001'`);
  });

  await t.test("a Part identity is the canonical partId verbatim: non-canonical ids, blank actors and unknown tenants are refused", async () => {
    for (const bad of ["", " TST-1", "TST 1", "TST/1", "a".repeat(65), "tst.1"]) {
      await assert.rejects(part("t1", bad), (e) => e.code === "23514" && e.constraint === "part_id_canonical_shape", JSON.stringify(bad));
    }
    await assert.rejects(q(PART_ROW, ["TST-X", "t1", ""]), (e) => e.constraint === "part_created_by_present");
    await assert.rejects(part("no-such-tenant", "TST-X"), (e) => e.code === "23503");
  });

  await t.test("concurrent creation of one identity is deterministic: exactly one row, every other attempt a duplicate", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => part("t1", "TST-RACE")));
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
    for (const a of attempts.filter((x) => x.status === "rejected")) assert.equal(a.reason.constraint, "parts_pkey");
    assert.equal((await q(`SELECT count(*)::int AS n FROM eos_ops.parts WHERE tenant_id='t1' AND id='TST-RACE'`)).rows[0].n, 1);
    const verdicts = await Promise.all(Array.from({ length: 10 }, () => authority.verifyReferences(pool, "t1", [P("TST-RACE"), M("TST-RACE")])));
    for (const v of verdicts) assert.deepEqual(v, ["FOUND", "WRONG_KIND"]);
  });

  // ════════════════════ the C2 command layer, with this authority as deps.catalog ════════════════════
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, owner_employee_id, created_by, updated_by) VALUES
    ('acct-1','t1','Customer','ACTIVE','e-1','x','x'), ('acct-t2','t2','Customer','ACTIVE','e-t2','x','x')`);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES
    ('e-1','t1','ACTIVE','taylor'), ('e-t2','t2','ACTIVE','taylor')`);
  for (const [p, tenant] of [["p1", "t1"], ["p-t2", "t2"]]) {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof','active')`, [p]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${p}`, tenant, p]);
  }
  const deps = { pool, catalog: authority };
  const newOpportunity = (actor, accountId, lines) => opp.createOpportunity(deps, actor, {
    idempotencyKey: key(), accountId, salesChannel: "RETAIL", operatingCompanyId: "taylor", need: "Walk-in freezer", lines,
  });
  const counts = async () => (await q(`SELECT (SELECT count(*) FROM eos_commercial.opportunities)::int AS o, (SELECT count(*) FROM eos_commercial.sales_orders)::int AS s`)).rows[0];

  await t.test("C2: an Opportunity and a Sales Order with a real PART and EQUIPMENT_MODEL line are accepted", async () => {
    const created = await newOpportunity(ACTOR_T1, "acct-1", [M("ACME--CW-100"), { ...P("TST-1001"), qty: 2 }, { kind: "SERVICE", ref: "svc-install", qty: 1 }].map((l) => ({ qty: 1, ...l })));
    assert.equal(created.replayed, false);
    const { rows } = await q(`SELECT kind::text, ref FROM eos_commercial.opportunity_lines WHERE opportunity_id = $1 ORDER BY line_number`, [created.opportunityId]);
    assert.deepEqual(rows, [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100" }, { kind: "PART", ref: "TST-1001" }, { kind: "SERVICE", ref: "svc-install" }]);
    const order = await so.createSalesOrder(deps, ACTOR_T1, {
      idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "TST-1002", orderedQty: 3, unitPrice: 2500 }, { kind: "EQUIPMENT_MODEL", ref: "ACME--CW-GONE", orderedQty: 1, unitPrice: 900000 }],
    });
    assert.equal(order.replayed, false);
  });

  await t.test("C2: an unknown reference is REFERENCE_NOT_FOUND, a wrong-kind one REFERENCE_WRONG_KIND, another tenant's NOT_FOUND -- zero mutation", async () => {
    const before = await counts();
    await assert.rejects(newOpportunity(ACTOR_T1, "acct-1", [{ ...P("TST-0000"), qty: 1 }]), code("REFERENCE_NOT_FOUND"));
    await assert.rejects(newOpportunity(ACTOR_T1, "acct-1", [{ ...M("TST-1001"), qty: 1 }]), code("REFERENCE_WRONG_KIND"));
    await assert.rejects(newOpportunity(ACTOR_T2, "acct-t2", [{ ...P("TST-1001"), qty: 1 }]), code("REFERENCE_NOT_FOUND"));
    await assert.rejects(so.createSalesOrder(deps, ACTOR_T1, {
      idempotencyKey: key(), accountId: "acct-1", ownerEmployeeId: "e-1", operatingCompanyId: "taylor", salesChannel: "RETAIL",
      lines: [{ kind: "PART", ref: "TST-1001", orderedQty: 1, unitPrice: 1 }, { kind: "EQUIPMENT_MODEL", ref: "ACME--T2-ONLY", orderedQty: 1, unitPrice: 1 }],
    }), code("REFERENCE_NOT_FOUND"));
    assert.deepEqual(await counts(), before);
    const t2 = await newOpportunity(ACTOR_T2, "acct-t2", [{ ...P("TST-9001"), qty: 1 }, { ...M("ACME--T2-ONLY"), qty: 1 }]);
    assert.equal(t2.replayed, false);
  });
});
