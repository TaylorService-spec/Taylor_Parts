// DENY/DENY IS NOT READINESS -- the vacuity proofs for functions/scripts/
// inventoryCapabilityParityHarness.js, at baseline 64008d5ae0bdd9532909671b15a91122400accf1.
//
// WHAT THIS SUITE EXISTS TO STOP. `classify()` compared `legacyAllow === target.allow` before
// inspecting any refusal, so "denied by both sides" scored PASS with reason "NONE", and the
// unresolved-identity guards only read reasons that are set on FAIL rows. MEASURED at this
// baseline, before the fix: a principal holding NONE of the eighteen census capabilities reported
// 18/18 PASS -> CAPABILITY_PARITY_READY = true. So did a principal absent from eos_policy
// ENTIRELY. So did a tenant in which not one capability was even DEFINED. Because
// `capabilityParityReady` is documented condition 1 for deleting the harness and re-pointing eight
// writers' authorization, a principal with no permissions at all could certify the cutover.
//
// Owner ruling G0-2 is the specification: DEFINED + ACTIVATED + ROLE GRANTED + PRINCIPAL ASSIGNED
// + CONTEXT AUTHORITY = AUTHORIZED USE, and deny/deny MAY be recorded as a PARITY OBSERVATION but
// is NOT proof of reachability. So both directions are proved here:
//
//   VACUOUS input must NOT read as ready          (tests 1-5)
//   a genuinely REACHABLE capability still does    (tests 6-8)
//
// WHY inventory.stock.receive IS THE REACHABILITY CAPABILITY. Resolved -- not grepped -- through
// the SAME shipped modules the harness itself requires (lib/access/resolveEffectivePermission.js
// over lib/access/compatibilityRoles.js + lib/access/governedBusinessRoles.js), it is the ONE
// census capability carrying no `active:false` flag, and it resolves ALLOW for exactly four Roles:
// admin, dispatcher, owner and the purpose-built inventoryReceivingClerk. `owner` is a DERIVED
// holder (OWNER_PERMISSIONS composes from ADMIN_ROLE) and `admin` is spread the whole catalogue by
// compatibilityRoles.ts, which is why the count must be resolved rather than read off a grep. The
// proofs below use inventoryReceivingClerk: a NON-ADMIN principal, so no broad Administrator grant
// is invented merely to make a test green. The other thirteen CAPABILITY_CATALOG census keys are
// `active:false`, hence refused for every principal with no activation override in force -- which
// is exactly why deny/deny rows are the DEFAULT state here and why scoring them PASS was fatal.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { WRITER_CAPABILITY_CENSUS } from "../lib/eosOps/migration/inventoryWriterCapabilityCensus.js";
import {
  classify,
  buildInventoryCapabilityParityReport,
  describeCapabilityParity,
} from "../scripts/inventoryCapabilityParityHarness.js";

const TENANT = "tenant-a";
const SYS = "uid-sys";
const RECEIVE_OP = "receiving.receive";
const RECEIVE_CAP = "inventory.stock.receive";
const CLERK = "inventoryReceivingClerk";
const CENSUS_KEYS = [...new Set(WRITER_CAPABILITY_CENSUS.map((o) => o.capabilityKey))];

/** Firestore stand-in. READ paths only -- the harness has no write path into either store. */
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
function fakePool({ grants = [], capabilityKeys = CENSUS_KEYS } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes("role_capabilities rc")) {
        const [tenantId, roleKeys] = params;
        return {
          rows: grants
            .filter((g) => g.tenantId === tenantId && roleKeys.includes(g.roleKey))
            .map((g) => ({ key: g.capabilityKey })),
        };
      }
      if (sql.trim().startsWith("SELECT key FROM eos_policy.capabilities")) {
        return { rows: capabilityKeys.map((key) => ({ key })) };
      }
      throw new Error(`fakePool: unrecognized SQL: ${sql}`);
    },
  };
}

/** An eos_policy tenant in which `subject` is an active member holding `roleKey`. */
async function tenantWithPrincipal(repo, tenantId, subject, roleKey) {
  await repo.transact({ tenantId, uid: SYS }, async (tx) => {
    if (!(await repo.getTenant(tenantId))) await tx.createTenant({ key: tenantId, name: tenantId });
    const existing = await repo.getPrincipalBySubject("firebase", subject);
    const principal = existing ?? (await tx.createPrincipal({ identityProvider: "firebase", externalSubject: subject }));
    await tx.createTenantMembership(principal.id);
    if (roleKey) {
      const role = await tx.createRole({ key: roleKey, name: roleKey, description: null, origin: "SYSTEM", protected: false });
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
    }
  });
}

const emptyFirestore = fakeFirestore();

// ───────────────────────── DIRECTION 1: vacuous input must NOT read as ready ─────────────────────

test("classify: deny/deny is an OBSERVATION, never a PASS, and demonstrates nothing", () => {
  const target = { allow: false, refusal: null, heldRoleKeys: [CLERK], hadStaleAssignment: false, capabilityKnownInCatalog: true };
  const verdict = classify({ allow: false, reason: "noQualifyingGrant" }, target);
  assert.equal(verdict.parity, "OBSERVATION");
  assert.notEqual(verdict.parity, "PASS", "deny/deny must never be scored a pass");
  assert.equal(verdict.reason, "DENY_DENY_NO_ROLE_CAPABILITY_GRANT");
  assert.equal(verdict.demonstrates, "NONE", "deny/deny supplies no readiness evidence");
});

test("classify: ACTIVATION absence and GRANT absence are distinct, named reasons -- not one pooled failure", () => {
  const base = { allow: false, refusal: null, heldRoleKeys: [CLERK], hadStaleAssignment: false, capabilityKnownInCatalog: true };
  // The legacy resolver refuses an `active:false` capability BEFORE it inspects any grant, so these
  // two are different facts about different G0-2 layers and must not collapse into one reason.
  assert.equal(classify({ allow: false, reason: "inactivePermission" }, base).reason, "DENY_DENY_CAPABILITY_NOT_ACTIVATED");
  assert.equal(classify({ allow: false, reason: "noQualifyingGrant" }, base).reason, "DENY_DENY_NO_ROLE_CAPABILITY_GRANT");
  assert.notEqual(
    classify({ allow: false, reason: "inactivePermission" }, base).reason,
    classify({ allow: false, reason: "noQualifyingGrant" }, base).reason,
  );
  // And the DEFINITION layer is named ahead of both, in G0-2's own layer order.
  assert.equal(
    classify({ allow: false, reason: "inactivePermission" }, { ...base, capabilityKnownInCatalog: false }).reason,
    "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_TARGET",
  );
  assert.equal(classify({ allow: false, reason: "unknownPermission" }, base).reason, "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_LEGACY");
});

test("classify: an unresolved principal is NAMED on a deny/deny row -- the guards no longer read FAIL rows only", () => {
  const base = { allow: false, refusal: null, heldRoleKeys: [], hadStaleAssignment: false, capabilityKnownInCatalog: true };
  assert.equal(classify({ allow: false, reason: "noQualifyingGrant" }, { ...base, refusal: "UNKNOWN_PRINCIPAL" }).reason, "DENY_DENY_TARGET_PRINCIPAL_UNKNOWN");
  assert.equal(classify({ allow: false, reason: "noQualifyingGrant" }, { ...base, refusal: "PRINCIPAL_DISABLED" }).reason, "DENY_DENY_TARGET_PRINCIPAL_DISABLED");
  assert.equal(classify({ allow: false, reason: "noQualifyingGrant" }, { ...base, refusal: "NO_TENANT_MEMBERSHIP" }).reason, "DENY_DENY_TARGET_NO_ACTIVE_ASSIGNMENT");
});

test("VACUITY: a principal holding NONE of the census capabilities is NOT CAPABILITY_PARITY_READY", async () => {
  const repo = new InMemoryPolicyRepository();
  await tenantWithPrincipal(repo, TENANT, "nobody", null); // member of the tenant, holds no Role
  const report = await buildInventoryCapabilityParityReport(repo, fakePool({ grants: [] }), TENANT, ["nobody"], { db: emptyFirestore });

  assert.equal(report.rows.length, WRITER_CAPABILITY_CENSUS.length);
  assert.equal(report.summary.passed, 0, "no row may be scored a pass");
  assert.equal(report.summary.observations, report.rows.length, "every row is a deny/deny observation");
  assert.equal(report.summary.demonstratedAllow, 0);
  // THE PARITY AXIS AND THE REACHABILITY AXIS ARE SEPARATELY VISIBLE, per Owner ruling G0-2 --
  // the stores genuinely do agree everywhere, and nothing was shown to be reachable. Both facts
  // must be readable from the report at once, not merged into one boolean.
  assert.equal(report.inParity, true, "deny/deny is a true parity observation");
  assert.equal(report.reachabilityProven, false, "...and it is NOT proof of reachability");
  assert.equal(report.capabilityParityReady, false, "THE VACUITY FIX: this must not certify the cutover");
  assert.ok(report.readinessBlockers.some((b) => b.startsWith("NO_NON_VACUOUS_PASS")));
  // The operator summary must say so in words, not only in a boolean.
  const text = describeCapabilityParity(report);
  assert.match(text, /NOT READY/);
  assert.match(text, /NOT proof of reachability/);
});

test("VACUITY: a principal ABSENT from eos_policy entirely is NOT ready -- and its identity is reported", async () => {
  const repo = new InMemoryPolicyRepository();
  await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    await tx.createTenant({ key: TENANT, name: TENANT });
  });
  const report = await buildInventoryCapabilityParityReport(repo, fakePool({ grants: [] }), TENANT, ["ghost-never-provisioned"], { db: emptyFirestore });

  assert.equal(report.capabilityParityReady, false);
  assert.equal(report.summary.demonstratedAllow, 0);
  assert.ok(
    report.rows.some((r) => r.reason === "DENY_DENY_TARGET_PRINCIPAL_UNKNOWN"),
    "an unmapped principal must be NAMED, not absorbed into silent parity",
  );
  assert.ok(report.readinessBlockers.includes("UNRESOLVED_PRINCIPAL_IDENTITY"));
});

test("VACUITY: a tenant in which NO capability is even DEFINED is NOT ready", async () => {
  const repo = new InMemoryPolicyRepository();
  await tenantWithPrincipal(repo, TENANT, "nobody", null);
  const bare = fakePool({ grants: [], capabilityKeys: [] }); // eos_policy.capabilities is empty
  const report = await buildInventoryCapabilityParityReport(repo, bare, TENANT, ["nobody"], { db: emptyFirestore });

  assert.equal(report.capabilityParityReady, false);
  assert.ok(report.rows.every((r) => r.reason === "DENY_DENY_CAPABILITY_NOT_DEFINED_IN_TARGET"));
  assert.ok(report.readinessBlockers.includes("UNRESOLVED_ROLE_OR_CAPABILITY_DEFINITION"));
});

// ─────────────────── DIRECTION 2: a genuinely reachable capability still reads ready ─────────────

const RECEIVE_ONLY = WRITER_CAPABILITY_CENSUS.filter((o) => o.operationKey === RECEIVE_OP);
const RECEIVE_PLUS_INACTIVE = WRITER_CAPABILITY_CENSUS.filter(
  (o) => o.operationKey === RECEIVE_OP || o.operationKey === "serializedInstall.install",
);

/** The clerk, wired identically on both sides: legacy roleAssignment + eos_policy Role and grant. */
async function reachableClerk({ grantReceive = true } = {}) {
  const repo = new InMemoryPolicyRepository();
  await tenantWithPrincipal(repo, TENANT, "u-clerk", CLERK);
  const pool = fakePool({ grants: grantReceive ? [{ tenantId: TENANT, roleKey: CLERK, capabilityKey: RECEIVE_CAP }] : [] });
  const db = fakeFirestore({
    users: { "u-clerk": { role: "receivingClerk", accessVersion: 0 } },
    assignments: [{ principalUid: "u-clerk", roleId: CLERK, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });
  return { repo, pool, db };
}

test("REACHABLE: a NON-ADMIN inventoryReceivingClerk holding inventory.stock.receive on both sides IS ready", async () => {
  const { repo, pool, db } = await reachableClerk();
  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, ["u-clerk"], { db, operations: RECEIVE_ONLY });

  const row = report.rows.find((r) => r.operationKey === RECEIVE_OP);
  assert.equal(row.legacyAllow, true, "the SHIPPED legacy resolver allows the clerk");
  assert.equal(row.eosPolicyAllow, true);
  assert.equal(row.parity, "PASS");
  assert.equal(row.demonstrates, "EXPECTED_ALLOW", "this is the NON-VACUOUS row");
  assert.equal(report.summary.demonstratedAllow, 1);
  assert.equal(report.inParity, true);
  assert.equal(report.reachabilityProven, true);
  assert.equal(report.capabilityParityReady, true, "a genuinely reachable capability must still read READY");
  assert.deepEqual([...report.readinessBlockers], []);
});

test("REACHABLE: readiness turns on the DEMONSTRATED ALLOW -- remove the grant and the same tenant stops being ready", async () => {
  // Identical wiring, one difference: eos_policy has no role_capabilities row. The clerk's legacy
  // ALLOW now disagrees with eos_policy, so this is a genuine FAIL, not a vacuous pass.
  const { repo, pool, db } = await reachableClerk({ grantReceive: false });
  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, ["u-clerk"], { db, operations: RECEIVE_ONLY });

  assert.equal(report.rows[0].parity, "FAIL");
  assert.equal(report.rows[0].reason, "MISSING_ROLE_CAPABILITY_GRANT");
  assert.equal(report.inParity, false);
  assert.equal(report.reachabilityProven, false);
  assert.equal(report.capabilityParityReady, false);
});

test("REACHABLE: a legitimate deny/deny row alongside the demonstrated ALLOW does not block readiness", async () => {
  // equipment.install is `active:false`, so the legacy resolver refuses it for EVERY principal and
  // eos_policy grants it to nobody. That row is a true parity observation; it must be RECORDED and
  // named, must contribute nothing, and must not veto the reachability the receive row proved.
  const { repo, pool, db } = await reachableClerk();
  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, ["u-clerk"], { db, operations: RECEIVE_PLUS_INACTIVE });

  assert.equal(report.summary.compared, 2);
  assert.equal(report.summary.passed, 1);
  assert.equal(report.summary.observations, 1);
  assert.equal(report.summary.failed, 0);
  const observed = report.rows.find((r) => r.parity === "OBSERVATION");
  assert.equal(observed.reason, "DENY_DENY_CAPABILITY_NOT_ACTIVATED", "activation absence is named, not pooled");
  assert.equal(report.capabilityParityReady, true);
});

test("the report NAMES what it cannot evidence, so the boolean is never mistaken for G0-2's whole bar", async () => {
  const { repo, pool, db } = await reachableClerk();
  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, ["u-clerk"], { db, operations: RECEIVE_ONLY });
  assert.ok(report.readinessEvidenceGaps.length >= 4);
  assert.ok(report.readinessEvidenceGaps.some((g) => g.startsWith("ENVIRONMENT_ISOLATION")));
  assert.ok(report.readinessEvidenceGaps.some((g) => g.startsWith("NO_PRODUCTION_INHERITANCE")));
  assert.ok(report.readinessEvidenceGaps.some((g) => g.startsWith("EXPECTED_DENY_AGAINST_A_STATED_EXPECTATION")));
  assert.match(describeCapabilityParity(report), /NOT EVIDENCED BY THIS HARNESS/);
});

// ───────────────── the activation gap the grant migration walks into, measured ───────────────────

test("ACTIVATION: eos_policy has no activation concept, so granting an `active:false` capability moves a tenant AWAY from parity", async () => {
  // Re-verified at this baseline: eos_policy.capabilities is (id, key, description, origin,
  // created_at) -- no `active` column and no activation table -- while the legacy resolver denies
  // on `inactivePermission` AHEAD of any grant. So a grant row for an active:false capability
  // produces legacy=DENY vs eos_policy=ALLOW. Named as its own reason rather than as a stray grant,
  // because the cause is a MISSING MODEL in the target, not a mistaken row.
  const repo = new InMemoryPolicyRepository();
  await tenantWithPrincipal(repo, TENANT, "u-clerk", CLERK);
  const install = WRITER_CAPABILITY_CENSUS.filter((o) => o.operationKey === "serializedInstall.install");
  const pool = fakePool({ grants: [{ tenantId: TENANT, roleKey: CLERK, capabilityKey: "equipment.install" }] });
  const db = fakeFirestore({
    users: { "u-clerk": { role: "receivingClerk", accessVersion: 0 } },
    assignments: [{ principalUid: "u-clerk", roleId: CLERK, scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 }],
  });

  const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, ["u-clerk"], { db, operations: install });
  assert.equal(report.rows[0].legacyAllow, false);
  assert.equal(report.rows[0].legacyDenyReason, "inactivePermission");
  assert.equal(report.rows[0].eosPolicyAllow, true);
  assert.equal(report.rows[0].parity, "FAIL");
  assert.equal(report.rows[0].reason, "TARGET_IGNORES_CAPABILITY_ACTIVATION");
  assert.equal(report.capabilityParityReady, false);
});

test("a STALE assignment on a deny/deny row still blocks readiness -- no unresolved assignment hides in an observation", () => {
  // The other half of the original defect: the guards read reasons only on FAIL rows, so any
  // identity or assignment problem that made BOTH sides deny became an invisible PASS. Every such
  // reason is now named on the OBSERVATION row and every one of them is a readiness blocker.
  const target = { allow: false, refusal: null, heldRoleKeys: [], hadStaleAssignment: true, capabilityKnownInCatalog: true };
  const verdict = classify({ allow: false, reason: "noQualifyingGrant" }, target);
  assert.equal(verdict.parity, "OBSERVATION");
  assert.equal(verdict.reason, "DENY_DENY_TARGET_ASSIGNMENT_STALE");
});

test("every deny/deny reason that names an unresolved identity, assignment, role or definition blocks readiness", async () => {
  // Proved through the REPORT, not by re-reading the constant: each construction below is a real
  // report whose only non-PASS rows are deny/deny observations, and each must still be NOT READY.
  const blocking = [
    ["unknown principal", async () => {
      const repo = new InMemoryPolicyRepository();
      await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => { await tx.createTenant({ key: TENANT, name: TENANT }); });
      return { repo, pool: fakePool({ grants: [] }), db: emptyFirestore };
    }],
    ["no role held", async () => {
      const repo = new InMemoryPolicyRepository();
      await tenantWithPrincipal(repo, TENANT, "nobody", null);
      return { repo, pool: fakePool({ grants: [] }), db: emptyFirestore };
    }],
    ["capability not defined in target", async () => {
      const repo = new InMemoryPolicyRepository();
      await tenantWithPrincipal(repo, TENANT, "nobody", null);
      return { repo, pool: fakePool({ grants: [], capabilityKeys: [] }), db: emptyFirestore };
    }],
  ];
  for (const [label, build] of blocking) {
    const { repo, pool, db } = await build();
    const subject = label === "unknown principal" ? "ghost-never-provisioned" : "nobody";
    const report = await buildInventoryCapabilityParityReport(repo, pool, TENANT, [subject], { db, operations: RECEIVE_ONLY });
    assert.equal(report.summary.failed, 0, `${label}: parity itself does not disagree`);
    assert.equal(report.capabilityParityReady, false, `${label}: must not read as ready`);
    assert.ok(report.readinessBlockers.length > 0, `${label}: must name a blocker`);
  }
});
