// Q-1a (Owner ruling Q1-11), the parts that need no database: the reach object's decisions and SQL, the kernels' fail-closed behaviour, and the structural
// fences (every lock carries the company predicate; the deployed server composes no test seam; allocation decides company before it locks).
// The live proof -- foreign records read as nonexistent with zero trace, the company-less rule, the Administrator before/after diff, allocation -- is
// commercialCompanyAuthorityPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const authority = require("../lib/eosCommercial/commercialCompanyAuthority.js");
const kernel = require("../lib/eosCommercial/commands/commercialCommandKernel.js");
const readKernel = require("../lib/eosCommercial/reads/commercialReadKernel.js");

const reachOf = (over = {}) => authority.commercialCompanyReachOf({
  unrestricted: false, protectedOwner: false, companyKeys: ["taylor-ops"], employeeIds: ["e-1"], creatorId: "p-1", ...over });
const rec = (operatingCompanyKey, ownerRef = "e-9", createdBy = "p-9") => ({ operatingCompanyKey, ownerRef, createdBy });

test("a company-keyed record is reachable only through the caller's company keys; ownership or creation grants nothing there", () => {
  const r = reachOf();
  assert.equal(r.admits(rec("taylor-ops")), true);
  assert.equal(r.admits(rec("ventana-ops")), false);
  assert.equal(r.admits(rec("ventana-ops", "e-1", "p-1")), false, "the owner and creator of a FOREIGN-company record still do not see it");
  assert.equal(r.admits(rec("")), false, "an empty key is not a company");
});

test("a company-less record is visible only to its owner or creator, the protected Administrator and the protected Owner", () => {
  assert.equal(reachOf().admits(rec(null, "e-1", "p-9")), true, "the owner");
  assert.equal(reachOf().admits(rec(null, "e-9", "p-1")), true, "the creator");
  assert.equal(reachOf().admits(rec(null, "e-9", "p-9")), false, "anyone else");
  assert.equal(reachOf({ companyKeys: ["taylor-ops", "ventana-ops"] }).admits(rec(null)), false, "company reach is not a claim on a company-less record");
  assert.equal(reachOf({ protectedOwner: true, employeeIds: [], creatorId: "p-1" }).admits(rec(null)), true, "the protected Owner");
  assert.equal(reachOf({ unrestricted: true, companyKeys: [], employeeIds: [], creatorId: null }).admits(rec(null)), true, "the protected Administrator");
  assert.equal(reachOf({ companyKeys: [], employeeIds: [], creatorId: null }).admits(rec(null, "e-1", "p-1")), false, "an identity gap claims nothing, not even a record it created");
  assert.equal(reachOf().admits(rec(null, null, null)), false, "a record with no owner and no creator is nobody's");
});

test("the protected Administrator is unrestricted: every company, a company-less record and a key no company is bound to", () => {
  const admin = reachOf({ unrestricted: true, companyKeys: [], employeeIds: [], creatorId: "p-admin" });
  for (const k of ["taylor-ops", "ventana-ops", "legacy-key", null]) assert.equal(admin.admits(rec(k)), true, String(k));
  assert.equal(admin.basis, "PROTECTED_ADMINISTRATOR");
  assert.equal(admin.admitsNewCompany("anything"), true);
});

test("creating: a company the caller does not reach is refused; a company-less record is allowed (its creator sees it)", () => {
  const r = reachOf();
  assert.deepEqual([r.admitsNewCompany("taylor-ops"), r.admitsNewCompany("ventana-ops"), r.admitsNewCompany(null)], [true, false, true]);
  assert.equal(reachOf({ companyKeys: [] }).admitsNewCompany("taylor-ops"), false);
});

test("the SQL predicate references exactly three consecutive bind parameters, carries the Administrator and Owner as literals, and refuses a bad alias", () => {
  const sql = reachOf().sql("o", 3);
  assert.match(sql, /\$3::text\[\]/); assert.match(sql, /\$4::text\[\]/); assert.match(sql, /\$5::text/);
  assert.doesNotMatch(sql, /\$6/);
  assert.match(sql, /^\(FALSE OR o\.operating_company_key = ANY\(\$3::text\[\]\)/);
  assert.match(sql, /o\.operating_company_key IS NULL AND \(FALSE OR /);
  assert.match(reachOf({ unrestricted: true }).sql("so", 8), /^\(TRUE OR /);
  assert.match(reachOf({ protectedOwner: true }).sql("a", 1), /IS NULL AND \(TRUE OR /);
  assert.deepEqual(reachOf().sqlParams(), [["taylor-ops"], ["e-1"], "p-1"]);
  assert.deepEqual(reachOf({ companyKeys: [], employeeIds: [], creatorId: null }).sqlParams(), [[], [], null]);
  for (const bad of ["o; DROP TABLE x", "O", "1a", "a.b", ""]) assert.throws(() => reachOf().sql(bad, 3), /bad alias/);
  assert.throws(() => reachOf().sql("o", 0), /bad alias/);
});

test("NO_COMMERCIAL_COMPANY_REACH admits nothing, and the resolver is built from the governed protected-role identity, not role strings", () => {
  assert.equal(authority.NO_COMMERCIAL_COMPANY_REACH.admits(rec("taylor-ops", "e-1", "p-1")), false);
  assert.equal(authority.NO_COMMERCIAL_COMPANY_REACH.admits(rec(null, "e-1", "p-1")), false);
  const src = code("eosCommercial/commercialCompanyAuthority.ts");
  assert.match(src, /hasProtectedAdministratorStanding\(roles, held\)/);
  assert.match(src, /isProtectedOwnerRole\(r\)/);
  assert.doesNotMatch(src, /["']admin["']|["']owner["']/, "no role-key string comparison: the protected identity modules decide it");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/, "the resolver and the helper only read");
});

// A pool that scripts only what runCommercialCommand / runCommercialRead ask before the body.
function fakePool() {
  const calls = [];
  const client = {
    async query(sql) {
      const s = String(sql).trim();
      calls.push(s.split(/\s+/)[0]);
      if (/command_receipts/.test(s) && /^SELECT/.test(s)) return { rows: [] };
      if (/tenant_memberships/.test(s)) return { rows: [{}] };
      return { rows: [] };
    },
    release() { calls.push("RELEASE"); },
  };
  return { calls, pool: { async connect() { return client; } } };
}
const ACTOR = { tenantId: "t1", principalId: "p-1", capabilities: new Set(["opportunity.write", "opportunity.read"]) };
const outcome = { result: { ok: 1 }, target: null, audit: { action: "x.y", targetKind: "opportunity", targetId: "o1", before: null, after: {} } };

test("a command body that never decides company authority is refused and rolled back (fail closed)", async () => {
  const { calls, pool } = fakePool();
  const err = await kernel.runCommercialCommand({ pool, companyReach: async () => reachOf() }, ACTOR, "x.y", ["opportunity.write"], "k", async () => outcome).then(() => null, (e) => e);
  assert.deepEqual([err?.code, err?.category], ["COMPANY_AUTHORITY_NOT_ESTABLISHED", "FORBIDDEN"]);
  assert.ok(calls.includes("ROLLBACK") && !calls.includes("COMMIT"), "nothing committed");
});

test("a command that decides a company (a lock filter or a creation admit) proceeds to its audit and receipt", async () => {
  const { calls, pool } = fakePool();
  const filtered = await kernel.runCommercialCommand({ pool, companyReach: async () => reachOf() }, ACTOR, "x.y", ["opportunity.write"], "k1", async (_db, _now, scope) => {
    const f = scope.companyFilter("o", 3);
    assert.match(f.sql, /^\(FALSE OR o\.operating_company_key = ANY\(\$3::text\[\]\)/);
    assert.deepEqual(f.params, [["taylor-ops"], ["e-1"], "p-1"]);
    return outcome;
  }).catch((e) => e);
  assert.equal(filtered.replayed, false, filtered.message);
  assert.ok(calls.includes("COMMIT"));
  const created = await kernel.runCommercialCommand({ pool: fakePool().pool, companyReach: async () => reachOf() }, ACTOR, "x.y", ["opportunity.write"], "k2", async (_db, _now, scope) => {
    scope.admitNewCompany("taylor-ops", "taylor");
    return outcome;
  }).catch((e) => e);
  assert.equal(created.replayed, false, created.message);
});

test("creating in a company the caller does not reach refuses with the words of an ungoverned company, and nothing commits", async () => {
  const { calls, pool } = fakePool();
  const err = await kernel.runCommercialCommand({ pool, companyReach: async () => reachOf() }, ACTOR, "x.y", ["opportunity.write"], "k", async (_db, _now, scope) => {
    scope.admitNewCompany("ventana-ops", "ventana");
    return outcome;
  }).then(() => null, (e) => e);
  assert.deepEqual([err?.code, err?.category, err?.message], ["OPERATING_COMPANY_NOT_GOVERNED", "PRECONDITION_FAILED", "operating company 'ventana' is not governed in this tenant"]);
  assert.ok(calls.includes("ROLLBACK") && !calls.includes("COMMIT"));
});

test("a read gets the resolved company reach next to the channel reach; a read naming no Commercial capability reaches no record", async () => {
  const seen = [];
  const deps = (resolver) => ({ pool: fakePool().pool, companyReach: resolver });
  await readKernel.runCommercialRead(deps(async () => reachOf()), ACTOR, ["opportunity.read"], () => null, async (_db, _t, _p, reach) => { seen.push(reach); return 1; });
  assert.equal(seen[0].global, true, "the channel reach is unchanged");
  assert.deepEqual([...seen[0].company.companyKeys], ["taylor-ops"]);
  let resolverCalled = false;
  await readKernel.runCommercialRead(deps(async () => { resolverCalled = true; return reachOf(); }), ACTOR, [], () => null, async (_db, _t, _p, reach) => { seen.push(reach); return 1; });
  assert.equal(resolverCalled, false, "no company is resolved for a read that touches no record");
  assert.equal(seen[1].company.admits(rec("taylor-ops", "e-1", "p-1")), false);
});

test("STRUCTURE: every Commercial lock carries the company predicate and every call site hands it the command's scope", () => {
  const store = code("eosCommercial/commands/commercialRecordStore.ts");
  for (const fn of ["lockOpportunity", "lockAgreement", "lockOrderState"]) {
    const body = store.slice(store.indexOf(`export async function ${fn}(`), store.indexOf("\nexport ", store.indexOf(`export async function ${fn}(`) + 10));
    assert.match(body, /scope: CommercialWriteScope/, fn);
    assert.match(body, /scope\.companyFilter\(/, fn);
    assert.match(body, /\$\{company\.sql\}/, `${fn}: the predicate is inside the locking SELECT`);
    assert.match(body, /FOR UPDATE/, fn);
  }
  // EVERY lock carries the predicate -- the by-Opportunity lookups of a derived record included (security review M-3).
  const unfiltered = store.split("export async function ").slice(1)
    .filter((seg) => /FOR UPDATE/.test(seg) && !seg.includes("companyFilter(")).map((seg) => seg.slice(0, seg.indexOf("(")));
  assert.deepEqual(unfiltered, [], "a locking SELECT without the company predicate");
  for (const file of ["opportunityCommandService", "salesAgreementCommandService", "salesOrderCommandService"]) {
    const src = code(`eosCommercial/commands/${file}.ts`);
    for (const m of src.matchAll(/\b(?:lockOpportunity|lockAgreement|lockOrderState)\(/g)) {
      if (src.slice(Math.max(0, m.index - 16), m.index).includes("function ")) continue;
      let depth = 1;
      let i = m.index + m[0].length;
      while (depth > 0 && i < src.length) { if (src[i] === "(") depth++; else if (src[i] === ")") depth--; i++; }
      const args = src.slice(m.index + m[0].length, i - 1);
      assert.match(args, /\bscope$/, `${file}: ${m[0]}${args}) must pass the command scope as its last argument`);
    }
    assert.doesNotMatch(src, /lockOpportunity\(db, (?:actor\.)?tenantId(?:, [^,)]+)?\)/, `${file}: an unscoped lock`);
  }
});

test("STRUCTURE: every Commercial read puts the company predicate inside its SELECT (details, lineage and lists), never after the row is read", () => {
  const expectAll = (file, needles) => { const src = code(file); for (const n of needles) assert.ok(src.includes(n), `${file} is missing ${n}`); return src; };
  expectAll("eosCommercial/reads/opportunityReadProjection.ts", ['reach.company.sql("o", 3)', 'reach.company.sql("sa", 3)', 'reach.company.sql("so", 3)', 'o.company.sql("o", 8)']);
  expectAll("eosCommercial/reads/salesAgreementReadProjection.ts", ['reach.company.sql("a", 3)', 'reach.company.sql("o", 3)', 'reach.company.sql("so", 3)', 'o.company.sql("a", 8)']);
  expectAll("eosCommercial/reads/salesOrderReadProjection.ts", ['reach.company.sql("s", 3)', 'reach.company.sql("o", 3)', 'reach.company.sql("a", 3)', 'o.company.sql("s", 8)']);
  expectAll("eosCommercial/reads/accountCommercialProjection.ts", ["company: reach.company"]);
  const kernelSrc = code("eosCommercial/reads/commercialReadKernel.ts");
  assert.match(kernelSrc, /requiredCapabilities\.length === 0 \? NO_COMMERCIAL_COMPANY_REACH/);
  assert.ok(kernelSrc.indexOf("tenant_memberships") < kernelSrc.indexOf("resolveCommercialCompanyReach)(client"), "company is resolved after the capability and membership checks");
});

test("STRUCTURE: the deployed server and the transport supply NO company seam; the governed resolver always decides in production", () => {
  assert.doesNotMatch(code("eosApi/server.ts"), /companyReach|ALL_COMPANIES/);
  const http = code("eosCommercial/commercialHttp.ts");
  assert.deepEqual([...http.matchAll(/companyReach/g)].length > 0, true);
  assert.doesNotMatch(http, /resolveCommercialCompanyReach|unrestricted|commercialCompanyReachOf/, "the transport forwards a seam it never builds");
  for (const f of ["eosCommercial/commands/commercialCommandKernel.ts", "eosCommercial/reads/commercialReadKernel.ts"]) {
    assert.match(code(f), /\(deps\.companyReach \?\? resolveCommercialCompanyReach\)\(client/, `${f}: absent seam = the governed resolver`);
  }
  // Nothing in src imports the test double.
  for (const f of ["eosCommercial/commercialHttp.ts", "eosApi/server.ts"]) assert.doesNotMatch(read(f), /commercialCompanyReachFixture/);
});

test("STRUCTURE: Sales Order allocation decides the shared Commercial visibility before it locks the order, for allocate, release and read", () => {
  const src = code("eosOps/salesOrderAllocation.ts");
  assert.match(src, /import \{ callerMaySeeSalesOrder, type CommercialCompanyResolver \} from "\.\.\/eosCommercial\/commercialCompanyAuthority\.js"/);
  const stated = src.slice(src.indexOf("async function requireStatedCompanyAndOrder"), src.indexOf("async function requireWarehouseScope"));
  assert.ok(stated.indexOf("callerMaySeeSalesOrder(") > 0 && stated.indexOf("callerMaySeeSalesOrder(") < stated.indexOf("FOR UPDATE"), "no lock-timing oracle on a hidden order");
  assert.match(stated, /resolveInventoryCompanyAuthority/, "the inventory check stays: the decision is the INTERSECTION");
  const readFn = src.slice(src.indexOf("export async function readSalesOrderAllocations"));
  assert.match(readFn, /callerMaySeeSalesOrder\(c, actor, salesOrderId, \[SALES_ORDER_FULFILL_CAPABILITY, SALES_ORDER_READ_CAPABILITY\], deps\.companyReach\)/);
  // The release on cancel/fulfil/close stays after the state UPDATE, in the same transaction, with no try/catch.
  const so = code("eosCommercial/commands/salesOrderCommandService.ts");
  const at = so.indexOf("await releaseSalesOrderClaims(");
  assert.ok(at > so.indexOf("UPDATE eos_commercial.sales_orders SET state"), "release follows the state UPDATE");
  assert.doesNotMatch(so.slice(so.lastIndexOf("try", at) < 0 ? at : Math.max(so.lastIndexOf("try", at), at - 2000), at), /\btry\s*\{/, "no try/catch around the release");
});

test("callerMaySeeSalesOrder decides on company first, then channel, and fails closed on a missing order", async () => {
  const queries = [];
  const db = (rows) => ({ async query(sql, params) { queries.push([String(sql), params]); return { rows }; } });
  const actor = (caps, scopedHeld) => ({ tenantId: "t1", principalId: "p-1", capabilities: new Set(caps), scopedHeld });
  const resolver = async () => reachOf();
  assert.equal(await authority.callerMaySeeSalesOrder(db([]), actor(["salesOrder.fulfill"]), "so-1", ["salesOrder.fulfill"], resolver), false, "no row: company hides it or it is missing");
  assert.match(queries[0][0], /o?\.?operating_company_key = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(queries[0][1], ["t1", "so-1", ["taylor-ops"], ["e-1"], "p-1"]);
  assert.equal(await authority.callerMaySeeSalesOrder(db([{ sales_channel: "RETAIL" }]), actor(["salesOrder.fulfill"]), "so-1", ["salesOrder.fulfill"], resolver), true, "a global holder reaches every channel");
  const scoped = [{ capabilityKey: "salesOrder.read", scopeType: "salesChannel", scopeValue: "RETAIL", sourceRole: "r", assignmentId: null, condition: null }];
  assert.equal(await authority.callerMaySeeSalesOrder(db([{ sales_channel: "RETAIL" }]), actor([], scoped), "so-1", ["salesOrder.read"], resolver), true);
  assert.equal(await authority.callerMaySeeSalesOrder(db([{ sales_channel: "NATIONAL_ACCOUNTS" }]), actor([], scoped), "so-1", ["salesOrder.read"], resolver), false, "channel narrowing applies inside company");
  assert.equal(await authority.callerMaySeeSalesOrder(db([{ sales_channel: "RETAIL" }]), actor([]), "so-1", ["salesOrder.read"], resolver), false, "no capability at all");
});

test("STRUCTURE: the Commercial surfaces outside the transport's record reads also decide company authority in SQL (security review H-1, H-2, M-1, M-3, L-1, L-2)", () => {
  const has = (file, needles) => { const src = code(file); for (const n of needles) assert.ok(src.includes(n), `${file} is missing ${n}`); return src; };
  // H-1 site-wide search: the three Commercial kinds carry the predicate in their WHERE, bound after the channel and reach-key slots.
  const search = has("eosExperience/myWork.ts", ["{{COMPANY_o}} AND (o.opportunity_number ILIKE", "{{COMPANY_o}} AND (o.sales_order_number ILIKE", "{{COMPANY_g}} AND (g.sales_agreement_number ILIKE",
    "resolveCommercialCompanyReach", "company.sql(alias, 4)"]);
  assert.equal([...search.matchAll(/commercial: true/g)].length, 3, "exactly the three Commercial kinds");
  // L-2 My Work: every family of 'records I own / am accountable for'.
  has("eosExperience/myWork.ts", ['company.sql("o", 4)']);
  // H-2 record ownership / accountability: the Commercial families only (CRM families are customer records).
  has("eosWorkforce/reads/employeeResponsibilityReads.ts", ['f.table.startsWith("eos_commercial.")', 'reach.sql("r", 6)']);
  // M-1 coordinated visits: the anchoring Sales Order's number and line refs pass the Sales Order reach.
  has("eosOps/coordinatedVisitPostgresRead.ts", ["reach.sql(\"s\", 3)", "visibleOrders", "resolveCommercialCompanyReach"]);
  // L-1 CRM activity: the Opportunity and Sales Order link probes.
  has("eosCrm/crmActivityAuthority.ts", ['companyReach!.sql("t", 4)', "resolveCommercialCompanyReach", 'company.sql("t", 3)']); // the probe AND the activity list projection
  // Owner review item 9: the summary link fields of details, lists and the Account projection are masked to the reachable.
  has("eosCommercial/reads/commercialReadKernel.ts", ["export async function maskUnreachedLinks", 'company.sql("lo", 3)', 'company.sql("la", 3)']);
  has("eosCommercial/reads/salesAgreementReadProjection.ts", ["maskUnreachedLinks(db, tenantId, reach.company", "maskUnreachedLinks(db, tenantId, o.company"]);
  has("eosCommercial/reads/salesOrderReadProjection.ts", ["maskUnreachedLinks(db, tenantId, reach.company", "maskUnreachedLinks(db, tenantId, o.company"]);
  // M-3 lineage: an Agreement's explicit company must agree with its parent Opportunity's.
  has("eosCommercial/commands/salesAgreementCommandService.ts", ["OPERATING_COMPANY_MISMATCH", "rawFields.operatingCompanyId"]);
  // None of the new seams is composed by the deployed server.
  assert.doesNotMatch(code("eosApi/server.ts"), /companyReach/);
});
