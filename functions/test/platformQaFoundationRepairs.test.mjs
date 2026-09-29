// L5 foundation repairs under Controller rulings 2026-09-28 -- the offline half (no database).
//
//   DQ-007 / XLF-001  employment access eligibility: ACTIVE and CONTRACTOR only, decided in principal resolution.
//   XLF-002           U+0000 anywhere in a request is a governed 400 INVALID_INPUT at every transport envelope.
//   XLF-003           a verified subject EOS does not know is 403 FORBIDDEN on /admin/policy, as on the siblings.
//   XLF-004           an unreadable policy store is a governed 500 INTERNAL from executeAdminOperation, never a throw.
//
// The PostgreSQL half (every persona x status x transport) is platformQaPersonaRuntimeMatrixPostgres E1.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { InMemoryPolicyRepository } = require("../lib/adminPolicy/inMemoryPolicyRepository.js");
const principalContext = require("../lib/adminPolicy/principalContext.js");
const { containsNulCharacter } = require("../lib/adminPolicy/requestText.js");
const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const adminHttp = require("../lib/adminPolicy/adminPolicyHttp.js");
const opsHttp = require("../lib/eosOps/eosOpsHttp.js");
const commercialHttp = require("../lib/eosCommercial/commercialHttp.js");
const crmHttp = require("../lib/eosCrm/crmHttp.js");
const workforceHttp = require("../lib/eosWorkforce/workforceHttp.js");
const catalogHttp = require("../lib/catalogMaster/catalogHttp.js");

const { ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES, employeeAccessIneligibility, resolvePrincipalContext, PrincipalContextError } = principalContext;

test("DQ-007: the eligible set is exactly ACTIVE and CONTRACTOR, and an unknown status fails closed", () => {
  assert.deepEqual([...ACCESS_ELIGIBLE_EMPLOYMENT_STATUSES], ["ACTIVE", "CONTRACTOR"]);
  assert.equal(employeeAccessIneligibility(null), null, "an unlinked Principal is not an Employee and is unaffected");
  for (const s of ["ACTIVE", "CONTRACTOR"]) assert.equal(employeeAccessIneligibility({ employeeId: "e", employmentStatus: s }), null, s);
  for (const s of ["ON_LEAVE", "INACTIVE", "TERMINATED", "RETIRED", "SUSPENDED_FUTURE_VALUE", "", "active"]) {
    assert.ok(employeeAccessIneligibility({ employeeId: "e", employmentStatus: s }), `${s} was treated as eligible`);
  }
  assert.ok(employeeAccessIneligibility({ employeeId: "e", employmentStatus: null }), "an unresolved Employee was treated as eligible");
  assert.ok(employeeAccessIneligibility({ employeeId: "a,b", employmentStatus: "ACTIVE", ambiguous: true }), "an ambiguous link was treated as eligible");
});

async function world() {
  const repo = new InMemoryPolicyRepository();
  const actor = { tenantId: "sys", uid: "sys" };
  const tenant = await repo.transact(actor, (tx) => tx.createTenant({ key: "t-l5", name: "T" }));
  const principal = await repo.transact({ tenantId: tenant.id, uid: "sys" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "subj-l5", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p;
  });
  return { repo, tenant, principal };
}

test("DQ-007: principal resolution refuses a linked ineligible Employee BEFORE any Role is read, and admits an eligible one", async () => {
  for (const [status, allowed] of [["ACTIVE", true], ["CONTRACTOR", true], ["TERMINATED", false], ["ON_LEAVE", false], [null, false]]) {
    const { repo, tenant, principal } = await world();
    repo.seedEmployeeLink(tenant.id, principal.id, "e-1", status);
    let rolesRead = 0;
    const reader = new Proxy(repo, { get(target, prop) {
      if (prop === "listRoles" || prop === "listAssignmentsForPrincipal") rolesRead += 1;
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    } });
    if (allowed) {
      const ctx = await resolvePrincipalContext(reader, { externalSubject: "subj-l5" });
      assert.equal(ctx.uid, principal.id);
    } else {
      await assert.rejects(resolvePrincipalContext(reader, { externalSubject: "subj-l5" }),
        (err) => err instanceof PrincipalContextError && err.refusal === "EMPLOYEE_NOT_ACCESS_ELIGIBLE");
      assert.equal(rolesRead, 0, `${status}: Roles were read before the eligibility refusal`);
    }
  }
});

test("XLF-002: containsNulCharacter finds U+0000 in values and keys at any depth, and nowhere else", () => {
  assert.equal(containsNulCharacter({ a: "ok", b: [1, true, null, { c: "fine" }] }), false);
  assert.equal(containsNulCharacter("a\u0000b"), true);
  assert.equal(containsNulCharacter({ a: ["x", { deep: "y\u0000" }] }), true);
  assert.equal(containsNulCharacter({ ["k\u0000"]: 1 }), true);
  let nested = "x"; for (let i = 0; i < 100; i += 1) nested = [nested];
  assert.equal(containsNulCharacter(nested), true, "absurd nesting is refused rather than walked");
});

test("XLF-002: every transport refuses U+0000 with 400 INVALID_INPUT at the envelope -- before identity is even asked", async () => {
  let verified = 0;
  const verifyToken = async () => { verified += 1; throw new Error("must not be reached"); };
  const body = JSON.stringify({ operation: "x", input: { name: "a\u0000b" } });
  const req = (url) => ({ method: "POST", url, headers: { authorization: "Bearer t" }, body });
  const results = {
    administration: await adminHttp.handleAdminRequest({ repo: {}, verifyToken }, req("/admin/policy")),
    operations: await opsHttp.handleOperationsRequest({ reader: {}, pool: {}, verifyToken }, req("/operations/inventory")),
    commercial: await commercialHttp.handleCommercialRequest({ reader: {}, pool: {}, verifyToken }, req("/commercial/sales")),
    crm: await crmHttp.handleCrmRequest({ reader: {}, pool: {}, verifyToken }, req("/crm/customer")),
    workforce: await workforceHttp.handleWorkforceRequest({ reader: {}, pool: {}, verifyToken }, req("/workforce/employees")),
    catalog: await catalogHttp.handleCatalogRequest({ reader: {}, pool: {}, verifyToken }, req(catalogHttp.CATALOG_ROUTE)),
  };
  for (const [name, r] of Object.entries(results)) {
    assert.deepEqual([r.status, JSON.parse(r.body).code], [400, "INVALID_INPUT"], name);
  }
  assert.equal(verified, 0);
});

test("XLF-003 + XLF-004: an unknown subject is FORBIDDEN, and an unreadable store is a governed INTERNAL (no throw)", async () => {
  const { repo } = await world();
  const unknown = await executeAdminOperation({ repo }, { caller: { externalSubject: "nobody", identityProvider: "firebase" }, operation: "listRoles", input: {} });
  assert.deepEqual([unknown.ok, unknown.code, unknown.message], [false, "FORBIDDEN", "this identity is not known to EOS"]);
  const broken = new Proxy(repo, { get(target, prop) {
    if (prop === "getPrincipalBySubject") return async () => { throw new Error("connect ECONNREFUSED 10.0.0.7:5432"); };
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  } });
  const original = console.error;
  console.error = () => {};
  try {
    const outage = await executeAdminOperation({ repo: broken }, { caller: { externalSubject: "subj-l5", identityProvider: "firebase" }, operation: "listRoles", input: {} });
    assert.deepEqual([outage.ok, outage.code], [false, "INTERNAL"]);
    assert.doesNotMatch(JSON.stringify(outage), /ECONNREFUSED|10\.0\.0\.7/);
    const http = await adminHttp.handleAdminRequest({ repo: broken, verifyToken: async () => ({ externalSubject: "subj-l5", identityProvider: "firebase" }), allowedOrigins: ["https://app.example"] },
      { method: "POST", url: "/admin/policy", headers: { authorization: "Bearer t", origin: "https://app.example" }, body: JSON.stringify({ operation: "listRoles" }) });
    assert.equal(http.status, 500);
    assert.equal(http.headers["access-control-allow-origin"], "https://app.example", "the outage answer is readable by the browser");
  } finally {
    console.error = original;
  }
});
