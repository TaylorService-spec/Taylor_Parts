// THE SUPPLIER TERMS FIELD-GROUP GOLDEN -- generator (field permissions PR 1: tests and tooling only).
//
// The accepted Supplier Terms authority (SUP-1, DECISIONS #230) is the governed field-group evaluator
// (eosOps/governedFieldGroups.ts) applied to PART_SUPPLIER_TERMS_FIELD_GROUPS (eosOps/partSupplierTerms.ts). This module
// evaluates it EXHAUSTIVELY: every subset of the eight capability keys the definition names (the seven supplierCatalogItem
// keys + inventory.catalog.read = 2^8 = 256 capability sets), and for each one
//   fieldAccessFor, recordAccessFor, canReadAllGroups, projectForCaller on one FIXED record (withheld markers included),
//   and the assertWritable outcome for every mode x probe (each group's fields, all declared fields, an undeclared field).
// The output is generated from CODE, never from data: the record below is a literal synthetic fixture, and nothing reads a
// database, a census or a clock. Rendering is deterministic (fixed key order, one case per line).
//
// The golden lives at test/fixtures/supplierTermsFieldGroups.golden.json and its SHA-256 is pinned in
// test/supplierTermsFieldGroupsGolden.test.mjs. Later field-permission PRs (engine G1-G4, adoptions) must leave it
// BYTE-IDENTICAL; a deliberate change regenerates it AND moves the pinned digest in the same reviewed diff.
//
//   npm run build && node test/support/supplierTermsFieldGroupsGolden.mjs --check   # exit 1 on any difference
//   npm run build && node test/support/supplierTermsFieldGroupsGolden.mjs --write   # deliberate regeneration only
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const GOLDEN_RELATIVE_PATH = "test/fixtures/supplierTermsFieldGroups.golden.json";
export const GOLDEN_PATH = resolve(FUNCTIONS_DIR, GOLDEN_RELATIVE_PATH);

/** The subset universe, in a FIXED order (bit i of a case index = CAPABILITY_KEYS[i] held). Literal on purpose. */
export const CAPABILITY_KEYS = Object.freeze([
  "inventory.supplierTerms.read",
  "inventory.supplierTerms.create",
  "inventory.supplierTerms.edit",
  "inventory.supplierTerms.changeStatus",
  "inventory.catalog.cost.read",
  "inventory.catalog.cost.create",
  "inventory.catalog.cost.edit",
  "inventory.catalog.read",
]);

/** One synthetic item carrying every declared field plus one field NO group declares (fail-closed probe). */
export const FIXED_RECORD = Object.freeze({
  itemId: "SYN-PART-0001__SYN-SUP-01",
  partId: "SYN-PART-0001",
  supplierId: "SYN-SUP-01",
  supplierName: "Synthetic Supplier One",
  supplierStatus: "ACTIVE",
  supplierSku: "SYN-SKU-77",
  status: "ACTIVE",
  preferred: true,
  version: 3,
  leadTimeDays: 14,
  availability: "AVAILABLE",
  minOrderQty: "2",
  orderMultiple: "2",
  purchaseUnit: "CASE",
  conversionToStockingUnit: "12",
  lastVerifiedAt: "2026-01-02T03:04:05Z",
  cost: "41.2500",
  currency: "USD",
  contractStart: "2026-01-01",
  contractEnd: "2026-12-31",
  internalNote: "undeclared field -- must never be projected",
});

/** Write probes, literal so a field moving between groups changes the golden. */
export const WRITE_PROBES = Object.freeze({
  RELATIONSHIP: Object.freeze(["supplierSku"]),
  OPERATIONAL: Object.freeze(["leadTimeDays", "availability", "minOrderQty", "orderMultiple", "purchaseUnit", "conversionToStockingUnit", "lastVerifiedAt"]),
  COMMERCIAL: Object.freeze(["cost", "currency", "contractStart", "contractEnd"]),
  ALL_TERMS: Object.freeze(["supplierSku", "cost", "currency", "leadTimeDays", "minOrderQty", "orderMultiple", "purchaseUnit",
    "conversionToStockingUnit", "contractStart", "contractEnd", "availability", "lastVerifiedAt"]),
  UNDECLARED: Object.freeze(["internalNote"]),
});
const MODES = Object.freeze(["create", "edit"]);

const flags = (a) => `${a.read ? "r" : "-"}${a.create ? "c" : "-"}${a.edit ? "e" : "-"}`;

/** Every key the definition names (record doorway + every group requirement), sorted. */
export function definitionKeys(def) {
  const keys = new Set(Object.values(def.record ?? {}));
  for (const g of def.groups) for (const m of ["read", "create", "edit"]) {
    const r = g[m];
    if (r === null) continue;
    for (const k of typeof r === "string" ? [r] : r) keys.add(k);
  }
  return [...keys].sort();
}

/** The golden as a plain object. `lib` defaults to the compiled modules under lib/ (npm run build first). */
export function computeGolden(lib = {
  fg: require("../../lib/eosOps/governedFieldGroups.js"),
  terms: require("../../lib/eosOps/partSupplierTerms.js"),
}) {
  const { fg, terms } = lib;
  const def = terms.PART_SUPPLIER_TERMS_FIELD_GROUPS;
  const projections = [];
  const projectionIndex = new Map();
  const refusals = [];
  const refusalIndex = new Map();
  const intern = (list, index, value) => {
    const k = JSON.stringify(value);
    if (!index.has(k)) { index.set(k, list.length); list.push(value); }
    return index.get(k);
  };
  const cases = [];
  for (let mask = 0; mask < 1 << CAPABILITY_KEYS.length; mask += 1) {
    const held = CAPABILITY_KEYS.filter((_, i) => (mask & (1 << i)) !== 0);
    const caps = new Set(held);
    const fieldAccess = fg.fieldAccessFor(def, caps);
    const recordAccess = fg.recordAccessFor(def, caps);
    const write = {};
    for (const mode of MODES) {
      write[mode] = {};
      for (const [probe, fields] of Object.entries(WRITE_PROBES)) {
        try {
          fg.assertWritable(def, caps, mode, fields);
          write[mode][probe] = "OK";
        } catch (err) {
          if (!(err instanceof fg.GovernedFieldGroupError)) throw err;
          write[mode][probe] = intern(refusals, refusalIndex,
            { code: err.code, category: err.category, message: err.message, details: err.details });
        }
      }
    }
    cases.push({
      mask,
      caps: held,
      fieldAccess: Object.fromEntries(Object.entries(fieldAccess).map(([g, a]) => [g, flags(a)])),
      recordAccess: Object.entries(recordAccess).filter(([, v]) => v).map(([k]) => k),
      canReadAllGroups: fg.canReadAllGroups(def, caps),
      projection: intern(projections, projectionIndex, fg.projectForCaller(def, caps, FIXED_RECORD)),
      write,
    });
  }
  return {
    $comment: "GENERATED by functions/test/support/supplierTermsFieldGroupsGolden.mjs from code only (no data). The exhaustive "
      + "Supplier Terms field-group decision table: 256 capability sets. Pinned by SHA-256 in "
      + "functions/test/supplierTermsFieldGroupsGolden.test.mjs -- regenerate only deliberately, with the digest, in one reviewed diff.",
    version: 1,
    objectKey: def.objectKey,
    definition: def,
    capabilityKeys: CAPABILITY_KEYS,
    record: FIXED_RECORD,
    writeProbes: WRITE_PROBES,
    auditSafe: fg.auditSafe(def, FIXED_RECORD),
    sensitiveFieldsChangedFromNothing: fg.sensitiveFieldsChanged(def, null, FIXED_RECORD),
    projections,
    refusals,
    cases,
  };
}

/** Deterministic bytes: header members one per line, then one case per line. */
export function renderGolden(golden) {
  const { cases, ...header } = golden;
  const lines = ["{"];
  for (const [k, v] of Object.entries(header)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push('  "cases": [');
  lines.push(cases.map((c) => `    ${JSON.stringify(c)}`).join(",\n"));
  lines.push("  ]");
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rendered = renderGolden(computeGolden());
  if (process.argv.includes("--write")) {
    writeFileSync(GOLDEN_PATH, rendered);
    console.log(`wrote ${GOLDEN_RELATIVE_PATH} (${rendered.length} bytes)`);
  } else {
    const onDisk = readFileSync(GOLDEN_PATH, "utf8");
    if (onDisk !== rendered) { console.error(`${GOLDEN_RELATIVE_PATH} differs from the evaluator's output`); process.exit(1); }
    console.log(`${GOLDEN_RELATIVE_PATH} matches`);
  }
}
