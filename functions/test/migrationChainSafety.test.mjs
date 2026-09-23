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

test("no migration in the chain grants a held capability", () => {
  // The Work Order lifecycle and Workflow Definition decisions are the Owner's, not a migration's.
  // Verified against the simulated post-chain state as zero; asserted here so a future edit cannot
  // quietly change it.
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql"))) {
    const sql = stripComments(up(f));
    const grantStatements = sql.split(";").filter((s) => /INSERT\s+INTO\s+role_capabilities/i.test(s));
    for (const stmt of grantStatements) {
      for (const held of ["workOrder.lifecycle.dispatch", "workOrder.lifecycle.cancel",
        "workOrder.lifecycle.complete", "workflowDefinition."]) {
        assert.equal(stmt.includes(held), false, `${f} grants a held capability (${held})`);
      }
    }
  }
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
