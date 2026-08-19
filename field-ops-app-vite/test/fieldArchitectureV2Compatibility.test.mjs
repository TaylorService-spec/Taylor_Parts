// v2 compatibility against the definitions that actually exist.
//
// The last clearing condition on the Field Architecture v2 gate is not more architecture
// — it is proof that the two merged v1 definitions map into v2 without losing meaning and
// without gaining invented meaning. Running it against the REAL definitions rather than
// fixtures is the point: a fixture would only prove fromV1() maps what a fixture author
// remembered to include.

import { test } from "node:test";
import assert from "node:assert/strict";
import { accountEntity } from "../src/metadata/definitions/account.js";
import { workOrderEntity } from "../src/metadata/definitions/workOrder.js";
import { fromV1, validateFieldV2, validateEntityFields, MIGRATION_UNKNOWN } from "../src/metadata/v2/fieldDefinitionV2.js";

const migrate = (entity) => entity.fields.map((f) => fromV1(f, { entitySystemName: entity.id }));

for (const entity of [accountEntity, workOrderEntity]) {
  test(`${entity.id}: every v1 field maps to a VALID v2 field`, () => {
    for (const f of migrate(entity)) {
      assert.deepEqual(validateFieldV2(f), [], `${entity.id}.${f.systemName}`);
    }
  });

  test(`${entity.id}: the migrated field set validates as a whole`, () => {
    // Catches duplicate systemNames and dependency cycles, neither of which a
    // field-at-a-time check would see.
    assert.deepEqual(validateEntityFields(migrate(entity), { at: entity.id }), []);
  });

  test(`${entity.id}: systemName carries v1's id forward unchanged`, () => {
    // v1's `id` was already a stable machine identity in everything but name, so the
    // migration must not RENAME anything — a rename here would break every merged
    // definition, index and test that references the field.
    assert.deepEqual(
      migrate(entity).map((f) => f.systemName),
      entity.fields.map((f) => f.id)
    );
  });

  test(`${entity.id}: storagePath initially matches systemName, and is a separate field`, () => {
    // They match today. The architecture requirement is that they CAN diverge, which is
    // only true if the value is stored twice rather than aliased.
    for (const f of migrate(entity)) assert.equal(f.storagePath, f.systemName);
  });

  test(`${entity.id}: labels survive the migration verbatim`, () => {
    assert.deepEqual(migrate(entity).map((f) => f.label), entity.fields.map((f) => f.label));
  });

  test(`${entity.id}: declared filter operators survive, so no promise is silently dropped`, () => {
    // A migration that quietly lost an operator would leave a list offering a filter the
    // v2 contract no longer claims — the promise-keeping rule broken by the migration
    // itself rather than by an author.
    for (const [i, f] of migrate(entity).entries()) {
      assert.deepEqual([...f.operators], [...entity.fields[i].operators], f.systemName);
    }
  });

  test(`${entity.id}: every migrated field records its unknowns rather than guessing`, () => {
    // v1 recorded no mutability and no write capability for anything, so every field must
    // say so. A field reporting NO gaps would mean the migration invented an answer.
    for (const f of migrate(entity)) {
      assert.ok(f.migrationGaps.includes(MIGRATION_UNKNOWN.MUTABILITY), f.systemName);
      assert.ok(f.migrationGaps.includes(MIGRATION_UNKNOWN.WRITE_CAPABILITY), f.systemName);
    }
  });
}

test("enum vocabulary survives, including the numeric one", () => {
  // Work Order priority is stored 1..4 and labelled with a word. A migration that
  // stringified the values would make the number unrecoverable.
  const priority = migrate(workOrderEntity).find((f) => f.systemName === "priority");
  assert.deepEqual([...priority.enumValues], [1, 2, 3, 4]);
  assert.equal(priority.enumLabels[1], "Emergency");
});

test("the multi-valued enum survives as ENUM_SET, not as a scalar", () => {
  const rel = migrate(accountEntity).find((f) => f.systemName === "relationshipTypes");
  assert.equal(rel.type, "ENUM_SET");
});

test("a REFERENCE keeps its target entity", () => {
  const customer = migrate(workOrderEntity).find((f) => f.systemName === "customerId");
  assert.equal(customer.type, "REFERENCE");
  assert.equal(customer.referenceTo, "account");
});

test("no migrated field claims to be DERIVED — v1 had no derived values to claim", () => {
  for (const entity of [accountEntity, workOrderEntity]) {
    for (const f of migrate(entity)) {
      assert.equal(f.fieldClass, "STANDARD", f.systemName);
      assert.equal(f.derivationType, null, f.systemName);
    }
  }
});
