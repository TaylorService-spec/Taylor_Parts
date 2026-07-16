// Issue #325 / ADR-007 D-FN -- emulator/security tests for the trusted
// report execution service (functions/src/reporting/
// reportExecutionService.ts). Same firebase-admin-against-a-live-
// Firestore-emulator convention as this repo's other emulator test
// files (no @firebase/rules-unit-testing, no test runner).
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/reportExecutionService.test.mjs
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below)
// -- never touches the live "taylor-parts" project. No Role/Rules/
// deployment/production-data change of any kind; this test grants
// capabilities ONLY via the service's own test-only `options.roles`
// injection seam, never by mutating the real Role catalogs.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "firebase-admin";
import {
  runReportDefinition,
  InvalidReportDefinitionError,
} from "../lib/reporting/reportExecutionService.js";

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

async function seedRunner(accessVersion = 1) {
  const runnerUid = uid("runner");
  await db.collection("users").doc(runnerUid).set({ accessVersion });
  return runnerUid;
}

async function grantRole(runnerUid, roleId, accessVersionAtGrant = 1) {
  const id = uid("assignment");
  await db.collection("roleAssignments").doc(id).set({
    id,
    principalUid: runnerUid,
    roleId,
    scope: { type: "global" },
    grantedBy: "test-fixture",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant,
  });
  return id;
}

// Test-only Role fixtures -- these never touch compatibilityRoles.ts or
// governedBusinessRoles.ts; they are passed only via
// `runReportDefinition(params, { roles })`, the service's own
// test-injection seam (reportExecutionService.ts's own doc comment on
// RunReportServiceOptions.roles explains why this exists).
const TEST_ROLES = Object.freeze({
  noObjectGrant: { id: "noObjectGrant", name: "x", description: "x", permissions: [] },
  fullCustomer: {
    id: "fullCustomer",
    name: "x",
    description: "x",
    permissions: [
      "report.customer.read",
      "report.customer.field.name.read",
      "report.customer.field.status.read",
      "report.customer.field.createdAt.read",
      "report.customer.field.tags.read",
    ],
  },
  partialCustomer: {
    // Object + name only -- status/createdAt/tags intentionally NOT granted.
    id: "partialCustomer",
    name: "x",
    description: "x",
    permissions: ["report.customer.read", "report.customer.field.name.read"],
  },
  inactiveFieldGrant: {
    // Grants report.customer.field.notes.read, which is registered
    // active:false in permissionCatalog.ts (security-text, pending the
    // wave-1 review's explicit confirmation) -- proves inactivePermission
    // denies even when a Role explicitly grants it, same as D-226's own
    // resolver-level proof, now proven end-to-end through this service.
    id: "inactiveFieldGrant",
    name: "x",
    description: "x",
    permissions: ["report.customer.read", "report.customer.field.notes.read"],
  },
  fullEquipmentWithLocation: {
    id: "fullEquipmentWithLocation",
    name: "x",
    description: "x",
    permissions: [
      "report.equipment.read",
      "report.equipment.field.name.read",
      "report.equipment.field.location.read", // traversal capability (equipment.locationId)
      "report.location.field.name.read", // the related object's OWN field capability
    ],
  },
  equipmentTraversalOnly: {
    // Traversal capability granted, but NOT the related object's own
    // field capability -- must still deny location.name (Spec sec2.5:
    // "authorized by THAT object's own field capabilities").
    id: "equipmentTraversalOnly",
    name: "x",
    description: "x",
    permissions: ["report.equipment.read", "report.equipment.field.name.read", "report.equipment.field.location.read"],
  },
  relatedFieldOnly: {
    // The related object's field capability granted, but NOT the
    // traversal capability itself -- must still deny (both gates required).
    id: "relatedFieldOnly",
    name: "x",
    description: "x",
    permissions: ["report.equipment.read", "report.equipment.field.name.read", "report.location.field.name.read"],
  },
});

async function seedCustomers(docs) {
  const batch = db.batch();
  const ids = [];
  for (const d of docs) {
    const id = uid("acct");
    ids.push(id);
    batch.set(db.collection("accounts").doc(id), d);
  }
  await batch.commit();
  return ids;
}

async function countAuditEventsFor(targetId) {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.docs.map((d) => d.data());
}

async function main() {
  // --- Structural validation gate: refused BEFORE any Firestore read/audit ---
  await check("an invalid definition throws InvalidReportDefinitionError and writes NO audit event", async () => {
    const runnerUid = await seedRunner();
    const definitionId = uid("def");
    await assert.rejects(
      () => runReportDefinition({ runnerUid, definition: { objectId: "notARealObject" }, definitionId }, { roles: TEST_ROLES }),
      InvalidReportDefinitionError,
    );
    assert.equal((await countAuditEventsFor(definitionId)).length, 0);
  });

  // --- Object gate ---
  await check("no roleAssignment at all denies with kind permission-denied, rows null, and an audited denial (no row data)", async () => {
    const runnerUid = await seedRunner();
    const definitionId = uid("def");
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"] }, definitionId },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "permission-denied");
    assert.equal(outcome.rows, null);
    const events = await countAuditEventsFor(definitionId);
    assert.equal(events.length, 1);
    assert.equal(events[0].outcome, "denied");
    assert.equal(events[0].action, "runReportDefinition");
    assert.equal(events[0].objectId, "customer");
    assert.equal("rowCount" in events[0], false, "a denied run must never report a rowCount");
  });

  await check("a Role with no report.* grant at all denies the same way (noObjectGrant fixture)", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "noObjectGrant");
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"] } },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "permission-denied");
  });

  // --- Full authorized run ---
  // NOTE: this whole file runs against ONE shared emulator collection
  // per object (accounts/equipment/locations), across every check() in
  // this file's single `main()` -- so every test that asserts an EXACT
  // rowCount/aggregate value seeds documents under a per-test unique
  // marker and includes a `startsWith`-on-that-marker filter, so its
  // own assertions can never be perturbed by another test's fixtures.
  await check("a fully-granted Role gets real, correctly projected rows with no drops", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Acme Corp`, status: "Active", createdAt: now },
      { name: `${marker}-Beta LLC`, status: "Inactive", createdAt: now },
    ]);
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name", "customer.status"],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "results");
    assert.equal(outcome.rowCount, 2);
    assert.deepEqual(outcome.droppedColumnLabels, []);
    const names = outcome.rows.map((r) => r["customer.name"]).sort();
    assert.deepEqual(names, [`${marker}-Acme Corp`, `${marker}-Beta LLC`]);
    assert.ok(outcome.rows.every((r) => "customer.status" in r));
  });

  await check("an empty (zero-row) authorized result is kind empty, not failure", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: "no-such-customer-xyz" }] } },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "empty");
    assert.equal(outcome.rowCount, 0);
    assert.deepEqual(outcome.rows, []);
  });

  // --- Column-level predicate-drop / partial authorization ---
  await check("an unauthorized SELECTED field is dropped from the projection, never returned (partially-authorized)", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "partialCustomer");
    const marker = uid("mk");
    await seedCustomers([{ name: `${marker}-Acme Corp`, status: "Active", createdAt: now }]);
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name", "customer.status"],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "partially-authorized");
    assert.equal(outcome.droppedColumnLabels.length, 1);
    assert.equal(outcome.droppedColumnLabels[0], "Status");
    assert.equal(outcome.droppedFieldIds[0], "customer.status");
    assert.equal(outcome.rowCount, 1);
    assert.ok(outcome.rows.every((r) => "customer.status" in r === false), "dropped column must be ABSENT, not blanked/null-valued");
    assert.ok(outcome.rows.every((r) => "customer.name" in r));
  });

  await check("a filter referencing an unauthorized field is DROPPED (never applied), widening the result -- not silently narrowed", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "partialCustomer"); // status is NOT granted
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Acme Corp`, status: "Active", createdAt: now },
      { name: `${marker}-Beta LLC`, status: "Inactive", createdAt: now },
    ]);
    // Two filters: one on the (authorized) name marker to isolate this
    // test's own fixtures, one on customer.status = "Active" -- if the
    // status filter were applied, it would exclude Beta LLC. Since
    // status is unauthorized, THAT predicate must be dropped and BOTH
    // marker-matching rows returned (widened), never silently filtered.
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name"],
          filters: [
            { fieldId: "customer.name", op: "startsWith", value: marker },
            { fieldId: "customer.status", op: "eq", value: "Active" },
          ],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.rowCount, 2, "the dropped predicate must not narrow the result");
    assert.equal(outcome.widened, true);
    assert.deepEqual(outcome.droppedPredicateFieldIds, ["customer.status"]);
    assert.equal(outcome.droppedPredicateCount, 1);
  });

  await check("an authorized filter DOES narrow the result (proves filters work at all, not just that dropping works)", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer"); // status IS granted
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Acme Corp`, status: "Active", createdAt: now },
      { name: `${marker}-Beta LLC`, status: "Inactive", createdAt: now },
    ]);
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name", "customer.status"],
          filters: [
            { fieldId: "customer.name", op: "startsWith", value: marker },
            { fieldId: "customer.status", op: "eq", value: "Active" },
          ],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.rowCount, 1);
    assert.equal(outcome.widened, false);
    assert.equal(outcome.rows[0]["customer.name"], `${marker}-Acme Corp`);
  });

  // --- inactivePermission override, end-to-end through the service ---
  await check("a Role granting an inactive (active:false) capability still denies that field, end-to-end", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "inactiveFieldGrant");
    const marker = uid("mk");
    await seedCustomers([{ name: `${marker}-Acme Corp`, notes: "sensitive text", createdAt: now }]);
    // notes has no filter operator (empty operators[] in the catalog),
    // so isolate this test's own fixture via a projected-but-dropped
    // customer.notes selection alongside an authorized filter on name --
    // wait: inactiveFieldGrant does not grant customer.name either, so
    // filtering by name is impossible here. Use fields:["customer.notes"]
    // only and assert on kind/droppedFieldIds, not on an exact rowCount
    // (this test intentionally does not depend on total row count).
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.notes"] } },
      { roles: TEST_ROLES },
    );
    // The object itself is readable and the field is dropped -- every
    // matching row still exists (rowCount > 0 once other tests' fixtures
    // have seeded the collection), each projected down to `{}` (no
    // visible columns). This is "partially-authorized", not "empty":
    // row EXISTENCE/COUNT is already bounded by the (granted)
    // object-level gate; only FIELD VALUES are restricted (Spec sec6:
    // "a field the runner may not read is absent from the response
    // payload" -- rows are not themselves hidden by a field-level denial).
    assert.equal(outcome.kind, "partially-authorized");
    assert.deepEqual(outcome.droppedFieldIds, ["customer.notes"]);
    assert.ok(outcome.rows.every((r) => Object.keys(r).length === 0), "every row must have zero visible columns");
  });

  // --- countRows aggregate ---
  await check("countRows aggregates the runner's own authorized/filtered row set, never raw collection size", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Acme Corp`, status: "Active", createdAt: now },
      { name: `${marker}-Beta LLC`, status: "Active", createdAt: now },
      { name: `${marker}-Gamma Inc`, status: "Inactive", createdAt: now },
    ]);
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          aggregates: [{ fn: "countRows" }],
          filters: [
            { fieldId: "customer.name", op: "startsWith", value: marker },
            { fieldId: "customer.status", op: "eq", value: "Active" },
          ],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.aggregates.length, 1);
    assert.equal(outcome.aggregates[0].countRows, 2);
  });

  // --- Relationship traversal: BOTH gates required ---
  await check("a related-object field requires BOTH the traversal capability AND the related field's own capability", async () => {
    const runnerUid1 = await seedRunner();
    await grantRole(runnerUid1, "equipmentTraversalOnly");
    const runnerUid2 = await seedRunner();
    await grantRole(runnerUid2, "relatedFieldOnly");
    const locId = uid("loc");
    await db.collection("locations").doc(locId).set({ name: "Main Warehouse" });
    await db.collection("equipment").doc(uid("eq")).set({ name: "Forklift A", locationId: locId });

    for (const runnerUid of [runnerUid1, runnerUid2]) {
      const outcome = await runReportDefinition(
        { runnerUid, definition: { objectId: "equipment", fields: ["equipment.name", "location.name"] } },
        { roles: TEST_ROLES },
      );
      assert.equal(outcome.droppedFieldIds.includes("location.name"), true, `runner ${runnerUid} must NOT see location.name with only one of the two required gates`);
    }
  });

  await check("a related-object field IS returned, correctly joined, when both gates are granted", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullEquipmentWithLocation");
    const marker = uid("mk");
    const locId = uid("loc");
    await db.collection("locations").doc(locId).set({ name: "Main Warehouse" });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Forklift A`, locationId: locId });

    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "equipment",
          fields: ["equipment.name", "location.name"],
          filters: [{ fieldId: "equipment.name", op: "startsWith", value: marker }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.kind, "results");
    assert.equal(outcome.rows.length, 1);
    assert.equal(outcome.rows[0]["equipment.name"], `${marker}-Forklift A`);
    assert.equal(outcome.rows[0]["location.name"], "Main Warehouse");
  });

  // --- Row cap / truncation (injectable low limits for a fast, deterministic test) ---
  await check("exceeding the row cap marks truncated and returns exactly rowCap rows, never silently more", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const marker = uid("mk");
    await seedCustomers(Array.from({ length: 5 }, (_, i) => ({ name: `${marker}-Cap Test ${i}`, status: "Active", createdAt: now })));
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }] } },
      { roles: TEST_ROLES, maxResultRows: 3, maxScanDocs: 100 },
    );
    assert.equal(outcome.truncated, true);
    assert.equal(outcome.rowCount, 3);
    assert.equal(outcome.rowCap, 3);
  });

  // --- Group cardinality cap ---
  await check("exceeding the group cardinality cap marks truncated and caps the number of groups", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const marker = uid("grp");
    await seedCustomers(
      Array.from({ length: 5 }, (_, i) => ({ name: `${marker}-${i}`, status: `status-${marker}-${i}`, createdAt: now })),
    );
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.status"],
          groupBy: ["customer.status"],
          aggregates: [{ fn: "countRows" }],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
        },
      },
      { roles: TEST_ROLES, maxGroupCardinality: 2, maxScanDocs: 100 },
    );
    assert.equal(outcome.truncated, true);
    assert.ok(outcome.aggregates.length <= 2);
  });

  // --- Cross-principal isolation (no caching) ---
  await check("two different runners in sequence never observe each other's authorized data", async () => {
    const grantedRunner = await seedRunner();
    await grantRole(grantedRunner, "fullCustomer");
    const deniedRunner = await seedRunner();
    const isolationMarker = uid("isolation-test-co");

    await seedCustomers([{ name: isolationMarker, status: "Active", createdAt: now }]);

    const grantedOutcome = await runReportDefinition(
      { runnerUid: grantedRunner, definition: { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: isolationMarker }] } },
      { roles: TEST_ROLES },
    );
    const deniedOutcome = await runReportDefinition(
      { runnerUid: deniedRunner, definition: { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: isolationMarker }] } },
      { roles: TEST_ROLES },
    );
    assert.equal(grantedOutcome.kind, "results");
    assert.equal(grantedOutcome.rowCount, 1);
    assert.equal(deniedOutcome.kind, "permission-denied");
    assert.equal(deniedOutcome.rows, null);

    // Re-run the granted runner AFTER the denied one to prove order has
    // no effect (a cache keyed wrong could serve the SECOND call the
    // FIRST call's cached decision).
    const grantedAgain = await runReportDefinition(
      { runnerUid: grantedRunner, definition: { objectId: "customer", fields: ["customer.name"], filters: [{ fieldId: "customer.name", op: "eq", value: isolationMarker }] } },
      { roles: TEST_ROLES },
    );
    assert.equal(grantedAgain.kind, "results");
    assert.equal(grantedAgain.rowCount, 1);
  });

  // --- Sort (review round 1 fix: sort was authorization-filtered but never applied) ---
  await check("an authorized sort clause actually orders the returned rows", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Charlie`, status: "Active", createdAt: now },
      { name: `${marker}-Alpha`, status: "Active", createdAt: now },
      { name: `${marker}-Bravo`, status: "Active", createdAt: now },
    ]);
    const asc = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name"],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
          sort: [{ fieldId: "customer.name", direction: "asc" }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.deepEqual(asc.rows.map((r) => r["customer.name"]), [`${marker}-Alpha`, `${marker}-Bravo`, `${marker}-Charlie`]);

    const desc = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name"],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
          sort: [{ fieldId: "customer.name", direction: "desc" }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.deepEqual(desc.rows.map((r) => r["customer.name"]), [`${marker}-Charlie`, `${marker}-Bravo`, `${marker}-Alpha`]);
  });

  // --- Relationship-field filter/group/aggregate execution (review round 1 fix) ---
  await check("a filter on an AUTHORIZED related-object field actually narrows the result, not silently drops everything or no-ops", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullEquipmentWithLocation");
    const marker = uid("mk");
    const matchLocId = uid("loc");
    const otherLocId = uid("loc");
    await db.collection("locations").doc(matchLocId).set({ name: `${marker}-Main Warehouse` });
    await db.collection("locations").doc(otherLocId).set({ name: `${marker}-Other Site` });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Forklift A`, locationId: matchLocId });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Forklift B`, locationId: otherLocId });

    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "equipment",
          fields: ["equipment.name", "location.name"],
          filters: [
            { fieldId: "equipment.name", op: "startsWith", value: marker },
            { fieldId: "location.name", op: "eq", value: `${marker}-Main Warehouse` },
          ],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.rowCount, 1, "a real related-field filter must actually narrow, not drop everything (silent-exclude bug) or match everything (silent-no-op bug)");
    assert.equal(outcome.rows[0]["equipment.name"], `${marker}-Forklift A`);
    assert.equal(outcome.widened, false, "the related-field filter was authorized, so nothing was dropped/widened");
  });

  await check("groupBy on an AUTHORIZED related-object field actually groups by its real joined value, not a single empty bucket", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullEquipmentWithLocation");
    const marker = uid("mk");
    const locA = uid("loc");
    const locB = uid("loc");
    await db.collection("locations").doc(locA).set({ name: `${marker}-Warehouse A` });
    await db.collection("locations").doc(locB).set({ name: `${marker}-Warehouse B` });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Item 1`, locationId: locA });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Item 2`, locationId: locA });
    await db.collection("equipment").doc(uid("eq")).set({ name: `${marker}-Item 3`, locationId: locB });

    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "equipment",
          fields: ["location.name"],
          groupBy: ["location.name"],
          aggregates: [{ fn: "countRows" }],
          filters: [{ fieldId: "equipment.name", op: "startsWith", value: marker }],
        },
      },
      { roles: TEST_ROLES },
    );
    assert.equal(outcome.aggregates.length, 2, "must group into the two REAL joined location buckets, not one empty-key bucket");
    const byLocation = Object.fromEntries(outcome.aggregates.map((r) => [r["location.name"], r.countRows]));
    assert.equal(byLocation[`${marker}-Warehouse A`], 2);
    assert.equal(byLocation[`${marker}-Warehouse B`], 1);
  });

  // --- Issue #325 W1: Owner's real (not synthetic-test) grant works end-to-end ---
  // Every other check() in this file passes `{ roles: TEST_ROLES }`, the
  // service's test-only injection seam -- proving the MECHANISM works,
  // never that a real Role actually grants anything (this session's own
  // hard requirement was "no premature grant" until this task). This is
  // the ONE check that omits `roles` entirely, so runReportDefinition()
  // falls back to its real production default (COMPATIBILITY_ROLES +
  // GOVERNED_BUSINESS_ROLES, genuinely merged) -- proving the real,
  // merged Owner Role can now run a real W1 report end-to-end, which is
  // this task's own stated purpose ("enables emulator W1 testing").
  await check("W1: the REAL Owner Role (no test-role injection) runs a real report end-to-end via GOVERNED_BUSINESS_ROLES", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "owner");
    const marker = uid("mk");
    await seedCustomers([
      { name: `${marker}-Acme Corp`, status: "Active", createdAt: now },
      { name: `${marker}-Beta LLC`, status: "Inactive", createdAt: now },
    ]);
    const outcome = await runReportDefinition(
      {
        runnerUid,
        definition: {
          objectId: "customer",
          fields: ["customer.name", "customer.status"],
          filters: [{ fieldId: "customer.name", op: "startsWith", value: marker }],
        },
      },
      // No `roles` override -- exercises the REAL production default.
    );
    assert.equal(outcome.kind, "results");
    assert.equal(outcome.rowCount, 2);
    assert.deepEqual(outcome.droppedColumnLabels, []);
  });

  await check("W1: the REAL Owner Role still can't read an inactive field (customer.notes) -- active:false overrides even the real grant", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "owner");
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.notes"] } },
    );
    assert.deepEqual(outcome.droppedFieldIds, ["customer.notes"]);
  });

  await check("W1: a runner with NO Role assignment is still denied against the REAL production role default (no accidental global widening)", async () => {
    const runnerUid = await seedRunner();
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"] } },
    );
    assert.equal(outcome.kind, "permission-denied");
  });

  await check("W1: a non-Owner governed business Role (e.g. Operations Manager) is still denied against the REAL production role default", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "operationsManager");
    const outcome = await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"] } },
    );
    assert.equal(outcome.kind, "permission-denied");
  });

  // --- No module-level mutable state (structural, static-text proof) ---
  await check("reportExecutionService.ts declares no top-level mutable (let/var) binding -- no cache, anywhere, of any kind", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src", "reporting", "reportExecutionService.ts"), "utf8");
    const lines = src.split("\n");
    const offenders = lines.filter((l) => /^(let|var)\s/.test(l));
    assert.deepEqual(offenders, [], "found a top-level let/var declaration -- potential cross-call/cross-principal cache");
  });

  // --- Audit content never carries row data ---
  await check("audit summaries never contain a seeded row's actual field values", async () => {
    const runnerUid = await seedRunner();
    await grantRole(runnerUid, "fullCustomer");
    const definitionId = uid("def");
    const distinctiveValue = `UNIQUE-ROW-VALUE-${now}`;
    await seedCustomers([{ name: distinctiveValue, status: "Active", createdAt: now }]);
    await runReportDefinition(
      { runnerUid, definition: { objectId: "customer", fields: ["customer.name"] }, definitionId },
      { roles: TEST_ROLES },
    );
    const events = await countAuditEventsFor(definitionId);
    assert.equal(events.length, 1);
    assert.ok(!events[0].summary.includes(distinctiveValue), "audit summary must never embed row data");
    assert.equal(JSON.stringify(events[0]).includes(distinctiveValue), false, "no field on the persisted audit document may carry row data");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
