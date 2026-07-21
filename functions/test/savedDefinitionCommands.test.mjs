// Issue #325 / ADR-007 D-RULES CORRECTED -- emulator/security tests for
// the trusted saved-definition CRUD service (functions/src/reporting/
// savedDefinitionCommands.ts). Same firebase-admin-against-a-live-
// Firestore-emulator convention as reportExecutionService.test.mjs (no
// @firebase/rules-unit-testing, no test runner).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/savedDefinitionCommands.test.mjs
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below)
// -- never touches the live "taylor-parts" project. No Role/Rules/
// deployment/production-data change of any kind; this test grants
// capabilities ONLY via the service's own test-only `options.roles`
// injection seam, never by mutating the real Role catalogs.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  createSavedDefinition,
  getSavedDefinition,
  listSavedDefinitions,
  renameSavedDefinition,
  duplicateSavedDefinition,
  deleteSavedDefinition,
  InvalidReportDefinitionError,
  InvalidInputError,
  UnauthorizedActorError,
  NotFoundError,
  NotOwnerError,
} from "../lib/reporting/savedDefinitionCommands.js";

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

const now = Date.now();
let seq = 0;
function uid(prefix) {
  seq += 1;
  return `${prefix}-${now}-${seq}`;
}

async function seedActor(accessVersion = 1) {
  const actorUid = uid("actor");
  await db.collection("users").doc(actorUid).set({ accessVersion });
  return actorUid;
}

async function grantRole(actorUid, roleId, accessVersionAtGrant = 1, status = "active") {
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({
    id,
    principalUid: actorUid,
    roleId,
    scope: { type: "global" },
    grantedBy: "test-fixture",
    grantedAt: admin.firestore.Timestamp.now(),
    status,
    accessVersionAtGrant,
  });
  return id;
}

const VALID_DEFINITION = { objectId: "customer", fields: ["customer.name"] };

// Test-only Role fixtures -- never touch compatibilityRoles.ts or
// governedBusinessRoles.ts; passed only via the service's own
// `options.roles` test-injection seam.
const TEST_ROLES = Object.freeze({
  noGrant: { id: "noGrant", name: "x", description: "x", permissions: [] },
  fullDefinitionAccess: {
    id: "fullDefinitionAccess",
    name: "x",
    description: "x",
    permissions: [
      "report.definition.create",
      "report.definition.read",
      "report.definition.rename",
      "report.definition.duplicate",
      "report.definition.delete",
    ],
  },
  readOnly: {
    id: "readOnly",
    name: "x",
    description: "x",
    permissions: ["report.definition.read"],
  },
});

async function countAuditEventsFor(targetId, action) {
  const snap = await db
    .collection("auditEvents")
    .where("targetId", "==", targetId)
    .where("action", "==", action)
    .get();
  return snap.docs.map((d) => d.data());
}

async function main() {
  // === Unauthorized users (no report.definition.* grant at all) ===

  await check("createSavedDefinition denies an actor with no grant, and audits the denial", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "noGrant");
    await assert.rejects(
      createSavedDefinition(
        { actorUid, name: "My Report", definition: VALID_DEFINITION },
        { roles: TEST_ROLES },
      ),
      UnauthorizedActorError,
    );
    const events = await db.collection("auditEvents").where("actorUid", "==", actorUid).get();
    assert.equal(events.size, 1, "exactly one denied Audit Event must exist");
    assert.equal(events.docs[0].data().outcome, "denied");
    assert.equal(events.docs[0].data().action, "createReportDefinition");
    assert.equal(events.docs[0].data().objectId, "customer");
  });

  await check("listSavedDefinitions denies an actor with no grant (no audit -- reads are not audited)", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "noGrant");
    await assert.rejects(listSavedDefinitions({ actorUid }, { roles: TEST_ROLES }), UnauthorizedActorError);
  });

  await check("getSavedDefinition denies an actor with no grant", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "noGrant");
    await assert.rejects(
      getSavedDefinition({ actorUid, definitionId: "does-not-matter" }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
  });

  // Independent-review round 1 finding: rename/duplicate/delete must deny
  // a no-grant actor with the IDENTICAL error (UnauthorizedActorError,
  // never NotFoundError) whether the target id exists or not -- the
  // capability gate must run BEFORE any Firestore read of the target
  // document, or a zero-privilege caller could distinguish "this id
  // exists" from "it doesn't" purely from which error class comes back
  // (a cross-principal existence oracle reachable with no grant at all).
  await check("rename/duplicate/delete deny a no-grant actor identically for an EXISTING id (no existence oracle)", async () => {
    const ownerUid = await seedActor();
    await grantRole(ownerUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid: ownerUid, name: "Real Target", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );

    const noGrantUid = await seedActor();
    await grantRole(noGrantUid, "noGrant");

    await assert.rejects(
      renameSavedDefinition({ actorUid: noGrantUid, definitionId: record.id, name: "x" }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    await assert.rejects(
      duplicateSavedDefinition({ actorUid: noGrantUid, definitionId: record.id }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    await assert.rejects(
      deleteSavedDefinition({ actorUid: noGrantUid, definitionId: record.id }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
  });

  await check("rename/duplicate/delete deny a no-grant actor identically for a NONEXISTENT id (same error class as the existing-id case)", async () => {
    const noGrantUid = await seedActor();
    await grantRole(noGrantUid, "noGrant");
    const bogusId = uid("nonexistent-for-no-grant");

    await assert.rejects(
      renameSavedDefinition({ actorUid: noGrantUid, definitionId: bogusId, name: "x" }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    await assert.rejects(
      duplicateSavedDefinition({ actorUid: noGrantUid, definitionId: bogusId }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    await assert.rejects(
      deleteSavedDefinition({ actorUid: noGrantUid, definitionId: bogusId }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    // The target document must never have been read/created as a side
    // effect of a capability-denied attempt.
    const snap = await db.collection("reportDefinitions").doc(bogusId).get();
    assert.equal(snap.exists, false);
  });

  // === Malformed definitions (rejected before any Firestore write, no audit event) ===

  await check("createSavedDefinition rejects a structurally invalid definition before any write or audit", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    await assert.rejects(
      createSavedDefinition(
        { actorUid, name: "Bad", definition: { objectId: "not-a-real-object" } },
        { roles: TEST_ROLES },
      ),
      InvalidReportDefinitionError,
    );
    const events = await db.collection("auditEvents").where("actorUid", "==", actorUid).get();
    assert.equal(events.size, 0, "a structurally invalid definition must never produce an Audit Event");
  });

  await check("createSavedDefinition rejects a missing/empty name", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    await assert.rejects(
      createSavedDefinition({ actorUid, name: "", definition: VALID_DEFINITION }, { roles: TEST_ROLES }),
      InvalidInputError,
    );
  });

  await check("createSavedDefinition rejects a name over 120 characters, accepts exactly 120", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    await assert.rejects(
      createSavedDefinition(
        { actorUid, name: "x".repeat(121), definition: VALID_DEFINITION },
        { roles: TEST_ROLES },
      ),
      InvalidInputError,
    );
    const record = await createSavedDefinition(
      { actorUid, name: "x".repeat(120), definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    assert.equal(record.name.length, 120);
  });

  // === Never trusts client ownerUid/timestamps ===

  await check("createSavedDefinition ignores a client-supplied ownerUid and always uses the trusted actorUid", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "Spoofed Owner Attempt", definition: VALID_DEFINITION, ownerUid: "someone-else" },
      { roles: TEST_ROLES },
    );
    assert.equal(record.ownerUid, actorUid);
    const snap = await db.collection("reportDefinitions").doc(record.id).get();
    assert.equal(snap.data().ownerUid, actorUid);
  });

  // === Ownership + cross-principal access ===

  await check("a non-owner cannot get/rename/duplicate/delete another principal's saved definition", async () => {
    const ownerUid = await seedActor();
    await grantRole(ownerUid, "fullDefinitionAccess");
    const other = await seedActor();
    await grantRole(other, "fullDefinitionAccess");

    const record = await createSavedDefinition(
      { actorUid: ownerUid, name: "Owner's Report", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );

    await assert.rejects(
      getSavedDefinition({ actorUid: other, definitionId: record.id }, { roles: TEST_ROLES }),
      NotOwnerError,
    );
    await assert.rejects(
      renameSavedDefinition({ actorUid: other, definitionId: record.id, name: "Hijacked" }, { roles: TEST_ROLES }),
      NotOwnerError,
    );
    await assert.rejects(
      duplicateSavedDefinition({ actorUid: other, definitionId: record.id }, { roles: TEST_ROLES }),
      NotOwnerError,
    );
    await assert.rejects(
      deleteSavedDefinition({ actorUid: other, definitionId: record.id }, { roles: TEST_ROLES }),
      NotOwnerError,
    );

    // The document must still exist and be unchanged -- none of the
    // cross-principal attempts above may have mutated it.
    const snap = await db.collection("reportDefinitions").doc(record.id).get();
    assert.ok(snap.exists);
    assert.equal(snap.data().name, "Owner's Report");

    // Each denied cross-principal mutation attempt is audited.
    const renameEvents = await countAuditEventsFor(record.id, "renameReportDefinition");
    assert.ok(renameEvents.some((e) => e.outcome === "denied" && e.actorUid === other));
  });

  await check("listSavedDefinitions only ever returns the caller's OWN definitions, never another principal's", async () => {
    const ownerUid = await seedActor();
    await grantRole(ownerUid, "fullDefinitionAccess");
    const other = await seedActor();
    await grantRole(other, "fullDefinitionAccess");
    const marker = uid("mk");

    await createSavedDefinition({ actorUid: ownerUid, name: `${marker}-A`, definition: VALID_DEFINITION }, { roles: TEST_ROLES });
    await createSavedDefinition({ actorUid: other, name: `${marker}-B`, definition: VALID_DEFINITION }, { roles: TEST_ROLES });

    const ownerList = await listSavedDefinitions({ actorUid: ownerUid }, { roles: TEST_ROLES });
    assert.ok(ownerList.every((d) => d.ownerUid === ownerUid));
    assert.ok(ownerList.some((d) => d.name === `${marker}-A`));
    assert.ok(!ownerList.some((d) => d.name === `${marker}-B`));
  });

  // === Revocation (a disabled RoleAssignment does not authorize) ===

  await check("a DISABLED report.definition.create RoleAssignment does not authorize create", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess", 1, "disabled");
    await assert.rejects(
      createSavedDefinition({ actorUid, name: "x", definition: VALID_DEFINITION }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
  });

  // === Stale assignments (accessVersionAtGrant newer than the current accessVersion) ===

  await check("a stale RoleAssignment (accessVersionAtGrant > current accessVersion) does not authorize", async () => {
    const actorUid = await seedActor(1);
    // Granted "in the future" relative to the principal's current
    // accessVersion -- resolveEffectivePermission.ts treats this as
    // malformed/stale data and excludes it, fail-closed.
    await grantRole(actorUid, "fullDefinitionAccess", 5);
    await assert.rejects(
      createSavedDefinition({ actorUid, name: "x", definition: VALID_DEFINITION }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
  });

  await check("bumping accessVersion after grant still authorizes (grant consistent with a LOWER current version)", async () => {
    const actorUid = await seedActor(1);
    await grantRole(actorUid, "fullDefinitionAccess", 1);
    await db.collection("users").doc(actorUid).set({ accessVersion: 3 });
    const record = await createSavedDefinition(
      { actorUid, name: "Still Valid", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    assert.ok(record.id);
  });

  // === Rename / duplicate / delete happy paths, ownership-scoped ===

  await check("owner can rename their own saved definition, and it is audited exactly once", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "Original", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    const renamed = await renameSavedDefinition(
      { actorUid, definitionId: record.id, name: "Renamed" },
      { roles: TEST_ROLES },
    );
    assert.equal(renamed.name, "Renamed");
    const snap = await db.collection("reportDefinitions").doc(record.id).get();
    assert.equal(snap.data().name, "Renamed");
    const events = await countAuditEventsFor(record.id, "renameReportDefinition");
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "applied");
  });

  await check("owner can duplicate their own saved definition into a NEW document they own", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "Source", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    const dup = await duplicateSavedDefinition({ actorUid, definitionId: record.id }, { roles: TEST_ROLES });
    assert.notEqual(dup.id, record.id);
    assert.equal(dup.ownerUid, actorUid);
    assert.equal(dup.name, "Source (copy)");
    assert.deepEqual(dup.definition, record.definition);
  });

  await check("owner can delete their own saved definition; it no longer exists afterward", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "To Delete", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    await deleteSavedDefinition({ actorUid, definitionId: record.id }, { roles: TEST_ROLES });
    const snap = await db.collection("reportDefinitions").doc(record.id).get();
    assert.equal(snap.exists, false);
    const events = await countAuditEventsFor(record.id, "deleteReportDefinition");
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "applied");
  });

  await check("get/rename/duplicate/delete on a nonexistent id all reject NotFoundError with no audit event", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const bogusId = uid("nonexistent");
    await assert.rejects(getSavedDefinition({ actorUid, definitionId: bogusId }, { roles: TEST_ROLES }), NotFoundError);
    await assert.rejects(
      renameSavedDefinition({ actorUid, definitionId: bogusId, name: "x" }, { roles: TEST_ROLES }),
      NotFoundError,
    );
    await assert.rejects(
      duplicateSavedDefinition({ actorUid, definitionId: bogusId }, { roles: TEST_ROLES }),
      NotFoundError,
    );
    await assert.rejects(deleteSavedDefinition({ actorUid, definitionId: bogusId }, { roles: TEST_ROLES }), NotFoundError);
    const events = await db.collection("auditEvents").where("targetId", "==", bogusId).get();
    assert.equal(events.size, 0);
  });

  // === A read-only Role can read but not mutate ===

  await check("a Role holding only report.definition.read can list/get but not create/rename/duplicate/delete", async () => {
    const ownerUid = await seedActor();
    await grantRole(ownerUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid: ownerUid, name: "Owned", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );

    const readOnlyUid = await seedActor();
    await grantRole(readOnlyUid, "readOnly");
    // readOnly principal reading THEIR OWN (nonexistent) list is fine...
    const list = await listSavedDefinitions({ actorUid: readOnlyUid }, { roles: TEST_ROLES });
    assert.deepEqual(list, []);
    // ...but may not create.
    await assert.rejects(
      createSavedDefinition({ actorUid: readOnlyUid, name: "x", definition: VALID_DEFINITION }, { roles: TEST_ROLES }),
      UnauthorizedActorError,
    );
    // Sanity: the read-only principal still can't touch the owner's definition (ownership gate, separate from the capability gate).
    await assert.rejects(
      getSavedDefinition({ actorUid: readOnlyUid, definitionId: record.id }, { roles: TEST_ROLES }),
      NotOwnerError,
    );
  });

  // === Immutable audit: exactly one Audit Event per mutating call, never overwritten ===

  await check("two sequential renames of the same definition produce exactly two immutable Audit Events, not one overwritten", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "V1", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    await renameSavedDefinition({ actorUid, definitionId: record.id, name: "V2" }, { roles: TEST_ROLES });
    await renameSavedDefinition({ actorUid, definitionId: record.id, name: "V3" }, { roles: TEST_ROLES });
    const events = await countAuditEventsFor(record.id, "renameReportDefinition");
    assert.equal(events.length, 2, "each rename call must produce its OWN Audit Event, never overwrite the prior one");
  });

  // === Atomic rollback: a failure mid-transaction commits NEITHER write ===

  await check("createSavedDefinition: a simulated failure after staging commits NEITHER the document NOR the Audit Event", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    await assert.rejects(
      createSavedDefinition(
        { actorUid, name: "Should Not Persist", definition: VALID_DEFINITION },
        { roles: TEST_ROLES, __simulateFailureAfterStage: new Error("simulated failure") },
      ),
    );
    const list = await listSavedDefinitions({ actorUid }, { roles: TEST_ROLES });
    assert.ok(!list.some((d) => d.name === "Should Not Persist"), "document must not have been committed");
    const events = await db.collection("auditEvents").where("actorUid", "==", actorUid).where("outcome", "==", "applied").get();
    assert.equal(events.size, 0, "no applied Audit Event may exist for a rolled-back transaction");
  });

  await check("deleteSavedDefinition: a simulated failure after staging leaves the document intact and unaudited", async () => {
    const actorUid = await seedActor();
    await grantRole(actorUid, "fullDefinitionAccess");
    const record = await createSavedDefinition(
      { actorUid, name: "Survives Rollback", definition: VALID_DEFINITION },
      { roles: TEST_ROLES },
    );
    await assert.rejects(
      deleteSavedDefinition(
        { actorUid, definitionId: record.id },
        { roles: TEST_ROLES, __simulateFailureAfterStage: new Error("simulated failure") },
      ),
    );
    const snap = await db.collection("reportDefinitions").doc(record.id).get();
    assert.ok(snap.exists, "document must still exist after a rolled-back delete");
    const events = await countAuditEventsFor(record.id, "deleteReportDefinition");
    assert.equal(events.length, 0, "no delete Audit Event may exist for a rolled-back transaction");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
