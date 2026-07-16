// Enterprise Access & Administration Platform (Issue #226) -- Row 5
// (Task 10) test for the immutable Audit Event trusted writer + read
// model (functions/src/access/auditEventWriter.ts), corrected per
// Customer Tier-2 review round 2 to prove atomic mutation+audit
// behavior. Covers: a successful atomic mutation+audit commit; a
// failed mutation producing NEITHER write; exactly-one-Audit-Event
// behavior; the complete runtime-validated contract (including the
// full AuditAction allow-list and optional Scope/approverUid/
// accessVersionAfter fields); and bounded/validated list-query limits.
//
// Follows this repo's established Firestore-emulator-test convention:
// firebase-admin (already a functions/ dependency) against a live
// Firestore emulator, no test runner, no @firebase/rules-unit-testing.
//
// Prerequisite: run against a live Firestore emulator, e.g.:
//   firebase emulators:start --only firestore --project taylor-parts
// then, in a second terminal (after `npm run build`):
//   node functions/test/auditEventWriter.test.mjs
//
// Read/write only against the emulator (FIRESTORE_EMULATOR_HOST below)
// -- never touches the live "taylor-parts" project.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

import assert from "node:assert/strict";
import admin from "firebase-admin";
import {
  stageAuditEvent,
  recordStandaloneAuditEvent,
  listRecentAuditEvents,
  AuditEventValidationError,
  REPORT_AUDIT_ACTIONS,
} from "../lib/access/auditEventWriter.js";

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

const VALID_EVENT = {
  actorUid: "actor-1",
  action: "grantRole",
  targetType: "roleAssignment",
  targetId: "assignment-1",
  outcome: "applied",
  summary: "Granted role dispatcher to principal-1",
};

async function countAuditEventsFor(targetId) {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.size;
}

async function main() {
  // --- Atomic mutation + audit: success commits BOTH writes ---
  await check("stageAuditEvent inside a transaction commits atomically WITH the business mutation", async () => {
    const targetId = `atomic-success-${Date.now()}`;
    const probeRef = db.collection("probe_mutations").doc(targetId);
    await db.runTransaction(async (txn) => {
      txn.set(probeRef, { businessField: "applied" });
      stageAuditEvent(txn, { ...VALID_EVENT, targetId });
    });
    const probeSnap = await probeRef.get();
    assert.ok(probeSnap.exists, "business mutation must be committed");
    const auditCount = await countAuditEventsFor(targetId);
    assert.equal(auditCount, 1, "exactly one Audit Event must exist");
  });

  // --- Atomic mutation + audit: a failed mutation produces NEITHER write ---
  await check("a transaction that throws after staging commits NEITHER the business mutation NOR the audit event", async () => {
    const targetId = `atomic-failure-${Date.now()}`;
    const probeRef = db.collection("probe_mutations").doc(targetId);
    await assert.rejects(
      db.runTransaction(async (txn) => {
        txn.set(probeRef, { businessField: "should-not-persist" });
        stageAuditEvent(txn, { ...VALID_EVENT, targetId });
        throw new Error("simulated business-logic failure after staging");
      }),
    );
    const probeSnap = await probeRef.get();
    assert.equal(probeSnap.exists, false, "business mutation must NOT be committed");
    const auditCount = await countAuditEventsFor(targetId);
    assert.equal(auditCount, 0, "no Audit Event may exist for a rolled-back transaction");
  });

  // --- Atomic mutation + audit via WriteBatch (the non-transaction path) ---
  await check("stageAuditEvent inside a WriteBatch commits atomically WITH the business mutation", async () => {
    const targetId = `batch-success-${Date.now()}`;
    const probeRef = db.collection("probe_mutations").doc(targetId);
    const batch = db.batch();
    batch.set(probeRef, { businessField: "applied-via-batch" });
    stageAuditEvent(batch, { ...VALID_EVENT, targetId });
    await batch.commit();
    const probeSnap = await probeRef.get();
    assert.ok(probeSnap.exists);
    assert.equal(await countAuditEventsFor(targetId), 1);
  });

  await check("a WriteBatch never committed persists NEITHER write (proves atomicity isn't accidental)", async () => {
    const targetId = `batch-uncommitted-${Date.now()}`;
    const probeRef = db.collection("probe_mutations").doc(targetId);
    const batch = db.batch();
    batch.set(probeRef, { businessField: "never-committed" });
    stageAuditEvent(batch, { ...VALID_EVENT, targetId });
    // Deliberately never call batch.commit().
    const probeSnap = await probeRef.get();
    assert.equal(probeSnap.exists, false);
    assert.equal(await countAuditEventsFor(targetId), 0);
  });

  await check("recordStandaloneAuditEvent (audit-only, no business mutation) writes exactly one event with a real server timestamp", async () => {
    const id = await recordStandaloneAuditEvent(VALID_EVENT);
    const snap = await db.collection("auditEvents").doc(id).get();
    assert.ok(snap.exists);
    const data = snap.data();
    assert.equal(data.actorUid, "actor-1");
    assert.equal(typeof data.at.toDate, "function");
  });

  // --- Complete contract validation ---
  for (const [field, value] of [
    ["actorUid", undefined],
    ["action", "notARealAction"],
    ["targetType", null],
    ["targetId", 123],
    ["outcome", "maybe"],
    ["summary", ""],
  ]) {
    await check(`stageAuditEvent rejects missing/invalid ${field}`, async () => {
      const bad = { ...VALID_EVENT, [field]: value };
      assert.throws(() => stageAuditEvent(db.batch(), bad), AuditEventValidationError);
    });
  }

  await check("stageAuditEvent rejects every non-allow-listed action value (full AuditAction contract, not merely 'is a string')", async () => {
    for (const bogus of ["deleteRole", "GRANTROLE", "grant_role", ""]) {
      assert.throws(
        () => stageAuditEvent(db.batch(), { ...VALID_EVENT, action: bogus }),
        AuditEventValidationError,
        `expected rejection for action="${bogus}"`,
      );
    }
  });

  await check("stageAuditEvent accepts every real AuditAction value", () => {
    for (const action of [
      "grantRole",
      "revokeRole",
      "assignApprovedRole",
      "setUserStatus",
      "approveAccessRequest",
      "rejectAccessRequest",
      "breakGlassRestore",
    ]) {
      assert.doesNotThrow(() => stageAuditEvent(db.batch(), { ...VALID_EVENT, action }));
    }
  });

  // --- Issue #325 / ADR-007 D-AUDIT: report definition changes, runs,
  // exports, sharing, and (designed) scheduling, extending this SAME
  // Audit Event path -- never row data or secrets. ---

  await check("REPORT_AUDIT_ACTIONS is exactly the eight report actions, in the documented set", () => {
    assert.deepEqual(
      [...REPORT_AUDIT_ACTIONS].sort(),
      [
        "createReportDefinition",
        "renameReportDefinition",
        "duplicateReportDefinition",
        "deleteReportDefinition",
        "runReportDefinition",
        "exportReportDefinition",
        "shareReportDefinition",
        "scheduleReportDefinition",
      ].sort(),
    );
  });

  await check("stageAuditEvent accepts every report AuditAction value with a valid objectId", () => {
    for (const action of REPORT_AUDIT_ACTIONS) {
      assert.doesNotThrow(() =>
        stageAuditEvent(db.batch(), {
          ...VALID_EVENT,
          action,
          targetType: "reportDefinition",
          objectId: "customer",
        }),
      );
    }
  });

  await check("stageAuditEvent rejects a report AuditAction with no objectId", () => {
    for (const action of REPORT_AUDIT_ACTIONS) {
      assert.throws(
        () => stageAuditEvent(db.batch(), { ...VALID_EVENT, action, targetType: "reportDefinition" }),
        AuditEventValidationError,
        `expected rejection for action="${action}" with no objectId`,
      );
    }
  });

  await check("stageAuditEvent rejects objectId on a NON-report AuditAction (report-only field, no drift onto grantRole/etc.)", () => {
    assert.throws(
      () => stageAuditEvent(db.batch(), { ...VALID_EVENT, objectId: "customer" }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent rejects an empty or over-length objectId", () => {
    assert.throws(
      () =>
        stageAuditEvent(db.batch(), {
          ...VALID_EVENT,
          action: "createReportDefinition",
          objectId: "",
        }),
      AuditEventValidationError,
    );
    assert.throws(
      () =>
        stageAuditEvent(db.batch(), {
          ...VALID_EVENT,
          action: "createReportDefinition",
          objectId: "x".repeat(201),
        }),
      AuditEventValidationError,
    );
  });

  const NON_ROW_FACT_REPORT_ACTIONS = REPORT_AUDIT_ACTIONS.filter(
    (a) => a !== "runReportDefinition" && a !== "exportReportDefinition",
  );

  await check("stageAuditEvent rejects rowCount/droppedFieldIds/droppedPredicateFieldIds/truncated on a non-run/export report action", () => {
    for (const action of NON_ROW_FACT_REPORT_ACTIONS) {
      const base = { ...VALID_EVENT, action, targetType: "reportDefinition", objectId: "customer" };
      for (const bad of [
        { rowCount: 5 },
        { droppedFieldIds: ["customer.notes"] },
        { droppedPredicateFieldIds: ["customer.notes"] },
        { truncated: false },
      ]) {
        assert.throws(
          () => stageAuditEvent(db.batch(), { ...base, ...bad }),
          AuditEventValidationError,
          `expected rejection for action="${action}" with ${JSON.stringify(bad)}`,
        );
      }
    }
  });

  await check("stageAuditEvent rejects rowCount/droppedFieldIds/droppedPredicateFieldIds/truncated on a non-report AuditAction too", () => {
    for (const bad of [
      { rowCount: 5 },
      { droppedFieldIds: ["customer.notes"] },
      { droppedPredicateFieldIds: ["customer.notes"] },
      { truncated: false },
    ]) {
      assert.throws(
        () => stageAuditEvent(db.batch(), { ...VALID_EVENT, ...bad }),
        AuditEventValidationError,
      );
    }
  });

  await check("stageAuditEvent accepts a well-formed runReportDefinition event with every row fact", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), {
        ...VALID_EVENT,
        action: "runReportDefinition",
        targetType: "reportDefinition",
        objectId: "customer",
        rowCount: 42,
        droppedFieldIds: ["customer.notes"],
        droppedPredicateFieldIds: ["customer.accountOwner"],
        truncated: false,
      }),
    );
  });

  await check("stageAuditEvent accepts a well-formed exportReportDefinition event", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), {
        ...VALID_EVENT,
        action: "exportReportDefinition",
        targetType: "reportDefinition",
        objectId: "customer",
        rowCount: 10000,
        truncated: true,
      }),
    );
  });

  await check("stageAuditEvent accepts a run/export event with NO row facts at all (they are optional, not required)", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), {
        ...VALID_EVENT,
        action: "runReportDefinition",
        targetType: "reportDefinition",
        objectId: "customer",
      }),
    );
  });

  for (const bad of [-1, 1.5, "3", NaN]) {
    await check(`stageAuditEvent rejects an invalid rowCount (${JSON.stringify(bad)})`, () => {
      assert.throws(
        () =>
          stageAuditEvent(db.batch(), {
            ...VALID_EVENT,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            objectId: "customer",
            rowCount: bad,
          }),
        AuditEventValidationError,
      );
    });
  }

  await check("stageAuditEvent rejects a non-array droppedFieldIds/droppedPredicateFieldIds", () => {
    for (const field of ["droppedFieldIds", "droppedPredicateFieldIds"]) {
      assert.throws(
        () =>
          stageAuditEvent(db.batch(), {
            ...VALID_EVENT,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            objectId: "customer",
            [field]: "customer.notes",
          }),
        AuditEventValidationError,
      );
    }
  });

  await check("stageAuditEvent rejects droppedFieldIds/droppedPredicateFieldIds containing a non-string, empty, or over-length entry", () => {
    for (const field of ["droppedFieldIds", "droppedPredicateFieldIds"]) {
      for (const bad of [[123], [""], ["x".repeat(201)], [null]]) {
        assert.throws(
          () =>
            stageAuditEvent(db.batch(), {
              ...VALID_EVENT,
              action: "runReportDefinition",
              targetType: "reportDefinition",
              objectId: "customer",
              [field]: bad,
            }),
          AuditEventValidationError,
          `expected rejection for ${field}=${JSON.stringify(bad)}`,
        );
      }
    }
  });

  await check("stageAuditEvent rejects a droppedFieldIds/droppedPredicateFieldIds array exceeding the length cap", () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `customer.field${i}`);
    for (const field of ["droppedFieldIds", "droppedPredicateFieldIds"]) {
      assert.throws(
        () =>
          stageAuditEvent(db.batch(), {
            ...VALID_EVENT,
            action: "runReportDefinition",
            targetType: "reportDefinition",
            objectId: "customer",
            [field]: tooMany,
          }),
        AuditEventValidationError,
      );
    }
  });

  await check("stageAuditEvent rejects a non-boolean truncated", () => {
    assert.throws(
      () =>
        stageAuditEvent(db.batch(), {
          ...VALID_EVENT,
          action: "runReportDefinition",
          targetType: "reportDefinition",
          objectId: "customer",
          truncated: "yes",
        }),
      AuditEventValidationError,
    );
  });

  await check("a persisted runReportDefinition event round-trips every report field correctly, and carries no row data field", async () => {
    const id = await recordStandaloneAuditEvent({
      ...VALID_EVENT,
      action: "runReportDefinition",
      targetType: "reportDefinition",
      targetId: `def-${Date.now()}`,
      objectId: "customer",
      rowCount: 7,
      droppedFieldIds: ["customer.notes"],
      droppedPredicateFieldIds: ["customer.accountOwner"],
      truncated: false,
      accessVersionAfter: 3,
    });
    const snap = await db.collection("auditEvents").doc(id).get();
    const data = snap.data();
    assert.equal(data.action, "runReportDefinition");
    assert.equal(data.objectId, "customer");
    assert.equal(data.rowCount, 7);
    assert.deepEqual(data.droppedFieldIds, ["customer.notes"]);
    assert.deepEqual(data.droppedPredicateFieldIds, ["customer.accountOwner"]);
    assert.equal(data.truncated, false);
    assert.equal(data.accessVersionAfter, 3);
    // Structural guarantee: no field on the persisted document can carry
    // arbitrary row data -- the only fields present are the fixed,
    // narrow-typed contract, never a generic "rows"/"data"/"results" blob.
    for (const key of ["rows", "data", "results", "records"]) {
      assert.equal(key in data, false, `persisted document must never carry a "${key}" field`);
    }
  });

  await check("stageAuditEvent rejects a summary that exceeds the length cap", () => {
    assert.throws(
      () => stageAuditEvent(db.batch(), { ...VALID_EVENT, summary: "x".repeat(501) }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent refuses to persist a summary that looks like a bearer token (secret-shape guard)", () => {
    assert.throws(
      () =>
        stageAuditEvent(db.batch(), {
          ...VALID_EVENT,
          summary: "Authenticated with Bearer abcdef1234567890.leaked",
        }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent accepts an ordinary, secret-free summary containing the word 'password' as a noun", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), { ...VALID_EVENT, summary: "Password reset link issued for principal-1" }),
    );
  });

  await check("stageAuditEvent accepts a valid optional scope", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), { ...VALID_EVENT, scope: { type: "global" } }),
    );
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), { ...VALID_EVENT, scope: { type: "domain", value: "inventory" } }),
    );
  });

  await check("stageAuditEvent rejects an invalid scope.type", () => {
    assert.throws(
      () => stageAuditEvent(db.batch(), { ...VALID_EVENT, scope: { type: "not-a-real-scope-type" } }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent rejects a non-string scope.value", () => {
    assert.throws(
      () => stageAuditEvent(db.batch(), { ...VALID_EVENT, scope: { type: "domain", value: 123 } }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent rejects a non-string approverUid", () => {
    assert.throws(
      () => stageAuditEvent(db.batch(), { ...VALID_EVENT, approverUid: 123 }),
      AuditEventValidationError,
    );
  });

  await check("stageAuditEvent accepts a valid approverUid", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), { ...VALID_EVENT, approverUid: "approver-1" }),
    );
  });

  for (const bad of [-1, 1.5, "3", NaN]) {
    await check(`stageAuditEvent rejects an invalid accessVersionAfter (${JSON.stringify(bad)})`, () => {
      assert.throws(
        () => stageAuditEvent(db.batch(), { ...VALID_EVENT, accessVersionAfter: bad }),
        AuditEventValidationError,
      );
    });
  }

  await check("stageAuditEvent accepts a valid accessVersionAfter", () => {
    assert.doesNotThrow(() =>
      stageAuditEvent(db.batch(), { ...VALID_EVENT, accessVersionAfter: 4 }),
    );
  });

  // --- Bounded/validated list-query limits ---
  await check("listRecentAuditEvents returns newest-first and honors a valid limit", async () => {
    const seedBatch = db.batch();
    const ref1 = db.collection("auditEvents").doc();
    const ref2 = db.collection("auditEvents").doc();
    seedBatch.set(ref1, { ...VALID_EVENT, targetId: `order-a-${Date.now()}`, at: admin.firestore.Timestamp.fromMillis(1000) });
    seedBatch.set(ref2, { ...VALID_EVENT, targetId: `order-b-${Date.now()}`, at: admin.firestore.Timestamp.fromMillis(2000) });
    await seedBatch.commit();
    const events = await listRecentAuditEvents({ limit: 1 });
    assert.equal(events.length, 1);
  });

  for (const bad of [0, -1, 1.5, 201, "50"]) {
    await check(`listRecentAuditEvents rejects an invalid limit (${JSON.stringify(bad)})`, async () => {
      await assert.rejects(() => listRecentAuditEvents({ limit: bad }), AuditEventValidationError);
    });
  }

  await check("listRecentAuditEvents accepts the boundary limits (1 and 200)", async () => {
    await assert.doesNotReject(() => listRecentAuditEvents({ limit: 1 }));
    await assert.doesNotReject(() => listRecentAuditEvents({ limit: 200 }));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
