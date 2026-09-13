// RPT-RECON -- the AUTHORIZATION axis of the `rowCount === 0 -> "empty"` ordering.
//
// WHICH REF THIS FILE IS WRITTEN AGAINST. origin/rpt/reporting-remediation
// @ 8e28e32d31cd2e6be485010a1d827bd834316d10 (identical to the local branch
// rpt/client-outcome-honesty). It does NOT run at main
// @ 64008d5ae0bdd9532909671b15a91122400accf1: the baseline has no
// test/support/reportEngineHarness.mjs, no reportRowScope.ts, and no
// `completeness`/`companyReach`/`refusedJoinObjectIds` on RunReportOutcome. It is
// committed on ext/reporting-reconcile as a reconciliation artifact and must be
// grafted onto the remediation chain (and registered in
// .github/workflows/report-execution-service-tests.yml, one `node --test` path per
// file, per that workflow's own stated rule) to be enforced.
//
// ===================== WHAT IS ALREADY CLOSED, AND BY WHAT ==================
//
// 8e28e32d closes the TRUNCATION flavour of the false empty: judgeAbsenceProvenance()
// refuses before the ladder, `completeness` travels as an orthogonal field, and the
// client grew an `empty-unproven` display state. That is proved by
// test/reportFalseEmptyHonesty.test.mjs (17 tests), and NOTHING here re-tests it.
//
// 8e28e32d also PINS the join flavour: reportFalseEmptyHonesty.test.mjs's
// "LATENT: no catalog field exists on a join-refused object..." fails the moment an
// `employee.*` report field is declared, because a surviving filter on a field whose
// related collection has no governed company bound would evaluate against
// `undefined` and drop every row. NOTHING here re-tests that either.
//
// ===================== WHAT THIS FILE PINS INSTEAD ==========================
//
// The kind ladder's ORDERING IS BYTE-IDENTICAL AT 64008d5a AND AT 8e28e32d:
//
//     rowCount === 0 ? "empty"
//       : droppedColumnLabels.length > 0 ? "partially-authorized"
//         : truncated || widened ? "truncated-widened" : "results"
//
// and judgeAbsenceProvenance() takes exactly two inputs -- `scanTruncated` and
// `rowCount`. So COMPLETENESS is now evaluated before `rowCount === 0`, but
// AUTHORIZATION AND SCOPE STILL ARE NOT. Every authorization/tenancy fact
// (droppedColumnLabels, droppedPredicateFieldIds, refusedJoinObjectIds,
// rowScopeKind, companyReach) is either ranked BELOW the zero-row branch or not
// ranked at all.
//
// The reachable consequence, recorded from a real run on 8e28e32d (see the lane
// verdict docs/reporting/FALSE-EMPTY-RECONCILIATION.md): a run whose saved report
// was NARROWED by authorization -- a column the runner may not read was dropped --
// and which then matched no rows returns
//
//     { kind: "empty", droppedColumnLabels: ["Status"], completeness: "proven-complete" }
//
// and the client's `empty` branch renders, verbatim and with notes: [],
// "This report ran successfully but no records matched."
//
// This is NOT the false-claim-about-DATA: with zero rows the absence itself is real.
// It is the single-winner collapse on the authorization axis -- the reader is never
// told the report that ran was not the report that was saved. It is reachable in the
// PRODUCTION-ACTIVATED configuration (the 25 adopted report.* ids include the four
// object reads but exclude ten sensitive field reads), and no test on the chain
// covers it.
//
// HOW TO READ THE RESULT. Test 1 is CHARACTERIZING: it asserts the CURRENT,
// UNFIXED behaviour so the eventual fixer has a recorded starting point. It is
// EXPECTED TO FAIL when the ordering is fixed, and the fixer should replace it with
// the inverted assertion rather than delete it silently. Tests 2 and 3 are
// TRIPWIRES in the style of reportFalseEmptyHonesty.test.mjs's own LATENT test:
// they pass today and fail when the defect class becomes reachable.
//
// No emulator. Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeRecordingDb,
  world,
  SYNTH_ROLES_NO_STATUS,
  pinProductionActivationProject,
} from "./support/reportEngineHarness.mjs";

pinProductionActivationProject();

const { runReportDefinition, judgeAbsenceProvenance } = await import(
  "../lib/reporting/reportExecutionService.js"
);
const { REPORT_RELATIONSHIPS, getReportObject, getReportField } = await import(
  "../lib/reporting/reportCatalog.js"
);
// The CLIENT half, imported by relative path from this same checkout -- exactly as
// test/reportCatalogParity.test.mjs already imports the client's reportCatalog.js.
// The server's honesty is only worth what the reader is actually shown.
const { describeRunOutcome } = await import(
  "../../field-ops-app-vite/src/domain/reporting/reportResultState.js"
);

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = join(HERE, "..", "src", "reporting", "reportExecutionService.ts");

// A saved report that (a) selects a column this runner may NOT read, so
// authorization NARROWS it, and (b) filters on a column the runner MAY read to a
// value no document carries, so the absence is genuine and the scan is complete.
// The filter must be on an AUTHORIZED field: a filter on an unauthorized one is
// DROPPED (ADR-007 sec2.4) and would WIDEN the run instead.
const NARROWED_AND_EMPTY_DEF = Object.freeze({
  objectId: "equipment",
  fields: ["equipment.name", "equipment.status"],
  filters: [{ fieldId: "equipment.name", op: "eq", value: "NO-SUCH-EQUIPMENT" }],
});

async function run(uid, definition, roles, options = {}) {
  const db = makeRecordingDb(world({ taylorRows: 4 }));
  const outcome = await runReportDefinition(
    { runnerUid: uid, definition, definitionId: "d-recon" },
    { db, roles, maxScanDocs: 50, maxResultRows: 50, ...options },
  );
  return { outcome, db };
}

// ===========================================================================
// 1. CHARACTERIZATION -- the current, UNFIXED behaviour. Expected to FAIL once
//    the ordering is fixed. Do not "repair" it by relaxing the assertion.
// ===========================================================================

test("CHARACTERIZING (unfixed): an AUTHORIZATION-NARROWED zero-row run is still headlined \"empty\", and the reader is told nothing", async () => {
  const { outcome } = await run("u-taylor", NARROWED_AND_EMPTY_DEF, SYNTH_ROLES_NO_STATUS);

  // The narrowing really happened.
  assert.deepEqual(outcome.droppedColumnLabels, ["Status"], "a column was dropped on authorization grounds");
  assert.deepEqual(outcome.droppedFieldIds, ["equipment.status"]);
  // The absence is genuine and the population was NOT cut, so 8e28e32d's
  // completeness gate correctly does not fire. This is the authorization axis, not
  // the truncation axis.
  assert.equal(outcome.rowCount, 0);
  assert.equal(outcome.scanTruncated, false);
  assert.equal(outcome.truncated, false);
  assert.equal(outcome.completeness, "proven-complete");
  assert.equal(outcome.widened, false, "no predicate was dropped -- the run was not widened");

  // THE DEFECT. `rowCount === 0` still out-ranks `droppedColumnLabels.length > 0`.
  assert.equal(
    outcome.kind,
    "empty",
    'FIX LANDED? If this now reads "partially-authorized", the ordering was fixed: invert this ' +
      "assertion and delete the characterization note above.",
  );

  // And the fact survives only as a FIELD the client's `empty` branch never reads.
  const shown = describeRunOutcome(outcome);
  assert.equal(shown.kind, "empty");
  assert.equal(shown.message, "This report ran successfully but no records matched.");
  assert.deepEqual(
    shown.notes,
    [],
    "the reader is given no note at all: not that a column was dropped, not that the answer is " +
      "bounded to their own operating company",
  );
});

test("CHARACTERIZING (unfixed): the tenancy bound is equally invisible on the same outcome", async () => {
  const { outcome } = await run("u-taylor", NARROWED_AND_EMPTY_DEF, SYNTH_ROLES_NO_STATUS);
  // ENG-E narrowed the POPULATION to one operating company server-side. "No records
  // matched" is therefore a claim about `taylor` only, and the outcome says so --
  // but only in fields the `empty` display branch does not consult.
  assert.equal(outcome.rowScopeKind, "company-bound");
  assert.deepEqual(outcome.companyReach, ["taylor"]);
  assert.equal(describeRunOutcome(outcome).notes.length, 0);
});

// ===========================================================================
// 2. THE JUDGE IS COMPLETENESS-ONLY -- stated as a property, not inferred.
// ===========================================================================

test("judgeAbsenceProvenance() is a COMPLETENESS judge: no authorization or tenancy fact can change its verdict", () => {
  // Same two inputs, every authorization/tenancy fact varied around them. The
  // verdict is invariant, which is the precise sense in which the ordering defect
  // is unaddressed on the authorization axis.
  for (const extra of [
    {},
    { droppedColumnLabels: ["Status"], droppedPredicateFieldIds: ["equipment.status"] },
    { refusedJoinObjectIds: ["employee"], rowScopeKind: "company-bound", companyReach: ["taylor"] },
  ]) {
    assert.equal(
      judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0, ...extra }),
      "proven-absence",
      "an authorization-narrowed zero-row run is still judged a PROVEN absence",
    );
  }
});

test("RATCHET: the absence gate is passed only the completeness pair, and the ladder still ranks rowCount first", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  // The gate's call site, verbatim. If a future fix widens it, this fails and the
  // characterization above must be re-derived.
  assert.match(
    src,
    /judgeAbsenceProvenance\(\{\s*scanTruncated,\s*rowCount\s*\}\)/,
    "the gate's argument list changed -- re-derive this file",
  );
  const ladderAt = src.indexOf("const kind: RunReportOutcomeKind =");
  assert.ok(ladderAt > 0);
  const ladder = src.slice(ladderAt, ladderAt + 400);
  assert.match(ladder, /rowCount === 0\s*\?\s*"empty"/, "rowCount is still the ladder's first test");
  const zeroAt = ladder.indexOf("rowCount === 0");
  const droppedAt = ladder.indexOf("droppedColumnLabels.length > 0");
  assert.ok(droppedAt > zeroAt, "the authorization branch still sits BELOW the zero-row branch");
});

// ===========================================================================
// 3. TRIPWIRE -- the UNRECORDED join skips, which
//    reportFalseEmptyHonesty.test.mjs's LATENT test does not cover.
//
//    joinRelatedDocs() records a refusal in `refusedJoinObjectIds` ONLY for a
//    related collection whose row scope is `unsupported`. Three earlier `continue`
//    statements -- a missing relationship, a related OBJECT with a null
//    `collection` (REPORT_OBJECTS declares one today: `serviceHistory`), and a
//    via-field absent from REPORT_FIELDS -- skip the join and record NOTHING. A
//    surviving filter on such a related field would then evaluate against
//    `undefined`, drop every row, and produce a zero-row run carrying no trace of
//    the skip at all: strictly worse than the refusal flavour that IS pinned.
//
//    Unreachable today, and this is what keeps it so.
// ===========================================================================

test("TRIPWIRE: every relationship target has a backing collection and a declared via-field, so no join can be skipped without being recorded", () => {
  for (const rel of REPORT_RELATIONSHIPS) {
    const toObject = getReportObject(rel.toObjectId);
    assert.ok(toObject, `relationship ${rel.relationshipId} points at an unknown object`);
    assert.ok(
      typeof toObject.collection === "string" && toObject.collection.length > 0,
      `relationship ${rel.relationshipId} targets "${rel.toObjectId}", which declares NO backing ` +
        "collection. joinRelatedDocs() `continue`s on `!toObject?.collection` BEFORE it can record " +
        "a refusal, so a filter on one of its fields would silently drop every row and the outcome " +
        "would not even list it in refusedJoinObjectIds. Decide the outcome (drop the predicate per " +
        "ADR-007 sec2.4, or record and judge the skip) before shipping it.",
    );
    assert.ok(
      getReportField(rel.viaField),
      `relationship ${rel.relationshipId} traverses via "${rel.viaField}", which is not a declared ` +
        "REPORT_FIELD. joinRelatedDocs() `continue`s on `!viaField` without recording, with the same " +
        "silent-narrowing consequence.",
    );
  }
});
