// THE SUPPLIER TERMS FIELD-GROUP GOLDEN (field permissions PR 1 -- tests only, zero runtime change).
//
// The accepted Supplier Terms authority must stay BYTE-IDENTICAL while the generic field-group engine is extended
// (G1-G4) and other Objects adopt it. This suite recomputes the exhaustive decision table -- every subset of the eight
// keys PART_SUPPLIER_TERMS_FIELD_GROUPS names (256 capability sets) x fieldAccessFor / recordAccessFor /
// canReadAllGroups / projectForCaller / assertWritable -- and compares it byte-for-byte with the committed golden.
//
// TWO PINS, the EXPORT_BASELINE_DIGEST pattern (scripts/firebaseCapabilityEquivalenceGuard.mjs):
//   1. golden == the evaluator's output now   (a behaviour change fails)
//   2. sha256(golden) == SUPPLIER_TERMS_GOLDEN_DIGEST, pinned HERE   (a silent `--write` regeneration fails)
// A DELIBERATE change regenerates the golden AND moves the digest below in one reviewed diff, citing the ruling.
// Pure: no database, no network. Prerequisite: `npm run build` (imports the compiled lib/ output).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  CAPABILITY_KEYS,
  FIXED_RECORD,
  GOLDEN_PATH,
  computeGolden,
  definitionKeys,
  renderGolden,
} from "./support/supplierTermsFieldGroupsGolden.mjs";

const require = createRequire(import.meta.url);
const terms = require("../lib/eosOps/partSupplierTerms.js");

/** sha256 of test/fixtures/supplierTermsFieldGroups.golden.json -- the accepted SUP-1 baseline (origin/main a360020d). */
export const SUPPLIER_TERMS_GOLDEN_DIGEST = "6022d63fb39b767f048e4d9179fad97d7ea157ce4cf809358603090605e45c6f";

const onDisk = readFileSync(GOLDEN_PATH, "utf8");

test("the golden file is the pinned one (no silent regeneration)", () => {
  assert.equal(createHash("sha256").update(onDisk).digest("hex"), SUPPLIER_TERMS_GOLDEN_DIGEST,
    "the committed golden changed: a deliberate change must move SUPPLIER_TERMS_GOLDEN_DIGEST in the same reviewed diff");
});

test("the evaluator reproduces the golden byte-for-byte", () => {
  const rendered = renderGolden(computeGolden());
  if (rendered !== onDisk) {
    const a = rendered.split("\n");
    const b = onDisk.split("\n");
    const i = a.findIndex((line, n) => line !== b[n]);
    assert.fail(`Supplier Terms field-group behaviour changed (first differing line ${i + 1}):\n  now:    ${a[i]?.slice(0, 400)}\n  golden: ${b[i]?.slice(0, 400)}`);
  }
});

test("the generator is deterministic (two runs, identical bytes)", () => {
  assert.equal(renderGolden(computeGolden()), renderGolden(computeGolden()));
});

test("TRIPS: dropping inventory.catalog.read from the COMMERCIAL read (the r1 all-of) changes the golden", () => {
  const fg = require("../lib/eosOps/governedFieldGroups.js");
  const def = terms.PART_SUPPLIER_TERMS_FIELD_GROUPS;
  const weakened = fg.defineFieldGroups({
    ...def,
    groups: def.groups.map((g) => (g.key === "COMMERCIAL" ? { ...g, read: g.read.filter((k) => k !== "inventory.catalog.read") } : g)),
  });
  assert.notEqual(renderGolden(computeGolden({ fg, terms: { PART_SUPPLIER_TERMS_FIELD_GROUPS: weakened } })), onDisk);
});

test("the subset universe is exactly the keys the definition names -- a new key cannot hide from the golden", () => {
  assert.deepEqual([...CAPABILITY_KEYS].sort(), definitionKeys(terms.PART_SUPPLIER_TERMS_FIELD_GROUPS));
  assert.equal(new Set(CAPABILITY_KEYS).size, 8);
  const golden = JSON.parse(onDisk);
  assert.equal(golden.cases.length, 256);
  assert.deepEqual(golden.cases.map((c) => c.mask), [...Array(256).keys()]);
});

test("the golden states the accepted rulings (spot checks that read as rules, not bytes)", () => {
  const g = JSON.parse(onDisk);
  const at = (...keys) => g.cases[keys.reduce((m, k) => m | (1 << CAPABILITY_KEYS.indexOf(k)), 0)];
  const projection = (c) => g.projections[c.projection];
  // Nothing held: no group readable or writable; the projection withholds every group, names only.
  assert.deepEqual(at().fieldAccess, { RELATIONSHIP: "---", OPERATIONAL: "---", COMMERCIAL: "---" });
  // r1 all-of: the COMMERCIAL read needs supplierTerms.read AND catalog.read AND catalog.cost.read.
  assert.equal(at("inventory.supplierTerms.read", "inventory.catalog.cost.read").fieldAccess.COMMERCIAL, "---");
  assert.equal(at("inventory.supplierTerms.read", "inventory.catalog.read", "inventory.catalog.cost.read").fieldAccess.COMMERCIAL, "r--");
  // Doorway only: relationship + ordering terms visible, cost withheld (names + required keys, never a value).
  const doorway = projection(at("inventory.supplierTerms.read"));
  assert.equal("cost" in doorway, false);
  assert.deepEqual(doorway.withheld.map((w) => w.group), ["COMMERCIAL"]);
  assert.equal(JSON.stringify(doorway.withheld).includes(FIXED_RECORD.cost), false);
  // Fail closed: an undeclared field is never projected and never writable, whatever is held.
  for (const c of g.cases) {
    assert.equal("internalNote" in projection(c), false);
    for (const mode of ["create", "edit"]) assert.equal(g.refusals[c.write[mode].UNDECLARED].code, "FIELD_NOT_GOVERNED");
  }
  // The audit view withholds every COMMERCIAL value.
  for (const f of ["cost", "currency", "contractStart", "contractEnd"]) assert.deepEqual(g.auditSafe[f], { withheld: true });
  // Additive: holding more keys never narrows any decision.
  const rank = (s) => [...s].map((ch) => (ch === "-" ? 0 : 1));
  for (const c of g.cases) for (const d of g.cases) {
    if ((c.mask & d.mask) !== c.mask) continue; // d is a superset of c
    for (const grp of Object.keys(c.fieldAccess)) {
      rank(c.fieldAccess[grp]).forEach((v, i) => assert.ok(rank(d.fieldAccess[grp])[i] >= v, `${grp} narrowed ${c.mask} -> ${d.mask}`));
    }
  }
});
