// Supplier / Supplier Catalog Item — the POSTGRESQL proofs.
//
// ════════════════════ THESE RUN AGAINST A REAL DATABASE ════════════════════
//
// Set POLICY_TEST_DATABASE_URL to run; without it this SKIPS rather than fails, the same contract as
// adminPolicyPostgres.test.mjs. The point of proving these against a real server rather than a
// double is that the claims under test are the DATABASE's claims — a foreign key, a partial unique
// index, a CHECK — and a fake would only restate the belief being tested.
//
// ════════════════════ WHY THIS SUITE DOES NOT RESET THE SCHEMA ════════════════════
//
// The three existing PostgreSQL suites tear `eos_ops` and `eos_policy` down and re-migrate, which is
// why they must run serialized under the ONE registered `test:adminPolicyPostgres` command
// (adminPolicyPostgres.test.mjs mechanically enforces that any suite doing so is registered there).
// This suite is not permitted to edit package.json, so instead of joining that family it stays out
// of it: it migrates forward (idempotent — node-pg-migrate skips what is applied), and resets only
// its OWN two tables between tests. It therefore cannot be the file that races the others.
//
// It should still be registered in that command when package.json can next be edited — see
// docs/handoff/w1-c6-registrations.md.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import {
  SupplierCatalogRepositoryError,
  createSupplier,
  createSupplierCatalogItem,
  findActiveSuppliersByNormalizedKey,
  listSupplierCatalogItemsForPart,
  readSupplier,
  readSupplierCatalogItem,
  setPreferredSupplier,
  setSupplierCatalogItemStatus,
  setSupplierStatus,
  updateSupplier,
} from "../lib/eosOps/supplierCatalogRepository.js";
import {
  planSupplierCatalogMigration,
  reconcileSupplierCatalogMigration,
} from "../lib/eosOps/migration/supplierCatalogMigration.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-c6";
const OTHER_TENANT = "tenant-c6-other";
const ACTOR = "uid-c6";
const PART_A = "PART-A1";
const PART_B = "PART-B2";

let pool = null;
function poolOf() {
  pool ??= new pg.Pool({ connectionString: URL, max: 4 });
  return pool;
}
test.after(async () => { if (pool) await pool.end(); });

function migrateForward() {
  execFileSync(process.execPath, [
    "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations",
  ], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
}

let migrated = false;
/** Migrate once, then empty only this suite's own two tables. Never touches another suite's data. */
async function reset() {
  if (!migrated) { migrateForward(); migrated = true; }
  const p = poolOf();
  await p.query("DELETE FROM eos_ops.supplier_catalog_items WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
  await p.query("DELETE FROM eos_ops.suppliers WHERE tenant_id = ANY($1)", [[TENANT, OTHER_TENANT]]);
  for (const id of [TENANT, OTHER_TENANT]) {
    await p.query(
      "INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [id, id, id],
    );
  }
}

const supplierInput = (supplierId, o = {}) => ({
  supplierId,
  name: `Supplier ${supplierId}`,
  normalizedKey: `supplier ${supplierId}`,
  ...o,
});

const itemInput = (partId, supplierId, o = {}) => ({
  partId,
  supplierId,
  supplierSku: `SKU-${supplierId}`,
  cost: "12.5000",
  currency: "USD",
  leadTimeDays: 7,
  availability: "AVAILABLE",
  ...o,
});

async function codeOf(fn) {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof SupplierCatalogRepositoryError, `expected a repository error, got ${err}`);
    return err.code;
  }
  return assert.fail("expected a refusal, but the call succeeded");
}

// ============================ suppliers ============================

test("a supplier round-trips, at version 1, with absent optionals as null", { skip: SKIP }, async () => {
  await reset();
  const created = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a", { email: "a@b.test" }));
  assert.equal(created.supplierId, "sup-a");
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.version, 1);
  assert.equal(created.email, "a@b.test");
  assert.equal(created.vendorNumber, null);
  assert.deepEqual(await readSupplier(poolOf(), TENANT, "sup-a"), created);
});

test("the same supplier id is independent per tenant, and invisible across the boundary", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a", { notes: "ours" }));
  await createSupplier(poolOf(), OTHER_TENANT, ACTOR, supplierInput("sup-a", { notes: "theirs" }));
  assert.equal((await readSupplier(poolOf(), TENANT, "sup-a")).notes, "ours");
  assert.equal((await readSupplier(poolOf(), OTHER_TENANT, "sup-a")).notes, "theirs");
});

test("a duplicate supplier id in one tenant is refused, never silently overwritten", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  assert.equal(await codeOf(() => createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"))), "ALREADY_EXISTS");
});

test("an update applies at the version the caller read, and only at that version", { skip: SKIP }, async () => {
  await reset();
  const created = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  const updated = await updateSupplier(poolOf(), TENANT, ACTOR, "sup-a", created.version, {
    name: "Acme Supply", normalizedKey: "acme supply", phone: "555-0100",
  });
  assert.equal(updated.name, "Acme Supply");
  assert.equal(updated.normalizedKey, "acme supply");
  assert.equal(updated.version, 2);

  assert.equal(
    await codeOf(() => updateSupplier(poolOf(), TENANT, ACTOR, "sup-a", created.version, { notes: "stale write" })),
    "VERSION_CONFLICT",
  );
  assert.equal((await readSupplier(poolOf(), TENANT, "sup-a")).notes, null, "the stale write changed nothing");
});

test("name and normalizedKey must change together -- neither is derived from the other", { skip: SKIP }, async () => {
  await reset();
  const created = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  assert.equal(
    await codeOf(() => updateSupplier(poolOf(), TENANT, ACTOR, "sup-a", created.version, { name: "Acme" })),
    "NORMALIZED_KEY_INVALID",
  );
});

test("an optional field is cleared by null and refused when blank", { skip: SKIP }, async () => {
  await reset();
  const created = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a", { notes: "keep" }));
  const cleared = await updateSupplier(poolOf(), TENANT, ACTOR, "sup-a", created.version, { notes: null });
  assert.equal(cleared.notes, null);
  assert.equal(
    await codeOf(() => updateSupplier(poolOf(), TENANT, ACTOR, "sup-a", cleared.version, { notes: "   " })),
    "OPTIONAL_FIELD_BLANK",
  );
});

test("updating a supplier that does not exist says so, rather than reporting a version conflict", { skip: SKIP }, async () => {
  await reset();
  assert.equal(
    await codeOf(() => setSupplierStatus(poolOf(), TENANT, ACTOR, "sup-ghost", 1, "INACTIVE")),
    "SUPPLIER_NOT_FOUND",
  );
});

// ============================ dedup detection ============================

test("suppliers sharing a normalized key are REPORTED, not refused", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a", { normalizedKey: "acme" }));
  // The second create SUCCEEDS -- S2's policy is detection, never auto-merge, so the index is not UNIQUE.
  const second = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-b", { normalizedKey: "acme" }));
  assert.equal(second.supplierId, "sup-b");

  const suspects = await findActiveSuppliersByNormalizedKey(poolOf(), TENANT, "acme", "sup-a");
  assert.deepEqual(suspects.map((s) => s.supplierId), ["sup-b"]);
});

test("an INACTIVE supplier drops out of dedup detection", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a", { normalizedKey: "acme" }));
  const b = await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-b", { normalizedKey: "acme" }));
  await setSupplierStatus(poolOf(), TENANT, ACTOR, "sup-b", b.version, "INACTIVE");
  assert.deepEqual(await findActiveSuppliersByNormalizedKey(poolOf(), TENANT, "acme", "sup-a"), []);
});

// ============================ the Part<->Supplier relationship ============================

test("a catalog item for a supplier that does not exist is REFUSED by the database", { skip: SKIP }, async () => {
  await reset();
  // This is the whole point of the move: in Firestore this write succeeds and joins to nothing.
  assert.equal(
    await codeOf(() => createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-ghost"))),
    "SUPPLIER_NOT_FOUND",
  );
});

test("a supplier in ANOTHER tenant does not satisfy the relationship", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), OTHER_TENANT, ACTOR, supplierInput("sup-a"));
  assert.equal(
    await codeOf(() => createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-a"))),
    "SUPPLIER_NOT_FOUND",
  );
});

test("a catalog item round-trips, and its itemId is DERIVED from the pair", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  const item = await createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-a", {
    minOrderQty: "10.0000",
    conversion: { purchaseUnit: "CASE", numerator: 24, denominator: 1 },
    contractStart: "2026-01-01",
    contractEnd: "2026-12-31",
  }));
  assert.equal(item.itemId, `${PART_A}__sup-a`, "the Firestore doc id, reproduced without being stored");
  assert.equal(item.cost, "12.5000", "NUMERIC comes back as a decimal string, never a float");
  assert.deepEqual(item.conversion, { purchaseUnit: "CASE", numerator: 24, denominator: 1 });
  assert.equal(item.contractStart, "2026-01-01");
  assert.equal(item.preferred, false);
  assert.deepEqual(await readSupplierCatalogItem(poolOf(), TENANT, PART_A, "sup-a"), item);
});

test("a non-canonical part id never reaches SQL", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  await assert.rejects(
    () => createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(" PART-A1 ", "sup-a")),
    /canonical/i,
  );
});

test("a contract window that ends before it starts is refused by the database", { skip: SKIP }, async () => {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  assert.equal(
    await codeOf(() => createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-a", {
      contractStart: "2026-12-31", contractEnd: "2026-01-01",
    }))),
    "CONSTRAINT_VIOLATED",
  );
});

// ============================ one preferred supplier per part ============================

async function twoItemsOnPartA() {
  await reset();
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-a"));
  await createSupplier(poolOf(), TENANT, ACTOR, supplierInput("sup-b"));
  const a = await createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-a"));
  const b = await createSupplierCatalogItem(poolOf(), TENANT, ACTOR, itemInput(PART_A, "sup-b"));
  return { a, b };
}

test("setting a preferred supplier clears the incumbent, atomically", { skip: SKIP }, async () => {
  const { a, b } = await twoItemsOnPartA();
  const preferredA = await setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-a", a.version);
  assert.equal(preferredA.preferred, true);

  const preferredB = await setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-b", b.version);
  assert.equal(preferredB.preferred, true);

  const all = await listSupplierCatalogItemsForPart(poolOf(), TENANT, PART_A);
  assert.deepEqual(all.filter((i) => i.preferred).map((i) => i.supplierId), ["sup-b"], "exactly one, and it is the new one");
  assert.equal(all[0].supplierId, "sup-b", "the preferred item reads first");
});

test("the database itself refuses a second preferred item for a part", { skip: SKIP }, async () => {
  const { a } = await twoItemsOnPartA();
  await setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-a", a.version);
  // Bypass the repository entirely: a direct UPDATE is exactly the writer that used to be able to
  // break this invariant, and the partial unique index is what now stops it.
  await assert.rejects(
    () => poolOf().query(
      "UPDATE eos_ops.supplier_catalog_items SET preferred = TRUE WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3",
      [TENANT, PART_A, "sup-b"],
    ),
    (err) => err.constraint === "supplier_catalog_items_one_preferred_per_part",
  );
});

test("preferring a non-ACTIVE item is refused, and deactivation clears the flag", { skip: SKIP }, async () => {
  const { a, b } = await twoItemsOnPartA();
  const inactive = await setSupplierCatalogItemStatus(poolOf(), TENANT, ACTOR, PART_A, "sup-b", b.version, "INACTIVE");
  assert.equal(inactive.status, "INACTIVE");
  assert.equal(
    await codeOf(() => setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-b", inactive.version)),
    "ITEM_NOT_ACTIVE",
  );

  const preferredA = await setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-a", a.version);
  const deactivated = await setSupplierCatalogItemStatus(poolOf(), TENANT, ACTOR, PART_A, "sup-a", preferredA.version, "INACTIVE");
  assert.equal(deactivated.preferred, false, "preferred cannot survive a deactivation as a stale flag");
});

test("a stale expectedVersion on setPreferredSupplier changes nothing", { skip: SKIP }, async () => {
  const { a } = await twoItemsOnPartA();
  assert.equal(
    await codeOf(() => setPreferredSupplier(poolOf(), TENANT, ACTOR, PART_A, "sup-a", a.version + 5)),
    "VERSION_CONFLICT",
  );
  const all = await listSupplierCatalogItemsForPart(poolOf(), TENANT, PART_A);
  assert.deepEqual(all.filter((i) => i.preferred), [], "the rolled-back transaction left no preferred item behind");
});

// ============================ the migration, end to end ============================

test("a planned migration lands in PostgreSQL and reconciles", { skip: SKIP }, async () => {
  await reset();
  const supplierDoc = (id) => ({ docId: id, data: { id, name: `Supplier ${id}`, normalizedKey: `k-${id}`, status: "ACTIVE" } });
  const itemDoc = (partId, supplierId, preferred) => ({
    docId: `${partId}__${supplierId}`,
    data: {
      itemId: `${partId}__${supplierId}`, partId, supplierId, supplierSku: `SKU-${supplierId}`,
      cost: "3.2500", currency: "USD", leadTimeDays: 2, availability: "AVAILABLE", preferred, status: "ACTIVE",
    },
  });

  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a"), supplierDoc("sup-b")],
    [itemDoc(PART_A, "sup-a", true), itemDoc(PART_A, "sup-b", false), itemDoc(PART_B, "sup-b", true),
     itemDoc(PART_B, "sup-ghost", false)],
  );
  assert.equal(plan.counts.mappedItems, 3);
  assert.equal(plan.orphanedItems.length, 1, "the orphan is known BEFORE the FK would have refused it");

  for (const s of plan.suppliers) await createSupplier(poolOf(), TENANT, ACTOR, s);
  const versions = new Map();
  for (const i of plan.items) {
    const row = await createSupplierCatalogItem(poolOf(), TENANT, ACTOR, i);
    versions.set(row.itemId, row.version);
  }
  for (const p of plan.preferred) {
    await setPreferredSupplier(poolOf(), TENANT, ACTOR, p.partId, p.supplierId, versions.get(`${p.partId}__${p.supplierId}`));
  }

  const counted = await poolOf().query(
    `SELECT (SELECT count(*) FROM eos_ops.suppliers WHERE tenant_id = $1) AS suppliers,
            (SELECT count(*) FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1) AS items,
            (SELECT count(*) FROM eos_ops.supplier_catalog_items WHERE tenant_id = $1 AND preferred) AS preferred`,
    [TENANT],
  );
  const destination = {
    suppliers: Number(counted.rows[0].suppliers),
    items: Number(counted.rows[0].items),
    preferred: Number(counted.rows[0].preferred),
  };
  const result = reconcileSupplierCatalogMigration(plan, destination);

  assert.equal(result.balanced, true, `discrepancies: ${JSON.stringify(result.discrepancies)}`);
  assert.equal(result.complete, false, "one orphaned item was deliberately left behind");
  assert.deepEqual(result.unmigrated.map((u) => u.docId), [`${PART_B}__sup-ghost`]);
});

// ============================ the shape the migration actually created ============================

test("the columns, constraints and indexes exist as declared", { skip: SKIP }, async () => {
  await reset();
  const columns = await poolOf().query(
    `SELECT column_name, data_type, is_nullable, column_default, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'eos_ops' AND table_name = 'supplier_catalog_items'
      ORDER BY column_name`,
  );
  const byName = new Map(columns.rows.map((r) => [r.column_name, r]));
  assert.equal(byName.get("item_id").is_generated, "ALWAYS", "item_id is derived, never stored independently");
  assert.equal(byName.get("cost").data_type, "numeric", "money is never a float");
  assert.equal(byName.get("preferred").is_nullable, "NO");
  assert.equal(byName.has("operating_company_key"), false, "no operating company is invented here");

  const indexes = await poolOf().query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'eos_ops' AND tablename = ANY($1)",
    [["suppliers", "supplier_catalog_items"]],
  );
  const names = indexes.rows.map((r) => r.indexname);
  assert.ok(names.includes("supplier_catalog_items_one_preferred_per_part"));
  assert.ok(names.includes("suppliers_by_normalized_key"));

  const unique = await poolOf().query(
    "SELECT indisunique FROM pg_index WHERE indexrelid = 'eos_ops.suppliers_by_normalized_key'::regclass",
  );
  assert.equal(unique.rows[0].indisunique, false, "dedup DETECTION -- a unique index would auto-refuse instead");

  const tables = await poolOf().query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'eos_ops' AND table_name = 'manufacturers'",
  );
  assert.equal(tables.rows.length, 0, "Manufacturer is not modelled here -- see migration 008's header");
});
