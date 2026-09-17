// SECURITY ROLE ASSIGNMENT CENSUS -- the offline proofs. No Firebase, no database, no network.
//
// The census is the evidence step before Security Role assignment authority converges on PostgreSQL. These assert
// that it answers honestly: legacy subjects are resolved through the identity model (never used as Principal ids),
// each store's assignments are judged by that store's own qualification rule, scoped and conditioned-role grants
// are refused for migration, the legacy `users.role` string stays in its own section, both diff directions are
// reported, and the output is deterministic down to its checksum.
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryPolicyRepository } from "../lib/adminPolicy/inMemoryPolicyRepository.js";
import {
  LEGACY_USERS_ROLE,
  MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY,
  RoleAssignmentCensusError,
  buildRoleAssignmentCensus,
  declaredRoleCatalogFacts,
  describeRoleAssignmentCensus,
} from "../lib/adminPolicy/migration/roleAssignmentCensus.js";
import {
  CENSUS_TENANT_KEY,
  LEGACY_ASSIGNMENTS,
  LEGACY_PRIVILEGED_REQUESTS,
  LEGACY_USERS,
  arrayLegacyReader,
  seedPolicyWorld,
} from "./support/roleAssignmentCensusFixture.mjs";

async function world() {
  const repo = new InMemoryPolicyRepository();
  await seedPolicyWorld(repo);
  return repo;
}

const census = async (repo, legacy = arrayLegacyReader(), extra = {}) =>
  buildRoleAssignmentCensus({ legacy, policy: repo, tenantKey: CENSUS_TENANT_KEY, ...extra });

const row = (c, documentId) => c.firestore.rows.find((r) => r.documentId === documentId);

// ════════════════════ identity ════════════════════

test("a legacy subject resolves to a Principal by (firebase, subject) -- and is NEVER used as a Principal id", async () => {
  const repo = await world();
  // A Principal from ANOTHER provider carrying the same subject string must not satisfy the firebase lookup.
  await repo.transact({ tenantId: "tenant-census", uid: "t" }, async (tx) => {
    await tx.createPrincipal({ externalSubject: "u-noprincipal", identityProvider: "saml" });
  });
  const legacyUids = new Set([...LEGACY_ASSIGNMENTS, ...LEGACY_USERS].map((d) => d.data.principalUid ?? d.id));
  const byId = [];
  const spy = new Proxy(repo, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args) => {
        if (["listAssignmentsForPrincipal", "getAccessVersion", "getMembership"].includes(prop)) byId.push(args[1]);
        if (["getPrincipal", "listMembershipsForPrincipal"].includes(prop)) byId.push(args[0]);
        if (prop === "transact") throw new Error("the census opened a transaction");
        return value.apply(target, args);
      };
    },
  });
  const c = await census(spy);
  assert.ok(byId.length > 0);
  assert.deepEqual(byId.filter((id) => legacyUids.has(id)), [], "no Principal-id read was made with a raw legacy uid");

  assert.ok(row(c, "ra-01").principalId, "u-matched resolved");
  assert.notEqual(row(c, "ra-01").principalId, "u-matched");
  assert.equal(row(c, "ra-04").principalId, null, "a saml Principal with the same subject is not a firebase Principal");
  assert.deepEqual(c.identity.subjectsWithoutPrincipal, ["u-future", "u-noprincipal"]);
});

test("a Principal with no ACTIVE membership in the tenant is reported", async () => {
  const c = await census(await world());
  assert.deepEqual(c.identity.principalsWithoutActiveMembership.map((p) => [p.subject, p.membershipStatus]), [["u-nomember", "disabled"]]);
  assert.equal(c.summary.principalsWithoutActiveMembership, 1);
});

// ════════════════════ role keys ════════════════════

test("a legacy roleId with no Role key in the tenant is reported, and catalog gaps are listed", async () => {
  const c = await census(await world());
  assert.deepEqual(c.roleKeys.legacyRoleIdsMissingInTenant, ["salesManager"]);
  assert.deepEqual(c.roleKeys.legacyRoleIdsNotInCatalog, []);
  assert.equal(row(c, "ra-05").roleKeyInTenant, false);
  assert.equal(row(c, "ra-05").roleKeyInCatalog, true);
  assert.equal(c.roleKeys.catalogRoleKeysMissingInTenant.length, declaredRoleCatalogFacts().roleKeys.length - 5);
  assert.ok(c.roleKeys.catalogRoleKeysMissingInTenant.includes("salesManager"));
});

test("a legacy roleId outside the declared catalog is reported as such", async () => {
  const legacy = arrayLegacyReader({
    assignments: [{ id: "x", data: { principalUid: "u-matched", roleId: "superUser", scope: { type: "global" }, status: "active", accessVersionAtGrant: 0 } }],
  });
  const c = await census(await world(), legacy);
  assert.deepEqual(c.roleKeys.legacyRoleIdsNotInCatalog, ["superUser"]);
  assert.deepEqual(c.roleKeys.legacyRoleIdsMissingInTenant, ["superUser"]);
});

// ════════════════════ refusals ════════════════════

test("scoped and conditioned-role legacy grants are flagged MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY", async () => {
  const c = await census(await world());
  assert.deepEqual(declaredRoleCatalogFacts().conditionedRoleKeys, ["admin", "dispatcher", "owner", "technician"]);
  assert.deepEqual(row(c, "ra-01").migrationRefusal, { code: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, reasons: ["CONDITIONED_ROLE"] });
  assert.deepEqual(row(c, "ra-02").migrationRefusal, { code: MIGRATION_REFUSED_UNTIL_EVALUATOR_PARITY, reasons: ["SCOPED"] });
  assert.equal(row(c, "ra-03").migrationRefusal, null);
  assert.deepEqual(
    { count: c.migrationRefusals.count, scoped: c.migrationRefusals.scoped, conditionedRole: c.migrationRefusals.conditionedRole, ids: c.migrationRefusals.documentIds },
    { count: 2, scoped: 1, conditionedRole: 1, ids: ["ra-01", "ra-02"] },
  );
});

test("a grant that is BOTH scoped and conditioned carries both reasons; the catalog facts are injectable", async () => {
  const legacy = arrayLegacyReader({
    assignments: [{ id: "x", data: { principalUid: "u-matched", roleId: "partsManager", scope: { type: "operatingCompany", value: "oc-1" }, status: "active", accessVersionAtGrant: 0 } }],
  });
  const c = await census(await world(), legacy, { catalog: { roleKeys: ["partsManager"], conditionedRoleKeys: ["partsManager"] } });
  assert.deepEqual(row(c, "x").migrationRefusal.reasons, ["SCOPED", "CONDITIONED_ROLE"]);
});

test("PostgreSQL grants the evaluator reads as global despite a scope are surfaced", async () => {
  const c = await census(await world());
  const scoped = c.postgres.rows.filter((r) => r.evaluatorIgnoresScope);
  assert.deepEqual(scoped.map((r) => [r.subject, r.roleKey, r.scopeType, r.scopeValue]), [["u-pgonly", "technician", "location", "wh-9"]]);
  assert.equal(c.summary.postgresEvaluatorIgnoresScope, 1);
});

// ════════════════════ qualification, per store ════════════════════

test("each assignment is judged by ITS OWN store's version rule -- the two counters are never compared", async () => {
  const c = await census(await world());
  assert.deepEqual(
    c.firestore.rows.map((r) => [r.documentId, r.legacyQualification.reason]),
    [
      ["ra-01", "QUALIFIES"],
      ["ra-02", "QUALIFIES"],
      ["ra-03", "GRANTED_AFTER_CURRENT_ACCESS_VERSION"], // no profile document reads 0
      ["ra-04", "GRANTED_AFTER_CURRENT_ACCESS_VERSION"],
      ["ra-05", "QUALIFIES"],
      ["ra-06", "GRANTED_AFTER_CURRENT_ACCESS_VERSION"],
      ["ra-07", "NOT_ACTIVE"],
    ],
  );
  assert.equal(c.firestore.assignments.qualifyingUnderLegacyRule, 3);
  const pg = Object.fromEntries(c.postgres.rows.map((r) => [`${r.subject}:${r.roleKey}`, r.postgresQualification.reason]));
  assert.deepEqual(pg, {
    "u-matched:admin": "QUALIFIES",
    "u-matched:reportViewer": "QUALIFIES",
    "u-disabled:partsManager": "QUALIFIES",
    "u-pgonly:technician": "GRANTED_AFTER_CURRENT_ACCESS_VERSION",
  });
  const text = JSON.stringify(c);
  assert.doesNotMatch(text, /accessVersionMismatch/i, "no cross-store counter comparison exists");
});

test("a malformed legacy accessVersion disqualifies under the legacy rule rather than reading as 0", async () => {
  const legacy = arrayLegacyReader({ users: [{ id: "u-matched", data: { accessVersion: "5" } }] });
  const c = await census(await world(), legacy);
  assert.equal(row(c, "ra-01").legacyQualification.reason, "CURRENT_ACCESS_VERSION_MALFORMED");
});

test("malformed legacy rows are reported and excluded from the comparison", async () => {
  const c = await census(await world());
  assert.deepEqual(c.firestore.malformedAssignments, [
    { documentId: "bad-1", reason: "PRINCIPAL_UID_MISSING" },
    { documentId: "bad-2", reason: "SCOPE_INVALID" },
  ]);
  assert.equal(c.firestore.assignments.total, 7);
  assert.ok(!JSON.stringify(c.diff).includes("bad-"));
});

// ════════════════════ counts ════════════════════

test("legacy assignments are counted by roleId and by scope type, active and disabled", async () => {
  const c = await census(await world());
  assert.deepEqual([c.firestore.assignments.active, c.firestore.assignments.disabled], [6, 1]);
  assert.deepEqual(c.firestore.assignments.byRoleId, [
    { roleId: "admin", active: 1, disabled: 0 },
    { roleId: "generalManager", active: 2, disabled: 0 },
    { roleId: "partsManager", active: 1, disabled: 1 },
    { roleId: "reportViewer", active: 1, disabled: 0 },
    { roleId: "salesManager", active: 1, disabled: 0 },
  ]);
  assert.deepEqual(c.firestore.assignments.byScopeType, [
    { scopeType: "global", active: 5, disabled: 1 },
    { scopeType: "location", active: 1, disabled: 0 },
  ]);
});

// ════════════════════ the diff ════════════════════

test("the diff reports BOTH directions by principal + Role key + scope, and an active/disabled disagreement", async () => {
  const c = await census(await world());
  const summarize = (list) => list.map((d) => `${d.subject}|${d.roleKey}|${d.scopeType}|${d.scopeValue ?? ""}`).sort();
  assert.equal(c.diff.matched.length, 1, "u-matched global admin");
  assert.deepEqual(summarize(c.diff.onlyInFirestore), [
    "u-future|generalManager|global|",
    "u-matched|reportViewer|location|wh-1",
    "u-matched|salesManager|global|",
    "u-nomember|partsManager|global|",
    "u-noprincipal|generalManager|global|",
  ]);
  assert.deepEqual(summarize(c.diff.onlyInPostgres), [
    "u-matched|reportViewer|global|",
    "u-pgonly|technician|location|wh-9",
  ]);
  assert.equal(c.diff.activeStatusMismatch.length, 1);
  assert.deepEqual([c.diff.activeStatusMismatch[0].firestoreActive, c.diff.activeStatusMismatch[0].postgresActive], [false, true]);
  const unresolved = c.diff.onlyInFirestore.find((d) => d.subject === "u-noprincipal");
  assert.equal(unresolved.principalId, null);
  assert.match(unresolved.grantKey, /^unresolved:firebase:u-noprincipal\|/);
});

test("identical stores report no difference", async () => {
  const repo = await world();
  const legacy = arrayLegacyReader({
    assignments: [
      { id: "a", data: { principalUid: "u-matched", roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
      { id: "b", data: { principalUid: "u-matched", roleId: "reportViewer", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
      { id: "c", data: { principalUid: "u-disabled", roleId: "partsManager", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
      { id: "d", data: { principalUid: "u-pgonly", roleId: "technician", scope: { type: "location", value: "wh-9" }, status: "active", accessVersionAtGrant: 0 } },
    ],
  });
  const c = await census(repo, legacy);
  assert.deepEqual([c.summary.onlyInFirestore, c.summary.onlyInPostgres, c.summary.activeStatusMismatch, c.summary.matched], [0, 0, 0, 4]);
});

// ════════════════════ LEGACY_USERS_ROLE ════════════════════

test("users.role values are reported SEPARATELY as LEGACY_USERS_ROLE and never become assignments", async () => {
  const c = await census(await world());
  assert.equal(c.legacyUsersRole.classification, LEGACY_USERS_ROLE);
  assert.equal(c.legacyUsersRole.mergedIntoAssignments, false);
  assert.deepEqual(c.legacyUsersRole.rows.map((r) => [r.uid, r.role, r.malformed]), [
    ["u-badrole", null, true],
    ["u-future", "dispatcher", false],
    ["u-matched", "admin", false],
    ["u-roleonly", "technician", false],
  ]);
  assert.deepEqual(c.legacyUsersRole.byValue, [
    { role: "(malformed)", count: 1 },
    { role: "admin", count: 1 },
    { role: "dispatcher", count: 1 },
    { role: "technician", count: 1 },
  ]);
  // u-roleonly holds a legacy role string and NO assignment: it must appear nowhere else in the report.
  const { legacyUsersRole, ...rest } = c;
  assert.ok(!JSON.stringify(rest).includes("u-roleonly"), "a users.role value is never inferred into an assignment or a diff");
  assert.equal(c.firestore.rows.some((r) => r.subject === "u-future" && r.roleKey === "dispatcher"), false);
});

// ════════════════════ privileged requests ════════════════════

test("pending privileged role requests are counted", async () => {
  const c = await census(await world());
  assert.equal(c.privilegedRoleRequests.total, LEGACY_PRIVILEGED_REQUESTS.length);
  assert.equal(c.privilegedRoleRequests.pendingApproval, 2);
  assert.deepEqual(c.privilegedRoleRequests.byStatus, [{ status: "APPROVED", count: 1 }, { status: "PENDING_APPROVAL", count: 2 }]);
});

// ════════════════════ determinism, tenancy, read-only ════════════════════

test("output is deterministic: input order does not change the report or its checksum", async () => {
  const repo = await world();
  const a = await census(repo);
  const b = await census(repo, arrayLegacyReader({
    assignments: [...LEGACY_ASSIGNMENTS].reverse(),
    users: [...LEGACY_USERS].reverse(),
    requests: [...LEGACY_PRIVILEGED_REQUESTS].reverse(),
  }));
  assert.match(a.reportSha256, /^[0-9a-f]{64}$/);
  assert.equal(a.reportSha256, b.reportSha256);
  assert.deepEqual(a, b);
  assert.equal("generatedAt" in a, false, "no clock in the content");

  const changed = await census(repo, arrayLegacyReader({ requests: [...LEGACY_PRIVILEGED_REQUESTS, { id: "pr-4", data: { status: "REJECTED" } }] }));
  assert.notEqual(changed.reportSha256, a.reportSha256, "one changed fact changes the digest");
  assert.match(describeRoleAssignmentCensus(a), new RegExp(a.reportSha256));
});

test("an unknown tenant is refused and never created", async () => {
  const repo = await world();
  await assert.rejects(
    buildRoleAssignmentCensus({ legacy: arrayLegacyReader(), policy: repo, tenantKey: "no-such-tenant" }),
    RoleAssignmentCensusError,
  );
  assert.equal(await repo.getTenantByKey("no-such-tenant"), null);
});

test("the census writes nothing: the policy audit trail and every row count are unchanged", async () => {
  const repo = await world();
  const before = JSON.stringify(repo.tables ?? null) + JSON.stringify(await repo.listAuditEvents("tenant-census", 1000));
  await census(repo);
  const after = JSON.stringify(repo.tables ?? null) + JSON.stringify(await repo.listAuditEvents("tenant-census", 1000));
  assert.equal(after, before);
});
