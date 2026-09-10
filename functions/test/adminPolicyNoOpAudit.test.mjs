// A CHANGE THAT CHANGES NOTHING IS NOT A MUTATION.
//
// Found during real non-production acceptance, against the deployed API, not in review: an identical
// updateRole, updateObjectMetadata, updateCustomFieldMetadata, setObjectPermission and
// setFieldPermissionOverride each wrote an audit event whose only difference was `updatedAt`. The two
// permission commands also bumped the access version of every holder of the Role.
//
// And one variant was worse than a false event: an updateCustomFieldMetadata naming ONLY `key` and
// `dataType` -- neither of which the command can express -- answered 200 and audited an "update". The
// caller was told their key change had succeeded.
//
// Measured, not claimed: run against the source as deployed at 8740bf11, seven of these nine fail.
// The other two are GUARDS -- that the first all-false CRED is still written, and that Inherit still
// deletes a real override and audits it -- and are meant to pass both before and after. A no-op
// guard that also swallowed real changes would be a worse defect than the one it fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  createCustomField,
  setFieldPermissionOverride,
  setObjectPermission,
  updateFieldDefinition,
  updateObjectMetadata,
} from "../lib/adminPolicy/policyCommands.js";
import { executeAdminOperation } from "../lib/adminPolicy/adminPolicyApi.js";
import { bootstrapAdministrator, bootstrapTenant } from "../lib/adminPolicy/tenantBootstrap.js";

const TENANT = "tenant-noop";
const SYS = "uid-seed";
const admin = { tenantId: TENANT, uid: "uid-admin", heldRoleKeys: ["admin"] };

/** One deletable-free object, one custom field, one Role held by one member principal. */
async function world() {
  const repo = new InMemoryPolicyRepository();
  const made = await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const object = await tx.createObject({
      key: "territory", label: "Territory", labelPlural: "Territories", description: null,
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    });
    const systemField = await tx.createField({
      objectId: object.id, key: "name", label: "Name", description: null, dataType: "STRING",
      required: true, allowedValues: [], defaultValue: null, searchable: true, sortable: true,
      reportable: true, sensitivity: "NORMAL", referenceTo: null, origin: "SYSTEM", lifecycle: "ACTIVE",
    });
    const role = await tx.createRole({ key: "zz_role", name: "ZZ Role", description: null, origin: "CUSTOM", protected: false });
    const holder = await tx.createPrincipal({ displayName: "Holder", identityProvider: "test", externalSubject: "holder" });
    await tx.createTenantMembership(holder.id);
    await tx.createAssignment({
      principalId: holder.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: SYS, grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
    });
    return { object, systemField, role, holder };
  });
  const customField = await createCustomField(repo, admin, {
    objectKey: "territory", key: "zzNote", label: "ZZ Note", dataType: "STRING", sensitivity: "INTERNAL",
  });
  return { repo, customField, ...made };
}

const auditCount = async (repo) => (await repo.listAuditEvents(TENANT, 500)).length;
const accessVersion = async (repo, principalId) => (await repo.getAccessVersion(TENANT, principalId))?.accessVersion ?? 0;

// ============================ definitions ============================

test("an identical Object metadata edit writes nothing and audits nothing", async () => {
  const { repo, object } = await world();
  const before = await auditCount(repo);
  const out = await updateObjectMetadata(repo, admin, { objectKey: "territory", label: object.label, labelPlural: object.labelPlural });
  assert.equal(await auditCount(repo), before, "no false mutation event");
  assert.equal(out.updatedAt, object.updatedAt, "the stored record was not touched");

  // and a real change still is one
  await updateObjectMetadata(repo, admin, { objectKey: "territory", label: "Sales Territory" });
  assert.equal(await auditCount(repo), before + 1);
});

test("an identical custom Field edit writes nothing and audits nothing", async () => {
  const { repo, customField } = await world();
  const before = await auditCount(repo);
  const out = await updateFieldDefinition(repo, admin, { fieldId: customField.id, label: customField.label, sensitivity: customField.sensitivity });
  assert.equal(await auditCount(repo), before);
  assert.equal(out.updatedAt, customField.updatedAt);
});

test("A FIELD EDIT NAMING ONLY key/dataType IS REFUSED — not answered 200 and audited", async () => {
  // The worst form of the defect: the caller asked to change identity and was told it worked.
  const { repo, customField } = await world();
  const before = await auditCount(repo);
  await assert.rejects(
    () => updateFieldDefinition(repo, admin, { fieldId: customField.id, key: "hijacked", dataType: "NUMBER" }),
    /nothing to update/,
  );
  assert.equal(await auditCount(repo), before);
});

test("an identical Role rename writes nothing and audits nothing — through the real API path", async () => {
  // updateRole's command lives in the dispatcher, so it is exercised there: a real bootstrapped
  // tenant, a real one-time administrator, and the same entry point the HTTP transport calls.
  const repo = new InMemoryPolicyRepository();
  const { tenant } = await bootstrapTenant(repo, { key: "noop-tenant", name: "No-op Tenant", actorUid: SYS });
  await bootstrapAdministrator(repo, { tenantId: tenant.id, externalSubject: "admin-subject", displayName: "Admin", performedBy: SYS, reason: "test" });
  const asAdmin = (operation, input) => ({ caller: { externalSubject: "admin-subject" }, operation, input });

  const created = await executeAdminOperation({ repo }, asAdmin("createRole", { key: "zz_noop", name: "ZZ No-op" }));
  assert.equal(created.ok, true);
  const role = created.data;
  const count = async () => (await repo.listAuditEvents(tenant.id, 500)).length;

  const before = await count();
  const same = await executeAdminOperation({ repo }, asAdmin("updateRole", { roleId: role.id, name: role.name }));
  assert.equal(same.ok, true, "an identical rename is not an error");
  assert.equal(await count(), before, "and it is not a mutation");
  assert.equal(same.data.updatedAt, role.updatedAt);

  const real = await executeAdminOperation({ repo }, asAdmin("updateRole", { roleId: role.id, name: "ZZ Renamed" }));
  assert.equal(real.ok, true);
  assert.equal(await count(), before + 1, "a real rename still is one");
});

// ============================ permissions: audit AND access version ============================

test("re-stating an Object CRED writes nothing, audits nothing, and bumps no holder", async () => {
  const { repo, role, holder } = await world();
  const cred = { C: false, R: true, E: true, D: false };
  await setObjectPermission(repo, admin, { roleId: role.id, objectKey: "territory", cred });
  const audit = await auditCount(repo);
  const version = await accessVersion(repo, holder.id);

  await setObjectPermission(repo, admin, { roleId: role.id, objectKey: "territory", cred: { ...cred } });
  assert.equal(await auditCount(repo), audit, "no false mutation event");
  assert.equal(await accessVersion(repo, holder.id), version, "no holder re-resolves authority that did not move");
});

test("the FIRST all-false Object CRED is still written — an absent row and a stored row differ", async () => {
  const { repo, role } = await world();
  const before = await auditCount(repo);
  await setObjectPermission(repo, admin, { roleId: role.id, objectKey: "territory", cred: { C: false, R: false, E: false, D: false } });
  assert.equal(await auditCount(repo), before + 1);
});

test("re-stating a Field override writes nothing, audits nothing, and bumps no holder", async () => {
  const { repo, role, holder, systemField } = await world();
  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: { R: false } });
  const audit = await auditCount(repo);
  const version = await accessVersion(repo, holder.id);

  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: { R: false } });
  assert.equal(await auditCount(repo), audit);
  assert.equal(await accessVersion(repo, holder.id), version);

  // A DIFFERENT partial override is a change: {R:false} and {R:false, E:true} are not the same fact.
  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: { R: false, E: true } });
  assert.equal(await auditCount(repo), audit + 1);
});

test("removing a Field override that does not exist is a no-op, not an audited removal", async () => {
  const { repo, role, holder, systemField } = await world();
  const audit = await auditCount(repo);
  const version = await accessVersion(repo, holder.id);
  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: {} });
  assert.equal(await auditCount(repo), audit);
  assert.equal(await accessVersion(repo, holder.id), version);
});

test("Inherit still DELETES a real override row, and that is still audited", async () => {
  // The no-op guard must not swallow the one removal that matters.
  const { repo, role, systemField } = await world();
  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: { R: false } });
  const audit = await auditCount(repo);
  await setFieldPermissionOverride(repo, admin, { roleId: role.id, fieldId: systemField.id, override: {} });
  assert.equal(await auditCount(repo), audit + 1);
  assert.equal((await repo.listFieldOverrides(TENANT, [role.id])).length, 0, "the row is gone");
});
