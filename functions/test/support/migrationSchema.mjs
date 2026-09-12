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
