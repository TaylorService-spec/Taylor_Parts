// TEST FIXTURE: establish a governed operating company and its ACTIVE key binding, the way nonprod holds them
// (eos_policy.tenant_operating_companies + eos_policy.tenant_operating_company_keys). The commercial writers resolve a
// record's operating_company_key ONLY through this binding (eosOps/operatingCompanyBinding.ts) -- never by assuming the
// company id and the key are the same string -- so a suite that writes commercial records must state the binding it
// relies on. Pass `key` different from `companyId` to prove no equality is inferred.
export async function bindOperatingCompany(q, tenantId, companyId, key = companyId) {
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1,$2,'ACTIVE','test-fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [tenantId, companyId]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1,$2,$3,'ACTIVE','MIGRATED','test-fixture','fixture','fixture') ON CONFLICT DO NOTHING`, [tenantId, companyId, key]);
}
