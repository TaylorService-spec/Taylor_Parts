// RPT-FIX -- the FALSE-EMPTY correctness defect in trusted report execution.
//
// Baseline: branch post/eng-e-report-scope @ 92db1d19, whose parent is main
// @ 64008d5ae0bdd9532909671b15a91122400accf1 (ATLAS-BASE-2026-09-12-A). These
// tests are written against ENG-E's unmerged row-scope work deliberately: it is
// the only other change to reportExecutionService.ts and rebuilding from bare
// main would conflict with it.
//
// ===================== THE DEFECT, AS RECORDED HERE =====================
//
// The engine loads an UNORDERED, BOUNDED page (MAX_SCAN_DOCS = 20,000; after
// ENG-E, bounded by a server-side operating-company predicate as well), and then
// applies the definition's filters IN MEMORY over that page. Matching documents
// may exist BEYOND the page. When none of the loaded documents match, rowCount
// is 0, and the kind ladder's FIRST branch maps rowCount === 0 to "empty" --
// ahead of every other fact, truncation included. The caller receives a false
// negative dressed as a successful, complete answer, and the client compounds it:
// reportResultState.js's "empty" branch reads no truncation flag and renders
// "This report ran successfully but no records matched."
//
// Recorded at this baseline, before the fix (repro in the lane verdict):
//
//   world: 4 taylor equipment docs, only eq-t4 status "retired"
//   definition: equipment WHERE status eq "retired", maxScanDocs 2
//   -> { kind: "empty", rowCount: 0, truncated: true }
//      query equipment predicates=[operatingCompanyId == taylor] limit=3
//      audit: outcome "applied", truncated true
//
// eq-t4 EXISTS and MATCHES. The answer "no records matched" is false.
//
// THE INVARIANT: EOS MUST NOT RETURN "EMPTY" WHEN THE QUERY WAS NOT PROVEN
// COMPLETE.
//
// ===================== WHY A REFUSAL, NOT A NEW KIND =====================
//
// The engine already refuses rather than understate an aggregate, on precisely
// this reasoning: census X-9 (BINDING) and the FIN-004 precedent it cites, wired
// as judgeScanCompleteness()/IncompleteAggregateScanError. An unproven absence is
// the same sentence's other half -- "0 rows" is an aggregate claim about the
// whole population, and bounding it produces a figure smaller than the truth
// while still labelled as the answer. So this follows the established outcome
// vocabulary (refuse) instead of inventing a new one.
//
// A refusal is also structurally immune to the failure that caused this defect.
// The kind ladder is a SINGLE-WINNER ranking, and it has already produced one
// documented collapse (X-9's own note: an understated total could arrive labelled
// "empty" or "partially-authorized", never "incomplete"). Adding a
// "cannot-establish" KIND would put completeness back into that same ranking
// contest, where it would have to out-rank "partially-authorized" to be seen. A
// throw cannot be out-ranked by anything.
//
// Completeness is ADDITIONALLY exposed as an ORTHOGONAL AXIS -- `completeness`
// and `scanTruncated` on every outcome -- so no consumer ever has to read it out
// of `kind`. That is the same shape ENG-E chose for the tenancy axis
// (companyReach/rowScopeKind/companyBoundRefusal travel as fields; only the
// refusal itself is a kind), and the closed RunReportOutcomeKind set is
// deliberately UNCHANGED by this fix.
//
// NO EMULATOR REQUIRED, and none is available here: the Firestore emulator needs
// a JRE and port 8080 is held by an unrelated process. reportExecutionService.
// test.mjs and savedDefinitionCommands.test.mjs DO need it, were not run, and are
// recorded UNPROVEN in the lane verdict.
//
// Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeRecordingDb,
  queriesOf,
  world,
  SYNTH_ROLES,
  SYNTH_ROLES_NO_STATUS,
  EQUIPMENT_DEF,
  EQUIPMENT_RETIRED_DEF,
  EQUIPMENT_RETIRED_GROUPED_DEF,
  pinProductionActivationProject,
} from "./support/reportEngineHarness.mjs";

pinProductionActivationProject();

const {
  runReportDefinition,
  judgeAbsenceProvenance,
  UnprovenAbsenceError,
  judgeScanCompleteness,
} = await import("../lib/reporting/reportExecutionService.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = join(HERE, "..", "src", "reporting", "reportExecutionService.ts");
const CALLABLE_SRC = join(HERE, "..", "src", "reporting", "runReportDefinitionCallable.ts");

async function run(uid, definition, options = {}, roles = SYNTH_ROLES) {
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  try {
    const outcome = await runReportDefinition(
      { runnerUid: uid, definition, definitionId: "d-test" },
      { db, roles, maxScanDocs: 50, maxResultRows: 50, ...options },
    );
    return { outcome, db, error: null };
  } catch (error) {
    return { outcome: null, db, error };
  }
}

// ===========================================================================
// THE RULE ITSELF -- pure, per this file's stated architecture ("every
// authorization/projection/limit DECISION is made by small, independently
// testable pure helper functions").
// ===========================================================================

test("PURE: zero rows out of a TRUNCATED scan is an UNPROVEN absence -- refused", () => {
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: true, rowCount: 0 }),
    "refuse-unproven-absence",
  );
});

test("PURE: zero rows out of a COMPLETE scan is a proven absence -- still 'empty'", () => {
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0 }),
    "proven-absence",
  );
});

test("PURE: a truncated scan that DID return rows is a bounded page, not an absence", () => {
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: true, rowCount: 3 }),
    "not-an-absence",
  );
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: false, rowCount: 3 }),
    "not-an-absence",
  );
});

test("PURE: only SCAN truncation can falsify an absence -- the row cap and group cap cannot", () => {
  // rowCapTruncated/groupCardinalityTruncated require MORE rows than the cap, so
  // they can never coexist with rowCount 0. The judge takes scanTruncated alone
  // for that reason, and this pins the reasoning rather than leaving it in a
  // comment. It is the same argument judgeScanCompleteness() already makes.
  assert.equal(judgeScanCompleteness({ scanTruncated: false, hasAggregates: true }), "complete");
  assert.equal(judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0 }), "proven-absence");
});

// ===========================================================================
// THE REPRODUCTION -- end to end, on the query the engine actually issued.
// ===========================================================================

test("REPRODUCTION: a bounded page that matched nothing is REFUSED, never returned as 'empty'", async () => {
  const { outcome, db, error } = await run("u-taylor", EQUIPMENT_RETIRED_DEF, { maxScanDocs: 2 });

  // The page really was cut, and the matching document really is outside it.
  const queries = queriesOf(db, "equipment");
  assert.equal(queries.length, 1, "exactly one scan of the reported collection");
  assert.deepEqual(queries[0].predicates, [
    { field: "operatingCompanyId", op: "==", value: "taylor" },
  ]);
  assert.equal(queries[0].limit, 3, "maxScanDocs + 1, so truncation is detectable");

  assert.equal(
    outcome,
    null,
    'at 92db1d19 this returned { kind: "empty", rowCount: 0, truncated: true } -- ' +
      "a false negative presented as a complete answer",
  );
  assert.ok(
    error instanceof UnprovenAbsenceError,
    `expected UnprovenAbsenceError, got ${error && error.constructor.name}`,
  );
  // Actionable, and carries NO row data, NO filter value, NO field content.
  assert.match(error.message, /equipment/);
  assert.ok(!/retired/.test(error.message), "the refusal never echoes a filter value");
});

test("REPRODUCTION: the grouped, aggregate-free path false-empties too and is refused", async () => {
  // judgeScanCompleteness() only refuses when hasAggregates -- a groupBy with no
  // aggregate is "bounded-page", so before this fix a truncated grouped run with
  // no surviving group also arrived as kind "empty".
  const { outcome, error } = await run("u-taylor", EQUIPMENT_RETIRED_GROUPED_DEF, { maxScanDocs: 2 });
  assert.equal(outcome, null, 'at 92db1d19 this returned kind "empty" with zero groups');
  assert.ok(error instanceof UnprovenAbsenceError, `got ${error && error.constructor.name}`);
});

test("the refusal is AUDITED as denied, on the INJECTED db, with the truncation fact and no row data", async () => {
  const { db, error } = await run("u-taylor", EQUIPMENT_RETIRED_DEF, { maxScanDocs: 2 });
  assert.ok(error instanceof UnprovenAbsenceError);
  assert.equal(db.auditWrites.length, 1, "exactly one Audit Event per run (D-AUDIT)");
  const ev = db.auditWrites[0];
  assert.equal(ev.outcome, "denied", 'never "applied" -- the run produced no answer');
  assert.equal(ev.action, "runReportDefinition");
  assert.equal(ev.truncated, true, "the truncation fact is recorded, not swallowed");
  assert.equal(ev.objectId, "equipment");
  assert.ok(!/retired/.test(String(ev.summary)), "the summary never interpolates a filter value");
  assert.ok(!/T1|T4|ORPHAN/.test(String(ev.summary)), "the summary never carries row data");
});

test("CONTROL: a PROVEN-COMPLETE zero-row run is still 'empty' -- the fix does not refuse real absences", async () => {
  // The Ventana runner's single row is "active", so "retired" genuinely matches
  // nothing, and the scan was NOT cut. This absence IS proven.
  const { outcome, error } = await run("u-ventana", EQUIPMENT_RETIRED_DEF, { maxScanDocs: 50 });
  assert.equal(error, null, "a proven absence must not be refused");
  assert.equal(outcome.kind, "empty");
  assert.equal(outcome.rowCount, 0);
  assert.equal(outcome.truncated, false);
  assert.equal(outcome.scanTruncated, false);
  assert.equal(outcome.completeness, "proven-complete");
});

test("CONTROL: a truncated page that DID match rows still returns them, and says it is a page", async () => {
  const { outcome, error } = await run("u-taylor", EQUIPMENT_DEF, { maxScanDocs: 2 });
  assert.equal(error, null, "a bounded LIST may page and say so -- X-9 permits exactly this");
  assert.equal(outcome.rowCount, 2);
  assert.equal(outcome.truncated, true);
  assert.equal(outcome.scanTruncated, true);
  assert.equal(outcome.completeness, "bounded-page");
});

// ===========================================================================
// THE ORTHOGONAL AXIS -- and how it composes with ENG-E's tenancy axis.
// ===========================================================================

test("completeness is NOT a kind: the closed RunReportOutcomeKind set is unchanged by this fix", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const block = src.slice(
    src.indexOf("export type RunReportOutcomeKind"),
    src.indexOf("export interface RunReportOutcome"),
  );
  const kinds = [...block.matchAll(/\|\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    kinds.sort(),
    [
      "company-unresolved",
      "empty",
      "partially-authorized",
      "permission-denied",
      "results",
      "truncated-widened",
    ].sort(),
    "no completeness kind was added -- the client's SERVICE_KINDS gains nothing from this fix " +
      "beyond ENG-E's company-unresolved",
  );
});

test("every returned outcome carries the completeness axis as FIELDS", async () => {
  const cases = [
    ["results", await run("u-taylor", EQUIPMENT_DEF, { maxScanDocs: 50 })],
    ["empty", await run("u-ventana", EQUIPMENT_RETIRED_DEF, { maxScanDocs: 50 })],
    ["permission-denied", await run("u-none", EQUIPMENT_DEF)],
    ["company-unresolved", await run("u-location", EQUIPMENT_DEF)],
  ];
  for (const [label, { outcome, error }] of cases) {
    assert.equal(error, null, `${label} must not throw`);
    assert.ok(
      ["proven-complete", "bounded-page", "not-attempted"].includes(outcome.completeness),
      `${label}: completeness missing or invalid (${outcome.completeness})`,
    );
    assert.equal(typeof outcome.scanTruncated, "boolean", `${label}: scanTruncated missing`);
  }
});

test("COMPOSITION with company-unresolved: the tenancy kind and the completeness axis do not overwrite each other", async () => {
  const { outcome, db, error } = await run("u-location", EQUIPMENT_DEF);
  assert.equal(error, null);
  // ENG-E's tenancy facts, unchanged.
  assert.equal(outcome.kind, "company-unresolved");
  assert.equal(outcome.rowScopeKind, "unresolved");
  assert.ok(typeof outcome.companyBoundRefusal === "string" && outcome.companyBoundRefusal.length > 0);
  // The completeness fact, stated rather than implied.
  assert.equal(
    outcome.completeness,
    "not-attempted",
    'a refused-on-tenancy run must NOT read as "proven-complete" -- nothing was scanned, ' +
      "so completeness is inapplicable, not true",
  );
  // And "not-attempted" is an observation, not a guess: no query of the reported
  // collection was issued at all.
  assert.equal(queriesOf(db, "equipment").length, 0, "the reported collection is never read");
  assert.equal(outcome.scanTruncated, false);
});

test("COMPOSITION: a run that is BOTH partially-authorized AND a bounded page reports BOTH facts", async () => {
  // The ladder is single-winner and names "partially-authorized" here. Every
  // other fact must still be readable as a field -- this is the collapse that
  // caused the defect in the first place, pinned so it cannot come back.
  const { outcome, error } = await run("u-taylor", EQUIPMENT_DEF, { maxScanDocs: 2 }, SYNTH_ROLES_NO_STATUS);
  assert.equal(error, null);
  assert.equal(outcome.kind, "partially-authorized", "the ladder names one reason");
  assert.deepEqual(outcome.droppedColumnLabels, ["Status"], "fact 1: a column was dropped");
  assert.equal(outcome.truncated, true, "fact 2: the result is a page");
  assert.equal(outcome.scanTruncated, true, "fact 2b: and the POPULATION itself was cut");
  assert.equal(outcome.completeness, "bounded-page", "fact 2c: stated on its own axis");
  assert.deepEqual(outcome.companyReach, ["taylor"], "fact 3: the tenancy bound applied");
  assert.equal(outcome.rowScopeKind, "company-bound");
});

// ===========================================================================
// RATCHETS -- structural, so a regression cannot pass by accident.
// ===========================================================================

test("RATCHET: the absence gate stands BEFORE the kind ladder and before the 'applied' Audit Event", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const gate = src.indexOf("judgeAbsenceProvenance({");
  const appliedAudit = src.indexOf('outcome: "applied"');
  const ladder = src.indexOf("const kind: RunReportOutcomeKind =");
  assert.ok(gate > 0, "judgeAbsenceProvenance() is not called by runReportDefinition()");
  assert.ok(appliedAudit > 0 && ladder > 0);
  assert.ok(
    gate < appliedAudit,
    "an unproven absence must be refused BEFORE a run is audited as applied",
  );
  assert.ok(gate < ladder, 'the gate must precede the rowCount === 0 -> "empty" branch');
});

test("RATCHET: the callable maps the refusal to resource-exhausted, exactly as the aggregate refusal is", () => {
  const src = readFileSync(CALLABLE_SRC, "utf8");
  assert.match(src, /UnprovenAbsenceError/, "the callable does not import/handle the refusal");
  const idx = src.indexOf("err instanceof UnprovenAbsenceError");
  assert.ok(idx > 0);
  const branch = src.slice(idx, idx + 400);
  assert.match(
    branch,
    /HttpsError\("resource-exhausted"/,
    "must NOT fall through to the generic internal branch, which the client maps to " +
      '"unavailable -- nothing was read"',
  );
});

test("RATCHET: the 'empty' branch of the kind ladder is unreachable unless absence was proven", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const ladderAt = src.indexOf("const kind: RunReportOutcomeKind =");
  const ladder = src.slice(ladderAt, ladderAt + 400);
  assert.match(ladder, /rowCount === 0\s*\?\s*"empty"/, "ladder shape changed; re-derive this test");
  // The only way rowCount can be 0 here is a proven absence, because the gate
  // above threw otherwise. Assert the gate is the LAST thing between them --
  // i.e. nothing reassigns scanTruncated or rowCount in between.
  const between = src.slice(src.indexOf("judgeAbsenceProvenance({"), ladderAt);
  assert.ok(
    !/\browCount\s*=[^=]/.test(between) && !/\bscanTruncated\s*=[^=]/.test(between),
    "rowCount/scanTruncated must not be reassigned between the gate and the ladder",
  );
});

// ===========================================================================
// THE SECOND, LATENT FALSE-EMPTY FLAVOUR -- reported, and pinned unreachable.
// ===========================================================================

test("LATENT: no catalog field exists on a join-refused object, so a refused join cannot manufacture an absence YET", () => {
  // joinRelatedDocs() refuses to read a related collection with no governed
  // company bound and records it in refusedJoinObjectIds. A SURVIVING filter on
  // such a field would then evaluate against `undefined` and drop every row --
  // a false empty produced by a refusal rather than by truncation, and one the
  // predicate-drop rule does not catch (the field is AUTHORIZED; its collection
  // is what is unbounded).
  //
  // That path is unreachable today: `employee` is the only related object whose
  // collection has no governed bound, and REPORT_FIELDS declares no employee.*
  // field, so no definition can reference one. This test FAILS the moment that
  // stops being true, which is the point -- it forces the decision (drop the
  // predicate, per ADR-007 sec2.4, or extend the absence judge) instead of
  // shipping a second false-empty silently.
  const catalog = readFileSync(join(HERE, "..", "src", "reporting", "reportCatalog.ts"), "utf8");
  const fieldObjectIds = new Set([...catalog.matchAll(/^\s*f\("([a-zA-Z]+)"/gm)].map((m) => m[1]));
  assert.ok(
    !fieldObjectIds.has("employee"),
    "an employee.* report field now exists: a filter on it survives authorization but its " +
      "collection has no governed company bound, so the join is refused and the filter drops " +
      "every row. Decide the outcome before shipping it.",
  );
});
