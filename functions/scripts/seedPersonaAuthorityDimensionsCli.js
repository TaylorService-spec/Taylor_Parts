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
// ════════════════════ THE TWO MODES, AND WHY THE DEFAULT FAILS CLOSED ════════════════════
//
// Owner ruling, docs/DECISIONS.md #180: "Future persona tooling must not broadly reconcile missing
// Role grants unless explicitly operating in a governed catalog-reconciliation mode."
//
//   DEFAULT -- PERSONA_PROVISIONING. Writes the two persona authorities through their governed
//     commands. It NEVER writes eos_policy.role_capabilities. A persona step whose capability the
//     canonical policy catalog does not declare is reported POLICY_RECONCILIATION_REQUIRED, is never
//     attempted, writes nothing, and the process exits 3 -- which is neither 0 nor the ordinary
//     blocked-step 1, so it cannot be read as success and cannot be read as a routine partial run.
//
//   --governedCatalogReconciliation --ownerDecision 180 -- GOVERNED_CATALOG_RECONCILIATION. Runs the
//     EXISTING governed Role-catalog derivation (eosOps/migration/inventoryCapabilityGrantMigration),
//     bounded to the capability keys THIS persona plan requires and refused outright for any key
//     outside the declared Employee grant set. It provisions NO persona: not one Work Eligibility
//     row, not one Operational Scope row. One run, one authority.
//
// Both flags are required together, and neither is accepted alone. Nothing in the environment, the
// database or a prior run makes an invocation reconciliation-capable.
//
// ════════════════════ THE FENCE ════════════════════
//
// Before `pg` or lib/ loads: a registry --environment that is production by neither role nor project
// id, EOS_ENVIRONMENT exactly `nonprod`, the frozen Certification world refused by id,
// --tenantKey / --performedBy / --adminPrincipalId required, and the mode pair resolved. The tenant
// is resolved by key, never created.
//
// Usage:
//   node scripts/seedPersonaAuthorityDimensionsCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> \
//     --adminPrincipalId <principal> [--apply]
//
//   node scripts/seedPersonaAuthorityDimensionsCli.js --environment platform-sandbox \
//     --databaseUrlEnv DATABASE_URL --tenantKey taylor-nonprod --performedBy <operator> \
//     --adminPrincipalId <principal> --governedCatalogReconciliation --ownerDecision 180 [--apply]
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const { planPersonaAuthorityDimensions } = require("./sampleCompany/personaAuthorityDimensions.js");
const {
  preflightAuthorityPlan, resolveSeedOutcome, assertPersonaWriteTarget,
  PERSONA_PROVISIONING_MODE, GOVERNED_CATALOG_RECONCILIATION_MODE,
} = require("./sampleCompany/personaE2EHarness.js");

const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);

/**
 * The Owner decision that accepted the governed catalog reconciliation, named on the command line as
 * a second explicit act. A number typed here is not a permission -- the acceptance is recorded in
 * docs/DECISIONS.md and this constant only makes the operator say which decision they are acting on.
 */
const OWNER_ACCEPTED_CATALOG_RECONCILIATION = "180";

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
    mode: assertProvisioningMode(args),
  };
}

/**
 * Resolve the run's mode. PERSONA_PROVISIONING unless the operator names the other one, twice.
 *
 * Neither flag is accepted alone: `--governedCatalogReconciliation` without the Owner decision is a
 * mode nobody authorized, and `--ownerDecision` without the mode flag is an operator who believes
 * they asked for reconciliation and did not. Both refusals happen before `pg` or lib/ is resolved.
 */
function assertProvisioningMode(args) {
  const requested = args.governedCatalogReconciliation === "true";
  const decision = args.ownerDecision;
  if (!requested) {
    if (decision !== undefined) {
      throw new Error("--ownerDecision is only meaningful with --governedCatalogReconciliation; a persona provisioning run reconciles nothing.");
    }
    return PERSONA_PROVISIONING_MODE;
  }
  if (decision !== OWNER_ACCEPTED_CATALOG_RECONCILIATION) {
    throw new Error(
      `--governedCatalogReconciliation requires --ownerDecision ${OWNER_ACCEPTED_CATALOG_RECONCILIATION} (docs/DECISIONS.md): `
      + "the governed catalog-reconciliation mode is named per run and is never a default.");
  }
  return GOVERNED_CATALOG_RECONCILIATION_MODE;
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
  // WHAT THE CANONICAL CATALOG DECLARES AT ALL, for any Role in this tenant -- not what this
  // Principal holds. A capability absent here is live for nobody, and the difference is the whole
  // point of the POLICY_RECONCILIATION_REQUIRED block code.
  const catalogCapabilityKeys = new Set((await pool.query(
    `SELECT DISTINCT c.key FROM eos_policy.role_capabilities rc
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1`, [tenantId])).rows.map((r) => r.key));
  const employeeIds = new Set((await pool.query(
    "SELECT id FROM eos_workforce.employees WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id));
  const warehouseIds = new Set((await pool.query(
    "SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1", [tenantId])).rows.map((r) => r.id));
  const activeOperatingCompanyKeys = new Set((await pool.query(
    "SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND status = 'ACTIVE'",
    [tenantId])).rows.map((r) => r.operating_company_key));
  return { roleKeys, catalogCapabilityKeys, capabilities, employeeIds, warehouseIds, activeOperatingCompanyKeys };
}

/**
 * The governed catalog-reconciliation run. Reached ONLY through the explicitly named mode.
 *
 * It is bounded twice over: to the capability keys THIS persona plan requires, and to the declared
 * Employee grant set (eosWorkforce/migration/employeeCapabilityGrants). A key outside that set is
 * refused rather than reconciled, so the mode cannot be used as a general grant tool. Who holds each
 * key is DERIVED from the compiled Role catalog, exactly as it was for the six rows the Owner
 * accepted -- this run names no Role.
 */
async function runGovernedCatalogReconciliation(pool, tenantId, plan, options) {
  assertPersonaWriteTarget(GOVERNED_CATALOG_RECONCILIATION_MODE, "eos_policy.role_capabilities");
  const { EMPLOYEE_CAPABILITY_GRANT_KEYS } = require("../lib/eosWorkforce/migration/employeeCapabilityGrants.js");
  const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
  const required = [...new Set(plan.map((s) => s.requiresCapability))].sort();
  const outside = required.filter((k) => !EMPLOYEE_CAPABILITY_GRANT_KEYS.includes(k));
  if (outside.length > 0) {
    throw new Error(`the governed catalog-reconciliation mode reconciles only declared Employee grant keys; refused: ${outside.join(", ")}`);
  }
  return reconcileInventoryCapabilityGrants(pool, {
    tenantId, apply: options.apply, capabilityKeys: required,
    actor: `persona-catalog-reconciliation:${options.performedBy}`,
  });
}

async function main() {
  const options = assertSeedInvocation(parseArgs(process.argv.slice(2)), process.env);
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  try {
    const tenant = await pool.query("SELECT id FROM eos_policy.tenants WHERE key = $1", [options.tenantKey]);
    if (tenant.rows.length !== 1) throw new Error(`no tenant with key ${options.tenantKey}; this run never creates one`);
    const tenantId = tenant.rows[0].id;
    const plan = planPersonaAuthorityDimensions();

    // ════ GOVERNED CATALOG RECONCILIATION: the catalog, and NOTHING else ════
    //
    // The persona writers are not even loaded on this path, so the disjointness is a property of the
    // process rather than a promise made in a comment.
    if (options.mode === GOVERNED_CATALOG_RECONCILIATION_MODE) {
      const report = await runGovernedCatalogReconciliation(pool, tenantId, plan, options);
      console.log(JSON.stringify({
        mode: options.mode,
        ownerDecision: OWNER_ACCEPTED_CATALOG_RECONCILIATION,
        environment: options.environmentId,
        tenantKey: options.tenantKey,
        tenantId,
        apply: options.apply,
        personaStepsAttempted: 0,
        outcome: report.unresolved.length > 0 ? "UNRESOLVED" : (options.apply ? "RECONCILED" : "PLANNED"),
        report,
      }, null, 2));
      process.exitCode = report.unresolved.length > 0 ? 1 : 0;
      return;
    }

    // ════ PERSONA PROVISIONING: the two governed persona authorities, and NOTHING else ════
    for (const target of ["eos_workforce.employee_work_eligibility", "eos_workforce.employee_operational_scopes"]) {
      assertPersonaWriteTarget(PERSONA_PROVISIONING_MODE, target);
    }
    const commands = {
      assignEmployeeWorkEligibility: require("../lib/eosWorkforce/commands/employeeWorkEligibilityCommands.js").assignEmployeeWorkEligibility,
      assignEmployeeOperationalScope: require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js").assignEmployeeOperationalScope,
    };

    const live = await measureLiveFacts(pool, tenantId, options.adminPrincipalId, capabilitiesForRoleKeys);
    const preflight = preflightAuthorityPlan(plan, live);
    const resolved = resolveSeedOutcome(options.mode, options.apply, preflight.blocked);

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
      mode: options.mode,
      outcome: resolved.outcome,
      // A capability the CATALOG lacks is named here, with the remedy, because the operator's next
      // act is a different, explicitly named run -- never a wider grant and never a retry of this one.
      policyReconciliationRequired: resolved.capabilities,
      remedy: resolved.remedy,
      catalogReconciliationPerformed: false,
      environment: options.environmentId,
      tenantKey: options.tenantKey,
      tenantId,
      adminRoleKeys: live.roleKeys.sort(),
      apply: options.apply,
      counts: preflight.counts,
      blocked: preflight.blocked.map((b) => ({ code: b.code, detail: b.detail, command: b.step.command, employeeId: b.step.input.employeeId })),
      outcomes,
    }, null, 2));
    // A blocked step is a REPORTED refusal, not a crash -- and not a success either. An unreconciled
    // CATALOG exits 3, distinct from both 0 and the ordinary blocked-step 1.
    process.exitCode = resolved.exitCode;
  } finally {
    await pool.end();
  }
}

module.exports = {
  OWNER_ACCEPTED_CATALOG_RECONCILIATION,
  assertSeedInvocation,
  assertProvisioningMode,
  measureLiveFacts,
};

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
