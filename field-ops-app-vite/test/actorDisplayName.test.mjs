// F-UID-1 regression -- resolveActorDisplayName must NEVER return a raw
// Firebase UID on a non-Admin surface. Proves the fix for the confirmed
// defect: the resolver used to fall back to the raw uid while the
// directory was loading or when no linked Employee existed, leaking the
// uid into the inventory (non-Admin) DOM.
//
// Run: node test/actorDisplayName.test.mjs   (also `npm test`)
import assert from "node:assert/strict";
import {
  resolveActorDisplayName,
  UNKNOWN_ACTOR_DISPLAY_NAME,
} from "../src/domain/actorDisplayName.js";

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log("PASS -- " + name); }

// A realistic Firebase Auth UID shape (28-char alphanumeric). The core
// assertion everywhere below is that THIS STRING never appears in output.
const RAW_UID = "aZ3kP9qXfL2mN7bV0cR5tY8wD1eH";

function assertNoRawUid(result) {
  assert.notStrictEqual(result, RAW_UID, "result must not equal the raw uid");
  assert.ok(
    typeof result !== "string" || !result.includes(RAW_UID),
    `result must not contain the raw uid, got: ${String(result)}`,
  );
}

ok("resolved Employee record -> recognizable name, no raw uid", () => {
  const byUserId = new Map([[RAW_UID, { userId: RAW_UID, displayName: "Dana Ruiz" }]]);
  const result = resolveActorDisplayName(RAW_UID, byUserId);
  assert.strictEqual(result, "Dana Ruiz");
  assertNoRawUid(result);
});

ok("directory still loading (empty map) -> neutral label, never the raw uid", () => {
  // useEmployeeDirectory initializes byUserId to an empty Map with
  // loading=true; the actor cell renders during that window.
  const result = resolveActorDisplayName(RAW_UID, new Map());
  assertNoRawUid(result);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
});

ok("missing Employee record -> neutral label, never the raw uid", () => {
  const byUserId = new Map([["someone-else", { userId: "someone-else", displayName: "Other Person" }]]);
  const result = resolveActorDisplayName(RAW_UID, byUserId);
  assertNoRawUid(result);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
});

ok("failed directory read (empty map / undefined) -> neutral label, never the raw uid", () => {
  // onSnapshot error handler resets byUserId to an empty Map; also guard
  // the defensive undefined-directory path.
  for (const dir of [new Map(), undefined]) {
    const result = resolveActorDisplayName(RAW_UID, dir);
    assertNoRawUid(result);
    assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  }
});

ok("legacy actor uid with no Employee link -> neutral label, never the raw uid", () => {
  const byUserId = new Map([["linked-user", { userId: "linked-user", displayName: "Linked User" }]]);
  const result = resolveActorDisplayName("legacy-actor-uid-9f3c2a1b7e", byUserId);
  assert.strictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  assert.ok(!String(result).includes("legacy-actor-uid-9f3c2a1b7e"));
});

ok("null / undefined / blank actor -> existing empty-value convention (distinct from 'Unknown user')", () => {
  for (const empty of [null, undefined, ""]) {
    const result = resolveActorDisplayName(empty, new Map());
    // Absence of an actor stays visually empty -- NOT relabeled as an
    // unresolved actor -- preserving the meaningful distinction.
    assert.strictEqual(result, empty);
    assert.notStrictEqual(result, UNKNOWN_ACTOR_DISPLAY_NAME);
  }
});

ok("no raw uid survives for ANY unresolved uid shape (fuzz over uid-like inputs)", () => {
  const emptyDir = new Map();
  for (const uid of [RAW_UID, "0123456789abcdef0123456789", "Xy", "uid_with_underscores_123", "UPPERCASEUID1234567890"]) {
    const result = resolveActorDisplayName(uid, emptyDir);
    assert.notStrictEqual(result, uid);
    assert.ok(!String(result).includes(uid));
  }
});

console.log(`\n${passed} passed, 0 failed`);
