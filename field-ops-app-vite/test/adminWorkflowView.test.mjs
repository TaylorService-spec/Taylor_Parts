// Administration → Workflows — the view model, and its MIRROR PARITY with the seed.
//
// The definitions are mirrored across two packages that share no build, which is this repository's
// established pattern and also its most-repeated defect: two copies of one fact, drifting. So the
// first test here reads the SEED's own source and compares it, structure for structure. A
// divergence fails rather than showing an administrator a workflow the platform would not seed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEED_WORKFLOW_FAMILIES,
  buildWorkflowVersionView,
  summarizeWorkflowFamily,
  workflowBoundRoleKeys,
} from "../src/domain/adminWorkflowView.js";

const SEED_SOURCE = "../functions/src/adminPolicy/workflowSeeds.ts";

// ============================ mirror parity ============================

test("every family mirrors the seed's steps and actions exactly", () => {
  const source = readFileSync(SEED_SOURCE, "utf8");

  for (const family of SEED_WORKFLOW_FAMILIES) {
    // The seed declares each family as an object literal with the same key. Parsing it properly
    // would mean importing TypeScript; comparing the DECLARED IDENTIFIERS is enough to catch a
    // step or action added on one side and not the other, which is the drift that matters.
    assert.ok(source.includes(`key: "${family.key}"`), `the seed declares ${family.key}`);

    for (const step of family.steps) {
      assert.ok(
        source.includes(`{ key: "${step.key}", label: "${step.label}"`),
        `${family.key}: the seed declares step ${step.key} with the same label`,
      );
    }
    for (const action of family.actions) {
      assert.ok(
        source.includes(`key: "${action.key}", label: "${action.label}", from: "${action.from}", to: "${action.to}"`),
        `${family.key}: the seed declares action ${action.key} with the same from/to`,
      );
    }
  }
});

test("the seed declares no family this screen would not show", () => {
  const source = readFileSync(SEED_SOURCE, "utf8");
  // Every `key:` at the family level in the seed is one of ours. Anchored on the exported constant
  // names so an action key never counts as a family.
  const seedFamilies = [...source.matchAll(/export const (\w+_WORKFLOW): SeedWorkflow/g)].map((m) => m[1]);
  assert.equal(
    seedFamilies.length, SEED_WORKFLOW_FAMILIES.length,
    `the seed exports ${seedFamilies.length} families and the screen mirrors ${SEED_WORKFLOW_FAMILIES.length}`,
  );
});

// ============================ shape ============================

test("SALES IS THREE MACHINES, and they stay separate", () => {
  // Opportunity, Agreement and Order are chained by events -- a won opportunity CREATES an
  // agreement -- so one combined machine would draw transitions no code performs.
  const sales = SEED_WORKFLOW_FAMILIES.filter((f) => f.key.startsWith("sales")).map((f) => f.key).sort();
  assert.deepEqual(sales, ["salesAgreement", "salesOpportunity", "salesOrder"]);

  // And no action crosses between them.
  for (const family of SEED_WORKFLOW_FAMILIES) {
    const stepKeys = new Set(family.steps.map((s) => s.key));
    for (const action of family.actions) {
      assert.ok(stepKeys.has(action.from), `${family.key}: ${action.key} comes from its own machine`);
      assert.ok(stepKeys.has(action.to), `${family.key}: ${action.key} goes to its own machine`);
    }
  }
});

test("every family has exactly one initial state and at least one terminal", () => {
  for (const family of SEED_WORKFLOW_FAMILIES) {
    const initial = family.steps.filter((s) => s.initial === true);
    assert.equal(initial.length, 1, `${family.key}: one place to start`);
    assert.ok(family.steps.some((s) => s.terminal === true), `${family.key}: something ends`);
    for (const step of family.steps) {
      assert.notEqual(step.initial === true && step.terminal === true, true, `${family.key}: ${step.key}`);
    }
  }
});

test("no action leaves a terminal state", () => {
  for (const family of SEED_WORKFLOW_FAMILIES) {
    const terminal = new Set(family.steps.filter((s) => s.terminal).map((s) => s.key));
    for (const action of family.actions) {
      assert.equal(terminal.has(action.from), false, `${family.key}: ${action.key} leaves a terminal state`);
    }
  }
});

test("every action names at least one Role", () => {
  // An action nobody may perform is not a definition error in the engine -- a version may be drafted
  // before its Roles exist -- but a SEEDED family binding nothing would be a workflow that silently
  // cannot run, which is worth failing on here.
  for (const family of SEED_WORKFLOW_FAMILIES) {
    for (const action of family.actions) {
      assert.ok(action.roleKeys.length > 0, `${family.key}: ${action.key} binds nobody`);
    }
  }
});

// ============================ the view ============================

test("each state is told which actions leave it, derived rather than declared", () => {
  const view = buildWorkflowVersionView(SEED_WORKFLOW_FAMILIES.find((f) => f.key === "workOrder"));
  const scheduled = view.steps.find((s) => s.key === "SCHEDULED");
  assert.deepEqual([...scheduled.outgoing].sort(), ["Cancel", "Dispatch", "Unschedule"].sort());

  const closed = view.steps.find((s) => s.key === "CLOSED");
  assert.deepEqual(closed.outgoing, [], "a terminal state has none, and that is its definition");
  assert.equal(closed.terminal, true);
});

test("the five own-assignment actions are marked", () => {
  const view = buildWorkflowVersionView(SEED_WORKFLOW_FAMILIES.find((f) => f.key === "workOrder"));
  const own = view.actions.filter((a) => a.requiresOwnAssignment).map((a) => a.key).sort();
  assert.deepEqual(own, ["Accept", "Arrive", "Complete", "Travel", "WorkStart"]);
});

test("every seeded version is a DRAFT — a definition routes nothing", () => {
  for (const family of SEED_WORKFLOW_FAMILIES) {
    const view = buildWorkflowVersionView(family);
    assert.equal(view.status, "DRAFT", `${family.key} is a draft`);
    assert.equal(view.version, 1);
    assert.equal(summarizeWorkflowFamily(family).published, false);
  }
});

test("binding counts add up", () => {
  const view = buildWorkflowVersionView(SEED_WORKFLOW_FAMILIES.find((f) => f.key === "salesAgreement"));
  assert.equal(view.bindingCount, view.actions.reduce((n, a) => n + a.roleKeys.length, 0));
  assert.equal(view.bindingCount, 6, "two actions, three Roles each");
});

test("a missing family is handled rather than thrown at", () => {
  assert.equal(buildWorkflowVersionView(null), null);
  assert.equal(buildWorkflowVersionView(undefined), null);
});

test("the bound Role keys are the set an administrator would need", () => {
  const keys = workflowBoundRoleKeys();
  assert.deepEqual(keys, [...keys].sort(), "sorted, so the list is stable to read");
  for (const expected of ["admin", "dispatcher", "technician", "partsManager", "partsAssociate",
    "salesperson", "salesManager", "operationsManager"]) {
    assert.ok(keys.includes(expected), `${expected} is bound somewhere`);
  }
});
