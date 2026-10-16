#!/usr/bin/env node
// RENTAL COMPANY-BINDING INTEGRITY CHECK -- P0 rental security, Owner ruling D5 (2026-10-15; DECISIONS #236).
//
// Rental records are visible only through an ACTIVE operating-company key binding to an ACTIVE operating company (EOS Core
// company authority, eosOps/companyAuthority.ts). A record whose company key is retired, unbound or bound to an INACTIVE
// company is therefore hidden from EVERYONE (fail closed) -- and kept: nothing is deleted or rewritten. This check is how the
// operator learns such records exist, so they are corrected through governed company administration instead of silently
// disappearing from the Rental workspace.
//
// READ-ONLY: SELECT statements only. Prints counts and record ids/numbers per tenant and company key -- no customer data.
// Exit code 0 = no affected records; 2 = affected records found (a data-quality alert for the operator); 1 = error.
//
// Usage: DATABASE_URL=postgres://... node functions/scripts/rentalCompanyBindingIntegrity.mjs
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (read-only use).");
  process.exit(1);
}

const ACTIVE_BINDING = `EXISTS (SELECT 1 FROM eos_policy.tenant_operating_company_keys k
  JOIN eos_policy.tenant_operating_companies c ON c.tenant_id = k.tenant_id AND c.operating_company_id = k.operating_company_id AND c.status = 'ACTIVE'
  WHERE k.tenant_id = x.tenant_id AND k.operating_company_key = x.company_key AND k.status = 'ACTIVE')`;

const CHECKS = [
  { kind: "rental_agreement", sql: `SELECT x.tenant_id, x.company_key, x.ref FROM (SELECT tenant_id, operating_company_key AS company_key, rental_agreement_number AS ref
      FROM eos_rental.rental_agreements) x WHERE NOT ${ACTIVE_BINDING} ORDER BY 1, 2, 3` },
  { kind: "fleet_unit", sql: `SELECT x.tenant_id, x.company_key, x.ref FROM (SELECT tenant_id, owner_operating_company_key AS company_key, id AS ref
      FROM eos_rental.fleet_units) x WHERE NOT ${ACTIVE_BINDING} ORDER BY 1, 2, 3` },
];

const client = new pg.Client({ connectionString: url });
let affected = 0;
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  for (const check of CHECKS) {
    const { rows } = await client.query(check.sql);
    affected += rows.length;
    console.log(`${check.kind}: ${rows.length} record(s) without an ACTIVE company binding`);
    for (const r of rows) console.log(`  tenant=${r.tenant_id} companyKey=${r.company_key} ${check.kind}=${r.ref}`);
  }
  await client.query("ROLLBACK");
} catch (err) {
  console.error(`integrity check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
process.exit(affected === 0 ? 0 : 2);
