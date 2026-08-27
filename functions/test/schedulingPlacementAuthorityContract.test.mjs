// ND-24 -- the structural half of the fix.
//
// The emulator suite (test/e2e/schedulingPlacementSymmetryEmulator.test.mjs) proves the two placement
// paths BEHAVE the same today. This file proves they are WIRED so they cannot stop.
//
// The distinction matters because of how the defect actually happened. Nobody wrote a second,
// disagreeing policy. `checkPlacement` was simply defined as a private function inside
// schedulingCommands.ts, which made it reachable only by the callers who happened to live in that
// module -- and transitionWorkOrder did not. The policy and the path that needed it were correct in
// isolation and never introduced to each other. A behavioural test would have caught the symptom; it
// would not have stopped the next placement path from being added the same way.
//
// So this suite reads the SOURCE and asserts the shape:
//
//   1. There is exactly ONE definition of checkPlacement, and it is in placementPolicy.ts.
//   2. Every placement path reaches it by import. Not by copy.
//   3. No placement path reimplements a refusal the policy owns.
//
// Source parsing rather than imports, deliberately: this is the same technique
// workOrderWorkflowMirrorContract.test.mjs already uses to hold the three transition tables in sync,
// and it is the only way to assert the ABSENCE of a second implementation. Importing a module tells
// you what it exports; only reading it tells you what it duplicates.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8");

const POLICY = "scheduling/placementPolicy.ts";

/**
 * Every module that decides where a Work Order may be placed.
 *
 * Adding a placement path means adding it here, and the suite then holds it to the same contract.
 * That is the point: the cost of a new entry point is one line in this list, and the cost of
 * forgetting is a red test rather than a defect a live gate finds months later.
 */
const PLACEMENT_PATHS = [
  { file: "transitionWorkOrder.ts", what: "the initial Schedule transition" },
  { file: "scheduling/schedulingCommands.ts", what: "reschedule and reassign" },
];

/**
 * Refusals the placement policy owns. A placement path that constructs one of these itself has
 * started keeping its own copy of the table, which is the defect returning in its original costume.
 *
 * `TECHNICIAN_NOT_FOUND` is deliberately NOT in this list, though the policy does raise it. The
 * availability commands (`setTechnicianWorkingAvailability`, `createTechnicianBlockedTime`) raise it
 * too, and legitimately: they are checking that the technician whose HOURS are being recorded exists,
 * which is not a placement decision and shares nothing with one but a message. Listing it here would
 * make this suite fail on correct code, and a contract test that cries wolf gets deleted.
 */
const POLICY_OWNED_REFUSALS = [
  "START_IN_PAST",
  "BLOCKED_TIME_CONFLICT",
  "TECHNICIAN_INELIGIBLE",
  "SCHEDULE_CONFLICT",
];

/** Raised by the policy, but not exclusively — see the note above. Still must exist there. */
const POLICY_REFUSALS_SHARED_WITH_OTHER_COMMANDS = ["TECHNICIAN_NOT_FOUND"];

test("the placement policy defines checkPlacement and exports it", () => {
  const policy = read(POLICY);
  assert.match(policy, /export async function checkPlacement\(/, `${POLICY} must export checkPlacement`);
});

test("checkPlacement is defined in exactly one place", () => {
  for (const { file, what } of PLACEMENT_PATHS) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /(async )?function checkPlacement\s*\(/,
      `${file} (${what}) defines its own checkPlacement. There must be exactly one, in ${POLICY} — ` +
        "a second copy is ND-24 reintroduced.",
    );
  }
});

test("every placement path imports the shared policy", () => {
  for (const { file, what } of PLACEMENT_PATHS) {
    const source = read(file);
    assert.match(
      source,
      /import \{[^}]*\bcheckPlacement\b[^}]*\} from "[^"]*placementPolicy"/,
      `${file} (${what}) must import checkPlacement from the shared placement policy`,
    );
  }
});

test("every placement path actually calls the shared policy", () => {
  // Importing it and not calling it would satisfy the test above and reintroduce the defect exactly.
  for (const { file, what } of PLACEMENT_PATHS) {
    const source = read(file);
    assert.match(
      source,
      /\bcheckPlacement\(\s*tx\s*,/,
      `${file} (${what}) imports checkPlacement but never calls it inside a transaction`,
    );
  }
});

test("no placement path constructs a refusal the policy owns", () => {
  for (const { file, what } of PLACEMENT_PATHS) {
    const source = read(file);
    for (const code of POLICY_OWNED_REFUSALS) {
      assert.doesNotMatch(
        source,
        new RegExp(`new SchedulingError\\(\\s*"${code}"`),
        `${file} (${what}) raises ${code} itself. That refusal belongs to ${POLICY}; raising it here is ` +
          "a second implementation of the collision policy.",
      );
    }
  }
});

test("the policy owns every refusal ND-20 assigns to a placement", () => {
  // The mirror of the assertion above: the codes must actually live SOMEWHERE, and that somewhere is
  // the policy. Without this, deleting a refusal outright would make the previous test pass.
  const policy = read(POLICY);
  for (const code of [...POLICY_OWNED_REFUSALS, ...POLICY_REFUSALS_SHARED_WITH_OTHER_COMMANDS]) {
    assert.match(
      policy,
      new RegExp(`new SchedulingError\\(\\s*"${code}"`),
      `${POLICY} no longer refuses ${code}. ND-20 assigns it to every placement.`,
    );
  }
});

test("the placement policy performs no writes", () => {
  // It runs inside its callers' transactions, in the read phase, before their writes. A write here
  // would make every caller's write ordering the policy's problem, and Firestore's
  // all-reads-before-writes rule would start failing in whichever caller was unlucky.
  const policy = read(POLICY);
  for (const write of ["tx.set(", "tx.update(", "tx.create(", "tx.delete("]) {
    assert.ok(!policy.includes(write), `${POLICY} must be read-only, found ${write}`);
  }
});

test("there is one past-start tolerance, and the policy owns it", () => {
  const policy = read(POLICY);
  assert.match(policy, /export const PAST_START_TOLERANCE_MS = /, `${POLICY} must define the tolerance`);
  for (const { file } of PLACEMENT_PATHS) {
    assert.doesNotMatch(
      read(file),
      /^export const PAST_START_TOLERANCE_MS = \d/m,
      `${file} redeclares PAST_START_TOLERANCE_MS. Two tolerances is two policies.`,
    );
  }
});

test("Schedule returns the policy's warnings rather than discarding them", () => {
  // ND-20's warnings are not refusals, so nothing fails if a caller drops them — the placement still
  // commits and the dispatcher simply never learns the job is outside the technician's hours. A
  // silent loss is exactly the kind of thing only a contract test catches.
  const source = read("transitionWorkOrder.ts");
  assert.match(
    source,
    /scheduleWarnings\s*=\s*await checkPlacement\(/,
    "transitionWorkOrder must capture the policy's warnings",
  );
  assert.match(
    source,
    /return \{[^}]*warnings: scheduleWarnings/,
    "transitionWorkOrder must return the captured warnings to the caller",
  );
});

test("Schedule maps policy refusals through the shared sanitized table", () => {
  // An unmapped SchedulingError escaping the transaction reaches the caller as a generic `internal`
  // 500 — telling a dispatcher the system is broken when the truthful answer is "that technician has
  // PTO then". Both placement paths must sanitize through the same table so a refusal reads the same
  // whichever produced it.
  const source = read("transitionWorkOrder.ts");
  assert.match(source, /from "\.\/scheduling\/errorMapping"/, "must import the shared error table");
  assert.match(
    source,
    /if \(err instanceof SchedulingError\) throw mapSchedulingError\(err\)/,
    "must map SchedulingError refusals rather than letting them collapse to internal",
  );
});
