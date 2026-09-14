// MEASURE FIRST, PART THREE -- the read-only nonprod activation measurements the two existing tools do
// not take: Employee population (C), Employee <-> Principal linkage (D), Owner vs Accountable Person (G)
// and Security Role occupancy (H).
//
// ============================ WHAT THIS IS, AND WHAT IT IS NOT ============================
//
// Legacy person references (E) are measured by measureEmployeeReferenceIntegrity.js and commercial
// accountability classification (F) by measureCommercialAccountability.js. This tool does not repeat
// either. It exists because nothing in the repository answered "how many Employees, in which lifecycle
// state, linked to which Principals, holding which Security Roles" against a real database, and
// Employee v4.1 must be built against that answer rather than against an assumption.
//
// It COUNTS. It performs no backfill, repair, link, assignment or inference. A zero is a measurement and
// is printed as 0; a relation that cannot be read is reported as NOT MEASURED and is never printed as 0.
//
// ============================ READ ONLY, BY CONSTRUCTION ============================
//
// Every statement is a SELECT, issued inside `SET TRANSACTION READ ONLY`, so the DATABASE refuses a
// write even if a future edit here attempted one. functions/test/workforceActivationMeasurement.test.mjs
// asserts the absence of write verbs statically. No Firebase module is loaded: Firestore, `users` and
// Firebase UIDs are not person authority (#187 s2), and measuring through them would be the inference
// #189 forbids.
//
// ============================ THE FENCE ============================
//
// SHARED, not reimplemented: `assertMeasurementTarget` from measureEmployeeReferenceIntegrity.js requires
// an explicit `--environment` declared in config/environments.json and an explicit `--databaseUrlEnv`
// naming the variable that holds the connection string, and refuses production by role AND by project id.
//
// PLUS A POSITIVE NONPROD IDENTIFICATION. Refusing production is not the same as knowing the target is
// nonprod. The trusted API's own process label is `EOS_ENVIRONMENT` (functions/src/eosApi/server.ts),
// and render.yaml declares it `nonprod` on the service whose database this measures. This tool requires
// that label to read exactly `nonprod` in the running process -- so it runs where the nonprod service
// runs (Render Shell on eos-api-nonprod), and refuses on a machine that has not declared itself nonprod.
// The refusal precedes any client: `pg` and `lib/` are required inside main(), after the fence.
//
// The connection is opened through resolvePolicyDatabaseConfig, the application's own connection path,
// with the string taken from the named variable. The string is never printed.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/measureWorkforceActivation.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL
//
// Output: one deterministic JSON document on stdout (no timestamps, sorted breakdowns).
// Exit: 0 every section measured; 1 at least one section NOT MEASURED; 2 fence refusal or connection
// failure. Anomaly counts above zero do NOT change the exit code -- they are findings, not failures.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");

const NONPROD_LABEL = "nonprod";

/** Mirrored from functions/src/employeeIdentity/employeeAuthority.ts; the test asserts equality. */
const EMPLOYMENT_STATUS_VALUES = Object.freeze(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);

/** OD-16 scope, mirrored from responsibility/accountabilityFamilyScope.ts; the test asserts equality. */
const COMMERCIAL_TABLES = Object.freeze([
  Object.freeze({ family: "opportunity", table: "opportunities" }),
  Object.freeze({ family: "salesAgreement", table: "sales_agreements" }),
  Object.freeze({ family: "salesOrder", table: "sales_orders" }),
]);

const RELATIONS = Object.freeze({
  C: ["eos_workforce.employees", "eos_policy.tenants"],
  D: ["eos_workforce.employees", "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.employee_principal_links"],
  G: COMMERCIAL_TABLES.map((t) => `eos_commercial.${t.table}`),
  H: ["eos_workforce.employees", "eos_policy.roles", "eos_policy.user_role_assignments", "eos_policy.principals", "eos_policy.tenant_memberships", "eos_policy.employee_principal_links"],
});

/** Positive nonprod identification, in addition to the shared production refusal. */
function assertNonprodRuntime(env) {
  const label = env.EOS_ENVIRONMENT;
  if (label !== NONPROD_LABEL) {
    throw new Error(
      `EOS_ENVIRONMENT must read exactly '${NONPROD_LABEL}' in this process (it reads ${label === undefined ? "nothing" : `'${label}'`}). ` +
        "This tool measures only a target positively identified as nonprod -- run it where render.yaml declares " +
        "EOS_ENVIRONMENT=nonprod (Render Shell on eos-api-nonprod). Refusing production is not the same as knowing the target is nonprod."
    );
  }
}

const n = (v) => Number(v);
const statusCounts = (rows) => {
  const out = {};
  for (const s of EMPLOYMENT_STATUS_VALUES) out[s] = 0;
  for (const r of rows) out[r.status] = n(r.count);
  return out;
};

async function missingRelations(client, names) {
  const res = await client.query(
    `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
      WHERE table_schema || '.' || table_name = ANY($1::text[])`,
    [names]
  );
  const present = new Set(res.rows.map((r) => r.name));
  return names.filter((name) => !present.has(name));
}

// ---------------------------------------------------------------- C. Employee population

async function measureEmployees(client) {
  const totals = (await client.query(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE NOT (e.id <> '' AND btrim(e.id) = e.id AND position('/' in e.id) = 0)) AS malformed_id,
            count(*) FILTER (WHERE e.operating_company_id IS NULL OR e.operating_company_id !~ '^[a-z][a-z0-9_-]{1,62}$') AS malformed_operating_company,
            count(*) FILTER (WHERE t.id IS NULL) AS tenant_not_declared
       FROM eos_workforce.employees e LEFT JOIN eos_policy.tenants t ON t.id = e.tenant_id`
  )).rows[0];
  const byStatus = await client.query(
    `SELECT employment_status::text AS status, count(*) AS count FROM eos_workforce.employees GROUP BY 1`
  );
  const byCompany = await client.query(
    `SELECT tenant_id, operating_company_id, count(*) AS count FROM eos_workforce.employees
      GROUP BY 1, 2 ORDER BY 1, 2`
  );
  const duplicateIds = (await client.query(
    `SELECT count(*) AS count FROM (SELECT id FROM eos_workforce.employees GROUP BY id HAVING count(*) > 1) d`
  )).rows[0];
  const vocabulary = await client.query(
    `SELECT e.enumlabel AS label FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace ns ON ns.oid = t.typnamespace
      WHERE ns.nspname = 'eos_workforce' AND t.typname = 'workforce_employment_status'
      ORDER BY e.enumsortorder`
  );
  const databaseVocabulary = vocabulary.rows.map((r) => r.label);
  return {
    total: n(totals.total),
    byLifecycleStatus: statusCounts(byStatus.rows),
    byTenantAndOperatingCompany: byCompany.rows.map((r) => ({
      tenantId: r.tenant_id,
      operatingCompanyId: r.operating_company_id,
      count: n(r.count),
    })),
    authorityQuality: {
      // A malformed id fails the Employee port's reference shape and so can never be RESOLVED through it.
      malformedIdNotResolvableByPort: n(totals.malformed_id),
      malformedOperatingCompany: n(totals.malformed_operating_company),
      tenantNotDeclared: n(totals.tenant_not_declared),
      duplicateEmployeeIds: n(duplicateIds.count),
      lifecycleVocabularyMatchesGoverned:
        JSON.stringify(databaseVocabulary) === JSON.stringify(EMPLOYMENT_STATUS_VALUES),
      databaseLifecycleVocabulary: databaseVocabulary,
    },
    notMeasuredHere: {
      accountabilityEligibility:
        "policy-dependent (#189 MI-epsilon) and never derived from lifecycle; measured per stated policy by measureCommercialAccountability.js",
    },
  };
}

// ---------------------------------------------------------------- D. Employee <-> Principal linkage

async function measureLinks(client) {
  const row = (await client.query(
    `WITH active AS (SELECT * FROM eos_policy.employee_principal_links WHERE status = 'active')
     SELECT
       (SELECT count(*) FROM eos_workforce.employees) AS employees_total,
       (SELECT count(*) FROM eos_workforce.employees e WHERE EXISTS
          (SELECT 1 FROM active a WHERE a.employee_id = e.id AND a.tenant_id = e.tenant_id)) AS employees_with_active_link,
       (SELECT count(*) FROM eos_policy.principals) AS principals_total,
       (SELECT count(*) FROM eos_policy.principals WHERE status::text = 'active') AS principals_active,
       (SELECT count(*) FROM eos_policy.principals p WHERE EXISTS
          (SELECT 1 FROM active a WHERE a.principal_id = p.id)) AS principals_with_active_link,
       (SELECT count(*) FROM eos_policy.tenant_memberships) AS memberships_total,
       (SELECT count(*) FROM eos_policy.employee_principal_links) AS links_total,
       (SELECT count(*) FROM active) AS links_active,
       (SELECT count(*) FROM eos_policy.employee_principal_links WHERE status = 'revoked') AS links_revoked,
       (SELECT count(*) FROM active WHERE link_source = 'RECIPROCAL_FIREBASE_UID_LINK') AS source_reciprocal,
       (SELECT count(*) FROM active WHERE link_source = 'OPERATOR_ASSERTED') AS source_operator,
       (SELECT count(*) FROM active a WHERE NOT EXISTS
          (SELECT 1 FROM eos_workforce.employees e WHERE e.id = a.employee_id)) AS employee_unresolved,
       (SELECT count(*) FROM active a WHERE
          NOT EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.id = a.employee_id AND e.tenant_id = a.tenant_id)
          AND EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.id = a.employee_id)) AS employee_cross_tenant,
       (SELECT count(*) FROM active a WHERE NOT EXISTS
          (SELECT 1 FROM eos_policy.principals p WHERE p.id = a.principal_id)) AS principal_missing,
       (SELECT count(*) FROM active a JOIN eos_policy.principals p ON p.id = a.principal_id
          WHERE p.status::text <> 'active') AS principal_not_active,
       (SELECT count(*) FROM active a JOIN eos_policy.tenant_memberships m
          ON m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id
          WHERE m.status::text <> 'active') AS membership_not_active,
       (SELECT count(*) FROM active a JOIN eos_workforce.employees e
          ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
          WHERE e.operating_company_id <> a.operating_company_id) AS operating_company_mismatch,
       (SELECT count(*) FROM (SELECT 1 FROM active GROUP BY tenant_id, employee_id HAVING count(*) > 1) x) AS dup_employee,
       (SELECT count(*) FROM (SELECT 1 FROM active GROUP BY tenant_id, principal_id HAVING count(*) > 1) x) AS dup_principal`
  )).rows[0];
  const linkedByStatus = await client.query(
    `SELECT e.employment_status::text AS status, count(*) AS count
       FROM eos_policy.employee_principal_links a
       JOIN eos_workforce.employees e ON e.id = a.employee_id AND e.tenant_id = a.tenant_id
      WHERE a.status = 'active' GROUP BY 1`
  );
  return {
    employees: {
      total: n(row.employees_total),
      withActivePrincipalLink: n(row.employees_with_active_link),
      withoutActivePrincipalLink: n(row.employees_total) - n(row.employees_with_active_link),
      withActiveLinkByLifecycleStatus: statusCounts(linkedByStatus.rows),
    },
    principals: {
      total: n(row.principals_total),
      active: n(row.principals_active),
      withActiveEmployeeLink: n(row.principals_with_active_link),
      withoutActiveEmployeeLink: n(row.principals_total) - n(row.principals_with_active_link),
      tenantMemberships: n(row.memberships_total),
    },
    links: {
      total: n(row.links_total),
      active: n(row.links_active),
      revoked: n(row.links_revoked),
      activeBySource: { RECIPROCAL_FIREBASE_UID_LINK: n(row.source_reciprocal), OPERATOR_ASSERTED: n(row.source_operator) },
    },
    anomalies: {
      activeLinkEmployeeUnresolved: n(row.employee_unresolved),
      activeLinkEmployeeCrossTenant: n(row.employee_cross_tenant),
      activeLinkPrincipalMissing: n(row.principal_missing),
      activeLinkPrincipalNotActive: n(row.principal_not_active),
      activeLinkMembershipNotActive: n(row.membership_not_active),
      activeLinkOperatingCompanyMismatch: n(row.operating_company_mismatch),
      employeesWithMultipleActiveLinks: n(row.dup_employee),
      principalsWithMultipleActiveLinks: n(row.dup_principal),
    },
  };
}

// ---------------------------------------------------------------- G. Owner vs Accountable Person

async function measureOwnerAccountable(client) {
  const families = [];
  for (const ref of COMMERCIAL_TABLES) {
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'eos_commercial' AND table_name = $1 ORDER BY column_name`,
      [ref.table]
    );
    const names = columns.rows.map((r) => r.column_name);
    if (!names.includes("owner_employee_id") || !names.includes("accountable_employee_id")) {
      families.push({ family: ref.family, relation: `eos_commercial.${ref.table}`, measured: false,
        error: "owner_employee_id or accountable_employee_id is absent -- a FAILURE TO MEASURE, not a finding of zero" });
      continue;
    }
    const row = (await client.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE owner_employee_id IS NULL AND accountable_employee_id IS NULL) AS both_absent,
              count(*) FILTER (WHERE owner_employee_id IS NOT NULL AND accountable_employee_id IS NULL) AS owner_only,
              count(*) FILTER (WHERE owner_employee_id IS NULL AND accountable_employee_id IS NOT NULL) AS accountable_only,
              count(*) FILTER (WHERE owner_employee_id = accountable_employee_id) AS same_person,
              count(*) FILTER (WHERE owner_employee_id <> accountable_employee_id) AS different_person
         FROM eos_commercial.${ref.table}`
    )).rows[0];
    const counts = {
      bothAbsent: n(row.both_absent),
      ownerPresentAccountableMissing: n(row.owner_only),
      accountablePresentOwnerMissing: n(row.accountable_only),
      samePerson: n(row.same_person),
      differentPerson: n(row.different_person),
    };
    const summed = Object.values(counts).reduce((a, b) => a + b, 0);
    if (summed !== n(row.total)) {
      families.push({ family: ref.family, relation: `eos_commercial.${ref.table}`, measured: false,
        error: `classification does not partition the population: ${summed} of ${n(row.total)}` });
      continue;
    }
    families.push({
      family: ref.family,
      relation: `eos_commercial.${ref.table}`,
      measured: true,
      total: n(row.total),
      counts,
      // Stated from the schema, not inferred: whether this store can represent an assignee, or the
      // provenance (EXPLICIT vs DERIVED_FROM_RECORD_OWNER) of an accountable person, at all.
      assigneeColumns: names.filter((c) => c.includes("assign")),
      accountabilityColumns: names.filter((c) => c.startsWith("accountable")),
    });
  }
  return { scope: "OPPORTUNITY, SALES AGREEMENT, SALES ORDER only (#189 OD-16)", families };
}

// ---------------------------------------------------------------- H. Security Role occupancy

async function measureSecurityRoles(client) {
  const roles = await client.query(
    `SELECT r.tenant_id, r.key, r.origin::text AS origin,
            count(a.id) FILTER (WHERE a.status::text = 'active') AS active_assignments,
            count(a.id) FILTER (WHERE a.status::text <> 'active') AS inactive_assignments,
            count(DISTINCT a.principal_id) FILTER (WHERE a.status::text = 'active') AS active_principals
       FROM eos_policy.roles r LEFT JOIN eos_policy.user_role_assignments a ON a.role_id = r.id
      GROUP BY r.id, r.tenant_id, r.key, r.origin ORDER BY r.tenant_id, r.key`
  );
  const row = (await client.query(
    `WITH active AS (SELECT * FROM eos_policy.user_role_assignments WHERE status::text = 'active'),
          links AS (SELECT * FROM eos_policy.employee_principal_links WHERE status = 'active')
     SELECT
       (SELECT count(*) FROM eos_policy.user_role_assignments) AS assignments_total,
       (SELECT count(*) FROM active) AS assignments_active,
       (SELECT count(*) FROM active a JOIN eos_policy.roles r ON r.id = a.role_id WHERE r.tenant_id <> a.tenant_id) AS role_tenant_mismatch,
       (SELECT count(*) FROM active a WHERE NOT EXISTS (SELECT 1 FROM eos_policy.principals p WHERE p.id = a.principal_id)) AS principal_missing,
       (SELECT count(*) FROM active a JOIN eos_policy.principals p ON p.id = a.principal_id WHERE p.status::text <> 'active') AS principal_not_active,
       (SELECT count(*) FROM active a WHERE NOT EXISTS (SELECT 1 FROM eos_policy.tenant_memberships m
          WHERE m.tenant_id = a.tenant_id AND m.principal_id = a.principal_id)) AS not_tenant_member,
       (SELECT count(*) FROM active a WHERE NOT EXISTS (SELECT 1 FROM links l
          WHERE l.tenant_id = a.tenant_id AND l.principal_id = a.principal_id)) AS no_employee_link,
       (SELECT count(*) FROM active a JOIN links l ON l.tenant_id = a.tenant_id AND l.principal_id = a.principal_id
          WHERE NOT EXISTS (SELECT 1 FROM eos_workforce.employees e WHERE e.id = l.employee_id AND e.tenant_id = l.tenant_id)) AS linked_employee_missing,
       (SELECT count(DISTINCT (e.tenant_id, e.id)) FROM active a
          JOIN links l ON l.tenant_id = a.tenant_id AND l.principal_id = a.principal_id
          JOIN eos_workforce.employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id) AS employees_with_role`
  )).rows[0];
  const occupancyByStatus = await client.query(
    `SELECT e.employment_status::text AS status,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM eos_policy.employee_principal_links l
                JOIN eos_policy.user_role_assignments a ON a.tenant_id = l.tenant_id AND a.principal_id = l.principal_id
               WHERE l.status = 'active' AND a.status::text = 'active' AND l.employee_id = e.id AND l.tenant_id = e.tenant_id
            )) AS with_role,
            count(*) AS count
       FROM eos_workforce.employees e GROUP BY 1`
  );
  const roleRows = roles.rows.map((r) => ({
    tenantId: r.tenant_id,
    roleKey: r.key,
    origin: r.origin,
    activeAssignments: n(r.active_assignments),
    inactiveAssignments: n(r.inactive_assignments),
    activePrincipals: n(r.active_principals),
  }));
  const withRole = statusCounts(occupancyByStatus.rows.map((r) => ({ status: r.status, count: r.with_role })));
  const all = statusCounts(occupancyByStatus.rows);
  const withoutRole = {};
  for (const s of EMPLOYMENT_STATUS_VALUES) withoutRole[s] = all[s] - withRole[s];
  return {
    roles: {
      defined: roleRows.length,
      bySystemOrigin: roleRows.filter((r) => r.origin === "SYSTEM").length,
      byCustomOrigin: roleRows.filter((r) => r.origin === "CUSTOM").length,
      withZeroActiveOccupants: roleRows.filter((r) => r.activeAssignments === 0).length,
      occupancy: roleRows,
    },
    assignments: {
      total: n(row.assignments_total),
      active: n(row.assignments_active),
      inactive: n(row.assignments_total) - n(row.assignments_active),
    },
    employees: {
      // Reached only through Principal -> active governed link -> Employee. Never from a job title,
      // department, legacy Firebase role or usage.
      uniqueWithActiveSecurityRole: n(row.employees_with_role),
      withActiveSecurityRoleByLifecycleStatus: withRole,
      withoutActiveSecurityRoleByLifecycleStatus: withoutRole,
    },
    anomalies: {
      activeAssignmentRoleTenantMismatch: n(row.role_tenant_mismatch),
      activeAssignmentPrincipalMissing: n(row.principal_missing),
      activeAssignmentPrincipalNotActive: n(row.principal_not_active),
      activeAssignmentPrincipalNotTenantMember: n(row.not_tenant_member),
      activeAssignmentPrincipalWithoutEmployeeLink: n(row.no_employee_link),
      activeAssignmentLinkedEmployeeMissing: n(row.linked_employee_missing),
    },
  };
}

const SECTIONS = Object.freeze([
  ["C", "employeePopulation", measureEmployees],
  ["D", "employeePrincipalLinkage", measureLinks],
  ["G", "ownerVersusAccountable", measureOwnerAccountable],
  ["H", "securityRoleOccupancy", measureSecurityRoles],
]);

/** Every section, each independently: one unreadable relation never becomes another section's zero. */
async function measureWorkforceActivation(client) {
  const sections = {};
  const unmeasured = [];
  for (const [id, name, measure] of SECTIONS) {
    try {
      const missing = await missingRelations(client, RELATIONS[id]);
      if (missing.length > 0) {
        sections[name] = { id, measured: false, error: `relations not present: ${missing.join(", ")} -- a FAILURE TO MEASURE, not a finding of zero` };
      } else {
        sections[name] = { id, measured: true, ...(await measure(client)) };
      }
    } catch (err) {
      sections[name] = { id, measured: false, error: `read failed: ${err && err.message ? err.message : String(err)}` };
    }
    if (!sections[name].measured) unmeasured.push(id);
  }
  return {
    tool: "measureWorkforceActivation",
    readOnly: true,
    mutations: 0,
    sections,
    unmeasured,
    measuredElsewhere: {
      E: "scripts/measureEmployeeReferenceIntegrity.js",
      F: "scripts/measureCommercialAccountability.js",
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client exists.
  const { environmentId, connectionString } = assertMeasurementTarget(args, process.env);
  assertNonprodRuntime(process.env);

  // AFTER the fence, never at module scope.
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString }));
  await client.connect();
  let report;
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    report = await measureWorkforceActivation(client);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ environment: environmentId, runtimeLabel: NONPROD_LABEL, ...report }, null, 2));
  process.exitCode = report.unmeasured.length === 0 ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
}

module.exports = {
  assertNonprodRuntime,
  measureWorkforceActivation,
  COMMERCIAL_TABLES,
  EMPLOYMENT_STATUS_VALUES,
  RELATIONS,
};
