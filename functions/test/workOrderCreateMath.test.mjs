// Pure unit tests for the createWorkOrder idempotency marker helper. Firebase-free, run locally with
// `node --experimental-strip-types --test`. The full transactional replay (retry -> one WO, one WO number)
// is proven by the sibling emulator integration test in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkOrderAuditId } from "../src/workOrderCreateMath.ts";

test("createWorkOrderAuditId is deterministic and namespaced (same inputs -> same marker id)", () => {
  const a = createWorkOrderAuditId("uid-1", "cust-1|loc-1", "key-abc");
  const b = createWorkOrderAuditId("uid-1", "cust-1|loc-1", "key-abc");
  assert.equal(a, b, "same (actor, scope, key) must collide -> that collision IS the replay guard");
  assert.match(a, /^createWorkOrder_[0-9a-f]{40}$/);
});

test("createWorkOrderAuditId separates distinct keys / scopes / actors", () => {
  const base = createWorkOrderAuditId("uid-1", "cust-1|loc-1", "key-abc");
  assert.notEqual(base, createWorkOrderAuditId("uid-1", "cust-1|loc-1", "key-xyz"), "different key -> different marker");
  assert.notEqual(base, createWorkOrderAuditId("uid-1", "cust-2|loc-1", "key-abc"), "different scope -> different marker");
  assert.notEqual(base, createWorkOrderAuditId("uid-2", "cust-1|loc-1", "key-abc"), "different actor -> different marker");
});
