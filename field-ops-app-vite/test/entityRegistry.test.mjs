// THE ENTITY REGISTRY — its coverage proof.
//
// A registry assembled by hand drifts the moment somebody adds a definition file and forgets the
// import. This reads the definitions directory and compares, so forgetting fails here rather than
// showing an Administration screen that quietly omits an object.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { ENTITY_REGISTRY, displayableFields, findEntityById, totalDeclaredFields } from "../src/metadata/entityRegistry.js";

const DEFINITIONS_DIR = "src/metadata/definitions";

/** Every `export const <name>Entity = makeEntityDefinition(` in the definitions directory. */
function declaredEntityExports() {
  const found = [];
  for (const file of readdirSync(DEFINITIONS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = readFileSync(`${DEFINITIONS_DIR}/${file}`, "utf8");
    for (const match of source.matchAll(/export const (\w+)\s*=\s*makeEntityDefinition\(/g)) {
      found.push({ file, exportName: match[1] });
    }
  }
  return found;
}

test("every declared EntityDefinition is in the registry", () => {
  const declared = declaredEntityExports();
  assert.equal(
    ENTITY_REGISTRY.length, declared.length,
    `${declared.length} definitions exist and ${ENTITY_REGISTRY.length} are registered -- add the missing import`,
  );
});

test("the registry holds real, distinct entities", () => {
  const ids = ENTITY_REGISTRY.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "no entity is registered twice");
  for (const entity of ENTITY_REGISTRY) {
    assert.ok(entity.id, "every entity has an id");
    assert.ok(entity.label, `${entity.id} has a label`);
    assert.ok(Array.isArray(entity.fields), `${entity.id} has fields`);
  }
});

test("lookups answer, and an unknown id is a question rather than a fault", () => {
  assert.equal(findEntityById("account")?.id, "account");
  assert.equal(findEntityById("nosuchthing"), null, "unknown returns null, never throws");
  assert.equal(findEntityById(undefined), null);
});

test("displayableFields excludes the fields no surface can render", () => {
  // A field may be DECLARED so its meaning and gaps are recorded, without being offered as a
  // column. Offering one in a permissions grid would invite configuring access to something nothing
  // shows.
  for (const entity of ENTITY_REGISTRY) {
    const offered = displayableFields(entity);
    assert.ok(offered.length <= entity.fields.length);
    assert.ok(offered.every((f) => f.displayable !== false));
  }
  assert.deepEqual(displayableFields(null), [], "a missing entity yields no fields, not a crash");
});

test("the declared field count is what the census measured", () => {
  // 394 across 29 entities. Pinned so a change to the model is a deliberate edit to this number
  // rather than something that drifts past the reconciliation document unnoticed.
  assert.equal(ENTITY_REGISTRY.length, 29);
  assert.equal(totalDeclaredFields(), 394);
});
