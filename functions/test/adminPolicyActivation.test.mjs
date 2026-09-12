// NON-PRODUCTION ACTIVATION — the end-to-end proofs, against a REAL PostgreSQL database.
//
// ════════════════════ WHAT THIS FILE IS FOR ════════════════════
//
// The foundation proved that the policy model is correct. This proves that it OPERATES: a tenant
// that something created, an administrator something granted, mutations that went through the
// trusted API and survived the process that made them.
//
// EVERY TEST HERE TALKS TO POSTGRESQL. The in-memory adapter is deliberately not used, because the
// single most likely way for this tranche to be wrong is for the in-memory adapter to quietly
// remain the operational source -- everything would pass and nothing would persist. The restart
// proof at the bottom exists for exactly that failure.
import test from "node:test";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig, checkPolicyDatabaseHealth } from "../lib/adminPolicy/policyDatabase.js";
import { bootstrapAdministrator, bootstrapTenant, ensureTenantPrincipal } from "../lib/adminPolicy/tenantBootstrap.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import { resolvePrincipalContext } from "../lib/adminPolicy/principalContext.js";
import { handleAdminRequest } from "../lib/adminPolicy/adminPolicyHttp.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TAYLOR = { key: "taylor-nonprod", name: "Taylor Freezer of Arizona" };
const OTHER = { key: "other-nonprod", name: "Another Tenant" };
const OPERATOR = "operator-under-test";

const ADMIN_SUBJECT = "firebase-uid-admin";
const OWNER_SUBJECT = "firebase-uid-owner";
const GM_SUBJECT = "firebase-uid-gm";
const PLAIN_SUBJECT = "firebase-uid-plain";

let pool = null;

function repo() {
  pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 4 }));
  return new PostgresPolicyRepository(pool);
}

/** A brand-new database, migrated from nothing. Every test starts from the same known state. */
async function resetDatabase() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS eos_policy CASCADE");
  // eos_ops (migration 005) is a sibling schema in the same database and must be dropped too, or a
  // repeat migrateFromClean() in the same job fails with "already exists".
  await client.query("DROP SCHEMA IF EXISTS eos_ops CASCADE");
  // EVERY schema the migrations create, not only the two that existed when this reset was written.
  // A surviving schema plus a dropped `pgmigrations` makes the next `up` re-run a migration against
  // tables that are still there, and it fails. Two lanes hit this independently (eos_crm from the
  // CRM migration, eos_commercial from the commercial one) and each added only its own; the union is
  // what is correct, and `declaredSchemas()` keeps it correct for the next one without another edit.
  for (const schema of declaredSchemas()) {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

/**
 * A fully stood-up Taylor tenant: seeded, with an administrator and three other principals.
 *
 * The three others exist because most of what is worth proving is a REFUSAL, and a refusal needs
 * somebody to refuse.
 */
async function standUpTaylor() {
  await resetDatabase();
  const r = repo();

  const { tenant, seed } = await bootstrapTenant(r, { ...TAYLOR, actorUid: OPERATOR });
  const admin = await bootstrapAdministrator(r, {
    tenantId: tenant.id,
    externalSubject: ADMIN_SUBJECT,
    displayName: "The Administrator",
    performedBy: OPERATOR,
    reason: "initial administrator",
  });

  const adminContext = await resolvePrincipalContext(r, { externalSubject: ADMIN_SUBJECT });
  const actorRoleKeys = adminContext.heldRoleKeys;

  const others = {};
  for (const [name, subject] of [["owner", OWNER_SUBJECT], ["gm", GM_SUBJECT], ["plain", PLAIN_SUBJECT]]) {
    others[name] = await ensureTenantPrincipal(r, {
      tenantId: tenant.id,
      externalSubject: subject,
      actorUid: adminContext.uid,
      actorRoleKeys,
    });
  }

  return { repo: r, tenant, seed, admin, adminContext, others };
}

const asAdmin = (operation, input) => ({ caller: { externalSubject: ADMIN_SUBJECT }, operation, input });
const asSubject = (subject, operation, input) => ({ caller: { externalSubject: subject }, operation, input });

/** Grant a Role by key, through the trusted API, as the administrator. */
async function grant(r, subject, roleKey) {
  const roles = await r.listRoles((await resolvePrincipalContext(r, { externalSubject: ADMIN_SUBJECT })).tenantId);
  const role = roles.find((x) => x.key === roleKey);
  assert.ok(role, `the seed created a "${roleKey}" role`);
  const principal = await r.getPrincipalBySubject("firebase", subject);
  const result = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
    principalId: principal.id, roleId: role.id,
  }));
  assert.equal(result.ok, true, `assigning ${roleKey}: ${result.ok ? "" : result.message}`);
  return result.data;
}

/** A direct SQL read, for asserting what is actually in the table rather than what a read returns. */
async function query(text, values = []) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

test.after(async () => {
  if (pool) await pool.end();
});

// ============================ TENANT ============================

test("bootstrap creates the Taylor tenant once, and a rerun changes nothing", { skip: SKIP }, async () => {
  await resetDatabase();
  const r = repo();

  const first = await bootstrapTenant(r, { ...TAYLOR, actorUid: OPERATOR });
  assert.equal(first.created, true, "the first run creates it");
  assert.equal(first.tenant.key, TAYLOR.key);
  assert.equal(first.tenant.status, "active");
  assert.equal(first.seed.alreadySeeded, false, "and seeds it");

  // The measured model, arriving in a real database.
  assert.equal(first.seed.created.objects, 37, "37 canonical objects");
  assert.equal(first.seed.created.fields, 394, "394 canonical fields");
  assert.ok(first.seed.created.roles >= 43, "the governed business roles, and the compatibility ones");
  assert.equal(first.seed.created.workflows, 5, "5 versioned state machines");
  assert.equal(first.seed.created.workflowVersions, 5);

  const second = await bootstrapTenant(r, { ...TAYLOR, actorUid: OPERATOR });
  assert.equal(second.created, false, "the second run finds it");
  assert.equal(second.tenant.id, first.tenant.id, "the same tenant, by key");
  assert.equal(second.seed.alreadySeeded, true, "and creates nothing");
  assert.equal(second.seed.created.objects, 0);
  assert.equal(second.seed.created.fields, 0);

  const objects = await r.listObjects(first.tenant.id);
  assert.equal(objects.length, 37, "still 37 after the rerun, not 74");
});

test("the seeded configuration version is recorded on the tenant", { skip: SKIP }, async () => {
  await resetDatabase();
  const r = repo();
  const { tenant, seed } = await bootstrapTenant(r, { ...TAYLOR, actorUid: OPERATOR });
  const reloaded = await r.getTenant(tenant.id);
  assert.equal(reloaded.configurationVersion, seed.seedVersion, "which seed produced this tenant is answerable");
});

test("TENANT ISOLATION: one tenant can neither read nor mutate another's policy", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const other = await bootstrapTenant(r, { ...OTHER, actorUid: OPERATOR });
  const otherAdmin = await bootstrapAdministrator(r, {
    tenantId: other.tenant.id,
    externalSubject: "firebase-uid-other-admin",
    performedBy: OPERATOR,
  });

  // READ. Taylor's administrator asks for the objects they can see, and gets Taylor's.
  const mine = await executeAdminOperation({ repo: r }, asAdmin("listObjects", {}));
  assert.equal(mine.ok, true);
  assert.equal(mine.tenantId, tenant.id, "resolved from membership, not from anything sent");

  // The other tenant's Role ids are not visible, and are not usable.
  const otherRoles = await r.listRoles(other.tenant.id);
  const otherRoleId = otherRoles[0].id;
  const readOther = await executeAdminOperation({ repo: r }, asAdmin("readRolePolicy", { roleId: otherRoleId }));
  assert.equal(readOther.ok, false, "another tenant's role is not readable");
  assert.equal(readOther.code, "NOT_FOUND", "and reports the same as a role that does not exist");

  // MUTATE. Taylor's administrator cannot set permissions on the other tenant's Role.
  const objects = await r.listObjects(tenant.id);
  const mutateOther = await executeAdminOperation({ repo: r }, asAdmin("setObjectPermission", {
    roleId: otherRoleId, objectKey: objects[0].key, cred: { C: true, R: true, E: true, D: false },
  }));
  assert.equal(mutateOther.ok, false, "and cannot write to it");

  // And nothing landed in the other tenant.
  const otherPerms = await r.listObjectPermissions(other.tenant.id, [otherRoleId]);
  assert.equal(otherPerms.filter((p) => p.updatedBy !== OPERATOR).length, 0, "no foreign write reached tenant B");
  assert.ok(otherAdmin.bootstrap.tenantId === other.tenant.id);
});

test("A SPOOFED TENANT ID IS REFUSED, not silently narrowed", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();
  const other = await bootstrapTenant(r, { ...OTHER, actorUid: OPERATOR });

  const spoofed = await executeAdminOperation({ repo: r }, {
    caller: { externalSubject: ADMIN_SUBJECT, requestedTenantId: other.tenant.id },
    operation: "listObjects",
  });

  // REFUSED. Falling back to the caller's own tenant would make a spoofed id look like it worked,
  // which is the difference between an attacker learning nothing and learning the id was wrong.
  assert.equal(spoofed.ok, false);
  assert.equal(spoofed.code, "FORBIDDEN");
  assert.match(spoofed.message, /not a member/i);
});

// ============================ BOOTSTRAP ADMINISTRATOR ============================

test("the administrator bootstrap is ONE-TIME, and does not overwrite", { skip: SKIP }, async () => {
  const { repo: r, tenant, admin } = await standUpTaylor();

  assert.equal(admin.bootstrap.tenantId, tenant.id);
  assert.ok(admin.assignmentId, "an assignment was created");

  // A second bootstrap, even naming a different subject, is refused.
  await assert.rejects(
    () => bootstrapAdministrator(r, {
      tenantId: tenant.id, externalSubject: "firebase-uid-someone-else", performedBy: OPERATOR,
    }),
    /already been bootstrapped/i,
    "the second call is refused",
  );

  // And the original administrator still administers.
  const context = await resolvePrincipalContext(r, { externalSubject: ADMIN_SUBJECT });
  assert.ok(context.heldRoleKeys.includes("admin"), "unchanged");
});

test("the bootstrapped administrator resolves to a real EOS context", { skip: SKIP }, async () => {
  const { repo: r, tenant, adminContext } = await standUpTaylor();

  assert.equal(adminContext.tenantId, tenant.id);
  assert.deepEqual(adminContext.heldRoleKeys, ["admin"]);
  // The EOS principal id, NOT the Firebase UID. That is what survives replacing the provider.
  assert.notEqual(adminContext.uid, ADMIN_SUBJECT);
  assert.equal(adminContext.principal.externalSubject, ADMIN_SUBJECT);
  assert.equal(adminContext.principal.identityProvider, "firebase");
  assert.ok(await r.getMembership(tenant.id, adminContext.uid), "and is a member");
});

test("an unknown subject, and a member with no Roles, are different answers", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();

  const unknown = await executeAdminOperation({ repo: r }, asSubject("firebase-uid-nobody", "listObjects", {}));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "UNAUTHENTICATED", "EOS does not know this identity");

  // A member with no Roles gets a context and can READ the configuration -- and can change nothing.
  const plain = await executeAdminOperation({ repo: r }, asSubject(PLAIN_SUBJECT, "listObjects", {}));
  assert.equal(plain.ok, true, "membership alone is enough to read the model");
  const context = await resolvePrincipalContext(r, { externalSubject: PLAIN_SUBJECT });
  assert.deepEqual(context.heldRoleKeys, [], "and holds nothing");
});

// ============================ OBJECTS ============================

test("OBJECTS: an Admin creates a custom field and the canonical read returns it", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();

  const created = await executeAdminOperation({ repo: r }, asAdmin("createCustomField", {
    objectKey: "account",
    key: "loyaltyTier",
    label: "Loyalty Tier",
    dataType: "STRING",
  }));
  assert.equal(created.ok, true, created.ok ? "" : created.message);
  assert.equal(created.data.origin, "CUSTOM");

  // CANONICAL READ, not the response echoed back.
  const read = await executeAdminOperation({ repo: r }, asAdmin("readObjectWithFields", { objectKey: "account" }));
  assert.equal(read.ok, true);
  const field = read.data.fields.find((f) => f.key === "loyaltyTier");
  assert.ok(field, "the field is in the persisted object");
  assert.equal(field.label, "Loyalty Tier");
});

test("OBJECTS: a non-Admin is refused, and nothing is written", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();
  await grant(r, GM_SUBJECT, "generalManager");

  const refused = await executeAdminOperation({ repo: r }, asSubject(GM_SUBJECT, "createCustomField", {
    objectKey: "account", key: "sneaky", label: "Sneaky", dataType: "STRING",
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "FORBIDDEN", "a General Manager may staff, not redefine");

  const read = await executeAdminOperation({ repo: r }, asAdmin("readObjectWithFields", { objectKey: "account" }));
  assert.equal(read.data.fields.some((f) => f.key === "sneaky"), false, "and no field was created");
});

test("OBJECTS: a SYSTEM field cannot be re-keyed or retyped", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();

  const read = await executeAdminOperation({ repo: r }, asAdmin("readObjectWithFields", { objectKey: "account" }));
  const systemField = read.data.fields.find((f) => f.origin === "SYSTEM");
  assert.ok(systemField, "the seed created system fields");

  // The API exposes label/description/required and NOTHING else, so re-keying and retyping are not
  // refusals to be enforced -- they are not expressible. Proved by asking for both and observing
  // that the persisted field is unchanged.
  const attempted = await executeAdminOperation({ repo: r }, asAdmin("updateCustomFieldMetadata", {
    fieldId: systemField.id,
    key: "somethingElse",
    dataType: "NUMBER",
    label: "Renamed Label",
  }));

  const after = await executeAdminOperation({ repo: r }, asAdmin("readObjectWithFields", { objectKey: "account" }));
  const reloaded = after.data.fields.find((f) => f.id === systemField.id);
  assert.equal(reloaded.key, systemField.key, "the key is identity and did not move");
  assert.equal(reloaded.dataType, systemField.dataType, "and the type is unchanged");
  // Whether the label edit was permitted is the command's business; the point here is that the two
  // structural properties did not move either way.
  assert.ok(attempted.ok === true || attempted.ok === false);
});

// ============================ ROLES & PERMISSIONS ============================

test("ROLES: an Object CRED change persists, and survives a fresh connection", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const salesperson = roles.find((x) => x.key === "salesperson");
  assert.ok(salesperson);

  const set = await executeAdminOperation({ repo: r }, asAdmin("setObjectPermission", {
    roleId: salesperson.id, objectKey: "account", cred: { C: true, R: true, E: true, D: false },
  }));
  assert.equal(set.ok, true, set.ok ? "" : set.message);

  // A DIFFERENT POOL, so nothing in-process could be answering. This is the cheapest possible test
  // that the write reached the database rather than a cache.
  const otherPool = new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 2 }));
  try {
    const fresh = new PostgresPolicyRepository(otherPool);
    const perms = await fresh.listObjectPermissions(tenant.id, [salesperson.id]);
    const object = await fresh.getObjectByKey(tenant.id, "account");
    const row = perms.find((p) => p.objectId === object.id);
    assert.ok(row, "the permission is in the database");
    assert.deepEqual(row.cred, { C: true, R: true, E: true, D: false });
  } finally {
    await otherPool.end();
  }
});

test("ROLES: a field override persists, and removing it restores inheritance", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const salesperson = roles.find((x) => x.key === "salesperson");

  await executeAdminOperation({ repo: r }, asAdmin("setObjectPermission", {
    roleId: salesperson.id, objectKey: "account", cred: { C: false, R: true, E: true, D: false },
  }));

  const read = await executeAdminOperation({ repo: r }, asAdmin("readObjectWithFields", { objectKey: "account" }));
  const field = read.data.fields[0];

  const set = await executeAdminOperation({ repo: r }, asAdmin("setFieldPermissionOverride", {
    roleId: salesperson.id, fieldId: field.id, override: { E: false },
  }));
  assert.equal(set.ok, true, set.ok ? "" : set.message);

  let policy = await executeAdminOperation({ repo: r }, asAdmin("readRolePolicy", { roleId: salesperson.id }));
  assert.equal(policy.data.fieldOverrides.length, 1, "the override is stored");
  assert.deepEqual(policy.data.fieldOverrides[0].override, { E: false });

  const removed = await executeAdminOperation({ repo: r }, asAdmin("removeFieldPermissionOverride", {
    roleId: salesperson.id, fieldId: field.id,
  }));
  assert.equal(removed.ok, true, removed.ok ? "" : removed.message);

  policy = await executeAdminOperation({ repo: r }, asAdmin("readRolePolicy", { roleId: salesperson.id }));
  assert.equal(policy.data.fieldOverrides.length, 0, "removing it leaves NO ROW -- inheritance, not a stored false");
});

test("ROLES: an unsupported CRED cell is REFUSED (D-2)", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const salesperson = roles.find((x) => x.key === "salesperson");

  // Reorder Requests supports no Delete: no capability governs it, so there is no enforcement point.
  const refused = await executeAdminOperation({ repo: r }, asAdmin("setObjectPermission", {
    roleId: salesperson.id, objectKey: "reorderRequest", cred: { C: false, R: true, E: false, D: true },
  }));
  assert.equal(refused.ok, false, "a grant the engine could never honour is not stored");
  assert.equal(refused.code, "INVALID_INPUT");
});

test("D-5 SURVIVES ACTIVATION: reorder data is CRED, reorder transitions are workflow actions",
  { skip: SKIP }, async () => {
    const { repo: r, tenant } = await standUpTaylor();

    // The Reorder Request object owns its data authority.
    const reorder = await r.getObjectByKey(tenant.id, "reorderRequest");
    assert.ok(reorder, "Reorder Request is a canonical object in a real database");

    // And the Parts/Purchasing workflow governs reorderRequest, not purchaseOrder.
    const workflows = await r.listWorkflows(tenant.id);
    const parts = workflows.find((w) => w.key === "partsPurchasing");
    assert.ok(parts, "the Parts / Purchasing machine is seeded");
    assert.equal(parts.objectKey, "reorderRequest", "authority follows the record");

    // No workflow action is reachable as a CRED cell: the object's own permissions carry only the
    // create/read capabilities, and the transitions live in the workflow's actions.
    const versions = await r.listWorkflowVersions(tenant.id, parts.id);
    const view = await executeAdminOperation({ repo: r }, asAdmin("readWorkflowVersion", {
      versionId: versions[0].id,
    }));
    assert.equal(view.ok, true);
    const actionKeys = view.data.actions.map((a) => a.key).sort();
    for (const key of [
      "approve", "reject", "assign", "startPurchasing", "postPurchasingUpdate",
      "recordPurchaseOrder", "markReceived", "voidPurchaseOrder",
      // Cancel is THREE edges, one per state it can leave from, and each has its own key -- a single
      // "cancel" action would be an edge from three states at once, which the model cannot express.
      "cancelFromReady", "cancelFromAssigned", "cancelFromPurchasing",
    ]) {
      assert.ok(actionKeys.includes(key), `${key} is a workflow action`);
    }
    assert.equal(actionKeys.length, 11, "eleven actions over nine states");

    // And the purchase order lifecycle action lives HERE, in the workflow, not on a CRED row.
    const purchaseOrder = await r.getObjectByKey(tenant.id, "purchaseOrder");
    const poPerms = await r.listObjectPermissions(tenant.id, (await r.listRoles(tenant.id)).map((x) => x.id));
    const poRows = poPerms.filter((x) => x.objectId === purchaseOrder.id);
    assert.equal(
      poRows.some((x) => x.cred?.D === true), false,
      "voiding is a workflow action, and no Role holds it as a Delete grant",
    );
  });

// ============================ USERS ============================

test("USERS: Owner, General Manager and Admin may each assign the Admin Role", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const adminRole = roles.find((x) => x.key === "admin");

  await grant(r, OWNER_SUBJECT, "owner");
  await grant(r, GM_SUBJECT, "generalManager");

  // A DIFFERENT TARGET EACH TIME. Assigning the same Role to the same principal three times is now
  // idempotent, so the second and third calls would have returned the FIRST one's row and reported
  // success without exercising anybody's authority -- a test that passes for the wrong reason.
  const targets = [OWNER_SUBJECT, GM_SUBJECT, PLAIN_SUBJECT];
  const created = new Set();
  for (const [i, subject] of [OWNER_SUBJECT, GM_SUBJECT, ADMIN_SUBJECT].entries()) {
    const target = await r.getPrincipalBySubject("firebase", targets[i]);
    const result = await executeAdminOperation({ repo: r }, asSubject(subject, "assignRole", {
      principalId: target.id, roleId: adminRole.id, reason: `assigned by ${subject}`,
    }));
    assert.equal(result.ok, true, `${subject} may assign Admin: ${result.ok ? "" : result.message}`);
    created.add(result.data.id);
  }
  assert.equal(created.size, 3, "three distinct assignments, one per assigning authority");
});

// ============================ RULING B — REFERENTIAL INTEGRITY ============================

test("INTEGRITY: an assignment to a principal who does not exist is refused BY THE DATABASE",
  { skip: SKIP }, async () => {
    // Below the API, below the command. The composite key means a migration, a repair script or a
    // psql prompt cannot write this row either -- which is the half an API check cannot defend.
    const { repo: r, tenant } = await standUpTaylor();
    const roles = await r.listRoles(tenant.id);

    await assert.rejects(
      () => r.transact({ tenantId: tenant.id, uid: "direct" }, (tx) => tx.createAssignment({
        principalId: "a-principal-that-does-not-exist",
        roleId: roles[0].id,
        scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "direct", grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
      })),
      /not a member of this tenant/i,
      "the store refuses it, not only the command",
    );

    const rows = await query(
      "SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE principal_id = $1",
      ["a-principal-that-does-not-exist"],
    );
    assert.equal(rows.rows[0].n, 0, "and nothing landed");
  });

test("INTEGRITY: a principal who is a member of ANOTHER tenant cannot be assigned here",
  { skip: SKIP }, async () => {
    // The failure the composite key exists for. A plain REFERENCES principals(id) would have let
    // this through: the principal exists, they are simply not in this tenant. That is not a dangling
    // row, it is a cross-tenant authority leak.
    const { repo: r, tenant } = await standUpTaylor();
    const other = await bootstrapTenant(r, { ...OTHER, actorUid: OPERATOR });
    const stranger = await bootstrapAdministrator(r, {
      tenantId: other.tenant.id, externalSubject: "firebase-uid-elsewhere", performedBy: OPERATOR,
    });
    const roles = await r.listRoles(tenant.id);

    // Through the API: refused as invalid input.
    const viaApi = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: stranger.principal.id, roleId: roles[0].id,
    }));
    assert.equal(viaApi.ok, false);
    assert.equal(viaApi.code, "INVALID_INPUT");

    // Straight at the store, bypassing the command: refused by the foreign key.
    await assert.rejects(
      () => r.transact({ tenantId: tenant.id, uid: "direct" }, (tx) => tx.createAssignment({
        principalId: stranger.principal.id, roleId: roles[0].id,
        scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "direct", grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
      })),
      /not a member of this tenant/i,
    );

    const leaked = await query(
      "SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE tenant_id = $1 AND principal_id = $2",
      [tenant.id, stranger.principal.id],
    );
    assert.equal(leaked.rows[0].n, 0, "no assignment crossed the boundary");
  });

test("INTEGRITY: a valid tenant member IS assignable, and the bootstrap still succeeds",
  { skip: SKIP }, async () => {
    // The constraint has to refuse the wrong thing without refusing the right one -- including the
    // bootstrap, which creates a principal, a membership and an Admin assignment in one transaction
    // and would fail outright if the ordering were wrong.
    const { repo: r, tenant, admin, others } = await standUpTaylor();

    assert.ok(admin.assignmentId, "the bootstrap's own assignment landed");
    const bootstrapRow = await query(
      "SELECT count(*)::int n FROM eos_policy.user_role_assignments WHERE id = $1",
      [admin.assignmentId],
    );
    assert.equal(bootstrapRow.rows[0].n, 1);

    const roles = await r.listRoles(tenant.id);
    const result = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: roles.find((x) => x.key === "technician").id,
    }));
    assert.equal(result.ok, true, result.ok ? "" : result.message);
    assert.equal(result.data.principalId, others.plain.id);
  });

test("INTEGRITY: a rejected assignment leaves the transaction atomic", { skip: SKIP }, async () => {
  // A constraint violation must roll the WHOLE unit of work back, audit event included. A refusal
  // that left a half-written change would be worse than one that let the write through, because it
  // would be invisible.
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const before = await r.listAuditEvents(tenant.id, 500);

  await assert.rejects(() => r.transact({ tenantId: tenant.id, uid: "direct" }, async (tx) => {
    await tx.createRole({ key: "willRollBack", name: "Will Roll Back", description: null, origin: "CUSTOM", protected: false });
    await tx.appendAudit({
      action: "createRole", actorUid: "direct", targetKind: "role", targetId: "x",
      occurredAt: new Date().toISOString(), reason: null, before: null, after: null,
    });
    await tx.createAssignment({
      principalId: "still-not-a-member", roleId: roles[0].id,
      scopeType: "global", scopeValue: null, status: "active",
      grantedBy: "direct", grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
    });
  }));

  const roleGone = await r.getRoleByKey(tenant.id, "willRollBack");
  assert.equal(roleGone, null, "the role written before the violation is gone");
  const after = await r.listAuditEvents(tenant.id, 500);
  assert.equal(after.length, before.length, "and so is its audit event");
});

// ============================ RULING C — IDENTICAL ACTIVE ASSIGNMENTS ============================

test("IDEMPOTENT: assigning the same Role at the same scope twice returns the SAME assignment",
  { skip: SKIP }, async () => {
    const { repo: r, tenant, others } = await standUpTaylor();
    const roles = await r.listRoles(tenant.id);
    const technician = roles.find((x) => x.key === "technician");

    const first = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
    }));
    assert.equal(first.ok, true, first.ok ? "" : first.message);
    const versionAfterFirst = (await r.getAccessVersion(tenant.id, others.plain.id)).accessVersion;
    const auditAfterFirst = (await r.listAuditEvents(tenant.id, 500)).length;

    const second = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
    }));
    assert.equal(second.ok, true, "the second call succeeds");
    assert.equal(second.data.id, first.data.id, "and returns the EXISTING canonical row");

    // No second row, no doubled authority, no misleading duplicate for an administrator to revoke.
    const rows = await query(
      `SELECT count(*)::int n FROM eos_policy.user_role_assignments
       WHERE tenant_id = $1 AND principal_id = $2 AND role_id = $3 AND status = 'active'`,
      [tenant.id, others.plain.id, technician.id],
    );
    assert.equal(rows.rows[0].n, 1, "exactly one active row");

    // Nothing about what they may do moved, so nothing was invalidated and nothing was recorded.
    assert.equal(
      (await r.getAccessVersion(tenant.id, others.plain.id)).accessVersion, versionAfterFirst,
      "the access version did not move for a change that did not happen",
    );
    assert.equal((await r.listAuditEvents(tenant.id, 500)).length, auditAfterFirst, "and no audit event");

    const context = await resolvePrincipalContext(r, { externalSubject: PLAIN_SUBJECT });
    assert.deepEqual(context.heldRoleKeys, ["technician"], "authority is not doubled");
  });

test("ADDITIVE STILL: a different Role, and the same Role at a different scope, are separate",
  { skip: SKIP }, async () => {
    // The ruling narrows exactly one case. Everything the additive model allows still works.
    const { repo: r, tenant, others } = await standUpTaylor();
    const roles = await r.listRoles(tenant.id);
    const technician = roles.find((x) => x.key === "technician");
    const salesperson = roles.find((x) => x.key === "salesperson");

    const a = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
    }));
    const b = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: salesperson.id,
    }));
    const c = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
      scopeType: "location", scopeValue: "wh-main",
    }));

    for (const [name, result] of [["technician", a], ["salesperson", b], ["technician@wh-main", c]]) {
      assert.equal(result.ok, true, `${name}: ${result.ok ? "" : result.message}`);
    }
    assert.equal(new Set([a.data.id, b.data.id, c.data.id]).size, 3, "three distinct assignments");

    const context = await resolvePrincipalContext(r, { externalSubject: PLAIN_SUBJECT });
    assert.deepEqual(context.heldRoleKeys, ["salesperson", "technician"], "and the union is additive");
  });

test("THE DATABASE REFUSES A DUPLICATE TOO, and a revoked one does not block a re-grant",
  { skip: SKIP }, async () => {
    const { repo: r, tenant, others } = await standUpTaylor();
    const roles = await r.listRoles(tenant.id);
    const technician = roles.find((x) => x.key === "technician");

    const first = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
    }));

    // Straight at the store, bypassing the command's idempotence: the partial unique index refuses.
    await assert.rejects(
      () => r.transact({ tenantId: tenant.id, uid: "direct" }, (tx) => tx.createAssignment({
        principalId: others.plain.id, roleId: technician.id,
        scopeType: "global", scopeValue: null, status: "active",
        grantedBy: "direct", grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
      })),
      /identical active assignment already exists/i,
    );

    // REVOKED, then re-granted: a real change, and it gets a real new row. The index is partial on
    // status = 'active' precisely so history never blocks a later decision.
    const revoked = await executeAdminOperation({ repo: r }, asAdmin("revokeRole", {
      assignmentId: first.data.id,
    }));
    assert.equal(revoked.ok, true, revoked.ok ? "" : revoked.message);

    const again = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
      principalId: others.plain.id, roleId: technician.id,
    }));
    assert.equal(again.ok, true, again.ok ? "" : again.message);
    assert.notEqual(again.data.id, first.data.id, "a new assignment, not the revoked one revived");

    // And the history is complete: both rows survive, one disabled and one active.
    const all = await r.listAssignmentsForPrincipal(tenant.id, others.plain.id);
    const forRole = all.filter((x) => x.roleId === technician.id);
    assert.equal(forRole.length, 2, "the revoked assignment is still there as history");
    assert.equal(forRole.filter((x) => x.status === "active").length, 1, "and only one is in force");
  });

test("USERS: a principal with no assignment authority cannot assign", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  await grant(r, PLAIN_SUBJECT, "technician");

  const owner = await r.getPrincipalBySubject("firebase", OWNER_SUBJECT);
  const refused = await executeAdminOperation({ repo: r }, asSubject(PLAIN_SUBJECT, "assignRole", {
    principalId: owner.id, roleId: roles.find((x) => x.key === "admin").id,
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "FORBIDDEN");
});

test("USERS: assignments are ADDITIVE, and revocation is exact", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const roles = await r.listRoles(tenant.id);
  const plain = await r.getPrincipalBySubject("firebase", PLAIN_SUBJECT);

  const first = await grant(r, PLAIN_SUBJECT, "technician");
  const second = await grant(r, PLAIN_SUBJECT, "salesperson");

  let listed = await executeAdminOperation({ repo: r }, asAdmin("listPrincipalRoleAssignments", {
    principalId: plain.id,
  }));
  assert.equal(listed.ok, true);
  const activeKeys = listed.data.assignments.filter((a) => a.status === "active").map((a) => a.roleKey).sort();
  assert.deepEqual(activeKeys, ["salesperson", "technician"], "both, at once -- there is no primary Role");

  // ACCESS VERSION MOVED. A grant that landed without it would be a change that silently did not
  // take effect.
  assert.ok(listed.data.accessVersion >= 2, `access version rose to ${listed.data.accessVersion}`);

  const revoked = await executeAdminOperation({ repo: r }, asAdmin("revokeRole", {
    assignmentId: first.id,
  }));
  assert.equal(revoked.ok, true, revoked.ok ? "" : revoked.message);

  listed = await executeAdminOperation({ repo: r }, asAdmin("listPrincipalRoleAssignments", {
    principalId: plain.id,
  }));
  const stillActive = listed.data.assignments.filter((a) => a.status === "active").map((a) => a.roleKey);
  assert.deepEqual(stillActive, ["salesperson"], "exactly the one named, and only it");
  assert.ok(second.id, "the other assignment is untouched");

  // And the effective context agrees.
  const context = await resolvePrincipalContext(r, { externalSubject: PLAIN_SUBJECT });
  assert.deepEqual(context.heldRoleKeys, ["salesperson"]);
});

test("USERS: a Role cannot be assigned to somebody who is not a member of the tenant", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const other = await bootstrapTenant(r, { ...OTHER, actorUid: OPERATOR });
  const stranger = await bootstrapAdministrator(r, {
    tenantId: other.tenant.id, externalSubject: "firebase-uid-stranger", performedBy: OPERATOR,
  });

  const roles = await r.listRoles(tenant.id);
  const refused = await executeAdminOperation({ repo: r }, asAdmin("assignRole", {
    principalId: stranger.principal.id, roleId: roles.find((x) => x.key === "technician").id,
  }));

  // This is the boundary check migration 002 chose instead of a foreign key, and it is proved here
  // rather than assumed by the comment that says so.
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "INVALID_INPUT");
  assert.match(refused.message, /not an active member/i);
});

test("USERS: the LAST administering assignment cannot be revoked", { skip: SKIP }, async () => {
  const { repo: r, admin } = await standUpTaylor();

  // The recovery invariant, and it is the one this tranche most easily broke: before membership
  // existed, the bootstrap's own assignment was invisible to the guard's principal walk, so this
  // would have counted zero administrators and allowed it.
  const refused = await executeAdminOperation({ repo: r }, asAdmin("revokeRole", {
    assignmentId: admin.assignmentId,
  }));
  assert.equal(refused.ok, false, "the platform may not be left unadministrable");
  assert.match(refused.message, /last active administering assignment/i);

  const context = await resolvePrincipalContext(r, { externalSubject: ADMIN_SUBJECT });
  assert.ok(context.heldRoleKeys.includes("admin"), "and the administrator still administers");
});

// ============================ WORKFLOWS ============================

test("WORKFLOWS: the seeded versions are DRAFT, and nothing routes through them", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();

  const listed = await executeAdminOperation({ repo: r }, asAdmin("listWorkflows", {}));
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 5, "5 versioned state machines");
  for (const entry of listed.data) {
    for (const version of entry.versions) {
      assert.equal(version.status, "DRAFT", `${entry.workflow.key} v${version.version} stays DRAFT`);
    }
  }
});

test("WORKFLOWS: a draft edit persists as a new version, and Role bindings persist", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const workflows = await r.listWorkflows(tenant.id);
  const parts = workflows.find((w) => w.key === "partsPurchasing");
  const versions = await r.listWorkflowVersions(tenant.id, parts.id);

  const before = await executeAdminOperation({ repo: r }, asAdmin("readWorkflowVersion", {
    versionId: versions[0].id,
  }));
  assert.equal(before.ok, true);

  const definition = {
    steps: before.data.steps.map((s) => ({ key: s.key, label: s.label, initial: s.initial, terminal: s.terminal })),
    actions: before.data.actions.map((a) => ({
      key: a.key, label: a.key === "approve" ? "Approve the request" : a.label,
      from: a.from, to: a.to, requiresOwnAssignment: a.requiresOwnAssignment, roleKeys: a.roleKeys,
    })),
  };

  const updated = await executeAdminOperation({ repo: r }, asAdmin("updateWorkflowDefinition", {
    versionId: versions[0].id, definition, reason: "relabel approve",
  }));
  assert.equal(updated.ok, true, updated.ok ? "" : updated.message);
  assert.equal(updated.data.version.version, 2, "a NEW draft version, not a rewrite of the old one");
  assert.equal(updated.data.version.status, "DRAFT");

  const after = await executeAdminOperation({ repo: r }, asAdmin("readWorkflowVersion", {
    versionId: updated.data.version.id,
  }));
  assert.equal(after.data.actions.find((a) => a.key === "approve").label, "Approve the request", "persisted");
  assert.ok(after.data.actions.find((a) => a.key === "approve").roleKeys.length > 0, "bindings came across");

  // The superseded version is still readable. An administrator who wants the old shape back has it.
  const original = await executeAdminOperation({ repo: r }, asAdmin("readWorkflowVersion", {
    versionId: versions[0].id,
  }));
  assert.equal(original.data.actions.find((a) => a.key === "approve").label, "Approve", "v1 is unchanged");
});

test("WORKFLOWS: a published version is IMMUTABLE", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const workflows = await r.listWorkflows(tenant.id);
  const parts = workflows.find((w) => w.key === "partsPurchasing");
  const versions = await r.listWorkflowVersions(tenant.id, parts.id);

  const published = await executeAdminOperation({ repo: r }, asAdmin("publishWorkflowVersion", {
    versionId: versions[0].id, reason: "proving immutability",
  }));
  assert.equal(published.ok, true, published.ok ? "" : published.message);
  assert.equal(published.data.status, "PUBLISHED");

  const edit = await executeAdminOperation({ repo: r }, asAdmin("updateWorkflowDefinition", {
    versionId: versions[0].id,
    definition: { steps: [{ key: "only", label: "Only", initial: true, terminal: true }], actions: [] },
  }));
  assert.equal(edit.ok, false, "history is not rewritten under a running process");
  assert.match(edit.message, /cannot be edited|published/i);

  const binding = await executeAdminOperation({ repo: r }, asAdmin("setWorkflowRoleBinding", {
    versionId: versions[0].id, actionKey: "approve", roleId: (await r.listRoles(tenant.id))[0].id,
  }));
  assert.equal(binding.ok, false, "and neither are its bindings");
});

test("WORKFLOWS: a non-Admin cannot edit a definition", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  await grant(r, GM_SUBJECT, "generalManager");
  const workflows = await r.listWorkflows(tenant.id);
  const versions = await r.listWorkflowVersions(tenant.id, workflows[0].id);

  const refused = await executeAdminOperation({ repo: r }, asSubject(GM_SUBJECT, "updateWorkflowDefinition", {
    versionId: versions[0].id,
    definition: { steps: [{ key: "only", label: "Only", initial: true, terminal: true }], actions: [] },
  }));
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "FORBIDDEN");
});

// ============================ AUDIT ============================

test("AUDIT: every mutation writes an event, and a refusal writes none", { skip: SKIP }, async () => {
  const { repo: r, tenant, adminContext } = await standUpTaylor();

  const before = await r.listAuditEvents(tenant.id, 500);

  await executeAdminOperation({ repo: r }, asAdmin("createCustomField", {
    objectKey: "account", key: "auditedField", label: "Audited", dataType: "STRING",
  }));

  const refused = await executeAdminOperation({ repo: r }, asSubject(PLAIN_SUBJECT, "createCustomField", {
    objectKey: "account", key: "refusedField", label: "Refused", dataType: "STRING",
  }));
  assert.equal(refused.ok, false);

  const after = await r.listAuditEvents(tenant.id, 500);
  assert.equal(after.length, before.length + 1, "one event for the mutation, none for the refusal");

  // NAMED, not "whichever came first". A fallback here would have let this test pass against the
  // wrong event -- which is exactly what it did on the first run, reporting the bootstrap operator
  // as the actor and looking like a defect in the API rather than in the assertion.
  const created = after.filter((e) => !before.some((b) => b.id === e.id));
  assert.equal(created.length, 1, "exactly one new event");
  const event = created[0];
  assert.equal(event.actorUid, adminContext.uid, "the EOS principal, not the Firebase UID");
  assert.notEqual(event.actorUid, "firebase-uid-admin", "and not the identity provider's subject");
  assert.equal(event.tenantId, tenant.id);
  assert.equal(event.targetKind, "objectField");
  assert.ok(event.occurredAt, "with an instant");
});

test("AUDIT: a rolled-back mutation leaves NO event", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const before = await r.listAuditEvents(tenant.id, 500);

  // A duplicate key: the create fails inside the transaction, and the audit event it had already
  // written must roll back with it. A false success in the audit trail is worse than no trail.
  await executeAdminOperation({ repo: r }, asAdmin("createCustomField", {
    objectKey: "account", key: "onlyOnce", label: "Only Once", dataType: "STRING",
  }));
  const middle = await r.listAuditEvents(tenant.id, 500);
  assert.equal(middle.length, before.length + 1);

  const duplicate = await executeAdminOperation({ repo: r }, asAdmin("createCustomField", {
    objectKey: "account", key: "onlyOnce", label: "Again", dataType: "STRING",
  }));
  assert.equal(duplicate.ok, false, "the second create is refused");

  const after = await r.listAuditEvents(tenant.id, 500);
  assert.equal(after.length, middle.length, "and wrote no audit event claiming it happened");
});

test("AUDIT: audit history is tenant-scoped", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();
  const other = await bootstrapTenant(r, { ...OTHER, actorUid: OPERATOR });

  const history = await executeAdminOperation({ repo: r }, asAdmin("readPolicyAuditHistory", { limit: 500 }));
  assert.equal(history.ok, true);
  assert.ok(history.data.length > 0);
  assert.equal(
    history.data.every((e) => e.tenantId === tenant.id), true,
    "not one event from another tenant",
  );
  assert.ok(other.tenant.id !== tenant.id);
});

// ============================ THE API'S OWN SHAPE ============================

test("there is no generic mutation: an unknown operation is refused by name", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();
  for (const operation of ["runSQL", "mutatePolicy", "patchAnything", "query", "__proto__"]) {
    const result = await executeAdminOperation({ repo: r }, asAdmin(operation, { sql: "SELECT 1" }));
    assert.equal(result.ok, false, `${operation} is not an operation`);
    assert.equal(result.code, "UNKNOWN_OPERATION");
  }
});

test("HTTP: a request with no bearer token never reaches the policy store", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();
  let verifierCalled = false;

  const response = await handleAdminRequest(
    { repo: r, verifyToken: async () => { verifierCalled = true; throw new Error("unreachable"); } },
    { method: "POST", url: "/admin/policy", headers: {}, body: JSON.stringify({ operation: "listObjects" }) },
  );

  assert.equal(response.status, 401);
  assert.equal(verifierCalled, false, "and the verifier was not even asked");
});

test("HTTP: the transport carries the verified subject and nothing the body claims", { skip: SKIP }, async () => {
  const { repo: r, tenant } = await standUpTaylor();

  const response = await handleAdminRequest(
    {
      repo: r,
      // The verifier is the ONLY source of the subject. The body below tries to state a different
      // one, and it is ignored because nothing reads it.
      verifyToken: async () => ({ externalSubject: ADMIN_SUBJECT, identityProvider: "firebase" }),
    },
    {
      method: "POST",
      url: "/admin/policy",
      headers: { authorization: "Bearer whatever" },
      body: JSON.stringify({
        operation: "listObjects",
        caller: { externalSubject: "firebase-uid-owner" },
        input: { tenantId: "some-other-tenant" },
      }),
    },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, true);
  assert.equal(body.tenantId, tenant.id, "resolved from the verified subject's membership");
});

test("HTTP: health reports reachable and migrated without a token", { skip: SKIP }, async () => {
  const { repo: r } = await standUpTaylor();
  const health = await checkPolicyDatabaseHealth(pool);

  const response = await handleAdminRequest(
    { repo: r, verifyToken: async () => { throw new Error("not called"); }, health: async () => health },
    { method: "GET", url: "/health", headers: {} },
  );

  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.reachable, true);
  assert.equal(body.migrated, true, "the schema is there, not merely the server");
});

// ============================ RESTART ============================

test("RESTART: every pool and every in-process object is discarded, and the state is still there",
  { skip: SKIP }, async () => {
    // ════════════════ THE PROOF THIS WHOLE TRANCHE TURNS ON ════════════════
    //
    // If the in-memory adapter were still the operational source, every test above would pass and
    // nothing would persist. So: stand the tenant up, make a change, THROW AWAY the pool and the
    // repository -- the closest thing to killing the process this harness can do -- and ask a
    // brand-new one what it has.
    const { repo: r, tenant, adminContext } = await standUpTaylor();

    await executeAdminOperation({ repo: r }, asAdmin("createCustomField", {
      objectKey: "account", key: "survivesRestart", label: "Survives Restart", dataType: "STRING",
    }));
    const roles = await r.listRoles(tenant.id);
    const salesperson = roles.find((x) => x.key === "salesperson");
    await executeAdminOperation({ repo: r }, asAdmin("setObjectPermission", {
      roleId: salesperson.id, objectKey: "account", cred: { C: false, R: true, E: true, D: false },
    }));

    // The restart.
    await pool.end();
    pool = null;
    const restarted = repo();

    // Identity survives.
    const context = await resolvePrincipalContext(restarted, { externalSubject: ADMIN_SUBJECT });
    assert.equal(context.tenantId, tenant.id);
    assert.equal(context.uid, adminContext.uid, "the same EOS principal id");
    assert.deepEqual(context.heldRoleKeys, ["admin"]);

    // Configuration survives.
    const objects = await restarted.listObjects(tenant.id);
    assert.equal(objects.length, 37);

    const read = await executeAdminOperation({ repo: restarted }, asAdmin("readObjectWithFields", {
      objectKey: "account",
    }));
    assert.equal(read.data.fields.some((f) => f.key === "survivesRestart"), true, "the custom field is still there");

    const perms = await restarted.listObjectPermissions(tenant.id, [salesperson.id]);
    const customer = await restarted.getObjectByKey(tenant.id, "account");
    assert.deepEqual(
      perms.find((p) => p.objectId === customer.id).cred,
      { C: false, R: true, E: true, D: false },
      "and so is the CRED change",
    );

    // Workflows survive.
    const workflows = await restarted.listWorkflows(tenant.id);
    assert.equal(workflows.length, 5);
  });
