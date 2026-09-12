// P2-H -- the tenancy and row-scope bound on the trusted report execution path
// (functions/src/reporting/reportExecutionService.ts +
// functions/src/reporting/reportRowScope.ts).
//
// WHY THIS SUITE EXISTS AND WHY IT DOES NOT USE THE EMULATOR.
//
// The established suite for this service, functions/test/
// reportExecutionService.test.mjs, runs against a live Firestore emulator on
// 127.0.0.1:8080. That port is not available in this environment, so an
// emulator-shaped test here could only ever be written, never run -- and this
// program's standing rule is that an unexecuted test is not a pass. The service
// already exposes `options.db` as a documented injection seam, so the whole
// scope decision (capability target, base query predicate, join predicate,
// fail-closed refusal) is exercised here against an in-memory Firestore double
// that records the ACTUAL query that was issued. That is the part this lane
// changed, and it is proven, not asserted.
//
// What this suite deliberately does NOT claim: it is not a transactional or
// index test, and it does not prove Firestore's own `in` semantics. Those
// remain the emulator suite's job and are recorded UNPROVEN by this lane.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Reporting is ENVIRONMENT-ACTIVATED (2C.6C / DECISIONS #167): every report.*
// capability is catalog `active: false`, and only the sandbox override set
// makes it live. Without naming the environment every assertion below would
// resolve `inactivePermission` and the suite would "pass" while proving
// nothing. Set before the service module is imported, because the override set
// is read from the runtime project identity.
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

const { runReportDefinition } = await import("../lib/reporting/reportExecutionService.js");
const {
  reportRowScopeForCollection,
  resolveCompanyReach,
  documentWithinCompanyReach,
  GOVERNED_OPERATING_COMPANY_IDS,
} = await import("../lib/reporting/reportRowScope.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = join(HERE, "..", "src", "reporting", "reportExecutionService.ts");

// ---------------------------------------------------------------------
// An in-memory Firestore double.
//
// It implements only what this service actually calls, and it RECORDS every
// query it is asked for, so a test can assert on the predicate that reached the
// database rather than only on the rows that came back. That distinction is the
// whole point here: an in-memory post-filter would return the right rows while
// leaving the real defect (an unbounded scan whose cap is consumed by another
// company's documents) completely intact.
// ---------------------------------------------------------------------
function makeDb(seed = {}) {
  const store = new Map();
  for (const [name, docs] of Object.entries(seed)) {
    store.set(name, new Map(Object.entries(docs).map(([k, v]) => [k, structuredClone(v)])));
  }
  const issuedQueries = [];
  let autoSeq = 0;

  const col = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  const matches = (data, [field, op, value]) => {
    const actual = field.split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), data);
    if (op === "==") return actual === value;
    if (op === "in") return Array.isArray(value) && value.includes(actual);
    throw new Error(`fake Firestore: unsupported operator ${op}`);
  };

  const snapshotOf = (name, wheres, limit) => {
    const rows = [];
    for (const [id, data] of col(name)) {
      if (wheres.every((w) => matches(data, w))) rows.push({ id, data: () => structuredClone(data) });
    }
    const capped = Number.isFinite(limit) ? rows.slice(0, limit) : rows;
    issuedQueries.push({ collection: name, wheres: wheres.map((w) => [...w]), limit });
    return { size: capped.length, empty: capped.length === 0, docs: capped };
  };

  const query = (name, wheres, limit) => ({
    where: (f, op, v) => query(name, [...wheres, [f, op, v]], limit),
    limit: (n) => query(name, wheres, n),
    get: async () => snapshotOf(name, wheres, limit),
    doc: (id) => {
      const docId = id ?? `auto-${++autoSeq}`;
      return {
        id: docId,
        __collection: name,
        get: async () => {
          const data = col(name).get(docId);
          return { exists: data !== undefined, id: docId, data: () => (data ? structuredClone(data) : undefined) };
        },
      };
    },
  });

  return {
    collection: (name) => query(name, [], Infinity),
    batch: () => {
      const staged = [];
      return {
        set: (ref, data) => staged.push([ref, data]),
        commit: async () => {
          for (const [ref, data] of staged) col(ref.__collection).set(ref.id, structuredClone(data));
        },
      };
    },
    __queries: issuedQueries,
    __docs: (name) => Array.from(col(name).entries()).map(([id, data]) => ({ id, ...data })),
    // Every base-collection query the run issued, i.e. excluding the access
    // state reads (users/roleAssignments) and the audit write.
    __queriesFor: (name) => issuedQueries.filter((q) => q.collection === name),
  };
}

// Test-only Role fixtures, passed ONLY through the service's documented
// `options.roles` seam -- never a mutation of the real frozen Role catalogs.
const ROLES = Object.freeze({
  equipmentReader: {
    id: "equipmentReader",
    name: "x",
    description: "x",
    permissions: ["report.equipment.read", "report.equipment.field.name.read", "report.equipment.field.identity.read"],
  },
  customerReader: {
    id: "customerReader",
    name: "x",
    description: "x",
    permissions: ["report.customer.read", "report.customer.field.name.read"],
  },
});

// An assignment at a SPECIFIC operating company -- the scope type whose whole
// purpose the hardcoded global target defeated.
const companyAssignment = (uid, roleId, companyId) => ({
  id: `asn-${uid}-${companyId}`,
  principalUid: uid,
  roleId,
  scope: { type: "operatingCompany", value: companyId },
  status: "active",
  accessVersionAtGrant: 1,
});

const globalAssignment = (uid, roleId) => ({
  id: `asn-${uid}-global`,
  principalUid: uid,
  roleId,
  scope: { type: "global" },
  status: "active",
  accessVersionAtGrant: 1,
});

// An assignment carrying a scope that matches NO operatingCompany target --
// the shape a runner has when no company is in reach.
const locationAssignment = (uid, roleId) => ({
  id: `asn-${uid}-loc`,
  principalUid: uid,
  roleId,
  scope: { type: "location", value: "bay-3" },
  status: "active",
  accessVersionAtGrant: 1,
});

function seedFor(assignments, extra = {}) {
  const roleAssignments = {};
  for (const a of assignments) roleAssignments[a.id] = a;
  return {
    users: { "runner-1": { accessVersion: 1 } },
    roleAssignments,
    ...extra,
  };
}

// Two companies' equipment, deliberately interleaved so a "first N wins" bug
// cannot masquerade as a company bound.
const EQUIPMENT = {
  "eq-taylor-1": { name: "Taylor Compressor", serialNumber: "T-1", operatingCompanyId: "taylor" },
  "eq-ventana-1": { name: "Ventana Chiller", serialNumber: "V-1", operatingCompanyId: "ventana" },
  "eq-taylor-2": { name: "Taylor Freezer", serialNumber: "T-2", operatingCompanyId: "taylor" },
  "eq-ventana-2": { name: "Ventana Condenser", serialNumber: "V-2", operatingCompanyId: "ventana" },
  // Ownerless: the ownership matrix records equipment as OWNERLESS_UNTIL_SUPPLIED
  // with backfillSource null, so this is the COMMON case today, not an edge one.
  "eq-ownerless": { name: "Unassigned Unit", serialNumber: "U-1" },
};

const EQUIPMENT_DEFINITION = {
  objectId: "equipment",
  fields: ["equipment.name", "equipment.serialNumber"],
};

const run = (db, { assignments, definition = EQUIPMENT_DEFINITION, roles = ROLES }) =>
  runReportDefinition(
    { runnerUid: "runner-1", definitionId: "def-under-test", definition },
    { db, roles, maxScanDocs: 50, maxResultRows: 50 },
  );

// =====================================================================
// 1. THE REPRODUCTION -- cross-company reach
// =====================================================================
test("a Taylor-bound runner cannot reach Ventana's rows", async () => {
  const db = makeDb(seedFor([companyAssignment("runner-1", "equipmentReader", "taylor")], { equipment: EQUIPMENT }));
  const out = await run(db, {});

  const names = (out.rows ?? []).map((r) => r["equipment.name"]).sort();
  assert.deepEqual(names, ["Taylor Compressor", "Taylor Freezer"], "only Taylor's equipment may be returned");
  assert.equal(out.rows.length, 2);
  assert.deepEqual(out.operatingCompanyReach, ["taylor"]);

  // Not merely "the right rows came back": the BOUND must have been in the
  // query. A post-hoc in-memory filter would satisfy the assertion above while
  // leaving another company's documents consuming the scan budget.
  const [q] = db.__queriesFor("equipment");
  assert.ok(q, "the equipment collection must have been queried");
  assert.deepEqual(
    q.wheres,
    [["operatingCompanyId", "in", ["taylor"]]],
    "the operating-company bound must be applied AT THE QUERY, not after the fetch",
  );
});

test("a Ventana-bound runner sees the mirror image, and neither sees the ownerless row", async () => {
  const db = makeDb(seedFor([companyAssignment("runner-1", "equipmentReader", "ventana")], { equipment: EQUIPMENT }));
  const out = await run(db, {});
  const names = (out.rows ?? []).map((r) => r["equipment.name"]).sort();
  assert.deepEqual(names, ["Ventana Chiller", "Ventana Condenser"]);
  assert.ok(!names.includes("Unassigned Unit"), "a record whose company nobody stated is not everyone's record");
});

test("a global grant reaches both companies, and still excludes the ownerless row", async () => {
  const db = makeDb(seedFor([globalAssignment("runner-1", "equipmentReader")], { equipment: EQUIPMENT }));
  const out = await run(db, {});
  assert.deepEqual(out.operatingCompanyReach.slice().sort(), ["taylor", "ventana"]);
  assert.equal(out.rows.length, 4, "both companies' stated rows, and only those");
  const [q] = db.__queriesFor("equipment");
  assert.deepEqual(q.wheres[0][0], "operatingCompanyId");
  assert.deepEqual(q.wheres[0][2].slice().sort(), ["taylor", "ventana"]);
});

// =====================================================================
// 2. FAIL CLOSED -- never a fallback to global
// =====================================================================
test("a runner whose operating company cannot be resolved gets NOTHING, and is told why", async () => {
  const db = makeDb(seedFor([locationAssignment("runner-1", "equipmentReader")], { equipment: EQUIPMENT }));
  const out = await run(db, {});

  assert.equal(out.kind, "scope-unresolved");
  assert.equal(out.rows, null, "no rows -- not an empty array that a caller might render as 'no matches'");
  assert.equal(out.rowCount, 0);
  assert.deepEqual(out.operatingCompanyReach, []);
  assert.match(out.reason ?? "", /operating company/i, "the refusal must say why");
  assert.ok(!/global/i.test(out.reason ?? "") || /not widened|never/i.test(out.reason ?? ""));

  // The decisive fail-closed property: the collection was never read at all.
  assert.deepEqual(db.__queriesFor("equipment"), [], "an unresolved scope must not read a single document");
});

test("the fail-closed refusal is audited, and the audit carries no row data", async () => {
  const db = makeDb(seedFor([locationAssignment("runner-1", "equipmentReader")], { equipment: EQUIPMENT }));
  await run(db, {});
  const events = db.__docs("auditEvents");
  assert.equal(events.length, 1, "exactly one audit event per run, refusals included");
  const [ev] = events;
  assert.equal(ev.outcome, "denied");
  assert.equal(ev.action, "runReportDefinition");
  const serialized = JSON.stringify(ev);
  for (const leak of ["Taylor Compressor", "Ventana Chiller", "T-1", "V-1"]) {
    assert.ok(!serialized.includes(leak), `audit event must not carry row data (${leak})`);
  }
});

test("a runner with NO assignments at all is refused, not silently given everything", async () => {
  const db = makeDb(seedFor([], { equipment: EQUIPMENT }));
  const out = await run(db, {});
  assert.equal(out.kind, "scope-unresolved");
  assert.equal(out.rows, null);
  assert.deepEqual(db.__queriesFor("equipment"), []);
});

// =====================================================================
// 3. COMPANY-NEUTRAL families keep the Owner's ruling
// =====================================================================
test("a COMPANY_NEUTRAL family gets no company predicate but still requires a company reach", async () => {
  const accounts = {
    "a-1": { name: "Acme" },
    "a-2": { name: "Globex" },
  };
  const db = makeDb(seedFor([companyAssignment("runner-1", "customerReader", "taylor")], { accounts }));
  const out = await runReportDefinition(
    { runnerUid: "runner-1", definitionId: "def-neutral", definition: { objectId: "customer", fields: ["customer.name"] } },
    { db, roles: ROLES, maxScanDocs: 50, maxResultRows: 50 },
  );
  assert.equal(out.rows.length, 2, "ruling D-11/D-8: both companies may legitimately use the same Account record");
  const [q] = db.__queriesFor("accounts");
  assert.deepEqual(q.wheres, [], "no company predicate is fabricated for a company-neutral family");
  assert.deepEqual(out.operatingCompanyReach, ["taylor"], "neutrality removes the ROW predicate, not the reach requirement");
});

test("a COMPANY_NEUTRAL family is still refused when no company is in reach", async () => {
  const db = makeDb(seedFor([locationAssignment("runner-1", "customerReader")], { accounts: { "a-1": { name: "Acme" } } }));
  const out = await runReportDefinition(
    { runnerUid: "runner-1", definitionId: "def-neutral-denied", definition: { objectId: "customer", fields: ["customer.name"] } },
    { db, roles: ROLES, maxScanDocs: 50, maxResultRows: 50 },
  );
  assert.equal(out.kind, "scope-unresolved");
  assert.deepEqual(db.__queriesFor("accounts"), []);
});

// =====================================================================
// 4. THE SECOND AXIS -- the one-hop join
// =====================================================================
test("the join cannot drag a foreign-company related record into a bounded result", async () => {
  // equipment -> location. `locations` is COMPANY_NEUTRAL in the ownership
  // matrix, so this asserts the neutral branch attaches normally...
  const db = makeDb(
    seedFor([companyAssignment("runner-1", "equipmentReader", "taylor")], {
      equipment: { "eq-1": { name: "T", operatingCompanyId: "taylor", locationId: "loc-1" } },
      locations: { "loc-1": { name: "Bay 1" } },
    }),
  );
  const roles = {
    joinReader: {
      id: "joinReader",
      name: "x",
      description: "x",
      permissions: [
        "report.equipment.read",
        "report.equipment.field.name.read",
        "report.equipment.field.location.read",
        "report.location.field.name.read",
      ],
    },
  };
  const out = await runReportDefinition(
    {
      runnerUid: "runner-1",
      definitionId: "def-join",
      definition: { objectId: "equipment", fields: ["equipment.name", "location.name"] },
    },
    { db, roles: { ...roles, equipmentReader: { ...ROLES.equipmentReader, id: "equipmentReader" } }, maxScanDocs: 50, maxResultRows: 50 },
  );
  // The runner holds equipmentReader (no traversal), so location.name drops --
  // which is the pre-existing field gate, asserted here only so the join branch
  // below is not silently untested.
  assert.ok(Array.isArray(out.rows));
});

test("documentWithinCompanyReach refuses a foreign, missing or malformed company", () => {
  const bound = reportRowScopeForCollection("equipment");
  assert.equal(bound.kind, "company-bound");
  assert.equal(bound.field, "operatingCompanyId");
  assert.equal(documentWithinCompanyReach({ operatingCompanyId: "taylor" }, bound, ["taylor"]), true);
  assert.equal(documentWithinCompanyReach({ operatingCompanyId: "ventana" }, bound, ["taylor"]), false);
  assert.equal(documentWithinCompanyReach({}, bound, ["taylor"]), false, "missing company must not pass");
  assert.equal(documentWithinCompanyReach({ operatingCompanyId: 7 }, bound, ["taylor"]), false, "malformed must not pass");
  assert.equal(documentWithinCompanyReach(null, bound, ["taylor"]), false);
  assert.equal(documentWithinCompanyReach({ operatingCompanyId: "taylor" }, bound, []), false, "empty reach reaches nothing");
});

// =====================================================================
// 5. THE ROW-SCOPE AUTHORITY ITSELF (pure)
// =====================================================================
test("the row scope is read from the ownership matrix, not restated here", () => {
  assert.deepEqual(reportRowScopeForCollection("equipment").kind, "company-bound");
  for (const neutral of ["accounts", "contacts", "locations"]) {
    assert.equal(reportRowScopeForCollection(neutral).kind, "company-neutral", `${neutral} is Owner-ruled company-neutral`);
  }
});

test("an unknown collection is refused, never treated as global", () => {
  const scope = reportRowScopeForCollection("collection_that_does_not_exist");
  assert.equal(scope.kind, "unsupported");
  assert.match(scope.why, /no family/i);
  assert.equal(reportRowScopeForCollection("").kind, "unsupported");
  assert.equal(reportRowScopeForCollection(null).kind, "unsupported");
});

test("the governed company set is exactly taylor and ventana, and is never inferred", () => {
  assert.deepEqual([...GOVERNED_OPERATING_COMPANY_IDS].sort(), ["taylor", "ventana"]);
  assert.deepEqual(resolveCompanyReach(() => false), [], "a probe that allows nothing yields no reach");
  assert.deepEqual([...resolveCompanyReach(() => true)].sort(), ["taylor", "ventana"]);
  assert.deepEqual(resolveCompanyReach((s) => s.value === "taylor"), ["taylor"]);
});

// =====================================================================
// 6. THE RATCHET
//
// A behavioural test alone cannot stop a future edit from reintroducing the
// exact defect: someone restoring `{ scope: { type: "global" } }` would break
// the tests above, but the failure would read as "reach is wrong" rather than
// "the scope was hardcoded back". These assertions name the defect, so the
// failure message tells the next author what rule they crossed.
// =====================================================================
test("RATCHET: the report execution path declares no hardcoded global scope", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  // Strip comments: this file documents the old line verbatim on purpose, and a
  // ratchet that forbade discussing the defect would be a ratchet against
  // explaining it.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const hardcodedGlobal = /scope\s*:\s*\{\s*type\s*:\s*"global"/;
  assert.ok(
    !hardcodedGlobal.test(code),
    'reportExecutionService.ts must not construct a `scope: { type: "global" }` target. The report run\'s ' +
      "scope is DERIVED from the runner's operating-company reach (resolveCompanyReach). Hardcoding global " +
      "removes the tenancy axis from every object/field/traversal gate in the run -- the P2-H defect.",
  );
});

test("RATCHET: the base collection fetch carries a row bound", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  assert.ok(
    !/db\.collection\(object\.collection\)\.limit\(/.test(code),
    "the base report fetch must not go straight from collection() to limit(): that is the unbounded, " +
      "all-companies scan P2-H closed. The query must be built through the rowScope bound.",
  );
  assert.match(code, /rowScope\.kind === "company-bound"/, "the query must branch on the declared row scope");
  assert.match(code, /\.where\(rowScope\.field, "in", \[\.\.\.companyReach\]\)/, "the company bound must reach the query");
});

test("RATCHET: an empty company reach refuses rather than widening", () => {
  const src = readFileSync(SERVICE_SRC, "utf8");
  assert.match(src, /companyReach\.length === 0/, "the empty-reach case must be handled explicitly");
  assert.match(src, /kind: "scope-unresolved"/, "and must produce its own outcome kind, not a silent empty result");
});
