// updateOpportunity — transactional core, EMULATOR tests.
//
// The pure core is covered by opportunityUpdateCommand.test.mjs (18 assertions). These cover
// what only a real transaction shows: idempotent replay, the version token round-trip, audit
// evidence, and that a conflicting concurrent edit is rejected rather than silently
// last-write-wins.
//
// Prerequisite: npm run build; Firestore emulator running.
// Run: node --test test/opportunityUpdateCallable.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

import assert from "node:assert/strict";
import test, { after } from "node:test";
import admin from "firebase-admin";

admin.initializeApp({ projectId: "taylor-parts" });
const db = admin.firestore();

const { persistUpdatedOpportunity } = await import("../lib/opportunity/opportunityCallables.js");

const ACTOR = "actor-update-1";
let seq = 0;
const created = [];

// Cleans up for the same reason the atomic-Won suite does: other suites assert over whole
// collections, and a suite that leaves rows behind breaks them in ways that look unrelated.
after(async () => {
  for (const id of created) {
    await db.collection("opportunities").doc(id).delete().catch(() => {});
  }
  const audits = await db.collection("auditEvents").where("actorUid", "==", ACTOR).get();
  await Promise.all(audits.docs.map((d) => d.ref.delete()));
});

async function seed(over = {}) {
  const id = `upd-${Date.now()}-${++seq}`;
  await db.collection("opportunities").doc(id).set({
    accountId: "acct-1",
    ownerEmployeeId: "emp-1",
    salesChannel: "RETAIL",
    stage: "SOLUTION",
    outcome: null,
    need: "original need",
    expectedValue: 1000,
    lines: [{ kind: "PART", ref: "PRT-1", qty: 1 }],
    updatedAtMillis: 1_000,
    ...over,
  });
  created.push(id);
  return id;
}

const run = (id, input, key = "k1") =>
  db.runTransaction((tx) =>
    persistUpdatedOpportunity(
      db,
      tx,
      db.collection("opportunities").doc(id),
      { opportunityId: id, expectedUpdatedAtMillis: 1_000, ...input },
      ACTOR,
      key,
    ),
  );

test("an authorized edit applies, reports the changed fields, and refreshes the version token", async () => {
  const id = await seed();
  const res = await run(id, { need: "updated need" });
  assert.equal(res.success, true);
  assert.equal(res.replayed, false);
  assert.deepEqual(res.changed, ["need"]);

  const doc = (await db.collection("opportunities").doc(id).get()).data();
  assert.equal(doc.need, "updated need");
  assert.notEqual(doc.updatedAtMillis, 1_000, "the version token must advance so the next edit uses a fresh one");
  assert.equal(doc.updatedByUid, ACTOR, "actor is server-derived");
});

test("LIFECYCLE IS UNTOUCHED by an ordinary edit, even when the payload carries it", async () => {
  const id = await seed();
  await run(id, { need: "x", stage: "WON", outcome: "WON" });
  const doc = (await db.collection("opportunities").doc(id).get()).data();
  assert.equal(doc.stage, "SOLUTION", "stage must not move");
  assert.equal(doc.outcome, null, "outcome must not be set");
});

test("SAME-KEY REPLAY is a no-op that reports itself, and does not apply the edit twice", async () => {
  const id = await seed();
  await run(id, { need: "first" }, "same");
  // A second call with the same key but DIFFERENT content must not apply the new content.
  const second = await run(id, { need: "second" }, "same");
  assert.equal(second.replayed, true);
  const doc = (await db.collection("opportunities").doc(id).get()).data();
  assert.equal(doc.need, "first", "the replay must not overwrite with the second payload");
});

test("a STALE version is rejected — concurrent edits do not silently last-write-win", async () => {
  const id = await seed();
  await run(id, { need: "winner" }, "k1");
  // Second editor still holds the ORIGINAL token.
  await assert.rejects(
    run(id, { need: "loser" }, "k2"),
    (e) => /changed since it was loaded/i.test(String(e?.message)),
    "the stale writer must be told, not silently applied",
  );
  const doc = (await db.collection("opportunities").doc(id).get()).data();
  assert.equal(doc.need, "winner", "the losing edit must not have landed");
});

test("AUDIT EVIDENCE is appended, naming the actor and the changed fields", async () => {
  const id = await seed();
  await run(id, { need: "audited", expectedValue: 2000 }, "audit-key");
  const audits = await db
    .collection("auditEvents")
    .where("actorUid", "==", ACTOR)
    .where("targetId", "==", id)
    .get();
  assert.ok(audits.size >= 1, "an audit event must exist");
  const ev = audits.docs[0].data();
  assert.equal(ev.action, "updateOpportunity");
  assert.equal(ev.outcome, "applied");
  assert.match(ev.summary, /need/, "the summary must name the changed fields");
  assert.match(ev.summary, /expectedValue/);
});

test("a WON Opportunity cannot be edited through this path", async () => {
  const id = await seed({ outcome: "WON" });
  await assert.rejects(run(id, { need: "x" }), /WON|closed/i);
});

test("editing a missing Opportunity is not-found, not a silent create", async () => {
  await assert.rejects(
    db.runTransaction((tx) =>
      persistUpdatedOpportunity(
        db,
        tx,
        db.collection("opportunities").doc("does-not-exist"),
        { opportunityId: "does-not-exist", expectedUpdatedAtMillis: 1_000, need: "x" },
        ACTOR,
        "nf",
      ),
    ),
    /No Opportunity/,
  );
  const doc = await db.collection("opportunities").doc("does-not-exist").get();
  assert.equal(doc.exists, false, "a failed edit must never create the document");
});

test("solution lines round-trip through the governed path", async () => {
  const id = await seed();
  await run(id, { lines: [{ kind: "PART", ref: "PRT-9", qty: 4 }] });
  const doc = (await db.collection("opportunities").doc(id).get()).data();
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].ref, "PRT-9");
  assert.equal(doc.lines[0].qty, 4);
});
