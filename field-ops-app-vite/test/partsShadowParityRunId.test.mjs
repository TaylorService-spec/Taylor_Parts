// INV-CONVERGENCE-E Stage A completion -- run-ID provider tests. Offline.
import assert from "node:assert/strict";
import { createRunIdProvider } from "../src/domain/partsShadowParityRunId.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("partsShadowParityRunId.test.mjs");

check("consecutive calls of one provider yield distinct opaque run IDs", () => {
  const next = createRunIdProvider();
  const a = next(); const b = next(); const c = next();
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  for (const id of [a, b, c]) assert.match(id, /^run-.+-\d+$/);
});
check("run IDs contain no user identity (no @, no uid-looking claim keys)", () => {
  const next = createRunIdProvider();
  const id = next();
  assert.ok(!/@/.test(id));
  assert.ok(!/uid|email|user/i.test(id));
});
check("two independent providers do not collide on their first id", () => {
  // distinct opaque prefixes -> first ids differ (crypto.randomUUID available in Node/browser)
  assert.notEqual(createRunIdProvider()(), createRunIdProvider()());
});

console.log(`\n${passed} passed`);
