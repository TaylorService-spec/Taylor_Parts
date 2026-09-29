// PLATFORM QA (lane L5) -- AUDIT COMPLETENESS OF THE GOVERNED ADMINISTRATION + WORKFORCE MUTATIONS.
//
// Owner HARD ruling 2026-09-26 (Administration is the control plane): every authority / workforce change carries a
// full audit -- actor, time, previous and new value, reason, tenant. This matrix drives each governed mutation through
// its real transport, as a Principal holding the seeded `admin` Role in the rebuilt nonprod authority population, and
// reads eos_policy.audit_events back:
//
//   every successful mutation appends >= 1 audit row for THIS tenant, naming the acting EOS Principal (never the
//   identity-provider subject), carrying the stated reason, and recording a previous and/or new value.
//
// A NO_CHANGE outcome may write nothing (that is the documented contract of the workforce commands). Disposable
// database only (platformQaHarness.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SKIP, rebuiltAuthorityDatabase, composeTransports, tokenRegistry, makeActor, assignRoleKeys, call } from "./platformQaHarness.mjs";

const TENANT = "tenant-l5-audit";
const REASON = () => `l5 audit probe ${randomUUID().slice(0, 8)}`;

test("audit completeness matrix", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { pool, repo } = await rebuiltAuthorityDatabase(t, "l5audit", TENANT, "l5-audit");
  const tokens = tokenRegistry();
  const { transports } = composeTransports(pool, tokens.verifyToken);
  const ctx = { repo, pool, tokens };
  const admin = await makeActor(ctx, TENANT, "l5-sub-audit-admin", []);
  assert.deepEqual(await assignRoleKeys(ctx, TENANT, admin.principalId, ["admin"]), []);
  const subject = await makeActor(ctx, TENANT, "l5-sub-audit-subject", []);
  await pool.query(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
                    VALUES ($1,'taylor','ACTIVE','l5','l5','l5')`, [TENANT]);
  await pool.query(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ('e-audit-1',$1,'ACTIVE','taylor')`, [TENANT]);

  const roleIdOf = async (key) => (await pool.query(`SELECT id FROM eos_policy.roles WHERE tenant_id=$1 AND key=$2`, [TENANT, key])).rows[0]?.id;
  // A grant target the rebuilt catalog governs: an Object action whose capability `technician` does not hold.
  const objects = await call(transports.administration, "listObjectsWithActions", { token: admin.token, input: {} });
  assert.equal(objects.status, 200, JSON.stringify(objects.body));

  const auditRows = async () => (await pool.query(`SELECT * FROM eos_policy.audit_events WHERE tenant_id=$1 ORDER BY occurred_at, id`, [TENANT])).rows;
  const results = [];
  const run = async (transport, op, input, { expectNoChange = false } = {}) => {
    const before = (await auditRows()).length;
    const r = await call(transports[transport], op, { token: admin.token, input });
    const rows = (await auditRows()).slice(before);
    const reason = input.reason ?? null;
    const cell = { op: `${transport}.${op}`, status: r.status, code: r.code, audit: rows.length,
      actorOk: rows.length > 0 && rows.every((a) => a.actor_uid === admin.principalId),
      subjectLeak: rows.some((a) => JSON.stringify(a).includes("l5-sub-")),
      reasonOk: reason === null || rows.some((a) => typeof a.reason === "string" && a.reason.includes(reason)),
      valuesOk: rows.some((a) => a.before !== null || a.after !== null),
      message: r.status === 200 ? undefined : String(r.body.message ?? "").slice(0, 160) };
    results.push(cell);
    return r;
  };

  // ── Administration ──
  const createRole = await run("administration", "createRole", { key: "l5_audit_role", name: "L5 Audit Role", reason: REASON() });
  const customRoleId = createRole.body.data?.id ?? createRole.body.data?.role?.id ?? await roleIdOf("l5_audit_role");
  await run("administration", "updateRole", { roleId: customRoleId, name: "L5 Audit Role (renamed)", reason: REASON() });
  const technicianRoleId = await roleIdOf("technician");
  await run("administration", "assignRole", { principalId: subject.principalId, roleId: technicianRoleId, reason: REASON() });
  const assignment = (await pool.query(`SELECT id FROM eos_policy.user_role_assignments WHERE tenant_id=$1 AND principal_id=$2 AND status='active'`, [TENANT, subject.principalId])).rows[0];
  if (assignment) await run("administration", "revokeRole", { assignmentId: assignment.id, reason: REASON() });

  // An object action (from the governed Object catalog) to grant to the custom Role and to the subject directly.
  const objectList = objects.body.data?.objects ?? objects.body.data ?? [];
  let target = null;
  for (const o of objectList) {
    const actions = o.actions ?? [];
    const a = actions.find((x) => x.capabilityKey && (x.actionKey ?? x.key));
    if (a) { target = { objectKey: o.objectKey ?? o.key, actionKey: a.actionKey ?? a.key }; break; }
  }
  t.diagnostic(`GRANT TARGET ${JSON.stringify(target)}`);
  if (target) {
    await run("administration", "grantObjectActionToRole", { ...target, roleKey: "l5_audit_role", reason: REASON() });
    await run("administration", "revokeObjectActionFromRole", { ...target, roleKey: "l5_audit_role", reason: REASON() });
    await run("administration", "grantObjectActionToPrincipal", { ...target, principalId: subject.principalId, reason: REASON() });
    await run("administration", "revokeObjectActionFromPrincipal", { ...target, principalId: subject.principalId, reason: REASON() });
  }
  // A CONDITIONABLE grant (the scope runtime / condition catalog accept RECORD_ASSIGNMENT on the Work Order read).
  let conditionable = null;
  for (const o of objectList) for (const a of o.actions ?? []) {
    if (a.capabilityKey === "workOrder.record.read") conditionable = { objectKey: o.objectKey ?? o.key, actionKey: a.actionKey ?? a.key };
  }
  t.diagnostic(`CONDITION TARGET ${JSON.stringify(conditionable)}`);
  if (conditionable) {
    await run("administration", "grantObjectActionToRole", { ...conditionable, roleKey: "l5_audit_role", reason: REASON() });
    await run("administration", "setGrantCondition", { ...conditionable, roleKey: "l5_audit_role",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" }, reason: REASON() });
    // Retiring a condition while its grant is held is REFUSED (Pass 7: it would widen the grant) -- revoke first.
    await run("administration", "revokeObjectActionFromRole", { ...conditionable, roleKey: "l5_audit_role", reason: REASON() });
    await run("administration", "retireGrantCondition", { ...conditionable, roleKey: "l5_audit_role", reason: REASON() });
  }
  // A retire with NOTHING to retire: recorded separately -- a no-op success that writes no audit row.
  const noop = await call(transports.administration, "retireGrantCondition", { token: admin.token, input: { ...(target ?? {}), roleKey: "l5_audit_role", reason: REASON() } });
  t.diagnostic(`NO-OP RETIRE ${noop.status} ${JSON.stringify(noop.body).slice(0, 300)}`);
  await run("administration", "setTenantSalesChannelStatus", { salesChannel: "RETAIL", status: "ACTIVE", reason: REASON() });

  // ── Workforce ──
  await run("workforce", "createEmployee", { employeeId: "e-audit-2", employmentStatus: "ACTIVE", operatingCompanyId: "taylor", reason: REASON() });
  await run("workforce", "changeEmploymentStatus", { employeeId: "e-audit-1", employmentStatus: "ON_LEAVE", reason: REASON() });
  await run("workforce", "assignEmployeeWorkEligibility", { employeeId: "e-audit-1", qualificationCode: "SERVICE_TECHNICIAN", reason: REASON() });
  await run("workforce", "endEmployeeWorkEligibility", { employeeId: "e-audit-1", qualificationCode: "SERVICE_TECHNICIAN", reason: REASON() });
  await run("workforce", "linkEmployeePrincipal", { employeeId: "e-audit-2", linkedPrincipalId: subject.principalId, reason: REASON() });
  await run("workforce", "unlinkEmployeePrincipal", { employeeId: "e-audit-2", expectedCurrentPrincipalId: subject.principalId, reason: REASON() });
  // createJobRole takes no reason (its accepted input is jobRoleId + displayName): the reason cell is then vacuous.
  await run("workforce", "createJobRole", { jobRoleId: "l5-audit-job", displayName: "L5 Audit Job" });
  await run("workforce", "assignEmployeeJobRole", { employeeId: "e-audit-1", jobRoleId: "l5-audit-job", reason: REASON() });
  // createFunctionalRole is not exercised: admin.employeeFunctionalRole.write is granted to NO Role (ruled inert).

  t.diagnostic(`AUDIT MATRIX\n${results.map((c) => `${c.op.padEnd(52)} ${String(c.status).padEnd(4)} ${String(c.code).padEnd(34)} audit=${c.audit} actor=${c.actorOk} reason=${c.reasonOk} values=${c.valuesOk} leak=${c.subjectLeak}${c.message ? `  :: ${c.message}` : ""}`).join("\n")}`);

  await t.test("every SUCCESSFUL governed mutation is fully audited", () => {
    const succeeded = results.filter((c) => c.status === 200 || c.status === 201);
    const gaps = succeeded.filter((c) => !(c.audit >= 1 && c.actorOk && c.reasonOk && c.valuesOk && !c.subjectLeak))
      .map((c) => `${c.op}: audit=${c.audit} actor=${c.actorOk} reason=${c.reasonOk} values=${c.valuesOk} leak=${c.subjectLeak}`);
    assert.deepEqual(gaps, EXPECTED_AUDIT_GAPS);
  });
  await t.test("the matrix is not vacuous: most governed mutations were actually exercised", () => {
    const succeeded = results.filter((c) => c.status === 200 || c.status === 201).map((c) => c.op).sort();
    t.diagnostic(`EXERCISED ${succeeded.length}/${results.length}: ${succeeded.join(", ")}`);
    assert.ok(succeeded.length >= 12, `only ${succeeded.length} mutations succeeded`);
  });
});

const EXPECTED_AUDIT_GAPS = [];
