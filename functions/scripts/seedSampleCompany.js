// SAMPLE COMPANY V2 -- the ONE orchestrator for the connected synthetic nonprod operating company.
//
// ============================ WHAT THIS IS ============================
//
// scripts/fixtures/sampleCompany.v2.json declares a fictional Taylor operating company: 17 Employees with
// complete synthetic profiles, 15 non-authenticating fixture Principals, the org chart, an expected access
// contract, CRM, Commercial, equipment models, part identities, suppliers, warehouses, bins, trucks,
// purchasing and cycle counts -- and, just as importantly, the sixteen relationships that have NO governed
// PostgreSQL authority today and are therefore declared BLOCKED rather than faked.
//
// This script APPLIES that manifest through the governed writers that already exist. It is a superset of
// scripts/seedSyntheticNonprodWorkforce.js, which it deliberately does not replace: every v1 id and record
// number is carried forward byte-identical, so running v2 over a v1 world extends it rather than doubling it.
//
// ============================ DEFAULT = PLAN. APPLY IS FIVE FACTS. ============================
//
//   --mode plan     (DEFAULT) reads, compares against the manifest, writes NOTHING, and reports what an
//                   apply run would CREATE, what is ALREADY_PRESENT, and what is FIXTURE_DRIFT.
//   --mode apply    writes. Requires ALL of: --apply, EOS_ENVIRONMENT exactly `nonprod`,
//                   --environment platform-sandbox, --tenantKey taylor-nonprod, --performedBy <operator>.
//   --mode verify   delegates to scripts/verifySampleCompany.js and emits its report.
//
// PRODUCTION AND CERTIFICATION FAIL BEFORE ANY CONNECTION. The fence runs before `pg` or `lib/` is resolved:
// production is refused twice over (registry role AND the literal project id, via assertMeasurementTarget),
// the Certification world is refused by environment id -- note it carries role "sandbox" in
// config/environments.json, so refusing by role alone would NOT catch it -- and platform-sandbox is required
// positively rather than merely "not production". functions/test/operatorScriptEnvironmentFence.test.mjs
// proves each refusal happened with no client library ever loaded.
//
// ============================ HOW EACH FACT IS WRITTEN ============================
//
//   Capability grants     reconcileInventoryCapabilityGrants (eosOps/migration/inventoryCapabilityGrantMigration.ts)
//                         over the capability keys DERIVED from the Role catalog for exactly the Roles this
//                         sample company uses. Dry run first, tenant-scoped, insert-missing-only, idempotent.
//                         UNRESOLVED_ROLE and UNKNOWN_CAPABILITY fail the run closed. No ad-hoc SQL grant.
//   Principal+membership  ensureTenantPrincipal (governed, audited, idempotent), identity provider
//                         `eos-synthetic-nonprod`, which NO verifier recognizes.
//   Security Role         assignRole (governed, audited, idempotent). Explicit per manifest entry, NEVER
//                         inferred from a Job Role.
//   Employee<->Principal  establishLink, OPERATOR_ASSERTED, with author and reason.
//   Reporting line        establishReportingRelationship (eosWorkforce/commands/reportingRelationshipCommands.ts).
//                         NEVER inferred from a Security Role.
//   CRM                   customerRepository create* (governed; Contact/Location inherit the Account owner).
//   Commercial            createCommercialRecord + establishCreationAccountablePerson + the mint, one
//                         transaction per record, exactly as the v1 seed does.
//   Equipment model       recordEquipmentModel (eosOps/equipmentCustody.ts).
//   Supplier / catalog    createSupplier / createSupplierCatalogItem / setPreferredSupplier.
//   Warehouse / bin       createWarehouse / createBin.
//   Truck / mobile loc    createMobileLocation / createTruck.
//   Purchasing            createReorderRequest -> recordPurchaseOrder -> createReceivingOrder / voidPurchaseOrder.
//   Cycle count           createSheet -> openLine -> submitCount -> reconcileLine (the ONLY governed
//                         PostgreSQL writer of eos_ops.inventory_movements).
//   Employee              DIRECT INSERT. No governed Employee writer exists; documented in the manifest's
//                         directInserts, drift-protected, additive on profile columns, never an overwrite.
//   Part identity         DIRECT INSERT into eos_ops.parts (identity only: id, tenant_id, created_by).
//                         Documented in the manifest's directInserts.
//
// Job Role is written NOWHERE. It is manifest metadata until EMP-RT-08.
//
// ============================ FAIL CLOSED ON DRIFT ============================
//
// For every record: matching existing row -> ALREADY_PRESENT; absent -> CREATE; present but DIFFERENT from
// the manifest -> FIXTURE_DRIFT and the run refuses. Nothing is ever silently overwritten.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/seedSampleCompany.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --existingAdminPrincipalId <principal id> --performedBy <operator>
//   ... add `--mode apply --apply` to write.
//
// Exit 0 planned/seeded; 1 drift or unresolved grants; 2 refused or failed. Output: deterministic JSON, no
// secrets, no passwords, no raw Firebase subjects.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const MANIFEST = require("./fixtures/sampleCompany.v2.json");

/** Mirrored from functions/src/employeeIdentity/employeeAuthority.ts; a test asserts equality. */
const EMPLOYMENT_STATUS_VALUES = Object.freeze(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);
const SYNTHETIC_IDENTITY_PROVIDER = "eos-synthetic-nonprod";
const DERIVE_FROM_OWNER = "DERIVE_FROM_OWNER";
const USER_ACCESS_STATES = Object.freeze(["ENABLED", "DISABLED", "NONE"]);
const JOB_ROLE_VOCABULARY = Object.freeze([
  "OWNER_EXECUTIVE", "GENERAL_MANAGER", "OFFICE_MANAGER", "SERVICE_MANAGER", "DISPATCHER", "SERVICE_TECHNICIAN",
  "RETAIL_SALES", "NATIONAL_ACCOUNTS_SALES", "PARTS_MANAGER", "PARTS_ASSOCIATE", "WAREHOUSE_MANAGER", "WAREHOUSE_ASSOCIATE",
]);

/** The environment this sample company lives in, and the one that is refused by NAME however it is labelled. */
const REQUIRED_ENVIRONMENT = "platform-sandbox";
const FROZEN_ENVIRONMENTS = Object.freeze(["platform-certification"]);
const REQUIRED_TENANT_KEY = "taylor-nonprod";

const LINK_REASON = "SAMPLE COMPANY V2: fixture link between a fixture Employee and a fixture Principal; not a real person and not a credential claim";
const ROLE_REASON = "SAMPLE COMPANY V2: explicit fixture Security Role assignment; not inferred from Job Role";
const REPORTING_REASON = "SAMPLE COMPANY V2 org chart";

const COMMERCIAL = Object.freeze({
  OPPORTUNITY: Object.freeze({ family: "opportunity", table: "opportunities", number: "opportunity_number" }),
  SALES_AGREEMENT: Object.freeze({ family: "salesAgreement", table: "sales_agreements", number: "sales_agreement_number" }),
  SALES_ORDER: Object.freeze({ family: "salesOrder", table: "sales_orders", number: "sales_order_number" }),
});

/** The Employee profile columns this seed fills, manifest key -> column. Job Role is deliberately ABSENT. */
const PROFILE_COLUMNS = Object.freeze([
  ["employeeNumber", "employee_number"], ["displayName", "display_name"], ["firstName", "first_name"],
  ["middleName", "middle_name"], ["lastName", "last_name"], ["preferredName", "preferred_name"],
  ["jobTitle", "job_title"], ["workEmail", "work_email"], ["workPhone", "work_phone"], ["mobilePhone", "mobile_phone"],
  ["addressStreet", "address_street"], ["addressUnit", "address_unit"], ["addressCity", "address_city"],
  ["addressState", "address_state"], ["addressPostalCode", "address_postal_code"],
  ["hireDate", "hire_date"], ["separationDate", "separation_date"],
]);

class SampleCompanyError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SampleCompanyError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new SampleCompanyError(code, message);
};

// ════════════════════════════ manifest invariants (pure, no I/O) ════════════════════════════

/**
 * Every invariant that can be checked without a database, checked BEFORE one is opened.
 *
 * Returns the lookup maps the seed and the verifier both need, so neither re-derives them.
 */
function validateManifest(m) {
  if (m.manifest !== "SAMPLE_COMPANY_V2" || m.sampleCompanyVersion !== 2) {
    refuse("MANIFEST_INVALID", "not the Sample Company v2 manifest");
  }
  if (m.company.syntheticIdentityProvider !== SYNTHETIC_IDENTITY_PROVIDER) {
    refuse("MANIFEST_INVALID", "the synthetic identity provider must be eos-synthetic-nonprod");
  }
  if (m.company.tenantKey !== REQUIRED_TENANT_KEY || m.company.environment !== REQUIRED_ENVIRONMENT) {
    refuse("MANIFEST_INVALID", `the sample company is declared for ${REQUIRED_TENANT_KEY} @ ${REQUIRED_ENVIRONMENT} and nowhere else`);
  }
  const policy = m.eligibilityPolicy;
  if (policy.policyId !== "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1"
    || JSON.stringify(policy.eligibleStatuses) !== JSON.stringify(["ACTIVE", "CONTRACTOR"])) {
    refuse("MANIFEST_INVALID", "the eligibility policy must be exactly COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = ACTIVE, CONTRACTOR");
  }

  // ---- Job Roles. A generic SALES Job Role is forbidden, and the two sales Job Roles are separate.
  const jobRoles = new Set();
  for (const r of m.jobRoles) {
    if (/^sales$/i.test(r.key) || /^sales$/i.test(String(r.label).trim())) {
      refuse("MANIFEST_INVALID", "a generic Job Role named SALES is forbidden; Retail Sales and National Accounts Sales are separate");
    }
    if (!JOB_ROLE_VOCABULARY.includes(r.key)) refuse("MANIFEST_INVALID", `Job Role ${r.key} is outside the governed vocabulary`);
    if (jobRoles.has(r.key)) refuse("MANIFEST_INVALID", `duplicate Job Role ${r.key}`);
    jobRoles.add(r.key);
  }
  for (const required of JOB_ROLE_VOCABULARY) {
    if (!jobRoles.has(required)) refuse("MANIFEST_INVALID", `Job Role ${required} must be declared`);
  }

  // ---- Employees.
  const employees = new Map();
  const ids = new Set();
  const employeeNumbers = new Set();
  for (const e of m.employees) {
    if (!EMPLOYMENT_STATUS_VALUES.includes(e.employmentStatus)) {
      refuse("MANIFEST_INVALID", `${e.key}: ${e.employmentStatus} is not a governed lifecycle status`);
    }
    if (!jobRoles.has(e.jobRole)) refuse("MANIFEST_INVALID", `${e.key}: undeclared Job Role ${e.jobRole}`);
    if (!/^synthetic-np-emp-[a-z0-9-]+$/.test(e.id)) refuse("MANIFEST_INVALID", `${e.key}: fixture Employee ids must be synthetic-np-emp-*`);
    // A Firebase uid is 28 URL-safe characters with no hyphen-delimited words. The id shape above already
    // excludes one; this states the rule the shape exists to enforce, so a future loosening cannot lose it.
    if (/^[A-Za-z0-9]{20,}$/.test(e.id)) refuse("MANIFEST_INVALID", `${e.key}: an Employee id must never look like a credential subject`);
    if (!/^Synthetic /.test(e.fixtureLabel)) refuse("MANIFEST_INVALID", `${e.key}: fixture labels must say Synthetic`);
    if (employees.has(e.key) || ids.has(e.id)) refuse("MANIFEST_INVALID", `duplicate Employee ${e.key}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(e.employeeNumber)) refuse("MANIFEST_INVALID", `${e.key}: employee number fails the governed shape`);
    if (employeeNumbers.has(e.employeeNumber.toUpperCase())) refuse("MANIFEST_INVALID", `duplicate employee number ${e.employeeNumber}`);
    employeeNumbers.add(e.employeeNumber.toUpperCase());
    if (!String(e.workEmail).endsWith(`@${m.company.workEmailDomain}`)) {
      refuse("MANIFEST_INVALID", `${e.key}: every work email must be @${m.company.workEmailDomain}`);
    }
    if (!USER_ACCESS_STATES.includes(e.userAccess?.state)) {
      refuse("MANIFEST_INVALID", `${e.key}: userAccess.state must be one of ${USER_ACCESS_STATES.join(", ")}`);
    }
    for (const phone of [e.workPhone, e.mobilePhone]) {
      if (phone !== null && phone !== undefined && !/^\+1-555-01\d{2}$/.test(phone)) {
        refuse("MANIFEST_INVALID", `${e.key}: telephone numbers must be in the fiction-reserved 555-01XX range`);
      }
    }
    employees.set(e.key, e);
    ids.add(e.id);
  }
  if (!m.employees.some((e) => e.userAccess.state === "NONE")) {
    refuse("MANIFEST_INVALID", "at least one Employee must declare userAccess NONE -- the Employee != User Access proof");
  }

  const eligible = (key, what) => {
    const e = employees.get(key);
    if (!e) refuse("MANIFEST_INVALID", `${what} names unknown Employee ${key}`);
    if (!policy.eligibleStatuses.includes(e.employmentStatus)) {
      refuse("MANIFEST_INVALID", `${what} names ${key}, who is not eligible under ${policy.policyId}`);
    }
    return e;
  };

  // ---- Principals: exactly one reused real administrator, everything else a non-authenticating fixture.
  const principalsByEmployee = new Map();
  let administrators = 0;
  const subjects = new Set();
  for (const p of m.principals) {
    const employee = eligible(p.employee, "a Principal link");
    if (employee.userAccess.state !== "ENABLED") {
      refuse("MANIFEST_INVALID", `${p.employee} declares userAccess ${employee.userAccess.state} but is given a Principal`);
    }
    if (principalsByEmployee.has(p.employee)) refuse("MANIFEST_INVALID", `${p.employee} is linked twice`);
    principalsByEmployee.set(p.employee, p);
    if ("jobRole" in p) refuse("MANIFEST_INVALID", "a Principal carries no Job Role; Security Roles are declared explicitly");
    if (!Array.isArray(p.securityRoles) || p.securityRoles.length === 0) {
      refuse("MANIFEST_INVALID", `${p.employee}: explicit Security Roles are required`);
    }
    if (p.existingAdministrator) {
      administrators += 1;
    } else {
      if (!/^synthetic-np-principal-[a-z0-9-]+$/.test(p.externalSubject || "")) {
        refuse("MANIFEST_INVALID", `${p.employee}: synthetic subjects must be synthetic-np-principal-*`);
      }
      if (subjects.has(p.externalSubject)) refuse("MANIFEST_INVALID", `duplicate external subject ${p.externalSubject}`);
      subjects.add(p.externalSubject);
    }
  }
  if (administrators !== 1) refuse("MANIFEST_INVALID", "exactly one existing administrator Principal is reused");
  for (const e of m.employees) {
    const hasPrincipal = principalsByEmployee.has(e.key);
    if (e.userAccess.state === "ENABLED" && !hasPrincipal) refuse("MANIFEST_INVALID", `${e.key} declares userAccess ENABLED but has no Principal`);
    if (e.userAccess.state === "NONE" && hasPrincipal) refuse("MANIFEST_INVALID", `${e.key} declares userAccess NONE but has a Principal`);
  }

  // ---- Reporting. Declared explicitly, acyclic, and never derived from a Role.
  const managerOf = new Map();
  for (const edge of m.reportingRelationships.edges) {
    if (!employees.has(edge.employee) || !employees.has(edge.manager)) {
      refuse("MANIFEST_INVALID", `reporting edge ${edge.employee} -> ${edge.manager} names an unknown Employee`);
    }
    if (edge.employee === edge.manager) refuse("MANIFEST_INVALID", `${edge.employee} cannot be their own manager`);
    if (managerOf.has(edge.employee)) refuse("MANIFEST_INVALID", `${edge.employee} has two current managers`);
    managerOf.set(edge.employee, edge.manager);
  }
  for (const start of managerOf.keys()) {
    const seen = new Set([start]);
    let at = managerOf.get(start);
    while (at) {
      if (seen.has(at)) refuse("MANIFEST_INVALID", `the reporting graph has a cycle through ${at}`);
      seen.add(at);
      at = managerOf.get(at);
    }
  }
  for (const e of m.employees) {
    const declared = e.manager ?? null;
    const edge = managerOf.get(e.key) ?? null;
    if (declared !== edge) refuse("MANIFEST_INVALID", `${e.key}: the profile manager and the reporting edge disagree`);
  }

  // ---- Expected access. Every login-capable persona declares the four-part contract.
  const accessPersonas = m.expectedAccess.personas;
  for (const [key, p] of principalsByEmployee) {
    const contract = accessPersonas[key];
    if (!contract) refuse("MANIFEST_INVALID", `${key} has a Principal but no expected access contract`);
    if (JSON.stringify(contract.securityRoles) !== JSON.stringify(p.securityRoles)) {
      refuse("MANIFEST_INVALID", `${key}: the access contract and the Principal declare different Security Roles`);
    }
    for (const field of ["requiredCapabilities", "forbiddenCapabilities", "expectedSurfaces", "deniedSurfaces"]) {
      if (!Array.isArray(contract[field])) refuse("MANIFEST_INVALID", `${key}: ${field} must be declared, even if empty`);
    }
    const overlap = contract.requiredCapabilities.filter((c) => contract.forbiddenCapabilities.includes(c));
    if (overlap.length > 0) refuse("MANIFEST_INVALID", `${key}: ${overlap.join(", ")} is both required and forbidden`);
  }
  for (const key of Object.keys(accessPersonas)) {
    if (!principalsByEmployee.has(key)) refuse("MANIFEST_INVALID", `the access contract names ${key}, who has no Principal`);
  }
  for (const [key, declared] of Object.entries(m.expectedAccess.noAccessPersonas)) {
    const e = employees.get(key);
    if (!e) refuse("MANIFEST_INVALID", `noAccessPersonas names unknown Employee ${key}`);
    if (e.userAccess.state !== declared.userAccessState) refuse("MANIFEST_INVALID", `${key}: userAccess state disagrees with noAccessPersonas`);
  }

  // ---- CRM.
  const accounts = new Map(m.accounts.map((a) => [a.id, a]));
  if (accounts.size !== m.accounts.length) refuse("MANIFEST_INVALID", "duplicate Account id");
  for (const a of m.accounts) eligible(a.owner, `Account ${a.id}`);
  const crmIds = new Set();
  for (const c of [...m.contacts, ...m.locations]) {
    if (!accounts.has(c.account)) refuse("MANIFEST_INVALID", `${c.id} names unknown Account ${c.account}`);
    if (crmIds.has(c.id)) refuse("MANIFEST_INVALID", `duplicate CRM id ${c.id}`);
    crmIds.add(c.id);
  }
  for (const a of m.accounts) {
    if (!m.contacts.some((c) => c.account === a.id && c.isPrimary)) {
      refuse("MANIFEST_INVALID", `Account ${a.id} has no primary Contact`);
    }
    if (!m.locations.some((l) => l.account === a.id)) refuse("MANIFEST_INVALID", `Account ${a.id} has no Location`);
  }

  // ---- Commercial. Owner, accountable person and assignment stay three separate facts.
  const numbers = new Map();
  let sameResponsibility = 0;
  let splitResponsibility = 0;
  for (const r of m.commercial) {
    if (!COMMERCIAL[r.kind]) refuse("MANIFEST_INVALID", `${r.number}: unknown kind ${r.kind}`);
    if (!accounts.has(r.account)) refuse("MANIFEST_INVALID", `${r.number}: unknown Account`);
    if (numbers.has(r.number)) refuse("MANIFEST_INVALID", `duplicate record number ${r.number}`);
    if ("assignedTo" in r || "assigneeEmployeeId" in r) {
      refuse("MANIFEST_INVALID", `${r.number}: assignment has no governed authority and must never appear on a commercial record`);
    }
    eligible(r.owner, `${r.number} owner`);
    if (r.accountable === DERIVE_FROM_OWNER || r.accountable === r.owner) sameResponsibility += 1;
    else {
      eligible(r.accountable, `${r.number} accountable person`);
      splitResponsibility += 1;
    }
    for (const upstream of [r.opportunity, r.agreement]) {
      if (upstream !== undefined && !numbers.has(upstream)) refuse("MANIFEST_INVALID", `${r.number}: upstream ${upstream} must be declared first`);
    }
    numbers.set(r.number, r);
  }
  if (sameResponsibility === 0 || splitResponsibility === 0) {
    refuse("MANIFEST_INVALID", "the commercial seed must prove BOTH owner == accountable and owner != accountable");
  }

  // ---- Operational closure: nothing references an operational identity the manifest does not declare.
  const parts = new Set(m.parts.records.map((p) => p.partId));
  for (const p of m.parts.records) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(p.partId)) refuse("MANIFEST_INVALID", `${p.partId} is not a canonical part id`);
  }
  const models = new Set(m.equipmentModels.map((e) => e.id));
  for (const e of m.equipmentModels) {
    if (e.id !== `${e.manufacturerId}--${e.modelNumber}`) refuse("MANIFEST_INVALID", `${e.id} is not {manufacturerId}--{modelNumber}`);
    if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(e.manufacturerId)) refuse("MANIFEST_INVALID", `${e.manufacturerId} is not a canonical manufacturer id`);
  }
  const warehouses = new Set(m.warehouses.map((w) => w.warehouseId));
  const suppliers = new Set(m.suppliers.map((s) => s.supplierId));
  for (const b of m.bins) if (!warehouses.has(b.warehouseId)) refuse("MANIFEST_INVALID", `bin ${b.idempotencyKey} names unknown warehouse ${b.warehouseId}`);
  const mobile = new Set(m.trucks.mobileLocations.map((l) => l.locationId));
  for (const t of m.trucks.records) {
    if (!warehouses.has(t.homeWarehouseId)) refuse("MANIFEST_INVALID", `truck ${t.truckId} names unknown home warehouse`);
    if (t.mobileLocationId && !mobile.has(t.mobileLocationId)) refuse("MANIFEST_INVALID", `truck ${t.truckId} names unknown mobile location`);
    if ("operatorEmployeeId" in t || "technicianId" in t) {
      refuse("MANIFEST_INVALID", `truck ${t.truckId}: the Employee<->Technician relationship is BLOCKED and must never be written as a field`);
    }
  }
  for (const i of m.supplierCatalogItems) {
    if (!parts.has(i.partId)) refuse("MANIFEST_INVALID", `supplier catalog item names unknown part ${i.partId}`);
    if (!suppliers.has(i.supplierId)) refuse("MANIFEST_INVALID", `supplier catalog item names unknown supplier ${i.supplierId}`);
  }
  for (const p of m.purchasing) {
    if (!parts.has(p.partId)) refuse("MANIFEST_INVALID", `purchasing ${p.key} names unknown part ${p.partId}`);
    if (!warehouses.has(p.warehouseId)) refuse("MANIFEST_INVALID", `purchasing ${p.key} names unknown warehouse ${p.warehouseId}`);
    eligible(p.raisedBy, `purchasing ${p.key}`);
    eligible(p.purchaseOrder.recordedBy, `purchasing ${p.key} purchase order`);
  }
  for (const c of m.cycleCounts) {
    if (c.location.type === "WAREHOUSE" && !warehouses.has(c.location.id)) {
      refuse("MANIFEST_INVALID", `cycle count ${c.key} names unknown warehouse ${c.location.id}`);
    }
    for (const line of c.lines) {
      if (!parts.has(line.partId)) refuse("MANIFEST_INVALID", `cycle count ${c.key} names unknown part ${line.partId}`);
      if (line.decision === "APPROVE" && (line.expectVariance ?? 0) !== 0 && line.submittedBy === c.reconciledBy) {
        refuse("MANIFEST_INVALID", `cycle count ${c.key}: a non-zero variance may not be reconciled by its own submitter`);
      }
    }
  }
  for (const e of m.equipment.desired) {
    if (!accounts.has(e.account)) refuse("MANIFEST_INVALID", `equipment ${e.id} names unknown Account`);
    if (!crmIds.has(e.customerLocation)) refuse("MANIFEST_INVALID", `equipment ${e.id} names unknown customer site`);
    if (!models.has(e.equipmentModel)) refuse("MANIFEST_INVALID", `equipment ${e.id} names unknown equipment model`);
  }
  for (const w of m.service.desired) {
    if (!accounts.has(w.account)) refuse("MANIFEST_INVALID", `work order ${w.key} names unknown Account`);
    if (!crmIds.has(w.location)) refuse("MANIFEST_INVALID", `work order ${w.key} names unknown location`);
    for (const used of w.partsUsed) if (!parts.has(used.partId)) refuse("MANIFEST_INVALID", `work order ${w.key} names unknown part ${used.partId}`);
  }

  // ---- Blocked relationships must be honest: every BLOCKED section names a declared code.
  const blockedCodes = new Set(m.blockedRelationships.map((b) => b.code));
  if (blockedCodes.size !== m.blockedRelationships.length) refuse("MANIFEST_INVALID", "duplicate blockedRelationships code");
  // Every `status: "BLOCKED"` anywhere in the manifest -- top level or nested -- must name a code that
  // blockedRelationships actually declares. A section that says BLOCKED without saying by WHAT is exactly
  // the vague refusal this manifest exists to prevent.
  const assertBlockedCodesDeclared = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node) && node.status === "BLOCKED") {
      const codes = Array.isArray(node.blockedBy) ? node.blockedBy : [node.blockedBy];
      for (const code of codes) {
        if (!blockedCodes.has(code)) refuse("MANIFEST_INVALID", `${path} is BLOCKED by ${code}, which is not declared in blockedRelationships`);
      }
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") assertBlockedCodesDeclared(v, `${path}.${k}`);
  };
  assertBlockedCodesDeclared(m, "manifest");
  for (const s of m.scenarios) {
    for (const code of s.blockedBy ?? []) if (!blockedCodes.has(code)) refuse("MANIFEST_INVALID", `scenario ${s.id} names undeclared blocker ${code}`);
  }

  return {
    employees, principalsByEmployee, accounts, managerOf, policy,
    numbers, parts, models, warehouses, suppliers, blockedCodes,
  };
}

/** Every capability key the Roles this sample company uses declare. Derived from the Role catalog, never typed. */
function sampleCompanyCapabilityKeys(manifest = MANIFEST) {
  const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
  const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
  const catalog = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  const keys = new Set();
  const unknownRoles = [];
  for (const p of manifest.principals) {
    for (const roleKey of p.securityRoles) {
      const role = catalog[roleKey];
      if (!role) {
        unknownRoles.push(roleKey);
        continue;
      }
      for (const permission of role.permissions ?? []) keys.add(permission);
    }
  }
  if (unknownRoles.length > 0) {
    refuse("ROLE_NOT_IN_CATALOG", `the manifest names Roles the governed catalog does not define: ${[...new Set(unknownRoles)].sort().join(", ")}. The seed never creates a Role.`);
  }
  return [...keys].sort();
}

// ════════════════════════════ the fence ════════════════════════════

function assertSampleCompanyInvocation(args, env) {
  const mode = args.mode === undefined ? "plan" : args.mode;
  if (!["plan", "apply", "verify"].includes(mode)) {
    refuse("ARGUMENT_INVALID", "--mode must be one of plan, apply, verify (plan is the default and writes nothing)");
  }
  const { environmentId, connectionString } = assertMeasurementTarget(args, env);
  assertNonprodRuntime(env);
  if (FROZEN_ENVIRONMENTS.includes(environmentId)) {
    refuse("ENVIRONMENT_REFUSED", `--environment '${environmentId}' is the Certification world, which is frozen. It carries role "sandbox" in the registry, so it is refused by NAME here rather than by role.`);
  }
  if (environmentId !== REQUIRED_ENVIRONMENT) {
    refuse("ENVIRONMENT_REFUSED", `the sample company exists only in '${REQUIRED_ENVIRONMENT}'; refusing '${environmentId}'. Not-production is not the same as the one environment this seed is for.`);
  }
  if (args.tenantKey !== REQUIRED_TENANT_KEY) {
    refuse("ARGUMENT_REQUIRED", `--tenantKey ${REQUIRED_TENANT_KEY} is required and has no default`);
  }
  if (typeof args.performedBy !== "string" || !/^[A-Za-z0-9._@-]{1,100}$/.test(args.performedBy)) {
    refuse("ARGUMENT_REQUIRED", "--performedBy <operator> is required ([A-Za-z0-9._@-], at most 100)");
  }
  if (typeof args.existingAdminPrincipalId !== "string" || args.existingAdminPrincipalId.trim() === "" || args.existingAdminPrincipalId === "true") {
    refuse("ARGUMENT_REQUIRED", "--existingAdminPrincipalId is required: the administering Principal is named, never inferred, and its authority is read from its own Role assignments");
  }
  const apply = mode === "apply";
  if (apply && args.apply !== "true") {
    refuse("ARGUMENT_REQUIRED", "--mode apply additionally requires the explicit --apply flag; a mode alone never writes");
  }
  if (!apply && args.apply === "true") {
    refuse("ARGUMENT_INVALID", "--apply was given without --mode apply; refusing rather than guessing which one was meant");
  }
  return {
    mode, apply, environmentId, connectionString,
    tenantKey: args.tenantKey, performedBy: args.performedBy,
    existingAdminPrincipalId: args.existingAdminPrincipalId,
  };
}

// ════════════════════════════ the seed ════════════════════════════

/** CREATE / ALREADY_PRESENT / FIXTURE_DRIFT, per domain. Drift is collected AND refused, never absorbed. */
function newLedger() {
  const domains = {};
  const drift = [];
  return {
    domains,
    drift,
    record(domain, outcome, id, detail) {
      const d = (domains[domain] ??= { CREATE: 0, ALREADY_PRESENT: 0, FIXTURE_DRIFT: 0, BLOCKED: 0, ids: [] });
      d[outcome] += 1;
      if (outcome === "CREATE") d.ids.push(id);
      if (outcome === "FIXTURE_DRIFT") drift.push({ domain, id, detail });
    },
  };
}

const sameDate = (stored, declared) => {
  if (stored === null || stored === undefined) return declared === null;
  const iso = stored instanceof Date ? stored.toISOString().slice(0, 10) : String(stored).slice(0, 10);
  return iso === declared;
};

/**
 * Seed (or plan) the whole sample company. `pool` is a pg Pool. Libraries load here, AFTER the caller's fence.
 *
 * The execution order below is the manifest's `executionOrder`, and it is derived from foreign keys and
 * writer preconditions, not from the order the sections happen to appear in the file.
 */
async function seedSampleCompany(pool, options, manifest = MANIFEST) {
  const lookups = validateManifest(manifest);
  const { employees, policy } = lookups;
  const apply = options.apply === true;

  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { assignRole } = require("../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../lib/adminPolicy/administrationAuthority.js");
  const { establishLink } = require("../lib/employeeIdentity/employeePrincipalLinkRepository.js");
  const { createPostgresEmployeeAuthority } = require("../lib/employeeIdentity/postgresEmployeeAuthority.js");
  const { decideAccountabilityEligibility } = require("../lib/employeeIdentity/employeeAuthority.js");
  const { establishReportingRelationship } = require("../lib/eosWorkforce/commands/reportingRelationshipCommands.js");
  const { reconcileInventoryCapabilityGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
  const { capabilitiesForRoleKeys } = require("../lib/eosOps/capabilityAuthority.js");
  const crm = require("../lib/crm/customerRepository.js");
  const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");
  const { establishCreationAccountablePerson } = require("../lib/responsibility/accountablePersonEstablishment.js");
  const { accountablePersonFields, ACCOUNTABLE_PERSON_FIELD } = require("../lib/responsibility/accountablePersonStorage.js");
  const equipmentCustody = require("../lib/eosOps/equipmentCustody.js");
  const supplierCatalog = require("../lib/eosOps/supplierCatalogRepository.js");
  const warehouseBins = require("../lib/eosOps/warehouseBinRepository.js");
  const truckFleet = require("../lib/eosOps/truckFleetRepository.js");
  const purchasing = require("../lib/eosOps/purchasingRepository.js");
  const cycleCounts = require("../lib/eosOps/cycleCountRepository.js");

  const ledger = newLedger();
  const repo = new PostgresPolicyRepository(pool);
  const actorUid = options.performedBy;
  const companyKey = manifest.company.operatingCompanyKey;
  const employeeId = (key) => employees.get(key).id;

  // ---- 1. tenant, resolved by key and NEVER created.
  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key ${options.tenantKey}; the seed never creates one`);
  const tenantId = tenant.id;

  // ---- 2. the administering Principal. This script asserts NO authority of its own.
  const admin = await repo.getPrincipal(options.existingAdminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID", "--existingAdminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const adminRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(adminRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_INVALID", "the named administrator Principal holds no Role that may assign Roles");
  }
  const actor = { tenantId, uid: actorUid, heldRoleKeys: adminRoleKeys };

  // Every Role the manifest names must already exist in this tenant. Refused up front rather than mid-write.
  for (const p of manifest.principals) {
    for (const key of p.securityRoles) {
      if (!roleByKey.has(key)) refuse("ROLE_NOT_DEFINED", `Security Role ${key} is not defined in this tenant; the seed never creates Roles`);
    }
  }

  // ---- 3. capability / Role grant reconciliation, through the EXISTING tooling. Dry run first, always.
  const capabilityKeys = sampleCompanyCapabilityKeys(manifest);
  const grantDryRun = await reconcileInventoryCapabilityGrants(pool, {
    tenantId, apply: false, actor: `sample-company-v2:${actorUid}`, capabilityKeys,
  });
  if (grantDryRun.unresolved.length > 0) {
    refuse("CAPABILITY_GRANT_UNRESOLVED", `${grantDryRun.unresolved.length} Role/capability pairs are UNRESOLVED_ROLE or UNKNOWN_CAPABILITY; the sample company fails closed rather than granting a substitute`);
  }
  const grantReport = apply
    ? await reconcileInventoryCapabilityGrants(pool, { tenantId, apply: true, actor: `sample-company-v2:${actorUid}`, capabilityKeys })
    : grantDryRun;

  // ---- 4 + 5. Employees, then their profile facts. DIRECT INSERT; documented in the manifest.
  for (const e of manifest.employees) {
    const { rows } = await pool.query(
      `SELECT tenant_id, employment_status::text AS status, operating_company_id,
              ${PROFILE_COLUMNS.map(([, col]) => col).join(", ")}
         FROM eos_workforce.employees WHERE id = $1`, [e.id]);
    if (rows.length === 0) {
      ledger.record("employees", "CREATE", e.id);
      if (!apply) continue;
      await pool.query(
        `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id,
           ${PROFILE_COLUMNS.map(([, col]) => col).join(", ")})
         VALUES ($1, $2, $3::eos_workforce.workforce_employment_status, $4,
           ${PROFILE_COLUMNS.map((_, i) => `$${i + 5}`).join(", ")})
         ON CONFLICT (id) DO NOTHING`,
        [e.id, tenantId, e.employmentStatus, manifest.company.operatingCompanyId,
          ...PROFILE_COLUMNS.map(([key]) => e[key] ?? null)]);
      continue;
    }
    const row = rows[0];
    if (row.tenant_id !== tenantId || row.status !== e.employmentStatus || row.operating_company_id !== manifest.company.operatingCompanyId) {
      ledger.record("employees", "FIXTURE_DRIFT", e.id, "tenant, employment status or operating company differs from the manifest");
      continue;
    }
    // Profile facts are ADDITIVE. A stored non-NULL value that differs is drift; a NULL is filled.
    const fill = [];
    let drifted = null;
    for (const [key, col] of PROFILE_COLUMNS) {
      const declared = e[key] ?? null;
      const stored = row[col] ?? null;
      const matches = col.endsWith("_date") ? sameDate(stored, declared) : stored === declared;
      if (stored === null) {
        if (declared !== null) fill.push([col, declared]);
      } else if (!matches) {
        drifted = `${col} is stored differently from the manifest`;
        break;
      }
    }
    if (drifted) {
      ledger.record("employees", "FIXTURE_DRIFT", e.id, drifted);
      continue;
    }
    if (fill.length > 0) {
      ledger.record("employeeProfiles", "CREATE", e.id);
      if (apply) {
        await pool.query(
          `UPDATE eos_workforce.employees SET ${fill.map(([col], i) => `${col} = $${i + 2}`).join(", ")} WHERE id = $1`,
          [e.id, ...fill.map(([, v]) => v)]);
      }
    } else {
      ledger.record("employeeProfiles", "ALREADY_PRESENT", e.id);
    }
    ledger.record("employees", "ALREADY_PRESENT", e.id);
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 6, 7, 8. Principals + memberships, Employee links, Security Role assignments.
  const principalIdByEmployee = new Map();
  for (const p of manifest.principals) {
    let principal;
    if (p.existingAdministrator) {
      // REUSED, never recreated and never re-credentialed. Its own Role set is left exactly as it is.
      principal = admin;
      ledger.record("principals", "ALREADY_PRESENT", "(the reused existing administrator)");
    } else {
      principal = await repo.getPrincipalBySubject(SYNTHETIC_IDENTITY_PROVIDER, p.externalSubject);
      ledger.record("principals", principal ? "ALREADY_PRESENT" : "CREATE", p.externalSubject);
      if (apply) {
        principal = await ensureTenantPrincipal(repo, {
          tenantId, externalSubject: p.externalSubject, identityProvider: SYNTHETIC_IDENTITY_PROVIDER,
          displayName: p.displayName, actorUid, actorRoleKeys: adminRoleKeys,
        });
      } else if (!principal) {
        // A plan run cannot read a link or an assignment for a Principal that does not exist yet. Both are
        // therefore recorded as CREATE, which is exactly what an apply run would do.
        ledger.record("employeePrincipalLinks", "CREATE", p.employee);
        for (const key of p.securityRoles) ledger.record("roleAssignments", "CREATE", `${p.employee}:${key}`);
        continue;
      }
    }
    principalIdByEmployee.set(p.employee, principal.id);

    const linked = await pool.query(
      `SELECT 1 FROM eos_policy.employee_principal_links
        WHERE tenant_id = $1 AND employee_id = $2 AND principal_id = $3 AND status = 'active'`,
      [tenantId, employeeId(p.employee), principal.id]);
    ledger.record("employeePrincipalLinks", linked.rows.length === 0 ? "CREATE" : "ALREADY_PRESENT", p.employee);
    if (apply) {
      await establishLink(pool, {
        tenantId, principalId: principal.id, employeeId: employeeId(p.employee),
        operatingCompanyId: manifest.company.operatingCompanyId, linkSource: "OPERATOR_ASSERTED",
        assertedBy: actorUid, assertionReason: LINK_REASON,
      });
    }

    const held = await repo.listAssignmentsForPrincipal(tenantId, principal.id);
    for (const key of p.securityRoles) {
      const role = roleByKey.get(key);
      const already = held.some((a) => a.status === "active" && a.roleId === role.id && (a.scopeType ?? "global") === "global");
      ledger.record("roleAssignments", already ? "ALREADY_PRESENT" : "CREATE", `${p.employee}:${key}`);
      if (apply && !already) await assignRole(repo, actor, { principalId: principal.id, roleId: role.id, reason: ROLE_REASON });
    }
  }

  // ---- 9. Reporting relationships, through the governed command. Never inferred from a Security Role.
  //
  // The command requires admin.employeeProfile.write, which is exactly what step 3 reconciled. Resolving the
  // administering Principal's EFFECTIVE capabilities here -- rather than assuming the grant landed -- is the
  // "deployed code is not a live grant" rule applied to this script's own actor.
  const adminCapabilities = await capabilitiesForRoleKeys(pool, tenantId, adminRoleKeys);
  const reportingActor = { tenantId, principalId: admin.id, capabilities: new Set(adminCapabilities) };
  for (const edge of manifest.reportingRelationships.edges) {
    const { rows } = await pool.query(
      `SELECT manager_employee_id FROM eos_workforce.employee_reporting_relationships
        WHERE tenant_id = $1 AND employee_id = $2 AND effective_to IS NULL`,
      [tenantId, employeeId(edge.employee)]);
    const current = rows[0]?.manager_employee_id ?? null;
    if (current === employeeId(edge.manager)) {
      ledger.record("reportingRelationships", "ALREADY_PRESENT", `${edge.employee}->${edge.manager}`);
      continue;
    }
    if (current !== null) {
      ledger.record("reportingRelationships", "FIXTURE_DRIFT", `${edge.employee}->${edge.manager}`,
        `a different current manager is recorded; the seed never reassigns a reporting line`);
      continue;
    }
    ledger.record("reportingRelationships", "CREATE", `${edge.employee}->${edge.manager}`);
    if (apply) {
      if (!reportingActor.capabilities.has("admin.employeeProfile.write")) {
        refuse("CAPABILITY_NOT_LIVE", "the administering Principal does not hold a LIVE admin.employeeProfile.write grant; reporting relationships are never written without it");
      }
      await establishReportingRelationship({ pool }, reportingActor, {
        employeeId: employeeId(edge.employee), managerEmployeeId: employeeId(edge.manager), reason: REPORTING_REASON,
      });
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 10, 11. CRM.
  for (const a of manifest.accounts) {
    const existing = await crm.readAccount(pool, tenantId, a.id);
    if (!existing) {
      ledger.record("accounts", "CREATE", a.id);
      if (apply) await crm.createAccount(pool, tenantId, actorUid, { id: a.id, name: a.name, status: a.status, ownerEmployeeId: employeeId(a.owner) });
    } else if (existing.ownerEmployeeId !== employeeId(a.owner) || existing.name !== a.name) {
      ledger.record("accounts", "FIXTURE_DRIFT", a.id, "the stored Account owner or name differs from the manifest");
    } else {
      ledger.record("accounts", "ALREADY_PRESENT", a.id);
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  for (const c of manifest.contacts) {
    const existing = (await crm.listAccountContacts(pool, tenantId, c.account)).find((x) => x.id === c.id);
    if (!existing) {
      ledger.record("contacts", "CREATE", c.id);
      if (apply) {
        await crm.createContact(pool, tenantId, actorUid, {
          id: c.id, accountId: c.account, name: c.name, isPrimary: c.isPrimary,
          email: c.email ?? null, phone: c.phone ?? null, contactRole: c.contactRole ?? null,
        });
      }
    } else if (existing.name !== c.name) {
      ledger.record("contacts", "FIXTURE_DRIFT", c.id, "the stored Contact name differs from the manifest");
    } else {
      ledger.record("contacts", "ALREADY_PRESENT", c.id);
    }
  }
  for (const l of manifest.locations) {
    const existing = await crm.readAccountLocation(pool, tenantId, l.id);
    if (!existing) {
      ledger.record("locations", "CREATE", l.id);
      if (apply) {
        await crm.createAccountLocation(pool, tenantId, actorUid, {
          id: l.id, accountId: l.account, name: l.name,
          addressStreet: l.addressStreet ?? null, addressCity: l.addressCity ?? null,
          addressState: l.addressState ?? null, addressPostalCode: l.addressPostalCode ?? null,
        });
      }
    } else if (existing.name !== l.name) {
      ledger.record("locations", "FIXTURE_DRIFT", l.id, "the stored site name differs from the manifest");
    } else {
      ledger.record("locations", "ALREADY_PRESENT", l.id);
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 12. Equipment models.
  for (const m of manifest.equipmentModels) {
    const existing = await equipmentCustody.readEquipmentModel(pool, tenantId, m.id);
    if (!existing) {
      ledger.record("equipmentModels", "CREATE", m.id);
      if (apply) await equipmentCustody.recordEquipmentModel(pool, tenantId, actorUid, m);
    } else if (existing.modelNumber !== m.modelNumber || existing.manufacturerId !== m.manufacturerId || existing.status !== m.status) {
      ledger.record("equipmentModels", "FIXTURE_DRIFT", m.id, "the stored model differs from the manifest");
    } else {
      ledger.record("equipmentModels", "ALREADY_PRESENT", m.id);
    }
  }

  // ---- 13. Equipment (installed). BLOCKED. Declared, counted, and written NOWHERE.
  for (const e of manifest.equipment.desired) ledger.record("equipment", "BLOCKED", e.id);

  // ---- 14. Commercial records + the governed accountable person, one transaction per record.
  const idByNumber = new Map();
  for (const r of manifest.commercial) {
    const shape = COMMERCIAL[r.kind];
    const found = await pool.query(
      `SELECT id, owner_employee_id, accountable_employee_id FROM eos_commercial.${shape.table}
        WHERE tenant_id = $1 AND ${shape.number} = $2`, [tenantId, r.number]);
    if (found.rows.length === 1) {
      if (found.rows[0].owner_employee_id !== employeeId(r.owner)) {
        ledger.record("commercial", "FIXTURE_DRIFT", r.number, "the stored record owner differs from the manifest");
        continue;
      }
      idByNumber.set(r.number, found.rows[0].id);
      ledger.record("commercial", "ALREADY_PRESENT", r.number);
      if (found.rows[0].accountable_employee_id === null) ledger.record("accountablePersons", "CREATE", r.number);
      else ledger.record("accountablePersons", "ALREADY_PRESENT", r.number);
      if (!apply) continue;
    } else {
      ledger.record("commercial", "CREATE", r.number);
      ledger.record("accountablePersons", "CREATE", r.number);
      if (!apply) continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const authority = createPostgresEmployeeAuthority(client);
      const owner = await authority.resolveEmployeeReference({ tenantId, employeeId: employeeId(r.owner) });
      if (owner.outcome !== "RESOLVED" || !decideAccountabilityEligibility(owner.employee, policy).eligible) {
        refuse("OWNER_INVALID", `${r.number}: the owner must resolve to an eligible governed Employee`);
      }
      const established = await establishCreationAccountablePerson({ employeeAuthority: authority }, {
        tenantId,
        family: shape.family,
        explicitAccountableEmployeeId: r.accountable === DERIVE_FROM_OWNER ? null : employeeId(r.accountable),
        currentRecordOwnerEmployeeId: employeeId(r.owner),
        eligibilityPolicy: policy,
      });
      const governedAccountable = accountablePersonFields(established)[ACCOUNTABLE_PERSON_FIELD];

      const locked = await client.query(
        `SELECT id, owner_employee_id, accountable_employee_id FROM eos_commercial.${shape.table}
          WHERE tenant_id = $1 AND ${shape.number} = $2 FOR UPDATE`, [tenantId, r.number]);
      let id;
      let current = null;
      if (locked.rows.length === 1) {
        id = locked.rows[0].id;
        current = locked.rows[0].accountable_employee_id;
        if (locked.rows[0].owner_employee_id !== employeeId(r.owner)) refuse("FIXTURE_DRIFT", `${r.number} exists with a different owner`);
        if (current !== null && current !== governedAccountable) refuse("FIXTURE_DRIFT", `${r.number} exists with a different accountable person`);
      } else {
        const record = await createCommercialRecord(client, tenantId, actorUid, {
          kind: r.kind, recordNumber: r.number, accountId: r.account, ownerEmployeeId: employeeId(r.owner),
          operatingCompanyId: manifest.company.operatingCompanyId, createdBy: actorUid,
          opportunityId: r.opportunity ? idByNumber.get(r.opportunity) : null,
          salesAgreementId: r.agreement ? idByNumber.get(r.agreement) : null,
        });
        id = record.id;
      }
      if (current === null) {
        await client.query(
          `UPDATE eos_commercial.${shape.table} SET accountable_employee_id = $1, updated_by = $2, updated_at = now()
            WHERE tenant_id = $3 AND id = $4 AND accountable_employee_id IS NULL`,
          [governedAccountable, actorUid, tenantId, id]);
      }
      await client.query("COMMIT");
      idByNumber.set(r.number, id);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 15. Part IDENTITIES. DIRECT INSERT; identity only; documented in the manifest.
  for (const p of manifest.parts.records) {
    const { rows } = await pool.query(`SELECT 1 FROM eos_ops.parts WHERE tenant_id = $1 AND id = $2`, [tenantId, p.partId]);
    ledger.record("parts", rows.length === 0 ? "CREATE" : "ALREADY_PRESENT", p.partId);
    if (apply && rows.length === 0) {
      await pool.query(
        `INSERT INTO eos_ops.parts (id, tenant_id, created_by) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [p.partId, tenantId, actorUid]);
    }
  }
  // Every descriptive Part fact is BLOCKED while the PostgreSQL catalog writer is INACTIVE.
  for (const p of manifest.parts.records) ledger.record("partDescriptiveFacts", "BLOCKED", p.partId);

  // ---- 16. Suppliers, then supplier catalog items.
  for (const s of manifest.suppliers) {
    const existing = await supplierCatalog.readSupplier(pool, tenantId, s.supplierId);
    if (!existing) {
      ledger.record("suppliers", "CREATE", s.supplierId);
      if (apply) await supplierCatalog.createSupplier(pool, tenantId, actorUid, s);
    } else if (existing.name !== s.name) {
      ledger.record("suppliers", "FIXTURE_DRIFT", s.supplierId, "the stored supplier name differs from the manifest");
    } else {
      ledger.record("suppliers", "ALREADY_PRESENT", s.supplierId);
    }
  }
  for (const i of manifest.supplierCatalogItems) {
    const existing = await supplierCatalog.readSupplierCatalogItem(pool, tenantId, i.partId, i.supplierId);
    if (!existing) {
      ledger.record("supplierCatalogItems", "CREATE", `${i.supplierId}/${i.partId}`);
      if (apply) {
        // createSupplierCatalogItem always writes preferred = FALSE; `preferred` is set only through the
        // governed setPreferredSupplier, which clears the incumbent in the same transaction and takes the
        // version it just read as the optimistic guard.
        const created = await supplierCatalog.createSupplierCatalogItem(pool, tenantId, actorUid, i);
        if (i.preferred) await supplierCatalog.setPreferredSupplier(pool, tenantId, actorUid, i.partId, i.supplierId, created.version);
      }
    } else if (existing.supplierSku !== i.supplierSku) {
      ledger.record("supplierCatalogItems", "FIXTURE_DRIFT", `${i.supplierId}/${i.partId}`, "the stored supplier SKU differs from the manifest");
    } else {
      ledger.record("supplierCatalogItems", "ALREADY_PRESENT", `${i.supplierId}/${i.partId}`);
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 17. Warehouses, then bins.
  for (const w of manifest.warehouses) {
    const existing = await warehouseBins.readWarehouse(pool, tenantId, w.warehouseId);
    if (!existing) {
      ledger.record("warehouses", "CREATE", w.warehouseId);
      if (apply) await warehouseBins.createWarehouse(pool, tenantId, actorUid, { ...w, operatingCompanyKey: companyKey });
    } else if (existing.name !== w.name || existing.operatingCompanyKey !== companyKey) {
      ledger.record("warehouses", "FIXTURE_DRIFT", w.warehouseId, "the stored warehouse name or operating company differs from the manifest");
    } else {
      ledger.record("warehouses", "ALREADY_PRESENT", w.warehouseId);
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // A bin's identity is DERIVED from its idempotency key (deriveBinId), so the key is the stable handle
  // this seed recognises a previously-created bin by -- never the generated code, which a rename may change.
  for (const b of manifest.bins) {
    const { rows } = await pool.query(
      `SELECT id, code FROM eos_ops.bins WHERE tenant_id = $1 AND warehouse_id = $2 AND idempotency_key = $3`,
      [tenantId, b.warehouseId, b.idempotencyKey]);
    if (rows.length === 0) {
      ledger.record("bins", "CREATE", b.idempotencyKey);
      if (apply) await warehouseBins.createBin(pool, tenantId, actorUid, b);
    } else {
      ledger.record("bins", "ALREADY_PRESENT", rows[0].code);
    }
  }

  // ---- 18. Mobile locations, then trucks.
  for (const l of manifest.trucks.mobileLocations) {
    const existing = await truckFleet.readMobileLocation(pool, tenantId, l.locationId);
    if (!existing) {
      ledger.record("mobileLocations", "CREATE", l.locationId);
      if (apply) await truckFleet.createMobileLocation(pool, tenantId, actorUid, { ...l, operatingCompanyKey: companyKey });
    } else if (existing.displayLabel !== l.displayLabel) {
      ledger.record("mobileLocations", "FIXTURE_DRIFT", l.locationId, "the stored mobile location label differs from the manifest");
    } else {
      ledger.record("mobileLocations", "ALREADY_PRESENT", l.locationId);
    }
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  for (const t of manifest.trucks.records) {
    const existing = await truckFleet.readTruck(pool, tenantId, t.truckId);
    if (!existing) {
      ledger.record("trucks", "CREATE", t.truckId);
      if (apply) {
        await truckFleet.createTruck(pool, tenantId, actorUid, {
          truckId: t.truckId, vehicleNumber: t.vehicleNumber, displayLabel: t.displayLabel,
          status: t.status, homeWarehouseId: t.homeWarehouseId, mobileLocationId: t.mobileLocationId,
        });
      }
    } else if (existing.vehicleNumber !== t.vehicleNumber || existing.homeWarehouseId !== t.homeWarehouseId) {
      ledger.record("trucks", "FIXTURE_DRIFT", t.truckId, "the stored truck differs from the manifest");
    } else {
      ledger.record("trucks", "ALREADY_PRESENT", t.truckId);
    }
    // The person-to-truck relationship has no governed authority and is written NOWHERE.
    ledger.record("truckOperatorLinks", "BLOCKED", `${t.truckId}<-${t.desiredOperator}`);
  }
  if (ledger.drift.length > 0) return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);

  // ---- 19. Purchasing: reorder request -> purchase order -> receipt / void.
  for (const p of manifest.purchasing) {
    const { rows } = await pool.query(
      `SELECT id, status FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND reorder_request_number = $2`,
      [tenantId, p.reorderRequestNumber]);
    if (rows.length > 0) {
      ledger.record("purchasing", "ALREADY_PRESENT", p.reorderRequestNumber);
      continue;
    }
    ledger.record("purchasing", "CREATE", p.reorderRequestNumber);
    if (!apply) continue;

    const request = await purchasing.createReorderRequest(pool, tenantId, actorUid, companyKey, {
      partId: p.partId, warehouseId: p.warehouseId, status: "PURCHASING_IN_PROGRESS",
      requestedQuantity: p.requestedQuantity, recommendedQuantity: p.recommendedQuantity,
      reorderRequestNumber: p.reorderRequestNumber,
    });
    await purchasing.recordPurchaseOrder(pool, tenantId, actorUid, request.id, {
      supplierName: p.purchaseOrder.supplierName, externalPoNumber: p.purchaseOrder.externalPoNumber,
      orderedQuantity: p.purchaseOrder.orderedQuantity, orderedDate: p.purchaseOrder.orderedDate,
      expectedArrivalDate: p.purchaseOrder.expectedArrivalDate,
      unitPriceMinor: p.purchaseOrder.unitPriceMinor, currency: p.purchaseOrder.currency,
    });
    if (p.progressTo === "RECEIVED") {
      await purchasing.createReceivingOrder(pool, tenantId, actorUid, companyKey, {
        purchaseOrderId: request.id, reorderRequestId: request.id, sourceKind: p.receipt.sourceKind,
        receivingLocation: p.receipt.receivingLocation, status: p.receipt.status,
        receivingOrderNumber: p.receipt.receivingOrderNumber, idempotencyKey: p.receipt.idempotencyKey,
        lines: p.receipt.lines,
      });
      ledger.record("receiving", "CREATE", p.receipt.receivingOrderNumber);
    } else if (p.progressTo === "VOIDED") {
      await purchasing.voidPurchaseOrder(pool, tenantId, actorUid, request.id, p.void.reason);
      ledger.record("purchaseOrderVoids", "CREATE", p.purchaseOrder.externalPoNumber);
    }
  }
  // The receipt -> on-hand movement has no governed PostgreSQL writer.
  for (const p of manifest.purchasing) if (p.progressTo === "RECEIVED") ledger.record("receiptInventoryMovements", "BLOCKED", p.receipt.receivingOrderNumber);

  // ---- 20. Cycle counts. The LAST writes, because reconcile is what posts the inventory movement.
  for (const c of manifest.cycleCounts) {
    const { rows } = await pool.query(
      `SELECT s.id FROM eos_ops.cycle_count_sheets s
        WHERE s.tenant_id = $1 AND s.operating_company_key = $2 AND s.location_id = $3
          AND EXISTS (SELECT 1 FROM eos_ops.cycle_count_lines l
                       WHERE l.tenant_id = s.tenant_id AND l.sheet_id = s.id AND l.part_id = $4)`,
      [tenantId, companyKey, c.location.id, c.lines[0].partId]);
    if (rows.length > 0) {
      ledger.record("cycleCounts", "ALREADY_PRESENT", c.key);
      continue;
    }
    ledger.record("cycleCounts", "CREATE", c.key);
    if (!apply) continue;

    const sheet = await cycleCounts.createSheet(pool, tenantId, actorUid, companyKey, c.location);
    for (const line of c.lines) {
      const opened = await cycleCounts.openLine(pool, tenantId, actorUid, sheet.id, line.partId, line.trackingMode, line.expectedQuantity, []);
      // The submitter and the reconciler are DIFFERENT actors, because separation of duties is a real rule
      // in cycleCountRepository and this sample company exercises it rather than working around it.
      const submitterActor = `sample-company-v2:${line.submittedBy}`;
      await cycleCounts.submitCount(pool, tenantId, submitterActor, opened.id, line.countedQuantity, []);
      if (line.decision !== null) {
        await cycleCounts.reconcileLine(pool, tenantId, `sample-company-v2:${c.reconciledBy}`, opened.id, line.decision, line.reason);
        if (line.expectMovement) ledger.record("inventoryMovements", "CREATE", `${c.key}/${line.partId}`);
      }
    }
  }

  // ---- 21, 22. Service, inbound work, reporting and financial consequences. BLOCKED; written NOWHERE.
  for (const w of manifest.service.desired) ledger.record("workOrders", "BLOCKED", w.key);
  for (const w of manifest.service.desired) ledger.record("workOrderAssignments", "BLOCKED", `${w.key}<-${w.desiredAssignee}`);
  for (const i of manifest.inboundWork.desired) ledger.record("inboundWork", "BLOCKED", i.key);
  ledger.record("financials", "BLOCKED", "invoices and payments (FINANCIAL_SAMPLE_COVERAGE)");

  return finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId);
}

function finish(manifest, options, ledger, grantReport, capabilityKeys, tenantId) {
  const totals = { CREATE: 0, ALREADY_PRESENT: 0, FIXTURE_DRIFT: 0, BLOCKED: 0 };
  for (const d of Object.values(ledger.domains)) for (const k of Object.keys(totals)) totals[k] += d[k];
  return {
    tool: "seedSampleCompany",
    sampleCompanyVersion: manifest.sampleCompanyVersion,
    classification: manifest.classification,
    mode: options.mode,
    applied: options.apply === true,
    tenantKey: options.tenantKey,
    tenantId,
    operatingCompanyKey: manifest.company.operatingCompanyKey,
    eligibilityPolicyId: manifest.eligibilityPolicy.policyId,
    syntheticIdentityProvider: SYNTHETIC_IDENTITY_PROVIDER,
    jobRoleAuthority: manifest.rulings.jobRole,
    capabilityGrants: {
      keysDerivedFromRoleCatalog: capabilityKeys.length,
      apply: grantReport.apply,
      beforeCount: grantReport.beforeCount,
      proposedAdditions: grantReport.proposedAdditions,
      appliedAdditions: grantReport.appliedAdditions,
      unresolved: grantReport.unresolved,
    },
    totals,
    domains: ledger.domains,
    drift: ledger.drift,
    blockedRelationships: manifest.blockedRelationships.map((b) => b.code),
    executionOrder: manifest.executionOrder,
    pass: ledger.drift.length === 0 && grantReport.unresolved.length === 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client library exists in this process.
  const options = assertSampleCompanyInvocation(args, process.env);
  validateManifest(MANIFEST);

  if (options.mode === "verify") {
    const { verifySampleCompanyMain } = require("./verifySampleCompany.js");
    await verifySampleCompanyMain(options);
    return;
  }

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: options.connectionString, max: 4 }));
  try {
    const result = await seedSampleCompany(pool, options);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ environment: options.environmentId, runtimeLabel: "nonprod", ...result }, null, 2));
    process.exitCode = result.pass ? 0 : 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}

module.exports = {
  seedSampleCompany,
  validateManifest,
  assertSampleCompanyInvocation,
  sampleCompanyCapabilityKeys,
  EMPLOYMENT_STATUS_VALUES,
  SYNTHETIC_IDENTITY_PROVIDER,
  JOB_ROLE_VOCABULARY,
  REQUIRED_ENVIRONMENT,
  REQUIRED_TENANT_KEY,
  PROFILE_COLUMNS,
  MANIFEST,
};
