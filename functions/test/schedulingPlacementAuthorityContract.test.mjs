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

/**
 * Exported commands that live in a placement path's FILE but are not themselves placement paths.
 *
 * EMPTY, AND THAT IS A STRENGTHENING. This list held `createTechnicianBlockedTime` for exactly one
 * reason: under ND-25 that command raised BLOCKED_TIME_CONFLICT itself, to refuse a new ABSENCE
 * overlapping an existing one. The Owner ruling of 2026-09-12 withdrew ND-25 — overlapping
 * blocked-time facts are legitimate — so the command no longer constructs any policy-owned refusal,
 * and the carve-out that let it off the scan is no longer needed.
 *
 * With the list empty, the BLOCKED_TIME_CONFLICT scan below runs over the WHOLE of
 * schedulingCommands.ts again. A placement path growing its own blocked-time refusal is precisely
 * ND-24 returning, and it is once more caught anywhere in the file rather than everywhere except one
 * exempt function.
 *
 * The mechanism is kept (rather than deleted with its last entry) because the next genuinely
 * non-placement command in a placement file will need it, and re-deriving it under time pressure is
 * how carve-outs get made too wide. `schedulingBlockedTimeUnion.test.mjs` holds the other half of
 * this file's claim: what `createTechnicianBlockedTime` refuses now, and what it no longer does.
 */
const NON_PLACEMENT_COMMANDS = [];

/** `source` with the non-placement command bodies removed, so a scan sees only placement code. */
function placementSurface(source) {
  let out = source;
  for (const name of NON_PLACEMENT_COMMANDS) {
    const start = out.indexOf(`export async function ${name}(`);
    if (start === -1) continue;
    const after = out.indexOf("\nexport ", start + 1);
    out = out.slice(0, start) + (after === -1 ? "" : out.slice(after));
  }
  return out;
}

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
    const source = placementSurface(read(file));
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

test("the non-placement carve-out excuses nothing it cannot account for", () => {
  // A carve-out that silently matches nothing is worse than no carve-out: it would keep this suite
  // green while the function it excuses was renamed, moved, or deleted, and nobody would learn that
  // the exclusion had stopped meaning anything. So every name listed must exist, and listing a name
  // must actually change what is scanned.
  const source = read("scheduling/schedulingCommands.ts");
  for (const name of NON_PLACEMENT_COMMANDS) {
    assert.ok(
      source.includes(`export async function ${name}(`),
      `NON_PLACEMENT_COMMANDS names ${name}, which scheduling/schedulingCommands.ts no longer exports`,
    );
  }

  if (NON_PLACEMENT_COMMANDS.length === 0) {
    // The state since the Owner ruling of 2026-09-12 withdrew ND-25: nothing is excused, so the
    // refusal scan runs over the WHOLE file. Asserted rather than merely allowed, because "the list
    // happens to be empty" and "the scan really does cover everything" are different facts, and only
    // the second one is the guarantee this suite sells.
    assert.equal(placementSurface(source), source, "an empty carve-out must remove nothing");
    return;
  }
  assert.notEqual(placementSurface(source), source, "the carve-out must actually remove something");
});

test("createTechnicianBlockedTime is inside the scanned surface, not excused from it", () => {
  // The specific consequence of the empty carve-out, pinned by name so re-adding the exemption is a
  // deliberate edit to a red test. Under ND-25 this command raised BLOCKED_TIME_CONFLICT and had to
  // be excused; the ruling withdrew that refusal, so it is ordinary scanned code again.
  const source = read("scheduling/schedulingCommands.ts");
  assert.ok(source.includes("export async function createTechnicianBlockedTime("), "the command still exists");
  assert.ok(
    placementSurface(source).includes("export async function createTechnicianBlockedTime("),
    "createTechnicianBlockedTime must be scanned like the rest of the file",
  );
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
