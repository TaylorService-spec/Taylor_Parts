// B4 REPORT / PERFORMANCE-GOAL GRANT PARITY -- the OFFLINE contracts (Firebase exit B4, DECISIONS #B4, OD-B4-1; migration 1764650000000). No database.
//
// Owner authorization 2026-10-18 ("B4 REPORT/GOAL PERMISSION PARITY", reaffirmed "COMPLETE B4 GRANT MIGRATION"), nonprod only: the 39 keys migration
// 1764640000000 registered are granted to EXACTLY the Firebase holders -- 122 (Role, key) pairs over 15 Roles -- and to nobody else.
//   a. The migration's VALUES equal, pair for pair, the holders derived from COMPATIBILITY_ROLES + GOVERNED_BUSINESS_ROLES, and equal the parity evidence file.
//      No duplicate, no scoped or conditioned B4 key in Firebase (so every grant is flat).
//   b. Zero additional holders: no other migration, seed, baseline entry, default writer (defaultWriterMayInsert / resolveCell), catalog sync (deriveLegacyRoleGrants)
//      or Sample Company reconcile yields a B4 key for a Role outside the 122 pairs; the fence for the 39 is gone and no other fenced key moved.
//   c. Administrator holds all 39 and Owner holds exactly its Firebase set (the same 39); every pre-existing Owner exclusion is unchanged.
// The Postgres half (stamped grants, an honoured ADMIN_REVOKED, the refusals and allowances of real personas) is b4ReportGoalGrantParityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = resolve(HERE, "..");
const REPO = resolve(FUNCTIONS_DIR, "..");
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES, OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES } = require("../lib/access/governedBusinessRoles.js");
const { ADMINISTRATION_GRANT_ONLY_CAPABILITIES, defaultWriterMayInsert, resolveCell, decisionIndex } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const seed = require("../scripts/seedSampleCompany.js");

const MIGRATION_ID = "1764650000000";
const MIGRATION_FILE = `1764650000000_b4-report-goal-grant-parity.sql`;
const STAMP = `migration:${MIGRATION_ID}`;
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const B4_KEYS = PERMISSION_CATALOG.map((p) => p.id).filter((id) => (id.startsWith("report.") && id !== "report.definition.read") || id === "performance.goal.read").sort();
const B4 = new Set(B4_KEYS);
const pairId = (roleKey, key) => `${roleKey}|${key}`;

const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const PARITY = JSON.parse(read(join(REPO, "docs", "architecture", "b4-report-goal-grant-parity.json")));
const BASELINE = JSON.parse(read(join(FUNCTIONS_DIR, "src", "adminPolicy", "seed", "roleCapabilityAuthorityBaseline.json")));

/** The (role, key) pairs the Firebase catalogs declare for the 39 keys -- the source the migration must equal. */
const catalogPairs = () => Object.entries(ROLES).flatMap(([roleKey, role]) => (role.permissions ?? []).filter((k) => B4.has(k)).map((k) => pairId(roleKey, k))).sort();

/** The VALUES list of the migration: ('role', 'capability.key') rows only (the `owner`/`admin` protected-row predicate carries no dot). */
function migrationPairs() {
  const sql = read(join(FUNCTIONS_DIR, "migrations", MIGRATION_FILE)).replace(/^\s*--.*$/gm, "");
  const start = sql.indexOf("JOIN (VALUES");
  const end = sql.indexOf(") AS g(role_key, capability_key)");
  assert.ok(start > 0 && end > start, "the migration's VALUES list is where the proof expects it");
  return [...sql.slice(start, end).matchAll(/\('([A-Za-z]+)',\s*'([A-Za-z0-9_.]+)'\)/g)].map((m) => pairId(m[1], m[2]));
}

test("a. the migration's VALUES equal, pair for pair, the Firebase holders of the 39 keys -- 122 pairs, 15 Roles, no duplicate", () => {
  assert.equal(B4_KEYS.length, 39, "38 report.* ids (report.definition.read has an EOS twin) + performance.goal.read");
  const fromMigration = migrationPairs();
  assert.equal(fromMigration.length, 122);
  assert.equal(new Set(fromMigration).size, 122, "no duplicate pair");
  assert.deepEqual([...fromMigration].sort(), catalogPairs(), "the migration writes exactly what the compiled Firebase catalogs declare");
  const roles = new Set(fromMigration.map((p) => p.split("|")[0]));
  assert.equal(roles.size, 15);
  // Every VALUES key is one of the 39, and every one of the 39 is granted to somebody.
  assert.deepEqual([...new Set(fromMigration.map((p) => p.split("|")[1]))].sort(), B4_KEYS);
  const perRole = {};
  for (const p of fromMigration) perRole[p.split("|")[0]] = (perRole[p.split("|")[0]] ?? 0) + 1;
  assert.deepEqual(perRole, {
    admin: 39, owner: 39, reportViewer: 26, reportFinanceViewer: 5, reportAuthor: 3,
    fieldManager: 1, generalManager: 1, operationsManager: 1, partsAssociate: 1, partsManager: 1, performanceGoalSubject: 1,
    salesManager: 1, salesperson: 1, warehouseAssociate: 1, warehouseManager: 1,
  });
});

test("a. the migration equals the parity evidence file (counts, per-Role counts, per-key holders), and the diff against Firebase is empty", () => {
  const fromEvidence = Object.entries(PARITY.holdersByKey).flatMap(([key, holders]) => holders.map((r) => pairId(r, key))).sort();
  assert.deepEqual(fromEvidence, [...migrationPairs()].sort());
  assert.deepEqual([PARITY.keyCount, PARITY.pairCount, PARITY.roleCount], [39, 122, 15]);
  assert.deepEqual(Object.keys(PARITY.holdersByKey).sort(), B4_KEYS);
  assert.deepEqual(PARITY.diff, { firebaseOnly: [], eosOnly: [] });
  const perRole = {};
  for (const p of fromEvidence) perRole[p.split("|")[0]] = (perRole[p.split("|")[0]] ?? 0) + 1;
  assert.deepEqual(PARITY.pairsPerRole, perRole);
  // The holders per key, restated from the catalogs rather than trusted from the file.
  for (const key of B4_KEYS) {
    const holders = Object.entries(ROLES).filter(([, r]) => (r.permissions ?? []).includes(key)).map(([id]) => id).sort();
    assert.deepEqual([...PARITY.holdersByKey[key]].sort(), holders, key);
  }
});

test("a. no B4 key is scoped or conditioned in Firebase, so every grant is flat; the migration writes a flat Role grant only", () => {
  assert.deepEqual(PARITY.scopedOrConditionedInFirebase, {});
  for (const [roleKey, role] of Object.entries(ROLES)) {
    for (const key of B4_KEYS) {
      assert.equal(Object.prototype.hasOwnProperty.call(role.scopesByPermission ?? {}, key), false, `${roleKey} scopes ${key}`);
      assert.equal(Object.prototype.hasOwnProperty.call(role.conditionsByPermission ?? {}, key), false, `${roleKey} conditions ${key}`);
    }
  }
  const sql = read(join(FUNCTIONS_DIR, "migrations", MIGRATION_FILE)).replace(/^\s*--.*$/gm, "");
  const up = sql.slice(0, sql.indexOf("-- Down Migration") > 0 ? sql.indexOf("-- Down Migration") : sql.indexOf("DO $$"));
  assert.match(up, /INSERT INTO role_capabilities/);
  assert.doesNotMatch(up, /principal_capabilities|grant_conditions|role_capability_decisions\s*\(|scope/i, "no direct, conditioned or scoped grant");
  assert.equal(up.match(/INSERT INTO/g).length, 1, "the migration's one write is the Role grant");
  assert.match(up, /'migration:1764650000000'/);
  assert.match(up, /ON CONFLICT \(tenant_id, role_id, capability_id\) DO NOTHING/);
  assert.match(up, /d\.decision = 'ADMIN_REVOKED'/, "an Administration revoke is honoured");
  assert.match(up, /r\.key NOT IN \('owner', 'admin'\) OR r\.protected = TRUE/, "the protected Roles are matched only as the protected rows");
  assert.doesNotMatch(up, /\b(DELETE|UPDATE|DROP|ALTER)\b/, "the up writes one INSERT and changes nothing else (SQL keywords in upper case; a key may end in .delete)");
});

test("b. nothing else yields a B4 key to another Role: catalog sync, default writers, the authority baseline", () => {
  const allowed = new Set(migrationPairs());
  // The catalog sync (the default writers' candidate set, every canonical Role) yields exactly the 122.
  const sync = deriveLegacyRoleGrants(B4_KEYS).map((g) => pairId(g.roleKey, g.capabilityKey));
  assert.deepEqual([...sync].sort(), [...allowed].sort());
  // The baseline carries exactly the 122 B4 entries, each explained by this migration -- no other source.
  const inBaseline = BASELINE.grants.filter((g) => B4.has(g.capabilityKey));
  assert.deepEqual(inBaseline.map((g) => pairId(g.roleKey, g.capabilityKey)).sort(), [...allowed].sort());
  for (const g of inBaseline) {
    assert.deepEqual([g.source, g.evidence, g.observedGrantedBy], ["MIGRATION_BACKED", STAMP, STAMP], pairId(g.roleKey, g.capabilityKey));
  }
  // 689 -> 697: the 8 A6 customer-balance summary grants (migration 1764680000000).
  // 632 -> 659 -> 689: the 27 P-1 supplier purchase order grants (migration 1764660000000) and the 30 GRANT-1 owner policy grants (migration 1764670000000) were appended to the baseline after the B4 parity; B4's own 122 are asserted exactly above.
  assert.equal(BASELINE.grants.length, 697);
  assert.equal(BASELINE.totalGrants, 697);
  assert.equal(BASELINE.deployment.rebuildTotal, 697);
  assert.ok(BASELINE.grantBearingMigrations.includes(STAMP));
  assert.ok(BASELINE.deployment.notYetAppliedToNonprod.includes(STAMP));
  assert.equal(new Set(BASELINE.grants.map((g) => pairId(g.roleKey, g.capabilityKey))).size, 697, "no duplicate baseline pair");
  // The default writer's rule: with no decision a declared pair may be inserted; a CURRENT Administration revoke always wins; a Role that does not declare the key is never a
  // default (callers pass isSystemDefault only for declared pairs).
  for (const pair of allowed) {
    const [roleKey, key] = pair.split("|");
    assert.equal(defaultWriterMayInsert(new Map(), roleKey, key).allowed, true, pair);
    const revoked = decisionIndex([{ roleKey, capabilityKey: key, decision: "ADMIN_REVOKED" }]);
    assert.deepEqual(defaultWriterMayInsert(revoked, roleKey, key), { allowed: false, source: "ADMIN_REVOKED" }, pair);
  }
  for (const roleKey of Object.keys(ROLES)) {
    for (const key of B4_KEYS) {
      if (allowed.has(pairId(roleKey, key))) continue;
      assert.deepEqual(resolveCell({ roleKey, capabilityKey: key, decision: null, isSystemDefault: false }), { shouldHold: false, source: "NONE" }, `${roleKey}/${key}`);
    }
  }
});

test("b. the fence for the 39 is gone (the explicit grant replaces it) and no other fenced key changed", () => {
  for (const key of B4_KEYS) assert.equal(ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(key), false, `${key} left the fence`);
  assert.deepEqual([...ADMINISTRATION_GRANT_ONLY_CAPABILITIES].sort(), [
    "inventory.serializedAsset.acquire",
    "reorder.purchaseOrder.void", "reorder.request.approve", "reorder.request.cancel", "reorder.request.markReceived",
    "reorder.request.reject",
    "workOrder.parts.plan",
  ].sort(), "the 11 keys fenced before B4 (8 Reorder lifecycle + workOrder.parts.plan + inventory.serializedAsset.acquire + inventory.catalog.alias.read), less the four GRANT-1 A7 keys (migration 1764670000000: startPurchasing, postPurchasingUpdate, recordPurchaseOrder, inventory.catalog.alias.read) that left the fence for explicit grants = 7, nothing else");
  assert.doesNotMatch(read(join(FUNCTIONS_DIR, "src", "adminPolicy", "roleCapabilityAdministration.ts")), /report\.customer\.read|performance\.goal\.read/);
});

test("b. no other migration, seed or script writes a grant of a B4 key", () => {
  const migrations = readdirSync(join(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const mentions = (text) => B4_KEYS.filter((k) => text.includes(k));
  for (const f of migrations) {
    if (f === MIGRATION_FILE) continue;
    const sql = read(join(FUNCTIONS_DIR, "migrations", f)).replace(/^\s*--.*$/gm, "");
    const hit = mentions(sql);
    if (f.startsWith("1764640000000_")) {
      // The registration migration names the keys to REGISTER them and writes no grant (also pinned by recordsReportingOffline).
      assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:eos_policy\.)?(?:role|principal)_capabilities/i, f);
      assert.ok(hit.length > 0);
      continue;
    }
    assert.deepEqual(hit, [], `${f} names a B4 key`);
  }
  // The seed files: only the capability / object metadata and the baseline name the keys; none is a grant list of another source.
  const seedDir = join(FUNCTIONS_DIR, "src", "adminPolicy", "seed");
  const MAY_NAME = new Set(["roleCapabilityAuthorityBaseline.json", "capabilityGovernedObjects.json", "policySeedSnapshot.json"]);
  for (const f of readdirSync(seedDir).filter((n) => n.endsWith(".json") && !MAY_NAME.has(n))) {
    assert.deepEqual(mentions(read(join(seedDir, f))), [], `${f} names a B4 key`);
  }
  for (const f of ["capabilityGovernedObjects.json", "policySeedSnapshot.json"]) {
    assert.doesNotMatch(read(join(seedDir, f)), /"roleKey"\s*:\s*"[^"]+",\s*"capabilityKey"\s*:\s*"(?:report\.|performance\.goal)/, `${f} carries a B4 grant row`);
  }
  // The activation / delta files (Administration commands replayed in nonprod) name no B4 key either.
  for (const f of readdirSync(join(FUNCTIONS_DIR, "src", "adminPolicy")).filter((n) => /Delta\.ts$/.test(n))) {
    assert.deepEqual(mentions(read(join(FUNCTIONS_DIR, "src", "adminPolicy", f))), [], `${f} names a B4 key`);
  }
});

test("b. the Sample Company reconcile no longer skips the 39 and still yields them to no Role outside the 122 pairs", () => {
  const allowed = new Set(migrationPairs());
  const keys = seed.sampleCompanyCapabilityKeys();
  const b4InScope = keys.filter((k) => B4.has(k));
  assert.ok(b4InScope.length > 0, "the temporary registered-not-granted filter is gone: the reconcile reaches the B4 keys the manifest's Roles declare");
  assert.doesNotMatch(read(join(FUNCTIONS_DIR, "scripts", "seedSampleCompany.js")), /performance\.goal\.read|permission\.startsWith\("report\."\)/);
  const roleKeys = seed.sampleCompanyRoleKeys();
  const grants = deriveLegacyRoleGrants(keys, roleKeys).filter((g) => B4.has(g.capabilityKey));
  assert.ok(grants.length > 0);
  for (const g of grants) assert.ok(allowed.has(pairId(g.roleKey, g.capabilityKey)), `the reconcile would grant ${pairId(g.roleKey, g.capabilityKey)}`);
  // The scope never includes the withheld `owner` Role, which the reconcile does not touch.
  assert.equal(roleKeys.includes("owner"), false);
});

test("c. Administrator holds all 39, Owner holds exactly its Firebase set (the same 39), and every pre-existing Owner exclusion is unchanged", () => {
  const held = (roleKey) => B4_KEYS.filter((k) => ROLES[roleKey].permissions.includes(k));
  assert.deepEqual(held("admin"), B4_KEYS, "Administrator holds all 39, as in Firebase");
  assert.deepEqual(held("owner"), B4_KEYS, "Owner holds exactly its Firebase set");
  // Owner's EOS grants equal its Firebase set: the baseline rows for owner among the B4 keys are those 39, no more.
  const ownerRows = BASELINE.grants.filter((g) => g.roleKey === "owner" && B4.has(g.capabilityKey)).map((g) => g.capabilityKey).sort();
  assert.deepEqual(ownerRows, B4_KEYS);
  const adminRows = BASELINE.grants.filter((g) => g.roleKey === "admin" && B4.has(g.capabilityKey)).map((g) => g.capabilityKey).sort();
  assert.deepEqual(adminRows, B4_KEYS);
  // The Owner exclusion contract (Owner ruling A) is untouched: none of the 20 admin-only keys is a B4 key, and B4 keys are held by BOTH, so admin-only does not move.
  assert.equal(OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.filter((k) => B4.has(k)).length, 0);
  assert.equal(OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES.length, 20, "the excluded admin-only list is still the 20 of the contract");
  // The other reporting Roles hold exactly what Firebase gives them: viewer reads only (no definition mutation, no finance field), author never deletes.
  const viewer = held("reportViewer");
  assert.equal(viewer.length, 26);
  assert.ok(viewer.every((k) => !/definition\.(create|rename|duplicate|delete)|paymentTerms|taxStatus|billingAddress|billingContact|commercialProfile|customer\.field\.notes|accountOwner|accessNotes/.test(k)));
  assert.deepEqual(held("reportFinanceViewer"), [
    "report.customer.field.billingAddress.read", "report.customer.field.billingContact.read", "report.customer.field.commercialProfile.read",
    "report.customer.field.paymentTerms.read", "report.customer.field.taxStatus.read"]);
  assert.deepEqual(held("reportAuthor"), ["report.definition.create", "report.definition.duplicate", "report.definition.rename"]);
  assert.equal(held("reportAuthor").includes("report.definition.delete"), false);
});
