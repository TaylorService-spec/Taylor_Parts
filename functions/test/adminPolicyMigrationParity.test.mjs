// The MIGRATION PARITY HARNESS — its proofs.
//
// The harness exists to answer one question with evidence: does the PostgreSQL policy hold the same
// authority the Firestore one did? These assert that it answers honestly -- that it reports a
// difference rather than smoothing it, and that "in parity" is a claim about EVERY axis rather than
// the convenient ones.
//
// Firestore is a small double here. The harness's job is comparison, and comparison logic does not
// need a real Firestore to be wrong.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import { buildPolicyParityReport, describeParity } from "../lib/adminPolicy/migration/firestorePolicyParityHarness.js";

const TENANT = "tenant-a";
const SYS = "uid-sys";

/** A Firestore stand-in holding legacy roleAssignments and users. READ paths only, like the real one. */
function fakeFirestore({ assignments = [], users = {} } = {}) {
  return {
    collection(name) {
      return {
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

/** A Postgres-side policy with the given roles and assignments. */
async function policyStore(rows = []) {
  const repo = new InMemoryPolicyRepository();
  const roleIdByKey = new Map();
  await repo.transact({ tenantId: TENANT, uid: SYS }, async (tx) => {
    for (const key of [...new Set(rows.map((r) => r.roleKey))]) {
      const role = await tx.createRole({ key, name: key, description: null, origin: "SYSTEM", protected: false });
      roleIdByKey.set(key, role.id);
    }
    for (const row of rows) {
      await tx.createAssignment({
        principalUid: row.principalUid,
        roleId: roleIdByKey.get(row.roleKey),
        scopeType: row.scopeType ?? "global",
        scopeValue: row.scopeValue ?? null,
        status: row.status ?? "active",
        grantedBy: SYS,
        grantedAt: new Date().toISOString(),
        accessVersionAtGrant: 0,
      });
    }
    for (const [uid, version] of Object.entries(rowsToVersions(rows))) {
      for (let i = 0; i < version; i += 1) await tx.bumpAccessVersion(uid);
    }
  });
  return repo;
}

function rowsToVersions(rows) {
  const out = {};
  for (const row of rows) if (row.accessVersion !== undefined) out[row.principalUid] = row.accessVersion;
  return out;
}

// ============================ parity ============================

test("identical stores report IN PARITY", async () => {
  const repo = await policyStore([{ principalUid: "u1", roleKey: "admin", accessVersion: 3 }]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 3 } },
  });

  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.inParity, true);
  assert.equal(report.summary.principalsCompared, 1);
  assert.equal(report.summary.matched, 1);
  assert.equal(report.summary.onlyInFirestore, 0);
  assert.equal(report.summary.onlyInPostgres, 0);
  assert.equal(report.summary.accessVersionMismatches, 0);
});

test("an assignment MISSING from Postgres is reported, not smoothed", async () => {
  const repo = await policyStore([]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 1 } },
  });

  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.inParity, false, "the cutover gate is closed");
  assert.equal(report.summary.onlyInFirestore, 1);
  assert.equal(report.principals[0].onlyInFirestore[0].roleKey, "admin");
});

test("an EXTRA assignment in Postgres is reported too", async () => {
  // Both directions matter. An extra grant in the new store is authority nobody migrated -- which is
  // a worse finding than a missing one, and a harness that only looked for gaps would miss it.
  const repo = await policyStore([
    { principalUid: "u1", roleKey: "admin", accessVersion: 1 },
    { principalUid: "u1", roleKey: "owner" },
  ]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 2 } },
  });

  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.inParity, false);
  assert.equal(report.summary.onlyInPostgres, 1);
  assert.equal(report.principals[0].onlyInPostgres[0].roleKey, "owner");
});

test("SCOPE is part of the comparison", async () => {
  // The same Role at a different scope is a different grant. Comparing on (principal, role) alone
  // would call a global grant and a single-warehouse grant equal.
  const repo = await policyStore([
    { principalUid: "u1", roleKey: "warehouseManager", scopeType: "location", scopeValue: "wh-north", accessVersion: 1 },
  ]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "warehouseManager", scope: { type: "location", value: "wh-south" }, status: "active" }],
    users: { u1: { accessVersion: 1 } },
  });

  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.inParity, false);
  assert.equal(report.summary.onlyInFirestore, 1);
  assert.equal(report.summary.onlyInPostgres, 1);
});

test("STATUS is part of the comparison", async () => {
  const repo = await policyStore([{ principalUid: "u1", roleKey: "admin", status: "active", accessVersion: 1 }]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "disabled" }],
    users: { u1: { accessVersion: 1 } },
  });
  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.inParity, false, "a disabled grant and an active one are not the same authority");
});

test("an ACCESS VERSION mismatch alone closes the gate", async () => {
  // The assignments match perfectly and the report is still NOT in parity. A cutover with a stale
  // version counter would silently re-validate grants a change had excluded.
  const repo = await policyStore([{ principalUid: "u1", roleKey: "admin", accessVersion: 2 }]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 7 } },
  });

  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.summary.matched, 1, "the assignments themselves agree");
  assert.equal(report.summary.accessVersionMismatches, 1);
  assert.equal(report.inParity, false, "and it is still not safe to cut over");
});

test("a MALFORMED legacy row is skipped rather than guessed at", async () => {
  // Inventing a shape for it would manufacture parity that does not exist.
  const repo = await policyStore([]);
  const db = fakeFirestore({
    assignments: [
      { roleId: "admin", scope: { type: "global" }, status: "active" }, // no principalUid
      { principalUid: "u1" }, // no roleId
    ],
    users: {},
  });
  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.summary.principalsCompared, 0, "neither row produced a comparison");
});

test("a principal with no legacy row at all is not invented", async () => {
  // The harness compares the legacy population forward. A Postgres-only principal shows up under
  // that principal only if the legacy store knew them -- otherwise there is nothing to compare, and
  // reporting a phantom difference would be noise.
  const repo = await policyStore([{ principalUid: "u-new", roleKey: "admin" }]);
  const db = fakeFirestore({ assignments: [], users: {} });
  const report = await buildPolicyParityReport(repo, TENANT, { db });
  assert.equal(report.summary.principalsCompared, 0);
  assert.equal(report.inParity, true, "an empty legacy store is trivially in parity");
});

test("the summary reads as a decision, not a data dump", async () => {
  const repo = await policyStore([]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 1 } },
  });
  const text = describeParity(await buildPolicyParityReport(repo, TENANT, { db }));
  assert.match(text, /NOT IN PARITY -- do not cut over/);

  const clean = await policyStore([{ principalUid: "u1", roleKey: "admin", accessVersion: 1 }]);
  const cleanText = describeParity(await buildPolicyParityReport(clean, TENANT, { db }));
  assert.match(cleanText, /IN PARITY -- the old path may be cut over and deleted/);
});

test("the harness returns NO Firestore data as policy", async () => {
  // The shape is a REPORT. There is no path by which a caller could take a legacy row out of it and
  // use it as an authority -- which is what keeps this from becoming a fallback.
  const repo = await policyStore([]);
  const db = fakeFirestore({
    assignments: [{ principalUid: "u1", roleId: "admin", scope: { type: "global" }, status: "active" }],
    users: { u1: { accessVersion: 1 } },
  });
  const report = await buildPolicyParityReport(repo, TENANT, { db });

  assert.deepEqual(Object.keys(report).sort(), ["generatedAt", "inParity", "principals", "summary", "tenantId"]);
  // Every legacy row appears only inside a DIFFERENCE list, described by role KEY -- never as a
  // resolvable grant with an id the resolver could act on.
  const legacy = report.principals[0].onlyInFirestore[0];
  assert.deepEqual(Object.keys(legacy).sort(), ["principalUid", "roleKey", "scopeType", "scopeValue", "status"]);
  assert.equal("roleId" in legacy, false, "no id a resolver could dereference");
});
