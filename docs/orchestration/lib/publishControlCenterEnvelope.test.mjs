import { test } from "node:test";
import assert from "node:assert/strict";
import { planPublish, publishEnvelope, ENVELOPE_COLLECTION } from "./publishControlCenterEnvelope.mjs";

const GENERATED_AT = "2026-08-09T12:00:00.000Z";
const PUBLISHED_AT = "2026-08-09T12:01:00.000Z";

test("planPublish requires provenance — refuses an ungoverned publish", () => {
  assert.throws(() => planPublish({ projectId: "taylor-parts", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT }), /commit is required/);
  assert.throws(() => planPublish({ commit: "abc", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT }), /projectId is required/);
  assert.throws(() => planPublish({ projectId: "taylor-parts", commit: "abc", publishedAt: PUBLISHED_AT }), /generatedAt is required/);
});

test("planPublish targets one gated doc per project and carries a publish record", () => {
  const payload = { schemaVersion: "1.1.0", source: { commit: "abc123" }, views: {} };
  const plan = planPublish({ projectId: "taylor-parts", commit: "abc123", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT, payload });
  assert.equal(plan.collection, ENVELOPE_COLLECTION);
  assert.equal(plan.docId, "taylor-parts");
  assert.equal(plan.publishRecord.commit, "abc123");
  assert.equal(plan.publishRecord.generatedAt, GENERATED_AT);
  assert.equal(plan.publishRecord.publishedAt, PUBLISHED_AT);
  assert.equal(plan.publishRecord.schemaVersion, "1.1.0");
  assert.equal(plan.envelope, payload);
});

test("planPublish fails closed on a mislabelled envelope (provenance mismatch)", () => {
  const payload = { schemaVersion: "1.1.0", source: { commit: "REAL" }, views: {} };
  assert.throws(
    () => planPublish({ projectId: "taylor-parts", commit: "CLAIMED", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT, payload }),
    /!= declared commit/,
  );
});

test("publishEnvelope is DRY-RUN by default — writes nothing", async () => {
  let wrote = false;
  const fakeDb = { collection: () => ({ doc: () => ({ set: async () => { wrote = true; } }) }) };
  const payload = { schemaVersion: "1.1.0", source: { commit: "abc" }, views: {} };
  const r = await publishEnvelope({ projectId: "taylor-parts", commit: "abc", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT, payload, firestore: fakeDb });
  assert.equal(r.dryRun, true);
  assert.equal(r.wrote, false);
  assert.equal(wrote, false, "no write without execute:true");
});

test("publishEnvelope writes exactly one doc when execute:true + firestore injected", async () => {
  const calls = [];
  const fakeDb = {
    collection: (c) => ({ doc: (d) => ({ set: async (data, opts) => { calls.push({ c, d, data, opts }); } }) }),
  };
  const payload = { schemaVersion: "1.1.0", source: { commit: "abc" }, views: { a: 1 } };
  const r = await publishEnvelope({ projectId: "taylor-parts", commit: "abc", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT, payload, firestore: fakeDb, execute: true });
  assert.equal(r.wrote, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].c, ENVELOPE_COLLECTION);
  assert.equal(calls[0].d, "taylor-parts");
  assert.deepEqual(calls[0].data.envelope, payload);
  assert.equal(calls[0].data.publish.commit, "abc");
  assert.equal(calls[0].opts.merge, false);
});

test("publishEnvelope stays dry-run if execute:true but no firestore handle", async () => {
  const payload = { schemaVersion: "1.1.0", source: { commit: "abc" }, views: {} };
  const r = await publishEnvelope({ projectId: "taylor-parts", commit: "abc", generatedAt: GENERATED_AT, publishedAt: PUBLISHED_AT, payload, execute: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.wrote, false);
});
