// P1A step 2 -- the capability parity harness proved end to end, offline. Firestore and PostgreSQL
// are both small doubles here (the same posture test/adminPolicyMigrationParity.test.mjs already
// takes for the sibling assignment-parity harness): the harness's job is comparison, and
// comparison logic does not need a real database to be wrong. functions/scripts/
// inventoryCapabilityParityHarness.js's `buildInventoryCapabilityParityReport` is exercised
// directly, wired to a real `InMemoryPolicyRepository` (so principal/tenant/Role resolution is the
// SAME logic `resolvePrincipalContext` runs against real Postgres) and a fake `pool.query` standing
// in for `eos_policy.role_capabilities` / `capabilities`.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { buildInventoryCapabilityParityReport } from "../scripts/inventoryCapabilityParityHarness.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const SYS = "uid-sys";
const RECEIVE_OP = "receiving.receive";
const RECEIVE_CAP = "inventory.stock.receive";
const RECEIVE_ROLE = "inventoryReceivingClerk";

/** A Firestore stand-in holding legacy roleAssignments and users. READ paths only. */
function fakeFirestore({ assignments = [], users = {} } = {}) {
  return {
    collection(name) {
      return {
        where() {
          return this;
        },
        async get() {
          if (name !== "roleAssignments") return { docs: [] };
          return { docs: assignments.map((a, i) => ({ id: `a${i}`, data: () => a })) };
        },
        doc(id) {
          return {
            async get() {
              const found = name === "users" ? users[id] : undefined;
              return { exists: Boolean(found), data: () => found };
            },
          };
        },
      };
    },
  };
}

/** A fake `pg.Pool` standing in for eos_policy.role_capabilities / capabilities. */
function fakePool({ grants = [], capabilityKeys = [RECEIVE_CAP] } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("role_capabilities rc")) {
        const [tenantId, roleKeys] = params;
        const rows = grants
          .filter((g) => g.tenantId === tenantId && roleKeys.includes(g.roleKey))
          .map((g) => ({ key: g.capabilityKey }));
        return { rows };
      }
      if (sql.trim().startsWith("SELECT key FROM eos_policy.capabilities")) {
        return { rows: capabilityKeys.map((key) => ({ key })) };
      }
      throw new Error(`fakePool: unrecognized SQL: ${sql}`);
    },
  };
}

async function makeTenantWithGrantedRole(repo, tenantId, subject) {
  let roleId;
  await repo.transact({ tenantId, uid: SYS }, async (tx) => {
    if (!(await repo.getTenant(tenantId))) await tx.createTenant({ key: tenantId, name: tenantId });
    const role = await tx.createRole({ key: RECEIVE_ROLE, name: RECEIVE_ROLE, description: null, origin: "SYSTEM", protected: false });
    roleId = role.id;
    // A principal (identityProvider, externalSubject) is global, never per-tenant -- the SAME
    // Firebase UID may hold memberships in more than one tenant, so it is created once and reused.
    const existing = await repo.getPrincipalBySubject("firebase", subject);
    const principal = existing ?? (await tx.createPrincipal({ identityProvider: "firebase", externalSubject: subject }));
    await tx.createTenantMembership(principal.id);
    await tx.createAssignment({
      principalId: principal.id,
      roleId: role.id,
      scopeType: "global",
      scopeValue: null,
      status: "active",
      grantedBy: SYS,
      grantedAt: new Date().toISOString(),
      accessVersionAtGrant: 0,
    });
  });
  return { roleId };
}

test("allow parity: legacy grants the capability, eos_policy holds the matching role_capabilities grant", async () => {
  const repo = new InMemoryPolicyRepository();
  const { roleId } = await makeTenantWithGrantedRole(repo, TENANT_A, "u1");
  const pool = fakePool({ grants: [{ tenantId: TENANT_A, roleKey: RECEIVE_ROLE, capabilityKey: RECEIVE_CAP }] });
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: RECEIVE_ROLE, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT_A, ["u1"], { db });
  const row = report.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(row.legacyAllow, true);
  assert.equal(row.eosPolicyAllow, true);
  assert.equal(row.parity, "PASS");
  void roleId;
});

test("missing role_capability grant: same legacy assignment, but eos_policy's Role has no grant row -- FAIL, not silently PASS", async () => {
  const repo = new InMemoryPolicyRepository();
  await makeTenantWithGrantedRole(repo, TENANT_A, "u1");
  const pool = fakePool({ grants: [] }); // no grant at all
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: RECEIVE_ROLE, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT_A, ["u1"], { db });
  const row = report.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(row.legacyAllow, true);
  assert.equal(row.eosPolicyAllow, false);
  assert.equal(row.parity, "FAIL");
  assert.equal(row.reason, "MISSING_ROLE_CAPABILITY_GRANT");
  assert.equal(report.capabilityParityReady, false);
});

test("disabled principal: eos_policy refuses outright, evidenced as DISABLED_PRINCIPAL when legacy still allows", async () => {
  const repo = new InMemoryPolicyRepository();
  let roleId;
  await repo.transact({ tenantId: TENANT_A, uid: SYS }, async (tx) => {
    await tx.createTenant({ key: TENANT_A, name: TENANT_A });
    const role = await tx.createRole({ key: RECEIVE_ROLE, name: RECEIVE_ROLE, description: null, origin: "SYSTEM", protected: false });
    roleId = role.id;
    const principal = await tx.createPrincipal({ identityProvider: "firebase", externalSubject: "u1", status: "disabled" });
    await tx.createTenantMembership(principal.id);
    await tx.createAssignment({
      principalId: principal.id, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: SYS, grantedAt: new Date().toISOString(), accessVersionAtGrant: 0,
    });
  });
  const pool = fakePool({ grants: [{ tenantId: TENANT_A, roleKey: RECEIVE_ROLE, capabilityKey: RECEIVE_CAP }] });
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: RECEIVE_ROLE, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT_A, ["u1"], { db });
  const row = report.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(row.reason, "DISABLED_PRINCIPAL");
  assert.equal(row.parity, "FAIL");
  void roleId;
});

test("cross-tenant isolation: tenant B's identically-keyed Role and grant never leak into tenant A's decision", async () => {
  const repo = new InMemoryPolicyRepository();
  await makeTenantWithGrantedRole(repo, TENANT_A, "u1"); // A: role exists, no Postgres grant
  await makeTenantWithGrantedRole(repo, TENANT_B, "u1"); // B: role exists too (different tenant)
  // The grant is recorded ONLY for tenant B.
  const pool = fakePool({ grants: [{ tenantId: TENANT_B, roleKey: RECEIVE_ROLE, capabilityKey: RECEIVE_CAP }] });
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: RECEIVE_ROLE, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  const reportA = await buildInventoryCapabilityParityReport(repo, pool, TENANT_A, ["u1"], { db });
  const rowA = reportA.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(rowA.eosPolicyAllow, false, "tenant A must not see tenant B's grant");
  assert.equal(rowA.reason, "MISSING_ROLE_CAPABILITY_GRANT");
});

test("spoofed tenant refusal: a principal only a member of tenant B, evaluated while stating tenant A, is refused -- reported PASS", async () => {
  const repo = new InMemoryPolicyRepository();
  await makeTenantWithGrantedRole(repo, TENANT_B, "u1"); // u1 belongs only to tenant B
  const pool = fakePool({ grants: [{ tenantId: TENANT_B, roleKey: RECEIVE_ROLE, capabilityKey: RECEIVE_CAP }] });
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: RECEIVE_ROLE, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  // Ask the harness to evaluate u1 against TENANT_A -- a stated tenant u1 is not a member of.
  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT_A, ["u1"], { db });
  const row = report.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(row.reason, "SPOOFED_TENANT_REFUSAL");
  assert.equal(row.parity, "PASS");
  assert.equal(row.eosPolicyAllow, false);
});
