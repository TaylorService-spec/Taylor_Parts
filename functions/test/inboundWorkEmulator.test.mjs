// Email Connections + Inbound Work -- THE END-TO-END SUITE, against a real Firestore emulator.
//
// This is the suite that proves the feature rather than its parts: a provider message goes in through the
// real adapter, routing, processing and intake path; the queue read serves it; a reviewer accepts it; and
// exactly ONE governed Work Order comes out, carrying the customer, site, unit, warranty authorization and
// problem the message described -- with the intake linked to it and an audit event beside it.
//
// Prerequisite (matching every other emulator suite here):
//   node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore \
//     --project eos-platform-sandbox --config ../firebase.json
//   npm run build && node --test test/inboundWorkEmulator.test.mjs
//
// PROJECT IDENTITY IS PART OF THE TEST. It runs as eos-platform-sandbox because that is where the six
// capabilities are activated; under the production identity every one of them resolves DENY, which is the
// posture the environment suite asserts separately.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

import { test, before } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";

import { normalizeProviderMessage } from "../lib/inboundWork/emailProvider.js";
import { ingestInboundMessage, inboundRequestDocId } from "../lib/inboundWork/inboundIntakeCommand.js";
import {
  acceptInboundWorkRequest,
  declineInboundWorkRequest,
  attachInboundWorkRequest,
  InboundDecisionError,
} from "../lib/inboundWork/inboundDecisionCommands.js";
import { upsertEmailConnection, upsertEmailMailbox, upsertEmailRoutingRule } from "../lib/inboundWork/emailAdminCommands.js";
import {
  readEmailIntakeConfiguration,
  readInboundWorkQueue,
  readInboundWorkRequest,
  readMailbox,
  readRoutingRules,
} from "../lib/inboundWork/inboundWorkReadService.js";
import { resolveEffectiveAccess } from "../lib/access/effectiveAccessFeed.js";
import {
  SANDBOX_CONNECTION,
  SANDBOX_MAILBOX_CONFIGS,
  SANDBOX_MAILBOXES,
  SANDBOX_ROUTING_RULES,
  SANDBOX_RECORDS,
  FIXTURE_CORPORATE_WARRANTY,
  FIXTURE_WARRANTY_REPLY,
  FIXTURE_UNKNOWN_CUSTOMER,
  FIXTURE_TO_DECLINE,
  FIXTURE_GMAIL_SERVICE,
} from "../scripts/fixtures/inboundWorkFixtures.mjs";

admin.initializeApp({ projectId: "eos-platform-sandbox" });
const db = admin.firestore();
const SYSTEM_ACTOR = "sbx-intake-system";
const REVIEWER = "sbx-reviewer-uid";
const OUTSIDER = "sbx-outsider-uid";
const ADMINISTRATOR = "sbx-email-admin-uid";

const ingest = (fixture, extra = {}) =>
  ingestInboundMessage(db, {
    message: normalizeProviderMessage(fixture.provider, fixture.message, {
      connectionId: SANDBOX_CONNECTION.id,
      mailboxId: fixture.mailboxId,
    }),
    mailbox: mailboxes[fixture.mailboxId],
    rules,
    actorUid: SYSTEM_ACTOR,
    ...extra,
  });

const auditFor = async (targetId, action) => {
  const snap = await db.collection("auditEvents").where("targetId", "==", targetId).get();
  return snap.docs.map((d) => d.data()).filter((e) => !action || e.action === action);
};

let mailboxes = {};
let rules = [];

async function seedPrincipal(uid, roleId) {
  await db.collection("users").doc(uid).set({ accessVersion: 1 });
  if (!roleId) return;
  await db.collection("roleAssignments").doc(`${uid}-${roleId}`).set({
    id: `${uid}-${roleId}`,
    principalUid: uid,
    roleId,
    scope: { type: "global" },
    grantedBy: "sandbox-fixture",
    grantedAt: admin.firestore.Timestamp.now(),
    status: "active",
    accessVersionAtGrant: 1,
  });
}

before(async () => {
  // FIXTURE RESET, and only in the emulator. Audit events are append-only by policy and this repository
  // has no code path that mutates one -- but a suite that counts events must start from a known state, or
  // the second run of "exactly one acceptance event" counts the first run's too. Deleting here is a
  // property of the throwaway emulator database, not a capability the writer gained. It runs FIRST, so the
  // configuration writes below are themselves inside the window this suite asserts about.
  for (const collection of ["inbound_work_requests", "auditEvents"]) {
    for (const doc of await db.collection(collection).listDocuments()) await doc.delete();
  }
  // Deterministic and re-runnable: every fixture writes at a fixed id, so a second run overwrites rather
  // than accumulating, and no test depends on a previous run's leftovers.
  await upsertEmailConnection(db, { id: SANDBOX_CONNECTION.id, actorUid: ADMINISTRATOR, config: SANDBOX_CONNECTION.config });
  for (const mailbox of SANDBOX_MAILBOX_CONFIGS) {
    await upsertEmailMailbox(db, { id: mailbox.id, actorUid: ADMINISTRATOR, config: mailbox.config });
  }
  for (const rule of SANDBOX_ROUTING_RULES) {
    await upsertEmailRoutingRule(db, { id: rule.id, actorUid: ADMINISTRATOR, rule: rule.rule });
  }
  await db.collection("accounts").doc(SANDBOX_RECORDS.accountId).set(SANDBOX_RECORDS.account);
  await db.collection("locations").doc(SANDBOX_RECORDS.locationId).set(SANDBOX_RECORDS.location);
  await db.collection("equipment").doc(SANDBOX_RECORDS.equipmentId).set(SANDBOX_RECORDS.equipment);
  await db.collection("contacts").doc(SANDBOX_RECORDS.contactId).set(SANDBOX_RECORDS.contact);
  await seedPrincipal(REVIEWER, "serviceInboundWorkReviewer");
  await seedPrincipal(ADMINISTRATOR, "emailIntakeAdministrator");
  await seedPrincipal(OUTSIDER, null);

  mailboxes = {
    [SANDBOX_MAILBOXES.service]: await readMailbox(db, SANDBOX_MAILBOXES.service),
    [SANDBOX_MAILBOXES.warranty]: await readMailbox(db, SANDBOX_MAILBOXES.warranty),
    [SANDBOX_MAILBOXES.parts]: await readMailbox(db, SANDBOX_MAILBOXES.parts),
  };
  rules = await readRoutingRules(db);
});

// ── Authority ────────────────────────────────────────────────────────────────────────────────────
test("the Service reviewer Role resolves the four inbound-work capabilities and NO administration authority", async () => {
  const { decisions } = await resolveEffectiveAccess({
    principalUid: REVIEWER,
    permissionIds: [
      "service.inboundWork.read",
      "service.inboundWork.accept",
      "service.inboundWork.decline",
      "service.inboundWork.attachExisting",
      "administration.emailIntake.manage",
    ],
  });
  assert.equal(decisions["service.inboundWork.read"], true);
  assert.equal(decisions["service.inboundWork.accept"], true);
  assert.equal(decisions["service.inboundWork.decline"], true);
  assert.equal(decisions["service.inboundWork.attachExisting"], true);
  assert.equal(decisions["administration.emailIntake.manage"], false, "a queue reviewer must not be able to repoint a mailbox");
});

test("the email administrator Role can configure intake and cannot accept work", async () => {
  const { decisions } = await resolveEffectiveAccess({
    principalUid: ADMINISTRATOR,
    permissionIds: ["administration.emailIntake.read", "administration.emailIntake.manage", "service.inboundWork.accept"],
  });
  assert.equal(decisions["administration.emailIntake.read"], true);
  assert.equal(decisions["administration.emailIntake.manage"], true);
  assert.equal(decisions["service.inboundWork.accept"], false, "configuring the mailboxes is not authority to accept the work");
});

test("a principal holding no governed Role is denied everything -- register and activate are not a grant", async () => {
  const { decisions } = await resolveEffectiveAccess({
    principalUid: OUTSIDER,
    permissionIds: ["service.inboundWork.read", "service.inboundWork.accept", "administration.emailIntake.read"],
  });
  assert.deepEqual(Object.values(decisions), [false, false, false]);
});

// ── Intake ───────────────────────────────────────────────────────────────────────────────────────
test("a Microsoft warranty message creates exactly ONE intake, routed by the administrator's rule", async () => {
  const result = await ingest(FIXTURE_CORPORATE_WARRANTY);
  assert.equal(result.outcome, "CREATED");
  assert.equal(result.requestId, inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id));

  const detail = await readInboundWorkRequest(db, result.requestId);
  assert.equal(detail.status, "AWAITING_DECISION");
  assert.equal(detail.requestType, "WARRANTY");
  assert.equal(detail.queue, "WARRANTY_REVIEW");
  assert.equal(detail.routingRuleId, "sbx-rule-corporate-warranty");
  assert.equal(detail.priority, 2);
  assert.equal(detail.processingProvider, "EOS_NATIVE");
});

test("provenance and the original message survive intake", async () => {
  const detail = await readInboundWorkRequest(db, inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id));
  assert.equal(detail.sourceProvider, "MICROSOFT_365");
  assert.equal(detail.sourceMessageId, FIXTURE_CORPORATE_WARRANTY.message.id);
  assert.equal(detail.sourceThreadId, FIXTURE_CORPORATE_WARRANTY.message.conversationId);
  assert.equal(detail.sender, "dispatch@corporate.example");
  assert.ok(detail.receivedAt > 0);
  assert.match(detail.originalBodyText, /not cooling/);
});

test("the governed read never hands a browser the stored markup", async () => {
  const id = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const stored = (await db.collection("inbound_work_requests").doc(id).get()).data();
  assert.match(stored.originalBody, /<p>/, "the raw message is retained as evidence");
  const detail = await readInboundWorkRequest(db, id);
  assert.equal(/[<>]/.test(detail.originalBodyText), false, "the projection is plain text");
  assert.equal("originalBody" in detail, false, "the markup is not projected at all");
});

test("attachments are preserved with their provenance", async () => {
  const detail = await readInboundWorkRequest(db, inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id));
  assert.equal(detail.attachmentRefs.length, 2);
  const pdf = detail.attachmentRefs.find((a) => a.filename === "warranty-authorization.pdf");
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.providerAttachmentId, "sbx-att-1");
  assert.equal(pdf.sourceMessageId, FIXTURE_CORPORATE_WARRANTY.message.id);
});

test("base EOS suggests the customer, site and unit from the serial -- no add-on involved", async () => {
  const detail = await readInboundWorkRequest(db, inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id));
  assert.equal(detail.equipmentCandidate.id, SANDBOX_RECORDS.equipmentId);
  assert.equal(detail.equipmentCandidate.matchedOn, "serialNumberKey");
  assert.equal(detail.customerCandidate.id, SANDBOX_RECORDS.accountId);
  assert.equal(detail.locationCandidate.id, SANDBOX_RECORDS.locationId);
  assert.equal(detail.authorizationNumber, "WR-4471");
  assert.equal(detail.externalReference, "CASE-88213");
});

test("a message EOS cannot resolve still arrives, honestly unresolved and flagged for review", async () => {
  const result = await ingest(FIXTURE_UNKNOWN_CUSTOMER);
  const detail = await readInboundWorkRequest(db, result.requestId);
  assert.equal(detail.status, "NEEDS_REVIEW", "the service-mailbox rule demands manual review");
  assert.equal(detail.equipmentCandidate.id, null);
  assert.equal(detail.customerCandidate.id, null);
  assert.ok(detail.warnings.includes("NO_SERIAL_NUMBER"));
});

test("the SAME provider message delivered twice does not create a second intake", async () => {
  const first = await ingest(FIXTURE_TO_DECLINE);
  const second = await ingest(FIXTURE_TO_DECLINE);
  assert.equal(first.outcome, "CREATED");
  assert.equal(second.outcome, "DUPLICATE");
  assert.equal(second.requestId, first.requestId);
  const snap = await db.collection("inbound_work_requests").where("sourceMessageId", "==", FIXTURE_TO_DECLINE.message.id).get();
  assert.equal(snap.size, 1);
});

test("a message in a mailbox EOS does not know is QUARANTINED and retained, never discarded", async () => {
  const result = await ingest({ ...FIXTURE_GMAIL_SERVICE, mailboxId: "sbx-mb-not-configured" }, { mailbox: null });
  assert.equal(result.outcome, "QUARANTINED");
  const detail = await readInboundWorkRequest(db, result.requestId);
  assert.equal(detail.status, "QUARANTINED");
  assert.ok(detail.originalBodyText.length > 0, "the message is still there to look at");
  assert.equal((await auditFor(result.requestId, "quarantineInboundWorkRequest")).length, 1);
});

test("a processing failure is RETAINED as FAILED with its reason, not lost", async () => {
  const failing = {
    ...FIXTURE_GMAIL_SERVICE,
    message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-processing-failure", threadId: "sbx-gmail-processing-failure-thread" },
  };
  const result = await ingest(failing, {
    processingProvider: "EXTERNAL",
    // A provider result that cannot be normalized: the getter throws when read, which is what an
    // external integration failing mid-delivery looks like from here.
    providerResult: Object.defineProperty({}, "requestType", {
      get() {
        throw new Error("external processing pipeline unavailable");
      },
      enumerable: true,
    }),
  });
  assert.equal(result.outcome, "FAILED");
  const detail = await readInboundWorkRequest(db, result.requestId);
  assert.equal(detail.status, "FAILED");
  assert.match(detail.processingError, /unavailable/);
  assert.ok(detail.originalBodyText.length > 0);
});

// ── The queue ────────────────────────────────────────────────────────────────────────────────────
test("the queue read serves the intake, newest first, without any client Firestore access", async () => {
  const { rows } = await readInboundWorkQueue(db, {});
  assert.ok(rows.length >= 3);
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].receivedAt >= rows[i].receivedAt);
  const warranty = rows.find((r) => r.subject.startsWith("Warranty service required"));
  assert.equal(warranty.requestType, "WARRANTY");
  assert.equal(warranty.attachmentCount, 2);
});

// ── Accept ───────────────────────────────────────────────────────────────────────────────────────
test("ACCEPT creates exactly one governed Work Order carrying what the message said", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const before = await db.collection("fieldops_wos").get();
  const result = await acceptInboundWorkRequest(db, {
    requestId,
    actorUid: REVIEWER,
    customerId: SANDBOX_RECORDS.accountId,
    locationId: SANDBOX_RECORDS.locationId,
    equipmentId: SANDBOX_RECORDS.equipmentId,
    requestType: "WARRANTY",
    priority: 2,
  });
  assert.equal(result.replayed, false);
  const after = await db.collection("fieldops_wos").get();
  assert.equal(after.size, before.size + 1, "exactly one Work Order");

  const wo = (await db.collection("fieldops_wos").doc(result.workItemId).get()).data();
  assert.equal(wo.customerId, SANDBOX_RECORDS.accountId);
  assert.equal(wo.locationId, SANDBOX_RECORDS.locationId);
  assert.equal(wo.equipmentId, SANDBOX_RECORDS.equipmentId);
  assert.equal(wo.type, "WARRANTY");
  assert.equal(wo.priority, 2);
  assert.equal(wo.status, "CREATED");
  assert.match(wo.complaint, /not cooling/, "the problem is carried over -- nobody retypes it");
  assert.equal(wo.authorizationNumber, "WR-4471");
  assert.equal(wo.externalReference, "CASE-88213");
  assert.equal(wo.inboundWorkRequestId, requestId, "the Work Order says which inbound request created it");
  assert.ok(wo.woNumber, "it is numbered by the same governed allocator");
});

test("the intake records the accepting user, the moment, and the Work Order", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.status, "ACCEPTED");
  assert.equal(detail.decision, "ACCEPTED");
  assert.equal(detail.decisionBy, REVIEWER);
  assert.ok(detail.workItemId);
  const stored = (await db.collection("inbound_work_requests").doc(requestId).get()).data();
  assert.ok(stored.decisionAt, "the acceptance time is a server timestamp, not a client claim");
});

test("acceptance is audited, and the trail answers why the Work Order exists", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const events = await auditFor(requestId);
  const actions = events.map((e) => e.action).sort();
  assert.ok(actions.includes("createInboundWorkRequest"));
  assert.ok(actions.includes("acceptInboundWorkRequest"));
  const acceptance = events.find((e) => e.action === "acceptInboundWorkRequest");
  assert.equal(acceptance.actorUid, REVIEWER);
  assert.match(acceptance.summary, /created work order/);

  const detail = await readInboundWorkRequest(db, requestId);
  const woEvents = await auditFor(detail.workItemId, "createWorkOrder");
  assert.equal(woEvents.length, 1, "the Work Order create is audited by the same governed core");
});

test("accepting the SAME request twice returns the SAME Work Order -- two clicks, one job", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const before = await db.collection("fieldops_wos").get();
  const replay = await acceptInboundWorkRequest(db, {
    requestId,
    actorUid: REVIEWER,
    customerId: SANDBOX_RECORDS.accountId,
    locationId: SANDBOX_RECORDS.locationId,
  });
  const after = await db.collection("fieldops_wos").get();
  assert.equal(replay.replayed, true);
  assert.equal(after.size, before.size, "no second Work Order");
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(replay.workItemId, detail.workItemId);
});

test("a concurrent double-accept still creates exactly one Work Order", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-race", threadId: "sbx-gmail-race-thread" } };
  const { requestId } = await ingest(fixture);
  const before = await db.collection("fieldops_wos").get();
  const accept = () =>
    acceptInboundWorkRequest(db, {
      requestId,
      actorUid: REVIEWER,
      customerId: SANDBOX_RECORDS.accountId,
      locationId: SANDBOX_RECORDS.locationId,
    });
  // THE INVARIANT IS "NEVER TWO WORK ORDERS", not "both calls succeed". Under real contention one
  // transaction wins and the other either replays the winner's result or fails outright -- the emulator
  // gives up on the losing transaction sooner than production Firestore does, and asserting that both
  // calls return would be asserting the emulator's retry budget rather than the behaviour that matters.
  // What must hold either way: one Work Order, and a later accept replaying to that same one.
  const outcomes = await Promise.allSettled([accept(), accept()]);
  const after = await db.collection("fieldops_wos").get();
  assert.equal(after.size, before.size + 1, "exactly one Work Order, whichever call won");

  const succeeded = outcomes.filter((o) => o.status === "fulfilled").map((o) => o.value.workItemId);
  assert.ok(succeeded.length >= 1, "at least one accept committed");
  assert.equal(new Set(succeeded).size, 1, "no two accepts produced different Work Orders");

  const replay = await accept();
  assert.equal(replay.replayed, true);
  assert.equal(replay.workItemId, succeeded[0]);
});

test("acceptance refuses a customer, location or unit that does not hold together", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-integrity", threadId: "sbx-gmail-integrity-thread" } };
  const { requestId } = await ingest(fixture);
  const base = { requestId, actorUid: REVIEWER, customerId: SANDBOX_RECORDS.accountId, locationId: SANDBOX_RECORDS.locationId };
  await assert.rejects(() => acceptInboundWorkRequest(db, { ...base, customerId: "no-such-account" }), /does not exist/);
  await assert.rejects(() => acceptInboundWorkRequest(db, { ...base, locationId: "no-such-location" }), /does not exist/);
  await assert.rejects(() => acceptInboundWorkRequest(db, { ...base, equipmentId: "no-such-equipment" }), /Equipment/);
  // An INSTALL cannot name a unit that does not exist yet -- the same rule the wizard is held to.
  await assert.rejects(
    () => acceptInboundWorkRequest(db, { ...base, requestType: "INSTALL", equipmentId: SANDBOX_RECORDS.equipmentId }),
    /INSTALL/i,
  );
});

test("accepting does not touch mastered Customer, Location or Equipment data", async () => {
  const account = (await db.collection("accounts").doc(SANDBOX_RECORDS.accountId).get()).data();
  const equipment = (await db.collection("equipment").doc(SANDBOX_RECORDS.equipmentId).get()).data();
  assert.deepEqual(account, SANDBOX_RECORDS.account);
  assert.deepEqual(equipment, SANDBOX_RECORDS.equipment);
});

// ── Threading ────────────────────────────────────────────────────────────────────────────────────
test("a reply on an accepted thread is preserved there and creates NO second Work Order", async () => {
  const originalId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const before = await db.collection("fieldops_wos").get();
  const intakeCountBefore = (await db.collection("inbound_work_requests").get()).size;

  const result = await ingest(FIXTURE_WARRANTY_REPLY);
  assert.equal(result.outcome, "THREAD_MATCH");
  assert.equal(result.requestId, originalId);

  assert.equal((await db.collection("inbound_work_requests").get()).size, intakeCountBefore, "no new intake");
  assert.equal((await db.collection("fieldops_wos").get()).size, before.size, "no new Work Order");

  const detail = await readInboundWorkRequest(db, originalId);
  assert.equal(detail.threadMessages.length, 1);
  assert.match(detail.threadMessages[0].normalizedBody, /still down/);
  assert.equal((await auditFor(originalId, "linkInboundWorkThreadMessage")).length, 1);
});

// ── Decline ──────────────────────────────────────────────────────────────────────────────────────
test("DECLINE records who, when and why, retains the record and creates no Work Order", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.service, FIXTURE_TO_DECLINE.message.id);
  const before = await db.collection("fieldops_wos").get();
  await declineInboundWorkRequest(db, { requestId, actorUid: REVIEWER, reason: "OUTSIDE_SERVICE_AREA", note: "Depot is out of area." });

  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.status, "DECLINED");
  assert.equal(detail.decisionReason, "OUTSIDE_SERVICE_AREA");
  assert.equal(detail.decisionBy, REVIEWER);
  assert.equal(detail.workItemId, null);
  assert.equal((await db.collection("fieldops_wos").get()).size, before.size);
  assert.equal((await auditFor(requestId, "declineInboundWorkRequest")).length, 1);
});

test("a declined request cannot then be accepted", async () => {
  const requestId = inboundRequestDocId(SANDBOX_MAILBOXES.service, FIXTURE_TO_DECLINE.message.id);
  await assert.rejects(
    () =>
      acceptInboundWorkRequest(db, {
        requestId,
        actorUid: REVIEWER,
        customerId: SANDBOX_RECORDS.accountId,
        locationId: SANDBOX_RECORDS.locationId,
      }),
    InboundDecisionError,
  );
});

test("an invalid decline reason is refused rather than stored as free text", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-badreason", threadId: "sbx-gmail-badreason-thread" } };
  const { requestId } = await ingest(fixture);
  await assert.rejects(() => declineInboundWorkRequest(db, { requestId, actorUid: REVIEWER, reason: "BECAUSE" }), InboundDecisionError);
});

// ── Attach to existing work ──────────────────────────────────────────────────────────────────────
test("ATTACH files a request against existing work and creates no second Work Order", async () => {
  const acceptedId = inboundRequestDocId(SANDBOX_MAILBOXES.warranty, FIXTURE_CORPORATE_WARRANTY.message.id);
  const existingWorkOrderId = (await readInboundWorkRequest(db, acceptedId)).workItemId;
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-attach", threadId: "sbx-gmail-attach-thread" } };
  const { requestId } = await ingest(fixture);

  const before = await db.collection("fieldops_wos").get();
  const result = await attachInboundWorkRequest(db, { requestId, actorUid: REVIEWER, workOrderId: existingWorkOrderId });
  assert.equal(result.replayed, false);
  assert.equal((await db.collection("fieldops_wos").get()).size, before.size, "attaching creates nothing");

  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.status, "ATTACHED");
  assert.equal(detail.workItemId, existingWorkOrderId);
  assert.equal(detail.customerId, SANDBOX_RECORDS.accountId, "the Work Order is the authority on who it is for");
  assert.equal((await auditFor(requestId, "attachInboundWorkRequest")).length, 1);

  // Attached is decided: it cannot then become a new job either.
  await assert.rejects(
    () => acceptInboundWorkRequest(db, { requestId, actorUid: REVIEWER, customerId: SANDBOX_RECORDS.accountId, locationId: SANDBOX_RECORDS.locationId }),
    InboundDecisionError,
  );
});

test("attaching to a Work Order that does not exist is refused", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-attach-missing", threadId: "sbx-gmail-attach-missing-thread" } };
  const { requestId } = await ingest(fixture);
  await assert.rejects(() => attachInboundWorkRequest(db, { requestId, actorUid: REVIEWER, workOrderId: "no-such-wo" }), InboundDecisionError);
});

// ── Gmail parity and the provider boundary ───────────────────────────────────────────────────────
test("the SAME workflow runs on a Gmail message with no change below the adapter", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-parity", threadId: "sbx-gmail-parity-thread" } };
  const { requestId, outcome } = await ingest(fixture);
  assert.equal(outcome, "CREATED");
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.sourceProvider, "GOOGLE_WORKSPACE");
  assert.equal(detail.equipmentCandidate.id, SANDBOX_RECORDS.equipmentId, "the same serial resolves the same unit");
  assert.equal(detail.externalReference, "VEN-5512");

  const accepted = await acceptInboundWorkRequest(db, {
    requestId,
    actorUid: REVIEWER,
    customerId: SANDBOX_RECORDS.accountId,
    locationId: SANDBOX_RECORDS.locationId,
    equipmentId: SANDBOX_RECORDS.equipmentId,
  });
  const wo = (await db.collection("fieldops_wos").doc(accepted.workItemId).get()).data();
  assert.equal(wo.type, "SERVICE_CALL");
  assert.equal(wo.externalReference, "VEN-5512");
});

test("an EXTERNAL processing provider changes nothing about acceptance or Work Order creation", async () => {
  const fixture = { ...FIXTURE_GMAIL_SERVICE, message: { ...FIXTURE_GMAIL_SERVICE.message, id: "sbx-gmail-external", threadId: "sbx-gmail-external-thread" } };
  const { requestId } = await ingest(fixture, {
    processingProvider: "EXTERNAL",
    providerResult: {
      requestType: "WARRANTY",
      authorizationNumber: "EXT-9001",
      problemDescription: "compressor replacement authorized by the vendor portal",
      customerCandidate: { id: SANDBOX_RECORDS.accountId, rawValue: "Sandbox Grill North", confidence: "EXACT", matchedOn: "externalMdm" },
      providerMetadata: { pipeline: "customer-ipaas-v2" },
    },
  });
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.processingProvider, "EXTERNAL");
  assert.equal(detail.authorizationNumber, "EXT-9001");
  assert.equal(detail.customerCandidate.id, SANDBOX_RECORDS.accountId);

  const accepted = await acceptInboundWorkRequest(db, {
    requestId,
    actorUid: REVIEWER,
    customerId: SANDBOX_RECORDS.accountId,
    locationId: SANDBOX_RECORDS.locationId,
  });
  const wo = (await db.collection("fieldops_wos").doc(accepted.workItemId).get()).data();
  assert.equal(wo.authorizationNumber, "EXT-9001");
  assert.match(wo.complaint, /compressor replacement/);
});

// ── Administration configuration ─────────────────────────────────────────────────────────────────
test("the administration read serves connections, mailboxes, rules and REAL counts", async () => {
  const config = await readEmailIntakeConfiguration(db);
  assert.equal(config.connections.length, 1);
  assert.equal(config.connections[0].oauthStatus, "NOT_CONNECTED", "a form cannot mark a connection authorized");
  assert.equal("password" in config.connections[0], false);
  assert.equal(config.mailboxes.length, 3);
  assert.equal(config.rules.length, 2);
  assert.ok(config.overview.total > 0);
  assert.ok((config.overview.byStatus.ACCEPTED ?? 0) > 0);
});

test("a connection carrying credential material is refused by the command, not only by the form", async () => {
  await assert.rejects(
    () =>
      upsertEmailConnection(db, {
        actorUid: ADMINISTRATOR,
        config: { ...SANDBOX_CONNECTION.config, connectionName: "Hostile", clientSecret: "shhh" },
      }),
    /cannot be stored/,
  );
});

test("configuration writes are audited", async () => {
  assert.equal((await auditFor(SANDBOX_CONNECTION.id, "configureEmailConnection")).length >= 1, true);
  assert.equal((await auditFor(SANDBOX_MAILBOXES.warranty, "configureEmailMailbox")).length >= 1, true);
});
