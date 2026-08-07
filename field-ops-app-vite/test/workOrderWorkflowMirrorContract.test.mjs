import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  canTransitionWorkOrder,
  getAllowedActions,
} from "../src/domain/workOrderWorkflow.js";

/**
 * F0 — contract test for the client mirror of the Work Order state machine.
 *
 * `domain/workOrderWorkflow.js` duplicates `functions/src/transitionEngine.ts`'s
 * TRANSITIONS table and permission matrix so the UI can disable invalid actions
 * without a round trip. Both files say "if either changes, change the other" --
 * but until now that was enforced by a COMMENT. A silent divergence would let
 * the UI offer an action the server rejects, or hide one it would allow.
 *
 * This test parses the server file as the source of truth and asserts the
 * client's BEHAVIOUR matches it for every (status, nextStatus) pair and every
 * (status, role, isOwnAssignment) combination. Behaviour rather than table
 * shape, so the client stays free to represent the tables however it likes.
 *
 * The server is TypeScript and this runner is plain node, so the tables are
 * extracted from source text rather than imported. Comments are stripped first
 * -- a doc comment in this repo has previously matched a naive scan and
 * produced a wrong result.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = resolve(HERE, "../../functions/src/transitionEngine.ts");

/** Strip // and block comments so prose can never be parsed as code. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Extract `export const NAME: ... = { ... };` as a JS value. */
function extractObject(src, name) {
  const start = src.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `${name} not found in transitionEngine.ts`);
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `unbalanced braces reading ${name}`);
  const body = src.slice(open, end + 1);
  // Quote bare keys, drop trailing commas, then evaluate as an expression.
  const jsonish = body
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(jsonish.replace(/'/g, '"'));
}

const server = stripComments(readFileSync(SERVER_SRC, "utf8"));
const TRANSITIONS = extractObject(server, "TRANSITIONS");
const ACTION_TO_STATUS = extractObject(server, "ACTION_TO_STATUS");
const ACTION_PERMISSIONS = extractObject(server, "ACTION_PERMISSIONS");

const STATUSES = Object.keys(TRANSITIONS);
const ACTIONS = Object.keys(ACTION_TO_STATUS);
const ROLES = ["admin", "dispatcher", "technician"];

test("the parse actually found the server tables (guards against a silent empty parse)", () => {
  assert.ok(STATUSES.length >= 10, `expected the full status set, got ${STATUSES.length}`);
  assert.ok(ACTIONS.length >= 9, `expected the full action set, got ${ACTIONS.length}`);
  assert.equal(Object.keys(ACTION_PERMISSIONS).length, ACTIONS.length,
    "every action must carry a permission entry");
  // Spot-check a value the field lifecycle depends on.
  assert.deepEqual(TRANSITIONS.ARRIVED, ["WORK_IN_PROGRESS", "CANCELLED"]);
});

test("client canTransitionWorkOrder matches the server TRANSITIONS table exactly", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = TRANSITIONS[from].includes(to);
      assert.equal(
        canTransitionWorkOrder(from, to), expected,
        `${from} -> ${to}: client says ${!expected}, server says ${expected}`,
      );
    }
  }
});

test("client getAllowedActions matches the server permission matrix for every case", () => {
  for (const status of STATUSES) {
    for (const role of ROLES) {
      for (const isOwn of [true, false]) {
        const expected = ACTIONS.filter((action) => {
          const next = ACTION_TO_STATUS[action];
          if (!TRANSITIONS[status].includes(next)) return false;
          const perm = ACTION_PERMISSIONS[action];
          if (!perm.roles.includes(role)) return false;
          if (perm.requiresOwnAssignment && !isOwn) return false;
          return true;
        }).sort();
        const actual = [...getAllowedActions(status, role, isOwn)].sort();
        assert.deepEqual(actual, expected,
          `status=${status} role=${role} own=${isOwn}`);
      }
    }
  }
});

// F0 depends on these specific guarantees, so they are asserted by name rather
// than only implied by the exhaustive sweep above.
test("the technician field lifecycle is exactly Accept/Travel/Arrive/WorkStart/Complete", () => {
  const technicianActions = ACTIONS.filter((a) => ACTION_PERMISSIONS[a].roles.includes("technician"));
  assert.deepEqual(technicianActions.sort(),
    ["Accept", "Arrive", "Complete", "Travel", "WorkStart"].sort());
  for (const a of technicianActions) {
    assert.equal(ACTION_PERMISSIONS[a].requiresOwnAssignment, true,
      `${a} must require own assignment -- a technician must never act on another's Work Order`);
  }
});

test("a technician is offered nothing on a Work Order that is not theirs", () => {
  for (const status of STATUSES) {
    assert.deepEqual(getAllowedActions(status, "technician", false), [],
      `status=${status}: technician got actions on an unassigned Work Order`);
  }
});

test("each field step is reachable only from its predecessor", () => {
  const chain = [
    ["DISPATCHED", "Accept"],
    ["ACCEPTED", "Travel"],
    ["EN_ROUTE", "Arrive"],
    ["ARRIVED", "WorkStart"],
    ["WORK_IN_PROGRESS", "Complete"],
  ];
  for (const [status, action] of chain) {
    assert.ok(getAllowedActions(status, "technician", true).includes(action),
      `${action} must be available to the assigned technician at ${status}`);
    for (const other of STATUSES) {
      if (other === status) continue;
      assert.ok(!getAllowedActions(other, "technician", true).includes(action),
        `${action} must NOT be available at ${other}`);
    }
  }
});
