// PERFORMANCE GOAL AUTHORING ON EOS -- the OFFLINE contracts (G-1; Owner direction 2026-10-19 "Restore complete EOS goal authoring"; DECISIONS #G-1; resolves OD-B4-3). No database.
//   a. The migration's VALUES equal, pair for pair, the Firebase holders of the four write keys -- 32 pairs over 8 Roles -- derived from the compiled catalogs; none is scoped or
//      conditioned in Firebase; nobody else holds any of them; the evidence file and the authority baseline carry the same 32.
//   b. The migration registers exactly the four ids on unique (object, action) cells, creates the idempotency table, and its down refuses to discard a goal or a decision.
//   c. The four operations are in the closed Operations lists, routed, NOT behind the Reorder boundary, and named by the client transport.
//   d. Capability FIRST: a caller without the verb's capability is refused before any input is read or any connection is opened; shape errors are refused before any connection.
//   e. The Analysis > Goals door is earned by the four authoring capabilities and NOT by performance.goal.read alone.
//   f. The authoring module reaches no Firebase; the date arithmetic that closes a predecessor's window is pure.
// The Postgres half (lifecycle, supersede, the self rules, reach per scope, foreign = nonexistent, replay, no write on refusal, audit) is g1GoalAuthoringPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PERMISSION_CATALOG } = require("../lib/access/permissionCatalog.js");
const { COMPATIBILITY_ROLES } = require("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = require("../lib/access/governedBusinessRoles.js");
const http = require("../lib/eosOps/eosOpsHttp.js");
const { ADMINISTRATION_GRANT_ONLY_CAPABILITIES, defaultWriterMayInsert, resolveCell, decisionIndex } = require("../lib/adminPolicy/roleCapabilityAdministration.js");
const { deriveLegacyRoleGrants } = require("../lib/eosOps/migration/inventoryCapabilityGrantMigration.js");
const authority = require("../lib/eosOps/experienceAuthority.js");
const goals = require("../lib/eosOps/performanceGoalAuthoring.js");

const MIGRATION_ID = "1764690000000";
const MIGRATION = `migrations/${MIGRATION_ID}_performance-goal-authoring.sql`;
const KEYS = ["performance.goal.approve", "performance.goal.create", "performance.goal.retire", "performance.goal.supersede"];
const ROLES = { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES };
const read = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const sqlCode = (p) => read(p).replace(/^\s*--.*$/gm, "");
const tsCode = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const pairId = (role, key) => `${role}|${key}`;

/** The (role, key) pairs the Firebase catalogs declare for the four keys. */
const catalogPairs = () => Object.entries(ROLES).flatMap(([roleKey, role]) => (role.permissions ?? []).filter((k) => KEYS.includes(k)).map((k) => pairId(roleKey, k))).sort();

function migrationPairs() {
  const sql = sqlCode(MIGRATION);
  const start = sql.indexOf("JOIN (VALUES");
  const end = sql.indexOf(") AS g(role_key, capability_key)");
  assert.ok(start > 0 && end > start, "the migration's VALUES list is where the proof expects it");
  return [...sql.slice(start, end).matchAll(/\('([A-Za-z]+)',\s*'([A-Za-z0-9_.]+)'\)/g)].map((m) => pairId(m[1], m[2]));
}

test("a. the four write keys are in the Firebase catalog, and their holders are 8 Roles, each flat (never scoped or conditioned)", () => {
  assert.deepEqual(PERMISSION_CATALOG.map((p) => p.id).filter((id) => id.startsWith("performance.goal.")).sort(), [...KEYS, "performance.goal.read"].sort());
  const pairs = catalogPairs();
  assert.equal(pairs.length, 32);
  const roles = [...new Set(pairs.map((p) => p.split("|")[0]))].sort();
  assert.deepEqual(roles, ["admin", "fieldManager", "generalManager", "operationsManager", "owner", "partsManager", "salesManager", "warehouseManager"]);
  for (const role of roles) assert.deepEqual(pairs.filter((p) => p.startsWith(`${role}|`)).map((p) => p.split("|")[1]).sort(), KEYS, role);
  // None of them is scoped or conditioned in Firebase, so every EOS grant is flat.
  for (const [roleKey, role] of Object.entries(ROLES)) {
    for (const table of ["scopesByPermission", "conditionsByPermission"]) {
      for (const id of Object.keys(role[table] ?? {})) assert.ok(!KEYS.includes(id), `${roleKey} scopes/conditions ${id} in ${table}`);
    }
  }
  // The read-only holders and the one Role DECISIONS #162's prose also names can author nothing.
  for (const roleKey of ["salesperson", "partsAssociate", "warehouseAssociate", "performanceGoalSubject", "purchasingManager", "technician", "dispatcher"]) {
    for (const key of KEYS) assert.ok(!(ROLES[roleKey]?.permissions ?? []).includes(key), `${roleKey} must not hold ${key}`);
  }
});

test("a. the migration's VALUES equal the Firebase holders pair for pair; the evidence file and the baseline carry the same 32", () => {
  const fromMigration = migrationPairs();
  assert.equal(fromMigration.length, 32);
  assert.equal(new Set(fromMigration).size, 32, "no duplicate pair");
  assert.deepEqual([...fromMigration].sort(), catalogPairs(), "the migration writes exactly what the compiled Firebase catalogs declare");
  const parity = JSON.parse(read("../docs/architecture/g1-goal-authoring-grant-parity.json"));
  assert.deepEqual([parity.keyCount, parity.pairCount, parity.roles.length], [4, 32, 8]);
  assert.deepEqual(parity.diff, { firebaseOnly: [], eosOnly: [] });
  assert.deepEqual(parity.pairs.map((p) => pairId(p.role, p.capability)).sort(), catalogPairs());
  assert.deepEqual(Object.keys(parity.holdersByKey).sort(), KEYS);
  assert.deepEqual(parity.scopedOrConditionedInFirebase, {});
  const baseline = JSON.parse(read("src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"));
  const stamped = baseline.grants.filter((g) => g.evidence === `migration:${MIGRATION_ID}`);
  assert.deepEqual(stamped.map((g) => pairId(g.roleKey, g.capabilityKey)).sort(), catalogPairs());
  assert.ok(stamped.every((g) => g.source === "MIGRATION_BACKED" && g.observedGrantedBy === `migration:${MIGRATION_ID}`));
  assert.ok(baseline.grantBearingMigrations.includes(`migration:${MIGRATION_ID}`));
  assert.equal(baseline.grants.length, baseline.totalGrants);
  // No other Role in the baseline holds any of the four.
  assert.equal(baseline.grants.filter((g) => KEYS.includes(g.capabilityKey)).length, 32);
});

test("a. nothing else yields the four keys to another Role: catalog sync, default writers, the fence, other migrations", () => {
  const allowed = new Set(migrationPairs());
  // The catalog sync (the default writers' candidate set, every canonical Role) yields exactly the 32.
  assert.deepEqual(deriveLegacyRoleGrants(KEYS).map((g) => pairId(g.roleKey, g.capabilityKey)).sort(), [...allowed].sort());
  // A CURRENT Administration revoke always wins over a default; a Role that does not declare the key is never a default.
  for (const pair of allowed) {
    const [roleKey, key] = pair.split("|");
    assert.equal(defaultWriterMayInsert(new Map(), roleKey, key).allowed, true, pair);
    const revoked = decisionIndex([{ roleKey, capabilityKey: key, decision: "ADMIN_REVOKED" }]);
    assert.deepEqual(defaultWriterMayInsert(revoked, roleKey, key), { allowed: false, source: "ADMIN_REVOKED" }, pair);
  }
  for (const roleKey of Object.keys(ROLES)) {
    for (const key of KEYS) {
      if (allowed.has(pairId(roleKey, key))) continue;
      assert.deepEqual(resolveCell({ roleKey, capabilityKey: key, decision: null, isSystemDefault: false }), { shouldHold: false, source: "NONE" }, `${roleKey}/${key}`);
    }
  }
  // They were never fenced as Administration-grant-only, and no earlier migration grants or conditions them.
  for (const key of KEYS) assert.equal(ADMINISTRATION_GRANT_ONLY_CAPABILITIES.has(key), false, key);
  for (const f of readdirSync("migrations").filter((n) => n.endsWith(".sql") && !n.startsWith(MIGRATION_ID))) {
    const sql = sqlCode(`migrations/${f}`);
    for (const key of KEYS) assert.ok(!sql.includes(key), `${f} names ${key}`);
  }
});

test("b. the migration registers exactly the four ids on unique (object, action) cells, creates the idempotency table, and its down refuses to discard data", () => {
  const sql = sqlCode(MIGRATION);
  const insert = sql.slice(sql.indexOf("INSERT INTO capabilities"), sql.indexOf("ON CONFLICT (key) DO NOTHING"));
  const rows = [...insert.matchAll(/\('(cap_[A-Za-z0-9_]+)', '([A-Za-z.]+)',\s*'(?:[^']|'')*',\s*'([A-Za-z]+)', '([A-Za-z]+)', '([A-Z_]+)', '(?:[^']|'')*'\)/g)];
  assert.deepEqual(rows.map((m) => m[2]).sort(), KEYS);
  assert.deepEqual([...new Set(rows.map((m) => m[3]))], ["performanceGoal"]);
  assert.equal(new Set(rows.map((m) => m[4])).size, 4, "UNIQUE (object_key, action_key)");
  assert.deepEqual([...new Set(rows.map((m) => m[5]))], ["BUSINESS_ACTION"], "no CRED verb is derived");
  assert.match(sql, /CREATE TABLE performance_goal_commands \(/);
  assert.match(sql, /PRIMARY KEY \(tenant_id, actor_principal_id, idempotency_key\)/, "keyed per actor");
  assert.match(sql, /command IN \('CREATE', 'APPROVE', 'RETIRE'\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, goal_id\) REFERENCES performance_goals/);
  // The grants honour an Administration revoke and match the protected Roles only as the protected rows.
  assert.match(sql, /d\.decision = 'ADMIN_REVOKED'/);
  assert.match(sql, /\(r\.key NOT IN \('owner', 'admin'\) OR r\.protected = TRUE\)/);
  // The down refuses to destroy commands, authored goals, Administration decisions, direct grants and foreign Role grants, then drops.
  const down = sql.slice(sql.indexOf("-- Down Migration") >= 0 ? sql.indexOf("DO $$") : 0);
  for (const guard of ["performance_goal_commands", "provenance = 'NATIVE'", "role_capability_decisions", "principal_capabilities", "granted_by <>"]) assert.ok(down.includes(guard), guard);
  assert.match(down, /DROP TABLE eos_ops\.performance_goal_commands;/);
  // Two-person approval rests on Employees: the author's Employee is recorded; and a DRAFT may be RETIRED (its disposition), so the approval-evidence CHECK is widened for
  // exactly that case and restored, with the column dropped, by the down -- which refuses first if a draft was retired without ever being approved.
  assert.match(sql, /ADD COLUMN author_employee_id TEXT;/);
  assert.match(sql, /status IN \('APPROVED', 'SUPERSEDED'\) AND approved_by_ref IS NOT NULL AND approved_at_ms IS NOT NULL/);
  assert.match(sql, /status = 'RETIRED' AND \(approved_by_ref IS NULL\) = \(approved_at_ms IS NULL\)/);
  assert.ok(down.includes("status = 'RETIRED' AND approved_by_ref IS NULL"), "the down refuses while a never-approved draft was retired");
  assert.match(down, /DROP COLUMN author_employee_id;/);
  assert.match(down, /CHECK \(\(status = 'DRAFT'\) = \(approved_by_ref IS NULL AND approved_at_ms IS NULL\)\)/);
  // It touches no goal row and writes no other grant: the only role_capabilities INSERT is the 32 pairs.
  assert.equal([...sql.matchAll(/INSERT\s+INTO\s+role_capabilities/gi)].length, 1);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+(?:eos_ops\.)?performance_goals/i);
  assert.doesNotMatch(sql, /principal_capabilities\s*\(/i);
});

test("c. the four operations are closed-list members, routed to /operations/inventory, NOT behind the Reorder boundary, and named by the client transport", async () => {
  const READ = ["listGoalAuthoringOptions"];
  const WRITE = ["createPerformanceGoalDraft", "approvePerformanceGoal", "retirePerformanceGoal"];
  for (const op of READ) assert.ok(http.OPERATIONS_READ_OPERATIONS.includes(op), op);
  for (const op of WRITE) assert.ok(http.OPERATIONS_MUTATION_OPERATIONS.includes(op), op);
  for (const op of [...READ, ...WRITE]) {
    assert.equal(http.OPERATIONS_ROUTE_BY_OPERATION[op], "/operations/inventory", op);
    assert.equal(http.isOperationsOperation(op), true, op);
  }
  assert.ok(!http.OPERATIONS_MUTATION_OPERATIONS.includes("listGoalAuthoringOptions"), "a read is not a mutation");
  const untouchable = new Proxy({}, { get: () => { throw new Error("DEPS_TOUCHED"); } });
  for (const operation of [...READ, ...WRITE]) {
    const r = await http.executeOperation({ reader: untouchable, pool: untouchable, reorderPostgresActive: false },
      { caller: { externalSubject: "x", identityProvider: "firebase", requestedTenantId: null }, operation, input: {} }).catch((e) => e);
    assert.notEqual(r && r.code, "PRECONDITION_FAILED", `${operation} is its own authority, not behind the Reorder boundary`);
  }
  const client = read("../field-ops-app-vite/src/services/reorderApiClient.js");
  for (const op of [...READ, ...WRITE]) assert.match(client, new RegExp(`"${op}"`), op);
  // The one read takes no input, so the transport may call it bare.
  assert.match(client, /REORDER_OPTIONAL_INPUT_OPERATIONS[\s\S]*"listGoalAuthoringOptions"/);
});

const POOL_NEVER = new Proxy({}, { get: () => { throw new Error("POOL_TOUCHED"); } });
const actor = (...caps) => ({ tenantId: "t1", principalId: "p1", capabilities: new Set(caps) });
const refusal = async (fn) => fn().then(() => assert.fail("expected a refusal"), (e) => e);
const KEY = { idempotencyKey: "k-1" };
const DRAFT = { metricId: "technician.workOrder.open.count", targetScopeType: "EMPLOYEE", targetScopeId: "e-1", targetValue: 5, unit: "COUNT", direction: "AT_MOST", effectiveFrom: "2026-11-01" };

test("d. capability FIRST: no verb's capability = CAPABILITY_REQUIRED before a connection is opened (create vs supersede ask different keys)", async () => {
  const deps = { pool: POOL_NEVER };
  const none = actor();
  for (const [fn, input] of [
    [goals.createPerformanceGoalDraft, { ...DRAFT, ...KEY }],
    [goals.approvePerformanceGoal, { goalId: "g-1", reason: "ok", ...KEY }],
    [goals.retirePerformanceGoal, { goalId: "g-1", reason: "ok", ...KEY }],
  ]) {
    const e = await refusal(() => fn(deps, none, input));
    assert.equal(e.code, "CAPABILITY_REQUIRED");
    assert.equal(e.category, "FORBIDDEN");
  }
  // Another verb's capability is not this verb's.
  assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, actor(goals.GOAL_CREATE, goals.GOAL_RETIRE), { goalId: "g-1", reason: "ok", ...KEY }))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusal(() => goals.retirePerformanceGoal(deps, actor(goals.GOAL_APPROVE, goals.GOAL_CREATE), { goalId: "g-1", reason: "ok", ...KEY }))).code, "CAPABILITY_REQUIRED");
  // A version that NAMES a predecessor is a supersede: holding create alone is not enough, and holding supersede alone is not enough for a first version.
  assert.equal((await refusal(() => goals.createPerformanceGoalDraft(deps, actor(goals.GOAL_CREATE), { ...DRAFT, ...KEY, supersedesGoalId: "g-0" }))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusal(() => goals.createPerformanceGoalDraft(deps, actor(goals.GOAL_SUPERSEDE), { ...DRAFT, ...KEY }))).code, "CAPABILITY_REQUIRED");
  // The options read needs ANY authoring capability.
  assert.equal((await refusal(() => goals.listGoalAuthoringOptions(deps, none, {}))).code, "CAPABILITY_REQUIRED");
  assert.equal((await refusal(() => goals.listGoalAuthoringOptions(deps, actor("performance.goal.read"), {}))).code, "CAPABILITY_REQUIRED", "read alone authors nothing");
});

test("d. shape errors are refused before any connection: unknown fields, a missing idempotency key, a missing reason", async () => {
  const deps = { pool: POOL_NEVER };
  const all = actor(goals.GOAL_CREATE, goals.GOAL_SUPERSEDE, goals.GOAL_APPROVE, goals.GOAL_RETIRE);
  // An unknown field is refused, never ignored: nobody can believe they chose a tenant, an author or a status.
  for (const extra of ["tenantId", "createdBy", "status", "version", "goalId", "actorUid"]) {
    assert.equal((await refusal(() => goals.createPerformanceGoalDraft(deps, all, { ...DRAFT, ...KEY, [extra]: "x" }))).code, "INPUT_FIELD_NOT_ACCEPTED", extra);
  }
  assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, all, { goalId: "g-1", reason: "ok", ...KEY, approvedBy: "p9" }))).code, "INPUT_FIELD_NOT_ACCEPTED");
  for (const bad of [undefined, "", " k", "k ", "x".repeat(201), 7]) {
    assert.equal((await refusal(() => goals.createPerformanceGoalDraft(deps, all, { ...DRAFT, idempotencyKey: bad }))).code, "IDEMPOTENCY_KEY_REQUIRED", String(bad));
  }
  for (const bad of [undefined, "", "   ", 7]) {
    assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, all, { goalId: "g-1", reason: bad, ...KEY }))).code, "REASON_REQUIRED", `approve ${String(bad)}`);
    assert.equal((await refusal(() => goals.retirePerformanceGoal(deps, all, { goalId: "g-1", reason: bad, ...KEY }))).code, "REASON_REQUIRED", `retire ${String(bad)}`);
  }
  assert.equal((await refusal(() => goals.approvePerformanceGoal(deps, all, { goalId: "g-1", reason: "x".repeat(1001), ...KEY }))).code, "REASON_TOO_LONG");
  assert.equal((await refusal(() => goals.retirePerformanceGoal(deps, all, { goalId: "", reason: "ok", ...KEY }))).code, "GOAL_ID_REQUIRED");
  assert.equal((await refusal(() => goals.createPerformanceGoalDraft(deps, all, { ...DRAFT, ...KEY, supersedesGoalId: 5 }))).code, "GOAL_ID_REQUIRED");
});

test("e. the Analysis > Goals door is earned by the four authoring capabilities and NOT by performance.goal.read alone", () => {
  const surface = authority.EXPERIENCE_SURFACES.find((s) => s.key === "analysis.goals");
  assert.ok(surface, "analysis.goals is a declared surface");
  assert.deepEqual(surface.grants.map((g) => g.capabilityKey).sort(), KEYS);
  assert.ok(!surface.grants.some((g) => g.capabilityKey === "performance.goal.read"), "a read-only holder has no authoring door");
  const client = read("../field-ops-app-vite/src/access/experienceContext.js");
  assert.match(client, /"analysis\.goals"/);
  const nav = read("../field-ops-app-vite/src/navigation/navConfig.js");
  assert.match(nav, /"analysis\/goals": \["analysis\.goals"\]/);
  assert.match(nav, /\{ key: "goals", label: "Goals", path: "goals" \}/);
});

test("f. the authoring module reaches no Firebase and no Firebase-era command service; the window arithmetic is pure UTC", () => {
  const text = tsCode("src/eosOps/performanceGoalAuthoring.ts");
  assert.doesNotMatch(text, /firebase|firestore|performanceGoalCommands|performanceGoalCallables|performanceGoalRepository|recordStandaloneAuditEvent/i);
  assert.equal(goals.previousIsoDate("2026-11-01"), "2026-10-31");
  assert.equal(goals.previousIsoDate("2026-03-01"), "2026-02-28");
  assert.equal(goals.previousIsoDate("2028-03-01"), "2028-02-29");
  assert.equal(goals.previousIsoDate("2027-01-01"), "2026-12-31");
  // BUSINESS_UNIT has no EOS authority (OD-B4-4) and TEAM is never bindable: neither is offered.
  assert.deepEqual([...goals.AUTHORABLE_SCOPES].sort(), ["EMPLOYEE", "FIRM", "LOCATION", "OPERATING_COMPANY"]);
});

// ── G-1b: what GOVERNS a date (the EOS-side selection; the Firebase currentGoalFor is untouched and still APPROVED-only) ──
const reads = require("../lib/eosOps/performanceGoalReads.js");
const T = { metricId: "m.x", targetScopeType: "FIRM", targetScopeId: null };
const DAY = (d) => Date.parse(`${d}T12:00:00.000Z`);
const g = (over) => ({ goalId: "g", metricId: "m.x", targetScopeType: "FIRM", targetScopeId: null, targetValue: 5, unit: "COUNT", direction: "AT_MOST", currency: null,
  effectiveFrom: "2026-10-20", effectiveTo: null, status: "APPROVED", version: 1, createdByUid: "p1", createdAtMillis: 1, approvedByUid: "p2", approvedAtMillis: DAY("2026-10-20"), supersedesGoalId: null, ...over });
const idOf = (list, d) => reads.governingGoalFor(list, T, d)?.goalId ?? null;

test("g1b. F1: a future-dated successor leaves no gap -- the SUPERSEDED predecessor governs to its closed end, the successor from its start", () => {
  const ga = g({ goalId: "ga", status: "SUPERSEDED", effectiveTo: "2026-10-31" });
  const gb = g({ goalId: "gb", version: 2, effectiveFrom: "2026-11-01", supersedesGoalId: "ga", approvedAtMillis: DAY("2026-10-25") });
  const list = [gb, ga];
  assert.deepEqual(["2026-10-19", "2026-10-20", "2026-10-31", "2026-11-01", "2027-01-01"].map((d) => idOf(list, d)), [null, "ga", "ga", "gb", "gb"]);
});

test("g1b. F1: a RETIRED-after-approval version governs the days before its close; a discarded draft (no approver) and a DRAFT never govern", () => {
  const retired = g({ goalId: "r", status: "RETIRED", effectiveTo: "2026-12-20" });
  assert.deepEqual(["2026-10-20", "2026-12-20", "2026-12-21"].map((d) => idOf([retired], d)), ["r", "r", null]);
  const discarded = g({ goalId: "d", status: "RETIRED", approvedByUid: null, approvedAtMillis: null, effectiveTo: "2026-12-20" });
  const draft = g({ goalId: "dr", status: "DRAFT", approvedByUid: null, approvedAtMillis: null });
  assert.equal(idOf([discarded, draft], "2026-11-15"), null);
  assert.equal(idOf([g({ goalId: "blank", status: "RETIRED", approvedByUid: "" })], "2026-11-15"), null, "an empty approver is not approval evidence");
  assert.deepEqual([reads.governsDates(g({ status: "APPROVED" })), reads.governsDates(discarded), reads.governsDates(draft)], [true, false, false]);
});

test("g1b. a SCHEDULED version replaced before it started governs NO date (derived from the approval), one replaced on or after its start governs its window", () => {
  const p = g({ goalId: "p", status: "SUPERSEDED", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30", approvedAtMillis: DAY("2026-01-01") });
  const s = g({ goalId: "s", status: "SUPERSEDED", version: 2, effectiveFrom: "2026-07-01", effectiveTo: null, supersedesGoalId: "p", approvedAtMillis: DAY("2026-03-01") });
  const c = g({ goalId: "c", version: 3, effectiveFrom: "2026-07-01", supersedesGoalId: "s", approvedAtMillis: DAY("2026-03-05") });
  assert.equal(reads.neverGoverned(s, [p, s, c]), true);
  assert.deepEqual(["2026-06-30", "2026-07-01", "2026-12-31"].map((d) => idOf([p, s, c], d)), ["p", "c", "c"], "no ambiguity: the scheduled version is not a candidate");
  // later start: the preceding version covers the gap the scheduled version would have filled (its closed window is moved by the command, not by the read)
  const p2 = { ...p, effectiveTo: "2026-07-14" };
  const c2 = { ...c, effectiveFrom: "2026-07-15" };
  assert.deepEqual(["2026-07-01", "2026-07-14", "2026-07-15"].map((d) => idOf([p2, s, c2], d)), ["p", "p", "c"]);
  // replaced ON its start day or later: it governed
  const started = { ...s, effectiveTo: "2026-07-14" };
  const after = { ...c, effectiveFrom: "2026-07-15", approvedAtMillis: DAY("2026-07-20") };
  assert.equal(reads.neverGoverned(started, [started, after]), false);
  assert.deepEqual(["2026-07-01", "2026-07-14", "2026-07-15"].map((d) => idOf([p, started, after], d)), ["s", "s", "c"]);
  assert.equal(reads.neverGoverned(g({ status: "APPROVED" }), []), false);
  assert.equal(reads.neverGoverned(s, [s]), false, "without an approved successor there is nothing to derive it from");
});

test("g1b. ambiguity is still a REFUSAL: two governing versions on one date raise GOAL_AMBIGUOUS, never the newer or the first", () => {
  const a = g({ goalId: "a", status: "SUPERSEDED", effectiveTo: null });
  const b = g({ goalId: "b", version: 2, effectiveFrom: "2026-11-01", supersedesGoalId: "a", approvedAtMillis: DAY("2026-10-25") });
  for (const order of [[a, b], [b, a]]) {
    assert.throws(() => reads.governingGoalFor(order, T, "2026-11-15"), (e) => e.code === "GOAL_AMBIGUOUS" && /2 governing goals/.test(e.message));
  }
  assert.equal(idOf([a, b], "2026-10-25"), "a", "a date only one covers is not ambiguous");
});

test("g1b. selection is per target and tolerates junk; the Firebase module is untouched and the EOS read no longer uses it for selection", () => {
  const other = g({ goalId: "o", targetScopeType: "OPERATING_COMPANY", targetScopeId: "taylor" });
  assert.equal(idOf([other], "2026-11-01"), null);
  assert.equal(reads.governingGoalFor(undefined, T, "2026-11-01"), null);
  assert.throws(() => reads.governingGoalFor([g({})], T, "11/01/2026"), (e) => e.code === "DATE_INVALID");
  assert.doesNotMatch(tsCode("src/eosOps/performanceGoalReads.ts"), /currentGoalFor/);
  assert.match(tsCode("src/eosOps/performanceGoalAuthoring.ts"), /governingVersions\(versions\)/, "the overlap check uses the governing predicate");
  assert.doesNotMatch(tsCode("src/eosOps/performanceGoalAuthoring.ts"), /status === "APPROVED" && overlaps/);
  // Firebase's own selection still ignores a SUPERSEDED version: nothing in the Firebase domain moved.
  const fb = require("../lib/performance/performanceGoal.js");
  assert.equal(fb.currentGoalFor([g({ goalId: "ga", status: "SUPERSEDED", effectiveTo: "2026-10-31" })], T, "2026-10-25"), null);
});
