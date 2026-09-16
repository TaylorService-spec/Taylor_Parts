// SAMPLE COMPANY V2 -- the ONE verifier. Read-only, one JSON report, no secrets.
//
// ============================ WHAT IT PROVES, AND HOW ============================
//
// The point of this file is that it proves the sample company by RESOLUTION, not by row-counting.
//
//   ACCESS is resolved through the whole chain -- external subject -> Principal -> ACTIVE tenant
//   membership -> QUALIFYING Role assignments -> eos_policy.role_capabilities -> effective capability set --
//   using resolveOperationalContext / capabilitiesForRoleKeys, the SAME functions the Commercial, Workforce
//   and eos_ops transports resolve authorization with. The existence of an assignment row is NEVER accepted
//   as proof that a capability is held: a Role assigned but never granted its capabilities resolves to an
//   empty effective set, and that is precisely the "deployed code is not a live grant" failure this verifier
//   exists to catch. DENIALS are proved the same way and in the same run.
//
//   RELATIONSHIPS are resolved by following the actual foreign key each manifest triple names, so a dangling
//   reference fails rather than reading as absent.
//
//   BLOCKED relationships are reported as BLOCKED with their missing authority. A blocker is not a failure;
//   silently counting one as verified would be.
//
// READ ONLY BY CONSTRUCTION. Every statement is a SELECT, and the connection runs in a read-only
// transaction, so the DATABASE refuses a write even if a future edit to this file attempted one.
//
// NO SECRETS. The report carries no password, no connection string, no raw Firebase subject and no
// credential of any kind. Synthetic external subjects ARE printed -- they are fixture strings by
// construction (`synthetic-np-principal-*`, an identity provider no verifier recognizes) -- and the report
// refuses to print any subject that is not one.
//
// Usage:
//   node scripts/verifySampleCompany.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --performedBy <operator> --existingAdminPrincipalId <principal id>
//
// Exit 0 pass; 1 the report says pass:false; 2 refused or failed.
"use strict";

const { parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const {
  assertSampleCompanyInvocation, validateManifest, sampleCompanyCapabilityKeys,
  SYNTHETIC_IDENTITY_PROVIDER, PROFILE_COLUMNS, MANIFEST,
} = require("./seedSampleCompany.js");

const COMMERCIAL_TABLE = Object.freeze({ OPPORTUNITY: "opportunities", SALES_AGREEMENT: "sales_agreements", SALES_ORDER: "sales_orders" });
const COMMERCIAL_NUMBER = Object.freeze({ OPPORTUNITY: "opportunity_number", SALES_AGREEMENT: "sales_agreement_number", SALES_ORDER: "sales_order_number" });

/** A subject is printable only if it is a declared synthetic fixture subject. Nothing else is ever echoed. */
const printableSubject = (s) => (/^synthetic-np-principal-[a-z0-9-]+$/.test(String(s)) ? String(s) : "(redacted)");

/**
 * Verify the sample company. `client` is a pg Client already inside a READ ONLY transaction.
 *
 * Returns the single report object. It never throws for a business finding -- a finding is a `drift` or
 * `blockers` entry and `pass: false`. It throws only when it cannot read at all, because an absent answer
 * and an answer of "zero" are different facts and must never be conflated.
 */
async function verifySampleCompany(client, options, manifest = MANIFEST) {
  const lookups = validateManifest(manifest);
  const { employees, principalsByEmployee } = lookups;
  const employeeId = (key) => employees.get(key).id;
  const drift = [];
  const blockers = [];
  const fail = (domain, id, detail) => drift.push({ domain, id, detail });

  const tenant = await client.query(`SELECT id FROM eos_policy.tenants WHERE key = $1`, [options.tenantKey]);
  if (tenant.rows.length !== 1) {
    return {
      sampleCompanyVersion: manifest.sampleCompanyVersion, environment: options.environmentId,
      tenant: { key: options.tenantKey, resolved: false }, mode: "verify",
      domains: {}, personas: [], scenarios: [], relationships: { expected: 0, verified: 0, blocked: 0 },
      access: {}, drift: [{ domain: "tenant", id: options.tenantKey, detail: "no tenant with this key" }],
      blockers: [], pass: false,
    };
  }
  const tenantId = tenant.rows[0].id;

  // ════════════════ domains ════════════════
  const domains = {};
  const count = async (name, sql, values, expected) => {
    const { rows } = await client.query(sql, values);
    const found = Number(rows[0].n);
    domains[name] = { expected, found, status: found === expected ? "COMPLETE" : found === 0 ? "ABSENT" : "PARTIAL" };
    if (found !== expected) fail(name, name, `expected ${expected} rows, found ${found}`);
    return found;
  };

  const employeeIds = manifest.employees.map((e) => e.id);
  await count("workforce.employees",
    `SELECT count(*)::int AS n FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, employeeIds], manifest.employees.length);

  // Profile facts: every declared column must match, for every Employee. This is what catches a half-seeded
  // Employee that the row count alone would report as present.
  const profiles = await client.query(
    `SELECT id, employment_status::text AS employment_status, operating_company_id,
            ${PROFILE_COLUMNS.map(([, col]) => col).join(", ")}
       FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, employeeIds]);
  const profileById = new Map(profiles.rows.map((r) => [r.id, r]));
  let completeProfiles = 0;
  for (const e of manifest.employees) {
    const row = profileById.get(e.id);
    if (!row) continue;
    let ok = row.employment_status === e.employmentStatus && row.operating_company_id === manifest.company.operatingCompanyId;
    for (const [key, col] of PROFILE_COLUMNS) {
      const declared = e[key] ?? null;
      const stored = row[col] ?? null;
      const matches = col.endsWith("_date")
        ? (stored === null ? declared === null : (stored instanceof Date ? stored.toISOString().slice(0, 10) : String(stored).slice(0, 10)) === declared)
        : stored === declared;
      if (!matches) {
        ok = false;
        fail("workforce.employeeProfiles", e.id, `${col} does not match the manifest`);
        break;
      }
    }
    if (ok) completeProfiles += 1;
    // JOB ROLE IS WRITTEN NOWHERE. If a job role column ever appears on this table, this verifier must be
    // revisited deliberately rather than quietly start passing.
    if (Object.keys(row).some((c) => /job_role/.test(c))) {
      fail("workforce.jobRole", e.id, "eos_workforce.employees has acquired a job role column; the manifest's non-authoritative Job Role metadata must be reviewed (EMP-RT-08)");
    }
  }
  domains["workforce.employeeProfiles"] = {
    expected: manifest.employees.length, found: completeProfiles,
    status: completeProfiles === manifest.employees.length ? "COMPLETE" : completeProfiles === 0 ? "ABSENT" : "PARTIAL",
  };

  await count("identity.principals",
    `SELECT count(*)::int AS n FROM eos_policy.principals p JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id
      WHERE m.tenant_id = $1 AND p.identity_provider = $2 AND p.external_subject = ANY($3::text[]) AND m.status = 'active' AND p.status = 'active'`,
    [tenantId, SYNTHETIC_IDENTITY_PROVIDER, manifest.principals.filter((p) => !p.existingAdministrator).map((p) => p.externalSubject)],
    manifest.principals.filter((p) => !p.existingAdministrator).length);

  await count("identity.employeePrincipalLinks",
    `SELECT count(*)::int AS n FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND status = 'active' AND employee_id = ANY($2::text[])`,
    [tenantId, [...principalsByEmployee.keys()].map(employeeId)], principalsByEmployee.size);

  await count("workforce.reportingRelationships",
    `SELECT count(*)::int AS n FROM eos_workforce.employee_reporting_relationships
      WHERE tenant_id = $1 AND effective_to IS NULL AND employee_id = ANY($2::text[])`,
    [tenantId, manifest.reportingRelationships.edges.map((e) => employeeId(e.employee))],
    manifest.reportingRelationships.edges.length);

  await count("crm.accounts", `SELECT count(*)::int AS n FROM eos_crm.accounts WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.accounts.map((a) => a.id)], manifest.accounts.length);
  await count("crm.contacts", `SELECT count(*)::int AS n FROM eos_crm.contacts WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.contacts.map((c) => c.id)], manifest.contacts.length);
  await count("crm.locations", `SELECT count(*)::int AS n FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.locations.map((l) => l.id)], manifest.locations.length);

  for (const [kind, table] of Object.entries(COMMERCIAL_TABLE)) {
    const numbers = manifest.commercial.filter((r) => r.kind === kind).map((r) => r.number);
    await count(`commercial.${table}`,
      `SELECT count(*)::int AS n FROM eos_commercial.${table} WHERE tenant_id = $1 AND ${COMMERCIAL_NUMBER[kind]} = ANY($2::text[])`,
      [tenantId, numbers], numbers.length);
  }

  await count("equipment.models", `SELECT count(*)::int AS n FROM eos_ops.equipment_models WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.equipmentModels.map((m) => m.id)], manifest.equipmentModels.length);
  await count("parts.identities", `SELECT count(*)::int AS n FROM eos_ops.parts WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.parts.records.map((p) => p.partId)], manifest.parts.records.length);
  await count("purchasing.suppliers", `SELECT count(*)::int AS n FROM eos_ops.suppliers WHERE tenant_id = $1 AND supplier_id = ANY($2::text[])`,
    [tenantId, manifest.suppliers.map((s) => s.supplierId)], manifest.suppliers.length);
  await count("purchasing.supplierCatalogItems",
    `SELECT count(*)::int AS n FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1 AND part_id = ANY($2::text[])`,
    [tenantId, manifest.supplierCatalogItems.map((i) => i.partId)], manifest.supplierCatalogItems.length);
  await count("warehouse.warehouses", `SELECT count(*)::int AS n FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, manifest.warehouses.map((w) => w.warehouseId)], manifest.warehouses.length);
  await count("warehouse.bins", `SELECT count(*)::int AS n FROM eos_ops.bins WHERE tenant_id = $1 AND idempotency_key = ANY($2::text[])`,
    [tenantId, manifest.bins.map((b) => b.idempotencyKey)], manifest.bins.length);
  await count("trucks.mobileLocations", `SELECT count(*)::int AS n FROM eos_ops.mobile_locations WHERE tenant_id = $1 AND location_id = ANY($2::text[])`,
    [tenantId, manifest.trucks.mobileLocations.map((l) => l.locationId)], manifest.trucks.mobileLocations.length);
  await count("trucks.trucks", `SELECT count(*)::int AS n FROM eos_ops.trucks WHERE tenant_id = $1 AND truck_id = ANY($2::text[])`,
    [tenantId, manifest.trucks.records.map((t) => t.truckId)], manifest.trucks.records.length);
  await count("purchasing.reorderRequests", `SELECT count(*)::int AS n FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = ANY($2::text[])`,
    [tenantId, manifest.purchasing.map((p) => p.reorderRequestNumber)], manifest.purchasing.length);
  await count("purchasing.purchaseOrders", `SELECT count(*)::int AS n FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND external_po_number = ANY($2::text[])`,
    [tenantId, manifest.purchasing.map((p) => p.purchaseOrder.externalPoNumber)], manifest.purchasing.length);
  await count("receiving.receivingOrders", `SELECT count(*)::int AS n FROM eos_ops.receiving_orders WHERE tenant_id = $1 AND receiving_order_number = ANY($2::text[])`,
    [tenantId, manifest.purchasing.filter((p) => p.progressTo === "RECEIVED").map((p) => p.receipt.receivingOrderNumber)],
    manifest.purchasing.filter((p) => p.progressTo === "RECEIVED").length);
  await count("purchasing.purchaseOrderVoids", `SELECT count(*)::int AS n FROM eos_ops.purchase_order_voids WHERE tenant_id = $1`,
    [tenantId], manifest.purchasing.filter((p) => p.progressTo === "VOIDED").length);

  const cycleLines = manifest.cycleCounts.flatMap((c) => c.lines);
  await count("cycleCount.sheets",
    `SELECT count(*)::int AS n FROM eos_ops.cycle_count_sheets WHERE tenant_id = $1 AND operating_company_key = $2`,
    [tenantId, manifest.company.operatingCompanyKey], manifest.cycleCounts.length);
  await count("cycleCount.lines",
    `SELECT count(*)::int AS n FROM eos_ops.cycle_count_lines l JOIN eos_ops.cycle_count_sheets s ON s.id = l.sheet_id
      WHERE l.tenant_id = $1 AND s.operating_company_key = $2`,
    [tenantId, manifest.company.operatingCompanyKey], cycleLines.length);
  await count("inventory.movements",
    `SELECT count(*)::int AS n FROM eos_ops.inventory_movements WHERE tenant_id = $1 AND operating_company_key = $2 AND source_kind = 'CYCLE_COUNT_LINE'`,
    [tenantId, manifest.company.operatingCompanyKey], cycleLines.filter((l) => l.expectMovement).length);

  // Domains with no current authority are reported as BLOCKED rather than measured as zero.
  for (const b of manifest.blockedRelationships) {
    blockers.push({ code: b.code, desired: b.desired, missingAuthority: b.missingAuthority, domains: b.domains });
    for (const d of b.domains) {
      const existing = domains[`blocked.${d}`];
      domains[`blocked.${d}`] = { status: "BLOCKED", blockedBy: [...(existing?.blockedBy ?? []), b.code] };
    }
  }

  // ════════════════ access: EFFECTIVE resolution, per persona ════════════════
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { resolveOperationalContext, capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
  // The read path takes a Pool-shaped object; the read-only client satisfies every call these make.
  const reader = new PostgresPolicyRepository(client);

  const personas = [];
  const grantRows = [];
  const capabilityKeys = new Set(sampleCompanyCapabilityKeys(manifest));

  // LIVE GRANT truth, once: which (Role key, capability key) pairs actually exist in role_capabilities.
  const live = await client.query(
    `SELECT r.key AS role_key, c.key AS capability_key
       FROM eos_policy.role_capabilities rc
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
       JOIN eos_policy.roles r ON r.id = rc.role_id
      WHERE rc.tenant_id = $1 AND r.tenant_id = $1`, [tenantId]);
  const liveByRole = new Map();
  for (const row of live.rows) {
    if (!liveByRole.has(row.role_key)) liveByRole.set(row.role_key, new Set());
    liveByRole.get(row.role_key).add(row.capability_key);
  }

  const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
  const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
  const roleCatalog = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const usedRoleKeys = [...new Set(manifest.principals.flatMap((p) => p.securityRoles))].sort();
  for (const roleKey of usedRoleKeys) {
    const expected = (roleCatalog[roleKey]?.permissions ?? []).filter((k) => capabilityKeys.has(k)).sort();
    const held = liveByRole.get(roleKey) ?? new Set();
    for (const capability of expected) {
      const granted = held.has(capability);
      grantRows.push({ role: roleKey, expectedCapability: capability, liveGrant: granted, status: granted ? "GRANTED" : "MISSING_GRANT" });
    }
  }
  const missingGrants = grantRows.filter((g) => g.status === "MISSING_GRANT");
  for (const g of missingGrants) fail("access.capabilityGrants", `${g.role}/${g.expectedCapability}`, "the Role catalog declares this capability but no live grant exists");

  for (const p of manifest.principals) {
    const employee = employees.get(p.employee);
    const contract = manifest.expectedAccess.personas[p.employee];
    const persona = {
      employeeKey: p.employee,
      employeeId: employee.id,
      jobRole: employee.jobRole,
      jobRoleAuthority: "MANIFEST_METADATA_ONLY",
      userAccessState: employee.userAccess.state,
      interactiveLogin: employee.sandboxPersona?.interactiveLogin === true,
      securityRoles: p.securityRoles,
      externalSubject: p.existingAdministrator ? "(the reused existing administrator)" : printableSubject(p.externalSubject),
      identityProvider: p.existingAdministrator ? "(unchanged)" : SYNTHETIC_IDENTITY_PROVIDER,
      resolved: false, heldRoleKeys: [], requiredCapabilities: [], forbiddenCapabilities: [],
      missingCapabilities: [], heldForbiddenCapabilities: [],
      expectedSurfaces: contract.expectedSurfaces, deniedSurfaces: contract.deniedSurfaces,
      accessModelGap: contract.accessModelGap ?? null,
      employeeLink: null, manager: null,
    };

    // THE WHOLE CHAIN. For a fixture Principal this runs through resolveOperationalContext exactly as a
    // request would; for the reused administrator the subject is not printed, so its effective set is
    // resolved from the Principal id through the same last hop instead.
    let effective;
    try {
      if (p.existingAdministrator) {
        const assignments = await reader.listAssignmentsForPrincipal(tenantId, options.existingAdminPrincipalId);
        const roles = await reader.listRoles(tenantId);
        const keyById = new Map(roles.map((r) => [r.id, r.key]));
        persona.heldRoleKeys = [...new Set(assignments.filter((a) => a.status === "active").map((a) => keyById.get(a.roleId)).filter(Boolean))].sort();
        effective = await capabilitiesForRoleKeys(client, tenantId, persona.heldRoleKeys);
      } else {
        const ctx = await resolveOperationalContext(reader, client, {
          identityProvider: SYNTHETIC_IDENTITY_PROVIDER, externalSubject: p.externalSubject, requestedTenantId: tenantId,
        });
        persona.heldRoleKeys = [...ctx.principalContext.heldRoleKeys].sort();
        effective = ctx.capabilities;
      }
      persona.resolved = true;
    } catch (err) {
      effective = new Set();
      fail("access.resolution", p.employee, `the identity chain did not resolve: ${err instanceof Error ? err.message : String(err)}`);
    }

    // A Role ASSIGNED but not RESOLVED is a real finding, and the row count above would not have caught it.
    for (const roleKey of p.securityRoles) {
      if (persona.resolved && !persona.heldRoleKeys.includes(roleKey)) {
        fail("access.roleAssignments", `${p.employee}:${roleKey}`, "the Role is declared but does not resolve as held");
      }
    }
    persona.requiredCapabilities = contract.requiredCapabilities.map((c) => ({ capability: c, held: effective.has(c) }));
    persona.forbiddenCapabilities = contract.forbiddenCapabilities.map((c) => ({ capability: c, held: effective.has(c) }));
    persona.missingCapabilities = contract.requiredCapabilities.filter((c) => !effective.has(c));
    persona.heldForbiddenCapabilities = contract.forbiddenCapabilities.filter((c) => effective.has(c));
    for (const c of persona.missingCapabilities) fail("access.requiredCapability", `${p.employee}:${c}`, "required but not resolved through the identity chain");
    for (const c of persona.heldForbiddenCapabilities) fail("access.forbiddenCapability", `${p.employee}:${c}`, "FORBIDDEN but resolved as held");

    // The Employee link is a separate fact from the Role assignment, and is checked separately.
    const link = await client.query(
      `SELECT employee_id FROM eos_policy.employee_principal_links
        WHERE tenant_id = $1 AND status = 'active' AND employee_id = $2`, [tenantId, employee.id]);
    persona.employeeLink = link.rows.length === 1 ? "ACTIVE" : "MISSING";
    if (link.rows.length !== 1) fail("identity.employeePrincipalLinks", p.employee, "no single active Employee/Principal link");
    personas.push(persona);
  }

  // No-access personas: the Employee != User Access proof, verified rather than asserted.
  for (const [key, declared] of Object.entries(manifest.expectedAccess.noAccessPersonas)) {
    const employee = employees.get(key);
    const links = await client.query(
      `SELECT count(*)::int AS n FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active'`,
      [tenantId, employee.id]);
    const n = Number(links.rows[0].n);
    if (n !== declared.expectedPrincipals) {
      fail("identity.noAccessPersonas", key, `declares userAccess ${declared.userAccessState} but has ${n} active Principal link(s)`);
    }
    personas.push({
      employeeKey: key, employeeId: employee.id, jobRole: employee.jobRole, jobRoleAuthority: "MANIFEST_METADATA_ONLY",
      userAccessState: employee.userAccess.state, interactiveLogin: false, securityRoles: [],
      externalSubject: null, identityProvider: null, resolved: true, heldRoleKeys: [],
      requiredCapabilities: [], forbiddenCapabilities: [], missingCapabilities: [], heldForbiddenCapabilities: [],
      expectedSurfaces: [], deniedSurfaces: declared.deniedSurfaces,
      accessModelGap: null, employeeLink: n === 0 ? "NONE_BY_DESIGN" : "UNEXPECTED", manager: null,
    });
  }

  // ════════════════ reporting line, per Employee ════════════════
  const managers = await client.query(
    `SELECT employee_id, manager_employee_id FROM eos_workforce.employee_reporting_relationships
      WHERE tenant_id = $1 AND effective_to IS NULL`, [tenantId]);
  const managerById = new Map(managers.rows.map((r) => [r.employee_id, r.manager_employee_id]));
  const personaByKey = new Map(personas.map((p) => [p.employeeKey, p]));
  for (const e of manifest.employees) {
    const expected = e.manager === null ? null : employeeId(e.manager);
    const found = managerById.get(e.id) ?? null;
    const persona = personaByKey.get(e.key);
    if (persona) persona.manager = found;
    if (expected !== found) fail("workforce.reportingRelationships", e.key, `expected manager ${expected ?? "(none)"}, found ${found ?? "(none)"}`);
  }
  // Managed Employees must be NON-VACUOUS at every level the management scenario claims.
  const management = manifest.scenarios.find((s) => s.id === "H");
  for (const [key, expectedCount] of Object.entries(management.expectedDirectReportCounts)) {
    const actual = [...managerById.values()].filter((m) => m === employeeId(key)).length;
    if (actual !== expectedCount) fail("workforce.managedEmployees", key, `expected ${expectedCount} direct reports, found ${actual}`);
  }

  // ════════════════ relationship assertions ════════════════
  const relationshipResolvers = {
    OWNS: async (subject, object) => {
      const [, employeeKey] = subject.split(":");
      const [kind, id] = object.split(":");
      const table = kind === "account" ? { schema: "eos_crm", table: "accounts", key: "id" }
        : kind === "opportunity" ? { schema: "eos_commercial", table: "opportunities", key: "opportunity_number" } : null;
      if (!table) return "UNRESOLVABLE";
      const { rows } = await client.query(
        `SELECT owner_employee_id FROM ${table.schema}.${table.table} WHERE tenant_id = $1 AND ${table.key} = $2`, [tenantId, id]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].owner_employee_id === employeeId(employeeKey) ? "VERIFIED" : "MISMATCH";
    },
    ACCOUNTABLE_FOR: async (subject, object) => {
      const [, employeeKey] = subject.split(":");
      const [kind, id] = object.split(":");
      const map = { opportunity: ["opportunities", "opportunity_number"], salesAgreement: ["sales_agreements", "sales_agreement_number"], salesOrder: ["sales_orders", "sales_order_number"] };
      if (!map[kind]) return "UNRESOLVABLE";
      const [table, numberColumn] = map[kind];
      const { rows } = await client.query(
        `SELECT accountable_employee_id FROM eos_commercial.${table} WHERE tenant_id = $1 AND ${numberColumn} = $2`, [tenantId, id]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].accountable_employee_id === employeeId(employeeKey) ? "VERIFIED" : "MISMATCH";
    },
    HAS_CONTACT: async (subject, object) => {
      const { rows } = await client.query(`SELECT account_id FROM eos_crm.contacts WHERE tenant_id = $1 AND id = $2`, [tenantId, object.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].account_id === subject.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    HAS_LOCATION: async (subject, object) => {
      const { rows } = await client.query(`SELECT account_id FROM eos_crm.account_locations WHERE tenant_id = $1 AND id = $2`, [tenantId, object.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].account_id === subject.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    INHERITS_OWNER_FROM: async (subject, object) => {
      const contact = await client.query(`SELECT owner_employee_id FROM eos_crm.contacts WHERE tenant_id = $1 AND id = $2`, [tenantId, subject.split(":")[1]]);
      const account = await client.query(`SELECT owner_employee_id FROM eos_crm.accounts WHERE tenant_id = $1 AND id = $2`, [tenantId, object.split(":")[1]]);
      if (contact.rows.length === 0 || account.rows.length === 0) return "DANGLING";
      return contact.rows[0].owner_employee_id === account.rows[0].owner_employee_id ? "VERIFIED" : "MISMATCH";
    },
    FOR_ACCOUNT: async (subject, object) => {
      const { rows } = await client.query(`SELECT account_id FROM eos_commercial.opportunities WHERE tenant_id = $1 AND opportunity_number = $2`, [tenantId, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].account_id === object.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    FROM_OPPORTUNITY: async (subject, object) => {
      const agreement = await client.query(`SELECT opportunity_id FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND sales_agreement_number = $2`, [tenantId, subject.split(":")[1]]);
      const opportunity = await client.query(`SELECT id FROM eos_commercial.opportunities WHERE tenant_id = $1 AND opportunity_number = $2`, [tenantId, object.split(":")[1]]);
      if (agreement.rows.length === 0 || opportunity.rows.length === 0) return "DANGLING";
      return agreement.rows[0].opportunity_id === opportunity.rows[0].id ? "VERIFIED" : "MISMATCH";
    },
    FROM_AGREEMENT: async (subject, object) => {
      const order = await client.query(`SELECT sales_agreement_id FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND sales_order_number = $2`, [tenantId, subject.split(":")[1]]);
      const agreement = await client.query(`SELECT id FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND sales_agreement_number = $2`, [tenantId, object.split(":")[1]]);
      if (order.rows.length === 0 || agreement.rows.length === 0) return "DANGLING";
      return order.rows[0].sales_agreement_id === agreement.rows[0].id ? "VERIFIED" : "MISMATCH";
    },
    REPORTS_TO: async (subject, object) => {
      const found = managerById.get(employeeId(subject.split(":")[1])) ?? null;
      if (found === null) return "DANGLING";
      return found === employeeId(object.split(":")[1]) ? "VERIFIED" : "MISMATCH";
    },
    LINKED_TO_EMPLOYEE: async (subject, object) => {
      const { rows } = await client.query(
        `SELECT l.employee_id FROM eos_policy.employee_principal_links l JOIN eos_policy.principals p ON p.id = l.principal_id
          WHERE l.tenant_id = $1 AND l.status = 'active' AND p.identity_provider = $2 AND p.external_subject = $3`,
        [tenantId, SYNTHETIC_IDENTITY_PROVIDER, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].employee_id === employeeId(object.split(":")[1]) ? "VERIFIED" : "MISMATCH";
    },
    HOLDS_SECURITY_ROLE: async (subject, object) => {
      const { rows } = await client.query(
        `SELECT 1 FROM eos_policy.user_role_assignments a
           JOIN eos_policy.principals p ON p.id = a.principal_id
           JOIN eos_policy.roles r ON r.id = a.role_id
          WHERE a.tenant_id = $1 AND a.status = 'active' AND p.identity_provider = $2 AND p.external_subject = $3 AND r.key = $4`,
        [tenantId, SYNTHETIC_IDENTITY_PROVIDER, subject.split(":")[1], object.split(":")[1]]);
      return rows.length > 0 ? "VERIFIED" : "DANGLING";
    },
    IN_WAREHOUSE: async (subject, object) => {
      const { rows } = await client.query(`SELECT 1 FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [tenantId, object.split(":")[1]]);
      void subject;
      return rows.length > 0 ? "VERIFIED" : "DANGLING";
    },
    HOMED_AT: async (subject, object) => {
      const { rows } = await client.query(`SELECT home_warehouse_id FROM eos_ops.trucks WHERE tenant_id = $1 AND truck_id = $2`, [tenantId, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].home_warehouse_id === object.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    STOCKS_AT: async (subject, object) => {
      const { rows } = await client.query(`SELECT mobile_location_id FROM eos_ops.trucks WHERE tenant_id = $1 AND truck_id = $2`, [tenantId, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].mobile_location_id === object.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    SUPPLIES_PART: async (subject, object) => {
      const [supplierId, partId] = subject.split(":")[1].split("/");
      const { rows } = await client.query(
        `SELECT 1 FROM eos_ops.supplier_catalog_items i JOIN eos_ops.parts p ON p.tenant_id = i.tenant_id AND p.id = i.part_id
          WHERE i.tenant_id = $1 AND i.supplier_id = $2 AND i.part_id = $3`, [tenantId, supplierId, partId]);
      return rows.length > 0 && partId === object.split(":")[1] ? "VERIFIED" : "DANGLING";
    },
    FOR_PART: async (subject, object) => {
      const { rows } = await client.query(`SELECT part_id FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = $2`, [tenantId, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].part_id === object.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    AT_WAREHOUSE: async (subject, object) => {
      const { rows } = await client.query(`SELECT warehouse_id FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = $2`, [tenantId, subject.split(":")[1]]);
      if (rows.length === 0) return "DANGLING";
      return rows[0].warehouse_id === object.split(":")[1] ? "VERIFIED" : "MISMATCH";
    },
    FULFILS: async (subject, object) => {
      const request = await client.query(`SELECT id FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = $2`, [tenantId, object.split(":")[1]]);
      if (request.rows.length === 0) return "DANGLING";
      const po = await client.query(`SELECT 1 FROM eos_ops.purchase_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, request.rows[0].id]);
      void subject;
      return po.rows.length > 0 ? "VERIFIED" : "DANGLING";
    },
    RECEIVES: async (subject, object) => {
      const request = await client.query(`SELECT id FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = $2`, [tenantId, object.split(":")[1]]);
      if (request.rows.length === 0) return "DANGLING";
      const receipt = await client.query(
        `SELECT source_purchase_order_id FROM eos_ops.receiving_orders WHERE tenant_id = $1 AND receiving_order_number = $2`,
        [tenantId, subject.split(":")[1]]);
      if (receipt.rows.length === 0) return "DANGLING";
      return receipt.rows[0].source_purchase_order_id === request.rows[0].id ? "VERIFIED" : "MISMATCH";
    },
    COUNTS_PART: async (subject, object) => {
      const partId = object.split(":")[1];
      const { rows } = await client.query(
        `SELECT 1 FROM eos_ops.cycle_count_lines l JOIN eos_ops.cycle_count_sheets s ON s.id = l.sheet_id
          WHERE l.tenant_id = $1 AND s.operating_company_key = $2 AND l.part_id = $3`,
        [tenantId, manifest.company.operatingCompanyKey, partId]);
      void subject;
      return rows.length > 0 ? "VERIFIED" : "DANGLING";
    },
    ADJUSTS_ON_HAND_AT: async (subject, object) => {
      const { rows } = await client.query(
        `SELECT 1 FROM eos_ops.inventory_movements
          WHERE tenant_id = $1 AND operating_company_key = $2 AND source_kind = 'CYCLE_COUNT_LINE'
            AND location_type = 'WAREHOUSE' AND location_id = $3`,
        [tenantId, manifest.company.operatingCompanyKey, object.split(":")[1]]);
      void subject;
      return rows.length > 0 ? "VERIFIED" : "DANGLING";
    },
  };

  const relationshipResults = [];
  for (const a of manifest.relationshipAssertions) {
    const resolver = relationshipResolvers[a.predicate];
    const status = resolver ? await resolver(a.subject, a.object) : "UNRESOLVABLE";
    relationshipResults.push({ ...a, status });
    if (status !== "VERIFIED") fail("relationships", `${a.subject} ${a.predicate} ${a.object}`, `assertion status ${status}`);
  }

  // ════════════════ scenarios ════════════════
  const scenarios = manifest.scenarios.map((s) => ({
    id: s.id, name: s.name, declaredStatus: s.status,
    blockedBy: s.blockedBy ?? [],
    personas: s.personas,
    verified: s.status === "BLOCKED"
      ? "BLOCKED"
      : drift.some((d) => (s.objects ?? []).some((o) => String(d.id).includes(o))) ? "FAILED" : s.status === "PARTIAL" ? "PARTIAL" : "VERIFIED",
  }));

  const verifiedRelationships = relationshipResults.filter((r) => r.status === "VERIFIED").length;
  return {
    sampleCompanyVersion: manifest.sampleCompanyVersion,
    environment: options.environmentId,
    tenant: { key: options.tenantKey, id: tenantId, resolved: true },
    mode: "verify",
    operatingCompanyKey: manifest.company.operatingCompanyKey,
    domains,
    personas,
    scenarios,
    relationships: {
      expected: manifest.relationshipAssertions.length,
      verified: verifiedRelationships,
      blocked: manifest.blockedRelationships.length,
      assertions: relationshipResults,
    },
    access: {
      capabilityKeysDerivedFromRoleCatalog: capabilityKeys.size,
      rolesUsed: usedRoleKeys,
      grants: grantRows,
      missingGrants: missingGrants.length,
      requiredCapabilityCoverage: {
        expected: personas.reduce((n, p) => n + p.requiredCapabilities.length, 0),
        held: personas.reduce((n, p) => n + p.requiredCapabilities.filter((c) => c.held).length, 0),
      },
      forbiddenCapabilityCoverage: {
        checked: personas.reduce((n, p) => n + p.forbiddenCapabilities.length, 0),
        violations: personas.reduce((n, p) => n + p.heldForbiddenCapabilities.length, 0),
      },
      accessModelGaps: personas.filter((p) => p.accessModelGap).map((p) => ({ persona: p.employeeKey, gap: p.accessModelGap })),
    },
    drift,
    blockers,
    pass: drift.length === 0,
  };
}

/** Entry point shared with `seedSampleCompany.js --mode verify`. The caller has already passed the fence. */
async function verifySampleCompanyMain(options) {
  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const client = new pg.Client(resolvePolicyDatabaseConfig({ connectionString: options.connectionString }));
  await client.connect();
  let report;
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    report = await verifySampleCompany(client, options);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The SAME fence the orchestrator uses, run here too: a verifier that could read production would be
  // an unauthorized read of customer data, and read-only is not a licence.
  const options = assertSampleCompanyInvocation({ ...args, mode: "verify" }, process.env);
  await verifySampleCompanyMain(options);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}

module.exports = { verifySampleCompany, verifySampleCompanyMain };
