// GRANT-1 OWNER POLICY GRANTS -- the OFFLINE contracts (Owner policy decisions A1, A2, A3, A4, A7, 2026-10-19; migration 1764670000000). No database.
//
// The Owner's list, exactly, and nothing beyond it:
//   A1  Parts Managers activate and deactivate Parts and Manufacturers WITHOUT Supplier status: a NEW key, inventory.catalog.part.activate, enforced by changePartStatus and
//       changeManufacturerStatus, granted to partsManager and to every current holder of inventory.catalog.activate (admin). Supplier status stays on inventory.catalog.activate.
//   A2  inventory.stock.receive + receivingOrder.record.read -> partsAssociate, warehouseAssociate.
//   A3a ownership.handoff.correct -> salesManager, generalManager.   A3b serviceInboundWorkReviewer -> inboundWork.request.{read,accept,decline,attach}, workOrder.create, workOrder.record.read.
//   A4  equipment.model.manage + inventory.catalog.read -> warehouseManager, generalManager, fieldManager, partsManager (the four catalog reads are already held).
//   A7  the 12 verified Firebase purchasing-parity pairs; technicians are excluded; the four keys leave ADMINISTRATION_GRANT_ONLY_CAPABILITIES.
// 1 capability + 30 NEW grants. The Postgres half (stamped grants, an honoured ADMIN_REVOKED, the A1 refusals and allowances of real personas, A3-REASON) is
// grant1OwnerPolicyGrantsPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const { ADMINISTRATION_GRANT_ONLY_CAPABILITIES, defaultWriterMayInsert, resolveCell, decisionIndex } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const { CATALOG_CAPABILITIES } = require("../lib/catalogMaster/catalogMasterKernel.js");
const { SUPPLIER_STATUS_CAPABILITY } = require("../lib/eosOps/supplierAdministration.js");

const MIGRATION_FILE = "1764670000000_owner-policy-grants.sql";
const STAMP = "migration:1764670000000";
const NEW_KEY = "inventory.catalog.part.activate";
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const pairId = (roleKey, key) => `${roleKey}|${key}`;

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const EVIDENCE = JSON.parse(read(join(REPO, "docs", "architecture", "grant1-owner-policy-grants.json")));
const BASELINE = JSON.parse(read(join(FUNCTIONS_DIR, "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json")));
const migrationSql = () => read(join(FUNCTIONS_DIR, "migrations", MIGRATION_FILE));
const upOf = (sql) => sql.slice(0, sql.indexOf("-- Down Migration")).replace(/^\s*--.*$/gm, "");

// The Owner's list, restated here (NOT read from the evidence file) so the evidence is itself proved against it.
const OWNER_LIST = Object.freeze({
  A1: ["admin|" + NEW_KEY, "partsManager|" + NEW_KEY],
  A2: ["partsAssociate|inventory.stock.receive", "warehouseAssociate|inventory.stock.receive", "partsAssociate|receivingOrder.record.read", "warehouseAssociate|receivingOrder.record.read"],
  A3a: ["salesManager|ownership.handoff.correct", "generalManager|ownership.handoff.correct"],
  A3b: ["inboundWork.request.read", "inboundWork.request.accept", "inboundWork.request.decline", "inboundWork.request.attach", "workOrder.create", "workOrder.record.read"]
    .map((k) => "serviceInboundWorkReviewer|" + k),
  A4: ["equipment.model.manage", "inventory.catalog.read"].flatMap((k) => ["warehouseManager", "generalManager", "fieldManager", "partsManager"].map((r) => `${r}|${k}`)),
  A7: [
    "admin|reorder.request.startPurchasing", "admin|reorder.request.postPurchasingUpdate", "admin|reorder.request.recordPurchaseOrder", "admin|inventory.catalog.alias.read",
    "dispatcher|reorder.request.startPurchasing", "dispatcher|reorder.request.postPurchasingUpdate", "dispatcher|reorder.request.recordPurchaseOrder",
    "purchasingManager|reorder.request.startPurchasing", "purchasingManager|reorder.request.postPurchasingUpdate", "purchasingManager|reorder.request.recordPurchaseOrder",
    "generalManager|reorder.request.postPurchasingUpdate", "inventoryStockRelocationOperator|inventory.catalog.alias.read",
  ],
});
const A4_ALREADY_HELD = ["warehouseManager", "generalManager", "fieldManager", "partsManager"].map((r) => `${r}|inventory.catalog.read`);
const OWNER_ALL = Object.values(OWNER_LIST).flat();
const OWNER_NEW = OWNER_ALL.filter((p) => !A4_ALREADY_HELD.includes(p));

/** The VALUES list of the migration: ('role', 'capability.key') rows only. */
function migrationPairs() {
  const sql = upOf(migrationSql());
  const start = sql.indexOf("JOIN (VALUES");
  const end = sql.indexOf(") AS g(role_key, capability_key)");
  assert.ok(start > 0 && end > start, "the migration's VALUES list is where the proof expects it");
  return [...sql.slice(start, end).matchAll(/\('([A-Za-z]+)',\s*'([A-Za-z0-9_.]+)'\)/g)].map((m) => pairId(m[1], m[2]));
}

test("a. the migration's VALUES are the Owner's list exactly: 34 pairs named, 30 new, the 4 catalog reads already held, no duplicate", () => {
  const fromMigration = migrationPairs();
  assert.equal(fromMigration.length, 34);
  assert.equal(new Set(fromMigration).size, 34, "no duplicate pair");
  assert.deepEqual([...fromMigration].sort(), [...OWNER_ALL].sort(), "the migration writes exactly the Owner's list -- no other holder, no other key");
  assert.deepEqual(Object.fromEntries(Object.entries(OWNER_LIST).map(([k, v]) => [k, v.length])), { A1: 2, A2: 4, A3a: 2, A3b: 6, A4: 8, A7: 12 });
  assert.equal(OWNER_NEW.length, 30);
});

test("a. the evidence file equals the Owner's list, item for item", () => {
  const items = EVIDENCE.items;
  assert.deepEqual([...items.A1.new].sort(), [...OWNER_LIST.A1].sort());
  assert.deepEqual([...items.A2.new].sort(), [...OWNER_LIST.A2].sort());
  assert.deepEqual([...items.A3a.new].sort(), [...OWNER_LIST.A3a].sort());
  assert.deepEqual([...items.A3b.new].sort(), [...OWNER_LIST.A3b].sort());
  assert.deepEqual([...items.A4.new, ...items.A4.alreadyHeld].sort(), [...OWNER_LIST.A4].sort());
  assert.deepEqual([...items.A4.alreadyHeld].sort(), [...A4_ALREADY_HELD].sort());
  assert.deepEqual([...items.A7.new].sort(), [...OWNER_LIST.A7].sort());
  assert.deepEqual(EVIDENCE.migration, { file: `functions/migrations/${MIGRATION_FILE}`, stamp: STAMP, idPrefix: "rc_g1_", capabilitiesRegistered: 1, newGrantsWritten: 30, pairsNamedInValues: 34, pairsAlreadyHeld: 4 });
  assert.deepEqual(EVIDENCE.counts, {
    baseline: { before: 659, after: 689, migrationBackedBefore: 601, migrationBackedAfter: 631 },
    capabilities: { before: 193, after: 194 }, migrations: { before: 108, after: 109 }, shellRequestSet: { before: 63, after: 64 },
  });
});

test("a. A7 is Firebase parity: every pair is declared by the Firebase catalogs; the catalogs declare nothing else for the four keys but the excluded technician and the existing lookup Role", () => {
  const A7_KEYS = ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder", "inventory.catalog.alias.read"];
  const declared = deriveLegacyRoleGrants(A7_KEYS).map((g) => pairId(g.roleKey, g.capabilityKey));
  for (const pair of OWNER_LIST.A7) assert.ok(declared.includes(pair), `${pair} is declared by the Firebase catalogs`);
  const rest = declared.filter((p) => !OWNER_LIST.A7.includes(p)).sort();
  assert.deepEqual(rest, [
    "inventoryLookupReader|inventory.catalog.alias.read", // already an EOS holder through Administration (truckInventoryActivationDelta); the Owner list does not re-grant it
    "technician|reorder.request.postPurchasingUpdate", "technician|reorder.request.recordPurchaseOrder", "technician|reorder.request.startPurchasing", // EXCLUDED
  ]);
  assert.deepEqual(EVIDENCE.items.A7.excluded[0].capabilities.sort(), A7_KEYS.slice(0, 3).sort());
});

test("b. the baseline carries exactly the 30 new pairs, each MIGRATION_BACKED and explained by this migration; the 4 held reads keep their earlier evidence", () => {
  const stamped = BASELINE.grants.filter((g) => g.evidence === STAMP);
  assert.deepEqual(stamped.map((g) => pairId(g.roleKey, g.capabilityKey)).sort(), [...OWNER_NEW].sort());
  for (const g of stamped) assert.deepEqual([g.source, g.observedGrantedBy], ["MIGRATION_BACKED", STAMP], pairId(g.roleKey, g.capabilityKey));
  for (const pair of A4_ALREADY_HELD) {
    const [roleKey, capabilityKey] = pair.split("|");
    const row = BASELINE.grants.find((g) => g.roleKey === roleKey && g.capabilityKey === capabilityKey);
    assert.ok(row, `${pair} is already in the baseline`);
    assert.equal(row.evidence, "migration:1761523200000", pair);
  }
  assert.equal(BASELINE.grants.length, 689);
  assert.equal(BASELINE.totalGrants, 689);
  assert.equal(BASELINE.deployment.rebuildTotal, 689);
  assert.deepEqual(BASELINE.countsBySource, { MIGRATION_BACKED: 631, CANONICAL_CATALOG: 53, NONPROD_ACTIVATION: 5, FIXTURE_ONLY: 0, UNEXPLAINED: 0 });
  assert.ok(BASELINE.grantBearingMigrations.includes(STAMP));
  assert.ok(BASELINE.deployment.notYetAppliedToNonprod.includes(STAMP));
  assert.equal(new Set(BASELINE.grants.map((g) => pairId(g.roleKey, g.capabilityKey))).size, 689, "no duplicate baseline pair");
});

test("b. nobody gains anything outside the list: no technician holds an A7 key, Owner gains nothing, and the new key has exactly two holders", () => {
  const holders = (key) => BASELINE.grants.filter((g) => g.capabilityKey === key).map((g) => g.roleKey).sort();
  assert.deepEqual(holders(NEW_KEY), ["admin", "partsManager"]);
  for (const key of ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder"]) {
    assert.equal(holders(key).includes("technician"), false, `technician holds ${key}`);
    assert.equal(holders(key).includes("owner"), false, `owner holds ${key}`);
  }
  assert.equal(BASELINE.grants.filter((g) => g.evidence === STAMP && g.roleKey === "owner").length, 0, "Owner is granted nothing by this migration");
  assert.deepEqual([...new Set(BASELINE.grants.filter((g) => g.evidence === STAMP).map((g) => g.roleKey))].sort(), [
    "admin", "dispatcher", "fieldManager", "generalManager", "inventoryStockRelocationOperator", "partsAssociate", "partsManager", "purchasingManager", "salesManager",
    "serviceInboundWorkReviewer", "warehouseAssociate", "warehouseManager",
  ]);
  // inventory.catalog.activate keeps its holders (admin) -- the split takes nothing from anybody.
  assert.deepEqual(holders("inventory.catalog.activate"), ["admin"]);
});

test("c. the fence: the four A7 keys left ADMINISTRATION_GRANT_ONLY_CAPABILITIES, no other fenced key moved, and the technician pairs are pair-level non-defaults", () => {
  for (const key of ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder", "inventory.catalog.alias.read"]) {
    assert.equal(ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(key), false, `${key} left the fence`);
  }
  assert.deepEqual([...ADMINISTRATION_GRANT_ONLY_CAPABILITIES].sort(), EVIDENCE.fence.stillAdministrationGrantOnly);
  for (const key of ["reorder.request.startPurchasing", "reorder.request.postPurchasingUpdate", "reorder.request.recordPurchaseOrder"]) {
    // The behaviour, not the encoding: a reconcile / default writer never imports the technician pair, and an Administration grant still can.
    assert.deepEqual(resolveCell({ roleKey: "technician", capabilityKey: key, decision: null, isSystemDefault: true }), { shouldHold: false, source: "NONE" }, `technician/${key}`);
    assert.deepEqual(defaultWriterMayInsert(new Map(), "technician", key), { allowed: false, source: "NONE" });
    assert.deepEqual(resolveCell({ roleKey: "technician", capabilityKey: key, decision: "ADMIN_GRANTED", isSystemDefault: true }), { shouldHold: true, source: "ADMIN_GRANTED" });
  }
  assert.deepEqual(EVIDENCE.fence.pairLevelNonDefaultsAdded.sort(), [
    "technician|reorder.request.postPurchasingUpdate", "technician|reorder.request.recordPurchaseOrder", "technician|reorder.request.startPurchasing",
  ]);
  // Every A7 pair is a default for its Role now (the explicit grant replaced the fence) and a current Administration revoke always wins.
  for (const pair of OWNER_LIST.A7) {
    const [roleKey, key] = pair.split("|");
    assert.equal(defaultWriterMayInsert(new Map(), roleKey, key).allowed, true, pair);
    const revoked = decisionIndex([{ roleKey, capabilityKey: key, decision: "ADMIN_REVOKED" }]);
    assert.deepEqual(defaultWriterMayInsert(revoked, roleKey, key), { allowed: false, source: "ADMIN_REVOKED" }, pair);
  }
});

test("d. A1: the new key is PostgreSQL-native, enforced by the Part and Manufacturer status writers, and Supplier status stays on inventory.catalog.activate", () => {
  assert.equal(NEW_KEY, EVIDENCE.newCapability.key);
  assert.equal(PERMISSION_CATALOG.some((p) => p.id === NEW_KEY), false, "absent from the in-repo catalog: the compiled admin Role composes it whole and would be granted the key by default");
  assert.equal(CATALOG_CAPABILITIES.PART_ACTIVATE, NEW_KEY);
  assert.equal(CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE, NEW_KEY);
  assert.equal(SUPPLIER_STATUS_CAPABILITY, "inventory.catalog.activate");
  assert.notEqual(SUPPLIER_STATUS_CAPABILITY, NEW_KEY);
  const src = (f) => read(join(FUNCTIONS_DIR, "src", f));
  const fn = (text, name) => text.slice(text.indexOf(`export async function ${name}(`), text.indexOf("\n}\n", text.indexOf(`export async function ${name}(`)));
  assert.match(fn(src("catalogMaster/postgresPartMasterWriter.ts"), "changePartStatus"), /CATALOG_CAPABILITIES\.PART_ACTIVATE/);
  assert.match(fn(src("catalogMaster/postgresManufacturerWriter.ts"), "changeManufacturerStatus"), /CATALOG_CAPABILITIES\.MANUFACTURER_ACTIVATE/);
  assert.match(src("eosOps/supplierAdministration.ts"), /requireCapability\(actor, SUPPLIER_STATUS_CAPABILITY\)/);
  // The migration registers it exactly once, as a BUSINESS_ACTION on the part Object, and grants it by explicit VALUES to admin and partsManager.
  const up = upOf(migrationSql());
  assert.equal(up.match(/INSERT INTO capabilities/g).length, 1);
  assert.match(up, /'cap_inventory_catalog_part_activate',\s*'inventory\.catalog\.part\.activate'/);
  assert.match(up, /'part',\s*'changeStatus',\s*'BUSINESS_ACTION'/);
  assert.deepEqual(migrationPairs().filter((p) => p.endsWith("|" + NEW_KEY)).sort(), ["admin|" + NEW_KEY, "partsManager|" + NEW_KEY]);
});

test("e. the migration's shape: two grant inserts (the list, then every other current holder of the old key), ON CONFLICT DO NOTHING, an honoured ADMIN_REVOKED, protected Roles only as the protected rows, no direct grant", () => {
  const up = upOf(migrationSql());
  assert.equal(up.match(/INSERT INTO role_capabilities/g).length, 2);
  assert.equal(up.match(/INSERT INTO /g).length, 3, "one capability and two Role-grant inserts, nothing else");
  assert.equal((up.match(/ON CONFLICT \(tenant_id, role_id, capability_id\) DO NOTHING/g) ?? []).length, 2);
  assert.equal((up.match(/d\.decision = 'ADMIN_REVOKED'/g) ?? []).length, 2, "an Administration revoke is honoured by both inserts");
  assert.equal((up.match(/r\.key NOT IN \('owner', 'admin'\) OR r\.protected = TRUE/g) ?? []).length, 2, "the protected Roles are matched only as the protected rows");
  assert.match(up, /'migration:1764670000000'/);
  assert.doesNotMatch(up, /principal_capabilities|grant_conditions/i, "no direct, conditioned or scoped grant");
  assert.doesNotMatch(up, /\b(DELETE|UPDATE|DROP|ALTER)\b/, "the up only inserts");
  // The second insert copies the NEW key to other holders of the OLD key -- it can never widen beyond that.
  assert.match(up, /o\.key = 'inventory\.catalog\.activate'/);
  assert.match(up, /n\.key = 'inventory\.catalog\.part\.activate'/);
  // The down refuses while Administration or a direct grant names the new key or one of its pairs, then removes exactly what it wrote.
  const down = migrationSql().slice(migrationSql().indexOf("-- Down Migration"));
  assert.match(down, /RAISE EXCEPTION 'GRANT1_OWNER_POLICY_GRANTS/);
  assert.match(down, /DELETE FROM eos_policy\.role_capabilities WHERE granted_by = 'migration:1764670000000'/);
  assert.match(down, /DELETE FROM eos_policy\.capabilities WHERE key = 'inventory\.catalog\.part\.activate'/);
});

test("f. A3-REASON: an administrative ownership handoff states a non-blank reason, refused before any write, on the Account and the Opportunity", () => {
  assert.deepEqual(EVIDENCE.reasonRule.enforcedBy.length, 2);
  const account = read(join(FUNCTIONS_DIR, "src", "eosCrm", "accountAuthority.ts"));
  const check = account.indexOf('fail("REASON_REQUIRED"');
  assert.ok(check > 0, "updateAccount refuses REASON_REQUIRED");
  assert.ok(check < account.indexOf("const newOwner = await requireOwnerEmployee(db, tenantId, owner)"), "the account refusal precedes the first write (requireOwnerEmployee / stageAccountOwnershipChange)");
  const opp = read(join(FUNCTIONS_DIR, "src", "eosCommercial", "commands", "opportunityCommandService.ts"));
  const oppCheck = opp.indexOf('fail("REASON_REQUIRED"');
  assert.ok(oppCheck > 0, "updateOpportunity refuses REASON_REQUIRED");
  assert.ok(oppCheck < opp.indexOf("UPDATE eos_commercial.opportunities"), "the opportunity refusal precedes the UPDATE");
});

test("g. the Sample Company vocabulary lists the new key, and the General Manager persona no longer forbids equipment.model.manage (A4)", () => {
  const manifest = JSON.parse(read(join(FUNCTIONS_DIR, "scripts", "fixtures", "sampleCompany.v2.json")));
  assert.ok(manifest.expectedAccess.postgresCapabilityVocabulary.includes(NEW_KEY));
  assert.equal(manifest.expectedAccess.personas["general-manager"].forbiddenCapabilities.includes("equipment.model.manage"), false);
});
