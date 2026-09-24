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
import { readFileSync } from "node:fs";
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
  const actorOf = (entitlements, capabilities) => Object.freeze({
    tenantId: "t", principalId: "p",
    capabilities: capabilities ?? model.capabilityKeysOf(entitlements),
    entitlements,
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
    // The proposed relation is a SEPARATE table keyed by (grantor, capability) -- never a column.
    assert.match(model.PROPOSED_GRANT_CONDITION_SCHEMA, /CREATE TABLE eos_policy\.capability_grant_conditions/);
    assert.match(model.PROPOSED_GRANT_CONDITION_SCHEMA,
      /UNIQUE \(tenant_id, grant_scope, grantor_key, capability_key\)/);
    assert.doesNotMatch(model.PROPOSED_GRANT_CONDITION_SCHEMA, /role_capabilities|principal_capabilities/);
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
    entitlements: await composition.resolveRoleEntitlements(pool, T, roles, conditions),
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
    assert.equal(model.entitlementsFor(actor.entitlements, PO_READ).length, 2, "both entitlements are present");
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
      actor: { tenantId: T, principalId: prn("tech-plain"), capabilities: model.capabilityKeysOf(plainDirect), entitlements: plainDirect },
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
      actor: { tenantId: T, principalId: prn("tech-plain"), capabilities: model.capabilityKeysOf(conditioned), entitlements: conditioned },
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

  // ════════════════════ PERSISTENCE -- designed, read, and NOT migrated ════════════════════

  await t.test("the condition relation does NOT exist: this lane added no migration", async () => {
    const { rows } = await q(
      `SELECT to_regclass('eos_policy.capability_grant_conditions') IS NOT NULL AS present`);
    assert.equal(rows[0].present, false, "a migration appeared where Lane AA owns the slot");
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

  await t.test("the PROPOSED relation, created from its own DDL, round-trips a real condition", async () => {
    // Applied HERE ONLY, in a throwaway database, from the exact text the migration would carry.
    await q(model.PROPOSED_GRANT_CONDITION_SCHEMA);
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
      entitlements: model.entitlementsFor(stored, PO_READ).filter((e) => e.grantor.roleKey === "technician") };
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
