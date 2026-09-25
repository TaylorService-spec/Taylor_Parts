// THE PENDING MIGRATION CHAIN -- properties that must hold before it is applied to a LIVE database.
//
// ════════════════════ WHY A CLEAN DATABASE PROVES TOO LITTLE ════════════════════
//
// Every other suite migrates an EMPTY database, where a preservation migration reads nothing and
// writes nothing. The migrations that matter here do their real work only when rows already exist:
// against nonprod's actual state the chain writes 249 role grants and 3 operational scopes, and a
// clean-database run writes none of them. These are the static properties that make that safe.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(FUNCTIONS_DIR, "migrations");
const read = (f) => readFileSync(join(DIR, f), "utf8");
const up = (f) => read(f).split("-- Down Migration")[0];
const stripComments = (s) => s.replace(/^\s*--.*$/gm, "");

/** Migrations whose UP writes DATA derived from rows that already exist. */
const PRESERVATION = Object.freeze([
  "1761523200000_cred-capability-vocabulary-and-grant-preservation.sql",
  "1761609600000_finance-administration-reorder-vocabulary.sql",
  "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql",
  "1761782400000_manufacturer-catalog-authority.sql",
]);

test("every migration file is present and ordered by its own id", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  const ids = files.map((f) => f.split("_")[0]);
  assert.deepEqual([...ids], [...ids].sort(), "filenames must sort in application order");
  assert.equal(new Set(ids).size, ids.length, "two migrations may not share an id");
  for (const f of PRESERVATION) assert.ok(files.includes(f), `${f} is missing`);
});

test("every data-preservation INSERT is idempotent by construction", () => {
  // PROVEN against a copy of real nonprod state: re-running all four preservation INSERTs
  // re-attempted 249 grant rows and 3 scope rows and added NOTHING except rows a later migration
  // had deliberately deleted. That property lives in these clauses, so it is asserted here.
  for (const f of PRESERVATION) {
    const sql = stripComments(up(f));
    const inserts = sql.split(";").map((s) => s.trim())
      .filter((s) => /^INSERT\s+INTO\s+(role_capabilities|eos_workforce\.employee_operational_scopes)\b/i.test(s));
    assert.ok(inserts.length > 0, `${f} declares no preservation INSERT`);
    for (const stmt of inserts) {
      const guarded = /ON CONFLICT[\s\S]*DO NOTHING/i.test(stmt) || /NOT EXISTS\s*\(/i.test(stmt);
      assert.ok(guarded, `${f}: a preservation INSERT has neither ON CONFLICT DO NOTHING nor NOT EXISTS`);
    }
  }
});

test("the supersession DELETE runs AFTER the grant it supersedes, in the same chain", () => {
  // ORDER IS LOad-BEARING, and this is the one place it bites. 1761609600000 GRANTS
  // reorder.request.read.queue; 1761696000000 DELETES those grants once the canonical unscoped
  // capability exists. Replaying the earlier INSERT without the later DELETE resurrects a
  // SUPERSEDED capability -- measured: exactly 6 grants came back. Anyone replaying preservation
  // DML by hand must replay the chain, not a statement.
  const granting = "1761609600000_finance-administration-reorder-vocabulary.sql";
  const superseding = "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql";
  assert.ok(granting < superseding, "the DELETE must sort after the INSERT it undoes");
  assert.ok(stripComments(up(granting)).includes("reorder.request.read.queue"),
    "the earlier migration still grants the scoped key");
  const later = stripComments(up(superseding));
  assert.match(later, /DELETE FROM role_capabilities[\s\S]*reorder\.request\.read\.queue/,
    "the later migration must remove those grants");
  assert.match(later, /UPDATE capabilities[\s\S]*SUPERSEDED/,
    "and must mark the capability superseded rather than deleting the evidence");
});

/** Every migration file's UP, split into the statements that write a Role grant. */
const grantStatementsInChain = () =>
  readdirSync(DIR).filter((x) => x.endsWith(".sql")).flatMap((f) =>
    stripComments(up(f)).split(";")
      .filter((s) => /INSERT\s+INTO\s+role_capabilities/i.test(s))
      .map((stmt) => [f, stmt]));

/**
 * THE WORKFLOW DEFINITION HOLD, AS THE OWNER NOW STATES IT.
 *
 * The hold used to be total -- no migration could name ANY `workflowDefinition.` key in a grant --
 * because "the Work Order lifecycle and Workflow Definition decisions are the Owner's, not a
 * migration's". The Owner has since made exactly ONE of those decisions:
 *
 *     workflowDefinition.read -> admin, owner.  No other Role.  Every other workflowDefinition.* at 0.
 *
 * So the guard is rewritten to express that ruling rather than deleted to let a migration past it.
 * Disabling a guard to admit the change it was built to catch leaves nothing behind to catch the
 * NEXT one. What it must still refuse, and does:
 *
 *   * a grant of workflowDefinition.publish (or create/edit/version/bindRole) -- named below;
 *   * a grant of some FUTURE workflowDefinition.* key nobody has ruled on -- caught by the
 *     enumeration check, which treats any action other than `read` as held;
 *   * a grant of workflowDefinition.read to a THIRD Role -- caught by the exact-population test;
 *   * a grant written in a shape this file cannot parse -- caught by the non-vacuity assertion,
 *     which refuses to report an exact population it did not actually read.
 */
const WORKFLOW_READ_GRANTEES = Object.freeze(["admin", "owner"]);

/**
 * THE WORK ORDER LIFECYCLE HOLD, AS THE OWNER NOW STATES IT.
 *
 * The same pattern, for the same reason. The hold used to be total on all three lifecycle keys.
 * Owner ruling S6 released exactly two of them, to exactly one Role:
 *
 *     workOrder.lifecycle.dispatch -> fieldManager.  workOrder.lifecycle.cancel -> fieldManager.
 *     workOrder.lifecycle.complete -> NOBODY, and it stays in HELD_CAPABILITIES below.
 *
 * COMPLETION IS NOT SCHEDULING. Dispatch and cancel are scheduling authority: deciding WHEN work
 * happens and whether it happens at all. Completion is execution attestation -- the person who did
 * the work says it is done. A manager who may both dispatch and complete can close work nobody
 * performed, which is the exact control this split exists to keep.
 *
 * admin and dispatcher hold dispatch and cancel in nonprod through the Wave 6 ENVIRONMENT
 * ACTIVATION, not through any migration, so they are correctly absent from the chain population
 * below: NONPROD_ACTIVATION is deliberately not global authority and no migration may promote it.
 */
const WORK_ORDER_LIFECYCLE_GRANTEES = Object.freeze({
  "workOrder.lifecycle.dispatch": ["fieldManager"],
  "workOrder.lifecycle.cancel": ["fieldManager"],
});

const HELD_CAPABILITIES = Object.freeze([
  "workOrder.lifecycle.complete",
  "workflowDefinition.create",
  "workflowDefinition.edit",
  "workflowDefinition.version",
  "workflowDefinition.publish",
  "workflowDefinition.bindRole",
]);

test("no migration in the chain grants a held capability", () => {
  // Verified against the simulated post-chain state as zero; asserted here so a future edit cannot
  // quietly change it.
  for (const [f, stmt] of grantStatementsInChain()) {
    for (const held of HELD_CAPABILITIES) {
      assert.equal(stmt.includes(held), false, `${f} grants a held capability (${held})`);
    }
    // ENUMERATION, not a blocklist: a workflowDefinition action nobody has released is held, so a
    // seventh key minted tomorrow is refused by this guard on the day it is first granted.
    for (const [, action] of stmt.matchAll(/'workflowDefinition\.([A-Za-z0-9_.]+)'/g)) {
      assert.equal(action, "read",
        `${f} grants workflowDefinition.${action}; no Owner ruling has released it from the hold`);
    }
  }
});

test("the released work order lifecycle keys go to exactly fieldManager, and completion to nobody", () => {
  // The SAME non-vacuity discipline as the workflowDefinition test below: if a grant statement names
  // one of these keys in a shape this parser cannot read, the population was read from less than the
  // whole chain, so refuse rather than report an "exact" answer derived from a partial read.
  for (const [key, expected] of Object.entries(WORK_ORDER_LIFECYCLE_GRANTEES)) {
    const grantees = [];
    for (const [f, stmt] of grantStatementsInChain()) {
      const mentions = [...stmt.matchAll(new RegExp(`'${key.replace(/\./g, "\\.")}'`, "g"))].length;
      const pairs = [...stmt.matchAll(new RegExp(`\\(\\s*'([A-Za-z0-9_]+)'\\s*,\\s*'${key.replace(/\./g, "\\.")}'\\s*\\)`, "g"))];
      assert.equal(pairs.length, mentions,
        `${f}: ${key} is granted in a shape this guard cannot read (${mentions} mention(s), ` +
        `${pairs.length} recognised pair(s)) -- review it by hand rather than letting the population go unmeasured`);
      for (const m of pairs) grantees.push(m[1]);
    }
    assert.deepEqual([...grantees].sort(), [...expected].sort(),
      `the chain must grant ${key} to exactly ${expected.join(", ")} -- a second Role here is a ruling nobody made`);
  }
  // And the third key is not released at all: HELD_CAPABILITIES carries it and the test above bites.
  assert.ok(HELD_CAPABILITIES.includes("workOrder.lifecycle.complete"));
  for (const [f, stmt] of grantStatementsInChain()) {
    assert.equal(stmt.includes("workOrder.lifecycle.complete"), false, `${f} grants completion`);
  }
});

test("workflowDefinition.read is granted to exactly admin and owner, and to nobody else", () => {
  // The ONE released key, and the exact population the ruling names. A third Role here fails.
  const grantees = [];
  for (const [f, stmt] of grantStatementsInChain()) {
    const mentions = [...stmt.matchAll(/'workflowDefinition\.read'/g)].length;
    const pairs = [...stmt.matchAll(/\(\s*'([A-Za-z0-9_]+)'\s*,\s*'workflowDefinition\.read'\s*\)/g)];
    // NON-VACUITY. If a grant statement names the key in a shape this parser does not recognise,
    // the population below was read from less than the whole chain -- so refuse rather than report
    // an "exact" answer derived from a partial read.
    assert.equal(pairs.length, mentions,
      `${f}: workflowDefinition.read is granted in a shape this guard cannot read ` +
      `(${mentions} mention(s), ${pairs.length} recognised (role_key, capability_key) pair(s)) -- ` +
      "review it by hand rather than letting the population go unmeasured");
    for (const m of pairs) grantees.push(m[1]);
  }
  assert.deepEqual([...grantees].sort(), [...WORKFLOW_READ_GRANTEES].sort(),
    "the chain must grant workflowDefinition.read to exactly admin and owner");
  assert.equal(grantees.length, 2, "exactly two grants, so no Role is granted it twice");
});

test("no migration manufactures a direct Principal grant", () => {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql"))) {
    const sql = stripComments(up(f));
    assert.equal(/INSERT\s+INTO\s+principal_capabilities/i.test(sql), false,
      `${f} writes a direct Principal grant; those are an Administration decision, never a migration's`);
  }
});

test("a guarded DOWN protects recorded authority rather than destroying it", () => {
  // GUARDED_NONREVERSIBLE_WITH_DATA is a safety property, not a defect. Each of these refuses to
  // narrow a vocabulary or drop a table while rows that depend on it exist.
  for (const [f, needle] of [
    ["1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql", /refuses to reverse/],
    ["1761782400000_manufacturer-catalog-authority.sql", /refuses to reverse/],
  ]) {
    const down = read(f).split("-- Down Migration")[1];
    assert.match(down, needle, `${f}'s down must refuse rather than destroy recorded data`);
  }
});
