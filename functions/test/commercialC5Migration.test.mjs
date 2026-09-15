// COMMERCIAL C5 -- the offline proofs. No database, no Firebase runtime, no network.
//
//   * FIREBASE_EXIT_MIGRATION_ONLY: the snapshot exporter's marker, exact three-collection allowlist, read-only verbs,
//     exclusive checksummed output, fences, and the STRUCTURAL proof that no runtime code can reach it (or the C5
//     modules);
//   * nothing under src/commercialMigration, and not the C5 CLI, loads Firebase;
//   * parity with the governed sources it restates (the V1 eligibility policy, the fixture marker, the Owner ruling's
//     recorded census, the number format);
//   * the source census: counts and ids, ALWAYS-excluded Certification fixtures, D2 execution fields excluded and
//     counted, legacy uids as provenance only, number validity / duplicates / sentinel years, lineage, field
//     classification, and the DISPOSITION decision (production STOP, empty, all-fixture, Owner ruling, review);
//   * finalize over target facts: owner / accountable / Account / catalog blockers, the accountability plan
//     (governed, derived, historical preserved), counter seeding max(existing, migrated), unknown target rows.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cleanSnapshot, clone, commercialDocs, EMP, snapshotOf, SANDBOX_ENV, SANDBOX_PROJECT } from "./support/commercialC5SnapshotFixture.mjs";

const require = createRequire(import.meta.url);
const C5 = require("../lib/commercialMigration/commercialC5Snapshot.js");
const T = require("../lib/commercialMigration/commercialC5Target.js");

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const sources = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? sources(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));
const census = (snap) => C5.censusCommercialSnapshot(C5.parseCommercialSnapshot(snap));
const codes = (findings, id) => findings.filter((f) => id === undefined || f.id === id).map((f) => f.code);

// ════════════════════ FIREBASE_EXIT_MIGRATION_ONLY: the exporter ════════════════════

const EXPORTER = "scripts/exportCommercialSnapshot.js";

test("the exporter is marked as the migration-only exception and allowlists exactly the three Commercial collections", () => {
  const ex = require("../scripts/exportCommercialSnapshot.js");
  assert.equal(ex.FIREBASE_EXIT_MIGRATION_ONLY, "FIREBASE_EXIT_MIGRATION_ONLY");
  assert.match(readFileSync(EXPORTER, "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY$/);
  assert.deepEqual(Object.values(ex.SOURCE_COLLECTIONS), ["opportunities", "sales_agreements", "sales_orders"]);
  for (const ok of ["opportunities", "sales_agreements", "sales_orders"]) assert.equal(ex.assertAllowlisted(ok), ok);
  for (const other of ["counters", "auditEvents", "accounts", "invoices", "fieldops_wos", "salesOrders", ""]) assert.throws(() => ex.assertAllowlisted(other), /not an allowlisted/);
  const code = stripComments(readFileSync(EXPORTER, "utf8"));
  assert.deepEqual([...code.matchAll(/\bdb\.collection\((.*?)\)\.get\(/g)].map((m) => m[1]), ["assertAllowlisted(name)"], "every collection read goes through the allowlist");
  assert.deepEqual([...code.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.doesNotMatch(code, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete)\s*\(/, "no Firestore write verb");
  assert.doesNotMatch(code, /onSchedule|onCall|onRequest|pubsub|setInterval/, "no schedule, trigger or handler");
  assert.match(code, /flag: "wx"/);
});

test("the exporter's fence refuses production, Certification, undeclared environments, a --projectId and an existing output -- before firebase-admin", () => {
  const ex = require("../scripts/exportCommercialSnapshot.js");
  const dir = mkdtempSync(join(tmpdir(), "c5-export-"));
  const out = join(dir, "snap.json");
  assert.throws(() => ex.assertExportInvocation({ out }), /--environment is required/);
  assert.throws(() => ex.assertExportInvocation({ environment: "taylor-parts-production", out }), /production/);
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-sandbox", confirmProduction: "taylor-parts", out }), /no production mode/);
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-certification", out }), /frozen/);
  assert.throws(() => ex.assertExportInvocation({ environment: "someone-else", out }), /not an environment declared/);
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-integration", out }), /declares no Firebase project/);
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-sandbox", projectId: "eos-platform-sandbox", out }), /--projectId is not accepted/);
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-sandbox" }), /--out <file> is required/);
  assert.deepEqual(ex.assertExportInvocation({ environment: "platform-sandbox", out }), { environmentId: "platform-sandbox", projectId: "eos-platform-sandbox", out });
});

test("the exporter writes the snapshot and its sha256 exclusively, never overwrites, and the CLI refuses a tampered or unchecksummed snapshot", () => {
  const ex = require("../scripts/exportCommercialSnapshot.js");
  const { verifySnapshotChecksum } = require("../scripts/commercialC5.js");
  const dir = mkdtempSync(join(tmpdir(), "c5-export-"));
  const out = join(dir, "snap.json");
  const sha = ex.writeSnapshotFiles(out, "{\"a\":1}\n");
  assert.match(sha, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(`${out}.sha256`, "utf8"), `${sha}  snap.json\n`);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.throws(() => ex.writeSnapshotFiles(out, "{\"a\":2}\n"), /EEXIST/);
  assert.equal(readFileSync(out, "utf8"), "{\"a\":1}\n");
  assert.throws(() => ex.assertExportInvocation({ environment: "platform-sandbox", out }), /never overwritten/);
  assert.equal(verifySnapshotChecksum(out).sha256, sha);
  writeFileSync(join(dir, "tampered.json"), "{}\n");
  writeFileSync(join(dir, "tampered.json.sha256"), `${sha}  tampered.json\n`);
  assert.throws(() => verifySnapshotChecksum(join(dir, "tampered.json")), /changed after export/);
  assert.throws(() => verifySnapshotChecksum(join(dir, "nope.json")), /missing/);
});

test("the exporter tags Timestamps, tags other Firestore types as unsupported, and refuses an ambiguous stored tag", () => {
  const { encodeValue } = require("../scripts/exportCommercialSnapshot.js");
  class FakeTimestamp { constructor(s, n) { this.seconds = s; this.nanoseconds = n; } }
  assert.deepEqual(encodeValue({ b: [1, "x", null], a: new FakeTimestamp(5, 7) }, FakeTimestamp, "d"), { a: { $timestamp: { seconds: 5, nanoseconds: 7 } }, b: [1, "x", null] });
  assert.deepEqual(encodeValue({ ref: new (class DocumentReference {})() }, FakeTimestamp, "d"), { ref: { $unsupported: "DocumentReference" } });
  assert.throws(() => encodeValue({ $timestamp: 1 }, FakeTimestamp, "d"), /ambiguous/);
  const snap = cleanSnapshot();
  snap.opportunities[1].data.need = { $unsupported: "GeoPoint" };
  assert.ok(codes(census(snap).census.findings, "opp-2").includes("UNSUPPORTED_VALUE"));
});

test("STRUCTURAL: no runtime code can reach the exporter, the C5 CLI or src/commercialMigration -- not src, not the client, not integrations, not package entry points, not a workflow step or schedule", () => {
  const root = resolve("..");
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    if (["node_modules", ".git", "lib", "dist"].includes(f)) return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(f) ? [p] : [];
  });
  const runtime = ["functions/src", "field-ops-app-vite/src", "integrations"].flatMap((d) => walk(join(root, d)));
  const offenders = runtime
    .filter((f) => !f.includes(join("functions", "src", "commercialMigration")))
    .filter((f) => /exportCommercialSnapshot|commercialC5\b|commercialMigration\/|FIREBASE_EXIT_MIGRATION_ONLY/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, [], "a runtime module references the C5 tooling");
  for (const f of sources("src/commercialMigration")) assert.doesNotMatch(readFileSync(f, "utf8"), /FIREBASE_EXIT_MIGRATION_ONLY/, `${f} names the exporter marker`);
  const scriptImporters = walk(join(root, "functions", "scripts")).filter((f) => /lib\/commercialMigration\//.test(readFileSync(f, "utf8")));
  assert.deepEqual(scriptImporters.map((f) => f.slice(root.length + 1)), ["functions/scripts/commercialC5.js"], "only the C5 operator CLI loads the C5 modules");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.doesNotMatch(JSON.stringify({ main: pkg.main, exports: pkg.exports ?? null, bin: pkg.bin ?? null, scripts: pkg.scripts }), /exportCommercialSnapshot|commercialC5\.js/);
  for (const wf of readdirSync(join(root, ".github", "workflows"))) {
    const text = readFileSync(join(root, ".github", "workflows", wf), "utf8");
    const lines = text.split("\n").filter((l) => /exportCommercialSnapshot|scripts\/commercialC5/.test(l));
    for (const line of lines) assert.match(line.trim(), /^- "functions\/scripts\/(exportCommercialSnapshot|commercialC5)\.js"$/, `${wf} may name the C5 tooling only as a path filter: ${line}`);
    if (lines.length > 0) assert.doesNotMatch(text, /^\s*schedule:/m, `${wf} names the C5 tooling and has a schedule`);
  }
});

// ════════════════════ no Firebase on the PostgreSQL side ════════════════════

const FORBIDDEN = [/from\s+["']firebase/, /require\(\s*["']firebase/, /import\(\s*["']firebase/, /\bgetFirestore\s*\(/, /\bFieldValue\b/, /@google-cloud\/firestore/];

test("no commercialMigration module or the C5 CLI imports Firebase, and loading them never resolves a Firebase package (runtime probe)", () => {
  for (const file of [...sources("src/commercialMigration"), "scripts/commercialC5.js"]) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const p of FORBIDDEN) assert.doesNotMatch(text, p, `${file}: ${p}`);
  }
  const cli = stripComments(readFileSync("scripts/commercialC5.js", "utf8"));
  const topLevel = cli.split("async function main")[0].match(/require\(\s*["'][^"']+["']\s*\)/g);
  assert.deepEqual(topLevel, ['require("node:fs")', 'require("node:path")', 'require("node:crypto")', 'require("./measureEmployeeReferenceIntegrity.js")', 'require("./measureWorkforceActivation.js")']);
  assert.doesNotMatch(cli, /exportCommercialSnapshot/, "the C5 CLI consumes a snapshot file; it never loads the exporter");
  assert.doesNotMatch(cli, /\.(set|add|delete|commit|batch|runTransaction|bulkWriter)\s*\(/);
  const dir = mkdtempSync(join(tmpdir(), "c5-probe-"));
  const preload = join(dir, "banFirebase.cjs");
  writeFileSync(preload, 'const M=require("module");const l=M._load;M._load=function(r,...a){if(/firebase|@google-cloud\\/firestore/i.test(r)){process.stderr.write("FIREBASE_LOADED:"+r);process.exit(97);}return l.call(this,r,...a);};');
  const modules = readdirSync("lib/commercialMigration").filter((f) => f.endsWith(".js")).map((f) => resolve("lib/commercialMigration", f));
  assert.equal(modules.length, 2);
  const probe = spawnSync(process.execPath, ["--require", preload, "-e", [...modules, resolve("scripts/commercialC5.js")].map((m) => `require(${JSON.stringify(m)});`).join("")], { encoding: "utf8" });
  assert.equal(probe.status, 0, `a C5 module transitively loaded Firebase: ${probe.stderr}`);
});

test("C5 does not import the C2 command layer or the catalog authority it may not reach before cutover", () => {
  for (const file of sources("src/commercialMigration")) {
    const code = stripComments(readFileSync(file, "utf8"));
    assert.doesNotMatch(code, /eosCommercial\/commands\/|CommandService|commercialCommandKernel/, `${file} reaches the C2 command layer`);
    assert.doesNotMatch(code, /catalogAuthority|postgresCatalogReferenceAuthority/, `${file} imports the catalog authority`);
    assert.doesNotMatch(code, /command_receipts\s*\(/, `${file} writes a command receipt`);
  }
  assert.doesNotMatch(stripComments(readFileSync("src/commercialMigration/commercialC5Target.ts", "utf8")), /INSERT INTO \$\{S\}\.command_receipts|INSERT INTO eos_commercial\.command_receipts/);
});

// ════════════════════ parity with what C5 restates ════════════════════

test("parity: the restated V1 eligibility policy, fixture marker, D3 recorded census and number format match their governed sources", () => {
  const kernel = require("../lib/eosCommercial/commands/commercialCommandKernel.js");
  assert.deepEqual(JSON.parse(JSON.stringify(C5.C5_ACCOUNTABILITY_ELIGIBILITY_V1)), JSON.parse(JSON.stringify(kernel.COMMERCIAL_ACCOUNTABILITY_ELIGIBILITY_V1)));
  assert.match(readFileSync("scripts/financialReviewFixtures.mjs", "utf8"), new RegExp(`MARKER_FIELD = "${C5.FINANCIAL_REVIEW_FIXTURE_MARKER}"`));
  const d3 = C5.OWNER_DISPOSITION_RULINGS.find((r) => r.id === "D3");
  const doc = readFileSync("../docs/assessments/eos-ownership-model-reconciliation.md", "utf8");
  assert.match(doc, new RegExp(`\`opportunities\` ${d3.recordedCensus.opportunities}/${d3.recordedCensus.opportunities}, \`sales_agreements\` ${d3.recordedCensus.salesAgreements}/${d3.recordedCensus.salesAgreements}, \`sales_orders\` ${d3.recordedCensus.salesOrders}/${d3.recordedCensus.salesOrders}`));
  const { formatCommercialNumber } = require("../lib/eosCommercial/commercialNumbering.js");
  const { UNKNOWN_YEAR_SENTINEL } = { UNKNOWN_YEAR_SENTINEL: 0 };
  for (const [family, series] of [["opportunity", "OPPORTUNITY"], ["salesAgreement", "SALES_AGREEMENT"], ["salesOrder", "SALES_ORDER"]]) {
    for (const [year, seq] of [[2026, 1], [2026, 999999], [1999, 1234567]]) {
      assert.deepEqual(C5.readBusinessNumber(family, formatCommercialNumber(series, year, seq)), { state: "VALID", series, year, sequence: seq });
    }
  }
  assert.match(readFileSync("src/salesOrder/salesOrderNumberBackfill.ts", "utf8"), new RegExp(`UNKNOWN_YEAR_SENTINEL = ${UNKNOWN_YEAR_SENTINEL};`));
  assert.equal(C5.readBusinessNumber("salesOrder", "SO-0000-000004").state, "SENTINEL_YEAR");
  for (const bad of ["SO-FR-ABC123", "SO-2026-12345", "SO-2026-0000001", "OPP-2026-000001", "SO-1969-000001", 42]) {
    assert.equal(C5.readBusinessNumber("salesOrder", bad).state, "INVALID_FORMAT", String(bad));
  }
  assert.equal(C5.readBusinessNumber("salesOrder", undefined).state, "MISSING");
});

test("every field a Firestore Commercial writer stores is classified (a new stored field fails here, not silently in a copy)", () => {
  const written = {
    opportunity: readFileSync("src/opportunity/opportunityCommands.ts", "utf8"),
    salesAgreement: readFileSync("src/salesAgreement/salesAgreementCommands.ts", "utf8"),
    salesOrder: readFileSync("src/salesOrder/salesOrderCommands.ts", "utf8"),
  };
  const builtFields = (src, iface) => {
    const body = src.slice(src.indexOf(`export interface ${iface}`), src.indexOf("\n}", src.indexOf(`export interface ${iface}`)));
    return [...body.matchAll(/^\s{2}([A-Za-z]+)\??:/gm)].map((m) => m[1]);
  };
  const stripped = { opportunity: ["createdAtMillis"], salesAgreement: [], salesOrder: [] };
  for (const [family, iface] of [["opportunity", "BuiltOpportunity"], ["salesAgreement", "BuiltSalesAgreement"], ["salesOrder", "BuiltSalesOrder"]]) {
    for (const f of builtFields(written[family], iface)) {
      if (stripped[family].includes(f)) continue;
      assert.ok(C5.FIELD_DISPOSITIONS[family][f] !== undefined || (family === "opportunity" && f === "createdByUid"), `${family}.${f} is written but not classified`);
    }
  }
  for (const [family, fields] of Object.entries({ opportunity: ["opportunityNumber", "salesAgreementId", "salesOrderId", "closedAt", "updatedByUid"], salesAgreement: ["salesAgreementNumber", "salesOrderId", "acceptedAtMillis", "acceptedByUid", "updatedByUid"], salesOrder: ["salesOrderNumber", "sourceAgreementId", "sourceOpportunityNumber", "serviceWorkOrderIds", "fulfillmentReadiness", "fulfillmentReadinessCounts", "allocatedAt", "updatedByUid"] })) {
    for (const f of fields) assert.ok(C5.FIELD_DISPOSITIONS[family][f], `${family}.${f} (written by a callable) is not classified`);
  }
  assert.equal(C5.FIELD_DISPOSITIONS.salesOrder.serviceWorkOrderIds, "D2");
  for (const q of ["allocatedQty", "fulfilledQty", "billedQty"]) assert.equal(C5.LINE_FIELD_DISPOSITIONS.salesOrder[q], "D2");
});

// ════════════════════ the source census ════════════════════

test("clean snapshot: counts and exact ids per family, Certification fixtures excluded with ids and reason, canonical rows exact", () => {
  const { census: c, canonical, legacyActorProvenance } = census(cleanSnapshot());
  assert.deepEqual(c.counts, { opportunities: 4, salesAgreements: 1, salesOrders: 2 });
  assert.deepEqual(c.ids, { opportunities: ["cw-opp-1", "opp-1", "opp-2", "opp-3"], salesAgreements: ["sa-1"], salesOrders: ["cw-so-1", "so-1"] });
  assert.deepEqual(c.certificationExcluded, {
    counts: { opportunities: 1, salesAgreements: 0, salesOrders: 1 },
    records: [
      { family: "opportunity", id: "cw-opp-1", code: "CERTIFICATION_FIXTURE_EXCLUDED:certificationWorld-marker" },
      { family: "salesOrder", id: "cw-so-1", code: "CERTIFICATION_FIXTURE_EXCLUDED:dataProvenance" },
    ],
  });
  assert.deepEqual(c.selected, { opportunities: ["opp-1", "opp-2", "opp-3"], salesAgreements: ["sa-1"], salesOrders: ["so-1"] });
  assert.deepEqual(c.findings, []);
  assert.deepEqual(c.blockers, []);
  assert.deepEqual(canonical.opportunities[0], {
    id: "opp-1", number: "OPP-2026-000007", accountId: "acct-1", ownerEmployeeId: EMP.owner, operatingCompanyKey: "taylor", creditedSalespersonEmployeeId: EMP.credited,
    salesChannel: "RETAIL", stage: "DECISION", outcome: "WON", closedAt: "2026-02-10T00:00:00.250000Z", need: "two coolers", expectedValue: 12500.5,
    expectedCloseAt: "2026-02-15T00:00:00.000000Z", nextAction: null, createdAt: "2026-01-11T00:00:00.123456Z", updatedAt: "2026-02-10T00:00:00.250000Z",
    lines: [{ lineNumber: 1, kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", qty: 1 }, { lineNumber: 2, kind: "SERVICE", ref: "SVC-INSTALL", qty: 1 }],
  });
  // legacy variants: closedAtMillis / createdAtMillis carried; absent updatedAt -> created_at (never fabricated)
  assert.equal(canonical.opportunities[2].closedAt, "2025-12-22T00:00:00.000000Z");
  assert.equal(canonical.opportunities[2].updatedAt, canonical.opportunities[2].createdAt);
  assert.equal(canonical.salesAgreements[0].acceptedAt, "2026-02-09T00:00:00.000000Z");
  assert.deepEqual(canonical.accountability.map((a) => [a.id, a.context, a.state, a.accountableEmployeeId, a.recordedSource]), [
    ["opp-1", "HISTORICAL", "PRESENT", EMP.accountable, "EXPLICIT"],
    ["opp-2", "ACTIONABLE", "ABSENT", null, null],
    ["opp-3", "HISTORICAL", "PRESENT", EMP.terminated, "DERIVED_FROM_RECORD_OWNER"],
    ["sa-1", "HISTORICAL", "PRESENT", EMP.accountable, "EXPLICIT"],
    ["so-1", "ACTIONABLE", "PRESENT", EMP.accountable, "DERIVED_FROM_RECORD_OWNER"],
  ]);
  // a Firebase uid is provenance evidence only: it appears in no canonical record
  assert.ok(legacyActorProvenance.some((p) => p.acceptedByUid === "uid-accepter"));
  for (const uid of ["uid-creator", "uid-updater", "uid-accepter"]) assert.doesNotMatch(JSON.stringify(canonical), new RegExp(uid));
  assert.equal(census(cleanSnapshot()).census.canonicalDigest, c.canonicalDigest, "deterministic");
});

test("D2 execution state (allocation / fulfillment / billing quantities, service Work Orders) is excluded from the canonical rows and counted", () => {
  const { census: c, canonical, legacyActorProvenance: prov } = census(cleanSnapshot());
  assert.deepEqual(c.d2Excluded.fieldPresence, {
    "salesOrder.fulfillmentReadiness": 1, "salesOrder.lines[].allocatedQty": 1, "salesOrder.lines[].billedQty": 1, "salesOrder.lines[].fulfilledQty": 1, "salesOrder.serviceWorkOrderIds": 1,
  });
  assert.deepEqual(codes(c.d2Excluded.recordsWithExecutionQuantities), ["D2_EXECUTION_NOT_MIGRATED:allocatedQty", "D2_EXECUTION_NOT_MIGRATED:fulfilledQty"]);
  const text = JSON.stringify(canonical.salesOrders);
  for (const f of ["allocatedQty", "fulfilledQty", "billedQty", "serviceWorkOrderIds", "fulfillmentReadiness"]) assert.doesNotMatch(text, new RegExp(f));
});

test("CERTIFICATION: an identified fixture is never selected, and a record depending on one blocks instead of dangling", () => {
  const d = commercialDocs();
  const cwOpp = { id: "cw-opp-9", data: { ...d.opp1.data, opportunityNumber: "OPP-2026-000050", certificationWorld: { v: 1 } } };
  const sa = clone(d.sa1);
  sa.data.sourceOpportunityId = "cw-opp-9";
  delete sa.data.salesOrderId;
  const { census: c, canonical } = census(snapshotOf({ opportunities: [cwOpp, d.opp2], salesAgreements: [sa] }));
  assert.ok(!canonical.opportunities.some((o) => o.id === "cw-opp-9"));
  assert.deepEqual(c.certificationExcluded.records.map((r) => r.id), ["cw-opp-9"]);
  assert.ok(codes(c.findings, "sa-1").includes("LINEAGE_OPPORTUNITY_NOT_SELECTED"));
  assert.ok(c.blockers.includes("LINEAGE_OPPORTUNITY_NOT_SELECTED"));
  assert.ok(!canonical.salesAgreements.some((a) => a.id === "sa-1"));
});

test("NUMBERS: duplicates per series block every holder, a non-governed format blocks, a missing number blocks, the sentinel year is preserved without a counter", () => {
  const d = commercialDocs();
  const dup = clone(d.opp2); dup.id = "opp-dup"; dup.data.opportunityNumber = "OPP-2026-000009";
  const fr = clone(d.so1); fr.id = "so-fr"; fr.data.salesOrderNumber = "SO-FR-ABC123"; fr.data.sourceOpportunityId = null; fr.data.sourceAgreementId = null; fr.data.sourceOpportunityNumber = null;
  const missing = clone(d.opp3); missing.id = "opp-nonum"; delete missing.data.opportunityNumber;
  const sentinel = clone(fr); sentinel.id = "so-sentinel"; sentinel.data.salesOrderNumber = "SO-0000-000001";
  const { census: c } = census(snapshotOf({ opportunities: [d.opp2, dup, missing], salesOrders: [fr, sentinel] }));
  assert.deepEqual(c.numbers.duplicates, [{ series: "OPPORTUNITY", number: "OPP-2026-000009", ids: ["opp-2", "opp-dup"] }]);
  assert.deepEqual(codes(c.findings, "opp-2"), ["DUPLICATE_BUSINESS_NUMBER"]);
  assert.ok(codes(c.findings, "so-fr").includes("NUMBER_FORMAT_INVALID"));
  assert.ok(codes(c.findings, "opp-nonum").includes("NUMBER_MISSING"));
  assert.deepEqual(c.numbers.sentinelYear, [{ family: "salesOrder", id: "so-sentinel", number: "SO-0000-000001" }]);
  assert.ok(!c.numbers.bySeriesYear.some((s) => s.series === "SALES_ORDER"), "a sentinel-year number seeds no counter");
  assert.ok(codes(c.advisories, "so-sentinel").includes("SENTINEL_YEAR_NUMBER_PRESERVED_NO_COUNTER"));
});

test("FIELDS AND LEGACY SHAPES: unclassified and Owner-decision fields, unrecorded accountable source, non-positional line ids, ambiguous SERVICE lines, missing company, broken acceptance", () => {
  const d = commercialDocs();
  const o = clone(d.opp2); o.data.mystery = 1;
  const a = clone(d.opp3); delete a.data.accountablePersonSource;
  const sa = clone(d.sa1); sa.data.lines[1].lineId = "line-7"; delete sa.data.acceptedAtMillis;
  const so = clone(d.so1); delete so.data.lines[1].businessUnitId; so.data.operatingCompanyId = null;
  const { census: c } = census(snapshotOf({ opportunities: [d.opp1, o, a], salesAgreements: [sa], salesOrders: [so] }));
  assert.deepEqual(codes(c.findings, "opp-2"), ["UNCLASSIFIED_SOURCE_FIELD"]);
  assert.deepEqual(codes(c.findings, "opp-3"), ["ACCOUNTABLE_PERSON_SOURCE_UNRECORDED"]);
  assert.deepEqual(codes(c.findings, "sa-1").sort(), ["ACCEPTED_AT_MISSING", "LINE_ID_NOT_POSITIONAL"]);
  // (B) an ACCEPTED Agreement without its legacy accepter uid blocks with its own code
  const noAccepter = clone(d.sa1); delete noAccepter.data.acceptedByUid;
  assert.ok(codes(census(snapshotOf({ opportunities: [d.opp1], salesAgreements: [noAccepter] })).census.findings, "sa-1").includes("ACCEPTING_PRINCIPAL_UID_MISSING"));
  assert.ok(codes(c.findings, "so-1").includes("BUSINESS_UNIT_UNRESOLVABLE"));
  assert.ok(codes(c.findings, "so-1").includes("COMPANY_REQUIRED"));
  assert.ok(!c.selected.salesOrders.includes("so-1") && !c.selected.salesAgreements.includes("sa-1"), "a record with a finding is never selected");
  const noOwner = clone(d.opp2); delete noOwner.data.ownerEmployeeId;
  assert.ok(codes(census(snapshotOf({ opportunities: [noOwner] })).census.findings).includes("OWNER_MISSING"));
  const noCreated = clone(d.opp2); delete noCreated.data.createdAt;
  assert.ok(codes(census(snapshotOf({ opportunities: [noCreated] })).census.findings).includes("CREATED_AT_MISSING"));
});

// ════════════════════ the disposition decision ════════════════════

test("DISPOSITION: production is STOP_FOR_OWNER_DECISION with records AND when empty -- never declared empty or disposable", () => {
  const prod = cleanSnapshot("", { environmentId: "taylor-parts-production", projectId: "taylor-parts" });
  assert.equal(C5.decideDisposition(C5.parseCommercialSnapshot(prod)).disposition, "STOP_FOR_OWNER_DECISION");
  const empty = snapshotOf({ environmentId: "taylor-parts-production", projectId: "taylor-parts" });
  const decision = C5.decideDisposition(C5.parseCommercialSnapshot(empty));
  assert.equal(decision.disposition, "STOP_FOR_OWNER_DECISION");
  assert.equal(decision.basis, "PRODUCTION_SOURCE");
});

test("DISPOSITION: empty nonprod, all-fixture, Owner ruling D3 within its census, D3 overruled by value signals or growth, and unmarked records elsewhere", () => {
  const decide = (snap) => C5.decideDisposition(C5.parseCommercialSnapshot(snap));
  assert.equal(decide(snapshotOf()).disposition, "NO_SOURCE_RECORDS");
  const d = commercialDocs();
  const marked = [d.opp1, d.opp2].map((x) => ({ id: x.id, data: { ...x.data, financialReviewP1: { version: "1.0.0" } } }));
  const allFixture = decide(snapshotOf({ opportunities: [...marked, d.oppCw] }));
  assert.deepEqual([allFixture.disposition, allFixture.basis], ["DISPOSABLE_FIXTURE_ONLY", "ALL_RECORDS_FIXTURE_PROVENANCE"]);
  assert.match(allFixture.path, /DISCARD \+ RESEED/);
  assert.match(allFixture.path, /Never delete the source/);
  // unmarked sandbox records, no value signal, within D3's recorded census -> disposable by Owner ruling
  const quiet = decide(snapshotOf({ opportunities: [d.opp1, d.opp2, d.opp3], salesAgreements: [d.sa1] }));
  assert.deepEqual([quiet.disposition, quiet.basis, quiet.ownerRulingApplied], ["DISPOSABLE_FIXTURE_ONLY", "OWNER_RULING_D3", "D3"]);
  assert.equal(quiet.recordsWithoutFixtureProvenance.length, 4);
  // a fulfilled quantity on an unmarked order is a value signal: STOP for review
  const valuable = decide(cleanSnapshot());
  assert.deepEqual([valuable.disposition, valuable.basis], ["MIGRATION_REQUIRED_OR_OWNER_REVIEW", "OWNER_RULING_D3_NOT_APPLICABLE:VALUE_SIGNALS"]);
  assert.deepEqual(valuable.valueSignals.map((v) => v.code), ["VALUE_SIGNAL:fulfilledQty>0"]);
  // a marked fixture's value signal does not count (it IS a fixture)
  const markedOrder = { id: d.so1.id, data: { ...d.so1.data, financialReviewP1: { version: "1.0.0" } } };
  assert.equal(decide(snapshotOf({ salesOrders: [markedOrder] })).disposition, "DISPOSABLE_FIXTURE_ONLY");
  // more records than D3's recorded census: records post-date the ruling
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `opp-${i}`, data: { ...d.opp2.data, opportunityNumber: `OPP-2026-${String(i + 1).padStart(6, "0")}` } }));
  assert.equal(decide(snapshotOf({ opportunities: many })).basis, "OWNER_RULING_D3_NOT_APPLICABLE:COUNTS_EXCEED_RECORDED_CENSUS:opportunities");
  // no ruling covers another environment
  const elsewhere = decide(snapshotOf({ opportunities: [d.opp2], environmentId: "platform-integration", projectId: "some-other" }));
  assert.deepEqual([elsewhere.disposition, elsewhere.basis], ["MIGRATION_REQUIRED_OR_OWNER_REVIEW", "RECORDS_WITHOUT_FIXTURE_PROVENANCE"]);
  for (const bad of [{ ...snapshotOf(), accounts: [] }, { ...snapshotOf(), format: "EOS_CRM_SNAPSHOT" }]) assert.throws(() => C5.parseCommercialSnapshot(bad), /SNAPSHOT_FORMAT_INVALID|allowlisted|not an/);
});

// ════════════════════ finalize over target facts ════════════════════

const employee = (id, status) => ({ outcome: "RESOLVED", employee: { employeeId: id, tenantId: "t1", employmentStatus: status, operatingCompanyId: "taylor" } });
function facts(over = {}) {
  return {
    schema: { commercialParity: true, accountabilitySource: true, crmAccounts: true, partMaster: true },
    employees: new Map([[EMP.owner, employee(EMP.owner, "ACTIVE")], [EMP.accountable, employee(EMP.accountable, "CONTRACTOR")], [EMP.terminated, employee(EMP.terminated, "TERMINATED")], [EMP.credited, employee(EMP.credited, "ON_LEAVE")]]),
    accountIds: new Set(["acct-1", "acct-2"]), locationIds: new Set(["loc-1"]),
    catalog: { status: "PROBED", verdicts: [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", verdict: "FOUND" }, { kind: "PART", ref: "P-100", verdict: "FOUND" }] },
    existing: { opportunity: [], salesAgreement: [], salesOrder: [] }, idsHeldByOtherTenants: [], counters: [],
    acceptors: new Map([["uid-accepter", { outcome: "RESOLVED", principalId: "p-accepter", principalStatus: "disabled", membershipStatus: "active" }]]),
    ...over,
  };
}

test("finalize: the clean snapshot is copy-ready; the accountability plan is governed, derived-at-migration and historical-preserved exactly where the rules say", () => {
  const { census: c, canonical, legacyActorProvenance: prov } = census(cleanSnapshot());
  const f = T.finalizeC5Census(c, canonical, facts(), prov);
  assert.deepEqual(f.blockers, []);
  assert.equal(f.copyReady, true);
  assert.deepEqual(f.accountabilityPlan.map((p) => [p.id, p.path, p.accountableEmployeeId, p.source, p.derivedAtMigration]), [
    ["opp-1", "GOVERNED_ESTABLISHMENT", EMP.accountable, "EXPLICIT", false],
    ["opp-2", "GOVERNED_ESTABLISHMENT", EMP.owner, "DERIVED_FROM_RECORD_OWNER", true],
    ["opp-3", "HISTORICAL_PRESERVED", EMP.terminated, "DERIVED_FROM_RECORD_OWNER", false],
    ["sa-1", "GOVERNED_ESTABLISHMENT", EMP.accountable, "EXPLICIT", false],
    ["so-1", "GOVERNED_ESTABLISHMENT", EMP.accountable, "DERIVED_FROM_RECORD_OWNER", false],
  ]);
  assert.deepEqual(f.derivedAccountablePersons, [{ family: "opportunity", id: "opp-2", accountableEmployeeId: EMP.owner }]);
  // (E) the excluded Certification order SO-2026-000099 is source-visible: it raises the SALES_ORDER high-water above the migrated 11
  assert.deepEqual(f.counterSeedPlan.map((x) => [x.series, x.year, x.migratedMax, x.sourceVisibleMax, x.existing, x.seedTo, x.action]), [
    ["OPPORTUNITY", 2025, 3, 3, null, 3, "INSERT"], ["OPPORTUNITY", 2026, 9, 9, null, 9, "INSERT"], ["SALES_AGREEMENT", 2026, 4, 4, null, 4, "INSERT"], ["SALES_ORDER", 2026, 11, 99, null, 99, "INSERT"],
  ]);
  // (A)(C)(D) accepted_by is the historical accepter's EOS Principal -- not the operator, not the uid; status is evidence, not required active
  assert.deepEqual(f.acceptancePlan, [{ id: "sa-1", legacyAcceptedByUidEvidence: "uid-accepter", acceptedByPrincipalId: "p-accepter", principalStatus: "disabled", membershipStatus: "active" }]);
  assert.match(T.establishmentReason(f.accountabilityPlan[2], "a".repeat(64)), /^C5_MIGRATION_HISTORICAL_ACCOUNTABILITY_PRESERVED snapshot:aaaaaaaaaaaaaaaa status:TERMINATED/);
  assert.ok(T.establishmentReason(f.accountabilityPlan[2], "a".repeat(64)).length <= 500);
  assert.deepEqual(f.gatingConditions.map((g) => [g.id, g.status]), [
    ["CRM_CUTOVER_RECONCILED", "OPERATOR_EVIDENCE_REQUIRED"], ["CATALOG_CUTOVER_RECONCILED", "OPERATOR_EVIDENCE_REQUIRED"], ["EMPLOYEE_AUTHORITY", "MET"],
    ["FIRESTORE_COMMERCIAL_WRITERS_FROZEN_BEFORE_EXPORT", "OPERATOR_EVIDENCE_REQUIRED"], ["PRODUCTION_CENSUS_AND_OWNER_DECISION", "NOT_MET"],
  ]);
});

test("finalize: owner, credited salesperson, accountable person, authority outage, Account and catalog blockers -- never a fallback, never always-FOUND", () => {
  const { census: c, canonical, legacyActorProvenance: prov } = census(cleanSnapshot());
  const people = new Map(facts().employees);
  people.delete(EMP.credited); // NOT_FOUND is modelled as absent from the answer map? no: explicit
  people.set(EMP.credited, { outcome: "NOT_FOUND" });
  people.set(EMP.accountable, employee(EMP.accountable, "INACTIVE"));
  const f = T.finalizeC5Census(c, canonical, facts({ employees: people, accountIds: new Set(["acct-2"]), catalog: { status: "PART_MASTER_SCHEMA_ABSENT", verdicts: [] } }), prov);
  assert.equal(f.copyReady, false);
  for (const code of ["CREDITED_SALESPERSON_UNRESOLVED", "ACCOUNTABLE_PERSON_NOT_CURRENTLY_ELIGIBLE", "ACCOUNT_UNRESOLVED", "CATALOG_REFERENCES_UNVERIFIABLE"]) assert.ok(f.blockers.includes(code), code);
  // the ineligible person on HISTORICAL records (opp-1, sa-1) is preserved; on ACTIONABLE work (so-1) it blocks
  assert.deepEqual(f.accountabilityPlan.filter((p) => p.accountableEmployeeId === EMP.accountable).map((p) => [p.id, p.path]), [["opp-1", "HISTORICAL_PRESERVED"], ["sa-1", "HISTORICAL_PRESERVED"]]);
  assert.ok(codes(f.findings, "so-1").includes("ACCOUNTABLE_PERSON_NOT_CURRENTLY_ELIGIBLE"));
  assert.ok(!f.findings.some((x) => x.code === "CATALOG_REFERENCE_NOT_FOUND"), "an absent catalog schema is UNVERIFIABLE, not a verdict");
  assert.equal(f.gatingConditions.find((g) => g.id === "CRM_CUTOVER_RECONCILED").status, "NOT_MET");
  assert.equal(f.gatingConditions.find((g) => g.id === "CATALOG_CUTOVER_RECONCILED").status, "NOT_MET");

  const noOwner = new Map(facts().employees); noOwner.set(EMP.owner, { outcome: "NOT_FOUND" });
  const g = T.finalizeC5Census(c, canonical, facts({ employees: noOwner }), prov);
  assert.ok(g.blockers.includes("OWNER_UNRESOLVED"));
  assert.deepEqual(codes(g.findings, "opp-2").sort(), ["ACCOUNTABLE_PERSON_UNDERIVABLE", "OWNER_UNRESOLVED"], "no accountable person is derived from an owner who does not resolve");
  const termOwner = new Map(facts().employees); termOwner.set(EMP.owner, employee(EMP.owner, "TERMINATED"));
  assert.ok(codes(T.finalizeC5Census(c, canonical, facts({ employees: termOwner }), prov).findings, "opp-2").includes("ACCOUNTABLE_PERSON_UNDERIVABLE"));
  const unknownPerson = new Map(facts().employees); unknownPerson.set(EMP.terminated, { outcome: "NOT_FOUND" });
  assert.ok(codes(T.finalizeC5Census(c, canonical, facts({ employees: unknownPerson }), prov).findings, "opp-3").includes("ACCOUNTABLE_PERSON_UNRESOLVED"));
  const outage = new Map(facts().employees); outage.set(EMP.accountable, { outcome: "AUTHORITY_UNAVAILABLE" });
  const h = T.finalizeC5Census(c, canonical, facts({ employees: outage }), prov);
  assert.ok(h.blockers.includes("EMPLOYEE_AUTHORITY_UNAVAILABLE"));
  assert.ok(!h.blockers.includes("ACCOUNTABLE_PERSON_UNRESOLVED"), "an outage is never a verdict about the person");
  const wrong = T.finalizeC5Census(c, canonical, facts({ catalog: { status: "PROBED", verdicts: [{ kind: "EQUIPMENT_MODEL", ref: "ACME--CW-100", verdict: "WRONG_KIND" }, { kind: "PART", ref: "P-100", verdict: "NOT_FOUND" }] } }), prov);
  assert.ok(wrong.blockers.includes("CATALOG_REFERENCE_WRONG_KIND") && wrong.blockers.includes("CATALOG_REFERENCE_NOT_FOUND"));
});

test("finalize: counters are seeded to max(existing, source-visible high-water) and never lowered; unknown and declared synthetic target rows, ids held by another tenant and numbers held by another record all block (J)", () => {
  const { census: c, canonical, legacyActorProvenance: prov } = census(cleanSnapshot());
  const f = T.finalizeC5Census(c, canonical, facts({ counters: [{ series: "OPPORTUNITY", year: 2026, lastValue: 4 }, { series: "SALES_ORDER", year: 2026, lastValue: 40 }] }), prov);
  assert.deepEqual(f.counterSeedPlan.find((x) => x.series === "OPPORTUNITY" && x.year === 2026), { series: "OPPORTUNITY", year: 2026, migratedMax: 9, sourceVisibleMax: 9, existing: 4, seedTo: 9, action: "RAISE" });
  assert.deepEqual(f.counterSeedPlan.find((x) => x.series === "SALES_ORDER"), { series: "SALES_ORDER", year: 2026, migratedMax: 11, sourceVisibleMax: 99, existing: 40, seedTo: 99, action: "RAISE" });
  for (const x of f.counterSeedPlan) assert.ok(x.seedTo >= x.sourceVisibleMax && x.seedTo >= (x.migratedMax ?? 0) && x.seedTo >= (x.existing ?? 0));
  const high = T.finalizeC5Census(c, canonical, facts({ counters: [{ series: "SALES_ORDER", year: 2026, lastValue: 500 }] }), prov);
  assert.deepEqual(high.counterSeedPlan.find((x) => x.series === "SALES_ORDER"), { series: "SALES_ORDER", year: 2026, migratedMax: 11, sourceVisibleMax: 99, existing: 500, seedTo: 500, action: "NONE" });

  const existing = { opportunity: [{ id: "opp-other", number: "OPP-2026-000009" }, { id: "syn-1", number: "SYN-NP-OPP-0001" }], salesAgreement: [], salesOrder: [] };
  const g = T.finalizeC5Census(c, canonical, facts({ existing, idsHeldByOtherTenants: [{ family: "salesOrder", id: "so-1" }] }), prov);
  assert.ok(g.blockers.includes("TARGET_HAS_UNKNOWN_RECORDS") && g.blockers.includes("ID_HELD_BY_ANOTHER_TENANT") && g.blockers.includes("NUMBER_HELD_BY_ANOTHER_RECORD"));
  assert.deepEqual(g.target.unknownRecords.map((r) => r.id), ["opp-other", "syn-1"]);
  // (J) a declared synthetic seed row is reported as such and BLOCKS a real copy -- there is no retention option
  const h = T.finalizeC5Census(c, canonical, facts({ existing: { opportunity: [{ id: "syn-1", number: "SYN-NP-OPP-0001" }], salesAgreement: [], salesOrder: [] } }), prov, { declaredSyntheticNumbers: ["SYN-NP-OPP-0001"] });
  assert.deepEqual(h.blockers, ["TARGET_HAS_SYNTHETIC_SEED_ROWS", "TARGET_HAS_UNKNOWN_RECORDS"]);
  assert.equal(h.copyReady, false);
  assert.deepEqual(h.target.syntheticSeedRows.map((r) => r.id), ["syn-1"]);
  assert.equal(T.finalizeC5Census(c, canonical, facts({ existing: { opportunity: [{ id: "syn-1", number: "SYN-NP-OPP-0001" }], salesAgreement: [], salesOrder: [] } }), prov, { retainedSyntheticNumbers: ["SYN-NP-OPP-0001"] }).copyReady, false, "the removed option has no effect");
  // a disposable source is never copy-ready, whatever the target says
  const d = commercialDocs();
  const [o1, a1] = [clone(d.opp1), clone(d.sa1)];
  delete o1.data.salesOrderId; delete a1.data.salesOrderId;
  const quiet = census(snapshotOf({ opportunities: [o1, d.opp2, d.opp3], salesAgreements: [a1] }));
  const q = T.finalizeC5Census(quiet.census, quiet.canonical, facts(), quiet.legacyActorProvenance);
  assert.deepEqual([q.copyReady, q.blockers], [false, ["DISPOSITION_DISPOSABLE_FIXTURE_ONLY"]]);
});

test("ACCEPTED_BY (B): unresolved, ambiguous and outside-tenant accepters block with their own codes; the operator is never a fallback", () => {
  const { census: c, canonical, legacyActorProvenance: prov } = census(cleanSnapshot());
  for (const [answer, code] of [
    [{ outcome: "UNRESOLVED" }, "ACCEPTING_PRINCIPAL_UNRESOLVED"],
    [{ outcome: "AMBIGUOUS", candidates: 2 }, "ACCEPTING_PRINCIPAL_AMBIGUOUS"],
    [{ outcome: "OUTSIDE_TENANT", principalId: "p-other", principalStatus: "active" }, "ACCEPTING_PRINCIPAL_OUTSIDE_TENANT"],
  ]) {
    const f = T.finalizeC5Census(c, canonical, facts({ acceptors: new Map([["uid-accepter", answer]]) }), prov);
    assert.equal(f.copyReady, false);
    assert.deepEqual(codes(f.findings, "sa-1"), [code]);
    assert.deepEqual(f.acceptancePlan, [], "no accepter is substituted");
  }
  const none = T.finalizeC5Census(c, canonical, facts({ acceptors: new Map() }), prov);
  assert.deepEqual(codes(none.findings, "sa-1"), ["ACCEPTING_PRINCIPAL_UNRESOLVED"]);
  // (D) the copy module never writes the actor or the uid into accepted_by
  const src = stripComments(readFileSync("src/commercialMigration/commercialC5Target.ts", "utf8"));
  assert.doesNotMatch(src, /acceptedAt === null \? null : actor/);
  assert.match(src, /a\.acceptedAt, acceptedBy, actor,/);
});

test("COUNTER HIGH-WATER (E, F, G): excluded valid numbers raise it, invalid numbers and the SO-0000 sentinel never do", () => {
  const d = commercialDocs();
  const excludedHigh = { id: "cw-so-9", data: { ...d.soCw.data, salesOrderNumber: "SO-2026-000500" } };
  const invalidFixture = { id: "fr-so", data: { ...clone(d.so1).data, salesOrderNumber: "SO-FR-999999", financialReviewP1: { version: "1.0.0" }, sourceOpportunityId: null, sourceAgreementId: null, sourceOpportunityNumber: null } };
  const invalidExcluded = { id: "cw-so-bad", data: { ...d.soCw.data, salesOrderNumber: "SO-2026-9999999x" } };
  const sentinel = { id: "cw-so-0", data: { ...d.soCw.data, salesOrderNumber: "SO-0000-900000" } };
  const hw = (orders) => C5.sourceVisibleHighWater(C5.parseCommercialSnapshot(snapshotOf({ opportunities: [d.opp1], salesAgreements: [d.sa1], salesOrders: orders })), new Set(["salesOrder|so-1"]))
    .filter((x) => x.series === "SALES_ORDER");
  assert.deepEqual(hw([d.so1, excludedHigh]).map((x) => [x.year, x.maxSequence, x.number, x.includesExcludedRecords]), [[2026, 500, "SO-2026-000500", true]]);
  assert.deepEqual(hw([d.so1, invalidFixture, invalidExcluded]).map((x) => [x.year, x.maxSequence]), [[2026, 11]], "invalid numbers never seed");
  assert.deepEqual(hw([d.so1, sentinel]).map((x) => [x.year, x.maxSequence]), [[2026, 11]], "the sentinel year never seeds");
  assert.deepEqual(hw([sentinel]), [], "a sentinel-only series seeds nothing");
});

test("OPPORTUNITY name (H) is legacy evidence only and the record migrates; accountabilityExceptionId (I) still blocks", () => {
  const d = commercialDocs();
  const named = clone(d.opp2); named.data.name = "Big deal";
  const { census: c, canonical } = census(snapshotOf({ opportunities: [named] }));
  assert.deepEqual(c.findings, []);
  assert.ok(canonical.opportunities.some((o) => o.id === "opp-2"), "the named Opportunity is copied");
  assert.doesNotMatch(JSON.stringify(canonical.opportunities), /Big deal/, "name reaches no column");
  assert.deepEqual(c.advisories.filter((a) => a.id === "opp-2").map((a) => [a.code, a.detail]), [["OPPORTUNITY_NAME_LEGACY_EVIDENCE_NOT_MIGRATED", "Big deal"]]);
  assert.equal(C5.FIELD_DISPOSITIONS.opportunity.name, "P");
  const excepted = clone(d.opp2); excepted.data.accountabilityExceptionId = "exc-1";
  const e = census(snapshotOf({ opportunities: [excepted] })).census;
  assert.ok(codes(e.findings, "opp-2").includes("ACCOUNTABILITY_EXCEPTION_NO_TARGET"));
  assert.ok(e.blockers.includes("ACCOUNTABILITY_EXCEPTION_NO_TARGET"));
});

test("the C5 CLI's post-fence checks: snapshot source must match the registry environment and is never production; census exit codes", () => {
  const cli = require("../scripts/commercialC5.js");
  const snap = C5.parseCommercialSnapshot(cleanSnapshot());
  assert.doesNotThrow(() => cli.assertSnapshotSource(snap, SANDBOX_ENV));
  assert.throws(() => cli.assertSnapshotSource(C5.parseCommercialSnapshot(cleanSnapshot("", { projectId: "taylor-parts", environmentId: SANDBOX_ENV })), SANDBOX_ENV), /production/);
  assert.throws(() => cli.assertSnapshotSource(C5.parseCommercialSnapshot(cleanSnapshot("", { projectId: SANDBOX_PROJECT, environmentId: "platform-integration" })), SANDBOX_ENV), /Refused/);
  assert.throws(() => cli.assertSnapshotSource(snap, "platform-integration"), /Refused/);
  assert.equal(cli.exitCodeForCensus({ copyReady: true }, "MIGRATION_REQUIRED_OR_OWNER_REVIEW"), 0);
  assert.equal(cli.exitCodeForCensus({ copyReady: false }, "DISPOSABLE_FIXTURE_ONLY"), 0);
  assert.equal(cli.exitCodeForCensus({ copyReady: false }, "MIGRATION_REQUIRED_OR_OWNER_REVIEW"), 1);
  assert.equal(cli.exitCodeForCensus({ copyReady: false }, "STOP_FOR_OWNER_DECISION"), 1);
  const env = { X: "postgres://x", EOS_ENVIRONMENT: "nonprod" };
  const base = { mode: "copy", environment: "platform-sandbox", databaseUrlEnv: "X", tenantKey: "t", snapshot: "s", principalId: "p" };
  assert.throws(() => cli.assertC5Invocation(base, env), /--confirmMigrationRequired/);
  assert.throws(() => cli.assertC5Invocation({ ...base, confirmMigrationRequired: "yes" }, env), /--confirmMigrationRequired/);
  assert.equal(cli.assertC5Invocation({ ...base, confirmMigrationRequired: "a".repeat(64) }, env).mode, "copy");
  assert.throws(() => cli.assertC5Invocation({ ...base, confirmMigrationRequired: "a".repeat(64), includeCertification: "true" }, env), /not an option/);
  for (const flag of ["retainDeclaredSyntheticSeedRows", "retainSyntheticRows", "allowUnknownTargetRows"]) {
    assert.throws(() => cli.assertC5Invocation({ ...base, confirmMigrationRequired: "a".repeat(64), [flag]: "true" }, env), /is not an option: target rows the snapshot does not hold/);
  }
});
