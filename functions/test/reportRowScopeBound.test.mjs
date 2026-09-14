// ENG-E -- the operating-company reach and ROW-LEVEL bound for trusted report
// execution. Against main @ 64008d5ae0bdd9532909671b15a91122400accf1.
//
// ================== WHAT THESE TESTS ASSERT ON, AND WHY ==================
//
// THE QUERY ACTUALLY ISSUED, not the rows returned.
//
// That is the whole point and it is not a stylistic preference. Firestore applies
// the scan cap (`limit`) BEFORE any in-memory pass. So an in-memory post-filter
// would satisfy a row-count assertion -- "a Ventana runner saw only Ventana
// rows" -- while leaving the defect completely intact: with 20,000 Taylor
// documents ahead of them in the unfiltered page, the Ventana runner's own rows
// would never be INSIDE the page at all, and the report would be silently wrong
// rather than bounded. A row-count test would go green on that. Recording the
// predicate is the difference between proving the fix and laundering it.
//
// The double below therefore logs every query with its predicate list and every
// document read, in order, and models Firestore's ordering (predicates first,
// limit second) so a "bounded" claim can be distinguished from a filtered one.
//
// NO EMULATOR REQUIRED, and none is available in this environment: the Firestore
// emulator needs a JRE and port 8080 is held by an unrelated process.
// reportExecutionService.test.mjs (which DOES need the emulator) is not run here
// and its coverage is recorded UNPROVEN in the ENG-E lane verdict.
//
// Prerequisite: `npm run build` in functions/ first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runReportDefinition } from "../lib/reporting/reportExecutionService.js";
import {
  reportRowScopeForCollection,
  companyFieldForFamily,
  documentSatisfiesCompanyBound,
  resolveCompanyReach,
  operatingCompanyScope,
  GOVERNED_OPERATING_COMPANY_IDS,
  MAX_IN_FILTER_VALUES,
} from "../lib/reporting/reportRowScope.js";
import { OWNERSHIP_MATRIX } from "../lib/ownership/ownershipMatrix.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = join(HERE, "..", "src", "reporting", "reportExecutionService.ts");
const ROWSCOPE_SRC = join(HERE, "..", "src", "reporting", "reportRowScope.ts");

// ---------------------------------------------------------------------------
// The recording Firestore double
// ---------------------------------------------------------------------------

const AUDIT_COLLECTIONS = new Set(["auditEvents", undefined, "undefined"]);

function atPath(row, path) {
  return String(path)
    .split(".")
    .reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), row);
}

function makeRecordingDb(world) {
  const log = [];
  const mkQuery = (collection, predicates, limit) => ({
    where(field, op, value) {
      return mkQuery(collection, [...predicates, { field, op, value }], limit);
    },
    limit(n) {
      return mkQuery(collection, predicates, n);
    },
    async get() {
      log.push({ kind: "query", collection, predicates: [...predicates], limit });
      let rows = Object.entries(world[collection] ?? {}).map(([id, d]) => ({ id, ...d }));
      // Firestore order: SERVER-SIDE predicates first, THEN the limit. Modelling
      // this is what makes the difference between a real bound and an in-memory
      // post-filter observable in a test.
      for (const p of predicates) {
        rows = rows.filter((r) => {
          const v = atPath(r, p.field);
          if (p.op === "==") return v === p.value;
          if (p.op === "in") return Array.isArray(p.value) && p.value.includes(v);
          throw new Error(`the double does not model operator ${p.op}`);
        });
      }
      const capped = typeof limit === "number" ? rows.slice(0, limit) : rows;
      return {
        size: capped.length,
        docs: capped.map((r) => ({
          id: r.id,
          exists: true,
          data: () => {
            const { id, ...rest } = r;
            return rest;
          },
        })),
      };
    },
    doc(id) {
      const docId = id ?? `auto-${log.length}`;
      return {
        id: docId,
        path: `${collection}/${docId}`,
        collection: { id: collection },
        async get() {
          log.push({ kind: "docGet", collection, docId });
          const d = (world[collection] ?? {})[docId];
          return { id: docId, exists: d !== undefined, data: () => d };
        },
      };
    },
  });
  return {
    log,
    collection(name) {
      return mkQuery(name, [], undefined);
    },
    batch() {
      return { set() {}, create() {}, update() {}, delete() {}, async commit() {} };
    },
  };
}

/** Every read the run issued against a REPORTED collection (audit writes excluded). */
function readsOf(db, collection) {
  return db.log.filter((e) => e.collection === collection && !AUDIT_COLLECTIONS.has(e.collection));
}
function queriesOf(db, collection) {
  return db.log.filter((e) => e.kind === "query" && e.collection === collection);
}
function docGetsOf(db, collection) {
  return db.log.filter((e) => e.kind === "docGet" && e.collection === collection);
}

// ---------------------------------------------------------------------------
// The synthetic world
// ---------------------------------------------------------------------------

// Exactly the 25 ids config/environments.json activates on
// taylor-parts-production, so the ALLOW paths below are exercised against the
// real production activation posture rather than a convenient invention.
const PRODUCTION_ACTIVATED_REPORT_CAPS = Object.freeze([
  "report.customer.read",
  "report.contact.read",
  "report.location.read",
  "report.equipment.read",
  "report.definition.read",
  "report.customer.field.name.read",
  "report.customer.field.status.read",
  "report.customer.field.relationshipTypes.read",
  "report.customer.field.tags.read",
  "report.customer.field.createdAt.read",
  "report.customer.field.commercialProfile.read",
  "report.customer.field.billingContact.read",
  "report.contact.field.name.read",
  "report.contact.field.role.read",
  "report.contact.field.customer.read",
  "report.location.field.name.read",
  "report.location.field.address.read",
  "report.location.field.customer.read",
  "report.equipment.field.name.read",
  "report.equipment.field.status.read",
  "report.equipment.field.identity.read",
  "report.equipment.field.dates.read",
  "report.equipment.field.customer.read",
  "report.equipment.field.location.read",
  "report.equipment.field.createdAt.read",
]);

// Test-only Role map. The real catalogs are frozen and must not be mutated; this
// is the `roles` seam reportExecutionService already exposes for exactly this.
const SYNTH_ROLES = Object.freeze({
  synthReportRunner: Object.freeze({
    id: "synthReportRunner",
    name: "Synthetic report runner",
    description: "test-only",
    permissions: Object.freeze([...PRODUCTION_ACTIVATED_REPORT_CAPS]),
  }),
});
const ACTIVATION = new Set(PRODUCTION_ACTIVATED_REPORT_CAPS);

function assignment(id, principalUid, scope) {
  return {
    id,
    principalUid,
    roleId: "synthReportRunner",
    scope,
    status: "active",
    accessVersionAtGrant: 3,
    grantedBy: "test",
  };
}

function world() {
  return {
    users: {
      "u-global": { accessVersion: 3 },
      "u-taylor": { accessVersion: 3 },
      "u-ventana": { accessVersion: 3 },
      "u-location": { accessVersion: 3 },
      "u-none": { accessVersion: 3 },
    },
    roleAssignments: {
      "ra-global": assignment("ra-global", "u-global", { type: "global" }),
      "ra-taylor": assignment("ra-taylor", "u-taylor", { type: "operatingCompany", value: "taylor" }),
      "ra-ventana": assignment("ra-ventana", "u-ventana", { type: "operatingCompany", value: "ventana" }),
      // A REAL grant that binds to no governed operating company. This is the
      // case that must NOT read as permission-denied.
      "ra-location": assignment("ra-location", "u-location", { type: "location", value: "phx-1" }),
    },
    equipment: {
      "eq-t1": { name: "T1", status: "active", operatingCompanyId: "taylor", accountId: "acc-1", locationId: "loc-1" },
      "eq-v1": { name: "V1", status: "active", operatingCompanyId: "ventana", accountId: "acc-2", locationId: "loc-2" },
      // Carries NO operating company. The predicate-free scan returned it to
      // everyone; a bounded scan cannot see it at all.
      "eq-orphan": { name: "ORPHAN", status: "active", accountId: "acc-3", locationId: "loc-3" },
    },
    accounts: { "acc-1": { name: "A1" }, "acc-2": { name: "A2" }, "acc-3": { name: "A3" } },
    locations: { "loc-1": { name: "L1" }, "loc-2": { name: "L2" }, "loc-3": { name: "L3" } },
    contacts: { "c-1": { name: "C1", role: "buyer", accountId: "acc-1" } },
  };
}

const EQUIPMENT_DEF = {
  objectId: "equipment",
  fields: ["equipment.name", "equipment.status", "equipment.locationId"],
};
const EQUIPMENT_JOIN_DEF = {
  objectId: "equipment",
  fields: ["equipment.name", "location.name", "customer.name"],
};
const CUSTOMER_DEF = { objectId: "customer", fields: ["customer.name", "customer.status"] };

async function run(uid, definition = EQUIPMENT_DEF, options = {}) {
  const db = makeRecordingDb(world());
  const outcome = await runReportDefinition(
    { runnerUid: uid, definition, definitionId: "d-test" },
    { db, roles: SYNTH_ROLES, maxScanDocs: 50, maxResultRows: 50, ...options },
  );
  return { outcome, db };
}

// The production activation set is resolved from GCLOUD_PROJECT at cold start and
// cached, so it is pinned for the whole file rather than per test.
process.env.GCLOUD_PROJECT = "taylor-parts";

// ===========================================================================
// AXIS 2 -- the base scan predicate. THE REPRODUCTION.
// ===========================================================================

test("AXIS 2: a company-scoped runner's base scan carries a SERVER-SIDE equality predicate", async () => {
  const { outcome, db } = await run("u-taylor");
  const queries = queriesOf(db, "equipment");
  assert.equal(queries.length, 1, "exactly one scan of the reported collection");
  assert.deepEqual(
    queries[0].predicates,
    [{ field: "operatingCompanyId", op: "==", value: "taylor" }],
    "at 64008d5a this was `predicates: []` -- the recorded defect",
  );
  assert.equal(queries[0].limit, 51, "the scan cap is still applied, AFTER the predicate");
  assert.equal(outcome.rowScopeKind, "company-bound");
  assert.deepEqual(outcome.companyReach, ["taylor"]);
  assert.equal(outcome.rowCount, 1);
});

test("AXIS 2: the predicate is SERVER-SIDE -- it precedes the limit, so it cannot be an in-memory pass", async () => {
  // The proof that this is not a post-filter: with a scan cap of 1 and the
  // Taylor row NOT first in the collection, a post-filter would return zero rows
  // (the page would hold only the other company's row) while a real server-side
  // predicate returns the Taylor row. `world()` orders equipment as
  // taylor, ventana, orphan -- so run the Ventana runner, whose row is second.
  const { outcome, db } = await run("u-ventana", EQUIPMENT_DEF, { maxScanDocs: 1 });
  assert.deepEqual(queriesOf(db, "equipment")[0].predicates, [
    { field: "operatingCompanyId", op: "==", value: "ventana" },
  ]);
  assert.equal(
    outcome.rowCount,
    1,
    "a server-side predicate finds the Ventana row even at a cap of 1; an in-memory post-filter would have returned 0",
  );
  assert.deepEqual(outcome.rows.map((r) => r["equipment.name"]), ["V1"]);
});

test("AXIS 2: a GLOBAL grant reaches both companies but still EXCLUDES ownerless rows", async () => {
  const { outcome, db } = await run("u-global");
  assert.deepEqual(queriesOf(db, "equipment")[0].predicates, [
    { field: "operatingCompanyId", op: "in", value: ["taylor", "ventana"] },
  ]);
  assert.deepEqual([...outcome.companyReach], ["taylor", "ventana"]);
  // eq-orphan carries no operating company. The predicate-free scan returned it.
  assert.deepEqual(outcome.rows.map((r) => r["equipment.name"]).sort(), ["T1", "V1"]);
  assert.ok(
    !outcome.rows.some((r) => r["equipment.name"] === "ORPHAN"),
    "an ownerless row is outside every company's reach and is never returned",
  );
});

test("neither company's runner can see the other's rows", async () => {
  const t = await run("u-taylor");
  const v = await run("u-ventana");
  assert.deepEqual(t.outcome.rows.map((r) => r["equipment.name"]), ["T1"]);
  assert.deepEqual(v.outcome.rows.map((r) => r["equipment.name"]), ["V1"]);
});

// ===========================================================================
// AXIS 1 -- the hardcoded target
// ===========================================================================

test("AXIS 1: an operatingCompany-scoped grant now RUNS -- at 64008d5a it was permission-denied", async () => {
  // The defect's true shape: scopeMatches() value-matches operatingCompany
  // exactly, so a company-scoped assignment could never satisfy the hardcoded
  // `global` target. There was no such thing as a company-bounded report runner.
  const { outcome } = await run("u-taylor");
  assert.notEqual(outcome.kind, "permission-denied");
  assert.equal(outcome.kind, "results");
});

test("AXIS 1: reach is probed at each governed company id through the canonical resolver", () => {
  const assignments = [assignment("a", "u", { type: "operatingCompany", value: "ventana" })];
  const { reach, heldSomewhere } = resolveCompanyReach({
    capabilityId: "report.equipment.read",
    assignments,
    roles: SYNTH_ROLES,
    currentAccessVersion: 3,
    activationOverrides: ACTIVATION,
  });
  assert.deepEqual([...reach], ["ventana"], "only the company the grant names");
  assert.equal(heldSomewhere, true);
  assert.deepEqual(operatingCompanyScope("taylor"), { type: "operatingCompany", value: "taylor" });
  assert.deepEqual([...GOVERNED_OPERATING_COMPANY_IDS], ["taylor", "ventana"]);
});

// ===========================================================================
// AXIS 3 -- the one-hop join
// ===========================================================================

test("AXIS 3: the join no longer reads the ownerless row's related documents", async () => {
  const { outcome, db } = await run("u-global", EQUIPMENT_JOIN_DEF);
  const locationReads = docGetsOf(db, "locations").map((e) => e.docId).sort();
  const accountReads = docGetsOf(db, "accounts").map((e) => e.docId).sort();
  // At 64008d5a this run issued SIX reads: loc-1, loc-2, loc-3, acc-1, acc-2,
  // acc-3 -- including the ownerless row's parents.
  assert.deepEqual(locationReads, ["loc-1", "loc-2"]);
  assert.deepEqual(accountReads, ["acc-1", "acc-2"]);
  assert.ok(!locationReads.includes("loc-3"), "the ownerless row's location is never read");
  assert.ok(!accountReads.includes("acc-3"), "the ownerless row's account is never read");
  assert.equal(outcome.rowCount, 2);
});

test("AXIS 3: a company-scoped runner's join reads ONLY its own company's related documents", async () => {
  const { db } = await run("u-taylor", EQUIPMENT_JOIN_DEF);
  assert.deepEqual(docGetsOf(db, "locations").map((e) => e.docId), ["loc-1"]);
  assert.deepEqual(docGetsOf(db, "accounts").map((e) => e.docId), ["acc-1"]);
});

test("AXIS 3: a related document outside the run's reach is DROPPED, not attached", () => {
  // The guard itself, since no company-bound related collection is reachable
  // through today's catalog (every join target is accounts/contacts/locations,
  // all COMPANY_NEUTRAL, or employees, which is EXCLUDED). The branch is armed
  // for the first SINGLE_COMPANY join target the catalog gains.
  assert.equal(documentSatisfiesCompanyBound({ operatingCompanyId: "taylor" }, "operatingCompanyId", ["taylor"]), true);
  assert.equal(documentSatisfiesCompanyBound({ operatingCompanyId: "ventana" }, "operatingCompanyId", ["taylor"]), false);
  assert.equal(documentSatisfiesCompanyBound({}, "operatingCompanyId", ["taylor"]), false, "ownerless never attaches");
  assert.equal(documentSatisfiesCompanyBound(undefined, "operatingCompanyId", ["taylor"]), false);
  assert.equal(documentSatisfiesCompanyBound({ operatingCompanyId: "" }, "operatingCompanyId", ["taylor"]), false);
});

test("AXIS 3: a related collection with no governed company bound is never fetched", () => {
  // `employees` is the concrete case: the ownership matrix classifies it
  // ownerClass EXCLUDED, so reportRowScopeForCollection refuses it and
  // joinRelatedDocs skips it BEFORE the fetch loop.
  const scope = reportRowScopeForCollection("employees");
  assert.equal(scope.kind, "unsupported");
  assert.match(scope.why, /EXCLUDED/);
  const src = readFileSync(SERVICE_SRC, "utf8");
  assert.match(
    src,
    /if \(relatedRowScope\.kind === "unsupported"\) \{\s*\n\s*refusedObjectIds\.add/,
    "the refusal must precede the fetch loop, not filter its results",
  );
});

// ===========================================================================
// AXIS 4 / REQUIREMENT 3 -- fail closed on tenancy, with a distinct kind
// ===========================================================================

test("REQ 3: a grant that binds to no company yields company-unresolved, NOT permission-denied", async () => {
  const { outcome } = await run("u-location");
  assert.equal(outcome.kind, "company-unresolved");
  assert.notEqual(outcome.kind, "permission-denied");
  assert.deepEqual([...outcome.companyReach], []);
  assert.equal(outcome.rowScopeKind, "unresolved");
  assert.match(outcome.companyBoundRefusal, /valueless grant confers no reach/);
  assert.equal(outcome.rows, null);
  assert.equal(outcome.rowCount, 0);
});

test("REQ 3: FAIL-CLOSED PROOF -- the reported collection is never read on a tenancy refusal", async () => {
  const { db } = await run("u-location");
  assert.deepEqual(queriesOf(db, "equipment"), [], "no scan query was issued");
  assert.deepEqual(docGetsOf(db, "equipment"), [], "no document read was issued");
  assert.deepEqual(readsOf(db, "equipment"), [], "the collection was NEVER touched");
  assert.deepEqual(readsOf(db, "locations"), [], "no join read either");
  assert.deepEqual(readsOf(db, "accounts"), []);
  // Only the runner's own access state was read.
  const touched = [...new Set(db.log.map((e) => e.collection))].filter((c) => !AUDIT_COLLECTIONS.has(c));
  assert.deepEqual(touched.sort(), ["roleAssignments", "users"]);
});

test("REQ 3: no grant at all is still permission-denied, and still reads nothing", async () => {
  const { outcome, db } = await run("u-none");
  assert.equal(outcome.kind, "permission-denied");
  assert.equal(outcome.companyBoundRefusal, null, "not a tenancy failure");
  assert.deepEqual(readsOf(db, "equipment"), []);
});

test("REQ 3: the two refusals are distinguishable by kind alone", async () => {
  const noGrant = await run("u-none");
  const noCompany = await run("u-location");
  assert.notEqual(noGrant.outcome.kind, noCompany.outcome.kind);
  assert.equal(noGrant.outcome.kind, "permission-denied");
  assert.equal(noCompany.outcome.kind, "company-unresolved");
});

// ===========================================================================
// The ownership matrix is the authority -- not this layer
// ===========================================================================

test("the row bound for every reachable report collection is read from the ownership matrix", () => {
  // The four reachable objects: validateReportDefinition defaults its activated
  // set to objectsWithPopulatedFields(), which is exactly these.
  assert.deepEqual(reportRowScopeForCollection("equipment").kind, "company-bound");
  assert.equal(reportRowScopeForCollection("equipment").field, "operatingCompanyId");
  for (const c of ["accounts", "contacts", "locations"]) {
    assert.equal(reportRowScopeForCollection(c).kind, "company-neutral", `${c} is R-15 COMPANY_NEUTRAL`);
  }
});

test("the company field is never guessed -- it comes from companyScopeField or a single COMPANY ownerField", () => {
  const equipment = OWNERSHIP_MATRIX.find((f) => f.family === "equipment");
  assert.equal(companyFieldForFamily(equipment), "operatingCompanyId");
  // companyScopeField wins when both are declared: it is the more specific
  // statement of "which field answers the company question".
  assert.equal(
    companyFieldForFamily({ ownerClass: "COMPANY", ownerFields: ["x"], companyScopeField: "operatingCompanyId" }),
    "operatingCompanyId",
  );
  // A PERSON-owned family's ownerFields are a USER id, never a company.
  assert.equal(companyFieldForFamily({ ownerClass: "PERSON", ownerFields: ["accountOwner"] }), null);
  // Two owner fields cannot be a single-field bound.
  assert.equal(companyFieldForFamily({ ownerClass: "COMPANY", ownerFields: ["a", "b"] }), null);
});

test("every unknown answers refuse, never global", () => {
  for (const c of ["", "   ", "not_a_collection", "users", "auditEvents", "reportDefinitions"]) {
    assert.equal(reportRowScopeForCollection(c).kind, "unsupported", `${JSON.stringify(c)} must refuse`);
  }
  assert.equal(reportRowScopeForCollection(undefined).kind, "unsupported");
  assert.equal(reportRowScopeForCollection(null).kind, "unsupported");
});

test("a CROSS_COMPANY_CAPABLE family is refused rather than approximated with one field", () => {
  const cross = OWNERSHIP_MATRIX.filter((f) => f.companyScope === "CROSS_COMPANY_CAPABLE");
  assert.ok(cross.length > 0, "the matrix declares at least one, or this test is vacuous");
  for (const fam of cross) {
    assert.equal(
      reportRowScopeForCollection(fam.collection).kind,
      "unsupported",
      `${fam.collection}: a participating pair is not a single-field equality`,
    );
  }
});

// ===========================================================================
// COMPANY_NEUTRAL -- recorded honestly, not dressed up as a bound
// ===========================================================================

test("a COMPANY_NEUTRAL base object still requires a non-empty reach, and says it carries no predicate", async () => {
  const { outcome, db } = await run("u-taylor", CUSTOMER_DEF);
  assert.equal(outcome.rowScopeKind, "company-neutral");
  assert.deepEqual(queriesOf(db, "accounts")[0].predicates, [], "no predicate exists to apply -- R-15");
  assert.deepEqual([...outcome.companyReach], ["taylor"]);
  // And the reach requirement is real: a runner with no company reach is refused
  // even on a neutral collection, and the collection is not read.
  const refused = await run("u-location", CUSTOMER_DEF);
  assert.equal(refused.outcome.kind, "company-unresolved");
  assert.deepEqual(readsOf(refused.db, "accounts"), []);
});

test("a reach too wide for a single `in` filter refuses rather than trimming the predicate", () => {
  // Not reachable with the two governed companies that exist today, but
  // operatingCompanyAuthority.ts requires new ones to be addable without a schema
  // change, so the guard must exist before it is needed. Trimming the predicate to
  // fit would silently under-report; issuing the query would surface as an opaque
  // Firestore error.
  assert.equal(MAX_IN_FILTER_VALUES, 30);
  assert.ok(GOVERNED_OPERATING_COMPANY_IDS.length <= MAX_IN_FILTER_VALUES);
  const code = codeOnly(SERVICE_SRC);
  assert.match(code, /companyReach\.length > MAX_IN_FILTER_VALUES/);
  assert.match(code, /"company-unresolved",\s*\n\s*`Report run refused: the runner's company reach/);
});

// ===========================================================================
// THE RATCHET -- the scope cannot be hardcoded back to global
// ===========================================================================

/**
 * Source text with comments and string literals' contents left intact but
 * COMMENTS STRIPPED. The ratchet must not be satisfiable (or defeated) by prose:
 * this file's own explanatory comments quote the old defect verbatim, and a
 * future edit must not be able to hide a real hardcode inside a comment either.
 */
function codeOnly(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

test("RATCHET: no global-scoped capability target may appear in the report execution service", () => {
  const code = codeOnly(SERVICE_SRC);
  assert.doesNotMatch(
    code,
    /type\s*:\s*["']global["']/,
    'a `{ type: "global" }` scope literal reappeared in reportExecutionService.ts -- this is the axis-1 defect at 64008d5a:420',
  );
  assert.doesNotMatch(code, /scope\s*:\s*\{\s*type\s*:\s*["']global["']/, "no global scope object literal");
  assert.doesNotMatch(
    code,
    /TargetContext/,
    "the service must construct no capability target of its own; operatingCompanyScope() builds them from a named company id",
  );
});

test("RATCHET: the base scan must carry a where() bound to the row scope's company field", () => {
  const code = codeOnly(SERVICE_SRC);
  assert.match(code, /baseCollection\.where\(rowScope\.field, "==", companyReach\[0\]\)/);
  assert.match(code, /baseCollection\.where\(rowScope\.field, "in", \[\.\.\.companyReach\]\)/);
  assert.doesNotMatch(
    code,
    /db\.collection\(object\.collection\)\s*\.limit\(/,
    "the predicate-free scan at 64008d5a:500 must not return",
  );
  assert.match(code, /boundedQuery\.limit\(maxScanDocs \+ 1\)\.get\(\)/, "the cap is applied to the BOUNDED query");
});

test("RATCHET: the service resolves its bound from reportRowScope.ts, not from its own judgement", () => {
  const code = codeOnly(SERVICE_SRC);
  for (const symbol of [
    "reportRowScopeForCollection",
    "resolveCompanyReach",
    "operatingCompanyScope",
    "documentSatisfiesCompanyBound",
  ]) {
    assert.match(code, new RegExp(symbol), `${symbol} must be used`);
  }
  assert.match(code, /isAllowedAcrossReach/, "field gates check every company in the reach");
  assert.doesNotMatch(code, /function isAllowed\(/, "the single-target isAllowed() must stay gone");
  // Tightened after a negative control showed the loose symbol check above was
  // satisfied by the IMPORT alone: deleting the join's verification left it green.
  // The guard's shape is asserted, not merely the symbol's presence.
  //
  // CI-UNBLOCK-1899 TIGHTENED THIS FURTHER, it did not relax it. The drop branch
  // now RECORDS the incompleteness before short-circuiting, so that a zero-row
  // run which depends on the dropped document is refused instead of being
  // returned as a proven `kind: "empty"` (see reportRelatedJoinHonesty.test.mjs).
  // Both statements are required here and in this order: deleting the
  // verification, deleting the `return` (which would ATTACH another company's
  // document), or deleting the recording (which would restore the silent drop)
  // each fails this assertion.
  assert.match(
    code,
    /relatedRowScope\.kind === "company-bound"\s*\n?\s*&& !documentSatisfiesCompanyBound\(related, relatedRowScope\.field, reach\)\)\s*\{\s*\n\s*incompleteObjectIds\.add\(toObjectId\);\s*\n\s*return;/,
    "the join must VERIFY a company-bound related document against the reach, RECORD the incomplete join, and drop it -- not merely import the helper",
  );
  assert.match(
    code,
    /if \(relatedRowScope\.kind === "unsupported"\) \{\s*\n\s*refusedObjectIds\.add\(relationship\.toObjectId\);\s*\n\s*continue;/,
    "an unsupported related collection must `continue` -- recording it without skipping the fetch is the defect",
  );
});

test("RATCHET: reportRowScope.ts stays pure -- no firebase-admin, no Firestore", () => {
  const code = codeOnly(ROWSCOPE_SRC);
  assert.doesNotMatch(code, /firebase-admin/);
  assert.doesNotMatch(code, /getFirestore/);
  assert.doesNotMatch(code, /\.collection\(/);
});

test("RATCHET: the company is never inferred -- no uid/profile/warehouse source feeds the reach", () => {
  const code = codeOnly(ROWSCOPE_SRC) + codeOnly(SERVICE_SRC);
  for (const forbidden of [
    /employeeId\s*\?\?/,
    /operatingCompanyId\s*=\s*.*(?:profile|employee|warehouse|job|title)/i,
    /inferCompany/i,
    /companyFromUid/i,
    /resolveCompanyForUser/i,
  ]) {
    assert.doesNotMatch(code, forbidden, `an inference path appeared: ${forbidden}`);
  }
  // Reach is derived from assignments through the resolver, and nowhere else.
  assert.match(codeOnly(ROWSCOPE_SRC), /resolveEffectivePermission\(\{/);
});

test("RATCHET: the outcome kind for a tenancy failure stays distinct from permission-denied", () => {
  const code = codeOnly(SERVICE_SRC);
  assert.match(code, /\| "company-unresolved"/);
  assert.match(code, /"permission-denied" \| "company-unresolved"/);
});

// ===========================================================================
// The corrected claim about production activation
// ===========================================================================

test("the service no longer claims production carries no activation overrides", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  // The false sentence is QUOTED in the correction on purpose (requirement 5:
  // correct the claim, do not delete it), so its mere presence is not the test.
  // What is asserted is that every occurrence is inside a block that marks it
  // false and names the real field.
  const occurrences = src.match(/Production carries no overrides/g) ?? [];
  assert.equal(occurrences.length, 1, "quoted exactly once, in the correction");
  assert.match(
    src,
    /ENG-E CORRECTION[\s\S]{0,400}Production carries no overrides[\s\S]{0,200}THAT IS FALSE/,
    "the quoted claim must be explicitly marked false, not left standing",
  );
  assert.match(src, /productionCapabilityActivations/, "the correction must name the real field");
  assert.match(src, /production-activated/i);
});

test("this suite exercises the run under the REAL production activation set", () => {
  assert.equal(process.env.GCLOUD_PROJECT, "taylor-parts");
  assert.equal(PRODUCTION_ACTIVATED_REPORT_CAPS.length, 25);
  assert.ok(
    PRODUCTION_ACTIVATED_REPORT_CAPS.every((id) => id.startsWith("report.")),
    "all 25 production-adopted capabilities are report.*",
  );
});
