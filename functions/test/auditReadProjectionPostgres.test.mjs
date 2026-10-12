// AUDIT READ PROJECTION, PR 5a -- ACCESS-NEUTRAL, proved byte-for-byte through the real resolver.
//
// readPolicyAuditHistory now passes every row through the closed per-kind registry (auditReadProjection.ts). PR 5a
// may withhold NOTHING from anyone who reads it today (Owner ruling; access-removing gating is PR 5b, HELD). This
// suite proves it on a baseline-equal tenant (the authority baseline's rebuild + the accepted Service delta):
//
//   1. every Role that holds audit.event.read here also holds inventory.transaction.read, unconditioned -- the
//      precondition for the only two ENFORCED gates (binPlacement, stockRelocation);
//   2. for a principal holding EACH of those Roles (and the bootstrap Administrator), the response to every read
//      shape -- unfiltered and each filter -- is BYTE-IDENTICAL to what the pre-5a read returned (the repository's
//      rows, unprojected, with no content-filter exclusion), over one fixture row per registered kind, one
//      unregistered kind, and rows carrying every content-filter key;
//   3. the content-filter exclusion of the two enforced kinds changes no filter result over rows in their writers'
//      exact payload shape;
//   4. the enforced gate does bite for a reader who lacks it (a fixture Role that exists in no catalog) -- values
//      ABSENT, marker exact, nothing dropped -- so (2) is not vacuous;
//   5. every capability key a recorded gate names is a registered capability (the data is not fiction);
//   6. the append-only trigger is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { serviceBaselineTenant } from "./support/serviceBaselineTenant.mjs";
import { seedProtectedOwner } from "./support/protectedOwnerFixture.mjs";

const require = createRequire(import.meta.url);
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const T = "t-auditproj";

const { executeAdminOperation } = require("../lib/adminPolicy/adminPolicyApi.js");
const { ensureTenantPrincipal } = require("../lib/adminPolicy/tenantBootstrap.js");
const projection = require("../lib/adminPolicy/auditReadProjection.js");

const AUDIT_READ = "audit.event.read";
const INVENTORY_TX_READ = "inventory.transaction.read";
const ENFORCED = ["binPlacement", "stockRelocation"];

test("audit read projection (PR 5a) is access-neutral through the real resolver", { skip: SKIP, concurrency: false }, async (t) => {
  const { q, repo, admin } = await serviceBaselineTenant(t, { urlBase: URL_BASE, tenant: T, prefix: "auditproj" });
  const ok = (r, what) => { assert.equal(r.ok, true, `${what}: ${r.ok ? "" : `${r.code} ${r.message}`}`); return r.data; };

  // ── 1. who reads the audit trail here, and do they all hold the enforced gate unconditioned? ──
  const holdersOf = async (key) => (await q(
    `SELECT r.key FROM eos_policy.role_capabilities rc JOIN eos_policy.roles r ON r.id = rc.role_id
       JOIN eos_policy.capabilities c ON c.id = rc.capability_id
      WHERE rc.tenant_id = $1 AND c.key = $2 ORDER BY r.key`, [T, key])).rows.map((r) => r.key);
  const auditRoles = await holdersOf(AUDIT_READ);
  const txRoles = new Set(await holdersOf(INVENTORY_TX_READ));
  assert.ok(auditRoles.length >= 11, `audit.event.read roles: ${auditRoles}`);
  t.diagnostic(`audit.event.read Roles: ${auditRoles.join(",")}`);
  assert.deepEqual(auditRoles.filter((r) => !txRoles.has(r)), [], "an audit reader Role lacks inventory.transaction.read");
  const conditioned = (await q(
    `SELECT grantor_key, capability_key FROM eos_policy.capability_grant_conditions
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND capability_key = ANY($2)`, [T, [AUDIT_READ, INVENTORY_TX_READ]])).rows;
  assert.deepEqual(conditioned, [], "a condition narrows an audit or inventory-transaction read grant");
  assert.equal((await q(`SELECT count(*)::int AS n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
      WHERE pc.tenant_id = $1 AND c.key = $2`, [T, AUDIT_READ])).rows[0].n, 0, "no direct audit.event.read grant");

  // ── fixture rows: one per registered kind (+ one unregistered), and rows carrying every content-filter key ──
  const base = Date.parse("2026-10-01T00:00:00.000Z");
  let n = 0;
  const insert = async (kind, action, targetId, before, after, reason = null) => {
    n += 1;
    await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [`audit_fx_${String(n).padStart(3, "0")}`, T, action, "p-fixture-actor", kind, targetId,
        before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
        new Date(base + n * 1000).toISOString(), reason]);
  };
  const STANDING = { standing: "PROTECTED_ADMINISTRATOR", ruling: "fixture" };
  for (const kind of [...projection.REGISTERED_AUDIT_KINDS, "zz_unregistered"]) {
    await insert(kind, `${kind}.fixture`, `${kind}-1`, null, { value: `${kind}-value`, authorizedBy: STANDING }, "fixture reason");
  }
  // The two ENFORCED kinds, in their writers' exact payload shape (binPlacementOperations / stockRelocationOperations).
  await insert("binPlacement", "binPlacement.record", "plc-1", null, { warehouseId: "wh-1", binId: "bin-1", binCode: "A-01",
    partId: "part-1", quantity: 2, serialCount: 0, pickedForWorkOrderId: null, placementIds: ["plc-1"], authorizedBy: STANDING });
  await insert("stockRelocation", "stockRelocation.relocate", "rel-1", null, { partId: "part-1",
    source: { type: "BIN", locationId: "bin-1" }, destination: { type: "BIN", locationId: "bin-2" }, warehouseId: "wh-1",
    quantity: 2, serialCount: 0, placementRecorded: true, placementIds: ["plc-2"] });
  // Rows a content filter matches, of governance kinds.
  const FILTER_VALUES = { principalId: "prn-filter", employeeId: "emp-filter", roleKey: "dispatcher", objectKey: "workOrder",
    capabilityKey: "workOrder.record.read", actionKey: "read", workflowKey: "wf-filter" };
  await insert("roleAssignment", "assignRole", "ura-filter", null, { principalId: FILTER_VALUES.principalId, roleId: "role-x" });
  await insert("roleCapability", "grantObjectActionToRole", "rc-filter", null, { granteeKey: FILTER_VALUES.roleKey,
    objectKey: FILTER_VALUES.objectKey, capabilityKey: FILTER_VALUES.capabilityKey, actionKey: FILTER_VALUES.actionKey });
  await insert("workflowVersion", "publishWorkflowVersion", "wfv-filter", null, { workflowKey: FILTER_VALUES.workflowKey, objectKey: "workOrder" });
  await insert("employee", "employee.reportingRelationship.establish", FILTER_VALUES.employeeId, null, { managerEmployeeId: "emp-mgr" });

  // ── the pre-5a read, reproduced: the repository's rows, unprojected, no content-filter exclusion ──
  const roleIdOf = async (key) => (await repo.getRoleByKey(T, key))?.id ?? null;
  const SHAPES = [
    { limit: 500 },
    { limit: 3 },
    { principalId: FILTER_VALUES.principalId, limit: 500 },
    { principalId: "p-fixture-actor", limit: 500 },
    { employeeId: FILTER_VALUES.employeeId, limit: 500 },
    { roleKey: FILTER_VALUES.roleKey, limit: 500 },
    { objectKey: FILTER_VALUES.objectKey, limit: 500 },
    { capabilityKey: FILTER_VALUES.capabilityKey, limit: 500 },
    { actionKey: FILTER_VALUES.actionKey, limit: 500 },
    { workflowKey: FILTER_VALUES.workflowKey, limit: 500 },
    { from: new Date(base + 10_000).toISOString(), to: new Date(base + 40_000).toISOString(), limit: 500 },
  ];
  const filterOf = (shape) => {
    const f = {};
    for (const k of ["principalId", "employeeId", "roleKey", "objectKey", "capabilityKey", "actionKey", "workflowKey", "from", "to"]) f[k] = shape[k] ?? null;
    return f;
  };
  const preRead = async (shape) => {
    const isFiltered = Object.keys(shape).some((k) => k !== "limit");
    if (!isFiltered) return repo.listAuditEvents(T, shape.limit);
    const roleId = shape.roleKey ? await roleIdOf(shape.roleKey) : null;
    return repo.queryAuditEvents(T, { ...filterOf(shape), roleId, limit: shape.limit });
  };

  await t.test("3. the content-filter exclusion of the enforced kinds changes no filter result", async () => {
    for (const shape of SHAPES.filter((s) => Object.keys(s).length > 1)) {
      const roleId = shape.roleKey ? await roleIdOf(shape.roleKey) : null;
      const without = await repo.queryAuditEvents(T, { ...filterOf(shape), roleId, limit: shape.limit });
      const withExclusion = await repo.queryAuditEvents(T, { ...filterOf(shape), roleId, limit: shape.limit,
        contentFilterExcludedKinds: projection.CONTENT_FILTER_EXCLUDED_KINDS });
      assert.equal(JSON.stringify(withExclusion), JSON.stringify(without), JSON.stringify(shape));
    }
    // And it is not vacuous: an enforced-kind row whose payload DID carry a filter key would no longer match by content.
    await insert("binPlacement", "binPlacement.record", "plc-oracle", null, { principalId: "prn-oracle" });
    const probe = { ...filterOf({ principalId: "prn-oracle" }), roleId: null, limit: 500 };
    assert.equal((await repo.queryAuditEvents(T, probe)).filter((r) => r.targetId === "plc-oracle").length, 1);
    assert.equal((await repo.queryAuditEvents(T, { ...probe, contentFilterExcludedKinds: projection.CONTENT_FILTER_EXCLUDED_KINDS }))
      .filter((r) => r.targetId === "plc-oracle").length, 0);
  });

  // ── 2. byte-identical for every audit reader ──
  const readers = [{ role: "admin (bootstrap Administrator)", subject: "uid-auditproj-admin" }];
  for (const roleKey of auditRoles) {
    if (roleKey === "admin") continue;
    const subject = `uid-auditproj-${roleKey}`;
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: "operator-auditproj", actorRoleKeys: ["admin"] });
    const principalId = made.principal?.id ?? made.id ?? made.principalId;
    // The protected Owner is not appointed through ordinary role administration; the fixture seeds it as bootstrap does.
    if (roleKey === "owner") await seedProtectedOwner(repo, { tenantId: T, principalId });
    else ok(await admin("assignRole", { principalId, roleId: await roleIdOf(roleKey), reason: "audit projection proof" }), `assign ${roleKey}`);
    readers.push({ role: roleKey, subject });
  }
  const read = (subject, input) => executeAdminOperation({ repo },
    { caller: { externalSubject: subject, identityProvider: "firebase" }, operation: "readPolicyAuditHistory", input });

  await t.test("2. every audit.event.read Role: every read shape is byte-identical to the pre-5a read", async () => {
    // The fixture writes no audit rows past this point, and the proof reads do not write any.
    const expected = new Map();
    for (const shape of SHAPES) expected.set(JSON.stringify(shape), JSON.stringify(await preRead(shape)));
    const unfiltered = JSON.parse(expected.get(JSON.stringify({ limit: 500 })));
    for (const kind of [...ENFORCED, "employee", "part_supplier_item", "zz_unregistered"]) {
      assert.ok(unfiltered.some((r) => r.targetKind === kind), `the fixture covers ${kind}`);
    }
    let compared = 0;
    for (const reader of readers) {
      for (const shape of SHAPES) {
        const data = ok(await read(reader.subject, shape), `${reader.role} ${JSON.stringify(shape)}`);
        assert.equal(JSON.stringify(data), expected.get(JSON.stringify(shape)), `${reader.role}: ${JSON.stringify(shape)} changed`);
        assert.ok(!JSON.stringify(data).includes("valuesWithheld"), `${reader.role}: a marker was emitted`);
        compared += 1;
      }
    }
    assert.equal(compared, readers.length * SHAPES.length);
    t.diagnostic(`byte-identical: ${readers.length} readers x ${SHAPES.length} read shapes = ${compared} responses`);
    assert.ok(readers.length >= 12, `${readers.length} readers`);
  });

  await t.test("4. the enforced gate bites for a reader who lacks it (a fixture-only Role)", async () => {
    const subject = "uid-auditproj-narrow";
    // A custom Role carrying audit.event.read and NOTHING else -- no catalog Role is shaped like this.
    const role = ok(await admin("createRole", { key: "zzAuditOnly", name: "zz audit only", reason: "narrow reader" }), "create narrow");
    ok(await admin("grantObjectActionToRole", { roleKey: "zzAuditOnly", objectKey: "auditLog", actionKey: "read", reason: "narrow reader" }), "grant narrow");
    const made = await ensureTenantPrincipal(repo, { tenantId: T, externalSubject: subject, actorUid: "operator-auditproj", actorRoleKeys: ["admin"] });
    ok(await admin("assignRole", { principalId: made.principal?.id ?? made.id ?? made.principalId, roleId: role.id ?? role.role?.id ?? await roleIdOf("zzAuditOnly"), reason: "narrow reader" }), "assign narrow");
    const raw = await repo.listAuditEvents(T, 500);
    const data = ok(await read(subject, { limit: 500 }), "narrow read");
    assert.equal(data.length, raw.length, "no row dropped");
    assert.deepEqual(data.map((r) => r.id), raw.map((r) => r.id), "same rows, same order");
    let withheld = 0;
    data.forEach((row, i) => {
      if (!ENFORCED.includes(raw[i].targetKind)) { assert.equal(JSON.stringify(row), JSON.stringify(raw[i]), raw[i].targetKind); return; }
      withheld += 1;
      assert.ok(!("before" in row) && !("after" in row), "values ABSENT, not null");
      assert.deepEqual(row.valuesWithheld, { reason: "RECORD_READ_REQUIRED", requires: [INVENTORY_TX_READ] });
      if (raw[i].after?.authorizedBy) assert.deepEqual(row.authorizedBy, raw[i].after.authorizedBy);
      else assert.ok(!("authorizedBy" in row));
    });
    assert.equal(withheld, 5, "the two per-kind rows, the two writer-shaped rows and the oracle probe");
  });

  await t.test("5. every capability a recorded gate names is registered", async () => {
    const registered = new Set((await q(`SELECT key FROM eos_policy.capabilities`)).rows.map((r) => r.key));
    const missing = [];
    for (const kind of projection.REGISTERED_AUDIT_KINDS) {
      const e = projection.AUDIT_KIND_REGISTRY[kind];
      if (e.class !== "VALUE_GATED") continue;
      const keys = [...e.gate.requires, ...Object.values(e.gate.actionRequires ?? {}).flat()];
      for (const k of keys) if (!registered.has(k)) missing.push(`${kind}: ${k}`);
    }
    assert.deepEqual(missing, []);
  });

  await t.test("6. audit_events stays append-only", async () => {
    await assert.rejects(q(`UPDATE eos_policy.audit_events SET reason = 'x' WHERE tenant_id = $1`, [T]), /append-only/);
    await assert.rejects(q(`DELETE FROM eos_policy.audit_events WHERE tenant_id = $1`, [T]), /append-only/);
  });

});
