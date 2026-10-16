// SYNTHETIC ACCEPTANCE AVAILABILITY (Owner DECISION 5, 2026-09-30): "Synthetic acceptance availability may be configured
// explicitly." A test that schedules a technician states that technician's working hours through the governed command --
// round the clock, UTC -- instead of relying on an assumed 24/7 default, which the runtime refuses to assume.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const availability = require("../../lib/eosOps/workOrderAvailability.js");

export const ROUND_THE_CLOCK = Object.freeze(Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"]
  .map((d) => [d, [{ start: "00:00", end: "24:00" }]])));

/**
 * Configure round-the-clock UTC hours for each Employee, as `scheduler` (an actor holding workOrder.lifecycle.schedule).
 * The synthetic scheduler is first given company authority over exactly those Employees' companies (G-9).
 */
export async function configureRoundTheClock(pool, scheduler, employeeIds) {
  const { rows } = await pool.query(`SELECT DISTINCT operating_company_id AS c FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY 1`,
    [scheduler.tenantId, employeeIds]);
  await grantSyntheticCompanyAuthority(pool, scheduler.tenantId, scheduler.principalId, rows.map((r) => r.c));
  for (const employeeId of employeeIds) {
    await availability.setTechnicianWorkingHours({ pool }, { actor: scheduler },
      { employeeId, timeZone: "UTC", weeklyHours: ROUND_THE_CLOCK, reason: "synthetic acceptance availability" });
  }
}

/**
 * G-9 (DECISIONS #237): the schedule commands act only within the caller's operating companies. A synthetic test scheduler
 * is given explicit company authority here -- never a canonical persona: when it has no linked Employee it gets a synthetic
 * linked Employee in companies[0] (its home company), and every other company is reached through a synthetic
 * operatingCompany-scoped role assignment (the same shape Company Authority V1, DECISIONS #235, resolves). Idempotent.
 */
export async function grantSyntheticCompanyAuthority(db, tenantId, principalId, companies) {
  const linked = await db.query(
    `SELECT e.operating_company_id AS home FROM eos_policy.employee_principal_links l
       JOIN eos_workforce.employees e ON e.tenant_id = l.tenant_id AND e.id = l.employee_id
      WHERE l.tenant_id = $1 AND l.principal_id = $2 AND l.status = 'active'`, [tenantId, principalId]);
  let home = linked.rows[0]?.home;
  if (!home) {
    home = companies[0];
    const eid = `syn-g9-emp-${principalId}`;
    await db.query(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
                    VALUES ($1,$2,'ACTIVE',$3,$1,$1)`, [eid, tenantId, home]);
    await db.query(`INSERT INTO eos_policy.employee_principal_links
                      (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
                    VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','fixture','g9 synthetic scheduler')`, [`syn-g9-lnk-${principalId}`, tenantId, principalId, eid, home]);
  }
  const others = [...new Set(companies)].filter((c) => c !== home);
  if (others.length === 0) return;
  const roleId = `syn-g9-reach-${tenantId}`;
  await db.query(`INSERT INTO eos_policy.roles (id,tenant_id,key,name,origin,created_by,updated_by)
                  VALUES ($1,$2,'syntheticCompanyReach','Synthetic company reach (G-9 fixture)','SYSTEM','fixture','fixture') ON CONFLICT DO NOTHING`, [roleId, tenantId]);
  for (const c of others) {
    await db.query(`INSERT INTO eos_policy.user_role_assignments (id,tenant_id,principal_id,role_id,scope_type,scope_value,status,granted_by,access_version_at_grant,created_by,updated_by)
                    VALUES ($1,$2,$3,$4,'operatingCompany',$5,'active','fixture',0,'fixture','fixture') ON CONFLICT DO NOTHING`,
      [`syn-g9-ura-${principalId}-${c}`, tenantId, principalId, roleId, c]);
  }
}
