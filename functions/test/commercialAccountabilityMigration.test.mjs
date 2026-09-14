// MIGRATION 020 — the accountability schema, proved over its SOURCE.
//
// ════════════════════ WHY OVER THE SOURCE ════════════════════
//
// The structural claims are proved against a real server in
// functions/test/commercialAccountabilityPostgres.test.mjs, which is where "the database refuses this"
// belongs. What is proved HERE is the set of claims that are about what the migration DOES NOT DO, and
// an absence is not observable by running the happy path against a server:
//
//   * no FOREIGN KEY on either person column (#189 `MI-λ`) — a server test can only see the keys that
//     exist, so the absence has to be read off the DDL;
//   * no constraint relating `accountable_employee_id` to `owner_employee_id` in EITHER direction
//     (#181) — neither "must differ" nor "must match";
//   * no eligibility column (#186 §2);
//   * no accountability column on any family outside the three (#189 `OD-16`);
//   * no new value in `commercial_handoff_source` and no accountability row in `ownership_handoffs`
//     (#187 §1);
//   * the down migration REFUSES while history exists rather than dropping it (#189).
//
// It also runs without a database, so the absences stay checked in every environment.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNTABLE_PERSON_STORAGE,
  ACCOUNTABILITY_FAMILIES,
} from "../lib/responsibility/accountablePersonStorage.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const MIGRATIONS = join(FUNCTIONS_DIR, "migrations");
const FILE = "1759276800000_commercial-accountability-authority.sql";
const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");

/**
 * Split FIRST on the `-- Down Migration` marker, THEN strip comments. Doing it the other way round
 * removes the marker itself, and a `down` half that is silently empty would make every assertion about
 * the down migration pass vacuously -- including the one that matters most, that it refuses to destroy
 * history.
 */
const [rawUp, rawDown] = (() => {
  const at = SQL.indexOf("-- Down Migration");
  assert.ok(at > 0, "migration 020 has no `-- Down Migration` marker");
  return [SQL.slice(0, at), SQL.slice(at)];
})();
const stripComments = (sql) => sql.replace(/^\s*--.*$/gm, "");
const up = stripComments(rawUp);
const down = stripComments(rawDown);
assert.ok(down.trim().length > 0, "the down half is empty -- every assertion about it would be vacuous");

const THREE_TABLES = ["opportunities", "sales_agreements", "sales_orders"];

// ════════════════════ 1. THE COLUMN, ON EXACTLY THREE TABLES ════════════════════

test("#189 OD-16: accountable_employee_id is added to EXACTLY the three admitted tables", () => {
  const altered = [...up.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+accountable_employee_id/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(altered.sort(), [...THREE_TABLES].sort());
  assert.equal(
    altered.length,
    ACCOUNTABILITY_FAMILIES.length,
    "the migration and the governed family scope disagree on how many families carry accountability",
  );
  // And the TypeScript declaration names the same three tables.
  assert.deepEqual(
    ACCOUNTABLE_PERSON_STORAGE.map((s) => s.table).sort(),
    THREE_TABLES.map((t) => `eos_commercial.${t}`).sort(),
  );
});

test("no OTHER migration in the set adds an accountability column to any other family", () => {
  const offenders = [];
  // Migration 021 (Owner ruling 2026-09-14, blocker #1) is admitted BY NAME and only for what it is: it alters the
  // accountability HISTORY table of the same three families and adds the mint's source enum. Proved below that it
  // touches nothing else, so admitting it cannot let accountability reach another family.
  const HISTORY_AUTHORITY = "1759363200000_accountability-history-action-and-source.sql";
  const history = readFileSync(join(MIGRATIONS, HISTORY_AUTHORITY), "utf8").replace(/^\s*--.*$/gm, "");
  const altered = [...history.matchAll(/ALTER TABLE\s+(\w+)/gi)].map((m) => m[1]);
  assert.ok(altered.length > 0 && altered.every((t) => t === "accountability_handoffs"), `021 alters ${altered.join(", ")}`);
  assert.deepEqual([...history.matchAll(/CREATE TYPE\s+(\w+)/gi)].map((m) => m[1]), ["accountable_person_source"]);
  assert.doesNotMatch(history, /CREATE TABLE|accountable_employee_id\s+TEXT/i, "021 adds an accountability column or table");
  for (const entry of readdirSync(MIGRATIONS)) {
    if (!entry.endsWith(".sql") || entry === FILE || entry === HISTORY_AUTHORITY) continue;
    const body = readFileSync(join(MIGRATIONS, entry), "utf8").replace(/^\s*--.*$/gm, "");
    // An accountability IDENTIFIER -- a column, a table, or a type -- not the WORD. Migration 019's
    // own down-migration HINT string mentions "accountability references" in prose, and prose in a
    // RAISE message is not a schema object.
    if (/(ADD COLUMN|CREATE TABLE|CREATE TYPE|ALTER TABLE)\s+\w*accountab/i.test(body)) {
      offenders.push(entry);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "another migration names accountability. #189 OD-16 admits three families and forbids inferring " +
      `any other: ${offenders.join(", ")}`,
  );
});

test("#189 MI-λ: the column is NULLABLE — MEASURE FIRST, never a fabricated default", () => {
  // Neither NOT NULL nor a DEFAULT of any kind. A `NOT NULL DEFAULT owner_employee_id` would fabricate
  // an accountability fact for every existing row and make #181's "NOT permanently derived from RECORD
  // OWNER" false in the storage itself.
  for (const match of up.matchAll(/ADD COLUMN\s+accountable_employee_id\s+([^,;]*)/g)) {
    const declaration = match[1];
    assert.doesNotMatch(declaration, /NOT\s+NULL/i, "the accountability column is NOT NULL");
    assert.doesNotMatch(declaration, /DEFAULT/i, "the accountability column has a DEFAULT");
  }
});

// ════════════════════ 2. THE ABSENCES THAT ARE THE RULINGS ════════════════════

test("#189 MI-λ: NEITHER person column in EITHER table carries a FOREIGN KEY", () => {
  // The measured reason, from the ruling: `ownership_handoffs` already carries four keys and none on
  // its two person columns, "so a bad person id already written there is permanent by design, and
  // adding a naive FK would either fail or require the history mutation this ruling forbids."
  for (const line of up.split("\n")) {
    if (!/accountable_employee_id/.test(line)) continue;
    assert.doesNotMatch(
      line,
      /REFERENCES/i,
      `a person column carries a foreign key: ${line.trim()}. #189 MI-lambda forbids it — identity must ` +
        "not be enforced by the database for a person reference, and a legacy unresolved reference " +
        "would then only be insertable by rewriting it.",
    );
  }
  // And the history table DOES carry keys — four of them — so the absence above is a decision about
  // the person columns rather than a migration that forgot about referential integrity entirely.
  const handoffs = up.slice(up.indexOf("CREATE TABLE accountability_handoffs"));
  const block = handoffs.slice(0, handoffs.indexOf("CREATE INDEX"));
  const references = [...block.matchAll(/(\w+)\s+TEXT[^,]*REFERENCES/g)].map((m) => m[1]);
  assert.deepEqual(
    references.sort(),
    ["opportunity_id", "sales_agreement_id", "sales_order_id", "tenant_id"].sort(),
    "the four non-person keys changed — the census's §5.1 claim must be re-measured",
  );
});

test("#181: NO constraint relates the accountable person to the record owner, in either direction", () => {
  // A constraint requiring them DIFFERENT would forbid the ordinary case — "For normal sales work they
  // will frequently be the same employee". A constraint requiring them EQUAL would be the permanent
  // computed identity #181 forbids in capitals. Both must be absent.
  for (const match of up.matchAll(/CHECK\s*\(([\s\S]*?)\)\s*(?:,|\n\s*\))/g)) {
    const body = match[1];
    if (!/accountable_employee_id/.test(body)) continue;
    assert.doesNotMatch(
      body,
      /owner_employee_id/,
      `a CHECK relates the accountable person to the record owner: ${body.trim()}. The two axes are ` +
        "independently mutable (#181) and the schema must take no position on whether they agree.",
    );
  }
  // Belt and braces over the whole UP: no line mentions both columns.
  for (const line of up.split("\n")) {
    if (/accountable_employee_id/.test(line) && /\bowner_employee_id\b/.test(line)) {
      assert.fail(`one statement names both axes: ${line.trim()}`);
    }
  }
});

test("#186 §2: there is NO eligibility column — eligibility is a verdict, not a stored property", () => {
  // Any eligibility COLUMN other than the policy id, which records WHO decided rather than WHAT.
  const eligibilityColumns = [...up.matchAll(/^\s*(eligib\w+)\s+\w/gim)].map((m) => m[1]);
  assert.deepEqual(
    eligibilityColumns,
    ["eligibility_policy_id"],
    "a cached eligibility verdict is stored on a commercial row. #186 s2 keeps REFERENCE VALIDITY, " +
      "EMPLOYEE LIFECYCLE STATUS and CURRENT ACCOUNTABILITY ELIGIBILITY separate, and a stored verdict " +
      "would disagree with the authority the next time the policy or the person's status changed.",
  );
  // The one eligibility word that IS present is the POLICY ID on the history row, which records WHO
  // decided rather than WHAT was decided. #189 MI-epsilon requires that; it is not a cached verdict.
  assert.match(up, /eligibility_policy_id\s+TEXT\s+NOT NULL/);
  // And no employment status is stored on a commercial row: the lifecycle fact lives on the Employee.
  assert.doesNotMatch(up, /ALTER TABLE[\s\S]{0,200}employment_status/);
});

test("#187 §1: accountability is NOT recorded as ownership", () => {
  // No new handoff source value, so an accountability transfer cannot be written into
  // `ownership_handoffs` under a new label.
  assert.doesNotMatch(up, /ALTER TYPE\s+commercial_handoff_source/i);
  assert.doesNotMatch(up, /ADD VALUE/i);
  // No column is added to ownership_handoffs at all.
  assert.doesNotMatch(up, /ALTER TABLE\s+ownership_handoffs/i);
  // The accountability history's person columns are NAMED for accountability, so a reader of a query
  // cannot mistake one for an owner.
  assert.match(up, /previous_accountable_employee_id/);
  assert.match(up, /new_accountable_employee_id/);
  const handoffBlock = up.slice(up.indexOf("CREATE TABLE accountability_handoffs"));
  assert.doesNotMatch(
    handoffBlock.slice(0, handoffBlock.indexOf("CREATE INDEX")),
    /owner/i,
    "the accountability history names an owner column — accountability must not be redefined as ownership",
  );
});

// ════════════════════ 3. HISTORY IS HISTORY ════════════════════

test("the accountability history is APPEND-ONLY, with its own trigger and its own message", () => {
  assert.match(up, /CREATE FUNCTION refuse_accountability_history_mutation/);
  assert.match(up, /BEFORE UPDATE OR DELETE ON accountability_handoffs/);
  // Its OWN function, not `refuse_ownership_history_mutation` reused: the error a DBA reads names the
  // axis, and #187 §1's rule applies to that text as much as to the column names.
  assert.doesNotMatch(
    up,
    /EXECUTE FUNCTION refuse_ownership_history_mutation/,
    "the accountability trigger reuses the ownership refusal, which names the wrong axis",
  );
  assert.match(up, /accountability_handoffs is append-only/);
});

test("the no-op and exactly-one-record constraints match the ownership history's shape", () => {
  assert.match(up, /accountability_handoff_names_exactly_one_record/);
  assert.match(up, /accountability_handoff_is_not_a_no_op/);
  // IS DISTINCT FROM, not <>: the none-to-someone ESTABLISHMENT case (NULL -> someone) must be a real
  // handoff rather than an unknown comparison. This is 008's own reasoning, and getting it wrong here
  // would silently make every first establishment unrecordable.
  assert.match(
    up,
    /previous_accountable_employee_id IS DISTINCT FROM new_accountable_employee_id/,
    "the no-op check uses <> rather than IS DISTINCT FROM, so establishing the first accountable " +
      "person would compare against NULL and be neither accepted nor refused",
  );
});

test("#189: the DOWN migration REFUSES while accountability history exists", () => {
  assert.match(down, /RAISE EXCEPTION/);
  assert.match(down, /count\(\*\)\s+INTO\s+recorded\s+FROM eos_commercial\.accountability_handoffs/);
  // The refusal must come BEFORE any DROP, or it is decoration.
  const raiseAt = down.indexOf("RAISE EXCEPTION");
  const dropAt = down.search(/DROP (TABLE|TRIGGER|INDEX|FUNCTION)/);
  assert.ok(raiseAt > 0 && dropAt > raiseAt, "the down migration drops before it counts");
});

test("the down migration reverses EXACTLY what the up migration created, and nothing more", () => {
  // Every object created is dropped, and no object the migration did not create is dropped -- a down
  // that dropped `ownership_handoffs` or the `opportunities` table would be catastrophic and is the
  // kind of thing a copy-paste produces.
  assert.match(down, /DROP TABLE IF EXISTS accountability_handoffs/);
  for (const table of THREE_TABLES) {
    assert.match(down, new RegExp(`ALTER TABLE\\s+${table}\\s+DROP COLUMN IF EXISTS accountable_employee_id`));
  }
  assert.doesNotMatch(down, /DROP TABLE IF EXISTS (opportunities|sales_agreements|sales_orders|ownership_handoffs)/);
  assert.doesNotMatch(down, /DROP SCHEMA/);
  assert.doesNotMatch(down, /DROP TYPE/);
});

test("STANDARD POSTGRESQL ONLY — no extension, no vendor feature", () => {
  assert.doesNotMatch(up, /CREATE EXTENSION/i);
  assert.doesNotMatch(up, /gen_random_uuid|uuid_generate/i);
});
