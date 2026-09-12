// WHAT THE MIGRATION FILES DECLARE — read from the files, never written down twice.
//
// ════════════════════ WHY THIS EXISTS ════════════════════
//
// Several shared suites used to pin the schema with a closed literal: "seven migrations", "twenty-one
// tables", "exactly these four eos_ops tables", "down 8". Each of those is a statement about how many
// migrations exist, which is a fact no single lane can know. At the W1 integration ELEVEN additive
// migrations landed at once, each written in isolation against a tree containing only its own, so
// every hand-written count and every closed table list was wrong in a different way and every lane
// had edited the same four files to say so.
//
// The literals are replaced by the rule they stood in for, computed here from `functions/migrations`.
// A migration that adds a table is then simply a migration that adds a table: no shared test changes,
// and nothing to re-resolve at the next integration.
//
// The parser is deliberately small and literal — it understands exactly the idiom every migration in
// this repository uses and nothing else:
//
//   CREATE SCHEMA IF NOT EXISTS <schema>;
//   SET search_path = <schema>, public;
//   CREATE TABLE <name> ( ... );
//
// It reads ONLY the Up section (everything before `-- Down Migration`), because what the Up section
// creates is what a migrated database must contain.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "migrations";

/** Every migration file, timestamp-ordered — the order node-pg-migrate itself applies them in. */
export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

/** The Up section of one migration, comment lines stripped. */
function upSection(dir, file) {
  return readFileSync(join(dir, file), "utf8")
    .split(/^-- Down Migration/m)[0]
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/**
 * Tables declared by the given migration files, as a Map of schema -> sorted table names.
 *
 * A `DROP TABLE` in an Up section removes the table again, so a migration that supersedes an earlier
 * one is accounted for rather than double-counted.
 */
export function declaredTables(files = migrationFiles(), dir = MIGRATIONS_DIR) {
  const bySchema = new Map();
  const add = (schema, table) => {
    if (!bySchema.has(schema)) bySchema.set(schema, new Set());
    bySchema.get(schema).add(table);
  };
  for (const file of files) {
    let current = "public"; // node-pg-migrate's default until a migration says otherwise
    for (const raw of upSection(dir, file).split("\n")) {
      const line = raw.trim();
      const searchPath = line.match(/^SET\s+search_path\s*=\s*([a-z_][a-z0-9_]*)/i);
      if (searchPath) { current = searchPath[1].toLowerCase(); continue; }
      const create = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?/i);
      if (create) {
        const [schema, table] = create[2] ? [create[1], create[2]] : [current, create[1]];
        add(schema.toLowerCase(), table.toLowerCase());
        continue;
      }
      const drop = line.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?/i);
      if (drop) {
        const [schema, table] = drop[2] ? [drop[1], drop[2]] : [current, drop[1]];
        bySchema.get(schema.toLowerCase())?.delete(table.toLowerCase());
      }
    }
  }
  return new Map([...bySchema].map(([schema, tables]) => [schema, [...tables].sort()]));
}

/** Sorted table names one schema's migrations declare. `[]` for a schema no migration creates. */
export const declaredTablesIn = (schema, files, dir) => declaredTables(files, dir).get(schema) ?? [];

/** Migration files strictly newer than `file`, by the timestamp prefix their names sort on. */
export const migrationsAfter = (file, dir) => migrationFiles(dir).filter((f) => f > file);

/**
 * Tables (in one schema) that the migrations give a named column, whether in the `CREATE TABLE` that
 * introduces the table or in a later `ALTER TABLE ... ADD COLUMN`.
 *
 * ════════════════════ WHY THIS IS DERIVED AND NOT LISTED ════════════════════
 *
 * `operating_company_key` used to be pinned by a hand-written COMPANY_TABLES list naming the three
 * tables migration 007 gave the column to. At the W1 integration, SEVEN further lanes added tables
 * carrying it -- `mobile_locations`, `warehouses`, `suppliers`, `purchase_orders` and the rest -- and
 * not one of them updated the list, because each lane's Postgres suites SKIP without a database and
 * nobody ran them. The sweep that was supposed to catch "a new table carries this column NULLABLE"
 * would instead have failed on every correct addition, which is the opposite of a useful guard.
 *
 * Derived from the files, the list cannot fall behind the migrations: a lane that adds a carrier is
 * included automatically, and the NOT NULL / TEXT / no-default properties are still asserted on every
 * row the live database returns.
 */
export function tablesWithColumn(schema, column, files = migrationFiles(), dir = MIGRATIONS_DIR) {
  const found = new Set();
  const col = column.toLowerCase();
  for (const file of files) {
    let current = "public";
    let openTable = null;   // the CREATE TABLE body we are inside, if any
    let depth = 0;
    for (const raw of upSection(dir, file).split("\n")) {
      const line = raw.trim();
      const searchPath = line.match(/^SET\s+search_path\s*=\s*([a-z_][a-z0-9_]*)/i);
      if (searchPath) { current = searchPath[1].toLowerCase(); continue; }

      // ALTER TABLE <t> ADD COLUMN <c> -- how migration 007 gave the column to tables it did not create.
      const alter = line.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/i);
      if (alter && alter[3].toLowerCase() === col && (alter[1]?.toLowerCase() ?? current) === schema) {
        found.add(alter[2].toLowerCase());
        continue;
      }

      if (openTable === null) {
        const create = line.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/i);
        if (create) { openTable = { schema: create[1]?.toLowerCase() ?? current, table: create[2].toLowerCase() }; depth = 0; }
      }
      if (openTable !== null) {
        depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
        // A column definition is `<name> <type> ...` at the top level of the table body.
        const colDef = line.match(/^([a-z_][a-z0-9_]*)\s+[A-Za-z]/);
        if (colDef && colDef[1].toLowerCase() === col && openTable.schema === schema) found.add(openTable.table);
        if (depth <= 0 && /;\s*$/.test(line)) openTable = null;
      }
    }
  }
  return [...found].sort();
}

/**
 * Every schema the migrations create, `eos_policy` and `eos_ops` included.
 *
 * What the Postgres resetters need. A `reset()` that drops only the schemas that existed when it was
 * written, then drops `pgmigrations` and migrates up, leaves the newer schemas' tables standing and
 * the re-`up` fails on `CREATE TABLE ... already exists`. Two W1 lanes hit exactly this and each
 * patched in only its own schema name; derived, the list cannot fall behind again.
 */
export function declaredSchemas(files = migrationFiles(), dir = MIGRATIONS_DIR) {
  const found = new Set();
  for (const file of files) {
    for (const raw of upSection(dir, file).split("\n")) {
      const m = raw.trim().match(/^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/i);
      if (m) found.add(m[1].toLowerCase());
    }
  }
  for (const schema of declaredTables(files, dir).keys()) if (schema !== "public") found.add(schema);
  return [...found].sort();
}

/**
 * Views declared by the migrations, as a Map of schema -> sorted view names.
 *
 * Kept separate from `declaredTables` because `information_schema.tables` does NOT keep them
 * separate: it lists views alongside base tables, so a schema assertion written against it silently
 * mixes "what is stored" with "what is projected". The W1 cash-application and invoice migrations
 * are exactly where that matters -- their whole design claim is that balances are VIEWS over facts
 * and never stored columns, so a check that cannot tell a view from a table cannot see that claim.
 */
export function declaredViews(files = migrationFiles(), dir = MIGRATIONS_DIR) {
  const bySchema = new Map();
  for (const file of files) {
    let current = "public";
    for (const raw of upSection(dir, file).split("\n")) {
      const line = raw.trim();
      const sp = line.match(/^SET\s+search_path\s*=\s*([a-z_][a-z0-9_]*)/i);
      if (sp) { current = sp[1].toLowerCase(); continue; }
      const cv = line.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/i);
      if (cv) {
        const schema = (cv[1] ?? current).toLowerCase();
        if (!bySchema.has(schema)) bySchema.set(schema, new Set());
        bySchema.get(schema).add(cv[2].toLowerCase());
        continue;
      }
      const dv = line.match(/^DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/i);
      if (dv) bySchema.get((dv[1] ?? current).toLowerCase())?.delete(dv[2].toLowerCase());
    }
  }
  return new Map([...bySchema].map(([s, v]) => [s, [...v].sort()]));
}

/** Sorted view names one schema's migrations declare. */
export const declaredViewsIn = (schema, files, dir) => declaredViews(files, dir).get(schema) ?? [];

/**
 * How many migrations sort STRICTLY NEWER than the one whose filename starts with `prefix`.
 *
 * ════════════════════ THE UNWIND-DEPTH RULE ════════════════════
 *
 * A lane suite that wants to prove "MY migration's down refuses while it still holds data" runs a
 * single `node-pg-migrate down`, which reverses whichever migration is currently newest. That is the
 * lane's own only while the lane's own is last -- true on a branch cut from main, false the moment a
 * sibling lands. Eleven siblings landed at the W1 integration, and every one of these suites was
 * then reversing somebody else's migration and reporting "Missing expected exception".
 *
 * Peeling exactly this many migrations first restores the precondition the test was written under,
 * without hardcoding a depth that the next migration invalidates again.
 */
export const stepsNewerThan = (prefix, dir) =>
  migrationFiles(dir).filter((f) => f > prefix && !f.startsWith(prefix)).length;
