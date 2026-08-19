// Seeded duplicate ruleset -- shape and combination semantics.
//
// The rules themselves are DATA an admin will edit, so this does not assert that
// any particular rule exists forever. It pins the things a later edit could break
// silently: how several rules on one object combine, that blocking cannot be
// cancelled by a permissive rule, and that a deactivated rule really is off.
import assert from "node:assert/strict";
import {
  MATCH_METHODS,
  RULE_OBJECTS,
  SEEDED_RULES,
  rulesForObject,
  objectsWithActiveRules,
  describeCriteria,
  strongestAction,
  resolveAction,
} from "../src/domain/duplicateRules.js";

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    throw err;
  }
}

console.log("duplicateRules.test.mjs");

ok("every seeded rule names a registered object and only known match methods", () => {
  const objectIds = new Set(RULE_OBJECTS.map((o) => o.id));
  for (const rule of SEEDED_RULES) {
    assert.ok(objectIds.has(rule.objectId), `${rule.id} targets unknown object ${rule.objectId}`);
    assert.ok(rule.criteria.length > 0, `${rule.id} has no criteria`);
    for (const c of rule.criteria) {
      assert.ok(MATCH_METHODS[c.method], `${rule.id} uses unknown match method ${c.method}`);
    }
  }
});

ok("every rule states an action for BOTH create and edit", () => {
  // Editing a record into collision is "becoming a duplicate" too; a rule that
  // only covers create would leave that path silently unguarded.
  for (const rule of SEEDED_RULES) {
    for (const phase of ["onCreate", "onEdit"]) {
      assert.ok(rule[phase], `${rule.id} has no ${phase}`);
      assert.ok(["allow", "block"].includes(rule[phase].action), `${rule.id}.${phase} action is invalid`);
    }
  }
});

ok("every rule carries the message a person will actually see", () => {
  for (const rule of SEEDED_RULES) {
    assert.equal(typeof rule.alertText, "string");
    assert.ok(rule.alertText.trim().length > 0, `${rule.id} has no alert text`);
  }
});

ok("matchBlanks is off on every seeded criterion", () => {
  // Two records both missing a phone number are not thereby similar. This is the
  // commonest false-positive source, so the default is asserted rather than assumed.
  for (const rule of SEEDED_RULES) {
    for (const c of rule.criteria) {
      assert.equal(c.matchBlanks, false, `${rule.id}/${c.fieldId} matches blanks`);
    }
  }
});

ok("Parts need two rules because the actions differ -- block, then warn", () => {
  // This is why one-rule-per-object could not be the model: the action belongs to
  // the rule, so two actions require two rules.
  const part = rulesForObject("part");
  assert.equal(part.length, 2);
  assert.equal(strongestAction(part[0]), "block");
  assert.equal(strongestAction(part[1]), "allow");
});

ok("the manufacturer part-number rule requires the manufacturer too", () => {
  // A manufacturer's number alone means nothing -- two makers can ship a part
  // numbered X-100 and those are genuinely different parts.
  const rule = SEEDED_RULES.find((r) => r.id === "part-manufacturer-number");
  const fields = rule.criteria.map((c) => c.fieldId).sort();
  assert.deepEqual(fields, ["manufacturerId", "manufacturerPartNumber"]);
  assert.match(rule.logic, /AND/);
});

ok("rules on one object OR together: any match is a suspected duplicate", () => {
  const [first, second] = rulesForObject("account");
  assert.ok(resolveAction([first]), "one rule matching is enough");
  assert.ok(resolveAction([second]), "the other rule matching is also enough");
});

ok("when rules disagree the STRONGEST action wins -- allow cannot cancel block", () => {
  const part = rulesForObject("part");
  const verdict = resolveAction(part, "onCreate");
  assert.equal(verdict.action, "block");
  assert.deepEqual(verdict.matchedRuleIds, ["part-internal-number", "part-manufacturer-number"]);
});

ok("a deactivated rule is genuinely off, even when it would have blocked", () => {
  // Deactivating is how an admin turns a rule off; if a blocking rule kept
  // blocking while switched off, the screen would be lying.
  const [blocking, warning] = rulesForObject("part");
  const verdict = resolveAction([{ ...blocking, active: false }, warning], "onCreate");
  assert.equal(verdict.action, "allow");
  assert.deepEqual(verdict.matchedRuleIds, ["part-manufacturer-number"]);
});

ok("no active rule at all produces no verdict, not a permissive one", () => {
  const off = rulesForObject("part").map((r) => ({ ...r, active: false }));
  assert.equal(resolveAction(off, "onCreate"), null);
  assert.equal(resolveAction([], "onCreate"), null);
});

ok("criteria descriptions use the rule's own logic -- an OR never reads as an AND", () => {
  const orRule = SEEDED_RULES.find((r) => r.id === "account-address-phone");
  const andRule = SEEDED_RULES.find((r) => r.id === "contact-name-phone");
  assert.match(describeCriteria(orRule), / or /);
  assert.match(describeCriteria(andRule), / and /);
});

ok("objectsWithActiveRules counts objects, not rules", () => {
  // Parts and Accounts have two rules each; the headline number must not double-count.
  assert.equal(objectsWithActiveRules(), new Set(SEEDED_RULES.filter((r) => r.active).map((r) => r.objectId)).size);
  assert.ok(objectsWithActiveRules() <= RULE_OBJECTS.length);
});

console.log(`\n${passed} passed, 0 failed`);
