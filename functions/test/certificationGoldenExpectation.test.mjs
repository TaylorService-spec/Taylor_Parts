// THE GOLDEN SCENARIOS MUST BE STATABLE BEFORE THE WORLD EXISTS.
//
// ============================ THE CIRCULARITY BEING GUARDED ============================
//
// buildGoldenManifest.mjs reads every figure back out of Firestore. On its own that is a recorder,
// and a recorder certifies nothing: an applier that left G04's stock in the warehouse instead of on
// the trucks would have its wrong number written down under a heading saying "False comfort", and
// the run would look successful.
//
// data/goldenExpectation.mjs breaks that by stating the figures from the repository plan fixtures,
// with no database anywhere. These tests hold it to that claim -- purity, determinism, coverage, and
// the specific scenario semantics that make the five worth having.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;

/**
 * Source with COMMENTS REMOVED, for the checks that scan for forbidden code.
 *
 * SAME LESSON certificationIdentitySurvivesReset.test.mjs already recorded, and it caught this file
 * too: the first version of these scans failed on goldenExpectation.mjs's own header, which explains
 * at length that it must never import firebase-admin and must never fold into worldFingerprint.
 * Documenting a prohibition made the file look like it did the thing it prohibits.
 *
 * Worth restating rather than quietly fixing: a guard that reads prose punishes explanation, and the
 * explanation is the most valuable part of these files. Scan the code.
 */
function codeOf(rel) {
  const raw = readFileSync(path.resolve(REPO, rel), "utf8");
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("/*", i);
    if (open === -1) { out += raw.slice(i); break; }
    out += raw.slice(i, open);
    const close = raw.indexOf("*/", open + 2);
    if (close === -1) break;
    i = close + 2;
  }
  return out
    .split(String.fromCharCode(10))
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join(String.fromCharCode(10));
}

const {
  buildGoldenExpectation, goldenExpectationFingerprint, diffScenario,
  GOLDEN_EXPECTATION_VERSION, MANIFEST_GOLDEN_IDS, UNCOVERED_GOLDEN_IDS, COVERED_GOLDEN_IDS,
} = await import(L("functions/scripts/certificationWorld/data/goldenExpectation.mjs"));

const expectation = buildGoldenExpectation();
const byId = new Map(expectation.scenarios.map((s) => [s.goldenId, s]));

// ── ZERO I/O ──────────────────────────────────────────────────────────────────────────────────

test("the expectation is built with NO Firestore, no admin SDK, and no clock", () => {
  // The claim is structural, so it is checked structurally rather than by trusting that nothing
  // happened to connect. A transitive import of firebase-admin would mean the "pure" expectation
  // could, one refactor later, start reading the very world it exists to judge.
  const seen = new Set();
  const FORBIDDEN = ["firebase-admin", "getFirestore", "initializeApp", "Date.now(", "Math.random("];
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = path.resolve(REPO, rel);
    let src;
    try { src = codeOf(path.relative(REPO, abs).split(path.sep).join("/")); } catch { return; }
    for (const bad of FORBIDDEN) {
      assert.equal(src.includes(bad), false,
        `${rel} references "${bad}" -- the pre-write expectation must not be able to observe a world`);
    }
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
      walk(path.relative(REPO, path.resolve(path.dirname(abs), m[1])).split(path.sep).join("/"));
    }
  };
  walk("functions/scripts/certificationWorld/data/goldenExpectation.mjs");
  assert.ok(seen.size > 3, "the import walk must actually have followed the fixture graph");
});

// ── DETERMINISM ───────────────────────────────────────────────────────────────────────────────

test("the expectation is deterministic across repeated builds", () => {
  const a = buildGoldenExpectation();
  const b = buildGoldenExpectation();
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.fingerprint.hash, b.fingerprint.hash);
});

test("the fingerprint changes when an expected figure changes", () => {
  // A fingerprint that survives a changed expectation detects nothing. Proven by perturbing a copy
  // rather than by trusting the hash function.
  const base = goldenExpectationFingerprint(expectation.scenarios);
  const perturbed = expectation.scenarios.map((s, i) => i !== 0 ? s : {
    ...s, lines: s.lines.map((l, j) => j !== 0 ? l : { ...l, warehouse: l.warehouse + 1 }),
  });
  assert.notEqual(goldenExpectationFingerprint(perturbed).hash, base.hash);
  assert.equal(goldenExpectationFingerprint(perturbed).rowCount, base.rowCount);
});

test("the scenario fingerprint is SEPARATE from the base-world fingerprint", () => {
  // The base world is 1092 seeded records; this is what the appliers should produce on top of them.
  // One number covering both would mean a base-world drift and a scenario regression are
  // indistinguishable, and every scenario run would appear to change the dataset.
  const src = codeOf("functions/scripts/certificationWorld/data/goldenExpectation.mjs");
  assert.equal(src.includes("worldFingerprint"), false,
    "the scenario expectation must not reuse or fold into the base-world fingerprint");
  assert.equal(expectation.fingerprint.rowCount, expectation.scenarios.length);
});

// ── COVERAGE IS A NAMED FACT, NOT AN ACCIDENT ─────────────────────────────────────────────────

test("every scenario the manifest declares is either covered or explicitly recorded as uncovered", () => {
  // THE SILENT-PARTIAL-GUARD TEST. A twelfth scenario added to the manifest with no expectation
  // would otherwise leave the expectation building, fingerprinting and passing -- certifying eleven
  // while appearing to certify twelve.
  const declared = new Set([...COVERED_GOLDEN_IDS, ...Object.keys(UNCOVERED_GOLDEN_IDS)]);
  assert.deepEqual([...declared].sort(), [...MANIFEST_GOLDEN_IDS].sort(),
    "covered + uncovered must exactly partition the manifest's scenarios");
  for (const id of COVERED_GOLDEN_IDS) {
    assert.equal(Object.hasOwn(UNCOVERED_GOLDEN_IDS, id), false, `${id} cannot be both covered and uncovered`);
  }
});

test("MANIFEST_GOLDEN_IDS matches what buildGoldenManifest actually declares", () => {
  // The register is only worth having if it cannot drift from the file it registers. Read from
  // source because buildGoldenManifest opens Firestore at import and cannot be imported here --
  // which is itself the reason the expectation lives in a separate, pure module.
  const src = readFileSync(
    path.resolve(REPO, "functions/scripts/certificationWorld/buildGoldenManifest.mjs"), "utf8");
  const ids = [...src.matchAll(/\{\s*id:\s*"(G\d+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0, "the id scan must actually find scenarios");
  assert.deepEqual(ids.sort(), [...MANIFEST_GOLDEN_IDS].sort(),
    "adding a scenario to the manifest must force a decision about its expectation");
});

test("every covered scenario carries a deterministic join key that is NOT a work-order number", () => {
  // demandPlan.mjs records why: createWorkOrderRecord "mints its own document id and WO number, so
  // the fixture cannot name them". A hardcoded WO number is an assumption about counter ordering,
  // so the expectation joins on the scenario tag and lets the comparison resolve the number.
  for (const s of expectation.scenarios) {
    assert.match(s.scenarioTag, /^cw-demand-[a-z0-9-]+$/);
    assert.equal(Object.hasOwn(s, "woNumber"), false, "the expectation must not key on a minted number");
  }
});

// ── THE SCENARIO SEMANTICS THEMSELVES ─────────────────────────────────────────────────────────

test("G01 is fulfillable -- the control case, which must stay boring", () => {
  const g = byId.get("G01");
  assert.equal(g.fulfillable, true);
  for (const l of g.lines) assert.equal(l.warehouseShortage, 0);
});

test("G02 is short with NO inbound, and inbound is null rather than zero", () => {
  // The distinction the scenario exists for: "nothing is on order" is a fact, "inbound measured at
  // zero" is a different fact, and reporting the second when you know only the first is the defect.
  const g = byId.get("G02");
  assert.equal(g.fulfillable, false);
  assert.ok(g.lines.some((l) => l.warehouseShortage > 0));
  for (const l of g.lines) assert.equal(l.plannedInbound, null);
});

test("G03 is short WITH inbound that covers the shortage", () => {
  const g = byId.get("G03");
  assert.equal(g.fulfillable, false);
  const l = g.lines[0];
  assert.ok(l.warehouseShortage > 0);
  assert.ok(l.plannedInbound !== null && l.plannedInbound >= l.warehouseShortage,
    "the recovery order must be able to close the gap, or the scenario proves nothing");
});

test("G04 is FALSE COMFORT: the company owns enough, the warehouse cannot fill the job", () => {
  // The most valuable scenario and the most likely to be silently wrong. Derived from the plan, so
  // an inventory-plan change that dissolves the shape fails here rather than in a manifest heading.
  const g = byId.get("G04");
  assert.equal(g.falseComfort, true);
  assert.equal(g.fulfillable, false);
  const l = g.lines[0];
  assert.ok(l.warehouseShortage > 0, "the warehouse must be short");
  assert.equal(l.companyShortage, 0, "the company must NOT be short");
  assert.ok(l.mobile > 0, "the stock has to actually be somewhere -- on the trucks");
});

test("G05 is short with live inbound -- G03's shape before its receipts", () => {
  const g = byId.get("G05");
  assert.equal(g.fulfillable, false);
  const l = g.lines[0];
  assert.ok(l.warehouseShortage > 0);
  assert.ok(l.plannedInbound !== null, "G05 differs from G02 precisely by having an order out");
});

test("G02 and G05 are the same SHAPE and differ only by inbound", () => {
  // If these two ever collapse into each other the world stops distinguishing "order something"
  // from "wait", which is the pair of opposite actions the manifest's own header is about.
  const g02 = byId.get("G02").lines[0];
  const g05 = byId.get("G05").lines[0];
  assert.ok(g02.warehouseShortage > 0 && g05.warehouseShortage > 0);
  assert.equal(g02.plannedInbound, null);
  assert.notEqual(g05.plannedInbound, null);
});

// ── THE COMPARISON FAILS CLOSED ───────────────────────────────────────────────────────────────

test("diffScenario reports NO differences against a faithful read-back", () => {
  const g = byId.get("G04");
  const observed = {
    fulfillable: g.fulfillable,
    lines: g.lines.map((l) => ({
      partId: l.partId, planned: l.planned, warehouse: l.warehouse, mobile: l.mobile,
      company: l.company, warehouseShortage: l.warehouseShortage, companyShortage: l.companyShortage,
      inbound: l.plannedInbound, inboundState: l.plannedInbound === null ? "UNKNOWN" : "KNOWN",
    })),
  };
  assert.deepEqual(diffScenario(g, observed), []);
});

test("diffScenario catches the exact regression the recorder could not: stock left in the warehouse", () => {
  // G04 with the truck allocation never applied. The old recorder would have written this down and
  // called it False comfort.
  const g = byId.get("G04");
  const observed = {
    fulfillable: true,
    lines: g.lines.map((l) => ({
      partId: l.partId, planned: l.planned, warehouse: l.company, mobile: 0,
      company: l.company, warehouseShortage: 0, companyShortage: 0,
      inbound: null, inboundState: "UNKNOWN",
    })),
  };
  const differences = diffScenario(g, observed);
  assert.ok(differences.length > 0, "a regressed world must not compare clean");
  assert.ok(differences.some((d) => d.includes("warehouse")), "the warehouse figure must be named");
  assert.ok(differences.some((d) => d.includes("fulfillable")), "the verdict flip must be named");
});

test("a MISSING scenario or line is a difference, never a skip", () => {
  const g = byId.get("G01");
  assert.ok(diffScenario(g, undefined).length > 0, "an absent scenario must fail, not pass quietly");
  assert.ok(diffScenario(g, { lines: [], fulfillable: g.fulfillable }).length >= g.lines.length,
    "every expected line that is absent must be reported");
});

test("an UNEXPECTED observed line is a difference", () => {
  // Fail closed in both directions: a world with extra planned demand is as much a disagreement as
  // a world with too little.
  const g = byId.get("G01");
  const observed = {
    fulfillable: g.fulfillable,
    lines: [
      ...g.lines.map((l) => ({
        partId: l.partId, planned: l.planned, warehouse: l.warehouse, mobile: l.mobile,
        company: l.company, warehouseShortage: l.warehouseShortage, companyShortage: l.companyShortage,
        inbound: null, inboundState: "UNKNOWN",
      })),
      { partId: "CW-P-9999", planned: 1, warehouse: 0, mobile: 0, company: 0,
        warehouseShortage: 1, companyShortage: 1, inbound: null, inboundState: "UNKNOWN" },
    ],
  };
  const differences = diffScenario(g, observed);
  assert.ok(differences.some((d) => d.includes("unexpected")), "an extra line must be reported");
});

test("the expectation carries its own version, distinct from the world dataset version", () => {
  assert.match(GOLDEN_EXPECTATION_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(expectation.version, GOLDEN_EXPECTATION_VERSION);
});
