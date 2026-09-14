// CI-UNBLOCK-1899 -- the one-hop related-object join: it must RETURN what it is
// authorized to return, and it must never SILENTLY report an incomplete join as
// a proven empty result.
//
// Baseline: int/foundation-wave-1 @ 21c9ca79 (PR #1899), whose merge base with
// main is 64008d5ae0bdd9532909671b15a91122400accf1.
//
// ===================== WHAT ACTUALLY BROKE, AND WHAT DID NOT =====================
//
// Three checks in reportExecutionService.test.mjs failed on this branch:
//
//   "a related-object field IS returned, correctly joined, when both gates are
//    granted"                                          -> 'empty' !== 'results'
//   "a filter on an AUTHORIZED related-object field actually narrows"  -> 0 !== 1
//   "groupBy on an AUTHORIZED related-object field actually groups"    -> 0 !== 2
//
// The join was NOT the cause. Measured against the emulator at 21c9ca79:
//
//   reportRowScopeForCollection("locations") -> { kind: "company-neutral", ... }
//
// `locations` is COMPANY_NEUTRAL (ownershipMatrix.ts family "location", ruling
// R-15), so joinRelatedDocs()'s company-bound verification never runs for it and
// documentSatisfiesCompanyBound() is never called on that path at all. A probe
// that seeded the SAME company-less `locations/{id}` document and only added
// `operatingCompanyId` to the BASE `equipment` document returned
// `kind=results rowCount=1 rows=[{"location.name":"Main Warehouse"}]` -- the
// join was working the whole time.
//
// The cause was the BASE scan. `equipment` is the one SINGLE_COMPANY family
// those checks report on, so ENG-E's axis-2 server-side bound
// (`where("operatingCompanyId","in",reach)`) correctly excluded fixtures that
// carried no company -- which is the SAME behaviour reportRowScopeBound.test.mjs
// already pins in "a GLOBAL grant reaches both companies but still EXCLUDES
// ownerless rows". The fixtures, written before that bound existed, stated no
// company. They were corrected to state one; no assertion was changed.
//
// ===================== THE REAL DEFECT THIS FILE PINS =====================
//
// Verifying the root cause exposed a genuine one on the same path. When
// joinRelatedDocs() DOES drop a related document -- refused collection, or a
// company-bound related document outside the run's reach -- it drops it
// SILENTLY. The related field then reads `undefined` on every affected row, a
// predicate over that field excludes rows whose real joined value was never
// established, and a run that ends at zero rows is returned as `kind: "empty"`.
//
// That is a PROVEN-ABSENCE claim for an absence that was never proven: exactly
// the false-empty invariant this branch exists to enforce (RPT-FIX /
// judgeAbsenceProvenance), arriving by a different route than scan truncation.
//
// THE DROP ITSELF IS NOT WEAKENED HERE, and must not be. ENG-E's ruling stands
// in both halves -- a related document of ANOTHER company never attaches, and a
// related document carrying NO company never attaches either (a SINGLE_COMPANY
// family's `unresolvedPolicy` makes such a document out-of-model, not
// company-neutral; deciding otherwise is an ownership ruling, not a CI fix).
// What changed is that the refusal is now REPORTED instead of being dressed as
// an empty answer.
//
// ===================== WHY THE END-TO-END PROOF IS PURE HERE =====================
//
// Every relationship the catalog can actually traverse today
// (reportCatalog.ts: equipment->location, equipment->customer, contact->customer,
// location->customer, customer->contact) targets a COMPANY_NEUTRAL collection,
// and the one EXCLUDED target (customer->employee) has no `employee.*` field to
// select, so resolveDefinitionField() cannot reach it. Both join-refusal
// branches are therefore UNREACHABLE through the production catalog as it
// stands. They are pinned at the level where they ARE reachable -- the pure
// judge and the call site -- which is this service's own stated architecture
// ("every authorization/projection/limit DECISION is made by small,
// independently testable pure helper functions"), and the same technique
// reportRowScopeBound.test.mjs uses to pin the base predicate's call site.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  makeRecordingDb,
  world,
  SYNTH_ROLES,
  pinProductionActivationProject,
} from "./support/reportEngineHarness.mjs";

pinProductionActivationProject();

const { runReportDefinition, judgeAbsenceProvenance } = await import(
  "../lib/reporting/reportExecutionService.js"
);
const { documentSatisfiesCompanyBound, reportRowScopeForCollection } = await import(
  "../lib/reporting/reportRowScope.js"
);

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = readFileSync(
  join(HERE, "..", "src", "reporting", "reportExecutionService.ts"),
  "utf8",
);

const EQUIPMENT_WITH_LOCATION_DEF = {
  objectId: "equipment",
  fields: ["equipment.name", "location.name"],
};

async function run(uid, definition, options = {}, roles = SYNTH_ROLES) {
  const db = makeRecordingDb(world());
  try {
    const outcome = await runReportDefinition(
      { runnerUid: uid, definition, definitionId: "d-join" },
      { db, roles, maxScanDocs: 50, maxResultRows: 50, ...options },
    );
    return { outcome, db, error: null };
  } catch (error) {
    return { outcome: null, db, error };
  }
}

// ===========================================================================
// THE ROOT CAUSE, PINNED -- so the next reader does not re-blame the join.
// ===========================================================================

test("ROOT CAUSE: the related collection in the failing checks is COMPANY_NEUTRAL, so the join never applied a company bound to it", () => {
  assert.equal(reportRowScopeForCollection("locations").kind, "company-neutral");
  assert.equal(reportRowScopeForCollection("accounts").kind, "company-neutral");
  // ...while the BASE object those checks report on IS company-bound. That
  // asymmetry is the whole failure: the fixtures stated no company, so the base
  // scan returned nothing and the join had nothing to join to.
  const equipment = reportRowScopeForCollection("equipment");
  assert.equal(equipment.kind, "company-bound");
  assert.equal(equipment.field, "operatingCompanyId");
});

// ===========================================================================
// (A) AN AUTHORIZED RELATED FIELD IS ACTUALLY JOINED AND RETURNED.
// ===========================================================================

test("A: an authorized related-object field returns its REAL joined value, not null and not an empty result", async () => {
  const { outcome } = await run("u-taylor", EQUIPMENT_WITH_LOCATION_DEF);
  assert.equal(outcome.kind, "results");
  assert.equal(outcome.rowCount, 1);
  // world(): eq-t1 is operatingCompanyId "taylor" and locationId "loc-1";
  // locations/loc-1 is { name: "L1" } and carries NO company field.
  assert.equal(outcome.rows[0]["equipment.name"], "T1");
  assert.equal(
    outcome.rows[0]["location.name"],
    "L1",
    "a COMPANY_NEUTRAL related document must join through -- it carries no company by ruling R-15, not by omission",
  );
  assert.deepEqual(outcome.refusedJoinObjectIds, []);
  assert.deepEqual(
    outcome.incompleteJoinObjectIds,
    [],
    "a join that completed must say so; at 21c9ca79 this field did not exist, so a caller could not tell",
  );
});

// ===========================================================================
// (B) AN AUTHORIZED RELATED-FIELD FILTER ACTUALLY NARROWS A POPULATED RESULT.
// ===========================================================================

test("B: an authorized related-field filter NARROWS -- it neither drops everything nor no-ops", async () => {
  const match = await run("u-taylor", {
    ...EQUIPMENT_WITH_LOCATION_DEF,
    filters: [{ fieldId: "location.name", op: "eq", value: "L1" }],
  });
  assert.equal(match.outcome.rowCount, 1, "the matching row survives -- not a silent-exclude");
  assert.equal(match.outcome.rows[0]["location.name"], "L1");
  assert.equal(match.outcome.widened, false, "the predicate was authorized, so nothing was dropped/widened");

  // The complement, so a filter that matches EVERYTHING cannot masquerade as a
  // working one: loc-2 belongs to the Ventana row, which this runner cannot see.
  const noMatch = await run("u-taylor", {
    ...EQUIPMENT_WITH_LOCATION_DEF,
    filters: [{ fieldId: "location.name", op: "eq", value: "L2" }],
  });
  assert.equal(noMatch.outcome.rowCount, 0, "a non-matching related-field filter must exclude -- not a silent-no-op");
  assert.equal(
    noMatch.outcome.kind,
    "empty",
    "this absence IS proven: the scan completed and every referenced related document joined successfully",
  );
});

// ===========================================================================
// (C) AN INCOMPLETE JOIN IS NEVER REPORTED AS A PROVEN EMPTY RESULT.
//     Each assertion below fails against 21c9ca79.
// ===========================================================================

test("C-pure: zero rows out of an INCOMPLETE join is an UNPROVEN absence -- refused, not 'empty'", () => {
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0, joinIncomplete: true }),
    "refuse-unproven-absence",
    'at 21c9ca79 this returned "proven-absence" and the ladder turned it into kind "empty" -- ' +
      "a proven-absence claim for rows excluded on a related value that was never read",
  );
});

test("C-pure: join incompleteness does not manufacture a refusal where rows DID come back", () => {
  assert.equal(
    judgeAbsenceProvenance({ scanTruncated: false, rowCount: 3, joinIncomplete: true }),
    "not-an-absence",
    "an incomplete join is a COMPLETENESS fact, published as its own field; it is not a reason to throw away real rows",
  );
});

test("C-pure: a complete join over a complete scan is still a proven absence -- the honest 'empty' survives", () => {
  assert.equal(judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0, joinIncomplete: false }), "proven-absence");
  assert.equal(judgeAbsenceProvenance({ scanTruncated: false, rowCount: 0 }), "proven-absence");
});

test("C-wiring: the absence gate is FED by both join-refusal sources, not just scan truncation", () => {
  assert.match(
    SERVICE_SRC,
    /const joinIncomplete\s*=\s*refusedJoinObjectIds\.length > 0 \|\| incompleteJoinObjectIds\.length > 0;/,
    "both refusal routes must falsify an absence: a collection refused before the read, and a document dropped after it",
  );
  assert.match(
    SERVICE_SRC,
    /judgeAbsenceProvenance\(\{ scanTruncated, rowCount, joinIncomplete \}\)/,
    "the judge must actually receive the fact; a computed-but-unpassed flag proves nothing",
  );
  // The gate must still stand BEFORE the kind ladder, or "empty" is reachable
  // again regardless of what the judge says.
  const gate = SERVICE_SRC.indexOf("judgeAbsenceProvenance({");
  const ladder = SERVICE_SRC.indexOf("const kind: RunReportOutcomeKind");
  assert.ok(gate > 0 && ladder > gate, "the unproven-absence gate must precede the kind ladder");
});

test("C-wiring: the refusal names the unjoined object and carries no row data", async () => {
  // Reachability is pinned in the header: no catalog relationship can trigger
  // this branch today, so the MESSAGE is pinned at the source rather than by a
  // run that cannot be constructed. It must be actionable and value-free.
  const message = SERVICE_SRC.slice(
    SERVICE_SRC.indexOf("judgeAbsenceProvenance({ scanTruncated, rowCount, joinIncomplete })"),
    SERVICE_SRC.indexOf("await recordStandaloneAuditEvent", SERVICE_SRC.indexOf("const unjoined")),
  );
  assert.match(message, /did not complete/, "the audit summary must state WHY the absence is unproven");
  assert.match(SERVICE_SRC, /could not be joined for this run/, "the thrown message must be actionable");
});

// ===========================================================================
// (D) AN UNAUTHORIZED RELATED FIELD IS STILL REFUSED.
// ===========================================================================

test("D: a related field the runner may not read is DROPPED from the projection, never joined, never returned", async () => {
  // The traversal capability WITHOUT the related object's own field capability
  // (Spec sec2.5 requires BOTH).
  const traversalOnly = Object.freeze({
    synthReportRunner: Object.freeze({
      id: "synthReportRunner",
      name: "traversal only",
      description: "test-only",
      permissions: Object.freeze([
        "report.equipment.read",
        "report.equipment.field.name.read",
        "report.equipment.field.location.read",
      ]),
    }),
  });
  const { outcome, db } = await run("u-taylor", EQUIPMENT_WITH_LOCATION_DEF, {}, traversalOnly);

  assert.equal(outcome.rowCount, 1, "the BASE row is still authorized and still returned");
  assert.ok(outcome.droppedFieldIds.includes("location.name"));
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.rows[0], "location.name"),
    false,
    "an unauthorized field is ABSENT from the payload -- never blanked, never returned-then-hidden (Spec sec6)",
  );
  assert.equal(outcome.kind, "partially-authorized");
  // And the refusal is not merely cosmetic: the related document was never read.
  assert.equal(
    db.log.filter((e) => e.kind === "docGet" && e.collection === "locations").length,
    0,
    "an unauthorized related field must not even be fetched",
  );
});

// ===========================================================================
// THE CROSS-COMPANY REFUSAL IS NOT WEAKENED BY ANY OF THE ABOVE.
// ===========================================================================

test("cross-company: a related document bearing ANOTHER company is still dropped, and an ownerless one still is too", () => {
  assert.equal(documentSatisfiesCompanyBound({ operatingCompanyId: "taylor" }, "operatingCompanyId", ["taylor"]), true);
  assert.equal(
    documentSatisfiesCompanyBound({ operatingCompanyId: "ventana" }, "operatingCompanyId", ["taylor"]),
    false,
    "ENG-E's cross-company refusal is untouched by the honesty fix",
  );
  assert.equal(
    documentSatisfiesCompanyBound({}, "operatingCompanyId", ["taylor"]),
    false,
    "a company-bound family's ownerless document is out-of-model and still never attaches",
  );
  assert.equal(documentSatisfiesCompanyBound({ operatingCompanyId: "" }, "operatingCompanyId", ["taylor"]), false);
});

test("cross-company: the join still RETURNS (drops) on a failed bound -- recording it must not have become attaching it", () => {
  const drop = SERVICE_SRC.slice(
    SERVICE_SRC.indexOf('if (relatedRowScope.kind === "company-bound"'),
    SERVICE_SRC.indexOf("for (const doc of joinedDocs) {", SERVICE_SRC.indexOf("refDocs.forEach")),
  );
  assert.match(drop, /!documentSatisfiesCompanyBound\(related, relatedRowScope\.field, reach\)/);
  assert.match(drop, /incompleteObjectIds\.add\(toObjectId\);/);
  const recordAt = drop.indexOf("incompleteObjectIds.add(toObjectId);");
  const returnAt = drop.indexOf("return;", recordAt);
  const attachAt = drop.indexOf("byId.set(");
  assert.ok(returnAt > recordAt, "the drop must still short-circuit AFTER recording the incompleteness");
  assert.ok(attachAt > returnAt, "`byId.set` must remain unreachable for a related document that failed the bound");
});

test("cross-company: an ENTIRE company's base rows still never cross -- the bound the join sits inside is intact", async () => {
  const t = await run("u-taylor", EQUIPMENT_WITH_LOCATION_DEF);
  const v = await run("u-ventana", EQUIPMENT_WITH_LOCATION_DEF);
  assert.deepEqual(t.outcome.rows.map((r) => r["equipment.name"]), ["T1"]);
  assert.deepEqual(v.outcome.rows.map((r) => r["equipment.name"]), ["V1"]);
  assert.deepEqual(t.outcome.rows.map((r) => r["location.name"]), ["L1"]);
  assert.deepEqual(v.outcome.rows.map((r) => r["location.name"]), ["L2"]);
});
