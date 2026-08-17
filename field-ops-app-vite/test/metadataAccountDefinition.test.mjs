// Account entity + account.index list — the first real definitions.
//
// Until now the contracts were exercised only by fixtures written to exercise them.
// These assert the properties that matter once a definition describes a collection that
// actually exists and a surface people already use.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntityDefinition, findField } from "../src/metadata/entityDefinition.js";
import { validateListViewDefinition, requiredIndexes } from "../src/metadata/listViewDefinition.js";
import { accountEntity, accountIndexList } from "../src/metadata/definitions/account.js";
import { ACCOUNT_STATUS, ACCOUNT_STATUS_LABEL } from "../src/domain/constants.js";

test("the Account entity is valid against the contract", () => {
  assert.deepEqual(validateEntityDefinition(accountEntity), []);
});

test("the Customers list is valid against the entity", () => {
  assert.deepEqual(validateListViewDefinition(accountIndexList, accountEntity), []);
});

test("status labels come from domain/constants, not a second copy", () => {
  // Two label maps for one enum is how "0 Active" ended up beside a table of ACTIVE
  // rows (#1093) — the surfaces disagreed about what the stored value meant. A metadata
  // layer with its own copy would be the third opinion.
  const status = findField(accountEntity, "status");
  assert.equal(status.enumLabels[ACCOUNT_STATUS.ACTIVE], ACCOUNT_STATUS_LABEL[ACCOUNT_STATUS.ACTIVE]);
  assert.deepEqual([...status.enumValues].sort(), Object.values(ACCOUNT_STATUS).sort());
});

test("identity names a real field and claims no reference number", () => {
  // An Account has no reference number. Declaring one would license a surface to render
  // a document id in its place — the defect corrected on Sales Orders (#1124).
  assert.equal(accountEntity.identity.nameField, "name");
  assert.equal(accountEntity.identity.referenceField, null);
  assert.ok(findField(accountEntity, "name"), "the identity field exists on the entity");
});

test("tags are renderable but claim no filter operator", () => {
  // A declared operator is a promise the query layer must keep. array-contains combined
  // with a sort needs its own composite index; claiming it before declaring that index
  // is exactly the promise §9 forbids.
  const tags = findField(accountEntity, "tags");
  assert.deepEqual(tags.operators, []);
  assert.equal(tags.filterable, false);
  assert.ok(accountIndexList.columns.some((c) => c.fieldId === "tags"), "still rendered as a column");
});

test("every declared filter names a field that declares the same operators", () => {
  for (const filter of accountIndexList.filters) {
    const field = findField(accountEntity, filter.fieldId);
    assert.ok(field, `filter ${filter.fieldId} names a real field`);
    for (const op of filter.operators) {
      assert.ok(field.operators.includes(op), `${filter.fieldId} field declares ${op}`);
    }
  }
});

test("the landing view is recently-viewed, not everything", () => {
  // At 250,000 accounts an unfiltered first page answers nobody's question.
  const landing = accountIndexList.savedViews.find((v) => v.isDefault);
  assert.equal(landing.kind, "RECENTLY_VIEWED");
});

test("the demanded index is expressed in Firestore's vocabulary, ready to declare", () => {
  const [idx] = requiredIndexes(accountIndexList, accountEntity);
  assert.equal(idx.collectionGroup, "accounts");
  for (const field of idx.fields) {
    assert.ok(["ASCENDING", "DESCENDING"].includes(field.order), `${field.fieldPath} order is Firestore's spelling`);
  }
});
