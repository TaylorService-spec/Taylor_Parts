// EOS Administration policy — the AUTHORIZATION proofs.
//
// Object CRED, field inheritance, the doorway invariant, multi-role union, fail-closed behaviour
// and cross-tenant isolation. Every one is asserted by RUNNING the resolver against a real store,
// not by reading it: a dropped predicate and an applied one both return a value, and only execution
// tells them apart.
//
// The store is the in-memory reference adapter. That is the point of the DAL port -- these
// properties are decisions the resolver makes, and none of them needs a database to be wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  canObject,
  loadPrincipalPolicy,
  projectReadableFields,
  resolveFieldAccess,
  resolveObjectAccess,
} from "../lib/adminPolicy/effectiveObjectAccess.js";

const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const ADMIN = "uid-admin";

const CRED = (c, r, e, d) => ({ C: c, R: r, E: e, D: d });
const NONE = CRED(false, false, false, false);
const READ = CRED(false, true, false, false);
const READ_EDIT = CRED(false, true, true, false);

/**
 * A tenant with one object, three fields, and whatever roles/grants the test asks for.
 *
 * Built through the repository's own transaction rather than by poking arrays, so the fixtures
 * exercise the same write path the commands use.
 */
async function makeWorld(repo, tenantId = TENANT) {
  const actor = { tenantId, uid: ADMIN };
  return repo.transact(actor, async (tx) => {
    const customer = await tx.createObject({
      key: "customer", label: "Customer", labelPlural: "Customers", description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: true,
    });
    const field = async (key, label) =>
      tx.createField({
        objectId: customer.id, key, label, description: null, dataType: "STRING",
        required: false, allowedValues: [], defaultValue: null, searchable: false,
        sortable: false, reportable: true, sensitivity: "NORMAL", referenceTo: null,
        origin: "SYSTEM", lifecycle: "ACTIVE",
      });
    const name = await field("name", "Name");
    const address = await field("address", "Address");
    const creditLimit = await field("creditLimit", "Credit Limit");
    return { customer, name, address, creditLimit };
  });
}

async function makeRole(repo, key, tenantId = TENANT) {
  return repo.transact({ tenantId, uid: ADMIN }, (tx) =>
    tx.createRole({ key, name: key, description: null, origin: "CUSTOM", protected: false }),
  );
}

async function grantObject(repo, roleId, objectId, cred, tenantId = TENANT) {
  await repo.transact({ tenantId, uid: ADMIN }, (tx) => tx.setObjectPermission(roleId, objectId, cred));
}

async function overrideField(repo, roleId, fieldId, override, tenantId = TENANT) {
  await repo.transact({ tenantId, uid: ADMIN }, (tx) => tx.setFieldOverride(roleId, fieldId, override));
}

async function assign(repo, principalUid, roleId, tenantId = TENANT, status = "active") {
  return repo.transact({ tenantId, uid: ADMIN }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalUid);
    return tx.createAssignment({
      principalUid, roleId, scopeType: "global", scopeValue: null, status,
      grantedBy: ADMIN, grantedAt: new Date().toISOString(), accessVersionAtGrant: accessVersion,
    });
  });
}

// ============================ object CRED ============================

test("no Object Read means NO record exposure", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, NONE);
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, NONE);
  assert.equal(canObject(policy, "customer", "R"), false);

  // And the projection returns NOTHING, rather than a record with fields blanked out.
  const projected = projectReadableFields(policy, "customer", [world.name], { name: "Acme" });
  assert.deepEqual(projected, {}, "a denied object yields no fields at all");
});

test("an Object grant resolves, and only for the verbs granted", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, READ);
});

test("Delete cannot be granted on an object that does not support it", async () => {
  const repo = new InMemoryPolicyRepository();
  const actor = { tenantId: TENANT, uid: ADMIN };
  const ledger = await repo.transact(actor, (tx) =>
    tx.createObject({
      key: "ledgerEntry", label: "Ledger Entry", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    }),
  );
  const role = await makeRole(repo, "auditor");
  // Written directly through the store, bypassing the command that refuses it -- so this asserts the
  // RESOLVER refuses to honour it too, not merely that one writer declined to record it.
  await grantObject(repo, role.id, ledger.id, CRED(true, true, true, true));
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.equal(resolveObjectAccess(policy, "ledgerEntry").cred.D, false, "D is refused at resolution");
  assert.equal(resolveObjectAccess(policy, "ledgerEntry").cred.R, true, "the other verbs are untouched");
});

// ============================ field inheritance and override ============================

test("a field INHERITS its object's permission when no override exists", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ_EDIT);
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  const decision = resolveFieldAccess(policy, "customer", world.name);
  assert.deepEqual(decision.cred, READ_EDIT);
  assert.equal(decision.basis, "fieldInherited");
});

test("an explicit field DENY overrides an Object allow", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await overrideField(repo, role.id, world.creditLimit.id, { R: false });
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.equal(resolveFieldAccess(policy, "customer", world.name).cred.R, true, "unoverridden field inherits");
  const denied = resolveFieldAccess(policy, "customer", world.creditLimit);
  assert.equal(denied.cred.R, false, "the override wins");
  assert.equal(denied.basis, "fieldOverride");
});

test("a denied field is OMITTED from the projection, never returned and hidden", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await overrideField(repo, role.id, world.creditLimit.id, { R: false });
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  const projected = projectReadableFields(
    policy, "customer",
    [world.name, world.address, world.creditLimit],
    { name: "Acme", address: "1 Main St", creditLimit: 50000 },
  );
  assert.deepEqual(projected, { name: "Acme", address: "1 Main St" });
  assert.equal("creditLimit" in projected, false, "the value is not on the wire at all");
});

// ============================ THE DOORWAY ============================

test("an explicit field GRANT cannot bypass an Object DENY", async () => {
  // The invariant this whole model is built around. Customer.Read = false with
  // Customer.Name.Read = true must still expose NO Customer records.
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "sneaky");
  await grantObject(repo, role.id, world.customer.id, NONE);
  await overrideField(repo, role.id, world.name.id, { R: true });
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.equal(resolveObjectAccess(policy, "customer").cred.R, false);

  const decision = resolveFieldAccess(policy, "customer", world.name);
  assert.equal(decision.cred.R, false, "the field grant does not open the doorway");
  assert.equal(decision.basis, "doorwayClosed", "and the reason says so rather than looking like an ordinary deny");

  const projected = projectReadableFields(policy, "customer", [world.name], { name: "Acme" });
  assert.deepEqual(projected, {}, "no record content escapes through the granted field");
});

test("the doorway is per VERB, not all-or-nothing", async () => {
  // Read granted on the object, Edit not. A field override granting Edit must not create an edit
  // right the object never conferred, while the field's Read still works.
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await overrideField(repo, role.id, world.name.id, { E: true });
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  const decision = resolveFieldAccess(policy, "customer", world.name);
  assert.equal(decision.cred.R, true, "Read still flows through the open verb");
  assert.equal(decision.cred.E, false, "Edit is closed at the object and stays closed at the field");
});

// ============================ multi-role union ============================

test("MULTI-ROLE UNION IS ADDITIVE at the object level", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const reader = await makeRole(repo, "reader");
  const editor = await makeRole(repo, "editor");
  await grantObject(repo, reader.id, world.customer.id, READ);
  await grantObject(repo, editor.id, world.customer.id, CRED(false, false, true, false));
  await assign(repo, "uid-1", reader.id);
  await assign(repo, "uid-1", editor.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, READ_EDIT, "the union, not the last one wins");
});

test("one Role's field DENY cannot veto another Role's grant", async () => {
  // Additive means additive. A deny is the absence of a grant, not a veto -- otherwise adding a
  // narrow Role to a person would silently REMOVE access they already had, which is the
  // "replacement semantics" the Owner ruling forbids.
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const wide = await makeRole(repo, "wide");
  const narrow = await makeRole(repo, "narrow");
  await grantObject(repo, wide.id, world.customer.id, READ);
  await grantObject(repo, narrow.id, world.customer.id, READ);
  await overrideField(repo, narrow.id, world.creditLimit.id, { R: false });
  await assign(repo, "uid-1", wide.id);
  await assign(repo, "uid-1", narrow.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.equal(
    resolveFieldAccess(policy, "customer", world.creditLimit).cred.R,
    true,
    "the wide Role still grants it -- the narrow Role's silence is not a veto",
  );
});

// ============================ fail closed ============================

test("an INACTIVE assignment confers nothing", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await assign(repo, "uid-1", role.id, TENANT, "disabled");

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, NONE);
  assert.equal(resolveObjectAccess(policy, "customer").basis, "noQualifyingAssignment");
});

test("a LATER access change does NOT invalidate an existing grant", async () => {
  // The direction of the version comparison, asserted rather than assumed. accessVersion rises on
  // every access change, so a grant made before the most recent one is ORDINARY -- excluding it
  // would mean each new grant silently revoked every earlier one, and multi-role union would be
  // unreachable because two Roles require two grants at two versions.
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await assign(repo, "uid-1", role.id);
  await repo.transact({ tenantId: TENANT, uid: ADMIN }, (tx) => tx.bumpAccessVersion("uid-1"));

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, READ, "the earlier grant still qualifies");
});

test("an assignment from the FUTURE is excluded as malformed", async () => {
  // The established interpretation, matching resolveEffectivePermission.ts: accessVersion increases
  // monotonically, so a grant whose snapshot EXCEEDS the current value cannot have been written by a
  // correctly-operating writer. Excluded, fail-closed, never given the benefit of the doubt.
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await repo.transact({ tenantId: TENANT, uid: ADMIN }, async (tx) => {
    await tx.bumpAccessVersion("uid-1");
    await tx.createAssignment({
      principalUid: "uid-1", roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ADMIN, grantedAt: new Date().toISOString(), accessVersionAtGrant: 999,
    });
  });

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  const decision = resolveObjectAccess(policy, "customer");
  assert.deepEqual(decision.cred, NONE);
  assert.equal(decision.basis, "staleAccessVersion", "distinguished from simply never having been granted");
});

test("an unknown object and an unknown field both DENY", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, CRED(true, true, true, true));
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  assert.deepEqual(resolveObjectAccess(policy, "nosuchobject").cred, NONE);
  assert.equal(resolveObjectAccess(policy, "nosuchobject").basis, "unknownObject");
  assert.equal(resolveFieldAccess(policy, "customer", null).basis, "unknownField");
  assert.equal(resolveFieldAccess(policy, "customer", undefined).cred.R, false);
});

test("a field belonging to a DIFFERENT object is refused, not answered from this one's policy", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const other = await repo.transact({ tenantId: TENANT, uid: ADMIN }, (tx) =>
    tx.createObject({
      key: "invoice", label: "Invoice", labelPlural: null, description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    }),
  );
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, CRED(true, true, true, true));
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  const foreign = { ...world.name, objectId: other.id };
  assert.equal(resolveFieldAccess(policy, "customer", foreign).basis, "unknownField");
});

test("MALFORMED stored policy fails closed rather than being repaired into a grant", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  // Every shape a corrupt row could take. None may produce an allow, and a partial set must not be
  // completed with `false` -- a storage fault is not a policy statement.
  for (const broken of [null, undefined, "R", 7, [], { R: true }, { C: 1, R: true, E: true, D: true }]) {
    const corrupted = {
      ...policy,
      objectPermissions: [{ id: "x", tenantId: TENANT, roleId: role.id, objectId: world.customer.id, cred: broken }],
    };
    assert.deepEqual(
      resolveObjectAccess(corrupted, "customer").cred, NONE,
      `malformed cred ${JSON.stringify(broken)} must not grant`,
    );
  }
});

test("a malformed field OVERRIDE is ignored, leaving the inherited value", async () => {
  const repo = new InMemoryPolicyRepository();
  const world = await makeWorld(repo);
  const role = await makeRole(repo, "viewer");
  await grantObject(repo, role.id, world.customer.id, READ);
  await assign(repo, "uid-1", role.id);

  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  for (const broken of [null, "R", { X: true }, { R: "no" }, {}]) {
    const corrupted = {
      ...policy,
      fieldOverrides: [{ id: "x", tenantId: TENANT, roleId: role.id, fieldId: world.name.id, override: broken }],
    };
    assert.equal(
      resolveFieldAccess(corrupted, "customer", world.name).cred.R, true,
      `malformed override ${JSON.stringify(broken)} must not change the inherited value`,
    );
  }
});

test("a principal with no assignments at all reads nothing", async () => {
  const repo = new InMemoryPolicyRepository();
  await makeWorld(repo);
  const policy = await loadPrincipalPolicy(repo, TENANT, "uid-nobody");
  assert.deepEqual(resolveObjectAccess(policy, "customer").cred, NONE);
});

// ============================ tenancy ============================

test("a Tenant A Role cannot affect Tenant B", async () => {
  const repo = new InMemoryPolicyRepository();
  const worldA = await makeWorld(repo, TENANT);
  await makeWorld(repo, OTHER_TENANT);
  const roleA = await makeRole(repo, "viewer", TENANT);
  await grantObject(repo, roleA.id, worldA.customer.id, CRED(true, true, true, true), TENANT);
  await assign(repo, "uid-1", roleA.id, TENANT);

  // The SAME principal uid, asked about the other tenant.
  const policyB = await loadPrincipalPolicy(repo, OTHER_TENANT, "uid-1");
  assert.equal(policyB.qualifyingRoleIds.length, 0, "tenant A's assignment is invisible in tenant B");
  assert.deepEqual(resolveObjectAccess(policyB, "customer").cred, NONE);
});

test("Tenant A policy cannot expose Tenant B object or field data", async () => {
  const repo = new InMemoryPolicyRepository();
  const worldA = await makeWorld(repo, TENANT);
  const worldB = await makeWorld(repo, OTHER_TENANT);
  const roleA = await makeRole(repo, "viewer", TENANT);
  await grantObject(repo, roleA.id, worldA.customer.id, CRED(true, true, true, true), TENANT);
  await assign(repo, "uid-1", roleA.id, TENANT);

  const policyA = await loadPrincipalPolicy(repo, TENANT, "uid-1");
  // Tenant B's field, asked with tenant A's policy. The object key matches -- both tenants have a
  // "customer" -- so only the id comparison stands between this and a cross-tenant answer.
  assert.equal(
    resolveFieldAccess(policyA, "customer", worldB.name).cred.R, false,
    "another tenant's field is not readable through this tenant's grant",
  );
});

test("a cross-tenant WRITE is refused by the store, and reports the same not-found as a missing row", async () => {
  const repo = new InMemoryPolicyRepository();
  const worldA = await makeWorld(repo, TENANT);
  const roleB = await makeRole(repo, "viewer", OTHER_TENANT);

  // Tenant B's actor, naming tenant A's object. Distinguishing "belongs to someone else" from "does
  // not exist" would itself confirm the other tenant's row exists.
  await assert.rejects(
    () => grantObject(repo, roleB.id, worldA.customer.id, READ, OTHER_TENANT),
    /object not found/,
  );
});

test("a transaction rolls back completely on a throw -- including its audit event", async () => {
  const repo = new InMemoryPolicyRepository();
  await makeWorld(repo);
  const before = (await repo.listAuditEvents(TENANT, 100)).length;

  await assert.rejects(
    () => repo.transact({ tenantId: TENANT, uid: ADMIN }, async (tx) => {
      await tx.createRole({ key: "halfWritten", name: "Half", description: null, origin: "CUSTOM", protected: false });
      await tx.appendAudit({
        action: "createRole", actorUid: ADMIN, targetKind: "role", targetId: "x",
        occurredAt: new Date().toISOString(), reason: null, before: null, after: null,
      });
      throw new Error("something failed after the writes");
    }),
    /something failed/,
  );

  assert.equal((await repo.listRoles(TENANT)).find((r) => r.key === "halfWritten"), undefined, "no partial policy");
  assert.equal((await repo.listAuditEvents(TENANT, 100)).length, before, "and no orphan audit event");
});
