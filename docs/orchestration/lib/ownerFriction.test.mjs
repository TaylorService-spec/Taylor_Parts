import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createFrictionEvent, validateFrictionEvent, projectOwnerFriction, isAvoidable,
  OWNER_FRICTION_CATEGORIES, AVOIDABLE_FRICTION, NECESSARY_FRICTION,
} from "./ownerFriction.mjs";

test("a friction event requires a known category and durable evidence", () => {
  assert.deepEqual(validateFrictionEvent(createFrictionEvent({ category: "MANUAL_HANDOFF", evidenceRef: "turn-log" })), []);
  assert.ok(validateFrictionEvent(createFrictionEvent({ category: "MANUAL_HANDOFF" })).some((e) => /evidenceRef/.test(e)));
  assert.ok(validateFrictionEvent(createFrictionEvent({ category: "NONSENSE", evidenceRef: "x" })).some((e) => /category/.test(e)));
});

test("avoidable vs necessary categories are distinguished (necessary is preserved, never hidden)", () => {
  assert.equal(isAvoidable("MANUAL_CONTEXT_RELAY"), true);
  assert.equal(isAvoidable("NECESSARY_OWNER_AUTHORIZATION"), false);
  assert.equal(AVOIDABLE_FRICTION.length + NECESSARY_FRICTION.length, OWNER_FRICTION_CATEGORIES.length);
});

test("MANUAL_CONTEXT_RELAY is DERIVED from ownerRelayed exchanges (real evidence, not invented)", () => {
  const f = projectOwnerFriction([], { aiExchanges: [{ ownerRelayed: true }, { ownerRelayed: true }, { ownerRelayed: false }] });
  assert.equal(f.derivedManualContextRelay, 2);
  assert.equal(f.byCategory.MANUAL_CONTEXT_RELAY, 2);
  assert.equal(f.avoidableTotal, 2);
});

test("necessary Owner decision/authorization counts are preserved, not folded into avoidable", () => {
  const events = [
    createFrictionEvent({ category: "NECESSARY_OWNER_AUTHORIZATION", evidenceRef: "HOSTING-DEPLOY-001" }),
    createFrictionEvent({ category: "UNNECESSARY_DECISION", evidenceRef: "x" }),
  ];
  const f = projectOwnerFriction(events);
  assert.equal(f.necessaryTotal, 1);
  assert.equal(f.avoidableTotal, 1);
  assert.match(f.goal, /reduce avoidable/);
});
