// DWO-company (DECISIONS #DWO-company) -- the OFFLINE half: the one reach object and its predicate, the closed inventory of Work Order entry points, and the
// structural fence over every source that reads eos_ops.work_orders. No database; the PostgreSQL half is workOrderCompanyBoundaryPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { WORK_ORDER_ROUTE_ENTRY_POINTS, OTHER_ROUTE_WORK_ORDER_ENTRY_POINTS } from "./support/workOrderCompanyEntryPoints.mjs";

const require = createRequire(import.meta.url);
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(FUNCTIONS_DIR, "src");
const authority = require("../lib/eosOps/workOrderCompanyAuthority.js");
const ops = require("../lib/eosOps/workOrderOperations.js");
const coordinated = require("../lib/eosOps/coordinatedVisitPostgresRead.js");

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
const source = (rel) => strip(readFileSync(join(SRC, rel), "utf8"));

test("the reach: own keys, the unrestricted Administrator form, and a predicate that is one bound array", () => {
  const own = authority.workOrderCompanyReachOf({ unrestricted: false, hasAuthority: true, companyKeys: ["taylor"], employeeIds: ["e-1"] });
  assert.equal(own.admits("taylor"), true);
  assert.equal(own.admits("ventana"), false, "a foreign company is not admitted");
  assert.equal(own.admits(null), false);
  assert.equal(own.admits(undefined), false);
  assert.deepEqual(own.sqlParams(), [["taylor"], ["e-1"]]);
  const assigned = " OR EXISTS (SELECT 1 FROM eos_ops.work_order_assignments wra WHERE wra.tenant_id = w.tenant_id AND wra.work_order_id = w.id AND wra.effective_to IS NULL"
    + " AND wra.assignee_employee_id = ANY($4::text[])))";
  assert.equal(own.sql("w.operating_company_key", 3), "(FALSE OR w.operating_company_key = ANY($3::text[])" + assigned, "the company, or the OPEN assignment of the caller's Employee");
  // F4: the OFFICE side has no assignment branch (same bind arity; the second bind is referenced by a no-op).
  assert.equal(own.sql("w.operating_company_key", 3, { assignment: false }), "((FALSE OR w.operating_company_key = ANY($3::text[])) AND ($4::text[] IS NULL OR TRUE))");
  assert.equal(/work_order_assignments/.test(own.sql("w.operating_company_key", 3, { assignment: false })), false);
  // F2: an OPEN assignment alone is authority over its Work Order (the home company may be inactive or unkeyed): no company keys, one Employee.
  const assignmentOnly = authority.workOrderCompanyReachOf({ unrestricted: false, hasAuthority: false, companyKeys: [], employeeIds: ["e-1"] });
  assert.equal(assignmentOnly.admits("taylor"), false, "...but never a company");
  assert.match(own.sql("operating_company_key", 1), /wra\.tenant_id = work_orders\.tenant_id AND wra\.work_order_id = work_orders\.id/, "an unaliased eos_ops.work_orders is addressed as work_orders");
  const admin = authority.workOrderCompanyReachOf({ unrestricted: true, hasAuthority: true, companyKeys: [] });
  assert.equal(admin.admits("ventana"), true, "the protected Administrator keeps every company, as before");
  assert.equal(admin.admits("a-key-no-company-is-bound-to"), true, "including a historical key");
  assert.match(admin.sql("operating_company_key", 1), /^\(TRUE OR operating_company_key = ANY\(\$1::text\[\]\)/);
  assert.deepEqual(authority.NO_WORK_ORDER_COMPANY_REACH.companyKeys, []);
  assert.equal(authority.NO_WORK_ORDER_COMPANY_REACH.admits("taylor"), false);
  assert.equal(authority.NO_WORK_ORDER_COMPANY_REACH.hasAuthority, false);
  // The predicate names a code-supplied column and a positive parameter; anything else is refused, never interpolated.
  for (const bad of ["w.operating_company_key; DROP TABLE x", "w.a.b", "1x", "", "w.operating_company_key OR TRUE", "w.status", "operating_company_key OR TRUE"]) {
    assert.throws(() => own.sql(bad, 1), /bad column/, bad);
  }
  assert.throws(() => own.sql("w.operating_company_key", 0), /bad column or parameter/);
  assert.throws(() => own.sql("w.operating_company_key", 1.5), /bad column or parameter/);
  // The reach object is frozen: a caller cannot widen it after the fact.
  assert.equal(Object.isFrozen(own), true);
  assert.equal(Object.isFrozen(own.companyKeys), true);
});

test("no authority at all is COMPANY_AUTHORITY_REQUIRED, decided before any Work Order row is read", async () => {
  const refusals = [];
  const refuse = (code, category, message) => { refusals.push([code, category, message]); throw new Error("refused"); };
  // A database that has no principal: resolveCompanyAuthority answers PRINCIPAL_NOT_ACTIVE, and the Administrator test finds no qualifying Role.
  const calls = [];
  const db = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  await assert.rejects(authority.requireWorkOrderCompanyReach(db, "t", "p", refuse), /refused/);
  assert.deepEqual(refusals[0].slice(0, 2), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
  assert.equal(calls.some((s) => /FROM\s+eos_ops\.work_orders/i.test(s)), false, "no Work Order row was read");
  // OWN mode never consults the Administrator standing (the entry points that were already bounded stay bounded).
  calls.length = 0;
  await authority.resolveWorkOrderCompanyReach(db, "t", "p", { administrator: "OWN" });
  assert.equal(calls.some((s) => /user_role_assignments/i.test(s) && /r\.protected/i.test(s)), false, "OWN mode does not read the protected-Administrator standing");
});

test("the inventory is closed: every operation of the Work Order table is classified, and nothing else is", () => {
  assert.deepEqual(Object.keys(ops.EOS_WORK_ORDER_OPERATIONS).sort(), Object.keys(WORK_ORDER_ROUTE_ENTRY_POINTS).sort(),
    "classify a new Work Order operation in test/support/workOrderCompanyEntryPoints.mjs (and cover it in the PostgreSQL boundary suite)");
  const kinds = new Set(Object.values(WORK_ORDER_ROUTE_ENTRY_POINTS));
  assert.deepEqual([...kinds].sort(), ["AGGREGATE", "CREATE", "EMPLOYEE", "ID", "ID_OWN", "ID_RELATION", "LIST", "NONE", "POLICY", "SELLER_PROJECTION"]);
});

// Every runtime source that reads eos_ops.work_orders, and how its company boundary is decided. A NEW file that reads the table fails here until it is classified.
// The Work Order row AND its children: a source that reads only a child table (labor, transitions, assignments, execution records, the parts plan, schedule history,
// self-scheduling sessions, inbound links, Sales Order line joins) is still a reader of Work Order data and must decide its company boundary.
const READS_WORK_ORDER_DATA = /(?:eos_ops|\$\{[A-Z_]*SCHEMA\})\.(?:work_orders|work_order_labor_entries|work_order_transitions|work_order_assignments|work_order_execution_records|work_order_parts_plan|work_order_schedule_history|work_order_sales_order_lines|self_scheduling_sessions|inbound_work_order_links)\b/;
const SCOPED_BY_DWO = ["eosExperience/myWork.ts", "eosOps/coordinatedVisitPostgresRead.ts", "eosOps/equipmentOperations.ts", "eosOps/inboundWorkDecisions.ts",
  "eosOps/selfScheduling.ts", "eosOps/workOrderAnalytics.ts", "eosOps/workOrderEquipmentInstall.ts", "eosOps/workOrderExecution.ts", "eosOps/workOrderFieldContext.ts",
  "eosOps/workOrderLabor.ts", "eosOps/workOrderLifecycle.ts", "eosOps/workOrderPartsPlanAuthority.ts", "eosOps/workOrderQueries.ts", "eosOps/workOrderScheduling.ts",
  "eosWorkforce/reads/assignedWorkReads.ts"];
// DWO-1: the seller's narrow read-only projection of a Service Work Order another company performs for its Sales Order (decided on the SALES ORDER, not on the Work Order's company).
const SELLER_PROJECTION_SOURCE = "eosOps/salesOrderServiceWorkOrders.ts";
const SCOPED_BEFORE_DWO = {
  // Bounded by the caller's own company authority before this lane (#235, D-248-1, G-9); unchanged.
  "eosOps/workOrderAvailability.ts": "suggestWorkOrderPlacement and the placement reads: companies via requireCompanyAuthority / resolveCompanyAuthority",
  "eosOps/workOrderCreateCommand.ts": "create: the stated company must be one the caller is authorized for; the Sales Order link is Q-1a",
  "eosAnalysis/measures.ts": "Analysis measures filter on the caller's company keys (w.operating_company_key = ANY($2))",
  "eosRental/rental.ts": "Work Orders read through a Rental Agreement the caller's company reach already decided; a rental Work Order is the agreement's company (RENTAL_COMPANY_MISMATCH at create)",
};
const NOT_AN_ENTRY_POINT = {
  "eosOps/contextualAuthorization.ts": "the record-RELATION reader (is the caller the assigned Employee): runs after the capability and decides only the relation; the company layer follows in each command",
  "eosOps/workOrderListQuery.ts": "the filter-expression vocabulary of the office list, whose SELECT (workOrderQueries.ts) carries the caller's company keys",
  "eosOps/workOrderCompanyAuthority.ts": "the predicate itself",
  "eosCommercial/fulfillment/salesOrderFulfillmentAuthority.ts": "system code inside the completion transaction, after the Work Order was locked under the caller's company reach",
  "eosOps/inboundWorkRecovery.ts": "recovery of an ACCEPTING claim, keyed by the derived create key of the claim; not a Work Order id from the caller",
  "eosOps/inventoryCommitmentRepository.ts": "no caller constructs a WORK_ORDER demand source (the Sales Order allocation and parts reads use SALES_ORDER); inventory company checks apply",
  "eosOps/workOrderAssignmentAuthority.ts": "assignWithinTransaction runs inside Schedule / Dispatch after their own company lock; assignWorkOrderToEmployee has no transport",
  "adminPolicy/migration/credEquivalence.ts": "documentation text, not a query",
  "eosOps/migration/coordinatedVisitAnchorCensus.ts": "offline migration census tooling",
  "eosOps/migration/workOrderFieldParityMatrix.ts": "offline migration parity documentation",
  "eosOps/migration/workOrderMigrationCopy.ts": "offline migration copy tooling",
  "eosOps/migration/workOrderMigrationDryRun.ts": "offline migration dry-run tooling",
};

test("the fence: every source that reads eos_ops.work_orders is classified, and each classification is true of the source", () => {
  const readers = walk(SRC).map((f) => relative(SRC, f).replace(/\\/g, "/"))
    .filter((rel) => READS_WORK_ORDER_DATA.test(source(rel)));
  const classified = [SELLER_PROJECTION_SOURCE, ...SCOPED_BY_DWO, ...Object.keys(SCOPED_BEFORE_DWO), ...Object.keys(NOT_AN_ENTRY_POINT)];
  assert.deepEqual(readers.filter((r) => !classified.includes(r)), [], "a new reader of eos_ops.work_orders must decide its company boundary and be classified in this fence");
  assert.deepEqual(classified.filter((c) => !readers.includes(c)), [], "a classified source no longer reads Work Order data: remove it from the fence");
  for (const rel of SCOPED_BY_DWO) {
    const s = source(rel);
    assert.match(s, /from "(?:\.\.?\/)+(?:eosOps\/)?workOrderCompanyAuthority(?:\.js)?"/, `${rel}: imports the ONE Work Order company reach`);
    assert.match(s, /(?:reach|Reach)\.sql\(/, `${rel}: puts the predicate inside its SQL`);
  }
  for (const rel of Object.keys(SCOPED_BEFORE_DWO)) {
    const s = source(rel);
    assert.match(s, /resolveCompanyAuthority|requireCompanyAuthority|companyKeys|operating_company_key = ANY/, `${rel}: keeps its own company authority`);
  }
});

// A FROM / JOIN of eos_ops.work_orders in a DWO-scoped source is either scoped by the reach predicate in the SAME statement, or is one of these, each with its reason.
const STATEMENT_JUSTIFICATIONS = [
  ["eosOps/coordinatedVisitPostgresRead.ts", "FROM eos_ops.work_order_sales_order_lines", "line refs for Work Orders the page already admitted"],
  ["eosOps/inboundWorkDecisions.ts", "create_idempotency_key = $3", "the Accept's own existence probe on the caller's own derived create key"],
  ["eosOps/selfScheduling.ts", "w.estimated_duration_minutes, w.scheduled_start", "the private row read, called only after the reach probe of issueSelfSchedulingLink"],
  ["eosOps/workOrderExecution.ts", "SELECT operating_company_key FROM", "truck consumption: reads the company of a Work Order already locked under the caller's reach in the same transaction"],
  ["eosOps/workOrderQueries.ts", "FROM ${SCHEMA}.work_orders w LEFT JOIN", "SUMMARY_FROM: the row shape; every caller appends the predicate (detail, mine) or the office list's company keys"],
  ["eosOps/workOrderQueries.ts", "operating_company_key = ANY($3::text[])", "listWorkOrderTechnicians: the pre-existing own-company keys (the picker's read authority)"],
  ["eosOps/workOrderScheduling.ts", "JOIN ${SCHEMA}.work_order_assignments a", "an Employee's OTHER jobs (schedule conflict, double booking): the placement check, run after the lock"],
];
const SCOPE_EVIDENCE = /\.sql\(|\bownPredicate\b|\{\{WO_COMPANY\}\}/;
test("per statement: every FROM / JOIN of eos_ops.work_orders in a scoped source carries the reach predicate or a recorded justification", () => {
  const unscoped = [];
  for (const rel of [...SCOPED_BY_DWO, SELLER_PROJECTION_SOURCE]) {
    const s = source(rel);
    for (const m of s.matchAll(/(?:FROM|JOIN)\s+(?:eos_ops|\$\{[A-Z_]*SCHEMA\})\.work_orders\b/g)) {
      const a = s.lastIndexOf("`", m.index);
      const b = s.indexOf("`", m.index);
      const statement = s.slice(a, b).replace(/\s+/g, " ");
      if (SCOPE_EVIDENCE.test(statement)) continue;
      if (rel === SELLER_PROJECTION_SOURCE && /sales_order_service_providers/.test(statement)) continue;   // the lineage join is this source's own scoping
      if (STATEMENT_JUSTIFICATIONS.some(([file, needle]) => file === rel && statement.includes(needle))) continue;
      unscoped.push(rel + " :: " + statement.slice(0, 120));
    }
    // the child-table justifications must still match something (a stale justification is a hole in the fence)
  }
  assert.deepEqual(unscoped, [], "a statement over eos_ops.work_orders must carry the reach predicate or be recorded in STATEMENT_JUSTIFICATIONS with its reason");
  for (const [file, needle] of STATEMENT_JUSTIFICATIONS) assert.ok(source(file).replace(/\s+/g, " ").includes(needle), "stale justification: " + file + " :: " + needle);
});

test("the entry points of the OTHER routes are all in scoped sources, and every scoped source outside the Work Order route is one of them", () => {
  const files = new Set(Object.values(OTHER_ROUTE_WORK_ORDER_ENTRY_POINTS).map((e) => e.file));
  for (const f of files) assert.ok(SCOPED_BY_DWO.includes(f), f + ": an entry point of another route must live in a DWO-scoped source");
  const routeOwned = (f) => /^eosOps\/(workOrder|selfScheduling)/.test(f);
  for (const f of SCOPED_BY_DWO) assert.ok(routeOwned(f) || files.has(f), f + ": a scoped source outside the Work Order route must back a recorded entry point");
  for (const [name, e] of Object.entries(OTHER_ROUTE_WORK_ORDER_ENTRY_POINTS)) assert.ok(["ID", "LIST"].includes(e.kind), name);
});

test("no source composes a second Work Order company policy: the only SQL predicates on operating_company_key for Work Orders come from the reach object", () => {
  for (const rel of SCOPED_BY_DWO) {
    const s = source(rel);
    // A hand-written company filter on the work_orders alias in a DWO-scoped file would be a second policy engine. (The Work Order list / technicians in workOrderQueries.ts
    // predate this lane and keep their own company keys; they are the documented exception.)
    if (rel === "eosOps/workOrderQueries.ts") continue;
    assert.equal(/\bw\.operating_company_key\s*=\s*ANY\(\s*\$/.test(s), false, `${rel}: no hand-written company predicate`);
  }
});

test("the lock: every command that locks a Work Order in the scheduling module carries the reach, with its recorded Administrator mode", () => {
  const s = source("eosOps/workOrderScheduling.ts");
  const calls = [...s.matchAll(/await lockWorkOrder\(([^)]*\)[^;]*);/g)].map((m) => m[1]);
  assert.equal(calls.length, 5, "schedule, unschedule, reschedule, dispatch, complete");
  assert.equal(calls.filter((c) => /administrator: "OWN"/.test(c)).length, 3, "schedule / reschedule / dispatch stay bounded by the Administrator's own authority (D-248-1)");
  assert.equal(calls.filter((c) => /administrator: "UNRESTRICTED"/.test(c)).length, 2, "unschedule / complete were tenant-wide and stay so for the Administrator");
  assert.match(s, /FOR UPDATE/);
});

test("coordinated operations: the governed entry point supplies the Work Order reach, and the predicate is in the SQL before the page is cut", async () => {
  const governed = source("eosOps/coordinatedVisitPostgresRead.ts");
  assert.match(governed, /readActiveCoordinatedWorkOrdersFromPostgres\(client, actor\.tenantId, undefined, reach, workOrderReach\)/, "the governed read always supplies the reach");
  const captured = [];
  const db = { async query(sql, params) { captured.push({ sql, params }); return { rows: [] }; } };
  const own = authority.workOrderCompanyReachOf({ unrestricted: false, hasAuthority: true, companyKeys: ["taylor"] });
  await coordinated.readActiveCoordinatedWorkOrdersFromPostgres(db, "t1", undefined, undefined, own);
  const first = captured[0];
  assert.match(first.sql, /AND \(\(\(FALSE OR w\.operating_company_key = ANY\(\$4::text\[\]\)\) AND \(\$5::text\[\] IS NULL OR TRUE\)\) OR FALSE\)/, "an office list: the company, no assignment branch, and no seller branch without a Commercial reach");
  assert.match(first.sql, /LIMIT \$3/, "the predicate precedes the page cut");
  assert.deepEqual(first.params.slice(3), [["taylor"], []]);
  captured.length = 0;
  const admin = authority.workOrderCompanyReachOf({ unrestricted: true, hasAuthority: true, companyKeys: [] });
  await coordinated.readActiveCoordinatedWorkOrdersFromPostgres(db, "t1", undefined, undefined, admin);
  assert.match(captured[0].sql, /\(TRUE OR w\.operating_company_key/);
  // Absent reach (the parity seam / census) is unchanged: no predicate at all.
  captured.length = 0;
  await coordinated.readActiveCoordinatedWorkOrdersFromPostgres(db, "t1");
  assert.equal(/ANY\(\$4/.test(captured[0].sql), false);
});

test("the seller projection (DWO-1): read-only, decided on the Sales Order and the governed lineage, no Firebase, no blanket grant, no restricted field", () => {
  const raw = readFileSync(join(SRC, SELLER_PROJECTION_SOURCE), "utf8");
  const code = source(SELLER_PROJECTION_SOURCE);
  assert.match(code, /callerMaySeeSalesOrder\(/, "the Sales Order is decided by the one shared Commercial decision");
  assert.match(code, /JOIN eos_commercial\.sales_order_service_providers/, "the lineage is the seller's service-provider authorization");
  assert.match(code, /w\.sales_order_id = \$2/, "the Work Order carries THIS Sales Order");
  assert.match(code, /w\.operating_company_key <> \$3/, "only another company's Work Orders");
  assert.equal(/\b(INSERT|UPDATE|DELETE|TRUNCATE|FOR UPDATE)\b/i.test(code), false, "a read: no write and no lock");
  assert.equal(/firebase|firestore|fieldops_|getFirestore/i.test(raw), false, "no Firebase dependency");
  assert.equal(/customer_id|customer_name|account_id/.test(code), false, "never inferred from customer identity");
  // Not one restricted field is selected: no complaint, diagnosis, notes, labor, parts, costs, rates, attachments, assignee or equipment.
  const start = code.indexOf("SERVICE_PROJECTION_COLUMNS = `");
  assert.ok(start >= 0, "the projection has ONE column list, shared by the Sales Order read and the coordinated-visit read");
  const selected = code.slice(start, code.indexOf("`;", start));
  assert.ok(selected.length > 100);
  assert.match(code, /SELECT \$\{SERVICE_PROJECTION_COLUMNS\}\s+FROM eos_ops\.work_orders w/);
  assert.match(source("eosOps/coordinatedVisitPostgresRead.ts"), /\$\{SERVICE_PROJECTION_COLUMNS\}, w\.customer_id/, "the coordinated read selects the same list (plus its own legacy columns for own-company rows)");
  for (const banned of ["complaint", "diagnosis", "note", "labor", "parts", "cost", "price", "rate", "attachment", "assignee", "equipment", "estimated_duration", "created_by"]) {
    assert.equal(selected.includes(banned), false, "the projection selects no " + banned);
  }
  // No blanket grant: the operation adds no capability, no migration is part of this lane, and the ordinary Work Order read does not mention the seller.
  assert.equal(/INSERT INTO eos_policy|role_capabilities|grantCapability/.test(code), false);
  assert.equal(/sales_order_service_providers|callerMaySeeSalesOrder/.test(source("eosOps/workOrderQueries.ts")), false, "ordinary Work Order detail is not opened to the seller");
  assert.equal(/sales_order_service_providers|callerMaySeeSalesOrder/.test(source("eosOps/workOrderCompanyAuthority.ts")), false, "the company reach has no seller branch");
});

test("the deployed server supplies no company seam of its own: the governed resolver always decides", () => {
  for (const rel of ["eosApi/server.ts", "index.ts"]) {
    const s = source(rel);
    assert.equal(/WorkOrderCompanyReach|workOrderCompanyReach|resolveWorkOrderCompanyReach/.test(s), false, `${rel}: composes no Work Order company reach`);
  }
  // No production source injects a reach: it is resolved inside each entry point from the verified caller.
  const injected = walk(SRC).map((f) => relative(SRC, f).replace(/\\/g, "/")).filter((rel) => /workOrderCompanyReach\s*[:=]\s*(?!await)/.test(source(rel)) && !rel.endsWith("workOrderCompanyAuthority.ts"));
  assert.deepEqual(injected, []);
});
