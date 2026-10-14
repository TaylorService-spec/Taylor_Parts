// TEST-TENANT ONLY: the Financials company assignment (Financials Workspace P0 correction). A custom Role holding exactly
// finance.payment.read, assigned per operating company through the governed Administration commands -- the shape the
// nonprod change proposes. Company assignment is mandatory: a global finance Role alone reaches no company.
import assert from "node:assert/strict";

export const FINANCE_COMPANY_ACCESS_ROLE = "financeCompanyAccess";

/** Create the Role once (exactly finance.payment.read), then assign each principal at each company. */
export async function assignFinanceCompanies({ admin, q, tenant }, principals, companies = ["taylor", "ventana"]) {
  const roleRow = async () => (await q(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = $2`, [tenant, FINANCE_COMPANY_ACCESS_ROLE])).rows[0];
  if (!(await roleRow())) {
    const created = await admin("createRole", { key: FINANCE_COMPANY_ACCESS_ROLE, name: "Financials Company Access",
      reason: "local test tenant only (Financials company assignment)" });
    assert.equal(created.ok, true, JSON.stringify(created).slice(0, 300));
    const c = (await q(`SELECT object_key, action_key FROM eos_policy.capabilities WHERE key = 'finance.payment.read'`)).rows[0];
    const granted = await admin("grantObjectActionToRole", { roleKey: FINANCE_COMPANY_ACCESS_ROLE, objectKey: c.object_key, actionKey: c.action_key,
      reason: "local test tenant only" });
    assert.equal(granted.ok, true, JSON.stringify(granted).slice(0, 300));
  }
  const roleId = (await roleRow()).id;
  for (const who of principals) {
    for (const company of companies) {
      const r = await admin("assignRole", { principalId: who.principalId, roleId, reason: "local test tenant only (Financials company assignment)",
        scopeType: "operatingCompany", scopeValue: company });
      assert.equal(r.ok, true, `${who.principalId}@${company} ${JSON.stringify(r).slice(0, 300)}`);
    }
  }
}
