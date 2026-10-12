// DECISIONS #229 -- the shared authorization-denial audit helper, without a database: mode, attribution, privacy,
// rate-bound identity and fail-safety. The PostgreSQL behaviour is functions/test/authorizationDenialAuditPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const audit = require("../lib/eosAudit/authorizationDenialAudit.js");

const DENIAL = Object.freeze({
  tenantId: "t1", principalId: "p1", domain: "catalog", operation: "createPart",
  requiredCapability: "inventory.catalog.manage", refusalCode: "CAPABILITY_REQUIRED", correlationId: "req-123",
});
const AT = new Date("2026-10-11T12:00:30.000Z");

// Answers the Administrator-standing lookup withActorAuthority makes (no standing), and records the audit INSERT.
function fakePool({ fail = false, rowCount = 1 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      if (fail) throw new Error("connection refused -- contains nothing about the request");
      if (!/INSERT INTO eos_policy\.audit_events/.test(text)) return { rows: [], rowCount: 0 };
      calls.push({ text, values });
      return { rowCount };
    },
  };
}

test("the committed mode is OFF: activation is a reviewed code change, and OFF writes nothing", async () => {
  assert.equal(audit.AUTHORIZATION_DENIAL_AUDIT.mode, "OFF");
  assert.ok(Object.isFrozen(audit.AUTHORIZATION_DENIAL_AUDIT));
  const pool = fakePool();
  assert.equal(await audit.recordAuthorizationDenial(pool, DENIAL), "SKIPPED_OFF");
  assert.equal(pool.calls.length, 0);
});

test("RECORD writes one row with exactly the policy's fields -- and nothing from the request", async () => {
  const pool = fakePool();
  assert.equal(await audit.recordAuthorizationDenial(pool, DENIAL, { mode: "RECORD", now: () => AT }), "RECORDED");
  assert.equal(pool.calls.length, 1);
  const [id, tenant, action, actor, targetKind, targetId, after, occurredAt, reason] = pool.calls[0].values;
  assert.match(pool.calls[0].text, /ON CONFLICT \(id\) DO NOTHING/);
  assert.match(id, /^audit_denied_[0-9a-f]{40}$/);
  assert.deepEqual([tenant, action, actor, targetKind, targetId, reason], ["t1", "catalog.createPart.denied", "p1", "authorization", "createPart", "CAPABILITY_REQUIRED"]);
  assert.deepEqual(JSON.parse(after), { operation: "createPart", requiredCapability: "inventory.catalog.manage", refusalCode: "CAPABILITY_REQUIRED", correlationId: "req-123" });
  assert.equal(occurredAt, AT);
});

test("rate bound: one id per (tenant, principal, action, code, minute)", () => {
  const id = (over = {}, at = AT) => audit.denialAuditId(over.t ?? "t1", over.p ?? "p1", over.a ?? "catalog.createPart.denied", over.c ?? "CAPABILITY_REQUIRED", at);
  assert.equal(id(), id({}, new Date("2026-10-11T12:00:59.999Z")), "same minute -> same row");
  assert.notEqual(id(), id({}, new Date("2026-10-11T12:01:00.000Z")), "next minute -> a new row");
  for (const over of [{ t: "t2" }, { p: "p2" }, { a: "catalog.updatePart.denied" }, { c: "ACTOR_NOT_TENANT_MEMBER" }]) {
    assert.notEqual(id(), id(over), JSON.stringify(over));
  }
});

test("a conflicting (already recorded) row is DEDUPLICATED, not an error", async () => {
  const pool = fakePool({ rowCount: 0 });
  assert.equal(await audit.recordAuthorizationDenial(pool, DENIAL, { mode: "RECORD", now: () => AT }), "DEDUPLICATED");
});

test("an unresolved identity is never recorded (no Principal to attribute; never the caller-stated tenant)", async () => {
  for (const over of [{ tenantId: "" }, { principalId: "" }, { tenantId: null }, { principalId: undefined }, { operation: "bad op; DROP" }, { refusalCode: "" }]) {
    const pool = fakePool();
    assert.equal(await audit.recordAuthorizationDenial(pool, { ...DENIAL, ...over }, { mode: "RECORD" }), "SKIPPED_UNRESOLVED", JSON.stringify(over));
    assert.equal(pool.calls.length, 0);
  }
});

test("a correlation id is recorded only when it is a plain token; anything else is dropped, never echoed", async () => {
  assert.equal(audit.sanitizeCorrelationId("abc-123.x:y_z"), "abc-123.x:y_z");
  for (const bad of ["", "has space", "x".repeat(129), "<script>", "Bearer eyJ...", 42, null]) {
    assert.equal(audit.sanitizeCorrelationId(bad), null, String(bad));
  }
  const pool = fakePool();
  await audit.recordAuthorizationDenial(pool, { ...DENIAL, correlationId: "Bearer secret-token" }, { mode: "RECORD", now: () => AT });
  assert.equal(JSON.parse(pool.calls[0].values[6]).correlationId, null);
  assert.ok(!JSON.stringify(pool.calls[0].values).includes("secret-token"));
});

test("an audit-store failure is swallowed: FAILED, a payload-free warning, and never a throw", async () => {
  const warnings = [];
  const pool = fakePool({ fail: true });
  assert.equal(await audit.recordAuthorizationDenial(pool, DENIAL, { mode: "RECORD", warn: (m) => warnings.push(m) }), "FAILED");
  assert.deepEqual(warnings, ["authorization-denial audit: the audit row could not be written"]);
  const throwing = { query() { throw new Error("synchronous driver failure"); } };
  assert.equal(await audit.recordAuthorizationDenial(throwing, DENIAL, { mode: "RECORD", warn: () => {} }), "FAILED");
  assert.equal(await audit.recordAuthorizationDenial(null, DENIAL, { mode: "RECORD", warn: () => {} }), "FAILED");
});
