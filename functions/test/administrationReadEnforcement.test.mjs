// THE ADMINISTRATION READS ARE GOVERNED — proved by refusing, against a real database.
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// `executeAdminOperation` ran every one of the thirteen Administration READS for any principal who
// resolved to a context in the tenant. The dispatcher said so in its own words -- "Reads are open
// to any principal with a context in the tenant. That is not a gap... The sensitive act is CHANGING
// it" -- and administrationSurfaceAuthority.ts recorded the same posture from the other side,
// calling itself explicitly NOT an enforcement point.
//
// That was defensible while nothing governed Administration. It stopped being defensible when
// navigation became capability-governed: from then on the capability model decided what a browser
// DREW, while the data behind every one of those screens stayed available to every authenticated
// principal in the tenant over one POST to /admin/policy. A permission the UI honours and the
// server does not is not a permission.
//
// ════════════════════ THE STRUCTURAL TRAP THIS FILE EXISTS TO CATCH ════════════════════
//
// `AdminActor` carries `heldRoleKeys` -- ROLE KEYS. A gate written against them compiles, reads
// naturally, and passes every test whose persona was granted through a Role. It also SILENTLY
// IGNORES `principal_capabilities`: a direct grant an administrator made through the governed
// `grantObjectActionToPrincipal` command would simply not count, and nobody would notice, because
// `principal_capabilities` holds ZERO rows in nonprod. Requirement F below is the one that fails if
// the gate ever gets rewritten that way, and it is the reason this file exists rather than a
// handful of assertions bolted onto an existing suite.
//
// ════════════════════ WHAT IS NOT PROVED HERE ════════════════════
//
// Nothing about mutations. They were authority-gated before this change and are gated by the same
// commands afterwards -- the engine invariant, the privileged-role approval and the anti-lockout
// guard are untouched, and adminPolicyActivation.test.mjs still proves them.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const api = require("../lib/adminPolicy/adminPolicyApi.js");
const {
  ADMIN_READ_CAPABILITY,
  ADMIN_READ_OPERATIONS,
  ADMIN_MUTATION_OPERATIONS,
  capabilityForAdminRead,
  executeAdminOperation,
} = api;
const { handleAdminRequest } = require("../lib/adminPolicy/adminPolicyHttp.js");
const {
  ADMINISTRATION_READ_CAPABILITY_KEYS,
  ADMINISTRATION_WRITE_CAPABILITY_KEYS,
} = require("../lib/adminPolicy/administrationSurfaceAuthority.js");

const SECURITY_POLICY_READ = "admin.securityPolicy.read";
const PRINCIPAL_ACCESS_READ = "admin.principalAccess.read";
const WORKFLOW_READ = "workflowDefinition.read";
const AUDIT_READ = "audit.event.read";

/**
 * THE OWNER'S MAP, WRITTEN OUT. Not derived from the module under test -- if it were, the module
 * could rename every capability and this assertion would follow it.
 */
const CANONICAL_MAP = Object.freeze({
  listObjects: SECURITY_POLICY_READ,
  readObjectWithFields: SECURITY_POLICY_READ,
  listObjectsWithActions: SECURITY_POLICY_READ,
  getObjectSecurityMatrix: SECURITY_POLICY_READ,
  listRoles: SECURITY_POLICY_READ,
  readRolePolicy: SECURITY_POLICY_READ,
  getRoleSecurity: SECURITY_POLICY_READ,
  listTenantPrincipals: PRINCIPAL_ACCESS_READ,
  listPrincipalRoleAssignments: PRINCIPAL_ACCESS_READ,
  getPrincipalEffectiveAccess: PRINCIPAL_ACCESS_READ,
  listWorkflows: WORKFLOW_READ,
  readWorkflowVersion: WORKFLOW_READ,
  readPolicyAuditHistory: AUDIT_READ,
  // The Administration control plane (2026-09-26): two more projections of the SAME security policy,
  // and its decision history -- all under the ONE security-policy read, no new read key.
  getSecurityRoleDetail: SECURITY_POLICY_READ,
  getObjectActionGrantMatrix: SECURITY_POLICY_READ,
  listRoleCapabilityDecisionHistory: SECURITY_POLICY_READ,
  // The runtime evaluator's explanation of one Principal's access -- the SAME principal-access read.
  explainEffectiveAccess: PRINCIPAL_ACCESS_READ,
  // The condition vocabulary the server enforces: part of the security policy model.
  listSupportedConditionKinds: SECURITY_POLICY_READ,
  // The workflow control plane (2026-09-26): validation results, pinned instances and one
  // workflow's history under the ONE workflow read; an Employee's derived workflow
  // responsibilities under the principal-access read, like explainEffectiveAccess. No new key.
  validateWorkflowVersion: WORKFLOW_READ,
  listWorkflowInstances: WORKFLOW_READ,
  readWorkflowHistory: WORKFLOW_READ,
  listPrincipalWorkflowResponsibilities: PRINCIPAL_ACCESS_READ,
  // Lane SC: the assignment-scope vocabulary the Employee > Security Roles picker reads -- the SAME principal-access
  // read as listPrincipalRoleAssignments. No new key.
  listSupportedAssignmentScopes: PRINCIPAL_ACCESS_READ,
});

const operationsRequiring = (capability) =>
  Object.entries(CANONICAL_MAP).filter(([, key]) => key === capability).map(([op]) => op).sort();

/** Enough input for each read to reach its own body, so a PASS is never a validation accident. */
const INPUT_FOR = Object.freeze({
  readObjectWithFields: { objectKey: "account" },
  getObjectSecurityMatrix: { objectKey: "workOrder" },
  getRoleSecurity: { roleKey: "dispatcher" },
  readPolicyAuditHistory: { limit: 5 },
  getSecurityRoleDetail: { roleKey: "dispatcher" },
  getObjectActionGrantMatrix: { objectKey: "workOrder" },
  listRoleCapabilityDecisionHistory: { limit: 5 },
  explainEffectiveAccess: { principalId: "prn-none" },
});

// ════════════════════ A. THE MAP IS CLOSED — no database needed ════════════════════

test("A: twenty-three reads, each with EXACTLY ONE capability, and the map is the Owner's", () => {
  assert.equal(ADMIN_READ_OPERATIONS.length, 23, "the read list changed size without this map changing");
  assert.deepEqual([...ADMIN_READ_OPERATIONS].sort(), Object.keys(CANONICAL_MAP).sort(),
    "a read exists that the canonical map does not name, or the other way round");
  for (const operation of ADMIN_READ_OPERATIONS) {
    assert.equal(ADMIN_READ_CAPABILITY[operation], CANONICAL_MAP[operation],
      `${operation} requires the wrong capability`);
    assert.equal(capabilityForAdminRead(operation), CANONICAL_MAP[operation]);
  }
  // Exactly four distinct authorities, and no read shares two.
  assert.deepEqual([...new Set(Object.values(ADMIN_READ_CAPABILITY))].sort(),
    [SECURITY_POLICY_READ, AUDIT_READ, WORKFLOW_READ, PRINCIPAL_ACCESS_READ].sort());
});

test("A: an UNMAPPED read cannot compile, and is refused if it ever reaches the gate", () => {
  // ════════ HALF ONE: THE TYPE ════════
  //
  // `READ_OPERATION_SURFACE` is declared `Readonly<Record<AdminReadOperation, AdministrationSurface>>`
  // and `AdminReadOperation` is derived from ADMIN_READ_OPERATIONS, so adding a read to the list
  // without giving it a surface is a COMPILE ERROR (TS2741: "Property '<name>' is missing"). That is
  // the structural half of the guarantee, and this assertion is what keeps the declaration from
  // being loosened to `Record<string, ...>` or `Partial<...>` in passing.
  const source = readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/adminPolicyApi.ts"), "utf8");
  assert.match(source, /READ_OPERATION_SURFACE:\s*Readonly<Record<AdminReadOperation,\s*AdministrationSurface>>/,
    "the operation->surface table is no longer exhaustive by type");
  assert.equal(/READ_OPERATION_SURFACE[^=]*Partial</.test(source), false, "the table was made partial");

  // ════════ HALF TWO: THE RUNTIME ════════
  //
  // A lookup miss is a REFUSAL, never "no capability needed". A map that returned undefined and a
  // gate that treated undefined as open would reinstate the defect one operation at a time.
  for (const notMapped of ["listSecrets", "runSQL", "", "toString", "__proto__", "constructor"]) {
    assert.equal(capabilityForAdminRead(notMapped), null, `"${notMapped}" resolved to an authority`);
  }
});

test("A: the map is the SAME authority navigation uses, and never a write", () => {
  // NO SECOND PERMISSION CATALOG. Every key the gate can require is one administrationSurface-
  // Authority already declares, so "may open Administration > Users" and "may call
  // listTenantPrincipals" cannot become two different answers.
  const surfaceKeys = new Set(ADMINISTRATION_READ_CAPABILITY_KEYS);
  const writes = new Set(ADMINISTRATION_WRITE_CAPABILITY_KEYS);
  for (const [operation, key] of Object.entries(ADMIN_READ_CAPABILITY)) {
    assert.equal(surfaceKeys.has(key), true, `${operation} requires "${key}", which no surface declares`);
    assert.equal(writes.has(key), false, `${operation} is gated by the WRITE "${key}"`);
    assert.equal(/\.(write|create|edit|publish|version|bindRole|assign|decide|execute|stage)$/.test(key), false,
      `${operation} is gated by "${key}", which names a mutation`);
  }
  // And a MUTATION never appears in the read map: mutations are gated by their commands, and a
  // second gate here would be a second authorization model for the same act.
  for (const mutation of ADMIN_MUTATION_OPERATIONS) {
    assert.equal(capabilityForAdminRead(mutation), null, `${mutation} acquired a read authority`);
  }
});

// ════════════════════ G. NO WIDENING — the access model is untouched ════════════════════

test("G: this change mints no capability, writes no grant and adds no migration", () => {
  // THE MIGRATION CHAIN IS UNCHANGED BY THIS CHANGE, counted rather than asserted in prose.
  // The count is 51, not the 50 this lane measured alone: the Phase 3 integration also carries the
  // AUTHORITY ACTIVATION VEHICLE (1762300800000), which is a DIFFERENT change with its own baseline.
  // The pin stays an exact equality so that a migration added or removed by the read enforcement --
  // which still adds none -- fails here; only the integrated total moved.
  const migrations = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"));
  // 51 -> 52: the Administration control plane (1762646400000) -- schema, one WRITE capability and
  // its parity grants. It registers no READ key, which is what the rest of this test proves.
  // 52 -> 53: the workflow control plane (1762732800000) -- workflow schema and triggers only. It
  // registers no capability and writes no grant.
  // 53 -> 54: the Functional Role authority (1762819200000) -- eos_workforce catalog + assignments, the
  // FUNCTIONAL_ROLE binding target, and ONE WRITE capability granted to nobody. It registers no READ key.
  // 54 -> 55: the tenant sales channel activation (1762905600000, lane GA) -- one eos_policy table, no capability,
  // no grant. It registers no READ key.
  // 55 -> 56: the direct-exception cell lock (1762992000000, lane DX) -- one trigger, no capability, no grant.
  // 56 -> 57: the Administrator staffing capability (1763078400000, Owner ruling R1) -- ONE WRITE capability
  // (admin.administratorRole.assign) granted to owner. It registers no READ key.
  // 57 -> 63: the Catalog + Reorder coordinated activation candidate -- the Part alias authority (1763164800000), four
  // Reorder domain schema migrations (1763251200000, 1763424000000, 1763510400000, 1763596800000) and the Reorder
  // lifecycle capability REGISTRATION (1763337600000: eight BUSINESS_ACTION keys, granted to nobody). None registers
  // a READ key, and none is a read-enforcement change.
  // 63 -> 70, INTEGRATED 2026-09-29 (lanes L1 + L2 + L3 over main e2dac914; L5 adds no migration or capability) -- seven migrations appended after the
  // Catalog + Reorder candidate, none of which registers a READ key or is a read-enforcement change:
  //   1763683200000 (L1, DQ-022): ownership.handoff.correct -- ONE BUSINESS_ACTION capability granted to nobody.
  //   1763856000000 (L2, DQ-010 / DQ-011): FOUR Work Order BUSINESS_ACTION capabilities granted to nobody.
  //   1764115200000 (L3, DQ-024): the MOBILE location -> warehouse scope binding -- one eos_ops table, no capability.
  //   1764118800000 (L3, DQ-029): inventory.location.scopeBinding.manage -- ONE ADMIN_ACTION capability granted to nobody.
  //   1764122400000 (L3): the Transfer-on-EOS storage support -- an enum value, a counter table, an index; no capability.
  //   1764126000000 (L3, DQ-038): the bin placement authority -- one eos_ops table, no capability.
  //   1764129600000 (L3, DQ-036(b)): inventory.serializedAsset.acquire -- ONE BUSINESS_ACTION capability granted to
  //   nobody (Administration-grant-only), plus its provenance table.
  // 70 -> 71 (lane IDENTITY, Controller ruling 2026-09-29): 1764200000000 eos_policy.principal_identities -- the additive
  // EOS identity binding table; no capability, no READ key, not a read-enforcement change.
  // 71 -> 72 (the Work Order domain cutover, 2026-09-30): 1764300000000 the Work Order execution facts +
  // workOrder.execution.record, registered with no grant.
  // 72 -> 76: the Work Order cutover completion pass (2026-09-30): quarantine 1764310000000, availability 1764320000000, labor 1764330000000 (+workOrder.labor.correctEntry), inbound work 1764340000000 (+5 inboundWork.* capabilities) -- every new capability granted to NO Role.
  // 76 -> 79: the Service Experience completion (2026-09-30): provider runtime 1764350000000 (schema), recovery 1764360000000 (+inboundWork.request.recover), self-scheduling 1764370000000 (+workOrder.selfScheduling.issue/.configure) -- every new capability granted to NO Role.
  // 79 -> 80: the Parts / Purchasing / Receiving completion (2026-10-01): 1764380000000 -- Reorder create idempotency, the
  // one-open-demand index, RR numbering, and two capabilities granted to NO Role (warehouse.record.manage, configuration;
  // supplier.record.read, a business READ -- not an Administration surface key, so the read gate is unchanged).
  // 80 -> 81: the Inventory / Warehouse completion (2026-10-01): 1764390000000 -- the inventory baseline cutover certification
  // (schema; the fail-closed gate the activated Inventory writers read). No capability, no grant.
  // 81 -> 82: the Equipment activation (2026-10-01): 1764400000000 -- equipment.record.read + equipment.record.manage (granted to
  // NO Role), equipment.version and the append-only equipment_events history.
  // 82 -> 83: the Truck Inventory activation (2026-10-01): 1764410000000 -- inventory.catalog.alias.read + inventory.truckRegistry.manage (granted to NO Role), MOBILE operational scope, receipt-into-MOBILE CHECK.
  // 83 -> 84: the Finance foundation (2026-10-01): 1764420000000 -- counterparties, company profiles, immutable financial facts, obligations, cost-evidence exceptions, accounting destinations; FINANCING_PROVIDER relationship; supplier -> organization link; no capability, no grant.
  // 84 -> 85: Finance Activation 1 completion (2026-10-01, DECISIONS #193): 1764430000000 -- explicit PO supplier identity, receiving_corrections, missing-cost exception resolutions; inventory.receipt.correct granted to NO Role.
  // 85 -> 86: Commercial Finance activation (2026-10-02, DECISIONS #195): 1764440000000 -- sales_order_fulfillments (append-only) + derived fulfillment / billing-eligibility views; no capability, no grant.
  // 86 -> 87: Operational Billing Package (2026-10-02, DECISIONS #196): 1764450000000 -- eos_finance.billing_packages + billing_package_lines (immutable content); no capability, no grant.
  // 87 -> 88: Finance Activation 2 (2026-10-02, DECISIONS #197): 1764460000000 -- Agreement tax evidence, one receivable per billing package, accounting_handoffs; no capability, no grant.
  assert.equal(migrations.length, 88, "a migration was added or removed by the read enforcement");
  assert.equal(migrations.filter((f) => f.startsWith("1762300800000")).length, 1,
    "the authority activation vehicle must be present exactly once");
  assert.equal(migrations.filter((f) => f.startsWith("1762646400000")).length, 1,
    "the Administration control plane migration must be present exactly once");

  // Every capability the gate can require was ALREADY registered by a migration. The gate requires
  // keys; it does not create them, and a key it required that nothing registers would be a surface
  // nobody could ever open -- which would look exactly like a denial.
  const registered = new Set();
  for (const file of migrations) {
    const up = readFileSync(resolve(FUNCTIONS_DIR, "migrations", file), "utf8")
      .split("-- Down Migration")[0].replace(/^\s*--.*$/gm, "");
    for (const stmt of up.split(";")) {
      if (!/INSERT\s+INTO\s+capabilities/i.test(stmt)) continue;
      for (const m of stmt.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g)) registered.add(m[1]);
    }
  }
  assert.ok(registered.size >= 20, `the scan found only ${registered.size} capabilities -- it has stopped matching`);
  for (const key of new Set(Object.values(ADMIN_READ_CAPABILITY))) {
    assert.equal(registered.has(key), true, `the gate requires "${key}", which no migration registers`);
  }

  // THE ENFORCEMENT POINT WRITES NOTHING. It reads the repository and refuses; it cannot grant, and
  // an implementation that "helpfully" granted the missing key on the way past would be the exact
  // inverse of this feature.
  const source = readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/adminPolicyApi.ts"), "utf8");
  const gate = source.slice(source.indexOf("async function requireAdminReadAuthority"));
  const body = gate.slice(0, gate.indexOf("\nasync function dispatch"));
  for (const forbidden of ["grantRoleCapability", "grantPrincipalCapability", "INSERT", "transact"]) {
    assert.equal(body.includes(forbidden), false, `the read gate performs "${forbidden}"`);
  }
});

// ════════════════════ H. AND IT CANNOT BE REWRITTEN WITH FIREBASE ════════════════════
//
// Proved in adminPolicyNoFirebase.test.mjs, where the policy subsystem's Firebase regression guard
// already lives -- "the read gate resolves from the policy store, never from an identity claim".
// It is there rather than here because a SECOND place answering "may this subsystem read Firebase"
// is exactly the duplication that guard exists to prevent.

// ════════════════════ B–F, I. AGAINST POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("the Administration read gate, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");
  const { bootstrapTenant, bootstrapAdministrator, ensureTenantPrincipal } =
    require("../lib/adminPolicy/tenantBootstrap.js");
  const { resolvePrincipalContext } = require("../lib/adminPolicy/principalContext.js");
  const commands = require("../lib/adminPolicy/policyCommands.js");

  const OPERATOR = "operator-under-test";
  const ADMIN_SUBJECT = "firebase-uid-readgate-admin";

  const name = `readgate_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  const dbUrl = dbUrlFor(name);
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrl, max: 6 });
  const repo = new PostgresPolicyRepository(pool);

  const { tenant } = await bootstrapTenant(repo, { key: "taylor-readgate", name: "Taylor", actorUid: OPERATOR });
  await bootstrapAdministrator(repo, {
    tenantId: tenant.id, externalSubject: ADMIN_SUBJECT, displayName: "The Administrator",
    performedBy: OPERATOR, reason: "initial administrator",
  });
  const adminContext = await resolvePrincipalContext(repo, { externalSubject: ADMIN_SUBJECT });
  const admin = { tenantId: tenant.id, uid: adminContext.uid, heldRoleKeys: adminContext.heldRoleKeys };

  // THE GRANT-BEARING MIGRATIONS RESOLVED NOTHING HERE. 1762041600000 and 1762128000000 grant by
  // Role KEY, and they ran against a database with no tenant and therefore no Roles; the seed wrote
  // the Roles afterwards. So the administrator starts, correctly, holding no capability at all --
  // which is the cleanest possible starting point for a test about who may read.
  const grantToRole = (roleKey, objectKey) => commands.grantObjectActionToRole(repo, admin,
    { roleKey, objectKey, actionKey: "read", reason: "read gate proof" });
  const OBJECT_OF = Object.freeze({
    [SECURITY_POLICY_READ]: "rolesPermissions",
    [PRINCIPAL_ACCESS_READ]: "principal",
    [WORKFLOW_READ]: "workflowDefinition",
    [AUDIT_READ]: "auditLog",
  });

  /** Somebody who really is here: ACTIVE Principal, ACTIVE membership, an ACTIVE Role assignment. */
  async function persona(subject, roleKey, roleName) {
    const principal = await ensureTenantPrincipal(repo, {
      tenantId: tenant.id, externalSubject: subject, actorUid: admin.uid,
      actorRoleKeys: admin.heldRoleKeys, reason: `read gate persona ${subject}`,
    });
    const role = (await repo.getRoleByKey(tenant.id, roleKey))
      ?? await commands.createRole(repo, admin, { key: roleKey, name: roleName, reason: "read gate proof" });
    await commands.assignRole(repo, admin, {
      principalId: principal.id, roleId: role.id, reason: "read gate proof",
    });
    return { principal, role, subject };
  }

  const call = (subject, operation, input) => executeAdminOperation({ repo }, {
    caller: { externalSubject: subject }, operation, input: input ?? INPUT_FOR[operation] ?? {},
  });

  const assertRefused = async (subject, operation, required) => {
    const result = await call(subject, operation);
    assert.equal(result.ok, false, `${operation} was ANSWERED for a principal who may not read it`);
    assert.equal(result.code, "FORBIDDEN", `${operation} refused with ${result.code}, not FORBIDDEN`);
    assert.match(result.message, new RegExp(required.replace(/\./g, "\\.")),
      "the refusal names the capability that was missing");
    assert.equal("data" in result, false, `${operation} returned data with its refusal`);
  };

  const assertAllowed = async (subject, operation) => {
    const result = await call(subject, operation);
    assert.equal(result.ok, true,
      `${operation} was refused for a holder: ${result.ok ? "" : result.message}`);
    assert.equal(result.tenantId, tenant.id);
    return result.data;
  };

  // ════════════════════ THE PEOPLE ════════════════════

  // Holds the security policy read, and nothing else.
  const reader = await persona("firebase-uid-readgate-reader", "securityPolicyReader", "Security Policy Reader");
  await grantToRole("securityPolicyReader", OBJECT_OF[SECURITY_POLICY_READ]);

  // A REAL, FULLY VALID PRINCIPAL WHO HOLDS NO ADMINISTRATION READ. Not disabled, not a stranger,
  // not a member of another tenant: this is the principal the old posture answered everything for.
  const bare = await persona("firebase-uid-readgate-bare", "shopFloor", "Shop Floor");
  await commands.grantObjectActionToRole(repo, admin,
    { roleKey: "shopFloor", objectKey: "workOrder", actionKey: "dispatch", reason: "an unrelated grant" });

  // Everything, so the positive path and the transport have somebody to answer. Written as SYSTEM
  // DEFAULT rows (fixture): an administrator may not widen a Role it holds (Pass 8 D5a).
  for (const key of [SECURITY_POLICY_READ, PRINCIPAL_ACCESS_READ, WORKFLOW_READ, AUDIT_READ]) {
    await pool.query(`INSERT INTO eos_policy.role_capabilities (id,tenant_id,role_id,capability_id,granted_by,created_by,updated_by)
      SELECT 'rc-fx-' || md5($1 || c.id), $1, r.id, c.id, 'fixture','fixture','fixture'
        FROM eos_policy.roles r, eos_policy.capabilities c WHERE r.tenant_id=$1 AND r.key='admin' AND c.key=$2
      ON CONFLICT DO NOTHING`, [tenant.id, key]);
  }

  await t.test("the fixture is honest: the bare principal really is authenticated and ACTIVE", async () => {
    const context = await resolvePrincipalContext(repo, { externalSubject: bare.subject });
    assert.equal(context.tenantId, tenant.id, "they resolve to a context in this tenant");
    assert.deepEqual([...context.heldRoleKeys], ["shopFloor"], "with an ACTIVE Role assignment");
    const principal = await repo.getPrincipal(context.uid);
    assert.equal(principal.status, "active");
    assert.equal((await repo.getMembership(tenant.id, context.uid)).status, "active");
    // And they DO hold a capability -- just not one of the four. A persona holding nothing at all
    // would make every refusal below true for a weaker reason.
    const held = await repo.listRoleCapabilities(tenant.id, [bare.role.id]);
    assert.equal(held.length, 1, "the bare persona holds exactly one, unrelated, capability");
  });

  // ════════════════════ B. admin.securityPolicy.read ════════════════════

  await t.test("B: the security policy reads answer a HOLDER and refuse everybody else", async () => {
    const governed = operationsRequiring(SECURITY_POLICY_READ);
    assert.deepEqual(governed, [
      "getObjectActionGrantMatrix", "getObjectSecurityMatrix", "getRoleSecurity", "getSecurityRoleDetail",
      "listObjects", "listObjectsWithActions", "listRoleCapabilityDecisionHistory", "listRoles",
      "listSupportedConditionKinds", "readObjectWithFields", "readRolePolicy",
    ], "the population of security-policy reads changed");

    for (const operation of governed) {
      // readRolePolicy needs a Role id, which only a holder can obtain.
      const input = operation === "readRolePolicy"
        ? { roleId: (await repo.listRoles(tenant.id))[0].id } : undefined;
      const allowed = await executeAdminOperation({ repo }, {
        caller: { externalSubject: reader.subject }, operation, input: input ?? INPUT_FOR[operation] ?? {},
      });
      assert.equal(allowed.ok, true, `${operation} refused a holder: ${allowed.ok ? "" : allowed.message}`);
      await assertRefused(bare.subject, operation, SECURITY_POLICY_READ);
    }
  });

  await t.test("B: the refusal is about AUTHORITY, and says nothing about the tenant's data", async () => {
    const refused = await call(bare.subject, "listObjects");
    // Not 404 and not 500: a caller must not be able to tell "you may not" from "it is not there",
    // and a denial must never read as an outage.
    assert.equal(refused.code, "FORBIDDEN");
    const text = JSON.stringify(refused);
    for (const leak of ["account", "workOrder", "dispatcher", tenant.id, "eos_policy", "SELECT"]) {
      assert.equal(text.includes(leak), false, `the refusal leaked "${leak}"`);
    }
  });

  // ════════════════════ C. admin.principalAccess.read ════════════════════

  await t.test("C: without admin.principalAccess.read, the three principal reads are refused", async () => {
    assert.deepEqual(operationsRequiring(PRINCIPAL_ACCESS_READ),
      ["explainEffectiveAccess", "getPrincipalEffectiveAccess", "listPrincipalRoleAssignments",
        "listPrincipalWorkflowResponsibilities", "listSupportedAssignmentScopes", "listTenantPrincipals"]);
    // THE READER HOLDS admin.securityPolicy.read AND IS STILL REFUSED. One Administration read is
    // not a key to the others; if it were, the four capabilities would be one capability.
    for (const subject of [reader.subject, bare.subject]) {
      await assertRefused(subject, "listTenantPrincipals", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "listPrincipalRoleAssignments", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "getPrincipalEffectiveAccess", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "explainEffectiveAccess", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "listSupportedAssignmentScopes", PRINCIPAL_ACCESS_READ);
    }
    // Including when the principal they ask about is THEMSELVES. "It is my own access" is not an
    // authority, and a self-exemption is how a read gate acquires its first bypass.
    const own = await call(reader.subject, "getPrincipalEffectiveAccess", { principalId: reader.principal.id });
    assert.equal(own.code, "FORBIDDEN", "a principal read their own effective access without the capability");
  });

  // ════════════════════ D. audit.event.read ════════════════════

  await t.test("D: the audit history is refused by the SERVER, not hidden by a client", async () => {
    await assertRefused(bare.subject, "readPolicyAuditHistory", AUDIT_READ);
    await assertRefused(reader.subject, "readPolicyAuditHistory", AUDIT_READ);
    // There IS an audit history to withhold -- every grant above wrote one. A refusal that happened
    // to sit in front of an empty table would prove nothing.
    const { rows } = await pool.query(
      "SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1", [tenant.id]);
    assert.ok(rows[0].n > 0, "the fixture wrote no audit events, so the refusal is vacuous");
    // And the refusal carries none of them.
    const refused = await call(bare.subject, "readPolicyAuditHistory");
    assert.equal(JSON.stringify(refused).includes("grantObjectActionToRole"), false,
      "a refused audit read still returned an audit event");
  });

  // ════════════════════ E. workflowDefinition.read ════════════════════

  await t.test("E: the workflow reads are refused without workflowDefinition.read", async () => {
    assert.deepEqual(operationsRequiring(WORKFLOW_READ),
      ["listWorkflowInstances", "listWorkflows", "readWorkflowHistory", "readWorkflowVersion", "validateWorkflowVersion"]);
    await assertRefused(bare.subject, "listWorkflows", WORKFLOW_READ);
    await assertRefused(reader.subject, "listWorkflows", WORKFLOW_READ);
    // REFUSED BEFORE THE INPUT IS EVEN PARSED. A bogus versionId still answers FORBIDDEN rather
    // than INVALID_INPUT or NOT_FOUND -- so a caller cannot probe which version ids exist by
    // reading the shape of the error they get back.
    const probe = await call(bare.subject, "readWorkflowVersion", { versionId: "00000000-0000-0000-0000-000000000000" });
    assert.equal(probe.code, "FORBIDDEN");
    const malformed = await call(bare.subject, "readWorkflowVersion", {});
    assert.equal(malformed.code, "FORBIDDEN", "a missing versionId leaked INVALID_INPUT to an unauthorized caller");

    // And a holder gets the real answer.
    const workflows = await assertAllowed(ADMIN_SUBJECT, "listWorkflows");
    assert.ok(Array.isArray(workflows) && workflows.length > 0, "the seed created workflows");
    const versionId = workflows[0].versions[0].id;
    const view = await call(ADMIN_SUBJECT, "readWorkflowVersion", { versionId });
    assert.equal(view.ok, true, view.ok ? "" : view.message);
  });

  // ════════════════════ F. THE DIRECT GRANT — the one that catches the Role-key trap ═══════════

  await t.test("F: a DIRECT principal_capabilities grant is sufficient, with no Role carrying it", async () => {
    const direct = await persona("firebase-uid-readgate-direct", "noAdminReads", "No Administration Reads");

    // Before: refused, exactly like anybody else.
    await assertRefused(direct.subject, "listTenantPrincipals", PRINCIPAL_ACCESS_READ);

    // The governed command, not a hand-written INSERT: this is the act an administrator performs on
    // the Users screen, and it is the only thing that changes between the refusal above and the
    // answer below.
    const grant = await commands.grantObjectActionToPrincipal(repo, admin, {
      objectKey: OBJECT_OF[PRINCIPAL_ACCESS_READ], actionKey: "read",
      principalId: direct.principal.id, reason: "direct grant proof",
    });
    assert.ok(grant.id);

    // ════════ NO ROLE OF THEIRS CARRIES IT — measured, not assumed ════════
    const context = await resolvePrincipalContext(repo, { externalSubject: direct.subject });
    assert.deepEqual([...context.heldRoleKeys], ["noAdminReads"], "they hold exactly one Role");
    const { rows: viaRole } = await pool.query(
      `SELECT c.key FROM eos_policy.role_capabilities rc
         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
         JOIN eos_policy.roles r        ON r.id = rc.role_id
        WHERE rc.tenant_id = $1 AND r.key = ANY($2::text[])`,
      [tenant.id, [...context.heldRoleKeys]]);
    assert.deepEqual(viaRole.map((r) => r.key), [],
      "the direct-grant persona's Role carries a capability, which would make this test vacuous");
    const { rows: viaPrincipal } = await pool.query(
      `SELECT c.key FROM eos_policy.principal_capabilities pc
         JOIN eos_policy.capabilities c ON c.id = pc.capability_id
        WHERE pc.tenant_id = $1 AND pc.principal_id = $2`, [tenant.id, direct.principal.id]);
    assert.deepEqual(viaPrincipal.map((r) => r.key), [PRINCIPAL_ACCESS_READ],
      "the ONLY source of this authority is the direct grant");

    // ════════ AND ALL THREE READS NOW ANSWER ════════
    //
    // THIS IS THE ASSERTION THAT FAILS if the gate is ever rewritten against
    // `AdminActor.heldRoleKeys`. It would still compile, and every other test in this file would
    // still pass, because every other persona was granted through a Role.
    for (const operation of operationsRequiring(PRINCIPAL_ACCESS_READ)) {
      const input = operation === "listTenantPrincipals" ? {} : { principalId: direct.principal.id };
      const result = await executeAdminOperation({ repo }, {
        caller: { externalSubject: direct.subject }, operation, input,
      });
      // explainEffectiveAccess needs the server-composed evaluator, absent here: the GATE admitted the
      // caller (not FORBIDDEN) and the read then refuses as uncomposed. Its answer is proved in
      // effectiveAccessExplanationPostgres.
      if (operation === "explainEffectiveAccess" || operation === "listPrincipalWorkflowResponsibilities") {
        assert.notEqual(result.code, "FORBIDDEN", operation); continue;
      }
      assert.equal(result.ok, true,
        `${operation} ignored a direct principal_capabilities grant: ${result.ok ? "" : result.message}`);
    }

    // AND NOT ONE STEP FURTHER. A direct grant of one key opens that key's reads and no others.
    await assertRefused(direct.subject, "listObjects", SECURITY_POLICY_READ);
    await assertRefused(direct.subject, "readPolicyAuditHistory", AUDIT_READ);
    await assertRefused(direct.subject, "listWorkflows", WORKFLOW_READ);

    // A REVOKED DIRECT GRANT SHUTS THE DOOR AGAIN -- the union is re-resolved per request, never
    // cached into something that outlives the row it came from.
    await commands.revokeObjectActionFromPrincipal(repo, admin, {
      objectKey: OBJECT_OF[PRINCIPAL_ACCESS_READ], actionKey: "read",
      principalId: direct.principal.id, reason: "withdrawn",
    });
    await assertRefused(direct.subject, "listTenantPrincipals", PRINCIPAL_ACCESS_READ);
  });

  await t.test("F: a STALE Role assignment carries no read either", async () => {
    // The union is over ACTIVE assignments. A revoked Role that still had a row would be authority
    // nobody believes they granted.
    const stale = await persona("firebase-uid-readgate-stale", "temporaryReader", "Temporary Reader");
    await grantToRole("temporaryReader", OBJECT_OF[SECURITY_POLICY_READ]);
    await assertAllowed(stale.subject, "listObjects");

    const held = await repo.listAssignmentsForPrincipal(tenant.id, stale.principal.id);
    const assignment = held.find((a) => a.roleId === stale.role.id && a.status === "active");
    await commands.revokeRole(repo, admin, { assignmentId: assignment.id, reason: "the loan ended" });
    await assertRefused(stale.subject, "listObjects", SECURITY_POLICY_READ);
  });

  // ════════════════════ G. AND NOTHING WIDENED ════════════════════

  await t.test("G: refusing and answering wrote no grant, no assignment and no capability", async () => {
    const census = async () => {
      const { rows } = await pool.query(`
        SELECT (SELECT count(*) FROM eos_policy.capabilities)           AS capabilities,
               (SELECT count(*) FROM eos_policy.role_capabilities)      AS role_capabilities,
               (SELECT count(*) FROM eos_policy.principal_capabilities) AS principal_capabilities,
               (SELECT count(*) FROM eos_policy.user_role_assignments)       AS assignments`);
      return rows[0];
    };
    const before = await census();
    // Every read in the map, refused for the bare principal and answered for the administrator.
    for (const operation of ADMIN_READ_OPERATIONS) {
      await call(bare.subject, operation);
      await call(ADMIN_SUBJECT, operation);
    }
    assert.deepEqual(await census(), before,
      "running the read gate changed the access model -- it must only ever read it");
  });

  // ════════════════════ I. THROUGH THE REAL TRANSPORT ════════════════════

  await t.test("I: over HTTP, a holder gets 200 and a non-holder gets 403 FORBIDDEN", async () => {
    const post = (subject, operation, input) => handleAdminRequest(
      { repo, verifyToken: async () => ({ externalSubject: subject, identityProvider: "firebase" }) },
      {
        method: "POST", url: "/admin/policy",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ operation, input: input ?? INPUT_FOR[operation] ?? {} }),
      },
    );

    const firstWorkflow = (await repo.listWorkflows(tenant.id))[0];
    const firstVersionId = (await repo.listWorkflowVersions(tenant.id, firstWorkflow.id))[0].id;
    for (const operation of ADMIN_READ_OPERATIONS) {
      const input = operation === "readRolePolicy" ? { roleId: (await repo.listRoles(tenant.id))[0].id }
        : ["listPrincipalRoleAssignments", "getPrincipalEffectiveAccess", "explainEffectiveAccess",
          "listPrincipalWorkflowResponsibilities"].includes(operation)
          ? { principalId: adminContext.uid }
          : ["readWorkflowVersion", "validateWorkflowVersion", "listWorkflowInstances"].includes(operation)
            ? { versionId: firstVersionId }
            : operation === "readWorkflowHistory" ? { workflowId: firstWorkflow.id }
              : undefined;

      const allowed = await post(ADMIN_SUBJECT, operation, input);
      if (operation === "explainEffectiveAccess" || operation === "listPrincipalWorkflowResponsibilities") {
        // The gate admits the holder; the read then needs the server-composed evaluator, which this
        // transport fixture does not compose (proved end to end in effectiveAccessExplanationPostgres).
        assert.notEqual(allowed.status, 403, `${operation} as a holder: ${allowed.body}`);
      } else {
        assert.equal(allowed.status, 200, `${operation} as a holder: ${allowed.body}`);
        assert.equal(JSON.parse(allowed.body).ok, true);
      }

      const refused = await post(bare.subject, operation, input);
      assert.equal(refused.status, 403, `${operation} as a non-holder returned ${refused.status}`);
      const body = JSON.parse(refused.body);
      assert.equal(body.ok, false);
      assert.equal(body.code, "FORBIDDEN");
      assert.equal(body.operation, operation);
      assert.equal("data" in body, false);
      // And the transport still refuses to cache a policy answer, refusal or not.
      assert.equal(refused.headers["cache-control"], "no-store");
    }
  });

  await t.test("I: an unauthenticated caller is still 401; a verified subject EOS does not know is 403 with its own message", async () => {
    // No token / an unverifiable token is AUTHENTICATION: 401. A VERIFIED subject with no EOS Principal is an
    // AUTHORITY fact and is 403 FORBIDDEN, as on the Operations, Commercial, CRM and Workforce transports (Controller
    // XLF-003, 2026-09-28). The two stay distinguishable by status AND message: an expired token never looks like a
    // provisioning problem.
    const noToken = await handleAdminRequest(
      { repo, verifyToken: async () => { throw new Error("nope"); } },
      { method: "POST", url: "/admin/policy", headers: {}, body: JSON.stringify({ operation: "listObjects" }) },
    );
    assert.equal(noToken.status, 401);
    const stranger = await call("firebase-uid-nobody-at-all", "listObjects");
    assert.equal(stranger.code, "FORBIDDEN", "a verified identity EOS does not know is refused as authority");
    assert.equal(stranger.message, "this identity is not known to EOS");
  });
});
