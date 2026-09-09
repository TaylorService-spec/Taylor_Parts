// OBJECT AND FIELD DEFINITION EDITING — the server's half of the Administration correction.
//
// Two things this file exists to hold:
//
//   1. A SYSTEM field's DEFINITION is protected. It used to be protected only in `lifecycle`, which
//      left label, description, required, searchable, sortable, reportable and sensitivity all
//      editable on a field application code reads by name. `sensitivity` in particular is read by
//      the field-projection path, so "just a label change" was never just a label change.
//
//   2. Object DISPLAY metadata is editable, and nothing else about an Object is. There was no
//      operation at all before this, while the Administration contract said Object definition
//      editing was Admin-only -- a contract with nothing behind it.
//
// Enforced next to the transaction rather than by hiding a button: a caller reaching the command
// directly gets the same refusal the UI would have prevented.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  createCustomField,
  updateFieldDefinition,
  updateObjectMetadata,
} from "../lib/adminPolicy/policyCommands.js";

const TENANT = "tenant-def";
const SYS = "uid-seed";
const admin = { tenantId: TENANT, uid: "uid-admin", heldRoleKeys: ["admin"] };
const plain = { tenantId: TENANT, uid: "uid-plain", heldRoleKeys: ["technician"] };

/** One object with one SYSTEM field, built through the store the way the seed would. */
async function world() {
  const repo = new InMemoryPolicyRepository();
  const made = await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    const object = await tx.createObject({
      key: "account", label: "Accounts", labelPlural: "Customers",
      description: "A customer or vendor relationship.",
      origin: "SYSTEM", lifecycle: "ACTIVE", supportsDelete: false,
    });
    const systemField = await tx.createField({
      objectId: object.id, key: "name", label: "Customer", description: null, dataType: "STRING",
      required: true, allowedValues: [], defaultValue: null, searchable: true, sortable: true,
      reportable: true, sensitivity: "NORMAL", referenceTo: null, origin: "SYSTEM", lifecycle: "ACTIVE",
    });
    return { object, systemField };
  });
  return { repo, ...made };
}

// ============================ SYSTEM field definitions are protected ============================

test("EVERY part of a SYSTEM field's definition is refused, not just its lifecycle", async () => {
  const { repo, systemField } = await world();

  for (const patch of [
    { label: "Renamed" },
    { description: "changed" },
    { required: false },
    { searchable: false },
    { sortable: false },
    { reportable: false },
    { sensitivity: "RESTRICTED" },
    { lifecycle: "RETIRED" },
  ]) {
    await assert.rejects(
      () => updateFieldDefinition(repo, admin, { fieldId: systemField.id, ...patch }),
      /SYSTEM field's definition is protected/,
      `${Object.keys(patch)[0]} must be refused`,
    );
  }
});

test("the refusal is the SERVER's, not a hidden button", async () => {
  // The UI offers no Edit affordance on a SYSTEM field. That is courtesy, not enforcement: this is
  // the direct call the UI would have prevented, and it is still refused.
  const { repo, systemField } = await world();
  await assert.rejects(
    () => updateFieldDefinition(repo, admin, { fieldId: systemField.id, label: "Straight at the command" }),
    /protected/,
  );

  // And nothing moved.
  const [object] = await repo.listObjects(TENANT);
  const fields = await repo.listFields(TENANT, object.id);
  assert.equal(fields.find((f) => f.id === systemField.id).label, "Customer");
});

test("a CUSTOM field on the same object stays fully editable", async () => {
  // The rule is about ORIGIN, not about making the screen read-only. If this failed, the tightening
  // would have turned a protection into a lockout.
  const { repo } = await world();
  const custom = await createCustomField(repo, admin, {
    objectKey: "account", key: "loyaltyTier", label: "Loyalty Tier", dataType: "STRING",
  });

  const updated = await updateFieldDefinition(repo, admin, {
    fieldId: custom.id,
    label: "Loyalty Band",
    description: "Which loyalty band this customer sits in",
    required: true,
    searchable: true,
    sortable: true,
    reportable: false,
    sensitivity: "INTERNAL",
    lifecycle: "ACTIVE",
  });

  assert.equal(updated.label, "Loyalty Band");
  assert.equal(updated.sensitivity, "INTERNAL");
  assert.equal(updated.required, true);
  assert.equal(updated.reportable, false);
  // Identity and type are untouched: they are not in the input at all.
  assert.equal(updated.key, "loyaltyTier");
  assert.equal(updated.dataType, "STRING");
});

test("a custom field's key and dataType are not expressible as an edit", async () => {
  const { repo } = await world();
  const custom = await createCustomField(repo, admin, {
    objectKey: "account", key: "tier", label: "Tier", dataType: "STRING",
  });

  // Sent anyway, the way a hand-written client would. `UpdateFieldInput` has no such members, so
  // they are ignored rather than applied -- changing either is a data migration, not an edit.
  const updated = await updateFieldDefinition(repo, admin, {
    fieldId: custom.id, key: "somethingElse", dataType: "NUMBER", label: "Tier",
  });
  assert.equal(updated.key, "tier");
  assert.equal(updated.dataType, "STRING");
});

// ============================ Object display metadata ============================

test("an Object's display metadata is editable", async () => {
  const { repo, object } = await world();

  const updated = await updateObjectMetadata(repo, admin, {
    objectKey: "account",
    label: "Customers",
    labelPlural: "Customers",
    description: "What the business calls them.",
  });

  assert.equal(updated.label, "Customers");
  assert.equal(updated.description, "What the business calls them.");
  // Identity and the enforcement facts are untouched.
  assert.equal(updated.key, object.key);
  assert.equal(updated.origin, "SYSTEM");
  assert.equal(updated.supportsDelete, false);
  assert.equal(updated.lifecycle, "ACTIVE");
});

test("a partial edit does not erase the fields it does not name", async () => {
  // The commonest way an edit form loses data: sending one field and nulling the rest.
  const { repo } = await world();
  const updated = await updateObjectMetadata(repo, admin, { objectKey: "account", label: "Accounts (renamed)" });
  assert.equal(updated.label, "Accounts (renamed)");
  assert.equal(updated.labelPlural, "Customers", "untouched");
  assert.equal(updated.description, "A customer or vendor relationship.", "untouched");
});

test("an empty edit is refused rather than written as a no-op", async () => {
  const { repo } = await world();
  await assert.rejects(
    () => updateObjectMetadata(repo, admin, { objectKey: "account" }),
    /nothing to update/,
  );
});

test("Object metadata editing is ADMIN ONLY", async () => {
  const { repo } = await world();
  await assert.rejects(
    () => updateObjectMetadata(repo, plain, { objectKey: "account", label: "Nope" }),
    /not authorized/,
  );
  const [object] = await repo.listObjects(TENANT);
  assert.equal(object.label, "Accounts", "and nothing changed");
});

test("an unknown object is refused", async () => {
  const { repo } = await world();
  await assert.rejects(
    () => updateObjectMetadata(repo, admin, { objectKey: "notAnObject", label: "x" }),
    /no object "notAnObject"/,
  );
});

test("the edit writes ONE audit event carrying before and after", async () => {
  const { repo } = await world();
  const before = await repo.listAuditEvents(TENANT, 100);

  await updateObjectMetadata(repo, admin, { objectKey: "account", label: "Customers" });

  const after = await repo.listAuditEvents(TENANT, 100);
  const created = after.filter((e) => !before.some((b) => b.id === e.id));
  assert.equal(created.length, 1);
  assert.equal(created[0].action, "updateObjectMetadata");
  assert.equal(created[0].targetKind, "object");
  assert.equal(created[0].actorUid, admin.uid);
  assert.equal(created[0].before.label, "Accounts", "what it was");
  assert.equal(created[0].after.label, "Customers", "and what it became");
});

test("a refused edit writes NO audit event", async () => {
  const { repo } = await world();
  const before = await repo.listAuditEvents(TENANT, 100);
  await assert.rejects(() => updateObjectMetadata(repo, plain, { objectKey: "account", label: "Nope" }));
  const after = await repo.listAuditEvents(TENANT, 100);
  assert.equal(after.length, before.length);
});
