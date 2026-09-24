// CONDITIONAL ENTITLEMENT — "Role A holds capability X unconditionally, Role B holds the SAME
// capability only when predicate P holds."
//
// The previous lane proved, by executed test, three structural reasons this sentence could not be
// said: no condition column on either grant table, a resolver that discards the granting Role, and
// an action-level predicate that constrains every holder. This file proves the sentence CAN now be
// said, against a real PostgreSQL, using the grant rows migration 1761696000000 actually writes —
// and that saying it changes nothing for the eleven Roles that hold Purchase Order read
// unconditioned or the five that hold create.
//
// NOTHING IS ACTIVATED. `SHIPPED_GRANT_CONDITIONS` stays empty, the two Purchase Order cells stay
// in `WITHHELD_CONDITIONED_CELLS`, `ACTION_CONTEXT_POLICIES` stays empty, and the production entry
// point refuses a catalog naming either cell. The technician condition below is modelled inside a
// throwaway database and a test-local catalog; no nonprod or production row is written anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const model = require("../lib/eosOps/conditionalEntitlement.js");
const composition = require("../lib/eosOps/entitledActionAuthority.js");
const seam = require("../lib/eosOps/contextualActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");

const ROLE = (roleKey) => ({ kind: "ROLE", roleKey });
const PRINCIPAL = (principalId) => ({ kind: "PRINCIPAL", principalId });
const ELIGIBILITY = (qualificationCode) => ({ kind: "WORK_ELIGIBILITY", qualificationCode });
const ASSIGNED = { kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" };
const SCOPE = (scopeType, scopeId) => ({ kind: "OPERATIONAL_SCOPE", scopeType, scopeId });

const PO_READ = "reorder.purchaseOrder.read";
const PO_CREATE = "reorder.purchaseOrder.create";
const REQUEST_READ = "reorder.request.read";

// The grant list, parsed out of the migration that wrote it rather than copied.
const GRANT_SQL = readFileSync(
  resolve(FUNCTIONS_DIR, "migrations/1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8");
const MIGRATION_GRANTS = [...GRANT_SQL.matchAll(/\('([A-Za-z]+)',\s*'(reorder\.[A-Za-z.]+)'\)/g)]
  .map((m) => ({ roleKey: m[1], capabilityKey: m[2] }));
const holdersOf = (capabilityKey) =>
  MIGRATION_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey).sort();

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE PURE MODEL. No database: these are the rules the composition must not be able to bend.
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("the conditional entitlement MODEL, pure", async (t) => {
  await t.test("the shipped catalog is EMPTY: composing the model activates nothing", () => {
    assert.equal(model.SHIPPED_GRANT_CONDITIONS.size, 0);
    assert.doesNotThrow(() => model.assertNoWithheldGrantConditions(model.SHIPPED_GRANT_CONDITIONS));
    assert.equal(seam.ACTION_CONTEXT_POLICIES.size, 0, "the action registry must stay empty too");
    assert.deepEqual([...seam.WITHHELD_CONDITIONED_CELLS], [PO_READ, PO_CREATE]);
  });

  await t.test("a WITHHELD cell can be MODELLED but never ACTIVATED on the production path", () => {
    // Expressing the technician cell is this lane's deliverable, so building the catalog works...
    const catalog = model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    assert.equal(catalog.size, 1);
    // ...and the production guard refuses it, which is where activation would otherwise happen.
    assert.throws(() => model.assertNoWithheldGrantConditions(catalog), /WITHHELD conditioned cell/);
    // The action-level registry still refuses the same cell outright, unchanged by this lane.
    assert.throws(() => seam.actionContextRegistry([{ capabilityKey: PO_READ, paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] }]),
      /WITHHELD conditioned cell/);
  });

  await t.test("a condition this model cannot evaluate is REFUSED, never dropped", () => {
    // Dropping an unreadable condition would turn a conditioned grant into an unconditional one.
    const bad = [
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [] } }, /no path is not a condition/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[]] } }, /empty path would allow every holder/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[{ kind: "isOwnAssignment" }]] } }, /unsupported predicate kind/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ASSIGNED]] } }, /needs a governed recordKind/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ASSIGNED]], recordKind: "opportunity" } }, /needs a governed recordKind/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("X")]], recordKind: "workOrder" } }, /decides nothing/],
      [{ grantor: ROLE("technician"), capabilityKey: "", condition: { paths: [[ELIGIBILITY("X")]] } }, /no capability key/],
      [{ grantor: { kind: "EMPLOYEE", roleKey: "x" }, capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("X")]] } }, /unknown grantor kind/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("")]] } }, /needs a qualificationCode/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[SCOPE("", "x")]] } }, /needs a scopeType/],
      [{ grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ANY" }]], recordKind: "workOrder" } }, /only ASSIGNED_EMPLOYEE/],
    ];
    for (const [row, message] of bad) assert.throws(() => model.grantConditionCatalog([row]), message, JSON.stringify(row));
    assert.throws(() => model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("SERVICE_TECHNICIAN")]] } },
    ]), /duplicate condition for one grant cell/, "two conditions on one cell is an unresolved policy");
  });

  await t.test("an UNREADABLE STORED condition fails closed rather than reading as unconditioned", () => {
    for (const condition of [null, "PARTS_OPERATIONS", 7, {}, { paths: "all" }]) {
      assert.throws(() => model.grantConditionCatalogFromRows([
        { grantScope: "ROLE", grantorKey: "technician", capabilityKey: PO_READ, condition },
      ]), /unreadable|no path is not a condition/, JSON.stringify(condition));
    }
  });

  await t.test("composition: a grant keeps its grantor, a condition finds its cell, and nothing else moves", () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
      // A condition for a cell nobody grants is INERT, not an error and not a grant.
      { grantor: ROLE("salesperson"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const entitlements = model.entitlementsFrom([
      { grantor: ROLE("technician"), capabilityKey: PO_READ },
      { grantor: ROLE("purchasingManager"), capabilityKey: PO_READ },
      { grantor: ROLE("technician"), capabilityKey: REQUEST_READ },
    ], conditions);
    assert.equal(entitlements.length, 3);
    assert.notEqual(entitlements[0].condition, null, "technician's PO read is conditioned");
    assert.equal(entitlements[1].condition, null, "purchasingManager's SAME key is not");
    assert.equal(entitlements[2].condition, null, "and technician's OTHER key is not");
    assert.deepEqual([...model.capabilityKeysOf(entitlements)].sort(), [PO_READ, REQUEST_READ]);
    assert.equal(model.hasUnconditionalEntitlement(entitlements, PO_READ), true);
    assert.equal(model.hasUnconditionalEntitlement(entitlements, REQUEST_READ), true);
    assert.equal(model.grantCellKey(ROLE("technician"), PO_READ), `ROLE:technician|${PO_READ}`);
    assert.equal(model.grantCellKey(PRINCIPAL("prn-x"), PO_READ), `PRINCIPAL:prn-x|${PO_READ}`);
  });

  // A reader that counts, and answers nothing. Any read at all is a failure in the zero-read cases.
  const countingReader = (answers = {}) => {
    const state = { reads: 0 };
    return [state, {
      linkedEmployeeId: async () => { state.reads += 1; return answers.employeeId ?? null; },
      hasWorkEligibility: async () => { state.reads += 1; return answers.eligible ?? false; },
      hasOperationalScope: async () => { state.reads += 1; return answers.inScope ?? false; },
      isAssignedEmployee: async () => { state.reads += 1; return answers.assigned ?? false; },
    }];
  };
  // The actor carries a REQUIRED RESOLVER. A test that wants a fixed entitlement list says so by
  // wrapping it, which is exactly the shape the composition produces -- and exactly the shape a
  // caller can no longer fake with a bare array.
  const actorOf = (entitlements, capabilities) => Object.freeze({
    tenantId: "t", principalId: "p",
    capabilities: capabilities ?? model.capabilityKeysOf(entitlements),
    entitlements: async () => entitlements,
  });

  await t.test("CAPABILITY FIRST: no key, no reads, and no entitlement is even looked at", async () => {
    const [state, reader] = countingReader();
    const d = await model.authorizeEntitledAction(reader, {
      actor: actorOf(model.entitlementsFrom([{ grantor: ROLE("technician"), capabilityKey: REQUEST_READ }])),
      capabilityKey: PO_READ,
    });
    assert.equal(d.outcome, "CAPABILITY_MISSING");
    assert.equal(d.contextEvaluated, false);
    assert.equal(d.viaGrantor, null);
    assert.equal(state.reads, 0);
  });

  await t.test("the two resolvers must AGREE: a flat-set key with no entitlement refuses", async () => {
    const [state, reader] = countingReader();
    const d = await model.authorizeEntitledAction(reader, {
      actor: actorOf(model.entitlementsFrom([]), new Set([PO_READ])),
      capabilityKey: PO_READ,
    });
    assert.equal(d.outcome, "CAPABILITY_MISSING", "disagreement resolves to the stricter answer");
    assert.equal(d.detail, `${PO_READ}: no entitlement`);
    assert.equal(state.reads, 0);
  });

  await t.test("an UNCONDITIONAL entitlement allows with ZERO context reads, even beside a conditioned one", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const [state, reader] = countingReader();
    const d = await model.authorizeEntitledAction(reader, {
      actor: actorOf(model.entitlementsFrom([
        { grantor: ROLE("technician"), capabilityKey: PO_READ },
        { grantor: ROLE("purchasingManager"), capabilityKey: PO_READ },
      ], conditions)),
      capabilityKey: PO_READ,
    });
    assert.equal(d.allowed, true);
    assert.equal(d.viaCondition, false);
    assert.deepEqual(d.viaGrantor, ROLE("purchasingManager"));
    assert.equal(d.contextEvaluated, false);
    assert.equal(state.reads, 0, "an unconditional path must not consult the context authority");
  });

  await t.test("MOST SPECIFIC denial wins, and every other refusal is kept", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("a"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_ASSOCIATE")]] } },
      { grantor: ROLE("b"), capabilityKey: PO_READ, condition: { paths: [[SCOPE("REORDER_QUEUE", "co")]] } },
      { grantor: ROLE("c"), capabilityKey: PO_READ, condition: { paths: [[ASSIGNED]], recordKind: "reorderRequest" } },
      { grantor: ROLE("d"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const entitlements = model.entitlementsFrom(
      ["a", "b", "c", "d"].map((roleKey) => ({ grantor: ROLE(roleKey), capabilityKey: PO_READ })), conditions);
    const [, reader] = countingReader({ employeeId: "emp-1" });
    const d = await model.authorizeEntitledAction(reader, {
      actor: actorOf(entitlements), capabilityKey: PO_READ, recordId: "RR-1",
    });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "NOT_ASSIGNED", "the record-specific refusal is the one a caller can act on");
    assert.equal(d.denials.length, 4);
    assert.deepEqual(d.denials.map((x) => x.outcome).sort(),
      ["NOT_ASSIGNED", "OUTSIDE_OPERATIONAL_SCOPE", "WORK_ELIGIBILITY_MISSING", "WORK_ELIGIBILITY_UNMAPPED"]);
    assert.deepEqual(d.denials.map((x) => x.grantor.roleKey), ["a", "b", "c", "d"]);
    // And the platform gap ranks LAST rather than masking an answerable refusal -- without being lost.
    const gapOnly = await model.authorizeEntitledAction(reader, {
      actor: actorOf(model.entitlementsFrom([{ grantor: ROLE("a"), capabilityKey: PO_READ }], conditions)),
      capabilityKey: PO_READ,
    });
    assert.equal(gapOnly.outcome, "WORK_ELIGIBILITY_UNMAPPED", "alone, the gap is the answer");
  });

  await t.test("an unanswerable authority DOMINATES a clean business denial", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("a"), capabilityKey: PO_READ, condition: { paths: [[ASSIGNED]], recordKind: "reorderRequest" } },
      { grantor: ROLE("b"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const reader = {
      linkedEmployeeId: async () => "emp-1",
      isAssignedEmployee: async () => false,
      hasWorkEligibility: async () => { throw new Error("connection terminated unexpectedly"); },
      hasOperationalScope: async () => false,
    };
    const d = await model.authorizeEntitledAction(reader, {
      actor: actorOf(model.entitlementsFrom(
        [{ grantor: ROLE("a"), capabilityKey: PO_READ }, { grantor: ROLE("b"), capabilityKey: PO_READ }], conditions)),
      capabilityKey: PO_READ, recordId: "RR-1",
    });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE", "an outage is never reported as a business denial");
    assert.equal(d.denials.length, 2, "and the clean denial beside it is still recorded");
  });

  await t.test("a conditioned grant that needs a record and is given none FAILS CLOSED", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("a"), capabilityKey: PO_READ, condition: { paths: [[ASSIGNED]], recordKind: "workOrder" } },
    ]);
    const [state, reader] = countingReader({ employeeId: "emp-1", assigned: true });
    for (const recordId of [undefined, "", "   "]) {
      const d = await model.authorizeEntitledAction(reader, {
        actor: actorOf(model.entitlementsFrom([{ grantor: ROLE("a"), capabilityKey: PO_READ }], conditions)),
        capabilityKey: PO_READ, recordId,
      });
      assert.equal(d.allowed, false);
      assert.equal(d.outcome, "NOT_ASSIGNED");
      assert.equal(d.detail, "no record supplied");
    }
    assert.equal(state.reads, 0, "no record, no question to ask");
  });

  await t.test("the record KIND comes from the condition, never from the caller", () => {
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/conditionalEntitlement.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.match(src, /recordKind:\s*condition\.recordKind/);
    assert.doesNotMatch(src, /request\.recordKind/);
    // The pure model stays pure: no SQL, no Firebase, no second capability resolver.
    assert.doesNotMatch(src, /\.query\s*\(/);
    assert.doesNotMatch(src, /FROM\s+eos_/);
    for (const forbidden of ["firebase", "firestore", "request.auth", "customClaims", "operationalRoles"]) {
      assert.equal(src.toLowerCase().includes(forbidden.toLowerCase()), false, `the model reaches for ${forbidden}`);
    }
  });

  await t.test("AB2: no source in this lane puts a condition on a GRANT ROW", () => {
    for (const file of ["src/eosOps/conditionalEntitlement.ts", "src/eosOps/entitledActionAuthority.ts",
      "src/eosOps/capabilityAuthority.ts"]) {
      const src = readFileSync(resolve(FUNCTIONS_DIR, file), "utf8");
      assert.doesNotMatch(src, /ALTER TABLE[\s\S]{0,80}(role_capabilities|principal_capabilities)/i, file);
      assert.doesNotMatch(src, /INSERT INTO[\s\S]{0,40}(role_capabilities|principal_capabilities)/i, file);
    }
    // The relation is a SEPARATE table keyed by (grantor, capability) -- never a column.
    assert.match(model.GRANT_CONDITION_RELATION_SCHEMA, /CREATE TABLE eos_policy\.capability_grant_conditions/);
    assert.match(model.GRANT_CONDITION_RELATION_SCHEMA,
      /UNIQUE \(tenant_id, grant_scope, grantor_key, capability_key\)/);
    assert.doesNotMatch(model.GRANT_CONDITION_RELATION_SCHEMA, /role_capabilities|principal_capabilities/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AGAINST A REAL, MIGRATED POSTGRESQL, over the rows migration 1761696000000 writes.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t-lane-ab";
const COMPANY_KEY = "sample-co-synthetic";
const REORDER_RECORD = "RR-2026-000911";

test("conditional entitlement against PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `laneab_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  // ════════════════════ the fixture ════════════════════

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','lane-ab','fixture','fixture')`, [T, COMPANY_KEY]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,$2,$2,'ACTIVE','MIGRATED','lane-ab','fixture','fixture')`, [T, COMPANY_KEY]);
  await q(`INSERT INTO eos_ops.warehouses
             (id,tenant_id,operating_company_key,name,site_label,status,provenance,created_by,updated_by)
           VALUES ('AB-WH',$1,$2,'AB-WH','AB-WH','ACTIVE','NATIVE','fixture','fixture')`, [T, COMPANY_KEY]);

  const roleKeys = [...new Set([...MIGRATION_GRANTS.map((g) => g.roleKey), "technician", "partsManager"])].sort();
  for (const key of roleKeys) {
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
             VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, T, key]);
  }

  // THE MIGRATION'S OWN GRANT ROWS, spelled exactly as its VALUES list spells them.
  //
  // Plus TWO DECLARED TEST GRANTS, in this throwaway database only: technician -> PO read and
  // create. Migration 1761696000000 deliberately WITHHOLDS those two rows from PostgreSQL because
  // the flat grant could not carry technician's condition. They exist here so the conditional model
  // has the cell it is meant to express -- and the shipped catalog still conditions nothing, the
  // production guard still refuses the cell, and no nonprod or production row is written by this file.
  const TEST_GRANTS = Object.freeze([
    { roleKey: "technician", capabilityKey: PO_READ },
    { roleKey: "technician", capabilityKey: PO_CREATE },
  ]);
  for (const { roleKey, capabilityKey } of [...MIGRATION_GRANTS, ...TEST_GRANTS]) {
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
    [`rc-${roleKey}-${capabilityKey}`.slice(0, 60), T, `role-${roleKey}`, capabilityKey]);
  }

  // Three Employees that differ in ONE fact each.
  const PEOPLE = Object.freeze({
    "tech-eligible": { eligibility: ["PARTS_OPERATIONS", "SERVICE_TECHNICIAN"], assigned: true },
    "tech-plain": { eligibility: ["SERVICE_TECHNICIAN"], assigned: false },
    "purchasing": { eligibility: [], assigned: false },
  });
  const emp = (k) => `emp-${k}`;
  const prn = (k) => `prn-${k}`;
  for (const [key, person] of Object.entries(PEOPLE)) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [emp(key), T, COMPANY_KEY, `E-${key}`.slice(0, 32)]);
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
             VALUES ($1,$2,'firebase','active')`, [prn(key), `uid-${key}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
             VALUES ($1,$2,$3,'active')`, [`mem-${key}`.slice(0, 60), T, prn(key)]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','lane ab fixture')`,
    [`lnk-${key}`.slice(0, 60), T, prn(key), emp(key), COMPANY_KEY]);
    for (const code of person.eligibility) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility
                 (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
               VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${key}-${code}`.slice(0, 60), T, emp(key), code]);
    }
  }
  await q(`INSERT INTO eos_workforce.employee_operational_scopes
             (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
           VALUES ('os-purchasing',$1,$2,'REORDER_QUEUE',$3,now(),'fixture')`, [T, emp("purchasing"), COMPANY_KEY]);
  await q(`INSERT INTO eos_ops.reorder_requests
             (id,tenant_id,operating_company_key,part_id,warehouse_id,status,requested_quantity,requested_by,updated_by)
           VALUES ($1,$2,$3,'p1','AB-WH','PENDING_REVIEW',1,'fixture','fixture')`, [REORDER_RECORD, T, COMPANY_KEY]);
  await q(`INSERT INTO eos_ops.reorder_request_assignments
             (id,tenant_id,reorder_request_id,assigned_employee_id,effective_from,provenance,assigned_by_principal_id)
           VALUES ('a-ab',$1,$2,$3,now(),'NATIVE',$4)`, [T, REORDER_RECORD, emp("tech-eligible"), prn("purchasing")]);

  const reader = evaluator.postgresContextualReader(pool);
  const counting = () => {
    const state = { reads: 0 };
    return [state, {
      linkedEmployeeId: async (...a) => { state.reads += 1; return reader.linkedEmployeeId(...a); },
      hasWorkEligibility: async (...a) => { state.reads += 1; return reader.hasWorkEligibility(...a); },
      hasOperationalScope: async (...a) => { state.reads += 1; return reader.hasOperationalScope(...a); },
      isAssignedEmployee: async (...a) => { state.reads += 1; return reader.isAssignedEmployee(...a); },
    }];
  };

  // THE CONDITION, expressed once: technician's PO grants, and only technician's.
  const TECHNICIAN_PO_CONDITIONS = model.grantConditionCatalog([
    { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    { grantor: ROLE("technician"), capabilityKey: PO_CREATE, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
  ]);

  const actorFor = async (personKey, roles, conditions = TECHNICIAN_PO_CONDITIONS) => Object.freeze({
    tenantId: T,
    principalId: prn(personKey),
    capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, roles),
    entitlements: await (async () => { const e = await composition.resolveRoleEntitlements(pool, T, roles, conditions); return () => e; })(),
  });

  // ════════════════════ AB1 -- the sentence, said ════════════════════

  await t.test("AB1: one capability, three entitlements, three different conditions", async () => {
    const entitlements = await composition.resolveRoleEntitlements(
      pool, T, ["technician", "purchasingManager", "warehouseAssociate"], TECHNICIAN_PO_CONDITIONS);
    const po = model.entitlementsFor(entitlements, PO_READ);
    assert.equal(po.length, 3, "three Roles reach the SAME capability key");
    const byRole = Object.fromEntries(po.map((e) => [e.grantor.roleKey, e]));
    assert.deepEqual(byRole.technician.condition.paths, [[ELIGIBILITY("PARTS_OPERATIONS")]],
      "technician -> purchaseOrder.read -> WORK_ELIGIBILITY(PARTS_OPERATIONS)");
    assert.equal(byRole.purchasingManager.condition, null, "purchasingManager -> purchaseOrder.read -> NONE");
    assert.equal(byRole.warehouseAssociate.condition, null, "warehouseAssociate -> purchaseOrder.read -> NONE");
    // Every grantor is a ROLE and every one names itself: the provenance the flat Set discarded.
    assert.deepEqual(po.map((e) => e.grantor.kind), ["ROLE", "ROLE", "ROLE"]);
  });

  await t.test("the provenance resolver AGREES with the runtime authority, exactly", async () => {
    for (const roles of [["technician"], ["purchasingManager"], ["technician", "purchasingManager"],
      ["partsManager"], ["owner", "controller", "financeManager"], []]) {
      const flat = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, roles);
      const derived = model.capabilityKeysOf(await composition.resolveRoleEntitlements(pool, T, roles));
      assert.deepEqual([...derived].sort(), [...flat].sort(), `roles ${JSON.stringify(roles)}`);
    }
  });

  // ════════════════════ AB5 -- the Purchase Order proof ════════════════════

  await t.test("AB5: the technician case is expressed -- eligible ALLOWED, not eligible REFUSED", async () => {
    const eligible = await actorFor("tech-eligible", ["technician"]);
    const allowed = await model.authorizeEntitledAction(reader, { actor: eligible, capabilityKey: PO_READ });
    assert.equal(allowed.allowed, true);
    assert.deepEqual(allowed.viaGrantor, ROLE("technician"));
    assert.equal(allowed.viaCondition, true, "allowed THROUGH the condition, not around it");
    assert.equal(allowed.contextEvaluated, true);

    const plain = await actorFor("tech-plain", ["technician"]);
    const refused = await model.authorizeEntitledAction(reader, { actor: plain, capabilityKey: PO_READ });
    assert.equal(refused.allowed, false);
    assert.equal(refused.outcome, "WORK_ELIGIBILITY_MISSING");
    assert.equal(refused.predicate, "WORK_ELIGIBILITY");
    assert.equal(refused.viaGrantor, null);
    // The two technicians differ in ONE governed fact.
    assert.equal(await reader.hasWorkEligibility(T, emp("tech-eligible"), "PARTS_OPERATIONS"), true);
    assert.equal(await reader.hasWorkEligibility(T, emp("tech-plain"), "PARTS_OPERATIONS"), false);
    // Same for create.
    assert.equal((await model.authorizeEntitledAction(reader, { actor: eligible, capabilityKey: PO_CREATE })).allowed, true);
    assert.equal((await model.authorizeEntitledAction(reader, { actor: plain, capabilityKey: PO_CREATE })).outcome,
      "WORK_ELIGIBILITY_MISSING");
  });

  await t.test("AB5: every UNCONDITIONED holder still resolves with ZERO context reads", async () => {
    assert.deepEqual(holdersOf(PO_READ), [
      "accountingManager", "admin", "controller", "dispatcher", "financeManager", "generalManager",
      "operationsManager", "owner", "purchasingManager", "warehouseAssociate", "warehouseManager"]);
    assert.equal(holdersOf(PO_READ).length, 11);
    assert.deepEqual(holdersOf(PO_CREATE), ["admin", "dispatcher", "generalManager", "owner", "purchasingManager"]);
    assert.equal(holdersOf(PO_CREATE).length, 5);
    let checked = 0;
    for (const [capabilityKey, holders] of [[PO_READ, holdersOf(PO_READ)], [PO_CREATE, holdersOf(PO_CREATE)]]) {
      for (const roleKey of holders) {
        // "purchasing" holds no PARTS_OPERATIONS eligibility: if the condition leaked onto these
        // Roles, every one of them would fail, not merely read the database.
        const actor = await actorFor("purchasing", [roleKey]);
        const [state, countingReader] = counting();
        const d = await model.authorizeEntitledAction(countingReader, { actor, capabilityKey });
        assert.equal(d.allowed, true, `${roleKey} lost ${capabilityKey}`);
        assert.equal(d.contextEvaluated, false, `${roleKey} acquired a context requirement on ${capabilityKey}`);
        assert.equal(d.viaCondition, false);
        assert.deepEqual(d.viaGrantor, ROLE(roleKey));
        assert.equal(state.reads, 0, `${roleKey} caused a context read for ${capabilityKey}`);
        checked += 1;
      }
    }
    assert.equal(checked, 16, "eleven read holders plus five create holders");
  });

  await t.test("AB5: a Principal holding BOTH Roles keeps the unconditioned answer", async () => {
    // tech-plain is NOT PARTS_OPERATIONS eligible. Holding purchasingManager beside technician must
    // still allow, with no read: the condition constrains technician's GRANT, not the person.
    const actor = await actorFor("tech-plain", ["technician", "purchasingManager"]);
    const [state, countingReader] = counting();
    const d = await model.authorizeEntitledAction(countingReader, { actor, capabilityKey: PO_READ });
    assert.equal(d.allowed, true);
    assert.deepEqual(d.viaGrantor, ROLE("purchasingManager"));
    assert.equal(state.reads, 0);
    assert.equal(model.entitlementsFor(await actor.entitlements(), PO_READ).length, 2, "both entitlements are present");
  });

  await t.test("AB5: a Role holding NEITHER cell is refused before anything is read", async () => {
    const actor = await actorFor("purchasing", ["partsManager"]);
    const [state, countingReader] = counting();
    const d = await model.authorizeEntitledAction(countingReader, { actor, capabilityKey: PO_READ });
    assert.equal(d.outcome, "CAPABILITY_MISSING");
    assert.equal(state.reads, 0);
    assert.equal(holdersOf(PO_READ).includes("partsManager"), false,
      "partsManager holds no Purchase Order grant in migration 1761696000000");
  });

  await t.test("AB5: the harm the ACTION-level predicate would do, measured in the same database", async () => {
    // The identical predicate, attached to the ACTION instead of the GRANT, refuses every
    // unconditioned holder. That difference is the entire reason this lane exists.
    const dispatcher = await actorFor("purchasing", ["dispatcher"]);
    const grantLevel = await model.authorizeEntitledAction(reader, { actor: dispatcher, capabilityKey: PO_CREATE });
    assert.equal(grantLevel.allowed, true, "grant-level: untouched");
    const actionLevel = await evaluator.authorizeObjectAction(reader, {
      actor: dispatcher, capabilityKey: PO_CREATE,
      predicates: [ELIGIBILITY("PARTS_OPERATIONS")],
    });
    assert.equal(actionLevel.allowed, false, "action-level: narrowed");
    assert.equal(actionLevel.reason, "WORK_ELIGIBILITY_MISSING");
  });

  // ════════════════════ AB3 -- the direct Principal path ════════════════════

  await t.test("AB3: a DIRECT Principal grant is an entitlement, and it can carry a predicate", async () => {
    await q(`INSERT INTO eos_policy.principal_capabilities (id,tenant_id,principal_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'pc-ab-1',$1,$2,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $3`,
    [T, prn("tech-plain"), PO_READ]);
    // Unconditioned direct grant: allowed, zero reads, grantor PRINCIPAL.
    const plainDirect = await composition.resolveDirectEntitlements(pool, T, prn("tech-plain"));
    assert.equal(plainDirect.length, 1);
    assert.deepEqual(plainDirect[0].grantor, PRINCIPAL(prn("tech-plain")));
    assert.equal(plainDirect[0].condition, null);
    const [state, countingReader] = counting();
    const open = await model.authorizeEntitledAction(countingReader, {
      actor: { tenantId: T, principalId: prn("tech-plain"), capabilities: model.capabilityKeysOf(plainDirect), entitlements: async () => plainDirect },
      capabilityKey: PO_READ,
    });
    assert.equal(open.allowed, true);
    assert.equal(state.reads, 0);

    // The SAME direct grant, conditioned by a PRINCIPAL-keyed catalog row: refused, fail-closed.
    const directConditions = model.grantConditionCatalog([
      { grantor: PRINCIPAL(prn("tech-plain")), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const conditioned = await composition.resolveDirectEntitlements(pool, T, prn("tech-plain"), directConditions);
    assert.notEqual(conditioned[0].condition, null, "a direct grant is conditionable today, not someday");
    const gated = await model.authorizeEntitledAction(reader, {
      actor: { tenantId: T, principalId: prn("tech-plain"), capabilities: model.capabilityKeysOf(conditioned), entitlements: async () => conditioned },
      capabilityKey: PO_READ,
    });
    assert.equal(gated.allowed, false);
    assert.equal(gated.outcome, "WORK_ELIGIBILITY_MISSING");

    // AND the operational runtime is UNCHANGED: direct grants are not silently in the Role set.
    const flat = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician"]);
    const direct = await composition.resolveDirectEntitlements(pool, T, prn("tech-plain"));
    assert.equal(direct.length, 1);
    assert.equal(flat.has(PO_READ), true, "held via the technician TEST GRANT, not via the direct row");
    const noRoles = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, []);
    assert.equal(noRoles.size, 0, "a direct grant does not leak into Role resolution");
  });

  // ════════════════════ AB4 -- evaluation, against governed tables ════════════════════

  await t.test("AB4: only conditional paths -- each evaluated fail-closed, any valid path ALLOWS", async () => {
    // reorder.request.read is held by technician AND partsManager per the migration. Condition BOTH
    // grants, differently, and make the caller satisfy exactly one.
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: REQUEST_READ, condition: { paths: [[ASSIGNED]], recordKind: "reorderRequest" } },
      { grantor: ROLE("partsManager"), capabilityKey: REQUEST_READ, condition: { paths: [[SCOPE("REORDER_QUEUE", COMPANY_KEY)]] } },
    ]);
    const assignedTech = await actorFor("tech-eligible", ["technician", "partsManager"], conditions);
    const viaAssignment = await model.authorizeEntitledAction(reader, {
      actor: assignedTech, capabilityKey: REQUEST_READ, recordId: REORDER_RECORD,
    });
    assert.equal(viaAssignment.allowed, true);
    assert.deepEqual(viaAssignment.viaGrantor, ROLE("technician"), "the assignment path carried it");
    // Entitlements resolve in Role-key order, so partsManager's queue condition was evaluated FIRST
    // and refused -- an Employee with an assignment and no queue scope still reaches their own record.
    assert.deepEqual(viaAssignment.denials.map((d) => d.outcome), ["OUTSIDE_OPERATIONAL_SCOPE"]);

    const queueOnly = await actorFor("purchasing", ["technician", "partsManager"], conditions);
    const viaQueue = await model.authorizeEntitledAction(reader, {
      actor: queueOnly, capabilityKey: REQUEST_READ, recordId: REORDER_RECORD,
    });
    assert.equal(viaQueue.allowed, true);
    assert.deepEqual(viaQueue.viaGrantor, ROLE("partsManager"), "the queue-scope path carried it");
    assert.equal(viaQueue.denials.length, 0, "the first valid path decides; the rest are never asked");

    const neither = await actorFor("tech-plain", ["technician", "partsManager"], conditions);
    const refused = await model.authorizeEntitledAction(reader, {
      actor: neither, capabilityKey: REQUEST_READ, recordId: REORDER_RECORD,
    });
    assert.equal(refused.allowed, false);
    assert.equal(refused.outcome, "NOT_ASSIGNED", "the most specific of the two refusals");
    assert.deepEqual(refused.denials.map((d) => d.outcome).sort(), ["NOT_ASSIGNED", "OUTSIDE_OPERATIONAL_SCOPE"]);
  });

  await t.test("AB4: eligibility is never inferred from holding the Role", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("dispatcher"), capabilityKey: REQUEST_READ, condition: { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] } },
    ]);
    const actor = await actorFor("purchasing", ["dispatcher"], conditions);
    const d = await model.authorizeEntitledAction(reader, { actor, capabilityKey: REQUEST_READ });
    assert.equal(d.outcome, "WORK_ELIGIBILITY_MISSING");
    const { rows } = await q(`SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility
                               WHERE tenant_id=$1 AND employee_id=$2 AND effective_to IS NULL`, [T, emp("purchasing")]);
    assert.equal(rows[0].n, 0, "the fixture would prove nothing if this Employee were eligible");
  });

  await t.test("AB4: an unmappable qualification is a PLATFORM GAP, not a denial", async () => {
    const conditions = model.grantConditionCatalog([
      { grantor: ROLE("technician"), capabilityKey: PO_READ, condition: { paths: [[ELIGIBILITY("PARTS_ASSOCIATE")]] } },
    ]);
    const actor = await actorFor("tech-eligible", ["technician"], conditions);
    const d = await model.authorizeEntitledAction(reader, { actor, capabilityKey: PO_READ });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "WORK_ELIGIBILITY_UNMAPPED");
    assert.equal(evaluator.GOVERNED_QUALIFICATION_CODES.has("PARTS_ASSOCIATE"), false);
  });

  // ════════════════════ THE SHIPPED PATH IS INERT ════════════════════

  await t.test("the PRODUCTION entry point conditions nothing and withholds the two cells", async () => {
    const resolved = {
      principalContext: { tenantId: T, uid: prn("tech-plain"), heldRoleKeys: ["technician"] },
      capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician"]),
    };
    // tech-plain has NO PARTS_OPERATIONS eligibility, and is still allowed -- because the shipped
    // catalog conditions nothing. Composing this model activated no condition anywhere.
    const d = await composition.authorizeEntitledResolvedAction(pool, resolved, { capabilityKey: PO_READ });
    assert.equal(d.allowed, true);
    assert.equal(d.contextEvaluated, false);
    assert.equal(d.viaCondition, false);
    assert.deepEqual(d.viaGrantor, ROLE("technician"));
    // And a caller with no grant at all is refused identically to the existing seam.
    const none = await composition.authorizeEntitledResolvedAction(pool,
      { principalContext: { tenantId: T, uid: prn("purchasing"), heldRoleKeys: ["partsManager"] },
        capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["partsManager"]) },
      { capabilityKey: PO_READ });
    assert.equal(none.outcome, "CAPABILITY_MISSING");
  });

  await t.test("a resolver outage on the production path is a refusal, not a decision", async () => {
    const broken = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    const d = await composition.authorizeEntitledResolvedAction(broken,
      { principalContext: { tenantId: T, uid: prn("purchasing"), heldRoleKeys: ["dispatcher"] },
        capabilities: new Set([PO_READ]) },
      { capabilityKey: PO_READ });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
  });

  // ════════════════ PERSISTENCE -- designed, read, and migrated by 1762214400000 ════════════════

  await t.test("migration 1762214400000 creates the relation on THIS lineage now -- and an absent store still throws", async () => {
    // WAVE 10 / LANE AR. This subtest recorded the OPPOSITE on Lane AB's branch: the relation was
    // absent because migration 1762214400000 was not on that lineage. It is on v7 -- integration v6
    // (42191317) deployed it -- so a database migrated from `migrations/` now carries the condition
    // store, and the premise "this lane adds none" is about the LANE, not about the lineage.
    const { rows } = await q(
      `SELECT to_regclass('eos_policy.capability_grant_conditions') IS NOT NULL AS present`);
    assert.equal(rows[0].present, true, "migration 1762214400000 did not create the relation");
    assert.equal(model.GRANT_CONDITION_SCHEMA_MIGRATION, "1762214400000");

    // THE FAIL-CLOSED GUARD IS NOT WEAKENED, only produced deliberately instead of for free. It used
    // to be demonstrable because the lineage had no migration; the store is dropped here so that "a
    // missing condition store throws" is still measured rather than assumed. The next subtest
    // re-creates it from GRANT_CONDITION_RELATION_SCHEMA exactly as it always did.
    await q(`DROP TABLE eos_policy.capability_grant_conditions`);
    await assert.rejects(() => composition.postgresGrantConditions(pool, T), /does not exist/,
      "a missing condition store must throw, never read as 'no conditions'");
    // AB2: the two grant tables still answer WHAT, never WHICH.
    const { rows: cols } = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='eos_policy' AND table_name IN ('role_capabilities','principal_capabilities')`);
    const forbidden = ["condition", "condition_kind", "conditions", "predicate", "qualification_code",
      "scope", "scope_type", "own_only"];
    assert.deepEqual(cols.filter((c) => forbidden.includes(c.column_name)), []);
    assert.equal(cols.filter((c) => c.table_name === "role_capabilities").length, 10,
      "role_capabilities grew or lost a column");
  });

  await t.test("the relation, created from its own DDL, round-trips a real condition", async () => {
    // Applied HERE ONLY, in a throwaway database, from the exact text migration 1762214400000 carries.
    await q(model.GRANT_CONDITION_RELATION_SCHEMA);
    await q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-1',$1,'ROLE','technician',$2,$3::jsonb,'lane-ab','lane-ab')`,
    [T, PO_READ, JSON.stringify({ paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] })]);
    await q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-2',$1,'PRINCIPAL',$2,$3,$4::jsonb,'lane-ab','lane-ab')`,
    [T, prn("tech-plain"), PO_CREATE, JSON.stringify({ paths: [[ASSIGNED]], recordKind: "reorderRequest" })]);
    // A RETIRED row is not a condition.
    await q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
             VALUES ('cgc-3',$1,'ROLE','dispatcher',$2,$3::jsonb,'RETIRED','lane-ab','lane-ab')`,
    [T, PO_READ, JSON.stringify({ paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] })]);

    const catalog = await composition.postgresGrantConditions(pool, T);
    assert.equal(catalog.size, 2, "the RETIRED row is not loaded");
    assert.deepEqual(catalog.get(`ROLE:technician|${PO_READ}`).paths, [[ELIGIBILITY("PARTS_OPERATIONS")]]);
    assert.equal(catalog.get(`PRINCIPAL:${prn("tech-plain")}|${PO_CREATE}`).recordKind, "reorderRequest");

    // The stored catalog decides exactly as the hand-built one did.
    const stored = await composition.resolveRoleEntitlements(pool, T, ["technician", "purchasingManager"], catalog);
    const eligible = { tenantId: T, principalId: prn("tech-eligible"),
      capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician"]),
      entitlements: async () => model.entitlementsFor(stored, PO_READ).filter((e) => e.grantor.roleKey === "technician") };
    const d = await model.authorizeEntitledAction(reader, { actor: eligible, capabilityKey: PO_READ });
    assert.equal(d.allowed, true);
    assert.equal(d.viaCondition, true);

    // One grant cell, one condition: the unique key is what makes the policy readable.
    await assert.rejects(() => q(`INSERT INTO eos_policy.capability_grant_conditions
               (id,tenant_id,grant_scope,grantor_key,capability_key,condition,established_by,updated_by)
             VALUES ('cgc-dup',$1,'ROLE','technician',$2,'{}'::jsonb,'lane-ab','lane-ab')`, [T, PO_READ]),
    /duplicate key|unique/i);
    // An unreadable stored condition refuses the WHOLE catalog rather than silently unconditioning it.
    await q(`UPDATE eos_policy.capability_grant_conditions SET condition = '"PARTS_OPERATIONS"'::jsonb WHERE id='cgc-1'`);
    await assert.rejects(() => composition.postgresGrantConditions(pool, T), /unreadable/);
    await q(`DELETE FROM eos_policy.capability_grant_conditions`);
    await q(`DROP TABLE eos_policy.capability_grant_conditions`);
  });

  // ════════════════════ AB6 -- the existing model is untouched ════════════════════

  await t.test("AB6: Work Order assignment, Reorder queue scope and PARTS_OPERATIONS are unchanged", async () => {
    // The SAME three behaviours the existing seam decides, decided by the existing seam, in this
    // database, with this lane's code loaded. Nothing was rewritten to use the new mechanism.
    const own = seam.actionContextRegistry([{ capabilityKey: REQUEST_READ,
      paths: [[ASSIGNED]], recordKind: "reorderRequest" }]);
    const queue = seam.actionContextRegistry([{ capabilityKey: REQUEST_READ,
      paths: [[SCOPE("REORDER_QUEUE", COMPANY_KEY)]] }]);
    const eligibility = seam.actionContextRegistry([{ capabilityKey: REQUEST_READ,
      paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] }]);
    const techActor = {
      tenantId: T, principalId: prn("tech-eligible"),
      capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician"]),
    };
    const queueActor = {
      tenantId: T, principalId: prn("purchasing"),
      capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["partsManager"]),
    };
    assert.equal((await seam.authorizeContextualAction(reader, { actor: techActor, capabilityKey: REQUEST_READ,
      recordId: REORDER_RECORD }, own)).allowed, true);
    assert.equal((await seam.authorizeContextualAction(reader, { actor: techActor, capabilityKey: REQUEST_READ },
      queue)).outcome, "OUTSIDE_OPERATIONAL_SCOPE", "queue scope is still not implied by assignment");
    assert.equal((await seam.authorizeContextualAction(reader, { actor: queueActor, capabilityKey: REQUEST_READ },
      queue)).allowed, true);
    assert.equal((await seam.authorizeContextualAction(reader, { actor: queueActor, capabilityKey: REQUEST_READ,
      recordId: REORDER_RECORD }, own)).outcome, "NOT_ASSIGNED", "assignment is still not implied by queue scope");
    assert.equal((await seam.authorizeContextualAction(reader, { actor: techActor, capabilityKey: REQUEST_READ },
      eligibility)).allowed, true, "PARTS_OPERATIONS still decides as it did");
    assert.equal((await seam.authorizeContextualAction(reader, { actor: queueActor, capabilityKey: REQUEST_READ },
      eligibility)).outcome, "WORK_ELIGIBILITY_MISSING");
    // Work Order assignment, through the same unchanged evaluator.
    await q(`INSERT INTO eos_ops.work_orders (id,tenant_id,operating_company_key,status,work_order_type,priority,
               provenance,customer_id,location_id,created_by_principal_id,created_at,updated_at)
             VALUES ('wo-ab',$1,$2,'WORK_IN_PROGRESS','SERVICE_CALL',3,'NATIVE','c1','l1',$3,now(),now())`,
    [T, COMPANY_KEY, prn("purchasing")]);
    await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,
               effective_from,provenance,assigned_by_principal_id,source)
             VALUES ('wa-ab',$1,'wo-ab',$2,now(),'NATIVE',$3,'SCHEDULE')`, [T, emp("tech-eligible"), prn("purchasing")]);
    assert.equal(await reader.isAssignedEmployee(T, "workOrder", "wo-ab", emp("tech-eligible")), true);
    assert.equal(await reader.isAssignedEmployee(T, "workOrder", "wo-ab", emp("tech-plain")), false);
    assert.equal([...evaluator.CONTEXT_PREDICATE_KINDS].length, 3, "the predicate vocabulary is unchanged");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// LANE AJ — THE DIFFERENCE BETWEEN "THE SCHEMA EXISTS" AND "THE RUNTIME WORKS".
//
// Migration 1762214400000 created `eos_policy.capability_grant_conditions` and applied it to nonprod
// on 2026-09-24, where it holds ZERO rows. WAVE 10 / LANE AR: that migration IS on this lineage now
// -- integration v6 carried it -- so the migration chain creates the relation and this lane still
// adds none. `GRANT_CONDITION_RELATION_SCHEMA`, the repository's own DDL, is the text the migration
// was written from character for character, and the two are now measured against each other.
//
// NOTHING IS ACTIVATED ANYWHERE THAT PERSISTS. Every condition row in this file lives in a throwaway
// database that is dropped when the test ends; `SHIPPED_GRANT_CONDITIONS` stays empty and frozen; the
// two Purchase Order cells stay withheld and the production entry point still refuses them.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
const policy = require("../lib/eosOps/grantConditionPolicy.js");
const workforceHttp = require("../lib/eosWorkforce/workforceHttp.js");

const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";

/**
 * NONPROD, READ ONLY, 2026-09-24 — `render psql dpg-dah48qht0dsc73egnml0-a --command "SELECT ..."`.
 * Pinned verbatim so the repository's declared shape is checked against what is DEPLOYED and not
 * only against what this test can create for itself.
 */
const NONPROD_COLUMNS = Object.freeze([
  ["id", "text", "NO", null],
  ["tenant_id", "text", "NO", null],
  ["grant_scope", "text", "NO", null],
  ["grantor_key", "text", "NO", null],
  ["capability_key", "text", "NO", null],
  ["condition", "jsonb", "NO", null],
  ["status", "text", "NO", "'ACTIVE'::text"],
  ["established_by", "text", "NO", null],
  ["established_at", "timestamp with time zone", "NO", "now()"],
  ["updated_by", "text", "NO", null],
  ["updated_at", "timestamp with time zone", "NO", "now()"],
]);
const NONPROD_CONSTRAINTS = Object.freeze([
  "CHECK ((grant_scope = ANY (ARRAY['ROLE'::text, 'PRINCIPAL'::text])))",
  "CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text])))",
  "FOREIGN KEY (capability_key) REFERENCES eos_policy.capabilities(key)",
  "FOREIGN KEY (tenant_id) REFERENCES eos_policy.tenants(id)",
  "PRIMARY KEY (id)",
  "UNIQUE (tenant_id, grant_scope, grantor_key, capability_key)",
]);
const NONPROD_INDEXES = Object.freeze([
  "capability_grant_conditions_by_capability",
  "capability_grant_conditions_pkey",
  "capability_grant_conditions_tenant_id_grant_scope_grantor_k_key",
]);
/** Measured in nonprod the same day, from eos_policy.role_capabilities. */
const NONPROD_PO_READ_HOLDERS = Object.freeze(["accountingManager", "admin", "controller", "dispatcher",
  "financeManager", "generalManager", "operationsManager", "owner", "purchasingManager",
  "warehouseAssociate", "warehouseManager"]);
const NONPROD_PO_CREATE_HOLDERS = Object.freeze(["admin", "dispatcher", "generalManager", "owner", "purchasingManager"]);
/** `SELECT count(*) FROM eos_policy.capability_grant_conditions` in nonprod, 2026-09-24. */
const NONPROD_CONDITION_ROWS = 0;

test("AJ: the DEPLOYED schema, the zero-condition runtime, and the seam that consumes it", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `laneaj_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);

  const TENANT = "t-lane-aj";
  const COMPANY = "sample-co-synthetic";
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','lane-aj','fixture','fixture')`, [TENANT, COMPANY]);

  // ---- the relation. WAVE 10 / LANE AR: migration 1762214400000 IS on this lineage as of v7, so
  // the chain above already created it. It is measured as deployed, then dropped so the ABSENT case
  // stays provable, then restored from the repository's own DDL -- which is also the evidence that
  // the migration's text and `GRANT_CONDITION_RELATION_SCHEMA` describe one relation, not two.
  const relationDeployed = await capabilityAuthority.describeGrantConditionRelation(pool);
  await q(`DROP TABLE eos_policy.capability_grant_conditions`);
  const relationAbsent = await capabilityAuthority.describeGrantConditionRelation(pool);
  await q(model.GRANT_CONDITION_RELATION_SCHEMA);

  // ---- Roles, grants and Principals, through the real policy repository
  const fixture = { tenantId: TENANT, uid: "uid-lane-aj" };
  const ROLE_KEYS = [...new Set([...MIGRATION_GRANTS.map((g) => g.roleKey), "technician", "partsManager", "admin"])].sort();
  const roleIds = {};
  for (const key of ROLE_KEYS) {
    roleIds[key] = (await repo.transact(fixture, (tx) =>
      tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
  }
  const grant = async (roleKey, capabilityKey) => {
    const r = await q(
      `INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
       SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $4
       ON CONFLICT DO NOTHING`,
      [`rc-${roleKey}-${capabilityKey}`.slice(0, 60), TENANT, roleIds[roleKey], capabilityKey]);
    assert.equal(r.rowCount, 1, `${capabilityKey} is not in the capability vocabulary`);
  };
  // The migration's OWN grant rows, spelled as its VALUES list spells them.
  for (const g of MIGRATION_GRANTS) await grant(g.roleKey, g.capabilityKey);
  // Two TEST GRANTS, in this throwaway database only: technician -> the two Purchase Order cells.
  // Migration 1761696000000 withholds them from PostgreSQL because a flat grant cannot carry a
  // condition; they exist here so the model has the cell it is meant to express.
  await grant("technician", PO_READ);
  await grant("technician", PO_CREATE);
  await grant("admin", PRINCIPAL_ACCESS_READ);
  await grant("warehouseAssociate", PRINCIPAL_ACCESS_READ);

  const TOKENS = new Map();
  const makePrincipal = async (subject, roleKeys) => {
    const principalId = await repo.transact(fixture, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    for (const roleKey of roleKeys) {
      await repo.transact(fixture, async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: roleIds[roleKey], scopeType: "global", scopeValue: null,
          status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    TOKENS.set(`tok-${subject}`, subject);
    return { principalId, subject, token: `tok-${subject}`, roleKeys };
  };
  const linkEmployee = async (key, principalId, eligibility = []) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [`emp-${key}`, TENANT, COMPANY, `AJ-${key}`.slice(0, 32)]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','lane aj fixture')`,
    [`lnk-${key}`.slice(0, 60), TENANT, principalId, `emp-${key}`, COMPANY]);
    for (const code of eligibility) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility
                 (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
               VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${key}-${code}`.slice(0, 60), TENANT, `emp-${key}`, code]);
    }
    return `emp-${key}`;
  };

  const techEligible = await makePrincipal("uid-aj-tech-eligible", ["technician"]);
  const techPlain = await makePrincipal("uid-aj-tech-plain", ["technician"]);
  const bothRoles = await makePrincipal("uid-aj-both", ["technician", "purchasingManager"]);
  const adminUser = await makePrincipal("uid-aj-admin", ["admin"]);
  await linkEmployee("tech-eligible", techEligible.principalId, ["PARTS_OPERATIONS", "SERVICE_TECHNICIAN"]);
  await linkEmployee("tech-plain", techPlain.principalId, ["SERVICE_TECHNICIAN"]);
  await linkEmployee("both", bothRoles.principalId, ["SERVICE_TECHNICIAN"]);
  await linkEmployee("admin", adminUser.principalId, []);

  // The fourth argument is a condition PROVIDER now, resolved lazily and only if a gate site asks.
  const resolveFor = (actor, conditions) => capabilityAuthority.resolveOperationalContext(
    repo, pool, { identityProvider: "firebase", externalSubject: actor.subject, requestedTenantId: null },
    conditions ? () => conditions : undefined);
  const pgReader = evaluator.postgresContextualReader(pool);
  const countingOver = (inner) => {
    const state = { reads: 0 };
    return [state, {
      linkedEmployeeId: async (...a) => { state.reads += 1; return inner.linkedEmployeeId(...a); },
      hasWorkEligibility: async (...a) => { state.reads += 1; return inner.hasWorkEligibility(...a); },
      hasOperationalScope: async (...a) => { state.reads += 1; return inner.hasOperationalScope(...a); },
      isAssignedEmployee: async (...a) => { state.reads += 1; return inner.isAssignedEmployee(...a); },
    }];
  };
  const storeCondition = (id, scope, grantorKey, capabilityKey, condition, status = "ACTIVE") =>
    q(`INSERT INTO eos_policy.capability_grant_conditions
         (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'lane-aj','lane-aj')`,
    [id, TENANT, scope, grantorKey, capabilityKey, JSON.stringify(condition), status]);
  const clearConditions = () => q(`DELETE FROM eos_policy.capability_grant_conditions`);
  const conditionRowCount = async () =>
    (await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`)).rows[0].n;

  // ════════════════════ AJ2 — THE LIVE SCHEMA ════════════════════

  await t.test("AJ2: the repository's declared shape IS the shape deployed in nonprod", () => {
    // The declaration is checked against the nonprod readout FIRST -- otherwise this file would only
    // prove that a table matches the DDL that created it, which is circular.
    assert.deepEqual(
      policy.GRANT_CONDITION_RELATION_SHAPE.columns.map((c) =>
        [c.name, c.dataType, c.nullable ? "YES" : "NO", c.columnDefault]),
      NONPROD_COLUMNS.map((c) => [...c]),
      "the declared columns differ from information_schema in nonprod");
    assert.deepEqual([...policy.GRANT_CONDITION_RELATION_SHAPE.constraints].sort(), [...NONPROD_CONSTRAINTS],
      "the declared constraints differ from pg_constraint in nonprod");
    assert.equal(policy.GRANT_CONDITION_RELATION_SHAPE.namedIndex.name, NONPROD_INDEXES[0]);
    assert.deepEqual([...policy.GRANT_CONDITION_RELATION_SHAPE.namedIndex.columns], ["tenant_id", "capability_key"]);
    assert.equal(policy.GRANT_CONDITION_RELATION_MIGRATION, "1762214400000");
    assert.equal(policy.GRANT_CONDITION_RELATION_NAME, "eos_policy.capability_grant_conditions");
    assert.equal(capabilityAuthority.GRANT_CONDITION_RELATION, policy.GRANT_CONDITION_RELATION_NAME);
    // WAVE 10 / LANE AR: AJ2 still adds no migration, but the lineage now HAS one -- v6 brought
    // 1762214400000. Exactly one migration may name the relation; a second would mean two DDLs.
    const migrationsDir = resolve(FUNCTIONS_DIR, "migrations");
    const naming = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))
      .filter((f) => readFileSync(resolve(migrationsDir, f), "utf8").includes("capability_grant_conditions"));
    assert.deepEqual(naming, ["1762214400000_capability-grant-conditions.sql"],
      `the relation is named by ${naming.length} migrations on this lineage: ${naming}`);
    // AND THE DEPLOYED RELATION IS THE DECLARED ONE. This could not be measured on AJ's branch,
    // because there the only relation that existed was the one this test had just created.
    assert.equal(relationDeployed.present, true, "the migration chain did not create the relation");
    assert.deepEqual(capabilityAuthority.grantConditionRelationDrift(relationDeployed), [],
      "the relation migration 1762214400000 deploys drifts from GRANT_CONDITION_RELATION_SCHEMA");
    assert.equal(relationAbsent.present, false, "the relation survived the deliberate drop");
    assert.deepEqual(capabilityAuthority.grantConditionRelationDrift(relationAbsent),
      ["eos_policy.capability_grant_conditions is absent"]);
  });

  await t.test("AJ2: a database created from that DDL has ZERO drift from the declaration", async () => {
    const facts = await capabilityAuthority.describeGrantConditionRelation(pool);
    assert.equal(facts.present, true);
    assert.deepEqual(capabilityAuthority.grantConditionRelationDrift(facts), []);
    assert.deepEqual(facts.columns.map((c) => [c.name, c.dataType, c.nullable ? "YES" : "NO", c.columnDefault]),
      NONPROD_COLUMNS.map((c) => [...c]));
    assert.deepEqual([...facts.constraints], [...NONPROD_CONSTRAINTS]);
    assert.deepEqual([...facts.indexes], [...NONPROD_INDEXES]);
    assert.deepEqual([...facts.namedIndexColumns], ["tenant_id", "capability_key"]);
  });

  await t.test("AJ2: the parity check is load-bearing -- each kind of drift is DETECTED", async () => {
    const drifts = [
      ["ALTER TABLE eos_policy.capability_grant_conditions ADD COLUMN scope_type TEXT",
        "ALTER TABLE eos_policy.capability_grant_conditions DROP COLUMN scope_type", /column scope_type is undeclared/],
      ["ALTER TABLE eos_policy.capability_grant_conditions ALTER COLUMN updated_by DROP NOT NULL",
        "ALTER TABLE eos_policy.capability_grant_conditions ALTER COLUMN updated_by SET NOT NULL", /column updated_by nullability/],
      ["DROP INDEX eos_policy.capability_grant_conditions_by_capability",
        "CREATE INDEX capability_grant_conditions_by_capability ON eos_policy.capability_grant_conditions (tenant_id, capability_key)",
        /index missing: capability_grant_conditions_by_capability/],
      [`ALTER TABLE eos_policy.capability_grant_conditions DROP CONSTRAINT capability_grant_conditions_status_check`,
        `ALTER TABLE eos_policy.capability_grant_conditions ADD CONSTRAINT capability_grant_conditions_status_check CHECK (status IN ('ACTIVE','RETIRED'))`,
        /constraint missing: CHECK \(\(status = ANY/],
    ];
    for (const [break_, restore, expected] of drifts) {
      await q(break_);
      const found = capabilityAuthority.grantConditionRelationDrift(
        await capabilityAuthority.describeGrantConditionRelation(pool));
      assert.ok(found.some((d) => expected.test(d)), `${break_} produced ${JSON.stringify(found)}`);
      await q(restore);
    }
    assert.deepEqual(capabilityAuthority.grantConditionRelationDrift(
      await capabilityAuthority.describeGrantConditionRelation(pool)), [], "the relation was left drifted");
  });

  // ════════════════════ AJ3 — ZERO ACTIVE CONDITIONS ════════════════════

  await t.test("AJ3: with zero rows the STORED catalog is the SHIPPED catalog, exactly", async () => {
    assert.equal(await conditionRowCount(), 0);
    assert.equal(NONPROD_CONDITION_ROWS, 0, "nonprod carries no condition row either");
    const stored = await composition.postgresGrantConditions(pool, TENANT);
    assert.equal(stored.size, 0);
    assert.deepEqual([...stored.keys()], [...model.SHIPPED_GRANT_CONDITIONS.keys()]);
    // A RETIRED row is not a condition: the count moves, the catalog does not.
    await storeCondition("aj-retired", "ROLE", "technician", REQUEST_READ,
      { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] }, "RETIRED");
    assert.equal(await conditionRowCount(), 1);
    assert.equal((await composition.postgresGrantConditions(pool, TENANT)).size, 0);
    await clearConditions();
  });

  await t.test("AJ3: zero conditions -> every held capability allows with ZERO context reads", async () => {
    for (const actor of [techEligible, techPlain, bothRoles, adminUser]) {
      const ctx = await resolveFor(actor);
      // The runtime authority and the provenance resolver agree, key for key.
      assert.deepEqual([...model.capabilityKeysOf(await ctx.entitlements())].sort(), [...ctx.capabilities].sort(), actor.subject);
      assert.ok(ctx.capabilities.size > 0, `${actor.subject} holds nothing -- the proof would be vacuous`);
      const [state, counting] = countingOver(pgReader);
      for (const capabilityKey of [...ctx.capabilities].sort()) {
        const d = await composition.authorizeResolvedOperationalAction(counting, ctx, { capabilityKey });
        assert.equal(d.allowed, true, `${actor.subject} lost ${capabilityKey}`);
        assert.equal(d.contextEvaluated, false, `${actor.subject} acquired a context requirement on ${capabilityKey}`);
        assert.equal(d.viaCondition, false);
        assert.equal(d.viaGrantor.kind, "ROLE");
        assert.ok(actor.roleKeys.includes(d.viaGrantor.roleKey), `${capabilityKey} allowed via an unheld Role`);
      }
      assert.equal(state.reads, 0, `${actor.subject} caused ${state.reads} context reads with zero conditions`);
    }
  });

  await t.test("AJ3: reading conditions from PostgreSQL and from the shipped catalog decide identically", async () => {
    const viaShipped = await resolveFor(adminUser);
    const viaStored = await composition.resolveEntitledOperationalContext(
      repo, pool, { identityProvider: "firebase", externalSubject: adminUser.subject, requestedTenantId: null });
    assert.deepEqual(await viaStored.entitlements(), await viaShipped.entitlements());
    assert.deepEqual([...viaStored.capabilities].sort(), [...viaShipped.capabilities].sort());
    // And a database that cannot ANSWER refuses rather than reading as "unconditioned".
    const broken = { query: async () => { throw new Error("relation does not exist"); },
      connect: async () => { throw new Error("relation does not exist"); } };
    await assert.rejects(() => composition.resolveEntitledOperationalContext(
      repo, broken, { identityProvider: "firebase", externalSubject: adminUser.subject, requestedTenantId: null }));
  });

  // ════════════════════ AJ4 — MULTIPLE ENTITLEMENT PATHS ════════════════════

  await t.test("AJ4: an unconditional path is never denied because another Role's condition FAILED", async () => {
    // reorder.request.read is granted to technician AND purchasingManager by migration 1761696000000.
    assert.ok(holdersOf(REQUEST_READ).includes("technician") && holdersOf(REQUEST_READ).includes("purchasingManager"),
      "the fixture would prove nothing if one Role did not hold the key");
    // `bothRoles` is NOT PARTS_OPERATIONS eligible, so technician's condition CANNOT be satisfied.
    for (const [conditioned, allowingRole] of [["technician", "purchasingManager"], ["purchasingManager", "technician"]]) {
      await clearConditions();
      await storeCondition(`aj-multi-${conditioned}`, "ROLE", conditioned, REQUEST_READ,
        { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
      const catalog = await composition.postgresGrantConditions(pool, TENANT);
      assert.equal(catalog.size, 1);
      const ctx = await resolveFor(bothRoles, catalog);
      const reaching = model.entitlementsFor(await ctx.entitlements(), REQUEST_READ);
      assert.equal(reaching.length, 2, "both Roles reach the SAME capability key");
      assert.equal(reaching.filter((e) => e.condition !== null).length, 1, "exactly one path is conditioned");
      const [state, counting] = countingOver(pgReader);
      const d = await composition.authorizeResolvedOperationalAction(counting, ctx, { capabilityKey: REQUEST_READ });
      assert.equal(d.allowed, true, `the ${allowingRole} path was denied by ${conditioned}'s failed condition`);
      assert.deepEqual(d.viaGrantor, ROLE(allowingRole));
      assert.equal(d.viaCondition, false);
      assert.equal(state.reads, 0, "an unconditional path must cost nothing, whatever else failed");
      // The SAME caller holding ONLY the conditioned Role is refused, so the condition really binds.
      const onlyConditioned = { tenantId: TENANT, principalId: bothRoles.principalId, capabilities: ctx.capabilities,
        entitlements: async () => reaching.filter((e) => e.grantor.roleKey === conditioned) };
      const refused = await composition.authorizeOperationalAction(pgReader, onlyConditioned, { capabilityKey: REQUEST_READ });
      assert.equal(refused.allowed, false);
      assert.equal(refused.outcome, "WORK_ELIGIBILITY_MISSING");
    }
    await clearConditions();
  });

  await t.test("AJ4: two conditions, one satisfiable -- the UNION allows, and the refusals are kept", async () => {
    await storeCondition("aj-u-tech", "ROLE", "technician", REQUEST_READ, { paths: [[ELIGIBILITY("SERVICE_TECHNICIAN")]] });
    await storeCondition("aj-u-pm", "ROLE", "purchasingManager", REQUEST_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const catalog = await composition.postgresGrantConditions(pool, TENANT);
    const ctx = await resolveFor(bothRoles, catalog);
    assert.equal(model.hasUnconditionalEntitlement(await ctx.entitlements(), REQUEST_READ), false, "both paths must be conditioned");
    const d = await composition.authorizeResolvedOperationalAction(pgReader, ctx, { capabilityKey: REQUEST_READ });
    assert.equal(d.allowed, true);
    assert.deepEqual(d.viaGrantor, ROLE("technician"), "the satisfiable path carried it");
    assert.equal(d.viaCondition, true);
    assert.deepEqual(d.denials.map((x) => [x.grantor.roleKey, x.outcome]), [["purchasingManager", "WORK_ELIGIBILITY_MISSING"]]);
    await clearConditions();
  });

  // ════════════════════ AJ5 — THE TECHNICIAN PURCHASE ORDER DRY PROOF ════════════════════

  await t.test("AJ5: technician -> purchaseOrder.read/.create -> WORK_ELIGIBILITY(PARTS_OPERATIONS), expressed", async () => {
    // Measured in nonprod on 2026-09-24: 11 unconditional read holders, 5 create holders, technician
    // in neither. The same numbers the migration's VALUES list writes.
    assert.deepEqual(holdersOf(PO_READ), [...NONPROD_PO_READ_HOLDERS]);
    assert.deepEqual(holdersOf(PO_CREATE), [...NONPROD_PO_CREATE_HOLDERS]);
    assert.equal(holdersOf(PO_READ).includes("technician"), false);
    assert.equal(holdersOf(PO_CREATE).includes("technician"), false);

    await storeCondition("aj-po-read", "ROLE", "technician", PO_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    await storeCondition("aj-po-create", "ROLE", "technician", PO_CREATE, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const catalog = await composition.postgresGrantConditions(pool, TENANT);
    assert.equal(catalog.size, 2);
    assert.deepEqual(catalog.get(`ROLE:technician|${PO_READ}`).paths, [[ELIGIBILITY("PARTS_OPERATIONS")]]);

    // The eligible technician reaches both cells THROUGH the condition; the plain one does not.
    const eligible = await resolveFor(techEligible, catalog);
    const plain = await resolveFor(techPlain, catalog);
    for (const capabilityKey of [PO_READ, PO_CREATE]) {
      const yes = await composition.authorizeResolvedOperationalAction(pgReader, eligible, { capabilityKey });
      assert.equal(yes.allowed, true, capabilityKey);
      assert.equal(yes.viaCondition, true, "allowed THROUGH the condition, not around it");
      assert.deepEqual(yes.viaGrantor, ROLE("technician"));
      const no = await composition.authorizeResolvedOperationalAction(pgReader, plain, { capabilityKey });
      assert.equal(no.allowed, false, capabilityKey);
      assert.equal(no.outcome, "WORK_ELIGIBILITY_MISSING");
      assert.equal(no.predicate, "WORK_ELIGIBILITY");
    }

    // EVERY unconditional holder is untouched, and costs ZERO context reads.
    let checked = 0;
    for (const [capabilityKey, holders] of [[PO_READ, holdersOf(PO_READ)], [PO_CREATE, holdersOf(PO_CREATE)]]) {
      for (const roleKey of holders) {
        const entitlements = await composition.resolveRoleEntitlements(pool, TENANT, [roleKey], catalog);
        const actor = { tenantId: TENANT, principalId: techPlain.principalId,
          capabilities: model.capabilityKeysOf(entitlements), entitlements: async () => entitlements };
        const [state, counting] = countingOver(pgReader);
        const d = await composition.authorizeOperationalAction(counting, actor, { capabilityKey });
        assert.equal(d.allowed, true, `${roleKey} lost ${capabilityKey}`);
        assert.equal(d.contextEvaluated, false, `${roleKey} acquired a context requirement on ${capabilityKey}`);
        assert.equal(state.reads, 0, `${roleKey} caused a context read for ${capabilityKey}`);
        checked += 1;
      }
    }
    assert.equal(checked, 16, "eleven read holders plus five create holders");

    // AND IT IS STILL WITHHELD. A stored catalog naming either cell cannot reach a deployed decision.
    assert.throws(() => model.assertNoWithheldGrantConditions(catalog), /WITHHELD conditioned cell/);
    await assert.rejects(() => composition.resolveEntitledOperationalContext(
      repo, pool, { identityProvider: "firebase", externalSubject: techEligible.subject, requestedTenantId: null }),
    /WITHHELD conditioned cell/, "the production resolver accepted a withheld cell");
    assert.equal(model.SHIPPED_GRANT_CONDITIONS.size, 0, "the shipped catalog grew a condition");

    await clearConditions();
    assert.equal(await conditionRowCount(), 0, "the dry proof left a row behind");
  });

  // ════════════════════ AJ6 — THE RUNTIME SEAM ════════════════════

  await t.test("AJ6: the transport carries the entitlement metadata onto the actor the kernels gate on", async () => {
    const ctx = await resolveFor(adminUser);
    // A REQUIRED RESOLVER, not a value -- and it still resolves to the same entitlements.
    assert.equal(typeof ctx.entitlements, "function");
    const resolved = await ctx.entitlements();
    assert.ok(Array.isArray(resolved) && resolved.length > 0);
    assert.ok(model.hasResolvedEntitlements(ctx));
    assert.equal(model.hasResolvedEntitlements({ capabilities: ctx.capabilities }), false);
    // STRICTER THAN AJ: a bare array no longer discharges the obligation. Under the previous check
    // `entitlements: []` passed this gate; it is now refused, and so is a hand-built list.
    assert.equal(model.hasResolvedEntitlements({ capabilities: ctx.capabilities, entitlements: [] }), false);
    assert.equal(model.hasResolvedEntitlements({ capabilities: ctx.capabilities, entitlements: resolved }), false);
    // Source-level, because this is the property that makes the seam real rather than available:
    // the transport puts the resolved entitlements on the actor it hands every runner.
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosWorkforce/workforceHttp.ts"), "utf8");
    assert.match(src, /entitlements: ctx\.entitlements/);
    for (const file of ["src/eosWorkforce/reads/employeeReadKernel.ts", "src/eosWorkforce/commands/employeeCommandKernel.ts"]) {
      const kernel = readFileSync(resolve(FUNCTIONS_DIR, file), "utf8");
      assert.match(kernel, /hasResolvedEntitlements\(actor\)/, `${file} does not require resolved entitlements`);
      assert.match(kernel, /authorizeEntitledAction\(/, `${file} does not reach the conditional decision`);
      // The flat check is still there, still first, and still unchanged.
      assert.match(kernel, /actor\.capabilities\.has\(/, `${file} replaced the flat gate instead of layering on it`);
    }
  });

  await t.test("AJ6: a REQUEST reaches a conditional decision -- refused, then allowed, over one stored row", async () => {
    const deps = { reader: repo, pool, allowedOrigins: [],
      verifyToken: async (token) => {
        const subject = TOKENS.get(token);
        if (!subject) throw new Error("invalid token");
        return { externalSubject: subject, identityProvider: "firebase" };
      } };
    const call = async (actor, extraDeps = {}) => {
      const res = await workforceHttp.handleWorkforceRequest({ ...deps, ...extraDeps }, {
        method: "POST", url: "/workforce/employees", headers: { authorization: `Bearer ${actor.token}` },
        body: JSON.stringify({ operation: "readEmployeePrincipalLink", input: { employeeId: "emp-admin" } }),
      });
      return { status: res.status, body: JSON.parse(res.body) };
    };

    // 1. The deployed composition: the SHIPPED (empty) catalog. Allowed.
    const shipped = await call(adminUser);
    assert.equal(shipped.status, 200, JSON.stringify(shipped.body));

    // 2. The SAME request, reading conditions from PostgreSQL with ZERO rows. Byte-identical.
    assert.equal(await conditionRowCount(), 0);
    const storedEmpty = await call(adminUser, { grantConditionSource: "POSTGRES" });
    assert.deepEqual([storedEmpty.status, storedEmpty.body], [shipped.status, shipped.body],
      "switching the condition source changed a decision while the relation was empty");

    // 3. ONE row: admin's grant of admin.principalAccess.read, narrowed by WORK_ELIGIBILITY. The
    //    admin Principal's Employee holds no qualification, so the SAME request is now REFUSED --
    //    by the governed eos_workforce authority, reached from an HTTP request.
    await storeCondition("aj-seam", "ROLE", "admin", PRINCIPAL_ACCESS_READ,
      { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const refused = await call(adminUser, { grantConditionSource: "POSTGRES" });
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "CAPABILITY_CONDITION_UNSATISFIED");
    assert.match(refused.body.message, new RegExp(`${PRINCIPAL_ACCESS_READ}: WORK_ELIGIBILITY_MISSING`));
    // The SHIPPED composition is untouched by the row: activation is a code change, not a row.
    assert.equal((await call(adminUser)).status, 200, "the stored row bound a composition that did not ask for it");

    // 4. Grant the governed fact the condition names. The SAME request now succeeds.
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ('we-aj-seam',$1,'emp-admin','PARTS_OPERATIONS',now(),'fixture')`, [TENANT]);
    const allowed = await call(adminUser, { grantConditionSource: "POSTGRES" });
    assert.deepEqual([allowed.status, allowed.body], [shipped.status, shipped.body],
      "the condition was satisfied and the read still did not answer");

    // 5. RETIRE the row rather than deleting it: a retired condition is not a condition.
    await q(`UPDATE eos_policy.capability_grant_conditions SET status='RETIRED' WHERE id='aj-seam'`);
    // The eligibility authority keeps history: a qualification is ENDED, never deleted.
    await q(`UPDATE eos_workforce.employee_work_eligibility
                SET effective_to = now(), ended_by = 'fixture', ended_at = now() WHERE id='we-aj-seam'`);
    assert.equal((await call(adminUser, { grantConditionSource: "POSTGRES" })).status, 200);
    await clearConditions();
    assert.equal(await conditionRowCount(), 0, "the seam proof left a row behind");
  });

  await t.test("AJ6: an actor without entitlements is REFUSED, never decided on the flat set alone", async () => {
    const ctx = await resolveFor(adminUser);
    const read = require("../lib/eosWorkforce/reads/employeePrincipalLinkRead.js");
    const stripped = { tenantId: ctx.principalContext.tenantId, principalId: ctx.principalContext.uid,
      capabilities: ctx.capabilities };
    await assert.rejects(() => read.readEmployeePrincipalLink({ pool }, stripped, { employeeId: "emp-admin" }),
      (e) => e.code === "ACTOR_CONTEXT_REQUIRED");
    // The same actor WITH its entitlements is allowed, so the refusal is about the metadata and
    // nothing else.
    const whole = { ...stripped, entitlements: ctx.entitlements };
    assert.ok(await read.readEmployeePrincipalLink({ pool }, whole, { employeeId: "emp-admin" }));
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// AQ — LAZY CONDITIONAL ENTITLEMENT. The Owner's evaluation order, proved with DETERMINISTIC
// COUNTERS rather than wall-clock: integers counted off the pool and off the request's own context,
// on a real PostgreSQL, with no timing anywhere.
//
// WHAT CHANGED, AND WHAT DID NOT. Lane AJ put the conditional-entitlement metadata on the request
// path for the EOS transports, and made it a REQUIRED field because "an optional field is a
// caller-controlled bypass". That reasoning is kept in full. What moved is the WORK, not the DUTY:
// `entitlements` is now a required RESOLVER rather than a required VALUE, so a request that never
// asks the question never pays for its answer -- and a caller still cannot omit the obligation,
// still cannot satisfy it with a stale array, and still cannot make an unreadable store read as
// "unconditioned".
//
// THE MEASURED BEFORE, from the same probe that produced the AFTER numbers pinned below:
//
//   scenario                                     capSet  provenance  condition  principal  queries
//   seam, SHIPPED, gate site never asks             1        1           0          1         12
//   seam, SHIPPED, gate site asks                   1        1           0          1         12
//   seam, POSTGRES, gate site never asks            1        1           1          2         23
//   seam, POSTGRES, gate site asks                  1        1           1          2         23
//   whole workforce HTTP request, SHIPPED           1        1           0          1         17
//   whole workforce HTTP request, POSTGRES          1        1           1          2         28
//
// Eleven of the thirteen gate sites read `capabilities.has(key)` and nothing else, so that
// `provenance` column was a per-request indexed read of `role_capabilities` bought for nobody; and
// the POSTGRES composition resolved the principal TWICE, once only to learn the tenant its
// condition catalog needed.
// ════════════════════════════════════════════════════════════════════════════════════════════════

test("AQ: LAZY conditional entitlement -- the Owner's order, counted", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `laneaq_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);
  const repo = new PostgresPolicyRepository(pool);

  const TENANT = "t-lane-aq";
  const COMPANY = "sample-co-synthetic";
  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','lane-aq','fixture','fixture')`, [TENANT, COMPANY]);
  // WAVE 10 / LANE AR: migration 1762214400000 is on this lineage as of v7 and the chain above
  // already created this relation, so the lane's own CREATE would now fail as a duplicate. The
  // relation it produces is proved identical to the declaration in the AJ2 block above.

  const fixture = { tenantId: TENANT, uid: "uid-lane-aq" };
  const ROLE_KEYS = [...new Set([...MIGRATION_GRANTS.map((g) => g.roleKey), "technician", "purchasingManager", "admin"])].sort();
  const roleIds = {};
  for (const key of ROLE_KEYS) {
    roleIds[key] = (await repo.transact(fixture, (tx) =>
      tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }))).id;
  }
  const grantId = (roleKey, capabilityKey) => `rc-${roleKey}-${capabilityKey}`.slice(0, 60);
  const grant = async (roleKey, capabilityKey) => {
    const r = await q(
      `INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
       SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $4
       ON CONFLICT DO NOTHING`,
      [grantId(roleKey, capabilityKey), TENANT, roleIds[roleKey], capabilityKey]);
    assert.equal(r.rowCount, 1, `${capabilityKey} is not in the capability vocabulary`);
  };
  for (const g of MIGRATION_GRANTS) await grant(g.roleKey, g.capabilityKey);
  await grant("technician", PO_READ);
  await grant("technician", PO_CREATE);
  await grant("admin", PRINCIPAL_ACCESS_READ);

  const makePrincipal = async (subject, roleKeys) => {
    const principalId = await repo.transact(fixture, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    for (const roleKey of roleKeys) {
      await repo.transact(fixture, async (tx) => {
        const accessVersion = await tx.bumpAccessVersion(principalId);
        return tx.createAssignment({ principalId, roleId: roleIds[roleKey], scopeType: "global", scopeValue: null,
          status: "active", grantedBy: "fixture", grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion });
      });
    }
    return { principalId, subject, roleKeys };
  };
  const linkEmployee = async (key, principalId, eligibility = []) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [`emp-${key}`, TENANT, COMPANY, `AQ-${key}`.slice(0, 32)]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','lane aq fixture')`,
    [`lnk-${key}`.slice(0, 60), TENANT, principalId, `emp-${key}`, COMPANY]);
    for (const code of eligibility) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility
                 (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
               VALUES ($1,$2,$3,$4,now(),'fixture')`, [`we-${key}-${code}`.slice(0, 60), TENANT, `emp-${key}`, code]);
    }
  };
  const adminUser = await makePrincipal("uid-aq-admin", ["admin"]);
  const bothRoles = await makePrincipal("uid-aq-both", ["technician", "purchasingManager"]);
  await linkEmployee("admin", adminUser.principalId, []);
  await linkEmployee("both", bothRoles.principalId, ["SERVICE_TECHNICIAN"]);

  const storeCondition = (id, scope, grantorKey, capabilityKey, condition, status = "ACTIVE") =>
    q(`INSERT INTO eos_policy.capability_grant_conditions
         (id,tenant_id,grant_scope,grantor_key,capability_key,condition,status,established_by,updated_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'lane-aq','lane-aq')`,
    [id, TENANT, scope, grantorKey, capabilityKey, JSON.stringify(condition), status]);
  const clearConditions = () => q(`DELETE FROM eos_policy.capability_grant_conditions`);
  const conditionRowCount = async () =>
    (await q(`SELECT count(*)::int n FROM eos_policy.capability_grant_conditions`)).rows[0].n;

  // ════════════════════ THE INSTRUMENT ════════════════════
  //
  // Every query one request issues, bucketed by the relation its SQL names. Integers only: no
  // clock, no wall time, nothing that varies between runs or between machines. `grantProvenance`
  // is the second `role_capabilities` read AJ added; `capabilitySet` is the one that was always
  // there; `conditionCatalog` is the read of the condition relation itself.
  const countingPool = (inner) => {
    const counts = { capabilitySet: 0, grantProvenance: 0, conditionCatalog: 0, principalContext: 0, total: 0 };
    const reset = () => { for (const k of Object.keys(counts)) counts[k] = 0; };
    const note = (sql) => {
      const s = String(sql ?? "");
      counts.total += 1;
      if (/role_capabilities/.test(s) && /SELECT DISTINCT c\.key/.test(s)) counts.capabilitySet += 1;
      else if (/role_capabilities/.test(s) && /r\.key AS role_key/.test(s)) counts.grantProvenance += 1;
      else if (/capability_grant_conditions/.test(s) && /^\s*SELECT/.test(s)) counts.conditionCatalog += 1;
      else if (/FROM eos_policy\.principals|principal_role_assignments/.test(s)) counts.principalContext += 1;
    };
    const wrap = (target, withConnect) => new Proxy(target, {
      get(tgt, prop, recv) {
        if (prop === "query") return (...a) => { note(typeof a[0] === "string" ? a[0] : a[0]?.text); return tgt.query(...a); };
        if (withConnect && prop === "connect") return async () => wrap(await tgt.connect(), false);
        const v = Reflect.get(tgt, prop, recv);
        return typeof v === "function" ? v.bind(tgt) : v;
      },
    });
    return { db: wrap(inner, true), counts, reset, snap: () => ({ ...counts }) };
  };
  const countingReader = (inner) => {
    const state = { reads: 0 };
    return [state, {
      linkedEmployeeId: async (...a) => { state.reads += 1; return inner.linkedEmployeeId(...a); },
      hasWorkEligibility: async (...a) => { state.reads += 1; return inner.hasWorkEligibility(...a); },
      hasOperationalScope: async (...a) => { state.reads += 1; return inner.hasOperationalScope(...a); },
      isAssignedEmployee: async (...a) => { state.reads += 1; return inner.isAssignedEmployee(...a); },
    }];
  };
  const pgReader = evaluator.postgresContextualReader(pool);
  const inputFor = (a) => ({ identityProvider: "firebase", externalSubject: a.subject, requestedTenantId: null });
  /** One instrumented REQUEST: its own counting pool, its own context, its own counters. */
  const request = async (actor, { source = "SHIPPED" } = {}) => {
    const m = countingPool(pool);
    const resolver = source === "POSTGRES"
      ? composition.resolveEntitledOperationalContext : capabilityAuthority.resolveOperationalContext;
    const ctx = await resolver(new PostgresPolicyRepository(m.db), m.db, inputFor(actor));
    return { ctx, m, resolved: m.snap() };
  };

  // ════════════════════ AQ2 — THE OWNER'S EVALUATION ORDER ════════════════════

  await t.test("AQ2 step 1: a capability the actor does NOT hold reads NOTHING -- no context, no condition, no grant", async () => {
    const { ctx, m } = await request(adminUser);
    m.reset();
    const [state, reader] = countingReader(pgReader);
    const d = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: "inventory.cycleCount.create" });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "CAPABILITY_MISSING", "the refusal changed shape");
    assert.equal(d.contextEvaluated, false);
    // THE LAZINESS, MECHANICALLY: the resolver was never even ASKED, so no store was touched.
    assert.equal(ctx.lookups.requests, 0, "a missing capability asked for entitlements it could not use");
    assert.equal(ctx.lookups.resolutions, 0);
    assert.deepEqual(m.snap(), { capabilitySet: 0, grantProvenance: 0, conditionCatalog: 0, principalContext: 0, total: 0 });
    assert.equal(state.reads, 0);
  });

  await t.test("AQ2 steps 2 and 3: a valid UNCONDITIONAL path allows with NO condition lookup and NO context read", async () => {
    assert.equal(await conditionRowCount(), 0);
    const { ctx, m } = await request(adminUser);
    m.reset();
    const [state, reader] = countingReader(pgReader);
    const d = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: PRINCIPAL_ACCESS_READ });
    assert.equal(d.allowed, true);
    assert.equal(d.viaCondition, false, "allowed AROUND the conditional machinery, not through it");
    assert.equal(d.contextEvaluated, false, "an unconditional path consulted a context authority");
    assert.deepEqual(d.viaGrantor, ROLE("admin"));
    const after = m.snap();
    // The obligation IS discharged -- one provenance read, because the decision must know WHO
    // granted the key before it may call that grant unconditional.
    assert.equal(ctx.lookups.resolutions, 1);
    assert.equal(after.grantProvenance, 1);
    // ...and NOTHING conditional was looked up: zero condition rows read, zero context reads.
    assert.equal(after.conditionCatalog, 0, "the deployed path read the condition relation");
    assert.equal(state.reads, 0, "an unconditional allow cost a context read");
  });

  // ════════════════════ AQ4 — THE ZERO-ROW FAST PATH ════════════════════

  await t.test("AQ4: with ZERO condition rows the ordinary path costs ONE provenance read and nothing else", async () => {
    assert.equal(await conditionRowCount(), 0);
    for (const actor of [adminUser, bothRoles]) {
      const { ctx, m } = await request(actor);
      assert.ok(ctx.capabilities.size > 0, "the proof would be vacuous");
      m.reset();
      const [state, reader] = countingReader(pgReader);
      for (const capabilityKey of [...ctx.capabilities].sort()) {
        const d = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey });
        assert.equal(d.allowed, true, `${actor.subject} lost ${capabilityKey}`);
        assert.equal(d.contextEvaluated, false, `${actor.subject} acquired a context requirement on ${capabilityKey}`);
        assert.equal(d.viaCondition, false);
      }
      const after = m.snap();
      // EVERY held capability, decided, for ONE read of the grant store and ZERO of anything else.
      assert.equal(after.grantProvenance, 1, `${actor.subject}: ${ctx.capabilities.size} checks cost ${after.grantProvenance} provenance reads`);
      assert.equal(after.conditionCatalog, 0, `${actor.subject}: the zero-row relation was read anyway`);
      assert.equal(after.total, 1, `${actor.subject}: conditional entitlement cost ${after.total} queries with no conditions in force`);
      assert.equal(state.reads, 0, `${actor.subject}: ${state.reads} context reads with zero conditions`);
      // And the two resolvers still agree, key for key, which is the adoption contract.
      assert.deepEqual([...model.capabilityKeysOf(await ctx.entitlements())].sort(), [...ctx.capabilities].sort());
    }
  });

  await t.test("AQ4: a transport whose gate sites only read the flat Set resolves NO entitlements at all", async () => {
    // This is the shape eleven of the thirteen gate sites run -- catalogMasterKernel,
    // commercialCommandKernel, commercialReadKernel, accountAuthority, crmAuthorityKernel,
    // employeeChangeHistoryRead, reorderAssignmentAuthority, workOrderAssignmentAuthority,
    // workOrderLifecycle, workOrderCreateCommand, workOrderPartsPlanAuthority -- and every one of
    // the non-Workforce transports. BEFORE: one provenance read per request, for nobody.
    const { ctx, resolved } = await request(bothRoles);
    assert.equal(ctx.capabilities.has(REQUEST_READ), true, "the flat gate still answers");
    assert.equal(resolved.capabilitySet, 1, "the flat capability set is still resolved eagerly, as every gate site needs it");
    assert.equal(resolved.grantProvenance, 0, "a request nobody asked still paid for the provenance read");
    assert.equal(resolved.conditionCatalog, 0);
    assert.equal(resolved.principalContext, 1, "the principal was resolved more than once");
    assert.equal(ctx.lookups.requests, 0);
    assert.equal(ctx.lookups.resolutions, 0);
  });

  // ════════════════════ AQ3 — REQUEST-SCOPED MEMOIZATION, AND NOTHING LONGER ════════════════════

  await t.test("AQ3: N asks in ONE request cost ONE resolution", async () => {
    const { ctx, m } = await request(adminUser);
    m.reset();
    const keys = [...ctx.capabilities].sort();
    assert.ok(keys.length >= 2, "the proof needs more than one capability");
    // Ask for the SAME capability repeatedly, then for DIFFERENT ones, then the resolver directly.
    for (let i = 0; i < 3; i += 1) await composition.authorizeResolvedOperationalAction(pgReader, ctx, { capabilityKey: keys[0] });
    for (const capabilityKey of keys) await composition.authorizeResolvedOperationalAction(pgReader, ctx, { capabilityKey });
    await ctx.entitlements();
    await ctx.entitlements();
    const asks = 3 + keys.length + 2;
    assert.equal(ctx.lookups.requests, asks, "the counter did not see every ask");
    assert.equal(ctx.lookups.resolutions, 1, `${asks} asks caused ${ctx.lookups.resolutions} resolutions`);
    assert.equal(m.snap().grantProvenance, 1);
    assert.equal(m.snap().conditionCatalog, 0);
    // The memoized value is the SAME object, not an equal copy: nothing re-derives per ask.
    assert.equal(await ctx.entitlements(), await ctx.entitlements());
  });

  await t.test("AQ3: NOTHING is memoized across requests -- no TTL, no global cache, no invalidation", async () => {
    // Two requests for the SAME principal each resolve for themselves.
    const first = await request(adminUser);
    await first.ctx.entitlements();
    const second = await request(adminUser);
    await second.ctx.entitlements();
    assert.equal(first.ctx.lookups.resolutions, 1);
    assert.equal(second.ctx.lookups.resolutions, 1, "the second request reused the first request's answer");
    assert.notEqual(first.ctx.entitlements, second.ctx.entitlements, "two requests shared one resolver");
    assert.equal(second.m.snap().grantProvenance, 1, "the second request read the grant store zero times: it was cached");

    // A grant CHANGED between two requests is visible to the next one IMMEDIATELY. A cache with a
    // TTL could not pass this; a cache needing invalidation would have to be told.
    const UNHELD = "inventory.cycleCount.create";
    const before = await request(adminUser);
    assert.equal(model.hasUnconditionalEntitlement(await before.ctx.entitlements(), UNHELD), false,
      "the fixture already granted the key -- the proof would be vacuous");
    await grant("admin", UNHELD);
    const after = await request(adminUser);
    assert.equal(model.hasUnconditionalEntitlement(await after.ctx.entitlements(), UNHELD), true,
      "a grant ADDED between two requests was not seen: something is cached across requests");
    assert.equal(after.ctx.capabilities.has(UNHELD), true, "the flat set is resolved per request too");
    await q(`DELETE FROM eos_policy.role_capabilities WHERE id = $1`, [grantId("admin", UNHELD)]);
    const restored = await request(adminUser);
    assert.equal(model.hasUnconditionalEntitlement(await restored.ctx.entitlements(), UNHELD), false,
      "a grant REMOVED between two requests was not seen: a stale cache would be a widening");
    assert.equal(restored.ctx.capabilities.has(UNHELD), false);
  });

  // ════════════════════ AQ6 — THE PERFORMANCE PROOF ════════════════════

  await t.test("AQ6: the four scenarios, before and after, as exact query counts", async () => {
    // The BEFORE numbers are the measured ones in this block's header; AFTER is asserted here.
    // 1. AN ORDINARY REQUEST whose gate sites never reach the entitled decision. 2 -> 1.
    const ordinary = (await request(bothRoles)).resolved;
    assert.equal(ordinary.capabilitySet + ordinary.grantProvenance, 1, "BEFORE 2 role_capabilities reads, AFTER 1");
    assert.equal(ordinary.total, 11, "BEFORE 12 queries, AFTER 11");

    // 2. AN UNCONDITIONAL CAPABILITY, decided. The provenance read MOVED to the ask; it did not
    //    multiply. A request that does ask still costs exactly what it cost before.
    const u = await request(adminUser);
    await composition.authorizeResolvedOperationalAction(pgReader, u.ctx, { capabilityKey: PRINCIPAL_ACCESS_READ });
    assert.equal(u.m.snap().total, 12, "BEFORE 12 queries, AFTER 12 -- the work moved, it did not grow");
    assert.equal(u.m.snap().grantProvenance, 1);
    assert.equal(u.m.snap().conditionCatalog, 0);

    // 3. A CONDITIONAL CAPABILITY, over the POSTGRES condition source. The duplicate principal
    //    resolution is gone: 23 -> 13.
    await clearConditions();
    await storeCondition("aq-perf", "ROLE", "admin", PRINCIPAL_ACCESS_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const c = await request(adminUser, { source: "POSTGRES" });
    assert.equal(c.resolved.principalContext, 1, "BEFORE 2 principal resolutions, AFTER 1");
    assert.equal(c.resolved.conditionCatalog, 1, "the withheld-cell guard must still read the relation here");
    assert.equal(c.resolved.total, 13, "BEFORE 23 queries, AFTER 13");
    c.m.reset();
    const [state, reader] = countingReader(pgReader);
    const d = await composition.authorizeResolvedOperationalAction(reader, c.ctx, { capabilityKey: PRINCIPAL_ACCESS_READ });
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "WORK_ELIGIBILITY_MISSING", "the condition stopped binding");
    assert.equal(d.contextEvaluated, true);
    assert.equal(c.m.snap().total, 0, "deciding a conditional capability re-read the policy stores");
    assert.ok(state.reads > 0, "a conditional decision must consult the governed authority");

    // 4. THE SAME CAPABILITY CHECKED REPEATEDLY IN ONE REQUEST. Still one resolution, still zero
    //    further policy reads.
    c.m.reset();
    for (let i = 0; i < 4; i += 1) await composition.authorizeResolvedOperationalAction(pgReader, c.ctx, { capabilityKey: PRINCIPAL_ACCESS_READ });
    assert.equal(c.m.snap().total, 0, "a repeated check re-read the policy stores");
    assert.equal(c.ctx.lookups.resolutions, 1);
    await clearConditions();
  });

  // ════════════════════ AQ5 — MULTI-PATH CORRECTNESS, ORDER-INDEPENDENT ════════════════════

  await t.test("AQ5: an UNCONDITIONAL path allows even when another path's condition fails -- both ways round", async () => {
    assert.ok(holdersOf(REQUEST_READ).includes("technician") && holdersOf(REQUEST_READ).includes("purchasingManager"));
    for (const [conditioned, allowingRole] of [["technician", "purchasingManager"], ["purchasingManager", "technician"]]) {
      await clearConditions();
      await storeCondition(`aq-multi-${conditioned}`, "ROLE", conditioned, REQUEST_READ,
        { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
      // `bothRoles` holds no PARTS_OPERATIONS eligibility, so the conditioned path CANNOT succeed.
      const { ctx, m } = await request(bothRoles, { source: "POSTGRES" });
      const reaching = model.entitlementsFor(await ctx.entitlements(), REQUEST_READ);
      assert.equal(reaching.length, 2, "both Roles reach the SAME capability key");
      assert.equal(reaching.filter((e) => e.condition !== null).length, 1, "exactly one path is conditioned");
      m.reset();
      const [state, reader] = countingReader(pgReader);
      const d = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: REQUEST_READ });
      assert.equal(d.allowed, true, `the ${allowingRole} path was denied by ${conditioned}'s failed condition`);
      assert.deepEqual(d.viaGrantor, ROLE(allowingRole));
      assert.equal(d.viaCondition, false);
      assert.equal(state.reads, 0, "an unconditional path must cost nothing, whatever else failed");
      assert.equal(m.snap().total, 0, "the decision re-read a store the request had already resolved");
      // And the SAME caller holding ONLY the conditioned path is refused, so the condition binds.
      const onlyConditioned = { tenantId: TENANT, principalId: bothRoles.principalId, capabilities: ctx.capabilities,
        entitlements: async () => reaching.filter((e) => e.grantor.roleKey === conditioned) };
      const refused = await composition.authorizeOperationalAction(pgReader, onlyConditioned, { capabilityKey: REQUEST_READ });
      assert.equal(refused.allowed, false);
      assert.equal(refused.outcome, "WORK_ELIGIBILITY_MISSING");
    }
    await clearConditions();
  });

  await t.test("AQ5: a CONDITIONAL-ONLY path evaluates context, and no valid path fails closed", async () => {
    await clearConditions();
    // Both Roles conditioned: there is no unconditional path, so the context MUST be consulted.
    await storeCondition("aq-only-t", "ROLE", "technician", REQUEST_READ, { paths: [[ELIGIBILITY("SERVICE_TECHNICIAN")]] });
    await storeCondition("aq-only-p", "ROLE", "purchasingManager", REQUEST_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const { ctx } = await request(bothRoles, { source: "POSTGRES" });
    assert.equal(model.hasUnconditionalEntitlement(await ctx.entitlements(), REQUEST_READ), false);
    const [state, reader] = countingReader(pgReader);
    const d = await composition.authorizeResolvedOperationalAction(reader, ctx, { capabilityKey: REQUEST_READ });
    assert.equal(d.allowed, true, "the satisfiable path did not carry it");
    assert.equal(d.viaCondition, true);
    assert.deepEqual(d.viaGrantor, ROLE("technician"));
    assert.ok(state.reads > 0, "a conditional-only path decided without consulting the context authority");
    assert.deepEqual(d.denials.map((x) => [x.grantor.roleKey, x.outcome]), [["purchasingManager", "WORK_ELIGIBILITY_MISSING"]],
      "the other path's refusal was lost");

    // NO VALID PATH -> fails closed, and never back onto the flat set.
    await clearConditions();
    // GOVERNED codes this actor does not hold: `bothRoles` carries SERVICE_TECHNICIAN and nothing
    // else. An UNGOVERNED code would report WORK_ELIGIBILITY_UNMAPPED, which is the platform
    // admitting it cannot decide rather than a statement about the caller.
    await storeCondition("aq-none-t", "ROLE", "technician", REQUEST_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    await storeCondition("aq-none-p", "ROLE", "purchasingManager", REQUEST_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const closed = await request(bothRoles, { source: "POSTGRES" });
    assert.equal(closed.ctx.capabilities.has(REQUEST_READ), true, "the FLAT set still says held -- which is the whole point");
    const refused = await composition.authorizeResolvedOperationalAction(pgReader, closed.ctx, { capabilityKey: REQUEST_READ });
    assert.equal(refused.allowed, false, "no path was valid and the caller was still admitted");
    assert.equal(refused.outcome, "WORK_ELIGIBILITY_MISSING");
    assert.equal(refused.denials.length, 2);
    await clearConditions();
  });

  // ════════════════════ AQ — THE BYPASS THAT MUST NOT COME BACK ════════════════════

  await t.test("AQ: laziness did NOT reintroduce the caller-controlled bypass", async () => {
    const { ctx } = await request(adminUser);
    const base = { tenantId: TENANT, principalId: adminUser.principalId, capabilities: ctx.capabilities };
    const held = PRINCIPAL_ACCESS_READ;
    assert.equal(ctx.capabilities.has(held), true, "the flat set says HELD for every case below");

    // 1. THE OBLIGATION IS NOT OPTIONAL. An actor that simply omits it is refused, not decided on
    //    the flat set -- exactly as AJ left it.
    assert.equal(model.hasResolvedEntitlements(base), false);
    const omitted = await composition.authorizeOperationalAction(pgReader, base, { capabilityKey: held });
    assert.equal(omitted.allowed, false, "an actor with no entitlement obligation was ALLOWED");
    assert.equal(omitted.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");

    // 2. AND IT IS NOW STRICTER: a VALUE no longer discharges it. Under AJ's check any array passed,
    //    including an empty one and including a hand-built one that says "unconditioned".
    const real = await ctx.entitlements();
    for (const [label, value] of [["empty array", []], ["the REAL entitlements, as a value", real],
      ["a fabricated unconditional grant", [{ capabilityKey: held, grantor: ROLE("admin"), condition: null }]]]) {
      assert.equal(model.hasResolvedEntitlements({ ...base, entitlements: value }), false, label);
      const d = await composition.authorizeOperationalAction(pgReader, { ...base, entitlements: value }, { capabilityKey: held });
      assert.equal(d.allowed, false, `${label} was ALLOWED`);
      assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE", label);
    }

    // 3. A RESOLVER THAT CANNOT ANSWER FAILS CLOSED. "The store could not be read" is never "then
    //    there are no conditions" -- the parity defect this repository has already paid for once.
    const broken = await composition.authorizeOperationalAction(pgReader,
      { ...base, entitlements: async () => { throw new Error("relation does not exist"); } }, { capabilityKey: held });
    assert.equal(broken.allowed, false, "an unreadable condition store read as UNCONDITIONED");
    assert.equal(broken.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
    assert.equal(broken.contextEvaluated, false);

    // 4. A RESOLVER THAT ANSWERS "NOTHING" IS A DISAGREEMENT, AND THE STRICTER ANSWER WINS.
    const empty = await composition.authorizeOperationalAction(pgReader,
      { ...base, entitlements: async () => [] }, { capabilityKey: held });
    assert.equal(empty.allowed, false, "the flat set said held, the provenance resolver said nobody granted it, and it ALLOWED");
    assert.equal(empty.outcome, "CAPABILITY_MISSING");

    // 5. A RESOLVER THAT ANSWERS RUBBISH IS AN OUTAGE, NOT A PASS.
    for (const junk of [null, undefined, "unconditioned", {}, 7]) {
      const d = await composition.authorizeOperationalAction(pgReader,
        { ...base, entitlements: async () => junk }, { capabilityKey: held });
      assert.equal(d.allowed, false, `a resolver returning ${JSON.stringify(junk) ?? "undefined"} was ALLOWED`);
      assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
    }

    // 6. THE WHOLE CONTEXT FAILS CLOSED when the stores are unreadable, on both compositions.
    const dead = { query: async () => { throw new Error("connection terminated unexpectedly"); },
      connect: async () => { throw new Error("connection terminated unexpectedly"); } };
    await assert.rejects(() => capabilityAuthority.resolveOperationalContext(repo, dead, inputFor(adminUser)));
    await assert.rejects(() => composition.resolveEntitledOperationalContext(repo, dead, inputFor(adminUser)));
    // A pool that answers the flat set but NOT the condition relation must still refuse: the lazy
    // resolver propagates the failure rather than resolving to "unconditioned".
    const noRelation = await capabilityAuthority.resolveOperationalContext(repo, pool, inputFor(adminUser),
      async () => { throw new Error("relation eos_policy.capability_grant_conditions does not exist"); });
    await assert.rejects(() => noRelation.entitlements(), /does not exist/);
    const stillRefused = await composition.authorizeResolvedOperationalAction(pgReader, noRelation, { capabilityKey: held });
    assert.equal(stillRefused.allowed, false, "an unreadable condition source allowed a request");
    assert.equal(stillRefused.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");

    // 7. A MISCOMPOSED SERVER -- the old catalog argument -- refuses at COMPOSITION, not one request later.
    await assert.rejects(() => capabilityAuthority.resolveOperationalContext(repo, pool, inputFor(adminUser),
      model.SHIPPED_GRANT_CONDITIONS), /GrantConditionProvider/);
  });

  await t.test("AQ: the flat gate still runs FIRST and both refusal codes are still distinct", async () => {
    for (const file of ["src/eosWorkforce/reads/employeeReadKernel.ts", "src/eosWorkforce/commands/employeeCommandKernel.ts"]) {
      const kernel = readFileSync(resolve(FUNCTIONS_DIR, file), "utf8");
      assert.match(kernel, /hasResolvedEntitlements\(actor\)/, `${file} dropped the obligation check`);
      assert.match(kernel, /actor\.capabilities\.has\(/, `${file} replaced the flat gate instead of layering on it`);
      assert.match(kernel, /authorizeEntitledAction\(/, `${file} does not reach the conditional decision`);
      // The flat refusal must still be REACHED first: order is the guarantee that the new path can
      // only ever refuse further.
      assert.ok(kernel.indexOf(`refuse("CAPABILITY_REQUIRED"`) < kernel.indexOf(`refuse("CAPABILITY_CONDITION_UNSATISFIED"`),
        `${file}: the conditional refusal now precedes the flat one`);
    }
    // The resolver choice is still SERVER composition, never a request field.
    const http = readFileSync(resolve(FUNCTIONS_DIR, "src/eosWorkforce/workforceHttp.ts"), "utf8");
    assert.match(http, /deps\.grantConditionSource === "POSTGRES"/);
    assert.doesNotMatch(http, /request\.[A-Za-z.]*grantConditionSource|caller\.[A-Za-z.]*grantCondition/);
    assert.match(http, /entitlements: ctx\.entitlements/);
  });

  await t.test("AQ: the two Purchase Order cells are STILL withheld, lazily resolved or not", async () => {
    await clearConditions();
    await storeCondition("aq-po-read", "ROLE", "technician", PO_READ, { paths: [[ELIGIBILITY("PARTS_OPERATIONS")]] });
    const catalog = await composition.postgresGrantConditions(pool, TENANT);
    assert.equal(catalog.size, 1);
    assert.throws(() => model.assertNoWithheldGrantConditions(catalog), /WITHHELD conditioned cell/);
    // THE PRODUCTION RESOLVER STILL REJECTS. Laziness did not push this guard out to whichever gate
    // site happens to ask: resolveEntitledOperationalContext discharges the obligation itself, so a
    // withheld cell is seen HERE, on every request, whether any gate site goes on to ask or not.
    await assert.rejects(() => composition.resolveEntitledOperationalContext(repo, pool, inputFor(adminUser)),
      /WITHHELD conditioned cell/, "the production resolver accepted a withheld cell");
    // ...and the provider itself refuses, which is where the rows are actually read.
    await assert.rejects(() => composition.postgresGrantConditionProvider(pool)(TENANT), /WITHHELD conditioned cell/);
    assert.equal(model.SHIPPED_GRANT_CONDITIONS.size, 0, "the shipped catalog grew a condition");
    await clearConditions();
    assert.equal(await conditionRowCount(), 0, "the withholding proof left a row behind");
  });
});
