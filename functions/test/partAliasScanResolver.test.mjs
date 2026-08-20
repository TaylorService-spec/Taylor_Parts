// SCANNED IDENTIFIER -> PART. The trusted multi-type resolver. Pure over an injected per-type
// resolver: no emulator, no Firestore, no network.
// Run: node --test test/partAliasScanResolver.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveScannedPartIdentifier,
  candidateAliasTypes,
} from "../lib/partMaster/partAliasScanResolver.js";

// A stub for the EXISTING per-type resolver. `answers` maps aliasType -> the outcome that type
// would return, so each test states exactly what the alias store holds and nothing else.
const stub = (answers) => {
  const calls = [];
  const fn = async ({ aliasType }) => {
    calls.push(aliasType);
    return answers[aliasType] ?? { result: "NOT_FOUND" };
  };
  fn.calls = calls;
  return fn;
};

const found = (partId, aliasId = "a1") => ({ result: "FOUND", partId, aliasId, status: "ACTIVE" });
const run = (resolver, input = { rawValue: "0037000112345" }) =>
  resolveScannedPartIdentifier(input, { db: {}, resolver });

// ─────────────────────────────────────────── the happy path

test("one ACTIVE registration resolves to that part, naming which identifier matched", async () => {
  const r = await run(stub({ UPC: { ...found("PRT-1001"), aliasType: "UPC" } }));
  assert.equal(r.result, "FOUND");
  assert.equal(r.partId, "PRT-1001");
  assert.equal(r.aliasType, "UPC", "which identifier matched is part of the answer, not a detail");
});

test("the SAME part registered under several types is one answer, not an ambiguity", async () => {
  // A part legitimately carries a UPC and a GTIN for the same physical code. That is not a conflict.
  const r = await run(stub({
    UPC: { ...found("PRT-1001"), aliasType: "UPC" },
    GTIN: { ...found("PRT-1001"), aliasType: "GTIN" },
  }));
  assert.equal(r.result, "FOUND");
  assert.equal(r.partId, "PRT-1001");
});

// ─────────────────────────────────────────── fail closed

test("the same value pointing at DIFFERENT parts is AMBIGUOUS — never a pick", async () => {
  const r = await run(stub({
    UPC: { ...found("PRT-1001"), aliasType: "UPC" },
    SUPPLIER_SKU: { ...found("PRT-2002"), aliasType: "SUPPLIER_SKU" },
  }));
  assert.equal(r.result, "AMBIGUOUS");
  assert.equal(r.partId, undefined, "an ambiguous resolution must not carry a part");
  assert.deepEqual(r.matches.map((m) => m.partId).sort(), ["PRT-1001", "PRT-2002"]);
});

test("INACTIVE is never collapsed into NOT_FOUND, and still names the part", async () => {
  // "registered but switched off" and "never registered" call for opposite fixes: one is a
  // reactivation, the other a registration. Collapsing them causes duplicate records.
  const r = await run(stub({ UPC: { result: "INACTIVE", partId: "PRT-1001", aliasId: "a1", aliasType: "UPC" } }));
  assert.equal(r.result, "INACTIVE");
  assert.equal(r.partId, "PRT-1001");
});

test("an ACTIVE registration wins over an INACTIVE one", async () => {
  const r = await run(stub({
    UPC: { result: "INACTIVE", partId: "PRT-OLD", aliasId: "a0", aliasType: "UPC" },
    GTIN: { ...found("PRT-NEW"), aliasType: "GTIN" },
  }));
  assert.equal(r.result, "FOUND");
  assert.equal(r.partId, "PRT-NEW");
});

test("two INACTIVE registrations on different parts are AMBIGUOUS, not a pick", async () => {
  const r = await run(stub({
    UPC: { result: "INACTIVE", partId: "PRT-1001", aliasId: "a1", aliasType: "UPC" },
    LEGACY: { result: "INACTIVE", partId: "PRT-2002", aliasId: "a2", aliasType: "LEGACY" },
  }));
  assert.equal(r.result, "AMBIGUOUS");
});

test("well-formed and registered nowhere is NOT_FOUND", async () => {
  const r = await run(stub({}));
  assert.equal(r.result, "NOT_FOUND");
});

test("rejected by EVERY candidate type is MALFORMED, not NOT_FOUND", async () => {
  // "I could not read that" and "that is not registered" are different problems. Reporting the
  // first as the second sends the operator to register a value the system cannot store.
  const all = {};
  for (const t of candidateAliasTypes(false)) all[t] = { result: "MALFORMED", detail: "bad" };
  const r = await run(stub(all));
  assert.equal(r.result, "MALFORMED");
});

test("rejected by SOME types is still NOT_FOUND — one type accepting it is enough", async () => {
  // A 12-digit number is not a valid EAN and IS a valid UPC. Per-type rejection is normal.
  const r = await run(stub({ EAN: { result: "MALFORMED", detail: "wrong length" } }));
  assert.equal(r.result, "NOT_FOUND");
});

test("an empty or blank value is MALFORMED, and asks the store nothing", async () => {
  for (const raw of ["", "   ", undefined, null, 42]) {
    const s = stub({});
    const r = await resolveScannedPartIdentifier({ rawValue: raw }, { db: {}, resolver: s });
    assert.equal(r.result, "MALFORMED", `${String(raw)} must be malformed`);
    assert.equal(s.calls.length, 0, "a blank scan must not hit the alias store at all");
  }
});

test("a stored CONFLICT surfaces rather than being swallowed", async () => {
  const r = await run(stub({ UPC: { result: "CONFLICT", detail: "duplicate doc" } }));
  assert.equal(r.result, "MALFORMED");
  assert.match(r.detail, /conflict/i);
});

// ─────────────────────────────────────────── which types are asked

test("MANUFACTURER_PN is NOT asked without a manufacturer scope, and IS asked with one", async () => {
  // Its normalizer requires the scope; asking without one would produce a guaranteed MALFORMED that
  // says nothing about the scan.
  assert.equal(candidateAliasTypes(false).includes("MANUFACTURER_PN"), false);
  assert.equal(candidateAliasTypes(true).includes("MANUFACTURER_PN"), true);

  const bare = stub({});
  await resolveScannedPartIdentifier({ rawValue: "ABC-123" }, { db: {}, resolver: bare });
  assert.equal(bare.calls.includes("MANUFACTURER_PN"), false);

  const scoped = stub({});
  await resolveScannedPartIdentifier({ rawValue: "ABC-123", manufacturerId: "MFR-1" }, { db: {}, resolver: scoped });
  assert.equal(scoped.calls.includes("MANUFACTURER_PN"), true);
});

test("every other registered alias type IS asked — nothing is silently unsearchable", async () => {
  const s = stub({});
  await resolveScannedPartIdentifier({ rawValue: "ABC-123" }, { db: {}, resolver: s });
  for (const t of ["INTERNAL_PN", "SUPPLIER_SKU", "UPC", "EAN", "GTIN", "LEGACY", "CUSTOMER_REF", "VENDOR_REF", "BARCODE_OTHER"]) {
    assert.ok(s.calls.includes(t), `${t} was never searched`);
  }
});

test("the raw value is trimmed once and passed through unchanged otherwise", async () => {
  // Normalization belongs to normalizeIdentifier, per type. Anything done here would be a second
  // normalizer, and the scanner and the administrator would stop agreeing about what a value means.
  let seen = null;
  const s = async ({ rawValue }) => { seen = rawValue; return { result: "NOT_FOUND" }; };
  await resolveScannedPartIdentifier({ rawValue: "  0037000112345  " }, { db: {}, resolver: s });
  assert.equal(seen, "0037000112345");
});

// ─────────────────────────────────────────── no second matcher

test("the module contains NO matching or normalization logic of its own", async () => {
  const src = readFileSync(new URL("../src/partMaster/partAliasScanResolver.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/RegExp|test\(|match\(/, /toUpperCase|toLowerCase|replace\(/, /normalizeIdentifier/, /deriveAliasDocId/]) {
    assert.doesNotMatch(code, forbidden, `resolver must not contain ${forbidden}`);
  }
  // It reaches the alias store ONLY through the existing per-type resolver.
  assert.match(code, /resolvePartAlias/);
  assert.doesNotMatch(code, /collection\(|\.doc\(|getByAliasId/, "must not read the alias store directly");
});

test("it never writes: no command, no transaction, no set/update/delete", async () => {
  const src = readFileSync(new URL("../src/partMaster/partAliasScanResolver.ts", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const forbidden of [/runTransaction/, /\.set\(/, /\.update\(/, /\.delete\(/, /createPartAlias/, /deactivatePartAlias/]) {
    assert.doesNotMatch(code, forbidden, `lookup must never ${forbidden}`);
  }
});
