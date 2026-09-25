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
});

const operationsRequiring = (capability) =>
  Object.entries(CANONICAL_MAP).filter(([, key]) => key === capability).map(([op]) => op).sort();

/** Enough input for each read to reach its own body, so a PASS is never a validation accident. */
const INPUT_FOR = Object.freeze({
  readObjectWithFields: { objectKey: "account" },
  getObjectSecurityMatrix: { objectKey: "workOrder" },
  getRoleSecurity: { roleKey: "dispatcher" },
  readPolicyAuditHistory: { limit: 5 },
});

// ════════════════════ A. THE MAP IS CLOSED — no database needed ════════════════════

test("A: thirteen reads, each with EXACTLY ONE capability, and the map is the Owner's", () => {
  assert.equal(ADMIN_READ_OPERATIONS.length, 13, "the read list changed size without this map changing");
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
  assert.equal(migrations.length, 51, "a migration was added or removed by the read enforcement");
  assert.equal(migrations.filter((f) => f.startsWith("1762300800000")).length, 1,
    "the one migration beyond this lane's 50 must be the authority activation vehicle and nothing else");

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

  // Everything, so the positive path and the transport have somebody to answer.
  for (const key of [SECURITY_POLICY_READ, PRINCIPAL_ACCESS_READ, WORKFLOW_READ, AUDIT_READ]) {
    await grantToRole("admin", OBJECT_OF[key]);
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
      "getObjectSecurityMatrix", "getRoleSecurity", "listObjects", "listObjectsWithActions",
      "listRoles", "readObjectWithFields", "readRolePolicy",
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
      ["getPrincipalEffectiveAccess", "listPrincipalRoleAssignments", "listTenantPrincipals"]);
    // THE READER HOLDS admin.securityPolicy.read AND IS STILL REFUSED. One Administration read is
    // not a key to the others; if it were, the four capabilities would be one capability.
    for (const subject of [reader.subject, bare.subject]) {
      await assertRefused(subject, "listTenantPrincipals", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "listPrincipalRoleAssignments", PRINCIPAL_ACCESS_READ);
      await assertRefused(subject, "getPrincipalEffectiveAccess", PRINCIPAL_ACCESS_READ);
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
    assert.deepEqual(operationsRequiring(WORKFLOW_READ), ["listWorkflows", "readWorkflowVersion"]);
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

    for (const operation of ADMIN_READ_OPERATIONS) {
      const input = operation === "readRolePolicy" ? { roleId: (await repo.listRoles(tenant.id))[0].id }
        : operation === "listPrincipalRoleAssignments" || operation === "getPrincipalEffectiveAccess"
          ? { principalId: adminContext.uid }
          : operation === "readWorkflowVersion"
            ? { versionId: (await repo.listWorkflowVersions(tenant.id,
              (await repo.listWorkflows(tenant.id))[0].id))[0].id }
            : undefined;

      const allowed = await post(ADMIN_SUBJECT, operation, input);
      assert.equal(allowed.status, 200, `${operation} as a holder: ${allowed.body}`);
      assert.equal(JSON.parse(allowed.body).ok, true);

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

  await t.test("I: an unauthenticated caller is still 401, never 403", async () => {
    // The two refusals stay distinguishable. Collapsing them would make an expired token look like
    // a permissions problem, and every support conversation about it would start in the wrong place.
    const noToken = await handleAdminRequest(
      { repo, verifyToken: async () => { throw new Error("nope"); } },
      { method: "POST", url: "/admin/policy", headers: {}, body: JSON.stringify({ operation: "listObjects" }) },
    );
    assert.equal(noToken.status, 401);
    const stranger = await call("firebase-uid-nobody-at-all", "listObjects");
    assert.equal(stranger.code, "UNAUTHENTICATED", "EOS does not know this identity");
  });
});
