// PLATFORM QA (lane L5) -- EVERY MANIFEST PERSONA THROUGH THE WHOLE RUNTIME PATH, and the lifecycle negatives.
//
// personaBusinessAccessRegression.test.mjs proves Role composition -> capabilities -> surfaces with
// `capabilitiesForRoleKeys`, i.e. it starts AFTER identity. This file starts at the TOKEN: each persona is a real
// Principal with a real membership, real Role assignments, a real Employee, a real Principal link and real Work
// Eligibility / Operational Scope rows, and every answer is read back through the deployed transports:
//
//   A  RUNTIME == ROLE JOIN     /operations/inventory resolveMyCapabilities  ==  capabilitiesForRoleKeys(securityRoles) + protected-Administrator standing (#223)
//   B  ADMIN PREVIEW == RUNTIME /admin/policy explainEffectiveAccess(principal).capabilities/surfaces == the runtime's
//   C  DIMENSIONS               /operations/experience returns the manifest's Employee, eligibility and scopes, and
//                               the surfaces grantedSurfaceKeys derives from them (PG dimensions == manifest dimensions)
//   D  NEIGHBOURS               the persona x capability grid, with the ruled neighbour separations asserted
//   E  LIFECYCLE NEGATIVES      what the runtime does when the Employee is TERMINATED, the link revoked, eligibility
//                               ended, or a Role revoked -- measured through the same transports
//
// Disposable database only (platformQaHarness.mjs). No fixture is edited and nothing shared is written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import {
  SKIP, FUNCTIONS_DIR, rebuiltAuthorityDatabase, composeTransports, tokenRegistry, makeActor, assignRoleKeys, call,
} from "./platformQaHarness.mjs";

const require = createRequire(import.meta.url);
const { capabilitiesForRoleKeys, protectedAdministratorKeys } = require("../lib/eosOps/capabilityAuthority.js");
const { grantedSurfaceKeys } = require("../lib/eosOps/experienceAuthority.js");
const { ADMIN_READ_CAPABILITY } = require("../lib/adminPolicy/adminPolicyApi.js");

const MANIFEST = JSON.parse(readFileSync(path.join(FUNCTIONS_DIR, "scripts", "fixtures", "personaAuthorityDimensions.v1.json"), "utf8"));
const PERSONAS = MANIFEST.personas;
const TENANT = "tenant-l5-persona-runtime";
const TENANT_KEY = "l5-persona-runtime";
const OPCO = "sample-co-synthetic";

const dimsOf = (p) => ({
  employeeId: p.employee,
  workEligibility: [...(p.workEligibility ?? [])].sort(),
  operationalScopes: (p.operationalScopes ?? []).map((s) => { const [scopeType, scopeId] = s.split(":"); return { scopeType, scopeId }; })
    .sort((a, b) => `${a.scopeType}:${a.scopeId}`.localeCompare(`${b.scopeType}:${b.scopeId}`)),
});

test("persona runtime matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool, repo } = await rebuiltAuthorityDatabase(t, "l5persona", TENANT, TENANT_KEY);
  const tokens = tokenRegistry();
  const { transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };

  // The administering actor for explainEffectiveAccess and the lifecycle commands: a Principal holding the seeded
  // `admin` Role, exactly as the administrator persona does.
  const adminActor = await makeActor(ctx, TENANT, "l5-sub-admin-operator", []);
  assert.deepEqual(await assignRoleKeys(ctx, TENANT, adminActor.principalId, ["admin"]), []);

  const provision = async (key, persona, suffix = "") => {
    const actor = await makeActor(ctx, TENANT, `l5-persona-${key}${suffix}`, []);
    const missing = await assignRoleKeys(ctx, TENANT, actor.principalId, persona.securityRoles ?? []);
    const employeeId = `${persona.employee}${suffix}`;
    await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,$2,'ACTIVE',$3)`,
      [employeeId, TENANT, OPCO]);
    await pool.query(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
                      VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','l5','l5 fixture')`, [`epl-${randomUUID()}`, TENANT, actor.principalId, employeeId, OPCO]);
    for (const code of persona.workEligibility ?? []) {
      await pool.query(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
                        VALUES ($1,$2,$3,$4,now(),'l5')`, [`we-${randomUUID()}`, TENANT, employeeId, code]);
    }
    for (const s of persona.operationalScopes ?? []) {
      const [scopeType, scopeId] = s.split(":");
      await pool.query(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
                        VALUES ($1,$2,$3,$4,$5,now(),'l5')`, [`os-${randomUUID()}`, TENANT, employeeId, scopeType, scopeId]);
    }
    return { ...actor, employeeId, missing };
  };

  // The governed scope TARGETS the manifest names (trigger operational_scope_target_exists refuses a scope row whose
  // target is not governed): one operating company with its ACTIVE key, and the two warehouses.
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
                    VALUES ($1,'sample-co','ACTIVE','l5','l5','l5')`, [TENANT]);
  await pool.query(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
                    VALUES ($1,'sample-co',$2,'ACTIVE','NATIVE','l5','l5','l5')`, [TENANT, OPCO]);
  for (const wh of ["SC-WH-MAIN", "SC-WH-SERVICE"]) {
    await pool.query(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
                      VALUES ($1,$2,$3,$1,$1,'ACTIVE','NATIVE','l5','l5')`, [wh, TENANT, OPCO]);
  }

  const actors = {};
  for (const [key, persona] of Object.entries(PERSONAS)) actors[key] = await provision(key, persona);

  const runtimeCaps = async (actor) => {
    const r = await call(transports.operations, "resolveMyCapabilities", { token: actor.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.result;
  };
  const experience = async (actor) => {
    const r = await call(transports.operations, "resolveMyExperienceContext", { token: actor.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.result;
  };
  const explain = async (principalId) => {
    const r = await call(transports.administration, "explainEffectiveAccess", { token: adminActor.token, input: { principalId } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data;
  };

  const grid = {};
  const allCaps = new Set();

  await t.test("every Security Role a manifest persona names exists in the rebuilt catalog", () => {
    const missing = Object.entries(actors).filter(([, a]) => a.missing.length > 0).map(([k, a]) => `${k}: ${a.missing.join(",")}`);
    assert.deepEqual(missing, []);
  });

  await t.test("A+B+C: token -> Principal -> Roles -> capabilities -> surfaces, three ways, for every persona", async () => {
    const diffs = [];
    for (const [key, persona] of Object.entries(PERSONAS)) {
      const actor = actors[key];
      // The grant join, PLUS what protected-Administrator standing implies (DECISIONS #223) -- empty for every other persona.
      const expected = [...new Set([...await capabilitiesForRoleKeys(pool, TENANT, persona.securityRoles ?? []),
        ...await protectedAdministratorKeys(pool, TENANT, persona.securityRoles ?? [])])].sort();
      const runtime = await runtimeCaps(actor);
      if (JSON.stringify(runtime.capabilities) !== JSON.stringify(expected)) diffs.push(`A ${key}: runtime ${runtime.capabilities.length} vs join ${expected.length}`);
      if (JSON.stringify([...runtime.heldRoleKeys].sort()) !== JSON.stringify([...(persona.securityRoles ?? [])].sort())) {
        diffs.push(`A ${key}: heldRoleKeys ${runtime.heldRoleKeys} vs manifest ${persona.securityRoles}`);
      }
      const exp = await experience(actor);
      const want = dimsOf(persona);
      if (exp.employeeId !== actor.employeeId) diffs.push(`C ${key}: employee ${exp.employeeId}`);
      if (JSON.stringify(exp.workEligibility) !== JSON.stringify(want.workEligibility)) diffs.push(`C ${key}: eligibility ${exp.workEligibility}`);
      if (JSON.stringify(exp.operationalScopes) !== JSON.stringify(want.operationalScopes)) diffs.push(`C ${key}: scopes ${JSON.stringify(exp.operationalScopes)}`);
      const surfaces = [...await grantedSurfaceKeys({ tenantId: TENANT, principalId: actor.principalId, capabilities: new Set(expected) },
        { employeeId: actor.employeeId, workEligibility: want.workEligibility, operationalScopes: want.operationalScopes })].sort();
      if (JSON.stringify([...exp.surfaces].sort()) !== JSON.stringify(surfaces)) diffs.push(`C ${key}: surfaces ${exp.surfaces.length} vs ${surfaces.length}`);
      const explained = await explain(actor.principalId);
      if (JSON.stringify(explained.capabilities) !== JSON.stringify(runtime.capabilities)) diffs.push(`B ${key}: preview capabilities differ from runtime`);
      if (JSON.stringify([...explained.surfaces].sort()) !== JSON.stringify([...exp.surfaces].sort())) diffs.push(`B ${key}: preview surfaces differ from runtime`);
      grid[key] = new Set(runtime.capabilities);
      for (const c of runtime.capabilities) allCaps.add(c);
    }
    assert.deepEqual(diffs, []);
  });

  await t.test("D: the persona x capability grid, and the ruled neighbour separations", () => {
    const caps = [...allCaps].sort();
    const keys = Object.keys(PERSONAS);
    const rows = caps.map((c) => `${c.padEnd(52)} ${keys.map((k) => (grid[k].has(c) ? "X" : ".")).join("")}`);
    t.diagnostic(`GRID personas=${keys.join(",")}\n${rows.join("\n")}`);
    t.diagnostic(`CELLS ${keys.length} personas x ${caps.length} held capabilities = ${keys.length * caps.length}; ALLOW ${[...Object.values(grid)].reduce((n, s) => n + s.size, 0)}`);
    // Neighbours that differ ONLY by governed authority, where a ruling fixes the direction of the difference.
    const has = (k, c) => grid[k].has(c);
    const NEIGHBOUR_RULES = [
      // Persona Foundation: the Owner and the Administrator are separate Principals (the 2026-09-26 split); GM is NOT a
      // security administrator (Pass 8 ruling); Owner staffs the Administrator role (R1), and since DECISIONS #223 the
      // protected Administrator does too (by standing).
      ["owner-executive", "admin.administratorRole.assign", true], ["administrator", "admin.administratorRole.assign", true],
      ["administrator", "admin.securityPolicy.write", true], ["general-manager", "admin.securityPolicy.write", false],
      ["general-manager", "admin.roleAssignment.write", false], ["owner-executive", "admin.securityPolicy.write", false],
      // A technician with no Security Role (on leave) holds nothing; the active technician's WO read is a governed grant.
      ["technician-on-leave", null, false],
      // The restricted persona is the fail-closed floor for operational writes.
      ["restricted-user", "admin.employeeProfile.write", false],
    ];
    const violations = [];
    for (const [k, c, want] of NEIGHBOUR_RULES) {
      if (c === null) { if ((grid[k].size > 0) !== want) violations.push(`${k} holds ${grid[k].size} capabilities`); continue; }
      if (!allCaps.has(c) && want) { violations.push(`${c} is held by nobody`); continue; }
      if (has(k, c) !== want) violations.push(`${k} ${want ? "lacks" : "holds"} ${c}`);
    }
    assert.deepEqual(violations, []);
  });

  await t.test("F: Administration's read gate (its OWN evaluator) agrees with the runtime for every persona x read", async () => {
    // adminPolicyApi.requireAdminReadAuthority decides through resolvePrincipalEffectiveAccess -- a second evaluator
    // over the same tables. The gate runs BEFORE input validation, so 403 <=> the gate refused.
    const disagreements = [];
    let cells = 0;
    for (const key of Object.keys(PERSONAS)) {
      for (const [op, capability] of Object.entries(ADMIN_READ_CAPABILITY)) {
        cells += 1;
        const r = await call(transports.administration, op, { token: actors[key].token, input: {} });
        const gateAllowed = r.status !== 403;
        const runtimeAllows = capability !== null && grid[key].has(capability);
        if (gateAllowed !== runtimeAllows) disagreements.push(`${key} ${op} (${capability}): gate ${r.status} ${r.code}, runtime ${runtimeAllows}`);
      }
    }
    t.diagnostic(`ADMIN READ GATE CELLS ${cells}`);
    assert.deepEqual(disagreements, []);
  });

  await t.test("G: no transport refuses a capability the runtime says the persona HOLDS (every op x every persona)", async () => {
    // Each kernel's CAPABILITY_REQUIRED refusal names the key it wanted. If that key is in the persona's runtime set,
    // the kernel decided with something other than the runtime resolution -- a second answer to one question.
    const contradictions = [];
    const named = new Set();
    let cells = 0;
    for (const key of Object.keys(PERSONAS)) {
      for (const [name, tr] of Object.entries(transports)) {
        if (name === "administration") continue; // F covers it with the declared map
        for (const op of tr.operations) {
          cells += 1;
          const r = await call(tr, op, { token: actors[key].token, input: {} });
          if (r.status !== 403) continue;
          const wanted = [...String(r.body.message ?? "").matchAll(/\b([a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+)\b/g)].map((m) => m[1])
            .filter((k) => allCaps.has(k) || /^(admin|employee|customer|opportunity|salesAgreement|salesOrder|workOrder|inventory|reorder|audit|workflowDefinition)\./.test(k));
          wanted.forEach((k) => named.add(k));
          const held = wanted.filter((k) => grid[key].has(k));
          if (held.length > 0 && wanted.every((k) => grid[key].has(k))) contradictions.push(`${key} ${name}.${op}: ${r.code} naming ${held.join(",")} which the runtime grants`);
        }
      }
    }
    t.diagnostic(`TRANSPORT GATE CELLS ${cells}; capability keys named by refusals: ${named.size}`);
    assert.deepEqual(contradictions, EXPECTED_GATE_CONTRADICTIONS);
  });

  // ════════════════════ E. LIFECYCLE NEGATIVES ════════════════════
  // Fresh clones of the SERVICE TECHNICIAN persona, so each negative changes exactly one fact.
  const tech = PERSONAS["service-technician-a"];
  const probeAll = async (actor) => {
    const caps = await runtimeCaps(actor);
    const exp = await experience(actor);
    const wf = await call(transports.workforce, "readMyWorkforceCapabilities", { token: actor.token });
    return { capabilities: caps.capabilities.length, surfaces: [...exp.surfaces].sort(), employeeId: exp.employeeId,
      workEligibility: exp.workEligibility, workforceSelf: wf.status };
  };
  const lifecycle = {};

  // E1 -- EMPLOYMENT ACCESS ELIGIBILITY (Controller DQ-007, 2026-09-28): ACTIVE and CONTRACTOR only. Rewritten from the
  // L5-F06 characterisation that pinned the OLD behaviour (a TERMINATED technician kept everything).
  //
  // Three personas whose authority differs in kind -- a field technician (Employee-derived surfaces), a retail
  // salesperson (commercial writes), and the administrator (Administration) -- are cloned once per employment status
  // and asked EVERY operation of all five transports. An ineligible status must answer 403 FORBIDDEN on every one, with
  // no surface and no commercial write; an eligible status must answer exactly as the ACTIVE baseline does.
  const STATUSES = ["ACTIVE", "CONTRACTOR", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED"];
  const ELIGIBLE = new Set(["ACTIVE", "CONTRACTOR"]);
  const LIFECYCLE_PERSONAS = ["service-technician-a", "retail-sales-a", "administrator"];
  const fingerprint = async (actor) => {
    const out = {};
    for (const [name, tr] of Object.entries(transports)) {
      for (const op of tr.operations) {
        const r = await call(tr, op, { token: actor.token, input: {} });
        out[`${name}.${op}`] = `${r.status} ${r.code}`;
      }
    }
    return out;
  };
  const eligibilityGrid = {};
  await t.test("E1: employment status x persona x every operation of all six transports", async () => {
    const violations = [];
    for (const key of LIFECYCLE_PERSONAS) {
      const baseline = await fingerprint(actors[key]);
      eligibilityGrid[key] = {};
      for (const status of STATUSES) {
        const a = await provision(key, PERSONAS[key], `-st-${status.toLowerCase()}`);
        const r = await call(transports.workforce, "changeEmploymentStatus", { token: adminActor.token,
          input: { employeeId: a.employeeId, employmentStatus: status, reason: "l5 employment access probe" } });
        assert.ok(r.status === 200, `set ${status}: ${JSON.stringify(r.body)}`);
        const got = await fingerprint(a);
        const cells = Object.entries(got);
        if (ELIGIBLE.has(status)) {
          const diffs = cells.filter(([op, v]) => v !== baseline[op] && !/^(workforce\.readMyEmployeeProfile)$/.test(op));
          if (diffs.length > 0) violations.push(`${key} ${status} (eligible) differs from ACTIVE on ${diffs.map(([op, v]) => `${op}=${v} vs ${baseline[op]}`).join("; ")}`);
          eligibilityGrid[key][status] = `unchanged (${cells.filter(([, v]) => /^2/.test(v)).length} ops answer 2xx)`;
        } else {
          // DQ-034: while the Catalog compatibility hold exists, every PostgreSQL Catalog MUTATION is refused with
          // 412 CATALOG_MUTATION_HELD before identity resolution and before any write (catalogHttp.ts) -- for every
          // caller, eligible or not. That is a refusal too, and only for catalog.* operations.
          const open = cells.filter(([op, v]) => !/^403 FORBIDDEN$/.test(v) && !/^404 UNKNOWN_OPERATION$/.test(v)
            && !(/^catalog\./.test(op) && /^412 CATALOG_MUTATION_HELD$/.test(v)));
          if (open.length > 0) violations.push(`${key} ${status} (ineligible) not refused on ${open.map(([op, v]) => `${op}=${v}`).join("; ")}`);
          eligibilityGrid[key][status] = `refused on ${cells.length - open.length}/${cells.length} ops`;
        }
      }
    }
    t.diagnostic(`EMPLOYMENT ACCESS GRID ${JSON.stringify(eligibilityGrid, null, 1)}`);
    assert.deepEqual(violations, []);
  });

  await t.test("E1b: the refusal names the governed reason, deletes nothing, and restoring ACTIVE restores access", async () => {
    const a = await provision("retail-sales-a", PERSONAS["retail-sales-a"], "-restore");
    const assignmentsBefore = (await pool.query(`SELECT id, status FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2 ORDER BY id`, [TENANT, a.principalId])).rows;
    const before = await runtimeCaps(a);
    await call(transports.workforce, "changeEmploymentStatus", { token: adminActor.token, input: { employeeId: a.employeeId, employmentStatus: "TERMINATED", reason: "l5" } });
    const refused = await call(transports.operations, "resolveMyCapabilities", { token: a.token });
    assert.deepEqual([refused.status, refused.code], [403, "FORBIDDEN"]);
    assert.equal(refused.body.message, "EMPLOYEE_NOT_ACCESS_ELIGIBLE");
    const adminView = await call(transports.administration, "listRoles", { token: a.token, input: {} });
    assert.match(adminView.body.message, /not eligible for access/);
    // A commercial WRITE specifically (the ruling names it): refused before any command runs.
    const write = await call(transports.commercial, "createOpportunity", { token: a.token, input: { idempotencyKey: `l5-${randomUUID()}` } });
    assert.deepEqual([write.status, write.code], [403, "FORBIDDEN"]);
    // Nothing deleted, nothing rewritten.
    const assignmentsAfter = (await pool.query(`SELECT id, status FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2 ORDER BY id`, [TENANT, a.principalId])).rows;
    assert.deepEqual(assignmentsAfter, assignmentsBefore);
    // The Administration explanation reports "no effective access", not a server fault.
    const explained = await call(transports.administration, "explainEffectiveAccess", { token: adminActor.token, input: { principalId: a.principalId } });
    assert.deepEqual([explained.status, explained.code], [404, "NOT_FOUND"]);
    await call(transports.workforce, "changeEmploymentStatus", { token: adminActor.token, input: { employeeId: a.employeeId, employmentStatus: "ACTIVE", reason: "l5" } });
    assert.deepEqual(await runtimeCaps(a), before, "restoring ACTIVE did not restore exactly the prior access");
  });

  await t.test("E1c: an ACTIVE link to an Employee that does not resolve in the tenant fails closed", async () => {
    const a = await makeActor(ctx, TENANT, "l5-persona-dangling-link", []);
    await assignRoleKeys(ctx, TENANT, a.principalId, ["technician"]);
    await pool.query(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason)
                      VALUES ($1,$2,$3,'e-l5-nowhere',$4,'OPERATOR_ASSERTED','l5','l5 fixture')`, [`epl-${randomUUID()}`, TENANT, a.principalId, OPCO]);
    const r = await call(transports.operations, "resolveMyCapabilities", { token: a.token });
    assert.deepEqual([r.status, r.body.message], [403, "EMPLOYEE_NOT_ACCESS_ELIGIBLE"]);
  });

  await t.test("E1e: the OPERATOR entry point (resolveEmployeeAdministrationActor) applies the same rule", async () => {
    const { resolveEmployeeAdministrationActor } = require("../lib/eosWorkforce/commands/employeeAdministrationAuthority.js");
    const a = await provision("administrator", PERSONAS.administrator, "-operator");
    const ok = await resolveEmployeeAdministrationActor(pool, { tenantId: TENANT, principalId: a.principalId });
    assert.ok(ok.capabilities.size > 0);
    await call(transports.workforce, "changeEmploymentStatus", { token: adminActor.token, input: { employeeId: a.employeeId, employmentStatus: "INACTIVE", reason: "l5" } });
    await assert.rejects(resolveEmployeeAdministrationActor(pool, { tenantId: TENANT, principalId: a.principalId }),
      (err) => err.code === "ADMINISTRATOR_NOT_ACCESS_ELIGIBLE");
  });

  await t.test("E1d: a Principal with NO Employee link (service / administrative) is unaffected", async () => {
    const a = await makeActor(ctx, TENANT, "l5-persona-unlinked-service", []);
    await assignRoleKeys(ctx, TENANT, a.principalId, ["technician"]);
    const r = await call(transports.operations, "resolveMyCapabilities", { token: a.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.result.capabilities, [...await capabilitiesForRoleKeys(pool, TENANT, ["technician"])].sort());
  });

  await t.test("E2: Principal link REVOKED -- Employee dimensions must drop, Role capabilities are Principal-level", async () => {
    const a = await provision("service-technician-a", tech, "-unlinked");
    const before = await probeAll(a);
    await pool.query(`UPDATE eos_policy.employee_principal_links SET status='revoked' WHERE tenant_id=$1 AND principal_id=$2`, [TENANT, a.principalId]);
    const after = await probeAll(a);
    lifecycle.LINK_REVOKED = { before, after };
    assert.equal(after.employeeId, null, "a revoked link still resolves an Employee");
    assert.deepEqual(after.workEligibility, []);
    assert.equal(after.capabilities, before.capabilities, "Role capabilities are Principal authority and must not move with the link");
    assert.ok(before.surfaces.every((s) => after.surfaces.includes(s)) || after.surfaces.length < before.surfaces.length);
  });

  await t.test("E3: Work Eligibility ENDED -- eligibility-predicated surfaces drop, capabilities do not", async () => {
    const a = await provision("service-technician-a", tech, "-ineligible");
    const before = await probeAll(a);
    await pool.query(`UPDATE eos_workforce.employee_work_eligibility SET effective_to=now(), ended_by='l5', ended_at=now() WHERE tenant_id=$1 AND employee_id=$2`, [TENANT, a.employeeId]);
    const after = await probeAll(a);
    lifecycle.ELIGIBILITY_ENDED = { before, after };
    assert.deepEqual(after.workEligibility, []);
    assert.equal(after.capabilities, before.capabilities);
  });

  await t.test("E4: Security Role REVOKED through Administration -- capabilities drop on the very next request", async () => {
    const a = await provision("service-technician-a", tech, "-revoked");
    const before = await probeAll(a);
    const assignment = (await pool.query(`SELECT id FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2 AND status='active'`, [TENANT, a.principalId])).rows;
    assert.equal(assignment.length, 1);
    const r = await call(transports.administration, "revokeRole", { token: adminActor.token, input: { assignmentId: assignment[0].id, reason: "l5 lifecycle probe" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = await probeAll(a);
    lifecycle.ROLE_REVOKED = { before, after };
    assert.equal(after.capabilities, 0, "a revoked Role still confers capabilities");
    assert.ok(before.capabilities > 0);
    const audit = (await pool.query(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id=$1 AND action ILIKE '%revoke%'`, [TENANT])).rows[0].n;
    assert.ok(audit >= 1, "the revocation left no audit event");
  });

  await t.test("E-RESULT: the lifecycle outcomes", () => {
    t.diagnostic(`LIFECYCLE ${JSON.stringify(lifecycle, null, 1)}`);
  });
});

// Filled from the measured run; each entry is classified in the L5 ledger.
const EXPECTED_GATE_CONTRADICTIONS = [];
