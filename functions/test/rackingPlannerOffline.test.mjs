// THE WAREHOUSE RACKING PLANNER AND THE FIREBASE BIN CENSUS -- the claims that need no database (Firebase exit B3, DECISIONS #B3).
// Run: npm run build && node --test test/rackingPlannerOffline.test.mjs
//
//   1. The classification (planBinCreates): NEW / ALREADY_EXISTS / POSITION_TAKEN / CODE_RESERVED / INVALID / INTEGRITY_ERROR, deterministic.
//   2. HOLDER PARITY (Owner ruling 7): inventory.location.bin.read / .manage are held by EXACTLY the Roles that hold them in the Firebase catalog
//      (the compiled Role catalog), no other -- measured here against the committed authority baseline, not asserted from memory.
//   3. The gate: the planner's operations are gated by the bin keys (not warehouse.record.manage), reads vs mutations.
//   4. The census (classifyFirebaseBins + scripts/binCensus.js): synthetic / duplicate / unmatched, offline, writes nothing.
//   5. The migration's shape: registers both keys, grants exactly the baseline's seven pairs, creates no row.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { planBinCreates, classifyBin, validateProposal, MAX_BIN_PROPOSALS } from "../lib/eosOps/binRackingPlan.js";
import { classifyFirebaseBins } from "../lib/eosOps/migration/binCensus.js";
import { deriveBinId } from "../lib/inventoryLocation/binRegistry.js";
import { ADMIN_CONFIGURATION_OPERATIONS, RACKING_READ_CAPABILITY, RACKING_MANAGE_CAPABILITY, WAREHOUSE_MASTER_CAPABILITY } from "../lib/adminPolicy/configurationOperations.js";
import { WAREHOUSE_ADMIN_OPERATIONS, isWarehouseAdminOperation } from "../lib/eosOps/warehouseBinAdministration.js";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = JSON.parse(readFileSync(join(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");

const WH = "wh-1";
const key = (aisle, bay, position, area = "PARTS") => `binadm:v1:${WH}:${area}:${aisle}:${bay}:${position}`;
const proposal = (aisle, bay, position, area = "PARTS") => ({ area, aisle, bay, position, idempotencyKey: key(aisle, bay, position, area) });
const stored = (aisle, bay, position, code, area = "PARTS") => ({ id: deriveBinId(key(aisle, bay, position, area)), area, aisle, bay, position, code, status: "ACTIVE" });
const claim = (code, binId, claimState = "HELD") => ({ code, binId, claimState });

// ════════════════════════════ 1. THE CLASSIFICATION ════════════════════════════

test("a new bin is NEW, with the server's own canonical code", () => {
  const [r] = planBinCreates(WH, [proposal("A", 1, 1)], [], []);
  assert.deepEqual([r.classification, r.code, r.reason, r.binId], ["NEW", "A01-001", null, deriveBinId(key("A", 1, 1))]);
});

test("an exact replay is ALREADY_EXISTS; the same position under another key is POSITION_TAKEN; a claimed code is CODE_RESERVED", () => {
  const bins = [stored("A", 1, 1, "A01-001")];
  const claims = [claim("A01-001", bins[0].id), claim("B01-001", "bin_other", "SUPERSEDED")];
  const out = planBinCreates(WH, [proposal("A", 1, 1), proposal("B", 1, 1), proposal("C", 1, 1)], bins, claims);
  assert.deepEqual(out.map((r) => [r.classification, r.reason]), [
    ["ALREADY_EXISTS", null],
    ["CODE_RESERVED", "code_reserved_by_another_bin"],
    ["NEW", null],
  ]);
  // The same rack position under ANOTHER idempotency key (the WarehouseMasters key scheme) is a different bin id: POSITION_TAKEN.
  const [taken] = planBinCreates(WH, [{ ...proposal("A", 1, 1), idempotencyKey: `${key("A", 1, 1)}:alt` }], bins, claims);
  assert.deepEqual([taken.classification, taken.reason], ["POSITION_TAKEN", "position_taken_by_another_bin"]);
  // A3: the key must be scoped to THIS request's warehouse (`binadm:v1:<warehouseId>:`); another warehouse's key, or an unscoped one, is refused.
  const wrong = planBinCreates(WH, [{ ...proposal("A", 1, 1), idempotencyKey: key("A", 1, 1).replace(`:${WH}:`, ":wh-other:") }, { ...proposal("A", 1, 3), idempotencyKey: "bin-wh-1-PARTS-A-1-3" }], [], []);
  assert.deepEqual(wrong.map((r) => [r.classification, r.reason]), [["INVALID", "idempotency_key_wrong_scope"], ["INVALID", "idempotency_key_wrong_scope"]]);
});

test("stored state that disagrees with itself or the request is INTEGRITY_ERROR, never repaired", () => {
  const b = stored("A", 1, 1, "A01-001");
  const verdict = (bins, claims) => planBinCreates(WH, [proposal("A", 1, 1)], bins, claims)[0];
  assert.deepEqual([verdict([b], []).classification, verdict([b], []).reason], ["INTEGRITY_ERROR", "claim_unreadable"]);
  assert.equal(verdict([b], [claim("A01-001", "bin_elsewhere")]).reason, "claim_points_elsewhere");
  assert.equal(verdict([b], [claim("A01-001", b.id, "SUPERSEDED")]).reason, "claim_points_elsewhere");
  assert.equal(verdict([{ ...b, code: "A01-009" }], [claim("A01-009", b.id)]).reason, "bin_disagrees_with_request");
});

test("invalid proposals name their reason; a duplicate WITHIN the request is refused for its later occurrence; a foreign warehouse is refused", () => {
  const out = planBinCreates(WH, [
    { ...proposal("A", 1, 1), aisle: "ZZZ" }, { ...proposal("A", 1, 3), bay: -1 }, { ...proposal("A", 1, 5), idempotencyKey: "  " },
    proposal("A", 1, 7), proposal("A", 1, 7), { ...proposal("A", 1, 9), warehouseId: "wh-other" }, "nope", { ...proposal("A", 1, 11), code: "X" },
  ], [], []);
  assert.deepEqual(out.map((r) => [r.classification, r.reason]), [
    ["INVALID", "aisle_invalid"], ["INVALID", "bay_invalid"], ["INVALID", "idempotency_key_invalid"],
    ["NEW", null], ["INVALID", "duplicate_in_request"], ["INVALID", "warehouse_mismatch"], ["INVALID", "not_object"], ["INVALID", "code_not_accepted"],
  ]);
  assert.equal(MAX_BIN_PROPOSALS, 250, "the Firebase BIN_PREVIEW_MAX_PROPOSALS, never silently truncated");
});

test("the classification is deterministic and order-preserving, and the preview and the create decide with the SAME function", () => {
  const rows = [proposal("A", 1, 1), proposal("A", 1, 3), proposal("B", 1, 1)];
  assert.deepEqual(planBinCreates(WH, rows, [], []), planBinCreates(WH, rows, [], []));
  const checked = validateProposal(0, WH, rows[0]);
  assert.equal(checked.valid, true);
  const viaPlan = planBinCreates(WH, [rows[0]], [], [])[0];
  const viaCreate = classifyBin(0, checked.value, { binById: null, binByPosition: null, claimByCode: null });
  assert.deepEqual(viaPlan, viaCreate);
});

// ════════════════════════════ 2. HOLDER PARITY ════════════════════════════

test("HOLDER PARITY: the bin keys are held by exactly the Roles that hold them in the Firebase catalog -- no new holder", () => {
  const compiled = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
  for (const capability of [RACKING_READ_CAPABILITY, RACKING_MANAGE_CAPABILITY]) {
    const firebase = Object.entries(compiled)
      .filter(([, role]) => (role.permissions ?? []).some((p) => (typeof p === "string" ? p : p.id) === capability)).map(([id]) => id).sort();
    const eos = [...new Set(BASELINE.grants.filter((g) => g.capabilityKey === capability).map((g) => g.roleKey))].sort();
    assert.deepEqual(eos, firebase, `${capability}: the EOS holders must equal the Firebase catalog's`);
  }
  assert.deepEqual([...new Set(BASELINE.grants.filter((g) => g.capabilityKey === RACKING_MANAGE_CAPABILITY).map((g) => g.roleKey))].sort(), ["admin", "inventoryBinAdministrator"]);
  assert.equal(BASELINE.grants.filter((g) => /^inventory\.location\.bin\./.test(g.capabilityKey)).length, 7);
  // Every one of the seven is stamped by this migration, and no other grant names a bin key.
  assert.equal(BASELINE.grants.filter((g) => /^inventory\.location\.bin\./.test(g.capabilityKey) && g.evidence === "migration:1764630000000").length, 7);
  // The memberless Role carries no member by this change: no principal or assignment is created anywhere in the migration.
  const up = readFileSync(join(FUNCTIONS_DIR, "migrations/1764630000000_warehouse-receiving-bins-on-eos.sql"), "utf8").split("-- Down Migration")[0];
  assert.doesNotMatch(up, /user_role_assignments|principal_capabilities|employee_principal_links/);
});

// ════════════════════════════ 3. THE GATE ════════════════════════════

test("the planner is gated by the BIN keys (reads vs mutations), never by warehouse.record.manage; the master operations keep theirs", () => {
  const racking = { listRackingWarehouses: false, listRackingBins: false, previewBinCreates: false, createBins: true, renameRackingBin: true, setRackingBinStatus: true };
  for (const [op, mutation] of Object.entries(racking)) {
    assert.equal(ADMIN_CONFIGURATION_OPERATIONS[op].mutation, mutation, op);
    assert.equal(ADMIN_CONFIGURATION_OPERATIONS[op].capability, mutation ? RACKING_MANAGE_CAPABILITY : RACKING_READ_CAPABILITY, op);
    assert.ok(isWarehouseAdminOperation(op), `${op} is served by the warehouse/bin administration handler`);
    assert.ok(WAREHOUSE_ADMIN_OPERATIONS.includes(op));
  }
  for (const op of ["listWarehouses", "listWarehouseBins", "createWarehouse", "updateWarehouse", "setWarehouseStatus", "createBin", "relabelBin", "setBinStatus"]) {
    assert.equal(ADMIN_CONFIGURATION_OPERATIONS[op].capability, WAREHOUSE_MASTER_CAPABILITY, `${op} keeps the warehouse master key`);
  }
});

test("the planner commits ONE BIN PER TRANSACTION and has no whole-batch transaction, no giant success flag and no revive-on-create", () => {
  const src = readFileSync(join(FUNCTIONS_DIR, "src/eosOps/warehouseBinAdministration.ts"), "utf8");
  const apply = src.slice(src.indexOf("async function applyOneBin"), src.indexOf("async function createBins"));
  assert.match(apply, /BEGIN/);
  assert.match(apply, /COMMIT/);
  assert.match(apply, /await audit\(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS\.BIN_CREATED/, "one audit row per created bin, in the bin's own transaction");
  const batch = src.slice(src.indexOf("async function createBins"), src.indexOf("/** The bin (with its warehouse's company)"));
  assert.doesNotMatch(batch, /BEGIN|COMMIT/, "the batch itself opens no transaction");
  assert.match(batch, /complete: count\("REFUSED"\) === 0/);
  assert.doesNotMatch(src.slice(src.indexOf("async function applyOneBin"), src.indexOf("async function createBins")), /UPDATE eos_ops\.bins|setBinStatus|DELETE/, "a create never moves, overwrites, revives or deletes");
});

// ════════════════════════════ 4. THE CENSUS ════════════════════════════

const census = (over = {}) => classifyFirebaseBins({
  firebase: {
    warehouses: [{ id: "wh-main", name: "Main" }, { id: "wh-real", name: "Phoenix" }, { id: "wh-orphan", name: "Elsewhere" }, { id: "wh-qa", name: "QA test warehouse" }],
    bins: [
      { id: "b-fx", warehouseId: "wh-main", area: "A", aisle: "A", bay: 1, position: 1, code: "A01-001" },
      { id: "b-qa", warehouseId: "wh-qa", area: "A", aisle: "A", bay: 1, position: 1, code: "A01-001" },
      { id: "b-dup-eos", warehouseId: "wh-real", area: "PARTS", aisle: "A", bay: 1, position: 1, code: "A01-001" },
      { id: "b-twin-1", warehouseId: "wh-real", area: "PARTS", aisle: "B", bay: 1, position: 1, code: "B01-001" },
      { id: "b-twin-2", warehouseId: "wh-real", area: "PARTS", aisle: "B", bay: 1, position: 1, code: "B01-001" },
      { id: "b-unique", warehouseId: "wh-real", area: "PARTS", aisle: "C", bay: 1, position: 1, code: "C01-001" },
      { id: "b-orphan", warehouseId: "wh-orphan", area: "PARTS", aisle: "A", bay: 1, position: 1, code: "A01-001" },
    ],
  },
  eos: {
    warehouses: [{ warehouseId: "wh-real", name: "Phoenix" }, { warehouseId: "taylor-main" }],
    bins: [{ binId: "bin_eos1", warehouseId: "wh-real", area: "PARTS", aisle: "A", bay: 1, position: 1, code: "A01-001" }],
  },
  ...over,
});

test("every Firebase bin gets exactly ONE class with reasons: synthetic > duplicate > unmatched", () => {
  const byId = Object.fromEntries(census().rows.map((r) => [r.firebaseBinId, r]));
  assert.equal(byId["b-fx"].classification, "SYNTHETIC");
  assert.deepEqual(byId["b-fx"].reasons.slice(0, 1), ["fixture_warehouse_identity"]);
  assert.equal(byId["b-qa"].classification, "SYNTHETIC");
  assert.equal(byId["b-dup-eos"].classification, "DUPLICATE");
  assert.equal(byId["b-dup-eos"].eosBinId, "bin_eos1");
  assert.equal(byId["b-twin-1"].classification, "DUPLICATE");
  assert.deepEqual(byId["b-twin-1"].duplicateOfFirebaseBinIds, ["b-twin-2"]);
  assert.equal(byId["b-unique"].classification, "UNMATCHED");
  assert.ok(byId["b-unique"].reasons.includes("eos_holds_no_bin_here"));
  assert.equal(byId["b-orphan"].classification, "UNMATCHED");
  assert.ok(byId["b-orphan"].reasons.includes("no_eos_warehouse_for_this_firebase_warehouse"));
  const { counts } = census();
  assert.deepEqual([counts.SYNTHETIC, counts.DUPLICATE, counts.UNMATCHED, counts.total], [2, 3, 2, 7]);
});

test("a warehouse maps by an explicit manifest, else by the same id -- never by name", () => {
  const mapped = census({ warehouseMap: { "wh-orphan": "taylor-main" } });
  assert.equal(mapped.rows.find((r) => r.firebaseBinId === "b-orphan").eosWarehouseId, "taylor-main");
  const byName = classifyFirebaseBins({
    firebase: { warehouses: [{ id: "fb-1", name: "Phoenix" }], bins: [{ id: "x", warehouseId: "fb-1", area: "P", aisle: "A", bay: 1, position: 1, code: "A01-001" }] },
    eos: { warehouses: [{ warehouseId: "wh-real", name: "Phoenix" }], bins: [] },
  });
  assert.equal(byName.rows[0].eosWarehouseId, null, "the same NAME is not the same warehouse");
  assert.equal(byName.rows[0].classification, "UNMATCHED");
});

test("the census CLI reads two files, writes nothing but an optional exclusive report, loads no SDK, and refuses to overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "bin-census-"));
  const doc = (id, data) => ({ id, data });
  writeFileSync(join(dir, "snap.json"), JSON.stringify({
    format: "EOS_BIN_SNAPSHOT", version: 1,
    warehouses: [doc("wh-main", { name: "Main" }), doc("wh-real", { name: "Phoenix" })],
    bins: [doc("b1", { warehouseId: "wh-main", area: "A", aisle: "A", bay: 1, position: 1, code: "A01-001" }), doc("b2", { warehouseId: "wh-real", area: "PARTS", aisle: "C", bay: 1, position: 1, code: "C01-001" })],
    binCodeClaims: [],
  }));
  writeFileSync(join(dir, "eos.json"), JSON.stringify({ warehouses: [{ warehouseId: "wh-real" }], bins: [] }));
  const out = join(dir, "report.json");
  const run = () => spawnSync(process.execPath, ["scripts/binCensus.js", "--snapshot", join(dir, "snap.json"), "--eos", join(dir, "eos.json"), "--out", out],
    { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const printed = JSON.parse(first.stdout);
  assert.deepEqual([printed.counts.SYNTHETIC, printed.counts.UNMATCHED, printed.counts.total], [1, 1, 2]);
  assert.ok(existsSync(out) && existsSync(`${out}.sha256`));
  const report = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(report.format, "EOS_BIN_CENSUS");
  assert.match(report.inputs.snapshotSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(run().status, 0, "an existing report is never overwritten");
  const wrong = spawnSync(process.execPath, ["scripts/binCensus.js", "--snapshot", join(dir, "eos.json"), "--eos", join(dir, "eos.json")], { cwd: FUNCTIONS_DIR, encoding: "utf8" });
  assert.notEqual(wrong.status, 0, "a file that is not an EOS_BIN_SNAPSHOT is refused");
});

test("the census tool and the exporter are read-only: no write verb, no SDK in the census, a fenced exporter", () => {
  const strip = (file) => readFileSync(join(FUNCTIONS_DIR, file), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const censusCli = strip("scripts/binCensus.js");
  assert.doesNotMatch(censusCli, /firebase-admin|google-auth-library|require\("pg"\)|DATABASE_URL|fetch\(/, "the census opens no connection and holds no credential");
  const exporter = strip("scripts/exportBinSnapshot.js");
  assert.doesNotMatch(exporter, /\.(set|add|update|delete|create|batch|runTransaction|bulkWriter|recursiveDelete)\(/, "no Firestore write verb");
  assert.match(readFileSync(join(FUNCTIONS_DIR, "scripts/exportBinSnapshot.js"), "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY\r?$/);
  assert.match(exporter, /assertExportInvocation\(args\)/);
  assert.ok(exporter.indexOf("assertExportInvocation(args)") < exporter.indexOf('require("firebase-admin/app")'), "the fence runs before the SDK is loaded");
  assert.deepEqual(Object.values(require("../scripts/exportBinSnapshot.js").SOURCE_COLLECTIONS).sort(), ["bin_code_claims", "bins", "warehouses"]);
});

// ════════════════════════════ 5. THE MIGRATION ════════════════════════════

test("the migration registers the two keys, creates empty tables only, and the legacy archive has no application writer", () => {
  const sql = readFileSync(join(FUNCTIONS_DIR, "migrations/1764630000000_warehouse-receiving-bins-on-eos.sql"), "utf8");
  const up = sql.split("-- Down Migration")[0];
  assert.match(up, /'inventory\.location\.bin\.read'/);
  assert.match(up, /'inventory\.location\.bin\.manage'/);
  for (const table of ["supplier_purchase_orders", "supplier_purchase_order_lines", "legacy_inventory_action_notes"]) assert.match(up, new RegExp(`CREATE TABLE ${table}`));
  // No row of business data: the only INSERTs are the capability registration and the grants.
  const inserts = [...up.matchAll(/INSERT INTO (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ["capabilities", "role_capabilities"]);
  const sources = ["src/eosOps/legacyInventoryActionNotes.ts", "src/eosOps/supplierPurchaseOrderReceiving.ts", "src/eosOps/warehouseBinAdministration.ts"].map((f) => readFileSync(join(FUNCTIONS_DIR, f), "utf8")).join("\n");
  assert.doesNotMatch(sources, /(INSERT INTO|UPDATE|DELETE FROM)\s+\$\{SCHEMA\}\.legacy_inventory_action_notes|legacy_inventory_action_notes\s+SET/, "nothing in the application writes the archive");
});
