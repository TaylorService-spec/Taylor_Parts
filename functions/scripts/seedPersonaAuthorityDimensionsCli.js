// PERSONA AUTHORITY DIMENSIONS -- the operator run of the Work Eligibility and Operational Scope
// seed phase that personaAuthorityDimensions.js plans.
//
// DRY RUN BY DEFAULT. `--apply` writes through the two GOVERNED commands and nothing else:
// assignEmployeeWorkEligibility and assignEmployeeOperationalScope. No raw SQL, no second authority,
// no Employee, no Principal, no Role, no grant and no operating company key binding.
//
// ════════════════════ THE ACTOR ASSERTS NOTHING ════════════════════
//
// The administering Principal is NAMED (--adminPrincipalId), its active Role assignments are read,
// and its capabilities are resolved LIVE from eos_policy.role_capabilities through
// capabilityAuthority.capabilitiesForRoleKeys. This script never constructs a capability set: a
// fabricated one would make the command's own capability gate decorative, which is the one thing a
// seed must never do to a guard it is standing in front of.
//
// ════════════════════ PREFLIGHT, THEN CONTINUE ════════════════════
//
// The plan is partitioned by scripts/sampleCompany/personaE2EHarness.js against MEASURED facts --
// live capabilities, the tenant's Employee ids, the tenant's warehouse ids, the ACTIVE operating
// company keys. A step whose precondition is missing is reported by CODE and never attempted; the
// rest still run. Blocking preconditions are removed by OTHER governed tools (the employee
// capability grant reconciliation, the Sample Company warehouse step, the operating company key
// reconciliation) and never by this one.
//
// ════════════════════ THE FENCE ════════════════════
//
// Before `pg` or lib/ loads: a registry --environment that is production by neither role nor project
// id, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused by id, and
// --tenantKey / --performedBy / --adminPrincipalId required. The tenant is resolved by key, never
// created.
//
// Usage:
//   node scripts/seedPersonaAuthorityDimensionsCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> \
//     --adminPrincipalId <principal> [--apply]
//
// ════════════════════ KNOWN DEFECT -- BACKLOG ITEM, NOT FIXED IN THIS WAVE ════════════════════
//
// THIS SCRIPT CANNOT APPLY. `--apply` throws `commands[step.command] is not a function`.
//
// PLANNER AND EXECUTOR HAVE DIVERGED. planPersonaAuthorityDimensions() now emits FOUR step commands
// (measured 2026-09-25, 50 steps: createJobRole 16, assignEmployeeJobRole 21,
// assignEmployeeWorkEligibility 7, assignEmployeeOperationalScope 6) after the canonical Job Role
// ruling re-pointed it at the Job Role writers. The `commands` map in main() below wires only TWO --
// assignEmployeeWorkEligibility and assignEmployeeOperationalScope. The first applicable Job Role step
// therefore dereferences `undefined` and the run dies.
//
// NOTHING IS HALF-APPLIED. The throw happens at the call site, before the governed command opens a
// transaction, so no row and no audit event is written by the failed step. Steps that ran BEFORE it in
// the same loop did commit -- each governed command is its own transaction and there is no outer one --
// so a future repair must be able to re-run, which the commands' NO_CHANGE outcomes already allow.
//
// THE OWNER RULED IT IS NOT REPAIRED HERE (2026-09-25). Wiring the two missing commands would make the
// script apply, but it would then apply MORE than the approved scope: it plans 16 createJobRole steps
// against a canonical catalog the governed seed (migration/jobRoleCatalogSeed.ts, driven by
// scripts/jobRoleCatalogSeedCli.js) already creates -- redundant, add-only, and reported rather than
// silent -- and it plans assignEmployeeJobRole for Employees outside the canonical persona census.
// Deciding which of the 21 assignments are in scope is a scoping question, not a wiring bug.
//
// THE UNBLOCK, MEANWHILE. Governed Job Role ASSIGNMENT for a NAMED Employee now exists in
// scripts/administerEmployeeCli.js (`--command assignEmployeeJobRole`), one bounded operation at a
// time, under the same admin.employeeJobRole.write and the same governed command this script failed to
// call. Phase 2C does not wait on this defect.
//
// NOT TOUCHED BY THAT LANE. No line of executable code in this file was changed; this block is the
// record, so that the next operator meets the defect here rather than at an apply.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { planPersonaAuthorityDimensions } = require("./sampleCompany/personaAuthorityDimensions.js");
const { preflightAuthorityPlan } = require("./sampleCompany/personaE2EHarness.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

function assertSeedInvocation(args, env) {
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    throw new Error(`--environment '${environmentId}' is the Certification world, which is frozen.`);
  }
  if (!args.tenantKey || args.tenantKey === "true") throw new Error("--tenantKey is required: the tenant is named, never inferred.");
  if (!args.performedBy || args.performedBy === "true" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    throw new Error("--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100).");
  }
  if (!args.adminPrincipalId || args.adminPrincipalId === "true") {
    throw new Error("--adminPrincipalId is required: this script asserts no authority of its own and administers as a named Principal.");
  }
  return {
    environmentId, connectionString, tenantKey: args.tenantKey, performedBy: args.performedBy,
    adminPrincipalId: args.adminPrincipalId, apply: args.apply === "true",
  };
}

/** Measure exactly the facts the preflight asks about. Read-only, and nothing is inferred. */
async function measureLiveFacts(pool, tenantId, adminPrincipalId, capabilitiesForRoleKeys) {
  const membership = await pool.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`,
    [tenantId, adminPrincipalId]);
  if (membership.rows.length === 0) {
    throw new Error("--adminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roleKeys = (await pool.query(
    `SELECT r.key FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active'`,
    [tenantId, adminPrincipalId])).rows.map((r) => r.key);
  const capabilities = new Set(await capabilitiesForRoleKeys(pool, tenantId, roleKeys));
  const employeeIds = new Set((await pool.query(
    "SELECT id FROM eos_workforce.employees WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id));
  const warehouseIds = new Set((await pool.query(
    "SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id));
  const activeOperatingCompanyKeys = new Set((await pool.query(
    "SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND status = 'ACTIVE'",
    [tenantId])).rows.map((r) => r.operating_company_key));
  return { roleKeys, capabilities, employeeIds, warehouseIds, activeOperatingCompanyKeys };
}

async function main() {
  const options = assertSeedInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
  const commands = {
    assignEmployeeWorkEligibility: require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js").assignEmployeeWorkEligibility,
    assignEmployeeOperationalScope: require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js").assignEmployeeOperationalScope,
  };
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; this run never creates one`);
    const tenantId = tenant.rows[0].id;

    const live = await measureLiveFacts(pool, tenantId, options.adminPrincipalId, capabilitiesForRoleKeys);
    const plan = planPersonaAuthorityDimensions();
    const preflight = preflightAuthorityPlan(plan, live);

    const actor = { tenantId, principalId: options.adminPrincipalId, capabilities: live.capabilities };
    const outcomes = [];
    for (const step of preflight.applicable) {
      if (!options.apply) {
        outcomes.push({ command: step.command, target: step.input, outcome: "PLANNED" });
        continue;
      }
      const result = await commands[step.command]({ pool }, actor, step.input);
      outcomes.push({ command: step.command, target: step.input, outcome: result.outcome });
    }
    console.log(JSON.stringify({
      environment: options.environmentId,
      tenantKey: options.tenantKey,
      tenantId,
      adminRoleKeys: live.roleKeys.sort(),
      apply: options.apply,
      counts: preflight.counts,
      blocked: preflight.blocked.map((b) => ({ code: b.code, detail: b.detail, command: b.step.command, employeeId: b.step.input.employeeId })),
      outcomes,
    }, null, 2));
    // A blocked step is a REPORTED refusal, not a crash -- and not a success either.
    process.exitCode = preflight.blocked.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = { assertSeedInvocation, measureLiveFacts };

if (require.main === module) {
  main().catch((err) => {
    const governed = !err || !err.code || typeof err.code === "string";
    console.error(JSON.stringify({
      outcome: "REFUSED_OR_FAILED",
      message: governed ? (err instanceof Error ? err.message : String(err)) : "the run could not be completed",
    }, null, 2));
    process.exitCode = 2;
  });
}
