// THE COORDINATED VISIT ANCHOR CENSUS — proving the classifier forces its verdicts.
//
// The census exists so a cutover decision is made against named causes. That is only worth anything if
// each verdict is REACHED BY EVIDENCE and not by elimination, so most of this suite is about what the
// classifier REFUSES to conclude: an unsourced legacy claim, an unmapped identity, an absent inventory.
//
// Pure throughout: no database, no Firebase, no clock. Prerequisite: `npm run build` in functions/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const census = require("../lib/eosOps/migration/coordinatedVisitAnchorCensus.js");
const seam = require("../lib/eosOps/coordinatedVisitPostgresRead.js");

const SOURCE = readFileSync(
  join(FUNCTIONS_DIR, "src", "eosOps", "migration", "coordinatedVisitAnchorCensus.ts"), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const wo = (o) => ({
  id: "wo-1", workOrderNumber: "WO-2026-000001", status: "SCHEDULED",
  customerId: "acct-1", locationId: "loc-1", salesOrderId: null,
  provenance: "MIGRATED", lineRefRows: 0, ...o,
});
const run = (evidence) => census.classifyCoordinatedVisitAnchors({
  workOrders: [], postgresSalesOrders: new Map(), ...evidence,
});

// ════════════════════ 1. READ ONLY, BY CONSTRUCTION ════════════════════

test("the census module issues no mutation of any kind", () => {
  const body = strip(SOURCE);
  for (const verb of ["INSERT", "UPDATE ", "DELETE", "TRUNCATE", "CREATE ", "DROP ", "ALTER "]) {
    assert.equal(body.includes(verb), false,
      `the census must never ${verb.trim()} — it exists to preserve the evidence it measures`);
  }
});

test("the measurement reads only the two relations the projection reads", () => {
  const relations = [...strip(SOURCE).matchAll(/FROM\s+(eos_[a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(relations)].sort(),
    ["eos_commercial.sales_orders", "eos_ops.work_order_sales_order_lines", "eos_ops.work_orders"]);
});

// ════════════════════ 2. THE VERDICTS, EACH FORCED BY ITS OWN FACT ════════════════════

test("an anchor present in eos_commercial resolves, and carries its reference", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "sor_a" })],
    postgresSalesOrders: new Map([["sor_a", "SO-2026-000009"]]),
  });
  assert.equal(r.classifications[0].verdict, "RESOLVED");
  assert.equal(r.classifications[0].resolvedReference, "SO-2026-000009");
  assert.equal(r.everyAnchorResolves, true);
});

test("a resolved row with no number resolves, but the projection prints nothing", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "sor_a" })],
    postgresSalesOrders: new Map([["sor_a", null]]),
  });
  assert.equal(r.classifications[0].verdict, "RESOLVED");
  assert.equal(r.classifications[0].resolvedReference, null);
});

test("an anchor known to the legacy source, absent from PostgreSQL, is LEGACY_ONLY_REFERENCE", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "INqO9CaHMdQMp2g030yf" })],
    legacySalesOrders: [{
      salesOrderId: "INqO9CaHMdQMp2g030yf", salesOrderNumber: "SO-2026-000002",
      citation: "docs/orchestration/metadata-program/sandbox-promotion-package.md:910",
    }],
  });
  const c = r.classifications[0];
  assert.equal(c.verdict, "LEGACY_ONLY_REFERENCE");
  assert.equal(c.resolvedReference, null);
  assert.ok(c.evidence.some((e) => e.includes("SO-2026-000002")));
  assert.ok(c.evidence.some((e) => e.includes("sandbox-promotion-package.md:910")));
  assert.equal(r.everyAnchorResolves, false);
});

test("legacy evidence with a blank citation is not evidence at all", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "legacy-1" })],
    legacySalesOrders: [{ salesOrderId: "legacy-1", salesOrderNumber: "SO-1", citation: "   " }],
  });
  // The inventory was supplied but this entry is inadmissible, so the record is absent from BOTH stores
  // as far as admissible evidence goes. Crucially: not LEGACY_ONLY_REFERENCE.
  assert.equal(r.classifications[0].verdict, "MISSING_COMMERCIAL_RECORD");
});

test("an anchor absent from PostgreSQL AND from a supplied inventory is MISSING_COMMERCIAL_RECORD", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "so-harbor-c713" })],
    legacySalesOrders: [{ salesOrderId: "other", salesOrderNumber: null, citation: "doc" }],
  });
  assert.equal(r.classifications[0].verdict, "MISSING_COMMERCIAL_RECORD");
});

test("with NO inventory supplied, absence is UNCLASSIFIABLE — never MISSING_COMMERCIAL_RECORD", () => {
  const r = run({ workOrders: [wo({ salesOrderId: "unknown-1" })] });
  const c = r.classifications[0];
  assert.equal(c.verdict, "UNCLASSIFIABLE");
  assert.ok(c.evidence.some((e) => e.includes("UNMEASURED")));
  assert.equal(r.everyAnchorResolves, false);
});

test("IDENTITY_FORMAT_MISMATCH requires a governed mapping, never a shape resemblance", () => {
  const shapes = run({
    // A Firestore-shaped anchor and a sor_-shaped PostgreSQL row, and nothing that binds them.
    workOrders: [wo({ salesOrderId: "cIk3hlPDTXH5IB3VHdLy" })],
    postgresSalesOrders: new Map([["sor_2d2e1715-9e18-4e50-8d80-776890011440", "SAMPLE-CO-SO-0003"]]),
    legacySalesOrders: [{ salesOrderId: "cIk3hlPDTXH5IB3VHdLy", salesOrderNumber: "SO-2026-000004", citation: "doc" }],
  });
  assert.equal(shapes.classifications[0].verdict, "LEGACY_ONLY_REFERENCE");

  const mapped = run({
    workOrders: [wo({ salesOrderId: "cIk3hlPDTXH5IB3VHdLy" })],
    postgresSalesOrders: new Map([["sor_2d2e1715-9e18-4e50-8d80-776890011440", "SAMPLE-CO-SO-0003"]]),
    legacySalesOrders: [{ salesOrderId: "cIk3hlPDTXH5IB3VHdLy", salesOrderNumber: "SO-2026-000004", citation: "doc" }],
    identityMappings: [{
      legacySalesOrderId: "cIk3hlPDTXH5IB3VHdLy",
      postgresSalesOrderId: "sor_2d2e1715-9e18-4e50-8d80-776890011440",
      citation: "a governed mapping table",
    }],
  });
  assert.equal(mapped.classifications[0].verdict, "IDENTITY_FORMAT_MISMATCH");
});

test("MIGRATION_NOT_RUN outranks LEGACY_ONLY_REFERENCE, and only when the plan is unapplied", () => {
  const evidence = {
    workOrders: [wo({ salesOrderId: "legacy-1" })],
    legacySalesOrders: [{ salesOrderId: "legacy-1", salesOrderNumber: "SO-1", citation: "doc" }],
  };
  const unapplied = run({
    ...evidence,
    boundMigrations: [{ salesOrderId: "legacy-1", migration: "C5", applied: false, citation: "plan §5" }],
  });
  assert.equal(unapplied.classifications[0].verdict, "MIGRATION_NOT_RUN");

  const applied = run({
    ...evidence,
    boundMigrations: [{ salesOrderId: "legacy-1", migration: "C5", applied: true, citation: "plan §5" }],
  });
  // An applied plan cannot explain an absent row; the truthful statement falls back to where it is.
  assert.equal(applied.classifications[0].verdict, "LEGACY_ONLY_REFERENCE");
});

test("a named exclusion ruling outranks the legacy record's existence", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "legacy-1" })],
    legacySalesOrders: [{ salesOrderId: "legacy-1", salesOrderNumber: "SO-1", citation: "doc" }],
    exclusionRulings: [{ salesOrderId: "legacy-1", ruling: "OWNER RULING 2026-09-22: out of population" }],
  });
  assert.equal(r.classifications[0].verdict, "MIGRATION_EXCLUDED");
});

test("a malformed identifier is a DATA_DEFECT before it is a missing record", () => {
  for (const bad of [" padded", "sales/orders/x", "x".repeat(201)]) {
    const r = run({
      workOrders: [wo({ salesOrderId: bad })],
      legacySalesOrders: [{ salesOrderId: "other", salesOrderNumber: null, citation: "doc" }],
    });
    assert.equal(r.classifications[0].verdict, "DATA_DEFECT", bad);
  }
  // A well-formed id that resolves nowhere is NOT a defect — that would blame the Work Order for a
  // Commercial backlog.
  assert.equal(census.isDefectiveIdentifier("cIk3hlPDTXH5IB3VHdLy"), false);
});

test("OTHER_EXPLICIT is reachable only with a spelled-out cause, and only with no inventory", () => {
  const r = run({
    workOrders: [wo({ salesOrderId: "odd-1" })],
    explicitOther: new Map([["odd-1", "the anchor names a Sales Order of another tenant"]]),
  });
  assert.equal(r.classifications[0].verdict, "OTHER_EXPLICIT");
  assert.deepEqual(r.classifications[0].evidence, ["the anchor names a Sales Order of another tenant"]);
});

// ════════════════════ 3. THE POPULATION ARITHMETIC ════════════════════

test("a Work Order with no anchor is uncoordinated, not a failed anchor", () => {
  const r = run({
    workOrders: [wo({ id: "a", salesOrderId: null }), wo({ id: "b", salesOrderId: "   " }),
      wo({ id: "c", salesOrderId: "sor_a" })],
    postgresSalesOrders: new Map([["sor_a", "SO-1"]]),
  });
  assert.equal(r.workOrdersMeasured, 3);
  assert.equal(r.uncoordinated, 2);
  assert.equal(r.anchored, 1);
  assert.equal(r.classifications.length, 1);
});

test("DISTINCT anchors are counted once however many Work Orders share them", () => {
  const r = run({
    workOrders: [wo({ id: "a", salesOrderId: "so-1" }), wo({ id: "b", salesOrderId: "so-1" }),
      wo({ id: "c", salesOrderId: "so-2" })],
    postgresSalesOrders: new Map([["so-1", "SO-1"]]),
    legacySalesOrders: [{ salesOrderId: "so-2", salesOrderNumber: "SO-2", citation: "doc" }],
  });
  assert.equal(r.distinctAnchors, 2);
  assert.equal(r.distinctAnchorsResolved, 1);
  assert.equal(r.countsByVerdict.RESOLVED, 2);           // two Work Orders, one anchor
  assert.equal(r.countsByVerdict.LEGACY_ONLY_REFERENCE, 1);
  assert.equal(r.everyAnchorResolves, false);
});

test("everyAnchorResolves is false when there is nothing to resolve", () => {
  assert.equal(run({ workOrders: [wo({ salesOrderId: null })] }).everyAnchorResolves, false);
});

test("every verdict in the vocabulary is counted, including the ones at zero", () => {
  const r = run({ workOrders: [] });
  assert.deepEqual(Object.keys(r.countsByVerdict).sort(), [...census.ANCHOR_VERDICTS].sort());
});

// ════════════════════ 4. THE TIERS MATCH THE SEAM THEY DESCRIBE ════════════════════

test("the three tiers name exactly the projection's three reads, and only ANCHOR_REFERENCE + LINE_DETAIL need Commercial", () => {
  const tiers = census.COORDINATED_VISIT_DATA_TIERS;
  assert.deepEqual(tiers.map((t) => t.tier), ["GROUPING", "ANCHOR_REFERENCE", "LINE_DETAIL"]);
  assert.deepEqual(tiers.map((t) => t.dependsOnCommercial), [false, true, true]);
  for (const t of tiers) {
    assert.ok(t.withoutIt.length > 0 && t.withIt.length > 0, `${t.tier} must state both sides`);
  }
});

test("the ANCHOR_REFERENCE tier needs IDENTITY ONLY — the seam's reference read selects nothing else", () => {
  const seamSource = readFileSync(
    join(FUNCTIONS_DIR, "src", "eosOps", "coordinatedVisitPostgresRead.ts"), "utf8");
  const query = /SELECT id, sales_order_number FROM eos_commercial\.sales_orders/;
  assert.match(seamSource, query,
    "if the reference read grows a column, the minimum cutover dependency grew with it");
  // And the seam still groups on the opaque string, so GROUPING really is Commercial-free.
  assert.equal(seam.MAX_RESOLVED_SALES_ORDER_REFERENCES, 30);
  assert.equal(seam.DEFAULT_LIMIT, 300);
});
