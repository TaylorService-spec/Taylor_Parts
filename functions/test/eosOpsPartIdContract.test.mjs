// P1B R1 — the eos_ops PART-ID CONTRACT.
// Run: node --test test/eosOpsPartIdContract.test.mjs   (prerequisite: npm run build)
//
// Canonical inventory part identity is `Part.partId`. This suite is the evidence that the
// migration boundary gate accepts nothing else and, just as importantly, INVENTS nothing:
// no alias translation, no partsCatalog fallback, no substitute display id, no silent rewriting.
//
// The behavioural tests below prove what the function does. The MECHANICAL tests at the bottom
// prove what it cannot do, by reading its source: a fallback that is not imported cannot be taken
// on some path nobody wrote a test for.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { requireCanonicalPartId, isCanonicalPartId, PartIdContractError } = await import(
  "../lib/eosOps/migration/partIdContract.js"
);
const { PARTS_CATALOG, getCatalogItem } = await import("../lib/data/partsCatalog.js");

const CONTRACT_SOURCE_PATH = "src/eosOps/migration/partIdContract.ts";
const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    assert.ok(err instanceof PartIdContractError, `expected PartIdContractError, got ${err?.constructor?.name}`);
    return err.code;
  }
};

// ── Accepts a canonical id, and returns it UNCHANGED ────────────────────────────────────────────
test("a canonical Part.partId is accepted and returned byte-identical", () => {
  for (const id of ["PRT-1001", "SKU_C713_A", "p", "TST-1001", "A".repeat(64)]) {
    assert.equal(requireCanonicalPartId(id), id);
    assert.equal(isCanonicalPartId(id), true);
  }
});

// ── Rejects empty / blank ───────────────────────────────────────────────────────────────────────
test("empty and blank values are refused", () => {
  assert.equal(codeOf(() => requireCanonicalPartId("")), "EMPTY");
  assert.equal(codeOf(() => requireCanonicalPartId("   ")), "EMPTY");
  assert.equal(codeOf(() => requireCanonicalPartId("\t\n")), "EMPTY");
  assert.equal(isCanonicalPartId(""), false);
});

// ── Rejects a SUBSTITUTE display id ─────────────────────────────────────────────────────────────
test("a display name is refused — it is never resolved into a part id", () => {
  // "Hex Coupler" is a REAL name in src/data/partsCatalog.ts, sitting next to the sku TST-1001.
  // A validator with a catalog fallback would happily turn it into "TST-1001"; this one refuses.
  assert.equal(getCatalogItem("TST-1001").name, "Hex Coupler"); // sanity: the fixture is real
  assert.equal(codeOf(() => requireCanonicalPartId("Hex Coupler")), "NOT_CANONICAL");
  assert.equal(codeOf(() => requireCanonicalPartId("Tune-Up Kit — Deluxe - 3 Ton")), "NOT_CANONICAL");
});

test("a caller cannot smuggle a substitute id in a wrapper object or a second argument", () => {
  assert.equal(codeOf(() => requireCanonicalPartId({ partId: "PRT-1001" })), "NOT_A_STRING");
  assert.equal(codeOf(() => requireCanonicalPartId({ sku: "TST-1001", displayId: "Hex Coupler" })), "NOT_A_STRING");
  assert.equal(codeOf(() => requireCanonicalPartId(["PRT-1001"])), "NOT_A_STRING");
  assert.equal(codeOf(() => requireCanonicalPartId(1001)), "NOT_A_STRING");
  assert.equal(codeOf(() => requireCanonicalPartId(null)), "NOT_A_STRING");
  assert.equal(codeOf(() => requireCanonicalPartId(undefined)), "NOT_A_STRING");
  // The second parameter is a MESSAGE LABEL. Passing a perfectly canonical id there cannot rescue
  // an uncanonical first argument — there is no fallback slot.
  assert.equal(codeOf(() => requireCanonicalPartId("Hex Coupler", "PRT-1001")), "NOT_CANONICAL");
});

// ── No alias translation ────────────────────────────────────────────────────────────────────────
test("alias-shaped values are refused, never translated", () => {
  // Manufacturer part numbers, supplier SKUs, barcodes and legacy refs routinely carry characters
  // a canonical id never has. Each is a legitimate way to FIND a part; none is a part's identity.
  for (const alias of ["MFR/123-A", "12-3456-78.9", "0 12345 67890 5", "ACME PN 447", "sku:TST-1001"]) {
    assert.equal(codeOf(() => requireCanonicalPartId(alias)), "NOT_CANONICAL", alias);
  }
});

test("the function is total and identity-preserving: it returns its input or throws, never a different string", () => {
  const inputs = [
    ...PARTS_CATALOG.slice(0, 25).map((item) => item.sku),
    ...PARTS_CATALOG.slice(0, 25).map((item) => item.name),
    "PRT-1001",
    " PRT-1001",
    "prt-1001",
    "",
  ];
  for (const input of inputs) {
    let out;
    try {
      out = requireCanonicalPartId(input);
    } catch (err) {
      assert.ok(err instanceof PartIdContractError);
      continue;
    }
    assert.equal(out, input, `requireCanonicalPartId rewrote ${JSON.stringify(input)} into ${JSON.stringify(out)}`);
  }
});

// ── No silent rewriting ─────────────────────────────────────────────────────────────────────────
test("a value that is only canonical AFTER trimming is refused, not trimmed", () => {
  assert.equal(codeOf(() => requireCanonicalPartId(" PRT-1001")), "NOT_EXACT");
  assert.equal(codeOf(() => requireCanonicalPartId("PRT-1001 ")), "NOT_EXACT");
  assert.equal(codeOf(() => requireCanonicalPartId("\tPRT-1001\n")), "NOT_EXACT");
});

// ── MECHANICAL: the fallbacks are not merely unused, they are not reachable ─────────────────────
test("the contract module imports no catalog, no alias resolver, and no persistence", () => {
  const source = readFileSync(CONTRACT_SOURCE_PATH, "utf8");
  const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g)]
    .map((m) => m[1] ?? m[2] ?? m[3]);
  assert.deepEqual(imports, ["../../partMaster/validation"], "exactly one import: the canonical format rule");
  for (const forbidden of ["partsCatalog", "partAlias", "scannerPartLookup", "firebase", "pg"]) {
    assert.ok(
      !imports.some((spec) => spec.includes(forbidden)),
      `the part-id contract must not reach for ${forbidden}`,
    );
  }
});

test("the contract module performs no lookup at all", () => {
  const executable = readFileSync(CONTRACT_SOURCE_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const smell of ["getCatalogItem", "PARTS_CATALOG", "resolveAlias", "getFirestore", "SELECT", "pool"]) {
    assert.ok(!executable.includes(smell), `no ${smell} in the part-id contract`);
  }
});
