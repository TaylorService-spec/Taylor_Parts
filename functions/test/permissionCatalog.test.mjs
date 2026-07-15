// Enterprise Access & Administration Platform (Issue #226) -- Row 1
// (Task 6) acceptance test A2 (docs/specifications/
// enterprise-access-and-administration-platform.md §21): Permission ids
// conform to §6 and are unique/immutable across the seed set.
//
// Dependency-free: plain Node assert against the compiled catalog, no
// test runner, matching this repo's existing pure-logic test
// convention (field-ops-app-vite/test/*.test.mjs).
//
// Prerequisite: `npm run build` in functions/ first (this test imports
// the compiled lib/ output, not the TypeScript source).
import assert from "node:assert/strict";
import {
  PERMISSION_CATALOG,
  isValidPermissionId,
  findPermission,
  requirePermission,
} from "../lib/access/permissionCatalog.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err);
  }
}

check("catalog is non-empty", () => {
  assert.ok(PERMISSION_CATALOG.length > 0);
});

check("every id matches the <domain>.<resource>.<action> format", () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(
      isValidPermissionId(permission.id),
      `"${permission.id}" does not match the required format`,
    );
  }
});

check("every id is unique", () => {
  const ids = PERMISSION_CATALOG.map((p) => p.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "duplicate PermissionId found");
});

check("the catalog array is frozen (immutable)", () => {
  assert.ok(Object.isFrozen(PERMISSION_CATALOG));
});

check("every entry is frozen (immutable)", () => {
  for (const permission of PERMISSION_CATALOG) {
    assert.ok(Object.isFrozen(permission), `"${permission.id}" is not frozen`);
  }
});

check("no entry is deprecated without a successor id", () => {
  for (const permission of PERMISSION_CATALOG) {
    if (permission.deprecated) {
      assert.ok(
        permission.deprecatedInFavorOf,
        `"${permission.id}" is deprecated with no deprecatedInFavorOf`,
      );
    }
  }
});

check("findPermission resolves a known id", () => {
  const found = findPermission("account.record.read");
  assert.ok(found);
  assert.equal(found.id, "account.record.read");
});

check("findPermission returns undefined for an unknown id", () => {
  assert.equal(findPermission("not.a.realPermission"), undefined);
});

check("requirePermission throws (fails closed) for an unknown id", () => {
  assert.throws(() => requirePermission("not.a.realPermission"));
});

check("requirePermission resolves a known id", () => {
  const permission = requirePermission("workOrder.transition");
  assert.equal(permission.id, "workOrder.transition");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
