// Migration 008 — the claims that do NOT need a database: the source mapping's refusals, the
// reconciliation, and the structural absences that keep a second authority from growing back.
//
// The database-backed proofs live in test/eosOpsWarehouseBinPostgres.test.mjs. Split deliberately:
// these run everywhere, so a change that reintroduces a stock-location writer or a bin-move method
// fails on any machine rather than only where Postgres happens to be up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  reconcileLocationSource,
  toBinCodeClaimRow,
  toBinRow,
  toWarehouseRow,
} from "../lib/eosOps/migration/warehouseBinMigrationSource.js";
import { OPS_LOCATION_TYPES } from "../lib/eosOps/operatingCompanyCustody.js";

const MIGRATION = "migrations/1758240000000_warehouse-and-bin-location-authority.sql";
const REPOSITORY = "src/eosOps/warehouseBinRepository.ts";
const migrationSql = readFileSync(MIGRATION, "utf8");
const repositorySource = readFileSync(REPOSITORY, "utf8");
// Comments explain what the module refuses to do and necessarily name it. The structural claims
// below are about CODE, so they are asserted against the source with comments stripped.
const repositoryCode = repositorySource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

// The exact shape deriveBinId produces: `bin_` + sha256 truncated to 40 hex.
const BIN_A = `bin_${"a".repeat(40)}`;
const BIN_B = `bin_${"b".repeat(40)}`;
const isGoverned = (v) => v === "taylor" || v === "ventana";

const warehouseDoc = (over = {}) => ({
  id: "wh-main", name: "Main Warehouse", location: "Phoenix, AZ",
  status: "ACTIVE", provenance: "NATIVE", operatingCompanyId: "taylor", ...over,
});
const binDoc = (over = {}) => ({
  schemaVersion: 2, warehouseId: "wh-main", area: "MAIN", aisle: "A", bay: 1, position: 3,
  code: "A01-003", name: null, status: "ACTIVE", idempotencyKey: "nonce-1", ...over,
});

// ============================ the operating company is never invented ============================

test("a warehouse with no operatingCompanyId is REFUSED, not defaulted", () => {
  // The field is explicitly OPTIONAL in the governed §3A shape (types/warehouse.ts: "a warehouse
  // without it is a VALID LEGACY GOVERNED WAREHOUSE"), so a legacy record is EXPECTED here. The
  // whole point is that expected does not mean guessable: an Owner states the company, a migration
  // does not pick one.
  const { id, ...noCompany } = { ...warehouseDoc(), operatingCompanyId: undefined };
  delete noCompany.operatingCompanyId;
  const mapped = toWarehouseRow("wh-main", { id, ...noCompany }, isGoverned);
  assert.equal(mapped.ok, false);
  assert.equal(mapped.refusal, "company_missing");
  assert.equal(mapped.row, null, "no row is produced for a company nobody stated");
});

test("a company id the authority does not govern is REFUSED distinctly from a missing one", () => {
  const mapped = toWarehouseRow("wh-main", warehouseDoc({ operatingCompanyId: "Taylor Freezer of Arizona" }), isGoverned);
  assert.equal(mapped.refusal, "company_invalid", "a display name is not an id, and is not silently coerced");
});

test("membership is the injected authority's answer, never this module's", () => {
  const refusesEverything = toWarehouseRow("wh-main", warehouseDoc(), () => false);
  assert.equal(refusesEverything.refusal, "company_invalid");
  const acceptsIt = toWarehouseRow("wh-main", warehouseDoc(), () => true);
  assert.equal(acceptsIt.ok, true);
});

test("a bin is never given an operating company of its own", () => {
  const mapped = toBinRow(BIN_A, binDoc(), new Set(["wh-main"]));
  assert.equal(mapped.ok, true);
  assert.equal("operatingCompanyKey" in mapped.row, false, "a bin's company is its warehouse's, reached by the foreign key");
  assert.match(repositorySource, /a bin never states its own operating company/);
});

// ============================ ids are carried, never re-derived ============================

test("the canonical warehouse id is the document id, unchanged -- no crosswalk", () => {
  const mapped = toWarehouseRow("wh-main", warehouseDoc(), isGoverned);
  assert.equal(mapped.row.id, "wh-main");
  const mismatch = toWarehouseRow("wh-other", warehouseDoc(), isGoverned);
  assert.equal(mismatch.refusal, "id_mismatch", "a stored id that disagrees with its path is a fault, not a rename");
});

test("the canonical bin id is carried verbatim, and a PRE-RULING-O-3 id is refused loudly", () => {
  const carried = toBinRow(BIN_A, binDoc(), new Set(["wh-main"]));
  assert.equal(carried.row.id, BIN_A);

  // The id shape before Decision #160 ruling O-3 was `bin_{warehouseId}__{code}` -- the human code
  // WAS the identity. Carrying one in would put a code-shaped id into a schema whose CHECK
  // constraint refuses it, and would reintroduce the very coupling O-3 severed.
  const legacy = toBinRow("bin_wh-main__A01-003", binDoc(), new Set(["wh-main"]));
  assert.equal(legacy.ok, false);
  assert.equal(legacy.refusal, "bin_id_not_opaque");
});

test("a v1 bin record fails closed -- there is no dual reader", () => {
  const v1 = toBinRow(BIN_A, binDoc({ schemaVersion: 1 }), new Set(["wh-main"]));
  assert.equal(v1.refusal, "schema_version_unsupported");
});

test("a bin whose parent warehouse was not accepted is refused, never orphaned", () => {
  const orphan = toBinRow(BIN_A, binDoc({ warehouseId: "wh-unknown" }), new Set(["wh-main"]));
  assert.equal(orphan.refusal, "warehouse_unknown");
});

// ============================ reconciliation ============================

test("a reconciliation with ANY refusal is NOT balanced -- a skipped row proves nothing", () => {
  const warehouses = [toWarehouseRow("wh-main", warehouseDoc(), isGoverned)];
  const bins = [toBinRow(BIN_A, binDoc(), new Set(["wh-main"]))];
  const claims = [toBinCodeClaimRow({ warehouseId: "wh-main", code: "A01-003", binId: BIN_A, claimState: "HELD" }, new Set([BIN_A]))];

  const clean = reconcileLocationSource({ warehouses, bins, claims });
  assert.equal(clean.balanced, true);
  assert.deepEqual(clean.binsWithoutHeldClaim, []);
  assert.equal(clean.warehouses.mapped, 1);

  const withRefusal = reconcileLocationSource({
    warehouses: [...warehouses, toWarehouseRow("wh-legacy", warehouseDoc({ id: "wh-legacy", operatingCompanyId: undefined }), isGoverned)],
    bins, claims,
  });
  assert.equal(withRefusal.balanced, false);
  assert.deepEqual(withRefusal.warehouses.refused, ["company_missing"]);
});

test("a bin with no HELD claim is named, not silently accepted", () => {
  const report = reconcileLocationSource({
    warehouses: [toWarehouseRow("wh-main", warehouseDoc(), isGoverned)],
    bins: [toBinRow(BIN_A, binDoc(), new Set(["wh-main"])), toBinRow(BIN_B, binDoc({ idempotencyKey: "nonce-2", position: 5, code: "A01-005" }), new Set(["wh-main"]))],
    claims: [toBinCodeClaimRow({ warehouseId: "wh-main", code: "A01-003", binId: BIN_A, claimState: "HELD" }, new Set([BIN_A, BIN_B]))],
  });
  assert.deepEqual(report.binsWithoutHeldClaim, [BIN_B], "a bin whose current code nothing reserves is a hole in the migration");
  assert.equal(report.balanced, false);
});

test("a SUPERSEDED claim does not satisfy a bin's current-code reservation", () => {
  const report = reconcileLocationSource({
    warehouses: [toWarehouseRow("wh-main", warehouseDoc(), isGoverned)],
    bins: [toBinRow(BIN_A, binDoc(), new Set(["wh-main"]))],
    claims: [toBinCodeClaimRow({ warehouseId: "wh-main", code: "A01-001", binId: BIN_A, claimState: "SUPERSEDED" }, new Set([BIN_A]))],
  });
  assert.deepEqual(report.binsWithoutHeldClaim, [BIN_A]);
});

// ============================ R3: the physical vocabulary is unchanged ============================

test("the physical movement vocabulary stays WAREHOUSE | BIN | MOBILE -- EQUIPMENT is not added", () => {
  // Migration 007 gave custody its own enum precisely so this one could stay the three places
  // company-held stock physically is. Migration 008 adds tables, not labels.
  assert.deepEqual([...OPS_LOCATION_TYPES], ["WAREHOUSE", "BIN", "MOBILE"]);
  assert.equal(/CREATE TYPE ops_location_type/.test(migrationSql), false, "008 does not redefine the movement vocabulary");
  assert.equal(/EQUIPMENT/.test(migrationSql.split("-- Down Migration")[0].replace(/^--.*$/gm, "")), false,
    "no EQUIPMENT label enters the physical schema this migration writes");
});

test("resolveOpsLocation takes the typed PAIR and refuses MOBILE by name", () => {
  assert.match(repositorySource, /export async function resolveOpsLocation\(\s*pool: Pool,\s*tenantId: string,\s*ref: OpsLocationRef,/);
  assert.match(repositorySource, /LOCATION_TYPE_NOT_IN_POSTGRES/);
  // A bare id never resolves: every exported read that returns a location goes through the pair.
  assert.equal(/export async function resolveOpsLocation\([^)]*locationId: string[^)]*\)/.test(repositorySource), false);
});

// ============================ what must not exist ============================

test("migration 008 creates no balance-shaped column anywhere", () => {
  const forbidden = ["quantity", "quantity_on_hand", "on_hand", "available", "reserved_quantity", "balance"];
  const up = migrationSql.split("-- Down Migration")[0];
  const statements = up.replace(/^\s*--.*$/gm, "");
  for (const word of forbidden) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(statements), false, `migration 008 must not introduce a \`${word}\` column`);
  }
});

test("the repository offers no way to move a bin between warehouses", () => {
  // binRegistry.ts refuses it as `warehouse_not_movable`. Moving a bin moves every historical
  // movement recorded at it across a custody boundary, so the absence is the enforcement.
  assert.equal(/UPDATE\s+\$\{SCHEMA\}\.bins[\s\S]{0,200}?SET[\s\S]{0,200}?warehouse_id\s*=/.test(repositoryCode), false);
  assert.match(repositorySource, /WAREHOUSE_NOT_MOVABLE/);
});

test("the repository offers no DELETE of a warehouse, a bin, or a code claim", () => {
  // A claim is a permanent reservation: releasing one is what would let a stale printed label
  // resolve to a different shelf one day.
  assert.equal(/\bDELETE\s+FROM\b/i.test(repositoryCode), false, "no delete path exists to be called by mistake");
  assert.equal(/\bTRUNCATE\b/i.test(repositoryCode), false);
});

test("the repository stores no quantity", () => {
  for (const word of ["quantity", "quantityOnHand", "onHand", "balance"]) {
    assert.equal(new RegExp(`\\b${word}\\b`).test(repositoryCode), false, `\`${word}\` has no place in a location authority`);
  }
});

// ============================ the retired stock-location authority stays retired ============================

function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".git" || entry === "lib") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|js|mjs|cjs)$/.test(entry)) out.push(full);
    }
  };
  walk(root);
  return out;
}

test("nothing in functions/ writes, reads or seeds the retired `stock_locations` collection", () => {
  // Looks for the WRITE AND READ SHAPES rather than the bare word, so a file that merely explains
  // why the collection is retired (constants/collections.ts, types/warehouse.ts, this test) is not
  // mistaken for one that uses it. Found by scanning, not by remembering -- the same discipline
  // adminPolicyPostgres.test.mjs's schema-resetter check uses.
  const usagePatterns = [
    /collection\(\s*["'`]stock_locations["'`]/,
    /\bset\(\s*["'`]stock_locations["'`]/,
    /\bdoc\(\s*["'`]stock_locations\//,
    /["'`]stock_locations["'`]\s*:/,      // a spec/registry entry keyed by the collection
    /\bstock_locations\s*:/,              // an object literal key
    /\[\s*["'`]stock_locations["'`]\s*\]/, // membership in a selected-collections list
  ];
  const offenders = [];
  for (const file of [...sourceFiles("src"), ...sourceFiles("scripts")]) {
    const text = readFileSync(file, "utf8");
    if (usagePatterns.some((p) => p.test(text))) offenders.push(file);
  }
  // ONE remaining reference, named explicitly so it cannot grow back into several unnoticed.
  //
  // `ownershipBackfillRules.ts` is the Ownership v1 backfill PLAN over documents that ALREADY EXIST
  // -- it stamps `operatingCompanyId` onto the five legacy sandbox rows from their `warehouseId`,
  // and its AUTHORIZED_WRITE_CAPS entry of 5 is a MEASURED blast-radius cap against live data. It
  // neither creates a stock_location nor reads one as a stock figure, and this packet deliberately
  // performs no production cutover, so those five documents still exist and the measurement is
  // still true. Removing the rule while the rows remain would make the plan silently incomplete.
  // It goes when those rows do, which is a cutover step, not this one.
  assert.deepEqual(offenders, ["src/ownership/ownershipBackfillRules.ts"],
    "stock_locations is a retired duplicate balance authority (Decision #160 / ADR-014): nothing new may write, read, seed or extract it");
});

test("the dead `stock_locations` composite index is gone from firestore.indexes.json", () => {
  const indexes = JSON.parse(readFileSync("../firestore.indexes.json", "utf8"));
  const groups = (indexes.indexes ?? []).map((i) => i.collectionGroup);
  assert.equal(groups.includes("stock_locations"), false, "an index is a read path; a retired authority keeps none");
});

test("the production-fixture pipeline no longer extracts or replays it", () => {
  const spec = readFileSync("scripts/fixtures/fixtureSpec.mjs", "utf8");
  assert.equal(/^\s*stock_locations\s*:/m.test(spec), false);
  const extractor = readFileSync("scripts/extractProductionFixtures.mjs", "utf8");
  assert.equal(/["']stock_locations["']/.test(extractor), false);
});
