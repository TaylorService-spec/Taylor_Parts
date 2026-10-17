from ed import edit
edit("scripts/exportCatalogSnapshot.js", [
("""//   * EXACT SOURCE ALLOWLIST: `parts`, `equipment_models` and `part_aliases`, nothing else (SOURCE_COLLECTIONS + assertAllowlisted).""",
"""//   * EXACT SOURCE ALLOWLIST: `parts`, `equipment_models`, `part_aliases` and `manufacturers`, nothing else
//     (SOURCE_COLLECTIONS + assertAllowlisted). `manufacturers` joined for Firebase exit F5 (2026-10-17), consumed by
//     scripts/manufacturerCopy.js; catalogCutover.js ignores the section."""),
("""// between. The allowlist is still EXACT -- three names, and `assertAllowlisted` refuses every other.
const SOURCE_COLLECTIONS = Object.freeze({ parts: "parts", equipmentModels: "equipment_models", partAliases: "part_aliases" });""",
"""// between. `manufacturers` joined on the same reasoning (Firebase exit F5): Parts name manufacturers. The allowlist is
// still EXACT -- four names, and `assertAllowlisted` refuses every other.
const SOURCE_COLLECTIONS = Object.freeze({
  parts: "parts", equipmentModels: "equipment_models", partAliases: "part_aliases", manufacturers: "manufacturers",
});"""),
("""  console.log(JSON.stringify({ projectId, out, parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length, sha256 }, null, 2));""",
"""  console.log(JSON.stringify({ projectId, out, parts: snapshot.parts.length, equipmentModels: snapshot.equipmentModels.length,
    partAliases: snapshot.partAliases.length, manufacturers: snapshot.manufacturers.length, sha256 }, null, 2));"""),
])
edit("test/catalogMaster.test.mjs", [
("""test("the exporter is explicitly marked as the migration-only exception and allowlists exactly three source collections", () => {""",
"""test("the exporter is explicitly marked as the migration-only exception and allowlists exactly four source collections", () => {"""),
("""  assert.deepEqual(Object.values(ex.SOURCE_COLLECTIONS), ["parts", "equipment_models", "part_aliases"]);
  assert.equal(ex.assertAllowlisted("parts"), "parts");
  assert.equal(ex.assertAllowlisted("part_aliases"), "part_aliases");""",
"""  // `manufacturers` joined for Firebase exit F5 (scripts/manufacturerCopy.js): Parts name manufacturers.
  assert.deepEqual(Object.values(ex.SOURCE_COLLECTIONS), ["parts", "equipment_models", "part_aliases", "manufacturers"]);
  assert.equal(ex.assertAllowlisted("parts"), "parts");
  assert.equal(ex.assertAllowlisted("part_aliases"), "part_aliases");
  assert.equal(ex.assertAllowlisted("manufacturers"), "manufacturers");"""),
])
