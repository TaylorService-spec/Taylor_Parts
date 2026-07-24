// Legacy Compatibility-Admin Bootstrap -- command tests (Firestore + Auth
// emulator). Proves the one-time audited migration: success, dry-run-zero-
// writes (script), the full refusal matrix, equivalence idempotency, race
// single-write, distinct operator/target audit identity, and the end-to-end
// unblock (resolver grants admin.roleAssignment.write, then
// assignApprovedRole(inventoryCreateExecutor) succeeds; privileged grants
// still need two people).
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
import assert from "node:assert/strict";
import admin from "firebase-admin";
admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();
const auth = admin.auth();
const {
  bootstrapCompatibilityAdmin, assignApprovedRole, grantRole, revokeRole,
  InvalidStateError, InvalidInputError,
} = await import("../lib/access/trustedWriterCommands.js");
const { resolveEffectivePermission } = await import("../lib/access/resolveEffectivePermission.js");
const { COMPATIBILITY_ROLES } = await import("../lib/access/compatibilityRoles.js");
const { GOVERNED_BUSINESS_ROLES } = await import("../lib/access/governedBusinessRoles.js");

let passed = 0, failed = 0;
let seq = 0;
const uid = (p) => `${p}-${Date.now()}-${(seq += 1)}`;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS: ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL: ${name}`); console.error(err); }
}
async function assertRejects(promise, ErrorClass, label) { await assert.rejects(promise, ErrorClass, label); }

const COMMIT = "d0dad859ca67fbcfc955c41f4713ec4467a7206c";
const OPERATOR = "infra-operator-1";
// Seed a legacy admin: enabled Auth user + users/{uid}.role=admin, NO roleAssignment.
async function seedLegacyAdmin(email) {
  const u = uid("legacy-admin");
  await auth.createUser({ uid: u, email });
  await db.collection("users").doc(u).set({ role: "admin" });
  return u;
}
const bootstrapId = (u) => `bootstrap-admin-${u}`;
const getAudit = async (id) => (await db.collection("auditEvents").doc(id).get()).data() ?? null;
const key = (u) => `bootstrap-admin-${u}-${uid("k")}`;

console.log("bootstrapCompatibilityAdmin.test.mjs");

await check("success: legacy admin -> active admin roleAssignment + applied audit + accessVersion + distinct operator/target", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  const k = key(u);
  const r = await bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: k });
  assert.equal(r.status, "applied");
  const asg = await db.collection("roleAssignments").doc(bootstrapId(u)).get();
  assert.ok(asg.exists);
  assert.equal(asg.data().roleId, "admin");
  assert.equal(asg.data().status, "active");
  assert.equal(asg.data().scope.type, "global");
  assert.equal(asg.data().grantedBy, "bootstrap:legacy-admin-migration");
  const audit = await getAudit(k);
  assert.equal(audit.action, "bootstrapCompatibilityAdmin");
  assert.equal(audit.outcome, "applied");
  assert.equal(audit.actorUid, OPERATOR, "operator identity is the actor");
  assert.equal(audit.targetId, u, "target is the migrated principal (distinct from operator)");
  assert.notEqual(audit.actorUid, audit.targetId);
  assert.match(audit.summary, /legacy users.role=admin/);
  assert.match(audit.summary, new RegExp(`commit=${COMMIT}`));
  assert.ok(!audit.summary.includes(email), "email/PII is not recorded in the audit");
  assert.equal((await db.collection("users").doc(u).get()).data().accessVersion, 1);
});

await check("refuse: exact email mismatch -> InvalidStateError + denied audit, no assignment/version", async () => {
  const u = await seedLegacyAdmin(`${uid("e")}@test.com`);
  const k = key(u);
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: "wrong@test.com", provenanceCommit: COMMIT, idempotencyKey: k }), InvalidStateError, "email mismatch");
  assert.equal((await db.collection("roleAssignments").doc(bootstrapId(u)).get()).exists, false);
  assert.equal((await getAudit(k)).outcome, "denied");
  assert.equal((await db.collection("users").doc(u).get()).data().accessVersion ?? 0, 0);
});

await check("refuse: unknown UID (no Auth user) -> denied", async () => {
  const u = uid("ghost");
  const k = key(u);
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: "x@test.com", provenanceCommit: COMMIT, idempotencyKey: k }), InvalidStateError, "no auth user");
  assert.equal((await getAudit(k)).outcome, "denied");
});

await check("refuse: disabled Auth user -> denied", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  await auth.updateUser(u, { disabled: true });
  const k = key(u);
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: k }), InvalidStateError, "disabled");
  assert.equal((await db.collection("roleAssignments").doc(bootstrapId(u)).get()).exists, false);
});

await check("refuse: missing / non-admin legacy role -> denied", async () => {
  const email = `${uid("e")}@test.com`;
  const u = uid("legacy-dispatcher");
  await auth.createUser({ uid: u, email });
  await db.collection("users").doc(u).set({ role: "dispatcher" });
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) }), InvalidStateError, "not admin");
  // absent users doc entirely:
  const u2 = uid("no-user-doc");
  await auth.createUser({ uid: u2, email: `${uid("e")}@test.com` });
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u2, expectedEmail: (await auth.getUser(u2)).email, provenanceCommit: COMMIT, idempotencyKey: key(u2) }), InvalidStateError, "no users doc");
});

await check("refuse: conflicting pre-existing active admin roleAssignment (different doc) -> denied", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  await db.collection("roleAssignments").doc(uid("other-admin")).set({ principalUid: u, roleId: "admin", scope: { type: "global" }, grantedBy: "someone", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 0 });
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) }), InvalidStateError, "conflicting admin");
  assert.equal((await db.collection("roleAssignments").doc(bootstrapId(u)).get()).exists, false);
});

await check("refuse: non-equivalent deterministic document -> fail closed with denied audit", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  // Pre-seed the DETERMINISTIC id with a non-equivalent doc (wrong grantedBy):
  await db.collection("roleAssignments").doc(bootstrapId(u)).set({ principalUid: u, roleId: "admin", scope: { type: "global" }, grantedBy: "not-the-bootstrap", grantedAt: admin.firestore.Timestamp.now(), status: "active", accessVersionAtGrant: 0 });
  const k = key(u);
  await assertRejects(bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: k }), InvalidStateError, "non-equivalent");
  assert.equal((await getAudit(k)).outcome, "denied");
});

await check("idempotent: equivalent rerun (fresh key) -> alreadyApplied, no second version bump", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  await bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) });
  const v1 = (await db.collection("users").doc(u).get()).data().accessVersion;
  const r2 = await bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) });
  assert.equal(r2.status, "alreadyApplied");
  assert.equal((await db.collection("users").doc(u).get()).data().accessVersion, v1, "no second version bump");
});

await check("race: concurrent attempts remain a single write", async () => {
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  const results = await Promise.allSettled([
    bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) }),
    bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: u, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(u) }),
  ]);
  const applied = results.filter((r) => r.status === "fulfilled" && r.value.status === "applied");
  assert.equal(applied.length >= 1, true);
  // Exactly one active bootstrap assignment doc exists:
  const asg = await db.collection("roleAssignments").doc(bootstrapId(u)).get();
  assert.ok(asg.exists);
  assert.equal((await db.collection("users").doc(u).get()).data().accessVersion, 1, "single version bump");
});

await check("end-to-end unblock: after bootstrap the resolver grants admin.roleAssignment.write; then assignApprovedRole(inventoryCreateExecutor) succeeds; privileged grants still need two people", async () => {
  const email = `${uid("e")}@test.com`;
  const adminUid = await seedLegacyAdmin(email);
  await bootstrapCompatibilityAdmin({ operatorUid: OPERATOR, uid: adminUid, expectedEmail: email, provenanceCommit: COMMIT, idempotencyKey: key(adminUid) });
  // Resolver now grants admin.roleAssignment.write for the bootstrapped admin:
  const assignmentsSnap = await db.collection("roleAssignments").where("principalUid", "==", adminUid).get();
  const decision = resolveEffectivePermission({
    permissionId: "admin.roleAssignment.write",
    assignments: assignmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    roles: { ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES },
    currentAccessVersion: 1,
    target: { scope: { type: "global" }, condition: {} },
  });
  assert.equal(decision.decision, "ALLOW");
  // The bootstrapped admin can now assign the operational governed role:
  const operator = uid("ice-operator");
  await auth.createUser({ uid: operator });
  const r = await assignApprovedRole({ actorUid: adminUid, principalUid: operator, roleId: "inventoryCreateExecutor", scope: { type: "global" }, idempotencyKey: key(operator) });
  assert.equal(r.status, "applied");
  // But privileged grants STILL require a distinct approver (two-person intact):
  await assertRejects(
    grantRole({ actorUid: adminUid, principalUid: operator, roleId: "admin", scope: { type: "global" }, idempotencyKey: key(operator) }),
    InvalidInputError, "admin grant still needs an approver",
  );
});

await check("operator script: dry-run performs ZERO writes (no assignment, no version bump)", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const email = `${uid("e")}@test.com`;
  const u = await seedLegacyAdmin(email);
  const script = fileURLToPath(new URL("../scripts/bootstrapCompatibilityAdmin.js", import.meta.url));
  const run = spawnSync(process.execPath, [script,
    "--project-id", "taylor-parts", "--confirm-project", "taylor-parts",
    "--uid", u, "--operator", OPERATOR, "--email", email, "--commit", COMMIT,
  ], { encoding: "utf8", env: { ...process.env } });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /DRY-RUN/);
  assert.equal((await db.collection("roleAssignments").doc(bootstrapId(u)).get()).exists, false, "dry-run wrote no assignment");
  assert.equal((await db.collection("users").doc(u).get()).data().accessVersion ?? 0, 0, "dry-run bumped no version");
});

console.log(`\nbootstrapCompatibilityAdmin: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
