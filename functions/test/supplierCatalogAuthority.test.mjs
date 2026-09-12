// Supplier / Supplier Catalog Item — the OFFLINE proofs.
//
// Two halves, both provable with no database and no Firebase: the migration file says what the
// header claims it says, and the pure mapping/plan/reconciliation behaves as specified. The
// PostgreSQL half lives in supplierCatalogPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  SupplierCatalogMigrationError,
  mapSupplier,
  mapSupplierItem,
  planSupplierCatalogMigration,
  reconcileSupplierCatalogMigration,
} from "../lib/eosOps/migration/supplierCatalogMigration.js";
import {
  SupplierCatalogRepositoryError,
  requireSupplierId,
} from "../lib/eosOps/supplierCatalogRepository.js";

const MIGRATIONS_DIR = "migrations";
const MIGRATION_FILE = "1758499200000_supplier-and-supplier-catalog-authority.sql";
const migrationSource = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");

/** SQL with comment lines removed -- a header that DISCUSSES a shape is not that shape. */
function executableSql(source) {
  return source.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}
const sql = executableSql(migrationSource);

// ============================ the migration file ============================

test("008 sorts last and uses node-pg-migrate's two sections", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  assert.equal(files[files.length - 1], MIGRATION_FILE, "008 sorts last -- its timestamp is the newest");
  assert.ok(files.includes("1757980800000_operating-company-and-serialized-custody.sql"), "007 is still present");
  assert.match(migrationSource, /^-- Up Migration/);
  assert.match(migrationSource, /\n-- Down Migration\n/);
});

test("it is additive -- it edits no earlier migration's objects", () => {
  // The only ALTERs an additive migration may contain are none: everything it needs, it creates.
  assert.equal(/ALTER TABLE/i.test(sql), false, "008 creates its own tables; it does not alter 001-007's");
  for (const earlier of ["inventory_movements", "serialized_custody", "cycle_count_sheets", "cycle_count_lines"]) {
    assert.equal(sql.includes(earlier), false, `008 does not touch ${earlier}`);
  }
});

test("identity is the business id, scoped by tenant -- no surrogate key", () => {
  assert.match(sql, /PRIMARY KEY \(tenant_id, supplier_id\)/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, part_id, supplier_id\)/);
  assert.equal(/\bid\s+TEXT\s+PRIMARY KEY/i.test(sql), false, "a minted surrogate id would be a second answer to 'which supplier'");
});

test("the Part<->Supplier relationship is a real foreign key", () => {
  assert.match(
    sql,
    /FOREIGN KEY \(tenant_id, supplier_id\)\s+REFERENCES suppliers \(tenant_id, supplier_id\)/,
    "the catalog item's supplier must exist -- the thing Firestore cannot state",
  );
  // ...and part_id deliberately has none, because there is no parts table in this schema.
  assert.equal(/REFERENCES\s+parts\b/i.test(sql), false, "no local copy of the Part authority is invented");
});

test("one preferred supplier per part is a database invariant, not a convention", () => {
  assert.match(
    sql,
    /CREATE UNIQUE INDEX supplier_catalog_items_one_preferred_per_part\s+ON supplier_catalog_items \(tenant_id, part_id\) WHERE preferred/,
  );
  assert.match(sql, /CONSTRAINT supplier_catalog_items_preferred_is_active CHECK \(\s*NOT preferred OR status = 'ACTIVE'\s*\)/);
});

test("the dedup index is NOT unique -- detection, never auto-merge", () => {
  assert.match(sql, /CREATE INDEX suppliers_by_normalized_key/);
  assert.equal(
    /CREATE UNIQUE INDEX suppliers_by_normalized_key/.test(sql), false,
    "a UNIQUE index would decide at write time a question S2 reserved for a person",
  );
});

test("no operating company column, and no manufacturers table, are invented here", () => {
  assert.equal(/operating_company_key/.test(sql), false, "no source record states one; see the header");
  assert.equal(/CREATE TABLE manufacturers/i.test(sql), false, "Manufacturer has no Postgres relationship to hold yet");
});

test("the down migration reverses in dependency order", () => {
  const down = executableSql(migrationSource.split("\n-- Down Migration\n")[1]);
  const itemsAt = down.indexOf("DROP TABLE IF EXISTS supplier_catalog_items");
  const suppliersAt = down.indexOf("DROP TABLE IF EXISTS suppliers");
  assert.ok(itemsAt >= 0 && suppliersAt >= 0);
  assert.ok(itemsAt < suppliersAt, "the referencing table goes first");
  for (const type of ["ops_supplier_availability", "ops_supplier_item_status", "ops_supplier_status"]) {
    assert.ok(down.includes(`DROP TYPE IF EXISTS ${type}`), `${type} is dropped`);
  }
});

// ============================ fixtures ============================

const PART_A = "PART-A1";
const PART_B = "PART-B2";

const supplierDoc = (id, o = {}) => ({
  docId: id,
  data: { id, name: `Supplier ${id}`, normalizedKey: `supplier ${id.toLowerCase()}`, status: "ACTIVE", ...o },
});

const itemDoc = (partId, supplierId, o = {}) => ({
  docId: `${partId}__${supplierId}`,
  data: {
    itemId: `${partId}__${supplierId}`,
    partId,
    supplierId,
    supplierSku: `SKU-${supplierId}`,
    cost: "12.5000",
    currency: "USD",
    leadTimeDays: 7,
    availability: "AVAILABLE",
    preferred: false,
    status: "ACTIVE",
    ...o,
  },
});

// ============================ mapping ============================

test("a governed supplier maps field for field, and absent optionals become null", () => {
  const mapped = mapSupplier("sup-a", { id: "sup-a", name: "Acme", normalizedKey: "acme", status: "ACTIVE", email: "a@b.test" });
  assert.equal(mapped.supplierId, "sup-a");
  assert.equal(mapped.name, "Acme");
  assert.equal(mapped.normalizedKey, "acme");
  assert.equal(mapped.email, "a@b.test");
  assert.equal(mapped.vendorNumber, null);
  assert.equal(mapped.notes, null);
});

test("the normalized key is carried verbatim -- never recomputed from the name", () => {
  // A key that does NOT match what normalizeSupplierName would produce survives unchanged. If this
  // module recomputed it, dedup detection would depend on which layer ran last.
  const mapped = mapSupplier("sup-a", { id: "sup-a", name: "Acme Supply Co", normalizedKey: "LEGACY-KEY-9", status: "ACTIVE" });
  assert.equal(mapped.normalizedKey, "LEGACY-KEY-9");
});

test("a supplier whose stored id disagrees with its document id is refused", () => {
  assert.throws(
    () => mapSupplier("sup-a", { id: "sup-b", name: "Acme", normalizedKey: "acme", status: "ACTIVE" }),
    (e) => e instanceof SupplierCatalogMigrationError && e.code === "IDENTITY_MISMATCH",
  );
});

test("a non-canonical part id is refused, and never rewritten into one", () => {
  const bad = itemDoc(PART_A, "sup-a");
  assert.throws(
    () => mapSupplierItem(bad.docId, { ...bad.data, partId: " PART-A1 ", itemId: " PART-A1 __sup-a" }),
    (e) => e instanceof Error && /canonical/i.test(e.message),
  );
});

test("an itemId that is not <partId>__<supplierId> for its own fields is refused", () => {
  assert.throws(
    () => mapSupplierItem("PART-A1__sup-a", { ...itemDoc(PART_A, "sup-a").data, supplierId: "sup-z" }),
    (e) => e instanceof SupplierCatalogMigrationError && e.code === "ITEM_ID_MISMATCH",
  );
});

test("cost stays a decimal STRING -- no float round-trip", () => {
  const base = itemDoc(PART_A, "sup-a").data;
  const mapped = mapSupplierItem(base.itemId, { ...base, cost: "0.0001" });
  assert.equal(mapped.cost, "0.0001");
  assert.equal(typeof mapped.cost, "string");
});

test("purchaseUnit without a conversion is refused; with one it decomposes", () => {
  const base = itemDoc(PART_A, "sup-a").data;
  assert.throws(
    () => mapSupplierItem(base.itemId, { ...base, purchaseUnit: "CASE" }),
    (e) => e instanceof SupplierCatalogMigrationError && e.code === "FIELD_INVALID",
  );
  const ok = mapSupplierItem(base.itemId, { ...base, purchaseUnit: "CASE", conversionToStockingUnit: { numerator: 24, denominator: 1 } });
  assert.deepEqual(ok.conversion, { purchaseUnit: "CASE", numerator: 24, denominator: 1 });
});

test("preferred is never part of the create input -- the index decides, not the migration", () => {
  const base = itemDoc(PART_A, "sup-a", { preferred: true }).data;
  const mapped = mapSupplierItem(base.itemId, base);
  assert.equal("preferred" in mapped, false);
});

// ============================ the plan ============================

test("the plan partitions rather than failing on the first bad row", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a"), { docId: "sup-b", data: { id: "sup-WRONG", name: "x", normalizedKey: "x", status: "ACTIVE" } }],
    [itemDoc(PART_A, "sup-a"), itemDoc(PART_B, "sup-a", { cost: 12.5 })],
  );
  assert.equal(plan.counts.mappedSuppliers, 1);
  assert.equal(plan.counts.mappedItems, 1);
  assert.equal(plan.counts.rejected, 2, "one bad supplier and one bad item, each with a reason");
  assert.deepEqual(plan.rejected.map((r) => r.docId).sort(), ["PART-B2__sup-a", "sup-b"]);
});

test("an item naming no migratable supplier is an ORPHAN, reported before the FK would refuse it", () => {
  const plan = planSupplierCatalogMigration([supplierDoc("sup-a")], [itemDoc(PART_A, "sup-ghost")]);
  assert.equal(plan.counts.mappedItems, 0);
  assert.deepEqual(plan.orphanedItems.map((o) => o.code), ["SUPPLIER_NOT_FOUND"]);
});

test("two ACTIVE suppliers sharing a normalized key are REPORTED, never merged", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a", { normalizedKey: "acme" }), supplierDoc("sup-b", { normalizedKey: "acme" })],
    [],
  );
  assert.equal(plan.counts.mappedSuppliers, 2, "both survive -- nothing is dropped or merged");
  assert.deepEqual(plan.suspectedDuplicates, [{ normalizedKey: "acme", supplierIds: ["sup-a", "sup-b"] }]);
});

test("an INACTIVE supplier does not raise a duplicate suspicion", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a", { normalizedKey: "acme" }), supplierDoc("sup-b", { normalizedKey: "acme", status: "INACTIVE" })],
    [],
  );
  assert.deepEqual(plan.suspectedDuplicates, []);
});

test("two preferred items for one part are a reported CONFLICT the target cannot hold", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a"), supplierDoc("sup-b")],
    [itemDoc(PART_A, "sup-a", { preferred: true }), itemDoc(PART_A, "sup-b", { preferred: true })],
  );
  assert.deepEqual(plan.preferredConflicts, [{ partId: PART_A, supplierIds: ["sup-a", "sup-b"] }]);
});

test("a preferred but INACTIVE item is not carried into the preferred set", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a")],
    [itemDoc(PART_A, "sup-a", { preferred: true, status: "INACTIVE" })],
  );
  assert.deepEqual(plan.preferred, []);
});

test("the plan is deterministic -- same input, same plan", () => {
  const input = [[supplierDoc("sup-b"), supplierDoc("sup-a")], [itemDoc(PART_A, "sup-a"), itemDoc(PART_B, "sup-b")]];
  assert.deepEqual(planSupplierCatalogMigration(...input), planSupplierCatalogMigration(...input));
});

// ============================ reconciliation ============================

test("matching counts balance; a short destination names the discrepancy", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a"), supplierDoc("sup-b")],
    [itemDoc(PART_A, "sup-a", { preferred: true }), itemDoc(PART_B, "sup-b")],
  );
  const good = reconcileSupplierCatalogMigration(plan, { suppliers: 2, items: 2, preferred: 1 });
  assert.equal(good.balanced, true);
  assert.equal(good.complete, true);

  const short = reconcileSupplierCatalogMigration(plan, { suppliers: 2, items: 1, preferred: 1 });
  assert.equal(short.balanced, false);
  assert.deepEqual(short.discrepancies, [{ what: "supplier_catalog_items", expected: 2, actual: 1 }]);
});

test("a conflicting part expects exactly ONE preferred row -- the excess is the conflict, not a discrepancy", () => {
  const plan = planSupplierCatalogMigration(
    [supplierDoc("sup-a"), supplierDoc("sup-b")],
    [itemDoc(PART_A, "sup-a", { preferred: true }), itemDoc(PART_A, "sup-b", { preferred: true })],
  );
  assert.equal(plan.preferred.length, 2);
  const r = reconcileSupplierCatalogMigration(plan, { suppliers: 2, items: 2, preferred: 1 });
  assert.equal(r.balanced, true);
});

test("balanced is NOT complete when records were left behind", () => {
  const plan = planSupplierCatalogMigration([supplierDoc("sup-a")], [itemDoc(PART_A, "sup-ghost")]);
  const r = reconcileSupplierCatalogMigration(plan, { suppliers: 1, items: 0, preferred: 0 });
  assert.equal(r.balanced, true, "the destination holds exactly what the plan said it would");
  assert.equal(r.complete, false, "...but one record was never migrated, and that must not hide inside 'balanced'");
  assert.equal(r.unmigrated.length, 1);
});

// ============================ the repository's own boundary gate ============================

test("requireSupplierId returns the value unchanged, or refuses it", () => {
  assert.equal(requireSupplierId("sup-a_1"), "sup-a_1");
  for (const bad of [" sup-a", "sup a", "", 7, null, "x".repeat(65)]) {
    assert.throws(
      () => requireSupplierId(bad),
      (e) => e instanceof SupplierCatalogRepositoryError && e.code === "SUPPLIER_ID_INVALID",
      `${JSON.stringify(bad)} is refused`,
    );
  }
});
