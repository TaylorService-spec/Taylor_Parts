import { describe, expect, it } from "vitest";
import { validateListViewDefinition } from "../src/metadata/listViewDefinition.js";
import { validateEntityDefinition } from "../src/metadata/entityDefinition.js";

// EVERY REAL DEFINITION, PUT THROUGH ITS OWN VALIDATOR.
//
// `validateListViewDefinition` and `validateEntityDefinition` were written to catch a definition
// that names a read it cannot actually perform -- an unregistered callable, a scope that does not
// match the surface, a sortable column the backing source offers no sort for. Until this file
// existed, NOTHING CALLED EITHER ONE over the definitions the app actually ships. They were
// exercised only against hand-built fixtures inside other tests, so a real definition could
// declare anything at all and every suite stayed green; the first thing to notice would have been
// a user opening the list.
//
// That is the same X-UNCONSUMED-DECLARATION-PATTERN defect the validators themselves were written
// to close, one layer further out: a check that runs on nothing checks nothing. Measured directly
// -- deleting a registered sort from the governed read registry left all 3,286 client tests
// passing -- which is what prompted this file.
//
// It enumerates the definitions by GLOB rather than by a hand-written list, so a definition file
// added later is covered the day it lands instead of the day someone remembers to add it here.
const modules = import.meta.glob("../src/metadata/definitions/*.js", { eager: true });

const entities = [];
const lists = [];
for (const [path, mod] of Object.entries(modules)) {
  for (const [exportName, value] of Object.entries(mod)) {
    if (!value || typeof value !== "object") continue;
    // An entity declares `fields`; a list view declares `columns` and the `entityId` it lists.
    // Shape-sniffing rather than name-matching, so a definition that does not follow the
    // `<name>Entity` / `<name>IndexList` convention is still covered.
    if (Array.isArray(value.fields) && value.id && !value.entityId) entities.push({ path, exportName, value });
    else if (Array.isArray(value.columns) && value.entityId) lists.push({ path, exportName, value });
  }
}

const entityById = new Map(entities.map((e) => [e.value.id, e.value]));

// EVERY relationship from EVERY entity, not just the listed entity's own.
//
// A RELATED list is declared on the CHILD (contactRelatedList lists contacts) while the
// relationship that scopes it is declared on the PARENT (account.js's `account.contacts`). Passing
// only `entity.relationships` therefore fails four real, correct definitions for a reason that is
// entirely an artifact of how this test gathers them -- and a test that fails on correct input
// gets muted, which would take the governed-source checks down with it.
const allRelationships = entities.flatMap((e) => e.value.relationships ?? []);

describe("every shipped metadata definition passes its own validator", () => {
  it("finds the definitions at all", () => {
    // Guards the glob itself. If the path or the export shapes change, the two suites below would
    // silently validate an empty list and pass -- the exact failure mode this file exists to end.
    expect(entities.length).toBeGreaterThan(15);
    expect(lists.length).toBeGreaterThan(10);
  });

  for (const { path, exportName, value } of entities) {
    it(`${exportName} (${path.split("/").pop()}) is a valid entity`, () => {
      expect(validateEntityDefinition(value)).toEqual([]);
    });
  }

  for (const { path, exportName, value } of lists) {
    it(`${exportName} (${path.split("/").pop()}) is a valid list view`, () => {
      const entity = entityById.get(value.entityId);
      // A list naming an entity no definition file exports cannot be validated at all, and
      // reporting that as "valid" would be the same lie as not running the validator.
      expect(entity, `no entity "${value.entityId}" is exported by any definition module`).toBeTruthy();
      // Joined into ONE string rather than compared as an array: a failing array comparison
      // prints "expected [ Array(2) ] to deeply equal []" and hides the problems themselves,
      // which are the only part anyone reading the failure needs.
      expect(validateListViewDefinition(value, entity, allRelationships).join("\n")).toBe("");
    });
  }
});
