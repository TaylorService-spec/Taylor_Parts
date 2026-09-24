// THE GOVERNED SYNTHETIC NONPROD WORKFORCE SEED -- Owner decision 2026-09-14.
//
// ============================ WHAT THIS IS ============================
//
// The nonprod activation census found an empty world: 0 Employees, 1 Principal, 0 Employee links, 0 commercial
// rows. No real Taylor source data is available for this phase, so the Owner authorized a SYNTHETIC nonprod
// acceptance dataset, declared in scripts/fixtures/syntheticNonprodWorkforceSeed.v1.json. It exists to make
// the C/D/E/F/G/H measurements non-vacuous. It is NOT historical truth, NOT migrated Taylor data and NOT real
// people, and every row it writes says so in its id, name or assertion reason.
//
// ============================ HOW EACH FACT IS WRITTEN ============================
//
//   Principal + membership   ensureTenantPrincipal (governed, audited, idempotent). Synthetic Principals use
//                            identity provider `eos-synthetic-nonprod`, which NO verifier recognizes, so they
//                            can never authenticate. The one real administrator Principal is reused, not
//                            recreated.
//   Security Role            assignRole (governed, audited, access-version bump, idempotent). Explicit per
//                            manifest entry; never inferred from the Job Role.
//   Employee <-> Principal   establishLink, OPERATOR_ASSERTED, with author and reason.
//   Account/Contact/Location customerRepository create* (governed CRM writers; Contact/Location inherit owner).
//   Commercial record        BLOCKED_PENDING_C5. Owner ruling 2026-09-23: this seed WRITES NONE. See below.
//   Accountable Person       GOVERNED/SEED: establishCreationAccountablePerson against the PostgreSQL Employee
//                            authority under COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1, then the mint, then
//                            accountablePersonFields. accountable_employee_id is written ONLY from that value,
//                            in the SAME transaction as the record, and only while it is still NULL. A manifest
//                            id never reaches the column directly. This is not live write activation, is not a
//                            reusable production writer, and does not close activation blocker #2.
//   Employee                 NO governed Employee writer exists in the repository (migration 019 built the
//                            authority, not a write path). The seed inserts fixture rows directly, refuses to
//                            overwrite a row that differs, and never updates one.
//
// Job Role is manifest metadata ONLY: "Job Role authority is NOT YET IMPLEMENTED in PostgreSQL."
//
// ============================ BLOCKED_PENDING_C5 -- THE COMMERCIAL HALF ============================
//
// Owner ruling 2026-09-23: "The current v1 seeder MUST NOT recreate the twelve intentionally removed Commercial
// C5 blockers. Current Commercial acceptance state: BLOCKED_PENDING_C5. Commercial acceptance data must be
// rebuilt only after the canonical Commercial migration/authority exists."
//
// The eight records this manifest declares -- SYN-NP-OPP-0001..0004, SYN-NP-SA-0001/0002, SYN-NP-SO-0001/0002 --
// are eight of the twelve rows the authorized governed cleanup removed from nonprod (commit 106e4292) BECAUSE
// they blocked Commercial C5. This seeder used to iterate `manifest.commercial` and write every one of them
// unconditionally, so a single re-run would have re-armed the blocker the cleanup cleared.
//
// THREE RINGS, all fail-closed, gating the WRITE and never the DECLARATION:
//
//   1. MANIFEST.  `commercialSeedState.status` must be exactly BLOCKED and `blockedBy` exactly
//      COMMERCIAL_RECORDS_PENDING_C5 -- the same gate shape and the same blocker code that
//      scripts/fixtures/sampleCompany.v2.json + scripts/seedSampleCompany.js already use. Unlike v2, BLOCKED is
//      the ONLY status v1 admits: there is no SEEDED branch, so a caller-supplied manifest cannot reopen the
//      write path. Anything else is MANIFEST_INVALID, before any connection exists.
//   2. LOOP.      Each declared record is accounted BLOCKED with its governed reason and the loop continues.
//      No client is opened, no accountable person is established, nothing is written, and the run still
//      completes so that every NON-Commercial fixture seeds exactly as before.
//   3. WRITER.    assertCommercialWriteAllowed() sits immediately above the governed writer and refuses
//      COMMERCIAL_SEED_BLOCKED_PENDING_C5 unconditionally. If ring 1 or 2 is ever edited away, the write itself
//      still refuses, inside the record's own transaction, so nothing commits.
//
// The declarations stay and stay fully validated: scripts/commercialC5.js reads `manifest.commercial` from BOTH
// manifests to classify a target row DECLARED_SYNTHETIC rather than UNKNOWN, and sampleCompany.v2.json's SUPERSET
// proof needs these eight numbers carried forward byte-identically. Blocked is not removed.
//
// ACTIVATION DEPENDENCY (not implemented here, and never by v1): Commercial C5 copy AND verify must complete for
// this tenant first. Post-C5 Commercial fixtures are then designed and sealed as SAMPLE COMPANY V3
// (`sampleCompanyV3` in scripts/fixtures/sampleCompany.v2.json), which supersedes this v1 manifest. This v1
// seeder gets no unblocked branch at any point.
//
// ============================ THE FENCE ============================
//
// Refuses, before any client exists: no registry `--environment`, production by role or project id (shared
// fence), no `--databaseUrlEnv`, EOS_ENVIRONMENT not exactly `nonprod` (positive identification), and missing
// `--tenantKey`, `--existingAdminPrincipalId` or `--performedBy`. The administering authority for the governed
// Role and Principal commands is NOT asserted by this script: it is read from the named existing administrator
// Principal's own active Role assignments, and the run refuses if that Principal cannot administer.
//
// Usage (Render Shell on eos-api-nonprod):
//   node scripts/seedSyntheticNonprodWorkforce.js --environment platform-sandbox --databaseUrlEnv DATABASE_URL \
//     --tenantKey taylor-nonprod --existingAdminPrincipalId <principal id> --performedBy <operator>
//
// Exit 0 seeded (or already seeded); 2 refused or failed. Output: deterministic JSON summary, no secrets.
"use strict";

const { assertMeasurementTarget, parseArgs } = require("./measureEmployeeReferenceIntegrity.js");
const { assertNonprodRuntime } = require("./measureWorkforceActivation.js");
const MANIFEST = require("./fixtures/syntheticNonprodWorkforceSeed.v1.json");

/** Mirrored from functions/src/employeeIdentity/employeeAuthority.ts; the test asserts equality. */
const EMPLOYMENT_STATUS_VALUES = Object.freeze(["ACTIVE", "ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "CONTRACTOR"]);
const SYNTHETIC_IDENTITY_PROVIDER = "eos-synthetic-nonprod";
const DERIVE_FROM_OWNER = "DERIVE_FROM_OWNER";
const LINK_REASON = "SYNTHETIC NONPROD SEED v1: fixture link between a fixture Employee and a Principal; not a real person";
const ROLE_REASON = "SYNTHETIC NONPROD SEED v1: explicit fixture Security Role assignment; not inferred from Job Role";

/** The blocker this seed's Commercial half is gated on. Declared by scripts/fixtures/sampleCompany.v2.json too. */
const COMMERCIAL_BLOCKER_CODE = "COMMERCIAL_RECORDS_PENDING_C5";
/** The governed refusal this seed returns rather than recreating a removed Commercial C5 blocker. */
const COMMERCIAL_SEED_BLOCKED = "COMMERCIAL_SEED_BLOCKED_PENDING_C5";
const COMMERCIAL_SEED_BLOCKED_MESSAGE =
  "BLOCKED_PENDING_C5: the declared-synthetic Commercial records were removed from nonprod because they blocked " +
  "Commercial C5, and this v1 seed may never put them back. Commercial acceptance data is rebuilt only after the " +
  "canonical Commercial migration/authority exists (C5 copy + verify), by SAMPLE COMPANY V3.";

const COMMERCIAL = Object.freeze({
  OPPORTUNITY: Object.freeze({ family: "opportunity", table: "opportunities", number: "opportunity_number" }),
  SALES_AGREEMENT: Object.freeze({ family: "salesAgreement", table: "sales_agreements", number: "sales_agreement_number" }),
  SALES_ORDER: Object.freeze({ family: "salesOrder", table: "sales_orders", number: "sales_order_number" }),
});

class SyntheticSeedError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "SyntheticSeedError";
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new SyntheticSeedError(code, message);
};

/** The manifest's invariants, checked before any connection. Returns lookup maps. */
function validateManifest(m) {
  if (m.manifest !== "SYNTHETIC_NONPROD_WORKFORCE_SEED" || m.version !== 1) refuse("MANIFEST_INVALID", "not the v1 synthetic seed manifest");
  if (m.syntheticIdentityProvider !== SYNTHETIC_IDENTITY_PROVIDER) refuse("MANIFEST_INVALID", "synthetic identity provider must be eos-synthetic-nonprod");
  const policy = m.eligibilityPolicy;
  if (policy.policyId !== "COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1" || JSON.stringify(policy.eligibleStatuses) !== JSON.stringify(["ACTIVE", "CONTRACTOR"])) {
    refuse("MANIFEST_INVALID", "the eligibility policy must be exactly COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1 = ACTIVE, CONTRACTOR");
  }

  const jobRoles = new Set();
  for (const r of m.jobRoles) {
    if (/^sales$/i.test(r.key) || /^sales$/i.test(r.label)) refuse("MANIFEST_INVALID", "a generic Sales Job Role is forbidden");
    if (jobRoles.has(r.key)) refuse("MANIFEST_INVALID", `duplicate Job Role ${r.key}`);
    jobRoles.add(r.key);
  }
  for (const required of ["RETAIL_SALES", "NATIONAL_ACCOUNTS_SALES"]) {
    if (!jobRoles.has(required)) refuse("MANIFEST_INVALID", `Job Role ${required} must be declared separately`);
  }

  const employees = new Map();
  const ids = new Set();
  for (const e of m.employees) {
    if (!EMPLOYMENT_STATUS_VALUES.includes(e.employmentStatus)) refuse("MANIFEST_INVALID", `${e.key}: ${e.employmentStatus} is not a governed lifecycle status`);
    if (!jobRoles.has(e.jobRole)) refuse("MANIFEST_INVALID", `${e.key}: undeclared Job Role ${e.jobRole}`);
    if (!/^synthetic-np-emp-[a-z0-9-]+$/.test(e.id)) refuse("MANIFEST_INVALID", `${e.key}: fixture Employee ids must be synthetic-np-emp-*`);
    if (!/^Synthetic /.test(e.fixtureLabel)) refuse("MANIFEST_INVALID", `${e.key}: fixture labels must say Synthetic`);
    if (employees.has(e.key) || ids.has(e.id)) refuse("MANIFEST_INVALID", `duplicate Employee ${e.key}`);
    employees.set(e.key, e);
    ids.add(e.id);
  }
  const eligible = (key, what) => {
    const e = employees.get(key);
    if (!e) refuse("MANIFEST_INVALID", `${what} names unknown Employee ${key}`);
    if (!policy.eligibleStatuses.includes(e.employmentStatus)) refuse("MANIFEST_INVALID", `${what} names ${key}, who is not eligible under ${policy.policyId}`);
    return e;
  };

  const linkedEmployees = new Set();
  let administrators = 0;
  for (const p of m.principals) {
    eligible(p.employee, "a Principal link");
    if (linkedEmployees.has(p.employee)) refuse("MANIFEST_INVALID", `${p.employee} is linked twice`);
    linkedEmployees.add(p.employee);
    if ("jobRole" in p) refuse("MANIFEST_INVALID", "Security Roles are declared explicitly; a Principal carries no Job Role");
    if (!Array.isArray(p.securityRoles) || p.securityRoles.length === 0) refuse("MANIFEST_INVALID", `${p.employee}: explicit Security Roles required`);
    if (p.existingAdministrator) administrators += 1;
    else if (!/^synthetic-np-principal-[a-z0-9-]+$/.test(p.externalSubject || "")) refuse("MANIFEST_INVALID", `${p.employee}: synthetic subjects must be synthetic-np-principal-*`);
  }
  if (administrators !== 1) refuse("MANIFEST_INVALID", "exactly one existing administrator Principal is reused");

  const accounts = new Map(m.accounts.map((a) => [a.id, a]));
  for (const a of m.accounts) eligible(a.owner, `Account ${a.id}`);
  for (const c of [...m.contacts, ...m.locations]) if (!accounts.has(c.account)) refuse("MANIFEST_INVALID", `${c.id} names unknown Account ${c.account}`);

  // ---- RING 1. The Commercial gate, read before anything connects.
  //
  // The eight declarations below stay DECLARED and stay FULLY VALIDATED whether or not they are ever written:
  // a declaration nobody checks rots, scripts/commercialC5.js classifies target rows from exactly these numbers,
  // and Sample Company v3 seeds from them. What this gate decides is whether they are WRITTEN, not whether they
  // are CORRECT. BLOCKED is the only status v1 admits -- there is deliberately no SEEDED branch to flip.
  const state = m.commercialSeedState;
  if (!state || state.status !== "BLOCKED" || state.blockedBy !== COMMERCIAL_BLOCKER_CODE) {
    refuse("MANIFEST_INVALID",
      `commercialSeedState.status must be exactly "BLOCKED" naming ${COMMERCIAL_BLOCKER_CODE}; the v1 seed has no unblocked state`);
  }

  const numbers = new Map();
  let same = 0;
  let different = 0;
  for (const r of m.commercial) {
    if (!COMMERCIAL[r.kind]) refuse("MANIFEST_INVALID", `${r.number}: unknown kind ${r.kind}`);
    if (!accounts.has(r.account)) refuse("MANIFEST_INVALID", `${r.number}: unknown Account`);
    eligible(r.owner, `${r.number} owner`);
    if (r.accountable === DERIVE_FROM_OWNER || r.accountable === r.owner) same += 1;
    else {
      eligible(r.accountable, `${r.number} accountable person`);
      different += 1;
    }
    for (const upstream of [r.opportunity, r.agreement]) {
      if (upstream !== undefined && !numbers.has(upstream)) refuse("MANIFEST_INVALID", `${r.number}: upstream ${upstream} must be declared first`);
    }
    numbers.set(r.number, r);
  }
  if (same === 0 || different === 0) refuse("MANIFEST_INVALID", "the commercial seed must prove both owner == accountable and owner != accountable");
  return { employees, policy };
}

/**
 * RING 3. The last gate before the governed Commercial writer, and the one that holds even if rings 1 and 2 are
 * edited away. It takes no argument it could be talked out of: v1 has no state in which a Commercial write is
 * allowed, so this refuses unconditionally, with the governed reason, inside the record's own transaction.
 */
function assertCommercialWriteAllowed(recordNumber) {
  refuse(COMMERCIAL_SEED_BLOCKED, `${recordNumber}: ${COMMERCIAL_SEED_BLOCKED_MESSAGE}`);
}

function assertSeedArguments(args) {
  for (const flag of ["tenantKey", "existingAdminPrincipalId", "performedBy"]) {
    if (typeof args[flag] !== "string" || args[flag].trim() === "") {
      refuse("ARGUMENT_REQUIRED", `--${flag} is required and has no default`);
    }
  }
  return { tenantKey: args.tenantKey, existingAdminPrincipalId: args.existingAdminPrincipalId, performedBy: args.performedBy };
}

/** The seed itself. `pool` is a pg Pool. Libraries load here, after the caller's fence. */
async function seedSyntheticNonprodWorkforce(pool, options, manifest = MANIFEST) {
  const { employees, policy } = validateManifest(manifest);
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
  const { assignRole } = require("../lib/adminPolicy/policyCommands.js");
  const { hasAdministrationAuthority } = require("../lib/adminPolicy/administrationAuthority.js");
  const { establishLink } = require("../lib/employeeIdentity/employeePrincipalLinkRepository.js");
  const { createPostgresEmployeeAuthority } = require("../lib/employeeIdentity/postgresEmployeeAuthority.js");
  const { decideAccountabilityEligibility } = require("../lib/employeeIdentity/employeeAuthority.js");
  const crm = require("../lib/crm/customerRepository.js");
  const { createCommercialRecord } = require("../lib/eosCommercial/commercialOwnershipRepository.js");
  const { establishCreationAccountablePerson } = require("../lib/responsibility/accountablePersonEstablishment.js");
  const { accountablePersonFields, ACCOUNTABLE_PERSON_FIELD } = require("../lib/responsibility/accountablePersonStorage.js");

  const summary = { employees: { created: 0, existing: 0 }, principals: { created: 0, existing: 0 }, links: { created: 0, existing: 0 },
    roleAssignments: { created: 0, existing: 0 }, accounts: { created: 0, existing: 0 }, contacts: { created: 0, existing: 0 },
    locations: { created: 0, existing: 0 }, commercial: { created: 0, existing: 0, blocked: 0 },
    accountablePersons: { persisted: 0, existing: 0, blocked: 0 } };
  const count = (bucket, created) => (created ? (summary[bucket].created += 1) : (summary[bucket].existing += 1));
  const repo = new PostgresPolicyRepository(pool);
  const employeeId = (key) => employees.get(key).id;

  // ---- tenant and the real administrator whose authority the governed commands run under
  const tenant = await repo.getTenantByKey(options.tenantKey);
  if (!tenant) refuse("TENANT_NOT_FOUND", `no tenant with key ${options.tenantKey}; the seed never creates one`);
  const tenantId = tenant.id;
  const admin = await repo.getPrincipal(options.existingAdminPrincipalId);
  const adminMembership = admin ? await repo.getMembership(tenantId, admin.id) : null;
  if (!admin || admin.status !== "active" || !adminMembership || adminMembership.status !== "active") {
    refuse("ADMINISTRATOR_INVALID", "--existingAdminPrincipalId must name an active Principal with an active membership in this tenant");
  }
  const roles = await repo.listRoles(tenantId);
  const roleByKey = new Map(roles.map((r) => [r.key, r]));
  const roleKeyById = new Map(roles.map((r) => [r.id, r.key]));
  const heldRoleKeys = (await repo.listAssignmentsForPrincipal(tenantId, admin.id))
    .filter((a) => a.status === "active").map((a) => roleKeyById.get(a.roleId)).filter(Boolean);
  if (!hasAdministrationAuthority(heldRoleKeys, "assignRole")) {
    refuse("ADMINISTRATOR_INVALID", "the named administrator Principal holds no Role that may assign Roles; the seed asserts no authority of its own");
  }
  const actor = { tenantId, uid: options.performedBy, heldRoleKeys };

  // ---- Employees (fixture rows; no governed Employee writer exists)
  for (const e of employees.values()) {
    const inserted = await pool.query(
      `INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id)
       VALUES ($1, $2, $3::eos_workforce.workforce_employment_status, $4) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [e.id, tenantId, e.employmentStatus, manifest.operatingCompanyId],
    );
    if (inserted.rows.length === 0) {
      const { rows } = await pool.query(
        `SELECT tenant_id, employment_status::text AS status, operating_company_id FROM eos_workforce.employees WHERE id = $1`, [e.id]);
      const row = rows[0];
      if (row.tenant_id !== tenantId || row.status !== e.employmentStatus || row.operating_company_id !== manifest.operatingCompanyId) {
        refuse("FIXTURE_DRIFT", `Employee ${e.id} exists but differs from the manifest; the seed never overwrites an Employee`);
      }
    }
    count("employees", inserted.rows.length === 1);
  }

  // ---- Principals, links, Security Roles
  for (const p of manifest.principals) {
    let principal = admin;
    if (!p.existingAdministrator) {
      const before = await repo.getPrincipalBySubject(SYNTHETIC_IDENTITY_PROVIDER, p.externalSubject);
      principal = await ensureTenantPrincipal(repo, { tenantId, externalSubject: p.externalSubject, identityProvider: SYNTHETIC_IDENTITY_PROVIDER,
        displayName: p.displayName, actorUid: options.performedBy, actorRoleKeys: heldRoleKeys });
      count("principals", before === null);
    }
    const linkedBefore = await pool.query(
      `SELECT 1 FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND employee_id = $2 AND principal_id = $3 AND status = 'active'`,
      [tenantId, employeeId(p.employee), principal.id]);
    await establishLink(pool, { tenantId, principalId: principal.id, employeeId: employeeId(p.employee), operatingCompanyId: manifest.operatingCompanyId,
      linkSource: "OPERATOR_ASSERTED", assertedBy: options.performedBy, assertionReason: LINK_REASON });
    count("links", linkedBefore.rows.length === 0);

    const held = await repo.listAssignmentsForPrincipal(tenantId, principal.id);
    for (const key of p.securityRoles) {
      const role = roleByKey.get(key);
      if (!role) refuse("ROLE_NOT_DEFINED", `Security Role ${key} is not defined in this tenant; the seed never creates Roles`);
      const already = held.some((a) => a.status === "active" && a.roleId === role.id && (a.scopeType ?? "global") === "global");
      await assignRole(repo, actor, { principalId: principal.id, roleId: role.id, reason: ROLE_REASON });
      count("roleAssignments", !already);
    }
  }

  // ---- CRM
  for (const a of manifest.accounts) {
    const existing = await crm.readAccount(pool, tenantId, a.id);
    if (existing && existing.ownerEmployeeId !== employeeId(a.owner)) refuse("FIXTURE_DRIFT", `Account ${a.id} exists with a different owner`);
    if (!existing) await crm.createAccount(pool, tenantId, options.performedBy, { id: a.id, name: a.name, status: a.status, ownerEmployeeId: employeeId(a.owner) });
    count("accounts", !existing);
  }
  for (const c of manifest.contacts) {
    const existing = (await crm.listAccountContacts(pool, tenantId, c.account)).some((x) => x.id === c.id);
    if (!existing) await crm.createContact(pool, tenantId, options.performedBy, { id: c.id, accountId: c.account, name: c.name, isPrimary: c.isPrimary });
    count("contacts", !existing);
  }
  for (const l of manifest.locations) {
    const existing = await crm.readAccountLocation(pool, tenantId, l.id);
    if (!existing) await crm.createAccountLocation(pool, tenantId, options.performedBy, { id: l.id, accountId: l.account, name: l.name });
    count("locations", !existing);
  }

  // ---- Commercial records and GOVERNED/SEED accountable persons, one transaction per record
  //
  // RING 2. BLOCKED_PENDING_C5. Every declared record is ACCOUNTED, by number, with its governed reason -- this
  // is a stated refusal, not a silent skip -- and nothing is written. The loop continues so that the
  // non-Commercial half above (Employees, Principals, links, Security Roles, Accounts, Contacts, Locations)
  // still seeds and still reports exactly as it did before this gate existed.
  const blockedCommercial = [];
  const idByNumber = new Map();
  // validateManifest has already refused any status other than BLOCKED, so for v1 this is always true.
  const commercialBlocked = manifest.commercialSeedState.status === "BLOCKED";
  for (const r of manifest.commercial) {
    if (commercialBlocked) {
      blockedCommercial.push(r.number);
      summary.commercial.blocked += 1;
      summary.accountablePersons.blocked += 1;
      continue;
    }
    const shape = COMMERCIAL[r.kind];
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

      const found = await client.query(
        `SELECT id, owner_employee_id, accountable_employee_id FROM eos_commercial.${shape.table}
          WHERE tenant_id = $1 AND ${shape.number} = $2 FOR UPDATE`, [tenantId, r.number]);
      let id;
      let current = null;
      if (found.rows.length === 1) {
        id = found.rows[0].id;
        current = found.rows[0].accountable_employee_id;
        if (found.rows[0].owner_employee_id !== employeeId(r.owner)) refuse("FIXTURE_DRIFT", `${r.number} exists with a different owner`);
        if (current !== null && current !== governedAccountable) refuse("FIXTURE_DRIFT", `${r.number} exists with a different accountable person`);
      } else {
        // RING 3, immediately above the governed writer: this always throws. See assertCommercialWriteAllowed.
        assertCommercialWriteAllowed(r.number);
        const record = await createCommercialRecord(client, tenantId, options.performedBy, {
          kind: r.kind, recordNumber: r.number, accountId: r.account, ownerEmployeeId: employeeId(r.owner),
          operatingCompanyId: manifest.operatingCompanyId, createdBy: options.performedBy,
          opportunityId: r.opportunity ? idByNumber.get(r.opportunity) : null,
          salesAgreementId: r.agreement ? idByNumber.get(r.agreement) : null,
        });
        id = record.id;
      }
      count("commercial", found.rows.length === 0);
      if (current === null) {
        await client.query(
          `UPDATE eos_commercial.${shape.table} SET accountable_employee_id = $1, updated_by = $2, updated_at = now()
            WHERE tenant_id = $3 AND id = $4 AND accountable_employee_id IS NULL`,
          [governedAccountable, options.performedBy, tenantId, id]);
        summary.accountablePersons.persisted += 1;
      } else {
        summary.accountablePersons.existing += 1;
      }
      await client.query("COMMIT");
      idByNumber.set(r.number, id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    tool: "seedSyntheticNonprodWorkforce",
    manifestVersion: manifest.version,
    classification: manifest.classification,
    tenantKey: options.tenantKey,
    eligibilityPolicyId: policy.policyId,
    syntheticIdentityProvider: SYNTHETIC_IDENTITY_PROVIDER,
    jobRoleAuthority: manifest.rulings.jobRole,
    // Stated, never silent: the run names its own refusal, the blocker it is gated on, and every record number
    // it declined to write, so an operator reading the summary cannot mistake zero Commercial rows for success.
    commercialSeedState: {
      status: manifest.commercialSeedState.status,
      blockedBy: manifest.commercialSeedState.blockedBy,
      reason: COMMERCIAL_SEED_BLOCKED,
      message: COMMERCIAL_SEED_BLOCKED_MESSAGE,
      unblockedBy: manifest.commercialSeedState.unblockedBy,
      blockedRecords: blockedCommercial,
    },
    summary,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // THE FENCE FIRST, before any client exists.
  const { environmentId, connectionString } = assertMeasurementTarget(args, process.env);
  assertNonprodRuntime(process.env);
  const options = assertSeedArguments(args);
  validateManifest(MANIFEST);

  const pg = require("pg");
  const { resolvePolicyDatabaseConfig } = require("../lib/adminPolicy/policyDatabase.js");
  const pool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString, max: 4 }));
  try {
    const result = await seedSyntheticNonprodWorkforce(pool, options);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ environment: environmentId, runtimeLabel: "nonprod", ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
}

module.exports = {
  seedSyntheticNonprodWorkforce,
  validateManifest,
  assertSeedArguments,
  assertCommercialWriteAllowed,
  EMPLOYMENT_STATUS_VALUES,
  SYNTHETIC_IDENTITY_PROVIDER,
  COMMERCIAL_BLOCKER_CODE,
  COMMERCIAL_SEED_BLOCKED,
  MANIFEST,
};
