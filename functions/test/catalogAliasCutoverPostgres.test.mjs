// THE ALIAS HALF OF THE CATALOG CUTOVER: census -> COPY -> VERIFY, against a real postgres:16.
//
// One snapshot carries Equipment Models, Parts AND the aliases that name them, because an alias and
// its Part are one consistent picture or they are not evidence. This suite is mostly about what the
// copy REFUSES: a dangling alias, an alias of an excluded certification Part, an identity that
// disagrees with its own value.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { copyCatalog, verifyCatalog } = require("../lib/catalogMaster/catalogCutover.js");
const { parseCatalogSnapshot, censusCatalogSnapshot } = require("../lib/catalogMaster/catalogSnapshot.js");
const { deriveAliasDocId } = require("../lib/partMaster/partAliasIdentity.js");
const aliasWriter = require("../lib/catalogMaster/postgresPartAliasWriter.js");

const DB_NAME = `cat_alias_cut_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const dbUrl = () => { const u = new URL(URL_BASE); u.pathname = `/${DB_NAME}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const ts = (seconds, nanoseconds = 0) => ({ $timestamp: { seconds, nanoseconds } });

const partDoc = (id, over = {}) => ({
  id,
  data: {
    partId: id, internalPartNumber: id, name: `Part ${id}`, category: "COMPRESSOR", status: "ACTIVE",
    stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED",
    flags: { expiryTracked: false, consumable: false, returnableCore: false },
    version: 1, createdAt: ts(1757100000), createdBy: "legacy-uid-a", updatedAt: ts(1757200000), updatedBy: "legacy-uid-b",
    ...over,
  },
});

const aliasDoc = (partId, aliasType, rawValue, over = {}) => {
  const derived = deriveAliasDocId(aliasType, rawValue, over.manufacturerId);
  return {
    id: derived.docId,
    data: {
      aliasId: derived.docId, partId, aliasType, originalValue: rawValue,
      normalizedValue: derived.normalizedValue, status: "ACTIVE", source: "import",
      version: 1, createdAt: ts(1757100000), createdBy: "legacy-uid-a", updatedAt: ts(1757100000), updatedBy: "legacy-uid-a",
      ...over,
    },
  };
};

const snapshotOf = ({ parts = [], equipmentModels = [], partAliases = [] }) => ({
  format: "EOS_CATALOG_SNAPSHOT", version: 1,
  source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-09-20T00:00:00.000Z" },
  parts, equipmentModels, partAliases,
});
const censusOf = (snap) => censusCatalogSnapshot(parseCatalogSnapshot(snap));

test("the Catalog cutover carries Part ALIASES, or refuses", { skip: SKIP, concurrency: 1 }, async (t) => {
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${DB_NAME}`));
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrl() }, stdio: "pipe",
  });
  const pool = new pg.Pool({ connectionString: dbUrl(), max: 8 });
  t.after(async () => {
    await pool.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`));
  });
  const q = (text, values = []) => pool.query(text, values);
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ('pc','pc','proof','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ('mc','t1','pc')`);
  const withPool = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };

  const SNAP = () => snapshotOf({
    parts: [partDoc("CAT-1"), partDoc("CAT-2")],
    partAliases: [
      aliasDoc("CAT-1", "SUPPLIER_SKU", "sku-one"),
      aliasDoc("CAT-1", "INTERNAL_PN", "OLD-CAT-1"),
      aliasDoc("CAT-2", "UPC", "012345678905"),
    ],
  });

  await t.test("the census counts, selects and digests aliases", () => {
    const { census, catalog, legacyActorProvenance } = censusOf(SNAP());
    assert.equal(census.copyReady, true, JSON.stringify(census.blockers));
    assert.deepEqual(census.counts, { parts: 2, equipmentModels: 0, partAliases: 3 });
    assert.deepEqual(census.selected, { parts: 2, equipmentModels: 0, partAliases: 3 });
    assert.equal(catalog.partAliases.length, 3);
    // The legacy uid is EVIDENCE, and is never a column value.
    assert.ok(legacyActorProvenance.some((p) => p.kind === "part_alias" && p.legacyCreatedBy === "legacy-uid-a"));
    // The digest covers the alias half: change one alias and the digest moves.
    const other = SNAP();
    other.partAliases[0].data.originalValue = "sku-one-changed";
    other.partAliases[0].id = deriveAliasDocId("SUPPLIER_SKU", "sku-one-changed").docId;
    other.partAliases[0].data.aliasId = other.partAliases[0].id;
    other.partAliases[0].data.normalizedValue = deriveAliasDocId("SUPPLIER_SKU", "sku-one-changed").normalizedValue;
    assert.notEqual(censusOf(other).census.canonicalDigest, census.canonicalDigest);
  });

  await t.test("COPY writes aliases after their Parts, with NULL actors under MIGRATED provenance", async () => {
    const { census, catalog } = censusOf(SNAP());
    const report = await withPool((c) => copyCatalog(c, {
      tenantId: "t1", principalId: "pc", catalog, canonicalDigest: census.canonicalDigest,
      certificationExcluded: census.certificationExcluded.records,
    }));
    assert.equal(report.outcome, "COPIED");
    assert.deepEqual(report.partAliases, { inserted: 3, unchanged: 0 });

    const rows = (await q(`SELECT * FROM eos_ops.part_aliases WHERE tenant_id='t1' ORDER BY id`)).rows;
    assert.equal(rows.length, 3);
    for (const r of rows) {
      assert.equal(r.provenance, "MIGRATED");
      assert.equal(r.created_by, null, "a legacy uid is not a Principal and never reaches a business column");
      assert.equal(r.updated_by, null);
    }
    const audit = (await q(`SELECT after FROM eos_policy.audit_events WHERE action='catalog.cutover.copy'`)).rows[0].after;
    assert.deepEqual(audit.partAliases, { inserted: 3, unchanged: 0 });
    assert.equal(JSON.stringify(audit).includes("legacy-uid"), false, "no uid in the audit payload either");
  });

  await t.test("a rerun of the SAME snapshot writes nothing", async () => {
    const { census, catalog } = censusOf(SNAP());
    const report = await withPool((c) => copyCatalog(c, {
      tenantId: "t1", principalId: "pc", catalog, canonicalDigest: census.canonicalDigest,
    }));
    assert.equal(report.outcome, "NO_CHANGES");
    assert.deepEqual(report.partAliases, { inserted: 0, unchanged: 3 });
  });

  await t.test("VERIFY reconciles the alias half: counts, identities, every field", async () => {
    const { census, catalog } = censusOf(SNAP());
    const report = await withPool((c) => verifyCatalog(c, {
      tenantId: "t1", catalog, sample: "all", certificationExcluded: census.certificationExcluded.records,
    }));
    assert.equal(report.reconciled, true, JSON.stringify(report.fieldMismatches));
    assert.deepEqual(report.counts.partAliases, { source: 3, target: 3 });
    assert.equal(report.sampled.partAliases, 3);
    assert.deepEqual(report.danglingAliasPartReferences, []);
    assert.deepEqual(report.aliasIdentityDisagreements, []);
  });

  await t.test("alias DRIFT refuses the whole copy", async () => {
    const drifted = SNAP();
    drifted.partAliases[0].data.source = "edited-by-hand";
    const { census, catalog } = censusOf(drifted);
    await assert.rejects(
      withPool((c) => copyCatalog(c, { tenantId: "t1", principalId: "pc", catalog, canonicalDigest: census.canonicalDigest })),
      (e) => { assert.equal(e.code, "DRIFT_DETECTED"); assert.ok(e.details.some((d) => d.kind === "part_alias")); return true; });
  });

  await t.test("an alias in the target that the snapshot does not contain refuses the copy", async () => {
    const fewer = SNAP();
    fewer.partAliases.pop();
    const { census, catalog } = censusOf(fewer);
    await assert.rejects(
      withPool((c) => copyCatalog(c, { tenantId: "t1", principalId: "pc", catalog, canonicalDigest: census.canonicalDigest })),
      (e) => { assert.equal(e.code, "TARGET_HAS_UNKNOWN_RECORDS"); return true; });
  });

  // ════════════════════════════ WHAT THE CENSUS REFUSES ════════════════════════════

  await t.test("a DANGLING alias is a BLOCKER, never a dropped row", async () => {
    const dangling = snapshotOf({
      parts: [partDoc("CAT-1")],
      partAliases: [aliasDoc("CAT-GONE", "LEGACY", "ORPHAN-1")],
    });
    const { census } = censusOf(dangling);
    assert.equal(census.copyReady, false);
    assert.ok(census.blockers.includes("MISSING_REFERENCES"));
    assert.ok(census.missingReferences.some((f) => f.kind === "part_alias" && /PART_NOT_IN_SNAPSHOT:CAT-GONE/.test(f.reason)));
  });

  await t.test("an alias of an EXCLUDED certification Part is excluded under the SAME evidence", () => {
    const withFixture = snapshotOf({
      parts: [
        partDoc("CAT-1"),
        partDoc("CERT-1", { certificationWorld: "G-03", dataProvenance: "SYNTHETIC_CERTIFICATION_FACT" }),
      ],
      partAliases: [aliasDoc("CAT-1", "SUPPLIER_SKU", "sku-one"), aliasDoc("CERT-1", "SUPPLIER_SKU", "cert-sku")],
    });
    const { census, catalog } = censusOf(withFixture);
    // The alias carries NO certification marker of its own: it is excluded because its PART is.
    assert.equal(census.certificationExcluded.counts.partAliases, 1);
    assert.ok(census.certificationExcluded.records.some(
      (r) => r.kind === "part_alias" && /alias-of-excluded-part:CERT-1/.test(r.reason)));
    assert.equal(catalog.partAliases.length, 1, "only the surviving Part's alias is selected");
    assert.equal(census.copyReady, true, "an excluded fixture neither copies nor blocks");
  });

  await t.test("an alias whose id disagrees with its own value is INVALID, never copied", () => {
    const wrong = snapshotOf({
      parts: [partDoc("CAT-1")],
      partAliases: [aliasDoc("CAT-1", "SUPPLIER_SKU", "sku-one", { normalizedValue: "SOMETHING-ELSE" })],
    });
    const { census } = censusOf(wrong);
    assert.equal(census.copyReady, false);
    assert.ok(census.invalid.some((f) => f.kind === "part_alias" && f.reason === "NORMALIZATION_DISAGREES"));
  });

  await t.test("an INACTIVE alias must say when it was deactivated", () => {
    const incoherent = snapshotOf({
      parts: [partDoc("CAT-1")],
      partAliases: [aliasDoc("CAT-1", "LEGACY", "OFF-1", { status: "INACTIVE" })],
    });
    const { census } = censusOf(incoherent);
    assert.ok(census.invalid.some((f) => f.reason === "ALIAS_DEACTIVATION_INCOHERENT"));
  });

  await t.test("a MANUFACTURER_PN without its scope, and any other type with one, are INVALID", () => {
    const noScope = snapshotOf({
      parts: [partDoc("CAT-1")],
      partAliases: [{
        id: "MANUFACTURER_PN__acme|MPN-1",
        data: {
          aliasId: "MANUFACTURER_PN__acme|MPN-1", partId: "CAT-1", aliasType: "MANUFACTURER_PN",
          originalValue: "MPN-1", normalizedValue: "acme|MPN-1", status: "ACTIVE", source: "import",
          version: 1, createdAt: ts(1757100000), createdBy: "u", updatedAt: ts(1757100000), updatedBy: "u",
        },
      }],
    });
    assert.ok(censusOf(noScope).census.invalid.some((f) => f.reason === "ALIAS_MANUFACTURER_SCOPE_INVALID"));
  });

  await t.test("a migrated alias still resolves the scanner, and still has no actor invented for it", async () => {
    await withPool(async (c) => {
      const found = await aliasWriter.resolveScannedPartIdentifier(c, "t1", { rawValue: "sku-one" });
      assert.equal(found.result, "FOUND");
      assert.equal(found.partId, "CAT-1");
      const historical = await aliasWriter.probePartAlias(c, "t1", { aliasType: "INTERNAL_PN", rawValue: "OLD-CAT-1" });
      assert.equal(historical.result, "FOUND", "a migrated historical part number still resolves");
    });
  });
});
