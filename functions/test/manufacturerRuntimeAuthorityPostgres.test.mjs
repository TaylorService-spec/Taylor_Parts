// MANUFACTURER RUNTIME AUTHORITY -- the PostgreSQL WRITER, the governed READ seam including SEARCH, and the
// reference reconciliation.
//
// The companion suite manufacturerAuthorityPostgres.test.mjs proves the target schema, the capability split
// and the one-time copy tooling. This one proves the runtime: that a governed command can create, correct and
// deactivate a manufacturer in eos_ops.manufacturers under exactly the authority the Firestore command checks,
// that the read seam refuses an uncapable caller on every read it offers, and that the reconciliation names
// what it found rather than guessing at it.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const writer = require("../lib/catalogMaster/postgresManufacturerWriter.js");
const kernel = require("../lib/catalogMaster/catalogMasterKernel.js");
const writerState = require("../lib/catalogMaster/catalogWriterState.js");
const readSeam = require("../lib/eosOps/manufacturerAuthority.js");
const recon = require("../lib/eosOps/migration/manufacturerReferenceReconciliation.js");
const { normalizeName } = require("../lib/eosOps/migration/manufacturerMigration.js");

const T = "t-mfg-rt";
const T2 = "t-mfg-other";
const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const walk = (dir) => readdirSync(dir).flatMap((f) =>
  (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : /\.(ts|js|mjs)$/.test(f) ? [join(dir, f)] : []));

// ════════════════════ the authorization, proven against the Firestore command ════════════════════

test("the writer requires exactly the capabilities the Firestore Manufacturer commands check, and invents none", () => {
  const pm = require("../lib/partMaster/partMasterCommands.js");
  const { isValidPermissionId } = require("../lib/access/permissionCatalog.js");

  // The PROOF, not the assumption: the legacy commands' own constants.
  assert.equal(kernel.CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, pm.CAP_CATALOG_MANAGE);
  assert.equal(kernel.CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE, pm.CAP_CATALOG_ACTIVATE);
  assert.equal(kernel.CATALOG_CAPABILITIES.MANUFACTURER_MANAGE, "inventory.catalog.manage");
  assert.equal(kernel.CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE, "inventory.catalog.activate");
  for (const id of Object.values(kernel.CATALOG_CAPABILITIES)) assert.equal(isValidPermissionId(id), true, `${id} must be registered`);

  // And the source says which command uses which -- create/update on manage, status on activate. Collapsing the
  // two would widen the deactivate authority to everyone who may correct a spelling.
  assert.notEqual(pm.CAP_CATALOG_MANAGE, pm.CAP_CATALOG_ACTIVATE);
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/partMaster/partMasterCommands.ts"), "utf8");
  for (const [fn, cap] of [["createManufacturer", "CAP_CATALOG_MANAGE"], ["updateManufacturer", "CAP_CATALOG_MANAGE"],
    ["changeManufacturerStatus", "CAP_CATALOG_ACTIVATE"]]) {
    assert.match(src, new RegExp(`requireCapabilityOrAudit\\([^)]*${cap},\\s*"${fn}"`),
      `${fn} must be the one governed by ${cap} in the Firestore command`);
  }

  // No manufacturer-Object WRITE capability was invented anywhere in the migration set.
  const migrations = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(FUNCTIONS_DIR, "migrations", f), "utf8")).join("\n");
  for (const invented of ["inventory.manufacturer.manage", "inventory.manufacturer.write", "inventory.manufacturer.create",
    "inventory.manufacturer.activate", "inventory.manufacturer.delete"]) {
    assert.equal(migrations.includes(invented), false, `${invented} must not exist -- no new capability, no new migration`);
  }
});

test("this change adds no migration: the applied set is the one the base commit had", () => {
  const files = readdirSync(resolve(FUNCTIONS_DIR, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  const manufacturerMigrations = files.filter((f) => /manufacturer/i.test(f));
  assert.deepEqual(manufacturerMigrations, ["1761782400000_manufacturer-catalog-authority.sql"],
    "the Manufacturer authority has exactly one migration and this lane adds none");
  // No file claims a slot after the last one the base commit carried.
  const newest = files[files.length - 1];
  assert.ok(Number(newest.split("_")[0]) <= 1762560000000, `an unexpected newest migration ${newest}`);
});

// ════════════════════ no Firebase, no delete, not wired ════════════════════

test("the writer and the reconciliation reach for no Firebase, no Firestore, and no legacy authority", () => {
  // A REACH, not the word. The reconciliation legitimately NAMES a Firestore-only reference site it cannot see
  // (OUT_OF_SCOPE_REFERENCE_SITES); a probe that fires on that label would teach people to stop declaring what
  // they left out, which is the opposite of what it is for.
  const REACHES = [
    /from\s+["']firebase/, /require\(\s*["']firebase/, /import\(\s*["']firebase/, /@google-cloud\/firestore/,
    /\bgetFirestore\s*\(/, /\bFieldValue\b/, /\bFieldPath\b/, /\brunTransaction\s*\(/, /\.collection\s*\(/,
    /\brequest\.auth\b/, /permissionCatalog/, /operationalRoles/, /\bjobRole\b/, /caller\.role/,
  ];
  for (const f of ["src/catalogMaster/postgresManufacturerWriter.ts", "src/eosOps/migration/manufacturerReferenceReconciliation.ts"]) {
    const src = stripComments(readFileSync(resolve(FUNCTIONS_DIR, f), "utf8"));
    for (const reach of REACHES) assert.equal(reach.test(src), false, `${f} reaches for ${reach}`);
    assert.ok(src.length > 1500, `${f}: the probe is scanning an empty file and would pass for the wrong reason`);
  }
  // And every place the reconciliation says "firestore" at all is INSIDE the one out-of-scope declaration:
  // it is describing a site it cannot see, not reaching for one.
  const recSrc = stripComments(readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/manufacturerReferenceReconciliation.ts"), "utf8"));
  const declaration = recSrc.slice(recSrc.indexOf("export const OUT_OF_SCOPE_REFERENCE_SITES"));
  assert.ok(declaration.length > 0, "the out-of-scope declaration must exist for this probe to mean anything");
  const total = (recSrc.toLowerCase().match(/firestore/g) ?? []).length;
  const inside = (declaration.toLowerCase().match(/firestore/g) ?? []).length;
  assert.equal(total, inside, "every mention of the legacy store is inside the out-of-scope declaration");
  assert.match(declaration, /"firestore:equipment\.manufacturer"/);
  const wrSrc = stripComments(readFileSync(resolve(FUNCTIONS_DIR, "src/catalogMaster/postgresManufacturerWriter.ts"), "utf8"));
  assert.equal(/firestore|firebase/i.test(wrSrc), false, "the writer names no legacy store at all");
});

test("NO HARD DELETE: the writer has no delete command and emits no DELETE statement", () => {
  assert.deepEqual(Object.keys(writer).filter((k) => /delete|remove|purge|destroy/i.test(k)), []);
  const src = stripComments(readFileSync(resolve(FUNCTIONS_DIR, "src/catalogMaster/postgresManufacturerWriter.ts"), "utf8"));
  assert.equal(/\bDELETE\s+FROM\b/i.test(src), false, "a manufacturer is deactivated, never deleted");
  assert.equal(/\bTRUNCATE\b/i.test(src), false);
  // The only three commands the source has, matching the only three the Firestore side has.
  assert.deepEqual(Object.keys(writer).filter((k) => typeof writer[k] === "function").sort(),
    ["changeManufacturerStatus", "createManufacturer", "updateManufacturer"]);
});

test("the reconciliation reads and reports; it modifies no dependent data", () => {
  const src = stripComments(readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/migration/manufacturerReferenceReconciliation.ts"), "utf8"));
  for (const write of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+TABLE\b/i, /\bMERGE\b/i]) {
    assert.equal(write.test(src), false, `the reconciliation must not ${write}`);
  }
  // Every declared statement is a SELECT.
  for (const s of [recon.MANUFACTURER_IDENTITY_SELECT, recon.EQUIPMENT_MODEL_CODE_REFERENCE_SELECT,
    recon.EQUIPMENT_MODEL_NAME_REFERENCE_SELECT, recon.PART_CANONICAL_REFERENCE_SELECT]) {
    assert.match(s.trim(), /^SELECT\b/, "every reconciliation statement is a SELECT");
  }
});

test("the PostgreSQL Manufacturer writer stays unwired while the catalog writer state says INACTIVE", () => {
  assert.deepEqual({ ...writerState.CATALOG_WRITER_AUTHORITY }, { firestore: "OPEN", postgres: "INACTIVE" },
    "this lane does not move the catalog writer state");
  const importers = walk(resolve(FUNCTIONS_DIR, "src"))
    .filter((f) => !f.includes(`${"src"}/catalogMaster`) && !f.endsWith("catalogMaster"))
    .filter((f) => /postgresManufacturerWriter/.test(readFileSync(f, "utf8")));
  assert.deepEqual(importers, [], "activating the PostgreSQL Manufacturer writer is a separate authorized step");
  // And no client cutover: the legacy Firestore read service and callables are untouched by this change.
  const legacyRead = readFileSync(resolve(FUNCTIONS_DIR, "src/partMaster/manufacturerReadService.ts"), "utf8");
  assert.match(legacyRead, /INVENTORY_CATALOG_READ_CAPABILITY = "inventory\.catalog\.read"/);
  assert.equal(legacyRead.includes("eos_ops.manufacturers"), false, "the legacy read must not have been pointed at PostgreSQL");
});

// ════════════════════ the reference reconciliation, offline ════════════════════

const MFRS = [
  { id: "m-taylor", name: "Taylor Company", status: "ACTIVE" },
  { id: "m-icetro", name: "Icetro", status: "INACTIVE" },
];
const ref = (site, space, value, rows = ["r1"]) => ({ site, space, value, referencingRowIds: rows });

test("a canonical id resolves by id equality only -- and a dangling one is ORPHAN, never re-pointed by name", () => {
  const site = "eos_ops.parts.primary_manufacturer_id";
  const hit = recon.classifyReference(ref(site, "CANONICAL_ID", "m-taylor"), MFRS);
  assert.equal(hit.disposition, "EXACT_CANONICAL");
  assert.equal(hit.rule, "ID_EQUALITY");
  assert.equal(hit.resolvedManufacturerId, "m-taylor");

  // "Taylor Company" IS a manufacturer's name, but in the ID space that is not evidence of anything.
  const byName = recon.classifyReference(ref(site, "CANONICAL_ID", "Taylor Company"), MFRS);
  assert.equal(byName.disposition, "ORPHAN");
  assert.deepEqual(byName.candidateManufacturerIds, []);
  assert.equal(byName.resolvedManufacturerId, null);
  assert.equal(recon.classifyReference(ref(site, "CANONICAL_ID", "m-gone"), MFRS).disposition, "ORPHAN");
});

test("a CODE resolves only by the code space's own derivation, and an unmastered one is ORPHAN", () => {
  const site = "eos_ops.equipment_models.manufacturer_id";
  // normalizeManufacturerId("Taylor Company") === "TAYLOR-COMPANY". That is a derivation, so it is evidence.
  const derived = recon.classifyReference(ref(site, "CODE", "TAYLOR-COMPANY", ["TAYLOR-COMPANY--C713", "TAYLOR-COMPANY--C723"]), MFRS);
  assert.equal(derived.disposition, "DETERMINISTIC_MAPPING");
  assert.equal(derived.rule, "CODE_DERIVED_FROM_NAME");
  assert.equal(derived.resolvedManufacturerId, "m-taylor");
  assert.equal(derived.referencingRowCount, 2);

  // "TAYLOR" is NOT "TAYLOR-COMPANY". No manufacturer derives to it, so nothing is merged into Taylor Company.
  const near = recon.classifyReference(ref(site, "CODE", "TAYLOR"), MFRS);
  assert.equal(near.disposition, "ORPHAN");
  assert.deepEqual(near.candidateManufacturerIds, []);

  // A code that is literally a Manufacturer id is the strongest evidence there is, and wins.
  assert.equal(recon.classifyReference(ref(site, "CODE", "m-icetro"), MFRS).disposition, "EXACT_CANONICAL");
});

test("two manufacturers deriving to the same reference is AMBIGUOUS with both named -- the tooling never picks", () => {
  const rival = [...MFRS, { id: "m-taylor-2", name: "taylor  company", status: "ACTIVE" }];
  const code = recon.classifyReference(ref("eos_ops.equipment_models.manufacturer_id", "CODE", "TAYLOR-COMPANY"), rival);
  assert.equal(code.disposition, "AMBIGUOUS");
  assert.deepEqual(code.candidateManufacturerIds, ["m-taylor", "m-taylor-2"]);
  assert.equal(code.resolvedManufacturerId, null, "an ambiguous reference resolves to nothing at all");

  const name = recon.classifyReference(ref("eos_ops.equipment_models.manufacturer_name", "DISPLAY_NAME", "Taylor Company"), rival);
  assert.equal(name.disposition, "AMBIGUOUS");
  assert.deepEqual(name.candidateManufacturerIds, ["m-taylor", "m-taylor-2"]);
});

test("a display string resolves by normalized name, and an unmastered one is FREE_TEXT_ONLY, not ORPHAN", () => {
  const site = "eos_ops.equipment_models.manufacturer_name";
  // Case and internal whitespace only -- the derivation manufacturers.normalized_name already uses.
  const hit = recon.classifyReference(ref(site, "DISPLAY_NAME", "  taylor   COMPANY "), MFRS);
  assert.equal(hit.disposition, "DETERMINISTIC_MAPPING");
  assert.equal(hit.rule, "NORMALIZED_NAME_EQUALITY");
  assert.equal(hit.resolvedManufacturerId, "m-taylor");
  assert.equal(hit.derivedKey, normalizeName("taylor company"));

  const unmastered = recon.classifyReference(ref(site, "DISPLAY_NAME", "Stoelting"), MFRS);
  assert.equal(unmastered.disposition, "FREE_TEXT_ONLY", "a display string never pointed anywhere, so it cannot dangle");
  assert.equal(recon.classifyReference(ref(site, "DISPLAY_NAME", "   "), MFRS).disposition, "FREE_TEXT_ONLY");
});

test("an empty Manufacturer table leaves every identity reference unresolved, and the report says exactly that", () => {
  const report = recon.reconcileManufacturerReferences([
    ref("eos_ops.equipment_models.manufacturer_id", "CODE", "FIXTUREWORKS", ["FIXTUREWORKS--FW-50", "FIXTUREWORKS--FW-OLD"]),
    ref("eos_ops.equipment_models.manufacturer_id", "CODE", "SAMPLECO", ["SAMPLECO--SC-100", "SAMPLECO--SC-200"]),
    ref("eos_ops.equipment_models.manufacturer_name", "DISPLAY_NAME", "SYNTHETIC FixtureWorks Ltd (fixture)", ["FIXTUREWORKS--FW-50", "FIXTUREWORKS--FW-OLD"]),
    ref("eos_ops.equipment_models.manufacturer_name", "DISPLAY_NAME", "SYNTHETIC SampleCo Manufacturing (fixture)", ["SAMPLECO--SC-100", "SAMPLECO--SC-200"]),
  ], []);
  assert.equal(report.manufacturerCount, 0);
  assert.equal(report.referenceValueCount, 4);
  assert.equal(report.referencingRowCount, 8);
  assert.deepEqual({ ...report.byDisposition },
    { EXACT_CANONICAL: 0, DETERMINISTIC_MAPPING: 0, AMBIGUOUS: 0, ORPHAN: 2, FREE_TEXT_ONLY: 2 });
  assert.equal(report.identityGraphResolved, false);
  assert.deepEqual(report.requiresRuling.map((r) => r.value), ["FIXTUREWORKS", "SAMPLECO"],
    "the two codes need a ruling; the two display strings do not block the identity graph");
});

test("a fully-mastered graph resolves, and unmastered free text does not block it", () => {
  const report = recon.reconcileManufacturerReferences([
    ref("eos_ops.parts.primary_manufacturer_id", "CANONICAL_ID", "m-taylor"),
    ref("eos_ops.equipment_models.manufacturer_id", "CODE", "TAYLOR-COMPANY"),
    ref("eos_ops.equipment_models.manufacturer_name", "DISPLAY_NAME", "Someone Not Mastered"),
  ], MFRS);
  assert.equal(report.identityGraphResolved, true);
  assert.deepEqual({ ...report.byDisposition },
    { EXACT_CANONICAL: 1, DETERMINISTIC_MAPPING: 1, AMBIGUOUS: 0, ORPHAN: 0, FREE_TEXT_ONLY: 1 });
  // One AMBIGUOUS anywhere in an identity space is enough to stop it.
  const blocked = recon.reconcileManufacturerReferences(
    [ref("eos_ops.equipment_models.manufacturer_id", "CODE", "TAYLOR-COMPANY")],
    [...MFRS, { id: "m-t2", name: "Taylor Company", status: "ACTIVE" }]);
  assert.equal(blocked.identityGraphResolved, false);
});

test("the Firestore-only free-text site is declared out of scope, so a zero is never read as a clean bill", () => {
  assert.deepEqual(recon.OUT_OF_SCOPE_REFERENCE_SITES.map((s) => s.site), ["firestore:equipment.manufacturer"]);
  assert.deepEqual(recon.MANUFACTURER_REFERENCE_SITES.map((s) => s.site).sort(), [
    "eos_ops.equipment_models.manufacturer_id",
    "eos_ops.equipment_models.manufacturer_name",
    "eos_ops.parts.primary_manufacturer_id",
  ]);
});

// ════════════════════ against the real database ════════════════════

test("Manufacturer runtime authority, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const dbName = `mfgrt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${dbName}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up",
    "--migrations-dir", "migrations", "--no-check-order"],
  { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(dbName) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(dbName), max: 4 });
  const q = (sql, v = []) => pool.query(sql, v);

  for (const tenant of [T, T2]) await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [tenant]);
  const principal = async (id, tenant, status = "active") => {
    await q(`INSERT INTO eos_policy.principals (id, external_subject, identity_provider, status) VALUES ($1,$1,'proof',$2)`, [id, status]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id, tenant_id, principal_id) VALUES ($1,$2,$3)`, [`m-${id}`, tenant, id]);
  };
  await principal("p-manage", T);
  await principal("p-activate", T);
  await principal("p-both", T);
  await principal("p-stranger", T2);

  const MANAGE = kernel.CATALOG_CAPABILITIES.MANUFACTURER_MANAGE;
  const ACTIVATE = kernel.CATALOG_CAPABILITIES.MANUFACTURER_ACTIVATE;
  const actor = (id, caps, tenant = T) => ({ tenantId: tenant, principalId: id, capabilities: new Set(caps) });
  const manager = actor("p-manage", [MANAGE]);
  const activator = actor("p-activate", [ACTIVATE]);
  const both = actor("p-both", [MANAGE, ACTIVATE]);
  const deps = { pool };
  const reader = { tenantId: T, capabilities: new Set([readSeam.MANUFACTURER_READ]) };
  const auditOf = async (id) => (await q(
    `SELECT action, actor_uid, target_kind, target_id, before, after FROM eos_policy.audit_events
      WHERE tenant_id = $1 AND target_id = $2 ORDER BY occurred_at, id`, [T, id])).rows;

  await t.test("create writes a governed row: caller id, ACTIVE, NATIVE, derived normalized name, server actor", async () => {
    const out = await writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-taylor", name: "  Taylor   Company  " } });
    assert.equal(out.manufacturerId, "m-taylor");
    assert.equal(out.replayed, false);
    assert.match(out.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

    const { rows } = await q(`SELECT * FROM eos_ops.manufacturers WHERE tenant_id = $1 AND id = 'm-taylor'`, [T]);
    assert.equal(rows.length, 1);
    const r = rows[0];
    // TRIMMED, NOT COLLAPSED -- exactly what the Firestore command stores (`input.name.trim()`, nothing more).
    // The display name keeps the spacing somebody typed; only the NORMALIZED name collapses it. The two
    // derivations are deliberately different, and this row shows both at once.
    assert.equal(r.name, "Taylor   Company", "the name is trimmed exactly as the Firestore command trims it");
    assert.equal(r.normalized_name, "TAYLOR COMPANY", "normalized_name is derived, never supplied");
    assert.equal(r.status, "ACTIVE");
    assert.equal(r.provenance, "NATIVE", "a live command writes NATIVE; MIGRATED belongs to the copy");
    assert.equal(r.created_by, "p-manage", "the actor is the resolved EOS Principal, server-authored");
    assert.equal(r.updated_by, "p-manage");
    assert.ok(r.created_at instanceof Date && r.updated_at instanceof Date, "timestamps are server-authored");

    const audit = await auditOf("m-taylor");
    assert.equal(audit.length, 1);
    assert.deepEqual({ action: audit[0].action, actor: audit[0].actor_uid, kind: audit[0].target_kind },
      { action: "catalog.manufacturer.create", actor: "p-manage", kind: "manufacturer" });
    assert.equal(audit[0].before, null);
    assert.equal(audit[0].after.status, "ACTIVE");
  });

  await t.test("create is idempotent by the record, and refuses to overwrite a different one", async () => {
    const before = (await auditOf("m-taylor")).length;
    const replay = await writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-taylor", name: "Taylor   Company" } });
    assert.equal(replay.replayed, true);
    assert.equal((await auditOf("m-taylor")).length, before, "a replay files no second audit event");

    await assert.rejects(
      () => writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-taylor", name: "Taylor Co" } }),
      (e) => e.code === "MANUFACTURER_ALREADY_EXISTS" && e.category === "CONFLICT");
    // A name that only NORMALIZES the same is still a different record, and is still refused rather than merged.
    await assert.rejects(
      () => writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-taylor", name: "Taylor Company" } }),
      (e) => e.code === "MANUFACTURER_ALREADY_EXISTS");
    assert.equal((await q(`SELECT name FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].name,
      "Taylor   Company", "the refused create changed nothing");
  });

  await t.test("every command refuses a caller without its own capability, and the two are not interchangeable", async () => {
    // create/update need MANAGE; holding only ACTIVATE is not enough.
    await assert.rejects(() => writer.createManufacturer(deps, activator, { manufacturer: { manufacturerId: "m-x", name: "X" } }),
      (e) => e.code === "CAPABILITY_REQUIRED" && /inventory\.catalog\.manage/.test(e.message));
    const cur = await readSeam.getManufacturer(pool, reader, "m-taylor");
    const token = (await q(`SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') t FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].t;
    assert.ok(cur);
    await assert.rejects(() => writer.updateManufacturer(deps, activator, { manufacturerId: "m-taylor", expectedUpdatedAt: token, name: "Nope" }),
      (e) => e.code === "CAPABILITY_REQUIRED");
    // changeStatus needs ACTIVATE; holding only MANAGE is not enough.
    await assert.rejects(() => writer.changeManufacturerStatus(deps, manager, { manufacturerId: "m-taylor", expectedUpdatedAt: token, newStatus: "INACTIVE" }),
      (e) => e.code === "CAPABILITY_REQUIRED" && /inventory\.catalog\.activate/.test(e.message));
    // A caller with no resolved actor context at all gets nowhere.
    await assert.rejects(() => writer.createManufacturer(deps, { tenantId: T, principalId: "p-manage", capabilities: [MANAGE] },
      { manufacturer: { manufacturerId: "m-x", name: "X" } }), (e) => e.code === "ACTOR_CONTEXT_REQUIRED");
    assert.equal(await readSeam.getManufacturer(pool, reader, "m-x"), null, "no refused command left a row behind");
  });

  await t.test("a principal who is not an active member of the tenant writes nothing", async () => {
    await assert.rejects(
      () => writer.createManufacturer(deps, actor("p-stranger", [MANAGE], T), { manufacturer: { manufacturerId: "m-intruder", name: "Intruder" } }),
      (e) => e.code === "ACTOR_NOT_TENANT_MEMBER" && e.category === "FORBIDDEN");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.manufacturers WHERE id = 'm-intruder'`)).rows[0].n, 0);
  });

  await t.test("update corrects the name under the token, and a stale token is refused", async () => {
    const t0 = (await writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-icetro", name: "Icetro" } })).updatedAt;

    const applied = await writer.updateManufacturer(deps, manager, { manufacturerId: "m-icetro", expectedUpdatedAt: t0, name: "Icetro Inc" });
    assert.equal(applied.replayed, false);
    assert.ok(applied.updatedAt > t0, "the token strictly advances");
    const row = (await q(`SELECT name, normalized_name, updated_by FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-icetro'`, [T])).rows[0];
    assert.deepEqual(row, { name: "Icetro Inc", normalized_name: "ICETRO INC", updated_by: "p-manage" });

    // THE LOST-UPDATE GUARD the Firestore command's expectedVersion provides, preserved.
    await assert.rejects(() => writer.updateManufacturer(deps, manager, { manufacturerId: "m-icetro", expectedUpdatedAt: t0, name: "Something Else" }),
      (e) => e.code === "VERSION_CONFLICT" && e.category === "CONFLICT");
    assert.equal((await q(`SELECT name FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-icetro'`, [T])).rows[0].name, "Icetro Inc");

    // A retry of the change that already committed is a replay, not a second write and not a conflict.
    const replay = await writer.updateManufacturer(deps, manager, { manufacturerId: "m-icetro", expectedUpdatedAt: t0, name: "Icetro Inc" });
    assert.equal(replay.replayed, true);
    assert.equal(replay.updatedAt, applied.updatedAt);

    // Asking for what is already stored, with a CURRENT token, is a refusal -- there is nothing to record.
    await assert.rejects(() => writer.updateManufacturer(deps, manager, { manufacturerId: "m-icetro", expectedUpdatedAt: applied.updatedAt, name: "Icetro Inc" }),
      (e) => e.code === "NO_CHANGES" && e.category === "PRECONDITION_FAILED");

    const audit = await auditOf("m-icetro");
    assert.deepEqual(audit.map((a) => a.action), ["catalog.manufacturer.create", "catalog.manufacturer.update"]);
    assert.equal(audit[1].before.name, "Icetro");
    assert.equal(audit[1].after.name, "Icetro Inc");
  });

  await t.test("update refuses what the Firestore command refuses: bad id, empty name, over-long name, unknown field", async () => {
    const tok = (await readSeam.getManufacturer(pool, reader, "m-icetro")) && (await q(
      `SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') t FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-icetro'`, [T])).rows[0].t;
    for (const bad of [{ manufacturerId: "has/slash", expectedUpdatedAt: tok, name: "X" },
      { manufacturerId: "m-icetro", expectedUpdatedAt: tok, name: "   " },
      { manufacturerId: "m-icetro", expectedUpdatedAt: tok, name: "x".repeat(201) },
      { manufacturerId: "m-icetro", expectedUpdatedAt: "", name: "X" }]) {
      await assert.rejects(() => writer.updateManufacturer(deps, manager, bad), (e) => e.code === "INVALID_INPUT");
    }
    await assert.rejects(() => writer.createManufacturer(deps, manager,
      { manufacturer: { manufacturerId: "m-y", name: "Y", status: "INACTIVE" } }),
    (e) => e.code === "FIELD_NOT_WRITABLE", "status is not a create input; a new manufacturer is ACTIVE");
    await assert.rejects(() => writer.createManufacturer(deps, manager,
      { manufacturer: { manufacturerId: "m-y", name: "Y", provenance: "MIGRATED" } }),
    (e) => e.code === "FIELD_NOT_WRITABLE", "provenance is not a caller's to choose");
    await assert.rejects(() => writer.updateManufacturer(deps, manager, { manufacturerId: "m-nope", expectedUpdatedAt: tok, name: "X" }),
      (e) => e.code === "MANUFACTURER_NOT_FOUND" && e.category === "NOT_FOUND");
  });

  await t.test("changeStatus is ACTIVE <-> INACTIVE, refuses a no-op transition, and never deletes", async () => {
    const t0 = (await q(`SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') t FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].t;

    await assert.rejects(() => writer.changeManufacturerStatus(deps, activator, { manufacturerId: "m-taylor", expectedUpdatedAt: t0, newStatus: "RETIRED" }),
      (e) => e.code === "INVALID_INPUT", "the status vocabulary is exactly ACTIVE/INACTIVE");
    await assert.rejects(() => writer.changeManufacturerStatus(deps, activator, { manufacturerId: "m-taylor", expectedUpdatedAt: t0, newStatus: "ACTIVE" }),
      (e) => e.code === "INVALID_STATUS_TRANSITION" && e.category === "PRECONDITION_FAILED");

    const off = await writer.changeManufacturerStatus(deps, activator, { manufacturerId: "m-taylor", expectedUpdatedAt: t0, newStatus: "INACTIVE" });
    assert.equal(off.replayed, false);
    assert.equal((await q(`SELECT status, updated_by FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].status, "INACTIVE");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].n, 1,
      "deactivation keeps the row: equipment that names it must not lose the reference");

    // A retry of the same deactivation replays rather than refusing as a no-op transition.
    const replay = await writer.changeManufacturerStatus(deps, activator, { manufacturerId: "m-taylor", expectedUpdatedAt: t0, newStatus: "INACTIVE" });
    assert.equal(replay.replayed, true);
    assert.equal(replay.updatedAt, off.updatedAt);

    const on = await writer.changeManufacturerStatus(deps, both, { manufacturerId: "m-taylor", expectedUpdatedAt: off.updatedAt, newStatus: "ACTIVE" });
    assert.equal((await q(`SELECT status FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-taylor'`, [T])).rows[0].status, "ACTIVE");

    const status = (await auditOf("m-taylor")).filter((a) => a.action === "catalog.manufacturer.changeStatus");
    assert.equal(status.length, 2);
    assert.deepEqual(status.map((a) => [a.before.status, a.after.status]), [["ACTIVE", "INACTIVE"], ["INACTIVE", "ACTIVE"]]);
    assert.ok(on.updatedAt > off.updatedAt);
  });

  await t.test("a command that refuses inside its transaction commits nothing at all, audit included", async () => {
    const auditBefore = (await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1`, [T])).rows[0].n;
    await assert.rejects(() => writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-atomic", name: "" } }),
      (e) => e.code === "INVALID_INPUT");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.manufacturers WHERE id = 'm-atomic'`)).rows[0].n, 0);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.audit_events WHERE tenant_id = $1`, [T])).rows[0].n, auditBefore,
      "a refusal files no audit row");
  });

  await t.test("the tenant boundary is not something a caller can name its way across", async () => {
    await writer.createManufacturer(deps, actor("p-stranger", [MANAGE], T2), { manufacturer: { manufacturerId: "m-taylor", name: "Other Tenant Taylor" } });
    // Same id, two tenants, two rows -- the primary key is (tenant_id, id).
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.manufacturers WHERE id = 'm-taylor'`)).rows[0].n, 2);
    assert.equal((await readSeam.getManufacturer(pool, reader, "m-taylor")).name, "Taylor   Company");
    const otherReader = { tenantId: T2, capabilities: new Set([readSeam.MANUFACTURER_READ]) };
    assert.equal((await readSeam.getManufacturer(pool, otherReader, "m-taylor")).name, "Other Tenant Taylor");
    // And a T caller cannot reach T2's row with T2's token.
    await assert.rejects(() => writer.updateManufacturer(deps, manager, { manufacturerId: "m-elsewhere", expectedUpdatedAt: "x", name: "N" }),
      (e) => e.code === "MANUFACTURER_NOT_FOUND");
  });

  // ──────────────────── the read seam ────────────────────

  await t.test("every read requires inventory.manufacturer.read, and no other capability substitutes for it", async () => {
    for (const caps of [[], ["inventory.catalog.read"], [MANAGE], [ACTIVATE], ["inventory.catalog.read", MANAGE]]) {
      const r = { tenantId: T, capabilities: new Set(caps) };
      await assert.rejects(() => readSeam.listManufacturers(pool, r), /CAPABILITY_MISSING/);
      await assert.rejects(() => readSeam.getManufacturer(pool, r, "m-taylor"), /CAPABILITY_MISSING/);
      await assert.rejects(() => readSeam.searchManufacturers(pool, r, "taylor"), /CAPABILITY_MISSING/);
    }
  });

  await t.test("search matches the normalized name, includes INACTIVE, and is bounded", async () => {
    await writer.createManufacturer(deps, manager, { manufacturer: { manufacturerId: "m-soft", name: "Taylor Soft Serve" } });
    const t1 = (await q(`SELECT to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') t FROM eos_ops.manufacturers WHERE tenant_id=$1 AND id='m-soft'`, [T])).rows[0].t;
    await writer.changeManufacturerStatus(deps, activator, { manufacturerId: "m-soft", expectedUpdatedAt: t1, newStatus: "INACTIVE" });

    // Case- and whitespace-insensitive, and CONTAINS rather than prefix.
    assert.deepEqual((await readSeam.searchManufacturers(pool, reader, "  taYLor  ")).map((m) => m.id).sort(), ["m-soft", "m-taylor"]);
    const mid = await readSeam.searchManufacturers(pool, reader, "soft serve");
    assert.deepEqual(mid.map((m) => m.id), ["m-soft"]);
    assert.equal(mid[0].status, "INACTIVE", "a deactivated manufacturer is still findable; equipment still names it");
    assert.deepEqual(await readSeam.searchManufacturers(pool, reader, "nothing at all"), []);

    // LIKE metacharacters in the caller's text are DATA, not pattern.
    assert.deepEqual(await readSeam.searchManufacturers(pool, reader, "%"), [], "a wildcard must not return the table");
    assert.deepEqual(await readSeam.searchManufacturers(pool, reader, "_"), []);
    assert.deepEqual((await readSeam.searchManufacturers(pool, reader, "TAYLOR", { limit: 1 })).length, 1);

    for (const bad of [["", /SEARCH_TERM_REQUIRED/], ["   ", /SEARCH_TERM_REQUIRED/], ["x".repeat(201), /SEARCH_TERM_TOO_LONG/]]) {
      await assert.rejects(() => readSeam.searchManufacturers(pool, reader, bad[0]), bad[1]);
    }
    for (const limit of [0, -1, 201, 1.5]) {
      await assert.rejects(() => readSeam.searchManufacturers(pool, reader, "taylor", { limit }), /SEARCH_LIMIT_INVALID/);
    }
    // Another tenant's catalog is not searchable from here.
    assert.deepEqual(await readSeam.searchManufacturers(pool, reader, "Other Tenant"), []);
  });

  await t.test("what the writer wrote is exactly what the governed read returns", async () => {
    const all = await readSeam.listManufacturers(pool, reader);
    // ICETRO INC < TAYLOR COMPANY < TAYLOR SOFT SERVE.
    assert.deepEqual(all.map((m) => m.id), ["m-icetro", "m-taylor", "m-soft"], "ordered by normalized name");
    assert.deepEqual(all.map((m) => m.provenance), ["NATIVE", "NATIVE", "NATIVE"]);
    const one = await readSeam.getManufacturer(pool, reader, "m-icetro");
    assert.deepEqual({ ...one }, { id: "m-icetro", name: "Icetro Inc", status: "ACTIVE", provenance: "NATIVE" });
  });

  // ──────────────────── reconciliation, against real rows ────────────────────

  await t.test("the reconciliation reads the live reference sites and classifies every one of them", async () => {
    await q(`INSERT INTO eos_ops.equipment_models
             (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
             VALUES ('TAYLOR-COMPANY--C713',$1,'TAYLOR-COMPANY','Taylor Company','C713','Taylor C713','ACTIVE','fixture',1,'f','f'),
                    ('STOELTING--F231',$1,'STOELTING','Stoelting','F231','Stoelting F231','ACTIVE','fixture',1,'f','f')`, [T]);
    await q(`INSERT INTO eos_ops.parts
             (id, tenant_id, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
              expiry_tracked, consumable, returnable_core, primary_manufacturer_id, whole_unit, version, created_by, updated_by)
             VALUES ('p-1',$1,'IPN-1','Seal','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,'m-icetro',false,1,'f','f'),
                    ('p-2',$1,'IPN-2','Gasket','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,'m-gone',false,1,'f','f')`, [T]);

    const report = await recon.collectAndReconcileManufacturerReferences(pool, T);
    assert.equal(report.manufacturerCount, 3);
    const at = (site, value) => report.rows.find((r) => r.site === site && r.value === value);

    // The canonical id space: one real pointer, one broken one. The broken one is NOT re-pointed by name.
    assert.equal(at("eos_ops.parts.primary_manufacturer_id", "m-icetro").disposition, "EXACT_CANONICAL");
    assert.deepEqual(at("eos_ops.parts.primary_manufacturer_id", "m-gone").candidateManufacturerIds, []);
    assert.equal(at("eos_ops.parts.primary_manufacturer_id", "m-gone").disposition, "ORPHAN");

    // The code space: TAYLOR-COMPANY derives from the mastered "Taylor Company"; STOELTING derives from nothing.
    const code = at("eos_ops.equipment_models.manufacturer_id", "TAYLOR-COMPANY");
    assert.equal(code.disposition, "DETERMINISTIC_MAPPING");
    assert.equal(code.resolvedManufacturerId, "m-taylor");
    assert.deepEqual(code.referencingRowIds, ["TAYLOR-COMPANY--C713"]);
    assert.equal(at("eos_ops.equipment_models.manufacturer_id", "STOELTING").disposition, "ORPHAN");

    // The display-name space: the same two facts, but an unmastered name is FREE_TEXT_ONLY, not a broken pointer.
    assert.equal(at("eos_ops.equipment_models.manufacturer_name", "Taylor Company").disposition, "DETERMINISTIC_MAPPING");
    assert.equal(at("eos_ops.equipment_models.manufacturer_name", "Stoelting").disposition, "FREE_TEXT_ONLY");

    assert.deepEqual({ ...report.byDisposition },
      { EXACT_CANONICAL: 1, DETERMINISTIC_MAPPING: 2, AMBIGUOUS: 0, ORPHAN: 2, FREE_TEXT_ONLY: 1 });
    assert.equal(report.identityGraphResolved, false, "two unresolved identity references block it");
    assert.deepEqual(report.requiresRuling.map((r) => `${r.site}=${r.value}`).sort(),
      ["eos_ops.equipment_models.manufacturer_id=STOELTING", "eos_ops.parts.primary_manufacturer_id=m-gone"]);

    // AND IT CHANGED NOTHING. That is the whole contract.
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.manufacturers WHERE tenant_id = $1`, [T])).rows[0].n, 3);
    assert.deepEqual((await q(`SELECT id, primary_manufacturer_id FROM eos_ops.parts WHERE tenant_id=$1 ORDER BY id`, [T])).rows,
      [{ id: "p-1", primary_manufacturer_id: "m-icetro" }, { id: "p-2", primary_manufacturer_id: "m-gone" }]);
    assert.deepEqual((await q(`SELECT id, manufacturer_id FROM eos_ops.equipment_models WHERE tenant_id=$1 ORDER BY id`, [T])).rows,
      [{ id: "STOELTING--F231", manufacturer_id: "STOELTING" }, { id: "TAYLOR-COMPANY--C713", manufacturer_id: "TAYLOR-COMPANY" }]);
  });

  await t.test("the platform still registers no DELETE capability, and none was added for Manufacturer", async () => {
    assert.deepEqual((await q(`SELECT key FROM eos_policy.capabilities WHERE action_kind = 'DELETE'`)).rows, []);
    assert.deepEqual((await q(
      `SELECT key FROM eos_policy.capabilities WHERE object_key = 'manufacturer' ORDER BY key`)).rows,
    [{ key: "inventory.manufacturer.read" }], "Manufacturer's only Object-scoped capability is still the read");
  });
});
