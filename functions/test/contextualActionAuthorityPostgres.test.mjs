// THE CANONICAL CONTEXTUAL AUTHORIZATION SEAM, against a real PostgreSQL.
//
// contextualAuthorizationPostgres.test.mjs already proves the EVALUATOR's semantics. This proves
// the SEAM: the one server-side place where the capability set the Render runtime actually resolves
// (capabilityAuthority.capabilitiesForRoleKeys, over eos_policy.role_capabilities rows a real
// migration wrote) meets the record context the governed workforce and operations tables answer.
//
// The personas, their Work Eligibility, their Operational Scope and the sixteen contextual
// expectations are NOT invented here. They are read from the governed persona manifest
// scripts/fixtures/personaAuthorityDimensions.v1.json, materialized into a migrated database, and
// executed through the seam. A pinned expectation that the seam cannot reproduce is a failure.
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
const seam = require("../lib/eosOps/contextualActionAuthority.js");
const evaluator = require("../lib/eosOps/contextualAuthorization.js");
const capabilityAuthority = require("../lib/eosOps/capabilityAuthority.js");
const MANIFEST = require("../scripts/fixtures/personaAuthorityDimensions.v1.json");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t-lane-p-seam";
const COMPANY_KEY = MANIFEST.operatingCompanyKey;         // sample-co-synthetic
const REORDER_RECORD = "RR-2026-000901";

// ════════════════════ the grant list, read from the MIGRATION rather than copied ════════════════════
//
// A copy of a grant list is a second authority that drifts. These are parsed out of
// migrations/1761696000000, the migration that actually wrote the rows, so the counts this test
// asserts are the counts the database has.
const GRANT_SQL = readFileSync(
  resolve(FUNCTIONS_DIR, "migrations/1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8");
const MIGRATION_GRANTS = [...GRANT_SQL.matchAll(/\('([A-Za-z]+)',\s*'(reorder\.[A-Za-z.]+)'\)/g)]
  .map((m) => ({ roleKey: m[1], capabilityKey: m[2] }));
const holdersOf = (capabilityKey) =>
  MIGRATION_GRANTS.filter((g) => g.capabilityKey === capabilityKey).map((g) => g.roleKey).sort();

// Two capability keys the persona matrix exercises that migration 1761696000000 does not grant.
// Declared HERE, explicitly, as TEST GRANTS for this throwaway database -- no business permission
// anywhere is altered by them, and no production or nonprod row is written by this file.
const TEST_GRANTS = Object.freeze([
  { roleKey: "warehouseAssociate", capabilityKey: "inventory.cycleCount.create" },
  { roleKey: "inventoryCycleCountCounter", capabilityKey: "inventory.cycleCount.create" },
  { roleKey: "salesperson", capabilityKey: "opportunity.read" },
]);

const personaEmployeeId = (personaKey) => `emp-${personaKey}`;
const personaPrincipalId = (personaKey) => `prn-${personaKey}`;

test("the contextual authorization SEAM", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `lanepseam_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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

  // ════════════════════ materialize the governed persona manifest ════════════════════

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies
             (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,$2,'ACTIVE','persona-manifest','fixture','fixture')`, [T, COMPANY_KEY]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,$2,$2,'ACTIVE','MIGRATED','persona-manifest','fixture','fixture')`, [T, COMPANY_KEY]);
  for (const wh of ["SC-WH-MAIN", "SC-WH-SERVICE"]) {
    await q(`INSERT INTO eos_ops.warehouses
               (id,tenant_id,operating_company_key,name,site_label,status,provenance,created_by,updated_by)
             VALUES ($1,$2,$3,$1,$1,'ACTIVE','NATIVE','fixture','fixture')`, [wh, T, COMPANY_KEY]);
  }

  // Every Security Role any persona holds, plus every Role the migration grant list names.
  const roleKeys = [...new Set([
    ...Object.values(MANIFEST.personas).flatMap((p) => p.securityRoles ?? []),
    ...MIGRATION_GRANTS.map((g) => g.roleKey),
    ...TEST_GRANTS.map((g) => g.roleKey),
  ])].sort();
  for (const key of roleKeys) {
    await q(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
             VALUES ($1,$2,$3,$3,'SYSTEM','fixture','fixture')`, [`role-${key}`, T, key]);
  }
  // The grant rows, exactly as migration 1761696000000 spells them, plus the three declared TEST GRANTS.
  for (const { roleKey, capabilityKey } of [...MIGRATION_GRANTS, ...TEST_GRANTS]) {
    await q(`INSERT INTO eos_policy.role_capabilities
               (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT $1,$2,$3,c.id,'fixture','fixture','fixture' FROM eos_policy.capabilities c WHERE c.key = $4`,
    [`rc-${roleKey}-${capabilityKey}`.slice(0, 60), T, `role-${roleKey}`, capabilityKey]);
  }

  // Employees, Principals and the governed link -- three separate facts, in that order.
  for (const [personaKey, persona] of Object.entries(MANIFEST.personas)) {
    const eid = personaEmployeeId(personaKey);
    const pid = personaPrincipalId(personaKey);
    await q(`INSERT INTO eos_workforce.employees
               (id,tenant_id,employment_status,operating_company_id,employee_number)
             VALUES ($1,$2,'ACTIVE',$3,$4)`, [eid, T, COMPANY_KEY, `E-${personaKey}`.slice(0, 32)]);
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
             VALUES ($1,$2,'firebase','active')`, [pid, `uid-${personaKey}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
             VALUES ($1,$2,$3,'active')`, [`mem-${personaKey}`.slice(0, 60), T, pid]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','persona manifest')`,
    [`lnk-${personaKey}`.slice(0, 60), T, pid, eid, COMPANY_KEY]);
    void persona;
  }
  // CX-16's actor: a Principal that is a real, active member and has NO Employee at all.
  await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status)
           VALUES ('prn-service','uid-service','firebase','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status)
           VALUES ('mem-service',$1,'prn-service','active')`, [T]);

  for (const row of MANIFEST.workEligibility) {
    await q(`INSERT INTO eos_workforce.employee_work_eligibility
               (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by)
             VALUES ($1,$2,$3,$4,now(),'fixture')`,
    [`we-${row.employee}-${row.qualificationCode}`.slice(0, 60), T, personaEmployeeId(row.employee), row.qualificationCode]);
  }
  for (const row of MANIFEST.operationalScopes) {
    await q(`INSERT INTO eos_workforce.employee_operational_scopes
               (id,tenant_id,employee_id,scope_type,scope_id,effective_from,assigned_by)
             VALUES ($1,$2,$3,$4,$5,now(),'fixture')`,
    [`os-${row.employee}-${row.scopeType}-${row.scopeId}`.slice(0, 60), T,
      personaEmployeeId(row.employee), row.scopeType, row.scopeId]);
  }

  // The manifest's REORDER_ASSIGNMENT_NOT_SEEDED blocker, resolved IN THIS THROWAWAY DATABASE ONLY:
  // the record relationship it declares but nonprod does not hold.
  await q(`INSERT INTO eos_ops.reorder_requests
             (id,tenant_id,operating_company_key,part_id,warehouse_id,status,requested_quantity,requested_by,updated_by)
           VALUES ($1,$2,$3,'p1','SC-WH-MAIN','PENDING_REVIEW',1,'fixture','fixture')`, [REORDER_RECORD, T, COMPANY_KEY]);
  const relationship = MANIFEST.recordRelationships.find((r) => r.recordId === REORDER_RECORD);
  await q(`INSERT INTO eos_ops.reorder_request_assignments
             (id,tenant_id,reorder_request_id,assigned_employee_id,effective_from,provenance,assigned_by_principal_id)
           VALUES ('a-cx',$1,$2,$3,now(),'NATIVE',$4)`,
  [T, REORDER_RECORD, personaEmployeeId(relationship.assignedEmployee), personaPrincipalId("owner-executive")]);

  // ════════════════════ the actors, resolved by the REAL runtime authority ════════════════════
  //
  // Not a hand-built Set: capabilitiesForRoleKeys is the function the Render process calls, over the
  // grant rows the migration's own VALUES list produced.
  const reader = evaluator.postgresContextualReader(pool);
  const actorCache = new Map();
  async function actorFor(personaKey) {
    if (actorCache.has(personaKey)) return actorCache.get(personaKey);
    const roles = personaKey === null ? [] : MANIFEST.personas[personaKey].securityRoles ?? [];
    const capabilities = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, roles);
    const actor = Object.freeze({
      tenantId: T,
      principalId: personaKey === null ? "prn-service" : personaPrincipalId(personaKey),
      capabilities,
    });
    actorCache.set(personaKey, actor);
    return actor;
  }
  // CX-16's actor holds the capability but no Employee; it borrows the dispatcher Role's grants.
  const serviceActor = Object.freeze({
    tenantId: T, principalId: "prn-service",
    capabilities: await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["dispatcher"]),
  });

  // ════════════════════ P1/P2 -- the seam's own properties ════════════════════

  await t.test("the shipped registry is EMPTY: composing the seam activates nothing", () => {
    assert.equal(seam.ACTION_CONTEXT_POLICIES.size, 0,
      "a registered action would change what a deployed command permits");
    assert.equal(seam.requiresContext("reorder.request.read"), false);
    assert.equal(seam.requiresContext("reorder.purchaseOrder.read"), false);
    assert.equal(seam.requiresContext("reorder.purchaseOrder.create"), false);
  });

  await t.test("CAPABILITY IS FIRST -- refused before the registry, and before any table is read", async () => {
    // A counting reader proves it rather than a comment: nothing may be asked of the context
    // authority on behalf of a caller who holds nothing.
    let reads = 0;
    const counting = {
      linkedEmployeeId: async (...a) => { reads += 1; return reader.linkedEmployeeId(...a); },
      hasWorkEligibility: async (...a) => { reads += 1; return reader.hasWorkEligibility(...a); },
      hasOperationalScope: async (...a) => { reads += 1; return reader.hasOperationalScope(...a); },
      isAssignedEmployee: async (...a) => { reads += 1; return reader.isAssignedEmployee(...a); },
    };
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]],
      recordKind: "reorderRequest",
    }]);
    const d = await seam.authorizeContextualAction(counting, {
      actor: await actorFor("general-manager"), capabilityKey: "reorder.request.read", recordId: REORDER_RECORD,
    }, registry);
    assert.equal(d.outcome, "CAPABILITY_MISSING");
    assert.equal(d.contextEvaluated, false);
    assert.equal(d.predicate, undefined, "no predicate ran, so no record fact can leak");
    assert.equal(reads, 0, "the context authority was consulted on behalf of an unauthorized caller");
  });

  await t.test("an UNCONDITIONED action stays unconditioned and reads no context", async () => {
    let reads = 0;
    const counting = {
      linkedEmployeeId: async () => { reads += 1; return null; },
      hasWorkEligibility: async () => { reads += 1; return false; },
      hasOperationalScope: async () => { reads += 1; return false; },
      isAssignedEmployee: async () => { reads += 1; return false; },
    };
    // The dispatcher holds reorder.purchaseOrder.create and NO work eligibility whatsoever.
    const d = await seam.authorizeContextualAction(counting, {
      actor: await actorFor("dispatcher"), capabilityKey: "reorder.purchaseOrder.create",
    }, seam.ACTION_CONTEXT_POLICIES);
    assert.equal(d.allowed, true);
    assert.equal(d.outcome, "ALLOWED");
    assert.equal(d.contextEvaluated, false);
    assert.equal(reads, 0, "an unconditioned grant must not acquire an Employee requirement");
  });

  await t.test("eligibility is NOT inferred from a Security Role", async () => {
    // The dispatcher persona holds a Security Role, a capability AND a REORDER_QUEUE scope, and
    // still holds no PARTS_OPERATIONS qualification. CX-13.
    const { rows } = await q(
      `SELECT count(*)::int n FROM eos_workforce.employee_work_eligibility
        WHERE tenant_id=$1 AND employee_id=$2 AND effective_to IS NULL`, [T, personaEmployeeId("dispatcher")]);
    assert.equal(rows[0].n, 0, "the fixture would not prove anything if the dispatcher were eligible");
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]],
    }]);
    const d = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("dispatcher"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(d.outcome, "WORK_ELIGIBILITY_MISSING");
    assert.equal(d.predicate, "WORK_ELIGIBILITY");
  });

  await t.test("the record KIND is policy, never the caller's word", async () => {
    // A caller supplies an id. If it could also supply the kind, it could aim the assignment
    // question at a relation table whose rows it does control.
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]],
      recordKind: "reorderRequest",
    }]);
    const request = { actor: await actorFor("service-technician-b"), capabilityKey: "reorder.request.read",
      recordId: REORDER_RECORD, recordKind: "workOrder", record: { recordKind: "workOrder", recordId: "anything" } };
    const d = await seam.authorizeContextualAction(reader, request, registry);
    assert.equal(d.outcome, "NOT_ASSIGNED", "a caller-supplied kind was honoured");
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/contextualActionAuthority.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.match(src, /recordKind:\s*policy\.recordKind/, "the kind must come from the policy");
    assert.doesNotMatch(src, /request\.recordKind/, "the seam must not read a caller-supplied record kind");
  });

  await t.test("a policy that needs a record and is given none FAILS CLOSED", async () => {
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]],
      recordKind: "reorderRequest",
    }]);
    for (const recordId of [undefined, "", "   "]) {
      const d = await seam.authorizeContextualAction(reader, {
        actor: await actorFor("service-technician-a"), capabilityKey: "reorder.request.read", recordId,
      }, registry);
      assert.equal(d.allowed, false, `recordId ${JSON.stringify(recordId)} must not pass`);
      assert.equal(d.outcome, "NOT_ASSIGNED");
      assert.equal(d.contextEvaluated, false);
    }
    // And a policy that declares a record predicate but no record kind refuses rather than guessing.
    const kindless = new Map([["reorder.request.read", {
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]],
    }]]);
    const d = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("service-technician-a"), capabilityKey: "reorder.request.read", recordId: REORDER_RECORD,
    }, kindless);
    assert.equal(d.outcome, "NOT_ASSIGNED");
    assert.equal(d.detail, "policy declares no record kind");
  });

  await t.test("a context authority that cannot ANSWER refuses, and says so distinctly", async () => {
    const broken = {
      linkedEmployeeId: async () => { throw new Error("connection terminated unexpectedly"); },
      hasWorkEligibility: async () => { throw new Error("unreachable"); },
      hasOperationalScope: async () => { throw new Error("unreachable"); },
      isAssignedEmployee: async () => { throw new Error("unreachable"); },
    };
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]],
    }]);
    const d = await seam.authorizeContextualAction(broken, {
      actor: await actorFor("parts-manager"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(d.allowed, false, "an outage must never read as authorization");
    assert.equal(d.outcome, "CONTEXT_AUTHORITY_UNAVAILABLE");
    assert.notEqual(d.outcome, "OUTSIDE_OPERATIONAL_SCOPE", "an outage is not a business denial");
    // The evaluator's own vocabulary is untouched by this addition.
    assert.equal([...evaluator.CONTEXT_PREDICATE_KINDS].length, 3);
  });

  await t.test("the seam accepts exactly what resolveOperationalContext returns", async () => {
    const resolved = {
      principalContext: { tenantId: T, uid: personaPrincipalId("parts-manager") },
      capabilities: (await actorFor("parts-manager")).capabilities,
    };
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]],
    }]);
    const d = await seam.authorizeResolvedAction(pool, resolved, { capabilityKey: "reorder.request.read" }, registry);
    assert.equal(d.allowed, true);
    assert.equal(d.contextEvaluated, true);
  });

  // ════════════════════ P3 -- NO GLOBAL ACTION PREDICATE ════════════════════

  await t.test("the Owner's measured grant shape is what the database actually holds", async () => {
    assert.deepEqual(holdersOf("reorder.purchaseOrder.read"), [
      "accountingManager", "admin", "controller", "dispatcher", "financeManager", "generalManager",
      "operationsManager", "owner", "purchasingManager", "warehouseAssociate", "warehouseManager",
    ], "11 UNCONDITIONED Roles hold Purchase Order read");
    assert.equal(holdersOf("reorder.purchaseOrder.read").length, 11);
    assert.deepEqual(holdersOf("reorder.purchaseOrder.create"),
      ["admin", "dispatcher", "generalManager", "owner", "purchasingManager"]);
    assert.equal(holdersOf("reorder.purchaseOrder.create").length, 5);
    assert.equal(holdersOf("reorder.purchaseOrder.read").includes("technician"), false,
      "the conditioned technician cell is WITHHELD from PostgreSQL, which is why it stays conditioned nowhere");
    assert.equal(holdersOf("reorder.purchaseOrder.create").includes("technician"), false);
    // And those same rows are in this database, resolved by the runtime authority.
    const { rows } = await q(
      `SELECT r.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.roles r ON r.id = rc.role_id
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
        WHERE rc.tenant_id = $1 AND c.key = 'reorder.purchaseOrder.read' ORDER BY r.key`, [T]);
    assert.equal(rows.length, 11);
  });

  await t.test("a WITHHELD conditioned cell cannot be given an action-level policy, by anybody", () => {
    for (const key of seam.WITHHELD_CONDITIONED_CELLS) {
      assert.throws(
        () => seam.actionContextRegistry([{
          capabilityKey: key,
          paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]],
        }]),
        /WITHHELD conditioned cell/,
        `${key} was registrable`);
    }
    assert.deepEqual([...seam.WITHHELD_CONDITIONED_CELLS],
      ["reorder.purchaseOrder.read", "reorder.purchaseOrder.create"]);
  });

  await t.test("THE HARM a global action predicate would do, measured rather than asserted", async () => {
    // The dispatcher is one of the five UNCONDITIONED holders of Purchase Order create and holds no
    // PARTS_OPERATIONS qualification. Today the seam allows them. An action-level
    // WORK_ELIGIBILITY(PARTS_OPERATIONS) predicate would deny them -- and the other four, and the
    // eleven on read -- which is a narrowing of Roles the Owner did not condition.
    const dispatcher = await actorFor("dispatcher");
    assert.equal(dispatcher.capabilities.has("reorder.purchaseOrder.create"), true);
    const today = await seam.authorizeContextualAction(reader, {
      actor: dispatcher, capabilityKey: "reorder.purchaseOrder.create",
    }, seam.ACTION_CONTEXT_POLICIES);
    assert.equal(today.allowed, true, "unconditioned today");
    // The same actor against the forbidden predicate, evaluated directly so the registry guard is
    // not what proves it: the refusal is real, and it is the widening's mirror image.
    const wouldBe = await evaluator.authorizeObjectAction(reader, {
      actor: dispatcher, capabilityKey: "reorder.purchaseOrder.create",
      predicates: [{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }],
    });
    assert.equal(wouldBe.allowed, false);
    assert.equal(wouldBe.reason, "WORK_ELIGIBILITY_MISSING",
      "an action-level predicate conditions every Role, not the one the catalog conditioned");
  });

  await t.test("CONDITIONAL_ENTITLEMENT_MODEL_GAP -- the three missing inputs, each proved", async () => {
    assert.equal(seam.CONDITIONAL_ENTITLEMENT_MODEL.code, "CONDITIONAL_ENTITLEMENT_MODEL_GAP");

    // 1. No condition column on either grant table.
    const { rows: cols } = await q(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='eos_policy' AND table_name IN ('role_capabilities','principal_capabilities')`);
    const forbidden = ["condition", "condition_kind", "conditions", "predicate", "qualification_code",
      "scope", "scope_type", "own_only"];
    assert.deepEqual(cols.filter((c) => forbidden.includes(c.column_name)), [],
      "a grant row still answers WHAT, never WHICH -- so it cannot carry a per-grant condition either");

    // 2. The runtime authority discards the granting Role.
    const both = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician", "dispatcher"]);
    assert.equal(both instanceof Set, true);
    assert.equal(both.has("reorder.request.read"), true);
    assert.equal([...both].every((v) => typeof v === "string"), true,
      "a flat Set<string> cannot say which Role granted a key");

    // 3. Paths union: an unconditioned path alongside a conditioned one allows EVERY holder, so the
    //    two cannot coexist at action level. This is the structural reason, executed.
    const technician = await actorFor("service-technician-a");
    const unionRegistry = new Map([["reorder.request.read", {
      capabilityKey: "reorder.request.read",
      paths: [[], [{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]],
    }]]);
    const d = await seam.authorizeContextualAction(reader, {
      actor: technician, capabilityKey: "reorder.request.read",
    }, unionRegistry);
    assert.equal(d.allowed, true,
      "the unconditioned path allows a caller who fails the conditioned one -- the condition is unreachable");
    assert.equal(await reader.hasWorkEligibility(T, personaEmployeeId("service-technician-a"), "PARTS_OPERATIONS"),
      false, "and that caller genuinely lacks the qualification");
  });

  // ════════════════════ P4 / P5 -- the sixteen pinned persona expectations ════════════════════

  const EXPECTATIONS = MANIFEST.contextualExpectations;
  assert.equal(EXPECTATIONS.length, 16, "the manifest's pinned matrix changed size");

  // ONE pinned expectation is UNREACHABLE as written, and this is the first execution of the matrix
  // against a database -- the Lane M test validates the manifest's SHAPE and never runs it.
  //
  // CX-14 asks for WORK_ELIGIBILITY_UNMAPPED from the parts-associate persona on
  // reorder.request.read. But CX-02 pins that the SAME persona holds no reorder.request.read grant
  // at all (neither partsAssociate nor inventoryReceivingClerk was granted it by migration
  // 1761696000000), and capability is the FIRST boundary. The refusal is therefore CAPABILITY_MISSING
  // and the predicate never runs -- which is the correct behaviour and the reason the two cannot both
  // be observed on one persona. The divergence is recorded here, the correct outcome is asserted, and
  // the UNMAPPED refusal is proved separately below on a persona that does hold the capability.
  // NOTHING is relaxed: no permission is added to make CX-14 reachable.
  const DIVERGENT = Object.freeze({
    "CX-14-LEGACY-LABEL-IS-REFUSED": {
      reason: "CAPABILITY_MISSING",
      allowed: false,
      why: "capability-first pre-empts the predicate; CX-02 pins the same persona as CAPABILITY_MISSING",
    },
  });

  for (const cx of EXPECTATIONS) {
    await t.test(`${cx.id} -- ${cx.persona ?? "no-employee principal"} / ${cx.capabilityKey}`, async () => {
      const predicates = cx.predicates ?? null;
      const actor = cx.persona === null ? serviceActor : await actorFor(cx.persona);

      // CX-07 / CX-08 pin the ALTERNATIVE-PATH case: one capability, two independent ways to a
      // record. They are the only entries with no `predicates` key.
      const paths = predicates === null
        ? [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }],
          [{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]]
        : predicates.length === 0 ? [] : [predicates];

      let registry = seam.ACTION_CONTEXT_POLICIES;
      if (paths.length > 0 && !seam.WITHHELD_CONDITIONED_CELLS.includes(cx.capabilityKey)) {
        registry = seam.actionContextRegistry([{
          capabilityKey: cx.capabilityKey,
          paths,
          ...(paths.some((p) => p.some((x) => x.kind === "RECORD_ASSIGNMENT"))
            ? { recordKind: cx.record?.recordKind ?? "reorderRequest" } : {}),
        }]);
      }

      const d = await seam.authorizeContextualAction(reader, {
        actor, capabilityKey: cx.capabilityKey, recordId: cx.record?.recordId,
      }, registry);

      const expected = DIVERGENT[cx.id] ?? cx.expect;
      assert.equal(d.allowed, expected.allowed, `${cx.id}: ${d.outcome} ${d.detail ?? ""}`);
      assert.equal(d.outcome, expected.reason, cx.id);
      if (!DIVERGENT[cx.id] && cx.expect.predicate) assert.equal(d.predicate, cx.expect.predicate, cx.id);
    });
  }

  await t.test("CX-14's UNMAPPED refusal, proved on a persona that HOLDS the capability", async () => {
    // The legacy label PARTS_ASSOCIATE must read as "this platform cannot decide", never as "you are
    // not eligible". The dispatcher holds reorder.request.read, so the predicate actually runs.
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_ASSOCIATE" }]],
    }]);
    const d = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("dispatcher"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(d.allowed, false);
    assert.equal(d.outcome, "WORK_ELIGIBILITY_UNMAPPED");
    assert.equal(d.predicate, "WORK_ELIGIBILITY");
    assert.equal(d.detail, "PARTS_ASSOCIATE");
    assert.notEqual(d.outcome, "WORK_ELIGIBILITY_MISSING", "a migration gap is not an ordinary denial");
    assert.equal(evaluator.GOVERNED_QUALIFICATION_CODES.has("PARTS_ASSOCIATE"), false);
  });

  await t.test("CX-09 / CX-10 are honoured WITHOUT an action predicate, which is why the cells stay withheld", async () => {
    // Both Purchase Order expectations pass through the seam with NO policy at all: CX-10 because
    // capability is first and the technician Role was never granted .create, CX-09 because the
    // parts-manager persona holds it unconditioned via purchasingManager. The eligibility predicate
    // the manifest writes beside them is therefore not what decides either one -- and registering it
    // would condition the other four holders. That is the whole of the Owner's ruling, executed.
    const techB = await actorFor("service-technician-b");
    assert.equal(techB.capabilities.has("reorder.purchaseOrder.create"), false);
    const partsManager = await actorFor("parts-manager");
    assert.equal(partsManager.capabilities.has("reorder.purchaseOrder.create"), true,
      "held via purchasingManager, unconditioned");
    assert.equal(
      await reader.hasWorkEligibility(T, personaEmployeeId("parts-manager"), "PARTS_OPERATIONS"), true,
      "the persona is eligible too -- but the seam never had to ask");
  });

  await t.test("PERSONA EXECUTABILITY: the parts persona, with and without PARTS_OPERATIONS", async () => {
    // A TEST-ONLY policy. No live business action declares a WORK_ELIGIBILITY(PARTS_OPERATIONS)
    // predicate, and none is given one here: reorder.request.read is registered only inside this
    // test's registry, never in ACTION_CONTEXT_POLICIES.
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "WORK_ELIGIBILITY", qualificationCode: "PARTS_OPERATIONS" }]],
    }]);
    // parts-associate is eligible but holds neither partsAssociate grant -- capability first.
    const associate = await actorFor("parts-associate");
    assert.equal(associate.capabilities.has("reorder.request.read"), false);
    // parts-manager: eligible AND capable.
    const withEligibility = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("parts-manager"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(withEligibility.allowed, true);
    assert.equal(withEligibility.contextEvaluated, true);
    // dispatcher: capable, NOT eligible.
    const withoutEligibility = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("dispatcher"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(withoutEligibility.allowed, false);
    assert.equal(withoutEligibility.outcome, "WORK_ELIGIBILITY_MISSING");
  });

  await t.test("PERSONA EXECUTABILITY: assigned vs unassigned Technician, on the same record", async () => {
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]],
      recordKind: "reorderRequest",
    }]);
    const assigned = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("service-technician-a"), capabilityKey: "reorder.request.read", recordId: REORDER_RECORD,
    }, registry);
    assert.equal(assigned.allowed, true);
    const unassigned = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("service-technician-b"), capabilityKey: "reorder.request.read", recordId: REORDER_RECORD,
    }, registry);
    assert.equal(unassigned.allowed, false);
    assert.equal(unassigned.outcome, "NOT_ASSIGNED");
    // The two personas differ in NOTHING else: same Security Role, same Work Eligibility.
    assert.deepEqual(MANIFEST.personas["service-technician-a"].securityRoles,
      MANIFEST.personas["service-technician-b"].securityRoles);
    assert.deepEqual(MANIFEST.personas["service-technician-a"].workEligibility,
      MANIFEST.personas["service-technician-b"].workEligibility);
  });

  await t.test("PERSONA EXECUTABILITY: Reorder queue scope present vs absent", async () => {
    const registry = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]],
    }]);
    const present = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("parts-manager"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(present.allowed, true);
    const absent = await seam.authorizeContextualAction(reader, {
      actor: await actorFor("service-technician-a"), capabilityKey: "reorder.request.read",
    }, registry);
    assert.equal(absent.allowed, false);
    assert.equal(absent.outcome, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal(absent.predicate, "OPERATIONAL_SCOPE");
  });

  await t.test("OPERATIONAL SCOPE is not RECORD ASSIGNMENT, through the seam", async () => {
    // Technician A reaches their OWN record and is still refused the queue; the parts manager
    // reaches the queue without any assignment. Neither authority implies the other.
    const own = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "reorderRequest",
    }]);
    const queue = seam.actionContextRegistry([{
      capabilityKey: "reorder.request.read",
      paths: [[{ kind: "OPERATIONAL_SCOPE", scopeType: "REORDER_QUEUE", scopeId: COMPANY_KEY }]],
    }]);
    const techA = await actorFor("service-technician-a");
    assert.equal((await seam.authorizeContextualAction(reader, {
      actor: techA, capabilityKey: "reorder.request.read", recordId: REORDER_RECORD }, own)).allowed, true);
    assert.equal((await seam.authorizeContextualAction(reader, {
      actor: techA, capabilityKey: "reorder.request.read" }, queue)).outcome, "OUTSIDE_OPERATIONAL_SCOPE");
    const partsManager = await actorFor("parts-manager");
    assert.equal((await seam.authorizeContextualAction(reader, {
      actor: partsManager, capabilityKey: "reorder.request.read", recordId: REORDER_RECORD }, own)).outcome,
    "NOT_ASSIGNED", "queue scope conveys no assignment");
    assert.equal((await seam.authorizeContextualAction(reader, {
      actor: partsManager, capabilityKey: "reorder.request.read" }, queue)).allowed, true);
  });

  await t.test("WORK ORDER own assignment is expressible through the same seam", async () => {
    await q(`INSERT INTO eos_ops.work_orders
               (id,tenant_id,operating_company_key,status,work_order_type,priority,provenance,customer_id,location_id,
                created_by_principal_id,created_at,updated_at)
             VALUES ('wo-lane-p',$1,$2,'WORK_IN_PROGRESS','SERVICE_CALL',3,'NATIVE','c1','l1',$3,now(),now())`,
    [T, COMPANY_KEY, personaPrincipalId("owner-executive")]);
    await q(`INSERT INTO eos_ops.work_order_assignments
               (id,tenant_id,work_order_id,assignee_employee_id,effective_from,provenance,assigned_by_principal_id,source)
             VALUES ('wa-lane-p',$1,'wo-lane-p',$2,now(),'NATIVE',$3,'SCHEDULE')`,
    [T, personaEmployeeId("service-technician-a"), personaPrincipalId("owner-executive")]);
    // TEST-ONLY: no Work Order lifecycle capability is granted to any Role by any migration, so this
    // registry entry and its capability grant exist only inside this database.
    await q(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
             SELECT 'rc-tech-wo',$1,'role-technician',c.id,'fixture','fixture','fixture'
               FROM eos_policy.capabilities c WHERE c.key = 'workOrder.lifecycle.complete'`, [T]);
    const capabilities = await capabilityAuthority.capabilitiesForRoleKeys(pool, T, ["technician"]);
    const registry = seam.actionContextRegistry([{
      capabilityKey: "workOrder.lifecycle.complete",
      paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder",
    }]);
    const mine = await seam.authorizeContextualAction(reader, {
      actor: { tenantId: T, principalId: personaPrincipalId("service-technician-a"), capabilities },
      capabilityKey: "workOrder.lifecycle.complete", recordId: "wo-lane-p",
    }, registry);
    assert.equal(mine.allowed, true);
    const theirs = await seam.authorizeContextualAction(reader, {
      actor: { tenantId: T, principalId: personaPrincipalId("service-technician-b"), capabilities },
      capabilityKey: "workOrder.lifecycle.complete", recordId: "wo-lane-p",
    }, registry);
    assert.equal(theirs.outcome, "NOT_ASSIGNED");
  });

  await t.test("DOMAIN READINESS: only the two governed relation kinds can answer a record question", () => {
    // Commercial and CRM record kinds have no assignment relation, which is why no Commercial or CRM
    // action can carry a RECORD_ASSIGNMENT policy yet.
    const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/contextualAuthorization.ts"), "utf8");
    const relations = [...src.matchAll(/^\s{2}(reorderRequest|workOrder):\s*\{ table:/gm)].map((m) => m[1]);
    assert.deepEqual(relations.sort(), ["reorderRequest", "workOrder"]);
    for (const kind of ["opportunity", "salesAgreement", "salesOrder", "account", "contact", "employee"]) {
      assert.equal(src.includes(`  ${kind}: { table:`), false, `${kind} acquired a relation quietly`);
    }
  });
});

test("the seam introduces no Firebase, no SQL and no second capability resolver", () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/eosOps/contextualActionAuthority.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of ["firebase", "firestore", "request.auth", "customClaims", "operationalRoles"]) {
    assert.equal(code.toLowerCase().includes(forbidden.toLowerCase()), false, `the seam reaches for ${forbidden}`);
  }
  // No SQL of its own: the seam composes two authorities and queries neither table itself.
  assert.doesNotMatch(code, /\.query\s*\(/, "the seam grew its own SQL");
  assert.doesNotMatch(code, /FROM\s+eos_/, "the seam named a table");
  assert.doesNotMatch(code, /(capabilitiesForRoleKeys|resolvePrincipalContext|getPolicyDatabasePool)\s*\(/,
    "the seam must consume a resolved context, never resolve a second one");
});
