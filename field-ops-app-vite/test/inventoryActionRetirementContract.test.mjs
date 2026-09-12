// INVENTORY ACTION — THE RETIREMENT CONTRACT.
//
// `inventory_actions` is a RETIRED, READ-ONLY LEGACY FIRESTORE AUDIT TRAIL. It is not a governed
// business object, it is not stock authority, and it must never become either. The Owner ruling of
// 2026-08-30 shut its write side (domain/inventoryActions.js: recordInventoryAction() throws, and
// the `.add()`-capable `inventoryActionsStore` handle was removed rather than commented out) while
// deliberately leaving the read alone, so existing history stays visible and attributable.
//
// ════════════════════ WHY THIS FILE EXISTS ════════════════════
//
// The retirement is currently held in place by ONE runtime statement (a `throw`) and a great deal
// of prose. Prose does not fail a build. Everything below turns the parts of that ruling that a
// later change could silently undo into assertions:
//
//   1. the writer still refuses,
//   2. the write side is structurally gone, not merely discouraged,
//   3. no SECOND writer reappeared anywhere in the app,
//   4. the collection still has no Postgres representation and is never a migration source,
//   5. its vocabulary never leaks into the governed movement ledger,
//   6. the surviving read is still the one scoped, client-direct query it was.
//
// ════════════════════ WHY 4 AND 5 ARE THE LOAD-BEARING ONES ════════════════════
//
// The obvious "next step" for a retired Firebase collection in this program is to migrate it into
// PostgreSQL. For this one that would be the WRONG step, and the reason is the same reason the
// write side was retired: `inventory_actions` was never reconciled with the governed ledger, so
// every row is an unverified parallel assertion that stock moved. Copying those assertions into
// `eos_ops.inventory_movements` would not make them true — it would launder them into the very
// authority they were retired for contradicting, and hand a governed reader rows no reconciliation
// ever supported. There are legacy rows that carry no location field at all, so the typed pair
// (location_type, location_id) could not even be constructed for them.
//
// So "no migration" is this object's ANSWER, not its gap — and test 4 is what keeps the answer from
// eroding into a TODO that someone later closes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recordInventoryAction } from "../src/domain/inventoryActions.js";
import { INVENTORY_ACTIONS_COLLECTION, INVENTORY_ACTION_TYPE } from "../src/domain/constants.js";
import { inventoryActionEntity } from "../src/metadata/definitions/inventoryAction.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_SRC = path.join(HERE, "..", "src");
const REPO_ROOT = path.join(HERE, "..", "..");

const read = (file) => fs.readFileSync(file, "utf8");

/**
 * A file with its comments removed.
 *
 * Necessary rather than fastidious: the modules this suite guards deliberately DISCUSS the write
 * path they retired, naming `inventoryActionsStore` and `makeCollectionStore` in prose so the
 * reason survives the code. A check that cannot tell a record from a call would read that
 * explanation as the very thing it forbids -- and the obvious "fix" would be to delete the
 * explanation, which is the opposite of what the ruling wanted.
 */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

/** Every hand-authored source file under a root, excluding vendored trees. */
function sourceFiles(root, extensions = [".js", ".jsx", ".ts", ".tsx"]) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.includes(path.extname(entry.name))) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1 + 2 — THE WRITE SIDE IS GONE, AND GONE STRUCTURALLY
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("recordInventoryAction() refuses, and says why rather than failing blankly", () => {
  // Kept exported and throwing rather than deleted: deleting it would take the REASON with it, and
  // the next person wanting an inventory note on the Part record would simply write another writer.
  assert.throws(
    () => recordInventoryAction({ partId: "P1", transactionType: INVENTORY_ACTION_TYPE.ADJUST_STOCK, quantityDelta: 1 }),
    (err) => {
      assert.ok(err instanceof Error, "must refuse with a real Error");
      // The message has to carry the ruling, not just a status. A bare "not supported" gets
      // re-enabled by whoever hits it next.
      assert.match(err.message, /no longer accepts new entries/i);
      assert.match(err.message, /not stock authority/i, "the refusal must state WHY it refuses");
      assert.match(err.message, /never reconciled with the governed ledger/i);
      return true;
    },
  );
});

test("recordInventoryAction() refuses UNCONDITIONALLY -- there is no argument shape that gets through", () => {
  // A throw guarded by validation would be a closed door with a key under the mat: a caller that
  // supplied a "good enough" payload would quietly resume writing. It must refuse before it looks.
  for (const args of [
    [],
    [undefined],
    [null],
    [{}],
    [{ partId: "P1", transactionType: INVENTORY_ACTION_TYPE.RECEIVE_STOCK, quantityDelta: 5, reason: "r", notes: "n", createdBy: "u1" }],
  ]) {
    assert.throws(() => recordInventoryAction(...args), /no longer accepts new entries/i);
  }
});

test("domain/inventoryActions.js holds NO Firebase handle at all -- the side door went with the front one", () => {
  const source = codeOnly(read(path.join(APP_SRC, "domain", "inventoryActions.js")));

  // An unused writable handle is an invitation. `inventoryActionsStore` was a live, .add()-capable
  // export; retiring the writer while leaving it standing would have shut the front door and left
  // the side one open -- a second write path, quieter than the first, and used by nothing.
  assert.doesNotMatch(source, /inventoryActionsStore/, "the .add()-capable store handle must stay removed");
  assert.doesNotMatch(source, /makeCollectionStore/, "no store may be constructed for this collection");

  // Structural, not behavioural: the module imports nothing whatsoever, so there is no Firestore
  // capability in the file for a future edit to reach for. This is also why the file no longer
  // appears in docs/architecture/firebase-exit-baseline.json -- the retirement genuinely removed a
  // Firebase business-runtime dependency rather than merely disarming it.
  assert.doesNotMatch(source, /^\s*import\s/m, "the retired writer must import nothing");
  assert.doesNotMatch(source, /firebase/i, "no Firebase module may be referenced by the retired writer");

  // Only the refusal is exported. Anything else exported from here is a new surface.
  const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["recordInventoryAction"]);
  assert.doesNotMatch(source, /^export\s+(?:const|let|var|class)\s/m, "no new exported binding may appear here");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3 — NO SECOND WRITER REAPPEARED
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("NOTHING IN THE APP WRITES inventory_actions -- the retirement is app-wide, not one module's opinion", () => {
  // The point of the ruling was to stop the creation of parallel assertions about stock. A writer
  // added anywhere else would defeat it just as completely as un-retiring this one, and would be
  // far harder to notice, so the check is a sweep rather than a file.
  const WRITE_CALLS = /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|makeCollectionStore)\b/;
  const offenders = [];

  for (const file of sourceFiles(APP_SRC)) {
    // constants.js merely DECLARES the name; declaring it is not reaching for it.
    if (file.endsWith(path.join("domain", "constants.js"))) continue;

    // Prose in this codebase routinely discusses the retired write path by name -- a comment is a
    // record, not a call.
    for (const line of codeOnly(read(file)).split("\n")) {
      // Reach the collection either by the constant or by its literal name.
      if (!/INVENTORY_ACTIONS_COLLECTION|["']inventory_actions["']/.test(line)) continue;
      if (WRITE_CALLS.test(line)) offenders.push(`${path.relative(REPO_ROOT, file)}: ${line.trim()}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "inventory_actions accepts no new entries (Owner ruling, 2026-08-30). Record the movement in " +
      "Receiving, Transfers, or the governed Cycle Count / adjustment paths instead:\n" + offenders.join("\n"),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4 — NO POSTGRES REPRESENTATION, AND NEVER A MIGRATION SOURCE
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("inventory_actions HAS NO PostgreSQL representation, and that is the answer rather than the gap", () => {
  // See the file header. Migrating unreconciled parallel assertions into the governed ledger would
  // launder them into the authority they were retired for contradicting. There are legacy rows with
  // no location field at all, so the typed (location_type, location_id) pair the governed ledger
  // requires could not be constructed for them even in principle.
  const roots = [
    path.join(REPO_ROOT, "functions", "migrations"),
    path.join(REPO_ROOT, "functions", "src", "eosOps"),
    path.join(REPO_ROOT, "functions", "src", "inventoryLedger"),
  ].filter((dir) => fs.existsSync(dir));

  assert.ok(roots.length === 3, "the governed ledger's own directories must exist for this check to mean anything");

  const offenders = [];
  for (const root of roots) {
    for (const file of sourceFiles(root, [".sql", ".ts", ".js", ".mjs"])) {
      const raw = read(file);
      // SQL comments are `--`; TS/JS comments are handled by codeOnly. A migration that merely
      // EXPLAINS why this collection is not a source is documentation, not a dependency.
      const source = path.extname(file) === ".sql"
        ? raw.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n")
        : codeOnly(raw);
      if (/inventory_actions|INVENTORY_ACTION/.test(source)) offenders.push(path.relative(REPO_ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A migration or governed repository now names inventory_actions. It is a retired, unreconciled " +
      "Firestore audit trail and must never be a migration source into eos_ops:\n" + offenders.join("\n"),
  );
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5 — ITS VOCABULARY NEVER REACHES THE GOVERNED MOVEMENT LEDGER
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("no INVENTORY_ACTION_TYPE value is a governed ops_movement_type", () => {
  // These three are a PERSON'S NOTE about an adjustment, not a movement the ledger recognises.
  // Receiving owns receiving, Transfers own transfers, and the Cycle Count / governed adjustment
  // paths own their movement; an action type admitted into the enum would let a note be replayed as
  // a movement.
  const foundation = read(path.join(REPO_ROOT, "functions", "migrations", "1757808000000_eos-ops-foundation.sql"));
  const enumBody = foundation.match(/CREATE TYPE ops_movement_type AS ENUM \(([\s\S]*?)\);/);
  assert.ok(enumBody, "ops_movement_type must be declared in the foundation migration");

  const movementTypes = [...enumBody[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(movementTypes.length > 0, "ops_movement_type must have members");

  for (const actionType of Object.values(INVENTORY_ACTION_TYPE)) {
    assert.equal(
      movementTypes.includes(actionType),
      false,
      `${actionType} is an Inventory Action note type and must never be an ops_movement_type`,
    );
  }
});

test("commitment facts are absent from BOTH vocabularies -- they are not physical movements", () => {
  // RESERVED / RELEASED / CONSUMED are commitment facts. They belong to the commitment surface, not
  // to a physical movement ledger and not to this retired note trail.
  const COMMITMENT_FACTS = ["RESERVED", "RELEASED", "CONSUMED"];
  const foundation = read(path.join(REPO_ROOT, "functions", "migrations", "1757808000000_eos-ops-foundation.sql"));
  const movementTypes = [...foundation.match(/CREATE TYPE ops_movement_type AS ENUM \(([\s\S]*?)\);/)[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

  for (const fact of COMMITMENT_FACTS) {
    assert.equal(movementTypes.includes(fact), false, `${fact} is a commitment fact, never an ops_movement_type`);
    assert.equal(
      Object.values(INVENTORY_ACTION_TYPE).includes(fact),
      false,
      `${fact} is a commitment fact and must not be an Inventory Action type either`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 6 — THE SURVIVING READ IS STILL EXACTLY WHAT IT WAS
// ═══════════════════════════════════════════════════════════════════════════════════════════════

test("the read stays ONE scoped, partId-filtered, client-direct query", () => {
  const hook = read(path.join(APP_SRC, "hooks", "useInventoryActions.js"));

  // Server-side filtered. An unscoped subscription would turn a per-Part history panel into a
  // cross-Part export of every adjustment note ever written, under a Rules grant that is
  // collection-level and does no per-document scoping of its own.
  assert.match(hook, /where\(\s*"partId"\s*,\s*"=="\s*,\s*partId\s*\)/, "the query must stay bound to one partId");

  // Read-only: the hook must not acquire a write.
  assert.doesNotMatch(hook, /\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch)\b/);

  // Exactly one exported reader -- no second, unscoped sibling.
  const exported = [...hook.matchAll(/^export\s+function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  assert.deepEqual(exported, ["useInventoryActionsForPart"]);
});

test("the entity still describes a retired, read-only, unowned-by-capability trail", () => {
  assert.equal(inventoryActionEntity.collection, INVENTORY_ACTIONS_COLLECTION);

  // CLIENT_DIRECT with readCapability null is not an oversight. `inventory.action.read` exists in
  // the capability catalog, but nothing evaluates it on this path: no callable stands between the
  // client and the collection, so the Firestore SDK call is gated by firestore.rules alone.
  // Declaring the capability here would claim a governed read that does not exist.
  assert.equal(inventoryActionEntity.readVia, "CLIENT_DIRECT");
  assert.equal(inventoryActionEntity.readCapability, null);

  // SYSTEM_ONLY: no human types or reads a name for one of these rows, and `transactionType` is a
  // shared category across many rows -- a category is never an identity.
  assert.equal(inventoryActionEntity.identity.mode, "SYSTEM_ONLY");
  assert.equal(inventoryActionEntity.identity.nameField, null);
  assert.equal(inventoryActionEntity.identity.referenceField, null);

  // Append-only: the ruling left no updatedAt/updatedBy, because these documents are never updated
  // (`allow update, delete: if false`).
  const fieldIds = inventoryActionEntity.fields.map((f) => f.id);
  for (const mutable of ["updatedAt", "updatedBy", "deletedAt", "voidedAt"]) {
    assert.equal(fieldIds.includes(mutable), false, `${mutable} implies a mutation this collection does not accept`);
  }
});
