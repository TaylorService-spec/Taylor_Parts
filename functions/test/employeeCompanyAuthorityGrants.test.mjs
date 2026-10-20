// EMPLOYEE COMPANY-ACCESS GRANTS (DECISIONS #249, Option A) -- the offline half (no database).
//
// A company-access grant is REACH to a company for one Employee. It is not a Role, not a capability and not Finance access.
// These proofs cover what needs no database: the order of the refusals in the commands (gate first, then shape, then the
// store), the closed shape of the migration, and that nothing but the company-authority resolver (and the preview that reports
// it) reads the new table. The behaviour against a real PostgreSQL -- reach, revocation, expiry, anti-escalation, audit,
// preview/digest, the store guard and the down path -- is employeeCompanyAuthorityGrantsPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as commands from "../lib/adminPolicy/policyCommands.js";
import { AdministrationCapabilityDeniedError } from "../lib/adminPolicy/administrationAuthority.js";

const FUNCTIONS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(FUNCTIONS, "..");
const read = (p) => readFileSync(resolve(FUNCTIONS, p), "utf8").replace(/\r\n/g, "\n");

const TENANT = "t-ecag-offline";
const ACTOR = "p-actor";
const holder = Object.freeze({ tenantId: TENANT, uid: ACTOR, heldRoleKeys: [], capabilities: new Set(["admin.roleAssignment.write"]) });
const denied = Object.freeze({ tenantId: TENANT, uid: ACTOR, heldRoleKeys: [], capabilities: new Set(["admin.principalAccess.read"]) });

/** A store that records what it was asked, so a refusal that happens BEFORE the store can be proved. */
function stubRepo({ link = null, employee = { employeeId: "e-1", homeOperatingCompanyId: "taylor" }, grants = [], companies = ["taylor", "ventana"], owner = false } = {}) {
  const calls = [];
  const note = (name, value) => async (...args) => { calls.push(name); return typeof value === "function" ? value(...args) : value; };
  const repo = {
    calls,
    // The central seam's reads (DECISIONS #SAE): the protected Owner's waiver of SELF_ADMINISTRATION. Not recorded in `calls`: they are not the grant's own reads.
    getMembership: async () => ({ status: "active" }),
    getPrincipal: async () => ({ id: ACTOR, status: "active" }),
    getAccessVersion: async () => ({ accessVersion: 1 }),
    listObjects: async () => [],
    listRoles: async () => [{ id: "r-owner", key: owner ? "owner" : "someRole", protected: owner ? true : false }],
    listAssignmentsForPrincipal: async () => [{ id: "a-1", roleId: "r-owner", status: "active", scopeType: "global", accessVersionAtGrant: 1 }],
    getLinkedEmployeeAccessFact: note("getLinkedEmployeeAccessFact", link),
    readCompanyGrantEmployee: note("readCompanyGrantEmployee", employee),
    readCompanyAuthorityGrant: note("readCompanyAuthorityGrant", null),
    listCompanyAuthorityGrants: note("listCompanyAuthorityGrants", grants),
    listAssignmentScopeValues: note("listAssignmentScopeValues", companies.map((c) => ({ value: c, label: c }))),
    transact: async () => { calls.push("transact"); throw new Error("the stub never opens a transaction"); },
  };
  return repo;
}
const refusal = (code) => (err) => err?.constructor?.name === "AdministrationRefusal" && err.code === code;
const base = { employeeId: "e-1", operatingCompanyId: "ventana", reason: "cover while Ana is out" };

test("the gate is admin.roleAssignment.write, decided before anything is read", async () => {
  const repo = stubRepo();
  await assert.rejects(() => commands.grantCompanyAuthority(repo, denied, base), AdministrationCapabilityDeniedError);
  await assert.rejects(() => commands.revokeCompanyAuthority(repo, denied, { grantId: "g-1", reason: "done" }), AdministrationCapabilityDeniedError);
  assert.deepEqual(repo.calls, [], "a principal who may not grant learns nothing");
});

test("a stated reason is required, for the grant and for the revoke", async () => {
  const repo = stubRepo();
  for (const reason of [undefined, null, "", "   "]) {
    await assert.rejects(() => commands.grantCompanyAuthority(repo, holder, { ...base, reason }), refusal("REASON_REQUIRED"), String(reason));
    await assert.rejects(() => commands.revokeCompanyAuthority(repo, holder, { grantId: "g-1", reason }), refusal("REASON_REQUIRED"), String(reason));
  }
  assert.deepEqual(repo.calls, []);
});

test("effective dates: an offset is required, the end must follow the start and be in the future (all before the store)", async () => {
  const repo = stubRepo();
  const refused = (extra) => assert.rejects(() => commands.grantCompanyAuthority(repo, holder, { ...base, ...extra }), refusal("COMPANY_GRANT_WINDOW_INVALID"), JSON.stringify(extra));
  await refused({ effectiveFrom: "2030-01-01T00:00:00" });
  await refused({ effectiveUntil: "2030-01-01" });
  await refused({ effectiveUntil: "not a date" });
  await refused({ effectiveFrom: "2031-01-01T00:00:00Z", effectiveUntil: "2030-01-01T00:00:00Z" });
  await refused({ effectiveFrom: "2031-01-01T00:00:00Z", effectiveUntil: "2031-01-01T00:00:00Z" });
  await refused({ effectiveUntil: "2001-01-01T00:00:00Z" });
  assert.deepEqual(repo.calls, [], "no date is accepted or refused by guessing the server's zone, and none reaches the store");
});

test("nobody staffs themselves: a grant to the actor's OWN linked Employee is SELF_ADMINISTRATION, before any other read", async () => {
  const repo = stubRepo({ link: { employeeId: "e-1", employmentStatus: "ACTIVE" } });
  await assert.rejects(() => commands.grantCompanyAuthority(repo, holder, base), refusal("SELF_ADMINISTRATION"));
  assert.ok(!repo.calls.some((c) => c !== "getLinkedEmployeeAccessFact"), "refused on the link alone (and the seam's re-read of it): no Employee, company or grant was read");
  // DECISIONS #SAE: ONLY the governed protected Owner is waived this refusal (the seam); an Administrator, or a role merely NAMED like it, is not.
  const unprotectedOwnerName = stubRepo({ link: { employeeId: "e-1", employmentStatus: "ACTIVE" }, owner: false });
  await assert.rejects(() => commands.grantCompanyAuthority(unprotectedOwnerName, holder, base), refusal("SELF_ADMINISTRATION"));
  const protectedOwner = stubRepo({ link: { employeeId: "e-1", employmentStatus: "ACTIVE" }, owner: true });
  await assert.rejects(() => commands.grantCompanyAuthority(protectedOwner, holder, base), /the stub never opens a transaction/);
  assert.ok(protectedOwner.calls.includes("readCompanyGrantEmployee"), "the protected Owner proceeds to the ordinary checks (company, Employee, window, capability) -- the waiver removes only the self refusal");  // An ambiguous link carries every employee id; the actor is any of them.
  const ambiguous = stubRepo({ link: { employeeId: "e-0,e-1", employmentStatus: null, ambiguous: true } });
  await assert.rejects(() => commands.grantCompanyAuthority(ambiguous, holder, base), refusal("SELF_ADMINISTRATION"));
  // A different Employee is not the actor's own: the command moves on to the Employee lookup (and stops at the stub's transaction).
  const other = stubRepo({ link: { employeeId: "e-9", employmentStatus: "ACTIVE" } });
  await assert.rejects(() => commands.grantCompanyAuthority(other, holder, base), /the stub never opens a transaction/);
  assert.ok(other.calls.includes("readCompanyGrantEmployee"));
});

test("the company is checked against the Employee and the governed list: home company and unknown company are refused", async () => {
  const home = stubRepo({ link: null });
  await assert.rejects(() => commands.grantCompanyAuthority(home, holder, { ...base, operatingCompanyId: "taylor" }), refusal("COMPANY_IS_HOME"));
  const unknownCompany = stubRepo({ link: null });
  await assert.rejects(() => commands.grantCompanyAuthority(unknownCompany, holder, { ...base, operatingCompanyId: "elsewhere" }), refusal("SCOPE_VALUE_INVALID"));
  const noEmployee = stubRepo({ link: null, employee: null });
  await assert.rejects(() => commands.grantCompanyAuthority(noEmployee, holder, base), /employee not found/);
  for (const r of [home, unknownCompany, noEmployee]) assert.ok(!r.calls.includes("transact"), "refused before a transaction opens");
});

test("an identical active grant is returned and nothing is written; a different window is refused, not silently replaced", async () => {
  const existing = { id: "g-1", tenantId: TENANT, employeeId: "e-1", operatingCompanyId: "ventana", status: "active",
    effectiveFrom: "2030-01-01T00:00:00.000Z", effectiveUntil: "2031-01-01T00:00:00.000Z", reason: "cover" };
  const same = stubRepo({ grants: [existing] });
  const row = await commands.grantCompanyAuthority(same, holder, { ...base, effectiveFrom: "2030-01-01T00:00:00Z", effectiveUntil: "2031-01-01T00:00:00Z" });
  assert.equal(row.id, "g-1");
  assert.ok(!same.calls.includes("transact"), "idempotent: no transaction, no audit event");
  const longer = stubRepo({ grants: [existing] });
  await assert.rejects(() => commands.grantCompanyAuthority(longer, holder, { ...base, effectiveUntil: "2032-01-01T00:00:00Z" }), refusal("COMPANY_GRANT_EXISTS"));
});

test("a store without the table fails closed, by name", async () => {
  const bare = { getLinkedEmployeeAccessFact: async () => null, transact: async () => { throw new Error("must not open"); } };
  await assert.rejects(() => commands.grantCompanyAuthority(bare, holder, base), refusal("COMPANY_GRANT_STORE_UNAVAILABLE"));
  await assert.rejects(() => commands.revokeCompanyAuthority(bare, holder, { grantId: "g-1", reason: "done" }), refusal("COMPANY_GRANT_STORE_UNAVAILABLE"));
});

test("revoking: unknown id and an already-revoked grant are refused before a transaction", async () => {
  const none = stubRepo();
  await assert.rejects(() => commands.revokeCompanyAuthority(none, holder, { grantId: "g-x", reason: "done" }), /company-access grant not found/);
  const revoked = stubRepo();
  revoked.readCompanyAuthorityGrant = async () => ({ id: "g-1", status: "revoked" });
  await assert.rejects(() => commands.revokeCompanyAuthority(revoked, holder, { grantId: "g-1", reason: "done" }), refusal("COMPANY_GRANT_NOT_ACTIVE"));
});

// ════════════════════ the shape of the change ════════════════════

test("the migration is additive and writes no capability, no grant and no Role; its down refuses while a grant is ACTIVE", () => {
  const sql = read("migrations/1764610000000_employee-company-authority-grants.sql");
  const up = sql.split("-- Down Migration")[0];
  const down = sql.split("-- Down Migration")[1];
  assert.equal(/INSERT\s+INTO/i.test(up), false, "the up migration inserts no row (default-inert)");
  assert.equal(/\b(ALTER|DROP)\s+TABLE\b/i.test(up), false, "the up migration alters no existing table");
  assert.match(up, /CREATE TABLE employee_company_authority_grants/);
  assert.match(up, /CREATE UNIQUE INDEX ecag_one_active[\s\S]*WHERE status = 'active'/);
  assert.match(up, /FOREIGN KEY \(tenant_id, employee_id\)[\s\S]*REFERENCES eos_workforce\.employees \(tenant_id, id\)/);
  assert.match(up, /FOREIGN KEY \(tenant_id, operating_company_id\)[\s\S]*REFERENCES tenant_operating_companies \(tenant_id, operating_company_id\)/);
  assert.match(up, /ecag_window CHECK \(effective_until IS NULL OR effective_until > effective_from\)/);
  assert.match(up, /ecag_status_known CHECK \(status IN \('active', 'revoked'\)\)/);
  assert.match(up, /administration_command/);
  assert.match(down, /status = 'active'[\s\S]*refuses to reverse/);
  assert.match(down, /DROP TABLE IF EXISTS employee_company_authority_grants/);
});

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "lib" || name === "test" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|js|mjs|cjs)$/.test(name) && !/\.test\./.test(name)) yield full;
  }
}

test("only the company-authority resolver, the preview that reports it and the repository adapter read the grants table", () => {
  const readers = [];
  for (const root of [join(FUNCTIONS, "src"), join(FUNCTIONS, "scripts")]) {
    for (const file of sources(root)) {
      if (/employee_company_authority_grants/.test(readFileSync(file, "utf8"))) readers.push(relative(REPO, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(readers.sort(), [
    "functions/src/adminPolicy/postgresPolicyRepository.ts",
    "functions/src/eosOps/authorityChangePreview.ts",
    "functions/src/eosOps/companyAuthority.ts",
  ]);
});

test("Finance reach never consults a company-access grant: the Finance authorities do not import company authority", () => {
  for (const file of ["src/eosFinance/financeCompanyAccess.ts", "src/eosFinance/financialPolicy.ts"]) {
    const text = read(file);
    assert.equal(/resolveCompanyAuthority|readMyCompanyAuthority|from\s+["'][^"']*\/companyAuthority["']/.test(text), false, `${file} must not read company authority (R4: a grant is not counted for Finance)`);
    assert.equal(/employee_company_authority_grants/.test(text), false, file);
  }
});

test("the resolver composes the grant as a third source after the identity gate, with database-clock window ends", () => {
  const text = read("src/eosOps/companyAuthority.ts");
  const gate = text.indexOf('return NONE("EMPLOYEE_NOT_ACCESS_ELIGIBLE")');
  const grantBranch = text.indexOf("FROM eos_policy.employee_company_authority_grants g");
  assert.ok(gate > 0 && grantBranch > gate, "the grant branch is only reached after the identity gate");
  assert.match(text, /g\.status = 'active' AND g\.effective_from <= now\(\)/);
  assert.match(text, /g\.effective_until IS NULL OR g\.effective_until > now\(\)/);
  assert.match(text, /tenant_operating_companies c[\s\S]*c\.status = 'ACTIVE'/, "an INACTIVE company is still filtered");
  assert.match(text, /r\.company_authority_effect = 'OPERATIONAL'/, "the #248 role expansion is unchanged");
});

test("the two commands ride the same mandatory-preview path as assignRole and are gated by the same capability", async () => {
  const { AUTHORITY_CHANGE_OPERATIONS, AUTHORITY_CHANGE_GATE } = await import("../lib/adminPolicy/authorityChangePreviewPort.js");
  for (const op of ["grantCompanyAuthority", "revokeCompanyAuthority"]) {
    assert.ok(AUTHORITY_CHANGE_OPERATIONS.includes(op), `${op} is previewable`);
    assert.equal(AUTHORITY_CHANGE_GATE[op], AUTHORITY_CHANGE_GATE.assignRole, `${op} has assignRole's gate`);
  }
  const api = await import("../lib/adminPolicy/adminPolicyApi.js");
  assert.ok(api.ADMIN_MUTATION_OPERATIONS.includes("grantCompanyAuthority") && api.ADMIN_MUTATION_OPERATIONS.includes("revokeCompanyAuthority"));
  assert.equal(api.capabilityForAdminRead("listEmployeeCompanyAuthority"), "admin.principalAccess.read");
});

// ════════════════════ the preview's company authority is set-based (regression guard) ════════════════════

test("the preview snapshot decides company authority with ONE set-based read, never a resolver call per member", async () => {
  const text = read("src/eosOps/authorityChangePreview.ts");
  assert.equal(/\bresolveCompanyAuthority\s*\(/.test(text), false, "authorityChangePreview.ts must not call the single-principal resolver (N x 4 round trips per side)");
  assert.match(text, /resolveCompanyAuthorityForMembers\(/);
  // And the set-based read really is two round trips whatever the number of members.
  const { resolveCompanyAuthorityForMembers } = await import("../lib/eosOps/companyAuthority.js");
  for (const members of [1, 10, 250]) {
    const ids = Array.from({ length: members }, (_, i) => `p-${i}`);
    const calls = [];
    const db = { query: async (sql) => {
      calls.push(sql);
      if (calls.length === 1) {
        return { rows: ids.map((id, i) => ({ principal_id: id, standing: true, employee_id: `e-${i}`, employment_status: "ACTIVE", operating_company_id: "taylor", link_count: "1" })) };
      }
      return { rows: ids.map((id) => ({ principal_id: id, id: "taylor" })) };
    } };
    const out = await resolveCompanyAuthorityForMembers(db, "t", ids);
    assert.equal(calls.length, 2, `${members} members took ${calls.length} round trips`);
    assert.equal(out.size, members);
    assert.deepEqual([...out.get("p-0").companies], ["taylor"]);
  }
  const none = { query: async () => { throw new Error("no query for no members"); } };
  assert.equal((await resolveCompanyAuthorityForMembers(none, "t", [])).size, 0);
});
