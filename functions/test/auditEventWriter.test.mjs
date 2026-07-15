// Enterprise Access & Administration Platform (Issue #226) -- Row 5
// (Task 10) test for the immutable Audit Event trusted writer + read
// model (functions/src/access/auditEventWriter.ts). Proves: a valid
// event is written with a server timestamp; every required field is
// actually required (fail-closed on missing/wrong-type input); the
// secret-pattern guard refuses to persist an obviously-wrong summary;
// the read model returns events newest-first and filters by target;
// and -- critically -- that firestore.rules STILL denies all
// CLIENT-SDK access to auditEvents regardless of this Admin-SDK writer
// existing (the deny-all Rule from Row 3/#245's still-open PR #276 is
// not yet live on this branch's base, so this file only asserts the
// writer's own behavior; the Rules-side deny-all is covered by
// functions/test/enterpriseAccessFoundationRules.test.js).
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
  recordAuditEvent,
  listRecentAuditEvents,
  AuditEventValidationError,
} from "../lib/access/auditEventWriter.js";

const PROJECT_ID = "taylor-parts";
admin.initializeApp({ projectId: PROJECT_ID });

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

async function main() {
  await check("recordAuditEvent writes a document with a server timestamp", async () => {
    const id = await recordAuditEvent(VALID_EVENT);
    const snap = await admin.firestore().collection("auditEvents").doc(id).get();
    assert.ok(snap.exists);
    const data = snap.data();
    assert.equal(data.actorUid, "actor-1");
    assert.equal(data.action, "grantRole");
    assert.equal(data.outcome, "applied");
    assert.ok(data.at, "at (server timestamp) must be set");
    // A Firestore Timestamp, not a client-suppliable number/string.
    assert.equal(typeof data.at.toDate, "function");
  });

  for (const [field, value] of [
    ["actorUid", undefined],
    ["action", ""],
    ["targetType", null],
    ["targetId", 123],
    ["outcome", "maybe"],
    ["summary", ""],
  ]) {
    await check(`recordAuditEvent rejects missing/invalid ${field}`, async () => {
      const bad = { ...VALID_EVENT, [field]: value };
      await assert.rejects(() => recordAuditEvent(bad), AuditEventValidationError);
    });
  }

  await check("recordAuditEvent rejects a summary that exceeds the length cap", async () => {
    const bad = { ...VALID_EVENT, summary: "x".repeat(501) };
    await assert.rejects(() => recordAuditEvent(bad), AuditEventValidationError);
  });

  await check("recordAuditEvent refuses to persist a summary that looks like a bearer token (secret-shape guard)", async () => {
    const bad = { ...VALID_EVENT, summary: "Authenticated with Bearer abcdef1234567890.leaked" };
    await assert.rejects(() => recordAuditEvent(bad), AuditEventValidationError);
  });

  await check("recordAuditEvent refuses to persist a summary containing password=... (secret-shape guard)", async () => {
    const bad = { ...VALID_EVENT, summary: "Login attempt password=hunter2leaked" };
    await assert.rejects(() => recordAuditEvent(bad), AuditEventValidationError);
  });

  await check("recordAuditEvent accepts an ordinary, secret-free summary containing the word 'password' as a noun", async () => {
    const ok = { ...VALID_EVENT, summary: "Password reset link issued for principal-1" };
    await assert.doesNotReject(() => recordAuditEvent(ok));
  });

  await check("listRecentAuditEvents returns newest-first and honors a limit", async () => {
    const targetId = `order-test-${Date.now()}`;
    await recordAuditEvent({ ...VALID_EVENT, targetId, summary: "first" });
    await new Promise((r) => setTimeout(r, 50));
    await recordAuditEvent({ ...VALID_EVENT, targetId, summary: "second" });
    const events = await listRecentAuditEvents({ targetId, limit: 1 });
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, "second");
  });

  await check("listRecentAuditEvents filters by targetType", async () => {
    const targetType = `probe-type-${Date.now()}`;
    await recordAuditEvent({ ...VALID_EVENT, targetType, targetId: "probe-1" });
    const events = await listRecentAuditEvents({ targetType });
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => e.targetType === targetType));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
