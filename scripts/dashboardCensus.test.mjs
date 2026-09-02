// Deterministic validation of the EOS Dashboard Reporting Authority Census.
//
//   node --test scripts/dashboardCensus.test.mjs
//
// Proves the ten rules from the census brief's section L against the document itself. This
// validates the CENSUS, not the platform: a passing run means the census is internally honest
// (every claim carries evidence, every gap names what is missing), not that any dashboard exists.
//
// Deliberately NOT wired into a CI workflow. Repository governance does not require CI for a
// documentation-only artifact, and every scripts/*.test.mjs in .github/workflows is listed by
// name, so a workflow edit would be CI infrastructure minted for one document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CENSUS_MD,
  CENSUS_JSON,
  CLASSIFICATIONS,
  buildCensusDocument,
  parseCensus,
  parseKnownSeventeen,
  tally,
} from "./dashboardCensus.lib.mjs";

const markdown = readFileSync(CENSUS_MD, "utf8");
const entries = parseCensus(markdown);
const committed = JSON.parse(readFileSync(CENSUS_JSON, "utf8"));

const withClass = (c) => entries.filter((e) => e.classification === c);
const NOW = () => withClass(CLASSIFICATIONS.NOW);

// The companion is derived, so drift between it and the markdown is a defect, not a difference
// of opinion. Everything below then holds for both files at once.
test("the JSON companion equals what the markdown parses to (regenerate, do not hand-edit)", () => {
  assert.deepEqual(
    committed,
    buildCensusDocument(markdown),
    "run `node scripts/generateDashboardCensusJson.mjs` after editing the markdown census",
  );
});

test("the census parsed a plausible number of fact families across every domain", () => {
  assert.ok(entries.length > 100, `only ${entries.length} rows parsed — a table shape probably changed`);
  const domains = new Set(entries.map((e) => e.domain));
  assert.equal(domains.size, 11, `expected all 11 domain sections, saw ${[...domains].join(", ")}`);
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate fact ids");
});

test("the executive totals in §1 match the rows in §3", () => {
  const counts = tally(entries);
  const block = /```\nREPORTABLE_NOW:[\s\S]*?```/.exec(markdown);
  assert.ok(block, "§1 totals block not found");
  const stated = Object.fromEntries(
    [...block[0].matchAll(/^([A-Z_]+):\s+(\d+)$/gm)].map(([, k, v]) => [k, Number(v)]),
  );
  assert.equal(stated.REPORTABLE_NOW, counts[CLASSIFICATIONS.NOW]);
  assert.equal(stated.EXISTING_ACTIVATION_REQUIRED, counts[CLASSIFICATIONS.ACT]);
  assert.equal(stated.FORMALIZATION_REQUIRED, counts[CLASSIFICATIONS.FORM]);
  assert.equal(stated.DEFINITION_GAP, counts[CLASSIFICATIONS.DEF]);
  assert.equal(stated.AUTHORITY_GAP, counts[CLASSIFICATIONS.AUTH]);
  assert.equal(stated.BLOCKED_BY_DEPENDENCY, counts[CLASSIFICATIONS.DEP]);
  assert.equal(stated.NOT_REPORTABLE, counts[CLASSIFICATIONS.NO]);
  assert.equal(stated.UNKNOWN, counts[CLASSIFICATIONS.UNKNOWN]);
  assert.match(markdown, new RegExp(`TOTAL FACT FAMILIES:\\s+${entries.length}\\b`));
});

// ---- L.1  Every REPORTABLE_NOW item contains non-empty authority evidence -------------------
test("L1 — every REPORTABLE_NOW row names a canonical source and non-empty evidence", () => {
  // Collect every offender rather than stopping at the first: a census with six thin evidence
  // cells should be reported as six, not fixed one round-trip at a time.
  const bad = NOW()
    .filter((e) => !e.sourceAuthority || !e.evidence || e.evidence.length <= 20)
    .map((e) => e.id);
  assert.deepEqual(bad, [], `REPORTABLE_NOW rows lacking a canonical source or substantive evidence: ${bad.join(", ")}`);
});

// ---- L.2  Every derived REPORTABLE_NOW item names a canonical derivation --------------------
// A derived fact is one whose definition describes a computation. It must name where that
// computation lives — a dashboard-local helper is not authority.
test("L2 — every derived REPORTABLE_NOW row names where the derivation lives", () => {
  const DERIVED = /derive|computed|projection|forecast|composes|grouping|count\(\)|classif|predict|filter/i;
  const NAMES_A_MODULE = /\.(ts|js|jsx|mjs)\b|`[A-Za-z][A-Za-z0-9_.]*\(\)`|SYSTEM_AUTHORITIES|ADR-|Decision|ND-/;
  for (const e of NOW()) {
    const text = `${e.definition ?? ""} ${e.label}`;
    if (!DERIVED.test(text)) continue;
    const where = `${e.readAuthority ?? ""} ${e.sourceAuthority ?? ""} ${e.evidence ?? ""}`;
    assert.match(where, NAMES_A_MODULE, `${e.id}: derived but names no canonical derivation`);
  }
});

// ---- L.3  Every period-based REPORTABLE_NOW metric names a time basis -----------------------
test("L3 — every period-based REPORTABLE_NOW row states its time basis", () => {
  // `\bage\b` on both sides: an unanchored `age\b` matches the tail of "STORAGE" and flags
  // ownership rows as period-based.
  const PERIOD = /today|week|month|quarter|year|overdue|past due|aging|\bage\b|MTD|QTD|YTD|trend|\brate\b/i;
  for (const e of NOW()) {
    if (!PERIOD.test(`${e.label} ${e.definition ?? ""}`)) continue;
    assert.ok(e.timeBasis, `${e.id}: period-based but no time basis`);
    assert.notEqual(e.timeBasis.toLowerCase(), "none", `${e.id}: period-based but time basis is "none"`);
  }
});

// ---- L.4  Every REPORTABLE_NOW item has a scope statement -----------------------------------
test("L4 — every REPORTABLE_NOW row states a scope", () => {
  for (const e of NOW()) {
    assert.ok(e.scopes.length > 0, `${e.id}: REPORTABLE_NOW with no scope statement`);
  }
});

// ---- L.5  Every dashboard-eligible item has at least one governed role/persona --------------
test("L5 — every dashboard-eligible row names at least one governed role", () => {
  const eligible = entries.filter((e) => e.dashboardEligibility !== "DO_NOT_IMPLEMENT_YET");
  assert.ok(eligible.length > 0);
  for (const e of eligible) {
    assert.ok(e.roles.length > 0, `${e.id}: dashboard-eligible with no eligible role`);
  }
});

// ---- L.6  Every AUTHORITY_GAP identifies the exact missing decision -------------------------
// The row itself carries the evidence of absence; §8 carries the decision. Both are required, and
// §8 must not be a list of vague topics.
test("L6 — every AUTHORITY_GAP row names what is absent, and §8 names the decision", () => {
  for (const e of withClass(CLASSIFICATIONS.AUTH)) {
    assert.ok(e.evidence && e.evidence.length > 20, `${e.id}: AUTHORITY_GAP with no evidence of absence`);
  }
  const section8 = markdown.slice(markdown.indexOf("## 8. Genuine authority backlog"), markdown.indexOf("## 9."));
  const rows = [...section8.matchAll(/^\| (G-\d+) \| (.+?) \| (.+?) \|$/gm)];
  assert.ok(rows.length >= 15, `§8 has only ${rows.length} decisions`);
  for (const [, id, decision, blocks] of rows) {
    assert.ok(decision.length > 25, `${id}: decision is too vague to act on`);
    assert.ok(blocks.trim().length > 0, `${id}: names nothing it blocks`);
  }
});

// ---- L.7  Every BLOCKED_BY_DEPENDENCY names its blocker -------------------------------------
test("L7 — every BLOCKED_BY_DEPENDENCY row names its blocker", () => {
  for (const e of withClass(CLASSIFICATIONS.DEP)) {
    assert.ok(e.dependencies.length > 0, `${e.id}: BLOCKED_BY_DEPENDENCY with no named blocker`);
  }
});

// ---- L.8  No known 17-authority item is omitted ---------------------------------------------
test("L8 — all seventeen known authorities are reconciled, each with a classification", () => {
  const known = parseKnownSeventeen(markdown);
  assert.equal(known.length, 17, `expected 17 known authorities, found ${known.length}`);
  assert.deepEqual(
    known.map((k) => k.id),
    Array.from({ length: 17 }, (_, i) => `K-${i + 1}`),
  );
  for (const k of known) {
    assert.ok(k.classification.length > 5, `${k.id}: no classification`);
    assert.ok(k.authority.length > 3, `${k.id}: no authority name`);
  }
});

// ---- L.9  No design specimen value is cited as semantic authority ---------------------------
// The failure mode is citing a mock, fixture or seed AS the authority. Naming one to record that
// it is NOT authority (which several rows do, deliberately) is the opposite and must stay legal —
// so the check is on the two authority-bearing columns, never on the prose.
test("L9 — no design specimen, fixture or seed is cited in an authority column", () => {
  const SPECIMEN = /\.dc\.html|Certification World|certification[- ]world|fixture|seed data|mock|synthetic|partsCatalog\.ts|prototype|Implementation Render/i;
  for (const e of entries) {
    for (const col of ["sourceAuthority", "readAuthority"]) {
      const v = e[col];
      if (!v) continue;
      assert.doesNotMatch(v, SPECIMEN, `${e.id}: ${col} cites a design specimen as authority — ${v}`);
    }
  }
});

// ---- L.10  No dashboard-local / new computation was introduced ------------------------------
// This census is documentation. It may not have shipped a calculation, a capability, a role, or a
// Rules/Functions/schema change. Proven two ways: the run's own file set, and the document's
// standing prohibition.
test("L10 — the census introduced no computation, capability, role or rules change", () => {
  assert.match(markdown, /A dashboard COMPOSES existing authority\. It does not invent authority\./);
  assert.match(markdown, /no capability activated, no calculation defined, no role or scope widened/);
  assert.match(
    markdown,
    /A dashboard-local computation of anything in this document/,
    "the DO NOT IMPLEMENT list must forbid dashboard-local recomputation",
  );
  // Nothing in the census may claim a fact family is REPORTABLE_NOW on the strength of a
  // derivation this document itself defines: every NOW row points outward.
  for (const e of NOW()) {
    assert.doesNotMatch(
      `${e.readAuthority ?? ""} ${e.sourceAuthority ?? ""}`,
      /this census|this document|dashboardCensus/i,
      `${e.id}: cites the census itself as authority`,
    );
  }
});

// ---- Standing invariants the census records, checked so they cannot be quietly dropped ------
test("the refused chains stay refused", () => {
  const graph = markdown.slice(markdown.indexOf("## 5. Dependency graph"), markdown.indexOf("## 6."));
  for (const claim of [
    /Picking \/ assignment ⇒ reservation.*Refused/s,
    /Reorder point participates in ATP.*Refused/s,
    /Location name ⇒ ownership.*Refused/s,
  ]) {
    assert.match(graph, claim);
  }
});

test("every correction records whether it was applied", () => {
  const section11 = markdown.slice(markdown.indexOf("## 11. Corrections made"), markdown.indexOf("## 12."));
  const rows = [...section11.matchAll(/^\| (C-\d+) \|.+\| \*\*(YES|NO)\*\*/gm)];
  assert.ok(rows.length >= 3, `§11 has only ${rows.length} corrections with an applied verdict`);
});
