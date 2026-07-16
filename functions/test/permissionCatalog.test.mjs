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
  isValidReportObjectReadCapabilityId,
  isValidReportFieldReadCapabilityId,
  isActivePermission,
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

// --- Issue #325 / ADR-007 D-226: field-level read-capability extension ---

check("wave-1 report.* catalog: exactly 4 object-read + 30 field-read ids (34 total)", () => {
  const reportIds = PERMISSION_CATALOG.filter((p) => p.id.startsWith("report."));
  const objectIds = reportIds.filter((p) => isValidReportObjectReadCapabilityId(p.id));
  const fieldIds = reportIds.filter((p) => isValidReportFieldReadCapabilityId(p.id));
  assert.equal(objectIds.length, 4, "expected exactly 4 wave-1 object read capabilities");
  assert.equal(fieldIds.length, 30, "expected exactly 30 wave-1 field read capabilities");
  assert.equal(reportIds.length, 34, "every report.* id must be either object- or field-shaped, no third shape");
});

check("isValidReportObjectReadCapabilityId accepts the exact adopted shape only", () => {
  assert.ok(isValidReportObjectReadCapabilityId("report.customer.read"));
  assert.ok(!isValidReportObjectReadCapabilityId("report.customer.field.name.read"), "a field id is not an object id");
  assert.ok(!isValidReportObjectReadCapabilityId("Report.customer.read"), "wrong case must not match");
  assert.ok(!isValidReportObjectReadCapabilityId("report.customer.write"), "wrong action must not match");
  assert.ok(!isValidReportObjectReadCapabilityId("account.record.read"), "a non-report id must not match");
});

check("isValidReportFieldReadCapabilityId accepts the exact adopted shape only", () => {
  assert.ok(isValidReportFieldReadCapabilityId("report.customer.field.name.read"));
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.read"), "an object id is not a field id");
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.name.read"), "missing the literal 'field' segment must not match");
  assert.ok(!isValidReportFieldReadCapabilityId("report.customer.field.name.write"), "wrong action must not match");
  assert.ok(!isValidReportFieldReadCapabilityId("Report.customer.field.name.read"), "wrong case must not match");
});

check("every wave-1 report.* id is registered and passes isValidPermissionId (the general shape check already accepts it unchanged)", () => {
  for (const id of [
    "report.customer.read",
    "report.customer.field.billingAddress.read",
    "report.contact.field.customer.read",
    "report.location.field.accessNotes.read",
    "report.equipment.field.identity.read",
  ]) {
    assert.ok(isValidPermissionId(id), `"${id}" must satisfy the general PermissionId pattern`);
    assert.ok(findPermission(id), `"${id}" must be registered in the catalog`);
  }
});

check("isActivePermission: true for a registered, active id", () => {
  assert.equal(isActivePermission("report.customer.field.name.read"), true);
  assert.equal(isActivePermission("account.record.read"), true, "an ordinary pre-existing id with no active flag is active");
});

check("isActivePermission: false for a registered but explicitly inactive id (ADR-007 sec2.6 sensitive-by-default)", () => {
  assert.equal(isActivePermission("report.customer.field.notes.read"), false, "security-text, pending wave-1 review confirmation");
  assert.equal(isActivePermission("report.customer.field.accountOwner.read"), false, "employee-sensitivity, deferred to wave 4");
  assert.equal(isActivePermission("report.location.field.accessNotes.read"), false, "security-text, pending wave-1 review confirmation");
});

check("isActivePermission: false (never true) for an unregistered id -- stricter than findPermission, not a substitute", () => {
  assert.equal(isActivePermission("report.customer.field.doesNotExist.read"), false);
  assert.equal(isActivePermission("not.a.realPermission"), false);
});

check("exactly 3 wave-1 report.* ids are inactive; every other wave-1 id is active", () => {
  const reportIds = PERMISSION_CATALOG.filter((p) => p.id.startsWith("report."));
  const inactive = reportIds.filter((p) => p.active === false).map((p) => p.id);
  assert.deepEqual(
    inactive.sort(),
    [
      "report.customer.field.accountOwner.read",
      "report.customer.field.notes.read",
      "report.location.field.accessNotes.read",
    ].sort(),
  );
  for (const p of reportIds) {
    if (!inactive.includes(p.id)) {
      assert.equal(p.active, true, `"${p.id}" is expected active: true (explicit), not merely omitted`);
    }
  }
});

check("no non-report catalog entry declares `active` (this addition is additive-only for every pre-existing id)", () => {
  for (const permission of PERMISSION_CATALOG) {
    if (permission.id.startsWith("report.")) continue;
    assert.equal("active" in permission, false, `"${permission.id}" must not declare active -- would be a behavior change`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
